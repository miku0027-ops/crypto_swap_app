import { formatUnits, isAddress } from "viem";
import { AppError } from "./errors.js";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const MAX_BATCH = 20;
const MAX_RESPONSE_BYTES = 1_048_576;
const MAX_UINT256 = (1n << 256n) - 1n;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const HASH = /^0x[0-9a-fA-F]{64}$/;
const HEX_DATA = /^0x(?:[0-9a-fA-F]{2})*$/;
const HEX_QUANTITY = /^0x[0-9a-fA-F]{1,64}$/;

export interface BalanceCurrency {
  address: string;
  decimals: number;
  symbol: string;
  name: string;
}
export type AssetBalance = BalanceCurrency &
  (
    | { balance: string; formatted: string; error?: never }
    | {
        balance: null;
        formatted: null;
        error: { code: string; message: string };
      }
  );
export interface WalletBalances {
  chainId: number;
  address: string;
  assets: AssetBalance[];
  fetchedAt: number;
}
export interface ExpectedTransaction {
  from: string;
  to: string;
  data: string;
  value: string;
  chainId: number;
}
export type TransactionVerification =
  { verified: true } | { verified: false; reason: "not_found" | "mismatch" };
interface RpcCall {
  method: string;
  params: unknown[];
}
interface RpcResponse {
  jsonrpc: "2.0";
  id: string;
  result?: unknown;
  error?: { code: number; message: string };
}
interface RpcOptions {
  allowLocalHttp?: boolean;
  now?: () => number;
}
const object = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const invalidInput = (message: string) =>
  new AppError(400, "INVALID_RPC_INPUT", message);
const invalidResponse = () =>
  new AppError(
    502,
    "RPC_INVALID_RESPONSE",
    "The network returned an invalid response. Please try again.",
  );

/** Endpoints come only from startup configuration, never from a request body. */
export class RpcService {
  private readonly urls = new Map<number, string>();
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly now: () => number;
  private readonly chainChecks = new Map<
    number,
    { expiresAt: number; promise: Promise<void> }
  >();
  private nextId = 0;

