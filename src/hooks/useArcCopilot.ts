// Hook for managing Arcis AI Copilot (Autonomous Agent Orchestrator & Knowledge Hub)
import { useState, useCallback, useEffect, useRef } from 'react'
import { arcTestnet, ARC_METADATA } from '../config/arcChain'
import { ARC_SERVICES_REGISTRY } from '../config/servicesRegistry'
import { executeX402Call, hasVerifiedX402Settlement, isServiceDataAvailable, isSuccessfulX402ServiceResult } from '../services/x402Client'
import { recommendationsForReport } from '../services/x402/nextActions'
import { getLivePortfolioSnapshot } from '../services/portfolioContextService'
import {
  getSessionKeyConfig,
  activateSessionKey as activateSessionKeyService,
  revokeSessionKey as revokeSessionKeyService,
  toggleSessionAutoExecute as toggleAutoExecuteService,
  verifySessionLimits,
  setActiveWalletForSession,
  COPILOT_SESSION_UPDATED_EVENT,
  SESSION_KEY_UPDATED_EVENT,
} from '../services/sessionKeyService'
import type { CopilotUcwHandlers } from '../services/copilotExecutionService'
import { resolveX402Payer } from '../services/x402/ucwPaymentSigner'
import { getEphemeralSessionAccount } from '../services/sessionEnclaveService'
import { getGatewayTotalBalance } from '../services/gatewayService'
import { tokenAmountToUsd } from '../services/tokenPriceService'
import {
  formatGatewayFlowReport,
  formatUsdcOrUnavailable,
  GATEWAY_FLOW_SOURCE,
} from '../services/gatewayFlowIndexer'
import {
  formatInstitutionalReportHeader,
  formatRiskRegisterLines,
} from '../services/x402/institutionalReport'
import type { CopilotMessage, CopilotStepLog, CopilotActionPayload, CopilotActionType } from '../types/marketplace'
import type { Recommendation } from '../services/x402/nextActions'
import type { SessionKeyConfig, SessionActionType, InlineExecutionReceipt } from '../types/sessionKey'
import { formatCopilotError, canceledActionTitle } from '../utils/errorUtils'
import { formatX402FailureNote } from '../utils/x402FailureDiagnosis'
import { classifyCopilotIntent, copilotActionIntent, invalidateCopilotDrafts } from '../utils/copilotIntent'
import {
  WALLET_SETTINGS_CHANGED_EVENT,
  normalizeWalletAddressKey,
  walletSettingsService,
} from '../services/walletSettingsService'
import {
  isSettingsSyncableDraft,
  syncDraftWithExecutionSettings,
} from '../services/copilot/copilotDraftSync'

function normalizeActionType(type?: CopilotActionType | string): SessionActionType {
  if (!type) return 'send'
  if (type === 'trade' || type.includes('swap')) return 'swap'
  if (type === 'zap' || type.includes('deposit')) return 'deposit'
  if (type.includes('bridge')) return 'bridge'
  return 'send'
}

/** Computes the USD equivalent of a Copilot action payload for session limit checks. */
function estimateActionSpendUsd(action: CopilotActionPayload): number {
  const actionType = normalizeActionType(action.type)
  const data = action.data || {}
  if (action.type === 'interactive_lp_deposit') {
    const tokenA = String(data.tokenA || 'USDC')
    const amountA = Number(data.amountA ?? data.amount) || 0
    const usdA = tokenAmountToUsd(tokenA, amountA)
    const usdB =
      data.lpMode === 'dual' && data.tokenB && Number(data.amountB) > 0
        ? tokenAmountToUsd(String(data.tokenB), Number(data.amountB))
        : 0
    return usdA + usdB
  }
  const amount = Number(data.amount) || 0
  const tokenForLimit =
    actionType === 'swap'
      ? String(data.fromToken || 'USDC')
      : actionType === 'send'
        ? String(data.tokenSymbol || data.token || 'USDC')
        : 'USDC'
  return tokenAmountToUsd(tokenForLimit, amount)
}

