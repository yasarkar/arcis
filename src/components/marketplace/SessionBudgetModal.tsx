// src/components/marketplace/SessionBudgetModal.tsx
// Session Budget & Enclave Manager for Arcis x402 AI Services
// Designed strictly according to DESIGN.md (Aave Luxury + Arc Blockchain High-Fi Obsidian)
// Creates and manages an ephemeral Session Enclave EOA in client memory.
// Enables zero-click autonomous payments signed by the enclave key on Arc Testnet.
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Clock,
  Copy,
  ExternalLink,
  Loader2,
  Lock,
  RefreshCw,
  ShieldCheck,
  Trash2,
  X,
  Zap,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { createWalletClient, custom, encodeFunctionData, parseUnits, type Address } from 'viem'
import { ensureNetwork } from '../../services/chainSwitchService'
import { arcTestnet } from '../../config/arcChain'
import { ERC20_ABI, POOL_CONTRACTS } from '../../config/poolsConfig'
import { useBodyScrollLock } from '../../hooks/useBodyScrollLock'
import { getStoredMscaAddress, sendModularUserOperation } from '../../services/modularWalletService'
import { getResilientPublicClient } from '../../services/rpc'
import {
  activateSessionKey,
  fetchEnclaveUsdcBalance,
  generateEphemeralSessionAccount,
  getEphemeralSessionAccount,
  getSessionKeyConfig,
  getSessionTimeRemaining,
  MARKETPLACE_SESSION_UPDATED_EVENT,
  revokeSessionKey,
  SESSION_KEY_UPDATED_EVENT,
  sweepEnclaveUsdc,
  toggleSessionAutoExecute,
} from '../../services/sessionKeyService'
import { soundService } from '../../services/soundService'
import { formatErrorMessage, isUserCanceledError } from '../../utils/errorNormalizer'
import { useBroadcast } from '../BroadcastNotification'

