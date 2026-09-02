// src/hooks/useModularWallet.ts
// React Hook for Circle Modular Wallets with WebAuthn Passkey Authentication

import { useState, useEffect, useCallback } from 'react'
import {
  getStoredCredential,
  getStoredMscaAddress,
  getStoredUsername,
  registerPasskey,
  loginPasskey,
  restoreSmartAccount,
  clearStoredCredential,
  sendModularUserOperation,
  type UserOpCall,
} from '../services/modularWalletService'
import { checkPasskeySupport } from '../utils/passkeyErrorUtils'

export interface ModularWalletState {
  isPasskeyConnected: boolean
  isSupported: boolean
  supportReason?: string
  mscaAddress: string
  username: string
  isLoading: boolean
  isRestoring: boolean
  hasStoredCredential: boolean
  error: string | null
  register: (username: string) => Promise<{ success: boolean; address?: string; error?: string }>
  login: () => Promise<{ success: boolean; address?: string; error?: string }>
  disconnect: () => void
  sendUserOp: (calls: UserOpCall[]) => Promise<{ success: boolean; txHash?: string; error?: string }>
}

export function useModularWallet(): ModularWalletState {
  const support = checkPasskeySupport()
  const [mscaAddress, setMscaAddress] = useState<string>(() => getStoredMscaAddress())
  const [username, setUsername] = useState<string>(() => getStoredUsername())
  const [isLoading, setIsLoading] = useState<boolean>(false)
  const [isRestoring, setIsRestoring] = useState<boolean>(() => Boolean(getStoredCredential() && getStoredMscaAddress()))
  const [error, setError] = useState<string | null>(null)

  // Auto-restore active account on mount
  useEffect(() => {
    let isMounted = true
    async function init() {
      const storedCred = getStoredCredential()
      const storedAddr = getStoredMscaAddress()
      if (storedCred && storedAddr) {
        try {
          const account = await restoreSmartAccount()
          if (isMounted && account?.address) {
            setMscaAddress(account.address)
          }
        } catch (e) {
          console.error('[useModularWallet] Auto-restore error:', e)
        }
      }
      if (isMounted) setIsRestoring(false)
    }
    init()
    return () => {
      isMounted = false
    }
  }, [])

  // Register with new Passkey
  const register = useCallback(async (nameInput: string) => {
    setIsLoading(true)
    setError(null)
    try {
      const res = await registerPasskey(nameInput)
      if (res.success && res.smartAccountAddress) {
        setMscaAddress(res.smartAccountAddress)
        setUsername(nameInput)
        setIsLoading(false)
        return { success: true, address: res.smartAccountAddress }
      } else {
        const err = res.error || 'Passkey kaydı başarısız oldu.'
        setError(err)
        setIsLoading(false)
        return { success: false, error: err }
      }
    } catch (err: any) {
      const errMsg = err.message || 'Passkey kaydı sırasında beklenmeyen bir hata oluştu.'
      setError(errMsg)
      setIsLoading(false)
      return { success: false, error: errMsg }
    }
  }, [])

  // Login with existing Passkey
  const login = useCallback(async () => {
    setIsLoading(true)
    setError(null)
    try {
      const res = await loginPasskey()
      if (res.success && res.smartAccountAddress) {
        setMscaAddress(res.smartAccountAddress)
        setUsername(getStoredUsername() || 'Passkey User')
        setIsLoading(false)
        return { success: true, address: res.smartAccountAddress }
      } else {
        const err = res.error || 'Passkey girişi başarısız oldu.'
        setError(err)
        setIsLoading(false)
        return { success: false, error: err }
      }
    } catch (err: any) {
      const errMsg = err.message || 'Passkey girişi sırasında hata oluştu.'
      setError(errMsg)
      setIsLoading(false)
      return { success: false, error: errMsg }
    }
  }, [])

  // Disconnect Passkey MSCA
  const disconnect = useCallback(() => {
    clearStoredCredential()
    setMscaAddress('')
    setUsername('')
    setError(null)
  }, [])

  // Send UserOperation via Modular Bundler
  const sendUserOp = useCallback(async (calls: UserOpCall[]) => {
    setIsLoading(true)
    setError(null)
    try {
      const res = await sendModularUserOperation({ calls, paymaster: true })
      setIsLoading(false)
      if (res.success) {
        return { success: true, txHash: res.txHash }
      } else {
        setError(res.error || 'İşlem yürütülemedi.')
        return { success: false, error: res.error }
      }
    } catch (err: any) {
      const errMsg = err.message || 'İşlem gönderilirken hata oluştu.'
      setError(errMsg)
      setIsLoading(false)
      return { success: false, error: errMsg }
    }
  }, [])

  return {
    isPasskeyConnected: Boolean(mscaAddress),
    isSupported: support.isSupported,
    supportReason: support.reason,
    mscaAddress,
    username,
    isLoading,
    isRestoring,
    hasStoredCredential: Boolean(getStoredCredential()),
    error,
    register,
    login,
    disconnect,
    sendUserOp,
  }
}