const formatUsdReportValue = (value: unknown): string =>
  typeof value === 'number' && Number.isFinite(value)
    ? `$${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : 'unavailable'

const formatPctReportValue = (value: unknown): string =>
  typeof value === 'number' && Number.isFinite(value) ? `${value}%` : 'unavailable'

/**
 * The paid flows this chat can run itself. A card's action kind only says how the
 * catalogue should open it; in-chat execution depends on having a flow for the service.
 */
const CHAT_EXECUTABLE_SERVICES = new Set<string>([
  'arc-portfolio-risk-exposure',
  'arc-vault-yield-tax-report',
  'arc-yield-vault-analytics',
])

/** A paid call is billable once Gateway accepts it, not only after final reconciliation. */
const isPaidOrSettled = (result: any): boolean =>
  Boolean(result?.success && (hasVerifiedX402Settlement(result) || result?.payment?.status === 'settlement_pending'))

export function isTransactionalAction(type?: CopilotActionType | string): boolean {
  if (!type) return false
  const t = type.toLowerCase()
  if (t === 'unsupported_bridge' || t === 'interactive_claim_fees' || t === 'interactive_lp_remove') return false
  return (
    t === 'trade' ||
    t === 'zap' ||
    t === 'bridge' ||
    t === 'send' ||
    t.startsWith('interactive_') ||
    t.includes('swap') ||
    t.includes('deposit') ||
    t.includes('bridge') ||
    t.includes('send')
  )
}

import {
  type TopicQuestion,
  type TopicCategory,
  EXPLORE_TOPIC_CATEGORIES,
  QUICK_PROMPTS,
  createArcisWelcomeMessage,
  createArcoWelcomeMessage,
  isGatewayFlowReportQuery,
  isActionOrStrategyIntent, isPortfolioAnalysisQuery, isVaultReportQuery, isVaultAnalyticsQuery,
  exploreTopicQuestions, isTopicPrompt, isPureEducationalQuery,
} from '../config/copilotTopics'

export {
  type TopicQuestion,
  type TopicCategory,
  EXPLORE_TOPIC_CATEGORIES,
  QUICK_PROMPTS,
  createArcisWelcomeMessage,
  createArcoWelcomeMessage,
  isGatewayFlowReportQuery,
  isActionOrStrategyIntent, isPortfolioAnalysisQuery, isVaultReportQuery,
  exploreTopicQuestions, isTopicPrompt, isPureEducationalQuery,
}


export function useArcCopilot(
  walletAddress?: string,
  provider?: any,
  ucwHandlers?: CopilotUcwHandlers,
  initialOpen = false
) {
  const [isOpen, setIsOpen] = useState<boolean>(initialOpen)
  const [isAnalyzing, setIsAnalyzing] = useState<boolean>(false)
  const [currentSteps, setCurrentSteps] = useState<CopilotStepLog[]>([])
  const [messages, setMessages] = useState<CopilotMessage[]>([createArcisWelcomeMessage()])

  // Paid x402 calls: an injected EOA signs its own EIP-3009 authorization; a Circle Wallet
  // (created as an EOA) signs through Circle's typed-data challenge. Passkey/MSCA smart
  // accounts cannot produce such a signature, so they require a funded Session Enclave.
  const [sessionConfig, setSessionConfig] = useState<SessionKeyConfig>(() => getSessionKeyConfig(walletAddress, 'copilot'))
  const nowMs = Date.now()
  const marketplaceSessionConfig = getSessionKeyConfig(walletAddress, 'marketplace')
  const activeMarketplaceEnclave =
    marketplaceSessionConfig.isActive &&
    marketplaceSessionConfig.sessionPublicKey &&
    nowMs <= marketplaceSessionConfig.expiresAt
      ? getEphemeralSessionAccount(walletAddress, 'marketplace')
      : null
  const activeCopilotEnclave =
    sessionConfig.isActive &&
    sessionConfig.sessionPublicKey &&
    nowMs <= sessionConfig.expiresAt
      ? getEphemeralSessionAccount(walletAddress, 'copilot')
      : null
  const sessionEnclaveAccount = activeMarketplaceEnclave || activeCopilotEnclave

  const paidCallPayer = resolveX402Payer(ucwHandlers?.authSource, ucwHandlers?.signTypedData)
  const hasPaidCallPayer = paidCallPayer !== null || Boolean(sessionEnclaveAccount)
  const canPayForCalls = Boolean(walletAddress) && hasPaidCallPayer

  // Prefer session_eoa only when the enclave actually holds enough Circle Gateway USDC
  // (or when no primary EOA/UCW payer exists, e.g. Passkey/MSCA); otherwise fall back
  // to the connected primary EOA / Circle UCW payer so a native-USDC-only Copilot
  // enclave never blocks paid x402 queries.
  const resolveEffectivePaidCallPayer = async (requiredUsdc: number) => {
    if (sessionEnclaveAccount) {
      if (!paidCallPayer) {
        return { kind: 'session_eoa' as const, signer: undefined }
      }
      try {
        const enclaveGatewayBal = Number(await getGatewayTotalBalance(sessionEnclaveAccount.address))
        if (Number.isFinite(enclaveGatewayBal) && enclaveGatewayBal > 0 && enclaveGatewayBal >= requiredUsdc) {
          return { kind: 'session_eoa' as const, signer: undefined }
        }
      } catch {
        // Fall back safely to the primary EOA / Circle UCW payer if Gateway balance lookup fails
      }
    }
    return paidCallPayer
  }
  const pendingActionRef = useRef<CopilotActionPayload | null>(null)
  const queryBusyRef = useRef<boolean>(false)
  // Guards a next-step card: a second click must not buy the same report twice.
  const nextStepInFlightRef = useRef<boolean>(false)
  const queryGenerationRef = useRef<number>(0)
  const queryAbortRef = useRef<AbortController | null>(null)
  // Separate from network generations: protects cards that are still being streamed.
  const draftGenerationRef = useRef(0)
  const settingsSyncSeqRef = useRef(0)
  const currentDraftRef = useRef<CopilotActionPayload | null>(null)
  const messagesRef = useRef<CopilotMessage[]>(messages)
  messagesRef.current = messages
  const activeStreamRef = useRef<{
    msgId: string
    fullContent: string
    actionPayload?: CopilotActionPayload
    draftGeneration: number
    cancel: () => void
  } | null>(null)

  const flushActiveStream = (options?: { discardActionPayload?: boolean }) => {
    const active = activeStreamRef.current
    if (!active) return
    activeStreamRef.current = null
    active.cancel()
    const attachAction =
      !options?.discardActionPayload && active.draftGeneration === draftGenerationRef.current
        ? active.actionPayload
        : undefined
    const applyFlush = (prev: CopilotMessage[]) =>
      prev.map((m) =>
        m.id === active.msgId
          ? {
              ...m,
              content: active.fullContent,
              isStreaming: false,
              actionPayload: attachAction,
            }
          : m
      )
    messagesRef.current = applyFlush(messagesRef.current)
    setMessages(applyFlush)
  }

  const invalidateDrafts = () => {
    draftGenerationRef.current += 1
    settingsSyncSeqRef.current += 1
    currentDraftRef.current = null
    pendingActionRef.current = null
    flushActiveStream({ discardActionPayload: true })
    messagesRef.current = invalidateCopilotDrafts(messagesRef.current)
    setMessages(invalidateCopilotDrafts)
  }

  // Invalidate in-flight query tasks and pending actions when the connected wallet changes
  const prevWalletRef = useRef<string | undefined>(walletAddress)
  useEffect(() => {
    if (prevWalletRef.current !== walletAddress) {
      invalidateDrafts()
      prevWalletRef.current = walletAddress
      queryGenerationRef.current += 1
      queryAbortRef.current?.abort()
      queryAbortRef.current = null
      queryBusyRef.current = false
      setIsAnalyzing(false)
      pendingActionRef.current = null
      setSessionConfig(getSessionKeyConfig(walletAddress, 'copilot'))
    }
  }, [walletAddress])

  const toggleOpen = useCallback(() => {
    setIsOpen((prev) => !prev)
  }, [])

  const streamAssistantMessage = async (msg: CopilotMessage): Promise<void> => {
    // Finish any prior active stream before starting a new one so two typewriter loops never overlap
    flushActiveStream()
    setIsAnalyzing(false)
    const currentGeneration = queryGenerationRef.current
    const draftGeneration = draftGenerationRef.current
    const fullContent = msg.content
    const msgId = msg.id

    // 1. Insert initial message placeholder with isStreaming = true and holding actionPayload
    const initialMsg: CopilotMessage = {
      ...msg,
      content: '',
      isStreaming: true,
      actionPayload: undefined,
    }

    messagesRef.current = [...messagesRef.current, initialMsg]
    setMessages((prev) => [...prev, initialMsg])

    let canceled = false
    let activeTimer: ReturnType<typeof setTimeout> | null = null
    const streamHandle = {
      msgId,
      fullContent,
      actionPayload: msg.actionPayload,
      draftGeneration,
      cancel: () => {
        canceled = true
        if (activeTimer !== null) {
          clearTimeout(activeTimer)
          activeTimer = null
        }
      },
    }
    activeStreamRef.current = streamHandle

    // 2. High-performance, organic typewriter cadence (24 chars batch with natural pauses)
    const chunkSize = 24
    const delayMs = 30

    let currentText = ''
    let i = 0

    while (i < fullContent.length) {
      if (canceled || currentGeneration !== queryGenerationRef.current) {
        if (activeStreamRef.current === streamHandle) activeStreamRef.current = null
        return
      }

      // If we encounter an HTML tag (e.g. <strong>, <code>), consume the entire tag atomically
      if (fullContent[i] === '<') {
        const closingIdx = fullContent.indexOf('>', i)
        if (closingIdx !== -1) {
          currentText += fullContent.slice(i, closingIdx + 1)
          i = closingIdx + 1
        } else {
          currentText += fullContent.slice(i, i + chunkSize)
          i += chunkSize
        }
      } else {
        currentText += fullContent.slice(i, i + chunkSize)
        i += chunkSize
      }

      const textToSet = currentText
      setMessages((prev) =>
        prev.map((m) => (m.id === msgId ? { ...m, content: textToSet } : m))
      )

      // Subtle natural breathing pause on sentence ends and line breaks
      const lastChar = currentText.slice(-1)
      const isPauseChar = lastChar === '.' || lastChar === '!' || lastChar === '?' || lastChar === '\n'
      const currentDelay = isPauseChar ? 45 : delayMs

      await new Promise<void>((resolve) => {
        activeTimer = setTimeout(() => {
          activeTimer = null
          resolve()
        }, currentDelay)
      })
    }

    if (canceled || currentGeneration !== queryGenerationRef.current) {
      if (activeStreamRef.current === streamHandle) activeStreamRef.current = null
      return
    }
    if (activeStreamRef.current === streamHandle) activeStreamRef.current = null

    // 3. Finished streaming: reveal full content, stop cursor, attach actionPayload
    const finalize = (prev: CopilotMessage[]) =>
      prev.map((m) =>
        m.id === msgId
          ? {
              ...m,
              content: fullContent,
              isStreaming: false,
              actionPayload: draftGeneration === draftGenerationRef.current ? msg.actionPayload : undefined,
            }
          : m
      )
    messagesRef.current = finalize(messagesRef.current)
    setMessages(finalize)
  }

  const addMessage = (msg: CopilotMessage) => {
    if (msg.role === 'assistant' && msg.content) {
      streamAssistantMessage(msg)
    } else {
      setMessages((prev) => [...prev, msg])
    }
  }

  const triggerResumeIfPending = useCallback((activeConfig: SessionKeyConfig) => {
    if (activeConfig.isActive && Date.now() <= activeConfig.expiresAt && pendingActionRef.current) {
      const pending = pendingActionRef.current
      const pendingType = normalizeActionType(pending.type)
      const limitCheck = verifySessionLimits(pendingType, estimateActionSpendUsd(pending), walletAddress)
      if (!limitCheck.allowed) return

      pendingActionRef.current = null
      const pendingName =
        pending.type.includes('swap') || pending.type === 'trade'
          ? 'Swap'
          : pending.type === 'interactive_lp_deposit'
            ? 'LP Deposit'
            : pending.type.includes('deposit') || pending.type === 'zap'
              ? 'Vault Deposit'
              : pending.type.includes('bridge')
                ? 'Bridge'
                : 'Send'

      const resumeMsg: CopilotMessage = {
        id: 'assistant-resume-' + Date.now(),
        role: 'assistant',
        content: `✅ Session Settings are now active! Ready to proceed with your ${pendingName} transaction:`,
        timestamp: Date.now(),
        actionPayload: pending,
      }
      addMessage(resumeMsg)
    }
  }, [walletAddress])

  const syncActiveDraftWithSession = useCallback((activeConfig: SessionKeyConfig) => {
    if (pendingActionRef.current) return
    const activeDraft = currentDraftRef.current
    if (!activeDraft || !isTransactionalAction(activeDraft.type)) return

    const isSessionActive = activeConfig.isActive && Date.now() <= activeConfig.expiresAt
    const actionType = normalizeActionType(activeDraft.type)

    if (!isSessionActive) {
      setMessages(invalidateCopilotDrafts)
      pendingActionRef.current = activeDraft
      const blockedMsg: CopilotMessage = {
        id: 'assistant-session-req-' + Date.now(),
        role: 'assistant',
        content: `⚠️ Active session required to execute this transaction. Please set up your Session Settings first.`,
        timestamp: Date.now(),
        actionPayload: {
          type: 'configure_session',
          title: 'Set Up Session Settings',
          data: {
            pendingAction: activeDraft,
            reason: 'Active session required',
            actionType,
          },
        },
      }
      addMessage(blockedMsg)
      return
    }

    const check = verifySessionLimits(actionType, estimateActionSpendUsd(activeDraft), walletAddress)
    if (!check.allowed) {
      setMessages(invalidateCopilotDrafts)
      pendingActionRef.current = activeDraft
      const actionName = actionType.charAt(0).toUpperCase() + actionType.slice(1)
      const reasonMsg = check.reason?.includes('not authorized')
        ? `The "${actionName}" operation is not allowed for this active session. Please check your session settings to grant permission for ${actionName}s.`
        : `${check.reason} Please adjust your session budget or limits in the Session Settings.`

      const limitMsg: CopilotMessage = {
        id: 'assistant-session-limit-' + Date.now(),
        role: 'assistant',
        content: `⚠️ ${reasonMsg}`,
        timestamp: Date.now(),
        actionPayload: {
          type: 'configure_session',
          title: 'Open Session Settings',
          data: {
            pendingAction: activeDraft,
            reason: reasonMsg,
            actionType,
          },
        },
      }
      addMessage(limitMsg)
    }
  }, [walletAddress])

  useEffect(() => {
    setActiveWalletForSession(walletAddress)
    const fresh = getSessionKeyConfig(walletAddress, 'copilot')
    setSessionConfig(fresh)

    const handleSessionUpdate = (e: any) => {
      if (e?.detail) {
        if (e.detail.scope && e.detail.scope !== 'copilot') return
        if (!e.detail.walletAddress || !walletAddress || e.detail.walletAddress.toLowerCase() === walletAddress.toLowerCase()) {
          setSessionConfig(e.detail)
          if (pendingActionRef.current) {
            triggerResumeIfPending(e.detail)
          } else {
            syncActiveDraftWithSession(e.detail)
          }
        }
      } else {
        const updatedFresh = getSessionKeyConfig(walletAddress, 'copilot')
        setSessionConfig(updatedFresh)
        if (pendingActionRef.current) {
          triggerResumeIfPending(updatedFresh)
        } else {
          syncActiveDraftWithSession(updatedFresh)
        }
      }
    }

    if (typeof window !== 'undefined') {
      window.addEventListener(COPILOT_SESSION_UPDATED_EVENT, handleSessionUpdate)
      window.addEventListener(SESSION_KEY_UPDATED_EVENT, handleSessionUpdate)
      return () => {
        window.removeEventListener(COPILOT_SESSION_UPDATED_EVENT, handleSessionUpdate)
        window.removeEventListener(SESSION_KEY_UPDATED_EVENT, handleSessionUpdate)
      }
    }
  }, [isOpen, walletAddress, triggerResumeIfPending, syncActiveDraftWithSession])

  // Real-time sync of active Confirm cards when Ask Arco execution settings (slippage / gas speed tier) change.
  useEffect(() => {
    if (typeof window === 'undefined') return

    const handleWalletSettingsChanged = (e: Event) => {
      const detail = (e as CustomEvent<{ walletAddress?: string }>).detail
      if (
        detail?.walletAddress &&
        normalizeWalletAddressKey(detail.walletAddress) !== normalizeWalletAddressKey(walletAddress)
      ) {
        return
      }

      const activeDraft = currentDraftRef.current
      // Use isSettingsSyncableDraft (not isTransactionalAction) so session-spend-exempt
      // drafts such as interactive_lp_remove and interactive_claim_fees also live-sync.
      if (!isSettingsSyncableDraft(activeDraft)) return

      const seq = ++settingsSyncSeqRef.current
      const targetDraftId = activeDraft.draftId
      const targetRevision = activeDraft.revision
      const copilotSlippage = walletSettingsService.getCopilotSlippage(walletAddress)
      const copilotSpeedTier = walletSettingsService.getCopilotSpeedTier(walletAddress)

      void syncDraftWithExecutionSettings(
        activeDraft,
        { copilotSlippage, copilotSpeedTier },
        walletAddress
      ).then((updatedDraft) => {
        if (!updatedDraft) return
        if (seq !== settingsSyncSeqRef.current) return
        if (
          !currentDraftRef.current ||
          currentDraftRef.current.draftId !== targetDraftId ||
          currentDraftRef.current.revision !== targetRevision
        ) {
          return
        }

        currentDraftRef.current = updatedDraft
        if (
          pendingActionRef.current &&
          pendingActionRef.current.draftId === targetDraftId &&
          pendingActionRef.current.revision === targetRevision
        ) {
          pendingActionRef.current = updatedDraft
        }

        setMessages((prev) =>
          prev.map((msg) => {
            if (msg.receipt || msg.isExecutingInline || !msg.actionPayload) return msg
            if (
              targetDraftId !== undefined &&
              (msg.actionPayload.draftId !== targetDraftId ||
                msg.actionPayload.revision !== targetRevision)
            ) {
              return msg
            }
            if (targetDraftId === undefined && msg.actionPayload !== activeDraft) {
              return msg
            }
            return { ...msg, actionPayload: updatedDraft }
          })
        )
      }).catch(() => {
        // Keep existing draft intact if settings sync fails unexpectedly
      })
    }

    window.addEventListener(WALLET_SETTINGS_CHANGED_EVENT, handleWalletSettingsChanged)
    return () => {
      window.removeEventListener(WALLET_SETTINGS_CHANGED_EVENT, handleWalletSettingsChanged)
    }
  }, [walletAddress])

  const activateSession = async (params: {
    /** Explicit user consent for this session; without it the session stays inactive. */
    userApproved: boolean
    maxSpendUsdc?: number
    durationHours?: number
    maxPerTxUsdc?: number
    autoExecute?: boolean
    allowedActions?: SessionActionType[]
    walletAddress?: string
    enableEnclave?: boolean
    scope?: 'copilot' | 'marketplace'
  }) => {
    const updated = await activateSessionKeyService({
      ...params,
      walletAddress: params.walletAddress || walletAddress,
      scope: params.scope || 'copilot',
    })
    setSessionConfig(updated)
    triggerResumeIfPending(updated)
    return updated
  }

  const revokeSession = () => {
    const updated = revokeSessionKeyService(walletAddress, 'copilot')
    setSessionConfig(updated)
    return updated
  }

  const toggleAutoExecute = (enabled: boolean) => {
    const updated = toggleAutoExecuteService(enabled, walletAddress, 'copilot')
    setSessionConfig(updated)
    return updated
  }

  // Execute an action directly inside the chat window
  // Tracks inline actions currently being broadcast, so a double-click can never send twice.
  const inFlightExecutionsRef = useRef<Set<string>>(new Set())

  const executeInlineAction = async (msgId: string, actionPayload: CopilotActionPayload) => {
    if (inFlightExecutionsRef.current.has(msgId)) return
    if (copilotActionIntent(actionPayload) && (!currentDraftRef.current ||
      actionPayload.draftId !== currentDraftRef.current.draftId ||
      actionPayload.revision !== currentDraftRef.current.revision)) return

    // ARCO-04: When retrying a safely released FAILED or CANCELED card ("Try Again"), advance the
    // draft revision so the immutable session spend ledger admits a fresh reservation instead of
    // short-circuiting with the prior released receipt. SUCCESS and PENDING receipts are never
    // eligible here (their currentDraftRef is already cleared and their status is excluded).
    const existingMsg = messagesRef.current.find((m) => m.id === msgId)
    const isRetryAfterFailure =
      existingMsg?.receipt?.status === 'FAILED' || existingMsg?.receipt?.status === 'CANCELED'
    const effectiveActionPayload: CopilotActionPayload =
      isRetryAfterFailure && copilotActionIntent(actionPayload)
        ? {
            ...actionPayload,
            draftId: actionPayload.draftId || crypto.randomUUID(),
            revision: (actionPayload.revision || 1) + 1,
          }
        : actionPayload

    if (isRetryAfterFailure && copilotActionIntent(effectiveActionPayload)) {
      currentDraftRef.current = effectiveActionPayload
    }

    const liveConfig = getSessionKeyConfig(walletAddress, 'copilot')
    const isSessionActive = liveConfig.isActive && Date.now() <= liveConfig.expiresAt

    if (isTransactionalAction(effectiveActionPayload?.type)) {
      if (!isSessionActive) {
        pendingActionRef.current = effectiveActionPayload
        if (isRetryAfterFailure) {
          setMessages((prev) =>
            prev.map((msg) => (msg.id === msgId ? { ...msg, actionPayload: effectiveActionPayload } : msg))
          )
        }
        const blockedMsg: CopilotMessage = {
          id: 'assistant-session-req-' + Date.now(),
          role: 'assistant',
          content: `⚠️ Active session required to execute this transaction. Please set up your Session Settings first.`,
          timestamp: Date.now(),
          actionPayload: {
            type: 'configure_session',
            title: 'Set Up Session Settings',
            data: {
              pendingAction: effectiveActionPayload,
              reason: 'Active session required',
            },
          },
        }
        addMessage(blockedMsg)
        return
      }

      const actionType = normalizeActionType(effectiveActionPayload.type)
      const check = verifySessionLimits(actionType, estimateActionSpendUsd(effectiveActionPayload), walletAddress)

      if (!check.allowed) {
        pendingActionRef.current = effectiveActionPayload
        if (isRetryAfterFailure) {
          setMessages((prev) =>
            prev.map((msg) => (msg.id === msgId ? { ...msg, actionPayload: effectiveActionPayload } : msg))
          )
        }
        const actionName = actionType.charAt(0).toUpperCase() + actionType.slice(1)
        const reasonMsg = check.reason?.includes('not authorized')
          ? `The "${actionName}" operation is not allowed for this active session. Please check your session settings to grant permission for ${actionName}s.`
          : `${check.reason} Please adjust your session budget or limits in the Session Settings.`

        const assistantMsg: CopilotMessage = {
          id: 'assistant-session-limit-' + Date.now(),
          role: 'assistant',
          content: `⚠️ ${reasonMsg}`,
          timestamp: Date.now(),
          actionPayload: {
            type: 'configure_session',
            title: 'Open Session Settings',
            data: {
              pendingAction: effectiveActionPayload,
              reason: reasonMsg,
              actionType,
            },
          },
        }
        addMessage(assistantMsg)
        return
      }
    }
    inFlightExecutionsRef.current.add(msgId)

    setMessages((prev) =>
      prev.map((msg) =>
        msg.id === msgId
          ? {
              ...msg,
              actionPayload: effectiveActionPayload,
              receipt: undefined,
              isExecutingInline: true,
              executionState: 'routing',
            }
          : msg
      )
    )

    try {
      const { executeDirectCopilotAction } = await import('../services/copilotExecutionService')
      const receipt = await executeDirectCopilotAction(
        effectiveActionPayload,
        walletAddress,
        provider,
        (progressState) => {
          setMessages((prev) =>
            prev.map((msg) =>
              msg.id === msgId
                ? { ...msg, executionState: progressState }
                : msg
            )
          )
        },
        ucwHandlers
      )

      setMessages((prev) =>
        prev.map((msg) =>
          msg.id === msgId
            ? {
                ...msg,
                isExecutingInline: false,
                executionState: receipt.status === 'SUCCESS' ? 'confirmed' : receipt.status === 'PENDING' ? 'pending' : 'failed',
                receipt,
              }
            : msg
        )
      )

      if (receipt.status === 'SUCCESS' || receipt.status === 'PENDING') {
        currentDraftRef.current = null
      }
      setSessionConfig(getSessionKeyConfig(walletAddress, 'copilot'))
    } catch (err: any) {
      const cleanErr = formatCopilotError(err)
      const dynamicActionType: InlineExecutionReceipt['actionType'] =
        effectiveActionPayload?.type === 'interactive_claim_fees'
          ? 'claim'
          : effectiveActionPayload?.type === 'interactive_lp_remove'
            ? 'withdraw'
            : normalizeActionType(effectiveActionPayload?.type)
      setMessages((prev) =>
        prev.map((msg) =>
          msg.id === msgId
            ? {
                ...msg,
                isExecutingInline: false,
                executionState: 'failed',
                receipt: {
                  id: `rcpt_err_${Date.now()}`,
                  actionType: dynamicActionType,
                  title: cleanErr.isCanceled ? canceledActionTitle(dynamicActionType) : cleanErr.title,
                  status: cleanErr.isCanceled ? 'CANCELED' : 'FAILED',
                  txHash: '',
                  gasUsdc: 0,
                  settlementLatencyMs: 0,
                  timestamp: Date.now(),
                  errorMessage: cleanErr.message,
                },
              }              : msg
        )
      )
    } finally {
      inFlightExecutionsRef.current.delete(msgId)
    }
  }

  // Helper to dispatch query to LLM / Local Semantic NLP Engine and handle Session Key Auto-Execution
  const handleLLMIntent = async (
    queryText: string,
    portfolioSnapshot?: any,
    signal?: AbortSignal,
    historySnapshot?: CopilotMessage[]
  ): Promise<void> => {
    const generation = queryGenerationRef.current
    try {
      const { queryArcisLLM } = await import('../services/llmService')
      const llmResult = await queryArcisLLM(
        queryText,
        walletAddress,
        historySnapshot ?? messagesRef.current,
        portfolioSnapshot,
        signal
      )
      if (signal?.aborted || generation !== queryGenerationRef.current) return
      const assistantMsgId = 'assistant-' + Date.now()
      const action = llmResult.actionPayload
      // Any newly prepared transaction supersedes unsubmitted cards, never receipts/in-flight work.
      if (action && copilotActionIntent(action)) {
        invalidateDrafts()
        currentDraftRef.current = action
      }

      const liveConfig = getSessionKeyConfig(walletAddress, 'copilot')
      const isSessionActive = liveConfig.isActive && Date.now() <= liveConfig.expiresAt
      const intent = classifyCopilotIntent(queryText)
      const isExplicitCommand = intent.kind === 'command' || intent.kind === 'correction'

      if (action && isTransactionalAction(action.type)) {
        if (!isSessionActive && isExplicitCommand) {
          pendingActionRef.current = action
          const actionName =
            action.type.includes('swap') || action.type === 'trade'
              ? 'Swap'
              : action.type === 'interactive_lp_deposit'
                ? 'LP Deposit'
                : action.type.includes('deposit') || action.type === 'zap'
                  ? 'Vault Deposit'
                  : action.type.includes('bridge')
                    ? 'Bridge'
                    : 'Send'

          const assistantMsg: CopilotMessage = {
            id: assistantMsgId,
            role: 'assistant',
            content: `${llmResult.message ? `${llmResult.message}\n\n` : ''}⚠️ Please set up your Session Settings before executing ${actionName} and other on-chain transactions. Once configured with your spend limits and duration, Arco can process your transactions safely.`,
            timestamp: Date.now(),
            actionPayload: {
              type: 'configure_session',
              title: 'Set Up Session Settings',
              data: {
                pendingAction: action,
                reason: 'Active session required',
                actionType: normalizeActionType(action.type),
              },
            },
          }
          addMessage(assistantMsg)
          return
        }

        const actionType = normalizeActionType(action.type)

        if (isSessionActive) {
          const check = verifySessionLimits(actionType, estimateActionSpendUsd(action), walletAddress)
          if (!check.allowed) {
            pendingActionRef.current = action
            const actionName = actionType.charAt(0).toUpperCase() + actionType.slice(1)
            const reasonMsg = check.reason?.includes('not authorized')
              ? `The "${actionName}" operation is not allowed for this active session. Please check your session settings to grant permission for ${actionName}s.`
              : `${check.reason} Please adjust your session budget or limits in the Session Settings.`

            const assistantMsg: CopilotMessage = {
              id: 'assistant-session-limit-' + Date.now(),
              role: 'assistant',
              content: `⚠️ ${reasonMsg}`,
              timestamp: Date.now(),
              actionPayload: {
                type: 'configure_session',
                title: 'Open Session Settings',
                data: {
                  pendingAction: action,
                  reason: reasonMsg,
                  actionType,
                },
              },
            }
            addMessage(assistantMsg)
            return
          }
        }

        // Always present the Confirm card template before executing any transactional command.
        const assistantMsg: CopilotMessage = {
          id: assistantMsgId,
          role: 'assistant',
          content: llmResult.message,
          timestamp: Date.now(),
          actionPayload: action,
        }
        addMessage(assistantMsg)
      } else {
        const assistantMsg: CopilotMessage = {
          id: assistantMsgId,
          role: 'assistant',
          content: llmResult.message,
          timestamp: Date.now(),
          actionPayload: action,
          ...(intent.kind === 'correction' && !action && Boolean(currentDraftRef.current)
            ? { preservesActiveDraft: true }
            : {}),
        }
        addMessage(assistantMsg)
      }
    } catch (err: any) {
      if (signal?.aborted || err?.name === 'AbortError' || generation !== queryGenerationRef.current) {
        return
      }
      console.error('LLM Intent Execution Error:', err)
      const assistantMsg: CopilotMessage = {
        id: 'assistant-' + Date.now(),
        role: 'assistant',
        content: `I encountered an error processing your query. Please try again or select one of the suggested topics above.`,
        timestamp: Date.now(),
      }
      addMessage(assistantMsg)
    }
  }

  // Paid analysis/reporting agents: a portfolio query buys a measured risk report and, when
  // that measurement exists, a narrative around it. A vault query buys the vault position
  // report. Both flows show each paid step, its cost and the running total.
  const runPaidPortfolioAnalysis = async (
    targetAddressInput?: string,
    includeGatewayBalance: boolean = true
  ): Promise<void> => {
    const steps: CopilotStepLog[] = []
    let totalCost = 0
    const targetAddress = targetAddressInput || walletAddress

    if (!walletAddress) {
      addMessage({
        id: 'assistant-' + Date.now(),
        role: 'assistant',
        content: 'Connect a wallet first: these paid analysis agents charge the connected EOA (an injected wallet or a Circle Wallet) per call.',
        timestamp: Date.now(),
      })
      setCurrentSteps([])
      return
    }
    if (!targetAddress) {
      addMessage({
        id: 'assistant-' + Date.now(),
        role: 'assistant',
        content: 'Give me a 20-byte Arc address to analyse, or connect a wallet so I can read your own portfolio.',
        timestamp: Date.now(),
      })
      setCurrentSteps([])
      return
    }
    if (!hasPaidCallPayer) {
      addMessage({
        id: 'assistant-' + Date.now(),
        role: 'assistant',
        content: 'Circle Gateway paid calls require an external EOA or an active Circle Wallet signing session (or a funded Session Enclave); passkey/MSCA wallets alone are unsupported.',
        timestamp: Date.now(),
      })
      setCurrentSteps([])
      return
    }

    const riskService = ARC_SERVICES_REGISTRY.find((s) => s.id === 'arc-portfolio-risk-exposure')
    if (!riskService) {
      addMessage({
        id: 'assistant-' + Date.now(),
        role: 'assistant',
        content: 'The portfolio risk service is not listed in the catalog, so no paid call was made.',
        timestamp: Date.now(),
      })
      setCurrentSteps([])
      return
    }

    steps.push({
      stepNumber: 1,
      serviceId: riskService.id,
      serviceName: riskService.name,
      status: 'executing',
      costUsdc: 0,
      durationMs: 0,
      detail: 'Reading Arc token balances and, if requested, the Circle Gateway unified balance...',
    })
    setCurrentSteps([...steps])

    let risk: any
    try {
      const resolvedPayer = await resolveEffectivePaidCallPayer(riskService.pricing.priceUsdc)
      if (!resolvedPayer) {
        throw new Error('No eligible Circle Gateway payer is available.')
      }
      risk = await executeX402Call(
        riskService,
        { address: targetAddress, includeGatewayBalance },
        walletAddress,
        provider,
        resolvedPayer.kind,
        resolvedPayer.signer
      )
    } catch (err: any) {
      steps[0].status = 'failed'
      steps[0].resultSummary = err?.message || 'Portfolio risk call failed.'
      setCurrentSteps([...steps])
      addMessage({
        id: 'assistant-' + Date.now(),
        role: 'assistant',
        content: `Portfolio risk analysis failed before a measurement was returned: ${err?.message || 'unknown error'}.`,
        timestamp: Date.now(),
        steps: [...steps],
      })
      return
    }

    const riskPaid = isPaidOrSettled(risk)
    if (riskPaid) {
      totalCost += risk.costUsdc
      steps[0].costUsdc = risk.costUsdc
    }
    const riskData = risk?.data as any
    const riskUsable = isServiceDataAvailable(risk)
    steps[0].durationMs = risk?.executionTimeMs || 0
    steps[0].status = riskUsable ? 'completed' : 'failed'
    steps[0].resultSummary = riskUsable
      ? `Measured ${formatUsdReportValue(riskData?.totalUsd)} across ${Array.isArray(riskData?.holdings) ? riskData.holdings.length : 0} assets.`
      : `No measurement returned: ${risk?.error || riskData?.reason || 'service data unavailable'}`
    setCurrentSteps([...steps])

    if (!riskUsable) {
      const unavailable = Array.isArray(riskData?.unavailable) ? riskData.unavailable.join(', ') : null
      const riskNote = formatX402FailureNote(risk)
      addMessage({
        id: 'assistant-' + Date.now(),
        role: 'assistant',
        content: `Portfolio risk analysis could not measure this wallet.${unavailable ? `\n\n• <strong>Unavailable:</strong> ${unavailable}` : ''}${riskData?.reason ? `\n\n${riskData.reason}` : ''}${riskNote ? `\n\n${riskNote}` : ''}\n\nNo charge was incurred on an unmeasured portfolio.${riskPaid ? `\n\nPayment: ${risk.costUsdc} USDC for the failed measurement; Gateway acceptance is not final settlement.` : ''}`,
        timestamp: Date.now(),
        steps: [...steps],
        ...(totalCost > 0 ? { totalCostUsdc: totalCost } : {}),
      })
      return
    }

    const measured = riskData || {}
    const riskFlags: string[] = Array.isArray(measured?.riskFlags) ? measured.riskFlags : []

    const lines: string[] = []
    lines.push('Paid portfolio analysis completed — measured facts below, analysis only; no transaction was executed.')

    // The measured risk call carries the institutional envelope; render its identity and its
    // graded register so severity, evidence and thresholds are visible.
    const riskReportHeader = formatInstitutionalReportHeader(riskData?.report)
    if (riskReportHeader) lines.push(riskReportHeader)

    lines.push(
      [
        `• <strong>Measured total:</strong> ${formatUsdReportValue(measured?.totalUsd)}`,
        `• <strong>Concentration:</strong> ${formatPctReportValue(measured?.concentrationPct)}`,
        `• <strong>Stablecoin share:</strong> ${formatPctReportValue(measured?.stablecoinSharePct)}`,
        `• <strong>Gateway balance:</strong> ${formatUsdReportValue(measured?.gatewayBalanceUsdc)}`,
        `• <strong>Risk flags:</strong> ${riskFlags.length > 0 ? riskFlags.map((flag) => flag.replace(/_/g, ' ')).join(', ') : 'none reported'}`,
      ].join('\n')
    )

    const riskRegisterLines = formatRiskRegisterLines(riskData?.report, 4)
    if (riskRegisterLines.length > 0) lines.push(riskRegisterLines.join('\n'))

    if (totalCost > 0) {
      lines.push(
        `Payment: ${totalCost.toFixed(3)} USDC across ${steps.filter((step) => step.costUsdc > 0).length} paid call(s). Gateway acceptance is not final settlement; provider accounting stays pending until reconciliation.`
      )
    }
    addMessage({
      id: 'assistant-' + Date.now(),
      role: 'assistant',
      content: lines.join('\n\n'),
      timestamp: Date.now(),
      steps: [...steps],
      nextSteps: recommendationsForReport(riskData?.report, {
        serviceId: riskService.id,
        requestParams: { address: targetAddress, includeGatewayBalance },
        limit: 2,
      }),
      ...(totalCost > 0 ? { totalCostUsdc: totalCost } : {}),
      actionPayload: { type: 'ai-services', title: 'Open AI Services Catalog', data: {} },
    })
  }

  const runPaidVaultReport = async (targetAddressInput?: string): Promise<void> => {
    const steps: CopilotStepLog[] = []
    let totalCost = 0
    const targetAddress = targetAddressInput || walletAddress

    if (!walletAddress) {
      addMessage({
        id: 'assistant-' + Date.now(),
        role: 'assistant',
        content: 'Connect a wallet first: the vault report is a paid call charged to the connected EOA (an injected wallet or a Circle Wallet).',
        timestamp: Date.now(),
      })
      setCurrentSteps([])
      return
    }
    if (!targetAddress) {
      addMessage({
        id: 'assistant-' + Date.now(),
        role: 'assistant',
        content: 'Give me a 20-byte Arc address whose vault position should be reported.',
        timestamp: Date.now(),
      })
      setCurrentSteps([])
      return
    }
    if (!hasPaidCallPayer) {
      addMessage({
        id: 'assistant-' + Date.now(),
        role: 'assistant',
        content: 'Circle Gateway paid calls require an external EOA or an active Circle Wallet signing session (or a funded Session Enclave); passkey/MSCA wallets alone are unsupported.',
        timestamp: Date.now(),
      })
      setCurrentSteps([])
      return
    }

    const service = ARC_SERVICES_REGISTRY.find((s) => s.id === 'arc-vault-yield-tax-report')
    if (!service) {
      addMessage({
        id: 'assistant-' + Date.now(),
        role: 'assistant',
        content: 'The vault reporting service is not listed in the catalog, so no paid call was made.',
        timestamp: Date.now(),
      })
      setCurrentSteps([])
      return
    }

    steps.push({
      stepNumber: 1,
      serviceId: service.id,
      serviceName: service.name,
      status: 'executing',
      costUsdc: 0,
      durationMs: 0,
      detail: 'Reading vault shares, principal, pending yield and redeemable value on-chain...',
    })
    setCurrentSteps([...steps])

    let report: any
    try {
      const resolvedPayer = await resolveEffectivePaidCallPayer(service.pricing.priceUsdc)
      if (!resolvedPayer) {
        throw new Error('No eligible Circle Gateway payer is available.')
      }
      report = await executeX402Call(
        service,
        { address: targetAddress },
        walletAddress,
        provider,
        resolvedPayer.kind,
        resolvedPayer.signer
      )
    } catch (err: any) {
      steps[0].status = 'failed'
      steps[0].resultSummary = err?.message || 'Vault report call failed.'
      setCurrentSteps([...steps])
      addMessage({
        id: 'assistant-' + Date.now(),
        role: 'assistant',
        content: `Vault report failed before a measurement was returned: ${err?.message || 'unknown error'}.`,
        timestamp: Date.now(),
        steps: [...steps],
      })
      return
    }

    const paid = isPaidOrSettled(report)
    if (paid) {
      totalCost += report.costUsdc
      steps[0].costUsdc = report.costUsdc
    }
    const data = report?.data as any
    const usable = isServiceDataAvailable(report)
    steps[0].durationMs = report?.executionTimeMs || 0
    steps[0].status = usable ? 'completed' : 'failed'
    steps[0].resultSummary = usable
      ? data?.status === 'NO_POSITION'
        ? 'This address holds no vault shares.'
        : 'Vault position measured on-chain and narrated.'
      : `Report unavailable: ${report?.error || data?.reason || 'service data unavailable'}`
    setCurrentSteps([...steps])

    if (!usable) {
      const unavailable = Array.isArray(data?.unavailable) ? data.unavailable.join(', ') : null
      const reportNote = formatX402FailureNote(report)
      addMessage({
        id: 'assistant-' + Date.now(),
        role: 'assistant',
        content: `Vault report could not be produced.${unavailable ? `\n\n• <strong>Unavailable:</strong> ${unavailable}` : ''}${data?.reason ? `\n\n${data.reason}` : ''}${reportNote ? `\n\n${reportNote}` : ''}${totalCost > 0 ? `\n\nPayment: ${totalCost} USDC; Gateway acceptance is not final settlement.` : ''}`,
        timestamp: Date.now(),
        steps: [...steps],
        ...(totalCost > 0 ? { totalCostUsdc: totalCost } : {}),
      })
      return
    }

    const measured = data?.measured && typeof data.measured === 'object' ? data.measured : {}
    const narrative = data?.narrative && typeof data.narrative === 'object' ? data.narrative : null
    const observations: string[] = Array.isArray(narrative?.observations)
      ? narrative.observations.filter((item: unknown): item is string => typeof item === 'string')
      : []
    const narrativeRisks: string[] = Array.isArray(narrative?.risks)
      ? narrative.risks.filter((item: unknown): item is string => typeof item === 'string')
      : []
    const limitations: string[] = Array.isArray(data?.limitations) ? data.limitations : []

    const lines: string[] = []
    if (data?.status === 'NO_POSITION') {
      lines.push('Vault report completed — this address holds no vault shares, so there is no position to report.')
    } else {
      lines.push('Paid vault report completed — measured from the ERC-4626 vault; this is not a tax filing.')
      lines.push(
        [
          `• <strong>Shares:</strong> ${measured?.shares ?? 'unavailable'}`,
          `• <strong>Redeemable value:</strong> ${formatUsdReportValue(measured?.currentValueUsdc)}`,
          `• <strong>Principal:</strong> ${formatUsdReportValue(measured?.principalUsdc)}`,
          `• <strong>Pending yield:</strong> ${formatUsdReportValue(measured?.pendingYieldUsdc)}`,
          `• <strong>Unrealized yield:</strong> ${formatUsdReportValue(measured?.unrealizedYieldUsdc)}`,
        ].join('\n')
      )
    }

    // The position report carries the institutional envelope; show its identity and graded
    // findings (impairment, unrealized gain, disclosure limits) before the narrative.
    const positionReportHeader = formatInstitutionalReportHeader(data?.report)
    if (positionReportHeader) lines.push(positionReportHeader)
    const positionRegisterLines = formatRiskRegisterLines(data?.report, 4)
    if (positionRegisterLines.length > 0) lines.push(positionRegisterLines.join('\n'))

    if (narrative) {
      lines.push(
        [
          `<strong>Report narrative:</strong> ${narrative.headline || ''}`,
          ...observations.map((observation) => `• ${observation}`),
          ...(narrativeRisks.length > 0 ? [`<strong>Risks:</strong> ${narrativeRisks.join(' ')}`] : []),
        ].join('\n')
      )
    }
    if (limitations.length > 0) {
      lines.push(`<strong>Limitations:</strong> ${limitations.join(' ')}`)
    }
    if (totalCost > 0) {
      lines.push(
        `Payment: ${totalCost.toFixed(3)} USDC. Gateway acceptance is not final settlement; provider accounting stays pending until reconciliation.`
      )
    }
    addMessage({
      id: 'assistant-' + Date.now(),
      role: 'assistant',
      content: lines.join('\n\n'),
      timestamp: Date.now(),
      steps: [...steps],
      nextSteps: recommendationsForReport(data?.report, {
        serviceId: service.id,
        requestParams: { address: targetAddress },
        limit: 2,
      }),
      ...(totalCost > 0 ? { totalCostUsdc: totalCost } : {}),
      actionPayload: { type: 'ai-services', title: 'Open AI Services Catalog', data: {} },
    })
  }


  // Measures the ERC-4626 USDC Yield Vault and all 6 live Arc V4 AMM pools on-chain.
  const runPaidVaultAnalytics = async (riskPreferenceInput?: unknown): Promise<void> => {
    const steps: CopilotStepLog[] = []
    let totalCost = 0
    const rawPref = String(riskPreferenceInput ?? 'all').toLowerCase()
    const riskPreference =
      rawPref === 'stable_only' || rawPref === 'volatile_only' ? rawPref : 'all'

    if (!walletAddress) {
      addMessage({
        id: 'assistant-' + Date.now(),
        role: 'assistant',
        content: 'Connect a wallet first: the vault analytics read is a paid call charged to the connected EOA (an injected wallet or a Circle Wallet).',
        timestamp: Date.now(),
      })
      setCurrentSteps([])
      return
    }
    if (!hasPaidCallPayer) {
      addMessage({
        id: 'assistant-' + Date.now(),
        role: 'assistant',
        content: 'Circle Gateway paid calls require an external EOA or an active Circle Wallet signing session (or a funded Session Enclave); passkey/MSCA wallets alone are unsupported.',
        timestamp: Date.now(),
      })
      setCurrentSteps([])
      return
    }

    const service = ARC_SERVICES_REGISTRY.find((s) => s.id === 'arc-yield-vault-analytics')
    if (!service) {
      addMessage({
        id: 'assistant-' + Date.now(),
        role: 'assistant',
        content: 'The yield & pool finder service is not listed in the catalog, so no paid call was made.',
        timestamp: Date.now(),
      })
      setCurrentSteps([])
      return
    }

    steps.push({
      stepNumber: 1,
      serviceId: service.id,
      serviceName: service.name,
      status: 'executing',
      costUsdc: 0,
      durationMs: 0,
      detail: 'Scanning ERC-4626 vault accounting and all 6 live Arc V4 AMM pools on-chain...',
    })
    setCurrentSteps([...steps])

    let result: any
    try {
      const resolvedPayer = await resolveEffectivePaidCallPayer(service.pricing.priceUsdc)
      if (!resolvedPayer) {
        throw new Error('No eligible Circle Gateway payer is available.')
      }
      result = await executeX402Call(
        service,
        { riskPreference, walletAddress },
        walletAddress,
        provider,
        resolvedPayer.kind,
        resolvedPayer.signer
      )
    } catch (err: any) {
      steps[0].status = 'failed'
      steps[0].resultSummary = err?.message || 'Vault analytics call failed.'
      setCurrentSteps([...steps])
      addMessage({
        id: 'assistant-' + Date.now(),
        role: 'assistant',
        content: `Vault analytics failed before a measurement was returned: ${err?.message || 'unknown error'}.`,
        timestamp: Date.now(),
        steps: [...steps],
      })
      return
    }

    const paid = isPaidOrSettled(result)
    if (paid) {
      totalCost += result.costUsdc
      steps[0].costUsdc = result.costUsdc
    }
    const data = result?.data as any
    const usable = isServiceDataAvailable(result)
    steps[0].durationMs = result?.executionTimeMs || 0
    steps[0].status = usable ? 'completed' : 'failed'
    steps[0].resultSummary = usable
      ? data?.status === 'VAULT_EMPTY'
        ? `Vault holds ${formatUsdReportValue(data?.tvlUsdc)} of assets against zero shares, so no share price is measurable.`
        : `Vault TVL ${formatUsdReportValue(data?.tvlUsdc)} at ${formatUsdReportValue(data?.sharePriceUsdc)} per share.`
      : `Vault analytics unavailable: ${result?.error || data?.reason || 'service data unavailable'}`
    setCurrentSteps([...steps])

    if (!usable) {
      const unavailable = Array.isArray(data?.unavailable) ? data.unavailable.join(', ') : null
      const readNote = formatX402FailureNote(result)
      addMessage({
        id: 'assistant-' + Date.now(),
        role: 'assistant',
        content: `Vault analytics could not measure the vault.${unavailable ? `\n\n• <strong>Unavailable:</strong> ${unavailable}` : ''}${data?.reason ? `\n\n${data.reason}` : ''}${readNote ? `\n\n${readNote}` : ''}${totalCost > 0 ? `\n\nPayment: ${totalCost} USDC; Gateway acceptance is not final settlement.` : ''}`,
        timestamp: Date.now(),
        steps: [...steps],
        ...(totalCost > 0 ? { totalCostUsdc: totalCost } : {}),
      })
      return
    }

    const limitations: string[] = Array.isArray(data?.limitations) ? data.limitations : []
    const sharesText =
      typeof data?.totalSupplyShares === 'string'
        ? `${data.totalSupplyShares} shares (${data?.shareDecimals ?? '?'} decimals)`
        : 'unavailable'

    const lines: string[] = []
    lines.push(
      data?.status === 'VAULT_EMPTY'
        ? 'Paid vault analytics completed — the vault holds assets but no shares are outstanding, so no holder has a claim priced by a share.'
        : 'Paid vault analytics completed — measured from the ERC-4626 vault itself, not inferred from a position.'
    )

    const vaultReportHeader = formatInstitutionalReportHeader(data?.report)
    if (vaultReportHeader) lines.push(vaultReportHeader)

    lines.push(
      [
        `• <strong>Vault TVL:</strong> ${formatUsdReportValue(data?.tvlUsdc)}`,
        `• <strong>Share price:</strong> ${formatUsdReportValue(data?.sharePriceUsdc)}`,
        `• <strong>Total assets:</strong> ${formatUsdReportValue(data?.totalAssetsUsdc)}`,
        `• <strong>Shares outstanding:</strong> ${sharesText}`,
        `• <strong>Vault:</strong> ${data?.vaultAddress || 'unavailable'}`,
        ...(typeof data?.poolsMeasuredCount === 'number'
          ? [`• <strong>Live Arc AMM pools scanned:</strong> ${data.poolsMeasuredCount}/${data.poolsScannedCount ?? 6} (filter: ${riskPreference})`]
          : []),
        `• <strong>On-chain snapshot:</strong> no historical APY series is published on-chain; pool fee run-rates reflect 24h rolling volume only.`,
      ].join('\n')
    )

    const registerLines = formatRiskRegisterLines(data?.report, 4)
    if (registerLines.length > 0) lines.push(registerLines.join('\n'))

    if (limitations.length > 0) {
      lines.push(`<strong>Limitations:</strong> ${limitations.join(' ')}`)
    }
    if (totalCost > 0) {
      lines.push(
        `Payment: ${totalCost.toFixed(3)} USDC. Gateway acceptance is not final settlement; provider accounting stays pending until reconciliation.`
      )
    }
    addMessage({
      id: 'assistant-' + Date.now(),
      role: 'assistant',
      content: lines.join('\n\n'),
      timestamp: Date.now(),
      steps: [...steps],
      nextSteps: recommendationsForReport(data?.report, {
        serviceId: service.id,
        requestParams: { riskPreference, walletAddress },
        limit: 2,
      }),
      ...(totalCost > 0 ? { totalCostUsdc: totalCost } : {}),
      actionPayload: { type: 'ai-services', title: 'Open AI Services Catalog', data: {} },
    })
  }

  // Orchestrate execution of natural language query or quick prompt
  const executeQuery = async (queryText: string) => {
    if (!queryText.trim()) return
    const intent = classifyCopilotIntent(queryText)
    // Cancellation must work while a provider response is still in flight.
    if (intent.kind === 'cancel') {
      queryGenerationRef.current += 1
      queryAbortRef.current?.abort()
      invalidateDrafts()
      addMessage({ id: 'user-' + Date.now(), role: 'user', content: queryText, timestamp: Date.now() })
      addMessage({ id: 'assistant-cancel-' + Date.now(), role: 'assistant', content: intent.message, timestamp: Date.now() })
      setCurrentSteps([])
      return
    }
    if (queryBusyRef.current) return
    queryBusyRef.current = true
    setIsAnalyzing(true)

    const currentGeneration = queryGenerationRef.current
    const abortController = new AbortController()
    queryAbortRef.current = abortController

    try {
      // Flush any still-streaming assistant reply so its actionPayload is immediately visible
      // to multi-turn corrections and no two typewriter loops overlap.
      flushActiveStream()
      const historyBeforeTurn = messagesRef.current
      const userMsgId = 'user-' + Date.now()
      const userMsg: CopilotMessage = {
        id: userMsgId,
        role: 'user',
        content: queryText,
        timestamp: Date.now(),
      }
      addMessage(userMsg)
      // Only a fresh transaction command immediately supersedes existing drafts;
      // a correction invalidates the prior draft only once a valid revised action is prepared.
      if (intent.kind === 'command') invalidateDrafts()
      // Paid analysis/report intents are answered before the generic read-only-reply gate:
      // they are measurements bought per call, not transaction drafts.
      if (
        isVaultReportQuery(queryText) ||
        isPortfolioAnalysisQuery(queryText) ||
        isVaultAnalyticsQuery(queryText)
      ) {
        const paidTargetAddress = queryText.match(/0x[a-fA-F0-9]{40}/)?.[0]
        if (isVaultReportQuery(queryText)) {
          await runPaidVaultReport(paidTargetAddress)
        } else if (isVaultAnalyticsQuery(queryText)) {
          await runPaidVaultAnalytics()
        } else {
          await runPaidPortfolioAnalysis(paidTargetAddress)
        }
        setCurrentSteps([])
        return
      }
      if (intent.kind === 'ambiguous' || (intent.kind === 'read-only' && !isTopicPrompt(queryText) && !isPureEducationalQuery(queryText))) {
        addMessage({ id: 'assistant-' + Date.now(), role: 'assistant', content: intent.message, timestamp: Date.now() })
        setCurrentSteps([])
        return
      }

      // Fetch live on-chain portfolio snapshot directly (no artificial 1.8s wait)
      const portfolioSnapshot = await getLivePortfolioSnapshot(walletAddress)
      if (currentGeneration !== queryGenerationRef.current) return

      // 0. PRIORITY ACTION & STRATEGY ROUTING
      // If the query is an action, swap, bridge, deposit, faucet,
      // or multi-turn correction, directly dispatch to the LLM / Local NLP Engine.
      if (isActionOrStrategyIntent(queryText)) {
        await handleLLMIntent(queryText, portfolioSnapshot, abortController.signal, historyBeforeTurn)
        setCurrentSteps([])
        return
      }

    const q = queryText.toLowerCase()
    const steps: CopilotStepLog[] = []
    let totalCost = 0

    // ─────────────────────────────────────────────────────────────
    // 1. GETTING STARTED HANDLERS
    // ─────────────────────────────────────────────────────────────

    if (
      q.includes('what makes it unique on arc l1') ||
      q.includes('what is arcis')
    ) {
      const assistantMsg: CopilotMessage = {
        id: 'assistant-' + Date.now(),
        role: 'assistant',
        content: `Arcis Protocol is a next-generation decentralized capital and DeFi operating system built natively on Arc L1.

