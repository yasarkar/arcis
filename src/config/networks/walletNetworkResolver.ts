// src/config/networks/walletNetworkResolver.ts
//
// Thin wallet-aware network & token resolver extending the existing single sources
// of truth (networkRegistry, bridgeConfig, bridgeRouteMatrix, gatewayConfig,
// circleBlockchain, tokenUtils). Never duplicates chain or route definitions.

import {
  IS_TESTNET,
  getNetwork,
  getNetworksByCapability,
} from './networkRegistry.js'
import { isSolanaChain } from '../chainMeta.js'
import { GATEWAY_SUPPORTED_CHAINS } from '../gatewayConfig.js'
import {
  BRIDGE_SELECTABLE_CHAINS,
  BRIDGE_GATEWAY_SELECTABLE_CHAINS,
} from '../bridgeConfig.js'
import {
  filterBridgeableTokens,
  filterReachableDestinations,
  filterReachableSources,
  getUcwBridgeMechanism,
} from '../bridgeRouteMatrix.js'
import { isCircleUcwChain } from '../../utils/circleBlockchain.js'
import { CHAIN_NATIVE_MAP, getCleanNativeTokenName } from '../../utils/tokenUtils.js'

export type WalletAuthSource = 'passkey' | 'ucw' | 'evm' | null | undefined
export type AppSurface = 'send' | 'bridge' | 'swap' | 'deposit'
export type TransferMode = 'direct' | 'gateway'
export type BridgeChainSide = 'source' | 'destination'

export interface SupportedTokenDescriptor {
  symbol: string
  name: string
  decimals: number
  address?: string
  isNative: boolean
  isAutoWrap?: boolean
}

export interface GetWalletSupportedChainsParams {
  surface: AppSurface
  authSource?: WalletAuthSource
  mode?: TransferMode
  /** For bridge: whether resolving the source or destination selector. */
  side?: BridgeChainSide
  /** For bridge: the opposite selected chain, used with `token` to filter reachable partners. */
  pairedChain?: string
  /** For bridge: currently selected bridge token. */
  token?: string
  /** Optional testnet override (defaults to active app environment IS_TESTNET). */
  isTestnet?: boolean
}

export interface GetChainSupportedTokensParams {
  surface: AppSurface
  chainKey: string
  destChainKey?: string
  authSource?: WalletAuthSource
  mode?: TransferMode
  /** True when native ETH auto-wrap to WETH is available on `chainKey`. */
  canAutoWrapEth?: boolean
  /** Optional filter for swap tokens with an active on-chain pool route. */
  isTokenSwappable?: (symbol: string) => boolean
}

const TOKEN_DISPLAY_NAMES: Record<string, string> = {
  USDC: 'USD Coin',
  EURC: 'Euro Coin',
  cirBTC: 'Circle Bitcoin',
  WETH: 'Wrapped Ether',
  ETH: 'Ethereum (Auto-Wrap)',
}

const CANONICAL_TOKEN_ORDER = ['USDC', 'EURC', 'cirBTC', 'WETH'] as const

function prioritizeArcFirst(chainKeys: readonly string[]): string[] {
  const unique = Array.from(new Set(chainKeys))
  const arcIndex = unique.indexOf('Arc_Testnet')
  if (arcIndex <= 0) return unique
  return ['Arc_Testnet', ...unique.filter((k) => k !== 'Arc_Testnet')]
}

/**
 * Checks whether `chainKey` is valid for the active environment (testnet-only in testnet builds)
 * and can be signed by the connected wallet type (`authSource`).
 */
export function isChainSupportedByWallet(
  chainKey: string,
  authSource?: WalletAuthSource,
  options?: { allowSolana?: boolean; isTestnet?: boolean }
): boolean {
  const targetTestnet = options?.isTestnet ?? IS_TESTNET
  const net = getNetwork(chainKey)
  if (!net || net.testnet !== targetTestnet) return false

  const isSolana = isSolanaChain(chainKey)
  if (isSolana && !options?.allowSolana) return false

  if (authSource === 'passkey') {
    return Boolean(net.capabilities.modular)
  }

  if (authSource === 'ucw') {
    return !isSolana && Boolean(net.capabilities.ucw) && isCircleUcwChain(chainKey)
  }

  return true
}

