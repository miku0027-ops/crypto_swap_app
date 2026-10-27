# Feature coverage

This checklist records implementation scope. It does not certify production readiness or successful on-chain execution. The live workspace is configured by backend capabilities; the no-funds demo retains clearly labeled sample data.

## Implemented backend

- [x] Fastify API with strict request schemas, amount/address/chain checks, body limits, safe errors, and request IDs.
- [x] Exact allowed origins, credentialed CORS, JSON-only mutation requests, CSRF checks, HTTP-only cookies, security headers, and log redaction.
- [x] Sign-In with Ethereum for externally owned EVM accounts, expiring single-use challenges, hashed sessions, logout, and account ownership checks.
- [x] Durable SQLite for development and a transactional Firestore adapter for production; production rejects SQLite.
- [x] Server-owned preferences/favorites with optimistic concurrency and wallet-scoped transfer history.
- [x] Atomic shared rate limits for authentication, quotes, upstream status requests, preferences, and balances.
- [x] Relay mainnet/testnet hosts, current EVM metadata, verified token search, bounded responses, timeouts, cache deduplication, and provider error handling.
- [x] Server-only Relay key, validated normalized quotes, quote expiration, policy-change detection, explicit execution/mainnet switches, and deposit address allowlists.
- [x] Atomic quote preparation and idempotency keys; client-supplied transaction hashes do not establish success.
- [x] Policy/expiry revalidation and a single wallet-submission reservation per step across devices; uncertain submissions require hash recovery instead of automatic resend.
- [x] RPC verification of submitted transaction sender, chain, target, calldata, and value against the reviewed quote.
- [x] Native/ERC-20 balance reads through fixed operator RPC endpoints, chain verification, precise base units, and partial-error handling.
- [x] Owner-scoped provider tracking; success/refund without a destination transaction reference remains pending.
- [x] Non-root Node 24 container, Cloud Build project guard, Firebase API rewrite, deny-all client Firestore rules, transfer query index, and deployment instructions.

## Implemented live web flow

- [x] Backend availability/capability states and a separately labeled demo entry point.
- [x] Installed EVM wallet sign-in, account-change invalidation, sign-out, and per-device sessions.
- [x] Provider-backed source/destination network and token selection, verified asset search, and custom EVM recipient.
- [x] Exact amount conversion, slippage limits, destination-gas request, expired quote handling, and stale-request cancellation.
- [x] Real quote review with provider fees/minimum output, explicit transaction details, wallet confirmation, and unsupported-route explanation.
- [x] Wallet network switching and repeated account/chain checks around transaction submission.
- [x] Local recovery references for already-broadcast transactions, retry tracking, persisted server activity, and destination explorer links.
- [x] Source-asset balance reads and account preferences saved to the verified wallet account.

Live execution supports only **one exact native deposit or one decoded ERC-20 transfer** to an explicitly approved address. The server blocks opaque router calls, token approvals, permits, gasless signatures, unsupported transaction sequences, and non-EVM execution. A quote can be displayable without being executable. Many provider routes may therefore remain unavailable until separately reviewed transaction decoders are implemented.

## Navigation, reference pages, and read-only resources

- [x] Swap, Vaults, Transactions and all observed Solutions, Products, Developers, Company, and App Resources options.
- [x] Responsive menu with keyboard focus management, theme controls, selected states, and deep links.
- [x] Wallet-owned transaction search by token/address/hash/reference, source/destination chain filters, and status filters; no unsupported global or ENS search claim.
- [x] Search/filter directory for all 148 published Relay documentation pages and original capability explanations.
- [x] Higher-contrast light/dark text and controls, stronger form hierarchy, explicit recipient focus/invalid states, and readable disabled actions.
- [x] Read-only validated vault catalog and authenticated wallet positions, matching the provider's current wind-down.
- [x] Your Positions and Top Vaults together, inline wallet sign-in, network/search filters, sortable APY/TVL, source/freshness details, and metadata-only fallback when the backend is unavailable.
- [x] Owner-scoped integrator app balances and recovery balances; explicit mainnet/read-only labels, unknown-value preservation, and official management links.
- [x] API availability check, official status link, testnet guidance, EVM explorer lookup, and preview terms/privacy disclosures.
- [ ] Vault redemption, app-balance deposits/claims, recovery attestation/signing, provider dashboard administration, and complete provider feature parity remain outside the current executable integration. See [coverage](RELAY-COVERAGE.md).

## Existing demo interface

- [x] Responsive shell, navigation, light/dark theme, accessible dialogs, search, and empty/error states.
- [x] Illustrative swap/bridge inputs, network/token selectors, favorites, recipient feedback, route details, review, and simulated progress.
- [x] Demo wallet, sample portfolio, local demo history, filters, CSV export, and malformed-storage recovery.
- [x] Network discovery, help, and buy/sell setup screens with disabled fiat checkout.

Demo balances, rates, fees, timings, addresses, and history are examples. Demo local storage is independent from authenticated server preferences and live history. The demo's Solana catalog does not enable Solana transactions.

## Provider and release work still required

- [ ] Supply a valid Relay app key; verify current API pricing/quotas and route availability for the intended launch market.
- [ ] Configure trusted RPC endpoints and independently review deposit targets for every enabled chain. No guessed target addresses are supplied.
- [ ] Complete real testnet quote/execution/settlement tests, including wallet rejection, insufficient gas, stale quotes, interrupted tracking, provider failures, and refunds.
- [x] Exercise Firestore adapter concurrency, wallet/session operations, owner isolation, logical expiry, Timestamp retention metadata, and deny-all rules against the real local emulator.
- [x] Build/run the production container locally against the Firestore emulator; check non-root runtime, SPA/API serving, authentication cookies, CSRF, and logout.
- [ ] Validate production Firestore IAM, composite index readiness, physical TTL deletion, and Cloud Run deployment with working project credentials, monitored quotas, and alerting.
- [ ] Add independent destination receipt/finality verification, background reconciliation, and authenticated provider callbacks where supported. Current status refresh is requested by the UI/API client.
- [ ] Implement and review any additional contract calldata decoders before opening more execution routes.
- [ ] Add EIP-1271/smart-account authentication, WalletConnect/mobile handoff, and supported non-EVM wallets.
- [ ] Integrate a fiat provider with actual countries, fees, identity checks, payment authorization, and refund handling.
- [ ] Build/package the Chrome extension and native Android application, including secure signing and store releases.
- [ ] Add localization/RTL, notifications, aggregated portfolio valuation, and real financial/accounting exports as separate features.
- [ ] Complete browser visual/accessibility/device coverage, operational recovery drills, load tests, and independent security review before a public funds-enabled launch.

The shared backend can support future web, extension, and Android clients. Those clients are not delivered by the responsive website, and their authentication/origin integration must be implemented explicitly. No rewards, staking, yield, limit orders, or referral features are claimed.