It combines ultra-low latency execution, unified cross-chain liquidity, and an autonomous AI agent marketplace into a single frictionless ecosystem.

<strong>Key Highlights:</strong>

• <strong>Native USDC Gas Token:</strong>
All transaction fees on Arc L1 are paid directly in USDC (~$0.005 per tx). There is no need to hold or manage volatile gas tokens like ETH.

• <strong>Sub-Second Finality (&lt;500ms):</strong>
Transactions settle and finalize in under 500 milliseconds on Arc L1, reducing execution latency and exposure window.

• <strong>Circle Gateway Liquidity:</strong>
Access your unified USDC balance across 13+ blockchains with instant spendability and streamlined cross-chain movement.

• <strong>Real-Yield Vault (af-USDC):</strong>
Deposit USDC into ERC-4626 tokenized vaults earning sustainable ~8.42% APY powered by organic protocol trading volume (zero token inflation).

• <strong>x402 AI Services:</strong>
Autonomous marketplace connecting AI agents and users with pay-per-call HTTP 402 services with instant micropayments via Circle User-Controlled Wallets.`,
        timestamp: Date.now(),
      }
      addMessage(assistantMsg)
    } else if (
      q.includes('connect my wallet and get started') ||
      q.includes('get testnet usdc') ||
      q.includes('start without paying eth gas') ||
      q.includes('connect my wallet')
    ) {
      const assistantMsg: CopilotMessage = {
        id: 'assistant-' + Date.now(),
        role: 'assistant',
        content: `Getting started on Arcis is instant, non-custodial, and 100% gas-abstracted. You do not need any ETH or external native tokens.

