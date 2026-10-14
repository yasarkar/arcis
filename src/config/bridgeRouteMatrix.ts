// src/config/bridgeRouteMatrix.ts
//
// Typed CCTP route matrix: which non-USDC token bridges between which chains.
//
// Circle's "CCTP for non-USDC" (CCTP-X) support is a *pair* property, not a
// chain property. App Kit's `bridge.mjs` requires both gates to open:
//
//   1. Both chains must be CCTP-X eligible — their SDK chain definition carries
//      `cctpx.serviceAddress` (a shared CrossChainTokenService proxy per
//      environment). On testnet that is exactly the seven chains below.
//   2. Circle's IRIS registry must list the token with a deployment on BOTH
//      chains' CCTP domains — `assertCCTPXTokenDeployments` in the SDK:
//      "a token routes iff the registry lists it with a deployment on both the
//      source and destination CCTP domains".
//
// Both facts were measured, not guessed (see docs/cctp-arc-testnet-route-matrix.md
// for the registry rows, the 24 live route checks and their results). Keeping the
// data here means the Bridge tab and its tests read the same source of truth
// instead of re-deriving routes from a token's presence on a chain.
//
// The registry's per-deployment `enabled` flag is intentionally NOT modelled: the
// SDK's token schema strips it and matches on `domainId` alone.

import type { SupportedBridgeToken } from '../types/bridge'

/** Tokens carried by the CCTP-X registry (USDC uses standard CCTPv2 instead). */
export type NonUsdcBridgeToken = 'EURC' | 'WETH' | 'cirBTC'

/**
 * Chains a USDC bridge can actually complete, measured live from Arc Testnet in
 * both directions (2026-10-14, `useForwarder: true`, the app's own
 * `kit.estimateBridge` path): all 22 checks resolved.
 *
 * USDC rides standard CCTPv2, whose route table is local to the SDK, so nothing
 * here is registry-gated — but "the SDK knows the route" is not the same as "this
 * app can deliver it". A chain only belongs here after a live check, and the
 * offline suite pins this list to `BRIDGE_SELECTABLE_CHAINS`, so adding a chain to
 * the selector forces a decision instead of silently widening USDC's promise.
 */
export const USDC_BRIDGE_CHAINS: readonly string[] = [
  'Arc_Testnet',
  'Ethereum_Sepolia',
  'Base_Sepolia',
  'Arbitrum_Sepolia',
  'Optimism_Sepolia',
  'Polygon_Amoy_Testnet',
  'Avalanche_Fuji',
  'HyperEVM_Testnet',
  'Sei_Testnet',
  'Sonic_Testnet',
  'Unichain_Sepolia',
  'World_Chain_Sepolia',
]

/**
 * Chains deliberately kept out of the USDC matrix, with the reason. A key here
 * must never appear in {@link USDC_BRIDGE_CHAINS} (the suite enforces it).
 */
export const USDC_EXCLUDED_CHAINS: Readonly<Record<string, string>> = {
  Solana_Devnet:
    'CCTP does support Solana, but this app cannot deliver there: the Bridge tab is EVM-only (wallet balances, destination-delivery verification and address handling), so no USDC route is offered.',
}

/**
 * Chain keys whose SDK chain definition carries `cctpx.serviceAddress`, mapped to
 * their CCTP domain. A chain missing here can NEVER route a non-USDC token; the
 * opposite is not true (eligibility alone does not imply a token is deployed).
 */
export const CCTPX_ELIGIBLE_CHAINS: Readonly<Record<string, number>> = {
  Ethereum_Sepolia: 0,
  Avalanche_Fuji: 1,
  Optimism_Sepolia: 2,
  Arbitrum_Sepolia: 3,
  Base_Sepolia: 6,
  Polygon_Amoy_Testnet: 7,
  Arc_Testnet: 26,
}

export interface NonUsdcTokenDeployments {
  /** bytes32 CCTP-X token id the registry lists on the testnet CCTS deployment. */
  tokenId: `0x${string}`
  decimals: number
  /** CCTP domains with a registry deployment (eligible or not, see the note). */
  domains: readonly number[]
}

/**
 * Measured registry deployments (sandbox host, 2026-10-14). Domain 14 is World
 * Chain Sepolia, which has EURC deployed but is not CCTP-X eligible — its
 * presence here is deliberately kept so the eligibility gate, not the deployment
 * list, is what excludes it.
 */
export const NON_USDC_TOKEN_DEPLOYMENTS: Readonly<
  Record<NonUsdcBridgeToken, NonUsdcTokenDeployments>
> = {
  EURC: {
    tokenId: '0x2587821a0ee7daa174b95436b5dab1731cfa1844775b010217d3c0dd02a4eecd',
    decimals: 6,
    domains: [0, 1, 6, 14, 26],
  },
  WETH: {
    tokenId: '0xaa3cf4df2d82ec4b91da19afe54d414f637d068fe9cd52ba5e0e7e0d94f9eac8',
    decimals: 18,
    domains: [0, 26],
  },
  cirBTC: {
    tokenId: '0x7c27b7b6485f3ea49b7d1a439e288d3c3116f533302afabb7e372dfc0770cc7d',
    decimals: 8,
    domains: [0, 26],
  },
}

/**
 * Alias used by the Bridge tab: `ETH` is the auto-wrap source form of `WETH`, so
 * it must resolve to the same routes. USDC keeps its own native CCTPv2 behaviour.
 */
