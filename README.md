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

A static Sites preview cannot run this Node backend. It can host the demo; a functional live workspace needs a deployed API with compatible origin and cookie behavior. Merely setting a cross-site backend URL does not make browser authentication work. Prefer the same-origin Firebase rewrite or serve both from Cloud Run.

## Provider references

- [Relay API keys](https://docs.relay.link/references/api/api-keys) — quotes require your server-side app key under the current provider contract.
- [Quote API](https://docs.relay.link/references/api/get-quote-v2) and [quote validation](https://docs.relay.link/references/api/api_core_concepts/input-validation).
- [Testnet support](https://docs.relay.link/references/api/api_guides/testnet) — supported chain IDs do not guarantee liquidity or route availability.
- [Status lifecycle](https://docs.relay.link/references/api/get-intents-status-v3) — source submission does not imply destination settlement.

Hoplane is an independent application using Relay's API. Native bridge infrastructure and a separately audited contract system would be additional projects.
