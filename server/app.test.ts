import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { privateKeyToAccount } from "viem/accounts";
import { randomUUID } from "node:crypto";
import { buildApp, type StoredQuote, type Transfer } from "./app.js";
import { readConfig } from "./config.js";
import { MemoryStore } from "./store.js";
import {
  RelayService,
  type QuoteDraft,
  type Currency,
  type IntentStatus,
} from "./relay.js";
import { RpcService } from "./rpc.js";
import { ZERO_ADDRESS } from "./validation.js";
import { AppError } from "./errors.js";
import { VaultsService } from "./vaults.js";
import { AccountResourcesService } from "./account-resources.js";
const account = privateKeyToAccount(`0x${"1".repeat(64)}`);
const other = privateKeyToAccount(`0x${"2".repeat(64)}`);
const target = "0x3333333333333333333333333333333333333333";
const hash = `0x${"a".repeat(64)}`;
const destinationHash = `0x${"b".repeat(64)}`;
const origin = "http://localhost:5173";
const native = (chainId: number): Currency => ({
  chainId,
  address: ZERO_ADDRESS,
  decimals: 18,
  symbol: "ETH",
  name: "Ethereum",
  vmType: "evm",
  metadata: { verified: true, isNative: true },
});
const input = {
  user: account.address,
  recipient: account.address,
  originChainId: 11155111,
  destinationChainId: 84532,
  originCurrency: ZERO_ADDRESS,
  destinationCurrency: ZERO_ADDRESS,
  amount: "1000000000000000",
  tradeType: "EXACT_INPUT" as const,
  slippageTolerance: "50",
  topupGas: false,
};
let app: Awaited<ReturnType<typeof buildApp>>,
  store: MemoryStore,
  clock: number,
  quote: ReturnType<typeof vi.fn>,
  status: ReturnType<typeof vi.fn>,
  verify: ReturnType<typeof vi.fn>,
  vaultPools: ReturnType<typeof vi.fn>,
  vaultPositions: ReturnType<typeof vi.fn>,
  appBalance: ReturnType<typeof vi.fn>,
  recoveryBalances: ReturnType<typeof vi.fn>,
  headers: Record<string, string>;
