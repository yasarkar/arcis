import React from 'react'
import { AlertTriangle } from 'lucide-react'

interface BridgeLegacyWethBannerProps {
  sourceChain: string
  legacyWethBalance?: string
  isUnwrapping: boolean
  disabled?: boolean
  onUnwrap: () => void
}

export const BridgeLegacyWethBanner: React.FC<BridgeLegacyWethBannerProps> = ({
  sourceChain,
  legacyWethBalance,
  isUnwrapping,
  disabled = false,
  onUnwrap,
}) => {
  if (
    sourceChain !== 'Ethereum_Sepolia' ||
    !legacyWethBalance ||
    parseFloat(legacyWethBalance) <= 0
  ) {
    return null
  }

  return (
    <div className="p-3 rounded-2xl border bg-amber-500/10 border-amber-500/25 text-amber-300 text-xs flex items-center justify-between gap-3 animate-fade-in">
      <div className="flex items-center gap-2 min-w-0">
        <AlertTriangle className="w-4 h-4 shrink-0 text-amber-400" />
        <div className="min-w-0">
          <p className="font-semibold text-amber-200">
            Legacy Sepolia WETH ({legacyWethBalance} WETH)
          </p>
          <p className="text-[11px] text-amber-300/80 truncate">
            CCTP-X routes via official Sepolia WETH (0xfff9...). Unwrap legacy token back to ETH to bridge.
          </p>
        </div>
      </div>
      <button
        type="button"
        disabled={isUnwrapping || disabled}
        onClick={onUnwrap}
        className="px-3 py-1.5 rounded-xl font-medium text-xs bg-amber-500/20 hover:bg-amber-500/30 text-amber-200 border border-amber-500/30 transition shrink-0 disabled:opacity-50 cursor-pointer"
      >
        {isUnwrapping ? 'Unwrapping...' : 'Unwrap to ETH'}
      </button>
    </div>
  )
}
