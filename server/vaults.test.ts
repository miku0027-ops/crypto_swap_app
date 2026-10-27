import { describe, expect, it, vi } from "vitest";
import { VaultsService } from "./vaults.js";
import { AppError } from "./errors.js";
import { KNOWN_VAULTS } from "./vault-metadata.js";
const NOW = 1793113200000;
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
    let now = NOW;
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
    await service.pools();
    const result = await service.positions(address);
    expect(result.positions[0]).toMatchObject({
      wallet: address,
      shareBalanceFormatted: "900.719925474099312345",
      symbol: "WETH-REL",
    });
    const body = JSON.parse(String(request.mock.calls[1][1]?.body));
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

const knownPool = {
  ...pool,
  contractAddress: KNOWN_VAULTS[0].address,
  asset: KNOWN_VAULTS[0].assetAddress,
  totalAssets: "1500000000000000000",
  totalShares: "1400000000000000000",
  apy: 132,
};

describe("vault metrics and freshness", () => {
  it("uses independently reviewed underlying units and exact USD arithmetic", async () => {
    const budget = vi.fn(async (_kind: string) => {});
    const request = vi.fn<typeof fetch>(async (_url, options) =>
      response(
        options?.method === "GET"
          ? { price: 2337.87761 }
          : catalog([knownPool]),
      ),
    );
    const result = await new VaultsService(request, () => NOW, budget).pools();
    expect(result.pools[0]).toMatchObject({
      decimals: 18,
      assetDecimals: 18,
      assetSymbol: "WETH",
      totalAssetsFormatted: "1.5",
      totalSharesFormatted: "1.4",
      apyPercent: "1.32",
      tvlUsd: "3506.816415",
      priceFetchedAt: NOW,
      metricsUpdatedAt: Number(pool.updatedAt),
      metricsSource: "https://vaults-api.relay.link/",
      metadataSource: KNOWN_VAULTS[0].metadataSource,
      dataStale: false,
    });
    expect(request.mock.calls[1][0]).toBe(
      `https://api.relay.link/currencies/token/price?chainId=1&address=${KNOWN_VAULTS[0].assetAddress}`,
    );
    expect(request.mock.calls[1][1]).toMatchObject({
      credentials: "omit",
      redirect: "error",
      method: "GET",
    });
    expect(budget.mock.calls.map(([kind]) => kind)).toEqual([
      "catalog",
      "price",
    ]);
  });
  it.each([
    [0, null],
    [-25, "-0.25"],
    [94, "0.94"],
    [undefined, null],
  ])(
    "handles provider APY %s without inventing yield",
    async (apy, expected) => {
      const request = vi.fn<typeof fetch>(async () =>
        response(catalog([{ ...pool, apy }])),
      );
      expect(
        (await new VaultsService(request, () => NOW).pools()).pools[0]
          .apyPercent,
      ).toBe(expected);
    },
  );
  it.each([1.5, -10_001, 2_147_483_648, "132", null])(
    "rejects invalid APY units %s",
    async (apy) => {
      await expect(
        new VaultsService(
          vi.fn(async () => response(catalog([{ ...pool, apy }]))),
          () => NOW,
        ).pools(),
      ).rejects.toMatchObject({ code: "INVALID_VAULT_RESPONSE" });
    },
  );
  it("does not derive unknown asset metadata or USD value from share decimals", async () => {
    const request = vi.fn<typeof fetch>(async () => response(catalog()));
    const result = await new VaultsService(request, () => NOW).pools();
    expect(result.pools[0]).toMatchObject({
      assetSymbol: null,
      assetDecimals: null,
      totalAssetsFormatted: null,
      tvlUsd: null,
      priceFetchedAt: null,
      priceSource: null,
    });
    expect(request).toHaveBeenCalledTimes(1);
  });
  it("rejects a substituted underlying asset on a reviewed vault", async () => {
    const request = vi.fn<typeof fetch>(async () =>
      response(catalog([{ ...knownPool, asset: address }])),
    );
    await expect(
      new VaultsService(request, () => NOW).pools(),
    ).rejects.toMatchObject({ code: "INVALID_VAULT_RESPONSE" });
    expect(request).toHaveBeenCalledTimes(1);
  });
  it.each([0, -1, 1e13, "2337.2", null])(
    "keeps price %s unavailable while retaining indexed assets",
    async (price) => {
      const request = vi.fn<typeof fetch>(async (_url, options) =>
        response(options?.method === "GET" ? { price } : catalog([knownPool])),
      );
      expect(
        (await new VaultsService(request, () => NOW).pools()).pools[0],
      ).toMatchObject({
        totalAssetsFormatted: "1.5",
        tvlUsd: null,
        priceFetchedAt: null,
        priceSource: null,
      });
    },
  );
  it("does not fabricate zero when optional pricing is rate limited", async () => {
    const request = vi.fn<typeof fetch>(async (_url, options) =>
      options?.method === "GET"
        ? new Response("private", { status: 429 })
        : response(catalog([knownPool])),
    );
    const result = await new VaultsService(request, () => NOW).pools();
    expect(result.pools[0].tvlUsd).toBeNull();
    expect(result.pools[0].totalAssetsFormatted).toBe("1.5");
  });
  it("keeps large balances precise when pricing uses scientific notation", async () => {
    const request = vi.fn<typeof fetch>(async (_url, options) =>
      response(
        options?.method === "GET"
          ? { price: 1e-7 }
          : catalog([
              { ...knownPool, totalAssets: "123456789012345678901234567890" },
            ]),
      ),
    );
    expect(
      (await new VaultsService(request, () => NOW).pools()).pools[0].tvlUsd,
    ).toBe("12345.678901");
  });
  it.each([
    "0",
    "01",
    "1e12",
    "-1",
    "9007199254740992",
    "8640000000000001",
    String(NOW + 300_001),
  ])("rejects invalid or future timestamp %s", async (updatedAt) => {
    await expect(
      new VaultsService(
        vi.fn(async () => response(catalog([{ ...pool, updatedAt }]))),
        () => NOW,
      ).pools(),
    ).rejects.toMatchObject({ code: "INVALID_VAULT_RESPONSE" });
  });
  it("marks old records stale and reevaluates freshness when cached data crosses the threshold", async () => {
    let now = NOW;
    const request = vi.fn<typeof fetch>(async () =>
      response(
        catalog([{ ...pool, updatedAt: String(NOW - 3_600_000 + 1000) }]),
      ),
    );
    const service = new VaultsService(request, () => now);
    expect((await service.pools()).pools[0].dataStale).toBe(false);
    now += 1001;
    expect((await service.pools()).pools[0].dataStale).toBe(true);
    expect(request).toHaveBeenCalledTimes(1);
  });
});

