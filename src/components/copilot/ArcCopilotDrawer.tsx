// src/components/copilot/ArcCopilotDrawer.tsx
// Floating Resizable AI Copilot Mini-Window for Arcis (Anchored Above Floating Widget)
import React, { useState, useRef, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { useClearOnWalletDisconnect } from '../../hooks/useClearOnWalletDisconnect'
import {
  X,
  Bot,
  Send,
  Sparkles,
  ChevronDown,
  ChevronUp,
  Activity,
  RotateCcw,
  MoveDiagonal2,
  Zap,
  Check,
  Copy,
  Pencil,
  Volume2,
  VolumeX,
  Settings,
  SlidersHorizontal,
} from 'lucide-react'
import { EXPLORE_TOPIC_CATEGORIES, exploreTopicQuestions } from '../../hooks/useArcCopilot'
import type { CopilotMessage, CopilotStepLog, CopilotActionPayload } from '../../types/marketplace'
import type { Recommendation } from '../../services/x402/nextActions'
import type { SessionKeyConfig, SessionActionType } from '../../types/sessionKey'
import { getSessionTimeRemaining } from '../../services/sessionKeyService'
import { playSound, soundService } from '../../services/soundService'
import { sanitizeCopilotHtml, stripCopilotHtml } from '../../utils/sanitizeCopilotHtml'
import { classifyCopilotIntent } from '../../utils/copilotIntent'
import CopilotMessageContent from './CopilotMessageContent'
import SessionKeyModal from './SessionKeyModal'
import CopilotSettingsModal from './CopilotSettingsModal'
import InlineActionCard from './InlineActionCard'
import NextStepRail from '../marketplace/NextStepRail'
import { CopilotSlashMenu } from './CopilotSlashMenu'
import { COPILOT_SLASH_COMMANDS, type SlashCommandItem } from '../../config/copilotSlashCommands'
import { walletSettingsService, WALLET_SETTINGS_CHANGED_EVENT } from '../../services/walletSettingsService'
import type { SlippagePreset } from '../../types/walletSettings'
import type { SpeedTier } from '../../config/feeTiers'
import { logger } from '../../utils/logger'

/** Scoped logger: swallowed UI-state failures must still be visible in diagnostics. */
const log = logger.createScope('ArcCopilotDrawer')

interface ArcCopilotDrawerProps {
  isOpen: boolean
  onClose: () => void
  messages: CopilotMessage[]
  currentSteps: CopilotStepLog[]
  isAnalyzing: boolean
  sessionConfig: SessionKeyConfig
  walletAddress?: string
  onSendMessage: (query: string) => Promise<void>
  onClearChat: () => void
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
  onExecuteInline: (messageId: string, actionPayload: CopilotActionPayload) => Promise<void>
  /** Runs a next-step card in this chat; resolves false when the chat has no flow for it. */
  onExecuteNextStep?: (recommendation: Recommendation) => Promise<boolean>
  /** Whether the chat can run this card itself; drives the button label and the fallback. */
  canExecuteNextStep?: (recommendation: Recommendation) => boolean
  /** Whether this session can actually be charged for a paid call (address + a signing payer). */
  canPayForCalls?: boolean
  onNavigateToTab?: (tab: string) => void
}

const DEFAULT_WIDTH = 720
const DEFAULT_HEIGHT = 800
const MIN_WIDTH = 480
const MIN_HEIGHT = 720

export default function ArcCopilotDrawer({
  isOpen,
  onClose,
  messages,
  currentSteps,
  isAnalyzing,
  sessionConfig,
  walletAddress,
  onSendMessage,
  onClearChat,
  onActivateSession,
  onRevokeSession,
  onToggleAutoExecute,
  onExecuteInline,
  onExecuteNextStep,
  canExecuteNextStep,
  canPayForCalls,
  onNavigateToTab,
}: ArcCopilotDrawerProps) {
  const [inputText, setInputText] = useState<string>('')
  const [selectedTopicId, setSelectedTopicId] = useState<string | null>(null)
  const [expandedStepsMap, setExpandedStepsMap] = useState<Record<string, boolean>>({})
  const [isSessionKeyModalOpen, setIsSessionKeyModalOpen] = useState<boolean>(false)
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState<boolean>(false)
  const [copilotSlippage, setCopilotSlippage] = useState<number>(() =>
    walletSettingsService.getCopilotSlippage(walletAddress)
  )
  const [copilotSlippageType, setCopilotSlippageType] = useState<SlippagePreset>(() => {
    const s = walletSettingsService.getWalletSettings(walletAddress)
    return s.copilotSlippageType || '1.0'
  })
  const [copilotCustomSlippage, setCopilotCustomSlippage] = useState<string>(() => {
    const s = walletSettingsService.getWalletSettings(walletAddress)
    return s.copilotCustomSlippage || ''
  })
  const [copilotSpeedTier, setCopilotSpeedTier] = useState<SpeedTier>(() =>
    walletSettingsService.getCopilotSpeedTier(walletAddress)
  )

  // Listen for wallet settings changes across windows/tabs/modals
  useEffect(() => {
    const handleSettingsChanged = () => {
      const s = walletSettingsService.getWalletSettings(walletAddress)
      setCopilotSlippage(s.copilotSlippage ?? 1.0)
      setCopilotSlippageType(s.copilotSlippageType || '1.0')
      setCopilotCustomSlippage(s.copilotCustomSlippage || '')
      setCopilotSpeedTier(s.copilotSpeedTier || 'fast')
    }
    window.addEventListener(WALLET_SETTINGS_CHANGED_EVENT, handleSettingsChanged)
    return () => window.removeEventListener(WALLET_SETTINGS_CHANGED_EVENT, handleSettingsChanged)
  }, [walletAddress])

  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // Systematic input clearing on wallet disconnect
  useClearOnWalletDisconnect(() => {
    setInputText('')
    setEditingText('')
    setEditingMsgId(null)
  })

  // Slash Commands State
  const [slashSelectedIdx, setSlashSelectedIdx] = useState<number>(0)
  const isSlashMode = inputText.startsWith('/')
  const slashQuery = isSlashMode ? inputText.slice(1).toLowerCase().trim() : ''
  const filteredSlashCommands = isSlashMode
    ? COPILOT_SLASH_COMMANDS.filter(
      (c) =>
        c.command.toLowerCase().includes(slashQuery) ||
        c.title.toLowerCase().includes(slashQuery) ||
        c.category.toLowerCase().includes(slashQuery) ||
        c.description.toLowerCase().includes(slashQuery)
    )
    : []
  const isSlashMenuOpen = isSlashMode && filteredSlashCommands.length > 0

  useEffect(() => {
    setSlashSelectedIdx(0)
  }, [slashQuery])

  // Sound FX State
  const [isSoundEnabled, setIsSoundEnabled] = useState<boolean>(() => soundService.isEnabled())
  const handleToggleSound = () => {
    const next = soundService.toggle()
    setIsSoundEnabled(next)
  }

  // Dynamic Spin & Reset State for Rotate-CCW
  const [isResetting, setIsResetting] = useState<boolean>(false)

  const handleResetChat = useCallback(() => {
    if (isResetting) return
    setIsResetting(true)
    playSound('pop')
    setSelectedTopicId(null)
    onClearChat()
    setTimeout(() => {
      setIsResetting(false)
    }, 650)
  }, [isResetting, onClearChat])

  const handleSelectSlashCommand = async (cmd: SlashCommandItem) => {
    playSound('pop')
    if (cmd.directActionKey === 'clear') {
      handleResetChat()
      setInputText('')
      return
    }
    if (cmd.directActionKey === 'session') {
      setIsSessionKeyModalOpen(true)
      setInputText('')
      return
    }

    const expectsParameters = ['/swap', '/vault', '/bridge', '/send'].includes(cmd.command) || cmd.syntax.includes('[')
    if (expectsParameters && !inputText.trim().includes(' ')) {
      setInputText(cmd.command + ' ')
      inputRef.current?.focus()
      return
    }

    const promptToExecute = cmd.templatePrompt || cmd.command
    setInputText('')
    await onSendMessage(promptToExecute)
  }

  // Message Copy and Inline Edit State
  const [copiedMsgId, setCopiedMsgId] = useState<string | null>(null)
  const [editingMsgId, setEditingMsgId] = useState<string | null>(null)
  const [editingText, setEditingText] = useState<string>('')

  const handleCopyMessage = async (msgId: string, text: string) => {
    try {
      playSound('pop')
      const cleanText = stripCopilotHtml(text)
      await navigator.clipboard.writeText(cleanText)
      setCopiedMsgId(msgId)
      setTimeout(() => setCopiedMsgId(null), 1800)
    } catch (err) {
      console.error('Failed to copy message:', err)
    }
  }

  const handleStartEdit = (msgId: string, content: string) => {
    const cleanText = stripCopilotHtml(content)
    setEditingMsgId(msgId)
    setEditingText(cleanText)
  }

  const handleCancelEdit = () => {
    setEditingMsgId(null)
    setEditingText('')
  }

  const handleSubmitEdit = async () => {
    if (!editingText.trim() || isAnalyzing) return
    const textToSend = editingText.trim()
    setEditingMsgId(null)
    setEditingText('')
    await onSendMessage(textToSend)
  }


  // Resizable window state (width and height)
  const [windowSize, setWindowSize] = useState<{ width: number; height: number }>(() => {
    try {
      const saved = localStorage.getItem('arcis_window_size_v2')
      if (saved) {
        const parsed = JSON.parse(saved)
        return {
          width: Math.max(MIN_WIDTH, Math.min(window.innerWidth - 48, parsed.width || DEFAULT_WIDTH)),
          height: Math.max(MIN_HEIGHT, Math.min(window.innerHeight - 120, parsed.height || DEFAULT_HEIGHT)),
        }
      }
    } catch (e) {
      console.error(e)
    }
    return { width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT }
  })

  // Dragging state for top-left corner
  const [isDragging, setIsDragging] = useState<boolean>(false)
  const dragStartRef = useRef<{ startX: number; startY: number; startW: number; startH: number }>({
    startX: 0,
    startY: 0,
    startW: DEFAULT_WIDTH,
    startH: DEFAULT_HEIGHT,
  })

  // Handle top-left resize drag with pointer events
  const handlePointerDownResize = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(true)
    dragStartRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      startW: windowSize.width,
      startH: windowSize.height,
    }
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      // Fallback if setPointerCapture is unsupported in environment
    }
  }

  const handlePointerMove = useCallback(
    (e: PointerEvent) => {
      if (!isDragging) return
      const deltaX = dragStartRef.current.startX - e.clientX // moving left increases width
      const deltaY = dragStartRef.current.startY - e.clientY // moving up increases height

      const maxW = Math.min(850, window.innerWidth - 48)
      const maxH = Math.min(900, window.innerHeight - 120)

      const newWidth = Math.max(MIN_WIDTH, Math.min(maxW, dragStartRef.current.startW + deltaX))
      const newHeight = Math.max(MIN_HEIGHT, Math.min(maxH, dragStartRef.current.startH + deltaY))

      setWindowSize({ width: newWidth, height: newHeight })
    },
    [isDragging]
  )

  const handlePointerUp = useCallback(() => {
    if (isDragging) {
      setIsDragging(false)
      try {
        localStorage.setItem('arcis_window_size_v2', JSON.stringify(windowSize))
      } catch (err) {
        // Cosmetic write: the drawer keeps its current size and only loses the remembered one, so the
        // failure is logged at warn level with that consequence instead of being swallowed.
        log.warn('Copilot drawer size could not be saved; next open falls back to the default size:', err)
      }
    }
  }, [isDragging, windowSize])

  useEffect(() => {
    if (isDragging) {
      window.addEventListener('pointermove', handlePointerMove)
      window.addEventListener('pointerup', handlePointerUp)
      window.addEventListener('pointercancel', handlePointerUp)
    } else {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerUp)
      window.removeEventListener('pointercancel', handlePointerUp)
    }
    return () => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerUp)
      window.removeEventListener('pointercancel', handlePointerUp)
    }
  }, [isDragging, handlePointerMove, handlePointerUp])

  // Global Escape key listener to close copilot drawer
  useEffect(() => {
    if (!isOpen) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (isSessionKeyModalOpen || isSettingsModalOpen) return
        if (editingMsgId) {
          handleCancelEdit()
          return
        }
        if (isSlashMenuOpen) {
          return
        }
        e.preventDefault()
        onClose()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, isSessionKeyModalOpen, isSettingsModalOpen, editingMsgId, isSlashMenuOpen, onClose])

  // Auto-scroll to bottom on new message
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, currentSteps, isAnalyzing])

  if (!isOpen) return null

  const canSendInput = Boolean(inputText.trim()) && (!isAnalyzing || classifyCopilotIntent(inputText).kind === 'cancel')
  const handleSend = async (e?: React.FormEvent) => {
    if (e) e.preventDefault()
    if (!canSendInput) return
    playSound('send')
    const text = inputText
    setInputText('')
    await onSendMessage(text)
  }

  const handleQuickPromptClick = async (promptText: string) => {
    if (isAnalyzing) return
    playSound('send')
    await onSendMessage(promptText)
  }

  const toggleSteps = (msgId: string) => {
    setExpandedStepsMap((prev) => ({
      ...prev,
      [msgId]: !prev[msgId],
    }))
  }

  return createPortal(
    <div
      role="dialog"
      aria-label="Arco AI Copilot"
      aria-modal="false"
      tabIndex={-1}
      className="fixed select-text flex flex-col rounded-3xl overflow-hidden border border-white/[0.08] shadow-2xl transition-shadow selection:bg-indigo-500/30 selection:text-white"
      style={{
        position: 'fixed',
        bottom: '84px',
        right: '24px',
        width: `${windowSize.width}px`,
        height: `${windowSize.height}px`,
        maxHeight: 'calc(100vh - 100px)',
        maxWidth: 'calc(100vw - 32px)',
        background: 'linear-gradient(180deg, rgba(15, 17, 26, 0.98) 0%, rgba(9, 10, 15, 0.99) 100%)',
        backdropFilter: 'blur(28px)',
        WebkitBackdropFilter: 'blur(28px)',
        boxShadow: '0 24px 64px -12px rgba(0, 0, 0, 0.9), 0 0 32px rgba(99, 102, 241, 0.12), inset 0 1px 0 rgba(255, 255, 255, 0.08)',
        zIndex: 9990,
      }}
    >
      {/* ── TOP-LEFT RESIZE HANDLE ── */}
      <div
        onPointerDown={handlePointerDownResize}
        aria-label="Resize copilot window"
        role="separator"
        aria-orientation="vertical"
        className="absolute top-0 left-0 w-8 h-8 z-40 flex items-center justify-center cursor-nwse-resize text-slate-500 hover:text-indigo-300 transition group select-none touch-none"
      >
        <div className="p-1 rounded-br-lg bg-[#0f111a]/80 group-hover:bg-indigo-950/60 border-r border-b border-white/[0.08] group-hover:border-indigo-500/40 select-none">
          <MoveDiagonal2 className="w-3 h-3 rotate-90 transform" />
        </div>
      </div>

      {/* ── HEADER (STABILIZER STYLE LUXURY TOP BAR) ── */}
      <div
        className="flex items-center justify-between px-5 py-3.5 border-b border-white/[0.08]"
        style={{
          background: 'linear-gradient(90deg, rgba(22, 25, 42, 0.95) 0%, rgba(15, 17, 26, 0.95) 100%)',
        }}
      >
        <div className="flex items-center gap-3 pl-4">
          <div className="relative">
            <div className="w-9 h-9 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 p-0.5 shadow-md shadow-indigo-500/20">
              <div className="w-full h-full bg-[#0f111a] rounded-full flex items-center justify-center">
                <Bot className="w-6 h-6 text-indigo-300" />
              </div>
            </div>
          </div>

          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-[14px] font-display font-bold text-white tracking-wide">Ask Arco</h3>
            </div>
            <p className="text-[11px] font-mono tracking-wider text-slate-400 uppercase flex items-center gap-1.5">
              <span>Arcis Autonomous Intelligence</span>
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Ask Arco Execution Settings (Slippage & Gas Fee) */}
          <button
            type="button"
            onClick={() => setIsSettingsModalOpen(true)}
            aria-label="Ask Arco transaction settings"
            title="Ask Arco Slippage & Gas Önceliği Ayarları"
            className="px-2.5 py-1.5 rounded-xl text-xs font-bold transition cursor-pointer flex items-center gap-1.5 border shadow-sm bg-[#161926]/80 hover:bg-[#1e2235] text-slate-300 hover:text-white border-white/[0.08] hover:border-indigo-500/40 hover:shadow-indigo-500/10"
          >
            <SlidersHorizontal className="w-4 h-4 text-indigo-400" />
          </button>

          {/* Session Settings */}
          <button
            onClick={() => setIsSessionKeyModalOpen(true)}
            aria-label="Session settings"
            className={`px-2 py-1.5 rounded-xl text-xs font-bold transition cursor-pointer flex items-center gap-1.5 border shadow-sm ${
              sessionConfig.isActive
                ? 'bg-indigo-950/80 hover:bg-indigo-900/90 text-indigo-300 border-indigo-500/40 shadow-indigo-500/10'
                : 'bg-[#161926]/80 hover:bg-[#1e2235] text-slate-400 border-white/[0.08]'
            }`}
          >
            <Settings className={`w-4 h-4 ${sessionConfig.isActive ? 'text-indigo-300' : 'text-slate-400'}`} />
          </button>

          {/* Sound FX Mute/Unmute Toggle */}
          <button
            onClick={handleToggleSound}
            aria-label={isSoundEnabled ? 'Disable sound effects' : 'Enable sound effects'}
            className={`px-2 py-1.5 rounded-xl text-xs font-bold transition cursor-pointer flex items-center gap-1.5 border shadow-sm ${isSoundEnabled
                ? 'bg-indigo-950/80 hover:bg-indigo-900/90 text-indigo-300 border-indigo-500/40 shadow-indigo-500/10'
                : 'bg-[#161926]/80 hover:bg-[#1e2235] text-slate-400 border-white/[0.08]'
              }`}
          >
            {isSoundEnabled ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
          </button>

          {/* Dynamic RotateCcw Reset / Clear Chat Button with Dynamic Visual Layer & Spin Effect */}
          <button
            type="button"
            onClick={handleResetChat}
            disabled={isResetting}
            aria-label={isResetting ? 'Sohbet sıfırlanıyor' : 'Sohbet geçmişini sıfırla'}
            className={`px-2 py-1.5 rounded-xl text-xs font-bold transition cursor-pointer flex items-center gap-1.5 border shadow-sm group relative ${
              isResetting
                ? 'bg-indigo-950/90 border-indigo-400/80 text-indigo-300 shadow-[0_0_18px_rgba(99,102,241,0.45)] ring-2 ring-indigo-400/40'
                : 'bg-[#161926]/85 hover:bg-[#1e2235] border-white/[0.08] hover:border-indigo-400/60 text-slate-300 hover:text-indigo-200 shadow-sm hover:shadow-[0_0_14px_rgba(99,102,241,0.25)]'
            }`}
          >
            {/* Dynamic visual aura layer */}
            <span className="absolute inset-0 rounded-xl bg-gradient-to-r from-indigo-500/25 via-purple-500/20 to-indigo-500/25 opacity-0 group-hover:opacity-100 blur-xs transition-opacity duration-300 pointer-events-none" />
            {isResetting && (
              <span className="absolute inset-0 rounded-xl bg-indigo-400/20 animate-pulse pointer-events-none" />
            )}
            <RotateCcw
              className={`w-4 h-4 relative z-10 transition-transform duration-300 ${
                isResetting ? 'animate-spin-ccw text-indigo-300' : 'group-hover:-rotate-45'
              }`}
            />
          </button>

          {/* Close copilot */}
          <button
            onClick={onClose}
            aria-label="Close copilot"
            className="px-2 py-1.5 rounded-xl text-xs font-bold transition cursor-pointer flex items-center gap-1.5 border shadow-sm bg-[#161926]/80 hover:bg-[#1e2235] text-slate-400 hover:text-white border-white/[0.08] hover:border-white/[0.15]"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* ── SESSION BUDGET BAR (Only shown when an active session is configured) ── */}
      {sessionConfig.isActive && Date.now() <= sessionConfig.expiresAt && (
        <div className="px-5 py-2 bg-[#090a0f]/90 border-b border-white/[0.06] flex items-center justify-between text-xs">
          <div className="flex items-center gap-2 text-slate-300">
            <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            <span className="font-medium flex items-center gap-1.5">
              <span>Session Budget:</span>
            </span>
            <span className="font-mono text-indigo-300 font-bold tabular-nums">
              {Math.max(0, sessionConfig.maxSpendUsdc - sessionConfig.spentUsdc).toFixed(2)} USDC
            </span>
            <span className="text-[12px] text-slate-400 font-mono hidden sm:inline">
              ({getSessionTimeRemaining(sessionConfig.expiresAt).formatted})
            </span>
          </div>
        </div>
      )}

      {/* ── CHAT MESSAGES STREAM ── */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4 font-sans text-xs select-text selection:bg-indigo-500/30 selection:text-white">
        {/* Message List */}
        {messages.map((msg, index) => (
          <div key={msg.id} className="space-y-1.5 select-text">
            <div
              className={`flex items-start gap-2.5 ${msg.role === 'user' ? 'justify-end' : 'justify-start'} ${index === 0 ? 'mt-1' : ''}`}
            >
              {/* Assistant Avatar on left */}
              {msg.role === 'assistant' && (
                <div className="w-7 h-7 rounded-full bg-[#161926] border border-indigo-400/40 flex-shrink-0 flex items-center justify-center mt-1 shadow-sm shadow-indigo-500/10 select-none">
                  <Bot className="w-4 h-4 text-indigo-300" />
                </div>
              )}

              {/* Message Bubble & Controls */}
              {msg.role === 'user' ? (
                editingMsgId === msg.id ? (
                  <div className="w-full max-w-[85%] p-3 rounded-2xl bg-[#0f111a] border border-indigo-500/50 shadow-xl space-y-2 animate-fade-in">
                    <textarea
                      value={editingText}
                      onChange={(e) => setEditingText(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault()
                          handleSubmitEdit()
                        } else if (e.key === 'Escape') {
                          handleCancelEdit()
                        }
                      }}
                      autoFocus
                      rows={Math.min(5, Math.max(2, editingText.split('\n').length))}
                      className="w-full p-2.5 rounded-xl bg-[#090a0f] border border-white/[0.08] text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-400 font-sans resize-none"
                      placeholder="Edit your message..."
                    />
                    <div className="flex items-center justify-end gap-2">
                      <button
                        type="button"
                        onClick={handleCancelEdit}
                        className="px-2.5 py-1 rounded-lg bg-[#161926] hover:bg-[#1e2235] text-slate-300 border border-white/[0.06] text-[11px] font-semibold transition cursor-pointer"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={handleSubmitEdit}
                        disabled={!editingText.trim() || isAnalyzing}
                        className="px-3 py-1 rounded-lg bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 disabled:opacity-50 text-white text-[11px] font-bold transition cursor-pointer flex items-center gap-1 shadow-md shadow-indigo-500/20"
                      >
                        <Send className="w-3 h-3" />
                        <span>Send</span>
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col items-end max-w-[85%] space-y-1 group">
                    <div className="rounded-2xl p-3.5 leading-relaxed bg-gradient-to-r from-indigo-600 to-purple-600 text-white rounded-br-none shadow-md shadow-indigo-500/10 select-text cursor-text">
                      <div
                        className="whitespace-pre-wrap leading-relaxed text-[12.5px] select-text cursor-text selection:bg-indigo-400/30 selection:text-white"
                        dangerouslySetInnerHTML={{ __html: sanitizeCopilotHtml(msg.content) }}
                      />
                    </div>

                    {/* Action buttons (Copy & Edit) right underneath user bubble, aligned to the right on hover */}
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity duration-200 pr-1 select-none">
                      {/* 1. Copy icon */}
                      <button
                        type="button"
                        onClick={() => handleCopyMessage(msg.id, msg.content)}
                        aria-label={copiedMsgId === msg.id ? 'Message copied to clipboard' : 'Copy message'}
                        className="p-1 rounded-md text-slate-400 hover:text-indigo-300 hover:bg-[#161926] transition cursor-pointer"
                      >
                        {copiedMsgId === msg.id ? (
                          <Check className="w-3.5 h-3.5 text-emerald-400" />
                        ) : (
                          <Copy className="w-3.5 h-3.5" />
                        )}
                      </button>

                      {/* 2. Edit icon (Pencil) */}
                      <button
                        type="button"
                        onClick={() => handleStartEdit(msg.id, msg.content)}
                        aria-label="Edit message"
                        className="p-1 rounded-md text-slate-400 hover:text-indigo-300 hover:bg-[#161926] transition cursor-pointer"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                )
              ) : (
                /* Assistant Bubble */
                <div className={`rounded-2xl leading-relaxed ${msg.receipt || msg.actionPayload ? 'max-w-[425px]' : 'max-w-[60%]'} shadow-md select-text cursor-text bg-[#0f111a]/95 text-slate-200 border border-white/[0.08] rounded-tl-none ${msg.receipt ? 'p-2 sm:p-2.5' : 'p-3.5'}`}>
                  {/* Fişlerin üstündeki hazırlık mesajı işlem sonuçlandığında (başarılı/başarısız fiş durumunda) gösterilmez */}
                  {!msg.receipt && (
                    <div className="relative">
                      <CopilotMessageContent
                        content={msg.content}
                        className="whitespace-pre-wrap leading-relaxed text-[12.5px] select-text cursor-text selection:bg-indigo-400/30 selection:text-white"
                      />
                      {msg.isStreaming && (
                        <span className="inline-block w-2 h-3.5 ml-1 bg-indigo-400 animate-pulse align-middle rounded-sm shadow-[0_0_8px_rgba(99,102,241,0.8)]" />
                      )}
                    </div>
                  )}

                  {/* Step Logs Accordion */}
                  {msg.steps && msg.steps.length > 0 && (
                    <div className="mt-3 pt-2.5 border-t border-white/[0.06] select-text">
                      <button
                        onClick={() => toggleSteps(msg.id)}
                        aria-expanded={expandedStepsMap[msg.id] ?? false}
                        aria-label={`Toggle execution steps (${msg.steps.length} steps)`}
                        className="flex items-center justify-between w-full text-[11px] font-semibold text-indigo-400 hover:text-indigo-300 cursor-pointer"
                      >
                        <span className="flex items-center gap-1.5">
                          <Activity className="w-3.5 h-3.5" />
                          <span>AI Services ({msg.steps.length} steps)</span>
                        </span>
                        {expandedStepsMap[msg.id] ? (
                          <ChevronUp className="w-3.5 h-3.5" />
                        ) : (
                          <ChevronDown className="w-3.5 h-3.5" />
                        )}
                      </button>

                      {expandedStepsMap[msg.id] && (
                        <div className="space-y-1.5 mt-2 pt-1 select-text">
                          {msg.steps.map((step) => (
                            <div
                              key={step.stepNumber}
                              className="p-2 rounded-lg bg-[#090a0f]/80 border border-white/[0.06] text-[10px] space-y-0.5 select-text cursor-text"
                            >
                              <div className="flex items-center justify-between font-mono select-text">
                                <span className="text-slate-300 font-semibold select-text">{step.serviceName}</span>
                                <span className="text-emerald-400 select-text tabular-nums">${step.costUsdc} USDC • {step.durationMs}ms</span>
                              </div>
                              {step.resultSummary && (
                                <p className="text-slate-400 select-text">{step.resultSummary}</p>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Protocol fee tag */}
                  {msg.totalCostUsdc && (
                    <div className="mt-2 text-[10px] font-mono text-emerald-400/90 flex items-center justify-between select-text cursor-text">
                      <span className="select-text">⚡ Nanopayment Ücreti:</span>
                      <span className="select-text tabular-nums">${msg.totalCostUsdc.toFixed(4)} USDC</span>
                    </div>
                  )}

                  {/* Interactive Inline Action Cards & Live Receipts */}
                  {(msg.actionPayload || msg.receipt || msg.isExecutingInline) && (
                    <InlineActionCard
                      message={msg}
                      walletAddress={walletAddress}
                      onExecuteInline={onExecuteInline}
                      onNavigateToTab={onNavigateToTab}
                      onOpenSessionSettings={() => setIsSessionKeyModalOpen(true)}
                      onOpenExecutionSettings={() => setIsSettingsModalOpen(true)}
                      onCloseDrawer={onClose}
                      onSendMessage={onSendMessage}
                    />
                  )}
                </div>
              )}
            </div>

            {/* Next step cards derived from the report this message just bought. Same engine and
                same cards as the AI Services shelf; opening one navigates there, where the
                playground can run it with the suggested inputs. */}
            {msg.role === 'assistant' && msg.nextSteps && msg.nextSteps.length > 0 && (
              <div className="pl-9.5 w-full max-w-[96%]">
                <NextStepRail
                  recommendations={msg.nextSteps}
                  compact
                  actionLabel={(recommendation) =>
                    canExecuteNextStep?.(recommendation)
                      ? 'Run in chat'
                      : 'Open in AI Services'
                  }
                  onOpen={async (recommendation) => {
                    // The card runs its paid step in this chat when the copilot has that flow;
                    // otherwise the catalogue is where it can be run with those inputs.
                    if (canExecuteNextStep?.(recommendation) && onExecuteNextStep) {
                      await onExecuteNextStep(recommendation)
                      return
                    }
                    onNavigateToTab?.('ai-services')
                    onClose()
                  }}
                />
              </div>
            )}

            {/* Explore Topics Chips placed directly below the welcome bubble */}
            {index === 0 && msg.role === 'assistant' && (
              <div className="pl-9.5 space-y-3 select-text w-full max-w-[96%]">
                <div className="arc-eyebrow text-[10px] text-slate-400 tracking-wider select-text ml-3 mt-3">
                  <span>EXPLORE TOPICS</span>
                </div>

                {/* Topic Pills */}
                <div className="flex flex-wrap gap-1.5">
                  {EXPLORE_TOPIC_CATEGORIES.map((topic) => {
                    const isSelected = topic.id === selectedTopicId
                    return (
                      <button
                        key={topic.id}
                        onClick={() =>
                          setSelectedTopicId((prev) => (prev === topic.id ? null : topic.id))
                        }
                        className={`px-3.5 py-1 rounded-full text-[11px] font-medium transition cursor-pointer shadow-sm active:scale-95 border ${isSelected
                            ? 'bg-gradient-to-r from-indigo-500 to-purple-600 text-white font-semibold border-indigo-400/50 shadow-md shadow-indigo-500/25'
                            : 'bg-[#161926]/90 text-slate-300 hover:text-white border-white/[0.08] hover:border-indigo-500/40'
                          }`}
                      >
                        {topic.label}
                      </button>
                    )
                  })}
                </div>

                {/* 5 Questions for the Selected Topic (only shown when a topic is selected) */}
                {selectedTopicId && (
                  <div className="space-y-1.5 pt-1 animate-fade-in">
                    {exploreTopicQuestions(selectedTopicId, canPayForCalls ?? Boolean(walletAddress)).map(
                      (q) => (
                        <button
                          key={q.id}
                          onClick={() => handleQuickPromptClick(q.prompt)}
                          disabled={isAnalyzing}
                          className="w-full text-left px-4 py-2.5 rounded-2xl bg-[#0f111a]/80 hover:bg-[#161926] border border-white/[0.06] hover:border-indigo-500/40 text-slate-200 hover:text-white text-xs font-normal transition flex items-center justify-between group cursor-pointer active:scale-[0.99] disabled:opacity-50"
                        >
                          <span className="truncate pr-2">{q.title}</span>
                          <span className="text-slate-500 group-hover:text-indigo-300 text-xs transition">
                            ›
                          </span>
                        </button>
                      )
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        ))}

        {/* Loading / Typing Indicator with Robot Avatar */}
        {isAnalyzing && (
          <div className="flex items-start gap-2.5 justify-start animate-fade-in">
            {/* Assistant Avatar with glowing pulse */}
            <div className="w-7 h-7 rounded-full bg-[#161926] border border-indigo-400/60 flex-shrink-0 flex items-center justify-center mt-1 shadow-sm shadow-indigo-500/20 relative">
              <Bot className="w-4 h-4 text-indigo-300 animate-pulse" />
              <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-indigo-400 animate-ping" />
            </div>

            {/* Speech Bubble with 4 Glowing Bouncing Wave Dots & Progress */}
            <div className="rounded-2xl p-3.5 bg-[#0f111a]/95 text-slate-200 border border-indigo-500/30 rounded-tl-none shadow-lg shadow-indigo-500/10 max-w-[85%] space-y-2">
              <div className="flex items-center gap-2.5">
                <div className="flex items-center gap-1.5 py-1 px-2 bg-[#090a0f]/90 rounded-full border border-indigo-500/30 shadow-inner shadow-indigo-500/10">
                  <span className="w-2 h-2 rounded-full bg-indigo-400 typing-dot-1" />
                  <span className="w-2 h-2 rounded-full bg-indigo-400 typing-dot-2" />
                  <span className="w-2 h-2 rounded-full bg-indigo-400 typing-dot-3" />
                  <span className="w-2 h-2 rounded-full bg-purple-400 typing-dot-4" />
                </div>
                <span className="text-indigo-200 text-xs font-semibold tracking-wide">
                  Arcis is preparing the answer...
                </span>
              </div>

              {/* Realtime step progress logs */}
              {currentSteps.length > 0 && (
                <div className="pt-2 border-t border-white/[0.06] space-y-1.5">
                  {currentSteps.map((step) => (
                    <div
                      key={step.stepNumber}
                      className="p-1.5 px-2.5 rounded-xl bg-[#090a0f]/80 border border-white/[0.06] text-[10px] flex items-center justify-between font-mono"
                    >
                      <span className="text-slate-300 truncate max-w-[65%]">{step.serviceName}</span>
                      <span className="text-indigo-300 flex-shrink-0">
                        {step.status === 'completed' ? `✓ ${step.durationMs}ms` : '⚡ Yürütülüyor...'}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* ── INPUT BOX (STABILIZER STYLE FOOTER) ── */}
      <div className="relative p-3 border-t border-white/[0.08] bg-[#090a0f]/90 backdrop-blur-xl">
        {/* Slash Commands Dropdown Menu */}
        <CopilotSlashMenu
          isOpen={isSlashMenuOpen}
          commands={filteredSlashCommands}
          selectedIndex={slashSelectedIdx}
          onSelectCommand={handleSelectSlashCommand}
          onHoverIndex={setSlashSelectedIdx}
        />

        <form onSubmit={handleSend} className="relative flex items-center gap-2">
          <div className="relative flex-1 flex items-center">
            <Sparkles className="w-4 h-4 text-indigo-400/70 absolute left-3.5 pointer-events-none" />
            <input
              ref={inputRef}
              type="text"
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              onKeyDown={(e) => {
                if (isSlashMenuOpen && filteredSlashCommands.length > 0) {
                  if (e.key === 'ArrowDown') {
                    e.preventDefault()
                    setSlashSelectedIdx((prev) => (prev + 1) % filteredSlashCommands.length)
                    return
                  }
                  if (e.key === 'ArrowUp') {
                    e.preventDefault()
                    setSlashSelectedIdx((prev) => (prev - 1 + filteredSlashCommands.length) % filteredSlashCommands.length)
                    return
                  }
                  if (e.key === 'Tab') {
                    e.preventDefault()
                    const selected = filteredSlashCommands[slashSelectedIdx]
                    if (selected) {
                      setInputText(selected.command + ' ')
                      inputRef.current?.focus()
                    }
                    return
                  }
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    const selected = filteredSlashCommands[slashSelectedIdx]
                    if (selected) {
                      handleSelectSlashCommand(selected)
                    }
                    return
                  }
                  if (e.key === 'Escape') {
                    e.preventDefault()
                    setInputText('')
                    return
                  }
                }
              }}
              placeholder="Type a command or open the quick menu with /"
              className="w-full pl-10 pr-3 py-2.5 rounded-2xl bg-[#0f111a]/90 border border-white/[0.08] text-xs text-white placeholder-slate-400 focus:outline-none focus:border-indigo-500/60 focus:ring-1 focus:ring-indigo-500/30 transition disabled:opacity-50"
            />
          </div>

          <button
            type="submit"
            aria-label="Send message"
            disabled={!canSendInput}
            className="w-9 h-9 rounded-2xl bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 disabled:bg-[#161926] disabled:text-slate-600 text-white flex items-center justify-center transition cursor-pointer disabled:cursor-not-allowed shadow-md shadow-indigo-500/25 flex-shrink-0"
          >
            <Send className="w-3.5 h-3.5" />
          </button>
        </form>
      </div>

      {/* ── ASK ARCO EXECUTION (SLIPPAGE & GAS FEE) SETTINGS MODAL ── */}
      <CopilotSettingsModal
        isOpen={isSettingsModalOpen}
        onClose={() => setIsSettingsModalOpen(false)}
        slippage={copilotSlippage}
        slippageType={copilotSlippageType}
        customSlippage={copilotCustomSlippage}
        speedTier={copilotSpeedTier}
        onSave={(newSettings) => {
          walletSettingsService.setWalletSettings(walletAddress, {
            copilotSlippage: newSettings.slippage,
            copilotSlippageType: newSettings.slippageType,
            copilotCustomSlippage: newSettings.customSlippage,
            copilotSpeedTier: newSettings.speedTier,
          })
          setCopilotSlippage(newSettings.slippage)
          setCopilotSlippageType(newSettings.slippageType)
          setCopilotCustomSlippage(newSettings.customSlippage)
          setCopilotSpeedTier(newSettings.speedTier)
        }}
      />

      {/* ── AUTONOMOUS SESSION KEY SETTINGS MODAL ── */}
      <SessionKeyModal
        isOpen={isSessionKeyModalOpen}
        onClose={() => setIsSessionKeyModalOpen(false)}
        sessionConfig={sessionConfig}
        walletAddress={walletAddress}
        onActivateSession={onActivateSession}
        onRevokeSession={onRevokeSession}
        onToggleAutoExecute={onToggleAutoExecute}
      />
    </div>,
    document.body
  )
}
