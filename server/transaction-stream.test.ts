import { afterEach, describe, expect, it, vi } from "vitest";
import { transactionStream } from "./transaction-stream";
import { AppError } from "./errors";
import { publicFeed } from "../test/fixtures/transactions";
const decode = (v: ReadableStreamReadResult<Uint8Array>) =>
  new TextDecoder().decode(v.value);
afterEach(() => vi.useRealTimers());
describe("public activity SSE lifecycle", () => {
  it("sends real snapshots and stops reads after cancellation", async () => {
    const read = vi.fn(async () => publicFeed());
    const disposed = vi.fn();
    const reader = transactionStream(read, undefined, disposed).getReader();
    expect(decode(await reader.read())).toContain("retry: 5000");
    const event = decode(await reader.read());
    expect(event).toContain("event: snapshot");
    expect(event).toContain("request_1");
    await reader.cancel();
    expect(disposed).toHaveBeenCalledTimes(1);
    expect(read).toHaveBeenCalledTimes(1);
  });
  it("sends safe failure events with retry timing, never fake empty snapshots", async () => {
    const reader = transactionStream(async () => {
      throw new AppError(
        429,
        "TRANSACTIONS_RATE_LIMITED",
        "Updates delayed",
        60,
      );
    }).getReader();
    await reader.read();
    const event = decode(await reader.read());
    expect(event).toContain("event: feed-error");
    expect(event).toContain('"retryAfterMs":60000');
    expect(event).not.toContain('"transactions":[]');
    await reader.cancel();
  });
  it("releases a waiting heartbeat on disconnect without another upstream read", async () => {
    vi.useFakeTimers();
    const cancel = new AbortController(),
      disposed = vi.fn(),
      read = vi.fn(async () => publicFeed());
    const reader = transactionStream(read, cancel.signal, disposed).getReader();
    await reader.read();
    await reader.read();
    const pending = reader.read();
    cancel.abort();
    expect(await pending).toMatchObject({ done: true });
    expect(disposed).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(120000);
    expect(read).toHaveBeenCalledTimes(1);
  });
  it("heartbeats without polling before the advertised refresh interval", async () => {
    vi.useFakeTimers();
    const read = vi.fn(async () => publicFeed()),
      reader = transactionStream(read).getReader();
    await reader.read();
    await reader.read();
    const heartbeat = reader.read();
    await vi.advanceTimersByTimeAsync(15000);
    expect(decode(await heartbeat)).toContain(": heartbeat");
    expect(read).toHaveBeenCalledTimes(1);
    await reader.cancel();
  });
});
