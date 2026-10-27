// @vitest-environment jsdom
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "./App";

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("hoplane.experience", "demo");
  window.history.replaceState({}, "", "/");
  delete window.ethereum;
  window.scrollTo = vi.fn();
  delete document.documentElement.dataset.theme;
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function useDemoWallet(user: ReturnType<typeof userEvent.setup>) {
  await user.click(
    screen.getAllByRole("button", { name: "Connect wallet" })[0],
  );
  const walletDialog = screen.getByRole("dialog", { name: "Connect a wallet" });
  await user.click(
    within(walletDialog).getByRole("button", { name: "Try demo wallet" }),
  );
}

describe("Hoplane preview UI", () => {
  it("states the preview boundary before any wallet is connected", () => {
    render(<App />);
    expect(screen.getByText("Preview mode · No funds move")).toBeTruthy();
    expect(
      screen.getByRole("textbox", { name: "Amount to send" }),
    ).toHaveProperty("value", "0.1");
    expect(
      screen.queryByRole("button", { name: /sign|submit transaction/i }),
    ).toBeNull();
    expect(screen.queryByText(/Balance:/)).toBeNull();
  });

  it("runs an explicit simulation and saves one demo activity record without requesting a wallet signature", async () => {
    const request = vi.fn();
    window.ethereum = { request };
    const user = userEvent.setup();
    render(
      <StrictMode>
        <App />
      </StrictMode>,
    );
    await useDemoWallet(user);
    await user.click(screen.getByRole("button", { name: "Review preview" }));
    const review = screen.getByRole("dialog", { name: "One last look" });
    expect(
      within(review).getByText(
        /No blockchain transaction is signed or submitted/,
      ),
    ).toBeTruthy();
    await user.click(
      within(review).getByRole("button", { name: "Simulate transfer" }),
    );
    const success = await screen.findByRole(
      "dialog",
      { name: "A successful practice hop." },
      { timeout: 6000 },
    );
    expect(
      within(success).getByText("Simulation · no real funds have moved"),
    ).toBeTruthy();
    await user.click(
      within(success).getByRole("button", { name: "View activity" }),
    );
    expect(
      screen.getByRole("heading", { name: "Your activity." }),
    ).toBeTruthy();
    expect(screen.getByText("DEMO")).toBeTruthy();
    const saved = JSON.parse(localStorage.getItem("hoplane.activity")!);
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({
      mode: "demo",
      status: "completed",
      amount: "0.1",
    });
    expect(saved[0].id).toMatch(/^demo-/);
    expect(request).not.toHaveBeenCalled();
  }, 9000);

  it("requires a valid custom destination address before review", async () => {
    const user = userEvent.setup();
    render(<App />);
    await useDemoWallet(user);
    await user.click(screen.getByRole("button", { name: "Same wallet" }));
    const address = screen.getByRole("textbox", { name: /Recipient address/ });
    const review = screen.getByRole("button", { name: "Review preview" });
    expect(review).toHaveProperty("disabled", true);
    await user.type(address, "not-an-address");
    expect(screen.getByText("Enter a valid Base address.")).toBeTruthy();
    expect(review).toHaveProperty("disabled", true);
    await user.clear(address);
    await user.type(address, "0x1111111111111111111111111111111111111111");
    expect(review).toHaveProperty("disabled", false);
    await user.click(review);
    expect(
      within(screen.getByRole("dialog")).getByText("0x1111…1111"),
    ).toBeTruthy();
  });

  it("searches the token catalog and applies the selected token", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(
      screen.getByRole("button", {
        name: "Select source token: ETH on Ethereum",
      }),
    );
    const picker = screen.getByRole("dialog", { name: "You pay" });
    await user.type(
      within(picker).getByRole("textbox", { name: "Search tokens" }),
      "Tether",
    );
    expect(within(picker).queryByText("USD Coin")).toBeNull();
    await user.click(
      within(picker).getByRole("button", { name: /USDT\s*Tether USD/ }),
    );
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(
      screen.getByRole("button", {
        name: "Select source token: USDT on Ethereum",
      }),
    ).toBeTruthy();
  });

  it("blocks identical source and destination assets", async () => {
    const user = userEvent.setup();
    render(<App />);
    await useDemoWallet(user);
    await user.click(
      screen.getByRole("button", {
        name: "Select destination token: USDC on Base",
      }),
    );
    const picker = screen.getByRole("dialog", { name: "You receive" });
    await user.click(within(picker).getByRole("button", { name: "Ethereum" }));
    await user.click(
      within(picker).getByRole("button", { name: /^ETH\s*Ethereum$/ }),
    );
    expect(screen.getByRole("alert").textContent).toContain(
      "Choose a different token or destination network.",
    );
    expect(
      screen.getByRole("button", { name: "Review preview" }),
    ).toHaveProperty("disabled", true);
  });

  it("keeps fiat checkout disabled until a provider is connected", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("tab", { name: "Buy" }));
    await user.selectOptions(
      screen.getByRole("combobox", { name: "Fiat currency" }),
      "INR",
    );
    await user.click(screen.getByRole("button", { name: "Bank transfer" }));
    expect(
      screen.getByRole("combobox", { name: "Fiat currency" }),
    ).toHaveProperty("value", "INR");
    expect(
      screen.getByRole("button", { name: "Provider integration coming next" }),
    ).toHaveProperty("disabled", true);
    expect(
      screen.getByText(/Fiat purchases need a payment provider/),
    ).toBeTruthy();
    expect(screen.queryByRole("textbox", { name: /card number/i })).toBeNull();
    await user.click(screen.getByRole("tab", { name: "Sell" }));
    expect(
      screen.getByText(/Fiat withdrawals need a payment provider/),
    ).toBeTruthy();
  });

  it("filters networks and uses the chosen destination in the swap form", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("button", { name: "Explore" }));
    await user.type(
      screen.getByRole("textbox", { name: "Search networks" }),
      "Solana",
    );
    const cards = screen.getAllByRole("button", { name: /Preview a route/ });
    expect(cards).toHaveLength(1);
    await user.click(cards[0]);
    expect(
      screen.getByRole("button", {
        name: "Select destination token: USDC on Solana",
      }),
    ).toBeTruthy();
    expect(
      screen.getByRole("textbox", { name: "Amount to receive" }),
    ).toBeTruthy();
  });

  it("shows a denied wallet request and does not silently fall back to the demo account", async () => {
    const request = vi
      .fn()
      .mockRejectedValue(new Error("User rejected the request."));
    window.ethereum = { request, isMetaMask: true };
    const user = userEvent.setup();
    render(<App />);
    await user.click(
      screen.getAllByRole("button", { name: "Connect wallet" })[0],
    );
    const dialog = screen.getByRole("dialog", { name: "Connect a wallet" });
    await user.click(
      within(dialog).getByRole("button", { name: /Browser wallet/ }),
    );
    expect(await within(dialog).findByRole("alert")).toHaveProperty(
      "textContent",
      "User rejected the request.",
    );
    expect(request).toHaveBeenCalledExactlyOnceWith({
      method: "eth_requestAccounts",
    });
    expect(screen.queryByRole("button", { name: "Review preview" })).toBeNull();
    expect(screen.queryByText(/Demo wallet connected/)).toBeNull();
  });

  it("changes appearance and keeps the preference when the UI is remounted", async () => {
    const user = userEvent.setup();
    const { unmount } = render(<App />);
    await user.click(screen.getByRole("button", { name: "Swap settings" }));
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Dark theme",
      }),
    );
    await user.click(screen.getByRole("button", { name: "Save preferences" }));
    expect(document.documentElement.dataset.theme).toBe("dark");
    unmount();
    render(<App />);
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(
      screen.getByRole("button", { name: "Switch to light theme" }),
    ).toBeTruthy();
  });

  it("closes dialogs with Escape and restores focus to the initiating control", async () => {
    const user = userEvent.setup();
    render(<App />);
    const trigger = screen.getByRole("button", { name: "Swap settings" });
    await user.click(trigger);
    expect(
      screen.getByRole("dialog", { name: "Make it your own" }),
    ).toBeTruthy();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });
});

