// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSiweMessage } from "viem/siwe";
import { connectWalletSession, messageHex, type Session } from "./backend";

const address = "0x1111111111111111111111111111111111111111";
const otherAddress = "0x2222222222222222222222222222222222222222";
const clock = Date.now();
const statement = "Sign in to Hoplane. This signature does not authorize any transfer of funds.";
const signature = `0x${"a".repeat(130)}`;
const challengeId = "12345678-1234-4123-8123-123456789012";
const csrfToken = "b".repeat(64);

function challenge(overrides: Partial<Parameters<typeof createSiweMessage>[0]> = {}) {
  const expirationTime = overrides.expirationTime ?? new Date(clock + 300_000);
  return {
    challengeId,
    expiresAt: expirationTime.getTime(),
    message: createSiweMessage({
      address,
      chainId: 1,
      domain: window.location.host,
      uri: window.location.origin,
      version: "1",
      nonce: "0123456789abcdef0123456789abcdef",
      issuedAt: new Date(clock),
      expirationTime,
      statement,
      ...overrides,
    }),
  };
}

const session: Session = {
  user: { address },
  csrfToken,
  expiresAt: clock + 86_400_000,
};

function response(data: unknown) {
  return new Response(JSON.stringify(data), { headers: { "Content-Type": "application/json" } });
}

function backend(overrides: Record<string, unknown | (() => Promise<Response>)> = {}) {
  const defaults: Record<string, unknown> = {
    "/api/config": { authChainId: 1, serverTime: clock },
    "/api/auth/challenge": challenge(),
    "/api/auth/verify": session,
    "/api/auth/logout": { ok: true },
  };
  const fetcher = vi.fn(async (input: string, _init?: RequestInit) => {
    const value = input in overrides ? overrides[input] : defaults[input];
    if (typeof value === "function") return value();
    if (value === undefined) throw new Error(`Unexpected API endpoint: ${input}`);
    return response(value);
  });
  vi.stubGlobal("fetch", fetcher);
  return fetcher;
}

