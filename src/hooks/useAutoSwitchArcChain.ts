// src/hooks/useAutoSwitchArcChain.ts
/**
 * Auto-switch hook for Arc L1.
 * Automatically prompts the user to switch their wallet to the active Arc network
 * upon initial connection, if on another chain.
 * Backed by the centralized chainSwitchService.
 */

import { useEffect, useRef, useCallback } from 'react'
import { useAccount } from 'wagmi'
import { arcTestnet, arcMainnet, arcActiveChain } from '../config/networks/networkRegistry'
import {
  ensureArcNetwork,
  buildAddEthereumChainParameter,
} from '../services/chainSwitchService'
import { useChainSwitch } from './useChainSwitch'

export const ARC_ACTIVE_CHAIN_ID = arcActiveChain.id
export const ARC_TESTNET_CHAIN_ID = arcTestnet.id
export const ARC_MAINNET_CHAIN_ID = arcMainnet.id
export const ARC_TESTNET_HEX_ID = `0x${arcTestnet.id.toString(16)}` as const
export const ARC_ACTIVE_HEX_ID = `0x${arcActiveChain.id.toString(16)}` as const

export const ARC_TESTNET_ADD_ETHEREUM_CHAIN_PARAMS = buildAddEthereumChainParameter(arcTestnet)
export const ARC_ACTIVE_ADD_ETHEREUM_CHAIN_PARAMS = buildAddEthereumChainParameter(arcActiveChain)

export function useAutoSwitchArcChain() {
  const { isConnected, chainId, connector } = useAccount()
  const { switchToArc } = useChainSwitch()
  const hasAttemptedThisSession = useRef<boolean>(false)

  // Trigger function to switch or add Arc network
  const handleSwitchToArc = useCallback(async (): Promise<{ success: boolean; error?: string }> => {
    if (!isConnected) {
      return { success: false, error: 'Wallet is not connected.' }
    }

    try {
      const provider = (await connector?.getProvider()) as any
      const res = await ensureArcNetwork(provider)
      return { success: res.success, error: res.error }
    } catch (err: any) {
      console.error('[useAutoSwitchArcChain] Switch error:', err)
      return { success: false, error: err?.message || 'Arc network switch failed.' }
    }
  }, [isConnected, connector])

  // Automatic one-shot trigger on initial wallet connection
  useEffect(() => {
    // Only trigger if wallet is connected and on a different EVM network
    if (!isConnected || chainId === arcActiveChain.id) return

    // Prevent repeated prompts in the current session
    if (hasAttemptedThisSession.current) return

    // Check if user already declined in this browser session
    const alreadyDeclined = sessionStorage.getItem('arcis_auto_switch_declined')
    if (alreadyDeclined === 'true') return

    hasAttemptedThisSession.current = true

    // Small delay to let wallet connection UI settle
    const timer = setTimeout(async () => {
      try {
        const res = await switchToArc()
        if (!res.success && res.isCanceled) {
          sessionStorage.setItem('arcis_auto_switch_declined', 'true')
        }
      } catch (e) {
        console.warn('[useAutoSwitchArcChain] Auto-switch notice:', e)
      }
    }, 600)

    return () => clearTimeout(timer)
  }, [isConnected, chainId, switchToArc])

  return {
    isWrongNetwork: Boolean(isConnected && chainId && chainId !== arcActiveChain.id),
    currentChainId: chainId,
    targetChainId: arcActiveChain.id,
    switchToArc: handleSwitchToArc,
    switchToArcTestnet: handleSwitchToArc, // Backward compatibility alias
  }
}
