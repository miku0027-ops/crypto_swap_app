// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  render,
  screen,
  within,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ResourceView from "./ResourceViews";
import { RELAY_DOCS } from "../lib/relay-reference";
const wallet = "0x1111111111111111111111111111111111111111";
const onNavigate = vi.fn(),
  onAccount = vi.fn();
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json({ user: null })));
  onNavigate.mockReset();
  onAccount.mockReset();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
const view = (page: string) =>
  render(
    <ResourceView page={page} onNavigate={onNavigate} onAccount={onAccount} />,
  );
describe("resource journeys", () => {
  it("indexes every published reference, filters by topic and search, and restores an empty result", async () => {
    const user = userEvent.setup();
    view("documentation");
    expect(screen.getAllByRole("link")).toHaveLength(RELAY_DOCS.length);
    for (const link of screen.getAllByRole("link"))
      expect(link.getAttribute("href")).toMatch(
        /^https:\/\/docs\.relay\.link\//,
      );
    await user.selectOptions(
      screen.getByRole("combobox", { name: "Documentation topic" }),
      "Vaults",
    );
    expect(screen.getAllByRole("link")).toHaveLength(
      RELAY_DOCS.filter((d) => d.category === "Vaults").length,
    );
    await user.type(
      screen.getByRole("textbox", { name: "Search documentation" }),
      "nothing-will-match-this",
    );
    expect(
      screen.getByRole("heading", { name: "No matching references" }),
    ).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(screen.getAllByRole("link")).toHaveLength(RELAY_DOCS.length);
  });
  it("shows only API provider references alongside the independent Hoplane backend contract", () => {
    view("api-reference");
    expect(
      screen
        .getByRole("link", { name: "Read our API contract" })
        .getAttribute("href"),
    ).toContain("crypto_swap_app/blob/main/docs/BACKEND.md");
    expect(screen.getAllByRole("link")).toHaveLength(
      RELAY_DOCS.filter((d) => d.category === "API").length + 1,
    );
  });
  it("does not construct explorer links for invalid input and changes the destination network safely", async () => {
    const user = userEvent.setup();
    view("explorer");
    const input = screen.getByRole("textbox", {
      name: "Transaction hash or address",
    });
    await user.type(input, "javascript:alert(1)");
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(screen.queryByRole("link", { name: "View on Ethereum" })).toBeNull();
    await user.clear(input);
    await user.type(input, `0x${"ab".repeat(32)}`);
    await user.selectOptions(
      screen.getByRole("combobox", { name: "Explorer network" }),
      "8453",
    );
    expect(
      screen.getByRole("link", { name: "View on Base" }).getAttribute("href"),
    ).toBe(`https://basescan.org/tx/0x${"ab".repeat(32)}`);
  });
  it("requires real sign-in for app funds without showing demo balances", async () => {
    const user = userEvent.setup();
    view("app-balance");
    await screen.findByRole("heading", {
      name: "Sign in to view your balance",
    });
    expect(screen.getByText("Relay mainnet balances")).toBeTruthy();
    expect(screen.queryByText("$0.00")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Connect & sign in" }));
    expect(onAccount).toHaveBeenCalledOnce();
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
  });
  it("shows provider failure as unavailable, never as an empty balance", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(
          json({
            user: { address: wallet },
            csrfToken: "token",
            expiresAt: Date.now() + 10000,
          }),
        )
        .mockResolvedValueOnce(
          json(
            {
              error: {
                code: "UPSTREAM_ERROR",
                message: "Balances temporarily unavailable",
              },
            },
            503,
          ),
        ),
    );
    view("app-balance");
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(
      screen.queryByRole("heading", { name: "No balances returned" }),
    ).toBeNull();
    expect(screen.queryByText("$0.00")).toBeNull();
  });
  it("preserves unknown currency and totals instead of displaying invented zeros", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(
          json({
            user: { address: wallet },
            csrfToken: "token",
            expiresAt: Date.now() + 10000,
          }),
        )
        .mockResolvedValueOnce(
          json({
            balances: [
              {
                amount: "1234567",
                amountFormatted: null,
                amountUsd: null,
                currency: null,
              },
            ],
            totalBalanceUsd: null,
            availableBalanceUsd: null,
            outstandingFastFillBalanceUsd: null,
            fetchedAt: Date.now(),
          }),
        ),
    );
    view("app-balance");
    await screen.findByText("Unidentified asset");
    expect(screen.getByText("1234567 base units")).toBeTruthy();
    expect(screen.getAllByText("Unavailable")).toHaveLength(3);
    expect(screen.queryByText("$0.00")).toBeNull();
  });
  it("keeps recovery owner chains explicit and limits this page to reads", async () => {
    const user = userEvent.setup();
    const request = vi.fn(async (input: RequestInfo | URL) =>
      String(input).includes("/auth/session")
        ? json({
            user: { address: wallet },
            csrfToken: "token",
            expiresAt: Date.now() + 10000,
          })
        : json({ balances: [], hasMore: false, fetchedAt: Date.now() }),
    );
    vi.stubGlobal("fetch", request);
    view("withdraw");
    await screen.findByRole("heading", { name: "No balances returned" });
    await user.selectOptions(
      screen.getByRole("combobox", { name: "Recovery owner network" }),
      "8453",
    );
    await waitFor(() =>
      expect(
        request.mock.calls.some(([url]) =>
          String(url).includes("ownerChainId=8453"),
        ),
      ).toBe(true),
    );
    await user.click(screen.getByRole("button", { name: "Verify & withdraw" }));
    expect(
      screen.getByRole("heading", { name: "Recover a deposit" }),
    ).toBeTruthy();
    expect(
      screen
        .getByRole("link", { name: "Open verification & withdrawal on Relay" })
        .getAttribute("href"),
    ).toBe("https://relay.link/withdraw");
    expect(
      screen.queryByRole("button", {
        name: /execute|sign|submit|claim|verify deposit/i,
      }),
    ).toBeNull();
  });
  it("separates Hoplane availability from provider status and can retry an unreachable service", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    view("status");
    await screen.findByText(
      "The backend could not be reached from this preview.",
    );
    expect(
      screen
        .getByRole("link", { name: "Open official API status" })
        .getAttribute("href"),
    ).toBe("https://status.relay.link/");
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) =>
        String(input).includes("/config")
          ? json({
              capabilities: {
                quotes: true,
                execution: false,
                balances: true,
                sync: true,
              },
            })
          : json({ status: "ok" }),
      ),
    );
    await user.click(screen.getByRole("button", { name: "Check again" }));
    await screen.findByText("Responding to the current availability check.");
    const execution = screen.getByText("Transaction execution").parentElement!;
    expect(within(execution).getByText("Not enabled")).toBeTruthy();
  });
});
