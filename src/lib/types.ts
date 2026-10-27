export type Chain = {
  id: number;
  name: string;
  short: string;
  color: string;
  symbol: string;
  explorer: string;
};
export type Token = {
  symbol: string;
  name: string;
  color: string;
  price: number;
  decimals: number;
  address: string;
};
export type Asset = { chainId: number; symbol: string };
export type Activity = {
  id: string;
  from: Asset;
  to: Asset;
  amount: string;
  received: string;
  timestamp: number;
  status: "completed" | "refunded";
  mode: "demo";
  recipient: string;
};
export type Settings = {
  slippage: string;
  gasTopup: boolean;
  theme: "light" | "dark";
  testnet: boolean;
  deadline: number;
};
export type Wallet = {
  address: string;
  type: "demo" | "injected";
  name: string;
};
