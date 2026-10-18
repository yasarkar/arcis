import React from 'react'
import { ChevronDown } from 'lucide-react'
import { ChainIcon } from '../common/ChainIcon'
import { DirectionSwitchButton } from '../fintech'
import { getChainDisplayName } from '../../config/bridgeConfig'

interface BridgeRouteSelectorProps {
  sourceChain: string
  destChain: string
  onOpenSourceModal: () => void
  onOpenDestModal: () => void
  onSwapChains: () => void
  disabled?: boolean
}

export const BridgeRouteSelector: React.FC<BridgeRouteSelectorProps> = ({
  sourceChain,
  destChain,
  onOpenSourceModal,
  onOpenDestModal,
  onSwapChains,
  disabled = false,
}) => {
  return (
    <div className="bg-[#121626]/85 border border-white/[0.06] rounded-2xl p-3.5 sm:p-4 flex items-center justify-between gap-2.5 sm:gap-3">
      {/* Source Network */}
      <div className="flex-1 min-w-0">
        <div
          className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-1.5 ml-1"
          style={{ fontFamily: 'var(--font-app)' }}
        >
          FROM NETWORK
        </div>
        <button
          type="button"
          disabled={disabled}
          onClick={onOpenSourceModal}
          className="w-full flex items-center justify-between gap-2 px-3 py-2.5 rounded-xl bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.08] hover:border-indigo-500/40 transition-all cursor-pointer select-none text-left"
        >
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-5 h-5 rounded-full overflow-hidden flex items-center justify-center shrink-0">
              <ChainIcon
                chainKeyOrIconId={sourceChain}
                name={getChainDisplayName(sourceChain)}
                size={20}
                className="rounded-full"
              />
            </div>
            <span className="text-xs font-semibold text-white truncate">
              {getChainDisplayName(sourceChain)}
            </span>
          </div>
          <ChevronDown className="w-3.5 h-3.5 text-slate-400 shrink-0" />
        </button>
      </div>

      {/* Invert Route Button */}
      <div className="pt-5 shrink-0">
        <DirectionSwitchButton
          onClick={onSwapChains}
          disabled={disabled}
          orientation="horizontal"
        />
      </div>

      {/* Destination Network */}
      <div className="flex-1 min-w-0">
        <div
          className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-1.5 ml-1"
          style={{ fontFamily: 'var(--font-app)' }}
        >
          TO NETWORK
        </div>
        <button
          type="button"
          disabled={disabled}
          onClick={onOpenDestModal}
          className="w-full flex items-center justify-between gap-2 px-3 py-2.5 rounded-xl bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.08] hover:border-indigo-500/40 transition-all cursor-pointer select-none text-left"
        >
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-5 h-5 rounded-full overflow-hidden flex items-center justify-center shrink-0">
              <ChainIcon
                chainKeyOrIconId={destChain}
                name={getChainDisplayName(destChain)}
                size={20}
                className="rounded-full"
              />
            </div>
            <span className="text-xs font-semibold text-white truncate">
              {getChainDisplayName(destChain)}
            </span>
          </div>
          <ChevronDown className="w-3.5 h-3.5 text-slate-400 shrink-0" />
        </button>
      </div>
    </div>
  )
}
