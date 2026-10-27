# Backend and deployment guide

The Node 24 service owns authentication, validation, account data, quote policy, and transfer tracking. Relay supplies quotes and cross-chain settlement. Users sign and broadcast through their installed wallet; the server never asks for a seed phrase or private key.

Execution and mainnet are disabled in the supplied configuration. Building the server does not remove the dependency on a Relay app key, trusted RPC endpoints, reviewed route targets, and real integration tests.

## Local workflow

```sh
npm ci
cp .env.server.example .env.server
npm run dev
```

Vite serves `http://localhost:5173` and proxies `/api` to the Node service on port 8080. `.env.server` is ignored by Git and loaded only by Node. SQLite persists under `.data/`; it is suitable for development, not shared Cloud Run instances. Node 24 may print an experimental warning for its built-in `node:sqlite` module.

```sh
npm run typecheck
npm test
npm run build
APP_ORIGIN=http://localhost:8080 ALLOWED_ORIGINS=http://localhost:8080 npm start
```

The final command serves the built SPA and API from `http://localhost:8080` in development mode. Production requires `NODE_ENV=production`, Firestore, explicit HTTPS origins, and valid Application Default Credentials. The process checks durable storage before opening its HTTP listener.

## Configuration

| Variable                           | Default / meaning                                                                                                               |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `NODE_ENV`                         | `development`; use `production` on Cloud Run.                                                                                   |
| `HOST`, `PORT`                     | `0.0.0.0`, `8080`; Cloud Run supplies its port.                                                                                 |
| `APP_ORIGIN`                       | `http://localhost:5173`; exact canonical website origin used in the SIWE domain and URI.                                        |
| `ALLOWED_ORIGINS`                  | Local app origin; explicit comma-separated HTTPS origins required in production. Must include `APP_ORIGIN`; no wildcards.       |
| `STORE_DRIVER`                     | `sqlite` locally, `firestore` in production. Production explicitly rejects SQLite.                                              |
| `DATABASE_PATH`                    | `./.data/hoplane.sqlite`; local persistent database.                                                                            |
| `FIREBASE_PROJECT_ID`              | Required with Firestore; deployment target is `hoplane-b9ac1`.                                                                  |
| `RELAY_API_KEY`                    | Unset. Required for live quotes; never exposed through `/api/config`.                                                           |
| `RELAY_TIMEOUT_MS`                 | `10000`; range 500–30000.                                                                                                       |
| `QUOTE_TTL_MS`                     | `30000`; range 5000–60000. Effective quote expiry is checked before preparing execution.                                        |
| `MAX_SLIPPAGE_BPS`                 | `300` (3%); hard server ceiling, range 0–1000. Users can request lower values.                                                  |
| `SESSION_TTL_MS`                   | `86400000` (24 hours); range 5 minutes–7 days.                                                                                  |
| `AUTH_CHAIN_ID`                    | `1`; must match the authentication challenge. This is not a transaction network selector.                                       |
| `ENABLE_MAINNET`                   | `false`. Mainnet requests are rejected until explicitly enabled.                                                                |
| `ENABLE_EXECUTION`                 | `false`. Enabling requires a Relay key and at least one reviewed transaction target; each route also requires RPC verification. |
| `ALLOWED_MAINNET_CHAINS`           | `1,8453,42161,10,137,56,43114,534352,324`; intersected with current provider EVM metadata.                                      |
| `ALLOWED_TESTNET_CHAINS`           | `11155111,84532`; candidate testnets, not a guarantee of route/liquidity support.                                               |
| `ALLOWED_TRANSACTION_TARGETS_JSON` | `{}`; map of numeric chain IDs to reviewed deposit addresses. Empty means no deposit execution is approved.                     |
| `RPC_URLS_JSON`                    | `{}`; map of numeric chain IDs to operator-owned RPC URLs. HTTPS required in production; credential-bearing URLs are secrets.   |
| `TRUST_PROXY_HOPS`                 | `0`; integer 0–2. Change only after verifying the complete ingress path and preventing shorter untrusted paths.                 |

`VITE_API_BASE_URL` is optional public browser configuration, default `/api`. Keep the same-origin default for Firebase Hosting and the combined Node server. Cross-origin requests include credentials, but the cookie is `SameSite=Lax`; unrelated sites cannot be made compatible merely by adding a CORS origin. Native/extension clients need an explicit authentication design rather than relaxing these protections.

