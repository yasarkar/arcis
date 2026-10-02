// src/components/marketplace/ProviderHubModal.tsx
// Developer & Provider Monetization Hub for x402 AI Services
// Tracks earnings and call metrics; provider withdrawals are internal ledger adjustments only.

import React, { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import {
  X,
  PiggyBank,
  Sparkles,
  TrendingUp,
  Coins,
  ShieldCheck,
  Zap,
  Activity,
  CheckCircle2,
  Plus,
  ArrowUpRight,
} from 'lucide-react'
import {
  getStoredProviderEarnings,
  getAccumulatedYieldVaultFees,
  fetchCanonicalProviderLedger,
  withdrawProviderEarningsApi,
} from '../../services/x402PaymentEngine'
import { soundService } from '../../services/soundService'
import { addTransaction } from '../../utils/history'
import type { x402Service } from '../../types/marketplace'
import UsdcIcon from '../../assets/Token-Icon/USDC Token.svg'

interface ProviderHubModalProps {
  isOpen: boolean
  onClose: () => void
  walletAddress?: string
  provider?: any
  services: x402Service[]
  onOpenRegister: () => void
}

export default function ProviderHubModal({
  isOpen,
  onClose,
  walletAddress,
  provider,
  services,
  onOpenRegister,
}: ProviderHubModalProps) {
  const [unclaimedUsdc, setUnclaimedUsdc] = useState<number>(0)
  const [totalEarnedUsdc, setTotalEarnedUsdc] = useState<number>(0)
  const [totalCalls, setTotalCalls] = useState<number>(0)
  const [yieldVaultTotal, setYieldVaultTotal] = useState<number>(0)
  const [claimSuccess, setClaimSuccess] = useState<boolean>(false)
  const [isClaiming, setIsClaiming] = useState<boolean>(false)
  const [claimError, setClaimError] = useState<string | null>(null)
  const [claimedTxHash, setClaimedTxHash] = useState<string | null>(null)
  const [isLoadingLedger, setIsLoadingLedger] = useState<boolean>(false)

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
      if (activeAddress) {
        setIsLoadingLedger(true)
        fetchCanonicalProviderLedger(activeAddress).finally(() => {
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
      const res = await withdrawProviderEarningsApi(activeAddress, amountToClaim, provider)

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
      <div
        className="fixed inset-0 bg-black/80 backdrop-blur-md transition-opacity animate-fade-in"
        onClick={onClose}
      />

      <div
        className="relative w-full max-w-2xl rounded-3xl overflow-hidden shadow-2xl transition-all border border-indigo-500/30 my-8 flex flex-col"
        style={{
          background: 'linear-gradient(180deg, rgba(16, 19, 34, 0.98) 0%, rgba(10, 12, 22, 0.99) 100%)',
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.8), 0 0 40px rgba(99, 102, 241, 0.2)',
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-5 border-b border-slate-800/80 bg-slate-900/40">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-white shadow-lg shadow-indigo-500/30">
              <PiggyBank className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-white tracking-tight flex items-center gap-2">
                <span>Provider Hub & Monetization</span>
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 font-semibold border border-emerald-500/30">
                  x402 Monetization
                </span>
              </h3>
              <p className="text-xs text-slate-400 font-mono">
                {activeAddress.substring(0, 8)}...{activeAddress.substring(activeAddress.length - 6)}
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-6">
          {/* Revenue Claim Banner */}
          <div
            className="rounded-2xl p-5 border border-emerald-500/30 relative overflow-hidden"
            style={{
              background: 'linear-gradient(135deg, rgba(6, 78, 59, 0.25) 0%, rgba(15, 23, 42, 0.6) 100%)',
            }}
          >
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <span className="text-xs text-emerald-300 font-medium">Internal Ledger Balance (not wallet USDC)</span>
                <div className="text-2xl sm:text-3xl font-extrabold text-white font-mono mt-1 flex items-center gap-2">
                  <img src={UsdcIcon} alt="USDC" className="w-6 h-6 rounded-full object-contain" />
                  <span>${unclaimedUsdc.toFixed(4)}</span>
                  <span className="text-sm font-normal text-slate-400">USDC</span>
                </div>
                <span className="text-[11px] text-slate-400">
                  Cumulative Total Earned: <strong className="text-white font-mono">${totalEarnedUsdc.toFixed(4)} USDC</strong>
                </span>
              </div>

              <button
                onClick={handleClaim}
                disabled={unclaimedUsdc <= 0 || isClaiming}
                className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 hover:brightness-110 text-white font-bold text-xs shadow-lg shadow-emerald-500/25 transition flex items-center justify-center gap-2 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {isClaiming ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    <span>Authorizing Ledger Adjustment...</span>
                  </>
                ) : (
                  <>
                    <Coins className="w-4 h-4" />
                    <span>Authorize Ledger Adjustment</span>
                  </>
                )}
              </button>
            </div>

            {claimError && (
              <div className="mt-3 p-2.5 rounded-xl bg-rose-500/20 border border-rose-500/40 text-rose-300 text-xs flex items-center gap-2 animate-fade-in">
                <span>{claimError}</span>
              </div>
            )}

            {claimSuccess && (
              <div className="mt-3 p-2.5 rounded-xl bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 text-xs flex items-center justify-between gap-2 animate-fade-in">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" />
                  <span>Internal ledger adjusted. No USDC was paid out to a wallet.</span>
                </div>
                {claimedTxHash ? (
                  <a
                    href={`https://testnet.arcscan.app/tx/${claimedTxHash}`}
                    target="_blank"
                    rel="noreferrer"
                    className="underline text-emerald-200 hover:text-white font-mono text-[10px]"
                  >
                    View Receipt
                  </a>
                ) : (
                  <span className="text-[10px] text-amber-300 font-mono">Off-chain ledger only</span>
                )}
              </div>
            )}
          </div>

          {/* Metric Cards Grid */}
          <div className="grid grid-cols-3 gap-3">
            <div className="p-3.5 rounded-2xl bg-slate-900/60 border border-slate-800">
              <span className="text-[11px] text-slate-400 flex items-center gap-1.5">
                <Activity className="w-3.5 h-3.5 text-cyan-400" />
                <span>Total Calls</span>
              </span>
              <div className="text-lg font-bold text-white font-mono mt-1">
                {totalCalls.toLocaleString()}
              </div>
            </div>

            <div className="p-3.5 rounded-2xl bg-slate-900/60 border border-slate-800">
              <span className="text-[11px] text-slate-400 flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-purple-400" />
                <span>YieldVault Backing</span>
              </span>
              <div className="text-lg font-bold text-purple-300 font-mono mt-1">
                ${yieldVaultTotal.toFixed(2)} USDC
              </div>
              <div className="text-[10px] text-slate-500">Local metric only; no protocol fee transfer occurred.</div>
            </div>

            <div className="p-3.5 rounded-2xl bg-slate-900/60 border border-slate-800">
              <span className="text-[11px] text-slate-400 flex items-center gap-1.5">
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                <span>Verified</span>
              </span>
              <div className="text-lg font-bold text-emerald-400 mt-1">
                Active Provider
              </div>
            </div>
          </div>

          {/* Registered Services Section */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="text-xs font-bold text-slate-300 uppercase tracking-wider">
                Your Published Services ({myServices.length})
              </h4>

              <button
                onClick={() => {
                  onClose()
                  onOpenRegister()
                }}
                className="text-xs font-semibold text-indigo-400 hover:text-indigo-300 flex items-center gap-1 cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Add New Service</span>
              </button>
            </div>

            {myServices.length === 0 ? (
              <div className="p-6 rounded-2xl bg-slate-950/40 border border-dashed border-slate-800 text-center space-y-2">
                <p className="text-xs text-slate-400">
                  You haven't listed any AI services yet.
                </p>
                <button
                  onClick={() => {
                    onClose()
                    onOpenRegister()
                  }}
                  className="text-xs text-indigo-400 hover:text-indigo-300 font-semibold cursor-pointer underline"
                >
                  List your first x402 AI service on Arc Testnet
                </button>
              </div>
            ) : (
              <div className="space-y-2 max-h-48 overflow-y-auto">
                {myServices.map((srv) => (
                  <div
                    key={srv.id}
                    className="p-3 rounded-xl bg-slate-950/60 border border-slate-800/80 flex items-center justify-between text-xs"
                  >
                    <div className="space-y-0.5">
                      <div className="font-bold text-white flex items-center gap-1.5 flex-wrap">
                        <span>{srv.name}</span>
                        <div className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-slate-900 border border-slate-800 text-[10px] text-slate-300 font-mono">
                          <img src={UsdcIcon} alt="USDC" className="w-3 h-3 rounded-full object-contain" />
                          <span>{srv.pricing.priceUsdc} USDC/call</span>
                        </div>
                      </div>
                      <span className="text-[10px] text-slate-500 font-mono">
                        {srv.upstream?.url || srv.serve.path}
                      </span>
                    </div>

                    <div className="text-right font-mono">
                      <span className="text-emerald-400 font-bold">
                        100% Direct Pass-Through
                      </span>
                      <div className="text-[10px] text-slate-400">
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