describe("vault resource bounds and failure recovery", () => {
  it("times out even when fetch ignores AbortSignal and allows a later retry", async () => {
    vi.useFakeTimers();
    try {
      const request = vi
        .fn<typeof fetch>()
        .mockImplementationOnce(async () => new Promise<Response>(() => {}))
        .mockImplementation(async () => response(catalog()));
      const service = new VaultsService(request, () => NOW);
      const pending = expect(service.pools()).rejects.toMatchObject({
        code: "VAULTS_TIMEOUT",
      });
      await vi.advanceTimersByTimeAsync(8001);
      await pending;
      expect((await service.pools()).pools).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });
  it("bounds a stalled body and a cancellation handler that never settles", async () => {
    vi.useFakeTimers();
    try {
      const request = vi.fn<typeof fetch>(
        async () =>
          new Response(
            new ReadableStream<Uint8Array>({
              start(controller) {
                controller.enqueue(new TextEncoder().encode('{"data":'));
              },
              cancel() {
                return new Promise<void>(() => {});
              },
            }),
          ),
      );
      const pending = expect(
        new VaultsService(request, () => NOW).pools(),
      ).rejects.toMatchObject({ status: 504, code: "VAULTS_TIMEOUT" });
      await vi.advanceTimersByTimeAsync(8001);
      await pending;
    } finally {
      vi.useRealTimers();
    }
  });
  it("abandons stalled optional pricing after three seconds and returns the catalog", async () => {
    vi.useFakeTimers();
    try {
      const request = vi.fn<typeof fetch>(async (_url, options) =>
        options?.method === "GET"
          ? new Promise<Response>(() => {})
          : response(catalog([knownPool])),
      );
      const pending = new VaultsService(request, () => NOW).pools();
      await vi.advanceTimersByTimeAsync(3001);
      expect((await pending).pools[0]).toMatchObject({
        totalAssetsFormatted: "1.5",
        tvlUsd: null,
      });
    } finally {
      vi.useRealTimers();
    }
  });
  it("bounds advertised response size without waiting for cancellation", async () => {
    const request = vi.fn<typeof fetch>(
      async () =>
        new Response(
          new ReadableStream<Uint8Array>({
            cancel: () => new Promise<void>(() => {}),
          }),
          { headers: { "Content-Length": String(1024 * 1024 + 1) } },
        ),
    );
    await expect(
      new VaultsService(request, () => NOW).pools(),
    ).rejects.toMatchObject({ code: "INVALID_VAULT_RESPONSE" });
  });
  it("rejects malformed UTF-8 instead of replacing bytes in provider data", async () => {
    const bytes = new Uint8Array([
      ...new TextEncoder().encode(
        '{"data":{"relayPools":{"items":[],"totalCount":0}},"junk":"',
      ),
      0xff,
      ...new TextEncoder().encode('"}'),
    ]);
    await expect(
      new VaultsService(
        vi.fn(async () => new Response(bytes)),
        () => NOW,
      ).pools(),
    ).rejects.toMatchObject({ code: "INVALID_VAULT_RESPONSE" });
  });
});

describe("wallet-isolated vault position caching", () => {
  it("coalesces the same wallet, isolates others, clones responses and expires in15s", async () => {
    let now = NOW;
    const secondWallet = "0x3333333333333333333333333333333333333333";
    const request = vi.fn<typeof fetch>(async (_url, options) => {
      const body = JSON.parse(String(options?.body));
      return response(
        body.variables
          ? positions([{ ...position, wallet: body.variables.wallet }])
          : catalog(),
      );
    });
    const service = new VaultsService(request, () => now);
    await service.pools();
    const [one, two] = await Promise.all([
      service.positions(address),
      service.positions(address),
    ]);
    one.positions[0].shareBalance = "0";
    one.lifecycle.sourceUrl = "changed";
    expect(two.positions[0].shareBalance).toBe(position.shareBalance);
    expect((await service.positions(address)).positions[0].shareBalance).toBe(
      position.shareBalance,
    );
    expect(request).toHaveBeenCalledTimes(2);
    expect(
      (await service.positions(secondWallet)).positions[0].wallet.toLowerCase(),
    ).toBe(secondWallet);
    expect(request).toHaveBeenCalledTimes(3);
    now += 15_001;
    expect((await service.positions(address)).lifecycle.sourceUrl).not.toBe(
      "changed",
    );
    expect(request).toHaveBeenCalledTimes(4);
  });
  it("caps retained wallet caches and evicts older entries", async () => {
    const request = vi.fn<typeof fetch>(async () => response(positions([])));
    const service = new VaultsService(request, () => NOW);
    const wallet = (n: number) => `0x${n.toString(16).padStart(40, "0")}`;
    for (let i = 1; i <= 101; i++) await service.positions(wallet(i));
    await service.positions(wallet(101));
    expect(request).toHaveBeenCalledTimes(101);
    await service.positions(wallet(1));
    expect(request).toHaveBeenCalledTimes(102);
  });
  it("bounds pending wallet reads without letting one wallet bypass coalescing", async () => {
    vi.useFakeTimers();
    try {
      const request = vi.fn<typeof fetch>(
        async () => new Promise<Response>(() => {}),
      );
      const service = new VaultsService(request, () => NOW);
      const wallet = (n: number) => `0x${n.toString(16).padStart(40, "0")}`;
      const pending = Array.from({ length: 100 }, (_, i) =>
        service.positions(wallet(i + 1)).catch((e: unknown) => e),
      );
      const same = service.positions(wallet(1)).catch((e: unknown) => e);
      await expect(service.positions(wallet(101))).rejects.toMatchObject({
        code: "VAULTS_BUSY",
      });
      expect(request).toHaveBeenCalledTimes(100);
      await vi.advanceTimersByTimeAsync(8001);
      expect((await Promise.all(pending))[0]).toMatchObject({
        code: "VAULTS_TIMEOUT",
      });
      await same;
    } finally {
      vi.useRealTimers();
    }
  });
  it("rejects duplicates, including zero-share duplicates, before joining metadata", async () => {
    const request = vi.fn<typeof fetch>(async () =>
      response(positions([position, { ...position, shareBalance: "0" }])),
    );
    await expect(
      new VaultsService(request, () => NOW).positions(address),
    ).rejects.toMatchObject({ code: "INVALID_VAULT_RESPONSE" });
    expect(request).toHaveBeenCalledTimes(1);
  });
  it("retains raw shares when the catalog fails instead of claiming an empty position", async () => {
    const request = vi.fn<typeof fetch>(async (_url, options) =>
      JSON.parse(String(options?.body)).variables
        ? response(positions([position]))
        : new Response("down", { status: 503 }),
    );
    const result = await new VaultsService(request, () => NOW).positions(
      address,
    );
    expect(result.positions).toHaveLength(1);
    expect(result.positions[0]).toMatchObject({
      shareBalance: position.shareBalance,
      shareBalanceFormatted: null,
      symbol: null,
    });
  });
  it("rejects future position timestamps and retries failures instead of caching them", async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        response(
          positions([{ ...position, updatedAt: String(NOW + 300_001) }]),
        ),
      )
      .mockResolvedValueOnce(response(positions([])));
    const service = new VaultsService(request, () => NOW);
    await expect(service.positions(address)).rejects.toMatchObject({
      code: "INVALID_VAULT_RESPONSE",
    });
    expect((await service.positions(address)).positions).toEqual([]);
    expect(request).toHaveBeenCalledTimes(2);
  });
  it("preserves truncation when the upstream index has additional records", async () => {
    const body = positions([]);
    body.data.userBalances.totalCount = 2;
    body.data.userBalances.pageInfo.hasNextPage = true;
    const request = vi.fn<typeof fetch>(async () => response(body));
    expect(
      (await new VaultsService(request, () => NOW).positions(address))
        .truncated,
    ).toBe(true);
  });
});

