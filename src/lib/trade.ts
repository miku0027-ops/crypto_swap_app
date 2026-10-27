import { tokenFor } from "./data";
import type { Asset } from "./types";
export function validAmount(value: string): boolean {
  return (
    /^(?:\d+\.?\d*|\.\d+)$/.test(value) &&
    Number.isFinite(Number(value)) &&
    Number(value) > 0 &&
    Number(value) <= 1e12
  );
}
export function validRecipient(value: string, chainId: number): boolean {
  return chainId === 792703809
    ? /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value)
    : /^0x[0-9a-fA-F]{40}$/.test(value);
}
export function previewQuote(
  amount: string,
  from: Asset,
  to: Asset,
  slippage: string,
) {
  const usd = validAmount(amount)
    ? Number(amount) * tokenFor(from.symbol).price
    : 0;
  const fee = usd > 0 ? Math.min(usd * 0.0035, usd * 0.02) : 0;
  const out = Math.max(0, usd - fee) / tokenFor(to.symbol).price;
  const slip = slippage === "auto" ? 0.5 : Number(slippage);
  return {
    usd,
    fee,
    out,
    minimum: out * (1 - slip / 100),
    rate: tokenFor(from.symbol).price / tokenFor(to.symbol).price,
    seconds: from.chainId === to.chainId ? 8 : 15,
  };
}
export function readStored<T>(key: string, fallback: T): T {
  try {
    const value = localStorage.getItem(key);
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}
export function saveStored(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* Browser storage may be unavailable. */
  }
}
