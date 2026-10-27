import type {
  PublicFeed,
  PublicTransaction,
} from "../../server/transactions-contract";
export const FIXED_NOW = Date.parse("2026-10-27T16:00:00Z");
export const walletA = `0x${"1".repeat(40)}`,
  walletB = `0x${"2".repeat(40)}`;
export const depositHash = `0x${"a".repeat(64)}`,
  fillHash = `0x${"b".repeat(64)}`;
export const currency = {
  chainId: 1,
  address: `0x${"0".repeat(40)}`,
  symbol: "ETH",
  name: "Ether",
  decimals: 18,
};
export const rawAmount = {
  currency,
  amount: "900719925474099312345",
  amountFormatted: "999",
  amountUsd: "999",
};
export function providerRow(now = FIXED_NOW) {
  return {
    id: "request_1",
    status: "success",
    user: walletA,
    recipient: walletB,
    createdAt: new Date(now - 15_000).toISOString(),
    updatedAt: new Date(now - 1000).toISOString(),
    data: {
      metadata: {
        sender: walletA,
        recipient: walletB,
        currencyIn: rawAmount,
        currencyOut: {
          ...rawAmount,
          currency: { ...currency, chainId: 8453 },
          amount: "10000000000000000",
        },
      },
      inTxs: [
        {
          hash: depositHash,
          chainId: 1,
          timestamp: Math.floor((now - 12_000) / 1000),
        },
      ],
      outTxs: [
        {
          hash: fillHash,
          chainId: 8453,
          timestamp: Math.floor((now - 2000) / 1000),
        },
      ],
    },
  };
}
export function publicRow(now = Date.now()): PublicTransaction {
  return {
    id: "request_1",
    status: "success",
    sender: walletA,
    recipient: walletB,
    from: {
      ...currency,
      amount: rawAmount.amount,
      amountFormatted: "900.719925474099312345",
      amountKind: "reported",
    },
    to: {
      ...currency,
      chainId: 8453,
      amount: "10000000000000000",
      amountFormatted: "0.01",
      amountKind: "reported",
    },
    depositTxs: [
      {
        hash: depositHash,
        chainId: 1,
        timestamp: now - 12000,
        status: "unknown",
      },
    ],
    fillTxs: [
      {
        hash: fillHash,
        chainId: 8453,
        timestamp: now - 2000,
        status: "unknown",
      },
    ],
    createdAt: now - 15_000,
    updatedAt: now - 1000,
    fillTimeSeconds: 10,
    requestType: null,
  };
}
export function publicFeed(now = Date.now()): PublicFeed {
  return {
    transactions: [publicRow(now)],
    fetchedAt: now,
    latestActivityAt: now - 1000,
    nextRefreshMs: 60_000,
    providerDataOld: false,
    omittedCount: 0,
    source: {
      name: "Relay network",
      scope: "public-network-activity",
      version: "v2",
      url: "https://api.relay.link/requests/v2",
      legacySunsetAt: Date.parse("2026-11-24T00:00:00Z"),
    },
  };
}
