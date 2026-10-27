# Feature coverage

This checklist separates the implemented interface from live financial capabilities. “Implemented” below means usable in the current UI preview; it does not mean that the app can transfer funds. Sample data is explicitly labeled, and unconfigured integrations do not claim successful execution.

## Implemented UI

- [x] Responsive desktop/mobile shell, navigation, and original Hoplane branding.
- [x] Swap and bridge workspace with source/destination network and token selection.
- [x] Search by token name/symbol, network selection, favorite tokens, empty results, and reversible routes.
- [x] Static preview catalog for Ethereum, Base, Arbitrum, Optimism, Polygon, Solana, BNB Chain, Avalanche, Scroll, and ZKsync.
- [x] Editable pay/receive fields, illustrative USD values and conversion, demo balance controls, invalid-amount feedback, and same-asset route guard.
- [x] Custom recipient with destination-specific EVM/Solana address-format feedback.
- [x] Expandable route summary, illustrative fee/time estimates, minimum received, and auto/custom slippage.
- [x] Persistent destination-gas preference, testnet preference, and light/dark appearance.
- [x] Wallet modal with installed EVM wallet connection and a separate explicitly labeled demo wallet.
- [x] Copy address, wallet disconnect, and linked navigation to the portfolio.
- [x] Review, simulated transfer progress, and simulated completion details.
- [x] Local demo activity with search, status filters, detail expansion, reference copying, empty states, and CSV export.
- [x] Network discovery with categories, search, network cards, and route selection.
- [x] Portfolio connection/empty states; searchable sample assets, balance visibility, and actions in demo mode.
- [x] Buy/sell form layouts with fiat currency, payment method, token/network selection, and disabled provider checkout.
- [x] Help articles, accessible controls/dialog structure, and official provider documentation links.
- [x] Preferences, favorites, and simulated history persisted in local browser storage, with schema validation, size bounds, and malformed-record recovery.

The catalog, prices, balances, history, durations, and quote math are illustrative. The testnet toggle is a saved preference, not an active testnet integration. Receive-amount editing approximates an exact-output flow using sample prices; production exact-output orders must come from Relay.

## Integration foundation implemented

- [x] Standalone typed adapter for public Relay chain metadata and token discovery.
- [x] Backend-only quote adapter using `VITE_API_BASE_URL` with no browser API secret.
- [x] Public status lookup with finality-aware polling and settlement helpers.
- [x] Aborts, timeouts, HTTP error parsing, `Retry-After`, and basic response validation.
- [x] Unit tests for invalid trade input, recipient formats, illustrative minimum output, network selection, quote configuration, errors, cancellation, and settlement status.

These adapters are not wired into the preview screens. Configuring a backend URL alone does not enable live transactions.

## Required before live bridging or swapping

- [ ] Create a Relay App/API key and keep it on the server. The current `/quote/v2` contract requires authentication.
- [ ] Implement the backend quote route with input validation, supported-route checks, per-client rate limits, and error translation.
- [ ] Replace the static token catalog and sample addresses with chain-specific metadata, addresses, decimals, and route availability.
- [ ] Wire live quotes with stale-response cancellation, quote refresh/expiration, real fee breakdown, minimum output, liquidity/error states, and accurate base-unit conversion.
- [ ] Add live portfolio/balance indexing, origin-gas checks, and an execution-aware MAX calculation.
- [ ] Add wallet chain switching and supported-chain configuration, explicit approvals/permits, wallet transaction review, and signature/execution handling.
- [ ] Validate quote recipient, chains, currency, amount, deadline, and actual transaction commitments before execution.
- [ ] Implement supported EVM, Solana, and other VM signing adapters. EVM connection alone cannot sign Solana transactions.
- [ ] Obtain WalletConnect configuration before enabling its connector.
- [ ] Track actual source and destination transactions through settlement; retain request IDs, explorer links, retry/refund states, and recovery guidance.
- [ ] Add verified webhook or websocket processing and reload-safe tracking of unsettled requests.
- [ ] Offer destination gas only when the provider confirms support for that destination/currency.
- [ ] Test real testnet bridge execution, user rejection, insufficient funds, stale quotes, provider failures, and refunds. This implementation has not submitted blockchain transactions.

## Additional product work

- [ ] Fiat provider integration with country availability, actual fees, identity requirements, payment authorization, and refunds.
- [ ] Firebase authentication, account linking, Firestore security rules, and cross-device synchronization.
- [ ] Production GCP deployment, configuration, monitoring, incident support, and provider health handling.
- [ ] Native Android packaging, mobile wallet handoff, secure release signing, and Play Store release.
- [ ] Chrome extension manifest, permissions, popup/full-page UX, wallet handoff, and Chrome Web Store release.
- [ ] Localization, currency preferences beyond the demonstrated fiat selectors, translation review, and RTL layouts.
- [ ] Contract-address token import with chain-aware validation and unverified-token warnings.
- [ ] Real portfolio valuation, tax/accounting export from actual activity, notifications, and advanced transaction search.
- [ ] Any rewards, staking, yield, limit orders, recurring swaps, fiat banking, or referral program. None is claimed as available here.

Feature planning should follow validated user needs and provider support. The repository does not assert complete parity with every Relay screen or every capability offered in the global crypto market.

## Official sources used for scope

- [Relay bridge/swap UI](https://relay.link/bridge/arbitrum)
- [How to swap tokens](https://support.relay.link/en/articles/9299290-how-do-i-swap-tokens)
- [Wallet panel and multiple-wallet controls](https://support.relay.link/en/articles/10180081-disconnect-wallet-from-relay)
- [API keys and rate limits](https://docs.relay.link/references/api/api-keys)
- [Quote API](https://docs.relay.link/references/api/get-quote-v2)
- [Testnet support](https://docs.relay.link/references/api/api_guides/testnet)
- [Transaction status lifecycle](https://docs.relay.link/references/api/get-intents-status-v3)
- [Quote verification](https://docs.relay.link/references/api/api_core_concepts/input-validation)
