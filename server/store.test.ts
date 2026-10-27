import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MemoryStore, SQLiteStore, type Store } from "./store.js";

for (const [name, factory] of [
  ["memory", (clock: () => number) => new MemoryStore(clock)],
  ["sqlite", (clock: () => number) => new SQLiteStore(":memory:", clock)],
] as const) {
  describe(`${name} store invariants`, () => {
    let now: number, store: Store;
    beforeEach(() => {
      now = 1_800_000_000_000;
      store = factory(() => now);
    });
    afterEach(async () => {
      await store.close();
    });
    it("round-trips JSON without sharing mutable references", async () => {
      const original = {
        owner: "alice",
        createdAt: now,
        nested: { amount: "900719925474099999999" },
      };
      await store.set("quotes", "q1", original);
      original.nested.amount = "changed";
      const first = await store.get<typeof original>("quotes", "q1");
      expect(first?.nested.amount).toBe("900719925474099999999");
      first!.nested.amount = "changed again";
      expect(
        (await store.get<typeof original>("quotes", "q1"))?.nested.amount,
      ).toBe("900719925474099999999");
    });
    it("expires reads exactly at the deadline and allows recreation", async () => {
      await store.set("sessions", "session1", { value: 1 }, now + 1000);
      now += 999;
      expect(await store.get("sessions", "session1")).toEqual({ value: 1 });
      now++;
      expect(await store.get("sessions", "session1")).toBeNull();
      expect(
        await store.create("sessions", "session1", { value: 2 }, now + 1000),
      ).toBe(true);
      expect(await store.get("sessions", "session1")).toEqual({ value: 2 });
    });
    it("atomically creates an idempotency key once", async () => {
      const results = await Promise.all(
        Array.from({ length: 25 }, (_, i) =>
          store.create("idempotency", "one", { i }, now + 1000),
        ),
      );
      expect(results.filter(Boolean)).toHaveLength(1);
    });
    it("consumes a challenge once across concurrent callers", async () => {
      await store.create(
        "auth_challenges",
        "challenge",
        { value: "single-use" },
        now + 1000,
      );
      const records = await Promise.all(
        Array.from({ length: 25 }, () =>
          store.consume("auth_challenges", "challenge"),
        ),
      );
      expect(records.filter(Boolean)).toEqual([{ value: "single-use" }]);
    });
    it("expired challenges cannot be consumed", async () => {
      await store.set("auth_challenges", "old", { value: 1 }, now + 1);
      now++;
      expect(await store.consume("auth_challenges", "old")).toBeNull();
      expect(await store.get("auth_challenges", "old")).toBeNull();
    });
    it("lists only the owner and live records newest first with a bounded limit", async () => {
      await store.set("transfers", "t1", {
        owner: "alice",
        createdAt: now,
        amount: 1,
      });
      await store.set("transfers", "t2", {
        owner: "alice",
        createdAt: now + 2,
        amount: 2,
      });
      await store.set("transfers", "t3", {
        owner: "bob",
        createdAt: now + 3,
        amount: 3,
      });
      await store.set(
        "transfers",
        "t4",
        { owner: "alice", createdAt: now + 4, amount: 4 },
        now + 1,
      );
      now++;
      expect(await store.list("transfers", "alice", 1)).toEqual([
        { owner: "alice", createdAt: now + 1, amount: 2 },
      ]);
      expect(await store.list("transfers", "alice")).toHaveLength(2);
    });
    it("enforces shared fixed-window quotas without extending the window on rejected requests", async () => {
      const results = await Promise.all(
        Array.from({ length: 20 }, () =>
          store.rateLimit("quote:2001:db8::1", 5, 10_000),
        ),
      );
      expect(results.filter((r) => r.allowed)).toHaveLength(5);
      expect(results[5]).toEqual({ allowed: false, retryAfterSeconds: 10 });
      now += 9000;
      expect(await store.rateLimit("quote:2001:db8::1", 5, 10_000)).toEqual({
        allowed: false,
        retryAfterSeconds: 1,
      });
      now += 1000;
      expect(await store.rateLimit("quote:2001:db8::1", 5, 10_000)).toEqual({
        allowed: true,
        retryAfterSeconds: 0,
      });
    });
    it("isolates separate limiter keys", async () => {
      await store.rateLimit("quote:alice", 1, 1000);
      expect((await store.rateLimit("quote:alice", 1, 1000)).allowed).toBe(
        false,
      );
      expect((await store.rateLimit("quote:bob", 1, 1000)).allowed).toBe(true);
    });
    it("atomically compares versions and prevents lost updates", async () => {
      expect(
        await store.compareAndSet(
          "preferences",
          "alice",
          { version: 1, value: "first" },
          0,
        ),
      ).toBe(true);
      const results = await Promise.all(
        Array.from({ length: 20 }, (_, i) =>
          store.compareAndSet(
            "preferences",
            "alice",
            { version: 2, value: i },
            1,
          ),
        ),
      );
      expect(results.filter(Boolean)).toHaveLength(1);
      expect(
        (await store.get<{ version: number }>("preferences", "alice"))?.version,
      ).toBe(2);
      expect(
        await store.compareAndSet(
          "preferences",
          "alice",
          { version: 2, value: "stale" },
          1,
        ),
      ).toBe(false);
    });
    it("treats an expired record as version zero", async () => {
      await store.set("preferences", "alice", { version: 10 }, now + 1);
      now++;
      expect(
        await store.compareAndSet("preferences", "alice", { version: 1 }, 0),
      ).toBe(true);
    });
    it("rejects a mismatched new version", async () => {
      await expect(
        store.compareAndSet("preferences", "alice", { version: 5 }, 0),
      ).rejects.toThrow("increment");
    });
    it("deletes records idempotently", async () => {
      await store.set("quotes", "q1", { amount: "1" });
      await store.delete("quotes", "q1");
      await store.delete("quotes", "q1");
      expect(await store.get("quotes", "q1")).toBeNull();
    });
    it("rejects unsafe paths, excessive records and invalid limits", async () => {
      await expect(store.get("../sessions", "id")).rejects.toThrow(
        "collection",
      );
      await expect(store.get("sessions", "nested/path")).rejects.toThrow("ID");
      await expect(store.get("sessions", "..")).rejects.toThrow("ID");
      await expect(
        store.set("sessions", "id", "x".repeat(900_001)),
      ).rejects.toThrow("bounded");
      await expect(store.list("transfers", "alice", 101)).rejects.toThrow(
        "limit",
      );
      await expect(store.list("transfers", "", 1)).rejects.toThrow("owner");
      await expect(store.rateLimit("key", 0, 1000)).rejects.toThrow("limit");
      await expect(store.rateLimit("key", 1, 0)).rejects.toThrow("window");
      await expect(store.set("sessions", "id", {}, Infinity)).rejects.toThrow(
        "expiry",
      );
    });
  });
}

