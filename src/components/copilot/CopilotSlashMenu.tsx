// src/components/copilot/CopilotSlashMenu.tsx
// Cybernetic Glassmorphic Slash Command Palette for Ask Arco Copilot

import React, { useEffect, useRef } from 'react'
import { Terminal, Command, CornerDownLeft, Sparkles } from 'lucide-react'
import type { SlashCommandItem } from '../../config/copilotSlashCommands'

interface CopilotSlashMenuProps {
  isOpen: boolean
  commands: SlashCommandItem[]
  selectedIndex: number
  onSelectCommand: (command: SlashCommandItem) => void
  onHoverIndex: (index: number) => void
}

export const CopilotSlashMenu: React.FC<CopilotSlashMenuProps> = ({
  isOpen,
  commands,
  selectedIndex,
  onSelectCommand,
  onHoverIndex,
}) => {
  const listRef = useRef<HTMLDivElement>(null)

  // Auto-scroll the active item into view
  useEffect(() => {
    if (!isOpen || !listRef.current) return
    const activeEl = listRef.current.children[selectedIndex] as HTMLElement | undefined
    if (activeEl) {
      activeEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    }
  }, [selectedIndex, isOpen])

  if (!isOpen || commands.length === 0) return null

  return (
    <div className="absolute bottom-full left-0 right-0 mb-2 z-40 animate-in fade-in slide-in-from-bottom-2 duration-200">
      <div className="mx-2 rounded-2xl bg-slate-950/95 border border-cyan-500/30 backdrop-blur-xl shadow-2xl overflow-hidden flex flex-col max-h-[300px]">
        {/* Header bar */}
        <div className="px-3.5 py-2 border-b border-slate-800/80 bg-slate-900/60 flex items-center justify-between">
          <div className="flex items-center gap-1.5 text-[11px] font-bold text-cyan-300">
            <Terminal className="w-3.5 h-3.5 text-cyan-400" />
            <span>Arco Commands</span>
          </div>
        </div>

        {/* Scrollable Command List */}
        <div
          ref={listRef}
          className="overflow-y-auto p-1.5 space-y-1 custom-scrollbar"
        >
          {commands.map((cmd, idx) => {
            const isSelected = idx === selectedIndex

            return (
              <button
                key={cmd.id}
                type="button"
                onMouseEnter={() => onHoverIndex(idx)}
                onClick={() => onSelectCommand(cmd)}
                className={`w-full text-left p-2 rounded-xl transition-all duration-150 flex items-center justify-between cursor-pointer group select-none ${
                  isSelected
                    ? 'bg-cyan-950/70 border border-cyan-500/50 shadow-[0_0_12px_rgba(6,182,212,0.25)]'
                    : 'bg-transparent border border-transparent hover:bg-slate-900/80'
                }`}
              >
                <div className="flex items-center gap-2.5 min-w-0 pr-2">
                  <div
                    className={`w-7 h-7 rounded-lg flex items-center justify-center text-sm flex-shrink-0 transition-transform ${
                      isSelected
                        ? 'bg-cyan-500/20 scale-110 shadow-sm'
                        : 'bg-slate-900 text-slate-300 group-hover:scale-105'
                    }`}
                  >
                    <span>{cmd.icon}</span>
                  </div>

                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span
                        className={`text-xs font-bold font-mono tracking-tight ${
                          isSelected ? 'text-cyan-200' : 'text-white'
                        }`}
                      >
                        {cmd.command}
                      </span>
                      <span className="text-xs font-medium text-slate-300 truncate">
                        {cmd.title}
                      </span>
                    </div>
                    <p className="text-[10px] text-slate-400 truncate mt-0.5">
                      {cmd.description}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2 flex-shrink-0 pl-2">
                  <span className="text-[10px] font-mono text-slate-400 opacity-60 group-hover:opacity-100 hidden sm:inline-block">
                    {cmd.syntax}
                  </span>
                  {isSelected && (
                    <div className="px-1.5 py-0.5 rounded-md bg-cyan-500/20 border border-cyan-400/40 text-[9px] font-mono text-cyan-300 flex items-center gap-1">
                      <span>Enter</span>
                      <CornerDownLeft className="w-2.5 h-2.5" />
                    </div>
                  )}
                </div>
              </button>
            )
          })}
        </div>

        {/* Footer shortcuts bar */}
        <div className="px-3 py-1.5 bg-slate-900/80 border-t border-slate-800/80 flex items-center justify-between text-[11px] text-slate-400 font-mono">
          <div className="flex items-center gap-2">
            <span>↑↓ Go</span>
            <span>•</span>
            <span>Enter / Tab Select</span>
            <span>•</span>
            <span>Esc Close</span>
          </div>
        </div>
      </div>
    </div>
  )
}
