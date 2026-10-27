import { describe, expect, it } from "vitest";
import { AppError } from "./errors.js";
import {
  addressSchema,
  parseInput,
  positiveUintSchema,
  uintSchema,
  walletAddressSchema,
  ZERO_ADDRESS,
} from "./validation.js";

describe("untrusted amount validation", () => {
  it.each([
    "",
    " ",
    "1e18",
    "1.2",
    "-1",
    "+1",
    "01",
    "0x123",
    "Infinity",
    "NaN",
    "1_000",
    "١",
    "9".repeat(79),
    (2n ** 256n).toString(),
    null,
    undefined,
    1,
    {},
    [],
  ])("returns a 400 validation error for %j", (value) => {
    for (const schema of [uintSchema, positiveUintSchema]) {
      expect(() => parseInput(schema, value)).toThrow(AppError);
      expect(() => parseInput(schema, value)).toThrow(
        expect.objectContaining({ status: 400, code: "VALIDATION_ERROR" }),
      );
      expect(() => schema.safeParse(value)).not.toThrow();
      expect(schema.safeParse(value).success).toBe(false);
    }
  });
  it("preserves canonical uint256 precision and distinguishes positive amounts", () => {
    const maximum = (2n ** 256n - 1n).toString();
    expect(parseInput(uintSchema, maximum)).toBe(maximum);
    expect(parseInput(positiveUintSchema, maximum)).toBe(maximum);
    expect(parseInput(uintSchema, "0")).toBe("0");
    expect(() => parseInput(positiveUintSchema, "0")).toThrow(
      expect.objectContaining({ status: 400 }),
    );
  });
});

describe("address normalization", () => {
  it.each([
    "",
    "0x",
    "0x" + "g".repeat(40),
    "0x52908400098527886E0F7030069857D2E4169Ee7",
    null,
    1,
    {},
  ])("rejects %j before the checksum transform can throw", (value) => {
    expect(() => addressSchema.safeParse(value)).not.toThrow();
    expect(() => parseInput(addressSchema, value)).toThrow(
      expect.objectContaining({ status: 400, code: "VALIDATION_ERROR" }),
    );
  });
  it("normalizes valid lowercase addresses and reserves zero for native currency", () => {
    expect(
      parseInput(addressSchema, "0x52908400098527886e0f7030069857d2e4169ee7"),
    ).toBe("0x52908400098527886E0F7030069857D2E4169EE7");
    expect(parseInput(addressSchema, ZERO_ADDRESS)).toBe(ZERO_ADDRESS);
    expect(() => parseInput(walletAddressSchema, ZERO_ADDRESS)).toThrow(
      expect.objectContaining({ status: 400 }),
    );
  });
});
