import { afterEach, describe, expect, it, vi } from "vitest";
import { RpcService } from "./rpc.js";
import type { BalanceCurrency, ExpectedTransaction } from "./rpc.js";

const wallet = "0x1111111111111111111111111111111111111111";
const target = "0x2222222222222222222222222222222222222222";
const token = "0x3333333333333333333333333333333333333333";
const hash = `0x${"ab".repeat(32)}`;
const native: BalanceCurrency = {
  address: "0x0000000000000000000000000000000000000000",
  symbol: "ETH",
  name: "Ethereum",
  decimals: 18,
};
const usdc: BalanceCurrency = {
  address: token,
  symbol: "USDC",
  name: "USD Coin",
  decimals: 6,
};
const expected: ExpectedTransaction = {
  from: wallet,
  to: target,
  data: "0xdeadbeef",
  value: "1000",
  chainId: 1,
};
const transaction = {
  hash,
  from: wallet,
  to: target,
  input: "0xdeadbeef",
  value: "0x3e8",
  chainId: "0x1",
  blockNumber: null,
};
type RpcRequest = {
  id: string;
  method: string;
  params: unknown[];
  jsonrpc: "2.0";
};
const response = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
function mockRpc(result: (request: RpcRequest) => unknown = () => "0x1") {
  return vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
    const calls = JSON.parse(init!.body as string) as RpcRequest[];
    return response(
      calls.map((request) => ({
        jsonrpc: "2.0",
        id: request.id,
        result: request.method === "eth_chainId" ? "0x1" : result(request),
      })),
    );
  });
}
afterEach(() => vi.useRealTimers());

