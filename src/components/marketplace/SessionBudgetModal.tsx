// src/components/marketplace/SessionBudgetModal.tsx
// Ephemeral Session EOA & Budget Manager for Arcis x402 AI Services
// Implements ADR-004 Option 4.2: Client-Isolated Session EOA + Dedicated Budget

import React, { useState, useEffect, useMemo } from 'react'
import { createPortal } from 'react-dom'
import {
  X,
  Zap,
  ShieldCheck,
  RefreshCw,
  Copy,
  Check,
  ExternalLink,
  Coins,
  Lock,
  Sliders,
  AlertCircle,
  Clock,
  Sparkles,
  ArrowRight,
  Flame,
} from 'lucide-react'
import {
  getSessionKeyConfig,
  saveSessionKeyConfig,
  activateSessionKey,
  revokeSessionKey,
  toggleSessionAutoExecute,
  getSessionTimeRemaining,
  SESSION_KEY_UPDATED_EVENT,
} from '../../services/sessionKeyService'
import {
  getStoredMscaAddress,
  sendModularUserOperation,
  createModularUsdcTransferCall,
} from '../../services/modularWalletService'
import { POOL_CONTRACTS, ERC20_ABI } from '../../config/poolsConfig'
import { getArcPublicClient } from '../../services/rpc'
import { arcTestnet } from '../../config/arcChain'
import { soundService } from '../../services/soundService'
import { addTransaction } from '../../utils/history'
import { createWalletClient, custom, parseUnits, type Hex } from 'viem'
import UsdcIcon from '../../assets/Token-Icon/USDC Token.svg'

interface SessionBudgetModalProps {
  isOpen: boolean
  onClose: () => void
  walletAddress?: string
  provider?: any
  onBudgetUpdated?: (newMax: number) => void
}

