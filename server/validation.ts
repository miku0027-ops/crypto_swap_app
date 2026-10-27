import { z } from "zod";
import { getAddress, isAddress } from "viem";
import { AppError } from "./errors.js";
export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
export const networkSchema = z.enum(["mainnet", "testnet"]);
export const addressSchema = z
  .string()
  .length(42)
  .refine(
    (value) => isAddress(value, { strict: true }),
    "Invalid EVM address or checksum",
  )
  .transform((value) => getAddress(value));
export const walletAddressSchema = addressSchema.refine(
  (value) => value !== ZERO_ADDRESS,
  "A nonzero wallet address is required",
);
const canonicalUint = /^(0|[1-9]\d{0,77})$/;
// Zod continues refinements after a regex issue. Every BigInt conversion must
// therefore guard its own input to keep malformed request data a validation error.
export const uintSchema = z
  .string()
  .regex(canonicalUint)
  .refine(
    (v) => canonicalUint.test(v) && BigInt(v) < 2n ** 256n,
    "Amount exceeds uint256",
  );
export const positiveUintSchema = uintSchema.refine(
  (v) => canonicalUint.test(v) && BigInt(v) > 0n,
  "Amount must be positive",
);
export const chainIdSchema = z
  .number()
  .int()
  .positive()
  .max(Number.MAX_SAFE_INTEGER);
export const requestIdSchema = z
  .string()
  .min(1)
  .max(160)
  .regex(/^[A-Za-z0-9_-]+$/);
export const hashSchema = z.string().regex(/^0x[0-9a-fA-F]{64}$/);
export const quoteInputSchema = z
  .object({
    user: walletAddressSchema,
    originChainId: chainIdSchema,
    destinationChainId: chainIdSchema,
    originCurrency: addressSchema,
    destinationCurrency: addressSchema,
    amount: positiveUintSchema,
    tradeType: z.enum(["EXACT_INPUT", "EXACT_OUTPUT"]),
    recipient: walletAddressSchema.optional(),
    slippageTolerance: z
      .string()
      .regex(/^(0|[1-9]\d{0,3}|10000)$/)
      .optional(),
    topupGas: z.boolean().optional(),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (
      v.originChainId === v.destinationChainId &&
      v.originCurrency === v.destinationCurrency
    )
      ctx.addIssue({
        code: "custom",
        path: ["destinationCurrency"],
        message: "Choose a different token or chain",
      });
  });
export const quoteRequestSchema = z
  .object({ network: networkSchema, quote: quoteInputSchema })
  .strict();
export const currencySearchSchema = z
  .object({
    chainIds: z.array(chainIdSchema).min(1).max(5),
    term: z.string().trim().max(80).optional(),
    address: addressSchema.optional(),
    limit: z.number().int().min(1).max(50).default(20),
  })
  .strict();
export type QuoteInput = z.infer<typeof quoteInputSchema>;
export type CurrencySearch = z.input<typeof currencySearchSchema>;
export function parseInput<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success)
    throw new AppError(
      400,
      "VALIDATION_ERROR",
      result.error.issues
        .slice(0, 3)
        .map(
          (issue) => `${issue.path.join(".") || "request"}: ${issue.message}`,
        )
        .join("; "),
    );
  return result.data;
}