describe("verified metadata without blocking position discovery", () => {
  it("formats reviewed shares without waiting for an unavailable catalog", async () => {
    const request = vi.fn<typeof fetch>(async (_url, options) => {
      const variables = JSON.parse(String(options?.body)).variables;
      if (!variables)
        throw new Error("A wallet read must not request the catalog");
      return response(
        positions([
          {
            ...position,
            relayPool: KNOWN_VAULTS[0].address,
            updatedAt: String(NOW - 30 * 86_400_000),
          },
        ]),
      );
    });
    const result = await new VaultsService(request, () => NOW).positions(
      address,
    );
    expect(result.positions[0]).toMatchObject({
      shareBalanceFormatted: "900.719925474099312345",
      symbol: "WETH-REL",
      updatedAt: NOW - 30 * 86_400_000,
      indexUpdatedAt: null,
      dataStale: false,
    });
    expect(request).toHaveBeenCalledTimes(1);
  });
  it("uses catalog snapshot freshness instead of treating dormant holdings as stale", async () => {
    let now = NOW;
    const request = vi.fn<typeof fetch>(async (_url, options) =>
      response(
        JSON.parse(String(options?.body)).variables
          ? positions([
              { ...position, updatedAt: String(NOW - 30 * 86_400_000) },
            ])
          : catalog([{ ...pool, updatedAt: String(NOW - 3_600_000 + 1000) }]),
      ),
    );
    const service = new VaultsService(request, () => now);
    await service.pools();
    expect((await service.positions(address)).positions[0]).toMatchObject({
      dataStale: false,
      indexUpdatedAt: NOW - 3_600_000 + 1000,
    });
    now += 1001;
    expect((await service.positions(address)).positions[0].dataStale).toBe(
      true,
    );
    expect(request).toHaveBeenCalledTimes(2);
  });
  it("does not format unknown shares with expired catalog metadata", async () => {
    let now = NOW;
    const request = vi.fn<typeof fetch>(async (_url, options) =>
      response(
        JSON.parse(String(options?.body)).variables
          ? positions([position])
          : catalog(),
      ),
    );
    const service = new VaultsService(request, () => now);
    await service.pools();
    now += 60_001;
    expect((await service.positions(address)).positions[0]).toMatchObject({
      shareBalance: position.shareBalance,
      shareBalanceFormatted: null,
      symbol: null,
    });
    expect(request).toHaveBeenCalledTimes(2);
  });
  it("rejects a share-decimal mismatch for a reviewed vault before pricing", async () => {
    const request = vi.fn<typeof fetch>(async () =>
      response(catalog([{ ...knownPool, decimals: 6 }])),
    );
    await expect(
      new VaultsService(request, () => NOW).pools(),
    ).rejects.toMatchObject({ code: "INVALID_VAULT_RESPONSE" });
    expect(request).toHaveBeenCalledTimes(1);
  });
  it.each(["contractAddress", "asset"])(
    "rejects zero %s in a vault record",
    async (field) => {
      const request = vi.fn<typeof fetch>(async () =>
        response(
          catalog([
            { ...pool, [field]: "0x0000000000000000000000000000000000000000" },
          ]),
        ),
      );
      await expect(
        new VaultsService(request, () => NOW).pools(),
      ).rejects.toMatchObject({ code: "INVALID_VAULT_RESPONSE" });
    },
  );
  it("includes a stalled quota store in the request deadline and never fetches after timeout", async () => {
    vi.useFakeTimers();
    try {
      let admit!: () => void;
      const budget = vi.fn(
        () =>
          new Promise<void>((resolve) => {
            admit = resolve;
          }),
      );
      const request = vi.fn<typeof fetch>(async () => response(catalog()));
      const pending = expect(
        new VaultsService(request, () => NOW, budget).pools(),
      ).rejects.toMatchObject({ code: "VAULTS_TIMEOUT" });
      await vi.advanceTimersByTimeAsync(8001);
      await pending;
      admit();
      await vi.advanceTimersByTimeAsync(1);
      expect(request).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
  it("bounds optional price quota admission without hiding valid vault data", async () => {
    vi.useFakeTimers();
    try {
      const budget = vi.fn(async (kind: string) => {
        if (kind === "price") await new Promise<void>(() => {});
      });
      const request = vi.fn<typeof fetch>(async () =>
        response(catalog([knownPool])),
      );
      const pending = new VaultsService(request, () => NOW, budget).pools();
      await vi.advanceTimersByTimeAsync(3001);
      expect((await pending).pools[0]).toMatchObject({
        totalAssetsFormatted: "1.5",
        tvlUsd: null,
      });
      expect(request).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
