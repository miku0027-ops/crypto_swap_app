import { describe, it, expect } from "vitest";
import { readConfig } from "./config.js";
describe("server configuration", () => {
  it("defaults to testnet read-only and local persistent development storage", () => {
    const config = readConfig({});
    expect(config.enableMainnet).toBe(false);
    expect(config.enableExecution).toBe(false);
    expect(config.storeDriver).toBe("sqlite");
    expect(config.maxSlippageBps).toBe(300);
    expect(config.allowedOrigins).toEqual(["http://localhost:5173"]);
  });
  it("requires production origin and durable store", () => {
    expect(() => readConfig({ NODE_ENV: "production" })).toThrow();
    expect(() =>
      readConfig({
        NODE_ENV: "production",
        APP_ORIGIN: "https://hoplane.example",
        ALLOWED_ORIGINS: "https://hoplane.example",
        STORE_DRIVER: "sqlite",
      }),
    ).toThrow();
    expect(() =>
      readConfig({
        NODE_ENV: "production",
        APP_ORIGIN: "https://hoplane.example",
        ALLOWED_ORIGINS: "https://hoplane.example",
        FIREBASE_PROJECT_ID: "hoplane-prod",
      }),
    ).not.toThrow();
  });
  it.each([
    "*",
    "http://example.com",
    "https://user:pass@example.com",
    "https://example.com/path",
    "https://example.com/?x=1",
  ])("rejects unsafe origin %s", (value) => {
    expect(() => readConfig({ APP_ORIGIN: value })).toThrow();
  });
  it.each(["yes", "1", "TRUE", "false "])(
    "rejects ambiguous booleans %s",
    (value) => {
      expect(() => readConfig({ ENABLE_MAINNET: value })).toThrow();
    },
  );
  it("requires key and reviewed target list to enable wallet execution", () => {
    expect(() => readConfig({ ENABLE_EXECUTION: "true" })).toThrow();
    expect(() =>
      readConfig({ ENABLE_EXECUTION: "true", RELAY_API_KEY: "test-only-key" }),
    ).toThrow();
  });
  it("never includes credential values in configuration errors", () => {
    try {
      readConfig({ RELAY_API_KEY: "private secret\n" });
    } catch (e) {
      expect(String(e)).not.toContain("private secret");
    }
  });
  it.each([
    '{"1":"any"}',
    '{"1":["0x0000000000000000000000000000000000000000"]}',
    '{"__proto__":[]}',
    "[]",
    "notjson",
  ])("rejects invalid transaction allowlists %s", (value) => {
    expect(() =>
      readConfig({ ALLOWED_TRANSACTION_TARGETS_JSON: value }),
    ).toThrow();
  });
  it("validates numeric bounds and chain IDs", () => {
    expect(() => readConfig({ PORT: "1.2" })).toThrow();
    expect(() => readConfig({ MAX_SLIPPAGE_BPS: "1001" })).toThrow();
    expect(() => readConfig({ ALLOWED_TESTNET_CHAINS: "1,0" })).toThrow();
    expect(
      readConfig({ ALLOWED_TESTNET_CHAINS: "11155111,11155111" })
        .allowedChainIds.testnet,
    ).toEqual([11155111]);
  });
});
