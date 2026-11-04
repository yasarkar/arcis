// src/components/copilot/CopilotRobotWidget.tsx
// Floating Obsidian "Ask Arco" Pill Widget in Bottom-Right Corner (Aligned with DESIGN.md)

import React, { useState } from 'react'
import { createPortal } from 'react-dom'
import { Bot } from 'lucide-react'

interface CopilotRobotWidgetProps {
  isOpen: boolean
  onClick: () => void
  isAnalyzing?: boolean
}

export default function CopilotRobotWidget({
  isOpen,
  onClick,
  isAnalyzing = false,
}: CopilotRobotWidgetProps) {
  const [isHovered, setIsHovered] = useState<boolean>(false)

  return createPortal(
    <div
      className="fixed bottom-6 right-6 z-50 select-none flex items-center justify-center"
      style={{
        position: 'fixed',
        bottom: '24px',
        right: '24px',
        zIndex: 9999,
      }}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {/* Speech bubble / Tooltip on hover (appears at the top-left of the widget) */}
      <div
        className={`absolute bottom-full right-2 mb-3.5 transition-all duration-300 transform pointer-events-none ${
          isHovered && !isOpen
            ? 'opacity-100 translate-y-0 scale-100'
            : 'opacity-0 translate-y-2 scale-95'
        }`}
      />

      {/* "Ask Arco" Capsule Pill Button */}
      <button
        onClick={onClick}
        type="button"
        aria-label="Toggle Arco AI Copilot"
        className={`relative group p-0.5 rounded-full transition-all duration-300 cursor-pointer focus:outline-none ${
          isOpen ? 'scale-95' : 'hover:scale-105 active:scale-95'
        }`}
      >
        {/* Animated Outer Glow Ring — Luxury Indigo / Purple Aura */}
        <div
          className="absolute -inset-1 rounded-full bg-gradient-to-r from-indigo-500 via-purple-600 to-indigo-500 blur-md opacity-70 group-hover:opacity-100 transition-opacity animate-pulse-slow pointer-events-none"
        />

        {/* Capsule Pill Body — Dark Obsidian Glass Surface */}
        <div
          className="relative pl-1.5 pr-4 py-1.5 rounded-full flex items-center gap-2.5 border border-white/[0.12] group-hover:border-indigo-400/50 shadow-2xl transition-all"
          style={{
            background: 'linear-gradient(135deg, rgba(22, 25, 42, 0.95) 0%, rgba(15, 17, 26, 0.98) 100%)',
            backdropFilter: 'blur(20px)',
            WebkitBackdropFilter: 'blur(20px)',
            boxShadow: '0 12px 32px rgba(0, 0, 0, 0.75), 0 0 24px rgba(99, 102, 241, 0.2), inset 0 1px 1px rgba(255, 255, 255, 0.15)',
          }}
        >
          {/* Left: Cybernetic Robot Avatar Circle */}
          <div
            className="relative w-9 h-9 rounded-full flex items-center justify-center border border-indigo-400/40 shadow-sm"
            style={{
              background: 'linear-gradient(135deg, #161926 0%, #1e1b4b 100%)',
            }}
          >
            <Bot
              className={`w-5 h-5 text-indigo-300 transition-transform duration-300 ${
                isAnalyzing ? 'animate-bounce' : 'group-hover:scale-110'
              }`}
            />
          </div>

          {/* Right: "Ask Arco" Text & AI Badge */}
          <div className="flex items-center gap-2">
            <span className="text-xs md:text-sm font-bold text-white tracking-wide group-hover:text-indigo-200 transition font-display">
              Ask Arco
            </span>
          </div>
        </div>
      </button>
    </div>,
    document.body
  )
}
