# Vault data and units

Verified against Relay's public documentation, GraphQL service, token-price API, and official `relayprotocol/relay-vaults` source on 2026-10-27. Repository source reviewed at commit `70f7864865f3a61a24002ec002d399e4e1e4d8c1`; source observations do not independently attest deployed bytecode.

## Lifecycle

Relay Vaults are winding down. The [official withdrawal guide](https://docs.relay.link/references/protocol/vaults/guides/withdrawing) says not to deposit new funds, gives the withdrawal UI retirement date of **2026-12-31**, and documents direct contract withdrawals afterward. Hoplane must preserve this context when presenting historical APY or existing positions. Showing a vault does not mean that deposits are available.

## Verified asset registry

The withdrawal guide explicitly states that both vaults hold WETH and issue WETH-REL shares with 18 decimals. The current public vault listing and Relay's curated currency metadata independently agree with these addresses and asset decimals.

| Chain | Vault contract | Underlying asset | Asset decimals | Share symbol / decimals |
| --- | --- | --- | --- | --- |
| Ethereum (1) | `0x57b68c4ea221ee8da6eb14ebdfccee5177567771` | WETH: `0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2` | 18 | WETH-REL / 18 |
| Arbitrum (42161) | `0xc7273772b87860097373d91b3880fd4cc61fba2d` | WETH: `0x82af49447d8a07e3bd95bd0d56f35241523fbab1` | 18 | WETH-REL / 18 |

Use chain ID **and** contract address as identity. The vault's `symbol` names its shares, not its underlying asset. ETH labels on Relay's presentation should not cause WETH amounts to be treated as native ETH balances.

The [schema comment](https://github.com/relayprotocol/relay-vaults/blob/70f7864865f3a61a24002ec002d399e4e1e4d8c1/backend/ponder.schema.ts) describes `decimals` as asset decimals, but the [deployment handler](https://github.com/relayprotocol/relay-vaults/blob/70f7864865f3a61a24002ec002d399e4e1e4d8c1/backend/src/handlers/RelayPoolFactory/PoolDeployed.ts) actually reads `decimals()` on the **vault contract**. Keep asset and share decimals separate. Do not extend the equality assumption to unknown pools.

## Public data sources

[Backend documentation](https://docs.relay.link/references/protocol/vaults/backend) identifies `https://vaults-api.relay.link/` as the public GraphQL service. The following read-only selection was verified live:

```graphql
query {
  relayPools(limit: 50) {
    items {
      chainId
      contractAddress
      name
      symbol
      asset
      decimals
      apy
      totalAssets
      totalShares
      outstandingDebt
      updatedAt
    }
    totalCount
  }
}
```

Amounts arrive as raw integer strings. Validate unsigned integer syntax and bounds; preserve them as strings/BigInt through calculations. The current API returned two pools. Do not treat a failed or incomplete listing as an authoritative empty catalogue.

The [Get Token Price API](https://docs.relay.link/references/api/get-token-price) documents:

```text
GET https://api.relay.link/currencies/token/price?chainId=1&address=0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2
Response: { "price": <number in USD> }
```

The API key is optional. Request the exact chain and asset from the verified registry. Validate the response as a finite positive price and apply bounded caching/timeouts. Price lookup failure should leave USD unavailable while preserving valid underlying-token amounts. This endpoint supplies no price timestamp: record local fetch time separately and do not claim on-chain oracle freshness.

[Get Currencies](https://docs.relay.link/references/api/get-currencies-v2), `POST /currencies/v2`, independently returns curated WETH metadata for both chains. It does **not** provide prices in its documented response.

## Metric meanings

| Field or display | Interpretation |
| --- | --- |
| `apy` | Signed integer **basis points**, expressly documented in the official schema. Display percent = `apy / 100`. Thus 132 means 1.32%, not 132%. |
| `totalAssets` | Raw underlying-asset units from the vault's `totalAssets()` read. For the verified WETH pools, formatted assets = raw amount / 10^18. |
| USD TVL estimate | Formatted underlying assets multiplied by the separately fetched USD price. Keep this an estimate and retain exact underlying units. |
| `totalShares` | Raw vault-share units, read from `totalSupply()`. Not a WETH balance. |
| `outstandingDebt` | Underlying funds lent to bridge recipients and not yet claimed back. Already contributes to `totalAssets`; never add it a second time. |
| Position assets | An indexed share-to-total-assets estimate can support display, but is not a withdrawal quote or proof of immediately redeemable liquidity. Contract rounding and available liquidity matter. |
| Pool `updatedAt` | Indexer's update time, currently serialized by GraphQL as a millisecond-epoch string. Not the same as the last HTTP fetch time or a finalized block timestamp. |
| User-balance `updatedAt` | Last time that wallet's balance record changed through a deposit, withdrawal, or transfer. An old value alone does not indicate an unhealthy indexer or an incorrect position. |

The [snapshot handler](https://github.com/relayprotocol/relay-vaults/blob/70f7864865f3a61a24002ec002d399e4e1e4d8c1/backend/src/handlers/PoolSnapshot.ts) reads `totalAssets()` and `totalSupply()`, then stores those values, APY, and `updatedAt: new Date()`. Snapshots have a minimum ten-minute interval; [indexer configuration](https://github.com/relayprotocol/relay-vaults/blob/70f7864865f3a61a24002ec002d399e4e1e4d8c1/backend/ponder.config.ts) schedules checks every 100 blocks in production. An old `updatedAt` can therefore be called old indexed data, rather than being dismissed as merely an inactive vault. A fresh HTTP response alone does not refresh the indexed record.

This periodic freshness reasoning applies to **pool records only**. User balances are updated by the [Deposit](https://github.com/relayprotocol/relay-vaults/blob/70f7864865f3a61a24002ec002d399e4e1e4d8c1/backend/src/handlers/RelayPool/Deposit.ts), [Withdraw](https://github.com/relayprotocol/relay-vaults/blob/70f7864865f3a61a24002ec002d399e4e1e4d8c1/backend/src/handlers/RelayPool/Withdraw.ts), and [Transfer](https://github.com/relayprotocol/relay-vaults/blob/70f7864865f3a61a24002ec002d399e4e1e4d8c1/backend/src/handlers/RelayPool/Transfer.ts) handlers. An untouched holding may legitimately retain an old activity timestamp while the associated pool's snapshots remain current.

Position responses therefore retain `updatedAt` as last activity and expose a separate nullable `indexUpdatedAt` from the cached pool snapshot. The one-hour stale flag uses only that snapshot timestamp; null means index freshness is unknown. Position reads never wait for an additional catalog or pricing request. Reviewed share decimals remain available from the registry during a catalog outage; unreviewed units without current cached metadata remain raw.

The snapshot APY calculation annualizes adjusted share-price growth over a seven-day reference window, falling back to the oldest available snapshot. The adjusted current price incorporates pending bridge fees. The handler stores zero when it cannot calculate APY, so a reported zero does **not** prove a measured zero return. APY can be negative. Present it as provider-reported historical/estimated yield, never a promised return or invitation to deposit.

The [current contract source](https://github.com/relayprotocol/relay-vaults/blob/70f7864865f3a61a24002ec002d399e4e1e4d8c1/smart-contracts/contracts/RelayPool.sol) defines total assets as yield-pool position value plus outstanding bridge debt, less pending bridge fees and unstreamed amounts, floored at zero. Consequently TVL is not the same as available withdrawal liquidity. Actual exits require contract-aware `maxWithdraw`/`maxRedeem` checks and a wallet-signed transaction; the read-only metrics integration does not implement those exits.

## Observed values, not fixtures

The verification query returned Ethereum APY 132 bps and raw total assets `160068620947780916843`, and Arbitrum APY 94 bps and raw total assets `25673336746776874784`. These are **observations only**; they must not be used as fallback live metrics. The token-price endpoint returned a positive price for each exact WETH asset. UI examples, screenshots, and these observations must never replace failed live data with apparently current balances or yields.
