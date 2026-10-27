import { formatUnits } from "viem";
import { z } from "zod";
import { AppError } from "./errors.js";
import { KNOWN_VAULTS } from "./vault-metadata.js";
import {
  chainIdSchema,
  uintSchema,
  walletAddressSchema,
} from "./validation.js";

const ENDPOINT = "https://vaults-api.relay.link/";
const MAX_BYTES = 1024 * 1024;
const MAX_POSITION_WALLETS = 100;
const POSITION_TTL_MS = 15_000;
const CATALOG_TTL_MS = 60_000;
const STALE_AFTER_MS = 60 * 60 * 1000;
const FUTURE_TOLERANCE_MS = 5 * 60 * 1000;
const LIFECYCLE = {
  phase: "wind-down" as const,
  depositsEnabled: false as const,
  withdrawalUiEndDate: "2026-12-31",
  sourceUrl: "https://docs.relay.link/references/protocol/vaults/overview",
};
const poolQuery = `{ relayPools(limit:50) { items { chainId contractAddress name symbol asset decimals apy totalAssets totalShares outstandingDebt updatedAt } totalCount } }`;
const positionQuery = `query Positions($wallet: String!) { userBalances(where:{wallet:$wallet}, limit:50) { items { chainId relayPool wallet shareBalance totalDeposited totalWithdrawn updatedAt } totalCount pageInfo { hasNextPage endCursor } } }`;
const timestamp = z
  .string()
  .regex(/^(0|[1-9]\d{0,15})$/)
  .refine(
    (v) =>
      Number.isSafeInteger(Number(v)) &&
      Number(v) > 0 &&
      Number(v) <= 8_640_000_000_000_000,
  )
  .transform(Number);
const label = z
  .string()
  .trim()
  .min(1)
  .max(160)
  .regex(/^[^\x00-\x1f\x7f]+$/);
const poolSchema = z.object({
  chainId: chainIdSchema,
  contractAddress: walletAddressSchema,
  name: label,
  symbol: label,
  asset: walletAddressSchema,
  // Provider decimals() is read from the share contract. Asset decimals are
  // separately reviewed below; ERC-4626 share decimals need not equal them.
  decimals: z.number().int().min(0).max(36),
  // Official ponder.schema.ts: APY is an integer in basis points. The
  // provider's missing-history fallback is zero, so zero remains unavailable.
  apy: z.number().int().min(-10_000).max(2_147_483_647).optional(),
  totalAssets: uintSchema,
  totalShares: uintSchema,
  outstandingDebt: uintSchema,
  updatedAt: timestamp,
});
const positionSchema = z.object({
  chainId: chainIdSchema,
  relayPool: walletAddressSchema,
  wallet: walletAddressSchema,
  shareBalance: uintSchema,
  totalDeposited: uintSchema,
  totalWithdrawn: uintSchema,
  updatedAt: timestamp,
});
export type VaultPool = {
  chainId: number;
  address: string;
  name: string;
  symbol: string;
  assetAddress: string;
  decimals: number;
  assetSymbol: string | null;
  assetDecimals: number | null;
  metadataSource: string | null;
  totalAssets: string;
  totalAssetsFormatted: string | null;
  totalShares: string;
  totalSharesFormatted: string;
  outstandingDebt: string;
  apyPercent: string | null;
  tvlUsd: string | null;
  metricsUpdatedAt: number;
  metricsSource: string;
  priceFetchedAt: number | null;
  priceSource: string | null;
  updatedAt: number;
  dataStale: boolean;
};
export type VaultPosition = {
  chainId: number;
  poolAddress: string;
  wallet: string;
  shareBalance: string;
  shareBalanceFormatted: string | null;
  symbol: string | null;
  updatedAt: number;
  indexUpdatedAt: number | null;
  dataStale: boolean;
};
export type VaultCatalog = {
  pools: VaultPool[];
  fetchedAt: number;
  truncated: boolean;
  lifecycle: typeof LIFECYCLE;
};
export type VaultPositions = {
  positions: VaultPosition[];
  fetchedAt: number;
  truncated: boolean;
  lifecycle: typeof LIFECYCLE;
};
function invalid(): never {
  throw new AppError(
    502,
    "INVALID_VAULT_RESPONSE",
    "The vault provider returned incomplete data. Please retry later.",
  );
}
function parse<T>(schema: z.ZodType<T>, v: unknown): T {
  const result = schema.safeParse(v);
  if (!result.success) return invalid();
  return result.data;
}
function unique(items: Array<{ chainId: number; address: string }>) {
  if (
    new Set(items.map((p) => `${p.chainId}:${p.address.toLowerCase()}`))
      .size !== items.length
  )
    invalid();
}
/** Multiply integer token units by the provider's decimal USD price without
 * converting balances to floating point. USD estimates are truncated to 6dp.
 */
