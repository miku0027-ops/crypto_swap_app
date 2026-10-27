import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { Firestore, Timestamp } from "firebase-admin/firestore";
import { privateKeyToAccount } from "viem/accounts";
import { FirestoreStore } from "./store.js";
import { AuthService } from "./auth.js";

// Never fall back to a real project. Tests run only against a loopback emulator.
const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST;
if (
  emulatorHost &&
  !/^(?:127\.0\.0\.1|localhost):\d{1,5}$/.test(emulatorHost)
) {
  throw new Error("Firestore integration tests require a loopback emulator.");
}
const projectId = "demo-hoplane";
const testAccount = privateKeyToAccount(`0x${"11".repeat(32)}`);
const otherAccount = privateKeyToAccount(`0x${"22".repeat(32)}`);
const authConfig = {
  appOrigin: "https://hoplane.example",
  authChainId: 1,
  sessionTtlMs: 86_400_000,
};

describe.skipIf(!emulatorHost)("real Firestore emulator integration", () => {
  let dbA: Firestore, dbB: Firestore, a: FirestoreStore, b: FirestoreStore;
  let now: number, id: string;
  beforeEach(() => {
    now = 1_800_000_000_000;
    id = randomUUID();
    dbA = new Firestore({ projectId });
    dbB = new Firestore({ projectId });
    a = new FirestoreStore(dbA, () => now);
    b = new FirestoreStore(dbB, () => now);
  });
  afterEach(async () => {
    await Promise.all([a.close(), b.close()]);
  });

  it("creates an idempotent record once across independent clients", async () => {
    const results = await Promise.all(
      Array.from({ length: 6 }, (_, index) =>
        (index % 2 ? a : b).create("emulator_test", id, { index }, now + 1000),
      ),
    );
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(await a.get("emulator_test", id)).toEqual(
      await b.get("emulator_test", id),
    );
  }, 30_000);

  it("atomically consumes signed challenges across instances and revokes shared sessions", async () => {
    const authA = new AuthService(a, authConfig, () => now),
      authB = new AuthService(b, authConfig, () => now);
    const challenge = await authA.challenge(testAccount.address, 1);
    const signature = await testAccount.signMessage({
      message: challenge.message,
    });
    const results = await Promise.allSettled([
      authA.verify(challenge.challengeId, signature),
      authB.verify(challenge.challengeId, signature),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const winner = results.find((r) => r.status === "fulfilled");
    if (winner?.status !== "fulfilled") throw new Error("No verified session");
    expect(await authB.authenticate(winner.value.token)).toEqual(
      winner.value.session,
    );
    await authB.logout(winner.value.token);
    expect(await authA.authenticate(winner.value.token)).toBeNull();
  }, 30_000);

  it("consumes an invalid signature attempt before any replay on another instance", async () => {
    const authA = new AuthService(a, authConfig, () => now),
      authB = new AuthService(b, authConfig, () => now);
    const challenge = await authA.challenge(testAccount.address, 1);
    await expect(
      authA.verify(
        challenge.challengeId,
        await otherAccount.signMessage({ message: challenge.message }),
      ),
    ).rejects.toMatchObject({ code: "SIGNATURE_REJECTED" });
    await expect(
      authB.verify(
        challenge.challengeId,
        await testAccount.signMessage({ message: challenge.message }),
      ),
    ).rejects.toMatchObject({ code: "CHALLENGE_EXPIRED" });
  }, 30_000);

  it("rejects lost updates when clients race the same preference version", async () => {
    expect(
      await a.compareAndSet(
        "preferences",
        id,
        { version: 1, value: "original" },
        0,
      ),
    ).toBe(true);
    const updates = await Promise.all(
      Array.from({ length: 6 }, (_, value) =>
        (value % 2 ? a : b).compareAndSet(
          "preferences",
          id,
          { version: 2, value },
          1,
        ),
      ),
    );
    expect(updates.filter(Boolean)).toHaveLength(1);
    expect(await b.get("preferences", id)).toMatchObject({ version: 2 });
    expect(
      await a.compareAndSet(
        "preferences",
        id,
        { version: 2, value: "stale" },
        1,
      ),
    ).toBe(false);
  }, 30_000);

  it("shares atomic rate counters and resets the fixed window across clients", async () => {
    const results = await Promise.all(
      Array.from({ length: 6 }, (_, index) =>
        (index % 2 ? a : b).rateLimit(id, 3, 10_000),
      ),
    );
    expect(results.filter((r) => r.allowed)).toHaveLength(3);
    now += 9000;
    expect(await b.rateLimit(id, 3, 10_000)).toEqual({
      allowed: false,
      retryAfterSeconds: 1,
    });
    now += 1000;
    expect(await a.rateLimit(id, 3, 10_000)).toEqual({
      allowed: true,
      retryAfterSeconds: 0,
    });
  }, 30_000);

  it("lists only the wallet owner in descending order and excludes expired rows before limiting", async () => {
    const owner = `alice-${id}`;
    await a.set("transfers", `${id}-old`, {
      owner,
      createdAt: now,
      amount: "1",
    });
    await a.set("transfers", `${id}-new`, {
      owner,
      createdAt: now + 1,
      amount: "2",
    });
    await a.set("transfers", `${id}-other`, {
      owner: `bob-${id}`,
      createdAt: now + 2,
      amount: "99",
    });
    // More expired rows than a Firestore page must not hide live history.
    await Promise.all(
      Array.from({ length: 26 }, (_, index) =>
        a.set(
          "transfers",
          `${id}-expired-${index}`,
          { owner, createdAt: now + 3 + index, amount: "3" },
          now + 1,
        ),
      ),
    );
    now++;
    expect(await b.list("transfers", owner, 1)).toEqual([
      { owner, createdAt: now, amount: "2" },
    ]);
    expect(
      (await b.list<{ amount: string }>("transfers", owner)).map(
        (row) => row.amount,
      ),
    ).toEqual(["2", "1"]);
  }, 30_000);

  it("stores a Timestamp for cleanup and enforces logical expiry before physical deletion", async () => {
    await a.set("sessions", id, { address: testAccount.address }, now + 1000);
    const snapshot = await dbB.collection("hoplane_sessions").doc(id).get();
    expect(snapshot.data()?.ttl).toBeInstanceOf(Timestamp);
    expect(snapshot.data()?.ttl.toMillis()).toBe(now + 1000);
    now += 1000;
    expect(await b.get("sessions", id)).toBeNull();
    expect(await a.consume("sessions", id)).toBeNull();
    expect(
      (await dbB.collection("hoplane_sessions").doc(id).get()).exists,
    ).toBe(false);
    expect(
      await b.create(
        "sessions",
        id,
        { address: otherAccount.address },
        now + 1000,
      ),
    ).toBe(true);
  }, 30_000);

  it("denies unauthenticated client reads and writes while Admin access works", async () => {
    await a.set("preferences", id, { owner: testAccount.address, version: 1 });
    const url = `http://${emulatorHost}/v1/projects/${projectId}/databases/(default)/documents/hoplane_preferences/${id}`;
    const read = await fetch(url);
    expect(read.status).toBe(403);
    const write = await fetch(url, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fields: { owner: { stringValue: "attacker" } } }),
    });
    expect(write.status).toBe(403);
    expect(await b.get("preferences", id)).toEqual({
      owner: testAccount.address,
      version: 1,
    });
  }, 30_000);
});
