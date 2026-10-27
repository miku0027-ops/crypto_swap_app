import { describe, expect, it } from 'vitest'
import { previewQuote, validAmount, validRecipient } from './trade'

const baseETH = {chainId: 8453, symbol: 'ETH'}
const arbitrumUSDC = {chainId: 42161, symbol: 'USDC'}

describe('amount validation', () => {
  it.each(['1', '0.1', '.5', '1.', '1000000000000'])('accepts a positive decimal %s', value => {
    expect(validAmount(value)).toBe(true)
  })
  it.each(['', '0', '0.00', '-1', '+1', 'Infinity', 'NaN', '1e3', '1,000', ' 1', '1 ', '1..2', '1000000000001'])('rejects invalid or out-of-range amount %s', value => {
    expect(validAmount(value)).toBe(false)
  })
})

describe('recipient format validation', () => {
  it('accepts an EVM address and rejects missing prefix, bad length and non-hex characters', () => {
    expect(validRecipient('0x52908400098527886E0F7030069857D2E4169EE7', 1)).toBe(true)
    expect(validRecipient('52908400098527886E0F7030069857D2E4169EE7', 1)).toBe(false)
    expect(validRecipient('0x1234', 8453)).toBe(false)
    expect(validRecipient('0xZ2908400098527886E0F7030069857D2E4169EE7', 42161)).toBe(false)
  })
  it('requires the destination VM address format', () => {
    const solanaAddress = 'So11111111111111111111111111111111111111112'
    expect(validRecipient(solanaAddress, 792703809)).toBe(true)
    expect(validRecipient(solanaAddress, 8453)).toBe(false)
    expect(validRecipient('0x52908400098527886E0F7030069857D2E4169EE7', 792703809)).toBe(false)
    expect(validRecipient('0'.repeat(32), 792703809)).toBe(false)
    expect(validRecipient('A'.repeat(31), 792703809)).toBe(false)
    expect(validRecipient('A'.repeat(45), 792703809)).toBe(false)
  })
})

describe('illustrative quote calculation', () => {
  it('subtracts the illustrative fee before converting to the receiving token', () => {
    const quote = previewQuote('1', baseETH, arbitrumUSDC, 'auto')
    expect(quote.fee).toBeGreaterThan(0)
    expect(quote.out).toBeCloseTo(quote.usd - quote.fee, 8)
    expect(quote.out).toBeLessThan(quote.usd)
  })
  it('uses 0.5% illustrative auto slippage for minimum received', () => {
    const quote = previewQuote('1', baseETH, arbitrumUSDC, 'auto')
    expect(quote.minimum).toBeCloseTo(quote.out * 0.995, 8)
    expect(quote.minimum).toBeLessThan(quote.out)
  })
  it('applies custom percentage slippage and respects zero slippage', () => {
    const custom = previewQuote('2', baseETH, arbitrumUSDC, '1')
    expect(custom.minimum).toBeCloseTo(custom.out * 0.99, 8)
    const exact = previewQuote('2', baseETH, arbitrumUSDC, '0')
    expect(exact.minimum).toBe(exact.out)
  })
  it.each(['0', '-1', 'not-an-amount'])('does not invent output or fees for invalid amount %s', amount => {
    const quote = previewQuote(amount, baseETH, arbitrumUSDC, 'auto')
    expect(quote.usd).toBe(0)
    expect(quote.fee).toBe(0)
    expect(quote.out).toBe(0)
    expect(quote.minimum).toBe(0)
  })
})
