import React from 'react'
import { ChevronDown, ArrowRightLeft, ArrowUpRight, Globe } from 'lucide-react'
import { ChainIcon } from '../common/ChainIcon'
import { PinnedNetworkIcon, PinnedTokenIcon } from '../common/PinnedIcons'
import { getChainDisplayName, getChainIconId } from '../../config/chainMeta'
import { EURC_ADDRESSES, CIRBTC_ADDRESSES, WETH_ADDRESSES } from '../../config/gatewayConfig'
import { UsdcIcon, EurcIcon, CirBtcIcon, PhrsIcon } from '../../config/tokenIcons'
import { formatFiatEstimate } from '../../hooks/useLiveTokenPrices'
import { getNativeGasPrice, type ChainBalanceItem } from '../../services/portfolio'

interface PortfolioChainCardProps {
  chainKey: string
  chainData?: ChainBalanceItem
  isExpanded: boolean
  onToggle: () => void
  chainTotalUsd: number
  prices?: Record<string, number> | null
  hideBalances: boolean
  onNavigateToTab?: (tab: string, chainKey?: string) => void
  onClose: () => void
}

export function PortfolioChainCard({
  chainKey,
  chainData,
  isExpanded,
  onToggle,
  chainTotalUsd,
  prices,
  hideBalances,
  onNavigateToTab,
  onClose,
}: PortfolioChainCardProps) {
  const chainName = chainData?.chainName || getChainDisplayName(chainKey)
  const iconId = getChainIconId(chainKey)
  const isArc = chainKey === 'Arc_Testnet' || chainKey === 'Arc'

  const hasEurc = Boolean(EURC_ADDRESSES[chainKey])
  const hasCirbtc = Boolean(CIRBTC_ADDRESSES[chainKey])
  const hasWeth = Boolean(WETH_ADDRESSES[chainKey])

  const usdcAmount = chainData?.usdc || '0.00'
  const eurcAmount = chainData?.eurc || (hasEurc ? '0.00' : undefined)
  const cirbtcAmount = chainData?.cirbtc || (hasCirbtc ? '0.00000' : undefined)
  const wethAmount = chainData?.weth || (hasWeth ? '0.0000' : undefined)
  const nativeAmount = chainData?.nativeAmount || '0.0000'
  const nativeSymbol = chainData?.nativeSymbol || (isArc ? 'USDC' : 'ETH')

  return (
    <div
      onClick={onToggle}
      className={`group relative rounded-2xl transition-all duration-300 border cursor-pointer select-none overflow-hidden ${
        isExpanded
          ? 'bg-white/[0.07] border-white/20 shadow-lg'
          : 'bg-white/[0.03] border-white/[0.06] hover:bg-white/[0.05] hover:border-white/10'
      }`}
    >
      {/* Primary Chain Row */}
      <div className="p-3.5 flex items-center justify-between">
        {/* Left: Chain Icon & Name */}
        <div className="flex items-center gap-3 min-w-0">
          <div className="relative w-10 h-10 rounded-2xl flex items-center justify-center shrink-0 group-hover:scale-105 transition-transform overflow-hidden shadow-inner">
            <div className="w-10 h-10 rounded-full overflow-hidden flex items-center justify-center shrink-0 shadow-sm">
              <ChainIcon
                chainKeyOrIconId={chainKey}
                name={chainName}
                size={36}
                className="rounded-full overflow-hidden"
              />
            </div>
          </div>

          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="text-[14px] font-bold text-white tracking-wide truncate">
                {chainName}
              </span>
            </div>
          </div>
        </div>

        {/* Right: Total Chain USD Value */}
        <div className="flex items-center gap-2.5 shrink-0 text-right">
          <div>
            <div className="flex items-baseline justify-end gap-1">
              <span className="font-mono text-[18px] font-bold text-white tracking-tight">
                {hideBalances
                  ? '$••••••'
                  : `$${chainTotalUsd.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
              </span>
              <span className="text-[12px] font-bold text-white">USD</span>
            </div>
          </div>

          <ChevronDown
            size={14}
            className={`text-slate-400 transition-transform duration-300 shrink-0 ${
              isExpanded ? 'rotate-180 text-white' : 'group-hover:translate-y-0.5'
            }`}
          />
        </div>
      </div>

      {/* ── Sub-Tokens Accordion (Revealed on Click) ── */}
      <div
        onClick={(e) => e.stopPropagation()}
        className={`transition-all duration-300 ease-out border-t border-white/[0.06] bg-[#070912]/80 backdrop-blur-md px-3.5 overflow-hidden ${
          isExpanded ? 'max-h-[760px] py-3 opacity-100' : 'max-h-0 py-0 opacity-0 pointer-events-none'
        }`}
      >
        <div className="space-y-2">
          {/* Native Gas Token Row (for Non-Arc Chains with distinct native token like ETH, POL, AVAX, S, SEI) */}
          {!isArc && (
            <div className="p-2 rounded-xl bg-white/[0.03] border border-white/[0.04] flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-full flex items-center justify-center shrink-0 shadow-sm overflow-hidden">
                  {nativeSymbol.toLowerCase() === 's' || iconId === 'sonic' ? (
                    <PinnedNetworkIcon name="sonic" variant="mono" size={24} className="text-white" />
                  ) : nativeSymbol.toLowerCase() === 'xpl' || iconId === 'plasma' ? (
                    <PinnedTokenIcon symbol="xpl" variant="mono" size={24} className="text-white" />
                  ) : nativeSymbol.toLowerCase() === 'phrs' || iconId === 'pharos' ? (
                    <img src={PhrsIcon} alt="PHRS" className="w-full h-full object-contain rounded-full" />
                  ) : nativeSymbol.toLowerCase() === 'okb' || iconId === 'x-layer' || iconId === 'xlayer' ? (
                    <PinnedTokenIcon symbol="okb" variant="mono" size={24} className="text-white" />
                  ) : (
                    <PinnedTokenIcon
                      symbol={nativeSymbol.toLowerCase() === 'pol' ? 'pol' : nativeSymbol.toLowerCase()}
                      variant="branded"
                      size={24}
                      className="w-full h-full object-contain"
                    />
                  )}
                </div>
                <div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-s font-semibold text-slate-200">{nativeSymbol}</span>
                  </div>
                </div>
              </div>

              <div className="text-right">
                <div className="font-mono text-s font-bold text-white">
                  {hideBalances ? '••••••' : `${nativeAmount} ${nativeSymbol}`}
                </div>
                <div className="text-[12px] text-slate-400 font-mono">
                  {hideBalances
                    ? '≈ $••••••'
                    : formatFiatEstimate(nativeAmount, nativeSymbol, prices) ||
                      `≈ $${(parseFloat(nativeAmount || '0') * getNativeGasPrice(nativeSymbol, prices)).toFixed(2)} USD`}
                </div>
              </div>
            </div>
          )}

          {/* USDC Token Row */}
          <div className="p-2 rounded-xl bg-white/[0.03] border border-white/[0.04] flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <img src={UsdcIcon} alt="USDC" className="w-8 h-8 object-contain" />
              <div>
                <div className="flex items-center gap-1.5">
                  <span className="text-s font-semibold text-slate-200">USDC</span>
                </div>
              </div>
            </div>

            <div className="text-right">
              <div className="font-mono text-s font-bold text-white">
                {hideBalances ? '••••••' : `${usdcAmount} USDC`}
              </div>
              <div className="text-[12px] text-slate-400 font-mono">
                {hideBalances
                  ? '≈ $••••••'
                  : formatFiatEstimate(usdcAmount, 'USDC', prices) ||
                    `≈ $${parseFloat(usdcAmount || '0').toFixed(2)} USD`}
              </div>
            </div>
          </div>

          {/* EURC Token Row */}
          {hasEurc && (
            <div className="p-2 rounded-xl bg-white/[0.03] border border-white/[0.04] flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <img src={EurcIcon} alt="EURC" className="w-8 h-8 object-contain" />
                <div>
                  <div className="text-s font-semibold text-slate-200">EURC</div>
                </div>
              </div>

              <div className="text-right">
                <div className="font-mono text-s font-bold text-slate-200">
                  {hideBalances ? '••••••' : `${eurcAmount} EURC`}
                </div>
                <div className="text-[12px] text-slate-400 font-mono">
                  {hideBalances
                    ? '≈ $••••••'
                    : formatFiatEstimate(eurcAmount, 'EURC', prices) ||
                      `≈ ${(parseFloat(eurcAmount || '0') * (prices?.EURC || 1.08)).toFixed(2)} USD`}
                </div>
              </div>
            </div>
          )}

          {/* cirBTC Token Row */}
          {hasCirbtc && (
            <div className="p-2 rounded-xl bg-white/[0.03] border border-white/[0.04] flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <img src={CirBtcIcon} alt="cirBTC" className="w-8 h-8 object-contain" />
                <div>
                  <div className="text-s font-semibold text-slate-200">cirBTC</div>
                </div>
              </div>

              <div className="text-right">
                <div className="font-mono text-s font-bold text-white">
                  {hideBalances ? '••••••' : `${cirbtcAmount} cirBTC`}
                </div>
                <div className="text-[12px] text-slate-400 font-mono">
                  {hideBalances
                    ? '≈ $••••••'
                    : formatFiatEstimate(cirbtcAmount, 'cirBTC', prices) ||
                      `≈ ${(parseFloat(cirbtcAmount || '0') * (prices?.cirBTC || prices?.BTC || 85000)).toFixed(2)} USD`}
                </div>
              </div>
            </div>
          )}

          {/* WETH Token Row */}
          {hasWeth && (
            <div className="p-2 rounded-xl bg-white/[0.03] border border-white/[0.04] flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-full flex items-center justify-center shrink-0 shadow-sm">
                  <PinnedTokenIcon symbol="eth" variant="branded" size={20} className="w-8 h-8 object-contain" />
                </div>
                <div>
                  <div className="text-s font-semibold text-slate-200">WETH</div>
                </div>
              </div>

              <div className="text-right">
                <div className="font-mono text-s font-bold text-white">
                  {hideBalances ? '••••••' : `${wethAmount} WETH`}
                </div>
                <div className="text-[12px] text-slate-400 font-mono">
                  {hideBalances
                    ? '≈ $••••••'
                    : formatFiatEstimate(wethAmount, 'WETH', prices) ||
                      `≈ ${(parseFloat(wethAmount || '0') * (prices?.WETH || prices?.ETH || 2500)).toFixed(2)} USD`}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Quick Action Shortcuts */}
        <div className="mt-2.5 pt-2 border-t border-white/[0.04] flex items-center justify-start gap-2">
          {onNavigateToTab && (
            <>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  onClose()
                  onNavigateToTab('swap', chainKey)
                }}
                className="px-2.5 py-1 rounded-xl text-[12px] font-semibold text-slate-300 hover:text-white bg-white/[0.05] hover:bg-indigo-600/30 border border-white/[0.08] hover:border-indigo-500/40 transition-all flex items-center gap-1 cursor-pointer"
              >
                <ArrowRightLeft size={12} />
                <span>Swap</span>
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  onClose()
                  onNavigateToTab('send', chainKey)
                }}
                className="px-2.5 py-1 rounded-xl text-[12px] font-semibold text-slate-300 hover:text-white bg-white/[0.05] hover:bg-blue-600/30 border border-white/[0.08] hover:border-blue-500/40 transition-all flex items-center gap-1 cursor-pointer"
              >
                <ArrowUpRight size={12} />
                <span>Send</span>
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  onClose()
                  onNavigateToTab('bridge', chainKey)
                }}
                className="px-2.5 py-1 rounded-xl text-[12px] font-semibold text-slate-300 hover:text-white bg-white/[0.05] hover:bg-purple-600/30 border border-white/[0.08] hover:border-purple-500/40 transition-all flex items-center gap-1 cursor-pointer"
              >
                <Globe size={12} />
                <span>Bridge</span>
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
