// src/config/__tests__/bridgeRouteMatrix.test.ts
//
// Guards the typed CCTP route matrix in two independent directions, with the real
// (unmocked) App Kit chain definitions and a recording of Circle's IRIS registry:
//
//   • SDK side — every chain the matrix treats as CCTP-X eligible must really
//     carry `cctpx.serviceAddress`, and no eligible testnet chain may be missing,
//     so an SDK upgrade that adds or drops a chain fails here instead of silently
//     at a user's transfer.
//   • Registry side — the recorded deployment rows must still equal what the
//     matrix claims. A live re-read of `GET /v2/cctpx/tokens` (paginated!) is a
//     separate, explicitly invoked check: `npm run verify:cctp-routes`.
//
// Nothing here touches the network.

import { describe, expect, it } from 'vitest'
import { AppKit } from '@circle-fin/app-kit'
import { BRIDGE_SELECTABLE_CHAINS } from '../bridgeConfig'
import {
  CCTPX_ELIGIBLE_CHAINS,
  NON_USDC_TOKEN_DEPLOYMENTS,
  USDC_BRIDGE_CHAINS,
  USDC_EXCLUDED_CHAINS,
  canUcwDirectBridgeToken,
  getUcwBridgeMechanism,
  filterBridgeableTokens,
  filterReachableDestinations,
  filterReachableSources,
  getBridgeRouteExclusionReason,
  getNonUsdcRoutePartners,
  isBridgeRouteSupported,
  isNonUsdcRouteSupported,
  normalizeMatrixToken,
} from '../bridgeRouteMatrix'

interface RegistryRow {
  symbol: string
  tokenId: string
  decimals: number
  domains: number[]
}

/**
 * Measured 2026-10-14 from the sandbox IRIS registry (all 15 pages / 736 rows).
 * These are the official Circle tokens; the same host also carries hundreds of
 * third-party test tokens, which the matrix deliberately ignores.
 */
const RECORDED_REGISTRY_ROWS: RegistryRow[] = [
  {
    symbol: 'EURC',
    tokenId: '0x2587821a0ee7daa174b95436b5dab1731cfa1844775b010217d3c0dd02a4eecd',
    decimals: 6,
    domains: [0, 1, 6, 14, 26],
  },
  {
    symbol: 'WETH',
    tokenId: '0xaa3cf4df2d82ec4b91da19afe54d414f637d068fe9cd52ba5e0e7e0d94f9eac8',
    decimals: 18,
    domains: [0, 26],
  },
  {
    symbol: 'cirBTC',
    tokenId: '0x7c27b7b6485f3ea49b7d1a439e288d3c3116f533302afabb7e372dfc0770cc7d',
    decimals: 8,
    domains: [0, 26],
  },
]

/**
 * Live USDC probe (2026-10-14): through the app's own `kit.estimateBridge` path
 * with `useForwarder: true`, every Arc Testnet <-> chain pair below resolved.
 * `failures` is the record of that run — a chain may only leave USDC reach by
 * re-measuring and editing this probe, never by drifting quietly.
 */
const RECORDED_USDC_ROUTE_PROBE = {
  measuredOn: '2026-10-14',
  pairs: BRIDGE_SELECTABLE_CHAINS.filter((chain) => chain !== 'Arc_Testnet').flatMap(
    (chain) =>
      [
        ['Arc_Testnet', chain],
        [chain, 'Arc_Testnet'],
      ] as Array<[string, string]>
  ),
  failures: [] as string[],
}

/** Testnet chains whose SDK definition advertises CCTP-X support. */
function eligibleTestnetChainDefs() {
  return new AppKit()
    .getSupportedChains('bridge')
    .filter((chain) => chain.isTestnet && Boolean((chain as any).cctpx?.serviceAddress))
}

function testnetChainDefs() {
  return new AppKit().getSupportedChains('bridge').filter((chain) => chain.isTestnet)
}

function domainOf(chain: any): number {
  return chain.cctp.domain as number
}