export function normalizeMatrixToken(token?: SupportedBridgeToken | string): string {
  const upper = (token ?? '').trim().toUpperCase()
  if (upper === 'ETH' || upper === 'WETH') return 'WETH'
  // Registry symbols are case-sensitive (`cirBTC`), so fold the aliases back to
  // the exact keys used above instead of returning the upper-cased form.
  if (upper === 'CIRBTC') return 'cirBTC'
  return upper
}

function isNonUsdcToken(token: string): token is NonUsdcBridgeToken {
  return token === 'EURC' || token === 'WETH' || token === 'cirBTC'
}

/** Chain keys the token can reach from `fromChain` (empty when it is not eligible). */
export function getNonUsdcRoutePartners(token: string, fromChain: string): string[] {
  const normalized = normalizeMatrixToken(token)
  if (!isNonUsdcToken(normalized)) return []

  const fromDomain = CCTPX_ELIGIBLE_CHAINS[fromChain]
  if (fromDomain === undefined) return []

  const domains = NON_USDC_TOKEN_DEPLOYMENTS[normalized].domains
  if (!domains.includes(fromDomain)) return []

  return Object.entries(CCTPX_ELIGIBLE_CHAINS)
    .filter(([chainKey, domain]) => chainKey !== fromChain && domains.includes(domain))
    .map(([chainKey]) => chainKey)
}

/**
 * Whether `token` can be bridged from `fromChain` to `toChain`.
 *
 * USDC rides standard CCTPv2 and is limited to the chains a USDC transfer was
 * verified on; non-USDC tokens follow the two-gate registry + eligibility rule.
 * A bridge always needs two distinct chains, so `fromChain === toChain` is never
 * supported.
 */
export function isBridgeRouteSupported(token: string, fromChain: string, toChain: string): boolean {
  if (!fromChain || !toChain || fromChain === toChain) return false

  const normalized = normalizeMatrixToken(token)
  if (!isNonUsdcToken(normalized)) {
    return USDC_BRIDGE_CHAINS.includes(fromChain) && USDC_BRIDGE_CHAINS.includes(toChain)
  }

  return getNonUsdcRoutePartners(normalized, fromChain).includes(toChain)
}

/**
 * Which on-chain mechanism a Circle-UCW direct bridge must use for `token`.
 *
 * Circle splits non-USDC bridging across two contracts, and the split is not
 * optional (App Kit states it directly: "USDC and EURC bridging continues to use
 * CCTP v2 (`cctp.v2.*`) actions, not CCTPx"):
 *
 *   • `cctp-v2` — `TokenMessengerV2.depositForBurn(WithHook)` with the token's
 *     own ERC-20 address and decimals. Carries USDC and EURC.
 *   • `cctpx` — `crossChainTransfer` on the chain's CrossChainTokenService
 *     (`cctpx.serviceAddress`), which needs the token's bytes32 registry id, a
 *     per-token manager approval, an IRIS-signed fee quote and the fee as
 *     `msg.value`. Carries the custom/ownerless tokens, wETH and cirBTC.
 *
 * `null` means neither can carry it, so the token must not be offered on this
 * signer path at all.
 */
export type UcwBridgeMechanism = 'cctp-v2' | 'cctpx'

export function getUcwBridgeMechanism(token: string): UcwBridgeMechanism | null {
  // `ETH` in the Bridge tab means "wrap native ETH first", and wrapping needs an
  // EIP-1193 provider to sign `deposit()` — a Circle UCW wallet only signs
  // challenges, so the auto-wrap tier is never available on that signer path.
  if ((token ?? '').trim().toUpperCase() === 'ETH') return null
  const normalized = normalizeMatrixToken(token)
  if (normalized === 'USDC' || normalized === 'EURC') return 'cctp-v2'
  if (normalized === 'WETH' || normalized === 'cirBTC') return 'cctpx'
  return null
}

/** Whether the Circle-UCW direct bridge path can carry `token` at all. */
export function canUcwDirectBridgeToken(token: string): boolean {
  return getUcwBridgeMechanism(token) !== null
}

/**
 * Why no bridge is offered for `token` involving `chainKey`, or `null` when the
 * chain is fine. Only app-level exclusions are reported here: a chain that is
 * merely unsupported for one token is described by the pair, not by the chain.
 */
export function getBridgeRouteExclusionReason(chainKey: string): string | null {
  return USDC_EXCLUDED_CHAINS[chainKey] ?? null
}

/** Non-USDC answer without the USDC/distinct-chain shortcuts (tests pin this). */
export function isNonUsdcRouteSupported(token: string, fromChain: string, toChain: string): boolean {
  return getNonUsdcRoutePartners(token, fromChain).includes(toChain)
}

/**
 * Narrows a token list to the tokens that can actually leave `sourceChain`
 * somewhere inside `universe` — e.g. WETH disappears when the source is a chain
 * where the registry has no wETH deployment.
 */
export function filterBridgeableTokens(
  tokens: readonly string[],
  sourceChain: string,
  universe: readonly string[]
): string[] {
  return tokens.filter((token) =>
    universe.some((candidate) => isBridgeRouteSupported(token, sourceChain, candidate))
  )
}

/** Destination chains reachable from `sourceChain` with `token`. */
export function filterReachableDestinations(
  token: string,
  sourceChain: string,
  candidates: readonly string[]
): string[] {
  return candidates.filter((candidate) => isBridgeRouteSupported(token, sourceChain, candidate))
}

/** Source chains that can reach `destChain` with `token`. */
export function filterReachableSources(
  token: string,
  destChain: string,
  candidates: readonly string[]
): string[] {
  return candidates.filter((candidate) => isBridgeRouteSupported(token, candidate, destChain))
}
