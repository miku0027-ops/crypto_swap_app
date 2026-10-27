/// <reference types="vite/client" />
/** Relay network access only. This adapter is not yet wired into the preview UI.
 * API keys belong in the configured backend, never in VITE_* variables.
 */
export type RelayNetwork = 'mainnet' | 'testnet'
export type RelayVM = 'evm' | 'svm' | 'bvm' | 'tvm' | 'tonvm' | 'hypevm' | 'lvm' | 'xrpvm' | 'hederavm' | 'atlasvm'
export interface RelayCurrency {
  chainId: number
  address: string
  symbol: string
  name: string
  decimals: number
  vmType?: RelayVM
  metadata?: { logoURI?: string; verified?: boolean; isNative?: boolean }
}
export interface RelayChain {
  id: number
  name: string
  displayName?: string
  vmType?: RelayVM
  iconUrl?: string
  explorerUrl?: string
  disabled?: boolean
  depositEnabled?: boolean
  currency?: RelayCurrency
  [key: string]: unknown
}
export interface RelayRequestOptions {
  network?: RelayNetwork
  signal?: AbortSignal
  timeoutMs?: number
}
export interface CurrencySearch {
  chainIds?: number[]
  term?: string
  address?: string
  defaultList?: boolean
  verified?: boolean
  limit?: number
}
export interface RelayQuoteInput {
  user: string
  originChainId: number
  destinationChainId: number
  originCurrency: string
  destinationCurrency: string
  amount: string
  tradeType: 'EXACT_INPUT' | 'EXACT_OUTPUT'
  recipient?: string
  /** Basis points, e.g. '50' for 0.5%; omit to use Relay's automatic tolerance. */
  slippageTolerance?: string
  topupGas?: boolean
}
export interface RelayQuote {
  requestId?: string
  steps: Array<{
    id: string
    action?: string
    description?: string
    kind: 'transaction' | 'signature'
    items: Array<{ status: string; data?: unknown; check?: { endpoint: string; method: string } }>
  }>
  details?: Record<string, unknown>
  fees?: Record<string, unknown>
  [key: string]: unknown
}
export type RelayIntentState = 'waiting' | 'depositing' | 'pending' | 'submitted' | 'success' | 'failure' | 'refund'
export interface RelayIntentStatus {
  status: RelayIntentState
  inTxHashes: string[]
  txHashes: string[]
  originChainId?: number
  destinationChainId?: number
  updatedAt?: number
  details?: string
  failReason?: string
  refundFailReason?: string
}
export class RelayApiError extends Error {
  readonly status?: number
  readonly code?: string
  readonly retryAfterSeconds?: number
  constructor(message: string, options: {status?: number; code?: string; retryAfterSeconds?: number} = {}) {
    super(message)
    this.name = 'RelayApiError'
    this.status = options.status
    this.code = options.code
    this.retryAfterSeconds = options.retryAfterSeconds
  }
}
const PUBLIC_API: Record<RelayNetwork, string> = {
  mainnet: 'https://api.relay.link',
  testnet: 'https://api.testnets.relay.link',
}
const object = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
function retryAfter(header: string | null): number | undefined {
  if (!header) return undefined
  const seconds = Number(header)
  if (Number.isFinite(seconds)) return Math.max(0, seconds)
  const timestamp = Date.parse(header)
  return Number.isFinite(timestamp) ? Math.max(0, Math.ceil((timestamp - Date.now()) / 1000)) : undefined
}
async function requestJson(url: string, init: RequestInit, options: RelayRequestOptions): Promise<unknown> {
  const controller = new AbortController()
  const abort = () => controller.abort(options.signal?.reason)
  if (options.signal?.aborted) abort()
  else options.signal?.addEventListener('abort', abort, {once: true})
  let timedOut = false
  const timer = setTimeout(() => { timedOut = true; controller.abort() }, options.timeoutMs ?? 12_000)
  try {
    const response = await fetch(url, {...init, signal: controller.signal, credentials: 'omit'})
    const raw = await response.text()
    let body: unknown
    try { body = raw ? JSON.parse(raw) : null } catch {
      throw new RelayApiError(response.ok ? 'The API returned an unreadable response.' : `The API request failed (${response.status}).`, {status: response.status})
    }
    if (!response.ok) {
      const message = object(body) && typeof body.message === 'string' ? body.message
        : object(body) && typeof body.error === 'string' ? body.error
        : response.status === 429 ? 'Too many requests. Please wait before trying again.'
        : response.status === 401 ? 'The backend could not authenticate with Relay.'
        : `The API request failed (${response.status}).`
      throw new RelayApiError(message, {
        status: response.status,
        code: object(body) && typeof body.errorCode === 'string' ? body.errorCode : undefined,
        retryAfterSeconds: retryAfter(response.headers.get('Retry-After')),
      })
    }
    return body
  } catch (error) {
    if (timedOut) throw new RelayApiError('The request timed out. Please try again.', {code: 'TIMEOUT'})
    if (options.signal?.aborted) throw error
    if (error instanceof RelayApiError) throw error
    throw new RelayApiError('Could not reach the API. Check your connection and try again.', {code: 'NETWORK_ERROR'})
  } finally {
    clearTimeout(timer)
    options.signal?.removeEventListener('abort', abort)
  }
}
const publicUrl = (path: string, options: RelayRequestOptions) => `${PUBLIC_API[options.network ?? 'mainnet']}${path}`
const invalidResponse = () => new RelayApiError('The API response does not match the expected format.', {code: 'INVALID_RESPONSE'})
export async function fetchRelayChains(options: RelayRequestOptions = {}): Promise<RelayChain[]> {
  const body = await requestJson(publicUrl('/chains', options), {method: 'GET'}, options)
  if (!object(body) || !Array.isArray(body.chains) || !body.chains.every(chain => object(chain) && typeof chain.id === 'number' && typeof chain.name === 'string')) throw invalidResponse()
  return body.chains as RelayChain[]
}
export async function fetchRelayCurrencies(search: CurrencySearch, options: RelayRequestOptions = {}): Promise<RelayCurrency[]> {
  const body = await requestJson(publicUrl('/currencies/v2', options), {
    method: 'POST', headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({...search, limit: Math.max(1, Math.min(100, search.limit ?? 20))}),
  }, options)
  if (!Array.isArray(body) || !body.every(currency => object(currency) && typeof currency.chainId === 'number' && typeof currency.address === 'string' && typeof currency.symbol === 'string' && typeof currency.decimals === 'number')) throw invalidResponse()
  return body as RelayCurrency[]
}
export function configuredApiBase(): string | undefined {
  const base = import.meta.env.VITE_API_BASE_URL?.trim()
  if (!base) return undefined
  if (!/^https?:\/\//i.test(base) && !/^\/(?!\/)/.test(base)) {
    throw new RelayApiError('VITE_API_BASE_URL must be an HTTP(S) URL or a relative backend path.', {code: 'INVALID_CONFIG'})
  }
  return base.replace(/\/+$/, '')
}
/** The backend must keep x-api-key server-side, validate input, and apply rate limits. */
export async function requestRelayQuote(quote: RelayQuoteInput, options: RelayRequestOptions = {}): Promise<RelayQuote> {
  const base = configuredApiBase()
  if (base === undefined) throw new RelayApiError('Live quotes are not configured. Connect the Hoplane backend first.', {code: 'NOT_CONFIGURED'})
  if (!/^\d+$/.test(quote.amount) || BigInt(quote.amount) <= 0n) throw new RelayApiError('Quote amount must be positive integer token base units.', {code: 'INVALID_AMOUNT'})
  if (quote.slippageTolerance !== undefined && (!/^(?:\d{1,4}|10000)$/.test(quote.slippageTolerance))) throw new RelayApiError('Slippage must be an integer from 0 to 10000 basis points.', {code: 'INVALID_SLIPPAGE'})
  const body = await requestJson(`${base}/relay/quote`, {
    method: 'POST', headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({network: options.network ?? 'mainnet', quote}),
  }, options)
  if (!object(body) || !Array.isArray(body.steps)) throw invalidResponse()
  return body as unknown as RelayQuote
}
export async function fetchRelayStatus(requestId: string, options: RelayRequestOptions = {}): Promise<RelayIntentStatus> {
  if (!requestId.trim()) throw new RelayApiError('A request ID is required.', {code: 'INVALID_REQUEST_ID'})
  const body = await requestJson(publicUrl(`/intents/status/v3?requestId=${encodeURIComponent(requestId)}`, options), {method: 'GET'}, options)
  const states: RelayIntentState[] = ['waiting', 'depositing', 'pending', 'submitted', 'success', 'failure', 'refund']
  if (!object(body) || !states.includes(body.status as RelayIntentState)) throw invalidResponse()
  const hashes = (value: unknown) => Array.isArray(value) ? value.filter((hash): hash is string => typeof hash === 'string') : []
  return {...body, status: body.status as RelayIntentState, inTxHashes: hashes(body.inTxHashes), txHashes: hashes(body.txHashes)} as RelayIntentStatus
}
export function shouldPollRelayStatus(status: RelayIntentStatus): boolean {
  return status.status !== 'success' && status.status !== 'refund' && !(status.status === 'failure' && Boolean(status.refundFailReason))
}
/** Accepted/submitted requests are not settlement; require the destination fill hash. */
export function isRelaySettled(status: RelayIntentStatus): boolean {
  return status.status === 'success' && status.txHashes.length > 0
}
