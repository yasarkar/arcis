/**
 * Check whether an error was caused by the user rejecting/cancelling
 * the transaction in their crypto wallet (MetaMask, Rabby, Phantom, etc.).
 */
export function isUserRejected(err: any): boolean {
  if (!err) return false

  // Direct code checks
  if (
    err?.code === 4001 ||
    err?.code === 'ACTION_REJECTED' ||
    err?.name === 'UserRejectedRequestError' ||
    err?.cause?.code === 4001 ||
    err?.cause?.name === 'UserRejectedRequestError' ||
    err?.info?.error?.code === 4001
  ) {
    return true
  }

  const errorString = typeof err === 'string'
    ? err
    : (err.shortMessage || err.message || err.details || err.errorMessage || String(err))

  const lowMsg = errorString.toLowerCase()

  return (
    lowMsg.includes('user rejected') ||
    lowMsg.includes('user denied') ||
    lowMsg.includes('action_rejected') ||
    lowMsg.includes('rejected the request') ||
    lowMsg.includes('user cancelled') ||
    lowMsg.includes('user canceled') ||
    lowMsg.includes('transaction rejected') ||
    lowMsg.includes('transaction was rejected') ||
    lowMsg.includes('transaction was cancelled') ||
    lowMsg.includes('transaction was canceled') ||
    lowMsg.includes('declined') ||
    lowMsg.includes('disapproved') ||
    lowMsg.includes('user disapproved') ||
    lowMsg.includes('rejected by user') ||
    lowMsg.includes('cancelled by user') ||
    lowMsg.includes('canceled by user') ||
    lowMsg.includes('signature rejected') ||
    lowMsg.includes('denied request signature') ||
    lowMsg.includes('request rejected')
  )
}

export interface ParsedTransactionError {
  isRejected: boolean
  category: 'rejection' | 'gas' | 'balance' | 'slippage' | 'revert' | 'timeout' | 'network' | 'unknown'
  title: string
  message: string
  rawMessage: string
}

/**
 * Clean and human-friendly error formatter specifically optimized for Copilot & DeFi actions.
 * Filters out raw Viem stack traces, calldata dumps, and Request Arguments.
 */
