// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  render,
  screen,
  within,
  fireEvent,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ResourceView from "./ResourceViews";
import { publicFeed } from "../../test/fixtures/transactions";
const runtime = {
  service: "hoplane-public-api",
  profile: "public-preview",
  checkedAt: Date.now(),
  capabilities: {
    publicActivity: true,
    quotes: false,
    execution: false,
    balances: false,
    sync: false,
  },
  testnetChainIds: [],
  providerKeyConfigured: false,
};
const json = (v: unknown, status = 200) =>
  new Response(JSON.stringify(v), { status });
const mount = (page: string) =>
  render(<ResourceView page={page} onNavigate={vi.fn()} onAccount={vi.fn()} />);
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
describe("Hoplane developer experience", () => {
  it("opens useful app-specific guides and searches their navigation", async () => {
    const user = userEvent.setup();
    mount("documentation");
    expect(
      screen.getByRole("heading", { name: "Start building with Hoplane" }),
    ).toBeTruthy();
    await user.click(
      screen.getByRole("button", {
        name: /Activity Public activity and wallet history/,
      }),
    );
    expect(
      screen.getByRole("heading", {
        name: "Public activity and wallet history",
      }),
    ).toBeTruthy();
    expect(screen.getByText(/November 24, 2026/)).toBeTruthy();
    await user.type(
      screen.getByLabelText("Search Hoplane guides"),
      "nothingshouldmatch",
    );
    expect(screen.getByText(/No matching guides/)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Clear search" }));
    expect(
      screen.getByRole("button", { name: /Authentication Wallet sessions/ }),
    ).toBeTruthy();
  });
  it("executes only a user-selected public GET and displays real error responses", async () => {
    const request = vi.fn(
      async (_input: RequestInfo | URL, _options?: RequestInit) =>
        json(runtime),
    );
    vi.stubGlobal("fetch", request);
    const user = userEvent.setup();
    mount("api-reference");
    expect(request).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Run GET request" }));
    expect(
      (await screen.findByRole("region", { name: "API response" })).textContent,
    ).toContain("public-preview");
    expect(request.mock.calls[0][0]).toBe("/api/developer/status");
    expect(request.mock.calls[0][1]).toMatchObject({ method: "GET" });
    expect(
      [
        ...screen
          .getByLabelText("Read-only API endpoint")
          .querySelectorAll("option"),
      ].some((o) => /auth\/|quotes|transfers/.test(o.value)),
    ).toBe(false);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        json({ error: { message: "The backend is not deployed here." } }, 503),
      ),
    );
    await user.selectOptions(
      screen.getByLabelText("Read-only API endpoint"),
      "/config",
    );
    await user.click(screen.getByRole("button", { name: "Run GET request" }));
    expect(await screen.findByRole("alert")).toBeTruthy();
  });
  it("shows the actual reported candidate testnets instead of claiming all defaults are active", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        json({
          ...runtime,
          service: "hoplane-api",
          profile: "backend",
          testnetChainIds: [11155111],
        }),
      ),
    );
    mount("testnets");
    await screen.findByText("Configured candidate");
    const base = screen
      .getByRole("heading", { name: "Base Sepolia" })
      .closest("article")!;
    expect(within(base).getByText("Not configured on this host")).toBeTruthy();
    expect(screen.getByText(/Demo mode uses sample data/)).toBeTruthy();
  });
  it("treats malformed capability information as unknown", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json({ capabilities: { execution: true } })),
    );
    mount("testnets");
    await screen.findByText(
      "The deployment returned incomplete capability information.",
    );
    expect(screen.queryByText("Configured candidate")).toBeNull();
  });
  it("keeps a provider failure separate from a healthy backend storage check", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) =>
        String(input).endsWith("/developer/status")
          ? json({ ...runtime, service: "hoplane-api", profile: "backend" })
          : String(input).endsWith("/ready")
            ? json({ status: "ready" })
            : json({ error: { message: "Provider rate limit" } }, 429),
      ),
    );
    mount("status");
    await screen.findByText("Backend storage read succeeded");
    await screen.findByText("Provider rate limit");
    expect(screen.getAllByText("Responding")).toHaveLength(1);
  });
  it("rejects a malformed activity response rather than reporting healthy", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) =>
        String(input).endsWith("/developer/status")
          ? json(runtime)
          : json({ user: null }),
      ),
    );
    mount("status");
    await screen.findByText("The activity response could not be verified.");
    expect(screen.queryByText("Responding")).toBeNull();
  });
  it("offers safe testnet explorer URLs and keeps protocol-chain inspection explicit", async () => {
    const user = userEvent.setup();
    mount("explorer");
    await user.type(
      screen.getByLabelText("Transaction hash or address"),
      "0x" + "a".repeat(64),
    );
    await user.selectOptions(
      screen.getByLabelText("Explorer network"),
      "84532",
    );
    expect(
      screen
        .getByRole("link", { name: "View on Base Sepolia" })
        .getAttribute("href"),
    ).toBe("https://sepolia.basescan.org/tx/0x" + "a".repeat(64));
    expect(
      screen
        .getByRole("link", { name: "Open Relay Chain Explorer" })
        .getAttribute("href"),
    ).toBe("https://explorer.chain.relay.link/");
  });
});