export default function SessionBudgetModal({
  isOpen,
  onClose,
  walletAddress,
  provider,
  onBudgetUpdated,
}: SessionBudgetModalProps) {
  const [config, setConfig] = useState(() => getSessionKeyConfig(walletAddress))
  const [customBudget, setCustomBudget] = useState<string>('2.00')
  const [selectedDuration, setSelectedDuration] = useState<number>(24)
  const [copiedKey, setCopiedKey] = useState<boolean>(false)
  const [isFunding, setIsFunding] = useState<boolean>(false)
  const [fundSuccess, setFundSuccess] = useState<string | null>(null)
  const [fundError, setFundError] = useState<string | null>(null)

  // Listen for session key updates
  useEffect(() => {
    const handleUpdate = (e: any) => {
      if (e?.detail) {
        if (!e.detail.walletAddress || !walletAddress || e.detail.walletAddress.toLowerCase() === walletAddress.toLowerCase()) {
          setConfig(e.detail)
        }
      } else {
        setConfig(getSessionKeyConfig(walletAddress))
      }
    }
    window.addEventListener(SESSION_KEY_UPDATED_EVENT, handleUpdate)
    return () => window.removeEventListener(SESSION_KEY_UPDATED_EVENT, handleUpdate)
  }, [walletAddress])

  // Sync on modal open
  useEffect(() => {
    if (isOpen) {
      setConfig(getSessionKeyConfig(walletAddress))
      setFundSuccess(null)
      setFundError(null)
    }
  }, [isOpen, walletAddress])

  // Time remaining
  const timeRemaining = useMemo(() => {
    return getSessionTimeRemaining(config.expiresAt)
  }, [config.expiresAt])

  if (!isOpen) return null

  const handleCopyAddress = () => {
    if (!config.sessionPublicKey) return
    navigator.clipboard.writeText(config.sessionPublicKey)
    soundService.play('pop')
    setCopiedKey(true)
    setTimeout(() => setCopiedKey(false), 2000)
  }

  const handleActivateNew = async (budgetUsdc: number, durationHours: number) => {
    soundService.play('pop')
    const updated = await activateSessionKey({
      // This local EOA is not on-chain delegated; consent must not activate autonomous signing.
      userApproved: false,
      maxSpendUsdc: budgetUsdc,
      durationHours,
      autoExecute: false,
      mscaAddress: walletAddress || getStoredMscaAddress() || undefined,
      walletAddress,
    })
    setConfig(updated)
    if (onBudgetUpdated) onBudgetUpdated(budgetUsdc)
    soundService.play('success')
  }

  const handleRevoke = () => {
    soundService.play('pop')
    const revoked = revokeSessionKey(walletAddress)
    setConfig(revoked)
  }

  const handleToggleAuto = () => {
    soundService.play('pop')
    const updated = toggleSessionAutoExecute(false, walletAddress)
    setConfig(updated)
  }

  // 1-Click Funding from connected wallet/MSCA (ADR-004 Option 4.2)
  const handleFundSessionEoa = async (amount: number) => {
    const msca = getStoredMscaAddress()
    const currentConfig = getSessionKeyConfig(walletAddress || msca || undefined)
    if (!currentConfig.sessionPublicKey) {
      setFundError('Session EOA is unavailable until an on-chain SessionKeyModule delegation is implemented. No transfer was attempted.')
      return
    }

    soundService.play('pop')
    setIsFunding(true)
    setFundSuccess(null)
    setFundError(null)

    const sessionRecipient = currentConfig.sessionPublicKey as Hex

    try {
      let resolvedTx: Hex

      if (msca) {
        // Option A: Circle MSCA Passkey UserOp
        const call = createModularUsdcTransferCall(sessionRecipient, amount)
        const res = await sendModularUserOperation({ calls: [call], paymaster: true })
        if (!res.success || !res.txHash) {
          throw new Error(res.error || 'Passkey UserOp execution failed')
        }
        // sendModularUserOperation may return the user-op hash when its receipt poll times out.
        // That is not an on-chain transaction receipt and must not count as funding confirmation.
        if (res.userOpHash && res.txHash.toLowerCase() === res.userOpHash.toLowerCase()) {
          throw new Error('Funding is still pending in the bundler. The session budget was not increased.')
        }
        resolvedTx = res.txHash as Hex
      } else if ((provider || (typeof window !== 'undefined' && (window as any).ethereum)) && walletAddress) {
        // Option B: Connected EIP-1193 Web3 Wallet
        const effective = provider || (window as any).ethereum
        const walletClient = createWalletClient({
          account: walletAddress as Hex,
          chain: arcTestnet,
          transport: custom(effective),
        })
        resolvedTx = await walletClient.writeContract({
          address: POOL_CONTRACTS.USDC as Hex,
          abi: ERC20_ABI,
          functionName: 'transfer',
          args: [sessionRecipient, parseUnits(amount.toString(), 6)],
        })
      } else {
        throw new Error('Connect a wallet or sign in with a Passkey before funding the Session EOA. No USDC was transferred.')
      }

      const receipt = await getArcPublicClient().waitForTransactionReceipt({
        hash: resolvedTx,
        timeout: 45_000,
      })
      if (receipt.status !== 'success' || receipt.transactionHash.toLowerCase() !== resolvedTx.toLowerCase()) {
        throw new Error('The Session EOA funding transaction has no matching successful receipt. Its budget was not increased.')
      }

      // This is a client-side spending ceiling, not an on-chain escrow or MSCA delegation.
      // Preserve the existing ephemeral key: activateSessionKey creates a brand-new EOA.
      const updated = {
        ...getSessionKeyConfig(walletAddress || msca || undefined),
        maxSpendUsdc: Number((currentConfig.maxSpendUsdc + amount).toFixed(2)),
      }
      saveSessionKeyConfig(updated, true, walletAddress || msca || undefined)
      setConfig(updated)
      if (onBudgetUpdated) onBudgetUpdated(updated.maxSpendUsdc)

      addTransaction({
        type: 'ai_service',
        txHash: resolvedTx,
        amount: amount.toFixed(2),
        tokenSymbol: 'USDC',
        sourceChain: 'Arc Testnet',
        userAddress: walletAddress || msca,
        recipient: sessionRecipient,
        status: 'success',
        serviceName: 'Direct USDC transfer to Local Session EOA (no delegated execution)',
      })

      soundService.play('success')
      setFundSuccess(`Session EOA received $${amount.toFixed(2)} USDC. Transaction confirmed.`)
      setTimeout(() => setFundSuccess(null), 5000)
    } catch (err: any) {
      console.error('Session funding failed:', err)
      setFundError(err?.message || 'Failed to fund session EOA')
      soundService.play('error')
    } finally {
      setIsFunding(false)
    }
  }

  const spentPercent = Math.min(100, (config.spentUsdc / (config.maxSpendUsdc || 1)) * 100)
  const isSessionActive = config.isActive && Date.now() <= config.expiresAt

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 overflow-y-auto">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-[#060810]/85 backdrop-blur-xl transition-all duration-300 animate-fade-in"
        onClick={onClose}
      />

      {/* Modal Container */}
      <div
        className="relative w-full max-w-xl rounded-3xl overflow-hidden shadow-2xl transition-all border border-indigo-500/30 my-auto flex flex-col bg-[#0b0e17]/95 backdrop-blur-2xl z-10"
        style={{
          boxShadow: '0 25px 70px -15px rgba(0,0,0,0.95), 0 0 50px rgba(99,102,241,0.2)',
        }}
      >
        {/* Top Gradient Hairline */}
        <div className="h-[2px] w-full bg-gradient-to-r from-transparent via-cyan-400 to-indigo-500" />

        {/* Header */}
        <div className="px-6 py-5 border-b border-slate-800/80 bg-slate-900/40 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-indigo-500 to-cyan-500 flex items-center justify-center text-white shadow-lg shadow-indigo-500/25">
              <Zap className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base font-extrabold text-white tracking-tight">
                  Session Key & Budget Manager
                </h3>
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 font-bold border border-indigo-500/30">
                  ADR-004
                </span>
              </div>
              <p className="text-xs text-slate-400 font-normal">
                Local spending cap and session EOA funding controls
              </p>
            </div>
          </div>

          <button
            onClick={() => {
              soundService.play('pop')
              onClose()
            }}
            className="p-1.5 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-5 overflow-y-auto max-h-[80vh]">
          {/* Ephemeral Identity Card */}
          <div className="p-4 rounded-2xl bg-slate-950/70 border border-slate-800 space-y-3">
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-400 font-medium flex items-center gap-1.5">
                <ShieldCheck className="w-3.5 h-3.5 text-cyan-400" />
                <span>Session Account Address</span>
              </span>
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 font-semibold">
                Client Isolated (I5)
              </span>
            </div>

            <div className="flex items-center justify-between gap-2 p-2.5 rounded-xl bg-slate-900 border border-slate-800 font-mono text-xs">
              <span className="text-indigo-300 truncate font-semibold">
                {config.sessionPublicKey || 'Unavailable — on-chain delegation not configured'}
              </span>
              <div className="flex items-center gap-1">
                <button
                  onClick={handleCopyAddress}
                  className="p-1 rounded text-slate-400 hover:text-white hover:bg-slate-800 transition cursor-pointer"
                  title="Copy address"
                >
                  {copiedKey ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                </button>
                {config.sessionPublicKey && (
                  <a
                    href={`https://testnet.arcscan.app/address/${config.sessionPublicKey}`}
                    target="_blank"
                    rel="noreferrer"
                    className="p-1 rounded text-slate-400 hover:text-cyan-300 transition"
                    title="View on ArcScan"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                )}
              </div>
            </div>

            <p className="text-[11px] text-slate-400 leading-relaxed">
              No session EOA key is currently provisioned. The displayed limits are local metadata only, not an on-chain delegation; automated signing and paid x402 calls remain disabled.
            </p>
          </div>

          {/* Current Budget & Usage Ribbon */}
          <div className="p-4 rounded-2xl bg-gradient-to-r from-indigo-950/40 via-purple-950/20 to-slate-950/60 border border-indigo-500/30 space-y-3">
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-300 font-bold uppercase tracking-wider text-[11px]">
                {isSessionActive ? 'Active Spending Envelope' : 'Configured Envelope (inactive)'}
              </span>
              <span className="text-xs text-indigo-300 font-mono flex items-center gap-1">
                <Clock className="w-3.5 h-3.5 text-indigo-400" />
                <span>{timeRemaining.formatted}</span>
              </span>
            </div>

            <div className="flex items-baseline justify-between">
              <div>
                <span className="text-2xl font-extrabold text-white font-mono">
                  ${config.spentUsdc.toFixed(4)}
                </span>
                <span className="text-sm text-slate-400 font-mono"> / ${config.maxSpendUsdc.toFixed(2)} USDC spending cap</span>
              </div>
              <span className="text-xs font-mono text-emerald-400 font-bold">
                ${Math.max(0, config.maxSpendUsdc - config.spentUsdc).toFixed(4)} remaining
              </span>
            </div>

            {/* Progress bar */}
            <div className="w-full h-2 rounded-full bg-slate-900 overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-emerald-400 via-cyan-400 to-indigo-500 rounded-full transition-all duration-500"
                style={{ width: `${spentPercent}%` }}
              />
            </div>
          </div>

          {/* Funding & Quick Top-Up (ADR-004 Option 4.2) */}
          <div className="space-y-3">
            <div className="flex items-center justify-between text-xs">
              <span className="text-xs font-bold text-slate-200 flex items-center gap-1.5">
                <Coins className="w-4 h-4 text-emerald-400" />
                <span>Top-Up Session Budget</span>
              </span>
              <span className="text-[11px] text-slate-400">Available after delegated account setup</span>
            </div>

            <p className="text-[11px] text-slate-400 leading-relaxed">
              This spending cap is local session metadata, not an on-chain escrow or MSCA delegation. These buttons transfer USDC to the separate session EOA; the balance is not spendable through zero-popup automation, which remains disabled until on-chain delegation exists.
            </p>

            <div className="grid grid-cols-4 gap-2">
              {[1.0, 2.0, 5.0, 10.0].map((amt) => (
                <button
                  key={amt}
                  onClick={() => handleFundSessionEoa(amt)}
                  disabled={isFunding || !config.sessionPublicKey}
                  className="py-2.5 px-3 rounded-xl bg-slate-900 hover:bg-indigo-600/30 text-white font-mono text-xs font-bold border border-slate-800 hover:border-indigo-500/50 transition flex flex-col items-center justify-center gap-1 cursor-pointer disabled:opacity-50"
                >
                  <span>+${amt.toFixed(2)}</span>
                  <span className="text-[10px] text-indigo-300 font-sans font-normal">USDC</span>
                </button>
              ))}
            </div>

            {fundSuccess && (
              <div className="p-2.5 rounded-xl bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 text-xs flex items-center gap-2 animate-fade-in">
                <Check className="w-4 h-4 text-emerald-400 flex-shrink-0" />
                <span>{fundSuccess}</span>
              </div>
            )}

            {fundError && (
              <div className="p-2.5 rounded-xl bg-rose-500/20 border border-rose-500/40 text-rose-300 text-xs flex items-center gap-2 animate-fade-in">
                <AlertCircle className="w-4 h-4 text-rose-400 flex-shrink-0" />
                <span>{fundError}</span>
              </div>
            )}
          </div>

          {/* Configuration Controls */}
          <div className="p-4 rounded-2xl bg-slate-950/70 border border-slate-800 space-y-3 text-xs">
            <div className="flex items-center justify-between">
              <div>
                <span className="font-bold text-white block">Auto-Execution Mode</span>
                <span className="text-[11px] text-slate-400">
                  Local preference only; it does not authorize paid calls by itself
                </span>
              </div>
              <button
                onClick={handleToggleAuto}
                disabled
                title="Unavailable until the session key is delegated on-chain"
                className="px-3 py-1.5 rounded-xl text-xs font-bold border bg-slate-800 text-slate-400 border-slate-700 opacity-70 cursor-not-allowed"
              >
                Manual 1-Click
              </button>
            </div>

            <div className="pt-2 border-t border-slate-800/80 flex items-center justify-between">
              <div>
                <span className="font-bold text-white block">Single-Tx Cap</span>
                <span className="text-[11px] text-slate-400">
                  Local per-call ceiling; no on-chain delegation is configured
                </span>
              </div>
              <span className="font-mono text-indigo-300 font-semibold">
                ${config.maxPerTxUsdc.toFixed(2)} USDC
              </span>
            </div>
          </div>

          {/* Danger Zone: Revoke */}
          <div className="pt-2 flex items-center justify-between">
            <button
              onClick={handleRevoke}
              className="text-xs text-rose-400 hover:text-rose-300 font-medium transition cursor-pointer flex items-center gap-1.5"
            >
              <Flame className="w-3.5 h-3.5" />
              <span>Revoke & Purge Key</span>
            </button>

            <button
              onClick={() => handleActivateNew(parseFloat(customBudget) || 2.0, selectedDuration)}
              className="px-4 py-2 rounded-xl bg-gradient-to-r from-indigo-600 to-cyan-600 hover:brightness-110 text-white font-bold text-xs transition flex items-center gap-1.5 shadow-md shadow-indigo-600/20 cursor-pointer"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>Reset / Refresh Session</span>
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  )
}
