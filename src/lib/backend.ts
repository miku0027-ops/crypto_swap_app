/// <reference types="vite/client" />
import { createSiweMessage, parseSiweMessage } from "viem/siwe";

export type Network = "testnet" | "mainnet";
export type LiveCurrency = {
  chainId?: number;
  address: string;
  symbol: string;
  name: string;
  decimals: number;
  metadata?: { logoURI?: string; verified?: boolean; isNative?: boolean };
};
export type LiveChain = {
  id: number;
  name: string;
  displayName?: string;
  vmType?: string;
  currency: LiveCurrency;
  explorerUrl?: string;
};
export type BackendConfig = {
  capabilities: {
    quotes: boolean;
    execution: boolean;
    balances: boolean;
    sync: boolean;
    fiat: boolean;
  };
  networks: Record<Network, number[]>;
  authChainId: number;
  maxSlippageBps: number;
  quoteTtlSeconds: number;
};
export type Session = {
  user: { address: string };
  csrfToken: string;
  expiresAt: number;
};
export type Preferences = {
  version: number;
  settings: {
    theme: "light" | "dark";
    slippageBps: number;
    gasTopup: boolean;
    network: Network;
  };
  favorites: { chainId: number; address: string }[];
};
export type PreparedTransaction = {
  from: string;
  to: string;
  data: string;
  value: string;
  chainId: number;
  stepId: string;
};
export type LiveQuote = {
  id: string;
  expiresAt: number;
  relayRequestId: string;
  summary: {
    currencyIn: LiveCurrency;
    currencyOut: LiveCurrency;
    amountIn: string;
    amountOut: string;
    minimumAmountOut: string;
    feesUsd: string | null;
    timeEstimate: number | null;
  };
  transactions: PreparedTransaction[];
  executable: boolean;
  executionBlockReason?: string;
};
export type Transfer = {
  id: string;
  quoteId?: string;
  createdAt?: number;
  expiresAt: number;
  transactions: PreparedTransaction[];
  status: string;
  txHashes?: string[];
  inTxHashes?: string[];
  reportedTxHashes?: string[];
  verifiedTxHashes?: string[];
  summary?: LiveQuote["summary"];
  network?: Network;
  executionBlockReason?: string;
};
export type BalanceResult = {
  chainId: number;
  address: string;
  assets: {
    address: string;
    symbol: string;
    decimals: number;
    balance?: string | null;
    formatted?: string | null;
    error?: { code: string; message: string };
  }[];
  fetchedAt: number;
};
export type WalletProvider = {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
};
export class BackendError extends Error {
  constructor(
    message: string,
    public code = "UNKNOWN",
    public status = 0,
    public requestId?: string,
  ) {
    super(message);
    this.name = "BackendError";
  }
}
const record = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
export function apiBase(): string {
  const value = (import.meta.env.VITE_API_BASE_URL || "/api")
    .trim()
    .replace(/\/+$/, "");
  if (
    !value ||
    (!/^https:\/\//.test(value) &&
      !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/.test(value) &&
      !/^\/(?!\/)/.test(value))
  )
    throw new BackendError(
      "The backend URL must use HTTPS or a local development address.",
      "INVALID_CONFIG",
    );
  return value;
}
export async function api<T>(
  path: string,
  options: {
    method?: string;
    body?: unknown;
    csrfToken?: string;
    signal?: AbortSignal;
    idempotencyKey?: string;
    timeoutMs?: number;
  } = {},
): Promise<T> {
  if (!/^\/[a-z0-9/?=&_%.-]+$/i.test(path) || path.startsWith("//"))
    throw new BackendError("Invalid API path.", "INVALID_PATH");
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (options.signal?.aborted) abort();
  else options.signal?.addEventListener("abort", abort, { once: true });
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, options.timeoutMs ?? 15000);
  try {
    const response = await fetch(`${apiBase()}${path}`, {
      method: options.method ?? (options.body !== undefined ? "POST" : "GET"),
      credentials: "include",
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        ...(options.body !== undefined
          ? { "Content-Type": "application/json" }
          : {}),
        ...(options.csrfToken ? { "X-CSRF-Token": options.csrfToken } : {}),
        ...(options.idempotencyKey
          ? { "Idempotency-Key": options.idempotencyKey }
          : {}),
      },
      ...(options.body !== undefined
        ? { body: JSON.stringify(options.body) }
        : {}),
    });
    const text = await response.text();
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      throw new BackendError(
        "The backend is not available at this address. Check its deployment and try again.",
        "INVALID_RESPONSE",
        response.status,
      );
    }
    if (!response.ok) {
      const error = record(data) && record(data.error) ? data.error : {};
      throw new BackendError(
        typeof error.message === "string"
          ? error.message
          : `Request failed (${response.status}).`,
        typeof error.code === "string" ? error.code : "API_ERROR",
        response.status,
        typeof error.requestId === "string" ? error.requestId : undefined,
      );
    }
    return data as T;
  } catch (error) {
    if (options.signal?.aborted) throw error;
    if (error instanceof BackendError) throw error;
    throw new BackendError(
      timedOut
        ? "The request timed out. Please try again."
        : "Could not reach the backend. Check your connection and retry.",
      timedOut ? "TIMEOUT" : "NETWORK_ERROR",
    );
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", abort);
  }
}
/** Decimal arithmetic only: never pass a token amount through Number. */
export function toBaseUnits(value: string, decimals: number): string {
  if (
    !Number.isInteger(decimals) ||
    decimals < 0 ||
    decimals > 36 ||
    !/^\d+(?:\.\d+)?$/.test(value)
  )
    throw new BackendError("Enter a positive token amount.", "INVALID_AMOUNT");
  const [whole, fraction = ""] = value.split(".");
  if (fraction.length > decimals)
    throw new BackendError(
      `This token supports ${decimals} decimal places.`,
      "INVALID_AMOUNT",
    );
  const result =
    BigInt(whole) * 10n ** BigInt(decimals) +
    BigInt((fraction + "0".repeat(decimals)).slice(0, decimals) || "0");
  if (result <= 0n || result >= 2n ** 256n)
    throw new BackendError(
      "The amount is outside the supported range.",
      "INVALID_AMOUNT",
    );
  return result.toString();
}
export function fromBaseUnits(value: string, decimals: number): string {
  if (
    !/^\d+$/.test(value) ||
    !Number.isInteger(decimals) ||
    decimals < 0 ||
    decimals > 36
  )
    return "Unavailable";
  const digits = BigInt(value)
    .toString()
    .padStart(decimals + 1, "0");
  if (!decimals) return digits;
  return `${digits.slice(0, -decimals)}.${digits.slice(-decimals)}`.replace(
    /\.?0+$/,
    "",
  );
}
export const isEvmAddress = (value: string) =>
  /^0x[0-9a-fA-F]{40}$/.test(value);
