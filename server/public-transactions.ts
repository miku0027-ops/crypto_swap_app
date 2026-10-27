import { formatUnits } from "viem";
import { z } from "zod";
import { AppError } from "./errors.js";
import {
  publicFeedSchema,
  publicLegSchema,
  publicStatusSchema,
} from "./transactions-contract.js";
import type {
  PublicFeed,
  PublicLeg,
  PublicTransaction,
} from "./transactions-contract.js";

const SUNSET = Date.parse("2026-11-24T00:00:00Z");
const MAX_BYTES = 2 * 1024 * 1024;
const uintMax = 2n ** 256n - 1n;
const record = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const id = z
  .string()
  .min(1)
  .max(256)
  .regex(/^[a-zA-Z0-9:_-]+$/);
const chain = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const envelope = z.object({ requests: z.array(z.unknown()).max(50) });
const iso = z.string().datetime({ offset: true });
const invalid = () =>
  new AppError(
    502,
    "TRANSACTIONS_INVALID_RESPONSE",
    "The activity provider returned incomplete data. Please retry later.",
  );

function date(value: unknown, now: number): number | null {
  if (!iso.safeParse(value).success) return null;
  const n = Date.parse(value as string);
  return Number.isSafeInteger(n) && n > 0 && n <= now + 300_000 ? n : null;
}
function leg(
  value: unknown,
  amountKind: PublicLeg["amountKind"],
): PublicLeg | null {
  if (
    !record(value) ||
    !record(value.currency) ||
    typeof value.amount !== "string" ||
    !/^(0|[1-9]\d{0,77})$/.test(value.amount)
  )
    return null;
  if (BigInt(value.amount) > uintMax) return null;
  const c = value.currency;
  if (
    !Number.isInteger(c.decimals) ||
    (c.decimals as number) < 0 ||
    (c.decimals as number) > 36
  )
    return null;
  const parsed = publicLegSchema.safeParse({
    chainId: c.chainId,
    address: c.address,
    symbol: c.symbol,
    amount: value.amount,
    decimals: c.decimals,
    amountFormatted: formatUnits(BigInt(value.amount), c.decimals as number),
    amountKind,
  });
  return parsed.success ? parsed.data : null;
}
function txs(
  value: unknown,
  version: "v2" | "v3",
  now: number,
): PublicTransaction["depositTxs"] {
  if (!Array.isArray(value) || value.length > 32) return [];
  return value.flatMap((v) => {
    if (!record(v)) return [];
    const hash = id.safeParse(version === "v3" ? v.txHash : v.hash);
    const network = chain.safeParse(v.chainId);
    if (
      !hash.success ||
      !network.success ||
      !/^[A-Za-z0-9_-]{32,256}$/.test(hash.data) ||
      (hash.data.startsWith("0x") &&
        (!/^0x[0-9a-fA-F]{40,128}$/.test(hash.data) ||
          /^0x0+$/.test(hash.data)))
    )
      return [];
    const t =
      typeof v.timestamp === "number" &&
      Number.isSafeInteger(v.timestamp) &&
      v.timestamp > 0 &&
      v.timestamp * 1000 <= now + 300_000
        ? v.timestamp * 1000
        : null;
    return [
      {
        hash: hash.data,
        chainId: network.data,
        timestamp: t,
        status:
          v.status === "success" || v.status === "failure"
            ? v.status
            : ("unknown" as const),
      },
    ];
  });
}
/** Fixed, read-only public feed. No wallet/session data or arbitrary provider queries. */
export class PublicTransactionsService {
  private cached?: PublicFeed;
  private pending?: Promise<PublicFeed>;
  private cooldownUntil = 0;
  private lastError?: AppError;
  constructor(
    private readonly options: {
      apiKey?: string;
      onFailure?: (detail: {
        kind: "http" | "runtime";
        status?: number;
        invalidContext?: boolean;
      }) => void;
    } = {},
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly now: () => number = Date.now,
    private readonly beforeRequest?: () => Promise<void>,
  ) {}
  async snapshot(): Promise<PublicFeed> {
    const version = this.options.apiKey ? "v3" : "v2";
    if (version === "v2" && this.now() >= SUNSET)
      throw new AppError(
        503,
        "TRANSACTIONS_KEY_REQUIRED",
        "Live activity is temporarily unavailable. Please try again later.",
        300,
      );
    const ttl = version === "v3" ? 10_000 : 60_000;
    if (this.cached && this.now() - this.cached.fetchedAt < ttl)
      return this.clone(this.cached);
    if (this.cooldownUntil > this.now())
      throw new AppError(
        this.lastError!.status,
        this.lastError!.code,
        this.lastError!.message,
        Math.max(1, Math.ceil((this.cooldownUntil - this.now()) / 1000)),
      );
    if (this.pending) return this.clone(await this.pending);
    this.pending = this.read(version, ttl).catch((error: unknown) => {
      const e = error instanceof AppError ? error : invalid();
      this.lastError = e;
      this.cooldownUntil = this.now() + (e.retryAfterSeconds ?? 15) * 1000;
      throw e;
    });
    try {
      return this.clone(await this.pending);
    } finally {
      this.pending = undefined;
    }
  }
  private clone(value: PublicFeed): PublicFeed {
    const result = structuredClone(value);
    result.providerDataOld =
      result.latestActivityAt !== null &&
      this.now() - result.latestActivityAt > 300_000;
    return result;
  }
  private async read(version: "v2" | "v3", ttl: number): Promise<PublicFeed> {
    const controller = new AbortController();
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        void reader?.cancel().catch(() => {});
        reject(
          new AppError(
            504,
            "TRANSACTIONS_TIMEOUT",
            "Live activity took too long to respond. Reconnecting shortly.",
            15,
          ),
        );
      }, 8000);
    });
    try {
      const raw = await Promise.race([
        timeout,
        (async () => {
          await this.beforeRequest?.();
          if (controller.signal.aborted) throw invalid();
          // Explicit descending sort: ascending updatedAt returns old historical records.
          const source = `https://api.relay.link/requests/${version}`;
          const response = await this.fetchImpl.call(
            globalThis,
            `${source}?limit=50&sortBy=createdAt&sortDirection=desc&includeAuthenticatedData=false`,
            {
              headers: {
                Accept: "application/json",
                ...(this.options.apiKey
                  ? { "x-api-key": this.options.apiKey }
                  : {}),
              },
              // Server-side fetch has no browser cookie jar; only the explicit
              // headers above are sent. Workers do not implement credentials
              // or redirect:error. Manual mode plus !ok below rejects redirects.
              redirect: "manual",
              signal: controller.signal,
            },
          );
          if (controller.signal.aborted) {
            void response.body?.cancel().catch(() => {});
            throw invalid();
          }
          if (!response.ok) {
            this.options.onFailure?.({ kind: "http", status: response.status });
            void response.body?.cancel().catch(() => {});
            const advertised = Number(response.headers.get("Retry-After"));
            const retry =
              Number.isFinite(advertised) && advertised > 0
                ? Math.min(300, Math.max(10, Math.ceil(advertised)))
                : 60;
            throw new AppError(
              response.status === 429 ? 429 : 503,
              response.status === 429
                ? "TRANSACTIONS_RATE_LIMITED"
                : "TRANSACTIONS_UNAVAILABLE",
              response.status === 429
                ? "The activity provider is busy. Updates will resume automatically."
                : "Live activity is temporarily unavailable. Reconnecting shortly.",
              retry,
            );
          }
          if (
            Number(response.headers.get("content-length")) > MAX_BYTES ||
            !response.body
          )
            throw invalid();
          reader = response.body.getReader();
          let size = 0;
          const chunks: Uint8Array[] = [];
          while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            size += value.byteLength;
            if (size > MAX_BYTES) throw invalid();
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
            throw invalid();
          }
        })(),
      ]);
      const parsed = envelope.safeParse(raw);
      if (!parsed.success) throw invalid();
      const seen = new Set<string>();
      let omittedCount = 0;
      const transactions: PublicTransaction[] = [];
      for (const raw of parsed.data.requests) {
        if (!record(raw) || !record(raw.data)) {
          omittedCount++;
          continue;
        }
        const requestId = id.safeParse(raw.id),
          created = date(raw.createdAt, this.now()),
          updated = date(raw.updatedAt, this.now());
        if (
          !requestId.success ||
          !created ||
          !updated ||
          updated < created ||
          seen.has(requestId.data)
        ) {
          omittedCount++;
          continue;
        }
        seen.add(requestId.data);
        const data = raw.data,
          metadata =
            version === "v2" && record(data.metadata) ? data.metadata : data;
        // v3 moves assets into data.route; do not use quoted route amounts as fills.
        const route = record(data.route) ? data.route : {};
        const actual = record(route.actual) ? route.actual : {},
          quoted = record(route.quoted) ? route.quoted : {};
        const actualOrigin = record(actual.origin) ? actual.origin : {},
          actualDestination = record(actual.destination)
            ? actual.destination
            : {};
        const quotedOrigin = record(quoted.origin) ? quoted.origin : {},
          quotedDestination = record(quoted.destination)
            ? quoted.destination
            : {};
        const from =
          version === "v2"
            ? leg(
                metadata.currencyIn,
                raw.status === "success" ? "reported" : "quoted",
              )
            : (leg(actualOrigin.inputCurrency, "reported") ??
              leg(quotedOrigin.inputCurrency, "quoted"));
        const to =
          version === "v2"
            ? leg(
                metadata.currencyOut,
                raw.status === "success" ? "reported" : "quoted",
              )
            : (leg(actualDestination.outputCurrency, "reported") ??
              leg(quotedDestination.outputCurrency, "quoted"));
        const status = publicStatusSchema.safeParse(raw.status);
        const depositTxs = txs(data.inTxs, version, this.now()),
          fillTxs = txs(data.outTxs, version, this.now());
        // Publish only requests with an indexed public transaction reference.
        if (!depositTxs.length && !fillTxs.length) {
          omittedCount++;
          continue;
        }
        const incoming = depositTxs
          .filter(
            (tx) =>
              tx.status !== "failure" &&
              tx.timestamp !== null &&
              from &&
              tx.chainId === from.chainId,
          )
          .map((tx) => tx.timestamp!);
        const outgoing = fillTxs
          .filter(
            (tx) =>
              tx.status !== "failure" &&
              tx.timestamp !== null &&
              to &&
              tx.chainId === to.chainId,
          )
          .map((tx) => tx.timestamp!);
        const elapsed =
          incoming.length && outgoing.length
            ? (Math.max(...outgoing) - Math.min(...incoming)) / 1000
            : null;
        transactions.push({
          id: requestId.data,
          status: status.success ? status.data : "unknown",
          sender: id.safeParse(metadata.sender ?? raw.sender ?? raw.user)
            .success
            ? ((metadata.sender ?? raw.sender ?? raw.user) as string)
            : null,
          recipient: id.safeParse(metadata.recipient ?? raw.recipient).success
            ? ((metadata.recipient ?? raw.recipient) as string)
            : null,
          from,
          to,
          depositTxs,
          fillTxs,
          createdAt: created,
          updatedAt: updated,
          fillTimeSeconds:
            raw.status === "success" &&
            elapsed !== null &&
            elapsed >= 0 &&
            elapsed <= 31_536_000
              ? elapsed
              : null,
          requestType:
            typeof raw.requestType === "string" &&
            /^[^\x00-\x1f\x7f]{1,64}$/.test(raw.requestType)
              ? raw.requestType
              : null,
        });
      }
      if (parsed.data.requests.length && !transactions.length) throw invalid();
      transactions.sort(
        (a, b) => b.createdAt - a.createdAt || a.id.localeCompare(b.id),
      );
      const result = publicFeedSchema.safeParse({
        transactions,
        fetchedAt: this.now(),
        latestActivityAt: transactions.length
          ? Math.max(...transactions.map((row) => row.updatedAt))
          : null,
        nextRefreshMs: ttl,
        providerDataOld: false,
        omittedCount,
        source: {
          name: "Relay network",
          scope: "public-network-activity",
          version,
          url: `https://api.relay.link/requests/${version}`,
          legacySunsetAt: version === "v2" ? SUNSET : null,
        },
      });
      if (!result.success) throw invalid();
      this.cached = result.data;
      return this.cached;
    } catch (error) {
      if (error instanceof AppError) throw error;
      this.options.onFailure?.({
        kind: "runtime",
        invalidContext:
          error instanceof TypeError &&
          error.message.includes("Illegal invocation"),
      });
      throw new AppError(
        503,
        "TRANSACTIONS_UNAVAILABLE",
        "Live activity is temporarily unavailable. Reconnecting shortly.",
        30,
      );
    } finally {
      if (timer) clearTimeout(timer);
      void reader?.cancel().catch(() => {});
      reader?.releaseLock();
    }
  }
}