describe("durable SQLite store", () => {
  it("preserves records, nonce consumption, and quota usage after a process-style reopen", async () => {
    const directory = mkdtempSync(join(tmpdir(), "hoplane-store-"));
    const path = join(directory, "store.sqlite");
    let store = new SQLiteStore(path);
    try {
      await store.set("preferences", "alice", { owner: "alice", version: 1 });
      await store.create("auth_challenges", "challenge", { nonce: "one" });
      await store.consume("auth_challenges", "challenge");
      await store.rateLimit("durable", 1, 60_000);
      await store.close();
      store = new SQLiteStore(path);
      expect(await store.get("preferences", "alice")).toEqual({
        owner: "alice",
        version: 1,
      });
      expect(await store.consume("auth_challenges", "challenge")).toBeNull();
      expect((await store.rateLimit("durable", 1, 60_000)).allowed).toBe(false);
    } finally {
      await store.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });
  it("shares atomic counters and one-time records across independent connections", async () => {
    const directory = mkdtempSync(join(tmpdir(), "hoplane-store-"));
    const path = join(directory, "store.sqlite");
    const a = new SQLiteStore(path),
      b = new SQLiteStore(path);
    try {
      await a.create("auth_challenges", "challenge", { nonce: "one" });
      const claims = await Promise.all([
        a.consume("auth_challenges", "challenge"),
        b.consume("auth_challenges", "challenge"),
      ]);
      expect(claims.filter(Boolean)).toHaveLength(1);
      expect((await a.rateLimit("shared", 1, 1000)).allowed).toBe(true);
      expect((await b.rateLimit("shared", 1, 1000)).allowed).toBe(false);
    } finally {
      await a.close();
      await b.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
