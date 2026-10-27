/** Public, reviewed metadata only; also imported by the browser.
 * These are WETH vaults. Their share token is WETH-REL, not native ETH.
 * Never use these reference entries as a source of balances or yield.
 */
export const VAULT_METADATA_SOURCE =
  "https://docs.relay.link/references/protocol/vaults/guides/withdrawing";

export const KNOWN_VAULTS = [
  {
    chainId: 1,
    chainName: "Ethereum",
    address: "0x57b68c4ea221ee8da6eb14ebdfccee5177567771",
    name: "Wrapped Ether Relay Vault",
    symbol: "WETH-REL",
    assetAddress: "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2",
    assetSymbol: "WETH",
    assetDecimals: 18,
    shareDecimals: 18,
    metadataSource: VAULT_METADATA_SOURCE,
  },
  {
    chainId: 42161,
    chainName: "Arbitrum",
    address: "0xc7273772b87860097373d91b3880fd4cc61fba2d",
    name: "Wrapped Ether Relay Vault",
    symbol: "WETH-REL",
    assetAddress: "0x82af49447d8a07e3bd95bd0d56f35241523fbab1",
    assetSymbol: "WETH",
    assetDecimals: 18,
    shareDecimals: 18,
    metadataSource: VAULT_METADATA_SOURCE,
  },
] as const;
