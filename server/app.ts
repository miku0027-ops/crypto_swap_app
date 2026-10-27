import Fastify, { type FastifyRequest, type FastifyReply } from "fastify";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import staticFiles from "@fastify/static";
import { randomUUID, timingSafeEqual, createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";
import { readConfig, type AppConfig, type Network } from "./config.js";
import { AppError } from "./errors.js";
import { AuthService, type Session } from "./auth.js";
import type { Store } from "./store.js";
import { RelayService, type QuoteDraft } from "./relay.js";
import { RpcService } from "./rpc.js";
import {
  parseInput,
  networkSchema,
  chainIdSchema,
  addressSchema,
  walletAddressSchema,
  hashSchema,
  quoteRequestSchema,
  currencySearchSchema,
} from "./validation.js";

export type StoredQuote = QuoteDraft & {
  id: string;
  owner: string;
  createdAt: number;
  policyFingerprint: string;
};
export type Transfer = {
  id: string;
  quoteId: string;
  owner: string;
  network: Network;
  relayRequestId: string;
  summary: QuoteDraft["summary"];
  transactions: QuoteDraft["transactions"];
  expiresAt: number;
  createdAt: number;
  updatedAt: number;
  version: number;
  status: string;
  txHashes: string[];
  inTxHashes: string[];
  reportedTxHashes: string[];
  verifiedTxHashes: string[];
  submittedSteps: Record<string, string>;
  authorizedSteps?: Record<string, number>;
  idempotencyHash: string;
  trackingError?: string;
};
interface Dependencies {
  config?: AppConfig;
  store: Store;
  relay?: RelayService;
  rpc?: RpcService;
  now?: () => number;
  logger?: boolean;
  serveStatic?: boolean;
  trustProxyHops?: number;
}
const uuid = z.string().uuid();
const networkQuery = z
  .object({ network: networkSchema.default("testnet") })
  .strict();
const idParam = z.object({ id: uuid }).strict();
const defaults = {
  version: 0,
  settings: {
    theme: "light" as const,
    slippageBps: 50,
    gasTopup: false,
    network: "testnet" as Network,
  },
  favorites: [] as { chainId: number; address: string }[],
};
const preferencesSchema = z
  .object({
    version: z
      .number()
      .int()
      .min(0)
      .max(Number.MAX_SAFE_INTEGER - 1),
    settings: z
      .object({
        theme: z.enum(["light", "dark"]),
        slippageBps: z.number().int().min(0).max(1000),
        gasTopup: z.boolean(),
        network: networkSchema,
      })
      .strict(),
    favorites: z
      .array(
        z.object({ chainId: chainIdSchema, address: addressSchema }).strict(),
      )
      .max(50),
  })
  .strict();
const publicSession = (session: Session) => ({
  user: { address: session.address },
  csrfToken: session.csrfToken,
  expiresAt: session.expiresAt,
});
const owner = (session: Session) => session.address.toLowerCase();
const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const retention = 90 * 24 * 60 * 60 * 1000;
export async function buildApp(deps: Dependencies) {
  const config = deps.config ?? readConfig(),
    now = deps.now ?? Date.now,
    store = deps.store;
  const relay =
      deps.relay ??
      new RelayService(config, fetch, now, async (path) => {
        await limit("relay:all", 240);
        if (path.startsWith("/quote/")) await limit("relay:quotes", 45);
        else if (path.startsWith("/intents/status/"))
          await limit("relay:status", 150);
        else await limit("relay:metadata", 100);
      }),
    rpc = deps.rpc ?? new RpcService({});
  const auth = new AuthService(store, config, now);
  const policyFingerprint = digest(
    JSON.stringify({
      execution: config.enableExecution,
      mainnet: config.enableMainnet,
      chains: config.allowedChainIds,
      targets: config.transactionTargets,
      slippage: config.maxSlippageBps,
    }),
  );
  const app = Fastify({
    logger: deps.logger
      ? {
          level: "info",
          redact: [
            "req.headers.cookie",
            "req.headers.authorization",
            'req.headers["x-csrf-token"]',
            'res.headers["set-cookie"]',
          ],
          serializers: {
            req: (r) => ({
              method: r.method,
              url: r.url.split("?")[0],
              requestId: r.id,
            }),
            err: (e) => ({
              type: "Error",
              message: "Request failed",
              stack: "",
              code: e.code ?? "INTERNAL_ERROR",
            }),
          },
        }
      : false,
    bodyLimit: 32 * 1024,
    requestTimeout: 20000,
    connectionTimeout: 10000,
    trustProxy: deps.trustProxyHops
      ? (_address, hop) => hop < deps.trustProxyHops!
      : false,
    genReqId: () => randomUUID(),
  });
  const cookieName =
    config.nodeEnv === "production" ? "__session" : "hoplane_session";
  const cookieOptions = {
    httpOnly: true,
    secure: config.nodeEnv === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: Math.floor(config.sessionTtlMs / 1000),
  };
  await app.register(cookie);
  await app.register(cors, {
    origin: (origin, cb) =>
      cb(null, !origin || config.allowedOrigins.includes(origin)),
    credentials: true,
    methods: ["GET", "POST", "PUT", "OPTIONS"],
    allowedHeaders: ["Content-Type", "X-CSRF-Token", "Idempotency-Key"],
    maxAge: 600,
  });
  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
        fontSrc: ["'self'", "https://fonts.gstatic.com"],
        imgSrc: ["'self'", "data:", "https:"],
        connectSrc: ["'self'", ...config.allowedOrigins],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        frameAncestors: ["'none'"],
      },
    },
    crossOriginEmbedderPolicy: false,
    hsts: config.nodeEnv === "production",
  });
  async function limit(key: string, count: number, window = 60000) {
    const result = await store.rateLimit(key, count, window);
    if (!result.allowed)
      throw new AppError(
        429,
        "RATE_LIMITED",
        "Too many requests. Please wait before retrying.",
        result.retryAfterSeconds,
      );
  }
  app.addHook("onRequest", async (req, reply) => {
    reply.header("X-Request-Id", req.id);
    if (!req.url.startsWith("/api/")) return;
    reply.header("Cache-Control", "no-store");
    if (req.method === "OPTIONS") return;
    const origin = req.headers.origin;
    if (origin && !config.allowedOrigins.includes(origin))
      throw new AppError(403, "ORIGIN_REJECTED", "This origin is not allowed.");
    if (["POST", "PUT", "DELETE", "PATCH"].includes(req.method)) {
      if (!origin || !config.allowedOrigins.includes(origin))
        throw new AppError(
          403,
          "ORIGIN_REQUIRED",
          "Use an authorized Hoplane origin.",
        );
      if (
        !req.headers["content-type"]
          ?.toLowerCase()
          .startsWith("application/json")
      )
        throw new AppError(415, "JSON_REQUIRED", "Use application/json.");
    }
    if (!["/api/health", "/api/ready"].includes(req.url))
      await limit(`ip:${req.ip}`, 180);
  });
  async function session(req: FastifyRequest, write = false): Promise<Session> {
    const current = await auth.authenticate(req.cookies[cookieName]);
    if (!current)
      throw new AppError(
        401,
        "AUTH_REQUIRED",
        "Connect and sign in with your wallet first.",
      );
    if (write) {
      const csrf = req.headers["x-csrf-token"];
      if (
        typeof csrf !== "string" ||
        Buffer.byteLength(csrf) !== Buffer.byteLength(current.csrfToken) ||
        !timingSafeEqual(Buffer.from(csrf), Buffer.from(current.csrfToken))
      )
        throw new AppError(
          403,
          "CSRF_REJECTED",
          "Your session changed. Sign in again.",
        );
    }
    return current;
  }
  function checkNetwork(network: Network) {
    if (network === "mainnet" && !config.enableMainnet)
      throw new AppError(
        403,
        "MAINNET_DISABLED",
        "Mainnet is not enabled. Select testnet.",
      );
  }
  function checkChain(network: Network, id: number) {
    checkNetwork(network);
    if (!config.allowedChainIds[network].includes(id))
      throw new AppError(
        400,
        "CHAIN_NOT_ALLOWED",
        "This network is not enabled by Hoplane.",
      );
  }
  async function ownedTransfer(id: string, user: Session) {
    const item = await store.get<Transfer>("transfers", id);
    if (!item || item.owner !== owner(user))
      throw new AppError(404, "TRANSFER_NOT_FOUND", "Transfer not found.");
    return item;
  }
  async function updateTransfer(
    id: string,
    user: Session,
    update: (t: Transfer) => Transfer,
  ) {
    for (let i = 0; i < 4; i++) {
      const item = await ownedTransfer(id, user);
      const next = {
        ...update(item),
        version: item.version + 1,
        updatedAt: now(),
      };
      if (
        await store.compareAndSet(
          "transfers",
          id,
          next,
          item.version,
          item.createdAt + retention,
        )
      )
        return next;
    }
    throw new AppError(
      409,
      "UPDATE_CONFLICT",
      "Transfer changed. Refresh and retry.",
    );
  }
  async function executableQuote(id: string, user: Session) {
    const quote = await store.get<StoredQuote>("quotes", id);
    if (!quote || quote.owner !== owner(user))
      throw new AppError(404, "QUOTE_NOT_FOUND", "Quote not found.");
    if (quote.policyFingerprint !== policyFingerprint)
      throw new AppError(
        409,
        "POLICY_CHANGED",
        "Server route policy changed. Request a new quote.",
      );
    if (quote.expiresAt <= now())
      throw new AppError(
        409,
        "QUOTE_EXPIRED",
        "This quote expired. Request a fresh quote.",
      );
    if (!config.enableExecution || !quote.executable)
      throw new AppError(
        409,
        "EXECUTION_DISABLED",
        quote.executionBlockReason || "Live execution is not enabled.",
      );
    checkNetwork(quote.network);
    for (const tx of quote.transactions) {
      checkChain(quote.network, tx.chainId);
      if (!rpc.readyFor(tx.chainId))
        throw new AppError(
          503,
          "RPC_NOT_CONFIGURED",
          "Transaction verification is unavailable for this network.",
        );
    }
    return quote;
  }
  const publicTransfer = ({
    idempotencyHash: _,
    owner: __,
    ...item
  }: Transfer) => item;
  app.get("/api/health", async () => ({
    status: "ok",
    service: "hoplane-api",
  }));
  app.get("/api/ready", async (_req, reply) => {
    try {
      await store.get("health", "probe");
      return {
        status: "ready",
        capabilities: {
          quotes: Boolean(config.relayApiKey),
          execution: config.enableExecution,
          storage: config.storeDriver,
        },
      };
    } catch {
      reply.code(503);
      return { status: "unavailable", code: "STORAGE_UNAVAILABLE" };
    }
  });
  app.get("/api/config", async () => ({
    version: 1,
    capabilities: {
      quotes: Boolean(config.relayApiKey),
      execution: config.enableExecution && Boolean(config.relayApiKey),
      balances: rpc.configuredChainIds.length > 0,
      sync: true,
      fiat: false,
    },
    networks: {
      mainnet: config.enableMainnet ? config.allowedChainIds.mainnet : [],
      testnet: config.allowedChainIds.testnet,
    },
    authChainId: config.authChainId,
    maxSlippageBps: config.maxSlippageBps,
    quoteTtlSeconds: config.quoteTtlMs / 1000,
    supportedVMs: ["evm"],
    authentication: "siwe-eoa",
    serverTime: now(),
  }));
  app.get("/api/chains", async (req) => {
    const { network } = parseInput(networkQuery, req.query);
    checkNetwork(network);
    return { chains: await relay.chains(network) };
  });
  app.post("/api/currencies", async (req) => {
    const body = parseInput(
      z
        .object({ network: networkSchema, search: currencySearchSchema })
        .strict(),
      req.body,
    );
    checkNetwork(body.network);
    return { currencies: await relay.currencies(body.network, body.search) };
  });
  app.post("/api/auth/challenge", async (req) => {
    await limit(`auth:${req.ip}`, 15);
    const body = parseInput(
      z
        .object({ address: walletAddressSchema, chainId: chainIdSchema })
        .strict(),
      req.body,
    );
    return auth.challenge(body.address, body.chainId);
  });
  app.post("/api/auth/verify", async (req, reply) => {
    await limit(`auth:${req.ip}`, 15);
    const body = parseInput(
      z
        .object({ challengeId: uuid, signature: z.string().min(1).max(132) })
        .strict(),
      req.body,
    );
    const { token, session: current } = await auth.verify(
      body.challengeId,
      body.signature,
    );
    const old = req.cookies[cookieName];
    if (old) await auth.logout(old);
    reply.setCookie(cookieName, token, cookieOptions);
    return publicSession(current);
  });
  app.get("/api/auth/session", async (req) => {
    const current = await auth.authenticate(req.cookies[cookieName]);
    return current ? publicSession(current) : { user: null };
  });
  app.post("/api/auth/logout", async (req, reply) => {
    await session(req, true);
    parseInput(z.object({}).strict(), req.body);
    await auth.logout(req.cookies[cookieName]);
    reply.clearCookie(cookieName, {
      path: "/",
      secure: cookieOptions.secure,
      sameSite: "lax",
    });
    return { ok: true };
  });
  app.get("/api/preferences", async (req) => {
    const current = await session(req);
    const saved = await store.get<Record<string, unknown>>(
      "preferences",
      owner(current),
    );
    if (!saved) return defaults;
    const { owner: _, createdAt: __, ...value } = saved;
    return value;
  });
  app.put("/api/preferences", async (req) => {
    const current = await session(req, true);
    await limit(`preferences:${owner(current)}`, 30);
    const value = parseInput(preferencesSchema, req.body);
    if (value.settings.slippageBps > config.maxSlippageBps)
      throw new AppError(
        400,
        "SLIPPAGE_LIMIT",
        "Slippage exceeds the server limit.",
      );
    checkNetwork(value.settings.network);
    for (const f of value.favorites)
      if (
        ![
          ...config.allowedChainIds.mainnet,
          ...config.allowedChainIds.testnet,
        ].includes(f.chainId)
      )
        throw new AppError(
          400,
          "CHAIN_NOT_ALLOWED",
          "A favorite uses an unsupported chain.",
        );
    const favorites = [
      ...new Map(
        value.favorites.map((f) => [
          `${f.chainId}:${f.address.toLowerCase()}`,
          f,
        ]),
      ).values(),
    ];
    const next = {
      ...value,
      favorites,
      version: value.version + 1,
      owner: owner(current),
      createdAt: now(),
    };
    if (
      !(await store.compareAndSet(
        "preferences",
        owner(current),
        next,
        value.version,
      ))
    )
      throw new AppError(
        409,
        "PREFERENCES_CONFLICT",
        "Preferences changed on another device. Reload them before saving.",
      );
    return { version: next.version, settings: next.settings, favorites };
  });
  async function quoteHandler(req: FastifyRequest) {
    const current = await session(req, true);
    await limit(`quote:${owner(current)}`, 12);
    const body = parseInput(quoteRequestSchema, req.body);
    if (body.quote.user.toLowerCase() !== owner(current))
      throw new AppError(
        403,
        "WALLET_MISMATCH",
        "Quote wallet must match your signed-in wallet.",
      );
    checkNetwork(body.network);
    const draft = await relay.quote(body.network, body.quote);
    if (
      draft.executable &&
      !draft.transactions.every((tx) => rpc.readyFor(tx.chainId))
    ) {
      draft.executable = false;
      draft.executionBlockReason =
        "RPC verification is not configured for this route.";
    }
    const record: StoredQuote = {
      ...draft,
      id: randomUUID(),
      owner: owner(current),
      createdAt: now(),
      policyFingerprint,
    };
    await store.set("quotes", record.id, record, now() + 86400000);
    const { owner: _, ...result } = record;
    return result;
  }
  app.post("/api/quotes", quoteHandler);
  app.post("/api/relay/quote", quoteHandler);
  app.post("/api/quotes/:id/prepare", async (req) => {
    const current = await session(req, true);
    await limit(`prepare:${owner(current)}`, 12);
    const { id } = parseInput(idParam, req.params);
    parseInput(z.object({}).strict(), req.body);
    const key = parseInput(uuid, req.headers["idempotency-key"]);
    const quote = await executableQuote(id, current);
    const existing = await store.get<Transfer>("transfers", id);
    if (existing) {
      if (existing.owner !== owner(current))
        throw new AppError(404, "QUOTE_NOT_FOUND", "Quote not found.");
      if (existing.idempotencyHash !== digest(key))
        throw new AppError(
          409,
          "QUOTE_ALREADY_PREPARED",
          "This quote already has a transfer. Resume it from activity.",
        );
      return publicTransfer(existing);
    }
    if (!quote.relayRequestId)
      throw new AppError(
        502,
        "INVALID_QUOTE",
        "The quote has no tracking reference.",
      );
    const item: Transfer = {
      id,
      quoteId: id,
      owner: owner(current),
      network: quote.network,
      relayRequestId: quote.relayRequestId,
      summary: quote.summary,
      transactions: quote.transactions,
      expiresAt: quote.expiresAt,
      createdAt: now(),
      updatedAt: now(),
      version: 1,
      status: "prepared",
      txHashes: [],
      inTxHashes: [],
      reportedTxHashes: [],
      verifiedTxHashes: [],
      submittedSteps: {},
      idempotencyHash: digest(key),
    };
    if (!(await store.create("transfers", id, item, now() + retention))) {
      const winner = await ownedTransfer(id, current);
      if (winner.idempotencyHash !== digest(key))
        throw new AppError(
          409,
          "QUOTE_ALREADY_PREPARED",
          "This quote already has a transfer.",
        );
      return publicTransfer(winner);
    }
    return publicTransfer(item);
  });
  app.post("/api/transfers/:id/authorize", async (req) => {
    const current = await session(req, true);
    await limit(`authorize:${owner(current)}`, 12);
    const { id } = parseInput(idParam, req.params);
    const { stepIndex } = parseInput(
      z.object({ stepIndex: z.number().int().min(0).max(9) }).strict(),
      req.body,
    );
    const item = await ownedTransfer(id, current);
    const quote = await executableQuote(item.quoteId, current);
    if (
      item.submittedSteps[stepIndex] ||
      ["success", "refund"].includes(item.status)
    )
      throw new AppError(
        409,
        "STEP_ALREADY_RECORDED",
        "This transaction was already submitted. Resume tracking from activity.",
      );
    const transaction = item.transactions[stepIndex];
    if (!transaction)
      throw new AppError(
        400,
        "INVALID_STEP",
        "This transaction step does not exist.",
      );
    if (
      JSON.stringify(transaction) !==
      JSON.stringify(quote.transactions[stepIndex])
    )
      throw new AppError(
        409,
        "POLICY_CHANGED",
        "This transaction no longer matches the quote. Request a new quote.",
      );
    // A prepared step may be opened for signing only once across all devices.
    // Unknown wallet outcomes are recovered by hash, never by replaying a send.
    await updateTransfer(id, current, (t) => {
      if (
        t.submittedSteps[stepIndex] ||
        ["success", "refund"].includes(t.status)
      )
        throw new AppError(
          409,
          "STEP_ALREADY_RECORDED",
          "This transaction was already submitted. Resume tracking from activity.",
        );
      if (t.authorizedSteps?.[stepIndex] !== undefined)
        throw new AppError(
          409,
          "STEP_ALREADY_AUTHORIZED",
          "This route was already authorized on a device. Request a fresh quote if no transaction was sent; otherwise recover the wallet transaction hash.",
        );
      return {
        ...t,
        authorizedSteps: { ...t.authorizedSteps, [stepIndex]: now() },
      };
    });
    return { transaction, expiresAt: quote.expiresAt, serverTime: now() };
  });
  app.post("/api/transfers/:id/transactions", async (req) => {
    const current = await session(req, true);
    await limit(`tracking-write:${owner(current)}`, 45);
    const { id } = parseInput(idParam, req.params);
    const body = parseInput(
      z
        .object({
          transactionHash: hashSchema,
          stepIndex: z.number().int().min(0).max(9),
        })
        .strict(),
      req.body,
    );
    const item = await ownedTransfer(id, current);
    const expected = item.transactions[body.stepIndex];
    if (!expected)
      throw new AppError(
        400,
        "INVALID_STEP",
        "This transaction step does not exist.",
      );
    const prior = item.submittedSteps[body.stepIndex];
    if (prior) {
      if (prior.toLowerCase() !== body.transactionHash.toLowerCase())
        throw new AppError(
          409,
          "STEP_ALREADY_RECORDED",
          "This step already has a verified transaction.",
        );
      return publicTransfer(item);
    }
    const verified = await rpc.verifyTransaction(
      expected.chainId,
      body.transactionHash,
      expected,
    );
    if (!verified.verified)
      throw new AppError(
        verified.reason === "not_found" ? 409 : 400,
        verified.reason === "not_found"
          ? "TRANSACTION_NOT_FOUND"
          : "TRANSACTION_MISMATCH",
        verified.reason === "not_found"
          ? "Transaction is not indexed yet. Retry tracking; do not send it again."
          : "This transaction does not match the reviewed quote.",
      );
    const updated = await updateTransfer(id, current, (t) => {
      const prior = t.submittedSteps[body.stepIndex];
      if (prior && prior.toLowerCase() !== body.transactionHash.toLowerCase())
        throw new AppError(
          409,
          "STEP_ALREADY_RECORDED",
          "This step already has a different transaction.",
        );
      return {
        ...t,
        status: ["success", "refund"].includes(t.status)
          ? t.status
          : "submitted",
        submittedSteps: {
          ...t.submittedSteps,
          [body.stepIndex]: body.transactionHash,
        },
        reportedTxHashes: [
          ...new Set([...t.reportedTxHashes, body.transactionHash]),
        ],
        verifiedTxHashes: [
          ...new Set([...t.verifiedTxHashes, body.transactionHash]),
        ],
      };
    });
    return publicTransfer(updated);
  });
  app.get("/api/transfers", async (req) => {
    const current = await session(req);
    parseInput(z.object({}).strict(), req.query);
    return {
      transfers: (
        await store.list<Transfer>("transfers", owner(current), 50)
      ).map(publicTransfer),
    };
  });
  app.get("/api/transfers/:id", async (req) => {
    const current = await session(req);
    const { id } = parseInput(idParam, req.params);
    const item = await ownedTransfer(id, current);
    if (
      ["success", "refund"].includes(item.status) ||
      !item.verifiedTxHashes.length ||
      item.updatedAt > now() - 4000
    )
      return publicTransfer(item);
    await limit(`status:${owner(current)}`, 45);
    const status = await relay.status(item.network, item.relayRequestId);
    if (
      status.originChainId &&
      status.originChainId !== item.transactions[0]?.chainId
    )
      throw new AppError(
        502,
        "STATUS_MISMATCH",
        "Provider status network does not match this transfer.",
      );
    const targetChain = item.summary.currencyOut.chainId;
    if (status.destinationChainId && status.destinationChainId !== targetChain)
      throw new AppError(
        502,
        "STATUS_MISMATCH",
        "Provider status destination does not match this transfer.",
      );
    const nextStatus =
      status.status === "success" && status.txHashes.length === 0
        ? "pending"
        : status.status === "refund" && status.txHashes.length === 0
          ? "pending"
          : status.status;
    return publicTransfer(
      await updateTransfer(id, current, (t) =>
        ["success", "refund"].includes(t.status)
          ? t
          : {
              ...t,
              status: nextStatus,
              txHashes: status.txHashes,
              inTxHashes: status.inTxHashes,
            },
      ),
    );
  });
  app.post("/api/balances", async (req) => {
    const current = await session(req, true);
    await limit(`balance:${owner(current)}`, 20);
    const body = parseInput(
      z
        .object({
          network: networkSchema,
          chainId: chainIdSchema,
          currencies: z.array(addressSchema).min(1).max(20),
        })
        .strict(),
      req.body,
    );
    checkChain(body.network, body.chainId);
    const chains = await relay.chains(body.network);
    const chain = chains.find((c) => c.id === body.chainId);
    if (!chain)
      throw new AppError(
        400,
        "CHAIN_UNAVAILABLE",
        "This chain is unavailable.",
      );
    const addresses = [...new Set(body.currencies)];
    const currencies = await Promise.all(
      addresses.map(async (address) => {
        if (
          chain.currency &&
          address.toLowerCase() === chain.currency.address.toLowerCase()
        )
          return chain.currency;
        const result = await relay.currencies(body.network, {
          chainIds: [body.chainId],
          address,
          limit: 1,
        });
        const token = result.find(
          (c) =>
            c.chainId === body.chainId &&
            c.address.toLowerCase() === address.toLowerCase(),
        );
        if (!token)
          throw new AppError(
            400,
            "TOKEN_UNAVAILABLE",
            "A token is unavailable on this network.",
          );
        return token;
      }),
    );
    return rpc.balance(body.chainId, current.address, currencies);
  });
  app.setErrorHandler((error, req, reply) => {
    const statusCode =
      error &&
      typeof error === "object" &&
      "statusCode" in error &&
      typeof error.statusCode === "number"
        ? error.statusCode
        : 500;
    const safe =
      error instanceof AppError
        ? error
        : statusCode === 413
          ? new AppError(
              413,
              "BODY_TOO_LARGE",
              "Request body exceeds the limit.",
            )
          : statusCode < 500
            ? new AppError(
                statusCode,
                "INVALID_REQUEST",
                "The request could not be processed.",
              )
            : new AppError(
                500,
                "INTERNAL_ERROR",
                "The service could not complete the request. Please retry.",
              );
    if (safe.retryAfterSeconds)
      reply.header("Retry-After", safe.retryAfterSeconds);
    req.log.warn({ code: safe.code, requestId: req.id }, "request rejected");
    reply.code(safe.status).send({
      error: { code: safe.code, message: safe.message, requestId: req.id },
    });
  });
  if (deps.serveStatic && existsSync(resolve("dist/index.html"))) {
    await app.register(staticFiles, {
      root: resolve("dist"),
      prefix: "/",
      cacheControl: true,
      maxAge: 0,
      setHeaders: (res, path) => {
        if (path.includes("/assets/"))
          res.header("Cache-Control", "public, max-age=31536000, immutable");
        else res.header("Cache-Control", "no-cache");
      },
    });
  }
  app.setNotFoundHandler((req, reply) => {
    if (
      !req.url.startsWith("/api/") &&
      deps.serveStatic &&
      req.method === "GET" &&
      existsSync(resolve("dist/index.html")) &&
      !req.url.split("?")[0].split("/").pop()?.includes(".")
    )
      return reply.sendFile("index.html");
    return reply.code(404).send({
      error: {
        code: "NOT_FOUND",
        message: "This endpoint does not exist.",
        requestId: req.id,
      },
    });
  });
  app.addHook("onClose", async () => store.close());
  return app;
}