function wallet(overrides: Record<string, unknown | (() => Promise<unknown>)> = {}) {
  return {
    request: vi.fn(async ({ method }: { method: string; params?: unknown[] }) => {
      if (method in overrides) {
        const value = overrides[method];
        return typeof value === "function" ? value() : value;
      }
      if (method === "eth_requestAccounts" || method === "eth_accounts") return [address];
      if (method === "personal_sign") return signature;
      throw new Error(`Unexpected wallet method: ${method}`);
    }),
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

beforeEach(() => {
  vi.stubEnv("VITE_API_BASE_URL", "/api");
  vi.spyOn(Date, "now").mockReturnValue(clock);
  vi.spyOn(performance, "now").mockReturnValue(0);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("Wallet session sign-in", () => {
  it("checks the backend first and signs only the validated SIWE challenge", async () => {
    const fetcher = backend();
    const provider = wallet();
    await expect(connectWalletSession(provider)).resolves.toEqual(session);
    expect(fetcher.mock.invocationCallOrder[0]).toBeLessThan(provider.request.mock.invocationCallOrder[0]);
    expect(provider.request.mock.calls.map(([args]) => args.method)).toEqual([
      "eth_requestAccounts", "eth_accounts", "personal_sign", "eth_accounts", "eth_accounts",
    ]);
    expect(provider.request).toHaveBeenCalledWith({
      method: "personal_sign",
      params: [messageHex(challenge().message), address],
    });
    const challengeRequest = fetcher.mock.calls.find(([path]) => path.endsWith("/challenge"))![1]!;
    expect(JSON.parse(challengeRequest.body as string)).toEqual({ address, chainId: 1 });
    const verifyRequest = fetcher.mock.calls.find(([path]) => path.endsWith("/verify"))![1]!;
    expect(JSON.parse(verifyRequest.body as string)).toEqual({ challengeId, signature });
    expect(verifyRequest.credentials).toBe("include");
  });

  it("does not prompt a wallet when the backend is unavailable", async () => {
    backend({ "/api/config": async () => new Response("<!doctype html>Preview") });
    const provider = wallet();
    await expect(connectWalletSession(provider)).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
    expect(provider.request).not.toHaveBeenCalled();
  });

  it.each([null, {}, { authChainId: 0 }, { authChainId: -1 }, { authChainId: 1.5 }, { authChainId: "1" }])(
    "rejects an invalid sign-in configuration before wallet access: %j", async (config) => {
      backend({ "/api/config": config });
      const provider = wallet();
      await expect(connectWalletSession(provider)).rejects.toMatchObject({ code: "INVALID_CONFIG" });
      expect(provider.request).not.toHaveBeenCalled();
    },
  );

  it.each([{ accounts: [] }, { accounts: ["not-an-address"] }, { accounts: [`0x${"0".repeat(40)}`] }])("rejects invalid selected wallet accounts: %j", async ({ accounts }) => {
    const fetcher = backend();
    const provider = wallet({ eth_requestAccounts: accounts });
    await expect(connectWalletSession(provider)).rejects.toMatchObject({ code: "INVALID_ADDRESS" });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["another origin", { uri: "https://other.example" }],
    ["another domain", { domain: "other.example" }],
    ["another wallet", { address: otherAddress }],
    ["another chain", { chainId: 10 }],
    ["a funds statement", { statement: "Approve a transfer of all tokens." }],
    ["extra resources", { resources: ["https://other.example/approval"] }],
  ] satisfies [string, Partial<Parameters<typeof createSiweMessage>[0]>][])("does not sign a challenge for %s", async (_label, fields) => {
    backend({ "/api/auth/challenge": challenge(fields) });
    const provider = wallet();
    await expect(connectWalletSession(provider)).rejects.toMatchObject({ code: "INVALID_CHALLENGE" });
    expect(provider.request).toHaveBeenCalledTimes(1);
  });

  it("rejects unparsed extra text after an otherwise valid challenge", async () => {
    const value = challenge();
    backend({ "/api/auth/challenge": { ...value, message: `${value.message}\nTransfer approval` } });
    const provider = wallet();
    await expect(connectWalletSession(provider)).rejects.toMatchObject({ code: "INVALID_CHALLENGE" });
    expect(provider.request).toHaveBeenCalledTimes(1);
  });

  it.each([
    { issuedAt: new Date(clock - 300_001), expirationTime: new Date(clock - 1) },
    { issuedAt: new Date(clock), expirationTime: new Date(clock + 300_001) },
    { issuedAt: new Date(clock + 60_000), expirationTime: new Date(clock + 360_000) },
  ])("rejects expired or invalid challenge lifetimes", async (fields) => {
    backend({ "/api/auth/challenge": challenge(fields) });
    const provider = wallet();
    await expect(connectWalletSession(provider)).rejects.toMatchObject({ code: "CHALLENGE_EXPIRED" });
    expect(provider.request).toHaveBeenCalledTimes(1);
  });

  it("rejects a malformed challenge identifier", async () => {
    backend({ "/api/auth/challenge": { ...challenge(), challengeId: "not-a-uuid" } });
    const provider = wallet();
    await expect(connectWalletSession(provider)).rejects.toMatchObject({ code: "INVALID_CHALLENGE" });
    expect(provider.request).toHaveBeenCalledTimes(1);
  });

  it("uses a bounded server clock when the device clock is ahead", async () => {
    vi.mocked(Date.now).mockReturnValue(clock + 60 * 60 * 1000);
    backend();
    await expect(connectWalletSession(wallet())).resolves.toEqual(session);
  });

  it("ignores an unsafe server clock", async () => {
    backend({ "/api/config": { authChainId: 1, serverTime: Number.MAX_SAFE_INTEGER } });
    await expect(connectWalletSession(wallet())).resolves.toEqual(session);
  });

  it("does not sign when the account changes while the challenge is loading", async () => {
    const pending = deferred<Response>();
    const fetcher = backend({ "/api/auth/challenge": () => pending.promise });
    const provider = wallet({ eth_accounts: [otherAddress] });
    const result = connectWalletSession(provider);
    const assertion = expect(result).rejects.toMatchObject({ code: "ACCOUNT_CHANGED" });
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
    pending.resolve(response(challenge()));
    await assertion;
    expect(provider.request.mock.calls.some(([args]) => args.method === "personal_sign")).toBe(false);
  });

  it("does not verify when the account changes while a signature is pending", async () => {
    const fetcher = backend();
    let checks = 0;
    const provider = wallet({ eth_accounts: async () => [++checks === 1 ? address : otherAddress] });
    await expect(connectWalletSession(provider)).rejects.toMatchObject({ code: "ACCOUNT_CHANGED" });
    expect(fetcher.mock.calls.some(([path]) => path.endsWith("/verify"))).toBe(false);
  });

  it("revokes a session if the account changed during backend verification", async () => {
    const fetcher = backend();
    let checks = 0;
    const provider = wallet({ eth_accounts: async () => [++checks < 3 ? address : otherAddress] });
    await expect(connectWalletSession(provider)).rejects.toMatchObject({ code: "ACCOUNT_CHANGED" });
    expect(fetcher).toHaveBeenLastCalledWith("/api/auth/logout", expect.objectContaining({
      method: "POST", headers: expect.objectContaining({ "X-CSRF-Token": csrfToken }),
    }));
  });

  it("does not prompt or contact the backend for an already cancelled flow", async () => {
    const fetcher = backend();
    const controller = new AbortController();
    controller.abort();
    const provider = wallet();
    await expect(connectWalletSession(provider, { signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
    expect(fetcher).not.toHaveBeenCalled();
    expect(provider.request).not.toHaveBeenCalled();
  });

  it("does not create a challenge after cancellation during account selection", async () => {
    const fetcher = backend();
    const pending = deferred<string[]>();
    const provider = wallet({ eth_requestAccounts: () => pending.promise });
    const controller = new AbortController();
    const result = connectWalletSession(provider, { signal: controller.signal });
    const assertion = expect(result).rejects.toMatchObject({ name: "AbortError" });
    await vi.waitFor(() => expect(provider.request).toHaveBeenCalledTimes(1));
    controller.abort();
    pending.resolve([address]);
    await assertion;
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("stops before signing if unmounted during the challenge request", async () => {
    const pending = deferred<Response>();
    const fetcher = backend({ "/api/auth/challenge": () => pending.promise });
    const provider = wallet();
    const controller = new AbortController();
    const result = connectWalletSession(provider, { signal: controller.signal });
    const assertion = expect(result).rejects.toMatchObject({ name: "AbortError" });
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
    controller.abort();
    pending.resolve(response(challenge()));
    await assertion;
    expect(provider.request).toHaveBeenCalledTimes(1);
  });

  it("receives and revokes a new session if unmounted during verification", async () => {
    const pending = deferred<Response>();
    const fetcher = backend({ "/api/auth/verify": () => pending.promise });
    const controller = new AbortController();
    const result = connectWalletSession(wallet(), { signal: controller.signal });
    const assertion = expect(result).rejects.toMatchObject({ name: "AbortError" });
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(3));
    controller.abort();
    const verifySignal = fetcher.mock.calls[2][1]!.signal!;
    expect(verifySignal.aborted).toBe(false);
    pending.resolve(response(session));
    await assertion;
    expect(fetcher.mock.calls[3][0]).toBe("/api/auth/logout");
    expect(fetcher.mock.calls[3][1]!.signal!.aborted).toBe(false);
  });

  it.each(["eth_requestAccounts", "personal_sign"])("reports explicit rejection of %s as cancelled sign-in", async (method) => {
    backend();
    const provider = wallet({ [method]: async () => { throw { code: 4001 }; } });
    await expect(connectWalletSession(provider)).rejects.toMatchObject({ code: "USER_REJECTED", message: expect.stringContaining("sign-in was cancelled") });
  });

  it("does not verify a malformed signature", async () => {
    const fetcher = backend();
    await expect(connectWalletSession(wallet({ personal_sign: "0x1234" }))).rejects.toMatchObject({ code: "INVALID_SIGNATURE" });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("does not verify a challenge that expired while signing", async () => {
    const fetcher = backend();
    const provider = wallet({ personal_sign: async () => {
      vi.mocked(performance.now).mockReturnValue(300_001);
      return signature;
    } });
    await expect(connectWalletSession(provider)).rejects.toMatchObject({ code: "CHALLENGE_EXPIRED" });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it.each([
    { ...session, user: { address: otherAddress } },
    { ...session, expiresAt: clock - 1 },
    { ...session, expiresAt: clock + 8 * 86_400_000 },
  ])("revokes malformed returned sessions with a usable CSRF token", async (invalid) => {
    const fetcher = backend({ "/api/auth/verify": invalid });
    await expect(connectWalletSession(wallet())).rejects.toMatchObject({ code: "INVALID_SESSION" });
    expect(fetcher.mock.calls.at(-1)![0]).toBe("/api/auth/logout");
  });

  it("rejects sessions without a valid CSRF token", async () => {
    backend({ "/api/auth/verify": { ...session, csrfToken: "bad-token" } });
    await expect(connectWalletSession(wallet())).rejects.toMatchObject({ code: "INVALID_SESSION" });
  });
});