export const isTxHash = (value: string) => /^0x[0-9a-fA-F]{64}$/.test(value);
export const short = (value: string) =>
  value.length > 17 ? `${value.slice(0, 8)}…${value.slice(-6)}` : value;
export const messageHex = (value: string) =>
  `0x${Array.from(new TextEncoder().encode(value), (v) => v.toString(16).padStart(2, "0")).join("")}`;
export function safeExplorerUrl(
  base: string | undefined,
  hash: string,
): string | undefined {
  if (!base || !isTxHash(hash)) return;
  try {
    const url = new URL(base);
    if (url.protocol !== "https:" || url.username || url.password) return;
    url.pathname = `${url.pathname.replace(/\/+$/, "")}/tx/${hash}`;
    url.search = "";
    url.hash = "";
    return url.href;
  } catch {
    return;
  }
}
export function validateTransaction(tx: PreparedTransaction, address: string) {
  if (
    !isEvmAddress(address) ||
    !isEvmAddress(tx.from) ||
    tx.from.toLowerCase() !== address.toLowerCase() ||
    !isEvmAddress(tx.to) ||
    !/^0x(?:[0-9a-fA-F]{2})*$/.test(tx.data) ||
    !/^\d+$/.test(tx.value) ||
    BigInt(tx.value) >= 2n ** 256n ||
    !Number.isSafeInteger(tx.chainId) ||
    tx.chainId <= 0
  )
    throw new BackendError(
      "The transaction failed local validation. Request a fresh quote.",
      "INVALID_TRANSACTION",
    );
}
export async function assertWalletAccount(
  provider: WalletProvider,
  address: string,
) {
  const accounts = await provider.request({ method: "eth_accounts" });
  if (
    !Array.isArray(accounts) ||
    typeof accounts[0] !== "string" ||
    accounts[0].toLowerCase() !== address.toLowerCase()
  )
    throw new BackendError(
      "Your wallet account changed. Sign in again before continuing.",
      "ACCOUNT_CHANGED",
    );
}

