import React from 'react'
import {
  Wallet,
  Globe,
  ChevronDown,
  AlertCircle,
  AlertTriangle,
  Plus,
  Layers,
} from 'lucide-react'
import { AssetInputPanel } from '../../fintech'
import { ChainIcon } from '../../common/ChainIcon'
import { InfoTooltip } from '../../common/Tooltip'
import { CHAIN_META, getChainDisplayName } from '../../../config/bridgeConfig'
import { formatFiatEstimate } from '../../../hooks/useLiveTokenPrices'
import UsdcIcon from '../../../assets/Token-Icon/USDC Token.svg'
import EurcIcon from '../../../assets/Token-Icon/EURC Token.svg'
import CirBtcIcon from '../../../assets/Token-Icon/cirBTC Token.svg'
import { WethIcon } from '../../../config/tokenIcons'

const ARC_GAS_RESERVE_USDC = 0.50

interface PoolDepositTabProps {
  isLp: boolean
  isVault: boolean
  isPoolEmpty: boolean
  depositSource: 'native' | 'crosschain'
  setDepositSource: (source: 'native' | 'crosschain') => void
  selectedSourceChain: string
  setShowChainDropdown: (show: boolean) => void
  crossChainBalStr: string
  crossChainBalNum: number
  gatewayTotalBalance: string
  lpDepositMethod: 'zap' | 'dual'
  setLpDepositMethod: (method: 'zap' | 'dual') => void
  amount: string
  percentage: number
  depositLabel: string
  depositTokenSymbol: string
  numericBalanceStr: string
  handleAmountInputChange: (val: string) => void
  handlePercentageChange: (pct: number) => void
  // Dual deposit props
  amountA: string
  amountB: string
  handleAmountAChange: (val: string) => void
  handleAmountBChange: (val: string) => void
  tokenASymbol: string
  tokenAIcon: string
  availableWalletTokenA: string
  counterTokenSymbol: string
  counterTokenDecimals: number
  counterWalletBalStr: string
  counterWalletBal: number
  walletBalTokenA: number
  isTokenAEurc: boolean
  // Common calculations
  tokenPrices: any
  livePoolRate: number
  pool: any
  isProcessing: boolean
  errorMsg: string | null
  inputAmountNum: number
  annualYield: number
  dailyYield: number
  estimatedLpMinted: string
  estimatedPoolShare: string
  slippage: number
  // O2 donation warning
  isDualDonationWarn: boolean
  isDualDonationBlock: boolean
  dualDepositBalance: any
  donationPct: number
  setAmountA: (val: string) => void
  setAmountB: (val: string) => void
  setErrorMsg: (msg: string | null) => void
}

