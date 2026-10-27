import { z } from "zod";
// Preserve the strict browser/Worker CSP without probing dynamic code execution.
z.config({ jitless: true });

const text = (max: number) =>
  z
    .string()
    .min(1)
    .max(max)
    .regex(/^[^\x00-\x1f\x7f\u202a-\u202e\u2066-\u2069]+$/);
const identifier = z
  .string()
  .min(1)
  .max(256)
  .regex(/^[a-zA-Z0-9:_-]+$/);
const timestamp = z.number().int().positive().max(8_640_000_000_000_000);
const chain = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const decimal = z
  .string()
  .max(120)
  .regex(/^(0|[1-9]\d{0,77})(?:\.\d{1,36})?$/);
export const publicStatusSchema = z.enum([
  "waiting",
  "depositing",
  "pending",
  "submitted",
  "success",
  "failure",
  "refund",
  "unknown",
]);
export const publicLegSchema = z.object({
  chainId: chain,
  address: identifier,
  symbol: text(32),
  amount: z
    .string()
    .max(78)
    .regex(/^(0|[1-9]\d*)$/),
  decimals: z.number().int().min(0).max(36),
  amountFormatted: decimal,
  amountKind: z.enum(["reported", "quoted"]),
});
export const publicTransactionSchema = z.object({
  id: identifier,
  status: publicStatusSchema,
  sender: identifier.nullable(),
  recipient: identifier.nullable(),
  from: publicLegSchema.nullable(),
  to: publicLegSchema.nullable(),
  depositTxs: z
    .array(
      z.object({
        hash: identifier,
        chainId: chain,
        timestamp: timestamp.nullable(),
        status: z.enum(["success", "failure", "unknown"]),
      }),
    )
    .max(32),
  fillTxs: z
    .array(
      z.object({
        hash: identifier,
        chainId: chain,
        timestamp: timestamp.nullable(),
        status: z.enum(["success", "failure", "unknown"]),
      }),
    )
    .max(32),
  createdAt: timestamp,
  updatedAt: timestamp,
  fillTimeSeconds: z.number().finite().min(0).max(31_536_000).nullable(),
  requestType: text(64).nullable(),
});
export const publicFeedSchema = z.object({
  transactions: z.array(publicTransactionSchema).max(50),
  fetchedAt: timestamp,
  latestActivityAt: timestamp.nullable(),
  nextRefreshMs: z.number().int().min(10_000).max(300_000),
  providerDataOld: z.boolean(),
  omittedCount: z.number().int().min(0).max(50),
  source: z.object({
    name: z.literal("Relay network"),
    scope: z.literal("public-network-activity"),
    version: z.enum(["v2", "v3"]),
    url: z.enum([
      "https://api.relay.link/requests/v2",
      "https://api.relay.link/requests/v3",
    ]),
    legacySunsetAt: timestamp.nullable(),
  }),
});
export type PublicLeg = z.infer<typeof publicLegSchema>;
export type PublicTransaction = z.infer<typeof publicTransactionSchema>;
export type PublicFeed = z.infer<typeof publicFeedSchema>;
