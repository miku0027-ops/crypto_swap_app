import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_SETTINGS, loadActivity, loadFavorites, loadSettings } from './storage'
import type { Activity } from './types'

let values: Map<string, string>
beforeEach(() => {
  values = new Map()
  vi.stubGlobal('localStorage', {getItem: (key: string) => values.get(key) ?? null})
})
afterEach(() => vi.unstubAllGlobals())
function store(key: string, value: unknown) { values.set(`hoplane.${key}`, JSON.stringify(value)) }
const example: Activity = {
  id: 'demo-example', from: {chainId: 8453, symbol: 'ETH'}, to: {chainId: 42161, symbol: 'USDC'},
  amount: '0.1', received: '247.76', timestamp: 1_700_000_000_000,
  mode: 'demo', status: 'completed', recipient: '0x000000000000000000000000000000000000dEaD',
}

describe('settings storage boundary', () => {
  it('recovers from corrupt JSON and unavailable storage', () => {
    values.set('hoplane.settings', '{broken')
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS)
    vi.stubGlobal('localStorage', {getItem: () => {throw new Error('Denied')}})
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS)
  })
  it.each([null, [], true, 1, 'dark'])('recovers from wrong settings shape %j', value => {
    store('settings', value)
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS)
  })
  it.each(['-1', '50.01', '100', 'Infinity', 'NaN', '1e2', '0.123', '', ' 1', 1, null])('rejects invalid slippage %j', slippage => {
    store('settings', {slippage, theme: 'dark'})
    expect(loadSettings()).toEqual({...DEFAULT_SETTINGS, theme: 'dark'})
  })
  it.each(['auto', '0', '.5', '0.50', '5', '50'])('accepts UI-supported slippage %s', slippage => {
    store('settings', {slippage})
    expect(loadSettings().slippage).toBe(slippage)
  })
  it('whitelists known fields without trusting persisted types or extra flags', () => {
    store('settings', {theme: 'dark', gasTopup: 'true', testnet: 'false', deadline: -10, executeLive: true})
    expect(loadSettings()).toEqual({...DEFAULT_SETTINGS, theme: 'dark'})
  })
})

describe('activity storage boundary', () => {
  it.each([null, {}, 'history', 1])('rejects wrong activity shape %j', value => {
    store('activity', value)
    expect(loadActivity()).toEqual([])
  })
  it('drops malformed nested records and token/network combinations', () => {
    store('activity', [null, {}, {...example, from: null}, {...example, from: {chainId: 1, symbol: 'SOL'}}, {...example, to: {chainId: 9999, symbol: 'USDC'}}, example])
    expect(loadActivity()).toEqual([example])
  })
  it('does not trust a persisted claim of real execution or an arbitrary blockchain status', () => {
    store('activity', [{...example, mode: 'live'}, {...example, status: 'success'}, {...example, id: '0xFakeTransactionHash'}, example])
    expect(loadActivity()).toEqual([example])
    expect(loadActivity().every(record => record.mode === 'demo')).toBe(true)
  })
  it('rejects invalid amounts, recipient, timestamp and identical asset routes', () => {
    store('activity', [{...example, amount: '-1'}, {...example, received: 'NaN'}, {...example, timestamp: 1e30}, {...example, recipient: '<script>alert(1)</script>'}, {...example, to: example.from}])
    expect(loadActivity()).toEqual([])
  })
  it('bounds and deduplicates records and strips unrelated fields', () => {
    const records = Array.from({length: 120}, (_, index) => ({...example, id: `demo-${index}`, executionEnabled: true}))
    records[1] = records[0]
    store('activity', records)
    const loaded = loadActivity()
    expect(loaded).toHaveLength(99)
    expect(loaded[0]).toEqual({...example, id: 'demo-0'})
    expect(new Set(loaded.map(record => record.id)).size).toBe(loaded.length)
  })
})

describe('favorite storage boundary', () => {
  it('recovers from corrupt data and wrong shapes', () => {
    values.set('hoplane.favorites', '{broken')
    expect(loadFavorites()).toEqual(['ETH', 'USDC', 'SOL'])
    store('favorites', null)
    expect(loadFavorites()).toEqual(['ETH', 'USDC', 'SOL'])
  })
  it('retains only known, unique token symbols', () => {
    store('favorites', ['ETH', 'ETH', 'UNKNOWN', null, {}, 'SOL'])
    expect(loadFavorites()).toEqual(['ETH', 'SOL'])
  })
  it('preserves an intentionally empty favorite list', () => {
    store('favorites', [])
    expect(loadFavorites()).toEqual([])
  })
})