export function formatCopilotError(err: any): { title: string; message: string; isRejected: boolean } {
  if (!err) {
    return {
      title: 'İşlem Başarısız Oldu',
      message: 'Beklenmeyen bir hata oluştu. Lütfen tekrar deneyin.',
      isRejected: false,
    }
  }

  const rawMessage = typeof err === 'string'
    ? err
    : (err.shortMessage || err.message || err.details || err.errorMessage || String(err))

  const lowMsg = rawMessage.toLowerCase()

  // 1. User Rejected / Cancelled in Wallet
  if (
    isUserRejected(err) ||
    lowMsg.includes('user rejected') ||
    lowMsg.includes('user denied') ||
    lowMsg.includes('rejected the request') ||
    lowMsg.includes('denied request signature')
  ) {
    return {
      title: 'Transaction rejected by user',
      message: 'You rejected the confirmation request in your wallet. No balance was deducted.',
      isRejected: true,
    }
  }

  // 2. Insufficient Gas / Balance on Arc Testnet
  if (
    lowMsg.includes('insufficient') ||
    lowMsg.includes('exceeds balance') ||
    lowMsg.includes('insufficient funds') ||
    lowMsg.includes('insufficient_gas') ||
    lowMsg.includes('yetersiz bakiye')
  ) {
    return {
      title: 'Yetersiz Bakiye',
      message: 'Arc L1 Testnet üzerinde işlem ve gas ücreti USDC olarak ödenir. Cüzdanınızda yeterli USDC bulunmuyor. Faucet üzerinden ücretsiz testnet USDC talep edebilirsiniz.',
      isRejected: false,
    }
  }

  // 3. Liquidity Route not found
  if (
    lowMsg.includes('no route') ||
    lowMsg.includes('route or resource not found') ||
    lowMsg.includes('input_amount_out_of_range') ||
    lowMsg.includes('liquidity limits') ||
    lowMsg.includes('no active swap route')
  ) {
    return {
      title: 'Likidite Rotası Bulunamadı',
      message: 'Bu token çifti veya belirtilen tutar için aktif bir testnet havuz rotası bulunamadı. Lütfen USDC ↔ EURC çiftini veya farklı bir tutar deneyin.',
      isRejected: false,
    }
  }

  // 4. Slippage Tolerance Exceeded
  if (lowMsg.includes('slippage') || lowMsg.includes('price impact') || lowMsg.includes('stoplimit')) {
    return {
      title: 'Slippage Toleransı Aşıldı',
      message: 'Fiyat kayma toleransı sınırı aşıldı. Lütfen daha yüksek bir tolerans ile yeniden deneyin.',
      isRejected: false,
    }
  }

  // 5. Smart contract revert
  if (lowMsg.includes('execution reverted') || lowMsg.includes('transaction reverted') || lowMsg.includes('revert')) {
    const reasonMatch = rawMessage.match(/reason:\s*([^\n\r]+)/i)
    const cleanReason = reasonMatch && reasonMatch[1] ? reasonMatch[1].trim() : 'Akıllı sözleşme işlemi reddetti.'
    return {
      title: 'İşlem Reddedildi',
      message: `Akıllı sözleşme kuralı: ${cleanReason}`,
      isRejected: false,
    }
  }

  // 6. Network Timeout / RPC Error
  if (lowMsg.includes('timeout') || lowMsg.includes('timed out') || lowMsg.includes('network') || lowMsg.includes('fetch failed')) {
    return {
      title: 'Ağ Bağlantı Hatası',
      message: 'Arc L1 RPC ağı zamanında yanıt veremedi. Lütfen internet bağlantınızı kontrol edip tekrar deneyin.',
      isRejected: false,
    }
  }

  // 7. General clean fallback (strip out "Request Arguments: ... Details: ... Version: viem")
  let cleanFallback = err.shortMessage || rawMessage
  if (cleanFallback.includes('Request Arguments:')) {
    cleanFallback = cleanFallback.split('Request Arguments:')[0].trim()
  }
  if (cleanFallback.includes('Details:')) {
    cleanFallback = cleanFallback.split('Details:')[0].trim()
  }
  if (cleanFallback.startsWith('Unknown blockchain error on Arc Testnet:')) {
    cleanFallback = cleanFallback.replace('Unknown blockchain error on Arc Testnet:', '').trim()
  }
  if (cleanFallback.length > 140) {
    cleanFallback = 'İşlem blokzincir üzerinde tamamlanamadı. Lütfen parametreleri kontrol edip tekrar deneyin.'
  }

  return {
    title: 'İşlem Başarısız Oldu',
    message: cleanFallback || 'İşlem tamamlanamadı. Lütfen parametreleri kontrol edin.',
    isRejected: false,
  }
}

/**
 * Parses and categorizes any Web3 / Viem / RPC error into structured English & Turkish texts.
 */
export function parseTransactionError(err: any): ParsedTransactionError {
  if (!err) {
    return {
      isRejected: false,
      category: 'unknown',
      title: 'Unknown Error',
      message: 'An unknown error occurred.',
      rawMessage: 'Unknown error',
    }
  }

  const clean = formatCopilotError(err)
  const rawMessage = typeof err === 'string'
    ? err
    : (err.shortMessage || err.message || err.details || err.errorMessage || String(err))

  return {
    isRejected: clean.isRejected,
    category: clean.isRejected ? 'rejection' : 'unknown',
    title: clean.title,
    message: clean.message,
    rawMessage,
  }
}

/**
 * Formats Viem / Web3 / RPC / Wallet errors into clean, user-friendly error messages.
 */
export function formatWalletError(err: any): string {
  const clean = formatCopilotError(err)
  return clean.message
}

