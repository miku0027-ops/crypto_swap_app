// @vitest-environment jsdom
import { StrictMode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from './App'

beforeEach(() => {
  localStorage.clear()
  window.history.replaceState({}, '', '/')
  delete window.ethereum
  window.scrollTo = vi.fn()
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

async function useDemoWallet(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getAllByRole('button', { name: 'Connect wallet' })[0])
  const walletDialog = screen.getByRole('dialog', { name: 'Connect a wallet' })
  await user.click(within(walletDialog).getByRole('button', { name: 'Try demo wallet' }))
}

describe('Hoplane preview UI', () => {
  it('states the preview boundary before any wallet is connected', () => {
    render(<App />)
    expect(screen.getByText('Preview mode · No funds move')).toBeTruthy()
    expect(screen.getByRole('textbox', { name: 'Amount to send' })).toHaveProperty('value', '0.1')
    expect(screen.queryByRole('button', { name: /sign|submit transaction/i })).toBeNull()
    expect(screen.queryByText(/Balance:/)).toBeNull()
  })

  it('runs an explicit simulation and saves one demo activity record without requesting a wallet signature', async () => {
    const request = vi.fn()
    window.ethereum = { request }
    const user = userEvent.setup()
    render(<StrictMode><App /></StrictMode>)
    await useDemoWallet(user)
    await user.click(screen.getByRole('button', { name: 'Review preview' }))
    const review = screen.getByRole('dialog', { name: 'One last look' })
    expect(within(review).getByText(/No blockchain transaction is signed or submitted/)).toBeTruthy()
    await user.click(within(review).getByRole('button', { name: 'Simulate transfer' }))
    const success = await screen.findByRole('dialog', { name: 'A successful practice hop.' }, { timeout: 6000 })
    expect(within(success).getByText('Simulation · no real funds have moved')).toBeTruthy()
    await user.click(within(success).getByRole('button', { name: 'View activity' }))
    expect(screen.getByRole('heading', { name: 'Your activity.' })).toBeTruthy()
    expect(screen.getByText('DEMO')).toBeTruthy()
    const saved = JSON.parse(localStorage.getItem('hoplane.activity')!)
    expect(saved).toHaveLength(1)
    expect(saved[0]).toMatchObject({ mode: 'demo', status: 'completed', amount: '0.1' })
    expect(saved[0].id).toMatch(/^demo-/)
    expect(request).not.toHaveBeenCalled()
  }, 9000)

  it('requires a valid custom destination address before review', async () => {
    const user = userEvent.setup()
    render(<App />)
    await useDemoWallet(user)
    await user.click(screen.getByRole('button', { name: 'Same wallet' }))
    const address = screen.getByRole('textbox', { name: /Recipient address/ })
    const review = screen.getByRole('button', { name: 'Review preview' })
    expect(review).toHaveProperty('disabled', true)
    await user.type(address, 'not-an-address')
    expect(screen.getByText('Enter a valid Base address.')).toBeTruthy()
    expect(review).toHaveProperty('disabled', true)
    await user.clear(address)
    await user.type(address, '0x1111111111111111111111111111111111111111')
    expect(review).toHaveProperty('disabled', false)
    await user.click(review)
    expect(within(screen.getByRole('dialog')).getByText('0x1111…1111')).toBeTruthy()
  })

  it('searches the token catalog and applies the selected token', async () => {
    const user = userEvent.setup()
    render(<App />)
    await user.click(screen.getByRole('button', { name: 'Select source token: ETH on Ethereum' }))
    const picker = screen.getByRole('dialog', { name: 'You pay' })
    await user.type(within(picker).getByRole('textbox', { name: 'Search tokens' }), 'Tether')
    expect(within(picker).queryByText('USD Coin')).toBeNull()
    await user.click(within(picker).getByRole('button', { name: /USDT\s*Tether USD/ }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getByRole('button', { name: 'Select source token: USDT on Ethereum' })).toBeTruthy()
  })

  it('blocks identical source and destination assets', async () => {
    const user = userEvent.setup()
    render(<App />)
    await useDemoWallet(user)
    await user.click(screen.getByRole('button', { name: 'Select destination token: USDC on Base' }))
    const picker = screen.getByRole('dialog', { name: 'You receive' })
    await user.click(within(picker).getByRole('button', { name: 'Ethereum' }))
    await user.click(within(picker).getByRole('button', { name: /^ETH\s*Ethereum$/ }))
    expect(screen.getByRole('alert').textContent).toContain('Choose a different token or destination network.')
    expect(screen.getByRole('button', { name: 'Review preview' })).toHaveProperty('disabled', true)
  })

  it('keeps fiat checkout disabled until a provider is connected', async () => {
    const user = userEvent.setup()
    render(<App />)
    await user.click(screen.getByRole('tab', { name: 'Buy' }))
    await user.selectOptions(screen.getByRole('combobox', { name: 'Fiat currency' }), 'INR')
    await user.click(screen.getByRole('button', { name: 'Bank transfer' }))
    expect(screen.getByRole('combobox', { name: 'Fiat currency' })).toHaveProperty('value', 'INR')
    expect(screen.getByRole('button', { name: 'Provider integration coming next' })).toHaveProperty('disabled', true)
    expect(screen.getByText(/Fiat purchases need a payment provider/)).toBeTruthy()
    expect(screen.queryByRole('textbox', { name: /card number/i })).toBeNull()
    await user.click(screen.getByRole('tab', { name: 'Sell' }))
    expect(screen.getByText(/Fiat withdrawals need a payment provider/)).toBeTruthy()
  })

  it('filters networks and uses the chosen destination in the swap form', async () => {
    const user = userEvent.setup()
    render(<App />)
    await user.click(screen.getByRole('button', { name: 'Explore' }))
    await user.type(screen.getByRole('textbox', { name: 'Search networks' }), 'Solana')
    const cards = screen.getAllByRole('button', { name: /Preview a route/ })
    expect(cards).toHaveLength(1)
    await user.click(cards[0])
    expect(screen.getByRole('button', { name: 'Select destination token: USDC on Solana' })).toBeTruthy()
    expect(screen.getByRole('textbox', { name: 'Amount to receive' })).toBeTruthy()
  })

  it('shows a denied wallet request and does not silently fall back to the demo account', async () => {
    const request = vi.fn().mockRejectedValue(new Error('User rejected the request.'))
    window.ethereum = { request, isMetaMask: true }
    const user = userEvent.setup()
    render(<App />)
    await user.click(screen.getAllByRole('button', { name: 'Connect wallet' })[0])
    const dialog = screen.getByRole('dialog', { name: 'Connect a wallet' })
    await user.click(within(dialog).getByRole('button', { name: /Browser wallet/ }))
    expect(await within(dialog).findByRole('alert')).toHaveProperty('textContent', 'User rejected the request.')
    expect(request).toHaveBeenCalledExactlyOnceWith({ method: 'eth_requestAccounts' })
    expect(screen.queryByRole('button', { name: 'Review preview' })).toBeNull()
    expect(screen.queryByText(/Demo wallet connected/)).toBeNull()
  })

  it('changes appearance and keeps the preference when the UI is remounted', async () => {
    const user = userEvent.setup()
    const { unmount } = render(<App />)
    await user.click(screen.getByRole('button', { name: 'Swap settings' }))
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Dark theme' }))
    await user.click(screen.getByRole('button', { name: 'Save preferences' }))
    expect(document.documentElement.dataset.theme).toBe('dark')
    unmount()
    render(<App />)
    expect(document.documentElement.dataset.theme).toBe('dark')
    expect(screen.getByRole('button', { name: 'Switch to light theme' })).toBeTruthy()
  })

  it('closes dialogs with Escape and restores focus to the initiating control', async () => {
    const user = userEvent.setup()
    render(<App />)
    const trigger = screen.getByRole('button', { name: 'Swap settings' })
    await user.click(trigger)
    expect(screen.getByRole('dialog', { name: 'Make it your own' })).toBeTruthy()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(trigger)
  })

})
