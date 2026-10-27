import { createHash, randomBytes, randomUUID } from "node:crypto";
import {
  getAddress,
  isAddress,
  verifyMessage,
  type Address,
  type Hex,
} from "viem";
import { createSiweMessage } from "viem/siwe";
import type { Store } from "./store.js";
import { AppError } from "./errors.js";

export interface Session {
  address: Address;
  csrfToken: string;
  createdAt: number;
  expiresAt: number;
}
export interface AuthConfig {
  appOrigin: string;
  authChainId: number;
  sessionTtlMs: number;
}
interface Challenge {
  address: Address;
  chainId: number;
  message: string;
  createdAt: number;
  expiresAt: number;
}
export interface AuthChallenge {
  challengeId: string;
  message: string;
  expiresAt: number;
}
const challengeIdPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const tokenPattern = /^[0-9a-f]{64}$/;
const hashToken = (token: string) =>
  createHash("sha256").update(token).digest("hex");

/** EOA authentication only. No funds are signed, sent, or held by this service. */
export class AuthService {
  private readonly origin: string;
  private readonly domain: string;
  constructor(
    private readonly store: Store,
    private readonly config: AuthConfig,
    private readonly clock: () => number = Date.now,
  ) {
    const url = new URL(config.appOrigin);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.origin !== config.appOrigin
    )
      throw new Error("Authentication origin must be an exact HTTP(S) origin.");
    if (!Number.isSafeInteger(config.authChainId) || config.authChainId < 1)
      throw new Error("Invalid authentication chain.");
    if (
      !Number.isSafeInteger(config.sessionTtlMs) ||
      config.sessionTtlMs < 60_000 ||
      config.sessionTtlMs > 7 * 24 * 60 * 60 * 1000
    )
      throw new Error("Invalid authentication session lifetime.");
    this.origin = url.origin;
    this.domain = url.host;
  }
  async challenge(address: string, chainId: number): Promise<AuthChallenge> {
    if (!isAddress(address, { strict: true }) || /^0x0{40}$/i.test(address))
      throw new AppError(
        400,
        "INVALID_ADDRESS",
        "Enter a valid non-zero Ethereum wallet address.",
      );
    if (chainId !== this.config.authChainId)
      throw new AppError(
        400,
        "AUTH_CHAIN_NOT_SUPPORTED",
        "This network is not configured for wallet sign-in.",
      );
    const normalized = getAddress(address),
      now = this.clock(),
      expiresAt = now + 5 * 60 * 1000;
    const challengeId = randomUUID(),
      nonce = randomBytes(16).toString("hex");
    const message = createSiweMessage({
      address: normalized,
      chainId,
      domain: this.domain,
      uri: this.origin,
      version: "1",
      nonce,
      issuedAt: new Date(now),
      expirationTime: new Date(expiresAt),
      statement:
        "Sign in to Hoplane. This signature does not authorize any transfer of funds.",
    });
    const record: Challenge = {
      address: normalized,
      chainId,
      message,
      createdAt: now,
      expiresAt,
    };
    if (
      !(await this.store.create(
        "auth_challenges",
        challengeId,
        record,
        expiresAt,
      ))
    )
      throw new AppError(
        503,
        "AUTH_UNAVAILABLE",
        "Could not create a sign-in challenge. Please retry.",
      );
    return { challengeId, message, expiresAt };
  }
  async verify(
    challengeId: string,
    signature: string,
  ): Promise<{ token: string; session: Session }> {
    if (!challengeIdPattern.test(challengeId))
      throw new AppError(
        400,
        "INVALID_CHALLENGE",
        "The sign-in challenge is invalid.",
      );
    // Even a malformed signature consumes a valid challenge: every challenge permits one attempt.
    const challenge = await this.store.consume<Challenge>(
      "auth_challenges",
      challengeId,
    );
    if (!challenge || challenge.expiresAt <= this.clock())
      throw new AppError(
        401,
        "CHALLENGE_EXPIRED",
        "This sign-in request expired or was already used. Start again.",
      );
    if (!/^0x[0-9a-fA-F]{130}$/.test(signature))
      throw new AppError(
        400,
        "INVALID_SIGNATURE",
        "The wallet signature is invalid.",
      );
    let valid = false;
    try {
      valid = await verifyMessage({
        address: challenge.address,
        message: challenge.message,
        signature: signature as Hex,
      });
    } catch {
      valid = false;
    }
    if (!valid)
      throw new AppError(
        401,
        "SIGNATURE_REJECTED",
        "The signature does not match this wallet sign-in request.",
      );
    // Recheck after asynchronous verification, so a challenge cannot cross its expiry boundary.
    const now = this.clock();
    if (challenge.expiresAt <= now)
      throw new AppError(
        401,
        "CHALLENGE_EXPIRED",
        "This sign-in request expired. Start again.",
      );
    const token = randomBytes(32).toString("hex");
    const session: Session = {
      address: challenge.address,
      csrfToken: randomBytes(32).toString("hex"),
      createdAt: now,
      expiresAt: now + this.config.sessionTtlMs,
    };
    if (
      !(await this.store.create(
        "sessions",
        hashToken(token),
        session,
        session.expiresAt,
      ))
    )
      throw new AppError(
        503,
        "AUTH_UNAVAILABLE",
        "Could not establish a session. Please retry.",
      );
    return { token, session };
  }
  async authenticate(
    token: string | undefined | null,
  ): Promise<Session | null> {
    if (typeof token !== "string" || !tokenPattern.test(token)) return null;
    const session = await this.store.get<Session>("sessions", hashToken(token));
    return session && session.expiresAt > this.clock() ? session : null;
  }
  async logout(token: string | undefined | null): Promise<void> {
    if (typeof token === "string" && tokenPattern.test(token))
      await this.store.delete("sessions", hashToken(token));
  }
}
