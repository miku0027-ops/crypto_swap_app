// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import VaultsView from "./VaultsView";
const wallet = "0x1111111111111111111111111111111111111111";
const pool = {
  chainId: 1,
  address: wallet,
  name: "Wrapped Ether Relay Vault",
  symbol: "WETH-REL",
  assetAddress: wallet,
  decimals: 18,
  totalShares: "12000000000000000000",
  totalSharesFormatted: "12",
  totalAssets: "12000000000000000000",
  outstandingDebt: "0",
  updatedAt: 1793113181993,
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
describe("read-only vault workspace", () => {
  it("renders actual catalog shares and never offers new deposits", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        json({ pools: [pool], fetchedAt: Date.now(), truncated: false }),
      ),
    );
    render(<VaultsView onSwap={() => {}} />);
    await screen.findByText("WETH-REL");
    expect(screen.getByText("12")).toBeTruthy();
    expect(screen.getByText(/New deposits are closed/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /deposit/i })).toBeNull();
    expect(
      screen.getByRole("link", { name: /View contract/ }).getAttribute("href"),
    ).toBe(`https://etherscan.io/address/${wallet}`);
  });
  it("distinguishes provider failure from an empty position or vault balance", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        json(
          {
            error: {
              code: "VAULTS_UNAVAILABLE",
              message: "Provider unavailable",
            },
          },
          502,
        ),
      ),
    );
    render(<VaultsView onSwap={() => {}} />);
    await screen.findByRole("alert");
    expect(screen.getByText("Vault information is unavailable")).toBeTruthy();
    expect(screen.queryByText("No vaults returned")).toBeNull();
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
    expect(
      screen.getByRole("link", { name: /Open Relay vaults/ }),
    ).toBeTruthy();
  });
  it("filters the authoritative catalog and resets filters", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        json({ pools: [pool], fetchedAt: Date.now(), truncated: false }),
      ),
    );
    const user = userEvent.setup();
    render(<VaultsView onSwap={() => {}} />);
    await screen.findByText("WETH-REL");
    await user.type(
      screen.getByRole("textbox", { name: "Search vaults" }),
      "does not exist",
    );
    expect(screen.getByText("No matching vaults")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(screen.getByText("WETH-REL")).toBeTruthy();
  });
  it("requires a verified account before displaying owned positions", async () => {
    const request = vi.fn(async (input: string | URL | Request) =>
      String(input).endsWith("/auth/session")
        ? json({ user: null })
        : json({ pools: [pool], fetchedAt: Date.now(), truncated: false }),
    );
    vi.stubGlobal("fetch", request);
    const user = userEvent.setup();
    const openAccount = vi.fn();
    render(<VaultsView onSwap={() => {}} onAccount={openAccount} />);
    await screen.findByText("WETH-REL");
    screen.getByRole("tab", { name: "Top vaults" }).focus();
    await user.keyboard("{ArrowRight}");
    expect(document.activeElement).toBe(
      screen.getByRole("tab", { name: "Your positions" }),
    );
    await user.click(
      await screen.findByRole("button", { name: /Open account/ }),
    );
    expect(openAccount).toHaveBeenCalledTimes(1);
    expect(
      request.mock.calls.some(([url]) =>
        String(url).endsWith("/vaults/positions"),
      ),
    ).toBe(false);
  });
  it("shows verified-wallet shares with provider management instead of local signing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url = String(input);
        if (url.endsWith("/auth/session"))
          return json({ user: { address: wallet } });
        if (url.endsWith("/vaults/positions"))
          return json({
            positions: [
              {
                chainId: 1,
                poolAddress: wallet,
                wallet,
                shareBalance: "2000000000000000000",
                shareBalanceFormatted: "2",
                symbol: "WETH-REL",
                updatedAt: Date.now(),
              },
            ],
            fetchedAt: Date.now(),
            truncated: false,
          });
        return json({ pools: [pool], fetchedAt: Date.now(), truncated: false });
      }),
    );
    const user = userEvent.setup();
    render(<VaultsView onSwap={() => {}} />);
    await screen.findByText("WETH-REL");
    await user.click(screen.getByRole("tab", { name: "Your positions" }));
    expect(await screen.findByText("2")).toBeTruthy();
    expect(
      screen
        .getByRole("link", { name: /Manage on Relay/ })
        .getAttribute("href"),
    ).toBe("https://relay.link/vaults");
    expect(screen.queryByRole("button", { name: /withdraw|sign/i })).toBeNull();
  });
});
