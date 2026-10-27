// @vitest-environment jsdom
import {
  act,
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import LiveTrading from "./LiveTrading";

const ADDRESS = "0x1111111111111111111111111111111111111111";
const TOKEN = "0x2222222222222222222222222222222222222222";
const NATIVE = "0x0000000000000000000000000000000000000000";
const chains = [11155111, 84532].map((id, index) => ({
  id,
  name: index ? "Base Sepolia" : "Sepolia",
  vmType: "evm",
  currency: {
    chainId: id,
    address: NATIVE,
    symbol: "ETH",
    name: "Ether",
    decimals: 18,
  },
}));
const config = {
  capabilities: {
    quotes: true,
    execution: true,
    balances: true,
    sync: false,
    fiat: false,
  },
  networks: { testnet: chains.map((chain) => chain.id), mainnet: [] },
  authChainId: 1,
  maxSlippageBps: 300,
  quoteTtlSeconds: 30,
};
const session = {
  user: { address: ADDRESS },
  csrfToken: "test-csrf-token",
  expiresAt: Date.now() + 3600000,
};
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
const quote = (expiresAt = Date.now() + 30000) => ({
  id: "reviewed-quote",
  expiresAt,
  relayRequestId: "provider-request",
  executable: true,
  summary: {
    currencyIn: chains[0].currency,
    currencyOut: chains[1].currency,
    amountIn: "100000000000000000",
    amountOut: "99000000000000000",
    minimumAmountOut: "98000000000000000",
    feesUsd: null,
    timeEstimate: null,
  },
  transactions: [
    {
      from: ADDRESS,
      to: TOKEN,
      value: "100000000000000000",
      data: "0x",
      chainId: chains[0].id,
      stepId: "deposit",
    },
  ],
});
type Handler = (
  path: string,
  init?: RequestInit,
) => Response | Promise<Response> | undefined;
function mockApi(handler: Handler = () => undefined) {
  const fetchMock = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input).replace(/^\/api/, "");
      const custom = handler(path, init);
      if (custom) return custom;
      if (path === "/config") return json(config);
      if (path === "/auth/session") return json(session);
      if (path === "/chains?network=testnet") return json({ chains });
      if (path === "/currencies")
        return json({
          currencies: [
            {
              chainId: chains[0].id,
              address: TOKEN,
              symbol: "USDC",
              name: "USD Coin",
              decimals: 6,
            },
          ],
        });
      if (path === "/quotes") return json(quote());
      throw new Error(`Unexpected API request: ${path}`);
    },
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}
function mockWallet() {
  const request = vi.fn(async ({ method }: { method: string }) => {
    if (method === "eth_accounts" || method === "eth_requestAccounts")
      return [ADDRESS];
    throw new Error(`Unexpected wallet request: ${method}`);
  });
  window.ethereum = { request };
  return request;
}
async function ready() {
  const amount = await screen.findByRole("textbox", { name: "You pay" });
  await waitFor(() =>
    expect(
      screen.getByRole("combobox", { name: "Source network" }),
    ).toHaveProperty("value", String(chains[0].id)),
  );
  return amount;
}