The supplied Firebase web API key is public project configuration. The current frontend does not use a Firebase browser SDK, so that key is unnecessary. Firestore Admin authenticates using the Cloud Run runtime identity, not a Firebase web key.

## Authentication and data ownership

1. Request a challenge for the selected EVM address and `AUTH_CHAIN_ID`.
2. The server creates the complete SIWE message: canonical domain/URI, address, chain ID, random nonce, issue time, and a five-minute expiry.
3. The wallet signs that exact message using personal signing. Verification consumes the challenge atomically, including an invalid-signature attempt; a challenge cannot be replayed.
4. Successful verification creates a random 32-byte token. Only its SHA-256 hash is stored, and only the HTTP-only cookie carries the raw token. The JSON response includes the account, session expiry, and CSRF token.
5. Authenticated writes require the cookie, allowed `Origin`, JSON content type, and `X-CSRF-Token`. Logout revokes the stored session and clears the cookie.

Authentication supports externally owned EVM accounts only. EIP-1271 contract wallets, account abstraction, social sign-in, and linking different wallet addresses are not implemented. Signing in with the same address on another device opens the same preferences/history; each device signs its own challenge and receives its own session.

Production uses a host-only `__session` cookie with `HttpOnly`, `Secure`, `SameSite=Lax`, and `Path=/`. Firebase Hosting strips other cookies when forwarding dynamic requests, so this name is required for the `/api` rewrite. Development uses `hoplane_session`. API responses set `Cache-Control: no-store`.

Sessions, quotes, transfers, and preferences are scoped to the verified wallet address. Transfer IDs are not authorization. Preferences carry a version: send the version last read; a concurrent save returns `409 PREFERENCES_CONFLICT`, requiring a reload before another save.

## API surface

All paths start with `/api`. Authenticated POST/PUT operations require `X-CSRF-Token`. Every POST/PUT, including public authentication/metadata requests, requires an allowed `Origin` and `Content-Type: application/json`.

| Method/path                                     | Purpose                                                                                                                                                        | Authentication    |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- |
| `GET /health`                                   | Process liveness.                                                                                                                                              | Public            |
| `GET /ready`                                    | Storage readiness and capability indicators.                                                                                                                   | Public            |
| `GET /config`                                   | Feature flags, chain IDs, policy limits, auth chain, server time; no secrets.                                                                                  | Public            |
| `GET /developer/status`                         | Deployment profile, configured capabilities and candidate testnet IDs. Reports configuration, not upstream health.                                             | Public            |
| `GET /developer/openapi.json`                   | OpenAPI 3.1 discovery document for every current route, auth policy and illustrative request shapes. Detailed field validation remains in the server contract. | Public            |
| `GET /transactions`                             | Latest 50 validated public Relay network requests; fixed provider query, no owner or URL parameters.                                                           | Public            |
| `GET /transactions/stream`                      | Bounded SSE snapshot stream; heartbeat, error events, reconnection and per-IP connection limits.                                                               | Public            |
| `GET /chains?network=testnet`                   | Current allowed EVM chain metadata.                                                                                                                            | Public            |
| `GET /vaults`                                   | Fixed, validated public vault catalog; wind-down metadata, no deposit execution.                                                                               | Public            |
| `GET /vaults/positions`                         | Indexed vault shares belonging only to the signed-in wallet. No arbitrary owner query.                                                                         | Cookie            |
| `GET /account/app-balance`                      | Integrator app-fee/sponsorship balances for the signed-in wallet, from Relay mainnet.                                                                          | Cookie            |
| `GET /account/recovery-balances?ownerChainId=1` | First 20 Relay mainnet Hub recovery balances for the signed-in owner account; explicit owner-chain ID, `hasMore` indication.                                   | Cookie            |
| `POST /currencies`                              | `{network, search: {chainIds, term?, address?, limit?}}`; verified provider token search.                                                                      | Public            |
| `POST /auth/challenge`                          | `{address, chainId}` → `{challengeId, message, expiresAt}`.                                                                                                    | Public            |
| `POST /auth/verify`                             | `{challengeId, signature}` → session JSON plus cookie.                                                                                                         | Public            |
| `GET /auth/session`                             | Current session or `{user:null}`.                                                                                                                              | Cookie if present |
| `POST /auth/logout`                             | `{}`; revoke session.                                                                                                                                          | Cookie + CSRF     |
| `GET /preferences`                              | Settings, favorites, version.                                                                                                                                  | Cookie            |
| `PUT /preferences`                              | `{version, settings, favorites}`; compare-and-set.                                                                                                             | Cookie + CSRF     |
| `POST /quotes`                                  | `{network, quote}`; validated provider quote. `/relay/quote` is an alias.                                                                                      | Cookie + CSRF     |
| `POST /quotes/:id/prepare`                      | `{}` plus UUID `Idempotency-Key`; create/resume one transfer.                                                                                                  | Cookie + CSRF     |
| `POST /transfers/:id/authorize`                 | `{stepIndex}`; recheck execution policy and reserve this wallet submission once across devices.                                                                | Cookie + CSRF     |
| `POST /transfers/:id/transactions`              | `{transactionHash, stepIndex}`; verify a broadcast transaction against its stored step.                                                                        | Cookie + CSRF     |
| `GET /transfers`                                | Latest 50 transfers for the signed-in wallet.                                                                                                                  | Cookie            |
| `GET /transfers/:id`                            | Owned transfer with bounded provider status refresh.                                                                                                           | Cookie            |
| `POST /balances`                                | `{network, chainId, currencies:[address]}`; up to 20 assets for the signed-in address.                                                                         | Cookie + CSRF     |

