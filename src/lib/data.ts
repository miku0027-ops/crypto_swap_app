import type { Chain, Token } from "./types";
export const CHAINS: Chain[] = [
  {
    id: 1,
    name: "Ethereum",
    short: "ETH",
    color: "#7186d8",
    symbol: "Ξ",
    explorer: "https://etherscan.io",
  },
  {
    id: 8453,
    name: "Base",
    short: "BASE",
    color: "#255cf6",
    symbol: "━",
    explorer: "https://basescan.org",
  },
  {
    id: 42161,
    name: "Arbitrum",
    short: "ARB",
    color: "#2b78c9",
    symbol: "Λ",
    explorer: "https://arbiscan.io",
  },
  {
    id: 10,
    name: "Optimism",
    short: "OP",
    color: "#ee374b",
    symbol: "OP",
    explorer: "https://optimistic.etherscan.io",
  },
  {
    id: 137,
    name: "Polygon",
    short: "POL",
    color: "#8555d4",
    symbol: "⬡",
    explorer: "https://polygonscan.com",
  },
  {
    id: 792703809,
    name: "Solana",
    short: "SOL",
    color: "#171a2a",
    symbol: "≋",
    explorer: "https://solscan.io",
  },
  {
    id: 56,
    name: "BNB Chain",
    short: "BNB",
    color: "#e8b923",
    symbol: "◇",
    explorer: "https://bscscan.com",
  },
  {
    id: 43114,
    name: "Avalanche",
    short: "AVAX",
    color: "#e75058",
    symbol: "▲",
    explorer: "https://snowtrace.io",
  },
  {
    id: 534352,
    name: "Scroll",
    short: "SCR",
    color: "#bc9a78",
    symbol: "S",
    explorer: "https://scrollscan.com",
  },
  {
    id: 324,
    name: "ZKsync",
    short: "ZK",
    color: "#23274e",
    symbol: "⇄",
    explorer: "https://explorer.zksync.io",
  },
];
export const TOKENS: Token[] = [
  {
    symbol: "ETH",
    name: "Ethereum",
    color: "#7686ca",
    price: 2486.32,
    decimals: 18,
    address: "0x0000000000000000000000000000000000000000",
  },
  {
    symbol: "USDC",
    name: "USD Coin",
    color: "#2775ca",
    price: 1,
    decimals: 6,
    address: "0xA0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
  },
  {
    symbol: "USDT",
    name: "Tether USD",
    color: "#26a17b",
    price: 1,
    decimals: 6,
    address: "0xdAC17F958D2ee523a2206206994597C13D831ec7",
  },
  {
    symbol: "WBTC",
    name: "Wrapped Bitcoin",
    color: "#f09a36",
    price: 68250.6,
    decimals: 8,
    address: "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599",
  },
  {
    symbol: "DAI",
    name: "Dai",
    color: "#edb444",
    price: 1,
    decimals: 18,
    address: "0x6B175474E89094C44Da98b954EedeAC495271d0F",
  },
  {
    symbol: "SOL",
    name: "Solana",
    color: "#181c28",
    price: 148.24,
    decimals: 9,
    address: "So11111111111111111111111111111111111111112",
  },
  {
    symbol: "BNB",
    name: "BNB",
    color: "#dfb42c",
    price: 584.2,
    decimals: 18,
    address: "native-bnb",
  },
  {
    symbol: "AVAX",
    name: "Avalanche",
    color: "#e75058",
    price: 28.64,
    decimals: 18,
    address: "native-avax",
  },
];
export const chainFor = (id: number) =>
  CHAINS.find((c) => c.id === id) ?? CHAINS[0];
export const tokenFor = (symbol: string) =>
  TOKENS.find((t) => t.symbol === symbol) ?? TOKENS[0];
export const tokensForChain = (id: number) =>
  TOKENS.filter((t) =>
    id === 792703809
      ? ["SOL", "USDC", "USDT"].includes(t.symbol)
      : id === 56
        ? ["BNB", "USDC", "USDT", "DAI"].includes(t.symbol)
        : id === 43114
          ? ["AVAX", "USDC", "USDT", "WBTC"].includes(t.symbol)
          : !["SOL", "BNB", "AVAX"].includes(t.symbol),
  );
export const demoBalance = (symbol: string) =>
  ({
    ETH: 1.284,
    USDC: 2450.5,
    USDT: 820,
    WBTC: 0.012,
    DAI: 250,
    SOL: 8.5,
    BNB: 1.7,
    AVAX: 12,
  })[symbol] ?? 0;
export const money = (n: number, currency = "USD") =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(n);
export const shortAddress = (a: string) =>
  a.length > 14 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a;
