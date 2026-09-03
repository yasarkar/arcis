import { useEffect, useRef, useCallback } from 'react'
import { useAccount, useSwitchChain } from 'wagmi'
import { arcTestnet } from '../config/arcChain'
import { useBroadcast } from '../components/BroadcastNotification'

export const ARC_TESTNET_CHAIN_ID = arcTestnet.id
export const ARC_TESTNET_HEX_ID = `0x${arcTestnet.id.toString(16)}` as const

export const ARC_TESTNET_ADD_ETHEREUM_CHAIN_PARAMS = {
  chainId: ARC_TESTNET_HEX_ID,
  chainName: arcTestnet.name,
  nativeCurrency: arcTestnet.nativeCurrency,
  rpcUrls: arcTestnet.rpcUrls.default.http,
  blockExplorerUrls: arcTestnet.blockExplorers?.default?.url,
}

export function useAutoSwitchArcChain() {
  const { isConnected, chainId, connector } = useAccount()
  const { switchChainAsync } = useSwitchChain()
  const { addBroadcast } = useBroadcast()
  const hasAttemptedThisSession = useRef<boolean>(false)

  // Manual trigger function to switch/add Arc Testnet
  const switchToArcTestnet = useCallback(async (): Promise<{ success: boolean; error?: string }> => {
    try {
      if (!isConnected) {
        return { success: false, error: 'Wallet is not connected.' }
      }

      // Try Wagmi standard switch first
      try {
        await switchChainAsync({ chainId: ARC_TESTNET_CHAIN_ID })
        addBroadcast({
          status: 'success',
          title: 'Arc Testnet Switched',
          message: 'Your wallet has been successfully switched to the Arc Testnet network.',
          badgeText: 'Arc L1',
        })
        return { success: true }
      } catch (switchErr: any) {
        const errCode = switchErr?.code || switchErr?.cause?.code
        const errMsg = switchErr?.message || ''

        // 4902 means the chain has not been added to the wallet yet
        if (errCode === 4902 || errMsg.includes('Unrecognized chain') || errMsg.includes('wallet_addEthereumChain')) {
          const provider = (await connector?.getProvider()) as any
          if (provider && typeof provider.request === 'function') {
            await provider.request({
              method: 'wallet_addEthereumChain',
              params: [ARC_TESTNET_ADD_ETHEREUM_CHAIN_PARAMS],
            })
            addBroadcast({
              status: 'success',
              title: 'Arc Testnet Added to Wallet',
              message: 'Arc Testnet network has been added to your wallet and selected as the active network.',
              badgeText: 'Arc L1',
            })
            return { success: true }
          }
        }

        // 4001 means user rejected the prompt
        if (errCode === 4001 || errMsg.includes('rejected') || errMsg.includes('User rejected')) {
          return { success: false, error: 'The network switch request was rejected in the wallet.' }
        }

        throw switchErr
      }
    } catch (err: any) {
      console.error('[useAutoSwitchArcChain] Switch error:', err)
      const msg = err?.message || 'Arc Testnet switch failed.'
      return { success: false, error: msg }
    }
  }, [isConnected, switchChainAsync, connector, addBroadcast])

  // Automatic one-shot trigger on initial wallet connection
  useEffect(() => {
    // Only trigger if wallet is connected and on a different EVM network
    if (!isConnected || chainId === ARC_TESTNET_CHAIN_ID) return

    // Prevent annoying infinite popup loops in the current session
    if (hasAttemptedThisSession.current) return

    // Check if user already declined in this browser tab
    const alreadyDeclined = sessionStorage.getItem('arcis_auto_switch_declined')
    if (alreadyDeclined === 'true') return

    hasAttemptedThisSession.current = true

    // Small delay to let wallet connection UI settle
    const timer = setTimeout(async () => {
      try {
        const res = await switchToArcTestnet()
        if (!res.success && res.error?.includes('iptal')) {
          sessionStorage.setItem('arcis_auto_switch_declined', 'true')
        }
      } catch (e) {
        console.warn('[useAutoSwitchArcChain] Auto-switch notice:', e)
      }
    }, 600)

    return () => clearTimeout(timer)
  }, [isConnected, chainId, switchToArcTestnet])

  return {
    isWrongNetwork: Boolean(isConnected && chainId && chainId !== ARC_TESTNET_CHAIN_ID),
    currentChainId: chainId,
    targetChainId: ARC_TESTNET_CHAIN_ID,
    switchToArcTestnet,
  }
}