/**
 * Returns the ordered list of testnet (or active-env) chain keys supported for
 * the requested surface, transfer mode, and connected wallet type.
 *
 * Unsupported or mainnet chains are excluded rather than shown disabled.
 */
export function getWalletSupportedChains(params: GetWalletSupportedChainsParams): string[] {
  const {
    surface,
    authSource,
    mode = 'direct',
    side = 'source',
    pairedChain,
    token,
    isTestnet = IS_TESTNET,
  } = params

  if (surface === 'swap') {
    const swapChains = getNetworksByCapability('swap', isTestnet)
      .map((net) => net.key)
      .filter((key) => isChainSupportedByWallet(key, authSource, { allowSolana: false, isTestnet }))
    return prioritizeArcFirst(swapChains)
  }

  if (surface === 'deposit') {
    const depositChains = BRIDGE_GATEWAY_SELECTABLE_CHAINS.filter((key) =>
      isChainSupportedByWallet(key, authSource, { allowSolana: false, isTestnet })
    )
    return prioritizeArcFirst(depositChains)
  }

  if (surface === 'send') {
    const base =
      mode === 'gateway'
        ? GATEWAY_SUPPORTED_CHAINS
        : getNetworksByCapability('send', isTestnet).map((net) => net.key)

    const allowSolana = authSource !== 'ucw' && authSource !== 'passkey'
    const filtered = base.filter((key) =>
      isChainSupportedByWallet(key, authSource, { allowSolana, isTestnet })
    )
    return prioritizeArcFirst(filtered)
  }

  // surface === 'bridge'
  const baseUniverse =
    mode === 'gateway' ? BRIDGE_GATEWAY_SELECTABLE_CHAINS : BRIDGE_SELECTABLE_CHAINS

  const walletFiltered = baseUniverse.filter((key) => {
    const net = getNetwork(key)
    if (!net || net.testnet !== isTestnet) return false

    if (authSource === 'passkey') {
      // Modular smart account currently signs on Arc_Testnet; destination stays open to reachable EVM chains
      return side === 'source' ? Boolean(net.capabilities.modular) : true
    }

    if (authSource === 'ucw') {
      // Direct CCTP uses forwarder on destination, so only source requires a UCW wallet;
      // Gateway UCW requires Circle blockchain mapping on both source and destination.
      if (mode === 'gateway' || side === 'source') {
        return Boolean(net.capabilities.ucw) && isCircleUcwChain(key)
      }
      return true
    }

    return true
  })

  if (token && pairedChain) {
    const routeFiltered =
      side === 'source'
        ? filterReachableSources(token, pairedChain, walletFiltered)
        : filterReachableDestinations(token, pairedChain, walletFiltered)
    return prioritizeArcFirst(routeFiltered)
  }

  return prioritizeArcFirst(walletFiltered)
}

/**
 * Dynamically returns the tokens supported on `chainKey` for the given surface,
 * transfer mode, and connected wallet type — backed directly by `networkRegistry.tokens`
 * and `bridgeRouteMatrix`.
 */