let config: ReturnType<typeof readConfig>;
async function signIn(who = account) {
  const challenge = await app.inject({
    method: "POST",
    url: "/api/auth/challenge",
    headers: { origin },
    payload: { address: who.address, chainId: 1 },
  });
  expect(challenge.statusCode).toBe(200);
  const c = challenge.json();
  const signed = await app.inject({
    method: "POST",
    url: "/api/auth/verify",
    headers: { origin },
    payload: {
      challengeId: c.challengeId,
      signature: await who.signMessage({ message: c.message }),
    },
  });
  expect(signed.statusCode).toBe(200);
  return {
    origin,
    cookie: String(signed.headers["set-cookie"]).split(";")[0],
    "x-csrf-token": signed.json().csrfToken,
  };
}
async function newQuote() {
  const result = await app.inject({
    method: "POST",
    url: "/api/quotes",
    headers,
    payload: { network: "testnet", quote: input },
  });
  expect(result.statusCode, result.body).toBe(200);
  return result.json();
}
async function prepare(id: string, key = randomUUID()) {
  return app.inject({
    method: "POST",
    url: `/api/quotes/${id}/prepare`,
    headers: { ...headers, "idempotency-key": key },
    payload: {},
  });
}
async function authorize(id: string, stepIndex = 0, requestHeaders = headers) {
  return app.inject({
    method: "POST",
    url: `/api/transfers/${id}/authorize`,
    headers: requestHeaders,
    payload: { stepIndex },
  });
}
beforeEach(async () => {
  clock = Date.now();
  store = new MemoryStore(() => clock);
  config = readConfig({
    NODE_ENV: "test",
    RELAY_API_KEY: "test-relay-key-not-real",
    ENABLE_EXECUTION: "true",
    ALLOWED_TRANSACTION_TARGETS_JSON: JSON.stringify({ "11155111": [target] }),
  });
  quote = vi.fn(
    async (network, q) =>
      ({
        network,
        input: q,
        relayRequestId: `0x${"c".repeat(64)}`,
        quote: {},
        expiresAt: clock + 30000,
        summary: {
          currencyIn: native(11155111),
          currencyOut: native(84532),
          amountIn: input.amount,
          amountOut: "990000000000000",
          minimumAmountOut: "985050000000000",
          amountInFormatted: "0.001",
          amountOutFormatted: "0.00099",
          minimumAmountOutFormatted: "0.00098505",
          feesUsd: null,
          timeEstimate: 10,
        },
        transactions: [
          {
            from: q.user,
            to: target,
            data: "0x",
            value: q.amount,
            chainId: 11155111,
            stepId: "deposit",
          },
        ],
        executable: true,
      }) satisfies QuoteDraft,
  );
  status = vi.fn(async (): Promise<IntentStatus> => ({
    status: "pending",
    txHashes: [],
    inTxHashes: [hash],
    originChainId: 11155111,
    destinationChainId: 84532,
  }));
  verify = vi.fn(async () => ({ verified: true }));
  const relay = {
    quote,
    status,
    chains: vi.fn(async () =>
      [11155111, 84532].map((id) => ({
        id,
        name: "Test network",
        currency: native(id),
        vmType: "evm",
        depositEnabled: true,
      })),
    ),
    currencies: vi.fn(async () => [native(11155111)]),
  } as unknown as RelayService;
  const rpc = {
    configuredChainIds: [11155111],
    readyFor: () => true,
    verifyTransaction: verify,
    balance: vi.fn(async () => ({ assets: [] })),
  } as unknown as RpcService;
  vaultPools = vi.fn(async () => ({
    pools: [],
    fetchedAt: clock,
    truncated: false,
    lifecycle: { depositsEnabled: false },
  }));
  vaultPositions = vi.fn(async (address: string) => ({
    address,
    positions: [],
    fetchedAt: clock,
    truncated: false,
  }));
  appBalance = vi.fn(async (address: string) => ({
    address,
    balances: [],
    fetchedAt: clock,
  }));
  recoveryBalances = vi.fn(async (address: string, ownerChainId: number) => ({
    address,
    ownerChainId,
    balances: [],
    hasMore: false,
    fetchedAt: clock,
  }));
  const vaults = {
    pools: vaultPools,
    positions: vaultPositions,
  } as unknown as VaultsService;
  const accountResources = {
    appBalance,
    recovery: recoveryBalances,
  } as unknown as AccountResourcesService;
  app = await buildApp({
    config,
    store,
    relay,
    rpc,
    vaults,
    accountResources,
    now: () => clock,
  });
  headers = await signIn();
});
afterEach(async () => {
  await app.close();
  vi.restoreAllMocks();
});
describe("backend HTTP integration", () => {
  it("returns the public vault catalog without requiring wallet sign-in", async () => {
    const response = await app.inject("/api/vaults");
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      pools: [],
      lifecycle: { depositsEnabled: false },
    });
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(vaultPools).toHaveBeenCalledTimes(1);
  });
  it.each([
    "/api/vaults?address=0x1111111111111111111111111111111111111111",
    "/api/vaults?url=https://untrusted.example",
    "/api/vaults?limit=1000",
  ])("rejects unexpected public vault query parameters: %s", async (url) => {
    const response = await app.inject(url);
    expect(response.statusCode).toBe(400);
    expect(vaultPools).not.toHaveBeenCalled();
  });
  it.each([
    "/api/vaults/positions",
    "/api/account/app-balance",
    "/api/account/recovery-balances?ownerChainId=1",
  ])("requires authentication for private provider data: %s", async (url) => {
    const response = await app.inject(url);
    expect(response.statusCode).toBe(401);
    expect(vaultPositions).not.toHaveBeenCalled();
    expect(appBalance).not.toHaveBeenCalled();
    expect(recoveryBalances).not.toHaveBeenCalled();
  });
  it("binds private provider requests to the signed-in wallet on every account", async () => {
    const otherHeaders = await signIn(other);
    for (const [requestHeaders, address] of [
      [headers, account.address],
      [otherHeaders, other.address],
    ] as const) {
      const positionResponse = await app.inject({
        url: "/api/vaults/positions",
        headers: requestHeaders,
      });
      expect(positionResponse.statusCode).toBe(200);
      expect(positionResponse.json().address).toBe(address);
      expect(vaultPositions).toHaveBeenLastCalledWith(address);
      const balanceResponse = await app.inject({
        url: "/api/account/app-balance",
        headers: requestHeaders,
      });
      expect(balanceResponse.statusCode).toBe(200);
      expect(balanceResponse.json().address).toBe(address);
      expect(appBalance).toHaveBeenLastCalledWith(address);
      const recoveryResponse = await app.inject({
        url: "/api/account/recovery-balances?ownerChainId=1",
        headers: requestHeaders,
      });
      expect(recoveryResponse.statusCode).toBe(200);
      expect(recoveryResponse.json()).toMatchObject({
        address,
        ownerChainId: 1,
      });
      expect(recoveryBalances).toHaveBeenLastCalledWith(address, 1);
    }
  });
  it.each([
    "/api/vaults/positions?address=0x3333333333333333333333333333333333333333",
    "/api/vaults/positions?url=https://untrusted.example",
    "/api/account/app-balance?address=0x3333333333333333333333333333333333333333",
    "/api/account/app-balance?url=https://untrusted.example",
    "/api/account/recovery-balances?ownerChainId=1&address=0x3333333333333333333333333333333333333333",
    "/api/account/recovery-balances?ownerChainId=1&url=https://untrusted.example",
  ])("rejects client-selected owner or upstream URL: %s", async (url) => {
    const response = await app.inject({ url, headers });
    expect(response.statusCode).toBe(400);
    expect(vaultPositions).not.toHaveBeenCalled();
    expect(appBalance).not.toHaveBeenCalled();
    expect(recoveryBalances).not.toHaveBeenCalled();
  });
  it.each([
    "",
    "0",
    "-1",
    "01",
    "1.0",
    "1e3",
    "9007199254740992",
    "12345678901234567",
  ])("rejects noncanonical or unsafe owner chain id %s", async (value) => {
    const response = await app.inject({
      url: `/api/account/recovery-balances?ownerChainId=${encodeURIComponent(value)}`,
      headers,
    });
    expect(response.statusCode).toBe(400);
    expect(recoveryBalances).not.toHaveBeenCalled();
  });
  it("requires a recovery owner chain instead of assuming the transaction network", async () => {
    const response = await app.inject({
      url: "/api/account/recovery-balances",
      headers,
    });
    expect(response.statusCode).toBe(400);
    expect(recoveryBalances).not.toHaveBeenCalled();
  });
  it("preserves safe provider failures and hides unexpected provider internals", async () => {
    appBalance.mockRejectedValueOnce(
      new AppError(
        503,
        "ACCOUNT_PROVIDER_UNAVAILABLE",
        "Account provider is unavailable.",
        20,
      ),
    );
    const unavailable = await app.inject({
      url: "/api/account/app-balance",
      headers,
    });
    expect(unavailable.statusCode).toBe(503);
    expect(unavailable.json().error.code).toBe("ACCOUNT_PROVIDER_UNAVAILABLE");
    expect(unavailable.headers["retry-after"]).toBe("20");
    vaultPools.mockRejectedValueOnce(new Error("secret-provider-debug-value"));
    const unexpected = await app.inject("/api/vaults");
    expect(unexpected.statusCode).toBe(500);
    expect(unexpected.json().error.code).toBe("INTERNAL_ERROR");
    expect(unexpected.body).not.toContain("secret-provider-debug-value");
  });

  it("returns capabilities, readiness and safe production headers", async () => {
    const c = await app.inject("/api/config");
    expect(c.statusCode).toBe(200);
    expect(c.json().capabilities.quotes).toBe(true);
    expect(c.json().networks.mainnet).toEqual([]);
    expect(c.body).not.toContain("test-relay-key");
    expect(c.headers["x-content-type-options"]).toBe("nosniff");
    expect(c.headers["cache-control"]).toBe("no-store");
    expect((await app.inject("/api/ready")).statusCode).toBe(200);
  });
  it("requires identity and CSRF for quotes", async () => {
    const a = await app.inject({
      method: "POST",
      url: "/api/quotes",
      headers: { origin },
      payload: { network: "testnet", quote: input },
    });
    expect(a.statusCode).toBe(401);
    const b = await app.inject({
      method: "POST",
      url: "/api/quotes",
      headers: { origin, cookie: headers.cookie },
      payload: { network: "testnet", quote: input },
    });
    expect(b.statusCode).toBe(403);
    expect(quote).not.toHaveBeenCalled();
  });
  it("rejects foreign origins even with valid session and CSRF", async () => {
    const r = await app.inject({
      method: "POST",
      url: "/api/quotes",
      headers: { ...headers, origin: "https://evil.example" },
      payload: { network: "testnet", quote: input },
    });
    expect(r.statusCode).toBe(403);
    expect(quote).not.toHaveBeenCalled();
  });
  it("does not trust spoofed forwarding headers for rate limits by default", async () => {
    for (let i = 0; i < 180; i++)
      await app.inject({
        url: "/api/config",
        headers: { "x-forwarded-for": `10.0.0.${i % 255}` },
      });
    const result = await app.inject({
      url: "/api/config",
      headers: { "x-forwarded-for": "192.168.1.7" },
    });
    expect(result.statusCode).toBe(429);
    expect(Number(result.headers["retry-after"])).toBeGreaterThan(0);
  });
  it.each([
    ["exponent notation", { amount: "1e18" }],
    ["numeric token amounts", { amount: 1e18 }],
    ["unknown fields", { unexpected: true }],
    ["negative amounts", { amount: "-1" }],
    ["empty amounts", { amount: "" }],
    ["zero amounts", { amount: "0" }],
    ["uint256 overflow", { amount: (2n ** 256n).toString() }],
    ["overlong amounts", { amount: "9".repeat(79) }],
  ] as const)(
    "rejects %s as a validation error, without calling the provider",
    async (_name, change) => {
      const r = await app.inject({
        method: "POST",
        url: "/api/quotes",
        headers,
        payload: { network: "testnet", quote: { ...input, ...change } },
      });
      expect(r.statusCode, r.body).toBe(400);
      expect(r.json().error.code).toBe("VALIDATION_ERROR");
      expect(quote).not.toHaveBeenCalled();
    },
  );
  it("rejects substitution of another signed-in wallet", async () => {
    const r = await app.inject({
      method: "POST",
      url: "/api/quotes",
      headers,
      payload: { network: "testnet", quote: { ...input, user: other.address } },
    });
    expect(r.statusCode, r.body).toBe(403);
    expect(r.json().error.code).toBe("WALLET_MISMATCH");
    expect(quote).not.toHaveBeenCalled();
  });
  it("blocks disabled mainnet and oversized request bodies", async () => {
    const a = await app.inject({
      method: "POST",
      url: "/api/quotes",
      headers,
      payload: { network: "mainnet", quote: input },
    });
    expect(a.statusCode).toBe(403);
    const b = await app.inject({
      method: "POST",
      url: "/api/auth/challenge",
      headers: { origin },
      payload: { large: "x".repeat(40000) },
    });
    expect(b.statusCode).toBe(413);
  });
  it("does not expose raw unexpected provider errors or secrets", async () => {
    quote.mockRejectedValueOnce(Error("sensitive upstream key=secret"));
    const r = await app.inject({
      method: "POST",
      url: "/api/quotes",
      headers,
      payload: { network: "testnet", quote: input },
    });
    expect(r.statusCode).toBe(500);
    expect(r.body).not.toContain("secret");
    expect(r.json().error.requestId).toBeTruthy();
  });
  it("preserves safe upstream failure and retry-after", async () => {
    quote.mockRejectedValueOnce(
      new AppError(429, "PROVIDER_RATE_LIMIT", "Provider busy.", 12),
    );
    const r = await app.inject({
      method: "POST",
      url: "/api/quotes",
      headers,
      payload: { network: "testnet", quote: input },
    });
    expect(r.statusCode).toBe(429);
    expect(r.headers["retry-after"]).toBe("12");
  });
  it("creates only one transfer for concurrent identical retries", async () => {
    const q = await newQuote(),
      key = randomUUID();
    const [a, b] = await Promise.all([prepare(q.id, key), prepare(q.id, key)]);
    expect(a.statusCode, a.body).toBe(200);
    expect(b.statusCode, b.body).toBe(200);
    expect(a.json().id).toBe(b.json().id);
    expect(
      (await store.list("transfers", account.address.toLowerCase())).length,
    ).toBe(1);
    const otherKey = await prepare(q.id);
    expect(otherKey.statusCode).toBe(409);
  });
  it("does not let an idempotent preparation replay bypass quote expiry", async () => {
    const q = await newQuote(),
      key = randomUUID();
    expect((await prepare(q.id, key)).statusCode).toBe(200);
    clock = q.expiresAt;
    const replay = await prepare(q.id, key);
    expect(replay.statusCode, replay.body).toBe(409);
    expect(replay.json().error.code).toBe("QUOTE_EXPIRED");
    expect(
      (await store.list("transfers", account.address.toLowerCase())).length,
    ).toBe(1);
  });
  it("does not let an idempotent preparation replay bypass disabled execution", async () => {
    const q = await newQuote(),
      key = randomUUID();
    expect((await prepare(q.id, key)).statusCode).toBe(200);
    config.enableExecution = false;
    const replay = await prepare(q.id, key);
    expect(replay.statusCode, replay.body).toBe(409);
    expect(replay.json().error.code).toBe("EXECUTION_DISABLED");
  });
  it("does not let an idempotent preparation replay bypass a changed route policy", async () => {
    const q = await newQuote(),
      key = randomUUID();
    expect((await prepare(q.id, key)).statusCode).toBe(200);
    const saved = await store.get<StoredQuote>("quotes", q.id);
    expect(saved).not.toBeNull();
    await store.set("quotes", q.id, {
      ...saved!,
      policyFingerprint: "a-previous-server-policy",
    });
    const replay = await prepare(q.id, key);
    expect(replay.statusCode, replay.body).toBe(409);
    expect(replay.json().error.code).toBe("POLICY_CHANGED");
  });
  it("rejects expired and unexecutable quotes", async () => {
    const q = await newQuote();
    clock += 30001;
    expect((await prepare(q.id)).statusCode).toBe(409);
    quote.mockImplementationOnce(async () => ({
      ...q,
      expiresAt: clock + 30000,
      executable: false,
      executionBlockReason: "Unsupported signing route.",
    }));
    const blocked = await newQuote();
    const r = await prepare(blocked.id);
    expect(r.statusCode).toBe(409);
    expect(r.json().error.code).toBe("EXECUTION_DISABLED");
  });
  it("isolates quotes, transfers and preferences by signed wallet", async () => {
    const q = await newQuote();
    await prepare(q.id);
    headers = await signIn(other);
    expect((await prepare(q.id)).statusCode).toBe(404);
    expect(
      (await app.inject({ url: `/api/transfers/${q.id}`, headers })).statusCode,
    ).toBe(404);
    expect(
      (await app.inject({ url: "/api/transfers", headers })).json().transfers,
    ).toEqual([]);
    expect(
      (await app.inject({ url: "/api/preferences", headers })).json().version,
    ).toBe(0);
  });
  it("atomically checks preference versions to prevent lost device updates", async () => {
    const p = {
      version: 0,
      settings: {
        theme: "dark",
        slippageBps: 50,
        gasTopup: false,
        network: "testnet",
      },
      favorites: [],
    };
    const a = await app.inject({
      method: "PUT",
      url: "/api/preferences",
      headers,
      payload: p,
    });
    expect(a.statusCode).toBe(200);
    expect(a.json().version).toBe(1);
    const b = await app.inject({
      method: "PUT",
      url: "/api/preferences",
      headers,
      payload: p,
    });
    expect(b.statusCode).toBe(409);
    const read = await app.inject({ url: "/api/preferences", headers });
    expect(read.json().settings.theme).toBe("dark");
    expect(read.body).not.toContain("owner");
  });
  it("does not accept arbitrary transaction hashes without RPC verification", async () => {
    const q = await newQuote();
    await prepare(q.id);
    verify.mockResolvedValueOnce({ verified: false, reason: "not_found" });
    let r = await app.inject({
      method: "POST",
      url: `/api/transfers/${q.id}/transactions`,
      headers,
      payload: { transactionHash: hash, stepIndex: 0 },
    });
    expect(r.statusCode).toBe(409);
    expect(r.json().error.code).toBe("TRANSACTION_NOT_FOUND");
    verify.mockResolvedValueOnce({ verified: false, reason: "mismatch" });
    r = await app.inject({
      method: "POST",
      url: `/api/transfers/${q.id}/transactions`,
      headers,
      payload: { transactionHash: hash, stepIndex: 0 },
    });
    expect(r.statusCode).toBe(400);
    expect((await store.get<any>("transfers", q.id)).verifiedTxHashes).toEqual(
      [],
    );
  });
  it("accepts a verified hash idempotently and prevents replacing a step", async () => {
    const q = await newQuote();
    await prepare(q.id);
    const payload = { transactionHash: hash, stepIndex: 0 };
    for (let i = 0; i < 2; i++) {
      const r = await app.inject({
        method: "POST",
        url: `/api/transfers/${q.id}/transactions`,
        headers,
        payload,
      });
      expect(r.statusCode, r.body).toBe(200);
      expect(r.json().verifiedTxHashes).toEqual([hash]);
    }
    expect(verify).toHaveBeenCalledTimes(1);
    const r = await app.inject({
      method: "POST",
      url: `/api/transfers/${q.id}/transactions`,
      headers,
      payload: { ...payload, transactionHash: destinationHash },
    });
    expect(r.statusCode).toBe(409);
  });
  it("authorizes only the saved unsubmitted transaction and returns server timing", async () => {
    const q = await newQuote();
    const prepared = await prepare(q.id);
    expect(prepared.statusCode).toBe(200);
    clock += 1000;
    const response = await authorize(q.id);
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json()).toEqual({
      transaction: prepared.json().transactions[0],
      expiresAt: q.expiresAt,
      serverTime: clock,
    });
    expect(verify).not.toHaveBeenCalled();
  });
  it("reserves an authorized step once and rejects repeated claims from another device", async () => {
    const q = await newQuote();
    await prepare(q.id);
    const authorizationTime = clock;
    const first = await authorize(q.id);
    expect(first.statusCode, first.body).toBe(200);
    const secondDevice = await signIn();
    clock += 15000;
    const repeated = await authorize(q.id, 0, secondDevice);
    expect(repeated.statusCode, repeated.body).toBe(409);
    expect(repeated.json().error.code).toBe("STEP_ALREADY_AUTHORIZED");
    const saved = await store.get<Transfer>("transfers", q.id);
    expect(saved?.authorizedSteps).toEqual({ "0": authorizationTime });
    expect(saved?.submittedSteps).toEqual({});
    expect(verify).not.toHaveBeenCalled();
  });
  it("grants exactly one concurrent authorization across devices with an atomic reservation", async () => {
    const q = await newQuote();
    await prepare(q.id);
    const secondDevice = await signIn();
    const compareAndSet = store.compareAndSet.bind(store);
    let release!: () => void;
    let writes = 0;
    const bothReady = new Promise<void>((resolve) => {
      release = resolve;
    });
    vi.spyOn(store, "compareAndSet").mockImplementation(async (...args) => {
      // Force both requests to read the same transfer version before either writes.
      if (args[0] === "transfers" && ++writes <= 2) {
        if (writes === 2) release();
        await bothReady;
      }
      return compareAndSet(...args);
    });
    const results = await Promise.all([
      authorize(q.id),
      authorize(q.id, 0, secondDevice),
    ]);
    expect(results.map((r) => r.statusCode).sort()).toEqual([200, 409]);
    expect(results.find((r) => r.statusCode === 409)?.json().error.code).toBe(
      "STEP_ALREADY_AUTHORIZED",
    );
    const saved = await store.get<Transfer>("transfers", q.id);
    expect(saved?.authorizedSteps).toEqual({ "0": clock });
    expect(saved?.version).toBe(2);
    expect(writes).toBe(2);
    expect(verify).not.toHaveBeenCalled();
  });
  it("recovers a broadcast hash after reservation, delayed indexing, expiry and disabled execution", async () => {
    const q = await newQuote();
    await prepare(q.id);
    expect((await authorize(q.id)).statusCode).toBe(200);
    const payload = { transactionHash: hash, stepIndex: 0 };
    verify.mockResolvedValueOnce({ verified: false, reason: "not_found" });
    const delayed = await app.inject({
      method: "POST",
      url: `/api/transfers/${q.id}/transactions`,
      headers,
      payload,
    });
    expect(delayed.statusCode, delayed.body).toBe(409);
    expect(delayed.json().error.code).toBe("TRANSACTION_NOT_FOUND");
    const blocked = await authorize(q.id);
    expect(blocked.json().error.code).toBe("STEP_ALREADY_AUTHORIZED");
    clock = q.expiresAt + 60000;
    config.enableExecution = false;
    const recovered = await app.inject({
      method: "POST",
      url: `/api/transfers/${q.id}/transactions`,
      headers,
      payload,
    });
    expect(recovered.statusCode, recovered.body).toBe(200);
    expect(recovered.json().submittedSteps).toEqual({ "0": hash });
    expect(recovered.json().verifiedTxHashes).toEqual([hash]);
    const retried = await app.inject({
      method: "POST",
      url: `/api/transfers/${q.id}/transactions`,
      headers,
      payload,
    });
    expect(retried.statusCode, retried.body).toBe(200);
    expect(retried.json().verifiedTxHashes).toEqual([hash]);
    expect(verify).toHaveBeenCalledTimes(2);
    const saved = await store.get<Transfer>("transfers", q.id);
    expect(Object.keys(saved?.authorizedSteps ?? {})).toEqual(["0"]);
  });
  it("requires a signed session and CSRF before transaction authorization", async () => {
    const q = await newQuote();
    await prepare(q.id);
    const anonymous = await authorize(q.id, 0, { origin });
    expect(anonymous.statusCode).toBe(401);
    const noCsrf = await authorize(q.id, 0, { origin, cookie: headers.cookie });
    expect(noCsrf.statusCode).toBe(403);
    expect(noCsrf.json().error.code).toBe("CSRF_REJECTED");
    const invalidCsrf = await authorize(q.id, 0, {
      ...headers,
      "x-csrf-token": "é".repeat(64),
    });
    expect(invalidCsrf.statusCode).toBe(403);
    expect(invalidCsrf.json().error.code).toBe("CSRF_REJECTED");
  });
  it("never authorizes a transfer owned by a different signed wallet", async () => {
    const q = await newQuote();
    await prepare(q.id);
    headers = await signIn(other);
    const response = await authorize(q.id);
    expect(response.statusCode, response.body).toBe(404);
    expect(response.body).not.toContain(target);
  });
  it("rejects authorization at the quote expiry boundary", async () => {
    const q = await newQuote();
    await prepare(q.id);
    clock = q.expiresAt;
    const response = await authorize(q.id);
    expect(response.statusCode, response.body).toBe(409);
    expect(response.json().error.code).toBe("QUOTE_EXPIRED");
  });
  it("rejects authorization after execution is disabled", async () => {
    const q = await newQuote();
    await prepare(q.id);
    config.enableExecution = false;
    const response = await authorize(q.id);
    expect(response.statusCode, response.body).toBe(409);
    expect(response.json().error.code).toBe("EXECUTION_DISABLED");
  });
  it("rejects authorization if the saved quote no longer matches route policy", async () => {
    const q = await newQuote();
    await prepare(q.id);
    const saved = await store.get<StoredQuote>("quotes", q.id);
    expect(saved).not.toBeNull();
    await store.set("quotes", q.id, {
      ...saved!,
      policyFingerprint: "a-previous-server-policy",
    });
    const response = await authorize(q.id);
    expect(response.statusCode, response.body).toBe(409);
    expect(response.json().error.code).toBe("POLICY_CHANGED");
  });
  it("rejects authorization if the reviewed quote is no longer available", async () => {
    const q = await newQuote();
    await prepare(q.id);
    await store.delete("quotes", q.id);
    const response = await authorize(q.id);
    expect(response.statusCode, response.body).toBe(404);
  });
  it("rejects authorization of an already recorded transaction step", async () => {
    const q = await newQuote();
    await prepare(q.id);
    const tracked = await app.inject({
      method: "POST",
      url: `/api/transfers/${q.id}/transactions`,
      headers,
      payload: { transactionHash: hash, stepIndex: 0 },
    });
    expect(tracked.statusCode, tracked.body).toBe(200);
    const response = await authorize(q.id);
    expect(response.statusCode, response.body).toBe(409);
    expect(response.json().error.code).toBe("STEP_ALREADY_RECORDED");
  });
  it("rejects missing or substituted transaction steps during authorization", async () => {
    const q = await newQuote();
    await prepare(q.id);
    const missing = await authorize(q.id, 1);
    expect(missing.statusCode, missing.body).toBe(400);
    const substituted = await app.inject({
      method: "POST",
      url: `/api/transfers/${q.id}/authorize`,
      headers,
      payload: { stepIndex: 0, transaction: { to: other.address, value: "1" } },
    });
    expect(substituted.statusCode, substituted.body).toBe(400);
    expect(substituted.json().error.code).toBe("VALIDATION_ERROR");
  });
  it("requires provider destination hashes before displaying settlement", async () => {
    const q = await newQuote();
    await prepare(q.id);
    await app.inject({
      method: "POST",
      url: `/api/transfers/${q.id}/transactions`,
      headers,
      payload: { transactionHash: hash, stepIndex: 0 },
    });
    clock += 5000;
    status.mockResolvedValueOnce({
      status: "success",
      txHashes: [],
      inTxHashes: [hash],
    });
    let r = await app.inject({ url: `/api/transfers/${q.id}`, headers });
    expect(r.json().status).toBe("pending");
    clock += 5000;
    status.mockResolvedValueOnce({
      status: "success",
      txHashes: [destinationHash],
      inTxHashes: [hash],
    });
    r = await app.inject({ url: `/api/transfers/${q.id}`, headers });
    expect(r.json().status).toBe("success");
    expect(r.json().txHashes).toEqual([destinationHash]);
  });
  it("keeps failure nonterminal and rejects foreign status network", async () => {
    const q = await newQuote();
    await prepare(q.id);
    await app.inject({
      method: "POST",
      url: `/api/transfers/${q.id}/transactions`,
      headers,
      payload: { transactionHash: hash, stepIndex: 0 },
    });
    clock += 5000;
    status.mockResolvedValueOnce({
      status: "failure",
      txHashes: [],
      inTxHashes: [hash],
    });
    expect(
      (await app.inject({ url: `/api/transfers/${q.id}`, headers })).json()
        .status,
    ).toBe("failure");
    clock += 5000;
    status.mockResolvedValueOnce({
      status: "success",
      txHashes: [destinationHash],
      inTxHashes: [hash],
      destinationChainId: 1,
    });
    const r = await app.inject({ url: `/api/transfers/${q.id}`, headers });
    expect(r.statusCode).toBe(502);
  });
  it("revokes the authenticated session on logout", async () => {
    const result = await app.inject({
      method: "POST",
      url: "/api/auth/logout",
      headers,
      payload: {},
    });
    expect(result.statusCode).toBe(200);
    expect(
      (await app.inject({ url: "/api/auth/session", headers })).json().user,
    ).toBe(null);
    expect(
      (await app.inject({ url: "/api/preferences", headers })).statusCode,
    ).toBe(401);
  });
  it("sets a Secure HttpOnly __session cookie compatible with Firebase Hosting in production", async () => {
    const productionOrigin = "https://hoplane.example";
    const productionConfig = readConfig({
      NODE_ENV: "production",
      APP_ORIGIN: productionOrigin,
      ALLOWED_ORIGINS: productionOrigin,
      FIREBASE_PROJECT_ID: "hoplane-tests",
    });
    const productionApp = await buildApp({
      config: productionConfig,
      store: new MemoryStore(() => clock),
      now: () => clock,
    });
    try {
      const challenge = await productionApp.inject({
        method: "POST",
        url: "/api/auth/challenge",
        headers: { origin: productionOrigin },
        payload: { address: account.address, chainId: 1 },
      });
      expect(challenge.statusCode, challenge.body).toBe(200);
      const c = challenge.json();
      const response = await productionApp.inject({
        method: "POST",
        url: "/api/auth/verify",
        headers: { origin: productionOrigin },
        payload: {
          challengeId: c.challengeId,
          signature: await account.signMessage({ message: c.message }),
        },
      });
      expect(response.statusCode, response.body).toBe(200);
      const cookie = String(response.headers["set-cookie"]);
      expect(cookie).toMatch(/^__session=[a-f0-9]{64};/);
      expect(cookie).toMatch(/; Secure(?:;|$)/);
      expect(cookie).toMatch(/; HttpOnly(?:;|$)/);
      expect(cookie).toMatch(/; SameSite=Lax(?:;|$)/i);
      expect(cookie).toContain("; Path=/");
      expect(cookie).not.toMatch(/Domain=/i);
      const sessionResponse = await productionApp.inject({
        url: "/api/auth/session",
        headers: { origin: productionOrigin, cookie: cookie.split(";")[0] },
      });
      expect(sessionResponse.json().user.address).toBe(account.address);
      expect(sessionResponse.headers["cache-control"]).toBe("no-store");
      expect(sessionResponse.headers["strict-transport-security"]).toBeTruthy();
    } finally {
      await productionApp.close();
    }
  });
  it("returns unknown API paths as JSON 404 without leaking frontend", async () => {
    const r = await app.inject("/api/does-not-exist");
    expect(r.statusCode).toBe(404);
    expect(r.json().error.code).toBe("NOT_FOUND");
  });
});