export const PoolDepositTab: React.FC<PoolDepositTabProps> = ({
  isLp,
  isVault,
  isPoolEmpty,
  depositSource,
  setDepositSource,
  selectedSourceChain,
  setShowChainDropdown,
  crossChainBalStr,
  crossChainBalNum,
  gatewayTotalBalance,
  lpDepositMethod,
  setLpDepositMethod,
  amount,
  percentage,
  depositLabel,
  depositTokenSymbol,
  numericBalanceStr,
  handleAmountInputChange,
  handlePercentageChange,
  amountA,
  amountB,
  handleAmountAChange,
  handleAmountBChange,
  tokenASymbol,
  tokenAIcon,
  availableWalletTokenA,
  counterTokenSymbol,
  counterTokenDecimals,
  counterWalletBalStr,
  counterWalletBal,
  walletBalTokenA,
  isTokenAEurc,
  tokenPrices,
  livePoolRate,
  pool,
  isProcessing,
  errorMsg,
  inputAmountNum,
  annualYield,
  dailyYield,
  estimatedLpMinted,
  estimatedPoolShare,
  slippage,
  isDualDonationWarn,
  isDualDonationBlock,
  dualDepositBalance,
  donationPct,
  setAmountA,
  setAmountB,
  setErrorMsg,
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
      {/* ── Deposit Source Switcher: Arc Testnet vs Cross-Chain Gateway Zap ── */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 8,
          background: 'rgba(11, 13, 24, 0.65)',
          border: '1px solid rgba(255, 255, 255, 0.08)',
          borderRadius: 12,
          padding: 4,
          marginBottom: 16,
        }}
      >
        <button
          type="button"
          onClick={() => {
            setDepositSource('native')
            setErrorMsg(null)
          }}
          style={{
            padding: '8px 10px',
            borderRadius: 9,
            border: 'none',
            background: depositSource === 'native' ? 'rgba(152, 150, 255, 0.2)' : 'transparent',
            color: depositSource === 'native' ? '#fff' : 'var(--fp-3)',
            fontSize: 12,
            fontFamily: 'var(--font-app)',
            fontWeight: depositSource === 'native' ? 600 : 500,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 6,
            transition: 'all 0.15s ease',
          }}
        >
          <Wallet size={13} style={{ color: 'var(--purple-1)' }} />
          <span>Arc Testnet</span>
        </button>

        <button
          type="button"
          onClick={() => {
            if (isLp && isPoolEmpty) {
              setErrorMsg(`Cross-Chain liquidity requires existing pool reserves to auto-balance into ${counterTokenSymbol}. Please use Arc Native Dual-Asset Deposit.`)
              return
            }
            setDepositSource('crosschain')
            setErrorMsg(null)
          }}
          disabled={isLp && isPoolEmpty}
          style={{
            padding: '8px 10px',
            borderRadius: 9,
            border: 'none',
            background: depositSource === 'crosschain' ? 'rgba(152, 150, 255, 0.2)' : 'transparent',
            color: isLp && isPoolEmpty ? 'rgba(255, 255, 255, 0.35)' : (depositSource === 'crosschain' ? '#fff' : 'var(--fp-3)'),
            fontSize: 12,
            fontFamily: 'var(--font-app)',
            fontWeight: depositSource === 'crosschain' ? 600 : 500,
            cursor: isLp && isPoolEmpty ? 'not-allowed' : 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 6,
            transition: 'all 0.15s ease',
            opacity: isLp && isPoolEmpty ? 0.6 : 1,
          }}
          title={isLp && isPoolEmpty ? 'Cross-Chain liquidity requires existing pool reserves' : undefined}
        >
          <Globe className="w-3.5 h-3.5 text-indigo-400" />
          <span>Cross-Chain</span>
          {isLp && isPoolEmpty && <span className="text-[10px] text-amber-400/80 ml-1">(0 Reserves)</span>}
        </button>
      </div>

      {/* ── Cross-Chain Gateway Zap Configuration Area ── */}
      {depositSource === 'crosschain' && (
        <div className="bg-[#121626]/85 border border-white/[0.06] rounded-2xl p-3.5 sm:p-4 mb-4">
          <div className="w-full min-w-0">
            <div className="flex items-center justify-between mb-1.5 ml-1">
              <div
                className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider"
                style={{ fontFamily: 'var(--font-app)' }}
              >
                NETWORK
              </div>
              <span className="text-[12px] text-slate-400 font-medium">
                Available: <strong className="text-white">{crossChainBalStr} USDC</strong>
              </span>
            </div>

            <button
              type="button"
              disabled={isProcessing}
              onClick={() => setShowChainDropdown(true)}
              className="w-full flex items-center justify-between gap-2 px-3 py-2.5 rounded-xl bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.08] hover:border-indigo-500/40 transition-all cursor-pointer select-none text-left"
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="w-5 h-5 rounded-full overflow-hidden flex items-center justify-center shrink-0">
                  <ChainIcon
                    chainKeyOrIconId={selectedSourceChain}
                    name={CHAIN_META[selectedSourceChain]?.name || getChainDisplayName(selectedSourceChain)}
                    size={20}
                    className="rounded-full"
                  />
                </div>
                <div className="flex flex-col min-w-0">
                  <span className="text-xs font-semibold text-white truncate">
                    {CHAIN_META[selectedSourceChain]?.name || getChainDisplayName(selectedSourceChain)}
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <ChevronDown className="w-3.5 h-3.5 text-slate-400 shrink-0" />
              </div>
            </button>

            {parseFloat(gatewayTotalBalance || '0') <= 0 ? (
              <div className="mt-2.5 p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/20 text-[11px] text-amber-300/90 leading-relaxed flex items-start gap-2">
                <AlertCircle className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />
                <div>
                  <strong className="text-amber-200 block mb-0.5">No Circle Gateway Balance</strong>
                  Cross-Chain Zap burns deposited USDC from Circle Gateway. Please deposit testnet USDC into Circle Gateway via the <strong>Unified Balance</strong> tab before zapping.
                </div>
              </div>
            ) : crossChainBalNum <= 0 ? (
              <div className="mt-2.5 p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/20 text-[11px] text-amber-300/90 leading-relaxed flex items-start gap-2">
                <AlertCircle className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />
                <div>
                  <strong className="text-amber-200 block mb-0.5">0 USDC on {CHAIN_META[selectedSourceChain]?.name || selectedSourceChain}</strong>
                  Your Gateway balance on this specific network is 0. Please select another source network with available balance above, or deposit via the <strong>Unified Balance</strong> tab.
                </div>
              </div>
            ) : null}
          </div>
        </div>
      )}

      {/* Native LP Deposit Method Switcher (When depositSource === 'native') */}
      {isLp && depositSource === 'native' && (
        <>
          {isPoolEmpty && (
            <div className="mb-3.5 p-3 rounded-xl bg-amber-500/10 border border-amber-500/25 text-xs text-amber-300/90 leading-relaxed flex items-start gap-2.5">
              <AlertCircle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
              <div>
                <strong className="text-amber-200 block mb-0.5">Initial Pool Liquidity (0 Reserves)</strong>
                This AMM pool currently has 0 reserves on Arc Testnet. Single-token deposit is unavailable because it requires pre-existing pool reserves to swap 50% USDC into {counterTokenSymbol}. To bootstrap this pool, please supply both assets via <strong>Dual-Asset Deposit</strong>, or deposit single-sided USDC into the <strong>USDC Yield Vault</strong>.
              </div>
            </div>
          )}
          <div style={{ display: 'flex', gap: 8, marginBottom: 18 }}>
            <button
              type="button"
              disabled={isPoolEmpty}
              onClick={() => {
                if (isPoolEmpty) return
                setLpDepositMethod('zap')
                setErrorMsg(null)
              }}
              style={{
                flex: 1,
                padding: '8px 12px',
                borderRadius: 10,
                background: lpDepositMethod === 'zap' ? 'rgba(152, 150, 255, 0.18)' : 'rgba(255, 255, 255, 0.03)',
                border: lpDepositMethod === 'zap' ? '1px solid rgba(152, 150, 255, 0.4)' : '1px solid rgba(255, 255, 255, 0.06)',
                color: isPoolEmpty ? 'rgba(255, 255, 255, 0.4)' : (lpDepositMethod === 'zap' ? '#fff' : 'var(--fp-3)'),
                fontSize: 12,
                fontFamily: 'var(--font-app)',
                fontWeight: 600,
                cursor: isPoolEmpty ? 'not-allowed' : 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 6,
                transition: 'all 0.15s ease',
                opacity: isPoolEmpty ? 0.6 : 1,
              }}
              title={isPoolEmpty ? 'Single-token deposit requires existing pool reserves' : undefined}
            >
              <Plus className="w-3.5 h-3.5 text-indigo-400" />
              <span>Single Asset</span>
              {isPoolEmpty && <span className="text-[10px] text-amber-400/80 ml-1">(0 Reserves)</span>}
            </button>

            <button
              type="button"
              onClick={() => {
                setLpDepositMethod('dual')
                setErrorMsg(null)
              }}
              style={{
                flex: 1,
                padding: '8px 12px',
                borderRadius: 10,
                background: lpDepositMethod === 'dual' ? 'rgba(152, 150, 255, 0.18)' : 'rgba(255, 255, 255, 0.03)',
                border: lpDepositMethod === 'dual' ? '1px solid rgba(152, 150, 255, 0.4)' : '1px solid rgba(255, 255, 255, 0.06)',
                color: lpDepositMethod === 'dual' ? '#fff' : 'var(--fp-3)',
                fontSize: 12,
                fontFamily: 'var(--font-app)',
                fontWeight: 600,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 6,
                transition: 'all 0.15s ease',
              }}
            >
              <Layers className="w-3.5 h-3.5 text-indigo-400" />
              <span>Dual Asset</span>
            </button>
          </div>
        </>
      )}

      {/* Input Panels */}
      {isLp && lpDepositMethod === 'dual' && depositSource === 'native' ? (
        /* Dual Token Deposit (Native Arc Only) */
        <div className="space-y-3 mb-4">
          <AssetInputPanel
            label={`AMOUNT OF ${tokenASymbol} TO DEPOSIT`}
            amount={amountA}
            onAmountChange={handleAmountAChange}
            tokenSymbol={tokenASymbol}
            tokenIcon={tokenAIcon}
            tokenListAvailable={false}
            balance={availableWalletTokenA}
            onMaxClick={() => {
              const maxAWithGas = isTokenAEurc ? walletBalTokenA : Math.max(0, walletBalTokenA - ARC_GAS_RESERVE_USDC)
              handleAmountAChange(maxAWithGas.toFixed(2))
            }}
            quickPercentages={[25, 50, 75, 100]}
            onSelectPercentage={(pct) => {
              const maxAWithGas = isTokenAEurc ? walletBalTokenA : Math.max(0, walletBalTokenA - ARC_GAS_RESERVE_USDC)
              handleAmountAChange(((maxAWithGas * pct) / 100).toFixed(2))
            }}
            fiatEstimate={formatFiatEstimate(amountA, tokenASymbol, tokenPrices)}
            disabled={isProcessing}
          />
          <AssetInputPanel
            label="AMOUNT TO DEPOSIT"
            amount={amountB}
            onAmountChange={handleAmountBChange}
            placeholder={counterTokenSymbol === 'cirBTC' || counterTokenSymbol.toLowerCase().includes('btc') ? '0.0000' : counterTokenSymbol === 'WETH' ? '0.0000' : '0.00'}
            tokenSymbol={counterTokenSymbol}
            tokenIcon={counterTokenSymbol === 'EURC' ? EurcIcon : (counterTokenSymbol === 'WETH' ? WethIcon : CirBtcIcon)}
            tokenListAvailable={false}
            balance={counterWalletBalStr}
            onMaxClick={() => {
              handleAmountBChange(counterWalletBalStr)
            }}
            quickPercentages={[25, 50, 75, 100]}
            onSelectPercentage={(pct) => {
              const balNum = counterWalletBal || 0
              handleAmountBChange(((balNum * pct) / 100).toFixed(counterTokenSymbol === 'EURC' ? 2 : counterTokenSymbol === 'WETH' ? 4 : 6))
            }}
            fiatEstimate={formatFiatEstimate(
              amountB,
              counterTokenSymbol,
              tokenPrices,
              livePoolRate > 0 ? livePoolRate : pool?.exchangeRate
            )}
            disabled={isProcessing}
          />
        </div>
      ) : (
        /* Single Token / Zap Deposit */
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
      )}

      {/* Arc Gas Shield Banner (Native Deposit Only) */}
      {depositSource === 'native' && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '8px 12px',
            background: 'rgba(56, 189, 248, 0.08)',
            border: '1px solid rgba(56, 189, 248, 0.2)',
            borderRadius: 10,
            marginBottom: 16,
            fontSize: 11,
            fontFamily: 'var(--font-app)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 12 }}>⛽</span>
            <span style={{ color: '#bae6fd' }}>
              <strong>Arcis Gas Protect:</strong> 0.50 USDC is automatically kept for transaction fees on MAX.
            </span>
          </div>
          {percentage === 100 && (
            <span
              style={{
                color: '#38bdf8',
                fontWeight: 700,
                fontSize: 10,
                background: 'rgba(56, 189, 248, 0.18)',
                padding: '2px 6px',
                borderRadius: 4,
                whiteSpace: 'nowrap',
              }}
            >
              -0.50 USDC Gas Reserved
            </span>
          )}
        </div>
      )}

      {/* Pre-Execution Summary Card for LP pools */}
      {isLp && inputAmountNum > 0 && (
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
              <span>Estimated LP Minted:</span>
              <InfoTooltip
                content="Estimated liquidity provider tokens minted based on pool reserves."
                position="top"
                align="start"
                size={11}
                iconClassName="w-3 h-3 text-slate-400 hover:text-indigo-300 cursor-help transition-colors"
              />
            </div>
            <span style={{ color: '#fff', fontWeight: 600 }}>
              {estimatedLpMinted ? `~${estimatedLpMinted} ${pool.lpTokenSymbol || 'LP'}` : 'Unavailable — live reserves required'}
            </span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', color: 'var(--fp-3)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <span>Pool Share:</span>
              <InfoTooltip
                content="Your proportional ownership percentage of the total liquidity pool."
                position="top"
                align="start"
                size={11}
                iconClassName="w-3 h-3 text-slate-400 hover:text-indigo-300 cursor-help transition-colors"
              />
            </div>
            <span style={{ color: 'var(--purple-1)', fontWeight: 600 }}>{estimatedPoolShare ? `~${estimatedPoolShare}%` : '—'}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', color: 'var(--fp-3)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <span>Projected Annual Return (Est. {pool.apy.toFixed(2)}% {pool.apyType}):</span>
              <InfoTooltip
                content="Projected annual earnings based on current pool APY."
                position="top"
                align="start"
                size={11}
                iconClassName="w-3 h-3 text-slate-400 hover:text-indigo-300 cursor-help transition-colors"
              />
            </div>
            <span style={{ color: 'var(--earned-green)', fontWeight: 600 }}>+{annualYield.toFixed(2)} USD</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', color: 'var(--fp-3)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <span>Slippage:</span>
              <InfoTooltip
                content="The maximum price difference tolerated before transaction reverts."
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

      {/* ── O2: Unbalanced dual-deposit donation warning ── */}
      {isDualDonationWarn && dualDepositBalance && (
        <div
          style={{
            background: isDualDonationBlock ? 'rgba(248, 113, 113, 0.08)' : 'rgba(251, 191, 36, 0.08)',
            border: `1px solid ${isDualDonationBlock ? 'rgba(248, 113, 113, 0.35)' : 'rgba(251, 191, 36, 0.35)'}`,
            borderRadius: 12,
            padding: '10px 14px',
            marginBottom: 16,
            fontSize: 11,
            fontFamily: 'var(--font-app)',
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: isDualDonationBlock ? '#fca5a5' : '#fcd34d' }}>
            <AlertTriangle size={14} />
            <span style={{ fontWeight: 700 }}>Unbalanced deposit — excess is donated to existing LPs</span>
          </div>
          <div style={{ color: 'var(--fp-3)', lineHeight: 1.5 }}>
            About <strong style={{ color: '#fff' }}>{dualDepositBalance.donationValueA.toFixed(2)} USDC</strong>{' '}
            ({donationPct.toFixed(2)}% of your deposit) is above the current pool ratio and would not
            mint any LP shares — it stays in the pool as a donation to existing LPs.
          </div>
          <button
            type="button"
            onClick={() => {
              const bDecimals = counterTokenDecimals
              setAmountA(dualDepositBalance.optimizedAmountA.toFixed(2))
              setAmountB(dualDepositBalance.optimizedAmountB.toFixed(bDecimals))
              setErrorMsg(null)
            }}
            style={{
              alignSelf: 'flex-start',
              background: 'rgba(152, 150, 255, 0.15)',
              border: '1px solid rgba(152, 150, 255, 0.35)',
              color: '#c7d2fe',
              fontWeight: 700,
              fontSize: 11,
              padding: '6px 10px',
              borderRadius: 8,
              cursor: 'pointer',
            }}
          >
            Balance amounts to pool ratio
          </button>
        </div>
      )}

      {/* Pre-Execution Summary Card for Vault */}
      {!isLp && inputAmountNum > 0 && (
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
            <span>Projected Annual Return (Est. {pool.apy.toFixed(2)}% {pool.apyType}):</span>
            <span style={{ color: 'var(--earned-green)', fontWeight: 600 }}>+{annualYield.toFixed(2)} USDC</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--fp-3)' }}>
            <span>Estimated Daily Yield:</span>
            <span style={{ color: 'var(--fp-2)' }}>+{dailyYield.toFixed(4)} USDC/day</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--fp-3)' }}>
            <span>Pool Share:</span>
            <span style={{ color: 'var(--purple-1)', fontWeight: 600 }}>{estimatedPoolShare ? `~${estimatedPoolShare}%` : '—'}</span>
          </div>
        </div>
      )}
    </div>
  )
}
