import { formatUnits, getAddress } from "viem";
import { z } from "zod";
import type { AppConfig, Network } from "./config.js";
import { AppError } from "./errors.js";
import {
  addressSchema,
  chainIdSchema,
  currencySearchSchema,
  hashSchema,
  networkSchema,
  parseInput,
  positiveUintSchema,
  quoteInputSchema,
  requestIdSchema,
  uintSchema,
  walletAddressSchema,
  ZERO_ADDRESS,
} from "./validation.js";
import type { CurrencySearch, QuoteInput } from "./validation.js";
export type { Network, QuoteInput, CurrencySearch };
export interface Currency {
  chainId: number;
  address: string;
  symbol: string;
  name: string;
  decimals: number;
  vmType: "evm";
  metadata: { verified: boolean; isNative: boolean; logoURI?: string };
}
export interface Chain {
  id: number;
  name: string;
  displayName: string;
  vmType: "evm";
  currency: Currency;
  explorerUrl?: string;
  iconUrl?: string;
  depositEnabled: boolean;
  disabled: false;
}
export interface PreparedTransaction {
  from: string;
  to: string;
  data: string;
  value: string;
  chainId: number;
  stepId: string;
}
export interface QuoteSummary {
  currencyIn: Currency;
  currencyOut: Currency;
  amountIn: string;
  amountOut: string;
  minimumAmountOut: string;
  amountInFormatted: string;
  amountOutFormatted: string;
  minimumAmountOutFormatted: string;
  feesUsd: string | null;
  timeEstimate: number | null;
}
export interface QuoteDraft {
  network: Network;
  input: QuoteInput;
  relayRequestId: string;
  quote: Record<string, unknown>;
  expiresAt: number;
  summary: QuoteSummary;
  transactions: PreparedTransaction[];
  executable: boolean;
  executionBlockReason?: string;
}
export type IntentState =
  | "waiting"
  | "depositing"
  | "pending"
  | "submitted"
  | "success"
  | "failure"
  | "refund";
export interface IntentStatus {
  status: IntentState;
  inTxHashes: string[];
  txHashes: string[];
  originChainId?: number;
  destinationChainId?: number;
  updatedAt?: number;
  details?: string;
  failReason?: string;
  refundFailReason?: string;
}
const HOSTS: Record<Network, string> = {
  mainnet: "https://api.relay.link",
  testnet: "https://api.testnets.relay.link",
};
const MAX_BYTES = 2 * 1024 * 1024;
const object = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const invalid = (
  message = "Relay returned an incomplete or inconsistent response.",
): never => {
  throw new AppError(502, "INVALID_PROVIDER_RESPONSE", message);
};
const text = (v: unknown, max = 120): v is string =>
  typeof v === "string" &&
  v.length > 0 &&
  v.length <= max &&
  !/[\x00-\x1f]/.test(v);