Quote input contains `user`, origin/destination chain IDs, origin/destination currency addresses, `amount` as an integer **base-unit string**, `tradeType`, and optional recipient/slippage/destination-gas settings. The live UI uses `EXACT_INPUT`; the backend validates both provider trade types. Slippage is a basis-point string (`"50"` = 0.5%), never a decimal percentage. Token decimals come from chain-specific metadata. Unknown fields and malformed numeric strings are rejected.

Errors use `{error:{code,message,requestId}}` with a matching `X-Request-Id`. Rate-limit errors include `Retry-After`. No stack, credential, RPC URL, or raw upstream error body is returned to the browser. Treat `409 TRANSACTION_NOT_FOUND` as a retry of tracking: the RPC may not have indexed the transaction yet; do not send it again.

## Quote and transaction policy

Quote responses are normalized and checked against the requested wallet, recipient, chain, currency, exact amount, slippage, and minimum output. Server-owned hosts select Relay mainnet/testnet; the client cannot supply a provider URL. Current chain metadata and verified token discovery are required. Mainnet and execution switches are independent.

Executable transactions are limited to **one exact plain native transfer or one decoded ERC-20 `transfer`** to an operator-approved deposit address. Allowlist entries describe the native transaction destination or decoded ERC-20 deposit recipient. The ERC-20 transaction target must itself match the requested source token. This does not approve arbitrary calldata to that address. Approval/permit/signature steps, opaque routers, multicalls, gasless execution, non-EVM transactions, and multistep routes remain blocked. Relay is still trusted to associate the deposit with its quoted destination fill; there is no independent bridge proof system in this repository.

A stored quote has an execution deadline and a fingerprint of its server policy. Preparation checks current policy, wallet ownership, expiry, route support, and RPC availability. The quote ID creates at most one transfer. Reusing its original idempotency key returns that transfer; a different key returns a conflict. Idempotency prevents duplicate preparation, not blockchain replay by an external wallet.

Immediately before asking the wallet to send, the browser calls `/transfers/:id/authorize`. The server rechecks the stored quote, expiry, current policy, execution switch, and RPC availability, then atomically reserves that step once across devices. A second authorization returns `409 STEP_ALREADY_AUTHORIZED`; reservations do not automatically unlock. After a definite wallet rejection (`4001`), obtain a fresh quote. If the wallet outcome is uncertain, recover its transaction hash and retry tracking; do not automatically send again.

The browser rechecks wallet identity/network and asks the wallet to submit only the authorized transaction. A local pending-broadcast reference enables retrying tracking after reload. The backend reads the hash from its trusted RPC, verifies sender/target/calldata/value/chain against the prepared step, and atomically records the step once. RPC visibility proves the submitted transaction matches; it does not by itself prove mining, finality, or destination settlement.

