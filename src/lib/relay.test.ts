import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchRelayChains, fetchRelayCurrencies, fetchRelayStatus, isRelaySettled, RelayApiError, requestRelayQuote, shouldPollRelayStatus } from './relay'
import type { RelayIntentStatus, RelayQuoteInput } from './relay'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  vi.useRealTimers()
})
const quote: RelayQuoteInput = {
  user: '0x52908400098527886E0F7030069857D2E4169EE7',
  originChainId: 8453, destinationChainId: 42161,
  originCurrency: '0x0000000000000000000000000000000000000000',
  destinationCurrency: '0x0000000000000000000000000000000000000000',
  amount: '1000000000000000', tradeType: 'EXACT_INPUT',
}
const response = (body: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), {status, headers})

describe('Relay read adapter', () => {
  it('selects the testnet host and returns validated chain metadata', async () => {
    const fetch = vi.fn().mockResolvedValue(response({chains: [{id: 11155111, name: 'sepolia'}]}))
    vi.stubGlobal('fetch', fetch)
    const chains = await fetchRelayChains({network: 'testnet'})
    expect(fetch.mock.calls[0][0]).toBe('https://api.testnets.relay.link/chains')
    expect(chains[0].id).toBe(11155111)
  })
  it('rejects unexpected payloads instead of silently showing an empty list', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({unexpected: []})))
    await expect(fetchRelayChains()).rejects.toMatchObject({code: 'INVALID_RESPONSE'})
  })
  it('posts token filters and caps results at the documented limit', async () => {
    const fetch = vi.fn().mockResolvedValue(response([]))
    vi.stubGlobal('fetch', fetch)
    await fetchRelayCurrencies({chainIds: [8453], term: 'USDC', limit: 500})
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({chainIds: [8453], term: 'USDC', limit: 100})
  })
  it('preserves a rate-limit error code and retry delay', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({message: 'Slow down', errorCode: 'RATE_LIMITED'}, 429, {'Retry-After': '30'})))
    await expect(fetchRelayChains()).rejects.toMatchObject({status: 429, code: 'RATE_LIMITED', retryAfterSeconds: 30, message: 'Slow down'})
  })
  it('aborts a slow request and distinguishes timeout from an HTTP failure', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('fetch', vi.fn((_url: string, init: RequestInit) => new Promise((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))
    })))
    const request = fetchRelayChains({timeoutMs: 20}).catch(error => error)
    await vi.advanceTimersByTimeAsync(21)
    const error = await request
    expect(error).toBeInstanceOf(RelayApiError)
    expect(error.code).toBe('TIMEOUT')
  })
  it('preserves caller cancellation without turning it into a retryable network error', async () => {
    const controller = new AbortController()
    vi.stubGlobal('fetch', vi.fn((_url: string, init: RequestInit) => new Promise((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))
    })))
    const request = fetchRelayChains({signal: controller.signal}).catch(error => error)
    controller.abort()
    expect((await request).name).toBe('AbortError')
  })
})

describe('Relay backend quote boundary', () => {
  it('does not contact any API when no backend is configured', async () => {
    vi.stubEnv('VITE_API_BASE_URL', '')
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    await expect(requestRelayQuote(quote)).rejects.toMatchObject({code: 'NOT_CONFIGURED'})
    expect(fetch).not.toHaveBeenCalled()
  })
  it('sends quote requests to the configured backend, without a browser API key', async () => {
    vi.stubEnv('VITE_API_BASE_URL', 'https://api.example.test/api/')
    const fetch = vi.fn().mockResolvedValue(response({steps: []}))
    vi.stubGlobal('fetch', fetch)
    await requestRelayQuote(quote, {network: 'testnet'})
    expect(fetch.mock.calls[0][0]).toBe('https://api.example.test/api/relay/quote')
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({network: 'testnet', quote})
    expect(fetch.mock.calls[0][1].headers).toEqual({'Content-Type': 'application/json'})
  })
  it.each(['0', '-1', '0.1', '1e18'])('rejects invalid token base-unit amount %s', async amount => {
    vi.stubEnv('VITE_API_BASE_URL', '/api')
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    await expect(requestRelayQuote({...quote, amount})).rejects.toMatchObject({code: 'INVALID_AMOUNT'})
    expect(fetch).not.toHaveBeenCalled()
  })
})

describe('Relay settlement state', () => {
  const status = (state: RelayIntentStatus['status'], extra: Partial<RelayIntentStatus> = {}): RelayIntentStatus => ({status: state, inTxHashes: [], txHashes: [], ...extra})
  it('keeps monitoring fill failures that may still be refunded or retried', () => {
    expect(shouldPollRelayStatus(status('failure'))).toBe(true)
    expect(shouldPollRelayStatus(status('failure', {refundFailReason: 'AMOUNT_TOO_LOW_TO_REFUND'}))).toBe(false)
    expect(shouldPollRelayStatus(status('refund'))).toBe(false)
    expect(shouldPollRelayStatus(status('success'))).toBe(false)
  })
  it('requires a successful destination transaction before declaring settlement', () => {
    expect(isRelaySettled(status('submitted', {txHashes: ['0xabc']}))).toBe(false)
    expect(isRelaySettled(status('success'))).toBe(false)
    expect(isRelaySettled(status('success', {txHashes: ['0xabc']}))).toBe(true)
  })
  it('encodes request IDs and normalizes absent transaction arrays', async () => {
    const fetch = vi.fn().mockResolvedValue(response({status: 'waiting'}))
    vi.stubGlobal('fetch', fetch)
    const state = await fetchRelayStatus('id/with?punctuation')
    expect(fetch.mock.calls[0][0]).toContain('requestId=id%2Fwith%3Fpunctuation')
    expect(state).toEqual({status: 'waiting', inTxHashes: [], txHashes: []})
  })
})
