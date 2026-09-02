// src/components/copilot/ArcCopilotDrawer.tsx
// Floating Resizable AI Copilot Mini-Window for Arcis (Anchored Above Floating Widget)
import React, { useState, useRef, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
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
  Key,
  Zap,
  Check,
  Copy,
  Pencil,
  Volume2,
  VolumeX,
} from 'lucide-react'
import { EXPLORE_TOPIC_CATEGORIES } from '../../hooks/useArcCopilot'
import type { CopilotMessage, CopilotStepLog, CopilotActionPayload } from '../../types/marketplace'
import type { SessionKeyConfig, SessionActionType } from '../../types/sessionKey'
import { getOpenAIApiKey, setOpenAIApiKey } from '../../services/llmService'
import { getSessionTimeRemaining } from '../../services/sessionKeyService'
import { playSound, soundService } from '../../services/soundService'
import SessionKeyModal from './SessionKeyModal'
import InlineActionCard from './InlineActionCard'
import { CopilotSlashMenu } from './CopilotSlashMenu'
import { COPILOT_SLASH_COMMANDS, type SlashCommandItem } from '../../config/copilotSlashCommands'

interface ArcCopilotDrawerProps {
  isOpen: boolean
  onClose: () => void
  messages: CopilotMessage[]
  currentSteps: CopilotStepLog[]
  isAnalyzing: boolean
  sessionConfig: SessionKeyConfig
  onSendMessage: (query: string) => Promise<void>
  onClearChat: () => void
  onActivateSession: (params: {
    maxSpendUsdc?: number
    durationHours?: number
    maxPerTxUsdc?: number
    autoExecute?: boolean
    allowedActions?: SessionActionType[]
  }) => Promise<SessionKeyConfig>
  onRevokeSession: () => void
  onToggleAutoExecute: (enabled: boolean) => void
  onExecuteInline: (messageId: string, actionPayload: CopilotActionPayload) => Promise<void>
  onNavigateToTab?: (tab: string) => void
  onOpenFaucet?: () => void
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
  onSendMessage,
  onClearChat,
  onActivateSession,
  onRevokeSession,
  onToggleAutoExecute,
  onExecuteInline,
  onNavigateToTab,
  onOpenFaucet,
}: ArcCopilotDrawerProps) {
  const [inputText, setInputText] = useState<string>('')
  const [selectedTopicId, setSelectedTopicId] = useState<string | null>(null)
  const [expandedStepsMap, setExpandedStepsMap] = useState<Record<string, boolean>>({})
  const [isSessionKeyModalOpen, setIsSessionKeyModalOpen] = useState<boolean>(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

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

  const handleSelectSlashCommand = async (cmd: SlashCommandItem) => {
    playSound('pop')
    if (cmd.directActionKey === 'clear') {
      onClearChat()
      setInputText('')
      return
    }
    if (cmd.directActionKey === 'session') {
      setIsSessionKeyModalOpen(true)
      setInputText('')
      return
    }
    if (cmd.directActionKey === 'faucet') {
      setInputText('')
      await onSendMessage('Claim 1,000 testnet USDC from faucet')
      return
    }
    if (cmd.directActionKey === 'apiKey') {
      setIsApiKeyModalOpen(true)
      setInputText('')
      return
    }

    if (cmd.command === '/swap' || cmd.command === '/vault' || cmd.command === '/bridge' || cmd.command === '/send') {
      if (inputText.trim() === cmd.command || inputText.trim() === '/') {
        setInputText(cmd.command + ' ')
        inputRef.current?.focus()
        return
      }
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
      const cleanText = text.replace(/<[^>]*>?/gm, '')
      await navigator.clipboard.writeText(cleanText)
      setCopiedMsgId(msgId)
      setTimeout(() => setCopiedMsgId(null), 1800)
    } catch (err) {
      console.error('Failed to copy message:', err)
    }
  }

  const handleStartEdit = (msgId: string, content: string) => {
    const cleanText = content.replace(/<[^>]*>?/gm, '')
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

  // API Key Settings State
  const [isApiKeyModalOpen, setIsApiKeyModalOpen] = useState<boolean>(false)
  const [apiKeyInput, setApiKeyInput] = useState<string>(getOpenAIApiKey())
  const [apiKeySavedNotice, setApiKeySavedNotice] = useState<boolean>(false)

  const handleSaveApiKey = () => {
    setOpenAIApiKey(apiKeyInput)
    setApiKeySavedNotice(true)
    setTimeout(() => {
      setApiKeySavedNotice(false)
      setIsApiKeyModalOpen(false)
    }, 900)
  }

  // Resizable window state (width and height)
  const [windowSize, setWindowSize] = useState<{ width: number; height: number }>(() => {
    try {
      const saved = localStorage.getItem('arcis_window_size_v2') || localStorage.getItem('arcflow_arco_window_size_v2')
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

  // Handle top-left resize drag
  const handleMouseDownResize = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(true)
    dragStartRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      startW: windowSize.width,
      startH: windowSize.height,
    }
  }

  const handleMouseMove = useCallback(
    (e: MouseEvent) => {
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

  const handleMouseUp = useCallback(() => {
    if (isDragging) {
      setIsDragging(false)
      try {
        localStorage.setItem('arcis_window_size_v2', JSON.stringify(windowSize))
      } catch (e) { }
    }
  }, [isDragging, windowSize])

  useEffect(() => {
    if (isDragging) {
      window.addEventListener('mousemove', handleMouseMove)
      window.addEventListener('mouseup', handleMouseUp)
    } else {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }
    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }
  }, [isDragging, handleMouseMove, handleMouseUp])

  // Auto-scroll to bottom on new message
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, currentSteps, isAnalyzing])

  if (!isOpen) return null

  const handleSend = async (e?: React.FormEvent) => {
    if (e) e.preventDefault()
    if (!inputText.trim() || isAnalyzing) return
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
      className="fixed z-50 select-text flex flex-col rounded-3xl overflow-hidden border border-cyan-500/30 shadow-2xl transition-shadow selection:bg-cyan-500/30 selection:text-white"
      style={{
        position: 'fixed',
        bottom: '84px',
        right: '24px',
        width: `${windowSize.width}px`,
        height: `${windowSize.height}px`,
        maxHeight: 'calc(100vh - 100px)',
        maxWidth: 'calc(100vw - 32px)',
        background: 'linear-gradient(180deg, rgba(14, 18, 33, 0.98) 0%, rgba(9, 11, 22, 0.99) 100%)',
        backdropFilter: 'blur(28px)',
        WebkitBackdropFilter: 'blur(28px)',
        boxShadow: '0 20px 60px -10px rgba(0, 0, 0, 0.85), 0 0 35px rgba(6, 182, 212, 0.2), inset 0 1px 0 rgba(255, 255, 255, 0.1)',
        zIndex: 9990,
      }}
    >
      {/* ── TOP-LEFT RESIZE HANDLE ── */}
      <div
        onMouseDown={handleMouseDownResize}
        title="Boyutu ayarlamak için sol üste doğru sürükleyin"
        className="absolute top-0 left-0 w-8 h-8 z-40 flex items-center justify-center cursor-nwse-resize text-slate-500 hover:text-cyan-300 transition group select-none"
      >
        <div className="p-1 rounded-br-lg bg-slate-900/80 group-hover:bg-cyan-950/60 border-r border-b border-slate-700/60 group-hover:border-cyan-500/40 select-none">
          <MoveDiagonal2 className="w-3 h-3 rotate-90 transform" />
        </div>
      </div>

      {/* ── HEADER (STABILIZER STYLE LUXURY TOP BAR) ── */}
      <div
        className="flex items-center justify-between px-5 py-3.5 border-b border-cyan-500/20"
        style={{
          background: 'linear-gradient(90deg, rgba(22, 34, 56, 0.95) 0%, rgba(17, 24, 46, 0.95) 100%)',
        }}
      >
        <div className="flex items-center gap-3 pl-4">
          <div className="relative">
            <div className="w-9 h-9 rounded-full bg-gradient-to-br from-cyan-400 to-indigo-600 p-0.5 shadow-md shadow-cyan-500/20">
              <div className="w-full h-full bg-slate-950 rounded-full flex items-center justify-center">
                <Bot className="w-6 h-6 text-cyan-300" />
              </div>
            </div>
          </div>

          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-extrabold text-white tracking-wide">Ask Arcis</h3>
            </div>
            <p className="text-[10px] text-slate-400">Arcis Assistant</p>
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          {/* Autonomous Session Key Trigger Button */}
          <button
            onClick={() => setIsSessionKeyModalOpen(true)}
            title={sessionConfig.isActive ? "Autonomous Session Key (Active)" : "Configure Autonomous Session Key"}
            className={`px-2.5 py-1 rounded-xl text-xs font-bold transition cursor-pointer flex items-center gap-1.5 border shadow-sm ${
              sessionConfig.isActive
                ? 'bg-cyan-950/80 hover:bg-cyan-900/90 text-cyan-300 border-cyan-500/40 shadow-cyan-500/10'
                : 'bg-slate-850 hover:bg-slate-800 text-slate-400 border-slate-700'
            }`}
          >
            <Zap className={`w-3.5 h-3.5 ${sessionConfig.isActive ? 'text-cyan-400 animate-pulse' : 'text-slate-400'}`} />
            <span className="hidden sm:inline">
              {sessionConfig.isActive ? '0 Pop-up Mode' : 'Session Key'}
            </span>
          </button>

          <button
            onClick={() => setIsApiKeyModalOpen(true)}
            title={getOpenAIApiKey() ? "OpenAI API Key (Aktif)" : "OpenAI API Key Ayarları"}
            className={`p-1.5 rounded-lg transition cursor-pointer relative ${
              getOpenAIApiKey()
                ? 'text-emerald-400 hover:text-emerald-300 bg-emerald-950/40 hover:bg-emerald-900/50 border border-emerald-500/30'
                : 'text-slate-400 hover:text-white hover:bg-slate-800/80'
            }`}
          >
            <Key className="w-4 h-4" />
            {getOpenAIApiKey() && (
              <span className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-emerald-400" />
            )}
          </button>

          {/* Sound FX Mute/Unmute Toggle */}
          <button
            onClick={handleToggleSound}
            title={isSoundEnabled ? 'Sesli Geri Bildirim: Açık (Kapatmak için tıklayın)' : 'Sesli Geri Bildirim: Sessiz (Açmak için tıklayın)'}
            className={`p-1.5 rounded-lg transition cursor-pointer ${
              isSoundEnabled
                ? 'text-cyan-300 hover:text-cyan-200 bg-cyan-950/40 hover:bg-cyan-900/50 border border-cyan-500/30'
                : 'text-slate-500 hover:text-slate-300 hover:bg-slate-800/80'
            }`}
          >
            {isSoundEnabled ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
          </button>

          <button
            onClick={() => {
              setSelectedTopicId(null)
              onClearChat()
            }}
            title="Sohbeti Yenile / Temizle"
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800/80 transition cursor-pointer"
          >
            <RotateCcw className="w-4 h-4" />
          </button>

          <button
            onClick={onClose}
            title="Kapat"
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800/80 transition cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* ── SESSION KEY & BUDGET BAR ── */}
      <div className="px-5 py-2 bg-slate-950/85 border-b border-cyan-500/20 flex items-center justify-between text-xs">
        <div className="flex items-center gap-2 text-slate-300">
          <div className={`w-2 h-2 rounded-full ${sessionConfig.isActive && Date.now() <= sessionConfig.expiresAt ? 'bg-emerald-400 animate-pulse' : 'bg-slate-600'}`} />
          <span className="font-medium flex items-center gap-1.5">
            <span>Session:</span>
          </span>
          <span className="font-mono text-cyan-300 font-bold">
            {Math.max(0, sessionConfig.maxSpendUsdc - sessionConfig.spentUsdc).toFixed(2)} USDC left
          </span>
          <span className="text-[12px] text-slate-400 font-mono hidden sm:inline">
            ({getSessionTimeRemaining(sessionConfig.expiresAt).formatted})
          </span>
        </div>
      </div>

      {/* ── CHAT MESSAGES STREAM ── */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4 font-sans text-xs select-text selection:bg-cyan-500/30 selection:text-white">
        {/* Message List */}
        {messages.map((msg, index) => (
          <div key={msg.id} className="space-y-1.5 select-text group">
            <div
              className={`flex items-start gap-2.5 ${msg.role === 'user' ? 'justify-end' : 'justify-start'} ${index === 0 ? 'mt-1' : ''}`}
            >
              {/* Assistant Avatar on left */}
              {msg.role === 'assistant' && (
                <div className="w-7 h-7 rounded-full bg-slate-900 border border-cyan-400/50 flex-shrink-0 flex items-center justify-center mt-1 shadow-sm shadow-cyan-500/10 select-none">
                  <Bot className="w-4 h-4 text-cyan-300" />
                </div>
              )}

              {/* Message Bubble & Controls */}
              {msg.role === 'user' ? (
                editingMsgId === msg.id ? (
                  <div className="w-full max-w-[85%] p-3 rounded-2xl bg-slate-900 border border-cyan-500/60 shadow-xl space-y-2 animate-fade-in">
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
                      className="w-full p-2.5 rounded-xl bg-slate-950 border border-slate-700 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-cyan-400 font-sans resize-none"
                      placeholder="Edit your message..."
                    />
                    <div className="flex items-center justify-end gap-2">
                      <button
                        type="button"
                        onClick={handleCancelEdit}
                        className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-[11px] font-semibold transition cursor-pointer"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={handleSubmitEdit}
                        disabled={!editingText.trim() || isAnalyzing}
                        className="px-3 py-1 rounded-lg bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 text-white text-[11px] font-bold transition cursor-pointer flex items-center gap-1 shadow-md"
                      >
                        <Send className="w-3 h-3" />
                        <span>Send</span>
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col items-end max-w-[85%] space-y-1">
                    <div className="rounded-2xl p-3.5 leading-relaxed bg-gradient-to-r from-teal-700 to-cyan-700 text-white rounded-br-none shadow-md select-text cursor-text">
                      <div
                        className="whitespace-pre-wrap leading-relaxed text-[12.5px] select-text cursor-text selection:bg-cyan-400/30 selection:text-white"
                        dangerouslySetInnerHTML={{ __html: msg.content }}
                      />
                    </div>

                    {/* Action buttons (Copy & Edit) right underneath user bubble, aligned to the right on hover */}
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity duration-200 pr-1 select-none">
                      {/* 1. Copy icon */}
                      <button
                        type="button"
                        onClick={() => handleCopyMessage(msg.id, msg.content)}
                        className="p-1 rounded-md text-slate-400 hover:text-cyan-300 hover:bg-slate-800/80 transition cursor-pointer"
                        title="Copy Message"
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
                        className="p-1 rounded-md text-slate-400 hover:text-cyan-300 hover:bg-slate-800/80 transition cursor-pointer"
                        title="Edit Message"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                )
              ) : (
                /* Assistant Bubble */
                <div className="rounded-2xl p-3.5 leading-relaxed max-w-[85%] shadow-md select-text cursor-text bg-slate-900/90 text-slate-200 border border-slate-800 rounded-tl-none">
                  <div className="relative">
                    <span
                      className="whitespace-pre-wrap leading-relaxed text-[12.5px] select-text cursor-text selection:bg-cyan-400/30 selection:text-white"
                      dangerouslySetInnerHTML={{ __html: msg.content }}
                    />
                    {msg.isStreaming && (
                      <span className="inline-block w-2 h-3.5 ml-1 bg-cyan-400 animate-pulse align-middle rounded-sm shadow-[0_0_8px_rgba(6,182,212,0.8)]" />
                    )}
                  </div>

                  {/* Step Logs Accordion */}
                  {msg.steps && msg.steps.length > 0 && (
                    <div className="mt-3 pt-2.5 border-t border-slate-800 select-text">
                      <button
                        onClick={() => toggleSteps(msg.id)}
                        className="flex items-center justify-between w-full text-[11px] font-semibold text-cyan-400 hover:text-cyan-300 cursor-pointer"
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
                              className="p-2 rounded-lg bg-slate-950/80 border border-slate-800/80 text-[10px] space-y-0.5 select-text cursor-text"
                            >
                              <div className="flex items-center justify-between font-mono select-text">
                                <span className="text-slate-300 font-semibold select-text">{step.serviceName}</span>
                                <span className="text-emerald-400 select-text">${step.costUsdc} USDC • {step.durationMs}ms</span>
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
                      <span className="select-text">${msg.totalCostUsdc.toFixed(4)} USDC</span>
                    </div>
                  )}

                  {/* Interactive Inline Action Cards & Live Receipts */}
                  {(msg.actionPayload || msg.receipt || msg.isExecutingInline) && (
                    <InlineActionCard
                      message={msg}
                      onExecuteInline={onExecuteInline}
                      onNavigateToTab={onNavigateToTab}
                      onOpenFaucet={onOpenFaucet}
                      onOpenSessionSettings={() => setIsSessionKeyModalOpen(true)}
                      onCloseDrawer={onClose}
                    />
                  )}
                </div>
              )}
            </div>

            {/* Explore Topics Chips placed directly below the welcome bubble */}
            {index === 0 && msg.role === 'assistant' && (
              <div className="pl-9.5 space-y-3 select-text w-full max-w-[96%]">
                <div className="flex items-center gap-2 text-[10px] uppercase font-bold tracking-wider text-slate-400 select-text">
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
                        className={`px-3.5 py-1.5 rounded-full text-[11px] font-medium transition cursor-pointer shadow-sm active:scale-95 border ${
                          isSelected
                            ? 'bg-teal-300 text-slate-950 font-bold border-teal-300 shadow-teal-300/20'
                            : 'bg-slate-900/90 text-slate-300 hover:text-white border-slate-700/80 hover:border-slate-500'
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
                    {EXPLORE_TOPIC_CATEGORIES.find((t) => t.id === selectedTopicId)?.questions.map(
                      (q) => (
                        <button
                          key={q.id}
                          onClick={() => handleQuickPromptClick(q.prompt)}
                          disabled={isAnalyzing}
                          className="w-full text-left px-4 py-2.5 rounded-2xl bg-slate-900/70 hover:bg-slate-800/90 border border-slate-800 hover:border-cyan-500/40 text-slate-200 hover:text-cyan-200 text-xs font-normal transition flex items-center justify-between group cursor-pointer active:scale-[0.99] disabled:opacity-50"
                        >
                          <span className="truncate pr-2">{q.title}</span>
                          <span className="text-slate-500 group-hover:text-cyan-400 text-xs transition">
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
            <div className="w-7 h-7 rounded-full bg-slate-900 border border-cyan-400/70 flex-shrink-0 flex items-center justify-center mt-1 shadow-sm shadow-cyan-500/20 relative">
              <Bot className="w-4 h-4 text-cyan-300 animate-pulse" />
              <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-cyan-400 animate-ping" />
            </div>

            {/* Speech Bubble with 4 Glowing Bouncing Wave Dots & Progress */}
            <div className="rounded-2xl p-3.5 bg-slate-900/95 text-slate-200 border border-cyan-500/40 rounded-tl-none shadow-lg shadow-cyan-500/10 max-w-[85%] space-y-2">
              <div className="flex items-center gap-2.5">
                <div className="flex items-center gap-1.5 py-1 px-2 bg-slate-950/80 rounded-full border border-cyan-500/30 shadow-inner shadow-cyan-500/10">
                  <span className="w-2 h-2 rounded-full bg-cyan-400 typing-dot-1" />
                  <span className="w-2 h-2 rounded-full bg-cyan-400 typing-dot-2" />
                  <span className="w-2 h-2 rounded-full bg-cyan-400 typing-dot-3" />
                  <span className="w-2 h-2 rounded-full bg-indigo-400 typing-dot-4" />
                </div>
                <span className="text-cyan-200 text-xs font-semibold tracking-wide">
                  Arcis is preparing the answer...
                </span>
              </div>

              {/* Realtime step progress logs */}
              {currentSteps.length > 0 && (
                <div className="pt-2 border-t border-slate-800/80 space-y-1.5">
                  {currentSteps.map((step) => (
                    <div
                      key={step.stepNumber}
                      className="p-1.5 px-2.5 rounded-xl bg-slate-950/80 border border-slate-800 text-[10px] flex items-center justify-between font-mono"
                    >
                      <span className="text-slate-300 truncate max-w-[65%]">{step.serviceName}</span>
                      <span className="text-cyan-400 flex-shrink-0">
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
      <div className="relative p-3 border-t border-slate-800/80 bg-slate-950/80 backdrop-blur-xl">
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
            <Sparkles className="w-4 h-4 text-slate-500 absolute left-3.5 pointer-events-none" />
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
                    if (selected) handleSelectSlashCommand(selected)
                    return
                  }
                  if (e.key === 'Enter') {
                    const selected = filteredSlashCommands[slashSelectedIdx]
                    if (selected && (inputText.trim() === selected.command || inputText.trim() === '/')) {
                      e.preventDefault()
                      handleSelectSlashCommand(selected)
                      return
                    }
                  }
                  if (e.key === 'Escape') {
                    e.preventDefault()
                    setInputText('')
                    return
                  }
                }
              }}
              placeholder="Type a command or open the quick menu with /"
              disabled={isAnalyzing}
              className="w-full pl-10 pr-3 py-2.5 rounded-2xl bg-slate-900/90 border border-slate-800 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500 transition disabled:opacity-50"
            />
          </div>

          <button
            type="submit"
            disabled={!inputText.trim() || isAnalyzing}
            className="w-9 h-9 rounded-2xl bg-cyan-600 hover:bg-cyan-500 disabled:bg-slate-800 disabled:text-slate-600 text-white flex items-center justify-center transition cursor-pointer disabled:cursor-not-allowed shadow-md shadow-cyan-600/30 flex-shrink-0"
          >
            <Send className="w-3.5 h-3.5" />
          </button>
        </form>
      </div>
      {/* ── OPENAI API KEY SETTINGS MODAL ── */}
      {isApiKeyModalOpen && (
        <div className="absolute inset-0 z-50 bg-slate-950/85 backdrop-blur-md p-6 flex flex-col justify-center animate-fade-in">
          <div className="bg-slate-900 border border-cyan-500/40 rounded-2xl p-5 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-xl bg-cyan-950/80 border border-cyan-500/40 flex items-center justify-center">
                  <Key className="w-4 h-4 text-cyan-300" />
                </div>
                <div>
                  <h4 className="text-sm font-bold text-white">GPT-4o-mini Settings</h4>
                  <p className="text-[10px] text-slate-400">OpenAI Natural Language Engine</p>
                </div>
              </div>
              <button
                onClick={() => setIsApiKeyModalOpen(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-xs text-slate-300 leading-relaxed">
              Enter your OpenAI API key to enable GPT-4o-mini structured intent execution. If empty, Arcis automatically runs on our built-in zero-latency local NLP engine.
            </p>

            <div className="space-y-1.5">
              <label className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                OpenAI API Key
              </label>
              <input
                type="password"
                value={apiKeyInput}
                onChange={(e) => setApiKeyInput(e.target.value)}
                placeholder="sk-proj-..."
                className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-700 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-cyan-500 font-mono"
              />
            </div>

            <div className="flex items-center justify-between pt-2">
              <button
                onClick={() => {
                  setApiKeyInput('')
                  setOpenAIApiKey('')
                }}
                className="text-xs text-slate-400 hover:text-rose-400 transition cursor-pointer underline"
              >
                Clear Key
              </button>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => setIsApiKeyModalOpen(false)}
                  className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold transition cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSaveApiKey}
                  className="px-4 py-1.5 rounded-xl bg-gradient-to-r from-emerald-500 to-cyan-600 hover:brightness-110 text-white text-xs font-bold transition cursor-pointer flex items-center gap-1.5 shadow-md"
                >
                  {apiKeySavedNotice ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-white" />
                      <span>Saved!</span>
                    </>
                  ) : (
                    <span>Save Key</span>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── AUTONOMOUS SESSION KEY SETTINGS MODAL ── */}
      <SessionKeyModal
        isOpen={isSessionKeyModalOpen}
        onClose={() => setIsSessionKeyModalOpen(false)}
        sessionConfig={sessionConfig}
        onActivateSession={onActivateSession}
        onRevokeSession={onRevokeSession}
        onToggleAutoExecute={onToggleAutoExecute}
      />
    </div>,
    document.body
  )
}
