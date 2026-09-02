// src/components/copilot/SessionKeyModal.tsx
// Circle Modular Wallets & Autonomous Session Key Configuration Modal
// Features: Granular action scopes, live budget progress bar, countdown timer & zero-popup execution

import React, { useState, useEffect } from 'react'
import {
  X,
  Shield,
  Zap,
  Key,
  CheckCircle2,
  Trash2,
  Lock,
  Fingerprint,
  Clock,
  Check,
  Sparkles,
} from 'lucide-react'
import type { SessionKeyConfig, SessionActionType } from '../../types/sessionKey'
import { getSessionKeyConfig, getSessionTimeRemaining } from '../../services/sessionKeyService'

interface SessionKeyModalProps {
  isOpen: boolean
  onClose: () => void
  sessionConfig: SessionKeyConfig
  onActivateSession: (params: {
    maxSpendUsdc?: number
    durationHours?: number
    maxPerTxUsdc?: number
    autoExecute?: boolean
    allowedActions?: SessionActionType[]
  }) => Promise<SessionKeyConfig>
  onRevokeSession: () => void
  onToggleAutoExecute: (enabled: boolean) => void
}

const ACTION_OPTIONS: { id: SessionActionType; label: string; description: string }[] = [
  { id: 'swap', label: 'Swap', description: 'Instant token swaps' },
  { id: 'deposit', label: 'Vault Deposit', description: 'Real-yield pools' },
  { id: 'bridge', label: 'Bridge', description: 'Cross-chain transfers' },
  { id: 'send', label: 'Send', description: 'Transfers & batch sends' },
  { id: 'faucet', label: 'Faucet', description: 'Testnet faucet funding' },
]

