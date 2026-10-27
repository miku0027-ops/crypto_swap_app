# Live public transaction activity

The Transactions page presents **Relay network activity**, including swaps initiated by other applications. It is not Hoplane trading volume. Personal Hoplane transfers and browser-local practice history have separate tabs. No analytics totals or success percentages are synthesized from this rolling sample.

## Sources and migration

Verified on 2026-10-27 against the [Requests documentation](https://docs.relay.link/references/api/get-requests), [live OpenAPI schema](https://api.relay.link/documentation/json), [v3 migration guide](https://docs.relay.link/references/api/api_guides/migrating-to-requests-v3), and read-only public requests.

- With a server-side `RELAY_API_KEY`, the service selects `GET https://api.relay.link/requests/v3` with 10-second shared snapshots. The current v3 API requires a key and applies provider visibility restrictions: this is the accessible public/own-integrator subset, not a guarantee of every Relay request globally.
- Without a key, it temporarily uses public `GET https://api.relay.link/requests/v2` with 60-second shared snapshots. **v2 retires November 24, 2026 at 00:00 UTC**; keyless reads fail closed after that deadline. Configure a key before then. No key is embedded in browser code or query strings.
- Both queries fix `limit=50`, `sortBy=createdAt`, `sortDirection=desc`, and `includeAuthenticatedData=false`. Explicit descending sort matters: ascending update order can return years-old records.
- The provider's [WebSocket guide](https://docs.relay.link/references/api/api_guides/websockets) also requires an API key and documents status subscriptions by request ID. This implementation uses HTTPS snapshots upstream and SSE downstream; it does not claim a provider WebSocket firehose or instant chain finality.

Live smoke validation returned 50 current indexed requests, all with parsed source/destination assets, and both successful and failed statuses. Those observed values are not fixtures or fallbacks in the product.

## Backend contract

`GET /api/transactions` and `/api/transactions/stream` are read-only public endpoints. They reject all query parameters; the browser filters its latest loaded records. They never proxy arbitrary URLs or forward browser cookies to Relay. Search covers wallet addresses, hashes, request IDs and token symbols in the current sample. ENS and exhaustive historical search are not implemented.

The response contains normalized transactions, fetch time, latest provider activity time, refresh interval, omission count, and provider/source metadata. It does not include private provider attribution, API key data, raw calldata, user sessions, or continuation tokens. Only requests with an indexed transaction reference are published. Records lacking a usable identifier/time are omitted and counted; a wholly invalid nonempty listing is an error, not an empty feed.

Amounts are unsigned integer strings bounded to uint256. Asset decimals are integers from 0 to 36; formatting uses integer arithmetic rather than `Number`. Unknown assets remain unavailable. Zero is shown only when explicitly present. The server recomputes formatted amounts instead of trusting provider `amountFormatted` strings. In v3 it uses `data.route.actual.origin.inputCurrency` and `data.route.actual.destination.outputCurrency`; quoted fallback is explicitly labelled. v2 metadata amounts for non-successful requests are labelled quoted. Refund destination amounts are historical route amounts, not an assertion of the actual refund value.

Statuses remain provider-reported. Unknown statuses stay unknown. Fill time is calculated only for successful requests with usable origin and destination transaction timestamps on the expected chains; failed references, missing times and negative intervals cannot manufacture a fill duration. It is indexed transaction timing, not an independently verified finality measurement or UI stopwatch.

## Streaming and bounds

The service uses an 8-second deadline covering quota admission, fetch and response-body reads, including stalled implementations that ignore abort. Responses are limited to 2 MiB with strict UTF-8/JSON parsing, no redirects, at most 50 requests, and bounded transaction references. Failures are sanitized. Concurrent identical reads coalesce, successful snapshots are cloned on return, and 429/provider failures install a bounded cooldown. A keyed v3 failure never silently falls back to deprecated v2.

SSE sends `snapshot` and `feed-error` events plus 15-second heartbeats. Streams are pull-driven to respect backpressure, last at most approximately two minutes before reconnecting, and dispose timers on cancellation. The Node service caps 100 active streams, three per IP, and six admissions per IP per minute, in addition to global rate limits. Shutdown cancels streams. Actual upstream reads consume the shared Relay budget and a 12/minute activity budget.

The Sites Worker has the same feed validation and stream implementation, successful snapshot caching in the edge Cache API, in-isolate single-flight/cooldown, bounded IP buckets, 30 HTTP reads per IP per minute and the same stream connection/admission caps. These local edge limits are not a substitute for a provider-wide quota: configure the provider key and monitor 429 responses before large public rollout.

The UI pauses connections while hidden, offline, manually paused or on personal history. Interrupted streams fall back to bounded polling. Invalid or older events cannot overwrite a newer valid snapshot. Errors keep the last real records visible and mark updates delayed. Old HTTP snapshots and provider records have distinct freshness warnings. No synthetic activity replaces an outage.

## Hosting

`npm run build:site` builds the existing web/Node outputs and a separate Worker artifact in `dist-site`. It preserves the Site project ID and audience, embeds the Vite assets, validates the ESM default `fetch` export, and leaves account/trading APIs for GCP. Those unconfigured routes return explicit JSON availability errors. The Worker permits only fixed public feed paths and applies same-origin policy and static security headers.

Set `RELAY_API_KEY` as an encrypted runtime secret on the deployment target. Never use `VITE_RELAY_API_KEY`. The private Sites preview can stream public activity without GCP deployment, but wallet sign-in, vault positions, trade execution and sync still require the authenticated backend. No wallet transaction is signed or broadcast by this feature.
