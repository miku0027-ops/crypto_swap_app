import { describe, expect, it, vi } from "vitest";
import { createTransactionsWorker } from "./transactions-worker";
import { PublicTransactionsService } from "../server/public-transactions";
import { publicFeed } from "../test/fixtures/transactions";
const origin = "https://hoplane.example";
const assets = {
  "/index.html": {
    contentType: "text/html",
    body: btoa("<!doctype html><html><body>Hoplane</body></html>"),
  },
  "/assets/app.js": { contentType: "text/javascript", body: btoa("export {}") },
};
function setup() {
  const snapshot = vi.fn(async () => publicFeed());
  const worker = createTransactionsWorker(assets, {
    service: { snapshot } as unknown as PublicTransactionsService,
  });
  return { worker, snapshot };
}
describe("hosted activity worker", () => {
  it("serves the existing site and safe asset content types", async () => {
    const { worker, snapshot } = setup();
    const page = await worker.fetch(new Request(origin + "/"));
    expect(page.status).toBe(200);
    expect(await page.text()).toContain("Hoplane");
    expect(page.headers.get("Content-Security-Policy")).toContain(
      "connect-src 'self'",
    );
    const js = await worker.fetch(new Request(origin + "/assets/app.js"));
    expect(js.headers.get("Content-Type")).toBe("text/javascript");
    expect(js.headers.get("Cache-Control")).toContain("immutable");
    expect(
      (await worker.fetch(new Request(origin + "/assets/missing.js"))).status,
    ).toBe(404);
    expect(snapshot).not.toHaveBeenCalled();
  });
  it("returns a public snapshot without authentication, cookies or secret values", async () => {
    const { worker, snapshot } = setup();
    const response = await worker.fetch(
      new Request(origin + "/api/transactions", {
        headers: { Cookie: "session=private" },
      }),
      { RELAY_API_KEY: "server-only-secret" },
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.text()).not.toMatch(
      /server-only-secret|session=private/,
    );
    expect(snapshot).toHaveBeenCalledWith();
  });
  it("rejects arbitrary provider paths, query parameters, cross-origin calls and mutations", async () => {
    const { worker, snapshot } = setup();
    expect(
      (
        await worker.fetch(
          new Request(origin + "/api/transactions?url=https://evil.example"),
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await worker.fetch(
          new Request(origin + "/api/transactions", { method: "POST" }),
        )
      ).status,
    ).toBe(405);
    expect(
      (
        await worker.fetch(
          new Request(origin + "/api/transactions", {
            headers: { Origin: "https://evil.example" },
          }),
        )
      ).status,
    ).toBe(403);
    expect(snapshot).not.toHaveBeenCalled();
    const auth = await worker.fetch(new Request(origin + "/api/auth/session"));
    expect(auth.status).toBe(503);
    expect((await auth.json()).error.code).toBe("BACKEND_NOT_DEPLOYED");
  });
  it("caches the normalized feed across calls and rejects stale cached records", async () => {
    const feed = publicFeed(),
      match = vi.fn(async () => new Response(JSON.stringify(feed))),
      put = vi.fn(async () => {}),
      snapshot = vi.fn(async () => feed);
    let now = feed.fetchedAt;
    const worker = createTransactionsWorker(assets, {
      service: { snapshot } as unknown as PublicTransactionsService,
      cache: { match, put },
      now: () => now,
    });
    expect(
      (await worker.fetch(new Request(origin + "/api/transactions"))).status,
    ).toBe(200);
    expect(snapshot).not.toHaveBeenCalled();
    now += 60001;
    await worker.fetch(new Request(origin + "/api/transactions"));
    expect(snapshot).toHaveBeenCalledTimes(1);
    expect(put).toHaveBeenCalledTimes(1);
  });
  it("streams snapshots and frees all three allowed connections after cancellation", async () => {
    const { worker } = setup();
    const streams: ReadableStreamDefaultReader<Uint8Array>[] = [];
    for (let i = 0; i < 3; i++) {
      const response = await worker.fetch(
        new Request(origin + "/api/transactions/stream"),
      );
      expect(response.headers.get("Content-Type")).toContain(
        "text/event-stream",
      );
      const reader = response.body!.getReader();
      streams.push(reader);
      await reader.read();
      expect(new TextDecoder().decode((await reader.read()).value)).toContain(
        "event: snapshot",
      );
    }
    expect(
      (await worker.fetch(new Request(origin + "/api/transactions/stream")))
        .status,
    ).toBe(429);
    for (const reader of streams) await reader.cancel();
    const response = await worker.fetch(
      new Request(origin + "/api/transactions/stream"),
    );
    expect(response.status).toBe(200);
    await response.body!.cancel();
  });
  it("bounds per-client HTTP requests", async () => {
    const { worker } = setup();
    for (let i = 0; i < 30; i++)
      expect(
        (await worker.fetch(new Request(origin + "/api/transactions"))).status,
      ).toBe(200);
    const response = await worker.fetch(
      new Request(origin + "/api/transactions"),
    );
    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBeTruthy();
  });
});
