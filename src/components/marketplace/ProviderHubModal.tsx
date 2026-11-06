// src/components/marketplace/ProviderHubModal.tsx
// Developer & Provider Monetization Hub for x402 AI Services
// Tracks earnings and call metrics. Fee-bearing calls settle to the protocol treasury, so a
// withdrawal is a real USDC payout from that treasury to the provider's wallet.

import {
  Activity,
  CheckCircle2,
  Coins,
  PiggyBank,
  Plus,
  ShieldCheck,
  Sparkles,
  X,
  Zap,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import UsdcIcon from '../../assets/Token-Icon/USDC Token.svg'
import { soundService } from '../../services/soundService'
import {
  fetchCanonicalProviderLedger,
  getAccumulatedYieldVaultFees,
  getStoredProviderEarnings,
  withdrawProviderEarningsApi,
} from '../../services/x402PaymentEngine'
import type { UcwTypedDataChallenge } from '../../services/ucwChallengeSigner'
import type { x402Service } from '../../types/marketplace'
import type { ProviderLedger } from '../../types/x402'
import { addTransaction } from '../../utils/history'

interface ProviderHubModalProps {
  isOpen: boolean
  onClose: () => void
  walletAddress?: string
  provider?: any
  /** Active wallet type, so a Circle Wallet can authorize its own earnings withdrawal. */
  authSource?: 'passkey' | 'ucw' | 'evm' | null
  /** Circle Wallet typed-data challenge signer; a UCW EOA signs its ledger authorization. */
  ucwSignTypedData?: UcwTypedDataChallenge
  services: x402Service[]
  onOpenRegister: () => void
}

export default function ProviderHubModal({
  isOpen,
  onClose,
  walletAddress,
  provider,
  authSource,
  ucwSignTypedData,
  services,
  onOpenRegister,
}: ProviderHubModalProps) {
  const [unclaimedUsdc, setUnclaimedUsdc] = useState<number>(0)
  const [totalEarnedUsdc, setTotalEarnedUsdc] = useState<number>(0)
  const [totalCalls, setTotalCalls] = useState<number>(0)
  const [pendingUsdc, setPendingUsdc] = useState<number>(0)
  const [withdrawnUsdc, setWithdrawnUsdc] = useState<number>(0)
  const [yieldVaultTotal, setYieldVaultTotal] = useState<number>(0)
  const [claimSuccess, setClaimSuccess] = useState<boolean>(false)
  const [isClaiming, setIsClaiming] = useState<boolean>(false)
  const [claimError, setClaimError] = useState<string | null>(null)
  const [claimedTxHash, setClaimedTxHash] = useState<string | null>(null)
  const [isLoadingLedger, setIsLoadingLedger] = useState<boolean>(false)
  // Per-service rows come straight from the shared ledger, never inferred from provider totals.
  const [serviceRows, setServiceRows] = useState<ProviderLedger['services']>([])

  const activeAddress = walletAddress || ''

  const refreshData = () => {
    const earnings = getStoredProviderEarnings()
    const providerData = (activeAddress ? earnings[activeAddress.toLowerCase()] : null) || {
      totalCallsServed: 0,
      totalUsdcEarned: 0,
      unclaimedEarningsUsdc: 0,
    }
    setUnclaimedUsdc(providerData.unclaimedEarningsUsdc)
    setTotalEarnedUsdc(providerData.totalUsdcEarned)
    setTotalCalls(providerData.totalCallsServed)
    setYieldVaultTotal(getAccumulatedYieldVaultFees())
  }

  useEffect(() => {
    if (isOpen) {
      refreshData()
      setClaimSuccess(false)
      setClaimError(null)
      setClaimedTxHash(null)
      // Never show the previous wallet's settlement figures while the new ledger loads.
      setPendingUsdc(0)
      setWithdrawnUsdc(0)
      setServiceRows([])
      if (activeAddress) {
        setIsLoadingLedger(true)
        fetchCanonicalProviderLedger(activeAddress)
          .then((ledger) => {
            // Circle acceptance is not final settlement: pending stays visible until the
            // reconciler matches the transfer and moves it to available.
            if (ledger) {
              setPendingUsdc(Number(ledger.pendingUsdc) || 0)
              setWithdrawnUsdc(Number(ledger.withdrawnUsdc) || 0)
              setServiceRows(Array.isArray(ledger.services) ? ledger.services : [])
            }
          })
          .finally(() => {
            setIsLoadingLedger(false)
            refreshData()
          })
      }
    }
  }, [isOpen, activeAddress])

  if (!isOpen) return null

  const handleClaim = async () => {
    if (unclaimedUsdc <= 0 || !activeAddress) return
    soundService.play('pop')
    setIsClaiming(true)
    setClaimError(null)
    const amountToClaim = unclaimedUsdc

    try {
      // Never fabricate a claim hash: the hash only exists once the settlement returns one.
      let resolvedTx = ''
      const res = await withdrawProviderEarningsApi(activeAddress, amountToClaim, provider, {
        authSource,
        ucwSignTypedData,
      })

      if (res.success) {
        if (res.txHash) resolvedTx = res.txHash
      } else {
        setClaimError(res.error || 'Provider ledger operation was rejected.')
        soundService.play('error')
        return
      }

      setClaimedTxHash(resolvedTx || null)
      try {
        // Only record a history entry once there is a real on-chain hash to reference.
        if (resolvedTx) {
          addTransaction({
            type: 'ai_service',
            txHash: resolvedTx,
            amount: amountToClaim.toFixed(4),
            tokenSymbol: 'USDC',
            sourceChain: 'Arc Testnet',
            userAddress: activeAddress,
            recipient: activeAddress,
            status: 'success',
            serviceName: 'x402 Provider Revenue Settlement Claim',
          })
        }
      } catch (err) {
        console.warn('[ProviderHubModal] Failed to add claim to transaction history:', err)
      }

      soundService.play('success')
      setClaimSuccess(true)
      refreshData()
      setTimeout(() => setClaimSuccess(false), 6000)
    } catch (err: any) {
      setClaimError(err.message || 'Provider ledger operation failed')
      soundService.play('error')
    } finally {
      setIsClaiming(false)
    }
  }

  // Filter services associated with this provider
  const myServices = services.filter(
    (s) =>
      s.provider.address.toLowerCase() === activeAddress.toLowerCase() ||
      (s.listing?.ownerAddress && s.listing.ownerAddress.toLowerCase() === activeAddress.toLowerCase())
  )

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 overflow-y-auto">
      {/* Backdrop (blur 28px) */}
      <div
        className="fixed inset-0 bg-[#060810]/85 backdrop-blur-[28px] transition-opacity animate-fade-in"
        onClick={onClose}
      />

      {/* Modal Container: 28px superellipse, luxury obsidian surface */}
      <div
        className="relative w-full max-w-2xl rounded-[28px] overflow-hidden transition-all my-8 flex flex-col z-10"
        style={{
          background: 'linear-gradient(145deg, rgba(20, 24, 40, 0.98) 0%, rgba(14, 17, 30, 0.98) 60%, rgba(9, 11, 20, 0.99) 100%)',
          backdropFilter: 'blur(28px)',
          WebkitBackdropFilter: 'blur(28px)',
          border: '1px solid rgba(255, 255, 255, 0.08)',
          boxShadow: '0 32px 80px -16px rgba(0, 0, 0, 0.95), 0 0 0 1px rgba(255, 255, 255, 0.04), 0 0 40px rgba(152, 150, 255, 0.1)',
        }}
      >
        {/* Top Gradient Hairline */}
        <div
          className="h-[2px] w-full"
          style={{
            background: 'linear-gradient(90deg, transparent 0%, var(--purple-1) 50%, var(--secondary-colors--sky-sync) 100%)',
          }}
        />

        {/* Header */}
        <div
          className="flex items-center justify-between px-6 py-5 border-b border-white/10"
          style={{ background: 'rgba(15, 18, 32, 0.6)' }}
        >
          <div className="flex items-center gap-3.5">
            <div
              className="w-10 h-10 rounded-2xl border flex items-center justify-center text-white shadow-lg"
              style={{
                backgroundColor: 'rgba(152, 150, 255, 0.15)',
                borderColor: 'rgba(152, 150, 255, 0.3)',
                boxShadow: '0 0 16px rgba(152, 150, 255, 0.2)',
              }}
            >
              <PiggyBank className="w-5 h-5 text-[var(--purple-1)]" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="arc-eyebrow text-[10px] text-[var(--secondary-colors--sky-sync)]">
                  ARCIS X402 // PROVIDER MONETIZATION
                </span>
              </div>
              <h3
                className="text-base font-extrabold text-white tracking-tight"
                style={{ fontFamily: 'var(--font-display, Outfit, sans-serif)' }}
              >
                Provider Hub & Earnings
              </h3>
            </div>
          </div>

          <button
            onClick={() => {
              soundService.play('pop')
              onClose()
            }}
            className="p-2 rounded-xl text-white/40 hover:text-white border border-white/10 hover:border-white/20 transition cursor-pointer"
            style={{ background: 'rgba(9, 11, 20, 0.7)' }}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-6">
          {/* Revenue Claim Banner */}
          <div
            className="rounded-2xl p-5 border relative overflow-hidden"
            style={{
              background: 'linear-gradient(135deg, rgba(1, 208, 98, 0.08) 0%, rgba(15, 23, 42, 0.75) 100%)',
              borderColor: 'rgba(1, 208, 98, 0.3)',
            }}
          >
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <span className="text-xs text-[var(--earned-green)] font-mono">Withdrawable Balance · Treasury-held</span>
                <div
                  className="text-2xl sm:text-3xl font-extrabold text-white mt-1 flex items-center gap-2 tabular-nums"
                  style={{ fontFamily: 'var(--fonts--space-grotesk)' }}
                >
                  <span>{unclaimedUsdc.toFixed(4)}</span>
                  <img src={UsdcIcon} alt="USDC" className="w-6 h-6 rounded-full object-contain" />
                  <span className="text-sm font-normal text-white/50">USDC</span>
                </div>
                <span className="text-[11px] text-white/50">
                  Cumulative Total Earned:{' '}
                  <strong
                    className="text-white font-mono tabular-nums"
                    style={{ fontFamily: 'var(--fonts--space-grotesk)' }}
                  >
                    {totalEarnedUsdc.toFixed(4)} USDC
                  </strong>
                </span>
              </div>

              <button
                onClick={handleClaim}
                disabled={unclaimedUsdc <= 0 || isClaiming}
                className={`px-5 py-2.5 rounded-xl font-semibold text-xs tracking-wide transition-all duration-200 flex items-center justify-center gap-2 select-none ${
                  unclaimedUsdc > 0 && !isClaiming
                    ? 'bg-gradient-to-r from-indigo-500 via-indigo-600 to-purple-600 hover:from-indigo-400 hover:via-indigo-500 hover:to-purple-500 text-white shadow-lg shadow-indigo-500/25 active:scale-[0.99] cursor-pointer'
                    : 'bg-white/[0.04] text-slate-500 border border-white/[0.06] cursor-not-allowed opacity-80'
                }`}
                style={{ fontFamily: 'var(--font-app)' }}
              >
                {isClaiming ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    <span>SENDING PAYOUT...</span>
                  </>
                ) : (
                  <>
                    <Coins className="w-4 h-4 text-white" />
                    <span>WITHDRAW USDC</span>
                  </>
                )}
              </button>
            </div>

            {claimError && (
              <div className="mt-3 p-3 rounded-xl bg-rose-500/20 border border-rose-500/40 text-rose-300 text-xs flex items-center gap-2 animate-fade-in">
                <span>{claimError}</span>
              </div>
            )}

            {claimSuccess && (
              <div
                className="mt-3 p-3 rounded-xl border text-xs flex items-center justify-between gap-2 animate-fade-in"
                style={{
                  backgroundColor: 'rgba(1, 208, 98, 0.1)',
                  borderColor: 'rgba(1, 208, 98, 0.3)',
                  color: 'var(--earned-green)',
                }}
              >
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-[var(--earned-green)] flex-shrink-0" />
                  <span>{claimedTxHash ? 'Treasury paid this withdrawal on Arc Testnet.' : 'Withdrawal recorded.'}</span>
                </div>
                {claimedTxHash ? (
                  <a
                    href={`https://testnet.arcscan.app/tx/${claimedTxHash}`}
                    target="_blank"
                    rel="noreferrer"
                    className="underline text-[var(--earned-green)] hover:text-white font-mono text-[10px]"
                  >
                    View Receipt
                  </a>
                ) : null}
              </div>
            )}
          </div>

          {/* Metric Cards Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div
              className="p-3.5 rounded-2xl border border-white/5"
              style={{ background: 'rgba(11, 14, 25, 0.75)' }}
              title="Calls served by this provider wallet, read from the shared settlement ledger"
            >
              <span className="arc-eyebrow text-[10px] flex items-center gap-1.5 text-[var(--secondary-colors--sky-sync)]">
                <Activity className="w-3.5 h-3.5 text-[var(--secondary-colors--sky-sync)]" />
                <span>Total Calls</span>
              </span>
              <div
                className="text-lg font-bold text-white mt-1 tabular-nums"
                style={{ fontFamily: 'var(--fonts--space-grotesk)' }}
              >
                {totalCalls.toLocaleString()}
              </div>
            </div>

            <div
              className="p-3.5 rounded-2xl border border-white/5"
              style={{ background: 'rgba(11, 14, 25, 0.75)' }}
            >
              <span className="arc-eyebrow text-[10px] flex items-center gap-1.5 text-[var(--purple-1)]">
                <Sparkles className="w-3.5 h-3.5 text-[var(--purple-1)]" />
                <span>YieldVault</span>
              </span>
              <div
                className="text-lg font-bold mt-1 tabular-nums text-[var(--purple-1)]"
                style={{ fontFamily: 'var(--fonts--space-grotesk)' }}
              >
                ${yieldVaultTotal.toFixed(2)}
              </div>
              <div className="text-[10px] text-white/40 mt-0.5">Local metric only.</div>
            </div>

            <div
              className="p-3.5 rounded-2xl border border-white/5"
              style={{ background: 'rgba(11, 14, 25, 0.75)' }}
            >
              <span className="arc-eyebrow text-[10px] flex items-center gap-1.5 text-[var(--secondary-colors--blockstream-gold)]">
                <Zap className="w-3.5 h-3.5 text-[var(--secondary-colors--blockstream-gold)]" />
                <span>Pending</span>
              </span>
              <div
                className="text-lg font-bold mt-1 tabular-nums text-[var(--secondary-colors--blockstream-gold)]"
                style={{ fontFamily: 'var(--fonts--space-grotesk)' }}
              >
                ${pendingUsdc.toFixed(4)}
              </div>
              <div className="text-[10px] text-white/40 mt-0.5">Awaiting Circle reconciliation.</div>
            </div>

            <div
              className="p-3.5 rounded-2xl border border-white/5"
              style={{ background: 'rgba(11, 14, 25, 0.75)' }}
            >
              <span className="arc-eyebrow text-[10px] flex items-center gap-1.5 text-[var(--earned-green)]">
                <ShieldCheck className="w-3.5 h-3.5 text-[var(--earned-green)]" />
                <span>Withdrawn</span>
              </span>
              <div
                className="text-lg font-bold mt-1 tabular-nums text-[var(--earned-green)]"
                style={{ fontFamily: 'var(--fonts--space-grotesk)' }}
              >
                ${withdrawnUsdc.toFixed(4)}
              </div>
              <div className="text-[10px] text-white/40 mt-0.5">Ledger adjusted.</div>
            </div>
          </div>

          {/* Per-Service Breakdown (read from the shared settlement ledger) */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="arc-eyebrow text-xs font-bold text-white tracking-wider">
                Per-Service Breakdown
              </h4>
              <span className="text-[10px] text-white/40 font-mono">
                {serviceRows.length > 0
                  ? `${serviceRows.length} service${serviceRows.length === 1 ? '' : 's'}`
                  : 'no attributed calls'}
              </span>
            </div>

            {serviceRows.length === 0 ? (
              <div
                className="p-4 rounded-2xl border border-dashed border-white/10 text-center"
                style={{ background: 'rgba(8, 10, 18, 0.5)' }}
              >
                <p className="text-xs text-white/50">
                  {isLoadingLedger
                    ? 'Reading the shared settlement ledger…'
                    : 'No paid call has been attributed to one of your services yet.'}
                </p>
              </div>
            ) : (
              <div className="rounded-2xl border border-white/10 overflow-hidden">
                <div
                  className="grid grid-cols-[1fr_auto_auto_auto] gap-3 px-3 py-2 text-[10px] uppercase tracking-wider text-white/40 border-b border-white/10"
                  style={{ background: 'rgba(8, 10, 18, 0.9)', fontFamily: 'var(--fonts--space-mono)' }}
                >
                  <span>Service</span>
                  <span className="text-right">Calls</span>
                  <span className="text-right">Earned</span>
                  <span className="text-right">Pending</span>
                </div>
                <div className="max-h-44 overflow-y-auto" style={{ background: 'rgba(8, 10, 18, 0.6)' }}>
                  {serviceRows.map((row) => (
                    <div
                      key={row.serviceId}
                      className="grid grid-cols-[1fr_auto_auto_auto] gap-3 px-3 py-2 text-[11px] border-b border-white/[0.04] last:border-0"
                    >
                      <span
                        className="truncate text-white"
                        title={row.serviceId}
                        style={{ fontFamily: 'var(--font-app)' }}
                      >
                        {services.find((service) => service.id === row.serviceId)?.name || row.serviceId}
                      </span>
                      <span
                        className="text-right tabular-nums text-white/80"
                        style={{ fontFamily: 'var(--fonts--space-grotesk)' }}
                      >
                        {row.callsServed.toLocaleString()}
                      </span>
                      <span
                        className="text-right tabular-nums text-[var(--earned-green)]"
                        style={{ fontFamily: 'var(--fonts--space-grotesk)' }}
                      >
                        ${row.grossUsdc.toFixed(4)}
                      </span>
                      <span
                        className="text-right tabular-nums text-[var(--secondary-colors--blockstream-gold)]"
                        style={{ fontFamily: 'var(--fonts--space-grotesk)' }}
                      >
                        ${row.pendingUsdc.toFixed(4)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Registered Services Section */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="arc-eyebrow text-xs font-bold text-white tracking-wider">
                Your Published Services ({myServices.length})
              </h4>

              <button
                onClick={() => {
                  soundService.play('pop')
                  onClose()
                  onOpenRegister()
                }}
                className="text-xs font-mono font-semibold text-[var(--secondary-colors--sky-sync)] hover:text-white flex items-center gap-1 cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Add New Service</span>
              </button>
            </div>

            {myServices.length === 0 ? (
              <div
                className="p-6 rounded-2xl border border-dashed border-white/10 text-center space-y-2"
                style={{ background: 'rgba(8, 10, 18, 0.5)' }}
              >
                <p className="text-xs text-white/50">
                  You haven't listed any AI services yet.
                </p>
                <button
                  onClick={() => {
                    soundService.play('pop')
                    onClose()
                    onOpenRegister()
                  }}
                  className="text-xs text-[var(--purple-1)] hover:text-white font-mono cursor-pointer underline"
                >
                  List your first x402 AI service on Arc Testnet
                </button>
              </div>
            ) : (
              <div className="space-y-2 max-h-48 overflow-y-auto">
                {myServices.map((srv) => (
                  <div
                    key={srv.id}
                    className="p-3 rounded-xl border border-white/10 flex items-center justify-between text-xs"
                    style={{ background: 'rgba(8, 10, 18, 0.7)' }}
                  >
                    <div className="space-y-0.5">
                      <div className="font-bold text-white flex items-center gap-1.5 flex-wrap">
                        <span style={{ fontFamily: 'var(--font-display, Outfit, sans-serif)' }}>{srv.name}</span>
                        <div
                          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md border text-[10px] text-white font-mono"
                          style={{ background: 'rgba(255, 255, 255, 0.05)', borderColor: 'rgba(255, 255, 255, 0.08)' }}
                        >
                          <img src={UsdcIcon} alt="USDC" className="w-3 h-3 rounded-full object-contain" />
                          <span className="tabular-nums">{srv.pricing.priceUsdc} USDC/call</span>
                        </div>
                      </div>
                      <span className="text-[10px] text-white/40 font-mono">
                        {srv.upstream?.url || srv.serve.path}
                      </span>
                    </div>

                    <div className="text-right font-mono">
                      <span className="text-[var(--earned-green)] font-bold text-xs">
                        100% Pass-Through
                      </span>
                      <div className="text-[10px] text-white/50 tabular-nums">
                        ${srv.pricing.priceUsdc.toFixed(4)} USDC/call
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body
  )
}
