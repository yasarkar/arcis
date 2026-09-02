// src/hooks/useMultiChainWallet.ts
// Custom hook to consume MultiChainWalletContext easily

import { useContext } from 'react'
import { MultiChainWalletContext } from '../context/MultiChainWalletContext'
import type { MultiChainWalletContextValue } from '../types/multiChainWallet'

export function useMultiChainWallet(): MultiChainWalletContextValue {
  const context = useContext(MultiChainWalletContext)
  if (!context) {
    throw new Error('useMultiChainWallet must be used within a MultiChainWalletProvider')
  }
  return context
}