describe('CCTP route matrix — SDK eligibility', () => {
  it('lists exactly the testnet chains the SDK marks CCTP-X eligible, with matching domains', () => {
    const eligible = eligibleTestnetChainDefs()

    // Domains are unique per chain, so they key the two sides together without
    // depending on how either names a chain.
    const sdkDomains = eligible.map(domainOf).sort((a, b) => a - b)
    const matrixDomains = Object.values(CCTPX_ELIGIBLE_CHAINS).sort((a, b) => a - b)

    expect(matrixDomains).toEqual(sdkDomains)
    expect(sdkDomains).toEqual([0, 1, 2, 3, 6, 7, 26])
  })

  it('marks no chain eligible that the SDK would reject as a bridge endpoint', () => {
    const byDomain = new Map(testnetChainDefs().map((chain) => [domainOf(chain), chain]))

    for (const [chainKey, domain] of Object.entries(CCTPX_ELIGIBLE_CHAINS)) {
      const def = byDomain.get(domain)
      expect(def, `no testnet SDK chain for ${chainKey} (domain ${domain})`).toBeTruthy()
      expect(
        (def as any).cctpx?.serviceAddress,
        `${chainKey} is in the matrix but the SDK does not mark it CCTP-X eligible`
      ).toBeTruthy()
    }
  })

  it('keeps Arc Testnet eligibility (the app’s home chain) pinned to domain 26', () => {
    expect(CCTPX_ELIGIBLE_CHAINS.Arc_Testnet).toBe(26)
  })
})

describe('CCTP route matrix — registry deployments', () => {
  it('matches the recorded IRIS registry rows field by field', () => {
    for (const row of RECORDED_REGISTRY_ROWS) {
      const config = NON_USDC_TOKEN_DEPLOYMENTS[row.symbol as keyof typeof NON_USDC_TOKEN_DEPLOYMENTS]
      expect(config, `missing matrix entry for ${row.symbol}`).toBeTruthy()
      expect(config.tokenId).toBe(row.tokenId)
      expect(config.decimals).toBe(row.decimals)
      expect([...config.domains].sort((a, b) => a - b)).toEqual([...row.domains].sort((a, b) => a - b))
    }
    expect(Object.keys(NON_USDC_TOKEN_DEPLOYMENTS).sort()).toEqual(['EURC', 'WETH', 'cirBTC'])
  })

  it('derives the measured Arc Testnet partners for every token', () => {
    expect(getNonUsdcRoutePartners('EURC', 'Arc_Testnet')).toEqual([
      'Ethereum_Sepolia',
      'Avalanche_Fuji',
      'Base_Sepolia',
    ])
    expect(getNonUsdcRoutePartners('WETH', 'Arc_Testnet')).toEqual(['Ethereum_Sepolia'])
    expect(getNonUsdcRoutePartners('cirBTC', 'Arc_Testnet')).toEqual(['Ethereum_Sepolia'])
  })

  it('excludes a chain where the token is deployed but the chain is not eligible', () => {
    // Domain 14 is World Chain Sepolia: EURC is deployed there, yet no route.
    expect(CCTPX_ELIGIBLE_CHAINS.World_Chain_Sepolia).toBeUndefined()
    expect(getNonUsdcRoutePartners('EURC', 'World_Chain_Sepolia')).toEqual([])
    expect(isBridgeRouteSupported('EURC', 'Arc_Testnet', 'World_Chain_Sepolia')).toBe(false)
  })

  it('gives EURC six pairs and WETH/cirBTC one pair each, all symmetric and distinct', () => {
    const expected: Record<string, Array<[string, string]>> = {
      EURC: [
        ['Ethereum_Sepolia', 'Avalanche_Fuji'],
        ['Ethereum_Sepolia', 'Base_Sepolia'],
        ['Ethereum_Sepolia', 'Arc_Testnet'],
        ['Avalanche_Fuji', 'Base_Sepolia'],
        ['Avalanche_Fuji', 'Arc_Testnet'],
        ['Base_Sepolia', 'Arc_Testnet'],
      ],
      WETH: [['Ethereum_Sepolia', 'Arc_Testnet']],
      cirBTC: [['Ethereum_Sepolia', 'Arc_Testnet']],
    }

    for (const [token, pairs] of Object.entries(expected)) {
      const chains = Object.keys(CCTPX_ELIGIBLE_CHAINS)
      const found: Array<[string, string]> = []
      for (const from of chains) {
        for (const to of chains) {
          if (from === to) continue
          if (!isNonUsdcRouteSupported(token, from, to)) continue
          found.push(from < to ? [from, to] : [to, from])
        }
      }
      const normalized = [...new Set(found.map(([a, b]) => `${a}|${b}`))].sort()
      expect(normalized).toEqual(pairs.map(([a, b]) => `${a < b ? a : b}|${a < b ? b : a}`).sort())
    }
  })
})