describe("Hoplane live and demo entry points", () => {
  it("defaults to live, exposes backend recovery, and only shows simulation when explicitly selected", async () => {
    localStorage.removeItem("hoplane.experience");
    const fetchMock = vi
      .fn()
      .mockRejectedValue(new Error("Service unavailable"));
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<App />);
    expect(
      screen
        .getByRole("button", { name: "Live mode" })
        .getAttribute("aria-pressed"),
    ).toBe("true");
    expect(
      await screen.findByRole("heading", {
        name: "The backend isn’t connected yet.",
      }),
    ).toBeTruthy();
    expect(screen.queryByText("Preview mode · No funds move")).toBeNull();
    expect(screen.queryByRole("button", { name: "Explore" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Connect wallet" })).toBeNull();
    expect(screen.getByRole("button", { name: "Account" })).toBeTruthy();
    const initialCalls = fetchMock.mock.calls.length;
    await user.click(screen.getByRole("button", { name: "Retry connection" }));
    expect(
      await screen.findByRole("heading", {
        name: "The backend isn’t connected yet.",
      }),
    ).toBeTruthy();
    expect(fetchMock.mock.calls.length).toBeGreaterThan(initialCalls);
    await user.click(screen.getByRole("button", { name: "Explore the demo" }));
    expect(screen.getByText("Preview mode · No funds move")).toBeTruthy();
    expect(
      screen
        .getByRole("button", { name: "Demo mode" })
        .getAttribute("aria-pressed"),
    ).toBe("true");
    expect(localStorage.getItem("hoplane.experience")).toBe("demo");
    await user.click(screen.getByRole("button", { name: "Live mode" }));
    expect(
      await screen.findByRole("heading", {
        name: "The backend isn’t connected yet.",
      }),
    ).toBeTruthy();
    expect(localStorage.getItem("hoplane.experience")).toBe("live");
    expect(screen.queryByText("Preview mode · No funds move")).toBeNull();
  });

  it("maps live header navigation to account and activity without opening demo screens", async () => {
    localStorage.setItem("hoplane.experience", "live");
    const config = {
      capabilities: {
        quotes: false,
        execution: false,
        balances: false,
        sync: false,
        fiat: false,
      },
      networks: { testnet: [], mainnet: [] },
      authChainId: 1,
      maxSlippageBps: 300,
      quoteTtlSeconds: 30,
    };
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input);
      const body = path.endsWith("/config")
        ? config
        : path.endsWith("/auth/session")
          ? { user: null }
          : { chains: [] };
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<App />);
    expect(
      await screen.findByRole("heading", { name: "Move with confidence." }),
    ).toBeTruthy();
    const bootCalls = () =>
      fetchMock.mock.calls.filter(([input]) =>
        /\/(?:config|auth\/session)$/.test(String(input)),
      ).length;
    const initialBootCalls = bootCalls();
    const nav = screen.getByRole("navigation", { name: "Main navigation" });
    await user.click(within(nav).getByRole("button", { name: "Account" }));
    expect(
      screen.getByRole("heading", { name: "Your account, across devices." }),
    ).toBeTruthy();
    expect(
      screen.queryByRole("heading", { name: "A clearer view of your assets." }),
    ).toBeNull();
    await user.click(within(nav).getByRole("button", { name: "Activity" }));
    expect(
      screen.getByRole("heading", { name: "Every real move." }),
    ).toBeTruthy();
    expect(
      screen.queryByRole("heading", { name: "Your activity." }),
    ).toBeNull();
    await user.click(within(nav).getByRole("button", { name: "Swap" }));
    expect(screen.getByRole("textbox", { name: "You pay" })).toBeTruthy();
    await user.click(screen.getByRole("tab", { name: "Activity" }));
    expect(
      within(nav).getByRole("button", { name: "Activity" }).className,
    ).toContain("active");
    await user.click(within(nav).getByRole("button", { name: "Swap" }));
    expect(screen.getByRole("textbox", { name: "You pay" })).toBeTruthy();
    expect(bootCalls()).toBe(initialBootCalls);
  });

  it("rejects an invalid stored experience and does not apply demo theme preferences in live mode", async () => {
    localStorage.setItem("hoplane.experience", "unexpected-mode");
    localStorage.setItem(
      "hoplane.settings",
      JSON.stringify({
        theme: "dark",
        slippage: "auto",
        gasTopup: false,
        testnet: true,
        deadline: 20,
      }),
    );
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("Service unavailable")),
    );
    render(<App />);
    expect(
      await screen.findByRole("heading", {
        name: "The backend isn’t connected yet.",
      }),
    ).toBeTruthy();
    expect(localStorage.getItem("hoplane.experience")).toBe("live");
    expect(document.documentElement.dataset.theme).not.toBe("dark");
  });
});

