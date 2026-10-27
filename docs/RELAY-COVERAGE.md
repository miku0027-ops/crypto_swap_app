# Relay reference inventory and Hoplane coverage

Reviewed against public sources on **2026-10-27**. This is an inventory of observed public navigation, the complete published documentation index, and the integration boundaries in Hoplane. It is not a claim that every authenticated Relay screen, country-specific fiat flow, provider backend, or contract system has been reproduced.

## Reference scope

- [Relay website](https://relay.link/) and [swap app](https://relay.link/bridge).
- [Vaults](https://relay.link/vaults), [transactions](https://relay.link/transactions), [app balance](https://relay.link/app-balance), and [withdrawal recovery](https://relay.link/withdraw).
- [Complete documentation index](https://docs.relay.link/llms.txt): **148 pages**, indexed in `src/lib/relay-reference.ts` with title, category, original directory summary, and canonical provider URL. The article bodies are not copied.
- [Support center](https://support.relay.link/en/): getting started, transaction problems, wallet network setup, safety, and FAQs. Its collection totals vary between cached home and collection pages; the live support center is authoritative.
- Public marketing/blog/company pages and the user's menu screenshots. Public reads cannot establish the complete contents of a signed-in developer dashboard or all wallet dialogs. Direct app HTML and sitemap retrieval were unavailable; indexed public pages and supplied screenshots were used instead of inventing hidden options.

## Navigation inventory

| Section | Observed destinations |
| --- | --- |
| Main app | Swap (`/bridge`), Vaults (`/vaults`), Transactions (`/transactions`) |
| Solutions | Wallets (`/wallets-solution`); Multichain Apps; Chains; Commerce & Payments |
| Products | Relay Dashboard; Relay App; Relay API; Relay Protocol; RelayKit |
| Developers | Documentation; API Reference; Testnets; Relay Chain Explorer; API Status |
| Company | Blog; Brand Assets; Jobs |
| App Resources | Help Center; App Balance; Withdraw Funds; Terms of Use; Privacy Policy |

The exact **25 destination URLs** are recorded in `RELAY_NAV_SECTIONS`. The wallet solution footer also contained a legacy Ecosystem link; it redirected to Relay's homepage when checked, so it is not represented as a separate working product. The documentation includes an additional Payment Service Providers solution not present in the main public footer.

The blog has Announcements, Case Studies, Education, Guides, and Buy Token collections. Hoplane uses its own product notes and brand files; Relay's articles, jobs, legal identity, partner endorsements, usage metrics, and service guarantees must not be presented as Hoplane's.

## Documentation coverage

| Group | Indexed pages | Topics |
| --- | ---: | --- |
| Platform | 2 | Product introduction and transaction lifecycle |
| Solutions | 5 | Payment providers, wallets, apps, chains, commerce |
| Features | 12 | Bridging, swaps, contract calls, app fees, sponsorship, deposit addresses, gas top-up, gasless execution/swaps, fast fill, price stabilization, routing models |
| Security | 6 | Screening, exchange restrictions, bounties, MEV handling, community support, audits |
| Resources | 4 | Chain support, AI integration, support, brand files |
| API | 65 | Setup/keys/rate limits, execution, fees/refunds, validation, trade types, error handling, indexing, smart accounts, supported VMs, deep links, webhooks/websockets, current and legacy endpoints |
| RelayKit | 24 | SDK, actions, adapters, type definitions, chain utilities, React hooks, widget/provider, theming |
| Protocol | 17 | Settlement chain, depository, deposit addresses, oracle, hub, allocator, governance, audits, recovery, addresses, EVM/Solana contracts |
| Vaults | 12 | Lifecycle, architecture, security, GraphQL, bridging legacy, interaction/withdrawals, pool/bridge factories and contracts |
| Changelog | 1 | Product and endpoint changes |

Deprecated API documents remain in the directory for discovery, but are not a recommendation to implement older endpoints. New integration work should follow each page's migration and deprecation notices.

## Product behavior and implementation boundaries

| Relay capability / screen | Hoplane treatment |
| --- | --- |
| Swap/bridge card, source/destination selection, recipient, quote details, slippage, gas top-up, wallet review | Live implementation uses validated server quotes and explicitly supported EVM transaction formats; a separate simulation remains labeled Demo. |
| Buy/Sell fiat controls | Navigation and explanatory setup; fiat checkout needs a selected provider and supported-country/payment configuration. No fake payment success. |
| Wallet connection and network/account switching | Installed EVM-wallet sign-in and repeated account/network checks. WalletConnect and non-EVM execution are separate integration work. |
| Transactions | Hoplane account history and simulation history remain separate. Public Relay wallet/ENS/hash search is a provider capability, not equivalent to Hoplane's owner-scoped server history. |
| Vaults | Read-only pool/position discovery and exit guidance, reflecting the current wind-down. No new-deposit action or invented APY. |
| Solutions and Products | Original Hoplane explanations with provider references and accurate availability; the external Relay developer dashboard is not impersonated as Hoplane administration. |
| Documentation/API/SDK/protocol | Searchable directory of all 148 published documentation pages, with original summaries and official links. This is a reference library, not copied proprietary documentation or a new protocol. |
| App Balance | Integrator app-fee and fee-sponsorship balance discovery. It is not an end-user's wallet token portfolio. Signing/claim/deposit/sponsorship administration are distinct financial actions. |
| Withdraw Funds | Recovery-balance discovery and official withdrawal guidance; recovering already-credited Hub funds is distinct from ordinary token sending, vault redemption, and replaying a bridge. |
| Company/brand/jobs | Hoplane-specific notes and downloadable original assets. No Relay job openings or partnerships are attributed to Hoplane. |
| Help, terms, privacy | Product-specific guidance and current implementation disclosures; provider terms remain linked as provider terms. |
| Gasless/permits/smart accounts/cross-chain calls/custom routing | Documented provider capabilities, blocked by the current Hoplane transaction policy unless separately implemented and reviewed. |
| Fee sponsorship/app fees/webhooks/websockets/fast fill | Documentation/reference coverage does not imply activated provider features or configured production credentials. |

## Current vault lifecycle (material finding)

The current [overview](https://docs.relay.link/references/protocol/vaults/overview) and [interaction guide](https://docs.relay.link/references/protocol/vaults/guides/interacting) say Relay Vaults are winding down and no longer support new deposits. The existing Relay withdrawal UI remains available until **December 31, 2026**; afterward, users can exit through the contracts using the [direct withdrawal guide](https://docs.relay.link/references/protocol/vaults/guides/withdrawing).

The public [GraphQL service](https://docs.relay.link/references/protocol/vaults/backend) at `https://vaults-api.relay.link/` returned two WETH-REL pools during this review, on Ethereum and Arbitrum. Discovery queries use fixed fields, bounded result counts, and decimal-string amounts. An indexed share balance is not a guaranteed immediately withdrawable amount: live withdrawal liquidity must be checked separately. Displayed index timestamps identify freshness; historical APY is not used to market new deposits.

The documented WETH exit uses `redeem(shares, receiver, owner)` on the vault. The native ETH route uses a gateway and requires an allowance plus redemption. No withdrawal transaction was signed or submitted during the reference review.

## Read-only account APIs

The [app-fee balance endpoint](https://docs.relay.link/references/api/get-app-fee-balances), `GET /app-fees/{wallet}/balances`, is public; an API key is optional for higher limits. Its balances belong to the named integrator wallet, not the browser's Demo wallet. App-fee claims, deposits, fee sponsorship, and dashboard administration require their own authorized workflows.

The [recovery balance endpoint](https://docs.relay.link/references/api/get-withdrawal-balances), `GET /withdrawals/balances`, is public and requires no signature. It takes a recovery owner address, a numeric owner-chain ID, a limit of at most 50, and an optional cursor. The recovery owner can differ from the original sender; the same EVM address on two owner chains can identify different Hub accounts. Null currency metadata is preserved, and balance discovery alone does not establish withdrawal eligibility.

The [withdrawal guide](https://docs.relay.link/references/protocol/guides/withdrawals) separates attestation, balance discovery, unsigned preparation, owner-signature execution, and status polling. Attestation changes protocol state and must not be treated as a read-only balance check. These recovery APIs are not versioned, so integration code must fail clearly on incompatible responses. No attestation, signing, claim, deposit, or withdrawal was performed during this review.

## Verification limits

The UI and documentation index can be checked through component tests, contrast calculations, TypeScript, builds, and provider read-only responses. Browser rendering/interactive reference inspection was unavailable in the session. The user-supplied screenshots were used for layout priorities; an exact pixel match, every signed-in provider flow, production settlement, and complete market-wide parity are not claimed.