describe('CCTP route matrix — USDC reach (live-measured)', () => {
  it('pins the recorded probe: all 22 Arc Testnet <-> chain pairs resolved', () => {
    expect(RECORDED_USDC_ROUTE_PROBE.pairs).toHaveLength(22)
    expect(RECORDED_USDC_ROUTE_PROBE.failures).toEqual([])

    for (const [from, to] of RECORDED_USDC_ROUTE_PROBE.pairs) {
      expect(isBridgeRouteSupported('USDC', from, to)).toBe(true)
    }
  })

  it('offers USDC on exactly the chains the Bridge tab lists', () => {
    expect([...USDC_BRIDGE_CHAINS].sort()).toEqual([...BRIDGE_SELECTABLE_CHAINS].sort())
  })

  it('keeps the excluded chains out of the USDC matrix, with a reason', () => {
    const excluded = Object.keys(USDC_EXCLUDED_CHAINS)

    expect(excluded.length).toBeGreaterThan(0)
    for (const chainKey of excluded) {
      // An exclusion has to say why, and can never be both offered and excluded.
      expect(USDC_EXCLUDED_CHAINS[chainKey].length).toBeGreaterThan(20)
      expect(USDC_BRIDGE_CHAINS).not.toContain(chainKey)
      expect(BRIDGE_SELECTABLE_CHAINS).not.toContain(chainKey)
      expect(getBridgeRouteExclusionReason(chainKey)).toBe(USDC_EXCLUDED_CHAINS[chainKey])
    }
  })

  it('drops an unverified chain from USDC candidate lists instead of promising it', () => {
    // Solana has a CCTP domain but no USDC route this app can deliver.
    expect(isBridgeRouteSupported('USDC', 'Arc_Testnet', 'Solana_Devnet')).toBe(false)
    expect(isBridgeRouteSupported('USDC', 'Solana_Devnet', 'Arc_Testnet')).toBe(false)
    expect(
      filterReachableDestinations('USDC', 'Arc_Testnet', [
        'Arc_Testnet',
        'Solana_Devnet',
        'Base_Sepolia',
      ])
    ).toEqual(['Base_Sepolia'])
    expect(getBridgeRouteExclusionReason('Base_Sepolia')).toBeNull()
  })
})