describe("Company navigation", () => {
  it("opens Blog, Brand Assets, and Jobs from the Company disclosure", async () => {
    const user = userEvent.setup();
    render(<App />);
    const company = screen.getByRole("button", { name: "Company" });
    expect(company.getAttribute("aria-expanded")).toBe("false");
    const destinations = [
      { label: "Blog", heading: "Blog", hash: "#company/blog" },
      { label: "Brand Assets", heading: "Brand assets", hash: "#company/brand" },
      { label: "Jobs", heading: "Careers", hash: "#company/jobs" },
    ];
    for (const destination of destinations) {
      await user.click(company);
      expect(company.getAttribute("aria-expanded")).toBe("true");
      const link = screen.getByRole("link", { name: destination.label });
      expect(link.getAttribute("href")).toBe(destination.hash);
      await user.click(link);
      expect(screen.getByRole("heading", { name: destination.heading, level: 1 })).toBeTruthy();
      expect(window.location.hash).toBe(destination.hash);
      expect(company.getAttribute("aria-expanded")).toBe("false");
      expect(company.className).toContain("active");
      if (destination.label === "Blog") {
        const article = document.getElementById("building-hoplane")!;
        const scrollIntoView = vi.fn();
        article.scrollIntoView = scrollIntoView;
        await user.click(screen.getByRole("link", { name: /Read the story/ }));
        expect(screen.getByRole("heading", { name: "Blog", level: 1 })).toBeTruthy();
        expect(window.location.hash).toBe("#company/blog");
        expect(scrollIntoView).toHaveBeenCalled();
      }
      await user.click(company);
      expect(screen.getByRole("link", { name: destination.label }).getAttribute("aria-current")).toBe("page");
      await user.keyboard("{Escape}");
      expect(company.getAttribute("aria-expanded")).toBe("false");
      expect(document.activeElement).toBe(company);
    }
    await user.click(screen.getByRole("button", { name: "Hoplane home" }));
    expect(window.location.hash).toBe("");
    expect(screen.getByText("Preview mode · No funds move")).toBeTruthy();
  });

  it("closes the nested mobile navigation after selection and dismisses outside clicks", async () => {
    const user = userEvent.setup();
    render(<App />);
    const toggle = screen.getByRole("button", { name: "Toggle navigation" });
    await user.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    const company = screen.getByRole("button", { name: "Company" });
    await user.click(company);
    await user.click(screen.getByRole("link", { name: "Brand Assets" }));
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(company.getAttribute("aria-expanded")).toBe("false");
    await user.click(company);
    await user.click(screen.getByRole("heading", { name: "Brand assets", level: 1 }));
    expect(company.getAttribute("aria-expanded")).toBe("false");
  });

  it("supports Company deep links in live mode without replacing them with the trading screen", () => {
    localStorage.setItem("hoplane.experience", "live");
    window.history.replaceState({}, "", "/#company/blog");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    render(<App />);
    expect(screen.getByRole("heading", { name: "Blog", level: 1 })).toBeTruthy();
    expect(screen.queryByText("Connecting to Hoplane")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