export function getChainSupportedTokens(
  params: GetChainSupportedTokensParams
): SupportedTokenDescriptor[] {
  const {
    surface,
    chainKey,
    destChainKey,
    authSource,
    mode = 'direct',
    canAutoWrapEth = false,
    isTokenSwappable,
  } = params

  const net = getNetwork(chainKey)
  if (!net) return []

  const getDecimals = (symbol: string): number => {
    if (net.tokenDecimals?.[symbol] !== undefined) return net.tokenDecimals[symbol]
    if (symbol === 'cirBTC') return 8
    if (symbol === 'WETH' || symbol === 'ETH') return 18
    return 6
  }

  // Gateway & Unified Balance deposit are strictly USDC-only
  if (mode === 'gateway' || surface === 'deposit') {
    if (!net.tokens.USDC) return []
    return [
      {
        symbol: 'USDC',
        name: TOKEN_DISPLAY_NAMES.USDC,
        decimals: getDecimals('USDC'),
        address: net.tokens.USDC,
        isNative: false,
      },
    ]
  }

  const deployedSymbols = Object.keys(net.tokens).filter((sym) => Boolean(net.tokens[sym]))
  const orderedDeployed = [
    ...CANONICAL_TOKEN_ORDER.filter((sym) => deployedSymbols.includes(sym)),
    ...deployedSymbols.filter(
      (sym) => !(CANONICAL_TOKEN_ORDER as readonly string[]).includes(sym)
    ),
  ]

  if (surface === 'swap') {
    return orderedDeployed
      .filter((sym) => (isTokenSwappable ? isTokenSwappable(sym) : true))
      .map((sym) => ({
        symbol: sym,
        name: TOKEN_DISPLAY_NAMES[sym] || sym,
        decimals: getDecimals(sym),
        address: net.tokens[sym],
        isNative: false,
      }))
  }

  if (surface === 'bridge') {
    const bridgeCandidates: string[] = []
    for (const sym of orderedDeployed) {
      if (sym === 'USDC' || sym === 'EURC' || sym === 'WETH' || sym === 'cirBTC') {
        bridgeCandidates.push(sym)
      }
    }
    if (canAutoWrapEth && authSource !== 'ucw' && Boolean(net.tokens.WETH)) {
      const wethIdx = bridgeCandidates.indexOf('WETH')
      if (wethIdx >= 0) {
        bridgeCandidates.splice(wethIdx + 1, 0, 'ETH')
      } else {
        bridgeCandidates.push('ETH')
      }
    }

    const universe = destChainKey ? [destChainKey] : BRIDGE_SELECTABLE_CHAINS
    const reachable = filterBridgeableTokens(bridgeCandidates, chainKey, universe).filter((sym) => {
      if (authSource === 'ucw') {
        return getUcwBridgeMechanism(sym) !== null && (sym === 'ETH' ? false : Boolean(net.tokens[sym]))
      }
      return true
    })

    return reachable.map((sym) => ({
      symbol: sym,
      name: TOKEN_DISPLAY_NAMES[sym] || sym,
      decimals: sym === 'ETH' ? 18 : getDecimals(sym),
      address: sym === 'ETH' ? undefined : net.tokens[sym],
      isNative: sym === 'ETH',
      isAutoWrap: sym === 'ETH',
    }))
  }

  // surface === 'send' (mode === 'direct')
  const sendTokens: SupportedTokenDescriptor[] = orderedDeployed.map((sym) => ({
    symbol: sym,
    name: TOKEN_DISPLAY_NAMES[sym] || sym,
    decimals: getDecimals(sym),
    address: net.tokens[sym],
    isNative: false,
  }))

  // Include native gas currency when distinct from USDC and not already listed as an ERC-20
  const nativeInfo = CHAIN_NATIVE_MAP[chainKey] || net.nativeCurrency
  if (nativeInfo && nativeInfo.symbol !== 'USDC' && !net.tokens[nativeInfo.symbol]) {
    sendTokens.push({
      symbol: nativeInfo.symbol,
      name: getCleanNativeTokenName(nativeInfo.symbol),
      decimals: nativeInfo.decimals ?? net.nativeCurrency?.decimals ?? 18,
      isNative: true,
    })
  }

  return sendTokens
}

/**
 * Clamps a requested chain key to the supported list, falling back to `preferredFallback`
 * (or the first available chain) so unsupported chains can never remain selected.
 */
export function resolveWalletSupportedChain(
  requestedChain: string | undefined,
  supportedChains: readonly string[],
  preferredFallback = 'Arc_Testnet'
): string {
  if (requestedChain && supportedChains.includes(requestedChain)) {
    return requestedChain
  }
  if (supportedChains.includes(preferredFallback)) {
    return preferredFallback
  }
  return supportedChains[0] || preferredFallback
}

/**
 * Clamps a requested token symbol to the chain's dynamically supported token list.
 */
export function resolveSupportedToken(
  requestedToken: string | undefined,
  supportedTokens: readonly SupportedTokenDescriptor[],
  preferredFallback = 'USDC'
): string {
  if (requestedToken && supportedTokens.some((t) => t.symbol === requestedToken)) {
    return requestedToken
  }
  if (supportedTokens.some((t) => t.symbol === preferredFallback)) {
    return preferredFallback
  }
  return supportedTokens[0]?.symbol || preferredFallback
}