describe('CCTP route matrix — selection helpers', () => {
  it('treats USDC as supported across the offered chains except onto itself', () => {
    expect(isBridgeRouteSupported('USDC', 'Arc_Testnet', 'Sei_Testnet')).toBe(true)
    expect(isBridgeRouteSupported('USDC', 'Sei_Testnet', 'Arc_Testnet')).toBe(true)
    expect(isBridgeRouteSupported('USDC', 'Arc_Testnet', 'Arc_Testnet')).toBe(false)
    expect(isBridgeRouteSupported('USDC', '', 'Arc_Testnet')).toBe(false)
  })

  it('resolves the ETH auto-wrap alias onto the WETH routes', () => {
    expect(normalizeMatrixToken('ETH')).toBe('WETH')
    expect(normalizeMatrixToken('weth')).toBe('WETH')
    expect(normalizeMatrixToken('cirBTC')).toBe('cirBTC')
    expect(isBridgeRouteSupported('ETH', 'Ethereum_Sepolia', 'Arc_Testnet')).toBe(true)
    expect(isBridgeRouteSupported('ETH', 'Arc_Testnet', 'Base_Sepolia')).toBe(false)
  })

  it('narrows destination chains to the ones that token can reach, in selector order', () => {
    expect(filterReachableDestinations('EURC', 'Arc_Testnet', BRIDGE_SELECTABLE_CHAINS)).toEqual([
      'Ethereum_Sepolia',
      'Base_Sepolia',
      'Avalanche_Fuji',
    ])
    expect(filterReachableDestinations('WETH', 'Arc_Testnet', BRIDGE_SELECTABLE_CHAINS)).toEqual([
      'Ethereum_Sepolia',
    ])
    expect(filterReachableDestinations('USDC', 'Arc_Testnet', BRIDGE_SELECTABLE_CHAINS)).toEqual(
      BRIDGE_SELECTABLE_CHAINS.filter((chain) => chain !== 'Arc_Testnet')
    )
  })

  it('narrows source chains the same way', () => {
    expect(filterReachableSources('cirBTC', 'Arc_Testnet', BRIDGE_SELECTABLE_CHAINS)).toEqual([
      'Ethereum_Sepolia',
    ])
    expect(filterReachableSources('EURC', 'Base_Sepolia', BRIDGE_SELECTABLE_CHAINS)).toEqual([
      'Arc_Testnet',
      'Ethereum_Sepolia',
      'Avalanche_Fuji',
    ])
  })

  it('drops tokens that cannot leave the selected source chain', () => {
    const all = ['USDC', 'EURC', 'WETH', 'cirBTC']

    expect(filterBridgeableTokens(all, 'Arc_Testnet', BRIDGE_SELECTABLE_CHAINS)).toEqual(all)
    // Optimism Sepolia is CCTP-X eligible but no token is deployed there.
    expect(filterBridgeableTokens(all, 'Optimism_Sepolia', BRIDGE_SELECTABLE_CHAINS)).toEqual([
      'USDC',
    ])
    // Not eligible at all, so even a source with balances offers USDC only.
    expect(filterBridgeableTokens(all, 'Sei_Testnet', BRIDGE_SELECTABLE_CHAINS)).toEqual(['USDC'])
  })

  it('assigns each UCW-bridgeable token to the mechanism whose calldata the wallet can sign', () => {
    // A UCW wallet can only submit encoded calls, so every token needs a
    // mechanism it can carry: USDC and EURC ride standard CCTP v2
    // (TokenMessengerV2.depositForBurn with the token's own ERC-20 and decimals),
    // while wETH and cirBTC ride CCTP-X (`crossChainTransfer` on the proxy).
    expect(getUcwBridgeMechanism('USDC')).toBe('cctp-v2')
    expect(getUcwBridgeMechanism('usdc')).toBe('cctp-v2')
    expect(getUcwBridgeMechanism('EURC')).toBe('cctp-v2')
    expect(getUcwBridgeMechanism('WETH')).toBe('cctpx')
    expect(getUcwBridgeMechanism('cirBTC')).toBe('cctpx')

    // Native ETH means "wrap first", which needs an EIP-1193 provider the UCW
    // wallet does not have, so it must never resolve to a mechanism.
    expect(getUcwBridgeMechanism('ETH')).toBeNull()
    expect(getUcwBridgeMechanism('eth')).toBeNull()
    expect(getUcwBridgeMechanism('')).toBeNull()
    expect(getUcwBridgeMechanism('DAI')).toBeNull()

    // `canUcwDirectBridgeToken` is the same question as a boolean.
    expect(canUcwDirectBridgeToken('USDC')).toBe(true)
    expect(canUcwDirectBridgeToken('usdc')).toBe(true)
    expect(canUcwDirectBridgeToken('EURC')).toBe(true)
    expect(canUcwDirectBridgeToken('wETH')).toBe(true)
    expect(canUcwDirectBridgeToken('cirBTC')).toBe(true)
    // Registry symbols are case-insensitive on input, case-sensitive on output.
    expect(canUcwDirectBridgeToken('CIRBTC')).toBe(true)
    for (const token of ['ETH', '', 'DAI']) {
      expect(canUcwDirectBridgeToken(token)).toBe(false)
    }
  })
})