function dollarValue(amount: string, decimals: number, price: number): string {
  const [mantissa, exponent = "0"] = String(price).toLowerCase().split("e");
  const [whole, fraction = ""] = mantissa.split(".");
  let coefficient = BigInt(whole + fraction);
  let scale = fraction.length - Number(exponent);
  if (scale < 0) {
    coefficient *= 10n ** BigInt(-scale);
    scale = 0;
  }
  return formatUnits(
    (BigInt(amount) * coefficient * 1_000_000n) /
      10n ** BigInt(decimals + scale),
    6,
  );
}

/** Public read-only index and pricing. No approvals, signatures or deposits. */
export class VaultsService {
  private cached: VaultCatalog | undefined;
  private pending: Promise<VaultCatalog> | undefined;
  private readonly positionCache = new Map<
    string,
    { expiresAt: number; value: VaultPositions }
  >();
  private readonly positionPending = new Map<string, Promise<VaultPositions>>();
  constructor(
    private fetchImpl: typeof fetch = fetch,
    private now: () => number = Date.now,
    private beforeRequest?: (
      kind: "catalog" | "positions" | "price",
    ) => Promise<void>,
  ) {}

  private validateTime(value: number): void {
    if (value > this.now() + FUTURE_TOLERANCE_MS) invalid();
  }