Provider tracking starts only after a source hash is verified. Success/refund responses without transaction references remain pending. Provider chain metadata is checked against the stored route when supplied. Status refresh is client-driven; a background reconciler and independently verified destination receipts remain future work. A provider failure may still lead to a later retry/refund, so failure is not treated as terminal by the client.

## Limits and performance

The default fixed-window limits below are atomic in the shared store, so they apply across Cloud Run instances. They are service protection settings, not a guarantee of capacity or resistance to every abuse pattern.

| Scope                                                                                                                 | Default per minute |
| --------------------------------------------------------------------------------------------------------------------- | ------------------ |
| All API requests, per resolved IP (health/readiness exempt)                                                           | 180                |
| Authentication challenge + verification, shared per IP                                                                | 15                 |
| Quote requests, per wallet / global provider budget                                                                   | 12 / 45            |
| Transfer preparation, per wallet                                                                                      | 12                 |
| Wallet submission authorization, per wallet                                                                           | 12                 |
| Submitted-hash tracking writes, per wallet                                                                            | 45                 |
| Provider status refresh, per wallet / globally                                                                        | 45 / 150           |
| Actual provider metadata requests, globally                                                                           | 100                |
| Actual Relay API requests, globally (including account resources and vault USD pricing; vault GraphQL index separate) | 240                |
| Preferences writes, per wallet                                                                                        | 30                 |
| Balance reads, per wallet                                                                                             | 20                 |
| App/recovery balance reads combined, per wallet / actual upstream globally                                            | 20 / 40            |
| Vault position requests, per wallet / actual vault upstream globally                                                  | 20 / 60            |

Metadata caches last 60 seconds for chains and 30 seconds for currency search, coalesce identical in-flight requests, and keep a bounded entry count. Cache hits do not consume provider request budgets. Quotes are not cached across users. Provider status polls reuse a transfer updated within four seconds. RPC chain identity is checked and cached briefly; balance requests use a bounded batch with independent token failures. Application requests have a 32 KiB body limit; upstream response readers are bounded (Relay 2 MiB, RPC 1 MiB) and timed out.

Firestore transactions on hot shared rate-limit keys impose an intentional global ceiling and incur reads/writes. Before increasing traffic, measure contention, latency, provider quotas, and Firestore cost; a dedicated distributed limiter may be appropriate at higher volume. There is no load-test-based throughput claim.

`TRUST_PROXY_HOPS=0` is conservative: behind a proxy, users may share its rate-limit bucket. Only configure a nonzero value after checking forwarded headers and ensuring the same trusted ingress topology for every public path. Arbitrarily trusting user-supplied forwarded IPs defeats per-IP limits. Wallet/global limits remain independent of IP resolution.

Security headers on Node responses include CSP, frame blocking, MIME protection, and production HSTS. CSP uses same-origin scripts, no objects/frames, allowed API origins, HTTPS images, and Google font/style hosts; inline styles remain permitted for the current UI. Firebase Hosting supplies matching static-site headers with same-origin `connect-src`. An intentional cross-origin API deployment also needs a matching hosting CSP. API logs contain request IDs and safe error codes; credentials/cookies/signatures and raw request bodies are not logged.

## Read-only provider resources

Public transaction activity is served by both the Node API and a separate Sites Worker. [Live transactions](LIVE-TRANSACTIONS.md) describes validation, source attribution, caching, response bounds, streaming and the v2 retirement deadline. The public feed is independent of enabled trading chains and exposes indexed chain references, never account sessions, preferences, prepared transaction calldata or API keys.

Vault metadata and positions use fixed GraphQL queries on `https://vaults-api.relay.link/`. Optional USD estimates use Relay's documented token-price endpoint for reviewed chain/asset pairs only. App-fee and recovery balances also use fixed GET paths on `https://api.relay.link/`; no private provider key is needed for these public reads. Server routes bind private account queries to the authenticated wallet and reject supplied owner addresses, arbitrary URLs, and extra fields. The recovery `ownerChainId` identifies the Relay Hub owner account, not necessarily the deposit chain or Hoplane trading environment.

