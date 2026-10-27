import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { privateKeyToAccount } from "viem/accounts";
import { AuthService } from "./auth.js";
import { MemoryStore } from "./store.js";

// Public deterministic test keys. Never configure these accounts on a real deployment.
const alice = privateKeyToAccount(
  "0x1111111111111111111111111111111111111111111111111111111111111111",
);
const bob = privateKeyToAccount(
  "0x2222222222222222222222222222222222222222222222222222222222222222",
);
const config = {
  appOrigin: "https://hoplane.example",
  authChainId: 1,
  sessionTtlMs: 43_200_000,
};
describe("wallet identity service", () => {
  let now: number, store: MemoryStore, auth: AuthService;
  beforeEach(() => {
    now = 1_800_000_000_000;
    store = new MemoryStore(() => now);
    auth = new AuthService(store, config, () => now);
  });
  afterEach(async () => {
    await store.close();
  });
  it("creates an exact domain-bound SIWE challenge with a short expiry and explicit no-transfer statement", async () => {
    const challenge = await auth.challenge(alice.address, 1);
    expect(challenge.message).toContain(
      "hoplane.example wants you to sign in with your Ethereum account:",
    );
    expect(challenge.message).toContain(alice.address);
    expect(challenge.message).toContain("URI: https://hoplane.example");
    expect(challenge.message).toContain("Chain ID: 1");
    expect(challenge.message).toContain(
      "does not authorize any transfer of funds",
    );
    expect(challenge.expiresAt).toBe(now + 300_000);
    const again = await auth.challenge(alice.address, 1);
    expect(again.challengeId).not.toBe(challenge.challengeId);
    expect(again.message).not.toBe(challenge.message);
  });
  it("signs in an EOA, stores only a session token hash, and authenticates with that token", async () => {
    const challenge = await auth.challenge(alice.address, 1);
    const signature = await alice.signMessage({ message: challenge.message });
    const { token, session } = await auth.verify(
      challenge.challengeId,
      signature,
    );
    expect(token).toMatch(/^[0-9a-f]{64}$/);
    expect(session.csrfToken).toMatch(/^[0-9a-f]{64}$/);
    expect(session.csrfToken).not.toBe(token);
    expect(session.address).toBe(alice.address);
    expect(session.expiresAt).toBe(now + config.sessionTtlMs);
    expect(await store.get("sessions", token)).toBeNull();
    expect(
      await store.get(
        "sessions",
        createHash("sha256").update(token).digest("hex"),
      ),
    ).toEqual(session);
    expect(await auth.authenticate(token)).toEqual(session);
  });
  it("rejects reusing a valid signed challenge", async () => {
    const challenge = await auth.challenge(alice.address, 1),
      signature = await alice.signMessage({ message: challenge.message });
    await auth.verify(challenge.challengeId, signature);
    await expect(
      auth.verify(challenge.challengeId, signature),
    ).rejects.toMatchObject({ status: 401, code: "CHALLENGE_EXPIRED" });
  });
  it("allows only one concurrent verification to establish a session", async () => {
    const challenge = await auth.challenge(alice.address, 1),
      signature = await alice.signMessage({ message: challenge.message });
    const results = await Promise.allSettled(
      Array.from({ length: 10 }, () =>
        auth.verify(challenge.challengeId, signature),
      ),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  });
  it("rejects a signature from a different wallet and consumes the attempt", async () => {
    const challenge = await auth.challenge(alice.address, 1),
      wrong = await bob.signMessage({ message: challenge.message });
    await expect(
      auth.verify(challenge.challengeId, wrong),
    ).rejects.toMatchObject({ code: "SIGNATURE_REJECTED" });
    const right = await alice.signMessage({ message: challenge.message });
    await expect(
      auth.verify(challenge.challengeId, right),
    ).rejects.toMatchObject({ code: "CHALLENGE_EXPIRED" });
  });
  it("does not accept a signature over a message with another domain or URI", async () => {
    const challenge = await auth.challenge(alice.address, 1);
    const signature = await alice.signMessage({
      message: challenge.message.replaceAll(
        "hoplane.example",
        "attacker.example",
      ),
    });
    await expect(
      auth.verify(challenge.challengeId, signature),
    ).rejects.toMatchObject({ code: "SIGNATURE_REJECTED" });
  });
  it("does not accept a signature for a different chain", async () => {
    const challenge = await auth.challenge(alice.address, 1);
    const signature = await alice.signMessage({
      message: challenge.message.replace("Chain ID: 1", "Chain ID: 8453"),
    });
    await expect(
      auth.verify(challenge.challengeId, signature),
    ).rejects.toMatchObject({ code: "SIGNATURE_REJECTED" });
  });
  it("invalid signature encodings consume a valid challenge", async () => {
    const challenge = await auth.challenge(alice.address, 1);
    await expect(
      auth.verify(challenge.challengeId, "0x"),
    ).rejects.toMatchObject({ code: "INVALID_SIGNATURE" });
    const signature = await alice.signMessage({ message: challenge.message });
    await expect(
      auth.verify(challenge.challengeId, signature),
    ).rejects.toMatchObject({ code: "CHALLENGE_EXPIRED" });
  });
  it("rejects malformed signatures without exposing cryptography internals", async () => {
    const challenge = await auth.challenge(alice.address, 1);
    await expect(
      auth.verify(challenge.challengeId, `0x${"00".repeat(65)}`),
    ).rejects.toMatchObject({
      code: "SIGNATURE_REJECTED",
      message: "The signature does not match this wallet sign-in request.",
    });
  });
  it("expires unsigned challenges exactly at the deadline", async () => {
    const challenge = await auth.challenge(alice.address, 1),
      signature = await alice.signMessage({ message: challenge.message });
    now += 300_000;
    await expect(
      auth.verify(challenge.challengeId, signature),
    ).rejects.toMatchObject({ code: "CHALLENGE_EXPIRED" });
  });
  it("expires sessions and revokes sessions on logout", async () => {
    let challenge = await auth.challenge(alice.address, 1);
    const first = await auth.verify(
      challenge.challengeId,
      await alice.signMessage({ message: challenge.message }),
    );
    await auth.logout(first.token);
    expect(await auth.authenticate(first.token)).toBeNull();
    challenge = await auth.challenge(alice.address, 1);
    const second = await auth.verify(
      challenge.challengeId,
      await alice.signMessage({ message: challenge.message }),
    );
    now += config.sessionTtlMs;
    expect(await auth.authenticate(second.token)).toBeNull();
  });
  it("does not read the database for malformed tokens", async () => {
    const spy = vi.spyOn(store, "get");
    for (const value of [
      undefined,
      null,
      "",
      "../session",
      "0".repeat(63),
      "a".repeat(65),
    ])
      expect(await auth.authenticate(value)).toBeNull();
    expect(spy).not.toHaveBeenCalled();
    await auth.logout(undefined);
  });
  it("rejects malformed challenges, addresses, and unsupported login chains", async () => {
    await expect(auth.verify("../other", "0x")).rejects.toMatchObject({
      status: 400,
      code: "INVALID_CHALLENGE",
    });
    await expect(auth.challenge("0x123", 1)).rejects.toMatchObject({
      code: "INVALID_ADDRESS",
    });
    await expect(
      auth.challenge("0x0000000000000000000000000000000000000000", 1),
    ).rejects.toMatchObject({ code: "INVALID_ADDRESS" });
    await expect(auth.challenge(alice.address, 8453)).rejects.toMatchObject({
      code: "AUTH_CHAIN_NOT_SUPPORTED",
    });
  });
  it("requires an exact HTTP(S) authentication origin and bounded session lifetime", () => {
    expect(
      () =>
        new AuthService(store, {
          ...config,
          appOrigin: "https://hoplane.example/path",
        }),
    ).toThrow("exact");
    expect(
      () =>
        new AuthService(store, {
          ...config,
          appOrigin: "https://user:pass@hoplane.example",
        }),
    ).toThrow("exact");
    expect(
      () => new AuthService(store, { ...config, sessionTtlMs: Infinity }),
    ).toThrow("lifetime");
  });
});