  constructor(
    urls: Record<number, string>,
    fetchImpl: typeof fetch = fetch,
    timeoutMs = 8000,
    options: RpcOptions = {},
  ) {
    if (!object(urls) || Object.keys(urls).length > 64)
      throw new AppError(
        500,
        "INVALID_RPC_CONFIG",
        "RPC configuration must contain at most 64 network endpoints.",
      );
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30_000)
      throw new AppError(
        500,
        "INVALID_RPC_CONFIG",
        "RPC timeout must be between 1 and 30000 milliseconds.",
      );
    for (const [key, value] of Object.entries(urls)) {
      const id = Number(key);
      if (
        !/^[1-9]\d*$/.test(key) ||
        !Number.isSafeInteger(id) ||
        typeof value !== "string" ||
        value.length > 2048
      )
        throw new AppError(
          500,
          "INVALID_RPC_CONFIG",
          "RPC networks and endpoint URLs must be valid.",
        );
      let url: URL;
      try {
        url = new URL(value);
      } catch {
        throw new AppError(
          500,
          "INVALID_RPC_CONFIG",
          "RPC endpoint URL is invalid.",
        );
      }
      const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
      const localHttp =
        options.allowLocalHttp === true && local && url.protocol === "http:";
      if (
        (url.protocol !== "https:" && !localHttp) ||
        url.username ||
        url.password ||
        url.hash
      )
        throw new AppError(
          500,
          "INVALID_RPC_CONFIG",
          "RPC endpoints require HTTPS; local HTTP is permitted only in explicit development configuration.",
        );
      this.urls.set(id, url.toString());
    }
    this.fetchImpl = fetchImpl;
    this.timeoutMs = timeoutMs;
    this.now = options.now ?? Date.now;
  }

  get configuredChainIds(): number[] {
    return [...this.urls.keys()];
  }
  readyFor(chainId: number): boolean {
    return this.urls.has(chainId);
  }

  async balance(
    chainId: number,
    address: string,
    currencies: BalanceCurrency[],
  ): Promise<WalletBalances> {
    this.endpoint(chainId);
    this.address(address);
    if (!Array.isArray(currencies) || currencies.length > MAX_BATCH)
      throw invalidInput("Request no more than 20 token balances at a time.");
    const seen = new Set<string>();
    for (const currency of currencies) {
      if (!object(currency)) throw invalidInput("Token metadata is required.");
      this.address(currency.address);
      if (seen.has(currency.address.toLowerCase()))
        throw invalidInput("Duplicate token addresses are not allowed.");
      seen.add(currency.address.toLowerCase());
      if (
        !Number.isInteger(currency.decimals) ||
        currency.decimals < 0 ||
        currency.decimals > 36 ||
        typeof currency.symbol !== "string" ||
        !currency.symbol.length ||
        currency.symbol.length > 32 ||
        typeof currency.name !== "string" ||
        currency.name.length > 128
      )
        throw invalidInput("Token metadata is invalid.");
    }
    if (!currencies.length)
      return { chainId, address, assets: [], fetchedAt: this.now() };
    await this.ensureChain(chainId);
    const results = await this.call(
      chainId,
      currencies.map((currency) =>
        currency.address.toLowerCase() === ZERO_ADDRESS
          ? { method: "eth_getBalance", params: [address, "latest"] }
          : {
              method: "eth_call",
              params: [
                {
                  to: currency.address,
                  data: `0x70a08231${address.slice(2).toLowerCase().padStart(64, "0")}`,
                },
                "latest",
              ],
            },
      ),
    );
    const assets: AssetBalance[] = currencies.map((currency, index) => {
      const response = results[index];
      const metadata: BalanceCurrency = {
        address: currency.address,
        decimals: currency.decimals,
        symbol: currency.symbol,
        name: currency.name,
      };
      if (response.error)
        return {
          ...metadata,
          balance: null,
          formatted: null,
          error: {
            code: "TOKEN_BALANCE_UNAVAILABLE",
            message: "The network could not read this token balance.",
          },
        };
      if (
        typeof response.result !== "string" ||
        !HEX_QUANTITY.test(response.result)
      )
        return {
          ...metadata,
          balance: null,
          formatted: null,
          error: {
            code: "INVALID_TOKEN_BALANCE",
            message: "The network returned an invalid token balance.",
          },
        };
      const value = BigInt(response.result);
      return {
        ...metadata,
        balance: value.toString(),
        formatted: formatUnits(value, currency.decimals),
      };
    });
    return { chainId, address, assets, fetchedAt: this.now() };
  }

  /** A matching transaction is not necessarily mined or settled. Relay status remains separate. */
  async verifyTransaction(
    chainId: number,
    hash: string,
    expected: ExpectedTransaction,
  ): Promise<TransactionVerification> {
    this.endpoint(chainId);
    if (typeof hash !== "string" || !HASH.test(hash))
      throw invalidInput("A valid transaction hash is required.");
    if (!object(expected) || expected.chainId !== chainId)
      throw invalidInput(
        "Transaction network does not match the requested network.",
      );
    this.address(expected.from);
    this.address(expected.to);
    if (
      typeof expected.data !== "string" ||
      expected.data.length > 131_074 ||
      !HEX_DATA.test(expected.data)
    )
      throw invalidInput("Transaction calldata is invalid.");
    if (
      typeof expected.value !== "string" ||
      !/^(?:0|[1-9]\d{0,77})$/.test(expected.value) ||
      BigInt(expected.value) > MAX_UINT256
    )
      throw invalidInput(
        "Transaction value must be an unsigned 256-bit integer.",
      );
    await this.ensureChain(chainId);
    const [response] = await this.call(chainId, [
      { method: "eth_getTransactionByHash", params: [hash] },
    ]);
    if (response.error)
      throw new AppError(
        502,
        "TRANSACTION_LOOKUP_UNAVAILABLE",
        "The network could not verify the transaction. Please retry.",
      );
    if (response.result === null)
      return { verified: false, reason: "not_found" };
    if (!object(response.result)) throw invalidResponse();
    const tx = response.result;
    const matching =
      typeof tx.hash === "string" &&
      tx.hash.toLowerCase() === hash.toLowerCase() &&
      typeof tx.from === "string" &&
      tx.from.toLowerCase() === expected.from.toLowerCase() &&
      typeof tx.to === "string" &&
      tx.to.toLowerCase() === expected.to.toLowerCase() &&
      typeof tx.input === "string" &&
      tx.input.toLowerCase() === expected.data.toLowerCase() &&
      typeof tx.value === "string" &&
      HEX_QUANTITY.test(tx.value) &&
      BigInt(tx.value) === BigInt(expected.value) &&
      (tx.chainId === undefined ||
        (typeof tx.chainId === "string" &&
          HEX_QUANTITY.test(tx.chainId) &&
          BigInt(tx.chainId) === BigInt(chainId)));
    return matching
      ? { verified: true }
      : { verified: false, reason: "mismatch" };
  }

  private endpoint(chainId: number): string {
    if (!Number.isSafeInteger(chainId) || chainId < 1)
      throw invalidInput("A valid network ID is required.");
    const url = this.urls.get(chainId);
    if (!url)
      throw new AppError(
        503,
        "RPC_NOT_CONFIGURED",
        "This network is not configured for balance or transaction verification.",
      );
    return url;
  }
  private address(address: unknown): asserts address is string {
    if (
      typeof address !== "string" ||
      !ADDRESS.test(address) ||
      !isAddress(address, { strict: true })
    )
      throw invalidInput("A valid EVM address is required.");
  }
  private async ensureChain(chainId: number): Promise<void> {
    const cached = this.chainChecks.get(chainId);
    if (cached && cached.expiresAt > this.now()) return cached.promise;
    const promise = this.call(chainId, [
      { method: "eth_chainId", params: [] },
    ]).then(([response]) => {
      if (
        response.error ||
        typeof response.result !== "string" ||
        !HEX_QUANTITY.test(response.result) ||
        BigInt(response.result) !== BigInt(chainId)
      )
        throw new AppError(
          502,
          "RPC_CHAIN_MISMATCH",
          "The configured RPC endpoint does not match the requested network.",
        );
    });
    this.chainChecks.set(chainId, { expiresAt: this.now() + 30_000, promise });
    try {
      await promise;
    } catch (error) {
      this.chainChecks.delete(chainId);
      throw error;
    }
  }
  private async call(
    chainId: number,
    calls: RpcCall[],
  ): Promise<RpcResponse[]> {
    if (!calls.length || calls.length > MAX_BATCH)
      throw invalidInput("RPC batch size is invalid.");
    const requests = calls.map((call) => ({
      jsonrpc: "2.0",
      id: `h${++this.nextId}`,
      ...call,
    }));
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(this.endpoint(chainId), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(requests),
        signal: controller.signal,
        redirect: "error",
        credentials: "omit",
      });
      if (!response.ok) {
        if (response.status === 429)
          throw new AppError(
            503,
            "RPC_RATE_LIMITED",
            "This network is busy. Please retry shortly.",
          );
        throw new AppError(
          502,
          "RPC_UNAVAILABLE",
          "The network RPC is currently unavailable.",
        );
      }
      const length = response.headers.get("content-length");
      if (length !== null && Number(length) > MAX_RESPONSE_BYTES)
        throw invalidResponse();
      if (!response.body) throw invalidResponse();
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > MAX_RESPONSE_BYTES) {
            await reader.cancel();
            throw invalidResponse();
          }
          chunks.push(value);
        }
      } finally {
        reader.releaseLock();
      }
      const buffer = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) {
        buffer.set(chunk, offset);
        offset += chunk.byteLength;
      }
      let payload: unknown;
      try {
        payload = JSON.parse(new TextDecoder().decode(buffer));
      } catch {
        throw invalidResponse();
      }
      const results = Array.isArray(payload)
        ? payload
        : requests.length === 1
          ? [payload]
          : null;
      if (!results || results.length !== requests.length)
        throw invalidResponse();
      const byId = new Map<string, RpcResponse>();
      const requestIds = new Set(requests.map((request) => request.id));
      for (const result of results) {
        if (
          !object(result) ||
          result.jsonrpc !== "2.0" ||
          typeof result.id !== "string" ||
          !requestIds.has(result.id) ||
          byId.has(result.id)
        )
          throw invalidResponse();
        const hasResult = Object.prototype.hasOwnProperty.call(
          result,
          "result",
        );
        const hasError = Object.prototype.hasOwnProperty.call(result, "error");
        if (
          hasResult === hasError ||
          (hasError &&
            (!object(result.error) ||
              !Number.isSafeInteger(result.error.code) ||
              typeof result.error.message !== "string"))
        )
          throw invalidResponse();
        byId.set(result.id, result as unknown as RpcResponse);
      }
      return requests.map((request) => byId.get(request.id)!);
    } catch (error) {
      if (controller.signal.aborted)
        throw new AppError(
          504,
          "RPC_TIMEOUT",
          "The network request timed out. Please try again.",
        );
      if (error instanceof AppError) throw error;
      throw new AppError(
        502,
        "RPC_UNAVAILABLE",
        "The network RPC could not be reached.",
      );
    } finally {
      clearTimeout(timeout);
    }
  }
}
