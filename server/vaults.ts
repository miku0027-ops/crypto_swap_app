import { formatUnits } from "viem";
import { z } from "zod";
import { AppError } from "./errors.js";
import {
  addressSchema,
  chainIdSchema,
  uintSchema,
  walletAddressSchema,
} from "./validation.js";

const ENDPOINT = "https://vaults-api.relay.link/";
const MAX_BYTES = 1024 * 1024;
const LIFECYCLE = {
  phase: "wind-down" as const,
  depositsEnabled: false as const,
  withdrawalUiEndDate: "2026-12-31",
  sourceUrl: "https://docs.relay.link/references/protocol/vaults/overview",
};
const poolQuery = `{ relayPools(limit:50) { items { chainId contractAddress name symbol asset decimals totalAssets totalShares outstandingDebt updatedAt } totalCount } }`;
const positionQuery = `query Positions($wallet: String!) { userBalances(where:{wallet:$wallet}, limit:50) { items { chainId relayPool wallet shareBalance totalDeposited totalWithdrawn updatedAt } totalCount pageInfo { hasNextPage endCursor } } }`;
const timestamp = z
  .string()
  .regex(/^\d{1,16}$/)
  .refine((v) => Number.isSafeInteger(Number(v)))
  .transform(Number);
const label = z
  .string()
  .min(1)
  .max(160)
  .refine((v) => !/[\x00-\x1f]/.test(v));
const poolSchema = z.object({
  chainId: chainIdSchema,
  contractAddress: addressSchema,
  name: label,
  symbol: label,
  asset: addressSchema,
  decimals: z.number().int().min(0).max(36),
  totalAssets: uintSchema,
  totalShares: uintSchema,
  outstandingDebt: uintSchema,
  updatedAt: timestamp,
});
const positionSchema = z.object({
  chainId: chainIdSchema,
  relayPool: addressSchema,
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
  totalAssets: string;
  totalShares: string;
  totalSharesFormatted: string;
  outstandingDebt: string;
  updatedAt: number;
};
export type VaultPosition = {
  chainId: number;
  poolAddress: string;
  wallet: string;
  shareBalance: string;
  shareBalanceFormatted: string | null;
  symbol: string | null;
  updatedAt: number;
};
export type VaultCatalog = {
  pools: VaultPool[];
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
export class VaultsService {
  private cached: VaultCatalog | undefined;
  private pending: Promise<VaultCatalog> | undefined;
  constructor(
    private fetchImpl: typeof fetch = fetch,
    private now: () => number = Date.now,
    private beforeRequest?: () => Promise<void>,
  ) {}
  private async request(
    query: string,
    variables?: Record<string, string>,
  ): Promise<unknown> {
    await this.beforeRequest?.();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    try {
      const response = await this.fetchImpl(ENDPOINT, {
        method: "POST",
        redirect: "error",
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({ query, ...(variables ? { variables } : {}) }),
      });
      if (response.status === 429)
        throw new AppError(
          429,
          "VAULTS_RATE_LIMITED",
          "The vault provider is busy. Please retry in a minute.",
          60,
        );
      if (!response.ok)
        throw new AppError(
          502,
          "VAULTS_UNAVAILABLE",
          "Vault information is temporarily unavailable.",
        );
      const length = Number(response.headers.get("content-length"));
      if (Number.isFinite(length) && length > MAX_BYTES) invalid();
      if (!response.body) invalid();
      const reader = response.body.getReader();
      let size = 0;
      const chunks: Uint8Array[] = [];
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > MAX_BYTES) invalid();
          chunks.push(value);
        }
      } finally {
        await reader.cancel().catch(() => {});
        reader.releaseLock();
      }
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.length;
      }
      let body: unknown;
      try {
        body = JSON.parse(new TextDecoder().decode(bytes));
      } catch {
        invalid();
      }
      const envelope = parse(
        z.object({
          data: z.record(z.string(), z.unknown()),
          errors: z.array(z.unknown()).optional(),
        }),
        body,
      );
      if (envelope.errors?.length) invalid();
      return envelope.data;
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
      clearTimeout(timer);
    }
  }
  async pools(): Promise<VaultCatalog> {
    if (this.cached && this.cached.fetchedAt > this.now() - 60_000)
      return structuredClone(this.cached);
    if (this.pending) return structuredClone(await this.pending);
    this.pending = (async () => {
      const raw = parse(
        z.object({
          relayPools: z.object({
            items: z.array(poolSchema).max(50),
            totalCount: z.number().int().min(0),
          }),
        }),
        await this.request(poolQuery),
      );
      if (raw.relayPools.totalCount < raw.relayPools.items.length) invalid();
      const pools = raw.relayPools.items.map((p) => ({
        chainId: p.chainId,
        address: p.contractAddress,
        name: p.name,
        symbol: p.symbol,
        assetAddress: p.asset,
        decimals: p.decimals,
        totalAssets: p.totalAssets,
        totalShares: p.totalShares,
        totalSharesFormatted: formatUnits(BigInt(p.totalShares), p.decimals),
        outstandingDebt: p.outstandingDebt,
        updatedAt: p.updatedAt,
      }));
      const ids = new Set(
        pools.map((p) => `${p.chainId}:${p.address.toLowerCase()}`),
      );
      if (ids.size !== pools.length) invalid();
      this.cached = {
        pools,
        fetchedAt: this.now(),
        truncated: raw.relayPools.totalCount > pools.length,
        lifecycle: LIFECYCLE,
      };
      return this.cached;
    })();
    try {
      return structuredClone(await this.pending);
    } finally {
      this.pending = undefined;
    }
  }
  async positions(address: string) {
    const wallet = walletAddressSchema.safeParse(address);
    if (!wallet.success)
      throw new AppError(400, "INVALID_WALLET", "Use a valid wallet address.");
    const raw = parse(
      z.object({
        userBalances: z.object({
          items: z.array(positionSchema).max(50),
          totalCount: z.number().int().min(0),
          pageInfo: z.object({
            hasNextPage: z.boolean(),
            endCursor: z.string().nullable(),
          }),
        }),
      }),
      await this.request(positionQuery, { wallet: wallet.data.toLowerCase() }),
    );
    if (
      raw.userBalances.items.some(
        (p) => p.wallet.toLowerCase() !== wallet.data.toLowerCase(),
      )
    )
      invalid();
    if (raw.userBalances.totalCount < raw.userBalances.items.length) invalid();
    const ids = new Set(
      raw.userBalances.items.map(
        (p) => `${p.chainId}:${p.relayPool.toLowerCase()}`,
      ),
    );
    if (ids.size !== raw.userBalances.items.length) invalid();
    const catalog = await this.pools();
    const positions: VaultPosition[] = raw.userBalances.items
      .filter((p) => BigInt(p.shareBalance) > 0n)
      .map((p) => {
        const pool = catalog.pools.find(
          (v) =>
            v.chainId === p.chainId &&
            v.address.toLowerCase() === p.relayPool.toLowerCase(),
        );
        return {
          chainId: p.chainId,
          poolAddress: p.relayPool,
          wallet: p.wallet,
          shareBalance: p.shareBalance,
          shareBalanceFormatted: pool
            ? formatUnits(BigInt(p.shareBalance), pool.decimals)
            : null,
          symbol: pool?.symbol ?? null,
          updatedAt: p.updatedAt,
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
