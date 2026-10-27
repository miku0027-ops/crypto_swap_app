# Hoplane

A responsive crypto swap and bridge interface, inspired by Relay’s interaction model and built with React, TypeScript, and Vite. This repository contains a working **UI preview**, not a production bridge or a live trading service.

The interface includes swap/bridge review, chain and token discovery, wallet connection, a simulated transfer lifecycle, local activity, sample portfolio, preferences, help, and buy/sell provider setup states. See [the feature checklist](docs/FEATURES.md) for completed screens and remaining integrations.

## Run locally

Use Node.js 22.12+ (Node.js 24 is supported).

```sh
npm install
npm run dev
```

Open the localhost URL printed by Vite. For a reproducible install from the committed lockfile, use `npm ci`.

```sh
npm test
npm run build
npm run preview
```

`npm test` runs the Vitest suite, including trade validation, API boundaries, and corrupt-storage recovery tests. `npm run build` checks TypeScript and creates `dist/`. `npm run preview` serves that production build locally. Preview is not a production hosting service.

## What the preview does

- A demo wallet lets you explore sample balances and simulate a transfer without signing or spending funds.
- An installed EVM wallet can share its public address through `eth_requestAccounts`. Connection does not enable transaction signing, real balance retrieval, or execution.
- Displayed token prices, rates, fees, transfer durations, balances, and calculated output amounts are illustrative. They are not live Relay quotes.
- Simulated transfers generate a local preview reference, not a transaction hash. Activity is labeled demo and has no blockchain explorer receipt.
- Settings, favorites, and demo activity are stored in this browser. Loaders validate their schemas and discard malformed values or records; history remains limited to demo records. They do not sync to Firebase, another browser, Android, or an extension.
- Mainnet/testnet and destination-gas controls save preferences for a future integration. They do not change live execution in this build.
- Fiat buy/sell controls demonstrate selection and review layout. Checkout remains disabled until a provider is configured. No payment details are collected.

The static catalog uses example tokens and metadata. Contract addresses in sample data are **not** a chain-specific execution allowlist and must never be used to submit real transactions. The demo recipient check is a format check; production needs VM-aware address decoding and validation.

## Relay adapter and backend contract

`src/lib/relay.ts` is an independently tested adapter, not yet connected to the UI. It provides:

- Public `GET /chains` metadata and `POST /currencies/v2` token search.
- Public `GET /intents/status/v3?requestId=…` lookup and settlement/polling helpers.
- Quote requests through **your backend only**.
- Abort signals, request timeouts, HTTP error parsing, rate-limit retry information, and response-shape checks.

Optional configuration:

```sh
cp .env.example .env.local
```

Set only the public backend base URL:

```dotenv
VITE_API_BASE_URL=http://localhost:8080/api
```

The adapter sends `POST {VITE_API_BASE_URL}/relay/quote` with this JSON structure:

```json
{
  "network": "testnet",
  "quote": {
    "user": "0x...",
    "originChainId": 11155111,
    "destinationChainId": 84532,
    "originCurrency": "0x0000000000000000000000000000000000000000",
    "destinationCurrency": "0x0000000000000000000000000000000000000000",
    "amount": "1000000000000000",
    "tradeType": "EXACT_INPUT"
  }
}
```

The abbreviated wallet address is illustrative. The backend should validate the request, select the appropriate Relay host, add its server-side `x-api-key`, and return the upstream quote JSON and meaningful HTTP errors. Discover current chain support through the appropriate `/chains` endpoint; example IDs do not guarantee route liquidity.

Changing `VITE_API_BASE_URL` alone **does not enable live quoting or transaction execution**. The UI still uses its explicit demo calculations until the adapter, wallet execution, and tracking are integrated.

Never put a Relay API secret, wallet private key, seed phrase, Firebase service-account credential, or other secret in a `VITE_*` variable. Vite embeds those variables in browser-accessible JavaScript. Store server credentials in GCP Secret Manager or your backend’s secret configuration.

## Planned GCP / Firebase architecture

- Firebase Hosting or equivalent static hosting for `dist/`.
- Cloud Run or Cloud Functions for the quote proxy, validation, rate limits, verified webhooks, and transaction indexing.
- Firebase Authentication with an explicit account-linking flow for optional cross-device synchronization. A public wallet address by itself does not establish account ownership.
- Firestore with per-user security rules for preferences, favorites, and transaction references. Blockchain/Relay status remains the source of truth for settlement.
- Secret Manager for Relay and other service credentials.
- WalletConnect project setup and chain-specific EVM/Solana wallet adapters before broader wallet support.
- A configured fiat on/off-ramp provider before buy/sell checkout, with its actual supported countries, fees, verification requirements, and terms.

A `firebase.json` static-hosting configuration and GitHub Actions test/build workflow are included. No Firebase project ID is selected. After selecting your project, build and deploy with the Firebase CLI. No GCP project, Firebase project, wallet provider account, or payment provider has been provisioned by this code. Native Android packaging and a Chrome extension are separate upcoming deliverables; this responsive web UI is their shared product foundation.

## Integration references

Checked against official Relay documentation during this implementation on October 27, 2026:

- [API keys and limits](https://docs.relay.link/references/api/api-keys): current docs require authentication for every `/quote/v2` request from October 2, 2026.
- [Quote API](https://docs.relay.link/references/api/get-quote-v2): amounts use integer token base units; slippage uses basis points, e.g. `"50"` means 0.5%.
- [Status lifecycle](https://docs.relay.link/references/api/get-intents-status-v3): a failed fill may still retry or refund; request acceptance is not settlement.
- [Testnet support](https://docs.relay.link/references/api/api_guides/testnet): testnet bridging can be tested with test tokens, while testnet swaps often fail because of missing DEX liquidity.
- [Fee structure](https://docs.relay.link/references/api/api_core_concepts/fees): use actual route costs; do not derive live fees from the preview formula.
- [Gas top-up](https://docs.relay.link/features/gas-top-up): availability depends on destination VM, currency, and route.

Hoplane is a working brand name. This project is not an official Relay product and does not claim to reproduce every Relay feature or operate its own bridging infrastructure.