These services bound responses to 1 MiB, enforce an 8-second timeout, reject redirects, validate response fields, and sanitize upstream failures. Vault deadlines also cover stalled response bodies; optional USD prices have a shorter 3-second deadline and fail independently. Account and vault-position reads cache for 15 seconds; vault catalogs cache for 60 seconds. Caches are bounded, wallet-specific when applicable, clone results, and coalesce concurrent identical reads. Shared upstream budgets run only for cache misses. The HTTP response remains `no-store`.

Missing currency metadata and unknown USD values stay null. Display amounts are computed from exact raw units and separately verified asset/share decimals. Provider APY basis points convert to percent; its ambiguous zero fallback remains unavailable. Index timestamps and price fetch times are distinct, invalid/future timestamps are rejected, and index data older than one hour is marked stale. Vault assets include outstanding debt, and share balances do not establish immediately withdrawable amounts. [Vault data and units](VAULT-DATA.md) records the evidence and limitations. No yield guarantee or deposit action is synthesized.

The Vaults screen restores an existing session or signs in inline. It checks the backend before opening a wallet prompt and validates the exact SIWE domain, URI, wallet, chain, statement, nonce, and expiry before requesting a signature. Wallet/account changes and cancelled sign-in cannot populate the previous wallet's positions; a session issued during cancellation is revoked on a best-effort basis. The static preview shows documented reference contracts with unavailable metrics when no API is deployed. App-fee claims, sponsorship administration, deposit attestation, and recovery execution remain official provider flows for explicit user review.

## Firestore storage and retention

Documents live in `hoplane_*` collections. Payloads use a private JSON envelope with indexed `owner` and `createdAt` metadata, numeric logical `expiresAt`, and a Firestore Timestamp `ttl` for eventual deletion. Client rules deny all reads and writes; the Admin SDK uses IAM and bypasses those rules. Do not expose an Admin credential or use these rules as a substitute for backend ownership checks.

| Collection                | Retention                                                                |
| ------------------------- | ------------------------------------------------------------------------ |
| `hoplane_auth_challenges` | Five-minute challenge deadline; consumed once.                           |
| `hoplane_sessions`        | Configured session TTL, 24 hours by default.                             |
| `hoplane_rate_limits`     | Window end; normally one minute.                                         |
| `hoplane_quotes`          | Stored 24 hours for workflow references; execution expires much earlier. |
| `hoplane_transfers`       | 90 days from creation, including updates.                                |
| `hoplane_preferences`     | Retained until explicitly removed by account administration.             |

Expired records are excluded by application logic immediately; Firestore physical TTL deletion is asynchronous. The supplied index supports transfer listing by `owner ASC, createdAt DESC`. Create/consume/rate-limit/CAS operations use Firestore transactions; SQLite uses atomic local transactions. The in-memory adapter is for tests only.

Enable TTL on the `ttl` Timestamp field for all five expiring collections. These are deployment commands to run with authorized project credentials, not actions already completed:

```sh
for collection in hoplane_auth_challenges hoplane_sessions hoplane_rate_limits hoplane_quotes hoplane_transfers; do
  gcloud firestore fields ttls update ttl \
    --project=hoplane-b9ac1 --database='(default)' \
    --collection-group="$collection" --enable-ttl
done
```

Firestore TTL does not delete backups. Choose backup retention and account-deletion procedures separately. No user-facing account deletion or export API is implemented yet.

## Production deployment to hoplane-b9ac1

The included configuration selects `hoplane-b9ac1`; always pass the project explicitly as well. The deployment attempt on October 27, 2026 confirmed `401 ACCESS_TOKEN_TYPE_UNSUPPORTED` from Project, Billing and Cloud Run APIs. Cloud deployment and Firestore access remain unverified. Reconnect a valid deployment identity with the relevant permissions. A Firebase web API key does not authorize deployment. No cloud mutation was performed on the rejected credential.

For a local Google Cloud CLI login, use `gcloud auth login` and `gcloud config set project hoplane-b9ac1`. That authenticates only that computer. To authorize this managed workspace, reconnect its deployment identity or replace `GCP_DEPLOY_ACCESS_TOKEN` through secure environment settings using a valid short-lived OAuth access token. Never paste credentials in chat or source files. Firebase CLI needs its own authenticated session (`firebase login`) or supported Application Default Credentials; a browser Firebase configuration is insufficient.

After the one-time provisioning below, use Node 24, Google Cloud CLI, Firebase CLI, `curl`, and `jq`, then run:

