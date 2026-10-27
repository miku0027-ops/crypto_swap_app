import { z } from "zod";
import { formatUnits, isAddress } from "viem";
import { AppError } from "./errors.js";
import {
  chainIdSchema,
  parseInput,
  uintSchema,
  walletAddressSchema,
} from "./validation.js";

export interface AccountCurrency {
  chainId: number;
  address: string;
  name: string | null;
  symbol: string | null;
  decimals: number | null;
}
export interface AccountBalance {
  currency: AccountCurrency | null;
  amount: string;
  amountFormatted: string | null;
  amountUsd: string | null;
}
export interface AppBalanceResult {
  address: string;
  balances: Array<AccountBalance & { minimumAmount: string | null }>;
  totalBalanceUsd: number | null;
  availableBalanceUsd: number | null;
  outstandingFastFillBalanceUsd: number | null;
  fetchedAt: number;
}
export interface RecoveryBalanceResult {
  address: string;
  ownerChainId: number;
  balances: Array<AccountBalance & { hubTokenId: string }>;
  hasMore: boolean;
  fetchedAt: number;
}

const MAX_BYTES = 1024 * 1024;
const MAX_ENTRIES = 100;
const CACHE_TTL_MS = 15_000;
const TIMEOUT_MS = 8_000;
const cleanText = (max: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(max)
    .regex(/^[^\u0000-\u001f\u007f]+$/);
const nullableText = (max: number) =>
  cleanText(max)
    .nullish()
    .transform((value) => value ?? null);
const decimal = z
  .string()
  .max(120)
  .regex(/^(0|[1-9]\d{0,77})(?:\.\d{1,36})?$/);
const nullableDecimal = decimal.nullish().transform((value) => value ?? null);
const nullableTotal = z
  .number()
  .finite()
  .min(0)
  .max(Number.MAX_SAFE_INTEGER)
  .nullish()
  .transform((value) => value ?? null);
const currencySchema = z.object({
  chainId: chainIdSchema,
  // Recovery metadata can describe a non-EVM asset. Keep it as inert text;
  // any 0x-prefixed value must still be a valid EVM address.
  address: z
    .string()
    .min(1)
    .max(256)
    .regex(/^[A-Za-z0-9:_-]+$/)
    .refine(
      (value) => !value.startsWith("0x") || isAddress(value, { strict: true }),
    ),
  name: nullableText(120),
  symbol: nullableText(32),
  decimals: z
    .number()
    .int()
    .min(0)
    .max(36)
    .nullish()
    .transform((value) => value ?? null),
});
const balanceFields = {
  currency: currencySchema.nullable(),
  amount: uintSchema,
  amountFormatted: nullableDecimal,
  amountUsd: nullableDecimal,
};
const appSchema = z.object({
  balances: z
    .array(
      z.object({
        ...balanceFields,
        minimumAmount: uintSchema.nullish().transform((value) => value ?? null),
      }),
    )
    .max(100),
  totalBalanceUsd: nullableTotal,
  availableBalanceUsd: nullableTotal,
  outstandingFastFillBalanceUsd: nullableTotal,
});
const recoverySchema = z.object({
  balances: z
    .array(
      z.object({
        ...balanceFields,
        hubTokenId: cleanText(512),
      }),
    )
    .max(20),
  continuation: cleanText(512).nullable(),
});
const invalid = () =>
  new AppError(
    502,
    "ACCOUNT_RESOURCE_INVALID_RESPONSE",
    "The provider returned incomplete balance data. Please retry later.",
  );

function checked<T>(schema: z.ZodType<T>, raw: unknown): T {
  const result = schema.safeParse(raw);
  if (!result.success) throw invalid();
  return result.data;
}
function normalized<T extends AccountBalance>(balance: T): T {
  const decimals = balance.currency?.decimals;
  return {
    ...balance,
    // Never let a provider's human-readable amount disagree with the raw units.
    amountFormatted:
      decimals === undefined || decimals === null
        ? null
        : formatUnits(BigInt(balance.amount), decimals),
  };
}

/** Public provider balance reads only. No attestation, signature or fund movement. */
export class AccountResourcesService {
  private readonly cache = new Map<
    string,
    { expiresAt: number; value: unknown }
  >();
  private readonly pending = new Map<string, Promise<unknown>>();
  constructor(
    private readonly fetchImpl: typeof fetch = globalThis.fetch,
    private readonly now: () => number = Date.now,
    private readonly beforeRequest?: () => Promise<void>,
  ) {}

  async appBalance(address: string): Promise<AppBalanceResult> {
    const wallet = parseInput(walletAddressSchema, address);
    return this.cached(`app:${wallet.toLowerCase()}`, async () => {
      const raw = checked(
        appSchema,
        await this.request(
          `/app-fees/${encodeURIComponent(wallet.toLowerCase())}/balances`,
        ),
      );
      return {
        address: wallet,
        ...raw,
        balances: raw.balances.map(normalized),
        fetchedAt: this.now(),
      };
    });
  }

  async recovery(
    address: string,
    ownerChainId: number,
  ): Promise<RecoveryBalanceResult> {
    const wallet = parseInput(walletAddressSchema, address);
    const chain = parseInput(chainIdSchema, ownerChainId);
    return this.cached(
      `recovery:${wallet.toLowerCase()}:${chain}`,
      async () => {
        const query = new URLSearchParams({
          recoveryAddress: wallet.toLowerCase(),
          ownerChainId: String(chain),
          limit: "20",
        });
        const raw = checked(
          recoverySchema,
          await this.request(`/withdrawals/balances?${query}`),
        );
        return {
          address: wallet,
          ownerChainId: chain,
          balances: raw.balances.map(normalized),
          hasMore: raw.continuation !== null,
          fetchedAt: this.now(),
        };
      },
    );
  }

  private async cached<T>(key: string, read: () => Promise<T>): Promise<T> {
    const cached = this.cache.get(key);
    if (cached && cached.expiresAt > this.now())
      return structuredClone(cached.value) as T;
    const pending = this.pending.get(key);
    if (pending) return structuredClone(await pending) as T;
    if (this.pending.size >= MAX_ENTRIES)
      throw new AppError(
        503,
        "ACCOUNT_RESOURCE_BUSY",
        "Balance discovery is busy. Please retry shortly.",
      );
    const promise = read()
      .then((value) => {
        if (this.cache.size >= MAX_ENTRIES)
          this.cache.delete(this.cache.keys().next().value!);
        this.cache.set(key, { value, expiresAt: this.now() + CACHE_TTL_MS });
        return value;
      })
      .finally(() => this.pending.delete(key));
    this.pending.set(key, promise);
    return structuredClone(await promise);
  }

  private async request(path: string): Promise<unknown> {
    // Shared quotas apply only to actual upstream requests, after cache admission.
    await this.beforeRequest?.();
    const controller = new AbortController();
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        void reader?.cancel().catch(() => {});
        reject(
          new AppError(
            504,
            "ACCOUNT_RESOURCE_TIMEOUT",
            "Balance discovery timed out. Please retry.",
          ),
        );
      }, TIMEOUT_MS);
    });
    try {
      return await Promise.race([
        deadline,
        (async () => {
          const response = await this.fetchImpl(
            `https://api.relay.link${path}`,
            {
              method: "GET",
              headers: { accept: "application/json" },
              credentials: "omit",
              redirect: "error",
              signal: controller.signal,
            },
          );
          if (response.status === 429) {
            await response.body?.cancel();
            const seconds = Number(response.headers.get("Retry-After"));
            throw new AppError(
              429,
              "ACCOUNT_RESOURCE_RATE_LIMIT",
              "Balance discovery is temporarily rate limited. Please wait before retrying.",
              Number.isFinite(seconds) && seconds > 0
                ? Math.min(300, Math.ceil(seconds))
                : 5,
            );
          }
          if (!response.ok) {
            await response.body?.cancel();
            throw new AppError(
              503,
              "ACCOUNT_RESOURCE_UNAVAILABLE",
              "Balance discovery is temporarily unavailable. Please retry later.",
            );
          }
          const advertised = Number(
            response.headers.get("content-length") || 0,
          );
          if (advertised > MAX_BYTES || !response.body) {
            await response.body?.cancel();
            throw invalid();
          }
          reader = response.body.getReader();
          const chunks: Uint8Array[] = [];
          let size = 0;
          for (;;) {
            const part = await reader.read();
            if (part.done) break;
            size += part.value.byteLength;
            if (size > MAX_BYTES) {
              await reader.cancel();
              throw invalid();
            }
            chunks.push(part.value);
          }
          const bytes = new Uint8Array(size);
          let offset = 0;
          for (const chunk of chunks) {
            bytes.set(chunk, offset);
            offset += chunk.byteLength;
          }
          try {
            return JSON.parse(
              new TextDecoder("utf-8", { fatal: true }).decode(bytes),
            ) as unknown;
          } catch {
            throw invalid();
          }
        })(),
      ]);
    } catch (error) {
      if (error instanceof AppError) throw error;
      if (controller.signal.aborted)
        throw new AppError(
          504,
          "ACCOUNT_RESOURCE_TIMEOUT",
          "Balance discovery timed out. Please retry.",
        );
      throw new AppError(
        503,
        "ACCOUNT_RESOURCE_UNAVAILABLE",
        "Balance discovery is temporarily unavailable. Please retry later.",
      );
    } finally {
      if (timer) clearTimeout(timer);
      reader?.releaseLock();
    }
  }
}
