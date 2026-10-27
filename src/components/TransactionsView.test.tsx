// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import TransactionsView, { transactionExplorer } from "./TransactionsView";
import {
  publicFeed,
  publicRow,
  walletA,
} from "../../test/fixtures/transactions";
class FeedEvents {
  static instances: FeedEvents[] = [];
  handlers = new Map<string, EventListener>();
  close = vi.fn();
  onerror: (() => void) | null = null;
  constructor(public url: string) {
    FeedEvents.instances.push(this);
  }
  addEventListener(type: string, listener: EventListener) {
    this.handlers.set(type, listener);
  }
  emit(type: string, value: unknown) {
    act(() =>
      this.handlers.get(type)?.(
        new MessageEvent(type, { data: JSON.stringify(value) }),
      ),
    );
  }
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status });
beforeEach(() => {
  FeedEvents.instances = [];
  vi.stubGlobal("EventSource", FeedEvents);
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => json(publicFeed())),
  );
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
const mount = () =>
  render(<TransactionsView personal={<div>Verified wallet history</div>} />);
const stream = async () => {
  await waitFor(() => expect(FeedEvents.instances).toHaveLength(1));
  return FeedEvents.instances[0];
};
describe("live public transactions", () => {
  it("shows source-labelled live transactions, exact amounts, statuses and explorer links without a wallet", async () => {
    mount();
    const table = await screen.findByRole("table");
    expect(screen.getByRole("heading", { name: "Transactions" })).toBeTruthy();
    expect(table.textContent).toContain("900.719925… ETH");
    expect(within(table).getByText("Completed")).toBeTruthy();
    expect(within(table).getByText("10s")).toBeTruthy();
    expect(screen.getByText(/swaps from other apps/)).toBeTruthy();
    expect(
      within(table).getByRole("link", { name: "Deposit" }).getAttribute("href"),
    ).toContain("https://etherscan.io/tx/0x");
    expect(screen.queryByText(/Verified wallet history/)).toBeNull();
    expect((await stream()).url).toBe("/api/transactions/stream");
  });
  it("replaces snapshots with current statuses and ignores older events", async () => {
    mount();
    const socket = await stream();
    const feed = publicFeed(Date.now() + 1000);
    feed.transactions[0].status = "refund";
    socket.emit("snapshot", feed);
    expect(
      await within(screen.getByRole("table")).findByText("Refunded"),
    ).toBeTruthy();
    socket.emit("snapshot", publicFeed(feed.fetchedAt - 5000));
    expect(
      within(screen.getByRole("table")).getByText("Refunded"),
    ).toBeTruthy();
  });
  it("retains the last real snapshot on stream errors and rejects malformed replacement data", async () => {
    mount();
    const socket = await stream();
    socket.emit("feed-error", { message: "Provider busy" });
    expect(screen.getByText(/Provider busy/)).toBeTruthy();
    expect(screen.getByRole("table")).toBeTruthy();
    socket.emit("snapshot", { transactions: [{ arbitrary: "bad" }] });
    expect(screen.getByRole("table")).toBeTruthy();
    expect(screen.getByText(/could not be verified/)).toBeTruthy();
    expect(screen.queryByText(/No public transactions returned/)).toBeNull();
  });
  it("filters loaded records by wallet, token, network, and status with a clear empty state", async () => {
    const feed = publicFeed();
    feed.transactions.push({
      ...publicRow(feed.fetchedAt),
      id: "second",
      status: "failure",
      from: { ...publicRow().from!, chainId: 42161, symbol: "USDC" },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json(feed)),
    );
    mount();
    await screen.findByRole("table");
    const user = userEvent.setup();
    await user.selectOptions(screen.getByLabelText("From network"), "42161");
    expect(within(screen.getByRole("table")).getAllByRole("row")).toHaveLength(
      2,
    );
    await user.selectOptions(
      screen.getByLabelText("Transaction status"),
      "success",
    );
    expect(screen.getByText("No matching transactions")).toBeTruthy();
    await user.click(
      screen.getAllByRole("button", { name: "Clear filters" })[0],
    );
    await user.type(
      screen.getByLabelText("Search loaded public transactions"),
      walletA,
    );
    expect(screen.getByRole("table")).toBeTruthy();
    await user.clear(
      screen.getByLabelText("Search loaded public transactions"),
    );
    await user.type(
      screen.getByLabelText("Search loaded public transactions"),
      "missing-token",
    );
    expect(
      screen.getByText(/Search applies to the latest loaded records/),
    ).toBeTruthy();
  });
  it("pauses, resumes and closes the stream while viewing private history", async () => {
    mount();
    const socket = await stream(),
      user = userEvent.setup();
    await user.click(screen.getByLabelText("Pause live updates"));
    expect(socket.close).toHaveBeenCalled();
    expect(screen.getByText("Paused")).toBeTruthy();
    await user.click(screen.getByLabelText("Resume live updates"));
    await waitFor(() => expect(FeedEvents.instances).toHaveLength(2));
    await user.click(screen.getByRole("tab", { name: "Your history" }));
    expect(screen.getByText("Verified wallet history")).toBeTruthy();
    expect(FeedEvents.instances[1].close).toHaveBeenCalled();
    expect(screen.queryByRole("table")).toBeNull();
  });
  it("opens details with full precision, reported timestamps, and contract evidence", async () => {
    mount();
    await screen.findByRole("table");
    const user = userEvent.setup();
    await user.click(
      screen.getByLabelText("Details for transaction request_1"),
    );
    const modal = screen.getByRole("dialog", { name: "Transaction details" });
    expect(modal.textContent).toContain("900.719925474099312345 ETH");
    expect(modal.textContent).toContain("Last provider update");
    expect(modal.textContent).toContain("provider-reported");
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
  });
  it("keeps unavailable feed data distinct from a legitimate empty feed", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        json({ error: { message: "Provider unavailable" } }, 503),
      ),
    );
    mount();
    expect(
      await screen.findByRole("heading", {
        name: "Live activity is unavailable",
      }),
    ).toBeTruthy();
    expect(screen.queryByText("No public transactions returned")).toBeNull();
    expect(screen.queryByRole("table")).toBeNull();
  });
  it("stops connections in the background and resumes when visible", async () => {
    mount();
    const socket = await stream();
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "hidden",
    });
    fireEvent(document, new Event("visibilitychange"));
    expect(socket.close).toHaveBeenCalled();
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "visible",
    });
    fireEvent(document, new Event("visibilitychange"));
    await waitFor(() => expect(FeedEvents.instances).toHaveLength(2));
  });
  it("does not invent explorer URLs for unknown chains or malformed hashes", () => {
    expect(transactionExplorer(9999999, "0x" + "a".repeat(64))).toBeNull();
    expect(transactionExplorer(1, "javascript:alert(1)")).toBeNull();
    expect(transactionExplorer(1, walletA, true)).toBe(
      `https://etherscan.io/address/${walletA}`,
    );
  });
  it("supports keyboard navigation between network and personal tabs", async () => {
    mount();
    await screen.findByRole("table");
    const tab = screen.getByRole("tab", { name: "Network activity" });
    tab.focus();
    fireEvent.keyDown(tab, { key: "ArrowRight" });
    expect(screen.getByText("Verified wallet history")).toBeTruthy();
    expect(document.activeElement).toBe(
      screen.getByRole("tab", { name: "Your history" }),
    );
  });
  it("does not accept an in-flight snapshot after switching to personal history", async () => {
    let finish!: (value: Response) => void;
    vi.stubGlobal(
      "fetch",
      vi.fn(
        () =>
          new Promise<Response>((resolve) => {
            finish = resolve;
          }),
      ),
    );
    mount();
    fireEvent.click(screen.getByRole("tab", { name: "Your history" }));
    await act(async () => {
      finish(json(publicFeed()));
    });
    expect(screen.getByText("Verified wallet history")).toBeTruthy();
    expect(FeedEvents.instances).toHaveLength(0);
  });
  it("falls back to paced HTTP refresh when a stream is interrupted", async () => {
    vi.useFakeTimers();
    const request = vi.fn(async () => json(publicFeed()));
    vi.stubGlobal("fetch", request);
    mount();
    await act(async () => {});
    expect(FeedEvents.instances).toHaveLength(1);
    act(() => FeedEvents.instances[0].onerror?.());
    expect(FeedEvents.instances[0].close).toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_001);
    });
    expect(request).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("table")).toBeTruthy();
  });
});
