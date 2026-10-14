import { useState, useEffect, useCallback } from 'react'
import {
  getSavedRecipients,
  saveRecipient as persistRecipient,
  removeSavedRecipient as deleteRecipient,
  clearAllSavedRecipients as clearRecipients,
  RECENT_RECIPIENTS_UPDATED_EVENT,
  type ChainFamily,
  type SavedRecipient,
} from '../utils/recentRecipients'

export function useRecentRecipients(
  chainFamily: ChainFamily = 'all',
  excludeAddress?: string
) {
  const [recipients, setRecipients] = useState<SavedRecipient[]>(() =>
    getSavedRecipients(chainFamily, excludeAddress)
  )

  const refresh = useCallback(() => {
    setRecipients(getSavedRecipients(chainFamily, excludeAddress))
  }, [chainFamily, excludeAddress])

  useEffect(() => {
    refresh()
    if (typeof window === 'undefined') return

    const handleUpdate = () => refresh()
    window.addEventListener(RECENT_RECIPIENTS_UPDATED_EVENT, handleUpdate)
    window.addEventListener('storage', handleUpdate)
    return () => {
      window.removeEventListener(RECENT_RECIPIENTS_UPDATED_EVENT, handleUpdate)
      window.removeEventListener('storage', handleUpdate)
    }
  }, [refresh])

  const save = useCallback(
    (input: {
      address: string
      chainFamily?: 'evm' | 'solana' | 'injective'
      label?: string
      sourceChain?: string
    }) => {
      const updated = persistRecipient(input)
      refresh()
      return updated
    },
    [refresh]
  )

  const remove = useCallback(
    (address: string) => {
      const updated = deleteRecipient(address)
      refresh()
      return updated
    },
    [refresh]
  )

  const clearAll = useCallback(() => {
    clearRecipients()
    refresh()
  }, [refresh])

  return {
    recipients,
    save,
    remove,
    clearAll,
    refresh,
  }
}