const signInStatement =
  "Sign in to Hoplane. This signature does not authorize any transfer of funds.";
const csrfPattern = /^[0-9a-f]{64}$/i;
const challengeIdPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const signInLifetimeMs = 5 * 60 * 1000;

/** Authenticate an EOA for private positions. Never requests a funds transaction. */
export async function connectWalletSession(
  provider: WalletProvider,
  options: { signal?: AbortSignal } = {},
): Promise<Session> {
  const ensureActive = () => {
    if (options.signal?.aborted)
      throw new DOMException("Wallet sign-in was cancelled.", "AbortError");
  };
  let issuedCsrfToken: string | undefined;
  try {
    ensureActive();
    // Check deployment availability before opening any wallet prompt.
    const configStarted = performance.now();
    const config = await api<unknown>("/config", { signal: options.signal });
    ensureActive();
    if (
      !record(config) ||
      !Number.isSafeInteger(config.authChainId) ||
      (config.authChainId as number) <= 0
    )
      throw new BackendError(
        "Wallet sign-in is not configured correctly. Please try again later.",
        "INVALID_CONFIG",
      );
    const chainId = config.authChainId as number;
    const receivedAt = performance.now();
    const localTime = Date.now();
    // A bounded, fresh server timestamp accommodates normal device clock skew.
    const referenceTime =
      typeof config.serverTime === "number" &&
      Number.isSafeInteger(config.serverTime) &&
      config.serverTime > 0 &&
      Math.abs(config.serverTime - localTime) <= 24 * 60 * 60 * 1000 &&
      receivedAt - configStarted <= 30_000
        ? config.serverTime
        : localTime;
    const now = () => referenceTime + (performance.now() - receivedAt);

    ensureActive();
    const accounts = await provider.request({ method: "eth_requestAccounts" });
    ensureActive();
    const address = Array.isArray(accounts) ? accounts[0] : undefined;
    if (
      typeof address !== "string" ||
      !isEvmAddress(address) ||
      /^0x0{40}$/i.test(address)
    )
      throw new BackendError(
        "Choose a valid Ethereum wallet account to sign in.",
        "INVALID_ADDRESS",
      );

    ensureActive();
    const challenge = await api<unknown>("/auth/challenge", {
      body: { address, chainId },
      signal: options.signal,
    });
    ensureActive();
    if (
      !record(challenge) ||
      typeof challenge.challengeId !== "string" ||
      !challengeIdPattern.test(challenge.challengeId) ||
      typeof challenge.message !== "string" ||
      challenge.message.length > 4096 ||
      typeof challenge.expiresAt !== "number" ||
      !Number.isSafeInteger(challenge.expiresAt)
    )
      throw new BackendError("The wallet sign-in request is invalid.", "INVALID_CHALLENGE");
    const message = parseSiweMessage(challenge.message);
    const issuedAt = message.issuedAt?.getTime();
    const expiresAt = message.expirationTime?.getTime();
    if (
      !message.address ||
      message.address.toLowerCase() !== address.toLowerCase() ||
      message.chainId !== chainId ||
      message.version !== "1" ||
      message.domain !== window.location.host ||
      message.uri !== window.location.origin ||
      message.statement !== signInStatement ||
      message.scheme !== undefined ||
      message.resources !== undefined ||
      message.notBefore !== undefined ||
      message.requestId !== undefined ||
      !message.nonce ||
      !/^[a-zA-Z0-9]{8,128}$/.test(message.nonce) ||
      !Number.isFinite(issuedAt) ||
      !Number.isFinite(expiresAt) ||
      expiresAt !== challenge.expiresAt
    )
      throw new BackendError(
        "The sign-in request does not match this app and wallet. Please retry.",
        "INVALID_CHALLENGE",
      );
    const ensureFresh = () => {
      if (
        expiresAt! <= now() ||
        issuedAt! > now() + 30_000 ||
        now() - issuedAt! > signInLifetimeMs ||
        expiresAt! - issuedAt! <= 0 ||
        expiresAt! - issuedAt! > signInLifetimeMs
      )
        throw new BackendError(
          "This wallet sign-in request expired or has an invalid lifetime. Please start again.",
          "CHALLENGE_EXPIRED",
        );
    };
    ensureFresh();
    // The parser accepts partial messages; require the exact approved SIWE form
    // so unparsed text or extra signing instructions cannot reach the wallet.
    if (
      challenge.message !==
      createSiweMessage({
        address: message.address,
        chainId,
        domain: window.location.host,
        uri: window.location.origin,
        version: "1",
        nonce: message.nonce,
        issuedAt: message.issuedAt,
        expirationTime: message.expirationTime,
        statement: signInStatement,
      })
    )
      throw new BackendError("The wallet sign-in request is invalid.", "INVALID_CHALLENGE");

    const checkAccount = async () => {
      ensureActive();
      await assertWalletAccount(provider, address);
      ensureActive();
    };
    await checkAccount();
    ensureActive();
    ensureFresh();
    const signature = await provider.request({
      method: "personal_sign",
      params: [messageHex(challenge.message), address],
    });
    ensureActive();
    if (typeof signature !== "string" || !/^0x[0-9a-fA-F]{130}$/.test(signature))
      throw new BackendError("The wallet returned an invalid sign-in signature.", "INVALID_SIGNATURE");
    await checkAccount();
    ensureActive();
    ensureFresh();
    // Once verification starts, receive its CSRF token even if the UI unmounts,
    // so a session cookie issued during cancellation can be revoked below.
    const session = await api<unknown>("/auth/verify", {
      body: { challengeId: challenge.challengeId, signature },
    });
    if (record(session) && typeof session.csrfToken === "string" && csrfPattern.test(session.csrfToken))
      issuedCsrfToken = session.csrfToken;
    ensureActive();
    if (
      !record(session) ||
      !record(session.user) ||
      typeof session.user.address !== "string" ||
      session.user.address.toLowerCase() !== address.toLowerCase() ||
      !issuedCsrfToken ||
      typeof session.expiresAt !== "number" ||
      !Number.isSafeInteger(session.expiresAt) ||
      session.expiresAt <= now() ||
      session.expiresAt > now() + 7 * 24 * 60 * 60 * 1000
    )
      throw new BackendError(
        "The backend returned an invalid wallet session. Please sign in again.",
        "INVALID_SESSION",
      );
    await checkAccount();
    ensureActive();
    return session as Session;
  } catch (error) {
    if (issuedCsrfToken) {
      // Do not use the cancelled signal: this is cleanup, never a funds action.
      await api("/auth/logout", { body: {}, csrfToken: issuedCsrfToken, timeoutMs: 5000 }).catch(() => undefined);
    }
    ensureActive();
    if (record(error) && (error.code === 4001 || error.code === "4001"))
      throw new BackendError(
        "Wallet sign-in was cancelled. Connect again when you are ready.",
        "USER_REJECTED",
      );
    throw error;
  }
}
export type TransferAuthorization = {
  transaction: PreparedTransaction;
  expiresAt: number;
  serverTime: number;
};
export async function authorizeTransfer(
  id: string,
  stepIndex: number,
  csrfToken: string,
  expected: PreparedTransaction,
): Promise<TransferAuthorization> {
  const result = await api<TransferAuthorization>(
    `/transfers/${encodeURIComponent(id)}/authorize`,
    { body: { stepIndex }, csrfToken },
  );
  const tx = result.transaction;
  if (!tx)
    throw new BackendError(
      "The server did not authorize this transaction.",
      "INVALID_AUTHORIZATION",
    );
  validateTransaction(tx, expected.from);
  if (
    tx.from.toLowerCase() !== expected.from.toLowerCase() ||
    tx.to.toLowerCase() !== expected.to.toLowerCase() ||
    tx.data.toLowerCase() !== expected.data.toLowerCase() ||
    BigInt(tx.value) !== BigInt(expected.value) ||
    tx.chainId !== expected.chainId ||
    tx.stepId !== expected.stepId ||
    !Number.isFinite(result.serverTime) ||
    !Number.isFinite(result.expiresAt) ||
    result.expiresAt <= result.serverTime ||
    result.expiresAt <= Date.now()
  )
    throw new BackendError(
      "The authorized transaction changed or expired. Review a fresh quote before continuing.",
      "INVALID_AUTHORIZATION",
    );
  return result;
}
/** Executes one explicitly confirmed EVM transaction only. Tracking retry is separate. */
export async function submitPreparedTransaction(
  provider: WalletProvider,
  tx: PreparedTransaction,
  address: string,
  expiresAt: number,
  now = Date.now,
  options: {
    authorize?: () => Promise<unknown>;
    beforeBroadcast?: () => void;
    previousHash?: string;
  } = {},
): Promise<string> {
  validateTransaction(tx, address);
  const ensureFresh = () => {
    if (!Number.isFinite(expiresAt) || now() >= expiresAt)
      throw new BackendError(
        "This quote has expired. Request a fresh quote.",
        "QUOTE_EXPIRED",
      );
  };
  ensureFresh();
  await assertWalletAccount(provider, address);
  const expectedChain = `0x${tx.chainId.toString(16)}`;
  let chain = await provider.request({ method: "eth_chainId" });
  if (typeof chain !== "string" || !/^0x[0-9a-f]+$/i.test(chain))
    throw new BackendError(
      "Could not verify the wallet network.",
      "CHAIN_MISMATCH",
    );
  if (BigInt(chain) !== BigInt(tx.chainId)) {
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: expectedChain }],
    });
    chain = await provider.request({ method: "eth_chainId" });
  }
  if (
    typeof chain !== "string" ||
    !/^0x[0-9a-f]+$/i.test(chain) ||
    BigInt(chain) !== BigInt(tx.chainId)
  )
    throw new BackendError(
      "Switch your wallet to the requested network before continuing.",
      "CHAIN_MISMATCH",
    );
  await assertWalletAccount(provider, address);
  ensureFresh();
  if (options.previousHash)
    await requireSuccessfulReceipt(provider, options.previousHash, tx.chainId);
  const request = {
    from: address,
    to: tx.to,
    data: tx.data,
    value: `0x${BigInt(tx.value).toString(16)}`,
    chainId: expectedChain,
  };
  const gas = await provider.request({
    method: "eth_estimateGas",
    params: [request],
  });
  if (
    typeof gas !== "string" ||
    !/^0x[0-9a-f]+$/i.test(gas) ||
    BigInt(gas) <= 0n
  )
    throw new BackendError(
      "The wallet could not simulate this transaction.",
      "SIMULATION_FAILED",
    );
  await options.authorize?.();
  await assertWalletAccount(provider, address);
  const finalChain = await provider.request({ method: "eth_chainId" });
  if (
    typeof finalChain !== "string" ||
    !/^0x[0-9a-f]+$/i.test(finalChain) ||
    BigInt(finalChain) !== BigInt(tx.chainId)
  )
    throw new BackendError(
      "Your wallet network changed. Please review the route again.",
      "CHAIN_MISMATCH",
    );
  ensureFresh();
  options.beforeBroadcast?.();
  let hash: unknown;
  try {
    hash = await provider.request({
      method: "eth_sendTransaction",
      params: [request],
    });
  } catch (error) {
    if (record(error) && error.code === 4001)
      throw new BackendError(
        "Transaction rejected in your wallet. Request a fresh quote before trying again.",
        "USER_REJECTED",
      );
    throw new BackendError(
      "The wallet submission result is unknown. Check wallet activity and recover the transaction hash before continuing. Do not send it again.",
      "UNCERTAIN_BROADCAST",
    );
  }
  if (typeof hash !== "string" || !isTxHash(hash))
    throw new BackendError(
      "The wallet returned an unexpected transaction response. Check wallet history before attempting another transaction.",
      "UNCERTAIN_BROADCAST",
    );
  return hash;
}
export type PendingBroadcast = {
  transferId: string;
  stepIndex: number;
  hash: string;
  address: string;
  createdAt: number;
};
const PENDING_KEY = "hoplane.pending-broadcasts";
export function pendingBroadcasts(address?: string): PendingBroadcast[] {
  try {
    const list = JSON.parse(localStorage.getItem(PENDING_KEY) || "[]");
    if (!Array.isArray(list)) return [];
    return list
      .filter(
        (x): x is PendingBroadcast =>
          record(x) &&
          typeof x.transferId === "string" &&
          /^[a-zA-Z0-9_-]{1,100}$/.test(x.transferId) &&
          Number.isInteger(x.stepIndex) &&
          Number(x.stepIndex) >= 0 &&
          typeof x.hash === "string" &&
          isTxHash(x.hash) &&
          typeof x.address === "string" &&
          isEvmAddress(x.address) &&
          typeof x.createdAt === "number" &&
          (!address || x.address.toLowerCase() === address.toLowerCase()),
      )
      .slice(0, 100);
  } catch {
    return [];
  }
}
export function saveBroadcast(record: PendingBroadcast): void {
  const list = pendingBroadcasts().filter(
    (x) =>
      x.transferId !== record.transferId || x.stepIndex !== record.stepIndex,
  );
  localStorage.setItem(
    PENDING_KEY,
    JSON.stringify([record, ...list].slice(0, 100)),
  );
}
export function clearBroadcast(transferId: string, stepIndex: number) {
  try {
    localStorage.setItem(
      PENDING_KEY,
      JSON.stringify(
        pendingBroadcasts().filter(
          (x) => x.transferId !== transferId || x.stepIndex !== stepIndex,
        ),
      ),
    );
  } catch {
    /* History remains available from the authenticated backend. */
  }
}
export function storageWritable(): boolean {
  try {
    localStorage.setItem("hoplane.storage-test", "1");
    localStorage.removeItem("hoplane.storage-test");
    return true;
  } catch {
    return false;
  }
}
export function isTransferSettled(transfer: Transfer) {
  return (
    transfer.status === "success" &&
    Array.isArray(transfer.txHashes) &&
    transfer.txHashes.some(isTxHash)
  );
}

