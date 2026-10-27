// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import VaultsView from "./VaultsView";

const wallet = "0x1111111111111111111111111111111111111111";
const otherWallet = "0x2222222222222222222222222222222222222222";
const ethereumVault = "0x57b68c4ea221ee8da6eb14ebdfccee5177567771";
const arbitrumVault = "0xc7273772b87860097373d91b3880fd4cc61fba2d";
const now = Date.now();
const pool = {
  chainId: 1,
  address: ethereumVault,
  name: "Wrapped Ether Relay Vault",
  symbol: "WETH-REL",
  assetAddress: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
  assetSymbol: "ETH",
  assetDecimals: 18,
  decimals: 18,
  totalShares: "12000000000000000000",
  totalSharesFormatted: "12",
  totalAssets: "12000000000000000000",
  totalAssetsFormatted: "12",
  outstandingDebt: "0",
  tvlUsd: null as string | null,
  apyPercent: null as string | null,
  updatedAt: now,
  metricsUpdatedAt: now,
  priceFetchedAt: null,
  priceSource: null,
  metricsSource: "https://vaults-api.relay.link/",
  metadataSource: "https://docs.relay.link/references/protocol/vaults/overview",
  dataStale: false,
};
const position = {
  chainId: 1,
  poolAddress: ethereumVault,
  wallet,
  shareBalance: "2000000000000000000",
  shareBalanceFormatted: "2",
  indexUpdatedAt: now,
  symbol: "WETH-REL",
  updatedAt: now,
  dataStale: false,
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
const catalog = (pools = [pool]) => ({
  pools,
  fetchedAt: now,
  truncated: false,
});
const holdings = () => ({
  positions: [position],
  fetchedAt: now,
  truncated: false,
});
const signedIn = (address = wallet, expiresAt = Date.now() + 3_600_000) => ({
  user: { address },
  csrfToken: "a".repeat(64),
  expiresAt,
});
const unavailable = () =>
  json(
    { error: { code: "VAULTS_UNAVAILABLE", message: "Provider unavailable" } },
    502,
  );
function mockRequests({
  catalogResponse = () => json(catalog()),
  sessionResponse = () => json({ user: null }),
  positionsResponse = () => json(holdings()),
}: {
  catalogResponse?: () => Response | Promise<Response>;
  sessionResponse?: () => Response | Promise<Response>;
  positionsResponse?: () => Response | Promise<Response>;
} = {}) {
  const request = vi.fn(async (input: RequestInfo | URL) => {
    const path = String(input);
    if (path.endsWith("/auth/session")) return sessionResponse();
    if (path.endsWith("/vaults/positions")) return positionsResponse();
    if (path.endsWith("/vaults")) return catalogResponse();
    throw new Error(`Unexpected API request: ${path}`);
  });
  vi.stubGlobal("fetch", request);
  return request;
}
function walletEvents() {
  const listeners = new Set<(accounts: string[]) => void>();
  const request = vi.fn(
    async (_args: { method: string; params?: unknown[] }) => [wallet],
  );
  window.ethereum = {
    request,
    on: (event, listener) => {
      if (event === "accountsChanged") listeners.add(listener);
    },
    removeListener: (event, listener) => {
      if (event === "accountsChanged") listeners.delete(listener);
    },
  };
  return {
    request,
    emit: (accounts: string[]) =>
      act(() => listeners.forEach((listener) => listener(accounts))),
  };
}
const vaultButtons = () =>
  within(screen.getByRole("table")).getAllByRole("button", {
    name: /^View .* vault on /,
  });
const vaultOrder = () =>
  vaultButtons().map((button) => button.getAttribute("aria-label"));

afterEach(() => {
  cleanup();
  delete window.ethereum;
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("vault positions and catalog", () => {
  it("shows both sections immediately and explains how to connect without an installed wallet", async () => {
    const request = mockRequests();
    const user = userEvent.setup();
    const onAccount = vi.fn();
    render(<VaultsView onSwap={() => {}} onAccount={onAccount} />);
    expect(
      screen.getByRole("heading", { name: /^Your positions$/i }),
    ).toBeTruthy();
    expect(screen.getByRole("heading", { name: /^Top vaults$/i })).toBeTruthy();
    expect(screen.queryByRole("tablist")).toBeNull();
    await screen.findByRole("button", {
      name: /View (WETH|ETH) vault on Ethereum/,
    });
    await user.click(
      await screen.findByRole("button", {
        name: /Connect.*wallet|Connect.*sign in/i,
      }),
    );
    expect(onAccount).not.toHaveBeenCalled();
    expect(
      screen.getByText(/Open Hoplane in your wallet browser/i),
    ).toBeTruthy();
    expect(
      request.mock.calls.some(([url]) => String(url).endsWith("/auth/session")),
    ).toBe(true);
    expect(
      request.mock.calls.some(([url]) =>
        String(url).endsWith("/vaults/positions"),
      ),
    ).toBe(false);
    expect(
      screen.queryByRole("button", {
        name: /deposit|withdraw|sign transaction/i,
      }),
    ).toBeNull();
  });

  it("keeps verified positions visible if the catalog fails and labels reference metrics unavailable", async () => {
    mockRequests({
      catalogResponse: unavailable,
      sessionResponse: () => json(signedIn()),
    });
    render(<VaultsView onSwap={() => {}} />);
    await screen.findByText("2");
    expect(
      await screen.findByText(/Reference vaults.*live data unavailable/i),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: /View (WETH|ETH) vault on Ethereum/ }),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: /View (WETH|ETH) vault on Arbitrum/ }),
    ).toBeTruthy();
    expect(screen.queryByText("$0.00")).toBeNull();
    expect(screen.queryByText("0%")).toBeNull();
    for (const row of within(screen.getByRole("table"))
      .getAllByRole("row")
      .slice(1)) {
      const metricCells = within(row).getAllByRole("cell").slice(0, 2);
      for (const cell of metricCells)
        expect(cell.textContent).not.toMatch(/\d/);
    }
    expect(screen.queryByText(/No positions/i)).toBeNull();
  });

  it("keeps the catalog available when positions fail without reporting a zero balance", async () => {
    mockRequests({
      sessionResponse: () => json(signedIn()),
      positionsResponse: unavailable,
    });
    render(<VaultsView onSwap={() => {}} />);
    await screen.findByRole("button", {
      name: /View (WETH|ETH) vault on Ethereum/,
    });
    expect(
      await screen.findByText(
        /Positions.*unavailable|Unable to load.*positions/i,
      ),
    ).toBeTruthy();
    expect(screen.queryByText(/No positions/i)).toBeNull();
    expect(screen.queryByText("$0.00")).toBeNull();
  });

  it("does not present unavailable account verification as a disconnected or empty account", async () => {
    mockRequests({ sessionResponse: unavailable });
    render(<VaultsView onSwap={() => {}} />);
    await screen.findByRole("button", {
      name: /View (WETH|ETH) vault on Ethereum/,
    });
    expect(
      await screen.findByText(
        /Account.*unavailable|Unable to verify.*account|Positions.*unavailable/i,
      ),
    ).toBeTruthy();
    expect(screen.queryByText(/No positions/i)).toBeNull();
  });

  it("filters by network and search and restores the complete catalog", async () => {
    mockRequests({
      catalogResponse: () =>
        json(
          catalog([pool, { ...pool, chainId: 42161, address: arbitrumVault }]),
        ),
    });
    const user = userEvent.setup();
    render(<VaultsView onSwap={() => {}} />);
    await screen.findByRole("button", {
      name: /View (WETH|ETH) vault on Arbitrum/,
    });
    await user.selectOptions(
      screen.getByRole("combobox", { name: "Filter vaults by network" }),
      "42161",
    );
    expect(vaultOrder()).toEqual(["View ETH vault on Arbitrum"]);
    await user.type(
      screen.getByRole("textbox", { name: "Search vaults" }),
      "not-a-vault",
    );
    expect(screen.getByText("No matching vaults")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(vaultButtons()).toHaveLength(2);
  });

  it("sorts decimal metrics beyond number precision and keeps unknowns last in both directions", async () => {
    const metricPools = [
      {
        ...pool,
        assetSymbol: "LOW",
        tvlUsd: "9007199254740992.000000000000000001",
        apyPercent: "1.000000000000000001",
      },
      { ...pool, address: otherWallet, assetSymbol: "UNKNOWN" },
      {
        ...pool,
        address: wallet,
        assetSymbol: "HIGH",
        tvlUsd: "9007199254740992.000000000000000002",
        apyPercent: "1.000000000000000002",
      },
    ];
    mockRequests({ catalogResponse: () => json(catalog(metricPools)) });
    const user = userEvent.setup();
    render(<VaultsView onSwap={() => {}} />);
    await screen.findByRole("button", { name: "View HIGH vault on Ethereum" });
    for (const metric of ["TVL", "APY"]) {
      const sort = screen.getByRole("button", { name: `Sort by ${metric}` });
      await user.click(sort);
      const firstDirection = sort.closest("th")?.getAttribute("aria-sort");
      expect(["ascending", "descending"]).toContain(firstDirection);
      const ascending = [
        "View LOW vault on Ethereum",
        "View HIGH vault on Ethereum",
        "View UNKNOWN vault on Ethereum",
      ];
      const descending = [ascending[1], ascending[0], ascending[2]];
      expect(vaultOrder()).toEqual(
        firstDirection === "ascending" ? ascending : descending,
      );
      await user.click(sort);
      expect(sort.closest("th")?.getAttribute("aria-sort")).toBe(
        firstDirection === "ascending" ? "descending" : "ascending",
      );
      expect(vaultOrder()).toEqual(
        firstDirection === "ascending" ? descending : ascending,
      );
    }
  });

  it("keeps negative yields distinct from unavailable APY and sorts them numerically", async () => {
    mockRequests({
      catalogResponse: () =>
        json(
          catalog([
            { ...pool, assetSymbol: "LOW", apyPercent: "-0.12" },
            { ...pool, address: otherWallet, assetSymbol: "UNKNOWN" },
            {
              ...pool,
              address: wallet,
              assetSymbol: "NEAR",
              apyPercent: "-0.11",
            },
            {
              ...pool,
              address: "0x3333333333333333333333333333333333333333",
              assetSymbol: "ZERO",
              apyPercent: "0",
            },
          ]),
        ),
    });
    const user = userEvent.setup();
    render(<VaultsView onSwap={() => {}} />);
    await screen.findByRole("button", { name: "View LOW vault on Ethereum" });
    const sort = screen.getByRole("button", { name: "Sort by APY" });
    sort.focus();
    await user.keyboard("{Enter}");
    expect(screen.getByText("-0.12%")).toBeTruthy();
    expect(vaultOrder()).toEqual([
      "View ZERO vault on Ethereum",
      "View NEAR vault on Ethereum",
      "View LOW vault on Ethereum",
      "View UNKNOWN vault on Ethereum",
    ]);
    await user.keyboard("{Enter}");
    expect(vaultOrder()).toEqual([
      "View LOW vault on Ethereum",
      "View NEAR vault on Ethereum",
      "View ZERO vault on Ethereum",
      "View UNKNOWN vault on Ethereum",
    ]);
  });

  it("opens contract details with keyboard, copies the exact contract, and restores focus on Escape", async () => {
    mockRequests();
    const user = userEvent.setup();
    const copy = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();
    render(<VaultsView onSwap={() => {}} />);
    const row = await screen.findByRole("button", {
      name: "View ETH vault on Ethereum",
    });
    row.focus();
    await user.keyboard("{Enter}");
    const dialog = screen.getByRole("dialog", { name: "Vault details" });
    expect(within(dialog).getByText(ethereumVault)).toBeTruthy();
    expect(
      within(dialog)
        .getByRole("link", { name: /View contract|Explorer/i })
        .getAttribute("href"),
    ).toBe(`https://etherscan.io/address/${ethereumVault}`);
    expect(within(dialog).getByText("Last index update")).toBeTruthy();
    expect(
      within(dialog)
        .getByRole("link", { name: "Relay vault index" })
        .getAttribute("href"),
    ).toBe("https://vaults-api.relay.link/");
    expect(
      within(dialog).getByText("Last fetched").nextElementSibling?.textContent,
    ).toBe(new Date(now).toLocaleString());
    await user.click(
      within(dialog).getByRole("button", { name: "Copy vault contract" }),
    );
    expect(copy).toHaveBeenCalledWith(ethereumVault);
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(row);
  });

  it("allows dismissing the retirement explanation while keeping withdrawal-only status visible", async () => {
    mockRequests();
    const user = userEvent.setup();
    render(<VaultsView onSwap={() => {}} />);
    await screen.findByRole("button", {
      name: /View (WETH|ETH) vault on Ethereum/,
    });
    await user.click(
      screen.getByRole("button", { name: "Dismiss retirement notice" }),
    );
    expect(
      screen.queryByRole("button", { name: "Dismiss retirement notice" }),
    ).toBeNull();
    expect(screen.getByText(/Withdrawals only/i)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /deposit/i })).toBeNull();
  });

  it("marks stale indexed data instead of implying a fresh live position", async () => {
    mockRequests({
      catalogResponse: () => json(catalog([{ ...pool, dataStale: true }])),
    });
    render(<VaultsView onSwap={() => {}} />);
    await screen.findByRole("button", {
      name: /View (WETH|ETH) vault on Ethereum/,
    });
    expect(
      screen.getAllByText(/Index data over 1h old|Older index data/i).length,
    ).toBeGreaterThan(0);
  });

  it("rejects positions belonging to a different authenticated wallet", async () => {
    mockRequests({
      sessionResponse: () => json(signedIn()),
      positionsResponse: () =>
        json({
          ...holdings(),
          positions: [{ ...position, wallet: otherWallet }],
        }),
    });
    render(<VaultsView onSwap={() => {}} />);
    await screen.findByRole("heading", { name: "Positions are unavailable" });
    expect(screen.queryByText("2")).toBeNull();
    expect(
      screen.getByRole("button", { name: "View ETH vault on Ethereum" }),
    ).toBeTruthy();
  });

  it("does not load a saved session's positions when the wallet changed while this view was closed", async () => {
    window.ethereum = { request: vi.fn(async () => [otherWallet]) };
    const request = mockRequests({ sessionResponse: () => json(signedIn()) });
    render(<VaultsView onSwap={() => {}} />);
    await screen.findByRole("button", { name: "Connect Wallet" });
    expect(
      request.mock.calls.some(([url]) =>
        String(url).endsWith("/vaults/positions"),
      ),
    ).toBe(false);
    expect(screen.queryByText("2")).toBeNull();
    expect(
      screen.getByRole("button", { name: "View ETH vault on Ethereum" }),
    ).toBeTruthy();
  });

  it("refuses to restore wallet positions when the provider has no connected accounts", async () => {
    const providerRequest = vi.fn(async () => []);
    window.ethereum = { request: providerRequest };
    const request = mockRequests({ sessionResponse: () => json(signedIn()) });
    render(<VaultsView onSwap={() => {}} />);
    await screen.findByRole("button", { name: "Connect Wallet" });
    expect(providerRequest).toHaveBeenCalledWith({ method: "eth_accounts" });
    expect(
      request.mock.calls.some(([url]) =>
        String(url).endsWith("/vaults/positions"),
      ),
    ).toBe(false);
    expect(screen.queryByText("2")).toBeNull();
  });

  it("rechecks the current provider after a delayed response even without an account-change event", async () => {
    let finishPositions!: (response: Response) => void;
    let finishRecheck!: (accounts: string[]) => void;
    const pendingPositions = new Promise<Response>((resolve) => {
      finishPositions = resolve;
    });
    const pendingRecheck = new Promise<string[]>((resolve) => {
      finishRecheck = resolve;
    });
    const providerRequest = vi
      .fn()
      .mockResolvedValueOnce([wallet])
      .mockImplementationOnce(() => pendingRecheck);
    // This provider deliberately has no event listener API.
    window.ethereum = { request: providerRequest };
    const request = mockRequests({
      sessionResponse: () => json(signedIn()),
      positionsResponse: () => pendingPositions,
    });
    render(<VaultsView onSwap={() => {}} />);
    await waitFor(() =>
      expect(
        request.mock.calls.some(([url]) =>
          String(url).endsWith("/vaults/positions"),
        ),
      ).toBe(true),
    );
    expect(providerRequest).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("2")).toBeNull();
    await act(async () => {
      finishPositions(json(holdings()));
      await pendingPositions;
    });
    await waitFor(() => expect(providerRequest).toHaveBeenCalledTimes(2));
    // The old wallet's response must remain hidden while identity is rechecked.
    expect(screen.queryByText("2")).toBeNull();
    await act(async () => {
      finishRecheck([otherWallet]);
      await pendingRecheck;
    });
    await screen.findByRole("button", { name: "Connect Wallet" });
    expect(screen.queryByText("2")).toBeNull();
    expect(
      providerRequest.mock.calls.every(
        ([args]) => args.method === "eth_accounts",
      ),
    ).toBe(true);
  });

  it("clears visible positions immediately when the connected wallet changes", async () => {
    const provider = walletEvents();
    mockRequests({ sessionResponse: () => json(signedIn()) });
    render(<VaultsView onSwap={() => {}} />);
    await screen.findByText("2");
    provider.emit([otherWallet]);
    expect(screen.queryByText("2")).toBeNull();
    expect(
      provider.request.mock.calls.every(
        ([args]) =>
          !/sign|sendTransaction/.test(
            String((args as { method?: string })?.method),
          ),
      ),
    ).toBe(true);
  });

  it("discards an old wallet position response that arrives after an account change", async () => {
    const provider = walletEvents();
    let finish!: (response: Response) => void;
    const pending = new Promise<Response>((resolve) => {
      finish = resolve;
    });
    const request = mockRequests({
      sessionResponse: () => json(signedIn()),
      positionsResponse: () => pending,
    });
    render(<VaultsView onSwap={() => {}} />);
    await waitFor(() =>
      expect(
        request.mock.calls.some(([url]) =>
          String(url).endsWith("/vaults/positions"),
        ),
      ).toBe(true),
    );
    provider.emit([otherWallet]);
    await act(async () => {
      finish(json(holdings()));
      await pending;
    });
    expect(screen.queryByText("2")).toBeNull();
  });

  it("removes wallet positions when the authenticated session expires", async () => {
    vi.useFakeTimers();
    mockRequests({
      sessionResponse: () => json(signedIn(wallet, Date.now() + 5_000)),
    });
    render(<VaultsView onSwap={() => {}} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(screen.getByText("2")).toBeTruthy();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    expect(screen.queryByText("2")).toBeNull();
  });
});