```sh
bash scripts/deploy-firebase.sh
```

The script performs read-only project/billing/resource checks before deployment. It then builds the current app, deploys Firestore rules/indexes/TTL, runs the tested Cloud Build image build, deploys its exact digest to Cloud Run, publishes Hosting and checks the website, health, Firestore readiness and disabled execution through the Firebase URL. A new transfer index may take time to become `READY`; the script stops before publishing if it is still building. Optional `HOPLANE_BUILD_SERVICE_ACCOUNT` selects a pre-provisioned build identity in this project. The script uses `deploy/cloudrun.firebase.yaml` as the initial, non-secret runtime configuration; review it before applying it to a service with existing environment settings. It does not provision missing resources, change billing, or add provider secrets. The individual commands below remain available for provisioning and deliberate configuration changes.

Cloud Run uses a dedicated runtime identity, `hoplane-runtime@hoplane-b9ac1.iam.gserviceaccount.com`. Grant it `roles/datastore.user`; grant `roles/secretmanager.secretAccessor` separately on each secret it actually needs. Do not give the runtime identity Owner, Editor, Cloud Run Admin, or a downloaded service-account key. Use Application Default Credentials through the attached identity.

The build identity needs Artifact Registry write access to the selected repository, Cloud Logging write access, and read access to the Cloud Build source staging objects. The deploying identity needs Cloud Run deployment permissions and `iam.serviceAccounts.actAs` for the runtime account, plus access to deploy Firebase Hosting/rules/indexes. Bootstrap API/service-account/Firestore creation requires separate project administration rights; grant them to the provisioning identity rather than the application runtime.

### Provision once

Enable required APIs and create the repository/runtime identity with an authorized administrator:

```sh
gcloud services enable run.googleapis.com cloudbuild.googleapis.com \
  artifactregistry.googleapis.com firestore.googleapis.com \
  secretmanager.googleapis.com firebasehosting.googleapis.com \
  --project=hoplane-b9ac1

gcloud artifacts repositories create hoplane --repository-format=docker \
  --location=asia-south1 --project=hoplane-b9ac1

gcloud iam service-accounts create hoplane-runtime \
  --display-name='Hoplane Cloud Run runtime' --project=hoplane-b9ac1

gcloud projects add-iam-policy-binding hoplane-b9ac1 \
  --member='serviceAccount:hoplane-runtime@hoplane-b9ac1.iam.gserviceaccount.com' \
  --role=roles/datastore.user
```

If `(default)` Firestore does not already exist, create a Native-mode database in the approved location (for example `asia-south1`). Check existing resources first; database location is a long-lived project decision. Billing must be enabled for the selected services. Budget alerts and max instances limit different things; max instances is not a hard spending cap.

Deploy Firestore rules/indexes using an authenticated Firebase CLI, and wait until the transfer index is ready:

```sh
firebase deploy --project=hoplane-b9ac1 --only firestore:rules,firestore:indexes
```

Enable TTL using the earlier commands. Browser SDK requests must be denied by the supplied rules. Admin access must succeed only under the intended project identity.

### Build an immutable image

```sh
gcloud builds submit . --project=hoplane-b9ac1 --config=cloudbuild.yaml \
  --substitutions=_EXPECTED_PROJECT_ID=hoplane-b9ac1,_REGION=asia-south1,_REPOSITORY=hoplane
```

The first Cloud Build step checks `$PROJECT_ID` against `_EXPECTED_PROJECT_ID`. The Docker build runs type checking, tests, and both builds before producing an image containing the static SPA, compiled API, and production dependencies. The runtime runs as the unprivileged `node` user. `.dockerignore` excludes local environments, data, and common credential-file names; keep all credentials outside the repository regardless. Record the resulting image digest from the successful build; deploy that digest rather than an unspecified `latest` tag. The build configuration publishes an image only and contains no deployment step.

### Start with execution disabled

Save this non-secret configuration as a reviewed local `cloudrun.env.yaml`. Keep RPC credentials and Relay keys out of this file:

