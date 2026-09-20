// src/hooks/useChainSwitch.ts
/**
 * React hook for centralized chain switching across the application.
 * Integrates Wagmi account connector with chainSwitchService and Broadcast notifications.
 */

import { useState, useCallback } from 'react'
import { useAccount, useSwitchChain } from 'wagmi'
import type { Chain } from 'viem'
import {
  ensureNetwork,
  ensureArcNetwork,
  resolveChain,
  type ChainSwitchResult,
} from '../services/chainSwitchService'
import { arcActiveChain } from '../config/networks/networkRegistry'

export function useChainSwitch() {
  const { isConnected, chainId, connector } = useAccount()
  const { switchChainAsync } = useSwitchChain()
  const [isSwitching, setIsSwitching] = useState(false)

  const isArcActive = Boolean(isConnected && chainId === arcActiveChain.id)

  const switchToChain = useCallback(
    async (target: string | number | Chain): Promise<ChainSwitchResult> => {
      if (!isConnected) {
        return { success: false, error: 'Wallet is not connected.' }
      }

      setIsSwitching(true)
      try {
        const chain = resolveChain(target)
        if (!chain) {
          return { success: false, error: `Unrecognized network "${String(target)}".` }
        }

        // Try wagmi switchChainAsync first if connector supports it
        let switched = false
        try {
          await switchChainAsync({ chainId: chain.id })
          switched = true
        } catch (wagmiErr: any) {
          const code = wagmiErr?.code ?? wagmiErr?.cause?.code
          const msg = String(wagmiErr?.message || '')

          if (code === 4001 || msg.includes('rejected') || msg.includes('canceled')) {
            return {
              success: false,
              isCanceled: true,
              error: 'Network switch canceled by user.',
            }
          }
          // If already pending, delegate to ensureNetwork which polls for resolution
          // If wagmi fails (e.g. chain not added or provider specific), fall through to chainSwitchService
        }

        if (!switched) {
          const provider = (await connector?.getProvider()) as any
          const result = await ensureNetwork(chain, provider)
          if (!result.success) {
            return result
          }
        }

        return { success: true, chainId: chain.id }
      } catch (err: any) {
        const msg = err?.message || 'Failed to switch network.'
        return { success: false, error: msg }
      } finally {
        setIsSwitching(false)
      }
    },
    [isConnected, connector, switchChainAsync]
  )

  const switchToArc = useCallback(async (): Promise<ChainSwitchResult> => {
    return switchToChain(arcActiveChain)
  }, [switchToChain])

  return {
    isConnected,
    currentChainId: chainId,
    isArcActive,
    isSwitching,
    arcActiveChain,
    switchToChain,
    switchToArc,
  }
}
