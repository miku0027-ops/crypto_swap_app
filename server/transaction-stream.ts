import { AppError } from "./errors.js";
import type { PublicFeed } from "./transactions-contract.js";

export const TRANSACTION_STREAM_HEADERS = {
  "Content-Type": "text/event-stream; charset=utf-8",
  "Cache-Control": "no-store, no-transform",
  "X-Accel-Buffering": "no",
  "X-Content-Type-Options": "nosniff",
};

/** Pull-driven SSE: slow clients do not accumulate an unbounded event queue. */
export function transactionStream(
  read: () => Promise<PublicFeed>,
  signal?: AbortSignal,
  onClose?: () => void,
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder(),
    started = Date.now();
  let closed = false,
    nextRead = 0,
    timer: ReturnType<typeof setTimeout> | undefined;
  let release: (() => void) | undefined;
  const dispose = () => {
    if (closed) return;
    closed = true;
    if (timer) clearTimeout(timer);
    release?.();
    signal?.removeEventListener("abort", abort);
    onClose?.();
  };
  let output: ReadableStreamDefaultController<Uint8Array>;
  const abort = () => {
    if (!closed) {
      dispose();
      output.close();
    }
  };
  return new ReadableStream<Uint8Array>(
    {
      start(controller) {
        output = controller;
        controller.enqueue(encoder.encode("retry: 5000\n\n"));
        if (signal?.aborted) abort();
        else signal?.addEventListener("abort", abort, { once: true });
      },
      async pull(controller) {
        if (closed) return;
        if (Date.now() - started >= 120_000) {
          dispose();
          controller.close();
          return;
        }
        const delay = Math.min(15_000, Math.max(0, nextRead - Date.now()));
        if (delay) {
          await new Promise<void>((resolve) => {
            release = resolve;
            timer = setTimeout(resolve, delay);
          });
          release = undefined;
          timer = undefined;
        }
        if (closed) return;
        if (Date.now() < nextRead) {
          controller.enqueue(encoder.encode(": heartbeat\n\n"));
          return;
        }
        try {
          const snapshot = await read();
          if (closed) return;
          nextRead =
            Date.now() +
            Math.max(
              1000,
              Math.min(
                snapshot.nextRefreshMs,
                snapshot.fetchedAt + snapshot.nextRefreshMs - Date.now(),
              ),
            );
          controller.enqueue(
            encoder.encode(
              `event: snapshot\ndata: ${JSON.stringify(snapshot)}\n\n`,
            ),
          );
        } catch (error) {
          if (closed) return;
          const e =
            error instanceof AppError
              ? error
              : new AppError(
                  503,
                  "TRANSACTIONS_UNAVAILABLE",
                  "Live activity is temporarily unavailable.",
                  30,
                );
          const retryAfterMs = Math.max(
            10_000,
            Math.min(300_000, (e.retryAfterSeconds ?? 30) * 1000),
          );
          nextRead = Date.now() + retryAfterMs;
          controller.enqueue(
            encoder.encode(
              `event: feed-error\ndata: ${JSON.stringify({ code: e.code, message: e.message, retryAfterMs })}\n\n`,
            ),
          );
        }
      },
      cancel() {
        dispose();
      },
    },
    { highWaterMark: 1 },
  );
}