  private async requestJson(
    url: string,
    kind: "catalog" | "positions" | "price",
    body?: unknown,
    timeoutMs = 8000,
  ): Promise<unknown> {
    const controller = new AbortController();
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        // Cancellation itself can stall on a broken upstream stream.
        void reader?.cancel().catch(() => {});
        reject(
          new AppError(
            504,
            "VAULTS_TIMEOUT",
            "Vault information took too long to respond. Please retry.",
          ),
        );
      }, timeoutMs);
    });
    try {
      return await Promise.race([
        deadline,
        (async () => {
          await this.beforeRequest?.(kind);
          if (controller.signal.aborted)
            throw new AppError(
              504,
              "VAULTS_TIMEOUT",
              "Vault information took too long to respond. Please retry.",
            );
          const response = await this.fetchImpl(url, {
            method: body === undefined ? "GET" : "POST",
            credentials: "omit",
            redirect: "error",
            signal: controller.signal,
            headers: {
              Accept: "application/json",
              ...(body === undefined
                ? {}
                : { "Content-Type": "application/json" }),
            },
            ...(body === undefined ? {} : { body: JSON.stringify(body) }),
          });
          // A fetch implementation may ignore AbortSignal and resolve after our
          // deadline. Cancel its body and do not start another read.
          if (controller.signal.aborted) {
            void response.body?.cancel().catch(() => {});
            throw new AppError(
              504,
              "VAULTS_TIMEOUT",
              "Vault information took too long to respond. Please retry.",
            );
          }
          if (response.status === 429) {
            void response.body?.cancel().catch(() => {});
            throw new AppError(
              429,
              "VAULTS_RATE_LIMITED",
              "The vault provider is busy. Please retry in a minute.",
              60,
            );
          }
          if (!response.ok) {
            void response.body?.cancel().catch(() => {});
            throw new AppError(
              502,
              "VAULTS_UNAVAILABLE",
              "Vault information is temporarily unavailable.",
            );
          }
          const length = Number(response.headers.get("content-length"));
          if (Number.isFinite(length) && length > MAX_BYTES) {
            void response.body?.cancel().catch(() => {});
            invalid();
          }
          if (!response.body) invalid();
          reader = response.body.getReader();
          let size = 0;
          const chunks: Uint8Array[] = [];
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            size += value.byteLength;
            if (size > MAX_BYTES) invalid();
            chunks.push(value);
          }
          const bytes = new Uint8Array(size);
          let offset = 0;
          for (const chunk of chunks) {
            bytes.set(chunk, offset);
            offset += chunk.length;
          }
          try {
            return JSON.parse(
              new TextDecoder("utf-8", { fatal: true }).decode(bytes),
            ) as unknown;
          } catch {
            invalid();
          }
        })(),
      ]);
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(
        controller.signal.aborted ? 504 : 502,
        controller.signal.aborted ? "VAULTS_TIMEOUT" : "VAULTS_UNAVAILABLE",
        controller.signal.aborted
          ? "Vault information took too long to respond. Please retry."
          : "Vault information is temporarily unavailable.",
      );
    } finally {
      if (timer) clearTimeout(timer);
      void reader?.cancel().catch(() => {});
      // releaseLock rejects a pending read after our timeout, safely consumed
      // by the promise already registered with Promise.race.
      reader?.releaseLock();
    }
  }

  private async request(
    query: string,
    variables?: Record<string, string>,
  ): Promise<unknown> {
    const envelope = parse(
      z.object({
        data: z.record(z.string(), z.unknown()),
        errors: z.array(z.unknown()).optional(),
      }),
      await this.requestJson(ENDPOINT, variables ? "positions" : "catalog", {
        query,
        ...(variables ? { variables } : {}),
      }),
    );
    if (envelope.errors?.length) invalid();
    return envelope.data;
  }

  async pools(): Promise<VaultCatalog> {
    if (this.cached && this.cached.fetchedAt > this.now() - CATALOG_TTL_MS)
      return this.cloneCatalog(this.cached);
    if (this.pending) return this.cloneCatalog(await this.pending);
    this.pending = (async () => {
      const raw = parse(
        z.object({
          relayPools: z.object({
            items: z.array(poolSchema).max(50),
            totalCount: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
          }),
        }),
        await this.request(poolQuery),
      );
      if (raw.relayPools.totalCount < raw.relayPools.items.length) invalid();
      unique(
        raw.relayPools.items.map((p) => ({
          chainId: p.chainId,
          address: p.contractAddress,
        })),
      );
      // Validate all records before making optional USD-price requests.
      const pools: VaultPool[] = raw.relayPools.items.map((p) => {
        this.validateTime(p.updatedAt);
        const metadata = KNOWN_VAULTS.find(
          (v) =>
            v.chainId === p.chainId &&
            v.address === p.contractAddress.toLowerCase(),
        );
        if (
          metadata &&
          (metadata.assetAddress !== p.asset.toLowerCase() ||
            metadata.shareDecimals !== p.decimals)
        )
          invalid();
        return {
          chainId: p.chainId,
          address: p.contractAddress,
          name: p.name,
          symbol: p.symbol,
          assetAddress: p.asset,
          decimals: p.decimals,
          assetSymbol: metadata?.assetSymbol ?? null,
          assetDecimals: metadata?.assetDecimals ?? null,
          metadataSource: metadata?.metadataSource ?? null,
          totalAssets: p.totalAssets,
          totalAssetsFormatted: metadata
            ? formatUnits(BigInt(p.totalAssets), metadata.assetDecimals)
            : null,
          totalShares: p.totalShares,
          totalSharesFormatted: formatUnits(BigInt(p.totalShares), p.decimals),
          outstandingDebt: p.outstandingDebt,
          apyPercent: p.apy ? formatUnits(BigInt(p.apy), 2) : null,
          tvlUsd: null,
          metricsUpdatedAt: p.updatedAt,
          metricsSource: ENDPOINT,
          priceFetchedAt: null,
          priceSource: null,
          updatedAt: p.updatedAt,
          dataStale: this.now() - p.updatedAt > STALE_AFTER_MS,
        };
      });
      await Promise.all(
        pools.map(async (pool) => {
          if (pool.assetDecimals === null) return;
          // Only reviewed registry assets reach the fixed, documented price API.
          const source = `https://api.relay.link/currencies/token/price?chainId=${pool.chainId}&address=${pool.assetAddress.toLowerCase()}`;
          try {
            const { price } = parse(
              z.object({ price: z.number().finite().min(1e-18).max(1e12) }),
              await this.requestJson(source, "price", undefined, 3000),
            );
            pool.tvlUsd = dollarValue(
              pool.totalAssets,
              pool.assetDecimals,
              price,
            );
            pool.priceFetchedAt = this.now();
            pool.priceSource = source;
          } catch {
            // Optional price failures do not hide indexed positions or assets.
            // Null communicates unavailable estimates instead of fabricating $0.
          }
        }),
      );
      this.cached = {
        pools,
        fetchedAt: this.now(),
        truncated: raw.relayPools.totalCount > pools.length,
        lifecycle: LIFECYCLE,
      };
      return this.cached;
    })();
    try {
      return this.cloneCatalog(await this.pending);
    } finally {
      this.pending = undefined;
    }
  }

  private cloneCatalog(value: VaultCatalog): VaultCatalog {
    const result = structuredClone(value);
    for (const pool of result.pools)
      pool.dataStale = this.now() - pool.updatedAt > STALE_AFTER_MS;
    return result;
  }

  async positions(address: string): Promise<VaultPositions> {
    const wallet = walletAddressSchema.safeParse(address);
    if (!wallet.success)
      throw new AppError(400, "INVALID_WALLET", "Use a valid wallet address.");
    const key = wallet.data.toLowerCase();
    const cached = this.positionCache.get(key);
    if (cached && cached.expiresAt > this.now())
      return this.clonePositions(cached.value);
    const pending = this.positionPending.get(key);
    if (pending) return this.clonePositions(await pending);
    if (this.positionPending.size >= MAX_POSITION_WALLETS)
      throw new AppError(
        503,
        "VAULTS_BUSY",
        "Position discovery is busy. Please retry shortly.",
      );
    const promise = this.readPositions(key)
      .then((value) => {
        this.positionCache.delete(key);
        if (this.positionCache.size >= MAX_POSITION_WALLETS)
          this.positionCache.delete(this.positionCache.keys().next().value!);
        this.positionCache.set(key, {
          value,
          expiresAt: this.now() + POSITION_TTL_MS,
        });
        return value;
      })
      .finally(() => this.positionPending.delete(key));
    this.positionPending.set(key, promise);
    return this.clonePositions(await promise);
  }

  private clonePositions(value: VaultPositions): VaultPositions {
    const result = structuredClone(value);
    for (const position of result.positions)
      position.dataStale =
        position.indexUpdatedAt !== null &&
        this.now() - position.indexUpdatedAt > STALE_AFTER_MS;
    return result;
  }

  private async readPositions(wallet: string): Promise<VaultPositions> {
    const raw = parse(
      z.object({
        userBalances: z.object({
          items: z.array(positionSchema).max(50),
          totalCount: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
          pageInfo: z.object({
            hasNextPage: z.boolean(),
            endCursor: z.string().max(2048).nullable(),
          }),
        }),
      }),
      await this.request(positionQuery, { wallet }),
    );
    if (raw.userBalances.items.some((p) => p.wallet.toLowerCase() !== wallet))
      invalid();
    if (raw.userBalances.totalCount < raw.userBalances.items.length) invalid();
    unique(
      raw.userBalances.items.map((p) => ({
        chainId: p.chainId,
        address: p.relayPool,
      })),
    );
    for (const position of raw.userBalances.items)
      this.validateTime(position.updatedAt);
    // Metadata must not hold a valid wallet read behind another network call.
    // Reviewed share units remain usable even if the optional catalog is down.
    const catalog = this.cached;
    const positions: VaultPosition[] = raw.userBalances.items
      .filter((p) => BigInt(p.shareBalance) > 0n)
      .map((p) => {
        const metadata = KNOWN_VAULTS.find(
          (v) =>
            v.chainId === p.chainId && v.address === p.relayPool.toLowerCase(),
        );
        const pool = catalog?.pools.find(
          (v) =>
            v.chainId === p.chainId &&
            v.address.toLowerCase() === p.relayPool.toLowerCase(),
        );
        // Unknown share metadata is used only from a current catalog cache.
        const currentPool =
          catalog && catalog.fetchedAt > this.now() - CATALOG_TTL_MS
            ? pool
            : undefined;
        const decimals = metadata?.shareDecimals ?? currentPool?.decimals;
        return {
          chainId: p.chainId,
          poolAddress: p.relayPool,
          wallet: p.wallet,
          shareBalance: p.shareBalance,
          shareBalanceFormatted:
            decimals === undefined
              ? null
              : formatUnits(BigInt(p.shareBalance), decimals),
          symbol: metadata?.symbol ?? currentPool?.symbol ?? null,
          // The position timestamp is last activity, not an index heartbeat.
          updatedAt: p.updatedAt,
          indexUpdatedAt: pool?.updatedAt ?? null,
          dataStale: pool
            ? this.now() - pool.updatedAt > STALE_AFTER_MS
            : false,
        };
      });
    return {
      positions,
      fetchedAt: this.now(),
      truncated:
        raw.userBalances.pageInfo.hasNextPage ||
        raw.userBalances.totalCount > raw.userBalances.items.length,
      lifecycle: structuredClone(LIFECYCLE),
    };
  }
}
