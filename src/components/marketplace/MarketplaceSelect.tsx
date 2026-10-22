// src/components/marketplace/MarketplaceSelect.tsx
// Institutional Obsidian Custom Select Dropdown for Arcis AI Services
import React, { useEffect, useRef, useState } from 'react'
import { ChevronDown, Check } from 'lucide-react'
import { soundService } from '../../services/soundService'

export interface SelectOption {
  value: string
  label: string
  badge?: string
  icon?: React.ComponentType<{ className?: string }>
}

export interface MarketplaceSelectProps {
  value: string
  onChange: (value: string) => void
  options: SelectOption[]
  placeholder?: string
  disabled?: boolean
  className?: string
  menuTitle?: string
}

export default function MarketplaceSelect({
  value,
  onChange,
  options,
  placeholder = 'Select option...',
  disabled = false,
  className = '',
  menuTitle,
}: MarketplaceSelectProps) {
  const [isOpen, setIsOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  const selectedOption = options.find((opt) => opt.value === value)

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside)
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [isOpen])

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape' && isOpen) {
        setIsOpen(false)
      }
    }
    if (isOpen) {
      document.addEventListener('keydown', handleKeyDown)
    }
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [isOpen])

  return (
    <div className={`relative ${isOpen ? 'z-50' : 'z-10'} ${className}`} ref={containerRef}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => {
          if (disabled) return
          soundService.play('pop')
          setIsOpen((prev) => !prev)
        }}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        className={`w-full px-3.5 py-2.5 rounded-xl border flex items-center justify-between text-xs transition-all duration-200 cursor-pointer select-none ${
          disabled
            ? 'opacity-50 cursor-not-allowed border-white/5 bg-white/[0.02] text-white/40'
            : isOpen
              ? 'border-[var(--purple-1)]/60 bg-[var(--purple-1)]/10 text-white shadow-[0_0_14px_rgba(152,150,255,0.18)]'
              : 'border-white/10 text-white/90 hover:text-white hover:border-white/20'
        }`}
        style={{
          background: isOpen ? undefined : 'rgba(9, 11, 20, 0.85)',
          fontFamily: 'var(--fonts--space-mono)',
        }}
      >
        <div className="flex items-center gap-2 min-w-0">
          {selectedOption?.icon && (
            <selectedOption.icon className="w-3.5 h-3.5 text-[var(--purple-1)] flex-shrink-0" />
          )}
          <span className="truncate">
            {selectedOption ? selectedOption.label : placeholder}
          </span>
        </div>
        <ChevronDown
          className={`w-3.5 h-3.5 text-white/40 transition-transform duration-200 flex-shrink-0 ml-2 ${
            isOpen ? 'rotate-180 text-[var(--purple-1)]' : ''
          }`}
        />
      </button>

      {isOpen && (
        <div
          role="listbox"
          className="absolute left-0 right-0 top-full mt-1.5 z-50 w-full min-w-[200px] rounded-2xl p-1.5 shadow-2xl backdrop-blur-2xl animate-fade-in max-h-60 overflow-y-auto"
          style={{
            background: 'rgba(12, 15, 26, 0.98)',
            border: '1px solid rgba(152, 150, 255, 0.25)',
            boxShadow: '0 20px 48px -8px rgba(0, 0, 0, 0.8), 0 0 1px 1px rgba(255, 255, 255, 0.06)',
            fontFamily: 'var(--fonts--space-mono)',
          }}
        >
          {menuTitle && (
            <div className="px-3 py-1.5 text-[10px] text-[var(--secondary-colors--sky-sync)] font-semibold uppercase tracking-wider border-b border-white/[0.06] flex items-center justify-between mb-1">
              <span>{menuTitle}</span>
            </div>
          )}
          <div className="space-y-0.5">
            {options.map((opt) => {
              const isSelected = opt.value === value
              const IconComp = opt.icon
              return (
                <button
                  key={opt.value}
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  onClick={() => {
                    soundService.play('pop')
                    onChange(opt.value)
                    setIsOpen(false)
                  }}
                  className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs transition-all cursor-pointer select-none text-left ${
                    isSelected
                      ? 'bg-[var(--purple-1)]/15 text-white border border-[var(--purple-1)]/30 shadow-[0_0_12px_rgba(152,150,255,0.15)] font-semibold'
                      : 'text-white/70 hover:text-white hover:bg-white/[0.06] border border-transparent'
                  }`}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    {IconComp && (
                      <IconComp
                        className={`w-3.5 h-3.5 flex-shrink-0 ${
                          isSelected ? 'text-[var(--purple-1)]' : 'text-white/40'
                        }`}
                      />
                    )}
                    <span className="truncate">{opt.label}</span>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0 ml-2">
                    {opt.badge && (
                      <span className="text-[9px] px-1.5 py-0.2 rounded font-mono bg-cyan-500/10 text-cyan-300 border border-cyan-500/20">
                        {opt.badge}
                      </span>
                    )}
                    {isSelected && <Check className="w-3.5 h-3.5 text-[var(--purple-1)]" />}
                  </div>
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
