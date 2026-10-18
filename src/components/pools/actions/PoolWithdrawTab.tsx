import React from 'react'
import { Plus, Layers } from 'lucide-react'
import { AssetInputPanel } from '../../fintech'
import { InfoTooltip } from '../../common/Tooltip'
import { formatFiatEstimate } from '../../../hooks/useLiveTokenPrices'
import UsdcIcon from '../../../assets/Token-Icon/USDC Token.svg'
import EurcIcon from '../../../assets/Token-Icon/EURC Token.svg'
import CirBtcIcon from '../../../assets/Token-Icon/cirBTC Token.svg'
import { WethIcon } from '../../../config/tokenIcons'

interface PoolWithdrawTabProps {
  isLp: boolean
  isVault: boolean
  lpPayoutMode: 'usdc' | 'dual'
  setLpPayoutMode: (mode: 'usdc' | 'dual') => void
  amount: string
  depositLabel: string
  depositTokenSymbol: string
  numericBalanceStr: string
  userStaked: number
  handleAmountInputChange: (val: string) => void
  handlePercentageChange: (pct: number) => void
  tokenPrices: any
  livePoolRate: number
  pool: any
  isProcessing: boolean
  errorMsg: string | null
  inputAmountNum: number
  withdrawAssetReturns: {
    amountA: string
    amountB: string
  } | null
  tokenASymbol: string
  counterTokenSymbol: string
  exchangeRate: number
  slippage: number
}

