import React from 'react'
import { Zap, Wallet } from 'lucide-react'
import { getChainDisplayName } from '../../config/bridgeConfig'

interface BridgeGatewayHelperProps {
  bridgeMode: 'direct' | 'gateway'
  isInsufficient: boolean
  sourceWalletBalance: string
  sourceChain: string
  onSwitchToDirect: () => void
}

export const BridgeGatewayHelper: React.FC<BridgeGatewayHelperProps> = ({
  bridgeMode,
  isInsufficient,
  sourceWalletBalance,
  sourceChain,
  onSwitchToDirect,
}) => {
  if (
    bridgeMode !== 'gateway' ||
    !isInsufficient ||
    parseFloat(sourceWalletBalance) <= 0
  ) {
    return null
  }

  return (
    <div className="text-[11px] text-indigo-300 bg-indigo-500/10 border border-indigo-500/25 rounded-xl p-3 flex items-start gap-2.5 animate-fade-in">
      <Zap className="w-4 h-4 text-indigo-400 shrink-0 mt-0.5" />
      <div className="flex-1 space-y-1.5">
        <p className="leading-relaxed">
          Your Gateway unified balance on {getChainDisplayName(sourceChain)} is insufficient, but you hold <strong>{sourceWalletBalance} USDC</strong> in your wallet.
        </p>
        <button
          type="button"
          onClick={onSwitchToDirect}
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-indigo-300 hover:text-white bg-indigo-500/20 hover:bg-indigo-500/35 border border-indigo-500/30 px-2.5 py-1 rounded-lg transition-colors cursor-pointer"
        >
          <Wallet className="w-3.5 h-3.5" />
          <span>Switch to Direct CCTP</span>
        </button>
      </div>
    </div>
  )
}
