import { CHAINS, TOKENS, tokensForChain } from './data'
import { readStored, validAmount, validRecipient } from './trade'
import type { Activity, Asset, Settings } from './types'

export const DEFAULT_SETTINGS: Readonly<Settings> = {
  slippage: 'auto', gasTopup: false, theme: 'light', testnet: true, deadline: 20,
}
const DEFAULT_FAVORITES = ['ETH', 'USDC', 'SOL']
const object = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const decimal = /^(?:\d+(?:\.\d*)?|\.\d+)$/
function validSlippage(value: unknown): value is string {
  return typeof value === 'string' && (value === 'auto' || (
    value.length <= 8 && /^(?:\d+(?:\.\d{0,2})?|\.\d{1,2})$/.test(value) && Number(value) >= 0 && Number(value) <= 50
  ))
}
/** Local storage is untrusted. Keep only known settings with valid field types. */
export function loadSettings(): Settings {
  const value = readStored<unknown>('hoplane.settings', null)
  const settings = {...DEFAULT_SETTINGS}
  if (!object(value)) return settings
  if (validSlippage(value.slippage)) settings.slippage = value.slippage
  if (typeof value.gasTopup === 'boolean') settings.gasTopup = value.gasTopup
  if (value.theme === 'light' || value.theme === 'dark') settings.theme = value.theme
  if (typeof value.testnet === 'boolean') settings.testnet = value.testnet
  if (typeof value.deadline === 'number' && Number.isInteger(value.deadline) && value.deadline >= 1 && value.deadline <= 120) settings.deadline = value.deadline
  return settings
}
function asset(value: unknown): Asset | null {
  if (!object(value) || typeof value.chainId !== 'number' || typeof value.symbol !== 'string') return null
  if (!CHAINS.some(chain => chain.id === value.chainId) || !tokensForChain(value.chainId).some(token => token.symbol === value.symbol)) return null
  return {chainId: value.chainId, symbol: value.symbol}
}
function activity(value: unknown): Activity | null {
  if (!object(value) || value.mode !== 'demo' || (value.status !== 'completed' && value.status !== 'refunded')) return null
  if (typeof value.id !== 'string' || !/^demo-[A-Za-z0-9-]{1,100}$/.test(value.id)) return null
  const from = asset(value.from)
  const to = asset(value.to)
  if (!from || !to || (from.chainId === to.chainId && from.symbol === to.symbol)) return null
  if (typeof value.amount !== 'string' || value.amount.length > 64 || !validAmount(value.amount)) return null
  if (typeof value.received !== 'string' || value.received.length > 64 || !decimal.test(value.received) || !Number.isFinite(Number(value.received)) || Number(value.received) < 0 || Number(value.received) > 1e18) return null
  if (typeof value.timestamp !== 'number' || !Number.isSafeInteger(value.timestamp) || value.timestamp < 0 || value.timestamp > Date.now() + 5 * 60_000) return null
  if (typeof value.recipient !== 'string' || value.recipient.length > 128 || !(value.recipient === 'Demo wallet' || validRecipient(value.recipient, 1) || validRecipient(value.recipient, 792703809))) return null
  return {
    id: value.id, from, to, amount: value.amount, received: value.received,
    timestamp: value.timestamp, status: value.status, mode: 'demo', recipient: value.recipient,
  }
}
/** Imported/local records remain simulations. Invalid records are discarded. */
export function loadActivity(): Activity[] {
  const value = readStored<unknown>('hoplane.activity', null)
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const records: Activity[] = []
  for (const candidate of value.slice(0, 100)) {
    const record = activity(candidate)
    if (record && !seen.has(record.id)) { records.push(record); seen.add(record.id) }
  }
  return records
}
export function loadFavorites(): string[] {
  const value = readStored<unknown>('hoplane.favorites', null)
  if (!Array.isArray(value)) return [...DEFAULT_FAVORITES]
  const known = new Set(TOKENS.map(token => token.symbol))
  return [...new Set(value.slice(0, 100).filter((symbol): symbol is string => typeof symbol === 'string' && known.has(symbol)))].slice(0, TOKENS.length)
}