```yaml
NODE_ENV: production
STORE_DRIVER: firestore
FIREBASE_PROJECT_ID: hoplane-b9ac1
APP_ORIGIN: https://hoplane-b9ac1.web.app
ALLOWED_ORIGINS: https://hoplane-b9ac1.web.app
ENABLE_MAINNET: "false"
ENABLE_EXECUTION: "false"
ALLOWED_MAINNET_CHAINS: "1,8453,42161,10,137,56,43114,534352,324"
ALLOWED_TESTNET_CHAINS: "11155111,84532"
ALLOWED_TRANSACTION_TARGETS_JSON: "{}"
AUTH_CHAIN_ID: "1"
SESSION_TTL_MS: "86400000"
QUOTE_TTL_MS: "30000"
MAX_SLIPPAGE_BPS: "300"
RELAY_TIMEOUT_MS: "10000"
TRUST_PROXY_HOPS: "0"
```

Replace the digest placeholder with the exact image digest from the build:

```sh
gcloud run deploy hoplane-api \
  --project=hoplane-b9ac1 --region=asia-south1 \
  --image='asia-south1-docker.pkg.dev/hoplane-b9ac1/hoplane/hoplane-api@sha256:REPLACE_WITH_BUILT_DIGEST' \
  --service-account=hoplane-runtime@hoplane-b9ac1.iam.gserviceaccount.com \
  --env-vars-file=cloudrun.env.yaml \
  --port=8080 --memory=512Mi --cpu=1 \
  --min-instances=0 --max-instances=3 --concurrency=40 --timeout=30s \
  --allow-unauthenticated \
  --startup-probe=httpGet.path=/api/ready,httpGet.port=8080,initialDelaySeconds=0,periodSeconds=10,timeoutSeconds=5,failureThreshold=12 \
  --liveness-probe=httpGet.path=/api/health,httpGet.port=8080,periodSeconds=30,timeoutSeconds=5,failureThreshold=3
```

Public Cloud Run HTTP access allows Firebase Hosting to invoke the service; financial/account endpoints still require application wallet authentication. `Dockerfile` also defines a local container healthcheck; Cloud Run uses its explicitly configured startup/liveness probes. Scale-to-zero may add cold-start latency.

Build the same frontend revision locally and deploy Hosting:

```sh
npm ci
npm run build
firebase deploy --project=hoplane-b9ac1 --only hosting
```

`firebase.json` places `/api/**` before the SPA fallback and targets service `hoplane-api` in `asia-south1`. Use the configured canonical `web.app` origin. If serving a custom domain or the alternate `firebaseapp.com` domain, deliberately update the exact allowed origins and SIWE canonical origin, and validate signing/cookies there. A direct Cloud Run URL serving the SPA likewise needs that origin configuration. Keeping one canonical website origin simplifies session behavior.

### Add provider credentials through Secret Manager

Create dedicated secrets such as `hoplane-relay-api-key` and `hoplane-rpc-urls` in project `hoplane-b9ac1`, and add values with Secret Manager's protected UI or `gcloud secrets versions add --data-file` using a private local file. Do not place secret values in command arguments, shell history, logs, source control, build substitutions, or `VITE_*` variables. The RPC secret value is a JSON map of configured chain IDs to HTTPS endpoints; no client-supplied endpoint is accepted.

Grant the runtime identity access on each named secret, then reference explicit versions:

```sh
gcloud secrets add-iam-policy-binding hoplane-relay-api-key \
  --project=hoplane-b9ac1 \
  --member='serviceAccount:hoplane-runtime@hoplane-b9ac1.iam.gserviceaccount.com' \
  --role=roles/secretmanager.secretAccessor

gcloud secrets add-iam-policy-binding hoplane-rpc-urls \
  --project=hoplane-b9ac1 \
  --member='serviceAccount:hoplane-runtime@hoplane-b9ac1.iam.gserviceaccount.com' \
  --role=roles/secretmanager.secretAccessor

gcloud run services update hoplane-api --project=hoplane-b9ac1 --region=asia-south1 \
  --update-secrets=RELAY_API_KEY=hoplane-relay-api-key:1,RPC_URLS_JSON=hoplane-rpc-urls:1
```

Replace version `1` with the reviewed actual versions. The first deployment omits these environment variables so secret references do not conflict with plain environment values. Remove any existing plain environment mapping before switching that name to a secret reference. Rotation should deploy a new revision with a new pinned version.

