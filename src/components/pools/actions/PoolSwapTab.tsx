import React from 'react'
import { AlertCircle, ArrowUpDown } from 'lucide-react'
import { AssetInputPanel } from '../../fintech'
import { InfoTooltip } from '../../common/Tooltip'
import { formatFiatEstimate } from '../../../hooks/useLiveTokenPrices'
import UsdcIcon from '../../../assets/Token-Icon/USDC Token.svg'
import EurcIcon from '../../../assets/Token-Icon/EURC Token.svg'
import CirBtcIcon from '../../../assets/Token-Icon/cirBTC Token.svg'
import { WethIcon } from '../../../config/tokenIcons'

const ARC_GAS_RESERVE_USDC = 0.50

interface PoolSwapTabProps {
  isPoolEmpty: boolean
  swapTokenIn: string
  swapTokenOut: string
  swapAmountIn: string
  calculatedSwapOut: string
  minSwapOutStr: string
  swapWalletBalTokenInStr: string
  swapWalletBalTokenIn: number
  priceImpactPct: number
  feePercent: number
  slippage: number
  tokenPrices: any
  pool: any
  livePoolRate: number
  isProcessing: boolean
  onSwapAmountChange: (val: string) => void
  onFlipDirection: () => void
}

export const PoolSwapTab: React.FC<PoolSwapTabProps> = ({
  isPoolEmpty,
  swapTokenIn,
  swapTokenOut,
  swapAmountIn,
  calculatedSwapOut,
  minSwapOutStr,
  swapWalletBalTokenInStr,
  swapWalletBalTokenIn,
  priceImpactPct,
  feePercent,
  slippage,
  tokenPrices,
  pool,
  livePoolRate,
  isProcessing,
  onSwapAmountChange,
  onFlipDirection,
}) => {
  const swapAmountInNum = parseFloat(swapAmountIn) || 0

  const getTokenIcon = (symbol: string) => {
    if (symbol === 'EURC') return EurcIcon
    if (symbol === 'WETH' || symbol === 'ETH') return WethIcon
    if (symbol === 'cirBTC' || symbol === 'BTC') return CirBtcIcon
    return UsdcIcon
  }

  return (
    <div className="mb-4 space-y-2">
      {isPoolEmpty && (
        <div className="mb-2 p-3 rounded-xl bg-amber-500/10 border border-amber-500/25 text-xs text-amber-300/90 leading-relaxed flex items-start gap-2.5">
          <AlertCircle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
          <div>
            <strong className="text-amber-200 block mb-0.5">Pool Reserves Empty (0 Liquidity)</strong>
            This AMM pool currently has 0 reserves on Arc Testnet. Swaps cannot be executed until initial liquidity is provided via <strong>Dual-Asset Deposit</strong>.
          </div>
        </div>
      )}

      {/* Input: YOU PAY */}
      <AssetInputPanel
        label="YOU PAY"
        amount={swapAmountIn}
        onAmountChange={onSwapAmountChange}
        placeholder={swapTokenIn === 'cirBTC' || swapTokenIn.toLowerCase().includes('btc') ? '0.0000' : swapTokenIn === 'WETH' ? '0.0000' : '0.00'}
        tokenSymbol={swapTokenIn}
        tokenIcon={getTokenIcon(swapTokenIn)}
        tokenListAvailable={false}
        balance={swapWalletBalTokenInStr}
        onMaxClick={() => {
          if (swapTokenIn === 'USDC') {
            const maxUsdcWithGas = Math.max(0, swapWalletBalTokenIn - ARC_GAS_RESERVE_USDC)
            onSwapAmountChange(maxUsdcWithGas.toFixed(2))
          } else if (swapTokenIn === 'WETH') {
            onSwapAmountChange(swapWalletBalTokenIn.toFixed(4))
          } else {
            onSwapAmountChange(swapWalletBalTokenIn.toString())
          }
        }}
        quickPercentages={[25, 50, 75, 100]}
        onSelectPercentage={(pct) => {
          const max = swapTokenIn === 'USDC'
            ? Math.max(0, swapWalletBalTokenIn - ARC_GAS_RESERVE_USDC)
            : swapWalletBalTokenIn
          const decimals = swapTokenIn === 'cirBTC' ? 6 : swapTokenIn === 'WETH' ? 4 : 2
          onSwapAmountChange(((max * pct) / 100).toFixed(decimals))
        }}
        fiatEstimate={formatFiatEstimate(
          swapAmountIn,
          swapTokenIn,
          tokenPrices,
          livePoolRate > 0 ? livePoolRate : pool?.exchangeRate
        )}
        disabled={isProcessing}
      />

      {/* Flip Button */}
      <div className="flex justify-center -my-2 z-10 relative">
        <button
          type="button"
          onClick={onFlipDirection}
          className="w-8 h-8 rounded-full bg-[#1e2238] hover:bg-[#282d4a] border border-white/10 flex items-center justify-center text-slate-300 hover:text-white transition-all shadow-md active:scale-95 cursor-pointer"
        >
          <ArrowUpDown size={14} />
        </button>
      </div>

      {/* Output: YOU RECEIVE */}
      <AssetInputPanel
        label="YOU RECEIVE (ESTIMATED)"
        amount={calculatedSwapOut}
        readOnly={true}
        placeholder={swapTokenOut === 'cirBTC' || swapTokenOut.toLowerCase().includes('btc') ? '0.0000' : swapTokenOut === 'WETH' ? '0.0000' : '0.00'}
        tokenSymbol={swapTokenOut}
        tokenIcon={getTokenIcon(swapTokenOut)}
        tokenListAvailable={false}
        fiatEstimate={formatFiatEstimate(
          calculatedSwapOut,
          swapTokenOut,
          tokenPrices,
          livePoolRate > 0 ? livePoolRate : pool?.exchangeRate
        )}
        disabled={isProcessing}
      />

      {/* Pre-Execution Summary Breakdown Card */}
      {swapAmountInNum > 0 && (
        <div
          style={{
            background: 'rgba(15, 18, 35, 0.85)',
            border: '1px solid rgba(152, 150, 255, 0.2)',
            borderRadius: 12,
            padding: '10px 14px',
            marginTop: 14,
            fontSize: 11,
            fontFamily: 'var(--font-app)',
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', color: 'var(--fp-3)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <span>Minimum Received ({slippage}% Slippage):</span>
              <InfoTooltip
                content="Guaranteed minimum amount received after maximum slippage tolerance."
                position="top"
                align="start"
                size={11}
                iconClassName="w-3 h-3 text-slate-400 hover:text-indigo-300 cursor-help transition-colors"
              />
            </div>
            <span style={{ color: '#fff', fontWeight: 600 }}>{minSwapOutStr} {swapTokenOut}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', color: 'var(--fp-3)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <span>AMM Swap Fee ({feePercent}%):</span>
              <InfoTooltip
                content="Fee rewarded directly to liquidity pool providers supporting this trade."
                position="top"
                align="start"
                size={11}
                iconClassName="w-3 h-3 text-slate-400 hover:text-indigo-300 cursor-help transition-colors"
              />
            </div>
            <span style={{ color: 'var(--fp-2)' }}>{(swapAmountInNum * (feePercent / 100)).toFixed(4)} {swapTokenIn}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', color: 'var(--fp-3)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <span>Estimated Price Impact:</span>
              <InfoTooltip
                content="Estimated impact of your swap size on pool exchange rates."
                position="top"
                align="start"
                size={11}
                iconClassName="w-3 h-3 text-slate-400 hover:text-indigo-300 cursor-help transition-colors"
              />
            </div>
            <span
              style={{
                color: priceImpactPct > 3 ? '#f87171' : priceImpactPct > 1 ? '#fbbf24' : '#34d399',
                fontWeight: 600,
              }}
            >
              {priceImpactPct <= 0 ? '< 0.01%' : `${priceImpactPct.toFixed(2)}%`}
            </span>
          </div>
        </div>
      )}
    </div>
  )
}
