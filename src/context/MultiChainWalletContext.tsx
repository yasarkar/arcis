// src/context/MultiChainWalletContext.tsx
// Unified Context for managing Solana and Injective/Cosmos multi-chain wallet connections

import React, { createContext, useState, useEffect, useCallback } from 'react'
import type {
  SolanaWalletProvider,
  SolanaWalletState,
  InjectiveWalletProvider,
  InjectiveWalletState,
  MultiChainWalletContextValue,
} from '../types/multiChainWallet'
import {
  connectSolanaWallet,
  disconnectSolanaWallet,
  getSolanaProvider,
  getStoredSolanaWallet,
  isSolanaWalletInstalled,
  clearStoredSolanaWallet,
} from '../services/solanaWalletService'
import {
  connectInjectiveWallet,
  disconnectInjectiveWallet,
  getStoredInjectiveWallet,
  isInjectiveWalletInstalled,
  clearStoredInjectiveWallet,
} from '../services/injectiveWalletService'

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

    // Re-verify Solana connection silently if stored
    const storedSol = getStoredSolanaWallet()
    if (storedSol?.address) {
      connectSolanaWallet(storedSol.provider, true)
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

    // Set up Solana account changed listener
    const solProvider = getSolanaProvider(solana.providerName)
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

    if (solProvider && typeof solProvider.on === 'function') {
      solProvider.on('accountChanged', handleSolAccountChange)
      solProvider.on('disconnect', handleSolDisconnect)
    }

    // Set up Keplr keystore change listener
    const handleKeplrKeystoreChange = () => {
      const storedInj = getStoredInjectiveWallet()
      if (storedInj?.provider) {
        connectInjectiveWallet(storedInj.provider).then((res) => {
          if (!mounted) return
          if (res.success && res.address) {
            setInjective((prev) => ({ ...prev, isConnected: true, address: res.address! }))
          }
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
      const err = res.error || 'Solana bağlantısı başarısız oldu.'
      setSolana((prev) => ({
        ...prev,
        isConnecting: false,
        error: err,
      }))
      return { success: false, error: err }
    }
  }, [])

  const disconnectSolana = useCallback(() => {
    disconnectSolanaWallet(solana.providerName)
    setSolana({
      isConnected: false,
      address: '',
      providerName: 'phantom',
      isConnecting: false,
      error: null,
    })
  }, [solana.providerName])

  const isSolanaInstalled = useCallback((provider: SolanaWalletProvider) => {
    return isSolanaWalletInstalled(provider)
  }, [])

  // ─────────────────────────────────────────────────────────────
  // 5. INJECTIVE ACTIONS
  // ─────────────────────────────────────────────────────────────
  const connectInjective = useCallback(async (provider: InjectiveWalletProvider) => {
    setInjective((prev) => ({ ...prev, isConnecting: true, error: null }))
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
      const err = res.error || 'Injective bağlantısı başarısız oldu.'
      setInjective((prev) => ({
        ...prev,
        isConnecting: false,
        error: err,
      }))
      return { success: false, error: err }
    }
  }, [])

  const disconnectInjective = useCallback(() => {
    disconnectInjectiveWallet()
    setInjective({
      isConnected: false,
      address: '',
      providerName: 'keplr',
      isConnecting: false,
      error: null,
    })
  }, [])

  const isInjectiveInstalled = useCallback((provider: InjectiveWalletProvider) => {
    return isInjectiveWalletInstalled(provider)
  }, [])

  // ─────────────────────────────────────────────────────────────
  // 6. DISCONNECT ALL NON-EVM
  // ─────────────────────────────────────────────────────────────
  const disconnectAllNonEvm = useCallback(() => {
    disconnectSolana()
    disconnectInjective()
  }, [disconnectSolana, disconnectInjective])

  return (
    <MultiChainWalletContext.Provider
      value={{
        solana,
        connectSolana,
        disconnectSolana,
        isSolanaInstalled,
        injective,
        connectInjective,
        disconnectInjective,
        isInjectiveInstalled,
        disconnectAllNonEvm,
      }}
    >
      {children}
    </MultiChainWalletContext.Provider>
  )
}
