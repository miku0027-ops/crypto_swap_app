import { describe, it, expect, vi } from "vitest";
import { readConfig } from "./config.js";
import { RelayService } from "./relay.js";
import { AppError } from "./errors.js";
import { ZERO_ADDRESS, parseInput, quoteInputSchema } from "./validation.js";
import type { QuoteInput } from "./validation.js";
const USER = "0x1111111111111111111111111111111111111111";
const TARGET = "0x2222222222222222222222222222222222222222";
const TOKEN = "0x3333333333333333333333333333333333333333";
const OTHER = "0x4444444444444444444444444444444444444444";
const KEY = "test-only-not-a-secret";
const REQUEST = "0x" + "a".repeat(64);
const chain = (id: number) => ({
  id,
  name: `Chain ${id}`,
  displayName: `Chain ${id}`,
  vmType: "evm",
  depositEnabled: true,
  currency: {
    symbol: "ETH",
    name: "Ethereum",
    decimals: 18,
    address: ZERO_ADDRESS,
  },
  explorerUrl: "https://explorer.example",
});
const currency = (id: number, address = ZERO_ADDRESS) => ({
  chainId: id,
  address,
  symbol: address === ZERO_ADDRESS ? "ETH" : "USDC",
  name: address === ZERO_ADDRESS ? "Ethereum" : "USD Coin",
  decimals: address === ZERO_ADDRESS ? 18 : 6,
  vmType: "evm",
  metadata: { verified: true, isNative: address === ZERO_ADDRESS },
});
const input: QuoteInput = {
  user: USER,
  originChainId: 11155111,
  destinationChainId: 84532,
  originCurrency: ZERO_ADDRESS,
  destinationCurrency: ZERO_ADDRESS,
  amount: "1000000000000000",
  tradeType: "EXACT_INPUT",
};
function quote(i: QuoteInput = input) {
  const amountOut = "900000000000000";
  return {
    requestId: REQUEST,
    details: {
      sender: i.user,
      recipient: i.recipient ?? i.user,
      currencyIn: {
        currency: currency(i.originChainId, i.originCurrency),
        amount: i.amount,
      },
      currencyOut: {
        currency: currency(i.destinationChainId, i.destinationCurrency),
        amount: amountOut,
        minimumAmount: "895500000000000",
      },
      timeEstimate: 15,
    },
    fees: { gas: { amountUsd: "0.01" }, relayer: { amountUsd: "0.02" } },
    steps: [
      {
        id: "deposit",
        kind: "transaction",
        requestId: REQUEST,
        items: [
          {
            status: "incomplete",
            data: {
              from: i.user,
              to: TARGET,
              data: "0x",
              value: i.originCurrency === ZERO_ADDRESS ? i.amount : "0",
              chainId: i.originChainId,
            },
          },
        ],
      },
    ],
  };
}
function setup(
  options: {
    body?: unknown;
    env?: NodeJS.ProcessEnv;
    now?: () => number;
    mutate?: (body: ReturnType<typeof quote>) => void;
  } = {},
) {
  const config = readConfig({
    NODE_ENV: "test",
    RELAY_API_KEY: KEY,
    ENABLE_EXECUTION: "true",
    ALLOWED_TRANSACTION_TARGETS_JSON: JSON.stringify({ "11155111": [TARGET] }),
    ...options.env,
  });
  const request = vi.fn<typeof fetch>(async (url, init) => {
    const path = new URL(String(url)).pathname;
    if (path === "/chains")
      return Response.json({
        chains: [
          chain(11155111),
          chain(84532),
          chain(1),
          { ...chain(99), vmType: "svm" },
        ],
      });
    if (path === "/currencies/v2") {
      const body = JSON.parse(String(init?.body));
      return Response.json([currency(body.chainIds[0], body.address ?? TOKEN)]);
    }
    if (path === "/quote/v2") {
      const body = options.body ?? quote(JSON.parse(String(init?.body)));
      if (options.mutate) options.mutate(body as ReturnType<typeof quote>);
      return Response.json(body);
    }
    return Response.json({
      status: "success",
      inTxHashes: [REQUEST],
      txHashes: [REQUEST],
    });
  });
  return {
    config,
    request,
    service: new RelayService(config, request, options.now),
  };
}
describe("Relay input and network boundary", () => {
  it.each(["0", "-1", "1.2", "1e18", "01", "0x123", "9".repeat(79)])(
    "rejects noncanonical or invalid amount %s",
    (amount) => {
      expect(() =>
        parseInput(quoteInputSchema, { ...input, amount }),
      ).toThrow();
    },
  );
  it("rejects unknown quote parameters and same-asset trades", () => {
    expect(() =>
      parseInput(quoteInputSchema, {
        ...input,
        callbackUrl: "http://metadata.google.internal",
      }),
    ).toThrow();
    expect(() =>
      parseInput(quoteInputSchema, {
        ...input,
        destinationChainId: input.originChainId,
      }),
    ).toThrow();
  });
  it("filters unsupported chain IDs and VM types", async () => {
    const { service } = setup();
    expect((await service.chains("testnet")).map((c) => c.id)).toEqual([
      11155111, 84532,
    ]);
  });
  it("rejects mainnet before network requests by default", async () => {
    const { service, request } = setup();
    await expect(service.chains("mainnet")).rejects.toMatchObject({
      code: "MAINNET_DISABLED",
    });
    expect(request).not.toHaveBeenCalled();
  });
  it("rejects invalid network values and request identifiers", async () => {
    const { service, request } = setup();
    await expect(
      service.chains("file:///tmp/key" as "mainnet"),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await expect(
      service.status("testnet", "../../secrets"),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(request).not.toHaveBeenCalled();
  });
  it("requires server-side key for live quotes", async () => {
    const { service, request } = setup({
      env: { RELAY_API_KEY: undefined, ENABLE_EXECUTION: "false" },
    });
    await expect(service.quote("testnet", input)).rejects.toMatchObject({
      code: "RELAY_NOT_CONFIGURED",
    });
    expect(request).not.toHaveBeenCalled();
  });
  it("rejects slippage over configured maximum before provider calls", async () => {
    const { service, request } = setup();
    await expect(
      service.quote("testnet", { ...input, slippageTolerance: "301" }),
    ).rejects.toMatchObject({ code: "SLIPPAGE_LIMIT" });
    expect(request).not.toHaveBeenCalled();
  });
  it("rejects destination gas topup when receiving native currency", async () => {
    const { service } = setup();
    await expect(
      service.quote("testnet", { ...input, topupGas: true }),
    ).rejects.toMatchObject({ code: "INVALID_GAS_TOPUP" });
  });
  it("limits currency search and rejects unknown properties", async () => {
    const { service } = setup();
    await expect(
      service.currencies("testnet", { chainIds: [11155111], limit: 51 }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await expect(
      service.currencies("testnet", {
        chainIds: [11155111],
        url: "https://evil.test",
      } as never),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });
});
describe("metadata caching and transport", () => {
  it("charges shared quota only for actual requests after cache and singleflight", async () => {
    const { config, request } = setup();
    const budget = vi.fn(async (_path: string) => {});
    const service = new RelayService(config, request, Date.now, budget);
    await Promise.all([service.chains("testnet"), service.chains("testnet")]);
    await service.chains("testnet");
    expect(budget).toHaveBeenCalledTimes(1);
    expect(budget).toHaveBeenCalledWith("/chains");
    await service.quote("testnet", input);
    await service.quote("testnet", input);
    expect(budget.mock.calls.map(([path]) => path)).toEqual([
      "/chains",
      "/quote/v2",
      "/quote/v2",
    ]);
  });
  it("propagates quota denials unchanged without calling the provider", async () => {
    const { config, request } = setup();
    const denied = new AppError(
      429,
      "SHARED_QUOTA_EXHAUSTED",
      "Retry shortly.",
      60,
    );
    const service = new RelayService(config, request, Date.now, async () => {
      throw denied;
    });
    await expect(service.chains("testnet")).rejects.toBe(denied);
    expect(request).not.toHaveBeenCalled();
  });
  it("starts provider timeout after budget admission", async () => {
    vi.useFakeTimers();
    try {
      const { config, request } = setup({ env: { RELAY_TIMEOUT_MS: "500" } });
      let release!: () => void;
      const admission = new Promise<void>((resolve) => {
        release = resolve;
      });
      const service = new RelayService(
        config,
        request,
        Date.now,
        () => admission,
      );
      const pending = service.chains("testnet");
      await vi.advanceTimersByTimeAsync(1000);
      expect(request).not.toHaveBeenCalled();
      release();
      await pending;
      expect(request.mock.calls[0][1]?.signal?.aborted).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
  it("singleflights concurrent metadata and returns independent snapshots", async () => {
    const { service, request } = setup();
    const [a, b] = await Promise.all([
      service.chains("testnet"),
      service.chains("testnet"),
    ]);
    expect(request).toHaveBeenCalledTimes(1);
    a[0].name = "changed";
    expect(b[0].name).not.toBe("changed");
    expect((await service.chains("testnet"))[0].name).not.toBe("changed");
  });
  it("refreshes expired metadata and never caches quotes", async () => {
    let now = 0;
    const { service, request } = setup({ now: () => now });
    await service.chains("testnet");
    now = 60001;
    await service.chains("testnet");
    expect(request).toHaveBeenCalledTimes(2);
    await service.quote("testnet", input);
    await service.quote("testnet", input);
    expect(
      request.mock.calls.filter(([url]) => String(url).endsWith("/quote/v2")),
    ).toHaveLength(2);
  });
  it("uses only fixed Relay hosts and never follows redirects", async () => {
    const { service, request } = setup();
    await service.quote("testnet", input);
    for (const [url, init] of request.mock.calls) {
      expect(new URL(String(url)).origin).toBe(
        "https://api.testnets.relay.link",
      );
      expect(init?.redirect).toBe("error");
      expect((init?.headers as Record<string, string>)["x-api-key"]).toBe(KEY);
    }
  });
  it("returns safe rate-limit errors and bounded retry hints", async () => {
    const service = new RelayService(
      readConfig({ NODE_ENV: "test" }),
      vi.fn(
        async () =>
          new Response("provider secret", {
            status: 429,
            headers: { "Retry-After": "9999" },
          }),
      ),
    );
    await expect(service.chains("testnet")).rejects.toMatchObject({
      status: 429,
      code: "PROVIDER_RATE_LIMIT",
      retryAfterSeconds: 300,
    });
  });
  it("never echoes provider error payloads", async () => {
    const service = new RelayService(
      readConfig({ NODE_ENV: "test" }),
      vi.fn(async () => new Response("api-key=secret", { status: 401 })),
    );
    await expect(service.chains("testnet")).rejects.toMatchObject({
      code: "PROVIDER_UNAVAILABLE",
    });
    await service
      .chains("testnet")
      .catch((e) => expect(e.message).not.toContain("secret"));
  });
  it("rejects malformed and oversized provider JSON", async () => {
    for (const body of ["not json", JSON.stringify({ chains: [] })]) {
      const headers: Record<string, string> =
        body === "not json" ? {} : { "content-length": "99999999" };
      const service = new RelayService(
        readConfig({ NODE_ENV: "test" }),
        vi.fn(async () => new Response(body, { headers })),
      );
      await expect(service.chains("testnet")).rejects.toMatchObject({
        code: "INVALID_PROVIDER_RESPONSE",
      });
    }
  });
  it("times out upstream requests and cleans pending cache work", async () => {
    const config = readConfig({ NODE_ENV: "test", RELAY_TIMEOUT_MS: "500" });
    const request = vi.fn<typeof fetch>(
      (_url, init) =>
        new Promise((_resolve, reject) =>
          init?.signal?.addEventListener("abort", () =>
            reject(new Error("aborted")),
          ),
        ),
    );
    const service = new RelayService(config, request);
    await expect(service.chains("testnet")).rejects.toMatchObject({
      code: "PROVIDER_TIMEOUT",
    });
    expect(request).toHaveBeenCalledTimes(1);
  });
});
describe("binding quotes to user intent", () => {
  it("normalizes amount strings with full token precision and expiration", async () => {
    const { service } = setup({ now: () => 1000 });
    const result = await service.quote("testnet", input);
    expect(result.expiresAt).toBe(31000);
    expect(result.input.recipient).toBe(USER);
    expect(result.input.slippageTolerance).toBe("50");
    expect(result.summary.amountInFormatted).toBe("0.001");
    expect(result.summary.feesUsd).toBe("0.030000");
    expect(result.executable).toBe(true);
    expect(result.transactions).toHaveLength(1);
    expect(result.quote).not.toHaveProperty("steps");
  });
  it.each(["sender", "recipient"])("rejects mismatched %s", async (field) => {
    const { service } = setup({
      mutate: (body) => {
        body.details[field as "sender"] = OTHER;
      },
    });
    await expect(service.quote("testnet", input)).rejects.toMatchObject({
      code: "INVALID_PROVIDER_RESPONSE",
    });
  });
  it("rejects different token chain, address, or decimals", async () => {
    for (const field of ["chainId", "address", "decimals"]) {
      const { service } = setup({
        mutate: (body) => {
          const c = body.details.currencyOut.currency as Record<
            string,
            unknown
          >;
          c[field] = field === "address" ? OTHER : field === "chainId" ? 1 : 6;
        },
      });
      await expect(service.quote("testnet", input)).rejects.toMatchObject({
        code: "INVALID_PROVIDER_RESPONSE",
      });
    }
  });
  it("rejects provider input amount changes and min-output violation", async () => {
    for (const mutate of [
      (body: ReturnType<typeof quote>) => {
        body.details.currencyIn.amount = "1";
      },
      (body: ReturnType<typeof quote>) => {
        body.details.currencyOut.minimumAmount = "1";
      },
    ]) {
      const { service } = setup({ mutate });
      await expect(service.quote("testnet", input)).rejects.toMatchObject({
        code: "INVALID_PROVIDER_RESPONSE",
      });
    }
  });
  it("rejects inconsistent request IDs", async () => {
    const { service } = setup({
      mutate: (body) => {
        body.steps[0].requestId = "other";
      },
    });
    await expect(service.quote("testnet", input)).rejects.toMatchObject({
      code: "INVALID_PROVIDER_RESPONSE",
    });
  });
  it("accepts a step-level request ID when top-level is omitted", async () => {
    const body = quote();
    delete (body as Partial<typeof body>).requestId;
    const { service } = setup({ body });
    expect((await service.quote("testnet", input)).relayRequestId).toBe(
      REQUEST,
    );
  });
});
describe("execution transaction policy", () => {
  it("keeps valid quotes nonexecutable when execution is disabled", async () => {
    const { service } = setup({ env: { ENABLE_EXECUTION: "false" } });
    const result = await service.quote("testnet", input);
    expect(result.executable).toBe(false);
    expect(result.transactions).toEqual([]);
  });
  it("keeps unknown target and signature routes nonexecutable", async () => {
    for (const mutate of [
      (body: ReturnType<typeof quote>) => {
        body.steps[0].items[0].data.to = OTHER;
      },
      (body: ReturnType<typeof quote>) => {
        body.steps[0].kind = "signature";
      },
    ]) {
      const { service } = setup({ mutate });
      const result = await service.quote("testnet", input);
      expect(result.executable).toBe(false);
      expect(result.transactions).toEqual([]);
    }
  });
  it.each(["from", "chainId", "value", "data"])(
    "rejects malformed or excess transaction %s",
    async (field) => {
      const { service } = setup({
        mutate: (body) => {
          const tx = body.steps[0].items[0].data as Record<string, unknown>;
          tx[field] =
            field === "from"
              ? OTHER
              : field === "chainId"
                ? 1
                : field === "value"
                  ? "9999999999999999"
                  : "0xzz";
        },
      });
      await expect(service.quote("testnet", input)).rejects.toMatchObject({
        code: "INVALID_PROVIDER_RESPONSE",
      });
    },
  );
  it("applies the native value cap to aggregate transactions", async () => {
    const { service } = setup({
      mutate: (body) => {
        body.steps.push(structuredClone(body.steps[0]));
      },
    });
    await expect(service.quote("testnet", input)).rejects.toMatchObject({
      code: "INVALID_PROVIDER_RESPONSE",
    });
  });
  it("blocks approvals without a supported audited pull/deposit decoder", async () => {
    const tokenInput: QuoteInput = {
      ...input,
      originCurrency: TOKEN,
      amount: "1000000",
    };
    const body = quote(tokenInput);
    const approve =
      "0x095ea7b3" +
      TARGET.slice(2).padStart(64, "0") +
      BigInt(tokenInput.amount).toString(16).padStart(64, "0");
    body.steps.unshift({
      id: "approve",
      kind: "transaction",
      requestId: REQUEST,
      items: [
        {
          status: "incomplete",
          data: {
            from: USER,
            to: TOKEN,
            data: approve,
            value: "0",
            chainId: input.originChainId,
          },
        },
      ],
    });
    const { service } = setup({ body });
    const result = await service.quote("testnet", tokenInput);
    expect(result.executable).toBe(false);
    expect(result.transactions).toHaveLength(0);
  });
  it("allows only exact ERC20 transfers to an approved deposit address", async () => {
    const tokenInput: QuoteInput = {
      ...input,
      originCurrency: TOKEN,
      amount: "1000000",
    };
    const body = quote(tokenInput);
    body.steps[0].items[0].data = {
      from: USER,
      to: TOKEN,
      data:
        "0xa9059cbb" +
        TARGET.slice(2).padStart(64, "0") +
        BigInt(tokenInput.amount).toString(16).padStart(64, "0"),
      value: "0",
      chainId: input.originChainId,
    };
    const { service } = setup({ body });
    const result = await service.quote("testnet", tokenInput);
    expect(result.executable).toBe(true);
    expect(result.transactions).toHaveLength(1);
  });
  it("blocks opaque calldata even when the target is approved", async () => {
    const { service } = setup({
      mutate: (body) => {
        body.steps[0].items[0].data.data = "0xdeadbeef";
      },
    });
    const result = await service.quote("testnet", input);
    expect(result.executable).toBe(false);
    expect(result.executionBlockReason).toContain("decoder");
    expect(result.transactions).toEqual([]);
  });
  it("rejects underfunded native deposits", async () => {
    const { service } = setup({
      mutate: (body) => {
        body.steps[0].items[0].data.value = "1";
      },
    });
    await expect(service.quote("testnet", input)).rejects.toMatchObject({
      code: "INVALID_PROVIDER_RESPONSE",
    });
  });
  it("rejects repeated token transfers and unexpected token amounts", async () => {
    const tokenInput: QuoteInput = {
      ...input,
      originCurrency: TOKEN,
      amount: "1000000",
    };
    for (const duplicated of [true, false]) {
      const body = quote(tokenInput);
      body.steps[0].items[0].data = {
        from: USER,
        to: TOKEN,
        data:
          "0xa9059cbb" +
          TARGET.slice(2).padStart(64, "0") +
          BigInt(duplicated ? tokenInput.amount : "1")
            .toString(16)
            .padStart(64, "0"),
        value: "0",
        chainId: input.originChainId,
      };
      if (duplicated) body.steps.push(structuredClone(body.steps[0]));
      const { service } = setup({ body });
      await expect(service.quote("testnet", tokenInput)).rejects.toMatchObject({
        code: "INVALID_PROVIDER_RESPONSE",
      });
    }
  });
  it("blocks token transfers to unapproved addresses", async () => {
    const tokenInput: QuoteInput = {
      ...input,
      originCurrency: TOKEN,
      amount: "1000000",
    };
    const body = quote(tokenInput);
    body.steps[0].items[0].data = {
      from: USER,
      to: TOKEN,
      data:
        "0xa9059cbb" +
        OTHER.slice(2).padStart(64, "0") +
        BigInt(tokenInput.amount).toString(16).padStart(64, "0"),
      value: "0",
      chainId: input.originChainId,
    };
    const { service } = setup({ body });
    expect((await service.quote("testnet", tokenInput)).executable).toBe(false);
  });
  it("rejects unlimited approvals", async () => {
    const tokenInput: QuoteInput = {
      ...input,
      originCurrency: TOKEN,
      amount: "1000000",
    };
    const body = quote(tokenInput);
    body.steps[0].items[0].data = {
      from: USER,
      to: TOKEN,
      data: "0x095ea7b3" + TARGET.slice(2).padStart(64, "0") + "f".repeat(64),
      value: "0",
      chainId: input.originChainId,
    };
    const { service } = setup({ body });
    await expect(service.quote("testnet", tokenInput)).rejects.toMatchObject({
      code: "INVALID_PROVIDER_RESPONSE",
    });
  });
  it("does not forward provider gas limits or extra properties to the wallet", async () => {
    const body = quote();
    Object.assign(body.steps[0].items[0].data, {
      gas: "99999999",
      nonce: "4",
      authorizationList: [{ address: OTHER }],
    });
    const { service } = setup({ body });
    const { transactions } = await service.quote("testnet", input);
    expect(Object.keys(transactions[0]).sort()).toEqual([
      "chainId",
      "data",
      "from",
      "stepId",
      "to",
      "value",
    ]);
  });
});
describe("intent status", () => {
  it("returns validated receipt identifiers and lifecycle status", async () => {
    const { service } = setup();
    expect(await service.status("testnet", REQUEST)).toEqual({
      status: "success",
      inTxHashes: [REQUEST],
      txHashes: [REQUEST],
    });
  });
  it("rejects unknown lifecycle or invalid transaction hashes", async () => {
    for (const value of [
      { status: "paid", txHashes: [] },
      { status: "success", txHashes: ["javascript:alert(1)"] },
    ]) {
      const service = new RelayService(
        readConfig({ NODE_ENV: "test" }),
        vi.fn(async () => Response.json(value)),
      );
      await expect(service.status("testnet", REQUEST)).rejects.toMatchObject({
        code: "INVALID_PROVIDER_RESPONSE",
      });
    }
  });
});
