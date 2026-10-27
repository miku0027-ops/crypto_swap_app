import { describe, expect, it, vi } from "vitest";
import { VaultsService } from "./vaults.js";
import { AppError } from "./errors.js";
const address = "0x1111111111111111111111111111111111111111";
const pool = {
  chainId: 1,
  contractAddress: address,
  name: "Wrapped Ether Relay Vault",
  symbol: "WETH-REL",
  asset: "0x2222222222222222222222222222222222222222",
  decimals: 18,
  totalAssets: "900719925474099312345",
  totalShares: "900719925474099312345",
  outstandingDebt: "0",
  updatedAt: "1793113181993",
};
const response = (data: unknown) =>
  new Response(JSON.stringify(data), {
    headers: { "Content-Type": "application/json" },
  });
const catalog = (items: unknown[] = [pool]) => ({
  data: { relayPools: { items, totalCount: items.length } },
});
const positions = (items: unknown[]) => ({
  data: {
    userBalances: {
      items,
      totalCount: items.length,
      pageInfo: { hasNextPage: false, endCursor: null },
    },
  },
});
const position = {
  chainId: 1,
  relayPool: address,
  wallet: address,
  shareBalance: "900719925474099312345",
  totalDeposited: "0",
  totalWithdrawn: "0",
  updatedAt: "1793113181993",
};
describe("read-only vault provider", () => {
  it("bounds the full upstream request with a deadline", async () => {
    vi.useFakeTimers();
    try {
      const request = vi.fn<typeof fetch>(
        async (_url, options) =>
          new Promise<Response>((_resolve, reject) =>
            options?.signal?.addEventListener(
              "abort",
              () => reject(new Error("aborted")),
              { once: true },
            ),
          ),
      );
      const pending = expect(
        new VaultsService(request).pools(),
      ).rejects.toMatchObject({ status: 504, code: "VAULTS_TIMEOUT" });
      await vi.advanceTimersByTimeAsync(8001);
      await pending;
    } finally {
      vi.useRealTimers();
    }
  });

  it("uses a fixed provider/query and preserves exact share precision", async () => {
    const request = vi.fn<typeof fetch>(async () => response(catalog()));
    const service = new VaultsService(request);
    const result = await service.pools();
    expect(request.mock.calls[0][0]).toBe("https://vaults-api.relay.link/");
    expect(result.pools[0].totalSharesFormatted).toBe("900.719925474099312345");
    expect(result.lifecycle.depositsEnabled).toBe(false);
    expect(result.lifecycle.withdrawalUiEndDate).toBe("2026-12-31");
  });
  it("caches and coalesces requests without spending another provider budget", async () => {
    let now = 100_000;
    const request = vi.fn<typeof fetch>(async () => response(catalog()));
    const budget = vi.fn(async () => {});
    const service = new VaultsService(request, () => now, budget);
    const [one, two] = await Promise.all([service.pools(), service.pools()]);
    one.pools[0].symbol = "mutated";
    expect(two.pools[0].symbol).toBe("WETH-REL");
    expect((await service.pools()).pools[0].symbol).toBe("WETH-REL");
    expect(request).toHaveBeenCalledTimes(1);
    expect(budget).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[0][0]).toBe("https://vaults-api.relay.link/");
    expect(request.mock.calls[0][1]).toMatchObject({
      method: "POST",
      redirect: "error",
    });
    now += 60_001;
    await service.pools();
    expect(request).toHaveBeenCalledTimes(2);
  });
  it("never contacts the provider when the shared quota rejects admission", async () => {
    const request = vi.fn<typeof fetch>();
    const service = new VaultsService(request, Date.now, async () => {
      throw new AppError(429, "RATE_LIMITED", "Wait", 30);
    });
    await expect(service.pools()).rejects.toMatchObject({
      status: 429,
      code: "RATE_LIMITED",
    });
    expect(request).not.toHaveBeenCalled();
  });
  it.each(["1e18", "-1", "1.2", "0x10"])(
    "rejects malformed provider amounts %s",
    async (amount) => {
      const service = new VaultsService(
        vi.fn(async () =>
          response(catalog([{ ...pool, totalShares: amount }])),
        ),
      );
      await expect(service.pools()).rejects.toMatchObject({
        status: 502,
        code: "INVALID_VAULT_RESPONSE",
      });
    },
  );
  it("rejects GraphQL errors and never returns raw provider details", async () => {
    const service = new VaultsService(
      vi.fn(async () =>
        response({
          ...catalog(),
          errors: [{ message: "secret provider internals" }],
        }),
      ),
    );
    await expect(service.pools()).rejects.toMatchObject({
      code: "INVALID_VAULT_RESPONSE",
    });
  });
  it("rejects duplicate pools and invalid addresses", async () => {
    for (const items of [[pool, pool], [{ ...pool, contractAddress: "bad" }]]) {
      const service = new VaultsService(
        vi.fn(async () => response(catalog(items))),
      );
      await expect(service.pools()).rejects.toMatchObject({
        code: "INVALID_VAULT_RESPONSE",
      });
    }
  });
  it("bounds upstream response bodies", async () => {
    const service = new VaultsService(
      vi.fn(async () => new Response("x".repeat(1024 * 1024 + 1))),
    );
    await expect(service.pools()).rejects.toMatchObject({
      code: "INVALID_VAULT_RESPONSE",
    });
  });
  it("surfaces provider throttling safely", async () => {
    const service = new VaultsService(
      vi.fn(async () => new Response("private", { status: 429 })),
    );
    await expect(service.pools()).rejects.toMatchObject({
      status: 429,
      code: "VAULTS_RATE_LIMITED",
      retryAfterSeconds: 60,
    });
  });
  it("binds indexed positions to the requested wallet and joins share decimals", async () => {
    const request = vi.fn<typeof fetch>(async (_url, options) => {
      const body = JSON.parse(String(options?.body));
      return response(body.variables ? positions([position]) : catalog());
    });
    const service = new VaultsService(request);
    const result = await service.positions(address);
    expect(result.positions[0]).toMatchObject({
      wallet: address,
      shareBalanceFormatted: "900.719925474099312345",
      symbol: "WETH-REL",
    });
    const body = JSON.parse(String(request.mock.calls[0][1]?.body));
    expect(body.variables).toEqual({ wallet: address });
    expect(result.positions[0]).not.toHaveProperty("withdrawableAmount");
  });
  it("rejects substituted wallet records", async () => {
    const request = vi.fn<typeof fetch>(async () =>
      response(
        positions([
          { ...position, wallet: "0x3333333333333333333333333333333333333333" },
        ]),
      ),
    );
    await expect(
      new VaultsService(request).positions(address),
    ).rejects.toMatchObject({ code: "INVALID_VAULT_RESPONSE" });
    expect(request).toHaveBeenCalledTimes(1);
  });
  it("rejects malformed input before a network request", async () => {
    const request = vi.fn<typeof fetch>();
    await expect(
      new VaultsService(request).positions("no wallet"),
    ).rejects.toMatchObject({ status: 400, code: "INVALID_WALLET" });
    expect(request).not.toHaveBeenCalled();
  });
  it("leaves unsupported metadata unformatted instead of inventing decimals", async () => {
    const request = vi.fn<typeof fetch>(async (_url, options) =>
      response(
        JSON.parse(String(options?.body)).variables
          ? positions([
              {
                ...position,
                relayPool: "0x3333333333333333333333333333333333333333",
              },
            ])
          : catalog(),
      ),
    );
    const result = await new VaultsService(request).positions(address);
    expect(result.positions[0].shareBalanceFormatted).toBeNull();
    expect(result.positions[0].shareBalance).toBe(position.shareBalance);
  });
  it("does not cache failed responses", async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("no", { status: 503 }))
      .mockImplementation(async () => response(catalog()));
    const service = new VaultsService(request);
    await expect(service.pools()).rejects.toMatchObject({
      code: "VAULTS_UNAVAILABLE",
    });
    expect((await service.pools()).pools).toHaveLength(1);
    expect(request).toHaveBeenCalledTimes(2);
  });
});
