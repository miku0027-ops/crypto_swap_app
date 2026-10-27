import { PublicTransactionsService } from "../server/public-transactions";
import { publicFeedSchema } from "../server/transactions-contract";
import type { PublicFeed } from "../server/transactions-contract";
import {
  transactionStream,
  TRANSACTION_STREAM_HEADERS,
} from "../server/transaction-stream";
import { AppError } from "../server/errors";
import { openApiDocument } from "../server/developer-reference";

export type SiteAssets = Record<string, { contentType: string; body: string }>;
type Environment = { RELAY_API_KEY?: string };
type Context = { waitUntil(promise: Promise<unknown>): void };
type EdgeCache = {
  match(request: Request): Promise<Response | undefined>;
  put(request: Request, response: Response): Promise<void>;
};
const security = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Content-Security-Policy":
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: https:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
};
const json = (value: unknown, status = 200, retry?: number) =>
  new Response(JSON.stringify(value), {
    status,
    headers: {
      ...security,
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...(retry ? { "Retry-After": String(retry) } : {}),
    },
  });

/** Only the public read feed runs here. The authenticated GCP API remains separate. */
export function createTransactionsWorker(
  assets: SiteAssets,
  injected?: {
    service?: PublicTransactionsService;
    cache?: EdgeCache;
    now?: () => number;
  },
) {
  let service = injected?.service,
    activeKey: string | undefined;
  const buckets = new Map<string, { count: number; expiresAt: number }>(),
    streams = new Map<string, number>();
  let activeStreams = 0;
  const now = injected?.now ?? Date.now;
  const rateLimit = (key: string, max: number) => {
    const time = now();
    for (const [k, bucket] of buckets)
      if (bucket.expiresAt <= time) buckets.delete(k);
    const bucket = buckets.get(key);
    if (bucket && bucket.count >= max)
      throw new AppError(
        429,
        "TRANSACTIONS_RATE_LIMITED",
        "Too many activity requests. Please retry shortly.",
        Math.ceil((bucket.expiresAt - time) / 1000),
      );
    if (bucket) bucket.count++;
    else if (buckets.size < 1000)
      buckets.set(key, { count: 1, expiresAt: time + 60_000 });
    else
      throw new AppError(
        503,
        "TRANSACTIONS_BUSY",
        "Activity connections are busy. Please retry shortly.",
        60,
      );
  };
  return {
    async fetch(
      request: Request,
      env: Environment = {},
      ctx?: Context,
    ): Promise<Response> {
      const url = new URL(request.url),
        path = url.pathname;
      try {
        if (
          path === "/api/developer/status" ||
          path === "/api/developer/openapi.json"
        ) {
          if (request.method !== "GET")
            return json(
              {
                error: {
                  code: "METHOD_NOT_ALLOWED",
                  message: "Use GET for developer resources.",
                },
              },
              405,
            );
          if (url.search)
            return json(
              {
                error: {
                  code: "INVALID_QUERY",
                  message:
                    "Developer resources do not accept query parameters.",
                },
              },
              400,
            );
          rateLimit(
            `developer:${request.headers.get("CF-Connecting-IP") ?? "local"}`,
            30,
          );
          if (path.endsWith("openapi.json")) return json(openApiDocument());
          return json({
            service: "hoplane-public-api",
            profile: "public-preview",
            checkedAt: now(),
            capabilities: {
              publicActivity: true,
              quotes: false,
              execution: false,
              balances: false,
              sync: false,
            },
            testnetChainIds: [],
            providerKeyConfigured: Boolean(env.RELAY_API_KEY),
          });
        }
        if (
          path === "/api/transactions" ||
          path === "/api/transactions/stream"
        ) {
          if (request.method !== "GET")
            return json(
              {
                error: {
                  code: "METHOD_NOT_ALLOWED",
                  message: "Use GET to read activity.",
                },
              },
              405,
            );
          if (url.search)
            return json(
              {
                error: {
                  code: "INVALID_QUERY",
                  message:
                    "Activity does not accept query parameters. Search the loaded records in the app.",
                },
              },
              400,
            );
          const origin = request.headers.get("Origin");
          if (origin && origin !== url.origin)
            return json(
              {
                error: {
                  code: "ORIGIN_REJECTED",
                  message: "This origin is not allowed.",
                },
              },
              403,
            );
          const ip = request.headers.get("CF-Connecting-IP") ?? "local";
          rateLimit(`read:${ip}`, 30);
          if (
            !injected?.service &&
            (!service || activeKey !== env.RELAY_API_KEY)
          ) {
            activeKey = env.RELAY_API_KEY;
            service = new PublicTransactionsService({
              apiKey: env.RELAY_API_KEY,
              onFailure: (detail) =>
                console.error("Public activity upstream unavailable", detail),
            });
          }
          const read = async (): Promise<PublicFeed> => {
            let cache = injected?.cache;
            if (!cache) {
              try {
                cache = (
                  globalThis.caches as unknown as
                    { default?: EdgeCache } | undefined
                )?.default;
              } catch {
                /* Optional storage may be unavailable in a dispatch namespace. */
              }
            }
            const cacheRequest = new Request(
              `${url.origin}/__hoplane_public_feed/${env.RELAY_API_KEY ? "v3" : "v2"}`,
            );
            if (cache) {
              try {
                const hit = await cache.match(cacheRequest);
                if (hit) {
                  const parsed = publicFeedSchema.safeParse(await hit.json());
                  if (
                    parsed.success &&
                    now() - parsed.data.fetchedAt < parsed.data.nextRefreshMs &&
                    (!parsed.data.source.legacySunsetAt ||
                      now() < parsed.data.source.legacySunsetAt)
                  )
                    return parsed.data;
                }
              } catch {
                /* Cache failures must not become invented empty activity. */
              }
            }
            const snapshot = await service!.snapshot();
            if (cache) {
              const put = cache
                .put(
                  cacheRequest,
                  new Response(JSON.stringify(snapshot), {
                    headers: {
                      "Content-Type": "application/json",
                      "Cache-Control": `public, max-age=${Math.floor(snapshot.nextRefreshMs / 1000)}`,
                    },
                  }),
                )
                .catch(() => {});
              if (ctx) ctx.waitUntil(put);
              else await put;
            }
            return snapshot;
          };
          if (path === "/api/transactions") return json(await read());
          if (activeStreams >= 100 || (streams.get(ip) ?? 0) >= 3)
            throw new AppError(
              429,
              "TRANSACTIONS_STREAM_LIMIT",
              "Too many activity connections. Please retry shortly.",
              60,
            );
          rateLimit(`stream:${ip}`, 6);
          streams.set(ip, (streams.get(ip) ?? 0) + 1);
          activeStreams++;
          const stream = transactionStream(read, request.signal, () => {
            activeStreams--;
            const count = (streams.get(ip) ?? 1) - 1;
            if (count) streams.set(ip, count);
            else streams.delete(ip);
          });
          return new Response(stream, {
            headers: { ...security, ...TRANSACTION_STREAM_HEADERS },
          });
        }
        if (path.startsWith("/api/"))
          return json(
            {
              error: {
                code: "BACKEND_NOT_DEPLOYED",
                message:
                  "This account service is not available yet. Public network activity remains available in Transactions.",
              },
            },
            503,
          );
        if (!["GET", "HEAD"].includes(request.method))
          return new Response("Method not allowed", {
            status: 405,
            headers: security,
          });
        const asset =
          assets[path] ??
          (path === "/" || (!path.includes(".") && !path.startsWith("/assets/"))
            ? assets["/index.html"]
            : undefined);
        if (!asset)
          return new Response("Not found", { status: 404, headers: security });
        const bytes = Uint8Array.from(atob(asset.body), (char) =>
          char.charCodeAt(0),
        );
        return new Response(request.method === "HEAD" ? null : bytes, {
          headers: {
            ...security,
            "Content-Type": asset.contentType,
            "Cache-Control": path.startsWith("/assets/")
              ? "public, max-age=31536000, immutable"
              : "no-cache",
          },
        });
      } catch (error) {
        if (!(error instanceof AppError))
          console.error("Public activity runtime error", {
            name: error instanceof Error ? error.name : "unknown",
            message:
              !env?.RELAY_API_KEY && error instanceof Error
                ? error.message.slice(0, 200)
                : undefined,
          });
        const e =
          error instanceof AppError
            ? error
            : new AppError(
                503,
                "TRANSACTIONS_UNAVAILABLE",
                "Live activity is temporarily unavailable. Reconnecting shortly.",
                30,
              );
        return json(
          { error: { code: e.code, message: e.message } },
          e.status,
          e.retryAfterSeconds,
        );
      }
    },
  };
}
