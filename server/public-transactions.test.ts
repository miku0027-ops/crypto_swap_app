import { afterEach, describe, expect, it, vi } from "vitest";
import { PublicTransactionsService } from "./public-transactions";
import { FIXED_NOW as NOW, providerRow } from "../test/fixtures/transactions";
const json = (value: unknown) => new Response(JSON.stringify(value));
const response = (rows = [providerRow()]) =>
  json({
    requests: rows,
    continuation: "private-cursor",
    deprecation: { sunsetAt: "2026-11-24" },
  });
afterEach(() => vi.useRealTimers());
describe("validated public transaction feed", () => {
  it("calls host fetch with the global context required by Worker runtimes", async () => {
    const fetcher = function (this: unknown) {
      expect(this).toBe(globalThis);
      return Promise.resolve(response());
    } as typeof fetch;
    expect(
      (await new PublicTransactionsService({}, fetcher, () => NOW).snapshot())
        .transactions,
    ).toHaveLength(1);
  });
  it("uses fixed descending public requests, exact raw amounts, and indexed fill timing", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => response());
    const feed = await new PublicTransactionsService(
      {},
      fetcher,
      () => NOW,
    ).snapshot();
    const [url, options] = fetcher.mock.calls[0];
    expect(String(url)).toContain(
      "requests/v2?limit=50&sortBy=createdAt&sortDirection=desc&includeAuthenticatedData=false",
    );
    expect(options).toMatchObject({ redirect: "error", credentials: "omit" });
    expect(options?.headers).not.toHaveProperty("x-api-key");
    expect(feed.transactions[0]).toMatchObject({
      from: {
        amountFormatted: "900.719925474099312345",
        amountKind: "reported",
      },
      to: { amountFormatted: "0.01" },
      fillTimeSeconds: 10,
    });
    expect(feed).toMatchObject({
      nextRefreshMs: 60000,
      source: { name: "Relay network", version: "v2" },
    });
    expect(JSON.stringify(feed)).not.toContain("private-cursor");
  });
  it("coalesces requests, clones cache results, and expires the public cache", async () => {
    let now = NOW;
    const fetcher = vi.fn<typeof fetch>(async () => response());
    const budget = vi.fn(async () => {}),
      service = new PublicTransactionsService({}, fetcher, () => now, budget);
    const [a, b] = await Promise.all([service.snapshot(), service.snapshot()]);
    a.transactions[0].id = "changed";
    expect(b.transactions[0].id).toBe("request_1");
    expect((await service.snapshot()).transactions[0].id).toBe("request_1");
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(budget).toHaveBeenCalledTimes(1);
    now += 60000;
    await service.snapshot();
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("uses v3 actual routes and labels quoted fallback without leaking keys or private fields", async () => {
    const row = providerRow(),
      meta = row.data.metadata;
    const v3 = {
      ...row,
      apiKey: "private-provider-field",
      data: {
        route: {
          actual: { origin: { inputCurrency: meta.currencyIn } },
          quoted: { destination: { outputCurrency: meta.currencyOut } },
        },
        inTxs: row.data.inTxs.map(({ hash, ...tx }) => ({
          ...tx,
          txHash: hash,
        })),
        outTxs: row.data.outTxs.map(({ hash, ...tx }) => ({
          ...tx,
          txHash: hash,
        })),
      },
    };
    const fetcher = vi.fn<typeof fetch>(async () => json({ requests: [v3] }));
    const result = await new PublicTransactionsService(
      { apiKey: "test-server-only-key" },
      fetcher,
      () => NOW,
    ).snapshot();
    expect(fetcher.mock.calls[0][0]).toContain("/requests/v3?");
    expect(fetcher.mock.calls[0][1]?.headers).toHaveProperty(
      "x-api-key",
      "test-server-only-key",
    );
    expect(result.transactions[0]).toMatchObject({
      from: { amountKind: "reported" },
      to: { amountKind: "quoted" },
    });
    expect(result.nextRefreshMs).toBe(10000);
    expect(result.source.legacySunsetAt).toBeNull();
    expect(JSON.stringify(result)).not.toMatch(
      /private-provider-field|test-server-only-key|apiKey/,
    );
  });
  it("keeps unknown statuses unknown and missing assets unavailable", async () => {
    const row = providerRow();
    row.status = "new_provider_status";
    (row.data.metadata as Record<string, unknown>).currencyOut = null;
    const result = await new PublicTransactionsService(
      {},
      async () => response([row]),
      () => NOW,
    ).snapshot();
    expect(result.transactions[0]).toMatchObject({
      status: "unknown",
      to: null,
      fillTimeSeconds: null,
    });
  });
  it("does not fabricate fills from negative timestamps, pending requests, or failed fill transactions", async () => {
    for (const change of ["pending", "negative", "failed"] as const) {
      const row = providerRow();
      if (change === "pending") row.status = "pending";
      if (change === "negative") row.data.outTxs[0].timestamp -= 100;
      if (change === "failed")
        Object.assign(row.data.outTxs[0], { status: "failure" });
      const result = await new PublicTransactionsService(
        {},
        async () => response([row]),
        () => NOW,
      ).snapshot();
      expect(result.transactions[0].fillTimeSeconds).toBeNull();
    }
  });
  it("omits duplicate, unbroadcast, invalid-date rows and reports the omission", async () => {
    const row = providerRow();
    const rows = [
      row,
      row,
      { ...row, id: "future", createdAt: new Date(NOW + 600000).toISOString() },
      {
        ...row,
        id: "unbroadcast",
        data: { ...row.data, inTxs: [], outTxs: [] },
      },
    ];
    const result = await new PublicTransactionsService(
      {},
      async () => response(rows),
      () => NOW,
    ).snapshot();
    expect(result.transactions).toHaveLength(1);
    expect(result.omittedCount).toBe(3);
  });
  it("rejects a wholly malformed listing rather than showing an empty feed", async () => {
    await expect(
      new PublicTransactionsService(
        {},
        async () => json({ requests: [{ arbitrary: "secret-debug" }] }),
        () => NOW,
      ).snapshot(),
    ).rejects.toMatchObject({ code: "TRANSACTIONS_INVALID_RESPONSE" });
  });
  it.each(["-1", "1.5", (2n ** 256n).toString()])(
    "leaves invalid amount %s unavailable",
    async (amount) => {
      const row = providerRow();
      row.data.metadata.currencyIn = {
        ...row.data.metadata.currencyIn,
        amount,
      };
      const result = await new PublicTransactionsService(
        {},
        async () => response([row]),
        () => NOW,
      ).snapshot();
      expect(result.transactions[0].from).toBeNull();
    },
  );
  it("preserves real zero amounts and flags old provider data", async () => {
    const row = providerRow(NOW - 600000);
    row.data.metadata.currencyIn = { ...rawInput(row), amount: "0" };
    const result = await new PublicTransactionsService(
      {},
      async () => response([row]),
      () => NOW,
    ).snapshot();
    expect(result.transactions[0].from?.amountFormatted).toBe("0");
    expect(result.providerDataOld).toBe(true);
  });
  it("backs off on 429 and never silently falls back from a keyed v3 request", async () => {
    let now = NOW;
    const fetcher = vi.fn<typeof fetch>(
      async () => new Response("private diagnostic", { status: 429 }),
    );
    const service = new PublicTransactionsService(
      { apiKey: "test-secret" },
      fetcher,
      () => now,
    );
    await expect(service.snapshot()).rejects.toMatchObject({
      code: "TRANSACTIONS_RATE_LIMITED",
      retryAfterSeconds: 60,
    });
    await expect(service.snapshot()).rejects.toMatchObject({
      code: "TRANSACTIONS_RATE_LIMITED",
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
    now += 60000;
    await expect(service.snapshot()).rejects.toMatchObject({
      code: "TRANSACTIONS_RATE_LIMITED",
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("fails closed after the legacy sunset without making a request", async () => {
    const fetcher = vi.fn<typeof fetch>();
    await expect(
      new PublicTransactionsService({}, fetcher, () =>
        Date.parse("2026-11-24T00:00:00Z"),
      ).snapshot(),
    ).rejects.toMatchObject({ code: "TRANSACTIONS_KEY_REQUIRED" });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it.each(["quota", "fetch", "body"])(
    "times out a stalled %s even if abort is ignored",
    async (stage) => {
      vi.useFakeTimers();
      const budget = vi.fn(async () => {
        if (stage === "quota") await new Promise(() => {});
      });
      const fetcher = vi.fn<typeof fetch>(async () =>
        stage === "fetch"
          ? new Promise(() => {})
          : new Response(
              new ReadableStream({
                pull() {
                  return new Promise(() => {});
                },
                cancel() {
                  return new Promise(() => {});
                },
              }),
            ),
      );
      const pending = expect(
        new PublicTransactionsService(
          {},
          fetcher,
          () => NOW,
          budget,
        ).snapshot(),
      ).rejects.toMatchObject({ code: "TRANSACTIONS_TIMEOUT" });
      await vi.advanceTimersByTimeAsync(8001);
      await pending;
      if (stage === "quota") expect(fetcher).not.toHaveBeenCalled();
    },
  );
  it("rejects oversized bodies and invalid UTF-8", async () => {
    for (const body of [
      "x".repeat(2 * 1024 * 1024 + 1),
      new Uint8Array([0xff]),
    ]) {
      await expect(
        new PublicTransactionsService(
          {},
          async () => new Response(body),
          () => NOW,
        ).snapshot(),
      ).rejects.toMatchObject({ code: "TRANSACTIONS_INVALID_RESPONSE" });
    }
  });
});
const rawInput = (row: ReturnType<typeof providerRow>) =>
  row.data.metadata.currencyIn;