<strong>Quick Start in 4 Steps:</strong>

1. <strong>Connect Your Web3 Wallet:</strong>
Click <strong>Connect Wallet</strong> in the top navigation. Supported wallets include browser injected EOAs (MetaMask, Rabby, Coinbase Wallet, Rainbow) as well as <strong>Circle User-Controlled Wallets (UCW)</strong> using email OTP or social passkey.

2. <strong>Switch to Arc Testnet:</strong>
Your wallet will automatically prompt you to connect to <strong>Arc Testnet</strong> (Chain ID: <code>5042002</code>, RPC: <code>https://rpc.testnet.arc.network</code>).

3. <strong>Get Testnet USDC:</strong>
Click <strong>Faucet</strong> in the top header to claim free testnet USDC. Because Arc L1 uses USDC as its native gas currency, your testnet USDC serves as both your trading capital and your transaction gas fee token (~$0.005 per swap).

4. <strong>Execute Your First Action:</strong>
You're all set! Try a quick swap with <code>/swap 10 USDC to EURC</code>, deposit into the <code>/vault</code>, or ask me for an optimal portfolio strategy.`,
        timestamp: Date.now(),
      }
      addMessage(assistantMsg)
    } else if (
      q.includes('bring usdc from ethereum') ||
      q.includes('bring usdc from') ||
      q.includes('bring usdc to arc') ||
      q.includes('transfer usdc from')
    ) {
      const assistantMsg: CopilotMessage = {
        id: 'assistant-' + Date.now(),
        role: 'assistant',
        content: `Arcis provides two high-performance rails to bring USDC and other assets to Arc L1:

<strong>1. Circle Gateway (Instant Unified Balance):</strong>
• <strong>Zero Bridge Wait Time:</strong> Hold a unified USDC balance across Ethereum, Base, Arbitrum, Polygon, and Solana.
• <strong>Burn &amp; Mint:</strong> Deposit on your source chain, and spend or mint instantly (&lt;500ms) on Arc L1 with cryptographic attestations.
• Navigate to the <strong>Gateway</strong> tab to inspect and manage your unified cross-chain balance.

<strong>2. Circle CCTP &amp; CCTP-X (Native Cross-Chain Transfers):</strong>
• Move native USDC with 1:1 capital efficiency and zero slippage.
• Also bridge <strong>EURC</strong>, <strong>wETH</strong>, and <strong>cirBTC</strong> natively between Arc Testnet and supported EVM testnets without wrapping risk.
• Open the <strong>Bridge</strong> tab or type <code>/bridge</code> to initiate a cross-chain transfer.`,
        timestamp: Date.now(),
      }
      addMessage(assistantMsg)
    } else if (
      q.includes('core defi modules') ||
      q.includes('core features i can use on arcis') ||
      q.includes('core features') ||
      q.includes('main modules')
    ) {
      const assistantMsg: CopilotMessage = {
        id: 'assistant-' + Date.now(),
        role: 'assistant',
        content: `Arcis delivers a comprehensive suite of high-performance DeFi modules designed for speed, capital efficiency, and autonomous intelligence:

<strong>Core Ecosystem Modules:</strong>

1. <strong>Smart DEX Router (Swap):</strong>
Execute trades across ArcSwap V3 with multi-hop split routing, dynamic slippage protection, and sub-cent USDC gas fees.

2. <strong>Real-Yield Vaults (Pools &amp; af-USDC):</strong>
Deposit USDC into tokenized ERC-4626 vaults earning sustainable ~8.42% APY backed by protocol volume, not inflationary token printing.

3. <strong>Bridge &amp; Gateway:</strong>
Teleport USDC across 13+ ecosystems instantly via Circle Gateway, or bridge native EURC, cirBTC, and wETH via CCTP.

4. <strong>x402 AI Services:</strong>
Autonomous marketplace connecting AI agents and users with pay-per-call HTTP 402 services (portfolio risk scoring, DEX arbitrage scanners, and automated reporting).

5. <strong>Send &amp; Payments:</strong>
Gasless USDC transfers with custom transaction memos and real-time confirmation tracking.`,
        timestamp: Date.now(),
      }
      addMessage(assistantMsg)
    } else if (
      q.includes('what can i do directly through ask arco') ||
      q.includes('what can i do directly through arco') ||
      q.includes('what can ask arco do') ||
      q.includes('ask arco copilot')
    ) {
      const assistantMsg: CopilotMessage = {
        id: 'assistant-' + Date.now(),
        role: 'assistant',
        content: `I'm <strong>Arco</strong>, your autonomous DeFi copilot! Unlike ordinary informational chatbots, I can analyze live on-chain state and prepare executable transactions directly in this drawer.

<strong>What You Can Do With Me:</strong>

• <strong>Execute Transactions:</strong>
Type natural commands like <em>"Swap 50 USDC for EURC"</em>, <em>"Deposit 100 USDC to af-USDC vault"</em>, or <em>"Send 10 USDC to 0x..."</em>. I calculate optimal routes and display interactive confirmation cards right here.

• <strong>Slash Commands:</strong>
Quickly trigger protocol actions with <code>/swap</code>, <code>/send</code>, <code>/vault</code>, <code>/add-lp</code>, <code>/remove-lp</code>, <code>/claim</code>, <code>/bridge</code>, <code>/strategy</code>, <code>/arbitrage</code>, <code>/session</code>, <code>/clear</code>, or <code>/help</code>.

• <strong>DeFi Intelligence &amp; Strategy:</strong>
Ask <em>"Analyze my portfolio"</em> or <em>"Scan Arc DEX for arbitrage opportunities"</em> to get real-time risk scores and pool analytics.

• <strong>x402 Autonomous Micro-Services:</strong>
Run verified on-chain analytics reports (like Circle Gateway flow or portfolio exposure) settling instantly via HTTP 402 micropayments.

• <strong>Execution Settings:</strong>
Adjust your slippage tolerance (0.1% to 1.0%) and gas speed right from the top settings icon in this chat!`,
        timestamp: Date.now(),
      }
      addMessage(assistantMsg)
    } else if (
      q.includes('why does arc l1 use usdc') ||
      q.includes('native gas token instead of eth') ||
      q.includes('native gas token')
    ) {
      const assistantMsg: CopilotMessage = {
        id: 'assistant-' + Date.now(),
        role: 'assistant',
        content: `Arc L1 is purpose-built to use USDC as its native gas currency instead of ETH. This architectural design eliminates critical friction points in decentralized finance:

<strong>Key Advantages:</strong>

1. <strong>Predictable and Stable Costs:</strong>
Gas prices remain constant in dollar terms regardless of crypto market volatility. A standard swap consistently costs under $0.005 USDC.

2. <strong>Single-Token Simplicity:</strong>
Users and autonomous agents never have to maintain dual balances (one for gas and one for trading). A single USDC balance powers all swaps, liquidity provision, and gas payments.

3. <strong>Seamless Agent Micro-Transactions:</strong>
Autonomous AI agents can execute micro-tasks and pay x402 HTTP 402 fees without complex multi-token bridging or gas wrapping.`,
        timestamp: Date.now(),
      }
      addMessage(assistantMsg)
    } else if (
      q.includes('how does <500ms finality protect') ||
      q.includes('500ms finality') ||
      q.includes('sub-second finality')
    ) {
      const assistantMsg: CopilotMessage = {
        id: 'assistant-' + Date.now(),
        role: 'assistant',
        content: `On traditional networks, transactions wait in a public mempool for 2 to 12 seconds, allowing predatory MEV bots to front-run, sandwich, or extract value from user trades.

Arc L1 solves this with sub-second deterministic finality:

<strong>Key Protections:</strong>

• <strong>Instant State Inclusion:</strong>
Transactions are included in blocks and finalized in under 500 milliseconds, which leaves a far smaller window for front-running than a multi-second public mempool.

• <strong>No Private Relayer:</strong>
Arcis does not operate a private relayer or bundle pipeline — swaps are submitted as ordinary Arc transactions. The Smart Trade & Execution Advisor measures pool depth and price impact before you swap; it provides advisory metrics, not transaction protection.

• <strong>Price Transparency:</strong>
The quote is read from live pool reserves, and slippage tolerance is yours to set; pool depth can still move the execution price, which is why that limit exists.`,
        timestamp: Date.now(),
      }
      addMessage(assistantMsg)
    }

    // ─────────────────────────────────────────────────────────────
    // 2. SWAPPING HANDLERS
    // ─────────────────────────────────────────────────────────────
    else if (
      q.includes('how do token swaps work') ||
      (q.includes('token swaps work') && (q.includes('arcis')))
    ) {
      const assistantMsg: CopilotMessage = {
        id: 'assistant-' + Date.now(),
        role: 'assistant',
        content: `Swapping tokens on Arcis is designed to be frictionless, instant, and gas-predictable.

<strong>Step-by-Step Swap Process:</strong>

1. <strong>Select Token Pair:</strong>
Choose your input asset (e.g. USDC) and your target output asset (e.g. EURC or cirBTC — the pairs the Arc pools actually list).

2. <strong>Automated Route Calculation:</strong>
The Arcis Smart Router queries all Arc L1 liquidity pools in parallel (<50ms) to compute the route with the highest output and lowest price impact.

3. <strong>One-Click Confirmation:</strong>
Sign the transaction with your connected wallet. With Arc L1 sub-second finality (<500ms), your swap completes and balances update in real time.

4. <strong>Direct USDC Gas Settlement:</strong>
All network fees (~$0.005 USDC) are paid directly in USDC with no need to maintain a separate ETH balance.`,
        timestamp: Date.now(),
      }
      addMessage(assistantMsg)
    } else if (
      q.includes('trading fees and gas costs for swaps') ||
      q.includes('trading fees and gas costs') ||
      q.includes('trading fees')
    ) {
      const assistantMsg: CopilotMessage = {
        id: 'assistant-' + Date.now(),
        role: 'assistant',
        content: `Arcis features transparent, institutional-grade low-cost fee structures:

<strong>Fee Architecture:</strong>

• <strong>Liquidity Provider (LP) Fee:</strong>
0.12% for StableSwap pairs (USDC/EURC), 0.25% for BTC pairs (USDC/cirBTC, EURC/cirBTC), and 0.30% for WETH pairs (USDC/WETH, EURC/WETH, cirBTC/WETH).

• <strong>Arc L1 Gas Fee:</strong>
A flat fee of approximately $0.005 USDC per transaction, deducted directly from your USDC balance.

• <strong>Zero Hidden Spreads:</strong>
No opaque relayer markups or predatory MEV slippage tolerances are applied.`,
        timestamp: Date.now(),
      }
      addMessage(assistantMsg)
    } else if (
      q.includes('split-routing protect large trades') ||
      q.includes('split-routing eliminate price impact') ||
      q.includes('split-routing eliminate slippage') ||
      q.includes('how does split-routing')
    ) {
      const assistantMsg: CopilotMessage = {
        id: 'assistant-' + Date.now(),
        role: 'assistant',
        content: `When executing large trades, routing 100% of an order through a single liquidity pool can cause severe price slippage.

<strong>How Arcis Split-Routing Solves Slippage:</strong>

1. <strong>Multi-Pool Liquidity Scanning:</strong>
The router analyzes concentrated liquidity ticks on Arc L1 pools simultaneously.

2. <strong>Dynamic Volume Splitting:</strong>
For an order of 50,000 USDC, the engine might route 65% ($32,500) through Pool A and 35% ($17,500) through Pool B to keep execution within optimal price ticks.

3. <strong>Compressed Slippage:</strong>
By preventing liquidity exhaustion in any single pool, price impact is compressed from over 0.85% down to under 0.04%, saving capital per swap.`,
        timestamp: Date.now(),
      }
      addMessage(assistantMsg)
    } else if (
      q.includes('which tokens can i swap on arc l1') ||
      q.includes('which tokens are supported') ||
      q.includes('which token pairs are supported') ||
      q.includes('token pairs are supported')
    ) {
      const assistantMsg: CopilotMessage = {
        id: 'assistant-' + Date.now(),
        role: 'assistant',
        content: `Arcis supports primary decentralized liquidity pairs on Arc L1:

<strong>Supported Assets:</strong>

• <strong>USDC:</strong>
Native gas token and primary settlement base currency (Circle standard).

• <strong>EURC:</strong>
Circle 100% Euro-backed stablecoin for FX settlement and zero-spread euro swaps.

• <strong>WETH:</strong>
Wrapped Ether on Arc Testnet across USDC/WETH, EURC/WETH, and cirBTC/WETH liquidity pools.

• <strong>cirBTC:</strong>
Circle Wrapped Bitcoin for premier digital store of value trading (there is no WBTC on Arc).

• <strong>af-USDC:</strong>
Arcis Real-Yield Vault interest-bearing share token earning ~8.42% APY.`,
        timestamp: Date.now(),
      }
      addMessage(assistantMsg)
    } else if (
      q.includes('customize slippage tolerance') ||
      q.includes('execute fast swaps') ||
      q.includes('how do i customize slippage') ||
      q.includes('fast swaps via ask arco')
    ) {
      const assistantMsg: CopilotMessage = {
        id: 'assistant-' + Date.now(),
        role: 'assistant',
        content: `Ask Arco is an autonomous execution copilot designed to give you complete control over trade speed and slippage protection:

<strong>How to Customize Slippage &amp; Execute Fast Swaps:</strong>

1. <strong>Set Slippage Tolerance:</strong>
Click the <strong>Settings (gear icon)</strong> in the top header of this drawer to choose your preferred slippage tolerance (<strong>0.1%</strong>, <strong>0.5%</strong>, or <strong>1.0%</strong>). You can also set your gas speed preset (Standard, Fast, Turbo).

2. <strong>Natural Language Execution:</strong>
Simply type your trade in chat:
• <em>"Swap 25 USDC for EURC"</em>
• <em>"Convert 100 USDC to cirBTC"</em>
• <em>"Buy 50 EURC with USDC"</em>

3. <strong>Instant Slash Command:</strong>
Type <code>/swap</code> or <code>/swap 50 USDC to EURC</code> to launch an interactive trade confirmation card directly in this drawer.

4. <strong>Review &amp; One-Click Confirm:</strong>
Arco calculates the live pool quote, verifies minimum received tokens based on your slippage setting, and presents a confirmation card. Click <strong>Confirm Swap</strong> to settle in &lt;500ms!`,
        timestamp: Date.now(),
      }
      addMessage(assistantMsg)
    } else if (
      q.includes('gasless eip-3009 swaps') ||
      q.includes('eip-3009 authorization') ||
      q.includes('0 gas in wallet')
    ) {
      const assistantMsg: CopilotMessage = {
        id: 'assistant-' + Date.now(),
        role: 'assistant',
        content: `EIP-3009 is a USDC authorization standard that can support relayed transfers when a compatible, configured relayer path is available. This FAQ does not verify that a gasless swap/relayer deployment is currently active. Check the transaction form and wallet confirmation for the actual route and fee; do not assume a sponsor, zero gas, or output-deducted fee.`,
        timestamp: Date.now(),
      }
      addMessage(assistantMsg)
    }

    // ─────────────────────────────────────────────────────────────
    // 3. YIELD & POOLS HANDLERS
    // ─────────────────────────────────────────────────────────────
    else if (
      q.includes('earn ~8.42% apy') ||
      q.includes('earn 8.42% apy') ||
      q.includes('8.42% apy') ||
      q.includes('real-yield vault (af-usdc)') ||
      q.includes('real-yield vault')
    ) {
      const assistantMsg: CopilotMessage = {
        id: 'assistant-' + Date.now(),
        role: 'assistant',
        content: `The Arcis YieldVault (af-USDC) generates sustainable real yield compliant with ERC-4626 standards:

<strong>Revenue Pillars &amp; Yield Composition (~8.42% APY):</strong>

• <strong>Institutional Credit Demand (7.42% APY):</strong>
Over-collateralized borrowing facilities provided to algorithmic market makers and liquidity routers on Arc L1.

• <strong>x402 AI Marketplace Protocol Surcharge (1.00% APY):</strong>
A 1% protocol fee share collected from thousands of automated daily x402 AI agent queries.

• <strong>Streaming Auto-Compounding:</strong>
Interest accrues on-chain every single second. As the pool expands, each af-USDC share token redeems for an increasing amount of underlying USDC.`,
        timestamp: Date.now(),
      }
      addMessage(assistantMsg)
    } else if (
      q.includes('where does the protocol yield come from') ||
      q.includes('zero token inflation') ||
      q.includes('protocol yield come from')
    ) {
      const assistantMsg: CopilotMessage = {
        id: 'assistant-' + Date.now(),
        role: 'assistant',
        content: `Arcis generates pure Real Yield without inflationary token emissions:

<strong>Revenue Pillars:</strong>

1. <strong>100% Real Economic Activity:</strong>
Returns originate exclusively from institutional borrower interest and x402 AI micro-service fees.

2. <strong>No Governance Token Dilution:</strong>
You are never paid in temporary farm tokens that lose value over time. All returns are 100% backed and denominated in native USDC.

3. <strong>Fully Transparent On-Chain Proof:</strong>
Vault reserves, utilization rates, and streaming earnings are verifiable in real time directly on the ArcScan block explorer.`,
        timestamp: Date.now(),
      }
      addMessage(assistantMsg)
    } else if (
      q.includes('deposit usdc to start earning') ||
      q.includes('deposit usdc to start earning streaming') ||
      q.includes('how do i deposit usdc')
    ) {
      const assistantMsg: CopilotMessage = {
        id: 'assistant-' + Date.now(),
        role: 'assistant',
        content: `Depositing USDC into the YieldVault:

<strong>How to Deposit (Step-by-Step Guide):</strong>

1. <strong>Open Pools & Yield Tab:</strong>
Navigate to the Pools & Yield tab in the top navigation.

2. <strong>Enter Allocation Amount:</strong>
Specify the amount of USDC you want to deposit (e.g. 1,000 USDC).

3. <strong>Approve & Deposit:</strong>
Click Deposit & Earn. Your wallet signs the transaction with sub-second finality.

4. <strong>Receive af-USDC Shares:</strong>
Your wallet instantly receives af-USDC interest-bearing tokens. Real-yield rewards begin streaming second by second immediately.`,
        timestamp: Date.now(),
      }
      addMessage(assistantMsg)
    } else if (
      q.includes('lockup periods or withdrawal fees') ||
      q.includes('what is af-usdc and how do i redeem') ||
      q.includes('what is af-usdc') ||
      q.includes('af-usdc')
    ) {
      const assistantMsg: CopilotMessage = {
        id: 'assistant-' + Date.now(),
        role: 'assistant',
        content: `Understanding the af-USDC Yield-Bearing Share:

<strong>Token Mechanics:</strong>

• <strong>ERC-4626 Standard:</strong>
af-USDC represents your exact proportional ownership of the total liquidity pool plus all accumulated interest.

• <strong>Continuous Price Growth:</strong>
The exchange rate (USDC per af-USDC) moves only upward as interest flows into the vault ($1.0000 ➔ $1.0842).

• <strong>Zero Lockup Periods:</strong>
Your capital is never locked. You can redeem af-USDC for the underlying principal and all earned yield at any time with zero withdrawal penalties.`,
        timestamp: Date.now(),
      }
      addMessage(assistantMsg)
    }
      else if (
        q.includes('yield options compare') ||
        q.includes('vaults compare') ||
        q.includes('single-sided vault vs lp pools')
      ) {
        const assistantMsg: CopilotMessage = {
          id: 'assistant-' + Date.now(),
          role: 'assistant',
          content: `Comparing Arcis's Yield & Pools:

• <strong>USDC Real-Yield Vault (8.42% APY):</strong>
Single-asset USDC deposit earning institutional borrower interest + protocol fees. <strong>Zero Impermanent Loss</strong> — the flagship 'set & forget' option.

• <strong>Gateway Cross-Chain Settlement Pool (7.25% APR):</strong>
USDC routed through Circle Gateway earns routing yield while staying instantly spendable across 13 chains.

• <strong>USDC / EURC Stable Pool (6.15% APR):</strong>
Stablecoin LP pair with near-zero impermanent loss, earning FX fees from euro (EURC) swaps.

• <strong>USDC / cirBTC Liquidity Pool (12.8% APR):</strong>
Volatile BTC pair with the highest yield but Medium impermanent-loss risk.

Use the Yield Calculator in the Pools tab to simulate compounding before you deposit.`,
          timestamp: Date.now(),
        }
        addMessage(assistantMsg)
      }


    // ─────────────────────────────────────────────────────────────
    // 4. AI SERVICES HANDLERS
    // ─────────────────────────────────────────────────────────────
    else if (
      q.includes('x402 nanopayments protocol work') ||
      q.includes('http 402')
    ) {
      const assistantMsg: CopilotMessage = {
        id: 'assistant-' + Date.now(),
        role: 'assistant',
        content: `x402 is an HTTP payment protocol that can return payment requirements (HTTP 402) before a paid service response. Circle Gateway nanopayments require an EOA key holder — an external EOA or a Circle Wallet created as an EOA — plus pre-funded Gateway USDC; this app does not deposit or withdraw funds automatically. Circle Wallet payments are authorized with its PIN/biometric typed-data challenge. Supported testnet calls require an explicit wallet signature. Circle accepts each call for later batch settlement, so provider accounting remains pending until nonce-based reconciliation reports confirmed. Passkey/MSCA smart accounts and autonomous session payments remain unsupported.`,
        timestamp: Date.now(),
      }
      addMessage(assistantMsg)
    } else if (
      q.includes('scan live arc dex pools') ||
      q.includes('highest arbitrage spread') ||
      q.includes('arbitrage')
    ) {
      // Single-step All-Pools Spread & Mispricing Scanner (no wasted pre-call)
      const scannerService = ARC_SERVICES_REGISTRY.find((s) => s.id === 'arc-cross-dex-arbitrage-sentinel')
      if (!scannerService) {
        addMessage({
          id: 'assistant-' + Date.now(),
          role: 'assistant',
          content: 'Pool spread analysis service is currently unavailable in the catalog.',
          timestamp: Date.now(),
        })
        setIsAnalyzing(false)
        setCurrentSteps([])
        return
      }
      steps.push({
        stepNumber: 1,
        serviceId: scannerService.id,
        serviceName: scannerService.name,
        status: 'executing',
        costUsdc: 0,
        durationMs: 0,
        detail: 'Scanning all 6 Arc pools against live external oracles and Arc gas...',
      })
      setCurrentSteps([...steps])

      const resolvedScannerPayer = hasPaidCallPayer
        ? await resolveEffectivePaidCallPayer(scannerService.pricing.priceUsdc)
        : null
      const r2 = resolvedScannerPayer
        ? await executeX402Call(
            scannerService,
            { pair: 'ALL_POOLS', tradeSizeUsdc: 25000, minNetProfitPct: 0.35 },
            walletAddress,
            provider,
            resolvedScannerPayer.kind,
            resolvedScannerPayer.signer
          )
        : { statusCode: 503, success: false, error: 'Circle Gateway payments require an external EOA or an active Circle Wallet signing session (or a funded Session Enclave); passkey/MSCA wallets alone are unsupported.', executionTimeMs: 0, costUsdc: 0 } as Awaited<ReturnType<typeof executeX402Call>>
      if (!isSuccessfulX402ServiceResult(r2)) {
        const verifiedSettlement = hasVerifiedX402Settlement(r2)
        const acceptedPayment = r2.payment?.status === 'settlement_pending' && r2.success
        const failureNote = acceptedPayment ? null : formatX402FailureNote(r2)
        steps[0].status = 'failed'
        steps[0].costUsdc = acceptedPayment || verifiedSettlement ? r2.costUsdc : 0
        steps[0].durationMs = r2.executionTimeMs
        steps[0].resultSummary = acceptedPayment
          ? `Gateway accepted ${r2.costUsdc} USDC; provider settlement remains pending reconciliation.`
          : isServiceDataAvailable(r2)
            ? `No verified settlement: ${r2.error || 'paid service response could not be verified'}`
            : `Service data unavailable: ${r2.error || 'no usable service result was returned'}`
        if (verifiedSettlement || acceptedPayment) totalCost += r2.costUsdc
        setCurrentSteps([...steps])
        addMessage({
          id: 'assistant-' + Date.now(),
          role: 'assistant',
          content: `Pool spread scan could not be completed. ${r2.error || 'A usable service response and Gateway payment acceptance were not both confirmed.'} No trade action was created.${failureNote ? `\n\n${failureNote}` : ''}`,
          timestamp: Date.now(),
          steps: [...steps],
          ...(totalCost > 0 ? { totalCostUsdc: totalCost } : {}),
        })
        setIsAnalyzing(false)
        setCurrentSteps([])
        return
      }
      totalCost += r2.costUsdc
      steps[0].costUsdc = r2.costUsdc
      const r2Data = r2.data as any
      steps[0].status = 'completed'
      steps[0].durationMs = r2.executionTimeMs
      steps[0].resultSummary = r2.payment?.status === 'settlement_pending' ? `Gateway accepted payment; provider settlement pending. Result: ${r2Data?.status || 'analysis returned'}.` : `Verified paid response: ${r2Data?.status || 'analysis returned'}.`
      setCurrentSteps([...steps])

      const assistantMsg: CopilotMessage = {
        id: 'assistant-' + Date.now(),
        role: 'assistant',
        content: r2Data?.status === 'OPPORTUNITY_DETECTED'
          ? `Pool spread analysis completed (estimates only; no trade was executed):

• <strong>Buy venue / quoted price:</strong> ${r2Data?.bestRoute?.buyDex ?? 'Unavailable'} @ ${r2Data?.bestRoute?.buyPriceUsdc ?? 'Unavailable'}
• <strong>Sell venue / quoted price:</strong> ${r2Data?.bestRoute?.sellDex ?? 'Unavailable'} @ ${r2Data?.bestRoute?.sellPriceUsdc ?? 'Unavailable'}
• <strong>Estimated gross spread:</strong> ${r2Data?.bestRoute?.grossSpreadPct ?? 'Unavailable'}%
• <strong>Estimated gas:</strong> ${r2Data?.bestRoute?.estimatedGasCostUsdc ?? 'Unavailable'} USDC
• <strong>Estimated net result:</strong> ${r2Data?.bestRoute?.netProfitUsdc ?? 'Unavailable'} USDC (${r2Data?.bestRoute?.netProfitPct ?? 'Unavailable'}%)

This is advisory analysis only; no trade or relayer protection was executed.`
          : `No pool spread above the requested threshold was reported. The services returned analysis only; no trade was executed.`,
        timestamp: Date.now(),
        steps: [...steps],
        totalCostUsdc: totalCost,
      }
      addMessage(assistantMsg)
    } else if (
      q.includes('micro-pricing rates for x402') ||
      q.includes('micro-pricing rates')
    ) {
      const assistantMsg: CopilotMessage = {
        id: 'assistant-' + Date.now(),
        role: 'assistant',
        content: `x402 AI Services Catalog Pricing (configured pay-per-call rates on Arc Testnet):

<strong>Listed Official Services (7 Active):</strong>

1. <strong>Smart Trade & Execution Advisor:</strong> $0.003 USDC/call — direct vs 2-hop routing, pool reserve exposure, and batch sizing before a swap.
2. <strong>All-Pools Spread & Mispricing Scanner:</strong> $0.005 USDC/call — scans all 6 Arc pools against live market oracles after USDC gas.
3. <strong>Bridge & Gateway Cost Optimizer:</strong> $0.003 USDC/call — live Circle Gateway, CCTP v2 and CCTP-X fee comparison for USDC, EURC, wETH and cirBTC.
4. <strong>Arc Yield & Pool Opportunity Finder:</strong> $0.002 USDC/call — live TVL, 24h volume, fee tiers and wallet matching across all 6 Arc pools + ERC-4626 vault.
5. <strong>Full Portfolio & DeFi Health Auditor:</strong> $0.004 USDC/call — audits wallet tokens, ERC-4626 vault shares, all 6 Arc LP pools, multi-chain gas, and Gateway USDC.
6. <strong>Yield, LP Fees & Position Statement (AI):</strong> $0.012 USDC/call — vault principal, accrued yield, and all 6 LP pool fees with AI summary & CSV/JSON export.
7. <strong>Cross-Chain Gateway Flow Monitor:</strong> $0.003 USDC/call — live on-chain Gateway USDC inflows and outflows on Arc L1.

These are catalog rates, not successful calls. Paid calls require an external EOA or a Circle Wallet EOA, Arc Testnet and a previously funded Circle Gateway balance. Circle facilitator acceptance serves the result, while provider earnings remain pending until nonce reconciliation confirms settlement. Passkey/MSCA and autonomous session payments are unsupported; this app never deposits automatically.`,
        timestamp: Date.now(),
      }
      addMessage(assistantMsg)
    } else if (
      q.includes('monetize their own ai models') ||
      q.includes('monetize their own ai services') ||
      q.includes('list & monetize')
    ) {
      const assistantMsg: CopilotMessage = {
        id: 'assistant-' + Date.now(),
        role: 'assistant',
        content: `x402 Developer Integration (Arc Testnet):

A provider can register a service manifest signed by an external EOA or Circle Wallet EOA and serve HTTP 402 payment challenges. Paid testnet calls settle through Circle Gateway (EIP-3009 authorizations from an external EOA, Circle Wallet EOA, or a funded Session Enclave) into the protocol treasury for fee-bearing listings (0.50% protocol fee on official manifests; net earnings credited after nonce reconciliation), and providers withdraw net USDC earnings directly from the treasury with an EIP-712 withdrawal authorization.`,
        timestamp: Date.now(),
      }
      addMessage(assistantMsg)
    }
      else if (
        q.includes('which x402 ai service')
      ) {
        const assistantMsg: CopilotMessage = {
          id: 'assistant-' + Date.now(),
          role: 'assistant',
          content: `Choosing an x402 AI service (7 active official services on Arc Testnet):

• <strong>Before a swap (routes, impact & sizing):</strong> Smart Trade & Execution Advisor ($0.003/call).
• <strong>All 6 pools vs oracle price spread:</strong> All-Pools Spread & Mispricing Scanner ($0.005/call).
• <strong>Before bridging (USDC, EURC, wETH, cirBTC fees):</strong> Bridge & Gateway Cost Optimizer ($0.003/call).
• <strong>Compare all 6 pools & vault yield opportunities:</strong> Arc Yield & Pool Opportunity Finder ($0.002/call).
• <strong>Full wallet, LP & Vault risk audit:</strong> Full Portfolio & DeFi Health Auditor ($0.004/call).
• <strong>AI-narrated yield & LP fees statement (CSV/JSON):</strong> Yield, LP Fees & Position Statement (AI) ($0.012/call).
• <strong>On-chain Arc USDC inflow/outflow tracking:</strong> Cross-Chain Gateway Flow Monitor ($0.003/call).

These are catalog entries. Paid testnet calls require an external EOA or Circle Wallet EOA with a funded Circle Gateway balance. Open the AI Services tab to launch any service.`,
          timestamp: Date.now(),
        }
        addMessage(assistantMsg)
      }

      // ─────────────── 4B. SEND & PAYMENTS HANDLERS ───────────────
      else if (
        q.includes('send tokens on arc l1') ||
        q.includes('how do i send tokens') ||
        (q.includes('sub-second finality') && q.includes('send'))
      ) {
        const assistantMsg: CopilotMessage = {
          id: 'assistant-' + Date.now(),
          role: 'assistant',
          content: `Sending Tokens on Arc L1:

<strong>Instant, Predictable Token Transfers:</strong>

• <strong>Sub-Second Finality (&lt;500ms):</strong>
Transactions settle deterministically in under 500 milliseconds on Arc L1, giving you instant confirmation with zero waiting.

• <strong>Multi-Token Support:</strong>
Send native <strong>USDC</strong>, <strong>EURC</strong>, <strong>WETH</strong>, or <strong>cirBTC</strong> directly to any Arc L1 address.

• <strong>Native USDC Gas (~$0.005):</strong>
All transaction fees are deducted directly in USDC. You never need to acquire or hold volatile ETH just to send tokens.

• <strong>Custom Transaction Memos:</strong>
Attach categorized on-chain metadata (Invoice, Freelance, Payroll, AI Agent, Tip, Split Bill) via Arc Memo smart contracts.

• <strong>Speed Tiers:</strong>
Choose between Standard (Eco, 0 platform fee), Fast (0.005 USDC), and Turbo (0.010 USDC) priority queues.`,
          timestamp: Date.now(),
        }
        addMessage(assistantMsg)
      } else if (q.includes('transaction memos')) {
        const assistantMsg: CopilotMessage = {
          id: 'assistant-' + Date.now(),
          role: 'assistant',
          content: `Arc Testnet Transaction Memos:

• <strong>What is a memo?</strong>
A memo is an on-chain structured note (invoice #, milestone, or reference ID) attached to your USDC transfer via the Arc Memo contract.

• <strong>Why attach one?</strong>
It turns a plain transfer into an auditable, categorized record — ideal for freelance invoicing, rent, AI-agent settlements, gifts, and e-commerce orders.

• <strong>Preserved Sender Identity:</strong>
The memo wraps your transfer using CallFrom so the recipient sees your real wallet address (msg.sender) together with the metadata.

Use the Send tab and pick a preset (Invoice, Freelance, Payroll, AI Agent, API Fee, Order, Subscription, Split Bill, Tip) to attach a memo.`,
          timestamp: Date.now(),
        }
        addMessage(assistantMsg)
      } else if (q.includes('fees does arcis charge')) {
        const assistantMsg: CopilotMessage = {
          id: 'assistant-' + Date.now(),
          role: 'assistant',
          content: `Arcis Send Fees (Speed & Priority Tiers):

• <strong>Standard (Eco):</strong> 0 USDC platform fee — only the ~$0.00042 L1 USDC gas cost, settling in 1-2 seconds.

• <strong>Fast (Recommended):</strong> 0.005 USDC platform fee — priority queue routing + fast memo processing, < 1 second.

• <strong>Turbo (Instant):</strong> 0.010 USDC platform fee — highest-priority execution with sub-second settlement.

All network gas is paid directly in USDC — no ETH wallet balance is ever required. 90% of protocol fees go to the Arcis Treasury and 10% supports the Arc ecosystem.`,
          timestamp: Date.now(),
        }
        addMessage(assistantMsg)
      } else if (q.includes('gasless sending')) {
        const assistantMsg: CopilotMessage = {
          id: 'assistant-' + Date.now(),
          role: 'assistant',
          content: `Gasless Sending on Arc:

• <strong>EIP-3009 TransferWithAuthorization:</strong>
This standard can authorize a relayed USDC transfer when an active, funded relayer is configured. This app cannot guarantee that the relayer is available or sponsored in a given environment.

• <strong>Fee confirmation:</strong>
Do not assume zero gas or sponsorship based on the quota display. Confirm the current Send flow and review the wallet prompt/receipt before relying on it.

• <strong>Relayer availability:</strong>
Sponsorship depends on server configuration and a valid confirmed transaction; a quota display alone does not guarantee it.

Check whether the Send form explicitly enables a relayer path before signing. Otherwise use a standard wallet transfer and review its fee.`,
          timestamp: Date.now(),
        }
        addMessage(assistantMsg)
      } else if (
        q.includes('send usdc cross-chain') ||
        q.includes('sepolia or base via the gateway') ||
        (q.includes('cross-chain') && q.includes('gateway') && q.includes('send'))
      ) {
        const assistantMsg: CopilotMessage = {
          id: 'assistant-' + Date.now(),
          role: 'assistant',
          content: `Cross-Chain Transfers via Circle Gateway:

<strong>Unified Cross-Chain Sending:</strong>

• <strong>Instant Spendability (&lt;500ms):</strong>
Circle Gateway abstracts multi-chain bridging into atomic deposit, burn, and mint operations with sub-second finality.

• <strong>Supported Destination Chains:</strong>
Send USDC directly to Ethereum Sepolia, Base Sepolia, Arbitrum Sepolia, Polygon Amoy, Avalanche Fuji, Optimism Sepolia, and Solana Devnet.

• <strong>1:1 Capital Efficiency:</strong>
Transfers use authentic native Circle USDC without wrapped tokens (wUSDC) or bridge slippage.

• <strong>How to Execute:</strong>
1. Open the <strong>Send</strong> tab.
2. Toggle the destination chain selector to your desired network (e.g. Base or Sepolia).
3. Enter recipient address and USDC amount.
4. Confirm to execute instant cross-chain settlement!`,
          timestamp: Date.now(),
        }
        addMessage(assistantMsg)
      }


    // ─────────────────────────────────────────────────────────────
    // 5. CIRCLE GATEWAY HANDLERS
    // ─────────────────────────────────────────────────────────────
    else if (
      q.includes('what is circle gateway and unified') ||
      q.includes('circle gateway and unified cross-chain balance')
    ) {
      const assistantMsg: CopilotMessage = {
        id: 'assistant-' + Date.now(),
        role: 'assistant',
        content: `Circle Gateway is an omnichain liquidity protocol that unites USDC balances:

<strong>Key Advantages:</strong>

• <strong>Unified Balance:</strong>
Consolidates USDC balances held across Ethereum, Base, Arbitrum, Polygon, and Solana into a single balance.

• <strong>Zero Bridge Waiting Time (<500ms):</strong>
Replaces traditional 15-to-30 minute bridge delays with instant cryptographic deposit-and-mint attestations.

• <strong>Maximized Capital Efficiency:</strong>
Deposit USDC on Base or Ethereum and spend it immediately on Arc L1 in the very next block.`,
        timestamp: Date.now(),
      }
      addMessage(assistantMsg)
    } else if (
      q.includes('how are cross-chain usdc inflows tracked') ||
      q.includes('inflows tracked on arc l1')
    ) {
      const assistantMsg: CopilotMessage = {
        id: 'assistant-' + Date.now(),
        role: 'assistant',
        content: `Tracking Cross-Chain Inflows on Arc L1:

<strong>On-Chain Flow Verification:</strong>

• <strong>Circle Gateway Event Indexing:</strong>
Arcis monitors real-time <code>AttestationUsed</code> and <code>GatewayBurned</code> smart contract events emitted on Arc L1.

• <strong>Net Inflow Velocity:</strong>
Calculates institutional deposit velocity, burn volumes, and cross-chain net liquidity migration into Arc L1 across 1-hour and 24-hour windows.

• <strong>Real-Time Transparency:</strong>
Every cross-chain transfer generates cryptographic attestations verifiable on the ArcScan block explorer.

• <strong>Automated Flow Reports:</strong>
You can trigger the <strong>Cross-Chain Gateway Flow Monitor</strong> agent directly through Ask Arco to generate an institutional flow report with your connected wallet.`,
        timestamp: Date.now(),
      }
      addMessage(assistantMsg)
    } else if (isGatewayFlowReportQuery(q)) {
      if (!hasPaidCallPayer) {
        addMessage({
          id: 'assistant-' + Date.now(),
          role: 'assistant',
          content: `The <strong>Cross-Chain Gateway Flow Monitor</strong> is an institutional on-chain intelligence service ($0.003 USDC per query).

To run this query live against the Arc L1 RPC:
• <strong>Connect an EOA Wallet:</strong> Connect MetaMask, Rabby, or a Circle User-Controlled Wallet (UCW).
• <strong>Fund Gateway Balance:</strong> Ensure your Circle Gateway account holds at least 0.003 USDC on Arc Testnet.

Once connected, ask me again or open the AI Services tab to run the live report!`,
          timestamp: Date.now(),
        })
        setIsAnalyzing(false)
        setCurrentSteps([])
        return
      }

      const s = ARC_SERVICES_REGISTRY.find((s) => s.id === 'arc-cross-chain-gateway-flow-indexer')!
      steps.push({
        stepNumber: 1,
        serviceId: s.id,
        serviceName: s.name,
        status: 'executing',
        costUsdc: 0,
        durationMs: 0,
        detail: 'Reading Circle Gateway AttestationUsed / GatewayBurned logs on Arc L1...',
      })
      setCurrentSteps([...steps])

      const resolvedFlowPayer = await resolveEffectivePaidCallPayer(s.pricing.priceUsdc)
      const r = resolvedFlowPayer
        ? await executeX402Call(s, { timeWindow: '1h' }, walletAddress, provider, resolvedFlowPayer.kind, resolvedFlowPayer.signer)
        : { statusCode: 503, success: false, error: 'Circle Gateway payments require an external EOA, an active Circle Wallet signing session, or a funded Session Enclave.', executionTimeMs: 0, costUsdc: 0 } as Awaited<ReturnType<typeof executeX402Call>>
      const settlementVerified = hasVerifiedX402Settlement(r)
      const paymentAccepted = r.payment?.status === 'settlement_pending' && r.success
      const serviceAvailable = isSuccessfulX402ServiceResult(r)
      const rData = serviceAvailable ? (r.data as any) : null
      if (settlementVerified || paymentAccepted) {
        totalCost += r.costUsdc
        steps[0].costUsdc = r.costUsdc
      }

      // The report is rendered only from a usable result accompanied by verified settlement.
      // Otherwise state that it is unavailable; never present unverified data or catalog pricing.
      const flowReport = serviceAvailable
        ? `${paymentAccepted ? 'Circle Gateway accepted this testnet payment; provider settlement is pending reconciliation.\n\n' : ''}${formatGatewayFlowReport(rData)}`
        : formatGatewayFlowReport({
            status: 'UNAVAILABLE',
            timeWindow: '1h',
            readAt: new Date().toISOString(),
            source: GATEWAY_FLOW_SOURCE,
            error: r.error || 'paid service data or trusted settlement could not be verified',
          })

      const flowNote = serviceAvailable ? null : formatX402FailureNote(r)
      steps[0].status = serviceAvailable ? 'completed' : 'failed'
      steps[0].durationMs = r.executionTimeMs
      steps[0].resultSummary = serviceAvailable
        ? `${paymentAccepted ? 'Gateway accepted; settlement pending. ' : ''}Gateway net flow: ${formatUsdcOrUnavailable(rData?.netUsdcInflowUsdc)}`
        : `Unavailable: ${r.error || 'paid service data or trusted settlement could not be verified'}`
      setCurrentSteps([...steps])

      const assistantMsg: CopilotMessage = {
        id: 'assistant-' + Date.now(),
        role: 'assistant',
        content: flowNote ? `${flowReport}\n\n${flowNote}` : flowReport,
        timestamp: Date.now(),
        steps: [...steps],
        totalCostUsdc: totalCost,
      }
      addMessage(assistantMsg)
    } else if (
      q.includes('instant cross-chain transfer work') ||
      q.includes('0 bridge waiting')
    ) {
      const assistantMsg: CopilotMessage = {
        id: 'assistant-' + Date.now(),
        role: 'assistant',
        content: `How Instant Cross-Chain Transfer Works in Circle Gateway:

<strong>Execution Lifecycle:</strong>

1. <strong>Deposit Attestation:</strong>
When you deposit USDC on Ethereum or Base, Circle Gateway minters produce a signed attestation in milliseconds.

2. <strong>Instant Mint on Arc L1:</strong>
The attestation is submitted to Arc L1, minting genuine native USDC into your recipient address in <500ms.

3. <strong>Zero Liquidity Risk:</strong>
No wrapped tokens (wUSDC) or risky lock-and-mint pools are involved. You always hold authentic Circle USDC.`,
        timestamp: Date.now(),
      }
      addMessage(assistantMsg)
    } else if (
      q.includes('deposit funds into gateway from sepolia') ||
      q.includes('deposit funds into gateway')
    ) {
      const assistantMsg: CopilotMessage = {
        id: 'assistant-' + Date.now(),
        role: 'assistant',
        content: `Depositing into Circle Gateway:

<strong>Step-by-Step Instructions:</strong>

1. <strong>Open Bridge Tab:</strong>
Navigate to the Bridge tab in the top navigation.

2. <strong>Select Origin Network:</strong>
Choose Ethereum Sepolia, Base, or Arbitrum as your source chain.

3. <strong>Enter USDC Amount:</strong>
Specify the amount of USDC you want to bridge into Arc L1.

4. <strong>Confirm Deposit:</strong>
Approve and confirm. Your unified USDC balance becomes available on Arc L1 in under 500 milliseconds.`,
        timestamp: Date.now(),
      }
      addMessage(assistantMsg)
    }
      else if (
        q.includes('unified gateway balance')
      ) {
        const assistantMsg: CopilotMessage = {
          id: 'assistant-' + Date.now(),
          role: 'assistant',
          content: `Circle Gateway Supported Chains:

<strong>13+ Testnet Chains:</strong>
Your unified USDC balance works across Arc Testnet, Ethereum Sepolia, Base, Arbitrum, Optimism, Polygon Amoy, Avalanche Fuji, HyperEVM, Sei, Solana Devnet, Sonic, Unichain, and World Chain.

<strong>How It Works:</strong>

• <strong>Single Deposit, Everywhere:</strong>
Deposit USDC once into the Gateway and the smart-contract vault tracks your liquidity across every chain.

• <strong>Instant Movement:</strong>
Move or spend liquidity across any network in under 500 ms with zero bridge confirmation waiting.

Use the Send or Bridge tab to move your unified balance between chains.`,
          timestamp: Date.now(),
        }
        addMessage(assistantMsg)
      }


    // ─────────────────────────────────────────────────────────────
    // 6. FAQ HANDLERS
    // ─────────────────────────────────────────────────────────────
    else if (
      q.includes('non-custodial and secure') ||
      q.includes('secure')
    ) {
      const assistantMsg: CopilotMessage = {
        id: 'assistant-' + Date.now(),
        role: 'assistant',
        content: `Arcis Security & Custody Architecture:

<strong>Security Pillars:</strong>

• <strong>Non-Custodial Smart Contracts:</strong>
You maintain 100% control of your private keys and assets at all times. Neither Arcis nor relayers have access to user funds.

• <strong>Audited ERC Standards:</strong>
Vaults comply strictly with ERC-4626 tokenized vault standards with built-in emergency recovery logic.

• <strong>Scoped Session Keys &amp; x402 Payments:</strong>
Session budgets and per-transaction caps are enforced client-side for Ask Arco and AI Services before signing (with optional ephemeral Session Enclaves you control and can revoke or sweep anytime). Paid x402 calls settle via Circle Gateway EIP-3009 authorizations signed by your external EOA, Circle Wallet EOA, or a funded Session Enclave.`,
        timestamp: Date.now(),
      }
      addMessage(assistantMsg)
    } else if (
      q.includes('network details for arc testnet') ||
      q.includes('rpc & chain id') ||
      q.includes(arcTestnet.id.toString())
    ) {
      const assistantMsg: CopilotMessage = {
        id: 'assistant-' + Date.now(),
        role: 'assistant',
        content: `${arcTestnet.name} Network Configuration:

<strong>Network Details:</strong>

• <strong>Network Name:</strong> ${arcTestnet.name}
• <strong>Chain ID:</strong> ${arcTestnet.id}
• <strong>RPC URL:</strong> ${ARC_METADATA.rpcHttpUrl}
• <strong>Native Gas Token:</strong> ${arcTestnet.nativeCurrency.name} (${arcTestnet.nativeCurrency.decimals} decimals)
• <strong>Block Explorer:</strong> ${arcTestnet.blockExplorers.default.url}`,
        timestamp: Date.now(),
      }
      addMessage(assistantMsg)
    } else if (
      q.includes('session budget and how does it protect') ||
      q.includes('session budget')
    ) {
      const assistantMsg: CopilotMessage = {
        id: 'assistant-' + Date.now(),
        role: 'assistant',
        content: `Session Settings and Paid AI Calls:

• The session budget shown in this UI is local metadata, not an on-chain spending cap.
• Automated signing/delegation is disabled because SessionKeyModule is not integrated with this frontend.
• Paid x402 testnet calls require an external EOA or a Circle Wallet EOA and pre-funded Circle Gateway USDC; this app never auto-deposits. Passkey/MSCA and autonomous session payments are unsupported.
• Facilitator acceptance is not final settlement; provider earnings remain pending until nonce reconciliation reports a matching Circle transfer.
• Catalog prices are not evidence that a paid call can currently be completed.`,
        timestamp: Date.now(),
      }
      addMessage(assistantMsg)
    }
      else if (
        q.includes('privacy encryption')
      ) {
        const assistantMsg: CopilotMessage = {
          id: 'assistant-' + Date.now(),
          role: 'assistant',
          content: `Arcis APS Privacy Encryption:

<strong>APS (Arc Privacy Shield):</strong>
An optional post-quantum privacy layer that encrypts your transaction metadata on-chain when enabled.

<strong>Two Modes:</strong>

• <strong>EVM-Transparent:</strong>
Default state where transfer metadata is publicly readable on the explorer.

• <strong>APS-Locked (Encrypted):</strong>
On-chain metadata is encrypted so outsiders cannot read message details.

<strong>Always Your Choice:</strong>
APS is fully optional and never removes custody of your funds — it only controls who can read the attached metadata.

Look for the privacy lock badge (APS) in the app to lock or unlock encryption on any transaction.`,
          timestamp: Date.now(),
        }
        addMessage(assistantMsg)
      } else if (
        q.includes('revenue share')
      ) {
        const assistantMsg: CopilotMessage = {
          id: 'assistant-' + Date.now(),
          role: 'assistant',
          content: `Arcis 90/10 Revenue Share:

• <strong>90% to Protocol Developers:</strong>
The majority of every protocol fee (from Send, Swap, and Bridge) flows into the Arcis Treasury to fund the roadmap and contributors.

• <strong>10% to the Arc Ecosystem:</strong>
A fixed share supports the Arc Network ecosystem per the Circle AppKit revenue-sharing model.

• <strong>Transparent Treasury:</strong>
The treasury address is public and verifiable on ArcScan, so you can inspect every inbound fee in real time.

This model keeps Arcis sustainable while rewarding builders on Arc L1.`,
          timestamp: Date.now(),
        }
        addMessage(assistantMsg)
      }


    // ─────────────────────────────────────────────────────────────
    // FALLBACK: AI COPILOT LLM & SMART LOCAL NLP INTENT PARSER
    // ─────────────────────────────────────────────────────────────
    else {
      await handleLLMIntent(queryText, portfolioSnapshot, abortController.signal, historyBeforeTurn)
    }

    setCurrentSteps([])
  } catch (err) {
    console.error('[useArcCopilot] executeQuery error:', err)
  } finally {
    queryBusyRef.current = false
    setIsAnalyzing(false)
  }
}

  /**
   * Runs a next-step card inside this chat, with the inputs the recommendation was derived for.
   * A step the chat has no paid flow for returns false; the caller opens the catalogue instead.
   * The card's action kind decides how the shelf opens it, not whether this chat can run it.
   */
  const canExecuteNextStep = (recommendation: Recommendation): boolean =>
    CHAT_EXECUTABLE_SERVICES.has(recommendation.action.serviceId)

  const executeNextStep = async (recommendation: Recommendation): Promise<boolean> => {
    const { action } = recommendation

    const params = action.params
    const requestedAddress =
      typeof params.address === 'string' && /^0x[a-fA-F0-9]{40}$/.test(params.address)
        ? params.address
        : walletAddress

    const run =
      action.serviceId === 'arc-portfolio-risk-exposure'
        ? () => runPaidPortfolioAnalysis(requestedAddress, params.includeGatewayBalance !== false)
        : action.serviceId === 'arc-vault-yield-tax-report'
          ? () => runPaidVaultReport(requestedAddress)
          : action.serviceId === 'arc-yield-vault-analytics'
            ? () => runPaidVaultAnalytics(params.riskPreference)
            : null

    if (!run) return false
    // A card click spends real USDC; a second click while the first call is in flight must not
    // buy the same report twice.
    if (nextStepInFlightRef.current) return true

    nextStepInFlightRef.current = true
    setIsAnalyzing(true)
    try {
      await run()
      return true
    } finally {
      nextStepInFlightRef.current = false
      setIsAnalyzing(false)
    }
  }

  const clearChat = () => {
    invalidateDrafts()
    queryGenerationRef.current += 1
    queryAbortRef.current?.abort()
    queryAbortRef.current = null
    queryBusyRef.current = false
    setIsAnalyzing(false)
    pendingActionRef.current = null
    setMessages([createArcisWelcomeMessage()])
  }

  return {
    isOpen,
    toggleOpen,
    setIsOpen,
    isAnalyzing,
    canPayForCalls,
    messages,
    currentSteps,
    sessionConfig,
    executeInlineAction,
    activateSession,
    revokeSession,
    toggleAutoExecute,
    executeQuery,
    canExecuteNextStep,
    executeNextStep,
    clearChat,
  }
}
