// src/components/copilot/SessionKeyModal.tsx
// Session Key Configuration Modal for Ask Arco Copilot
// Engineered strictly according to DESIGN.md (Aave Luxury + Arc Blockchain High-Fi Obsidian)
// Controls client-side execution boundaries, spend caps, and authorization scopes.

import React, { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import {
  X,
  Zap,
  Key,
  CheckCircle2,
  Trash2,
  Lock,
  Clock,
  AlertTriangle,
  ArrowLeftRight,
  Landmark,
  Compass,
  Send,
  ShieldCheck,
} from 'lucide-react'
import type { SessionKeyConfig, SessionActionType } from '../../types/sessionKey'
import { getSessionKeyConfig, getSessionTimeRemaining } from '../../services/sessionKeyService'
import { soundService } from '../../services/soundService'
import { useBodyScrollLock } from '../../hooks/useBodyScrollLock'

export interface SessionKeyModalProps {
  isOpen: boolean
  onClose: () => void
  sessionConfig: SessionKeyConfig
  walletAddress?: string
  onActivateSession: (params: {
    /** Explicit user consent for this session. */
    userApproved: boolean
    maxSpendUsdc?: number
    durationHours?: number
    maxPerTxUsdc?: number
    autoExecute?: boolean
    allowedActions?: SessionActionType[]
    walletAddress?: string
  }) => Promise<SessionKeyConfig>
  onRevokeSession: () => void
  onToggleAutoExecute: (enabled: boolean) => void
}

const ACTION_OPTIONS: {
  id: SessionActionType
  label: string
  description: string
  icon: React.ComponentType<{ className?: string }>
}[] = [
  { id: 'swap', label: 'Token Swap', description: 'Instant DEX trades', icon: ArrowLeftRight },
  { id: 'deposit', label: 'Vault Deposit', description: 'Real-yield pools', icon: Landmark },
  { id: 'bridge', label: 'Cross-Chain', description: 'CCTP & Gateway', icon: Compass },
  { id: 'send', label: 'Direct Send', description: 'USDC transfers', icon: Send },
]

const SINGLE_TX_PRESETS: { label: string; ratio: number }[] = [
  { label: '10%', ratio: 0.1 },
  { label: '25%', ratio: 0.25 },
  { label: '50%', ratio: 0.5 },
  { label: 'Max', ratio: 1.0 },
]

export default function SessionKeyModal({
  isOpen,
  onClose,
  sessionConfig,
  walletAddress,
  onActivateSession,
  onRevokeSession,
  onToggleAutoExecute,
}: SessionKeyModalProps) {
  const [budgetUsdc, setBudgetUsdc] = useState<number>(sessionConfig.maxSpendUsdc || 100)
  const [durationHours, setDurationHours] = useState<number>(24)
  const [maxPerTx, setMaxPerTx] = useState<number>(sessionConfig.maxPerTxUsdc || 50)
  const [allowedActions, setAllowedActions] = useState<SessionActionType[]>(
    Array.isArray(sessionConfig.allowedActions)
      ? sessionConfig.allowedActions
      : ['swap', 'deposit', 'bridge', 'send']
  )
  const [autoExecute, setAutoExecute] = useState<boolean>(sessionConfig.autoExecute || false)
  const [isCustomBudget, setIsCustomBudget] = useState<boolean>(false)
  const [isSaving, setIsSaving] = useState<boolean>(false)
  const [savedSuccess, setSavedSuccess] = useState<boolean>(false)
  const [timeRemainingText, setTimeRemainingText] = useState<string>('')
  // Safety confirmation dialog shown before replacing an active session
  const [isConfirmOpen, setIsConfirmOpen] = useState<boolean>(false)

  // Standard body scroll lock
  useBodyScrollLock(isOpen)

  // Sync state when sessionConfig or isOpen or walletAddress changes
  useEffect(() => {
    if (isOpen) {
      const fresh = getSessionKeyConfig(walletAddress)
      setBudgetUsdc(fresh.maxSpendUsdc || 100)
      setMaxPerTx(fresh.maxPerTxUsdc || 50)
      if (Array.isArray(fresh.allowedActions)) {
        setAllowedActions(fresh.allowedActions)
      }
      setAutoExecute(fresh.autoExecute || false)
      setIsConfirmOpen(false)
      setIsCustomBudget(![25, 50, 100, 250].includes(fresh.maxSpendUsdc || 100))
    }
  }, [isOpen, walletAddress])

  // Dismiss safety confirm if user tweaks any setting
  useEffect(() => {
    setIsConfirmOpen(false)
  }, [budgetUsdc, durationHours, maxPerTx, allowedActions, isCustomBudget, autoExecute])

  // Escape key closes safety prompt if open, otherwise closes the modal
  useEffect(() => {
    if (!isOpen) return
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (isConfirmOpen) {
          setIsConfirmOpen(false)
        } else {
          onClose()
        }
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, isConfirmOpen, onClose])

  // Live countdown timer ticker
  useEffect(() => {
    if (!isOpen) return
    const updateCountdown = () => {
      const fresh = getSessionKeyConfig(walletAddress)
      const stats = getSessionTimeRemaining(fresh.expiresAt)
      setTimeRemainingText(stats.formatted)
    }
    updateCountdown()
    const interval = setInterval(updateCountdown, 1000)
    return () => clearInterval(interval)
  }, [isOpen, walletAddress])

  if (!isOpen || typeof document === 'undefined') return null

  const handleToggleAction = (actionId: SessionActionType) => {
    if (allowedActions.includes(actionId)) {
      setAllowedActions(allowedActions.filter((a) => a !== actionId))
    } else {
      setAllowedActions([...allowedActions, actionId])
    }
  }

  /** True when this wallet already has a live, non-expired autonomous session. */
  const hasOngoingSession = (): boolean => {
    const fresh = getSessionKeyConfig(walletAddress)
    return fresh.isActive && Date.now() < fresh.expiresAt
  }

  const performSave = async () => {
    setIsSaving(true)
    try {
      await onActivateSession({
        userApproved: true,
        maxSpendUsdc: Number(budgetUsdc),
        durationHours: Number(durationHours),
        maxPerTxUsdc: Math.min(Number(maxPerTx), Number(budgetUsdc)),
        autoExecute,
        allowedActions,
        walletAddress,
      })
      if (autoExecute !== sessionConfig.autoExecute) {
        onToggleAutoExecute(autoExecute)
      }
      soundService.play('success')
      setSavedSuccess(true)
      setTimeout(() => {
        setSavedSuccess(false)
        onClose()
      }, 500)
    } catch {
      soundService.play('error')
    } finally {
      setIsSaving(false)
    }
  }

  const handleSaveClick = () => {
    if (isSaving) return
    soundService.play('pop')
    if (hasOngoingSession()) {
      setIsConfirmOpen(true)
      return
    }
    void performSave()
  }

  const handleConfirmSave = () => {
    setIsConfirmOpen(false)
    void performSave()
  }

  const maxSpend = Number(sessionConfig.maxSpendUsdc) || 0
  const spent = Number(sessionConfig.spentUsdc) || 0
  const reserved = Number(sessionConfig.reservedUsdc) || 0
  const perTx = Number(sessionConfig.maxPerTxUsdc) || 0
  const remainingBudget = Math.max(0, maxSpend - spent - reserved)
  const spentPercent = maxSpend > 0 ? Math.min(100, Math.round((spent / maxSpend) * 100)) : 0
  const isExpired = Date.now() > sessionConfig.expiresAt
  const visibleEnabledCount = ACTION_OPTIONS.filter((act) => allowedActions.includes(act.id)).length
  const minSliderVal = 5
  const maxSliderVal = Math.max(5, budgetUsdc)
  const sliderProgress =
    maxSliderVal > minSliderVal
      ? Math.min(100, Math.max(0, ((maxPerTx - minSliderVal) / (maxSliderVal - minSliderVal)) * 100))
      : 100
  const capPercent = Math.round((maxPerTx / Math.max(1, budgetUsdc)) * 100)

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Session Settings"
      className="fixed inset-0 z-[10000] flex items-center justify-center p-3 sm:p-5 bg-[#07080d]/85 backdrop-blur-[24px] animate-fade-in overscroll-contain touch-none select-text selection:bg-[var(--purple-1)]/30 selection:text-white"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-lg rounded-[28px] overflow-hidden transition-all my-auto flex flex-col border border-white/[0.08] p-5 sm:p-6 space-y-4 sm:space-y-5 animate-scale-in max-h-[92vh] overflow-y-auto"
        style={{
          background:
            'linear-gradient(145deg, rgba(22, 25, 42, 0.98) 0%, rgba(15, 17, 30, 0.99) 60%, rgba(9, 10, 18, 1) 100%)',
          backdropFilter: 'blur(28px)',
          WebkitBackdropFilter: 'blur(28px)',
          boxShadow:
            '0 32px 80px -16px rgba(0, 0, 0, 0.95), 0 0 0 1px rgba(255, 255, 255, 0.04), 0 0 48px rgba(152, 150, 255, 0.12)',
          fontFamily: 'var(--font-app)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Ambient Top Glow Orbs (DESIGN.md) */}
        <div className="absolute -top-24 -left-24 w-80 h-80 bg-[radial-gradient(ellipse_70%_50%_at_20%_0%,rgba(152,150,255,0.18)_0%,transparent_70%)] pointer-events-none" />
        <div className="absolute -bottom-24 -right-24 w-80 h-80 bg-[radial-gradient(circle,rgba(6,182,212,0.1)_0%,transparent_70%)] pointer-events-none" />

        {/* Modal Header */}
        <div className="flex items-center justify-between pb-4 border-b border-white/[0.06] relative z-10">
          <div className="flex items-center gap-3">
            <div
              className="w-10 h-10 rounded-2xl flex items-center justify-center border transition-transform hover:scale-105 flex-shrink-0"
              style={{
                backgroundColor: 'rgba(152, 150, 255, 0.12)',
                borderColor: 'rgba(152, 150, 255, 0.3)',
                boxShadow: '0 0 16px rgba(152, 150, 255, 0.2)',
              }}
            >
              <Zap className="w-5 h-5 text-[var(--purple-1)]" />
            </div>
            <div>
              <h3
                className="text-base sm:text-lg font-bold text-white tracking-tight flex items-center gap-2"
                style={{ fontFamily: 'var(--font-display, Outfit, sans-serif)' }}
              >
                <span>Session Settings</span>
              </h3>
              <p className="text-[11px] sm:text-xs text-slate-400">
                Client-side spend boundaries &amp; autonomous execution authority
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => {
              soundService.play('pop')
              onClose()
            }}
            aria-label="Close session settings"
            className="w-8 h-8 rounded-full bg-white/[0.04] border border-white/[0.08] hover:bg-white/[0.08] hover:border-white/20 text-slate-400 hover:text-white transition flex items-center justify-center cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--purple-1)] flex-shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Status Cockpit HUD Ribbon & Real-time Telemetry Matrix */}
        <div
          className="p-4 sm:p-4.5 rounded-2xl border border-white/[0.08] relative space-y-3.5"
          style={{
            background: 'linear-gradient(135deg, rgba(20, 25, 46, 0.85) 0%, rgba(12, 16, 32, 0.9) 100%)',
            boxShadow: 'inset 0 1px 0 rgba(255, 255, 255, 0.06), 0 12px 32px -8px rgba(0, 0, 0, 0.6)',
          }}
        >
          {/* Header of HUD */}
          <div className="flex items-center justify-between gap-3 min-h-[40px] pb-3.5 border-b border-white/[0.08]">
            <div className="flex items-center gap-2">
              {sessionConfig.isActive && !isExpired ? (
                <div className="inline-flex items-center gap-2.5 px-3 py-1.5 rounded-full text-xs font-mono font-bold tracking-wider uppercase text-emerald-400 bg-emerald-500/10 border border-emerald-500/30 shadow-[0_0_12px_rgba(16,185,129,0.18)] leading-none select-none flex-shrink-0">
                  <span className="w-2 h-2 rounded-full bg-emerald-400 shadow-[0_0_8px_#34d399] animate-pulse flex-shrink-0" />
                  <span className="leading-none pt-0.5">ACTIVE SESSION</span>
                  <svg className="ub-ecg-svg h-3.5 w-10 flex-shrink-0" viewBox="0 0 42 14" aria-hidden="true">
                    <path
                      className="ub-ecg-path-bg"
                      d="M 1 7 L 12 7 L 15 2 L 18 12 L 21 4 L 24 9 L 26 7 L 41 7"
                    />
                    <path
                      className="ub-ecg-path-pulse"
                      d="M 1 7 L 12 7 L 15 2 L 18 12 L 21 4 L 24 9 L 26 7 L 41 7"
                    />
                  </svg>
                </div>
              ) : (
                <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-mono font-semibold tracking-wider uppercase text-slate-400 bg-white/[0.04] border border-white/[0.08] leading-none select-none flex-shrink-0">
                  <span className="w-2 h-2 rounded-full bg-slate-500 flex-shrink-0" />
                  <span className="leading-none pt-0.5">INACTIVE SESSION</span>
                </div>
              )}
            </div>

            {sessionConfig.isActive && !isExpired && (
              <div className="text-xs text-[var(--secondary-colors--sky-sync)] font-mono flex items-center gap-1.5 leading-none flex-shrink-0">
                <Clock className="w-3.5 h-3.5 text-[var(--secondary-colors--sky-sync)] flex-shrink-0" />
                <span className="tabular-nums font-semibold leading-none pt-0.5">{timeRemainingText}</span>
              </div>
            )}
          </div>

          {/* 3-Stat Inset Telemetry Strip */}
          <div className="grid grid-cols-3 gap-2 pt-0.5">
            <div className="p-2.5 sm:p-3 rounded-xl bg-[rgba(14,17,29,0.7)] border border-white/[0.05] space-y-0.5">
              <span className="text-[9px] sm:text-[10px] font-mono uppercase tracking-wider text-slate-400 block truncate">
                REMAINING
              </span>
              <div
                className="text-sm sm:text-base font-bold text-white tabular-nums flex items-baseline gap-1"
                style={{ fontFamily: 'var(--fonts--space-grotesk)' }}
              >
                <span className="text-[var(--earned-green)]">
                  {sessionConfig.isActive && !isExpired ? remainingBudget.toFixed(2) : '0.00'}
                </span>
                <span className="text-[9px] text-slate-400 font-mono font-normal">USDC</span>
              </div>
            </div>

            <div className="p-2.5 sm:p-3 rounded-xl bg-[rgba(14,17,29,0.7)] border border-white/[0.05] space-y-0.5">
              <span className="text-[9px] sm:text-[10px] font-mono uppercase tracking-wider text-slate-400 block truncate">
                TOTAL CAP
              </span>
              <div
                className="text-sm sm:text-base font-bold text-white tabular-nums flex items-baseline gap-1"
                style={{ fontFamily: 'var(--fonts--space-grotesk)' }}
              >
                <span>{maxSpend.toFixed(2)}</span>
                <span className="text-[9px] text-slate-400 font-mono font-normal">USDC</span>
              </div>
            </div>

            <div className="p-2.5 sm:p-3 rounded-xl bg-[rgba(14,17,29,0.7)] border border-white/[0.05] space-y-0.5">
              <span className="text-[9px] sm:text-[10px] font-mono uppercase tracking-wider text-slate-400 block truncate">
                PER-TX LIMIT
              </span>
              <div
                className="text-sm sm:text-base font-bold text-white tabular-nums flex items-baseline gap-1"
                style={{ fontFamily: 'var(--fonts--space-grotesk)' }}
              >
                <span className="text-[var(--purple-1)]">{perTx.toFixed(2)}</span>
                <span className="text-[9px] text-slate-400 font-mono font-normal">USDC</span>
              </div>
            </div>
          </div>

          {/* Glowing Budget Progress Bar */}
          {sessionConfig.isActive && !isExpired && maxSpend > 0 && (
            <div className="space-y-1 pt-0.5">
              <div className="flex items-center justify-between text-[11px]">
                <span className="text-slate-400 font-mono uppercase tracking-wider text-[10px]">
                  Envelope Usage
                </span>
                <span className="text-slate-300 font-mono text-[11px]">
                  <span className="text-[var(--earned-green)] font-semibold tabular-nums">
                    {Math.max(0, 100 - spentPercent)}%
                  </span>{' '}
                  available
                </span>
              </div>
              <div className="w-full h-1.5 rounded-full bg-white/[0.05] border border-white/[0.06] overflow-hidden relative">
                <div
                  className="h-full rounded-full transition-all duration-500"
                  style={{
                    width: `${Math.max(0, 100 - spentPercent)}%`,
                    background: 'linear-gradient(90deg, #6366f1 0%, #9896ff 50%, #01d062 100%)',
                    boxShadow: '0 0 10px rgba(1, 208, 98, 0.4)',
                  }}
                />
              </div>
            </div>
          )}
        </div>

        {/* Configuration Controls */}
        <div className="space-y-4">
          {/* 1. Spend Cap Section */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="arc-eyebrow text-[11px] font-semibold tracking-wider text-[var(--secondary-colors--sky-sync)] uppercase">
                SPEND ENVELOPE
              </span>
              <span
                className="text-xs font-mono font-bold px-2.5 py-0.5 rounded-full"
                style={{
                  backgroundColor: 'rgba(152, 150, 255, 0.12)',
                  border: '1px solid rgba(152, 150, 255, 0.3)',
                  color: 'var(--purple-1)',
                }}
              >
                {budgetUsdc} USDC
              </span>
            </div>

            <div className="grid grid-cols-5 gap-1.5">
              {[25, 50, 100, 250].map((amt) => {
                const isSelected = !isCustomBudget && budgetUsdc === amt
                return (
                  <button
                    key={amt}
                    type="button"
                    onClick={() => {
                      soundService.play('pop')
                      setIsCustomBudget(false)
                      setBudgetUsdc(amt)
                      if (maxPerTx > amt) setMaxPerTx(amt)
                    }}
                    className={`py-2 px-1 rounded-xl text-xs font-semibold font-mono transition-all duration-200 cursor-pointer border text-center ${
                      isSelected
                        ? 'text-white border-[rgba(152,150,255,0.6)] bg-[rgba(152,150,255,0.18)] shadow-[0_0_16px_rgba(152,150,255,0.25)]'
                        : 'bg-white/[0.03] text-slate-300 border-white/[0.06] hover:bg-white/[0.07] hover:border-white/[0.12]'
                    }`}
                  >
                    {amt} USDC
                  </button>
                )
              })}
              <button
                type="button"
                onClick={() => {
                  soundService.play('pop')
                  setIsCustomBudget(true)
                }}
                className={`py-2 px-1 rounded-xl text-xs font-semibold font-mono transition-all duration-200 cursor-pointer border text-center ${
                  isCustomBudget
                    ? 'text-white border-[rgba(152,150,255,0.6)] bg-[rgba(152,150,255,0.18)] shadow-[0_0_16px_rgba(152,150,255,0.25)]'
                    : 'bg-white/[0.03] text-slate-300 border-white/[0.06] hover:bg-white/[0.07] hover:border-white/[0.12]'
                }`}
              >
                Custom
              </button>
            </div>

            {isCustomBudget && (
              <div className="relative animate-fade-in pt-1">
                <div className="relative flex items-center rounded-xl bg-black/40 border border-white/[0.1] focus-within:border-[var(--purple-1)] focus-within:ring-1 focus-within:ring-[var(--purple-1)]/30 transition-all overflow-hidden">
                  <input
                    type="number"
                    min={5}
                    max={5000}
                    step={5}
                    value={budgetUsdc}
                    onChange={(e) => {
                      const val = Number(e.target.value)
                      setBudgetUsdc(val)
                      if (maxPerTx > val) setMaxPerTx(val)
                    }}
                    className="w-full bg-transparent px-3 py-2 text-xs text-white font-mono tabular-nums focus:outline-none"
                    placeholder="Enter custom budget in USDC"
                  />
                  <span className="pr-5 text-xs text-[var(--secondary-colors--sky-sync)] font-mono font-semibold">
                    USDC
                  </span>
                </div>
              </div>
            )}
          </div>

          {/* 2. Session Duration Section */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="arc-eyebrow text-[11px] font-semibold tracking-wider text-[var(--secondary-colors--sky-sync)] uppercase">
                SESSION DURATION
              </span>
              <span
                className="text-xs font-mono font-bold px-2.5 py-0.5 rounded-full"
                style={{
                  backgroundColor: 'rgba(152, 150, 255, 0.12)',
                  border: '1px solid rgba(152, 150, 255, 0.3)',
                  color: 'var(--purple-1)',
                }}
              >
                {durationHours === 1 ? '1 Hour' : `${durationHours} Hours`}
              </span>
            </div>

            <div className="grid grid-cols-4 gap-2">
              {[
                { hrs: 1, label: '1h' },
                { hrs: 6, label: '6h' },
                { hrs: 12, label: '12h' },
                { hrs: 24, label: '24h' },
              ].map(({ hrs, label }) => {
                const isSelected = durationHours === hrs
                return (
                  <button
                    key={hrs}
                    type="button"
                    onClick={() => {
                      soundService.play('pop')
                      setDurationHours(hrs)
                    }}
                    className={`py-2 rounded-xl text-xs font-semibold font-mono transition-all duration-200 cursor-pointer border text-center ${
                      isSelected
                        ? 'text-white border-[rgba(152,150,255,0.6)] bg-[rgba(152,150,255,0.18)] shadow-[0_0_16px_rgba(152,150,255,0.25)]'
                        : 'bg-white/[0.03] text-slate-300 border-white/[0.06] hover:bg-white/[0.07] hover:border-white/[0.12]'
                    }`}
                  >
                    {label}
                  </button>
                )
              })}
            </div>
          </div>

          {/* 3. Single-Tx Cap Section */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="arc-eyebrow text-[11px] font-semibold tracking-wider text-[var(--secondary-colors--sky-sync)] uppercase">
                SINGLE-TX THRESHOLD
              </span>
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] text-slate-400 font-mono">
                  ({capPercent}% of cap)
                </span>
                <span
                  className="text-xs font-mono font-bold px-2.5 py-0.5 rounded-full"
                  style={{
                    backgroundColor: 'rgba(152, 150, 255, 0.14)',
                    border: '1px solid rgba(152, 150, 255, 0.35)',
                    color: 'var(--purple-1)',
                    boxShadow: '0 0 12px rgba(152, 150, 255, 0.15)',
                  }}
                >
                  {maxPerTx} USDC
                </span>
              </div>
            </div>

            {/* Precision Range Slider */}
            <div className="space-y-2 pt-0.5">
              <div className="relative group py-2 flex items-center">
                {/* Ambient glow behind track on hover */}
                <div
                  className="absolute inset-x-0 h-2.5 rounded-full opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none blur-md"
                  style={{ backgroundColor: 'rgba(152, 150, 255, 0.25)' }}
                />

                {/* Recessed Track Groove */}
                <div className="relative h-2.5 w-full bg-[#0a0c16] rounded-full border border-white/[0.08] shadow-[inset_0_1.5px_3px_rgba(0,0,0,0.85)] overflow-hidden">
                  {/* Precision tick graduation lines at 25%, 50%, 75% */}
                  <div className="absolute inset-0 pointer-events-none">
                    <div className="absolute top-0 bottom-0 left-1/4 w-[1px] bg-white/[0.12]" />
                    <div className="absolute top-0 bottom-0 left-2/4 w-[1px] bg-white/[0.12]" />
                    <div className="absolute top-0 bottom-0 left-3/4 w-[1px] bg-white/[0.12]" />
                  </div>

                  {/* Active Glowing Progress Fill */}
                  <div
                    className="h-full rounded-full transition-[width] duration-75 relative"
                    style={{
                      width: `${sliderProgress}%`,
                      background: 'linear-gradient(90deg, #4f46e5 0%, #7c3aed 50%, #9896ff 100%)',
                      boxShadow: '0 0 12px rgba(152, 150, 255, 0.55), inset 0 1px 1px rgba(255, 255, 255, 0.35)',
                    }}
                  />
                </div>

                {/* Jewel Thumb Knob */}
                <div
                  className="absolute top-1/2 pointer-events-none"
                  style={{
                    left: `clamp(10px, ${sliderProgress}%, calc(100% - 10px))`,
                    transform: 'translate(-50%, -50%)',
                  }}
                >
                  <div
                    className="w-5 h-5 rounded-full flex items-center justify-center border-2 transition-all duration-150 group-hover:scale-110"
                    style={{
                      backgroundColor: '#0c0e18',
                      borderColor: 'var(--purple-1)',
                      boxShadow:
                        '0 0 14px rgba(152, 150, 255, 0.8), 0 2px 6px rgba(0, 0, 0, 0.9), inset 0 0 4px rgba(152, 150, 255, 0.3)',
                    }}
                  >
                    <div className="w-1.5 h-1.5 rounded-full bg-white shadow-[0_0_6px_#ffffff]" />
                  </div>
                </div>

                {/* Transparent Interactive Native Input */}
                <input
                  type="range"
                  min={minSliderVal}
                  max={maxSliderVal}
                  step={5}
                  value={maxPerTx}
                  onChange={(e) => setMaxPerTx(Number(e.target.value))}
                  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-20 m-0 p-0"
                  aria-label="Single transaction threshold in USDC"
                />
              </div>

              {/* Lower Control Bar: Min / Preset Chips / Max */}
              <div className="flex items-center justify-between text-[10px] font-mono">
                <span className="text-slate-500 tabular-nums">5 USDC</span>
                <div className="flex items-center gap-1.5">
                  {SINGLE_TX_PRESETS.map(({ label, ratio }) => {
                    const targetVal =
                      ratio === 1.0
                        ? maxSliderVal
                        : Math.max(5, Math.min(maxSliderVal, Math.round((budgetUsdc * ratio) / 5) * 5))
                    const isSelected = maxPerTx === targetVal
                    return (
                      <button
                        key={label}
                        type="button"
                        onClick={() => {
                          soundService.play('pop')
                          setMaxPerTx(targetVal)
                        }}
                        className={`px-2 py-0.5 rounded-md text-[10px] font-mono font-medium transition-all duration-150 cursor-pointer border ${
                          isSelected
                            ? 'text-white border-[rgba(152,150,255,0.6)] bg-[rgba(152,150,255,0.22)] shadow-[0_0_10px_rgba(152,150,255,0.3)]'
                            : 'text-slate-400 border-white/[0.06] bg-white/[0.02] hover:bg-white/[0.08] hover:text-slate-200'
                        }`}
                      >
                        {label}
                      </button>
                    )
                  })}
                </div>
                <span className="text-slate-500 tabular-nums">{budgetUsdc} USDC</span>
              </div>
            </div>
          </div>

          {/* 4. Action Filters Section */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="arc-eyebrow text-[11px] font-semibold tracking-wider text-[var(--secondary-colors--sky-sync)] uppercase">
                PERMITTED ACTIONS
              </span>
              <span className="text-[10px] font-mono text-[var(--secondary-colors--sky-sync)] uppercase">
                {visibleEnabledCount} OF {ACTION_OPTIONS.length} ENABLED
              </span>
            </div>

            <div className="grid grid-cols-2 gap-2">
              {ACTION_OPTIONS.map((act) => {
                const isChecked = allowedActions.includes(act.id)
                const Icon = act.icon
                return (
                  <button
                    key={act.id}
                    type="button"
                    onClick={() => {
                      soundService.play('pop')
                      handleToggleAction(act.id)
                    }}
                    className={`p-2.5 rounded-xl border transition-all duration-200 text-left flex items-start gap-2.5 cursor-pointer relative ${
                      isChecked
                        ? 'bg-[rgba(152,150,255,0.12)] border-[rgba(152,150,255,0.4)] shadow-[0_0_12px_rgba(152,150,255,0.15)] text-white'
                        : 'bg-white/[0.02] border-white/[0.06] text-slate-400 opacity-60 hover:opacity-90'
                    }`}
                  >
                    <div
                      className={`w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 transition-colors ${
                        isChecked
                          ? 'bg-[rgba(152,150,255,0.25)] text-white'
                          : 'bg-white/[0.04] text-slate-500'
                      }`}
                    >
                      <Icon className="w-3.5 h-3.5" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-1">
                        <span className="text-xs font-semibold tracking-tight truncate">
                          {act.label}
                        </span>
                
                      </div>
                      <p className="text-[10px] text-slate-400 truncate mt-0.5">
                        {act.description}
                      </p>
                    </div>
                  </button>
                )
              })}
            </div>
          </div>

          {/* 5. Autonomous Zero-Popup Execution Toggle */}
          <div
            onClick={() => {
              soundService.play('pop')
              setAutoExecute(!autoExecute)
            }}
            className="p-3 rounded-xl bg-white/[0.02] border border-white/[0.06] hover:border-white/[0.12] transition-all flex items-center justify-between gap-3 cursor-pointer select-none"
          >
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-7 h-7 rounded-lg bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center flex-shrink-0 text-indigo-400">
                <ShieldCheck className="w-3.5 h-3.5 text-[var(--purple-1)]" />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold text-white truncate">Autonomous Mode</span>
                  <span className="text-[9px] font-mono px-1.5 py-0.2 rounded bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                    Zero-Popup
                  </span>
                </div>
                <p className="text-[10px] text-slate-400 truncate">
                  Execute authorized transactions within caps without pop-up prompts
                </p>
              </div>
            </div>

            <div
              className={`w-9 h-5 rounded-full transition-colors relative flex-shrink-0 p-0.5 ${
                autoExecute
                  ? 'bg-gradient-to-r from-[#9896ff] to-[#7c3aed]'
                  : 'bg-white/[0.1]'
              }`}
            >
              <div
                className={`w-4 h-4 rounded-full bg-white transition-transform ${
                  autoExecute ? 'translate-x-4' : 'translate-x-0'
                }`}
              />
            </div>
          </div>
        </div>

        {/* Modal Actions Footer */}
        <div className="flex items-center justify-between pt-3 border-t border-white/[0.06] relative z-10">
          <button
            type="button"
            onClick={() => {
              soundService.play('cancel')
              onRevokeSession()
            }}
            className="flex items-center gap-1.5 text-xs text-rose-400 hover:text-rose-300 transition cursor-pointer px-3.5 py-2 rounded-full bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/25"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>Revoke Session</span>
          </button>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleSaveClick}
              disabled={isSaving}
              className="px-6 py-2.5 rounded-full text-white text-xs font-semibold tracking-wide transition cursor-pointer flex items-center gap-2 shadow-lg disabled:opacity-50 hover:brightness-110 hover:scale-[1.01] active:scale-[0.98]"
              style={{
                fontFamily: 'var(--font-app)',
                background: 'linear-gradient(135deg, #9896ff 0%, #7c3aed 100%)',
                boxShadow: '0 6px 24px rgba(152, 150, 255, 0.35)',
              }}
            >
              {savedSuccess ? (
                <>
                  <CheckCircle2 className="w-4 h-4 text-white" />
                  <span>Activated!</span>
                </>
              ) : isSaving ? (
                <>
                  <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  <span>Saving...</span>
                </>
              ) : (
                <>
                  <Lock className="w-3.5 h-3.5" />
                  <span>Save &amp; Activate</span>
                </>
              )}
            </button>
          </div>
        </div>

        {/* ── YES/NO SAFETY CONFIRMATION DIALOG ── */}
        {isConfirmOpen && (
          <>
            {/* Click-away layer: dims and blurs the underlying form */}
            <div
              className="absolute inset-0 z-20 bg-[#07080d]/80 backdrop-blur-sm rounded-[28px] animate-fade-in"
              onClick={(e) => {
                e.stopPropagation()
                setIsConfirmOpen(false)
              }}
            />
            <div
              role="alertdialog"
              aria-label="Confirm updating the active session"
              className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-30 w-[90%] max-w-[22rem] rounded-2xl border p-4 sm:p-5 space-y-3.5 shadow-2xl animate-scale-in"
              style={{
                background:
                  'linear-gradient(145deg, rgba(22, 25, 42, 0.98) 0%, rgba(12, 14, 24, 0.99) 100%)',
                borderColor: 'rgba(233, 161, 63, 0.4)',
                boxShadow:
                  '0 24px 64px -12px rgba(0, 0, 0, 0.95), 0 0 32px rgba(233, 161, 63, 0.2)',
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-start gap-3">
                <div
                  className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0"
                  style={{
                    backgroundColor: 'rgba(233, 161, 63, 0.15)',
                    border: '1px solid rgba(233, 161, 63, 0.35)',
                  }}
                >
                  <AlertTriangle className="w-4 h-4 text-[var(--secondary-colors--blockstream-gold)]" />
                </div>
                <div className="space-y-0.5">
                  <span className="arc-eyebrow text-[9px] text-[var(--secondary-colors--blockstream-gold)] font-mono font-semibold tracking-wider uppercase block">
                    SECURITY SAFEGUARD
                  </span>
                  <h4 className="text-sm font-bold text-white tracking-tight">
                    Replace Active Session?
                  </h4>
                </div>
              </div>

              <p className="text-xs text-slate-300 leading-relaxed">
                An active session is currently running{' '}
                {timeRemainingText && (
                  <strong className="text-white font-mono font-semibold">({timeRemainingText})</strong>
                )}
                . Saving will overwrite the key and reset the spend budget counters.
              </p>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-white/[0.06]">
                <button
                  type="button"
                  onClick={() => {
                    soundService.play('cancel')
                    setIsConfirmOpen(false)
                  }}
                  className="px-3.5 py-1.5 rounded-full bg-white/[0.04] border border-white/[0.08] hover:bg-white/[0.08] text-slate-300 text-xs font-semibold transition cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => {
                    soundService.play('pop')
                    handleConfirmSave()
                  }}
                  disabled={isSaving}
                  className="px-4 py-1.5 rounded-full text-slate-950 text-xs font-bold transition cursor-pointer shadow-md disabled:opacity-50 hover:brightness-110 active:scale-[0.98]"
                  style={{
                    background: 'linear-gradient(135deg, #e9a13f 0%, #d97706 100%)',
                    boxShadow: '0 4px 16px rgba(233, 161, 63, 0.3)',
                  }}
                >
                  Yes, Replace
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>,
    document.body
  )
}
