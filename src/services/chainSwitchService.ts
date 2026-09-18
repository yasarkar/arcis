/**
 * Centralized Chain Switching Service for Arcis Protocol.
 * 
 * Provides unified, resilient network switching and addition logic:
 * - Handles EIP-1193 wallet_switchEthereumChain
 * - Handles EIP-3085 wallet_addEthereumChain fallback on error code 4902
 * - Gracefully handles user rejections (code 4001) without crashing or false error popups
 * - Resolves chain parameters dynamically from the Master Network Registry
 * - Supports both active environment Arc L1 (testnet/mainnet) and multi-chain ecosystem
 */
import type { Chain } from 'viem'
import {
  arcActiveChain,
  getNetwork,
  getNetworkByChainId,
  resolveChain,
  type NetworkConfig,
} from '../config/networks/networkRegistry'
import { normalizeAppError } from '../utils/errorNormalizer'
import { watchArcToken } from './tokenAssetService'

export { resolveChain }

export interface AddEthereumChainParameter {
  chainId: `0x${string}`
  chainName: string
  nativeCurrency: {
    name: string
    symbol: string
    decimals: number
  }
  rpcUrls: string[]
  blockExplorerUrls?: string[]
}

export interface ChainSwitchResult {
  success: boolean
  chainId?: number
  error?: string
  isCanceled?: boolean
}

/**
 * Resolves an EIP-1193 compatible provider from parameter or window.ethereum.
 */
export function resolveProvider(customProvider?: any): any {
  if (customProvider && typeof customProvider.request === 'function') {
    return customProvider
  }
  if (typeof window !== 'undefined' && (window as any).ethereum) {
    return (window as any).ethereum
  }
  return undefined
}

/**
 * Builds an EIP-3085 compliant parameter object for wallet_addEthereumChain.
 * Derives RPCs, block explorers, and currency decimals dynamically from networkRegistry.
 */
export function buildAddEthereumChainParameter(
  target: string | number | Chain
): AddEthereumChainParameter {
  let viemChain: Chain | undefined
  let netConfig: NetworkConfig | undefined

  if (typeof target === 'object' && 'id' in target && 'name' in target) {
    viemChain = target
    netConfig = getNetworkByChainId(target.id)
  } else if (typeof target === 'number') {
    netConfig = getNetworkByChainId(target)
    viemChain = resolveChain(target)
  } else {
    netConfig = getNetwork(target)
    viemChain = netConfig?.viemChain || resolveChain(target)
  }

  if (!viemChain) {
    throw new Error(`Cannot build add chain parameters: unknown network "${String(target)}"`)
  }

  const hexId = `0x${viemChain.id.toString(16)}` as `0x${string}`

  // Primary + fallback RPCs without duplicates
  const rpcList: string[] = netConfig
    ? [netConfig.rpcUrls.primary, ...netConfig.rpcUrls.fallbacks].filter(
        (url, idx, arr) => arr.indexOf(url) === idx
      )
    : [...viemChain.rpcUrls.default.http]

  // Explorers
  const explorerList: string[] = []
  if (netConfig?.blockExplorers?.url) {
    explorerList.push(netConfig.blockExplorers.url)
  } else if (viemChain.blockExplorers?.default?.url) {
    explorerList.push(viemChain.blockExplorers.default.url)
  }

  return {
    chainId: hexId,
    chainName: viemChain.name,
    nativeCurrency: {
      name: viemChain.nativeCurrency.name,
      symbol: viemChain.nativeCurrency.symbol,
      decimals: viemChain.nativeCurrency.decimals,
    },
    rpcUrls: rpcList,
    blockExplorerUrls: explorerList.length > 0 ? explorerList : undefined,
  }
}

/**
 * Checks if the wallet is currently connected to the target chain.
 */
export async function isCurrentNetwork(
  target: string | number | Chain,
  customProvider?: any
): Promise<boolean> {
  const provider = resolveProvider(customProvider)
  if (!provider) return false

  const chain = resolveChain(target)
  if (!chain) return false

  try {
    const currentHex = await provider.request({ method: 'eth_chainId' })
    if (!currentHex) return false
    return parseInt(String(currentHex), 16) === chain.id
  } catch {
    return false
  }
}

/**
 * Ensures the wallet is switched to the target network.
 * Automatically attempts wallet_addEthereumChain if the network has not yet been registered in the wallet.
 */
