import { getAddress, isAddress } from "viem";

export type Network = "mainnet" | "testnet";
export interface AppConfig {
  nodeEnv: "development" | "test" | "production";
  port: number;
  host: string;
  appOrigin: string;
  allowedOrigins: string[];
  relayApiKey?: string;
  relayTimeoutMs: number;
  quoteTtlMs: number;
  maxSlippageBps: number;
  enableMainnet: boolean;
  enableExecution: boolean;
  allowedChainIds: Record<Network, number[]>;
  transactionTargets: Record<string, string[]>;
  storeDriver: "sqlite" | "firestore";
  databasePath: string;
  firebaseProjectId?: string;
  sessionTtlMs: number;
  authChainId: number;
}
const invalid = (name: string): never => {
  throw new Error(`Invalid server configuration: ${name}`);
};
function number(
  env: NodeJS.ProcessEnv,
  key: string,
  fallback: number,
  min: number,
  max: number,
): number {
  const text = env[key];
  if (text === undefined || text === "") return fallback;
  if (!/^\d+$/.test(text)) return invalid(key);
  const value = Number(text);
  if (!Number.isSafeInteger(value) || value < min || value > max)
    return invalid(key);
  return value;
}
function bool(env: NodeJS.ProcessEnv, key: string): boolean {
  const text = env[key];
  if (text === undefined || text === "" || text === "false") return false;
  if (text !== "true") return invalid(key);
  return true;
}
function origin(value: string, production: boolean): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return invalid("APP_ORIGIN / ALLOWED_ORIGINS");
  }
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/" ||
    url.origin === "null"
  )
    return invalid("APP_ORIGIN / ALLOWED_ORIGINS");
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (
    url.protocol !== "https:" &&
    !(url.protocol === "http:" && local && !production)
  )
    return invalid("APP_ORIGIN / ALLOWED_ORIGINS must use HTTPS");
  return url.origin;
}
function chains(value: string | undefined, defaults: number[]): number[] {
  if (value === undefined) return defaults;
  if (!value.trim()) return [];
  const parts = value.split(",").map((v) => v.trim());
  const result = parts.map((v) => (/^\d+$/.test(v) ? Number(v) : NaN));
  if (
    result.length > 100 ||
    result.some((v) => !Number.isSafeInteger(v) || v <= 0)
  )
    return invalid("ALLOWED_MAINNET_CHAINS / ALLOWED_TESTNET_CHAINS");
  return [...new Set(result)];
}
export function readConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const nodeEnv = env.NODE_ENV || "development";
  if (!["development", "test", "production"].includes(nodeEnv))
    return invalid("NODE_ENV");
  const production = nodeEnv === "production";
  if (production && (!env.APP_ORIGIN || !env.ALLOWED_ORIGINS))
    return invalid(
      "production requires APP_ORIGIN and explicit ALLOWED_ORIGINS",
    );
  const appOrigin = origin(
    env.APP_ORIGIN || "http://localhost:5173",
    production,
  );
  const allowedOrigins = [
    ...new Set(
      (env.ALLOWED_ORIGINS || appOrigin)
        .split(",")
        .map((v) => origin(v.trim(), production)),
    ),
  ];
  if (allowedOrigins.length > 10 || !allowedOrigins.includes(appOrigin))
    return invalid("ALLOWED_ORIGINS must include APP_ORIGIN, maximum ten");
  const storeDriver = env.STORE_DRIVER || (production ? "firestore" : "sqlite");
  if (storeDriver !== "sqlite" && storeDriver !== "firestore")
    return invalid("STORE_DRIVER");
  const firebaseProjectId = env.FIREBASE_PROJECT_ID?.trim() || undefined;
  if (
    firebaseProjectId &&
    !/^[a-z][a-z0-9-]{4,61}[a-z0-9]$/.test(firebaseProjectId)
  )
    return invalid("FIREBASE_PROJECT_ID");
  if (storeDriver === "firestore" && !firebaseProjectId)
    return invalid("FIREBASE_PROJECT_ID is required with Firestore");
  if (production && storeDriver !== "firestore")
    return invalid("production requires Firestore persistence");
  const relayApiKey = env.RELAY_API_KEY?.trim() || undefined;
  if (
    relayApiKey &&
    (relayApiKey.length < 8 ||
      relayApiKey.length > 1024 ||
      /[\s\x00-\x1f]/.test(relayApiKey))
  )
    return invalid("RELAY_API_KEY");
  let rawTargets: unknown = {};
  try {
    rawTargets = JSON.parse(env.ALLOWED_TRANSACTION_TARGETS_JSON || "{}");
  } catch {
    return invalid("ALLOWED_TRANSACTION_TARGETS_JSON");
  }
  if (
    !rawTargets ||
    typeof rawTargets !== "object" ||
    Array.isArray(rawTargets)
  )
    return invalid("ALLOWED_TRANSACTION_TARGETS_JSON");
  const transactionTargets: Record<string, string[]> = {};
  if (Object.keys(rawTargets).length > 100)
    return invalid("ALLOWED_TRANSACTION_TARGETS_JSON too large");
  for (const [key, values] of Object.entries(rawTargets)) {
    if (
      !/^[1-9]\d*$/.test(key) ||
      !Number.isSafeInteger(Number(key)) ||
      !Array.isArray(values) ||
      values.length > 50 ||
      values.some(
        (v) =>
          typeof v !== "string" ||
          !isAddress(v, { strict: true }) ||
          /^0x0{40}$/i.test(v),
      )
    )
      return invalid("ALLOWED_TRANSACTION_TARGETS_JSON");
    transactionTargets[key] = [
      ...new Set((values as string[]).map((v) => getAddress(v))),
    ];
  }
  const enableExecution = bool(env, "ENABLE_EXECUTION");
  if (
    enableExecution &&
    (!relayApiKey || !Object.values(transactionTargets).some((v) => v.length))
  )
    return invalid(
      "ENABLE_EXECUTION requires Relay key and reviewed transaction target allowlists",
    );
  return {
    nodeEnv: nodeEnv as AppConfig["nodeEnv"],
    port: number(env, "PORT", 8080, 1, 65535),
    host: env.HOST || "0.0.0.0",
    appOrigin,
    allowedOrigins,
    relayApiKey,
    relayTimeoutMs: number(env, "RELAY_TIMEOUT_MS", 10000, 500, 30000),
    quoteTtlMs: number(env, "QUOTE_TTL_MS", 30000, 5000, 60000),
    maxSlippageBps: number(env, "MAX_SLIPPAGE_BPS", 300, 0, 1000),
    enableMainnet: bool(env, "ENABLE_MAINNET"),
    enableExecution,
    allowedChainIds: {
      mainnet: chains(
        env.ALLOWED_MAINNET_CHAINS,
        [1, 8453, 42161, 10, 137, 56, 43114, 534352, 324],
      ),
      testnet: chains(env.ALLOWED_TESTNET_CHAINS, [11155111, 84532]),
    },
    transactionTargets,
    storeDriver,
    databasePath: env.DATABASE_PATH || "./.data/hoplane.sqlite",
    firebaseProjectId,
    sessionTtlMs: number(env, "SESSION_TTL_MS", 86400000, 300000, 604800000),
    authChainId: number(env, "AUTH_CHAIN_ID", 1, 1, Number.MAX_SAFE_INTEGER),
  };
}