export async function requireSuccessfulReceipt(
  provider: WalletProvider,
  hash: string,
  chainId: number,
): Promise<void> {
  if (!isTxHash(hash))
    throw new BackendError(
      "The previous transaction hash is invalid.",
      "INVALID_HASH",
    );
  const chain = await provider.request({ method: "eth_chainId" });
  if (
    typeof chain !== "string" ||
    !/^0x[0-9a-f]+$/i.test(chain) ||
    BigInt(chain) !== BigInt(chainId)
  )
    throw new BackendError(
      "Switch to the source network to confirm the previous transaction.",
      "CHAIN_MISMATCH",
    );
  const receipt = await provider.request({
    method: "eth_getTransactionReceipt",
    params: [hash],
  });
  if (receipt === null)
    throw new BackendError(
      "The previous transaction is still pending. Wait for confirmation before the next step.",
      "PRIOR_TRANSACTION_PENDING",
    );
  if (
    !record(receipt) ||
    typeof receipt.transactionHash !== "string" ||
    receipt.transactionHash.toLowerCase() !== hash.toLowerCase()
  )
    throw new BackendError(
      "The wallet returned an invalid transaction receipt.",
      "INVALID_RECEIPT",
    );
  if (receipt.status === "0x0")
    throw new BackendError(
      "The previous transaction reverted. Stop this route and review your wallet activity.",
      "PRIOR_TRANSACTION_REVERTED",
    );
  if (receipt.status !== "0x1")
    throw new BackendError(
      "The previous transaction has not been confirmed successfully.",
      "PRIOR_TRANSACTION_PENDING",
    );
}
export type UncertainBroadcast = {
  transferId: string;
  stepIndex: number;
  address: string;
  createdAt: number;
};
const UNCERTAIN_KEY = "hoplane.uncertain-broadcasts";
export function uncertainBroadcasts(address?: string): UncertainBroadcast[] {
  try {
    const list = JSON.parse(localStorage.getItem(UNCERTAIN_KEY) || "[]");
    if (!Array.isArray(list)) return [];
    return list
      .filter(
        (x): x is UncertainBroadcast =>
          record(x) &&
          typeof x.transferId === "string" &&
          /^[a-zA-Z0-9_-]{1,100}$/.test(x.transferId) &&
          Number.isInteger(x.stepIndex) &&
          Number(x.stepIndex) >= 0 &&
          typeof x.address === "string" &&
          isEvmAddress(x.address) &&
          typeof x.createdAt === "number" &&
          (!address || x.address.toLowerCase() === address.toLowerCase()),
      )
      .slice(0, 100);
  } catch {
    return [];
  }
}
export function markUncertain(record: UncertainBroadcast) {
  const list = uncertainBroadcasts().filter(
    (x) =>
      x.transferId !== record.transferId || x.stepIndex !== record.stepIndex,
  );
  localStorage.setItem(
    UNCERTAIN_KEY,
    JSON.stringify([record, ...list].slice(0, 100)),
  );
}
export function clearUncertain(transferId: string, stepIndex: number) {
  localStorage.setItem(
    UNCERTAIN_KEY,
    JSON.stringify(
      uncertainBroadcasts().filter(
        (x) => x.transferId !== transferId || x.stepIndex !== stepIndex,
      ),
    ),
  );
}