describe("RpcService configuration and isolation", () => {
  it("allows only preconfigured chains and hides provider credentials in failures", async () => {
    const fetcher = vi.fn(async () => {
      throw Error("https://rpc.example/private-api-key");
    });
    const rpc = new RpcService(
      { 1: "https://rpc.example/private-api-key" },
      fetcher,
    );
    expect(rpc.configuredChainIds).toEqual([1]);
    expect(rpc.readyFor(1)).toBe(true);
    expect(rpc.readyFor(8453)).toBe(false);
    await expect(rpc.balance(8453, wallet, [native])).rejects.toMatchObject({
      code: "RPC_NOT_CONFIGURED",
    });
    expect(fetcher).not.toHaveBeenCalled();
    await expect(rpc.balance(1, wallet, [native])).rejects.toMatchObject({
      code: "RPC_UNAVAILABLE",
      message: "The network RPC could not be reached.",
    });
  });
  it.each([
    "http://rpc.example",
    "file:///etc/passwd",
    "https://user:pass@rpc.example",
    "https://rpc.example/#fragment",
    "not-a-url",
  ])("rejects unsafe endpoint %s", (url) => {
    expect(() => new RpcService({ 1: url })).toThrow();
  });
  it("requires explicit development authorization for loopback HTTP", () => {
    expect(() => new RpcService({ 1: "http://localhost:8545" })).toThrow();
    expect(
      () =>
        new RpcService({ 1: "http://localhost:8545" }, fetch, 8000, {
          allowLocalHttp: true,
        }),
    ).not.toThrow();
    expect(
      () =>
        new RpcService({ 1: "http://evil.example:8545" }, fetch, 8000, {
          allowLocalHttp: true,
        }),
    ).toThrow();
  });
  it("does not follow provider redirects", async () => {
    const fetcher = mockRpc();
    await new RpcService({ 1: "https://rpc.example" }, fetcher).balance(
      1,
      wallet,
      [native],
    );
    expect(fetcher.mock.calls[0][1]).toMatchObject({
      redirect: "error",
      credentials: "omit",
    });
  });
  it("rejects mismatched RPC chain IDs before reading balances", async () => {
    const fetcher = vi.fn(async (_url, init) =>
      response(
        JSON.parse(init.body).map((request: RpcRequest) => ({
          jsonrpc: "2.0",
          id: request.id,
          result: "0x89",
        })),
      ),
    );
    await expect(
      new RpcService({ 1: "https://rpc.example" }, fetcher).balance(1, wallet, [
        native,
      ]),
    ).rejects.toMatchObject({ code: "RPC_CHAIN_MISMATCH" });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});

describe("RpcService balances", () => {
  it("reads native and ERC20 values as integer strings and matches response IDs independently of order", async () => {
    const fetcher = vi.fn(async (_url, init) => {
      const calls = JSON.parse(init.body) as RpcRequest[];
      return response(
        calls
          .map((request) => ({
            jsonrpc: "2.0",
            id: request.id,
            result:
              request.method === "eth_chainId"
                ? "0x1"
                : request.method === "eth_getBalance"
                  ? "0xde0b6b3a7640000"
                  : `0x${1_250_001n.toString(16).padStart(64, "0")}`,
          }))
          .reverse(),
      );
    });
    const rpc = new RpcService({ 1: "https://rpc.example" }, fetcher, 8000, {
      now: () => 123456,
    });
    const result = await rpc.balance(1, wallet, [native, usdc]);
    expect(result).toMatchObject({
      chainId: 1,
      address: wallet,
      fetchedAt: 123456,
      assets: [
        { balance: "1000000000000000000", formatted: "1" },
        { balance: "1250001", formatted: "1.250001" },
      ],
    });
    const calls = JSON.parse(fetcher.mock.calls[1][1].body);
    expect(calls[1]).toMatchObject({
      method: "eth_call",
      params: [
        { to: token, data: `0x70a08231${wallet.slice(2).padStart(64, "0")}` },
        "latest",
      ],
    });
  });
  it("preserves token failures as unavailable, never as a zero balance", async () => {
    const fetcher = vi.fn(async (_url, init) =>
      response(
        (JSON.parse(init.body) as RpcRequest[]).map((request) =>
          request.method === "eth_call"
            ? {
                jsonrpc: "2.0",
                id: request.id,
                error: {
                  code: -32000,
                  message: "Private upstream details API_KEY=secret",
                },
              }
            : {
                jsonrpc: "2.0",
                id: request.id,
                result: request.method === "eth_chainId" ? "0x1" : "0x0",
              },
        ),
      ),
    );
    const result = await new RpcService(
      { 1: "https://rpc.example" },
      fetcher,
    ).balance(1, wallet, [native, usdc]);
    expect(result.assets[0].balance).toBe("0");
    expect(result.assets[1]).toMatchObject({
      balance: null,
      formatted: null,
      error: { code: "TOKEN_BALANCE_UNAVAILABLE" },
    });
    expect(JSON.stringify(result)).not.toContain("secret");
  });
  it.each(["0x", "0xzz", "1", "-1", `0x1${"0".repeat(64)}`, null])(
    "rejects malformed uint256 balance %s",
    async (value) => {
      const result = await new RpcService(
        { 1: "https://rpc.example" },
        mockRpc(() => value),
      ).balance(1, wallet, [native]);
      expect(result.assets[0]).toMatchObject({
        balance: null,
        error: { code: "INVALID_TOKEN_BALANCE" },
      });
    },
  );
  it("caps batches, validates addresses/metadata and rejects duplicate currencies before networking", async () => {
    const fetcher = mockRpc();
    const rpc = new RpcService({ 1: "https://rpc.example" }, fetcher);
    await expect(
      rpc.balance(1, "not-an-address", [native]),
    ).rejects.toMatchObject({ code: "INVALID_RPC_INPUT" });
    await expect(
      rpc.balance(1, wallet, Array(21).fill(native)),
    ).rejects.toMatchObject({ code: "INVALID_RPC_INPUT" });
    await expect(
      rpc.balance(1, wallet, [native, native]),
    ).rejects.toMatchObject({ code: "INVALID_RPC_INPUT" });
    await expect(
      rpc.balance(1, wallet, [{ ...native, decimals: 900 }]),
    ).rejects.toMatchObject({ code: "INVALID_RPC_INPUT" });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("single-flights and briefly caches chain identity verification", async () => {
    const fetcher = mockRpc();
    let now = 100;
    const rpc = new RpcService({ 1: "https://rpc.example" }, fetcher, 8000, {
      now: () => now,
    });
    await Promise.all([
      rpc.balance(1, wallet, [native]),
      rpc.balance(1, wallet, [usdc]),
    ]);
    const count = () =>
      fetcher.mock.calls
        .flatMap(([, init]) => JSON.parse(init!.body as string) as RpcRequest[])
        .filter((request) => request.method === "eth_chainId").length;
    expect(count()).toBe(1);
    now += 30_001;
    await rpc.balance(1, wallet, [native]);
    expect(count()).toBe(2);
  });
  it("rejects duplicate, foreign, or missing JSON-RPC IDs", async () => {
    for (const failure of ["duplicate", "foreign", "missing"]) {
      const fetcher = vi.fn(async (_url, init) => {
        const calls = JSON.parse(init.body) as RpcRequest[];
        if (calls[0].method === "eth_chainId")
          return response([{ jsonrpc: "2.0", id: calls[0].id, result: "0x1" }]);
        return response(
          calls
            .map((request, index) => ({
              jsonrpc: "2.0",
              id:
                failure === "duplicate"
                  ? calls[0].id
                  : failure === "foreign"
                    ? "foreign"
                    : request.id,
              result: "0x1",
            }))
            .slice(0, failure === "missing" ? 1 : 2),
        );
      });
      await expect(
        new RpcService({ 1: "https://rpc.example" }, fetcher).balance(
          1,
          wallet,
          [native, usdc],
        ),
      ).rejects.toMatchObject({ code: "RPC_INVALID_RESPONSE" });
    }
  });
  it("rejects protocol responses containing both result and error", async () => {
    const fetcher = vi.fn(async (_url, init) =>
      response(
        (JSON.parse(init.body) as RpcRequest[]).map((request) => ({
          jsonrpc: "2.0",
          id: request.id,
          result: "0x1",
          error: { code: -1, message: "bad" },
        })),
      ),
    );
    await expect(
      new RpcService({ 1: "https://rpc.example" }, fetcher).balance(1, wallet, [
        native,
      ]),
    ).rejects.toMatchObject({ code: "RPC_INVALID_RESPONSE" });
  });
});

describe("RpcService transaction verification", () => {
  it("matches exact prepared data without claiming confirmation or settlement", async () => {
    const result = await new RpcService(
      { 1: "https://rpc.example" },
      mockRpc(() => transaction),
    ).verifyTransaction(1, hash, expected);
    expect(result).toEqual({ verified: true });
    expect(result).not.toHaveProperty("confirmed");
  });
  it("accepts case differences in byte strings but does not compare addresses by substrings", async () => {
    const result = await new RpcService(
      { 1: "https://rpc.example" },
      mockRpc(() => ({
        ...transaction,
        hash: hash.toUpperCase().replace("0X", "0x"),
        input: "0xDEADBEEF",
      })),
    ).verifyTransaction(1, hash, expected);
    expect(result).toEqual({ verified: true });
  });
  it.each([
    { from: target },
    { to: wallet },
    { input: "0xbeef" },
    { value: "0x3e9" },
    { chainId: "0x89" },
    { hash: `0x${"ff".repeat(32)}` },
    { to: null },
    { value: "0x" },
  ])("rejects transaction mismatch %s", async (changes) => {
    const rpc = new RpcService(
      { 1: "https://rpc.example" },
      mockRpc(() => ({ ...transaction, ...changes })),
    );
    await expect(rpc.verifyTransaction(1, hash, expected)).resolves.toEqual({
      verified: false,
      reason: "mismatch",
    });
  });
  it("distinguishes propagation delay from mismatched transaction data", async () => {
    await expect(
      new RpcService(
        { 1: "https://rpc.example" },
        mockRpc(() => null),
      ).verifyTransaction(1, hash, expected),
    ).resolves.toEqual({ verified: false, reason: "not_found" });
  });
  it("rejects a transaction requested for the wrong chain before networking", async () => {
    const fetcher = mockRpc();
    await expect(
      new RpcService({ 1: "https://rpc.example" }, fetcher).verifyTransaction(
        1,
        hash,
        { ...expected, chainId: 137 },
      ),
    ).rejects.toMatchObject({ code: "INVALID_RPC_INPUT" });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it.each([
    { value: "-1" },
    { value: `${1n << 256n}` },
    { data: "0xabc" },
    { from: "bad" },
  ])("rejects invalid expected transaction fields %s", async (changes) => {
    await expect(
      new RpcService({ 1: "https://rpc.example" }, mockRpc()).verifyTransaction(
        1,
        hash,
        { ...expected, ...changes },
      ),
    ).rejects.toMatchObject({ code: "INVALID_RPC_INPUT" });
  });
});

describe("RpcService upstream failure boundaries", () => {
  it.each([
    [429, "RPC_RATE_LIMITED"],
    [500, "RPC_UNAVAILABLE"],
  ])("sanitizes HTTP %s failures", async (status, code) => {
    const fetcher = vi.fn(
      async () =>
        new Response("provider secret error details", {
          status: Number(status),
        }),
    );
    await expect(
      new RpcService({ 1: "https://rpc.example" }, fetcher).balance(1, wallet, [
        native,
      ]),
    ).rejects.toMatchObject({ code });
  });
  it("bounds responses with or without a content length", async () => {
    for (const headers of [
      { "content-length": "2000000" },
      {},
    ] as HeadersInit[]) {
      const fetcher = vi.fn(
        async () => new Response("a".repeat(1_048_577), { headers }),
      );
      await expect(
        new RpcService({ 1: "https://rpc.example" }, fetcher).balance(
          1,
          wallet,
          [native],
        ),
      ).rejects.toMatchObject({ code: "RPC_INVALID_RESPONSE" });
    }
  });
  it("returns a timeout rather than a raw aborted-network error", async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn(
      (_url: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("aborted", "AbortError")),
          );
        }),
    );
    const pending = new RpcService(
      { 1: "https://rpc.example" },
      fetcher,
      100,
    ).balance(1, wallet, [native]);
    const assertion = expect(pending).rejects.toMatchObject({
      code: "RPC_TIMEOUT",
      status: 504,
    });
    await vi.advanceTimersByTimeAsync(101);
    await assertion;
  });
});