beforeEach(() => {
  localStorage.clear();
  delete window.ethereum;
  vi.stubEnv("VITE_API_BASE_URL", "/api");
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("Live trading backend boundaries", () => {
  it("keeps a failed backend explicit, offers retry, and enters demo only on request", async () => {
    const user = userEvent.setup();
    const onDemo = vi.fn();
    const fetchMock = vi
      .fn()
      .mockRejectedValue(new TypeError("Network unavailable"));
    vi.stubGlobal("fetch", fetchMock);
    render(<LiveTrading onDemo={onDemo} />);
    expect(
      await screen.findByRole("heading", {
        name: "Live trading is unavailable.",
      }),
    ).toBeTruthy();
    expect(
      screen.getByText(/Live services aren’t available right now/),
    ).toBeTruthy();
    expect(onDemo).not.toHaveBeenCalled();
    expect(
      screen.queryByRole("button", { name: "Review live quote" }),
    ).toBeNull();
    await user.click(screen.getByRole("button", { name: "Retry connection" }));
    await screen.findByRole("heading", {
      name: "Live trading is unavailable.",
    });
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(onDemo).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Explore the demo" }));
    expect(onDemo).toHaveBeenCalledOnce();
  });

  it("does not offer a quote when the backend has disabled the quote capability", async () => {
    const user = userEvent.setup();
    const fetchMock = mockApi((path) =>
      path === "/config"
        ? json({
            ...config,
            capabilities: { ...config.capabilities, quotes: false },
          })
        : undefined,
    );
    render(<LiveTrading onDemo={vi.fn()} />);
    await user.type(await ready(), "0.1");
    expect(
      screen.getByRole("button", { name: "Review live quote" }),
    ).toHaveProperty("disabled", true);
    expect(
      screen.getByText(/Live quotes aren’t available in this environment yet/),
    ).toBeTruthy();
    expect(
      fetchMock.mock.calls.some(([url]) => String(url).endsWith("/quotes")),
    ).toBe(false);
  });

  it("uses the server token catalog and exact base units, surfacing backend validation", async () => {
    const user = userEvent.setup();
    mockWallet();
    const fetchMock = mockApi((path) =>
      path === "/quotes"
        ? json(
            {
              error: {
                code: "AMOUNT_TOO_LOW",
                message: "The minimum input is 2 USDC.",
                requestId: "validation-request",
              },
            },
            400,
          )
        : undefined,
    );
    render(<LiveTrading onDemo={vi.fn()} />);
    await ready();
    await user.click(
      screen.getByRole("button", { name: "Select live source token" }),
    );
    const picker = await screen.findByRole("dialog");
    await user.click(
      await within(picker).findByRole("button", { name: /USDC\s*USD Coin/ }),
    );
    await user.type(screen.getByRole("textbox", { name: "You pay" }), "1.25");
    await user.click(screen.getByRole("button", { name: "Review live quote" }));
    expect(await screen.findByRole("alert")).toHaveProperty(
      "textContent",
      expect.stringContaining("The minimum input is 2 USDC."),
    );
    const [, init] = fetchMock.mock.calls.find(([url]) =>
      String(url).endsWith("/quotes"),
    )!;
    expect(JSON.parse(String(init?.body))).toMatchObject({
      network: "testnet",
      quote: {
        user: ADDRESS,
        recipient: ADDRESS,
        originChainId: chains[0].id,
        destinationChainId: chains[1].id,
        originCurrency: TOKEN,
        amount: "1250000",
        tradeType: "EXACT_INPUT",
        slippageTolerance: "50",
        topupGas: false,
      },
    });
    expect(init?.credentials).toBe("include");
    expect(new Headers(init?.headers).get("X-CSRF-Token")).toBe(
      session.csrfToken,
    );
    expect(
      screen.queryByRole("dialog", { name: "Review your live route" }),
    ).toBeNull();
  });

  it("shows missing provider fee and duration honestly and prevents preparing an expired quote", async () => {
    const user = userEvent.setup();
    mockWallet();
    const fetchMock = mockApi((path) =>
      path === "/quotes" ? json(quote(Date.now() + 250)) : undefined,
    );
    render(<LiveTrading onDemo={vi.fn()} />);
    await user.type(await ready(), "0.1");
    await user.click(screen.getByRole("button", { name: "Review live quote" }));
    const review = await screen.findByRole("dialog", {
      name: "Review your live route",
    });
    expect(within(review).getAllByText("Unavailable")).toHaveLength(2);
    await within(review).findByText("Expired", {}, { timeout: 2000 });
    expect(
      within(review).getByRole("button", { name: "Prepare testnet transfer" }),
    ).toHaveProperty("disabled", true);
    expect(
      fetchMock.mock.calls.some(([url]) => String(url).endsWith("/prepare")),
    ).toBe(false);
  });

  it("renders per-token RPC errors without presenting a null balance as zero", async () => {
    const user = userEvent.setup();
    mockApi((path) =>
      path === "/balances"
        ? json({
            chainId: chains[0].id,
            address: ADDRESS,
            fetchedAt: Date.now(),
            assets: [
              {
                address: NATIVE,
                symbol: "ETH",
                decimals: 18,
                balance: null,
                formatted: null,
                error: {
                  code: "RPC_UNAVAILABLE",
                  message: "This network RPC is temporarily unavailable.",
                },
              },
            ],
          })
        : undefined,
    );
    render(<LiveTrading onDemo={vi.fn()} />);
    await ready();
    await user.click(screen.getByRole("tab", { name: "My account" }));
    await user.click(
      screen.getByRole("button", { name: "Load current balance" }),
    );
    expect(
      await screen.findByText("This network RPC is temporarily unavailable."),
    ).toBeTruthy();
    expect(screen.queryByText("0 ETH")).toBeNull();
  });

  it("stops authentication after a rejected signature and never switches silently to demo", async () => {
    const user = userEvent.setup();
    const onDemo = vi.fn();
    const request = vi.fn(async ({ method }: { method: string }) => {
      if (method === "eth_accounts" || method === "eth_requestAccounts")
        return [ADDRESS];
      if (method === "personal_sign")
        throw Object.assign(new Error("Signature request rejected."), {
          code: 4001,
        });
      throw new Error(`Unexpected wallet request: ${method}`);
    });
    window.ethereum = { request };
    const fetchMock = mockApi((path) => {
      if (path === "/auth/session") return json({ user: null });
      if (path === "/auth/challenge")
        return json({
          challengeId: "challenge-1",
          message: "Sign in to Hoplane. No transfer is authorized.",
          expiresAt: Date.now() + 30000,
        });
    });
    render(<LiveTrading onDemo={onDemo} />);
    await ready();
    expect(request).not.toHaveBeenCalled();
    await user.click(
      screen.getByRole("button", { name: "Connect & verify wallet" }),
    );
    expect(await screen.findByRole("alert")).toHaveProperty(
      "textContent",
      expect.stringContaining("Signature request rejected."),
    );
    expect(
      fetchMock.mock.calls.some(([url]) =>
        String(url).endsWith("/auth/verify"),
      ),
    ).toBe(false);
    expect(onDemo).not.toHaveBeenCalled();
    expect(
      screen.getByRole("button", { name: "Connect & verify wallet" }),
    ).toHaveProperty("disabled", false);
  });

  it("follows external account and activity navigation without remounting the workspace", async () => {
    const user = userEvent.setup();
    const fetchMock = mockApi((path) =>
      path === "/transfers" ? json({ transfers: [] }) : undefined,
    );
    const onDemo = vi.fn();
    const onViewChange = vi.fn();
    const { rerender } = render(
      <LiveTrading onDemo={onDemo} view="trade" onViewChange={onViewChange} />,
    );
    await ready();
    expect(
      screen.getByRole("tab", { name: "Swap & bridge", selected: true }),
    ).toBeTruthy();

    rerender(
      <LiveTrading
        onDemo={onDemo}
        view="account"
        onViewChange={onViewChange}
      />,
    );
    expect(
      await screen.findByRole("heading", {
        name: "Your account, across devices.",
      }),
    ).toBeTruthy();
    expect(
      screen.getByRole("tab", { name: "My account", selected: true }),
    ).toBeTruthy();
    expect(screen.queryByRole("textbox", { name: "You pay" })).toBeNull();

    rerender(
      <LiveTrading
        onDemo={onDemo}
        view="activity"
        onViewChange={onViewChange}
      />,
    );
    expect(
      await screen.findByRole("heading", { name: "Every real move." }),
    ).toBeTruthy();
    expect(
      screen.getByRole("tab", { name: "Activity", selected: true }),
    ).toBeTruthy();
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(([url]) =>
          String(url).endsWith("/transfers"),
        ),
      ).toBe(true),
    );
    expect(await screen.findByText("No live transfers yet.")).toBeTruthy();
    expect(
      screen.queryByRole("heading", { name: "Your account, across devices." }),
    ).toBeNull();
    await user.click(screen.getByRole("tab", { name: "Swap & bridge" }));
    expect(onViewChange).toHaveBeenLastCalledWith("trade");
    expect(
      screen.getByRole("tab", { name: "Swap & bridge", selected: true }),
    ).toBeTruthy();
  });

  it.each(["verified", "mismatched"] as const)(
    "tracks a %s transaction hash from another device without asking the wallet to send again",
    async (result) => {
      const user = userEvent.setup();
      const request = mockWallet();
      const transactionHash = `0x${"a".repeat(64)}`;
      const liveQuote = quote();
      const prepared = {
        id: "transfer-from-other-device",
        quoteId: liveQuote.id,
        network: "testnet",
        owner: ADDRESS,
        relayRequestId: liveQuote.relayRequestId,
        summary: liveQuote.summary,
        transactions: liveQuote.transactions,
        createdAt: Date.now() - 10000,
        expiresAt: liveQuote.expiresAt,
        status: "prepared",
        txHashes: [],
        inTxHashes: [],
        reportedTxHashes: [],
        verifiedTxHashes: [],
        submittedSteps: {},
      };
      const trackingPath = `/transfers/${prepared.id}/transactions`;
      const fetchMock = mockApi((path) => {
        if (path === "/transfers") return json({ transfers: [prepared] });
        if (path === `/transfers/${prepared.id}`) return json(prepared);
        if (path === trackingPath) {
          if (result === "mismatched")
            return json(
              {
                error: {
                  code: "TRANSACTION_MISMATCH",
                  message:
                    "This transaction does not match the prepared transfer.",
                  requestId: "mismatch-request",
                },
              },
              400,
            );
          return json({
            ...prepared,
            status: "submitted",
            reportedTxHashes: [transactionHash],
            verifiedTxHashes: [transactionHash],
            submittedSteps: { 0: transactionHash },
          });
        }
      });
      render(<LiveTrading onDemo={vi.fn()} />);
      await ready();
      await user.click(screen.getByRole("tab", { name: "Activity" }));
      await user.click(await screen.findByRole("button", { name: /0\.1 ETH/ }));
      expect(localStorage.getItem("hoplane.pending-broadcasts")).toBeNull();
      await user.click(
        screen.getByText("Track a transaction from another device"),
      );
      const hashInput = screen.getByRole("textbox", {
        name: "Existing transfer transaction hash",
      });
      const track = screen.getByRole("button", {
        name: "Verify and track existing transfer",
      });
      expect(track).toHaveProperty("disabled", true);
      await user.type(hashInput, transactionHash);
      await user.click(track);

      if (result === "mismatched") {
        expect(await screen.findByRole("alert")).toHaveProperty(
          "textContent",
          expect.stringContaining(
            "This transaction does not match the prepared transfer.",
          ),
        );
        expect(
          screen.getByRole("textbox", {
            name: "Existing transfer transaction hash",
          }),
        ).toHaveProperty("value", transactionHash);
        expect(localStorage.getItem("hoplane.pending-broadcasts")).toBeNull();
      } else {
        expect(
          await screen.findByText(
            "Transaction submitted. Tracking confirmation across networks.",
          ),
        ).toBeTruthy();
        expect(
          screen.queryByRole("button", {
            name: "Verify and track existing transfer",
          }),
        ).toBeNull();
      }
      const [, init] = fetchMock.mock.calls.find(([url]) =>
        String(url).endsWith(trackingPath),
      )!;
      expect(JSON.parse(String(init?.body))).toEqual({
        transactionHash,
        stepIndex: 0,
      });
      expect(new Headers(init?.headers).get("X-CSRF-Token")).toBe(
        session.csrfToken,
      );
      expect(
        fetchMock.mock.calls.filter(([url]) =>
          String(url).endsWith(trackingPath),
        ),
      ).toHaveLength(1);
      expect(request).not.toHaveBeenCalled();
      expect(
        fetchMock.mock.calls.some(([url]) =>
          /\/(prepare|authorize)$/.test(String(url)),
        ),
      ).toBe(false);
    },
  );

  it("does not request a wallet transaction after navigating away during server authorization", async () => {
    const user = userEvent.setup();
    const liveQuote = quote();
    const prepared = {
      id: "transfer-navigation-guard",
      quoteId: liveQuote.id,
      network: "testnet",
      owner: ADDRESS,
      relayRequestId: liveQuote.relayRequestId,
      summary: liveQuote.summary,
      transactions: liveQuote.transactions,
      createdAt: Date.now(),
      expiresAt: liveQuote.expiresAt,
      status: "prepared",
      txHashes: [],
      inTxHashes: [],
      reportedTxHashes: [],
      verifiedTxHashes: [],
      submittedSteps: {},
    };
    const request = vi.fn(async ({ method }: { method: string }) => {
      if (method === "eth_accounts") return [ADDRESS];
      if (method === "eth_chainId") return `0x${chains[0].id.toString(16)}`;
      if (method === "eth_estimateGas") return "0x5208";
      if (method === "eth_sendTransaction") return `0x${"b".repeat(64)}`;
      throw new Error(`Unexpected wallet request: ${method}`);
    });
    window.ethereum = { request };
    let resolveAuthorization!: (response: Response) => void;
    mockApi((path) => {
      if (path === "/quotes") return json(liveQuote);
      if (path === `/quotes/${liveQuote.id}/prepare`) return json(prepared);
      if (path === `/transfers/${prepared.id}/authorize`)
        return new Promise<Response>((resolve) => {
          resolveAuthorization = resolve;
        });
      if (path === `/transfers/${prepared.id}`) return json(prepared);
    });
    const { unmount } = render(<LiveTrading onDemo={vi.fn()} />);
    await user.type(await ready(), "0.1");
    await user.click(screen.getByRole("button", { name: "Review live quote" }));
    await user.click(
      await screen.findByRole("button", { name: "Prepare testnet transfer" }),
    );
    await user.click(
      await screen.findByRole("button", { name: "Confirm step 1 in wallet" }),
    );
    await waitFor(() => expect(resolveAuthorization).toBeTypeOf("function"));

    unmount();
    await act(async () => {
      resolveAuthorization(
        json({
          transaction: prepared.transactions[0],
          serverTime: Date.now(),
          expiresAt: prepared.expiresAt,
        }),
      );
    });
    await waitFor(() =>
      expect(
        request.mock.calls.filter(([args]) => args.method === "eth_chainId"),
      ).toHaveLength(2),
    );
    expect(
      request.mock.calls.some(
        ([args]) => args.method === "eth_sendTransaction",
      ),
    ).toBe(false);
    expect(localStorage.getItem("hoplane.uncertain-broadcasts")).toBeNull();
    expect(localStorage.getItem("hoplane.pending-broadcasts")).toBeNull();
  });

  it("discards a quote response that arrives after its input amount has changed", async () => {
    const user = userEvent.setup();
    mockWallet();
    let resolveQuote!: (response: Response) => void;
    const fetchMock = mockApi((path) =>
      path === "/quotes"
        ? new Promise<Response>((resolve) => {
            resolveQuote = resolve;
          })
        : undefined,
    );
    render(<LiveTrading onDemo={vi.fn()} />);
    const amount = await ready();
    await user.type(amount, "0.1");
    await user.click(screen.getByRole("button", { name: "Review live quote" }));
    await waitFor(() => expect(resolveQuote).toBeTypeOf("function"));
    const [, init] = fetchMock.mock.calls.find(([url]) =>
      String(url).endsWith("/quotes"),
    )!;
    await user.clear(amount);
    await user.type(amount, "0.2");
    expect(init?.signal?.aborted).toBe(true);
    await act(async () => {
      resolveQuote(json(quote()));
    });
    expect(
      screen.queryByRole("dialog", { name: "Review your live route" }),
    ).toBeNull();
    expect(screen.getByRole("textbox", { name: "You pay" })).toHaveProperty(
      "value",
      "0.2",
    );
    expect(
      screen.getByRole("button", { name: "Review live quote" }),
    ).toHaveProperty("disabled", false);
    expect(screen.getByText("Quote required")).toBeTruthy();
  });
  it("supports keyboard tab navigation with matching focus and panel labels", async () => {
    const user = userEvent.setup();
    const onViewChange = vi.fn();
    const fetchMock = mockApi((path) =>
      path === "/transfers" ? json({ transfers: [] }) : undefined,
    );
    render(<LiveTrading onDemo={vi.fn()} onViewChange={onViewChange} />);
    await ready();
    const trade = screen.getByRole("tab", { name: "Swap & bridge" });
    trade.focus();
    await user.keyboard("{ArrowRight}");
    const account = screen.getByRole("tab", {
      name: "My account",
      selected: true,
    });
    expect(document.activeElement).toBe(account);
    expect(screen.getByRole("tabpanel", { name: "My account" })).toBeTruthy();
    await user.keyboard("{End}");
    expect(document.activeElement).toBe(
      screen.getByRole("tab", { name: "Activity", selected: true }),
    );
    expect(screen.getByRole("tabpanel", { name: "Activity" })).toBeTruthy();
    await user.keyboard("{Home}");
    expect(document.activeElement).toBe(trade);
    expect(
      screen.getByRole("tabpanel", { name: "Swap & bridge" }),
    ).toBeTruthy();
    expect(onViewChange.mock.calls.map(([view]) => view)).toEqual([
      "account",
      "activity",
      "trade",
    ]);
    expect(
      fetchMock.mock.calls.filter(([url]) => String(url).endsWith("/config")),
    ).toHaveLength(1);
  });

  it("preserves a menu theme choice when saved preferences arrive later without writing the account", async () => {
    const user = userEvent.setup();
    let resolvePreferences!: (value: Response) => void;
    const preferences = new Promise<Response>((resolve) => {
      resolvePreferences = resolve;
    });
    const fetchMock = mockApi((path) => {
      if (path === "/config")
        return json({
          ...config,
          capabilities: { ...config.capabilities, sync: true },
        });
      if (path === "/preferences") return preferences;
      return undefined;
    });
    render(<LiveTrading onDemo={vi.fn()} />);
    await ready();
    await act(async () => {
      window.dispatchEvent(
        new CustomEvent("hoplane:theme-change", { detail: { theme: "dark" } }),
      );
    });
    expect(document.documentElement.dataset.theme).toBe("dark");
    await act(async () => {
      resolvePreferences(
        json({
          version: 1,
          settings: {
            theme: "light",
            slippageBps: 50,
            gasTopup: false,
            network: "testnet",
          },
          favorites: [],
        }),
      );
    });
    await user.click(screen.getByRole("button", { name: "Live preferences" }));
    expect(
      screen.getByRole("combobox", { name: "Synced appearance" }),
    ).toHaveProperty("value", "dark");
    expect(localStorage.getItem("hoplane.theme")).toBe("dark");
    expect(
      fetchMock.mock.calls.some(([, init]) => init?.method === "PUT"),
    ).toBe(false);
  });

  it("identifies an invalid recipient accessibly and blocks quote review until corrected", async () => {
    const user = userEvent.setup();
    mockApi();
    render(<LiveTrading onDemo={vi.fn()} />);
    await user.type(await ready(), "0.1");
    const review = screen.getByRole("button", { name: "Review live quote" });
    expect(review).toHaveProperty("disabled", false);
    await user.click(
      screen.getByRole("checkbox", { name: "Send to another wallet" }),
    );
    const recipient = screen.getByRole("textbox", {
      name: "Live recipient address",
    });
    await user.type(recipient, "invalid-address");
    expect(recipient.getAttribute("aria-invalid")).toBe("true");
    expect(recipient.getAttribute("aria-describedby")).toBe(
      "live-recipient-hint",
    );
    expect(review).toHaveProperty("disabled", true);
    await user.clear(recipient);
    await user.type(recipient, ADDRESS);
    expect(recipient.getAttribute("aria-invalid")).toBe("false");
    expect(review).toHaveProperty("disabled", false);
  });
  it("filters only loaded wallet history by hash, network, status and token, with clear recovery from no matches", async () => {
    const user = userEvent.setup();
    const liveQuote = quote();
    const settledHash = `0x${"a".repeat(64)}`;
    const first = {
      ...liveQuote,
      id: "eth-reference",
      createdAt: Date.now(),
      status: "success",
      txHashes: [settledHash],
      network: "testnet",
    };
    const stableIn = {
      ...chains[1].currency,
      address: TOKEN,
      symbol: "USDC",
      name: "USD Coin",
      decimals: 6,
    };
    const stableOut = { ...stableIn, chainId: chains[0].id };
    const second = {
      ...liveQuote,
      id: "usdc-reference",
      createdAt: Date.now(),
      status: "pending",
      txHashes: [],
      network: "testnet",
      summary: {
        ...liveQuote.summary,
        currencyIn: stableIn,
        currencyOut: stableOut,
        amountIn: "2000000",
        amountOut: "1990000",
      },
      transactions: [{ ...liveQuote.transactions[0], chainId: chains[1].id }],
    };
    const fetchMock = mockApi((path) =>
      path === "/transfers" ? json({ transfers: [first, second] }) : undefined,
    );
    render(<LiveTrading onDemo={vi.fn()} view="activity" />);
    await screen.findByRole("button", { name: /0.1 ETH → ETH/ });
    expect(screen.getByText(/Your latest 50 transfers/)).toBeTruthy();
    expect(screen.getByRole("button", { name: /2 USDC → USDC/ })).toBeTruthy();
    expect(screen.getByText("Completed · provider reported")).toBeTruthy();
    const search = screen.getByRole("searchbox", {
      name: "Search your transfers",
    });
    await user.type(search, settledHash);
    expect(screen.queryByRole("button", { name: /2 USDC → USDC/ })).toBeNull();
    expect(screen.getByRole("button", { name: /0.1 ETH → ETH/ })).toBeTruthy();
    await user.clear(search);
    await user.selectOptions(
      screen.getByRole("combobox", { name: "Filter source network" }),
      String(chains[1].id),
    );
    expect(screen.queryByRole("button", { name: /0.1 ETH → ETH/ })).toBeNull();
    expect(screen.getByRole("button", { name: /2 USDC → USDC/ })).toBeTruthy();
    await user.selectOptions(
      screen.getByRole("combobox", { name: "Filter destination network" }),
      String(chains[1].id),
    );
    expect(
      screen.getByRole("heading", { name: "No matching transfers." }),
    ).toBeTruthy();
    expect(screen.queryByText("No live transfers yet.")).toBeNull();
    await user.click(
      screen.getByRole("button", { name: "Show all transfers" }),
    );
    await user.selectOptions(
      screen.getByRole("combobox", { name: "Filter transfer status" }),
      "success",
    );
    expect(screen.getByRole("button", { name: /0.1 ETH → ETH/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /2 USDC → USDC/ })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Clear filters" }));
    await user.type(search, "usdc");
    expect(screen.getByRole("button", { name: /2 USDC → USDC/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /0.1 ETH → ETH/ })).toBeNull();
    await user.clear(search);
    await user.type(search, TOKEN);
    expect(screen.getByRole("button", { name: /2 USDC → USDC/ })).toBeTruthy();
    expect(
      fetchMock.mock.calls.filter(([url]) =>
        String(url).endsWith("/transfers"),
      ),
    ).toHaveLength(1);
  });
});