function formatFriendlyFundingError(err: unknown): string {
  if (isUserCanceledError(err)) {
    return 'Transaction request was cancelled in your wallet. No funds were transferred.'
  }
  const friendly = formatErrorMessage(err)
  if (friendly && !friendly.includes('Request Arguments') && friendly !== 'An unexpected error occurred. Please try again.') {
    return `Funding failed: ${friendly}`
  }
  const short = (err as any)?.shortMessage
  if (short && !short.includes('Request Arguments')) {
    return `Funding failed: ${short}`
  }
  return 'Funding failed: Transaction could not be completed.'
}

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
  const { addBroadcast, updateBroadcast } = useBroadcast()
  const [config, setConfig] = useState(() => getSessionKeyConfig(walletAddress, 'marketplace'))
  const [customBudget, setCustomBudget] = useState<string>('2.00')
  const [isCustomBudget, setIsCustomBudget] = useState<boolean>(false)
  const [selectedDuration, setSelectedDuration] = useState<number>(24)
  const [autoExecute, setAutoExecute] = useState<boolean>(() => {
    const initial = getSessionKeyConfig(walletAddress, 'marketplace')
    return initial.autoExecute ?? false
  })
  const [copiedKey, setCopiedKey] = useState<boolean>(false)
  const [enclaveBalance, setEnclaveBalance] = useState<number>(0)
  const [isFunding, setIsFunding] = useState<boolean>(false)
  const [isSaving, setIsSaving] = useState<boolean>(false)
  const [savedSuccess, setSavedSuccess] = useState<boolean>(false)
  const [resetSuccessNotice, setResetSuccessNotice] = useState<boolean>(false)
  const [isSweeping, setIsSweeping] = useState<boolean>(false)
  const [showForceReset, setShowForceReset] = useState<boolean>(false)

  // Listen for marketplace session key updates
  useEffect(() => {
    const handleUpdate = (e: any) => {
      if (e?.detail) {
        if (e.detail.scope && e.detail.scope !== 'marketplace') return
        if (!e.detail.walletAddress || !walletAddress || e.detail.walletAddress.toLowerCase() === walletAddress.toLowerCase()) {
          setConfig(e.detail)
          if (typeof e.detail.autoExecute === 'boolean') {
            setAutoExecute(e.detail.autoExecute)
          }
        }
      } else {
        const fresh = getSessionKeyConfig(walletAddress, 'marketplace')
        setConfig(fresh)
        setAutoExecute(fresh.autoExecute ?? false)
      }
    }
    window.addEventListener(MARKETPLACE_SESSION_UPDATED_EVENT, handleUpdate)
    window.addEventListener(SESSION_KEY_UPDATED_EVENT, handleUpdate)
    return () => {
      window.removeEventListener(MARKETPLACE_SESSION_UPDATED_EVENT, handleUpdate)
      window.removeEventListener(SESSION_KEY_UPDATED_EVENT, handleUpdate)
    }
  }, [walletAddress])

  // Standard body scroll lock
  useBodyScrollLock(isOpen)

  // Accessibility: Close on Escape key (unless funding or sweeping enclave)
  useEffect(() => {
    if (!isOpen) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isFunding && !isSweeping) {
        onClose()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, onClose, isFunding, isSweeping])

  // Sync on modal open and query live enclave balance
  useEffect(() => {
    if (isOpen) {
      setShowForceReset(false)
      const conf = getSessionKeyConfig(walletAddress, 'marketplace')
      setConfig(conf)
      setAutoExecute(conf.autoExecute ?? false)
      const currentMax = conf.maxSpendUsdc || 2
      setCustomBudget(currentMax.toString())
      setIsCustomBudget(![1, 2, 5, 10].includes(currentMax))
      if (conf.sessionPublicKey) {
        fetchEnclaveUsdcBalance(conf.sessionPublicKey).then((bal) => {
          setEnclaveBalance(bal)
        })
      } else {
        setEnclaveBalance(0)
      }
    }
  }, [isOpen, walletAddress])

  // Time remaining live countdown ticker
  const [timeRemainingText, setTimeRemainingText] = useState<string>('')

  useEffect(() => {
    if (!isOpen) return
    const updateCountdown = () => {
      const stats = getSessionTimeRemaining(config.expiresAt)
      setTimeRemainingText(stats.formatted)
    }
    updateCountdown()
    const interval = setInterval(updateCountdown, 1000)
    return () => clearInterval(interval)
  }, [isOpen, config.expiresAt])

  if (!isOpen) return null

  const handleCopyAddress = () => {
    if (!config.sessionPublicKey) return
    navigator.clipboard.writeText(config.sessionPublicKey)
    soundService.play('pop')
    setCopiedKey(true)
    setTimeout(() => setCopiedKey(false), 2000)
  }

  const handleActivateAndFund = async (budgetUsdc: number, durationHours: number) => {
    if (isFunding || isSweeping || isSaving) return

    // 1. Resolve or generate ephemeral account for marketplace scope
    let account = getEphemeralSessionAccount(walletAddress, 'marketplace')
    if (!account && walletAddress) {
      try {
        const gen = generateEphemeralSessionAccount(walletAddress, 'marketplace')
        account = gen.account
      } catch (genErr) {
        console.error('Failed to generate ephemeral marketplace account:', genErr)
      }
    }

    const pubKey = account?.address || config.sessionPublicKey
    if (!pubKey || !walletAddress) {
      const errMsg = 'Error: Wallet address or temporary session wallet not available.'
      addBroadcast({
        type: 'session',
        title: 'Enclave Setup Failed',
        status: 'failed',
        badgeText: 'Failed',
        message: errMsg,
        details: {
          sessionAction: 'fund',
          network: 'Arc_Testnet',
          sessionScope: 'marketplace',
          budgetUsdc,
        },
      })
      return
    }

    const targetAmount = budgetUsdc
    const amountToFund = !isSessionActive || enclaveBalance <= 0
      ? targetAmount
      : Math.max(0, targetAmount - enclaveBalance)

    let broadcastId: string | null = null
    let fundingTxHash: string | undefined = undefined

    // 2. FUNDING TRANSACTION FIRST (if funding needed)
    if (amountToFund > 0) {
      setIsFunding(true)
      soundService.play('pop')

      broadcastId = addBroadcast({
        type: 'session',
        title: isSessionActive ? 'Updating Enclave Budget' : 'Funding Session Enclave',
        status: 'pending',
        badgeText: 'Transferring',
        details: {
          sessionAction: isSessionActive ? 'update' : 'fund',
          amount: amountToFund.toFixed(2),
          tokenSymbol: 'USDC',
          network: 'Arc_Testnet',
          enclaveAddress: pubKey,
          userAddress: walletAddress,
          durationHours,
          budgetUsdc: targetAmount,
          autoExecute,
          sessionScope: 'marketplace',
        },
      })

      try {
        if (authSource === 'ucw') {
          const transferFn = ucwHandlers?.executeTransfer || ucwHandlers?.executeUcwTransfer
          if (transferFn) {
            const res = await transferFn({
              destinationAddress: pubKey,
              recipient: pubKey,
              amount: String(amountToFund),
              tokenSymbol: 'USDC',
              blockchain: 'ARC-TESTNET',
            })
            if (!res?.success) throw new Error(res?.error || 'Circle UCW transfer failed')
            if (res?.txHash) {
              fundingTxHash = res.txHash
              if (broadcastId) {
                updateBroadcast(broadcastId, {
                  badgeText: 'Confirming',
                  details: {
                    sessionAction: isSessionActive ? 'update' : 'fund',
                    amount: amountToFund.toFixed(2),
                    tokenSymbol: 'USDC',
                    network: 'Arc_Testnet',
                    enclaveAddress: pubKey,
                    userAddress: walletAddress,
                    durationHours,
                    budgetUsdc: targetAmount,
                    autoExecute,
                    sessionScope: 'marketplace',
                    txHash: res.txHash,
                  },
                })
              }
            }
          } else {
            throw new Error('Circle UCW transfer handler unavailable')
          }
        } else if (authSource === 'passkey') {
          const res = await sendModularUserOperation({
            calls: [
              {
                to: POOL_CONTRACTS.USDC as Address,
                data: encodeFunctionData({
                  abi: ERC20_ABI,
                  functionName: 'transfer',
                  args: [pubKey as Address, parseUnits(amountToFund.toString(), 6)],
                }),
              },
            ],
            paymaster: true,
          })
          if (!res?.success) throw new Error(res?.error || 'Passkey smart account transfer failed')
          if (res?.txHash) {
            fundingTxHash = res.txHash
            if (broadcastId) {
              updateBroadcast(broadcastId, {
                badgeText: 'Confirming',
                details: {
                  sessionAction: isSessionActive ? 'update' : 'fund',
                  amount: amountToFund.toFixed(2),
                  tokenSymbol: 'USDC',
                  network: 'Arc_Testnet',
                  enclaveAddress: pubKey,
                  userAddress: walletAddress,
                  durationHours,
                  budgetUsdc: targetAmount,
                  autoExecute,
                  sessionScope: 'marketplace',
                  txHash: res.txHash,
                },
              })
            }
          }
        } else {
          const effectiveProvider = provider || (typeof window !== 'undefined' ? (window as any).ethereum : undefined)
          if (effectiveProvider) {
            const switchRes = await ensureNetwork(arcTestnet, effectiveProvider)
            if (!switchRes.success) {
              throw new Error(
                switchRes.error || 'Please switch your wallet to Arc Testnet (Chain ID: 5042002) to fund the session.'
              )
            }
            const walletClient = createWalletClient({
              account: walletAddress as Address,
              chain: arcTestnet,
              transport: custom(effectiveProvider),
            })
            const hash = await walletClient.sendTransaction({
              to: POOL_CONTRACTS.USDC as Address,
              data: encodeFunctionData({
                abi: ERC20_ABI,
                functionName: 'transfer',
                args: [pubKey as Address, parseUnits(amountToFund.toString(), 6)],
              }),
            })
            fundingTxHash = hash
            if (broadcastId) {
              updateBroadcast(broadcastId, {
                badgeText: 'Confirming',
                details: {
                  sessionAction: isSessionActive ? 'update' : 'fund',
                  amount: amountToFund.toFixed(2),
                  tokenSymbol: 'USDC',
                  network: 'Arc_Testnet',
                  enclaveAddress: pubKey,
                  userAddress: walletAddress,
                  durationHours,
                  budgetUsdc: targetAmount,
                  autoExecute,
                  sessionScope: 'marketplace',
                  txHash: hash,
                },
              })
            }
            const resilientClient = getResilientPublicClient('Arc_Testnet')
            await resilientClient.waitForTransactionReceipt({ hash, timeout: 30000 })
          } else {
            throw new Error('No connected wallet provider available for funding.')
          }
        }

        const updatedBal = await fetchEnclaveUsdcBalance(pubKey)
        setEnclaveBalance(updatedBal)
      } catch (err: any) {
        soundService.play('error')
        const friendlyMsg = formatFriendlyFundingError(err)
        const isCancel = isUserCanceledError(err)
        setIsFunding(false)
        if (broadcastId) {
          updateBroadcast(broadcastId, {
            status: isCancel ? 'canceled' : 'failed',
            badgeText: isCancel ? 'Canceled' : 'Failed',
            message: friendlyMsg,
          })
        }
        return // STOP here! Do not activate if funding was rejected or failed
      } finally {
        setIsFunding(false)
      }
    }

    // 3. ACTIVATION PHASE
    setIsSaving(true)
    const isResetOnly = isSessionActive && amountToFund <= 0

    if (broadcastId) {
      updateBroadcast(broadcastId, {
        badgeText: 'Activating',
        message: 'Funding confirmed on Arc Testnet. Activating session policy...',
      })
    } else {
      broadcastId = addBroadcast({
        type: 'session',
        title: isResetOnly ? 'Updating Session Policy' : 'Activating Session Policy',
        status: 'pending',
        badgeText: 'Activating',
        details: {
          sessionAction: 'update',
          budgetUsdc: targetAmount,
          durationHours,
          autoExecute,
          enclaveAddress: pubKey,
          userAddress: walletAddress,
          network: 'Arc_Testnet',
          sessionScope: 'marketplace',
        },
      })
    }

    try {
      const updated = await activateSessionKey({
        userApproved: true,
        maxSpendUsdc: targetAmount,
        durationHours,
        autoExecute,
        enableEnclave: true,
        allowedActions: ['ai_service'],
        mscaAddress: walletAddress || getStoredMscaAddress() || undefined,
        walletAddress,
        scope: 'marketplace',
      })
      setConfig(updated)
      setAutoExecute(updated.autoExecute ?? false)
      if (onBudgetUpdated) onBudgetUpdated(targetAmount)
      soundService.play('success')
      setSavedSuccess(true)
      if (isResetOnly) {
        setResetSuccessNotice(true)
      }

      if (broadcastId) {
        updateBroadcast(broadcastId, {
          status: 'success',
          title: isResetOnly ? 'Session Policy Updated' : (isSessionActive ? 'Session Budget Updated' : 'Session Activated & Funded'),
          badgeText: 'Success',
          message: isResetOnly
            ? 'Session duration and policy have been reset on Arc Testnet.'
            : 'Autonomous Enclave is active with zero-popup authority on Arc Testnet.',
          details: {
            sessionAction: isSessionActive ? 'update' : 'fund',
            amount: amountToFund > 0 ? amountToFund.toFixed(2) : undefined,
            budgetUsdc: targetAmount,
            durationHours,
            autoExecute: updated.autoExecute ?? autoExecute,
            enclaveAddress: updated.sessionPublicKey || pubKey,
            userAddress: walletAddress,
            network: 'Arc_Testnet',
            sessionScope: 'marketplace',
            txHash: fundingTxHash,
          },
        })
      }

      const bal = await fetchEnclaveUsdcBalance(updated.sessionPublicKey)
      setEnclaveBalance(bal)

      setTimeout(() => {
        setSavedSuccess(false)
        setResetSuccessNotice(false)
      }, 3000)
    } catch (err: any) {
      soundService.play('error')
      const friendlyMsg = formatFriendlyFundingError(err)
      if (broadcastId) {
        updateBroadcast(broadcastId, {
          status: 'failed',
          badgeText: 'Failed',
          message: `Activation failed: ${friendlyMsg}`,
        })
      }
    } finally {
      setIsSaving(false)
    }
  }

  const handleRevoke = async () => {
    soundService.play('pop')
    if (!walletAddress) {
      addBroadcast({
        type: 'session',
        title: 'Revocation Failed',
        status: 'failed',
        badgeText: 'Failed',
        message: 'Wallet address not available.',
        details: {
          sessionAction: 'sweep',
          network: 'Arc_Testnet',
          sessionScope: 'marketplace',
        },
      })
      return
    }

    const broadcastId = addBroadcast({
      type: 'session',
      title: 'Revoking Session Enclave',
      status: 'pending',
      badgeText: 'Sweeping',
      details: {
        sessionAction: 'sweep',
        enclaveAddress: config.sessionPublicKey,
        userAddress: walletAddress,
        network: 'Arc_Testnet',
        sessionScope: 'marketplace',
      },
    })

    setIsSweeping(true)
    try {
      const sweepRes = await sweepEnclaveUsdc(walletAddress, walletAddress, 'marketplace', config.sessionPublicKey)
      if (sweepRes.success) {
        soundService.play('success')
        setEnclaveBalance(0)
        const hasSweptFunds = sweepRes.sweptAmountUsdc > 0

        updateBroadcast(broadcastId, {
          status: 'success',
          title: hasSweptFunds ? 'Enclave Funds Swept' : 'Session Revoked',
          badgeText: 'Success',
          details: {
            sessionAction: 'sweep',
            amount: hasSweptFunds ? sweepRes.sweptAmountUsdc.toFixed(2) : '0.00',
            tokenSymbol: 'USDC',
            enclaveAddress: config.sessionPublicKey,
            userAddress: walletAddress,
            network: 'Arc_Testnet',
            sessionScope: 'marketplace',
            txHash: sweepRes.txHash,
          },
          message: hasSweptFunds
            ? `Successfully swept ${sweepRes.sweptAmountUsdc.toFixed(2)} USDC back to your wallet.`
            : 'Session successfully revoked. No remaining balance to sweep.',
        })
      } else {
        soundService.play('error')
        const failMsg = `Sweep failed: ${sweepRes.error || 'Transaction rejected'}`
        setIsSweeping(false)
        setShowForceReset(true)

        updateBroadcast(broadcastId, {
          status: 'failed',
          badgeText: 'Failed',
          message: failMsg,
        })
        return
      }
    } catch (err: any) {
      console.error('Sweep before revoke failed', err)
      soundService.play('error')
      const errMsg = `Sweep error: ${err?.message || 'Sweep failed'}`
      setIsSweeping(false)
      setShowForceReset(true)

      updateBroadcast(broadcastId, {
        status: 'failed',
        badgeText: 'Failed',
        message: errMsg,
      })
      return
    } finally {
      setIsSweeping(false)
    }

    setShowForceReset(false)
    const revoked = revokeSessionKey(walletAddress, 'marketplace', config.sessionPublicKey)
    setConfig(revoked)
    setAutoExecute(revoked.autoExecute ?? false)
    setEnclaveBalance(0)
  }

  const handleForceReset = () => {
    soundService.play('cancel')
    const revoked = revokeSessionKey(walletAddress, 'marketplace', config.sessionPublicKey)
    setConfig(revoked)
    setAutoExecute(revoked.autoExecute ?? false)
    setEnclaveBalance(0)
    setShowForceReset(false)

    addBroadcast({
      type: 'session',
      title: 'Session Policy Reset',
      status: 'canceled',
      badgeText: 'Reset',
      details: {
        sessionAction: 'reset',
        enclaveAddress: config.sessionPublicKey,
        userAddress: walletAddress,
        network: 'Arc_Testnet',
        sessionScope: 'marketplace',
      },
      message: 'Local session policy was force-reset. Enclave key was cleared from memory.',
    })
  }

  const handleToggleAuto = () => {
    soundService.play('pop')
    const nextVal = !autoExecute
    setAutoExecute(nextVal)
    if (isSessionActive) {
      const updated = toggleSessionAutoExecute(nextVal, walletAddress, 'marketplace')
      setConfig(updated)

      addBroadcast({
        type: 'session',
        title: nextVal ? 'Autonomous Mode Enabled' : 'Autonomous Mode Disabled',
        status: 'info',
        badgeText: nextVal ? 'Zero-Popup' : 'Manual',
        details: {
          sessionAction: 'update',
          autoExecute: nextVal,
          enclaveAddress: config.sessionPublicKey,
          userAddress: walletAddress,
          network: 'Arc_Testnet',
          sessionScope: 'marketplace',
        },
        message: nextVal
          ? 'Authorized payments within caps execute without confirmation pop-ups.'
          : 'Transactions will require manual confirmation prompts.',
      })
    }
  }

  const remainingUsdc = Math.max(0, config.maxSpendUsdc - config.spentUsdc)
  const spentRatio = config.maxSpendUsdc > 0 ? Math.min(1, Math.max(0, config.spentUsdc / config.maxSpendUsdc)) : 0
  const remainingRatio = config.maxSpendUsdc > 0 ? Math.min(1, Math.max(0, remainingUsdc / config.maxSpendUsdc)) : 0
  const isExpired = Date.now() > config.expiresAt
  const isSessionActive = Boolean(config.isActive && !isExpired)
  const spentPercent = config.maxSpendUsdc > 0 ? Math.min(100, Math.round((config.spentUsdc / config.maxSpendUsdc) * 100)) : 0
  const targetBudget = parseFloat(customBudget) || 1.0
  const amountToFund = !isSessionActive || enclaveBalance <= 0
    ? targetBudget
    : Math.max(0, targetBudget - enclaveBalance)

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Session Key & Autonomous Enclave"
      className="fixed inset-0 z-[100] flex items-center justify-center p-3 sm:p-5 overflow-y-auto overscroll-contain touch-none"
    >
      {/* Backdrop: deep obsidian with blur */}
      <div
        className="fixed inset-0 bg-[#07080d]/85 backdrop-blur-md transition-all duration-300 animate-fade-in"
        onClick={onClose}
      />

      {/* Modal Container: 28px superellipse, luxury obsidian surface */}
      <div
        className="relative w-full max-w-xl rounded-[28px] overflow-hidden transition-all my-auto flex flex-col z-10"
        onClick={(e) => e.stopPropagation()}
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
              <h3
                className="text-lg font-bold text-white tracking-tight"
                style={{ fontFamily: 'var(--font-display, Outfit, sans-serif)' }}
              >
                Session Key &amp; Autonomous Enclave
              </h3>
              <div className="flex items-center gap-2">
                <span className="arc-eyebrow text-[11px] text-[var(--secondary-colors--sky-sync)] font-semibold tracking-[0.2em]">
                  Arcis x402 // Session Authority
                </span>
              </div>
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
        <div className="relative p-6 space-y-5 overflow-y-auto max-h-[85vh]">
          {/* Cockpit HUD Ribbon */}
          <div
            className="p-5 rounded-[22px] border border-white/[0.08] relative overflow-hidden"
            style={{
              background: 'linear-gradient(135deg, rgba(20, 25, 46, 0.85) 0%, rgba(12, 16, 32, 0.9) 100%)',
              boxShadow: 'inset 0 1px 0 rgba(255, 255, 255, 0.06), 0 12px 32px -8px rgba(0, 0, 0, 0.6)',
            }}
          >
            {/* Header of HUD */}
            <div
              className={`flex items-center justify-between gap-2 min-h-[15px] ${isSessionActive ? 'pb-3.5 border-b border-white/[0.08]' : ''
                }`}
            >
              <div className="flex items-center gap-2">
                {isSessionActive ? (
                  <div
                    className="inline-flex items-center gap-2.5 px-3 py-1.5 rounded-full text-xs font-mono font-bold tracking-wider uppercase border leading-none select-none flex-shrink-0"
                    style={{
                      color: 'var(--status-success-fg)',
                      backgroundColor: 'var(--status-success-bg)',
                      borderColor: 'var(--status-success-border)',
                      boxShadow: '0 0 12px var(--status-success-glow)',
                    }}
                  >
                    <span
                      className="w-2 h-2 rounded-full animate-pulse flex-shrink-0"
                      style={{
                        backgroundColor: 'var(--earned-green)',
                        boxShadow: '0 0 8px var(--earned-green)',
                      }}
                    />
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

              {isSessionActive ? (
                <div className="text-xs text-[var(--secondary-colors--sky-sync)] font-mono flex items-center gap-1.5 leading-none flex-shrink-0">
                  <Clock className="w-3.5 h-3.5 text-[var(--secondary-colors--sky-sync)] flex-shrink-0" />
                  <span className="tabular-nums font-semibold leading-none pt-0.5">{timeRemainingText}</span>
                </div>
              ) : (
                <span className="text-[11px] text-slate-400 font-mono">
                  No active policy
                </span>
              )}
            </div>

            {/* Inset Telemetry Matrix (3-Stat Strip): Only visible when an active session exists */}
            {isSessionActive && (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 pt-4">
                <div className="p-3.5 rounded-2xl bg-[rgba(14,17,29,0.7)] border border-white/[0.06] space-y-1">
                  <span className="text-[12px] font-mono uppercase tracking-wider text-slate-400 block truncate">
                    REMAINING
                  </span>
                  <div
                    className="text-lg sm:text-xl font-bold text-[var(--secondary-colors--sky-sync)] tabular-nums flex items-baseline gap-1"
                    style={{ fontFamily: 'var(--fonts--space-grotesk)' }}
                  >
                    <span className="text-[var(--secondary-colors--sky-sync)]">{remainingUsdc.toFixed(2)}</span>{' '}
                    <span className="text-xs text-slate-500 font-mono font-normal">USDC</span>
                  </div>
                </div>

                <div className="p-3.5 rounded-2xl bg-[rgba(14,17,29,0.7)] border border-white/[0.06] space-y-1">
                  <span className="text-[12px] font-mono uppercase tracking-wider text-slate-400 block truncate">
                    TOTAL ENVELOPE
                  </span>
                  <div
                    className="text-lg sm:text-xl font-bold text-[var(--secondary-colors--sky-sync)] tabular-nums flex items-baseline gap-1"
                    style={{ fontFamily: 'var(--fonts--space-grotesk)' }}
                  >
                    <span>{config.maxSpendUsdc.toFixed(2)}</span>{' '}
                    <span className="text-xs text-slate-500 font-mono font-normal">USDC</span>
                  </div>
                </div>

                <div className="p-3.5 rounded-2xl bg-[rgba(14,17,29,0.7)] border border-white/[0.06] space-y-1">
                  <span className="text-[12px] font-mono uppercase tracking-wider text-slate-400 block truncate">
                    SPENT VOLUME
                  </span>
                  <div
                    className="text-lg sm:text-xl font-bold text-[var(--secondary-colors--sky-sync)] tabular-nums flex items-baseline gap-1"
                    style={{ fontFamily: 'var(--fonts--space-grotesk)' }}
                  >
                    <span>{config.spentUsdc.toFixed(4)}</span>{' '}
                    <span className="text-xs text-slate-500 font-mono font-normal">USDC</span>
                  </div>
                </div>
              </div>
            )}

            {/* Glowing Budget Progress Bar: Only visible when an active session exists */}
            {isSessionActive && config.maxSpendUsdc > 0 && (
              <div className="space-y-2 pt-3.5">
                <div className="flex items-center justify-between text-[12px] font-mono">
                  <span className="text-slate-400 tracking-wide uppercase text-[12px]">Envelope Usage</span>
                  <span className="text-slate-500 tabular-nums text-[12px]">
                    <span className="text-slate-300 font-semibold">
                      {Math.max(0, 100 - spentPercent)}%
                    </span>{' '}
                    available
                  </span>
                </div>

                <div
                  className="relative h-1.5 w-full rounded-full bg-white/[0.06] overflow-hidden"
                  role="progressbar"
                  aria-label="Session envelope progress"
                  aria-valuemin={0}
                  aria-valuemax={config.maxSpendUsdc > 0 ? config.maxSpendUsdc : 1}
                  aria-valuenow={remainingUsdc}
                >
                  <div
                    className="h-full rounded-full transition-all duration-700 ease-out"
                    style={{
                      width: `${Math.min(100, Math.max(0, remainingRatio * 100))}%`,
                      background: 'linear-gradient(135deg, #9896ff 0%, #7c3aed 100%)',
                      boxShadow: remainingRatio > 0 ? '0 0 12px rgba(152, 150, 255, 0.35)' : undefined,
                    }}
                  />
                </div>
              </div>
            )}
          </div>

          {/* Ephemeral Identity & Cryptographic Enclave Card - Only shown when session is active */}
          {isSessionActive && config.sessionPublicKey && (
            <div
              className="p-5 rounded-[22px] border border-white/[0.08] space-y-3.5 relative overflow-hidden"
              style={{ background: 'rgba(11, 14, 25, 0.75)' }}
            >
              {/* Enclave Header */}
              <div className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-2 font-mono text-[11px]">
                  <span className="arc-eyebrow text-[11px] font-semibold tracking-wider text-white">
                    SESSION ENCLAVE
                  </span>
                  {enclaveBalance > 0 ? (
                    <span className="px-2.5 py-0.5 rounded-full border border-[var(--earned-green)]/30 bg-[var(--earned-green)]/10 text-[10px] font-mono uppercase text-[var(--earned-green)] flex items-center gap-1.5 shadow-[0_0_10px_rgba(1,208,98,0.2)]">
                      <span className="w-1.5 h-1.5 rounded-full bg-[var(--earned-green)] animate-pulse" />
                      Active &amp; Funded
                    </span>
                  ) : (
                    <span
                      className="px-2.5 py-0.5 rounded-full border text-[10px] font-mono uppercase flex items-center gap-1.5"
                      style={{
                        borderColor: 'var(--status-cancelled-border)',
                        backgroundColor: 'var(--status-cancelled-bg)',
                        color: 'var(--status-cancelled-fg)',
                      }}
                    >
                      <span
                        className="w-1.5 h-1.5 rounded-full"
                        style={{ backgroundColor: 'var(--status-cancelled-accent)' }}
                      />
                      Active (Exhausted)
                    </span>
                  )}
                </div>
              </div>

              {/* Address Display Box */}
              <div
                className="flex items-center justify-between gap-2 p-3 rounded-xl border border-white/[0.08] font-mono text-xs"
                style={{ background: 'rgba(8, 10, 18, 0.85)' }}
              >
                <span className="text-white truncate font-semibold tracking-wide">
                  {config.sessionPublicKey}
                </span>
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
              </div>

              <p className="text-[11px] text-white/45 leading-relaxed font-sans">
                The ephemeral private key resides strictly in client memory. When revoked, remaining funds are automatically swept back to your wallet.
              </p>
            </div>
          )}

          {/* Configuration Controls & Duration Stepper */}
          <div
            className="p-5 rounded-[22px] border border-white/[0.08] space-y-4 text-xs"
            style={{ background: 'rgba(11, 14, 25, 0.75)' }}
          >
            {/* Session Spending Ceiling */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="arc-eyebrow text-[11px] font-semibold tracking-wider text-[var(--secondary-colors--sky-sync)] uppercase">
                  SPEND ENVELOPE
                </label>
                <span
                  className="text-xs font-mono font-bold px-2.5 py-0.5 rounded-full"
                  style={{
                    backgroundColor: 'rgba(152, 150, 255, 0.12)',
                    border: '1px solid rgba(152, 150, 255, 0.3)',
                    color: 'var(--purple-1)',
                  }}
                >
                  {customBudget} USDC
                </span>
              </div>

              <div className="grid grid-cols-5 gap-1.5 sm:gap-2">
                {[1, 2, 5, 10].map((amt) => {
                  const isSelected = !isCustomBudget && parseFloat(customBudget) === amt
                  return (
                    <button
                      key={amt}
                      type="button"
                      onClick={() => {
                        soundService.play('pop')
                        setIsCustomBudget(false)
                        setCustomBudget(amt.toString())
                      }}
                      className={`py-2 px-1 rounded-xl text-xs font-semibold font-mono transition-all duration-200 cursor-pointer border text-center ${isSelected
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
                  className={`py-2 px-1 rounded-xl text-xs font-semibold font-mono transition-all duration-200 cursor-pointer border text-center ${isCustomBudget
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
                      min="0.10"
                      step="0.50"
                      value={customBudget}
                      onChange={(e) => setCustomBudget(e.target.value)}
                      placeholder="Enter custom budget in USDC"
                      className="w-full bg-transparent px-3 py-2 text-xs text-white font-mono tabular-nums focus:outline-none"
                    />
                    <span className="pr-4 text-xs text-[var(--secondary-colors--sky-sync)] font-mono font-semibold">
                      USDC
                    </span>
                  </div>
                </div>
              )}
            </div>

            {/* Session Duration Policy */}
            <div className="space-y-2 pt-3 border-t border-white/[0.06]">
              <div className="flex items-center justify-between">
                <label className="arc-eyebrow text-[11px] font-semibold tracking-wider text-[var(--secondary-colors--sky-sync)] uppercase block">
                  SESSION DURATION
                </label>
                <span
                  className="text-xs font-mono font-bold px-2.5 py-0.5 rounded-full"
                  style={{
                    backgroundColor: 'rgba(152, 150, 255, 0.12)',
                    border: '1px solid rgba(152, 150, 255, 0.3)',
                    color: 'var(--purple-1)',
                  }}
                >
                  {selectedDuration === 1 ? '1 Hour' : selectedDuration === 168 ? '7 Days' : `${selectedDuration} Hours`}
                </span>
              </div>
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
                    className={`py-2.5 px-2 rounded-xl text-xs font-mono font-semibold border transition cursor-pointer text-center ${selectedDuration === dur.hours
                      ? 'bg-[var(--purple-1)]/20 border-[var(--purple-1)] text-white shadow-[0_0_16px_rgba(152,150,255,0.25)]'
                      : 'bg-white/[0.02] border-white/[0.06] text-slate-400 hover:text-white hover:bg-white/[0.06]'
                      }`}
                  >
                    {dur.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Autonomous Zero-Popup Execution Toggle */}
            <div
              role="switch"
              aria-checked={autoExecute}
              tabIndex={0}
              onClick={handleToggleAuto}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  handleToggleAuto()
                }
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
                    <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                      Zero-Popup
                    </span>
                  </div>
                  <p className="text-[10px] text-slate-400 truncate">
                    Execute authorized transactions within caps without pop-up prompts
                  </p>
                </div>
              </div>

              <div
                className={`w-9 h-5 rounded-full transition-colors relative flex-shrink-0 p-0.5 ${autoExecute
                  ? 'bg-gradient-to-r from-[#9896ff] to-[#7c3aed]'
                  : 'bg-white/[0.1]'
                  }`}
              >
                <div
                  className={`w-4 h-4 rounded-full bg-white transition-transform ${autoExecute ? 'translate-x-4' : 'translate-x-0'
                    }`}
                />
              </div>
            </div>
          </div>

          {showForceReset && (
            <div
              className="p-3.5 my-3 rounded-xl border text-center space-y-2 animate-fade-in"
              style={{
                backgroundColor: 'var(--status-error-bg)',
                borderColor: 'var(--status-error-border)',
              }}
            >
              <div
                className="flex items-center justify-center gap-1.5 text-xs font-semibold"
                style={{ color: 'var(--status-error-fg)' }}
              >
                <AlertTriangle
                  className="w-4 h-4 flex-shrink-0"
                  style={{ color: 'var(--status-error-accent)' }}
                />
                <span>Signing Key Not Found in Client Storage</span>
              </div>
              <p className="text-[11px] text-white/75 leading-relaxed font-sans">
                The ephemeral key for this session cannot be located in storage (likely created before multi-tab storage was enabled, or cleared). You can force-reset the local session policy to unlock this window and start fresh.
              </p>
              <button
                type="button"
                onClick={handleForceReset}
                className="mt-1 px-4 py-1.5 rounded-full border text-xs font-semibold font-mono transition cursor-pointer hover:brightness-110"
                style={{
                  backgroundColor: 'rgba(244, 63, 94, 0.16)',
                  borderColor: 'var(--status-error-border)',
                  color: 'var(--status-error-fg)',
                }}
              >
                Force Reset Session Policy
              </button>
            </div>
          )}

          {/* Action Row: Revoke (if active) & Activate/Update Session */}
          <div className="pt-2 flex items-center justify-between gap-3">
            {isSessionActive && config.sessionPublicKey ? (
              <button
                type="button"
                onClick={handleRevoke}
                disabled={isSweeping || isFunding || isSaving || !config.sessionPublicKey}
                className="flex items-center gap-1.5 text-xs transition cursor-pointer px-3.5 py-2 rounded-full border hover:brightness-110 disabled:opacity-50 disabled:cursor-not-allowed"
                style={{
                  backgroundColor: 'var(--status-error-bg)',
                  borderColor: 'var(--status-error-border)',
                  color: 'var(--status-error-fg)',
                }}
              >
                <Trash2 className="w-3.5 h-3.5" style={{ color: 'var(--status-error-accent)' }} />
                <span>Revoke Session</span>
              </button>
            ) : (
              <div />
            )}

            <button
              type="button"
              onClick={() => handleActivateAndFund(targetBudget, selectedDuration)}
              disabled={isFunding || isSweeping || isSaving}
              className={`px-6 py-2.5 rounded-full font-semibold text-xs tracking-wide transition-all duration-200 flex items-center gap-2 select-none ${!(isFunding || isSweeping || isSaving)
                ? 'text-white hover:scale-[1.01] hover:brightness-110 active:scale-[0.98] cursor-pointer'
                : 'bg-white/[0.04] text-white/40 border border-white/[0.06] cursor-not-allowed opacity-80'
                }`}
              style={{
                fontFamily: 'var(--font-app)',
                ...(!(isFunding || isSweeping || isSaving)
                  ? {
                    background: 'linear-gradient(135deg, #9896ff 0%, #7c3aed 100%)',
                    boxShadow: '0 6px 24px rgba(152, 150, 255, 0.3)',
                  }
                  : {}),
              }}
            >
              {savedSuccess ? (
                <>
                  <CheckCircle2 className="w-4 h-4" style={{ color: 'var(--earned-green)' }} />
                  <span>{resetSuccessNotice ? 'Session Updated!' : 'Activated &amp; Funded!'}</span>
                </>
              ) : isFunding ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin text-white" />
                    <span>Funding ({amountToFund > 0 ? amountToFund : targetBudget} USDC)...</span>
                  </>
                ) : isSaving ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin text-white" />
                    <span>Activating Policy...</span>
                  </>
                ) : (
                  <>
                    {isSessionActive ? <RefreshCw className="w-3.5 h-3.5 text-white" /> : <Lock className="w-3.5 h-3.5 text-white" />}
                    <span>
                      {isSessionActive
                        ? (amountToFund > 0 ? `UPDATE SESSION (+${amountToFund.toFixed(2)} USDC)` : 'UPDATE SESSION')
                        : `ACTIVATE SESSION & FUND (${targetBudget} USDC)`}
                    </span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      </div>,
    document.body
  )
}