export default function SessionKeyModal({
  isOpen,
  onClose,
  sessionConfig,
  onActivateSession,
  onRevokeSession,
  onToggleAutoExecute,
}: SessionKeyModalProps) {
  const [budgetUsdc, setBudgetUsdc] = useState<number>(sessionConfig.maxSpendUsdc || 100)
  const [durationHours, setDurationHours] = useState<number>(24)
  const [maxPerTx, setMaxPerTx] = useState<number>(sessionConfig.maxPerTxUsdc || 50)
  const [autoExec, setAutoExec] = useState<boolean>(sessionConfig.autoExecute ?? true)
  const [allowedActions, setAllowedActions] = useState<SessionActionType[]>(
    sessionConfig.allowedActions && sessionConfig.allowedActions.length > 0
      ? sessionConfig.allowedActions
      : ['swap', 'deposit', 'bridge', 'send', 'faucet']
  )
  const [isCustomBudget, setIsCustomBudget] = useState<boolean>(false)
  const [isSaving, setIsSaving] = useState<boolean>(false)
  const [savedSuccess, setSavedSuccess] = useState<boolean>(false)
  const [timeRemainingText, setTimeRemainingText] = useState<string>('')

  // Sync state when sessionConfig or isOpen changes
  useEffect(() => {
    if (isOpen) {
      const fresh = getSessionKeyConfig()
      setBudgetUsdc(fresh.maxSpendUsdc || 100)
      setMaxPerTx(fresh.maxPerTxUsdc || 50)
      setAutoExec(fresh.autoExecute ?? true)
      if (fresh.allowedActions && fresh.allowedActions.length > 0) {
        setAllowedActions(fresh.allowedActions)
      }
    }
  }, [isOpen])

  // Live countdown timer ticker
  useEffect(() => {
    if (!isOpen) return
    const updateCountdown = () => {
      const fresh = getSessionKeyConfig()
      const stats = getSessionTimeRemaining(fresh.expiresAt)
      setTimeRemainingText(stats.formatted)
    }
    updateCountdown()
    const interval = setInterval(updateCountdown, 1000)
    return () => clearInterval(interval)
  }, [isOpen])

  if (!isOpen) return null

  const handleToggleAction = (actionId: SessionActionType) => {
    if (allowedActions.includes(actionId)) {
      if (allowedActions.length === 1) return // Keep at least one action
      setAllowedActions(allowedActions.filter((a) => a !== actionId))
    } else {
      setAllowedActions([...allowedActions, actionId])
    }
  }

  const handleSave = async () => {
    setIsSaving(true)
    try {
      await onActivateSession({
        maxSpendUsdc: Number(budgetUsdc),
        durationHours: Number(durationHours),
        maxPerTxUsdc: Math.min(Number(maxPerTx), Number(budgetUsdc)),
        autoExecute: autoExec,
        allowedActions,
      })
      setSavedSuccess(true)
      setTimeout(() => {
        setSavedSuccess(false)
        onClose()
      }, 500)
    } finally {
      setIsSaving(false)
    }
  }

  const remainingBudget = Math.max(0, sessionConfig.maxSpendUsdc - sessionConfig.spentUsdc)
  const spentPercent = sessionConfig.maxSpendUsdc > 0
    ? Math.min(100, Math.round((sessionConfig.spentUsdc / sessionConfig.maxSpendUsdc) * 100))
    : 0
  const isExpired = Date.now() > sessionConfig.expiresAt

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md animate-fade-in select-text selection:bg-cyan-500/30 selection:text-white">
      <div
        className="w-full max-w-lg rounded-3xl border border-cyan-500/40 bg-slate-900/95 p-6 space-y-5 shadow-2xl overflow-hidden relative select-text"
        style={{
          boxShadow: '0 25px 60px -15px rgba(0, 0, 0, 0.9), 0 0 35px rgba(6, 182, 212, 0.2)',
        }}
      >
        {/* Glow ambient background element */}
        <div className="absolute -top-24 -left-24 w-60 h-60 bg-cyan-500/15 rounded-full blur-3xl pointer-events-none" />

        {/* Modal Header */}
        <div className="flex items-center justify-between border-b border-slate-800 pb-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center shadow-inner">
              <Zap className="w-5 h-5 text-cyan-400" />
            </div>
            <div>
              <h3 className="text-base font-extrabold text-white flex items-center gap-2">
                <span>Autonomous Session Keys</span>
              </h3>
              <p className="text-xs text-slate-400">DeFi transactions with Arco in a single click</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Active Status Badge & Budget Progress Bar */}
        <div className="p-4 rounded-2xl bg-slate-950/80 border border-slate-800/90 space-y-3.5 text-xs">
          <div className="flex items-center justify-between">
            <span className="text-slate-400 flex items-center gap-1.5 font-medium">
              <Key className="w-3.5 h-3.5 text-cyan-400" />
              <span>Session Key Status:</span>
            </span>
            <div className="flex items-center gap-2">
              {sessionConfig.isActive && !isExpired && (
                <span className="text-[11px] font-mono text-cyan-400 flex items-center gap-1">
                  <Clock className="w-3 h-3 text-cyan-400" />
                  {timeRemainingText}
                </span>
              )}
              <span
                className={`px-2.5 py-0.5 rounded-full font-bold text-[11px] flex items-center gap-1.5 ${
                  sessionConfig.isActive && !isExpired
                    ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                    : 'bg-rose-500/20 text-rose-300 border border-rose-500/40'
                }`}
              >
                <span className={`w-2 h-2 rounded-full ${sessionConfig.isActive && !isExpired ? 'bg-emerald-400 animate-pulse' : 'bg-rose-400'}`} />
                {sessionConfig.isActive && !isExpired ? 'Active' : 'Inactive'}
              </span>
            </div>
          </div>

          {/* Live Glowing Budget Progress Bar */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-[11px]">
              <span className="text-slate-400 font-sans">Budget Usage:</span>
              <span className="font-mono text-slate-300">
                <span className="text-emerald-400 font-bold">${remainingBudget.toFixed(2)}</span> / ${sessionConfig.maxSpendUsdc.toFixed(2)} USDC Available
              </span>
            </div>
            <div className="w-full h-2 rounded-full bg-slate-800 overflow-hidden relative">
              <div
                className="h-full rounded-full transition-all duration-500 bg-gradient-to-r from-cyan-500 via-teal-400 to-emerald-400"
                style={{ width: `${100 - spentPercent}%` }}
              />
            </div>
          </div>

          {/* Account Delegation Details */}
          {sessionConfig.mscaAddress ? (
            <div className="p-2.5 rounded-xl bg-cyan-950/30 border border-cyan-500/30 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Fingerprint className="w-4 h-4 text-cyan-400" />
                <div>
                  <span className="text-[10px] text-cyan-300 font-bold uppercase block">Circle Smart Account (MSCA)</span>
                  <span className="text-xs font-mono text-white">{sessionConfig.mscaAddress.slice(0, 8)}...{sessionConfig.mscaAddress.slice(-6)}</span>
                </div>
              </div>
              <span className="text-[9px] font-bold px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 uppercase">
                Delegation Active
              </span>
            </div>
          ) : (
            <div className="p-2.5 rounded-xl bg-slate-900/60 border border-slate-800 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Shield className="w-4 h-4 text-slate-400" />
                <span className="text-[11px] text-slate-300">Arc L1 Ephemeral Delegated Signer</span>
              </div>
              <span className="text-[9px] font-bold px-2 py-0.5 rounded bg-cyan-950/50 text-cyan-300 border border-cyan-500/20 uppercase">
                Arc Testnet
              </span>
            </div>
          )}
        </div>

        {/* Configuration Controls */}
        <div className="space-y-4">
          {/* 1. Budget Presets & Custom Input */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold text-slate-300">Session Budget (USDC):</label>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setIsCustomBudget(!isCustomBudget)}
                  className="text-[10px] text-cyan-400 hover:text-cyan-300 transition underline cursor-pointer"
                >
                  {isCustomBudget ? 'Choose Preset' : 'Custom'}
                </button>
                <span className="text-cyan-400 font-mono font-bold">${budgetUsdc} USDC</span>
              </div>
            </div>

            {isCustomBudget ? (
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={10}
                  max={5000}
                  step={5}
                  value={budgetUsdc}
                  onChange={(e) => {
                    const val = Number(e.target.value)
                    setBudgetUsdc(val)
                    if (maxPerTx > val) setMaxPerTx(val)
                  }}
                  className="flex-1 bg-slate-950 border border-cyan-500/40 rounded-xl px-3 py-2 text-xs text-white font-mono focus:outline-none focus:border-cyan-400"
                  placeholder="Enter custom budget in USDC"
                />
                <span className="text-xs text-slate-400 font-mono">USDC</span>
              </div>
            ) : (
              <div className="grid grid-cols-4 gap-2">
                {[25, 50, 100, 250].map((amt) => (
                  <button
                    key={amt}
                    type="button"
                    onClick={() => {
                      setBudgetUsdc(amt)
                      if (maxPerTx > amt) setMaxPerTx(amt)
                    }}
                    className={`py-2 rounded-xl text-xs font-bold transition cursor-pointer border ${
                      budgetUsdc === amt
                        ? 'bg-cyan-500 text-slate-950 border-cyan-400 shadow-md shadow-cyan-500/20'
                        : 'bg-slate-800/80 text-slate-300 border-slate-700 hover:border-slate-500'
                    }`}
                  >
                    {amt} USDC
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* 2. Duration Presets */}
          <div className="space-y-2">
            <label className="text-xs font-semibold text-slate-300 flex items-center justify-between">
              <span>Session Duration:</span>
              <span className="text-cyan-400 font-mono font-bold">
                {durationHours === 1 ? '1 Hour' : `${durationHours} Hours`}
              </span>
            </label>
            <div className="grid grid-cols-4 gap-2">
              {[1, 6, 12, 24].map((hrs) => (
                <button
                  key={hrs}
                  type="button"
                  onClick={() => setDurationHours(hrs)}
                  className={`py-2 rounded-xl text-xs font-bold transition cursor-pointer border ${
                    durationHours === hrs
                      ? 'bg-cyan-500 text-slate-950 border-cyan-400 shadow-md shadow-cyan-500/20'
                      : 'bg-slate-800/80 text-slate-300 border-slate-700 hover:border-slate-500'
                  }`}
                >
                  {hrs}h
                </button>
              ))}
            </div>
          </div>

          {/* 3. Single-Tx Cap */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-slate-300 flex items-center justify-between">
              <span>Max. Spend Per Transaction:</span>
              <span className="text-cyan-400 font-mono">${maxPerTx} USDC</span>
            </label>
            <input
              type="range"
              min={5}
              max={budgetUsdc}
              step={5}
              value={maxPerTx}
              onChange={(e) => setMaxPerTx(Number(e.target.value))}
              className="w-full accent-cyan-400 cursor-pointer"
            />
          </div>

          {/* 4. Granular Action Scopes */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-slate-300 flex items-center justify-between">
              <span>Allowed Actions:</span>
            </label>
            <div className="flex flex-wrap gap-1.5">
              {ACTION_OPTIONS.map((act) => {
                const isChecked = allowedActions.includes(act.id)
                return (
                  <button
                    key={act.id}
                    type="button"
                    onClick={() => handleToggleAction(act.id)}
                    title={act.description}
                    className={`px-2.5 py-1.5 rounded-xl text-[11px] font-medium transition cursor-pointer flex items-center gap-1.5 border ${
                      isChecked
                        ? 'bg-cyan-950/70 border-cyan-500/50 text-cyan-200'
                        : 'bg-slate-950/50 border-slate-800 text-slate-500 hover:border-slate-700'
                    }`}
                  >
                    <div
                      className={`w-3.5 h-3.5 rounded flex items-center justify-center ${
                        isChecked ? 'bg-cyan-500 text-slate-950' : 'border border-slate-600'
                      }`}
                    >
                      {isChecked && <Check className="w-2.5 h-2.5 stroke-[3]" />}
                    </div>
                    <span>{act.label}</span>
                  </button>
                )
              })}
            </div>
          </div>

          {/* 5. Auto-Execute Toggle */}
          <div className="flex items-center justify-between p-3 rounded-2xl bg-slate-950/70 border border-slate-800">
            <div className="space-y-0.5 pr-2">
              <span className="text-xs font-semibold text-white flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-cyan-400" />
                <span>Zero-Popup Auto-Execution</span>
              </span>
              <p className="text-[10px] text-slate-400">
                Execute matching Ask Arco commands directly in chat without confirmation popups
              </p>
            </div>
            <button
              type="button"
              onClick={() => setAutoExec(!autoExec)}
              className={`w-12 h-6 rounded-full transition-colors relative cursor-pointer flex-shrink-0 ${
                autoExec ? 'bg-cyan-500' : 'bg-slate-700'
              }`}
            >
              <span
                className={`absolute top-1 left-1 w-4 h-4 rounded-full bg-white transition-transform ${
                  autoExec ? 'translate-x-6' : 'translate-x-0'
                }`}
              />
            </button>
          </div>
        </div>

        {/* Modal Actions */}
        <div className="flex items-center justify-between pt-2 border-t border-slate-800">
          <button
            type="button"
            onClick={onRevokeSession}
            className="flex items-center gap-1.5 text-xs text-rose-400 hover:text-rose-300 transition cursor-pointer px-3 py-2 rounded-xl hover:bg-rose-950/30"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>Revoke Session</span>
          </button>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold transition cursor-pointer"
            >
              Close
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={isSaving}
              className="px-5 py-2 rounded-xl bg-gradient-to-r from-emerald-500 via-teal-500 to-cyan-600 hover:brightness-110 text-white text-xs font-bold transition cursor-pointer flex items-center gap-1.5 shadow-lg shadow-cyan-500/20 disabled:opacity-50"
            >
              {savedSuccess ? (
                <>
                  <CheckCircle2 className="w-4 h-4 text-white" />
                  <span>Activated!</span>
                </>
              ) : (
                <>
                  <Lock className="w-3.5 h-3.5" />
                  <span>Start Session</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
