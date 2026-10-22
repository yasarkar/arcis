// src/components/marketplace/SessionBudgetModal.tsx
// Session Budget Manager for Arcis x402 AI Services
// Applies a local spending ceiling + duration policy. No session EOA or on-chain
// delegation exists yet, so these controls never move USDC.

import {
  Check,
  Clock,
  Copy,
  ExternalLink,
  Flame,
  RefreshCw,
  ShieldCheck,
  X,
  Zap,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { getStoredMscaAddress } from '../../services/modularWalletService'
import {
  activateSessionKey,
  getSessionKeyConfig,
  getSessionTimeRemaining,
  revokeSessionKey,
  SESSION_KEY_UPDATED_EVENT,
  toggleSessionAutoExecute,
} from '../../services/sessionKeyService'
import { soundService } from '../../services/soundService'

interface SessionBudgetModalProps {
  isOpen: boolean
  onClose: () => void
  walletAddress?: string
  onBudgetUpdated?: (newMax: number) => void
}

export default function SessionBudgetModal({
  isOpen,
  onClose,
  walletAddress,
  onBudgetUpdated,
}: SessionBudgetModalProps) {
  const [config, setConfig] = useState(() => getSessionKeyConfig(walletAddress))
  const [customBudget, setCustomBudget] = useState<string>('2.00')
  const [selectedDuration, setSelectedDuration] = useState<number>(24)
  const [copiedKey, setCopiedKey] = useState<boolean>(false)

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
      userApproved: true,
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

  const remainingUsdc = Math.max(0, config.maxSpendUsdc - config.spentUsdc)
  const remainingRatio = config.maxSpendUsdc > 0 ? Math.min(1, Math.max(0, remainingUsdc / config.maxSpendUsdc)) : 0
  const strokeDashoffset = 351.86 * (1 - remainingRatio)
  const estimatedCalls = Math.floor(remainingUsdc / 0.002)
  const isSessionActive = config.isActive && Date.now() <= config.expiresAt

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 overflow-y-auto">
      {/* Backdrop (blur 28px) */}
      <div
        className="fixed inset-0 bg-[#060810]/85 backdrop-blur-[28px] transition-all duration-300 animate-fade-in"
        onClick={onClose}
      />

      {/* Modal Container: 28px superellipse, luxury obsidian surface */}
      <div
        className="relative w-full max-w-xl rounded-[28px] overflow-hidden transition-all my-auto flex flex-col z-10"
        style={{
          background: 'linear-gradient(145deg, rgba(18, 22, 38, 0.98) 0%, rgba(12, 15, 28, 0.98) 60%, rgba(8, 10, 20, 0.99) 100%)',
          backdropFilter: 'blur(28px)',
          WebkitBackdropFilter: 'blur(28px)',
          border: '1px solid rgba(255, 255, 255, 0.08)',
          boxShadow: '0 32px 80px -16px rgba(0, 0, 0, 0.95), 0 0 0 1px rgba(255, 255, 255, 0.04), 0 0 50px rgba(112, 88, 248, 0.15)',
        }}
      >
        {/* Ambient Top Glow */}
        <div className="absolute top-0 right-0 w-80 h-80 bg-[radial-gradient(circle,rgba(112,88,248,0.14)_0%,transparent_70%)] pointer-events-none" />

        {/* Top Gradient Hairline */}
        <div
          className="h-[2px] w-full"
          style={{
            background: 'linear-gradient(90deg, transparent 0%, var(--color-brand-cyan) 30%, var(--purple-1) 70%, var(--earned-green) 100%)',
          }}
        />

        {/* Header */}
        <div
          className="relative px-6 py-5 border-b border-white/[0.06] flex items-center justify-between"
          style={{ background: 'rgba(15, 18, 32, 0.4)' }}
        >
          <div className="flex items-center gap-3.5">
            <div
              className="w-10 h-10 rounded-2xl border flex items-center justify-center text-white shadow-lg"
              style={{
                backgroundColor: 'rgba(112, 88, 248, 0.15)',
                borderColor: 'rgba(112, 88, 248, 0.3)',
                boxShadow: '0 0 20px rgba(112, 88, 248, 0.25)',
              }}
            >
              <Zap className="w-5 h-5 text-[var(--color-brand-cyan)]" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="arc-eyebrow text-[10px] text-[var(--secondary-colors--sky-sync)] font-semibold tracking-wider">
                  ARCIS X402 // SESSION AUTHORITY
                </span>
              </div>
              <h3
                className="text-base font-extrabold text-white tracking-tight"
                style={{ fontFamily: 'var(--font-display, Outfit, sans-serif)' }}
              >
                Session Key & Autonomous Enclave
              </h3>
            </div>
          </div>

          <button
            onClick={() => {
              soundService.play('pop')
              onClose()
            }}
            className="w-8 h-8 rounded-xl bg-white/[0.04] border border-white/[0.08] hover:bg-white/[0.08] text-slate-400 hover:text-white transition flex items-center justify-center cursor-pointer"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="relative p-6 space-y-5 overflow-y-auto max-h-[80vh]">
          {/* Cockpit Radial Arc HUD Ribbon */}
          <div
            className="p-5 rounded-[22px] border border-white/[0.08] relative overflow-hidden"
            style={{
              background: 'linear-gradient(135deg, rgba(20, 25, 46, 0.85) 0%, rgba(12, 16, 32, 0.9) 100%)',
              boxShadow: 'inset 0 1px 0 rgba(255, 255, 255, 0.06), 0 12px 32px -8px rgba(0, 0, 0, 0.6)',
            }}
          >
            {/* Header of HUD */}
            <div className="flex items-center justify-between text-xs pb-3 border-b border-white/[0.06]">
              <span className="arc-eyebrow text-[10px] font-bold text-white tracking-wider flex items-center gap-1.5">
                <span className={`w-2 h-2 rounded-full ${isSessionActive ? 'bg-[var(--earned-green)] shadow-[0_0_8px_var(--earned-green)] animate-pulse' : 'bg-slate-500'}`} />
                <span>{isSessionActive ? 'ACTIVE SPENDING ENVELOPE' : 'CONFIGURED ENVELOPE (LOCAL)'}</span>
              </span>
              <span className="text-xs text-[var(--secondary-colors--sky-sync)] font-mono flex items-center gap-1">
                <Clock className="w-3.5 h-3.5 text-[var(--secondary-colors--sky-sync)]" />
                <span>{timeRemaining.formatted}</span>
              </span>
            </div>

            {/* Radial Arc & Telemetry Matrix */}
            <div className="flex flex-col sm:flex-row items-center justify-between gap-5 pt-4">
              {/* Radial Arc Gauge */}
              <div className="relative w-36 h-36 flex items-center justify-center flex-shrink-0">
                {/* SVG Glow Circle */}
                <div className="absolute inset-0 rounded-full bg-[radial-gradient(circle,rgba(112,88,248,0.2)_0%,transparent_70%)] pointer-events-none" />

                <svg className="w-36 h-36 -rotate-90 transform" viewBox="0 0 136 136">
                  <defs>
                    <linearGradient id="modalHudArcGradient" x1="0%" y1="0%" x2="100%" y2="100%">
                      <stop offset="0%" stopColor="#00E5FF" />
                      <stop offset="50%" stopColor="#7058F8" />
                      <stop offset="100%" stopColor="#01D062" />
                    </linearGradient>
                    <filter id="modalHudArcGlow" x="-20%" y="-20%" width="140%" height="140%">
                      <feGaussianBlur stdDeviation="3" result="blur" />
                      <feComposite in="SourceGraphic" in2="blur" operator="over" />
                    </filter>
                  </defs>
                  <circle
                    cx="68"
                    cy="68"
                    r="56"
                    fill="none"
                    stroke="rgba(255, 255, 255, 0.06)"
                    strokeWidth="8"
                  />
                  <circle
                    cx="68"
                    cy="68"
                    r="56"
                    fill="none"
                    stroke="url(#modalHudArcGradient)"
                    strokeWidth="8"
                    strokeLinecap="round"
                    strokeDasharray="351.86"
                    strokeDashoffset={strokeDashoffset}
                    filter="url(#modalHudArcGlow)"
                    className="transition-all duration-700 ease-out"
                  />
                </svg>

                {/* Center Readout */}
                <div className="absolute inset-0 flex flex-col items-center justify-center text-center pointer-events-none">
                  <span className="text-[8px] font-mono tracking-widest uppercase text-slate-400">
                    REMAINING
                  </span>
                  <span
                    className="text-xl font-bold text-white tabular-nums tracking-tight leading-none my-1"
                    style={{ fontFamily: 'var(--fonts--space-grotesk)' }}
                  >
                    {remainingUsdc.toFixed(2)}
                  </span>
                  <span className="text-[9px] font-mono text-[var(--color-brand-cyan)] font-semibold">
                    USDC
                  </span>
                </div>
              </div>

              {/* Right Side Telemetry Grid */}
              <div className="flex-1 w-full space-y-2.5">
                <div className="grid grid-cols-2 gap-2">
                  <div className="p-3 rounded-xl bg-white/[0.03] border border-white/5 space-y-0.5">
                    <span className="text-[10px] font-mono uppercase text-slate-400 block">TOTAL ENVELOPE</span>
                    <span
                      className="text-base font-bold text-white tabular-nums"
                      style={{ fontFamily: 'var(--fonts--space-grotesk)' }}
                    >
                      {config.maxSpendUsdc.toFixed(2)} <span className="text-xs text-slate-500 font-normal">USDC</span>
                    </span>
                  </div>

                  <div className="p-3 rounded-xl bg-white/[0.03] border border-white/5 space-y-0.5">
                    <span className="text-[10px] font-mono uppercase text-slate-400 block">SPENT VOLUME</span>
                    <span
                      className="text-base font-bold text-[var(--secondary-colors--sky-sync)] tabular-nums"
                      style={{ fontFamily: 'var(--fonts--space-grotesk)' }}
                    >
                      {config.spentUsdc.toFixed(4)} USDC
                    </span>
                  </div>
                </div>

                <div className="p-3 rounded-xl bg-white/[0.03] border border-white/5 flex items-center justify-between text-xs font-mono">
                  <div className="flex items-center gap-1.5 text-slate-300">
                    <ShieldCheck className="w-3.5 h-3.5 text-[var(--earned-green)]" />
                    <span>Single-Tx Safety Cap</span>
                  </div>
                  <span className="text-white font-bold tabular-nums">
                    {config.maxPerTxUsdc.toFixed(2)} USDC
                  </span>
                </div>

                <div className="flex items-center justify-between text-[11px] font-mono px-1">
                  <span className="text-slate-400">Estimated Executions:</span>
                  <span className="text-[var(--earned-green)] font-semibold tabular-nums">
                    ~{estimatedCalls.toLocaleString()} calls remaining
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Configuration Controls & Duration Stepper */}
          <div
            className="p-4 rounded-2xl border border-white/[0.08] space-y-4 text-xs"
            style={{ background: 'rgba(9, 11, 20, 0.75)' }}
          >
            {/* Session Budget Policy */}
            <div className="space-y-1.5">
              <label className="text-[11px] font-mono tracking-wider uppercase text-slate-400">
                Session Budget (USDC)
              </label>
              <div className="flex items-center gap-2 mt-2">
                <div className="relative flex-1">
                  <input
                    type="number"
                    min="0.10"
                    step="0.50"
                    value={customBudget}
                    onChange={(e) => setCustomBudget(e.target.value)}
                    placeholder="2.00"
                    className="w-full py-2 px-3 rounded-xl bg-white/[0.04] border border-white/10 text-white font-mono text-xs focus:outline-none focus:border-[var(--color-brand-cyan)]"
                  />
                  <span className="absolute right-3 top-2 text-xs text-slate-500 font-mono">USDC</span>
                </div>
                <div className="flex items-center gap-1.5">
                  {[1.0, 2.0, 5.0, 10.0].map((val) => (
                    <button
                      key={val}
                      type="button"
                      onClick={() => {
                        soundService.play('pop')
                        setCustomBudget(val.toFixed(2))
                      }}
                      className="px-2.5 py-2 rounded-xl bg-white/[0.03] hover:bg-white/[0.08] border border-white/5 text-slate-300 font-mono text-[11px] cursor-pointer transition hover:text-white"
                    >
                      ${val}
                    </button>
                  ))}
                </div>
              </div>
              <p className="text-[10px] text-white/40 leading-relaxed pt-1">
                Sets this session&apos;s spending ceiling. No USDC is transferred.
              </p>
            </div>

            <div className="space-y-1.5 pt-2 border-t border-white/[0.06]">
              <label className="text-[11px] font-mono tracking-wider uppercase text-slate-400">
                Session Duration Policy
              </label>
              <div className="grid grid-cols-4 gap-2 mt-2">
                {[
                  { hours: 1, label: '1 Hour' },
                  { hours: 6, label: '6 Hours' },
                  { hours: 24, label: '24 Hours' },
                  { hours: 168, label: '7 Days' },
                ].map((dur) => (
                  <button
                    key={dur.hours}
                    type="button"
                    onClick={() => {
                      soundService.play('pop')
                      setSelectedDuration(dur.hours)
                    }}
                    className={`py-2 px-2 rounded-xl text-xs font-mono font-semibold border transition cursor-pointer text-center ${selectedDuration === dur.hours
                        ? 'bg-[var(--purple-1)]/20 border-[var(--purple-1)] text-white shadow-[0_0_12px_rgba(112,88,248,0.3)]'
                        : 'bg-white/[0.02] border-white/[0.06] text-slate-400 hover:text-white hover:bg-white/[0.05]'
                      }`}
                  >
                    {dur.label}
                  </button>
                ))}
              </div>
              <p className="text-[10px] text-white/40 leading-relaxed pt-1">
                {isSessionActive
                  ? 'Renewing starts a new window and resets spent volume for this wallet.'
                  : 'Activating applies this ceiling and duration as a local spending policy.'}
              </p>
            </div>

            <div className="pt-2 border-t border-white/[0.06] flex items-center justify-between">
              <div>
                <span className="font-bold text-white block">Autonomous Execution Mode</span>
                <span className="text-[10px] text-white/40">
                  Local preference only; does not authorize calls by itself
                </span>
              </div>
              <button
                onClick={handleToggleAuto}
                disabled
                title="Unavailable until the session key is delegated on-chain"
                className="px-3 py-1.5 rounded-full text-xs font-bold border border-white/10 text-white/40 opacity-70 cursor-not-allowed font-mono"
                style={{ background: 'rgba(255, 255, 255, 0.05)' }}
              >
                Manual 1-Click
              </button>
            </div>
          </div>


          {/* Ephemeral Identity & Cryptographic Enclave Card */}
          <div
            className="p-4 rounded-2xl border border-white/[0.08] space-y-3"
            style={{ background: 'rgba(11, 14, 25, 0.75)' }}
          >
            <div className="flex items-center justify-between text-xs">
              <span className="text-white/70 font-medium flex items-center gap-1.5 font-mono text-[11px]">
                <ShieldCheck className="w-3.5 h-3.5 text-cyan-300" />
                <span>SESSION ENCLAVE</span>
                {!config.sessionPublicKey && (
                  <span className="ml-1 px-2 py-0.5 rounded-full border border-white/10 bg-white/[0.04] text-[11px] font-normal tracking-wider uppercase text-white/45">
                    Not enabled
                  </span>
                )}
              </span>
            </div>

            <div
              className="flex items-center justify-between gap-2 p-3 rounded-xl border border-white/[0.08] font-mono text-xs"
              style={{ background: 'rgba(8, 10, 18, 0.85)' }}
            >
              <span
                className={
                  config.sessionPublicKey
                    ? 'text-[var(--purple-1)] truncate font-semibold'
                    : 'text-white/45 truncate'
                }
              >
                {config.sessionPublicKey || 'No session signer yet'}
              </span>
              {config.sessionPublicKey && (
                <div className="flex items-center gap-1 flex-shrink-0">
                  <button
                    onClick={handleCopyAddress}
                    className="p-1.5 rounded-lg text-white/50 hover:text-white hover:bg-white/10 transition cursor-pointer"
                    title="Copy address"
                  >
                    {copiedKey ? <Check className="w-3.5 h-3.5 text-[var(--earned-green)]" /> : <Copy className="w-3.5 h-3.5" />}
                  </button>
                  <a
                    href={`https://testnet.arcscan.app/address/${config.sessionPublicKey}`}
                    target="_blank"
                    rel="noreferrer"
                    className="p-1.5 rounded-lg text-white/50 hover:text-cyan-300 transition"
                    title="View on ArcScan"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                </div>
              )}
            </div>

            <p className="text-[10px] text-white/50 leading-relaxed font-mono">
              {config.sessionPublicKey
                ? 'The ephemeral private key resides solely in client memory. No private credentials ever leave your browser.'
                : 'Session keys are not enabled yet. The budget below is a local spending limit; it does not sign or authorize calls on its own.'}
            </p>
          </div>

          {/* Danger Zone: Revoke & Reset */}
          <div className="pt-2 flex items-center justify-between gap-3">
            <button
              onClick={handleRevoke}
              className="text-xs text-rose-400 hover:text-rose-300 font-mono transition cursor-pointer flex items-center gap-1.5 px-3 py-2 rounded-xl hover:bg-rose-500/10"
            >
              <Flame className="w-3.5 h-3.5" />
              <span>REVOKE KEY</span>
            </button>

            <button
              onClick={() => handleActivateNew(parseFloat(customBudget) || 1.0, selectedDuration)}
              className="arc-btn arc-btn-primary px-5 py-2.5 rounded-full text-xs font-bold cursor-pointer shadow-lg tracking-wider"
            >
              <RefreshCw className="w-3.5 h-3.5 text-black" />
              <span>{isSessionActive ? 'Update Session' : 'ACTIVATE SESSION'}</span>
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  )
}
