// src/context/MultiChainWalletContext.tsx
// Unified Context for managing Solana and Injective/Cosmos multi-chain wallet connections

import React, { createContext, useState, useEffect, useCallback, useMemo } from 'react'
import type {
  SolanaWalletProvider,
  SolanaWalletState,
  InjectiveWalletProvider,
  InjectiveWalletState,
  MultiChainWalletContextValue,
} from '../types/multiChainWallet'
// P03: the Solana/Injective wallet services load on demand (dynamic
// `import()`) so their parse/eval moves off the critical path. These modules
// only talk to injected `window` providers (no heavy SDK deps), so the win is
// small but free; stored sessions and user actions trigger the load and the
// UX is unchanged. The storage helpers stay statically imported because the
// initial state read needs them synchronously.
import {
  getStoredSolanaWallet,
  clearStoredSolanaWallet,
} from '../services/solanaWalletService'
import {
  getStoredInjectiveWallet,
  clearStoredInjectiveWallet,
} from '../services/injectiveWalletService'

const loadSolanaService = () => import('../services/solanaWalletService')
const loadInjectiveService = () => import('../services/injectiveWalletService')
import { clearAllAppInputs } from '../utils/inputClearer'

export const MultiChainWalletContext = createContext<MultiChainWalletContextValue | null>(null)