export async function ensureNetwork(
  target: string | number | Chain,
  customProvider?: any
): Promise<ChainSwitchResult> {
  const provider = resolveProvider(customProvider)
  if (!provider) {
    return {
      success: false,
      error: 'No active Ethereum wallet provider found. Please connect your wallet.',
    }
  }

  const chain = resolveChain(target)
  if (!chain) {
    return {
      success: false,
      error: `Unrecognized network: "${String(target)}".`,
    }
  }

  const targetHex = `0x${chain.id.toString(16)}`

  // 1. Quick check if already active on the target chain
  try {
    const currentHex = await provider.request({ method: 'eth_chainId' })
    if (currentHex && parseInt(String(currentHex), 16) === chain.id) {
      return { success: true, chainId: chain.id }
    }
  } catch {
    // Ignore verification failure and proceed to switch request
  }

  // 2. Request switch
  try {
    await provider.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: targetHex }],
    })
    if (chain.id === arcActiveChain.id || chain.name.toLowerCase().includes('arc')) {
      setTimeout(() => {
        watchArcToken('USDC', provider).catch(() => {})
      }, 700)
    }
    return { success: true, chainId: chain.id }
  } catch (switchErr: any) {
    const code = switchErr?.code ?? switchErr?.cause?.code
    const msg = String(switchErr?.message || '')

    // 4001: User rejected the request
    if (
      code === 4001 ||
      msg.includes('rejected') ||
      msg.includes('canceled') ||
      msg.includes('User rejected') ||
      msg.includes('User canceled')
    ) {
      return {
        success: false,
        isCanceled: true,
        error: 'The network switch request was canceled in the wallet.',
      }
    }

    // 4902 or unrecognized chain: Attempt to add chain to wallet
    if (
      code === 4902 ||
      code === -32603 ||
      msg.includes('Unrecognized chain') ||
      msg.includes('wallet_addEthereumChain') ||
      msg.includes('not added') ||
      msg.includes('unknown chain')
    ) {
      try {
        const addParams = buildAddEthereumChainParameter(chain)
        await provider.request({
          method: 'wallet_addEthereumChain',
          params: [addParams],
        })
        if (chain.id === arcActiveChain.id || chain.name.toLowerCase().includes('arc')) {
          setTimeout(() => {
            watchArcToken('USDC', provider).catch(() => {})
          }, 700)
        }
        return { success: true, chainId: chain.id }
      } catch (addErr: any) {
        const addCode = addErr?.code ?? addErr?.cause?.code
        const addMsg = String(addErr?.message || '')
        if (
          addCode === 4001 ||
          addMsg.includes('rejected') ||
          addMsg.includes('canceled') ||
          addMsg.includes('User rejected')
        ) {
          return {
            success: false,
            isCanceled: true,
            error: 'The network addition was canceled in the wallet.',
          }
        }
        const normalized = normalizeAppError(addErr)
        return {
          success: false,
          error: normalized.message || `Failed to add ${chain.name} to wallet.`,
        }
      }
    }

    const normalized = normalizeAppError(switchErr)
    return {
      success: false,
      error: normalized.message || `Failed to switch to ${chain.name}.`,
    }
  }
}

/**
 * Asserts that the wallet is on the specified network, throwing an Error if switching fails
 * or if verification fails.
 */
export async function assertNetwork(
  target: string | number | Chain,
  customProvider?: any
): Promise<void> {
  const chain = resolveChain(target)
  const res = await ensureNetwork(target, customProvider)
  if (!res.success) {
    const err: any = new Error(res.error || `Wallet is not connected to target network.`)
    if (res.isCanceled) {
      err.isCanceled = true
      err.code = 4001
      err.name = 'UserRejectedRequestError'
      err.isNetworkSwitchCanceled = true
    }
    throw err
  }

  // Double check active chain
  const provider = resolveProvider(customProvider)
  if (provider && chain) {
    try {
      const activeHex = await provider.request({ method: 'eth_chainId' })
      if (activeHex && parseInt(String(activeHex), 16) !== chain.id) {
        throw new Error(
          `Your wallet is not connected to ${chain.name} (Chain ID: ${chain.id}). Please switch the network in your wallet.`
        )
      }
    } catch (verifyErr: any) {
      if (verifyErr?.message?.includes('not connected to')) {
        throw verifyErr
      }
      // Verification ignored if provider doesn't support immediate eth_chainId check
    }
  }
}

/**
 * Ensures wallet is switched to the active Arc L1 network (Testnet or Mainnet according to environment).
 */
export async function ensureArcNetwork(customProvider?: any): Promise<ChainSwitchResult> {
  return ensureNetwork(arcActiveChain, customProvider)
}

/**
 * Backward compatible ensureChain function for existing callers (e.g. gatewayService, BridgeModal).
 */
export async function ensureChain(provider: any, chain: Chain): Promise<void> {
  await assertNetwork(chain, provider)
}
