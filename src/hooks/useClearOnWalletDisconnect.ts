// src/hooks/useClearOnWalletDisconnect.ts
// Reusable hook allowing components to register a cleanup function
// that executes whenever the user disconnects their wallet.

import { useEffect, useRef } from 'react'
import { WALLET_DISCONNECT_CLEAR_EVENT } from '../utils/inputClearer'

export function useClearOnWalletDisconnect(onClear: () => void): void {
  const onClearRef = useRef(onClear)

  useEffect(() => {
    onClearRef.current = onClear
  }, [onClear])

  useEffect(() => {
    const handleClear = () => {
      onClearRef.current?.()
    }

    window.addEventListener(WALLET_DISCONNECT_CLEAR_EVENT, handleClear)
    return () => {
      window.removeEventListener(WALLET_DISCONNECT_CLEAR_EVENT, handleClear)
    }
  }, [])
}
