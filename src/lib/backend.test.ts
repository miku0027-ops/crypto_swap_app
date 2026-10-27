// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  api,
  apiBase,
  authorizeTransfer,
  BackendError,
  clearBroadcast,
  clearUncertain,
  fromBaseUnits,
  isTransferSettled,
  markUncertain,
  messageHex,
  pendingBroadcasts,
  requireSuccessfulReceipt,
  safeExplorerUrl,
  saveBroadcast,
  submitPreparedTransaction,
  toBaseUnits,
  uncertainBroadcasts,
  validateTransaction,
} from "./backend";
import type { PreparedTransaction, Transfer } from "./backend";
const address = "0x1111111111111111111111111111111111111111",
  destination = "0x2222222222222222222222222222222222222222",
  hash = `0x${"a".repeat(64)}`;
const tx: PreparedTransaction = {
  from: address,
  to: destination,
  data: "0x",
  value: "1000000000000000000",
  chainId: 1,
  stepId: "deposit",
};
function provider(overrides: Record<string, unknown> = {}) {
  let chain = "0x1";
  const request = vi.fn(
    async ({ method, params }: { method: string; params?: unknown[] }) => {
      if (method in overrides) {
        const val = overrides[method];
        if (
          val instanceof Error ||
          (typeof val === "object" && val !== null && "code" in val)
        )
          throw val;
        return val;
      }
      if (method === "eth_accounts") return [address];
      if (method === "eth_chainId") return chain;
      if (method === "wallet_switchEthereumChain") {
        chain = (params?.[0] as { chainId: string }).chainId;
        return null;
      }
      if (method === "eth_estimateGas") return "0x5208";
      if (method === "eth_sendTransaction") return hash;
      if (method === "eth_getTransactionReceipt")
        return { transactionHash: hash, status: "0x1" };
      throw new Error(`Unexpected method ${method}`);
    },
  );
  return { request };
}
beforeEach(() => {
  localStorage.clear();
  vi.stubEnv("VITE_API_BASE_URL", "/api");
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});
describe("Exact token amount conversion", () => {
  it("preserves decimal precision beyond JavaScript safe integers", () => {
    expect(toBaseUnits("9007199254740993.123456", 6)).toBe(
      "9007199254740993123456",
    );
    expect(fromBaseUnits("9007199254740993123456", 6)).toBe(
      "9007199254740993.123456",
    );
  });
  it.each([
    "-1",
    "1e18",
    "0",
    "0.0000000",
    "Infinity",
    "NaN",
    "",
    ".5",
    "1.2345678",
  ])("rejects invalid or overprecise input %s", (value) => {
    expect(() => toBaseUnits(value, 6)).toThrow(BackendError);
  });
  it("formats zeros and whole tokens without discarding significant digits", () => {
    expect(fromBaseUnits("0", 18)).toBe("0");
    expect(fromBaseUnits("100000000", 6)).toBe("100");
    expect(fromBaseUnits("100", 0)).toBe("100");
    expect(toBaseUnits("0001.500", 6)).toBe("1500000");
  });
  it("rejects uint256 overflow and invalid decimals", () => {
    expect(() => toBaseUnits((2n ** 256n).toString(), 0)).toThrow();
    expect(() => toBaseUnits("1", 37)).toThrow();
    expect(fromBaseUnits("junk", 18)).toBe("Unavailable");
  });
});
describe("Backend requests", () => {
  it("uses credentialed requests and CSRF without exposing secrets", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ id: "quote" }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    expect(
      await api("/quotes", {
        body: { amount: "1" },
        csrfToken: "test-csrf",
        idempotencyKey: "request-id",
      }),
    ).toEqual({ id: "quote" });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/quotes",
      expect.objectContaining({
        credentials: "include",
        method: "POST",
        headers: expect.objectContaining({
          "X-CSRF-Token": "test-csrf",
          "Idempotency-Key": "request-id",
        }),
      }),
    );
  });
  it("preserves safe backend failure codes and request IDs", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              error: {
                code: "QUOTE_EXPIRED",
                message: "Request a fresh quote.",
                requestId: "trace-id",
              },
            }),
            { status: 409 },
          ),
      ),
    );
    await expect(api("/quotes")).rejects.toMatchObject({
      code: "QUOTE_EXPIRED",
      status: 409,
      requestId: "trace-id",
      message: "Request a fresh quote.",
    });
  });
  it("rejects HTML SPA fallback instead of treating it as config", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("<!doctype html>", { status: 200 })),
    );
    await expect(api("/config")).rejects.toMatchObject({
      code: "INVALID_RESPONSE",
    });
  });
  it("does not allow insecure remote backend configuration or protocol-relative paths", () => {
    vi.stubEnv("VITE_API_BASE_URL", "http://example.com/api");
    expect(() => apiBase()).toThrow();
    vi.stubEnv("VITE_API_BASE_URL", "//attacker.example/api");
    expect(() => apiBase()).toThrow();
  });
  it("reports timeout rather than indefinite spinner", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_url: string, init: RequestInit) =>
          new Promise((_, reject) =>
            init.signal?.addEventListener("abort", () =>
              reject(new DOMException("Abort", "AbortError")),
            ),
          ),
      ),
    );
    const p = api("/config", { timeoutMs: 20 });
    const assertion = expect(p).rejects.toMatchObject({ code: "TIMEOUT" });
    await vi.advanceTimersByTimeAsync(21);
    await assertion;
  });
});
describe("Wallet execution guardrails", () => {
  it("blocks signing and marker creation when server authorization is disabled", async () => {
    const p = provider();
    const marker = vi.fn();
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(
            JSON.stringify({
              error: {
                code: "EXECUTION_DISABLED",
                message: "Execution is disabled.",
              },
            }),
            { status: 503 },
          ),
        ),
    );
    await expect(
      submitPreparedTransaction(p, tx, address, Date.now() + 10000, Date.now, {
        authorize: () => authorizeTransfer("transfer-1", 0, "csrf-token", tx),
        beforeBroadcast: marker,
      }),
    ).rejects.toMatchObject({ code: "EXECUTION_DISABLED" });
    expect(marker).not.toHaveBeenCalled();
    expect(
      p.request.mock.calls.some(([r]) => r.method === "eth_sendTransaction"),
    ).toBe(false);
  });
  it("rejects authorization that substitutes a transaction target", async () => {
    const p = provider();
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(
            JSON.stringify({
              transaction: { ...tx, to: address },
              expiresAt: Date.now() + 10000,
              serverTime: Date.now(),
            }),
            { status: 200 },
          ),
        ),
    );
    await expect(
      submitPreparedTransaction(p, tx, address, Date.now() + 10000, Date.now, {
        authorize: () => authorizeTransfer("transfer-1", 0, "csrf-token", tx),
      }),
    ).rejects.toMatchObject({ code: "INVALID_AUTHORIZATION" });
    expect(
      p.request.mock.calls.some(([r]) => r.method === "eth_sendTransaction"),
    ).toBe(false);
  });
  it("rechecks the wallet after awaiting server authorization", async () => {
    const p = provider();
    const authorize = vi.fn(async () => {
      p.request.mockImplementation(async (r) =>
        r.method === "eth_accounts" ? [destination] : "0x1",
      );
    });
    await expect(
      submitPreparedTransaction(p, tx, address, Date.now() + 10000, Date.now, {
        authorize,
      }),
    ).rejects.toMatchObject({ code: "ACCOUNT_CHANGED" });
    expect(authorize).toHaveBeenCalledOnce();
    expect(
      p.request.mock.calls.some(([r]) => r.method === "eth_sendTransaction"),
    ).toBe(false);
  });
  it("checks account/network/estimate and persists marker immediately before one send", async () => {
    const p = provider();
    const marker = vi.fn(() => {
      expect(p.request.mock.calls.at(-1)?.[0].method).toBe("eth_chainId");
    });
    expect(
      await submitPreparedTransaction(p, tx, address, 10000, () => 100, {
        beforeBroadcast: marker,
      }),
    ).toBe(hash);
    expect(marker).toHaveBeenCalledTimes(1);
    const sends = p.request.mock.calls.filter(
      ([r]) => r.method === "eth_sendTransaction",
    );
    expect(sends).toHaveLength(1);
    expect(sends[0][0].params).toEqual([
      {
        from: address,
        to: destination,
        data: "0x",
        value: "0xde0b6b3a7640000",
        chainId: "0x1",
      },
    ]);
  });
  it("does not broadcast an expired quote", async () => {
    const p = provider();
    await expect(
      submitPreparedTransaction(p, tx, address, 99, () => 100),
    ).rejects.toMatchObject({ code: "QUOTE_EXPIRED" });
    expect(p.request).not.toHaveBeenCalled();
  });
  it("rejects a mismatched sender before calling the wallet", async () => {
    const p = provider();
    await expect(
      submitPreparedTransaction(
        p,
        { ...tx, from: destination },
        address,
        10000,
        () => 100,
      ),
    ).rejects.toMatchObject({ code: "INVALID_TRANSACTION" });
    expect(p.request).not.toHaveBeenCalled();
  });
  it("never sends if switching does not place the wallet on the required network", async () => {
    const p = provider({ eth_chainId: "0x2" });
    await expect(
      submitPreparedTransaction(p, tx, address, 10000, () => 100),
    ).rejects.toMatchObject({ code: "CHAIN_MISMATCH" });
    expect(
      p.request.mock.calls.some(([r]) => r.method === "eth_sendTransaction"),
    ).toBe(false);
  });
  it("rechecks the account after gas simulation", async () => {
    const p = provider();
    let accounts = 0;
    p.request.mockImplementation(async (r) => {
      if (r.method === "eth_accounts")
        return [++accounts >= 3 ? destination : address];
      if (r.method === "eth_chainId") return "0x1";
      if (r.method === "eth_estimateGas") return "0x5208";
      return hash;
    });
    await expect(
      submitPreparedTransaction(p, tx, address, 10000, () => 100),
    ).rejects.toMatchObject({ code: "ACCOUNT_CHANGED" });
    expect(
      p.request.mock.calls.some(([r]) => r.method === "eth_sendTransaction"),
    ).toBe(false);
  });
  it("rechecks expiry after asynchronous gas estimation", async () => {
    const p = provider();
    let time = 0;
    p.request.mockImplementation(async (r) => {
      if (r.method === "eth_accounts") return [address];
      if (r.method === "eth_chainId") return "0x1";
      if (r.method === "eth_estimateGas") {
        time = 1000;
        return "0x5208";
      }
      return hash;
    });
    await expect(
      submitPreparedTransaction(p, tx, address, 500, () => time),
    ).rejects.toMatchObject({ code: "QUOTE_EXPIRED" });
    expect(
      p.request.mock.calls.some(([r]) => r.method === "eth_sendTransaction"),
    ).toBe(false);
  });
  it("treats non-rejection submission failure as uncertain", async () => {
    const p = provider({
      eth_sendTransaction: new Error("Network disconnected"),
    });
    const marker = vi.fn();
    await expect(
      submitPreparedTransaction(p, tx, address, 10000, () => 100, {
        beforeBroadcast: marker,
      }),
    ).rejects.toMatchObject({ code: "UNCERTAIN_BROADCAST" });
    expect(marker).toHaveBeenCalledOnce();
  });
  it("recognizes explicit wallet rejection as safe to retry", async () => {
    const p = provider({
      eth_sendTransaction: { code: 4001, message: "Rejected" },
    });
    await expect(
      submitPreparedTransaction(p, tx, address, 10000, () => 100),
    ).rejects.toMatchObject({ code: "USER_REJECTED" });
  });
  it("treats malformed successful send return as uncertain", async () => {
    const p = provider({ eth_sendTransaction: "not-a-hash" });
    await expect(
      submitPreparedTransaction(p, tx, address, 10000, () => 100),
    ).rejects.toMatchObject({ code: "UNCERTAIN_BROADCAST" });
  });
  it("blocks broadcast if recovery marker cannot be persisted", async () => {
    const p = provider();
    await expect(
      submitPreparedTransaction(p, tx, address, 10000, () => 100, {
        beforeBroadcast: () => {
          throw new Error("Storage full");
        },
      }),
    ).rejects.toThrow("Storage full");
    expect(
      p.request.mock.calls.some(([r]) => r.method === "eth_sendTransaction"),
    ).toBe(false);
  });
  it("blocks subsequent step until the previous tx has a successful receipt", async () => {
    const p = provider({ eth_getTransactionReceipt: null });
    await expect(
      submitPreparedTransaction(p, tx, address, 10000, () => 100, {
        previousHash: hash,
      }),
    ).rejects.toMatchObject({ code: "PRIOR_TRANSACTION_PENDING" });
    expect(
      p.request.mock.calls.some(([r]) => r.method === "eth_sendTransaction"),
    ).toBe(false);
  });
  it("stops after a reverted prior transaction", async () => {
    await expect(
      requireSuccessfulReceipt(
        provider({
          eth_getTransactionReceipt: { transactionHash: hash, status: "0x0" },
        }),
        hash,
        1,
      ),
    ).rejects.toMatchObject({ code: "PRIOR_TRANSACTION_REVERTED" });
  });
  it("rejects arbitrary transaction data, amount and chain formats", () => {
    for (const invalid of [
      { ...tx, data: "https://bad" },
      { ...tx, value: "1e18" },
      { ...tx, chainId: NaN },
      { ...tx, to: "0x0" },
    ])
      expect(() => validateTransaction(invalid, address)).toThrow();
  });
});
describe("Recovery records and truthful receipt states", () => {
  it("persists uncertain requests across reload and clears only explicitly", () => {
    markUncertain({ transferId: "id-1", stepIndex: 0, address, createdAt: 1 });
    expect(uncertainBroadcasts(address)).toHaveLength(1);
    expect(uncertainBroadcasts(destination)).toHaveLength(0);
    clearUncertain("id-1", 0);
    expect(uncertainBroadcasts()).toEqual([]);
  });
  it("tracks known hashes without exposing them to a different account", () => {
    saveBroadcast({
      transferId: "id-1",
      stepIndex: 0,
      address,
      createdAt: 1,
      hash,
    });
    expect(pendingBroadcasts(address)).toHaveLength(1);
    expect(pendingBroadcasts(destination)).toHaveLength(0);
    clearBroadcast("id-1", 0);
    expect(pendingBroadcasts()).toEqual([]);
  });
  it("ignores corrupt storage data", () => {
    localStorage.setItem("hoplane.pending-broadcasts", "{}");
    localStorage.setItem("hoplane.uncertain-broadcasts", "null");
    expect(pendingBroadcasts()).toEqual([]);
    expect(uncertainBroadcasts()).toEqual([]);
  });
  it("does not infer success without a valid destination hash", () => {
    expect(
      isTransferSettled({
        status: "success",
        txHashes: [],
      } as unknown as Transfer),
    ).toBe(false);
    expect(
      isTransferSettled({
        status: "success",
        txHashes: ["invalid"],
      } as unknown as Transfer),
    ).toBe(false);
    expect(
      isTransferSettled({
        status: "success",
        txHashes: [hash],
      } as unknown as Transfer),
    ).toBe(true);
  });
  it("uses safe HTTPS explorer links only", () => {
    expect(safeExplorerUrl("javascript:alert(1)", hash)).toBeUndefined();
    expect(safeExplorerUrl("https://explorer.example", "bad")).toBeUndefined();
    expect(safeExplorerUrl("https://explorer.example/", hash)).toBe(
      `https://explorer.example/tx/${hash}`,
    );
  });
  it("encodes sign-in messages without losing unicode", () => {
    expect(messageHex("Hi ✓")).toBe("0x486920e29c93");
  });
});
