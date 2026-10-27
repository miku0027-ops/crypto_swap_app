import { afterEach, describe, expect, it, vi } from "vitest";
import { AccountResourcesService } from "./account-resources.js";
import { AppError } from "./errors.js";

const wallet = "0x1111111111111111111111111111111111111111";
const other = "0x2222222222222222222222222222222222222222";
const currency = {
  chainId: 8453,
  address: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
  name: "USD Coin",
  symbol: "USDC",
  decimals: 6,
};
const balance = {
  currency,
  amount: "50560170",
  amountFormatted: "50.56017",
  amountUsd: "50.545103",
};
const app = () => ({
  balances: [{ ...structuredClone(balance), minimumAmount: "50560170" }],
  totalBalanceUsd: 50.545103,
  availableBalanceUsd: 50.545103,
  outstandingFastFillBalanceUsd: 0,
});
const recovery = () => ({
  balances: [{ ...structuredClone(balance), hubTokenId: "base:usdc" }],
  continuation: null,
});
const response = (value: unknown, options: ResponseInit = {}) =>
  new Response(JSON.stringify(value), {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
const fetcherFor = (value: unknown) => vi.fn(async () => response(value));
afterEach(() => vi.useRealTimers());

describe("account resource request boundaries", () => {
  it("uses only fixed public GET routes and never sends credentials or signing data", async () => {
    const fetcher = vi.fn(async (url: string | URL | Request) =>
      response(String(url).includes("app-fees") ? app() : recovery()),
    );
    const service = new AccountResourcesService(fetcher, () => 1234);
    expect(await service.appBalance(wallet)).toMatchObject({
      address: wallet,
      fetchedAt: 1234,
      balances: [balance],
    });
    expect(await service.recovery(wallet, 1)).toMatchObject({
      address: wallet,
      ownerChainId: 1,
      fetchedAt: 1234,
      hasMore: false,
    });
    expect(fetcher.mock.calls.map((call) => call[0])).toEqual([
      `https://api.relay.link/app-fees/${wallet}/balances`,
      `https://api.relay.link/withdrawals/balances?recoveryAddress=${wallet}&ownerChainId=1&limit=20`,
    ]);
    for (const call of fetcher.mock.calls as unknown as Array<
      [string, RequestInit]
    >) {
      expect(call[1]).toMatchObject({
        method: "GET",
        redirect: "error",
        credentials: "omit",
        headers: { accept: "application/json" },
      });
      expect(call[1].body).toBeUndefined();
      expect(Object.keys(call[1].headers!)).toEqual(["accept"]);
    }
  });

  it.each([
    "",
    "0x123",
    "https://evil.invalid/wallet",
    `0x${"0".repeat(40)}`,
    "0x111111111111111111111111111111111111111X",
  ])("rejects invalid wallet %s before fetch", async (value) => {
    const fetcher = fetcherFor(app());
    const service = new AccountResourcesService(fetcher);
    await expect(service.appBalance(value)).rejects.toMatchObject({
      status: 400,
      code: "VALIDATION_ERROR",
    });
    await expect(service.recovery(value, 1)).rejects.toMatchObject({
      status: 400,
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, Number.NaN])(
    "rejects invalid owner chain %s",
    async (chain) => {
      const fetcher = fetcherFor(recovery());
      await expect(
        new AccountResourcesService(fetcher).recovery(wallet, chain),
      ).rejects.toMatchObject({ status: 400 });
      expect(fetcher).not.toHaveBeenCalled();
    },
  );

  it("preserves unknown metadata and missing totals as null without inventing zeros", async () => {
    const fetcher = fetcherFor({
      balances: [
        {
          currency: null,
          amount: "100",
          amountFormatted: null,
          amountUsd: null,
          hubTokenId: "unknown-token",
        },
      ],
      continuation: "opaque-next",
    });
    const result = await new AccountResourcesService(fetcher).recovery(
      wallet,
      8453,
    );
    expect(result).toMatchObject({
      hasMore: true,
      balances: [
        {
          currency: null,
          amount: "100",
          amountFormatted: null,
          amountUsd: null,
        },
      ],
    });
    expect(result).not.toHaveProperty("continuation");
    expect(
      await new AccountResourcesService(
        fetcherFor({ balances: [] }),
      ).appBalance(wallet),
    ).toMatchObject({
      balances: [],
      totalBalanceUsd: null,
      availableBalanceUsd: null,
      outstandingFastFillBalanceUsd: null,
    });
  });

  it("keeps token names nullable and recomputes display amounts from integer units", async () => {
    const data = app();
    data.balances[0].amountFormatted = "999999999";
    (data.balances[0].currency as unknown as Record<string, unknown>).name =
      null;
    const result = await new AccountResourcesService(
      fetcherFor(data),
    ).appBalance(wallet);
    expect(result.balances[0]).toMatchObject({
      amount: "50560170",
      amountFormatted: "50.56017",
      currency: { name: null },
    });
  });

  it("supports inert non-EVM metadata without turning it into an executable target", async () => {
    const data = recovery();
    data.balances[0].currency.address =
      "So11111111111111111111111111111111111111112";
    const result = await new AccountResourcesService(fetcherFor(data)).recovery(
      wallet,
      1,
    );
    expect(result.balances[0].currency?.address).toBe(
      "So11111111111111111111111111111111111111112",
    );
    expect(result.balances[0]).not.toHaveProperty("transaction");
  });

  it("strips provider metadata, raw errors, signatures and arbitrary URLs", async () => {
    const data = app() as unknown as Record<string, unknown>;
    data.signature = "private-value";
    data.error = "private-provider-secret";
    (
      data.balances as Array<{ currency: Record<string, unknown> }>
    )[0].currency.metadata = { logoURI: "javascript:alert(1)" };
    const result = await new AccountResourcesService(
      fetcherFor(data),
    ).appBalance(wallet);
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("private");
    expect(serialized).not.toContain("javascript:");
    expect(result.balances[0].currency).not.toHaveProperty("metadata");
  });
});

describe("account resource provider validation", () => {
  it.each(["1e18", "-1", "01", "1.5", "NaN", (2n ** 256n).toString()])(
    "rejects malformed amount %s",
    async (amount) => {
      const data = recovery();
      data.balances[0].amount = amount;
      await expect(
        new AccountResourcesService(fetcherFor(data)).recovery(wallet, 1),
      ).rejects.toMatchObject({
        status: 502,
        code: "ACCOUNT_RESOURCE_INVALID_RESPONSE",
      });
    },
  );

  it.each([
    { chainId: 0 },
    { chainId: 1.2 },
    { decimals: 37 },
    { decimals: -1 },
    { decimals: 2.5 },
    { address: "0xBAD" },
    { address: "javascript:alert(1)" },
    { symbol: "USDC\nSECRET" },
  ])("rejects unsafe currency metadata %j", async (fields) => {
    const data = app();
    Object.assign(data.balances[0].currency, fields);
    await expect(
      new AccountResourcesService(fetcherFor(data)).appBalance(wallet),
    ).rejects.toMatchObject({ status: 502 });
  });

  it("preserves a uint256-sized raw amount without numeric precision loss", async () => {
    const raw = (2n ** 256n - 1n).toString();
    const data = recovery();
    data.balances[0].amount = raw;
    const result = await new AccountResourcesService(fetcherFor(data)).recovery(
      wallet,
      1,
    );
    expect(result.balances[0].amount).toBe(raw);
    expect(result.balances[0].amountFormatted).toBe(
      `${raw.slice(0, -6)}.${raw.slice(-6)}`,
    );
  });

  it("rejects invalid decimal totals and unexpected pagination size", async () => {
    for (const data of [
      { ...app(), totalBalanceUsd: -1 },
      { ...app(), availableBalanceUsd: Number.MAX_SAFE_INTEGER + 1 },
      { ...app(), totalBalanceUsd: "123" },
    ]) {
      await expect(
        new AccountResourcesService(fetcherFor(data)).appBalance(wallet),
      ).rejects.toMatchObject({ status: 502 });
    }
    await expect(
      new AccountResourcesService(
        fetcherFor({
          balances: Array.from({ length: 21 }, () => recovery().balances[0]),
          continuation: null,
        }),
      ).recovery(wallet, 1),
    ).rejects.toMatchObject({ status: 502 });
    await expect(
      new AccountResourcesService(
        fetcherFor({ balances: [], continuation: "x".repeat(513) }),
      ).recovery(wallet, 1),
    ).rejects.toMatchObject({ status: 502 });
  });
});

describe("account resource transport and cache", () => {
  it("coalesces identical reads and charges the shared budget only on cache misses", async () => {
    const fetcher = fetcherFor(app()),
      budget = vi.fn(async () => {});
    let now = 1000;
    const service = new AccountResourcesService(fetcher, () => now, budget);
    const results = await Promise.all([
      service.appBalance(wallet),
      service.appBalance(wallet),
    ]);
    results[0].balances[0].amount = "999";
    expect((await service.appBalance(wallet)).balances[0].amount).toBe(
      "50560170",
    );
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(budget).toHaveBeenCalledTimes(1);
    now += 15_000;
    await service.appBalance(wallet);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(budget).toHaveBeenCalledTimes(2);
  });

  it("separates wallet and owner-chain cache entries", async () => {
    const fetcher = fetcherFor(recovery()),
      service = new AccountResourcesService(fetcher);
    await service.recovery(wallet, 1);
    await service.recovery(other, 1);
    await service.recovery(wallet, 8453);
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it("bounds the cache and refetches evicted wallet entries", async () => {
    const fetcher = fetcherFor(app()),
      service = new AccountResourcesService(fetcher);
    const address = (index: number) =>
      `0x${index.toString(16).padStart(40, "0")}`;
    for (let i = 1; i <= 101; i++) await service.appBalance(address(i));
    await service.appBalance(address(1));
    expect(fetcher).toHaveBeenCalledTimes(102);
  });

  it("propagates safe shared-budget rejection without requesting the provider", async () => {
    const fetcher = fetcherFor(app());
    const service = new AccountResourcesService(fetcher, Date.now, async () => {
      throw new AppError(429, "RATE_LIMITED", "Wait before retrying.", 12);
    });
    await expect(service.appBalance(wallet)).rejects.toMatchObject({
      code: "RATE_LIMITED",
      retryAfterSeconds: 12,
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("sanitizes upstream errors and clears failed cache requests for retry", async () => {
    const fetcher = vi
      .fn()
      .mockRejectedValueOnce(
        new Error("https://secret-provider.example/private-token"),
      )
      .mockResolvedValueOnce(response(app()));
    const service = new AccountResourcesService(fetcher);
    await expect(service.appBalance(wallet)).rejects.toMatchObject({
      status: 503,
      code: "ACCOUNT_RESOURCE_UNAVAILABLE",
    });
    expect((await service.appBalance(wallet)).balances).toHaveLength(1);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("normalizes provider429 without forwarding its error body", async () => {
    const fetcher = vi.fn(async () =>
      response(
        { message: "secret-key" },
        { status: 429, headers: { "Retry-After": "99999" } },
      ),
    );
    await expect(
      new AccountResourcesService(fetcher).appBalance(wallet),
    ).rejects.toMatchObject({
      status: 429,
      code: "ACCOUNT_RESOURCE_RATE_LIMIT",
      retryAfterSeconds: 300,
    });
  });

  it.each([302, 400, 401, 500])(
    "does not expose raw provider %s content",
    async (status) => {
      const fetcher = vi.fn(async () =>
        response({ message: "private-provider-credential" }, { status }),
      );
      try {
        await new AccountResourcesService(fetcher).appBalance(wallet);
        throw Error("Expected rejection");
      } catch (error) {
        expect(error).toMatchObject({ status: 503 });
        expect(String(error)).not.toContain("private-provider");
      }
    },
  );

  it("rejects oversized advertised or streamed bodies", async () => {
    const advertised = vi.fn(async () =>
      response(app(), {
        headers: { "Content-Length": String(1024 * 1024 + 1) },
      }),
    );
    const streamed = vi.fn(
      async () => new Response("x".repeat(1024 * 1024 + 1)),
    );
    for (const fetcher of [advertised, streamed])
      await expect(
        new AccountResourcesService(fetcher).appBalance(wallet),
      ).rejects.toMatchObject({
        status: 502,
        code: "ACCOUNT_RESOURCE_INVALID_RESPONSE",
      });
  });

  it("rejects non-JSON and missing response bodies", async () => {
    for (const res of [
      new Response("<html>private-error</html>"),
      new Response(null),
    ]) {
      await expect(
        new AccountResourcesService(vi.fn(async () => res)).appBalance(wallet),
      ).rejects.toMatchObject({ status: 502 });
    }
  });

  it("enforces an eight-second deadline even for stalled response streams", async () => {
    vi.useFakeTimers();
    const cancel = vi.fn();
    const fetcher = vi.fn(
      async () => new Response(new ReadableStream({ cancel })),
    );
    const result = new AccountResourcesService(fetcher)
      .appBalance(wallet)
      .catch((error) => error);
    await vi.advanceTimersByTimeAsync(8_000);
    expect(await result).toMatchObject({
      status: 504,
      code: "ACCOUNT_RESOURCE_TIMEOUT",
    });
    expect(cancel).toHaveBeenCalled();
  });
});