export const PoolWithdrawTab: React.FC<PoolWithdrawTabProps> = ({
  isLp,
  isVault,
  lpPayoutMode,
  setLpPayoutMode,
  amount,
  depositLabel,
  depositTokenSymbol,
  numericBalanceStr,
  handleAmountInputChange,
  handlePercentageChange,
  tokenPrices,
  livePoolRate,
  pool,
  isProcessing,
  errorMsg,
  inputAmountNum,
  withdrawAssetReturns,
  tokenASymbol,
  counterTokenSymbol,
  exchangeRate,
  slippage,
}) => {
  const depositTokenIcon = depositTokenSymbol === 'EURC' || depositTokenSymbol.includes('EURC')
    ? EurcIcon
    : (depositTokenSymbol === 'WETH' || depositTokenSymbol === 'ETH' || depositTokenSymbol.includes('WETH') || depositTokenSymbol.includes('ETH'))
      ? WethIcon
      : (depositTokenSymbol === 'cirBTC' || depositTokenSymbol === 'BTC' || depositTokenSymbol.includes('cirBTC') || depositTokenSymbol.includes('BTC'))
        ? CirBtcIcon
        : UsdcIcon

  return (
    <div>
      {/* LP Withdraw Payout Switcher */}
      {isLp && (
        <div style={{ display: 'flex', gap: 8, marginBottom: 18 }}>
          <button
            type="button"
            onClick={() => setLpPayoutMode('usdc')}
            style={{
              flex: 1,
              padding: '8px 12px',
              borderRadius: 10,
              background: lpPayoutMode === 'usdc' ? 'rgba(152, 150, 255, 0.18)' : 'rgba(255, 255, 255, 0.03)',
              border: lpPayoutMode === 'usdc' ? '1px solid rgba(152, 150, 255, 0.4)' : '1px solid rgba(255, 255, 255, 0.06)',
              color: lpPayoutMode === 'usdc' ? '#fff' : 'var(--fp-3)',
              fontSize: 12,
              fontFamily: 'var(--font-app)',
              fontWeight: 600,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 6,
            }}
          >
            <Plus size={13} style={{ color: 'var(--purple-1)' }} />
            <span>Single Token</span>
          </button>

          <button
            type="button"
            onClick={() => setLpPayoutMode('dual')}
            style={{
              flex: 1,
              padding: '8px 12px',
              borderRadius: 10,
              background: lpPayoutMode === 'dual' ? 'rgba(152, 150, 255, 0.18)' : 'rgba(255, 255, 255, 0.03)',
              border: lpPayoutMode === 'dual' ? '1px solid rgba(152, 150, 255, 0.4)' : '1px solid rgba(255, 255, 255, 0.06)',
              color: lpPayoutMode === 'dual' ? '#fff' : 'var(--fp-3)',
              fontSize: 12,
              fontFamily: 'var(--font-app)',
              fontWeight: 600,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 6,
            }}
          >
            <Layers size={13} />
            <span>Both Tokens</span>
          </button>
        </div>
      )}

      {/* Single Token / Zap Withdraw input */}
      <div className="mb-4">
        <AssetInputPanel
          label={depositLabel}
          amount={amount}
          onAmountChange={handleAmountInputChange}
          placeholder={depositTokenSymbol === 'cirBTC' || depositTokenSymbol.toLowerCase().includes('btc') ? '0.0000' : '0.00'}
          tokenSymbol={depositTokenSymbol}
          tokenIcon={depositTokenIcon}
          tokenListAvailable={false}
          balance={numericBalanceStr}
          onMaxClick={() => handlePercentageChange(100)}
          quickPercentages={[25, 50, 75, 100]}
          onSelectPercentage={handlePercentageChange}
          fiatEstimate={formatFiatEstimate(
            amount,
            depositTokenSymbol,
            tokenPrices,
            livePoolRate > 0 ? livePoolRate : pool?.exchangeRate
          )}
          disabled={isProcessing}
          error={Boolean(errorMsg && (errorMsg.toLowerCase().includes('exceeds') || errorMsg.toLowerCase().includes('insufficient')))}
        />
      </div>

      {/* Proportional Withdrawal Breakdown (LP Pools) */}
      {isLp && inputAmountNum > 0 && withdrawAssetReturns && (
        <div
          style={{
            background: 'rgba(15, 18, 35, 0.85)',
            border: '1px solid rgba(152, 150, 255, 0.2)',
            borderRadius: 12,
            padding: '10px 14px',
            marginBottom: 16,
            fontSize: 11,
            fontFamily: 'var(--font-app)',
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', color: 'var(--fp-3)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <span>Estimated Return ({lpPayoutMode === 'usdc' ? '100% USDC' : 'Dual Assets'}):</span>
              <InfoTooltip
                content={
                  lpPayoutMode === 'usdc'
                    ? `Proportional pool assets redeemed and automatically swapped to USDC with ${slippage}% slippage tolerance.`
                    : 'Proportional pool assets redeemed and sent directly to your wallet.'
                }
                position="top"
                align="start"
                size={11}
                iconClassName="w-3 h-3 text-slate-400 hover:text-indigo-300 cursor-help transition-colors"
              />
            </div>
            <span style={{ color: '#fff', fontWeight: 600 }}>
              {lpPayoutMode === 'usdc'
                ? `~${(parseFloat(withdrawAssetReturns.amountA) + (parseFloat(withdrawAssetReturns.amountB) * exchangeRate)).toFixed(2)} ${tokenASymbol}`
                : `~${withdrawAssetReturns.amountA} ${tokenASymbol} + ~${withdrawAssetReturns.amountB} ${counterTokenSymbol}`}
            </span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', color: 'var(--fp-3)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <span>Underlying Proportional Assets:</span>
              <InfoTooltip
                content="Underlying assets corresponding to your LP token share before any conversions."
                position="top"
                align="start"
                size={11}
                iconClassName="w-3 h-3 text-slate-400 hover:text-indigo-300 cursor-help transition-colors"
              />
            </div>
            <span style={{ color: 'var(--fp-2)' }}>
              {withdrawAssetReturns.amountA} ${tokenASymbol} / {withdrawAssetReturns.amountB} {counterTokenSymbol}
            </span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', color: 'var(--fp-3)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <span>Slippage Protection:</span>
              <InfoTooltip
                content="Maximum slippage tolerance applied during the withdrawal and any auto-swap."
                position="top"
                align="start"
                size={11}
                iconClassName="w-3 h-3 text-slate-400 hover:text-indigo-300 cursor-help transition-colors"
              />
            </div>
            <span style={{ color: 'var(--fp-2)' }}>{slippage}%</span>
          </div>
        </div>
      )}

      {/* Vault Redeem Breakdown */}
      {isVault && inputAmountNum > 0 && (
        <div
          style={{
            background: 'rgba(15, 18, 35, 0.85)',
            border: '1px solid rgba(152, 150, 255, 0.2)',
            borderRadius: 12,
            padding: '10px 14px',
            marginBottom: 16,
            fontSize: 11,
            fontFamily: 'var(--font-app)',
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--fp-3)' }}>
            <span>Redeeming Asset:</span>
            <span style={{ color: '#fff', fontWeight: 600 }}>Pure USDC (Direct to Wallet)</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--fp-3)' }}>
            <span>Vault Shares Burned:</span>
            <span style={{ color: 'var(--purple-1)', fontWeight: 600 }}>~{inputAmountNum.toFixed(2)} af-USDC</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--fp-3)' }}>
            <span>Protocol Lockup / Penalty:</span>
            <span style={{ color: '#34d399', fontWeight: 600 }}>0% (Flexible / No Penalty)</span>
          </div>
        </div>
      )}
    </div>
  )
}
