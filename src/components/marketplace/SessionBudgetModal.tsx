// src/components/marketplace/SessionBudgetModal.tsx
// Session Budget & Enclave Manager for Arcis x402 AI Services
// Designed strictly according to DESIGN.md (Aave Luxury + Arc Blockchain High-Fi Obsidian)
// Creates and manages an ephemeral Session Enclave EOA in client memory.
// Enables zero-click autonomous payments signed by the enclave key on Arc Testnet.
import {
  Check,
  Clock,
  Copy,
  ExternalLink,
  Flame,
  Loader2,
  RefreshCw,
  ShieldCheck,
  Wallet,
  X,
  Zap,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { createWalletClient, custom, encodeFunctionData, parseUnits, type Address } from 'viem'
import { arcTestnet } from '../../config/arcChain'
import { POOL_CONTRACTS, ERC20_ABI } from '../../config/poolsConfig'
import { getStoredMscaAddress } from '../../services/modularWalletService'
import {
  activateSessionKey,
  fetchEnclaveUsdcBalance,
  getSessionKeyConfig,
  getSessionTimeRemaining,
  revokeSessionKey,
  SESSION_KEY_UPDATED_EVENT,
  sweepEnclaveUsdc,
  toggleSessionAutoExecute,
} from '../../services/sessionKeyService'
import { soundService } from '../../services/soundService'

interface SessionBudgetModalProps {
  isOpen: boolean
  onClose: () => void
  walletAddress?: string
  provider?: any
  authSource?: 'passkey' | 'ucw' | 'evm' | null
  ucwHandlers?: any
  onBudgetUpdated?: (newMax: number) => void
}

export default function SessionBudgetModal({
  isOpen,
  onClose,
  walletAddress,
  provider,
  authSource,
  ucwHandlers,
  onBudgetUpdated,
}: SessionBudgetModalProps) {
  const [config, setConfig] = useState(() => getSessionKeyConfig(walletAddress))
  const [customBudget, setCustomBudget] = useState<string>('2.00')
  const [selectedDuration, setSelectedDuration] = useState<number>(24)
  const [copiedKey, setCopiedKey] = useState<boolean>(false)
  const [enclaveBalance, setEnclaveBalance] = useState<number>(0)
  const [isFunding, setIsFunding] = useState<boolean>(false)
  const [isSweeping, setIsSweeping] = useState<boolean>(false)
  const [fundingStatus, setFundingStatus] = useState<string | null>(null)

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

  // Sync on modal open and query live enclave balance
  useEffect(() => {
    if (isOpen) {
      const conf = getSessionKeyConfig(walletAddress)
      setConfig(conf)
      if (conf.sessionPublicKey) {
        fetchEnclaveUsdcBalance(conf.sessionPublicKey).then((bal) => {
          setEnclaveBalance(bal)
        })
      } else {
        setEnclaveBalance(0)
      }
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
      autoExecute: true,
      enableEnclave: true,
      mscaAddress: walletAddress || getStoredMscaAddress() || undefined,
      walletAddress,
    })
    setConfig(updated)
    if (onBudgetUpdated) onBudgetUpdated(budgetUsdc)
    soundService.play('success')

    // Query on-chain balance of the newly activated enclave address
    if (updated.sessionPublicKey) {
      const bal = await fetchEnclaveUsdcBalance(updated.sessionPublicKey)
      setEnclaveBalance(bal)
    }
  }

  const handleFundEnclave = async () => {
    if (!config.sessionPublicKey || !walletAddress) return
    const amountNum = parseFloat(customBudget) || 1.0
    if (amountNum <= 0) return

    soundService.play('pop')
    setIsFunding(true)
    setFundingStatus('Submitting funding transaction...')

    try {
      if (authSource === 'ucw' && ucwHandlers?.executeUcwTransfer) {
        const res = await ucwHandlers.executeUcwTransfer({
          recipient: config.sessionPublicKey,
          amount: amountNum,
          tokenSymbol: 'USDC',
        })
        if (!res?.success) {
          throw new Error(res?.error || 'Circle UCW transfer failed')
        }
      } else if (provider) {
        const walletClient = createWalletClient({
          account: walletAddress as Address,
          chain: arcTestnet,
          transport: custom(provider),
        })
        await walletClient.sendTransaction({
          to: POOL_CONTRACTS.USDC as Address,
          data: encodeFunctionData({
            abi: ERC20_ABI,
            functionName: 'transfer',
            args: [config.sessionPublicKey as Address, parseUnits(amountNum.toString(), 6)],
          }),
        })
      } else {
        throw new Error('No connected wallet provider available for funding.')
      }

      soundService.play('success')
      setFundingStatus('Funded successfully! Updating balance...')
      setTimeout(async () => {
        const bal = await fetchEnclaveUsdcBalance(config.sessionPublicKey)
        setEnclaveBalance(bal)
        setIsFunding(false)
        setFundingStatus(null)
      }, 2500)
    } catch (err: any) {
      soundService.play('error')
      setFundingStatus(`Funding failed: ${err?.message || 'Transaction rejected'}`)
      setIsFunding(false)
      setTimeout(() => setFundingStatus(null), 4000)
    }
  }

  const handleRevoke = async () => {
    soundService.play('pop')
    if (enclaveBalance > 0 && walletAddress) {
      setIsSweeping(true)
      try {
        await sweepEnclaveUsdc(walletAddress, walletAddress)
        soundService.play('success')
      } catch (err) {
        console.error('Sweep before revoke failed', err)
      } finally {
        setIsSweeping(false)
      }
    }
    const revoked = revokeSessionKey(walletAddress)
    setConfig(revoked)
    setEnclaveBalance(0)
  }

  const handleToggleAuto = () => {
    soundService.play('pop')
    const updated = toggleSessionAutoExecute(!config.autoExecute, walletAddress)
    setConfig(updated)
  }

  const remainingUsdc = Math.max(0, config.maxSpendUsdc - config.spentUsdc)
  const spentRatio = config.maxSpendUsdc > 0 ? Math.min(1, Math.max(0, config.spentUsdc / config.maxSpendUsdc)) : 0
  const remainingRatio = config.maxSpendUsdc > 0 ? Math.min(1, Math.max(0, remainingUsdc / config.maxSpendUsdc)) : 0
  const isSessionActive = config.isActive && Date.now() <= config.expiresAt

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 overflow-y-auto">
      {/* Backdrop: deep obsidian with 28px blur */}
      <div
        className="fixed inset-0 bg-[#07080d]/85 backdrop-blur-[28px] transition-all duration-300 animate-fade-in"
        onClick={onClose}
      />

      {/* Modal Container: 28px superellipse, luxury obsidian surface */}
      <div
        className="relative w-full max-w-xl rounded-[28px] overflow-hidden transition-all my-auto flex flex-col z-10"
        style={{
          background:
            'linear-gradient(145deg, rgba(22, 25, 42, 0.95) 0%, rgba(15, 17, 30, 0.97) 60%, rgba(9, 10, 18, 0.99) 100%)',
          backdropFilter: 'blur(28px)',
          WebkitBackdropFilter: 'blur(28px)',
          border: '1px solid rgba(255, 255, 255, 0.08)',
          boxShadow:
            '0 32px 80px -16px rgba(0, 0, 0, 0.95), 0 0 0 1px rgba(255, 255, 255, 0.04), 0 0 48px rgba(152, 150, 255, 0.12)',
        }}
      >
        {/* Ambient Top Glow: Aave Purple & Cyan aura */}
        <div className="absolute top-0 left-0 w-96 h-96 bg-[radial-gradient(ellipse_70%_50%_at_20%_0%,rgba(152,150,255,0.14)_0%,transparent_65%)] pointer-events-none" />
        <div className="absolute top-0 right-0 w-80 h-80 bg-[radial-gradient(circle,rgba(6,182,212,0.08)_0%,transparent_70%)] pointer-events-none" />

        {/* Top Hairline Gradient Accent */}
        <div
          className="h-[2px] w-full"
          style={{
            background:
              'linear-gradient(90deg, transparent 0%, var(--purple-1) 25%, var(--secondary-colors--sky-sync) 70%, var(--earned-green) 100%)',
          }}
        />

        {/* Header */}
        <div
          className="relative px-6 py-5 border-b border-white/[0.06] flex items-center justify-between"
          style={{ background: 'rgba(15, 18, 32, 0.45)' }}
        >
          <div className="flex items-center gap-3.5">
            <div
              className="w-10 h-10 rounded-[14px] border flex items-center justify-center text-white"
              style={{
                backgroundColor: 'rgba(152, 150, 255, 0.15)',
                borderColor: 'rgba(152, 150, 255, 0.35)',
                boxShadow: '0 0 16px rgba(152, 150, 255, 0.25)',
              }}
            >
              <Zap className="w-5 h-5 text-[var(--color-brand-cyan)]" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="arc-eyebrow text-[11px] text-[var(--secondary-colors--sky-sync)] font-semibold tracking-[0.2em]">
                  ARCIS X402 // SESSION AUTHORITY
                </span>
              </div>
              <h3
                className="text-lg font-bold text-white tracking-tight"
                style={{ fontFamily: 'var(--font-display, Outfit, sans-serif)' }}
              >
                Session Key &amp; Autonomous Enclave
              </h3>
            </div>
          </div>

          <button
            onClick={() => {
              soundService.play('pop')
              onClose()
            }}
            className="w-8 h-8 rounded-full bg-white/[0.04] border border-white/[0.08] hover:bg-white/[0.08] hover:border-white/20 text-slate-400 hover:text-white transition flex items-center justify-center cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--purple-1)]"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="relative p-6 space-y-5 overflow-y-auto max-h-[80vh]">
          {/* Cockpit HUD Ribbon */}
          <div
            className="p-5 rounded-[22px] border border-white/[0.08] relative overflow-hidden"
            style={{
              background: 'linear-gradient(135deg, rgba(20, 25, 46, 0.85) 0%, rgba(12, 16, 32, 0.9) 100%)',
              boxShadow: 'inset 0 1px 0 rgba(255, 255, 255, 0.06), 0 12px 32px -8px rgba(0, 0, 0, 0.6)',
            }}
          >
            {/* Header of HUD */}
            <div className="flex items-center justify-between text-xs pb-3.5 border-b border-white/[0.06]">
              {isSessionActive ? (
                <div className="ub-live-badge">
                  <span className="w-1.5 h-1.5 rounded-full bg-[var(--earned-green)] shadow-[0_0_8px_var(--earned-green)] animate-pulse" />
                  <span>ACTIVE SPENDING ENVELOPE</span>
                </div>
              ) : (
                <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-mono font-semibold tracking-wider uppercase text-slate-400 bg-white/[0.04] border border-white/[0.08]">
                  <span className="w-1.5 h-1.5 rounded-full bg-slate-500" />
                  <span>CONFIGURED ENVELOPE (LOCAL)</span>
                </div>
              )}

              <div className="text-xs text-[var(--secondary-colors--sky-sync)] font-mono flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5 text-[var(--secondary-colors--sky-sync)]" />
                <span>{timeRemaining.formatted}</span>
              </div>
            </div>

            {/* Inset Telemetry Matrix (3-Stat Strip) */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 pt-4">
              <div className="p-3.5 rounded-2xl bg-[rgba(14,17,29,0.7)] border border-white/[0.06] space-y-1">
                <span className="text-[10px] font-mono uppercase tracking-wider text-slate-400 block">
                  REMAINING
                </span>
                <span
                  className="text-lg sm:text-xl font-bold text-white tabular-nums flex items-baseline gap-1"
                  style={{ fontFamily: 'var(--fonts--space-grotesk)' }}
                >
                  {remainingUsdc.toFixed(2)}{' '}
                  <span className="text-xs text-[var(--color-brand-cyan)] font-mono font-normal">USDC</span>
                </span>
              </div>

              <div className="p-3.5 rounded-2xl bg-[rgba(14,17,29,0.7)] border border-white/[0.06] space-y-1">
                <span className="text-[10px] font-mono uppercase tracking-wider text-slate-400 block">
                  TOTAL ENVELOPE
                </span>
                <span
                  className="text-lg sm:text-xl font-bold text-white tabular-nums flex items-baseline gap-1"
                  style={{ fontFamily: 'var(--fonts--space-grotesk)' }}
                >
                  {config.maxSpendUsdc.toFixed(2)}{' '}
                  <span className="text-xs text-slate-500 font-mono font-normal">USDC</span>
                </span>
              </div>

              <div className="p-3.5 rounded-2xl bg-[rgba(14,17,29,0.7)] border border-white/[0.06] space-y-1">
                <span className="text-[10px] font-mono uppercase tracking-wider text-slate-400 block">
                  SPENT VOLUME
                </span>
                <span
                  className="text-lg sm:text-xl font-bold text-[var(--secondary-colors--sky-sync)] tabular-nums flex items-baseline gap-1"
                  style={{ fontFamily: 'var(--fonts--space-grotesk)' }}
                >
                  {config.spentUsdc.toFixed(4)}{' '}
                  <span className="text-xs text-slate-500 font-mono font-normal">USDC</span>
                </span>
              </div>
            </div>

            {/* Flat Progress Bar */}
            <div className="space-y-2 pt-3.5">
              <div className="flex items-center justify-between text-[11px] font-mono">
                <span className="text-slate-400 tracking-wide">Envelope Consumption</span>
                <span className="text-white font-semibold tabular-nums">
                  {Math.round(spentRatio * 100)}% spent
                  <span className="text-[var(--secondary-colors--sky-sync)] font-normal ml-1">
                    ({(remainingRatio * 100).toFixed(0)}% available)
                  </span>
                </span>
              </div>

              <div
                className="relative h-2.5 w-full rounded-full bg-white/[0.06] overflow-hidden"
                role="progressbar"
                aria-label="Session envelope progress"
                aria-valuemin={0}
                aria-valuemax={config.maxSpendUsdc > 0 ? config.maxSpendUsdc : 1}
                aria-valuenow={config.spentUsdc}
              >
                <div
                  className="h-full rounded-full transition-all duration-700 ease-out"
                  style={{
                    width: `${Math.min(100, Math.max(spentRatio > 0 ? 1 : 0, spentRatio * 100))}%`,
                    background:
                      'linear-gradient(90deg, var(--color-brand-accent) 0%, var(--purple-1) 50%, var(--earned-green) 100%)',
                    boxShadow: spentRatio > 0 ? '0 0 16px rgba(152, 150, 255, 0.5)' : undefined,
                  }}
                />
              </div>
            </div>
          </div>

          {/* Configuration Controls & Duration Stepper */}
          <div
            className="p-5 rounded-[22px] border border-white/[0.08] space-y-4 text-xs"
            style={{ background: 'rgba(11, 14, 25, 0.75)' }}
          >
            {/* Session Spending Ceiling */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="arc-eyebrow text-[11px] font-semibold tracking-wider text-[var(--secondary-colors--sky-sync)] uppercase">
                  Session Spending Ceiling
                </label>
              </div>

              <div className="flex items-center gap-2">
                <div className="relative flex-1">
                  <input
                    type="number"
                    min="0.10"
                    step="0.50"
                    value={customBudget}
                    onChange={(e) => setCustomBudget(e.target.value)}
                    placeholder="2.00"
                    className="ub-amount-input text-base sm:text-lg font-bold pr-16"
                  />
                  <span className="absolute right-4 top-1/2 -translate-y-1/2 text-xs text-[var(--secondary-colors--sky-sync)] font-mono font-semibold">
                    USDC
                  </span>
                </div>
              </div>
            </div>

            {/* Session Duration Policy */}
            <div className="space-y-2 pt-3 border-t border-white/[0.06]">
              <label className="arc-eyebrow text-[11px] font-semibold tracking-wider text-[var(--secondary-colors--sky-sync)] uppercase block">
                Session Validity Window
              </label>
              <div className="grid grid-cols-4 gap-2">
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
                    className={`py-2.5 px-2 rounded-xl text-xs font-mono font-semibold border transition cursor-pointer text-center ${
                      selectedDuration === dur.hours
                        ? 'bg-[var(--purple-1)]/20 border-[var(--purple-1)] text-white shadow-[0_0_16px_rgba(152,150,255,0.25)]'
                        : 'bg-white/[0.02] border-white/[0.06] text-slate-400 hover:text-white hover:bg-white/[0.06]'
                    }`}
                  >
                    {dur.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Autonomous Execution Mode */}
            <div className="pt-3 border-t border-white/[0.06] flex items-center justify-between gap-3">
              <div className="space-y-0.5">
                <span className="text-xs font-bold text-white block" style={{ fontFamily: 'var(--font-display, Outfit, sans-serif)' }}>
                  Autonomous Execution Mode
                </span>
                <span className="text-[11px] text-white/45 block font-sans">
                  {config.autoExecute
                    ? 'Zero-click background payments signed by Session Enclave'
                    : 'Manual confirmation challenge required per service request'}
                </span>
              </div>
              <button
                type="button"
                onClick={handleToggleAuto}
                disabled={!isSessionActive}
                title={isSessionActive ? 'Toggle autonomous execution mode' : 'Activate session first to enable'}
                className={`px-3.5 py-1.5 rounded-full text-xs font-bold border transition cursor-pointer font-mono flex items-center gap-1.5 ${
                  !isSessionActive
                    ? 'opacity-40 cursor-not-allowed bg-white/[0.02] border-white/10 text-white/40'
                    : config.autoExecute
                    ? 'bg-[var(--earned-green)]/15 border-[var(--earned-green)]/60 text-[var(--earned-green)] shadow-[0_0_12px_rgba(1,208,98,0.25)]'
                    : 'bg-white/[0.04] border-white/10 text-white/70 hover:text-white hover:bg-white/[0.08]'
                }`}
              >
                {config.autoExecute ? (
                  <>
                    <span className="w-1.5 h-1.5 rounded-full bg-[var(--earned-green)] animate-pulse" />
                    <span>Zero-Click Auto</span>
                  </>
                ) : (
                  <span>Manual 1-Click</span>
                )}
              </button>
            </div>
          </div>

          {/* Ephemeral Identity & Cryptographic Enclave Card */}
          <div
            className="p-5 rounded-[22px] border border-white/[0.08] space-y-3.5 relative overflow-hidden"
            style={{ background: 'rgba(11, 14, 25, 0.75)' }}
          >
            {/* Enclave Header */}
            <div className="flex items-center justify-between text-xs">
              <div className="flex items-center gap-2 font-mono text-[11px]">
                <ShieldCheck className="w-4 h-4 text-[var(--purple-1)]" />
                <span className="arc-eyebrow text-[11px] font-semibold tracking-wider text-white">
                  SESSION ENCLAVE
                </span>
                {!config.sessionPublicKey ? (
                  <span className="px-2.5 py-0.5 rounded-full border border-white/10 bg-white/[0.04] text-[10px] font-mono uppercase text-white/45">
                    Not Initialized
                  </span>
                ) : enclaveBalance > 0 ? (
                  <span className="px-2.5 py-0.5 rounded-full border border-[var(--earned-green)]/30 bg-[var(--earned-green)]/10 text-[10px] font-mono uppercase text-[var(--earned-green)] flex items-center gap-1.5 shadow-[0_0_10px_rgba(1,208,98,0.2)]">
                    <span className="w-1.5 h-1.5 rounded-full bg-[var(--earned-green)] animate-pulse" />
                    Active &amp; Funded
                  </span>
                ) : (
                  <span className="px-2.5 py-0.5 rounded-full border border-amber-500/30 bg-amber-500/10 text-[10px] font-mono uppercase text-amber-400 flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
                    Active (Unfunded)
                  </span>
                )}
              </div>

              {config.sessionPublicKey && (
                <div className="text-[11px] font-mono text-[var(--secondary-colors--sky-sync)]">
                  Balance:{' '}
                  <strong className="text-white font-bold tabular-nums" style={{ fontFamily: 'var(--fonts--space-grotesk)' }}>
                    {enclaveBalance.toFixed(2)} USDC
                  </strong>
                </div>
              )}
            </div>

            {/* Address Display Box */}
            <div
              className="flex items-center justify-between gap-2 p-3 rounded-xl border border-white/[0.08] font-mono text-xs"
              style={{ background: 'rgba(8, 10, 18, 0.85)' }}
            >
              <span
                className={
                  config.sessionPublicKey
                    ? 'text-[var(--purple-1)] truncate font-semibold tracking-wide'
                    : 'text-white/45 truncate'
                }
              >
                {config.sessionPublicKey || 'No session enclave generated yet'}
              </span>
              {config.sessionPublicKey && (
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  <button
                    onClick={handleCopyAddress}
                    className="p-1.5 rounded-lg text-white/60 hover:text-white hover:bg-white/10 transition cursor-pointer"
                    title="Copy enclave public address"
                  >
                    {copiedKey ? <Check className="w-3.5 h-3.5 text-[var(--earned-green)]" /> : <Copy className="w-3.5 h-3.5" />}
                  </button>
                  <a
                    href={`https://testnet.arcscan.app/address/${config.sessionPublicKey}`}
                    target="_blank"
                    rel="noreferrer"
                    className="p-1.5 rounded-lg text-white/60 hover:text-[var(--secondary-colors--sky-sync)] hover:bg-white/10 transition"
                    title="Inspect on ArcScan"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                </div>
              )}
            </div>

            {/* 1-Click Funding Button */}
            {config.sessionPublicKey && walletAddress && (
              <div className="pt-1 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2.5">
                <button
                  type="button"
                  onClick={handleFundEnclave}
                  disabled={isFunding || isSweeping}
                  className="ub-action-btn ub-action-btn-primary py-2.5 px-4 text-xs font-mono font-semibold flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isFunding ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      <span>Submitting Transfer...</span>
                    </>
                  ) : (
                    <>
                      <Wallet className="w-3.5 h-3.5 text-[var(--purple-1)]" />
                      <span>Deposit {customBudget} USDC to Enclave</span>
                    </>
                  )}
                </button>

                {fundingStatus && (
                  <span className="text-[11px] font-mono text-[var(--secondary-colors--sky-sync)] text-center sm:text-right">
                    {fundingStatus}
                  </span>
                )}
              </div>
            )}

            <p className="text-[11px] text-white/45 leading-relaxed font-sans">
              {config.sessionPublicKey
                ? 'The ephemeral private key resides strictly in client memory. When revoked, remaining funds are automatically swept back to your wallet.'
                : 'Session keys are gasless and autonomous. Activating the session derives an ephemeral enclave EOA for zero-click signing.'}
            </p>
          </div>

          {/* Danger Zone: Revoke & Reset */}
          <div className="pt-2 flex items-center justify-between gap-3">
            <button
              onClick={handleRevoke}
              disabled={isSweeping || isFunding || !config.sessionPublicKey}
              className="text-xs text-rose-400 hover:text-rose-300 font-mono font-semibold transition cursor-pointer flex items-center gap-1.5 px-4 py-2.5 rounded-full border border-rose-500/20 hover:border-rose-500/40 hover:bg-rose-500/10 disabled:opacity-30 disabled:cursor-not-allowed"
            >
              {isSweeping ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-rose-400" />
                  <span>Sweeping Funds...</span>
                </>
              ) : (
                <>
                  <Flame className="w-3.5 h-3.5" />
                  <span>REVOKE KEY {enclaveBalance > 0 ? `& SWEEP (${enclaveBalance.toFixed(2)} USDC)` : ''}</span>
                </>
              )}
            </button>

            <button
              onClick={() => handleActivateNew(parseFloat(customBudget) || 1.0, selectedDuration)}
              disabled={isFunding || isSweeping}
              className="arc-btn arc-btn-primary px-6 py-2.5 rounded-full text-xs font-bold cursor-pointer shadow-lg tracking-wider disabled:opacity-50 flex items-center gap-2"
            >
              <RefreshCw className="w-3.5 h-3.5 text-black" />
              <span>{isSessionActive ? 'UPDATE SESSION' : 'ACTIVATE SESSION'}</span>
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  )
}
