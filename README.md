# Hoplane

Hoplane is a React/TypeScript crypto bridge interface with a Node.js API, wallet ownership verification, persistent account preferences, validated Relay quotes, and transfer tracking. It uses Relay for routes and settlement; it does not operate independent bridge contracts or custody users' wallets.

The live workspace and the clearly labeled no-funds demo are separate. Live execution is **disabled by default**. A Relay API key, trusted RPC endpoints, reviewed deposit addresses, and successful route tests are needed before enabling supported transfers. The app currently supports EVM externally owned accounts and a restricted deposit transaction format; it does not claim every Relay feature.

## Run locally

Use **Node.js 24** and the committed lockfile:

```sh
npm ci
cp .env.server.example .env.server
npm run dev
```

Open `http://localhost:5173`. The development command starts both Vite and the API on port 8080; Vite forwards `/api` requests to the server. SQLite persists local data under `.data/`. Sign-in and account preferences work without a Relay key. Public chain/token discovery depends on provider availability; live quotes remain unavailable until a server-side key is configured.

```sh
npm run typecheck
npm test
npm run build
```

The build creates `dist/` and `dist-server/`. To serve both from Node locally after building:

```sh
APP_ORIGIN=http://localhost:8080 ALLOWED_ORIGINS=http://localhost:8080 npm start
```

Open `http://localhost:8080`. `npm run preview` serves only the static Vite build and does not start the API. Node's built-in SQLite module may print an experimental warning on Node 24; production uses Firestore instead.

## Navigation and reference coverage

The updated interface includes Swap, Vaults, Transactions, Solutions, Products, Developers, Company, and App Resources. Header and mobile navigation support active states, keyboard focus, appearance controls, and shareable pages. Trading fields, disabled actions, recipient validation, and selected controls use higher-contrast light/dark tokens.

Transactions opens a public Relay network feed with From/To amounts, sender/recipient references, deposit/fill explorer links, reported statuses, fill timing, filters, and pause/resume controls. Server-sent events deliver shared provider snapshots; automatic polling handles interrupted streams. Wallet history and practice history stay in separate tabs. Network activity includes transactions from other apps and is never presented as Hoplane volume. [Live transactions](docs/LIVE-TRANSACTIONS.md) documents its data contract and operating requirements.

The documentation library indexes all **148 pages** in Relay's public index reviewed on **2026-10-27**. Articles open on the official documentation site; Hoplane's explanatory pages describe its own implementation and distinguish provider-managed workflows. [The coverage inventory](docs/RELAY-COVERAGE.md) records every observed navigation destination and remaining integration boundaries.

Vaults puts Your Positions above a searchable, sortable Top Vaults table. Wallet sign-in stays on the page; owner-scoped positions and catalog data load independently. The table uses validated provider APY, underlying WETH amounts, and optional USD estimates with freshness labels. The static preview shows only documented reference contracts when the API is unavailable; balances and yields remain unavailable. [Vault data and units](docs/VAULT-DATA.md) records the source and meaning of each metric.

Vaults are read-only: current Relay documentation says new deposits are closed and the existing withdrawal UI remains available until December 31, 2026. Signed-in users can also read integrator app-fee balances and Relay Hub recovery balances through owner-scoped backend endpoints. Recovery/app-fee data comes from Relay's mainnet API, independently of the trading environment. Claims, attestations, and withdrawals continue on the official provider interface; Hoplane does not sign those operations.

## Backend and live workspace

- Server-created, single-use Sign-In with Ethereum challenges verify wallet ownership. Sessions use an HTTP-only cookie, expiry, hashed token storage, and CSRF/origin checks.
- Preferences and favorites belong to the verified wallet address, with version checks to prevent one device silently overwriting another. Sign in with the same wallet on each device to access the same account.
- Chain/token discovery uses current provider metadata and the server's enabled chain list. Amounts use integer base units; slippage, quote expiry, recipient, network, token, sender, and transaction commitments are checked on the server.
- The live UI supports quote review, wallet account/network changes, wallet transaction confirmation, source-asset balance reads, server activity, and recovery of already-broadcast transactions without automatically sending them again.
- Supported execution is limited to one exact native transfer or one decoded ERC-20 `transfer` to an operator-approved deposit address. Unsupported router calldata, approvals, permits, gasless signing, and multistep routes remain blocked.
- Source transactions must match the prepared transaction through a configured RPC endpoint. A provider status of success without a destination transaction reference is treated as pending. Provider settlement is still a dependency; this is not independent destination-chain verification.
- Request validation, shared atomic rate limits, bounded provider responses, timeouts, metadata caching, persistent idempotency, and owner-scoped history are implemented.

The demo keeps sample prices, balances, and activity in browser storage. Those records are never represented as live quotes or blockchain receipts. Fiat checkout, WalletConnect, Solana execution, native Android, and the Chrome extension are not integrated.

## Configuration and deployment

[The backend guide](docs/BACKEND.md) covers API contracts, environment variables, security boundaries, production deployment, and remaining verification. [Feature coverage](docs/FEATURES.md) distinguishes implemented behavior from required provider and release work.

The deployment configuration targets Firebase project **`hoplane-b9ac1`**:

- Firebase Hosting serves the SPA and forwards `/api/**` to Cloud Run service `hoplane-api` in `asia-south1`.
- The non-root Node 24 container builds/tests the project, serves the API and SPA, and requires Firestore in production.
- Firestore browser access is denied; the backend uses a dedicated runtime service account through Application Default Credentials.
- Relay keys and credential-bearing RPC configuration belong in Secret Manager. No secrets belong in `VITE_*` variables, source files, or container build arguments.
- `cloudbuild.yaml` verifies the expected project and publishes a tested image. It does **not** automatically deploy that image or enable execution.

The production container was built and smoke-tested locally against the real Firestore emulator, including wallet sign-in, session cookies, CSRF rejection, and logout. Firestore integration tests cover cross-client transactions, account isolation, expiry, and deny-all client rules. A working GCP deployment identity and Relay API key were not available, so Cloud Run deployment and on-chain settlement remain unverified. The supplied Firebase web API key is public client configuration, not a backend credential, and is unnecessary for the current server-owned data model.

The Sites preview now runs a small Worker for public transaction snapshots and streaming, with the existing SPA embedded as static assets. Build its separate artifact with `npm run build:site`. It does not run the authenticated Node backend: wallet sessions, trading, sync and vault positions still need the GCP API. Merely setting a cross-site backend URL does not make browser authentication work. Prefer the same-origin Firebase rewrite or serve both from Cloud Run.

The public activity feed currently uses keyless Requests v2 at a 60-second refresh interval. Relay retires that endpoint on **November 24, 2026**. Configure `RELAY_API_KEY` as a server/Worker secret to select Requests v3 (10-second shared snapshots); it is required before the sunset. Keys are never included in browser builds or feed responses. Provider rate limits may delay updates; those states remain visible.

## Provider references

- [Relay API keys](https://docs.relay.link/references/api/api-keys) — quotes require your server-side app key under the current provider contract.
- [Quote API](https://docs.relay.link/references/api/get-quote-v2) and [quote validation](https://docs.relay.link/references/api/api_core_concepts/input-validation).
- [Testnet support](https://docs.relay.link/references/api/api_guides/testnet) — supported chain IDs do not guarantee liquidity or route availability.
- [Status lifecycle](https://docs.relay.link/references/api/get-intents-status-v3) — source submission does not imply destination settlement.

Hoplane is an independent application using Relay's API. Native bridge infrastructure and a separately audited contract system would be additional projects.