const httpsUrl = (v: unknown): string | undefined => {
  if (typeof v !== "string" || v.length > 2048) return;
  try {
    const u = new URL(v);
    return u.protocol === "https:" && !u.username && !u.password
      ? v
      : undefined;
  } catch {
    return;
  }
};
function providerParse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  return result.success ? result.data : invalid();
}
function currency(raw: unknown, chainId?: number, native = false): Currency {
  if (!object(raw) || !text(raw.name) || !text(raw.symbol, 32))
    return invalid();
  const id = providerParse(chainIdSchema, chainId ?? raw.chainId);
  const address = providerParse(addressSchema, raw.address);
  const decimals = providerParse(z.number().int().min(0).max(36), raw.decimals);
  const metadata = object(raw.metadata) ? raw.metadata : {};
  return {
    chainId: id,
    address,
    symbol: raw.symbol,
    name: raw.name,
    decimals,
    vmType: "evm",
    metadata: {
      verified: native || metadata.verified === true,
      isNative: native || address === ZERO_ADDRESS,
      ...(httpsUrl(metadata.logoURI)
        ? { logoURI: httpsUrl(metadata.logoURI) }
        : {}),
    },
  };
}
function sameCurrency(raw: unknown, expected: Currency): boolean {
  if (!object(raw)) return false;
  const address = addressSchema.safeParse(raw.address);
  return (
    address.success &&
    address.data === expected.address &&
    raw.chainId === expected.chainId &&
    raw.decimals === expected.decimals
  );
}
export class RelayService {
  private cache = new Map<string, { expiresAt: number; value: unknown }>();
  private pending = new Map<string, Promise<unknown>>();
  constructor(
    private config: AppConfig,
    private fetchImpl: typeof fetch = globalThis.fetch,
    private now: () => number = Date.now,
    private beforeRequest?: (path: string) => Promise<void>,
  ) {}
  private network(value: unknown): Network {
    const network = parseInput(networkSchema, value);
    if (network === "mainnet" && !this.config.enableMainnet)
      throw new AppError(
        403,
        "MAINNET_DISABLED",
        "Mainnet is disabled on this server. Use testnet.",
      );
    return network;
  }
  private async request(
    network: Network,
    path: string,
    body?: unknown,
  ): Promise<unknown> {
    // Shared budgets apply to real upstream requests, never cache hits. Budget
    // failures propagate unchanged and waiting does not consume provider timeout.
    await this.beforeRequest?.(path);
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(),
      this.config.relayTimeoutMs,
    );
    try {
      const response = await this.fetchImpl(`${HOSTS[network]}${path}`, {
        method: body === undefined ? "GET" : "POST",
        headers: {
          accept: "application/json",
          ...(body === undefined ? {} : { "content-type": "application/json" }),
          ...(this.config.relayApiKey
            ? { "x-api-key": this.config.relayApiKey }
            : {}),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: controller.signal,
        redirect: "error",
      });
      if (response.status === 429) {
        await response.body?.cancel();
        const retry = Number(response.headers.get("Retry-After"));
        throw new AppError(
          429,
          "PROVIDER_RATE_LIMIT",
          "The route provider is busy. Please wait before retrying.",
          Number.isFinite(retry) && retry > 0
            ? Math.min(300, Math.ceil(retry))
            : 5,
        );
      }
      if (!response.ok) {
        await response.body?.cancel();
        throw new AppError(
          response.status === 400 ? 422 : 503,
          response.status === 400
            ? "ROUTE_UNAVAILABLE"
            : "PROVIDER_UNAVAILABLE",
          response.status === 400
            ? "This route or amount is unavailable. Try another token, network, or amount."
            : "The route provider is temporarily unavailable. Please try again later.",
        );
      }
      const advertised = Number(response.headers.get("content-length") || 0);
      if (advertised > MAX_BYTES) {
        await response.body?.cancel();
        return invalid("Relay response exceeded the safe size limit.");
      }
      if (!response.body) return invalid();
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      for (;;) {
        const result = await reader.read();
        if (result.done) break;
        size += result.value.byteLength;
        if (size > MAX_BYTES) {
          await reader.cancel();
          return invalid("Relay response exceeded the safe size limit.");
        }
        chunks.push(result.value);
      }
      const combined = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) {
        combined.set(chunk, offset);
        offset += chunk.byteLength;
      }
      try {
        return JSON.parse(
          new TextDecoder("utf-8", { fatal: true }).decode(combined),
        );
      } catch {
        return invalid();
      }
    } catch (error) {
      if (error instanceof AppError) throw error;
      if (controller.signal.aborted)
        throw new AppError(
          504,
          "PROVIDER_TIMEOUT",
          "The route provider took too long to respond. Please retry.",
        );
      throw new AppError(
        503,
        "PROVIDER_UNAVAILABLE",
        "The route provider could not be reached. Please retry.",
      );
    } finally {
      clearTimeout(timer);
    }
  }
  private async cached<T>(
    key: string,
    ttl: number,
    load: () => Promise<T>,
  ): Promise<T> {
    const prior = this.cache.get(key);
    if (prior && prior.expiresAt > this.now())
      return structuredClone(prior.value) as T;
    const existing = this.pending.get(key);
    if (existing) return structuredClone(await existing) as T;
    if (this.pending.size >= 100)
      throw new AppError(
        503,
        "SERVER_BUSY",
        "Too many requests are in progress. Please retry shortly.",
      );
    const work = load()
      .then((value) => {
        if (this.cache.size >= 200)
          this.cache.delete(this.cache.keys().next().value!);
        this.cache.set(key, {
          expiresAt: this.now() + ttl,
          value: structuredClone(value),
        });
        return value;
      })
      .finally(() => this.pending.delete(key));
    this.pending.set(key, work);
    return structuredClone(await work);
  }
  async chains(networkInput: Network): Promise<Chain[]> {
    const network = this.network(networkInput);
    return this.cached(`${network}:chains`, 60000, async () => {
      const response = await this.request(network, "/chains");
      if (!object(response) || !Array.isArray(response.chains))
        return invalid();
      return response.chains
        .filter(
          (item): item is Record<string, unknown> =>
            object(item) &&
            item.vmType === "evm" &&
            item.disabled !== true &&
            item.blockProductionLagging !== true &&
            this.config.allowedChainIds[network].includes(item.id as number),
        )
        .map((item) => {
          const id = providerParse(chainIdSchema, item.id);
          if (!text(item.name)) return invalid();
          return {
            id,
            name: item.name,
            displayName: text(item.displayName) ? item.displayName : item.name,
            vmType: "evm" as const,
            currency: currency(item.currency, id, true),
            ...(httpsUrl(item.explorerUrl)
              ? { explorerUrl: httpsUrl(item.explorerUrl) }
              : {}),
            ...(httpsUrl(item.iconUrl)
              ? { iconUrl: httpsUrl(item.iconUrl) }
              : {}),
            depositEnabled: item.depositEnabled === true,
            disabled: false as const,
          };
        });
    });
  }
  async currencies(
    networkInput: Network,
    rawSearch: CurrencySearch,
  ): Promise<Currency[]> {
    const network = this.network(networkInput);
    const search = parseInput(currencySearchSchema, rawSearch);
    const chains = await this.chains(network);
    if (search.chainIds.some((id) => !chains.some((chain) => chain.id === id)))
      throw new AppError(
        400,
        "UNSUPPORTED_CHAIN",
        "Choose a supported network.",
      );
    return this.cached(
      `${network}:currencies:${JSON.stringify(search)}`,
      30000,
      async () => {
        const response = await this.request(network, "/currencies/v2", {
          ...search,
          verified: true,
          useExternalSearch: false,
        });
        if (!Array.isArray(response) || response.length > 100) return invalid();
        const result: Currency[] = [];
        for (const item of response) {
          if (
            !object(item) ||
            !search.chainIds.includes(item.chainId as number) ||
            (item.vmType && item.vmType !== "evm")
          )
            continue;
          const token = currency(item);
          if (token.metadata.verified || token.address === ZERO_ADDRESS) {
            if (search.address && token.address !== search.address) continue;
            result.push(token);
          }
        }
        // Native chain metadata is authoritative even when its currency search entry is absent.
        for (const chain of chains.filter((c) =>
          search.chainIds.includes(c.id),
        )) {
          const token = chain.currency;
          const term = search.term?.toLowerCase();
          if (
            (!search.address || search.address === token.address) &&
            (!term ||
              `${token.name} ${token.symbol}`.toLowerCase().includes(term)) &&
            !result.some(
              (t) => t.chainId === token.chainId && t.address === token.address,
            )
          )
            result.unshift(token);
        }
        return result.slice(0, search.limit);
      },
    );
  }
  private async resolveCurrency(
    network: Network,
    chain: Chain,
    address: string,
  ): Promise<Currency> {
    if (chain.currency.address === address) return chain.currency;
    const token = (
      await this.currencies(network, {
        chainIds: [chain.id],
        address,
        limit: 10,
      })
    ).find(
      (t) =>
        t.address === address && t.chainId === chain.id && t.metadata.verified,
    );
    if (!token)
      throw new AppError(
        400,
        "UNSUPPORTED_TOKEN",
        "This token is not in the verified token catalog for that chain.",
      );
    return token;
  }
  async quote(
    networkInput: Network,
    rawInput: QuoteInput,
  ): Promise<QuoteDraft> {
    const network = this.network(networkInput);
    const input = parseInput(quoteInputSchema, rawInput);
    if (!this.config.relayApiKey)
      throw new AppError(
        503,
        "RELAY_NOT_CONFIGURED",
        "Live quotes are not configured on this server.",
      );
    const slippage = Number(input.slippageTolerance ?? "50");
    if (slippage > this.config.maxSlippageBps)
      throw new AppError(
        400,
        "SLIPPAGE_LIMIT",
        `Slippage must not exceed ${this.config.maxSlippageBps} basis points.`,
      );
    input.slippageTolerance = String(slippage);
    input.recipient ??= input.user;
    const chains = await this.chains(network);
    const origin = chains.find((c) => c.id === input.originChainId);
    const destination = chains.find((c) => c.id === input.destinationChainId);
    if (!origin || !destination || !origin.depositEnabled)
      throw new AppError(
        400,
        "UNSUPPORTED_CHAIN",
        "This source or destination is unavailable for bridging.",
      );
    const [currencyIn, currencyOut] = await Promise.all([
      this.resolveCurrency(network, origin, input.originCurrency),
      this.resolveCurrency(network, destination, input.destinationCurrency),
    ]);
    if (input.topupGas && currencyOut.metadata.isNative)
      throw new AppError(
        400,
        "INVALID_GAS_TOPUP",
        "Destination gas top-up is not available when receiving the native token.",
      );
    const raw = await this.request(network, "/quote/v2", input);
    if (
      !object(raw) ||
      !Array.isArray(raw.steps) ||
      !raw.steps.length ||
      raw.steps.length > 10 ||
      !object(raw.details)
    )
      return invalid();
    const details = raw.details;
    const sender = providerParse(walletAddressSchema, details.sender);
    const recipient = providerParse(walletAddressSchema, details.recipient);
    if (
      sender !== input.user ||
      recipient !== input.recipient ||
      !object(details.currencyIn) ||
      !object(details.currencyOut) ||
      !sameCurrency(details.currencyIn.currency, currencyIn) ||
      !sameCurrency(details.currencyOut.currency, currencyOut)
    )
      return invalid(
        "The provider quote does not match the requested wallet, recipient, or assets.",
      );
    const amountIn = providerParse(
      positiveUintSchema,
      details.currencyIn.amount,
    );
    const amountOut = providerParse(
      positiveUintSchema,
      details.currencyOut.amount,
    );
    const minimum = providerParse(
      positiveUintSchema,
      details.currencyOut.minimumAmount,
    );
    if (
      (input.tradeType === "EXACT_INPUT" ? amountIn : amountOut) !==
        input.amount ||
      BigInt(minimum) > BigInt(amountOut) ||
      BigInt(minimum) < (BigInt(amountOut) * BigInt(10000 - slippage)) / 10000n
    )
      return invalid(
        "The quote amounts or minimum received do not match the requested trade.",
      );
    const stepIds = raw.steps
      .filter(object)
      .filter((step) => step.requestId !== undefined)
      .map((step) => providerParse(requestIdSchema, step.requestId));
    const relayRequestId = providerParse(
      requestIdSchema,
      raw.requestId ?? stepIds[0],
    );
    if (stepIds.some((id) => id !== relayRequestId))
      return invalid("The provider returned inconsistent request identifiers.");
    const timeEstimate =
      typeof details.timeEstimate === "number" &&
      Number.isFinite(details.timeEstimate) &&
      details.timeEstimate >= 0 &&
      details.timeEstimate <= 86400
        ? details.timeEstimate
        : null;
    const fees = object(raw.fees) ? raw.fees : {};
    const feeParts = ["gas", "relayer", "app"]
      .map((key) => fees[key])
      .filter(object);
    const amountsUsd = feeParts.map((part) => part.amountUsd);
    const feeTotal =
      amountsUsd.length &&
      amountsUsd.every(
        (v) => typeof v === "string" && /^\d{1,12}(\.\d{1,18})?$/.test(v),
      )
        ? amountsUsd.reduce<number>((sum, v) => sum + Number(v), 0)
        : NaN;
    const feesUsd = Number.isFinite(feeTotal) ? feeTotal.toFixed(6) : null;
    const summary: QuoteSummary = {
      currencyIn,
      currencyOut,
      amountIn,
      amountOut,
      minimumAmountOut: minimum,
      amountInFormatted: formatUnits(BigInt(amountIn), currencyIn.decimals),
      amountOutFormatted: formatUnits(BigInt(amountOut), currencyOut.decimals),
      minimumAmountOutFormatted: formatUnits(
        BigInt(minimum),
        currencyOut.decimals,
      ),
      feesUsd,
      timeEstimate,
    };
    const parsed = this.prepareTransactions(raw.steps, input, amountIn);
    const executionBlockReason = !this.config.enableExecution
      ? "Transaction execution is disabled by the server."
      : parsed.reason;
    const executable = !executionBlockReason;
    return {
      network,
      input,
      relayRequestId,
      expiresAt: this.now() + this.config.quoteTtlMs,
      summary,
      quote: {
        requestId: relayRequestId,
        details: {
          sender,
          recipient,
          currencyIn: { currency: currencyIn, amount: amountIn },
          currencyOut: {
            currency: currencyOut,
            amount: amountOut,
            minimumAmount: minimum,
          },
          timeEstimate,
        },
        feesUsd,
      },
      transactions: executable ? parsed.transactions : [],
      executable,
      ...(executionBlockReason ? { executionBlockReason } : {}),
    };
  }
  /**
   * Conservative deposit policy: one exact plain native transfer, or one decoded
   * ERC-20 transfer to an operator-approved deposit address. Relay remains trusted
   * to associate that approved deposit with the cross-chain quote. Opaque router
   * calldata, permits and approvals are not executable without an audited decoder.
   */
  private prepareTransactions(
    steps: unknown[],
    input: QuoteInput,
    amountIn: string,
  ): { transactions: PreparedTransaction[]; reason?: string } {
    const transactions: PreparedTransaction[] = [];
    let nativeTotal = 0n;
    let tokenTotal = 0n;
    let deposits = 0;
    let reason: string | undefined;
    const allowed =
      this.config.transactionTargets[String(input.originChainId)] ?? [];
    for (const step of steps) {
      if (
        !object(step) ||
        !text(step.id, 80) ||
        !Array.isArray(step.items) ||
        step.items.length > 10
      )
        return invalid();
      if (step.kind !== "transaction") {
        reason =
          "This route requires signature or gasless execution, which is not supported yet.";
        continue;
      }
      for (const item of step.items) {
        if (!object(item)) return invalid();
        if (item.status === "complete") continue;
        if (item.status !== "incomplete" || !object(item.data))
          return invalid();
        const tx = item.data;
        const from = providerParse(walletAddressSchema, tx.from);
        const to = providerParse(walletAddressSchema, tx.to);
        const chainId = providerParse(chainIdSchema, tx.chainId);
        const value = providerParse(uintSchema, tx.value ?? "0");
        if (from !== input.user || chainId !== input.originChainId)
          return invalid(
            "The provider transaction has an unexpected sender or network.",
          );
        if (
          typeof tx.data !== "string" ||
          tx.data.length > 65538 ||
          !/^0x(?:[0-9a-fA-F]{2})*$/.test(tx.data)
        )
          return invalid("The provider transaction calldata is invalid.");
        nativeTotal += BigInt(value);
        if (
          input.originCurrency === ZERO_ADDRESS
            ? nativeTotal > BigInt(amountIn)
            : nativeTotal > 0n
        )
          return invalid(
            "The provider transaction exceeds the approved native amount.",
          );
        const calldata = tx.data.toLowerCase();
        if (calldata.startsWith("0x095ea7b3")) {
          if (
            to !== input.originCurrency ||
            input.originCurrency === ZERO_ADDRESS ||
            calldata.length !== 138 ||
            !/^0{24}$/.test(calldata.slice(10, 34))
          )
            return invalid("The approval does not match the source token.");
          const approval = BigInt(`0x${calldata.slice(74)}`);
          if (approval !== 0n && approval !== BigInt(amountIn))
            return invalid("Only exact-amount token approvals are permitted.");
          // A transfer does not need approval. Allowing approval without a decoded,
          // supported subsequent pull would leave an unnecessary token allowance.
          reason =
            "This route requires a token approval and an unsupported deposit contract.";
        } else if (calldata.startsWith("0xa9059cbb")) {
          if (
            to !== input.originCurrency ||
            input.originCurrency === ZERO_ADDRESS ||
            calldata.length !== 138 ||
            !/^0{24}$/.test(calldata.slice(10, 34))
          )
            return invalid(
              "The token transfer does not match the source token.",
            );
          const destination = getAddress(`0x${calldata.slice(34, 74)}`);
          const amount = BigInt(`0x${calldata.slice(74)}`);
          tokenTotal += amount;
          if (amount !== BigInt(amountIn) || tokenTotal > BigInt(amountIn))
            return invalid(
              "The token transfer does not match the exact approved amount.",
            );
          if (!allowed.includes(destination))
            reason =
              "The token deposit address has not been approved by the server operator.";
          deposits++;
        } else if (input.originCurrency === ZERO_ADDRESS && calldata === "0x") {
          if (BigInt(value) !== BigInt(amountIn))
            return invalid(
              "The native transfer does not match the exact approved amount.",
            );
          if (!allowed.includes(to))
            reason =
              "The deposit address has not been approved by the server operator.";
          deposits++;
        } else {
          reason =
            "This route uses contract calldata that has no supported audited decoder.";
        }
        transactions.push({
          from,
          to,
          data: tx.data,
          value,
          chainId,
          stepId: step.id,
        });
      }
    }
    if (!transactions.length)
      reason ??= "This quote has no supported transactions to execute.";
    if (deposits !== 1 || transactions.length !== 1)
      reason ??=
        "This route requires an unsupported sequence of wallet transactions.";
    return { transactions, reason };
  }
  async status(
    networkInput: Network,
    requestId: string,
  ): Promise<IntentStatus> {
    const network = this.network(networkInput);
    const id = parseInput(requestIdSchema, requestId);
    const raw = await this.request(
      network,
      `/intents/status/v3?requestId=${encodeURIComponent(id)}`,
    );
    if (!object(raw)) return invalid();
    const status = providerParse(
      z.enum([
        "waiting",
        "depositing",
        "pending",
        "submitted",
        "success",
        "failure",
        "refund",
      ]),
      raw.status,
    );
    const hashes = (value: unknown): string[] => {
      if (value === undefined) return [];
      return providerParse(z.array(hashSchema).max(20), value);
    };
    const result: IntentStatus = {
      status,
      inTxHashes: hashes(raw.inTxHashes),
      txHashes: hashes(raw.txHashes),
    };
    for (const key of ["originChainId", "destinationChainId"] as const)
      if (raw[key] !== undefined)
        result[key] = providerParse(chainIdSchema, raw[key]);
    if (
      typeof raw.updatedAt === "number" &&
      Number.isSafeInteger(raw.updatedAt) &&
      raw.updatedAt >= 0
    )
      result.updatedAt = raw.updatedAt;
    // Deliberately use generic provider failure labels rather than echo untrusted response text.
    if (raw.failReason)
      result.failReason =
        "The provider reported a failed fill. It may retry or refund.";
    if (raw.refundFailReason)
      result.refundFailReason =
        "The provider reported an unresolved refund. Contact support with the request reference.";
    return result;
  }
}