export const MultiChainWalletProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  // ─────────────────────────────────────────────────────────────
  // 1. SOLANA STATE
  // ─────────────────────────────────────────────────────────────
  const [solana, setSolana] = useState<SolanaWalletState>(() => {
    const stored = getStoredSolanaWallet()
    return {
      isConnected: Boolean(stored?.address),
      address: stored?.address || '',
      providerName: stored?.provider || 'phantom',
      isConnecting: false,
      error: null,
    }
  })

  // ─────────────────────────────────────────────────────────────
  // 2. INJECTIVE STATE
  // ─────────────────────────────────────────────────────────────
  const [injective, setInjective] = useState<InjectiveWalletState>(() => {
    const stored = getStoredInjectiveWallet()
    return {
      isConnected: Boolean(stored?.address),
      address: stored?.address || '',
      providerName: stored?.provider || 'keplr',
      isConnecting: false,
      error: null,
    }
  })

  // ─────────────────────────────────────────────────────────────
  // 3. AUTO-RECONNECT ON MOUNT & EVENT LISTENERS
  // ─────────────────────────────────────────────────────────────
  useEffect(() => {
    let mounted = true

    // Re-verify Solana connection silently if stored (service loads on demand)
    const storedSol = getStoredSolanaWallet()
    if (storedSol?.address) {
      loadSolanaService()
        .then(({ connectSolanaWallet }) => connectSolanaWallet(storedSol.provider, true))
        .then((res) => {
          if (!mounted) return
          if (res.success && res.address) {
            setSolana((prev) => ({
              ...prev,
              isConnected: true,
              address: res.address!,
              providerName: storedSol.provider,
            }))
          }
        })
        .catch(() => {
          // ignore silent fail
        })
    }

    // Set up Solana account changed listener (after the service loads)
    let solProvider: any = null
    const handleSolAccountChange = (publicKey: any) => {
      if (!mounted) return
      if (publicKey) {
        const newAddr = publicKey.toString ? publicKey.toString() : String(publicKey)
        setSolana((prev) => ({ ...prev, isConnected: true, address: newAddr }))
      } else {
        clearStoredSolanaWallet()
        setSolana((prev) => ({ ...prev, isConnected: false, address: '', error: null }))
      }
    }

    const handleSolDisconnect = () => {
      if (!mounted) return
      clearStoredSolanaWallet()
      setSolana((prev) => ({ ...prev, isConnected: false, address: '', error: null }))
    }

    loadSolanaService()
      .then(({ getSolanaProvider }) => {
        if (!mounted) return
        solProvider = getSolanaProvider(solana.providerName)
        if (solProvider && typeof solProvider.on === 'function') {
          solProvider.on('accountChanged', handleSolAccountChange)
          solProvider.on('disconnect', handleSolDisconnect)
        }
      })
      .catch(() => {
        // Listener setup is best-effort; explicit actions load the service.
      })

    // Set up Keplr keystore change listener
    const handleKeplrKeystoreChange = () => {
      const storedInj = getStoredInjectiveWallet()
      if (storedInj?.provider) {
        loadInjectiveService()
          .then(({ connectInjectiveWallet }) => connectInjectiveWallet(storedInj.provider))
          .then((res) => {
            if (!mounted) return
            if (res.success && res.address) {
              setInjective((prev) => ({ ...prev, isConnected: true, address: res.address! }))
            }
          })
          .catch(() => {
            // ignore silent fail
          })
      }
    }

    if (typeof window !== 'undefined') {
      window.addEventListener('keplr_keystorechange', handleKeplrKeystoreChange)
    }

    return () => {
      mounted = false
      if (solProvider && typeof solProvider.removeListener === 'function') {
        solProvider.removeListener('accountChanged', handleSolAccountChange)
        solProvider.removeListener('disconnect', handleSolDisconnect)
      }
      if (typeof window !== 'undefined') {
        window.removeEventListener('keplr_keystorechange', handleKeplrKeystoreChange)
      }
    }
  }, [solana.providerName])

  // ─────────────────────────────────────────────────────────────
  // 4. SOLANA ACTIONS
  // ─────────────────────────────────────────────────────────────
  const connectSolana = useCallback(async (provider: SolanaWalletProvider) => {
    setSolana((prev) => ({ ...prev, isConnecting: true, error: null }))
    const { connectSolanaWallet } = await loadSolanaService()
    const res = await connectSolanaWallet(provider)
    if (res.success && res.address) {
      setSolana({
        isConnected: true,
        address: res.address,
        providerName: provider,
        isConnecting: false,
        error: null,
      })
      return res
    } else {
      const err = res.error || 'Solana wallet connection failed.'
      setSolana((prev) => ({
        ...prev,
        isConnecting: false,
        error: err,
      }))
      return { success: false, error: err }
    }
  }, [])

  const disconnectSolana = useCallback(() => {
    // Fire-and-forget: storage cleanup below runs regardless of service load.
    loadSolanaService()
      .then(({ disconnectSolanaWallet }) => disconnectSolanaWallet(solana.providerName))
      .catch(() => {
        // ignore — local state is still cleared below
      })
    setSolana({
      isConnected: false,
      address: '',
      providerName: 'phantom',
      isConnecting: false,
      error: null,
    })
    clearAllAppInputs()
  }, [solana.providerName])

  const isSolanaInstalled = useCallback(async (provider: SolanaWalletProvider) => {
    const { isSolanaWalletInstalled } = await loadSolanaService()
    return isSolanaWalletInstalled(provider)
  }, [])

  // ─────────────────────────────────────────────────────────────
  // 5. INJECTIVE ACTIONS
  // ─────────────────────────────────────────────────────────────
  const connectInjective = useCallback(async (provider: InjectiveWalletProvider) => {
    setInjective((prev) => ({ ...prev, isConnecting: true, error: null }))
    const { connectInjectiveWallet } = await loadInjectiveService()
    const res = await connectInjectiveWallet(provider)
    if (res.success && res.address) {
      setInjective({
        isConnected: true,
        address: res.address,
        providerName: provider,
        isConnecting: false,
        error: null,
      })
      return res
    } else {
      const err = res.error || 'Injective wallet connection failed.'
      setInjective((prev) => ({
        ...prev,
        isConnecting: false,
        error: err,
      }))
      return { success: false, error: err }
    }
  }, [])

  const disconnectInjective = useCallback(() => {
    // Fire-and-forget: storage cleanup below runs regardless of service load.
    loadInjectiveService()
      .then(({ disconnectInjectiveWallet }) => disconnectInjectiveWallet())
      .catch(() => {
        // ignore — local state is still cleared below
      })
    setInjective({
      isConnected: false,
      address: '',
      providerName: 'keplr',
      isConnecting: false,
      error: null,
    })
    clearAllAppInputs()
  }, [])

  const isInjectiveInstalled = useCallback(async (provider: InjectiveWalletProvider) => {
    const { isInjectiveWalletInstalled } = await loadInjectiveService()
    return isInjectiveWalletInstalled(provider)
  }, [])

  // ─────────────────────────────────────────────────────────────
  // 6. DISCONNECT ALL NON-EVM
  // ─────────────────────────────────────────────────────────────
  const disconnectAllNonEvm = useCallback(() => {
    disconnectSolana()
    disconnectInjective()
    clearAllAppInputs()
  }, [disconnectSolana, disconnectInjective])

  // P08: the provider value is memoized so unrelated App re-renders (price
  // ticks, copilot state, tab switches) don't re-render every context consumer.
  // All actions are `useCallback`-stable; only solana/injective state changes
  // produce a new value.
  const contextValue = useMemo<MultiChainWalletContextValue>(
    () => ({
      solana,
      connectSolana,
      disconnectSolana,
      isSolanaInstalled,
      injective,
      connectInjective,
      disconnectInjective,
      isInjectiveInstalled,
      disconnectAllNonEvm,
    }),
    [
      solana,
      connectSolana,
      disconnectSolana,
      isSolanaInstalled,
      injective,
      connectInjective,
      disconnectInjective,
      isInjectiveInstalled,
      disconnectAllNonEvm,
    ]
  )

  return (
    <MultiChainWalletContext.Provider value={contextValue}>
      {children}
    </MultiChainWalletContext.Provider>
  )
}