Keep execution disabled while checking live metadata, signing, quotes, and balances. Obtain and independently verify the provider's currently valid deposit addresses; no addresses are guessed in this repository. Only enable supported testnet execution after configuring the target map, validating the prepared transaction, and testing settlement/recovery. Mainnet requires a separate decision and test evidence. Unsupported transaction formats continue to fail closed even with both feature flags enabled.

## Verification and operations

`npm test` includes request/auth/CSRF/owner isolation, quote validation and executable-route restrictions, provider error/size/timeout handling, RPC transaction/balance checks, local persistence/TTL/atomic consumption/CAS/rate counters, and frontend trade/storage/provider-boundary tests. Signing tests use synthetic test keys; no real user keys are required. Full test results should come from the final repository revision, not a previous build.

Eight real Firestore emulator integration tests exercise independent clients racing idempotent creation, SIWE challenge consumption, session revocation, preference versions, and shared rate limits; they also verify owner isolation, logical expiry/Timestamp retention metadata, and deny-all browser rules. These tests caught and fixed a Firestore pagination bug where expired records consumed the result limit and hid live transfers. The emulator does not establish production composite-index readiness or physical TTL deletion.

The production Docker image was built and smoke-tested locally against the emulator: non-root UID 1000, static SPA/fallback/cache/security headers, storage readiness, SIWE sign-in, Secure/HTTP-only `__session`, persisted authentication, CSRF rejection, and logout passed. The final image build ran 348 passing tests, with eight emulator tests skipped inside that isolated build; all eight were separately run successfully against the real emulator. Full type checking and both application builds passed. Build-time proxy CA material and local environment files were not present in the final image. Real testnet metadata returned successfully; no Relay quote using a private app key or actual on-chain settlement was tested. Browser visual QA, production IAM/index/TTL behavior, and Cloud Run deployment remain unverified; the supplied GCP token failed authentication.

To reproduce the integration tests, start the official Firestore emulator with the repository rules and a local demo project in one terminal. With Firebase CLI installed and Java 21 available:

```sh
firebase emulators:start --only firestore --project=demo-hoplane
```

Use the local port printed by the emulator (8080 by default; stop the development API first or configure another port), then run in another terminal:

```sh
METADATA_SERVER_DETECTION=none FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 \
  npx vitest run server/store.firestore.test.ts
```

The committed tests use project `demo-hoplane`, reject non-loopback emulator hosts, and skip when `FIRESTORE_EMULATOR_HOST` is absent, so they cannot silently fall back to a real Firestore project. During implementation the official emulator v1.22.0 ran on port 8085 with its published SHA-256 verified. Keep the emulator in memory for these tests; its synthetic records are isolated by generated identifiers. For a Docker-to-host emulator smoke test, add `host.docker.internal:host-gateway` and include that host in `NO_PROXY`/`no_proxy` so local gRPC traffic avoids an external proxy. Production credentials and private keys are not needed.

Before opening a funds-enabled release, verify storage across two service instances/restarts, concurrent preference edits/preparation, account isolation, replay rejection, cookie forwarding through Firebase Hosting, allowed/rejected origins, provider downtime, stale quotes, wallet cancellation, insufficient gas, transaction mismatch, interrupted hash tracking, and delayed/refunded settlement. Test exact launch routes; Relay testnets can lack DEX liquidity.

Monitor readiness failures, API/provider error rates, latency, 429s, Firestore contention, memory, and abandoned/pending transfers. Configure Cloud Monitoring alerts and billing budgets under the deployment identity. Correlate incidents with `X-Request-Id`; never ask users to send private keys. Setting `ENABLE_EXECUTION=false` stops new transfer preparation and step authorization while existing records can still be tracked; already authorized or broadcast wallet transactions cannot be revoked on chain by a server flag. Retain a tested previous image digest for rollback and do not delete active transfer records during recovery.

## Hosting references

- [Firebase Hosting with Cloud Run](https://firebase.google.com/docs/hosting/cloud-run).
- [Firebase Hosting cookies and cache behavior](https://firebase.google.com/docs/hosting/manage-cache) — the special `__session` cookie.
- [Cloud Build to Cloud Run](https://cloud.google.com/build/docs/deploying-builds/deploy-cloud-run).
- [Firestore TTL policies](https://cloud.google.com/firestore/native/docs/ttl).
