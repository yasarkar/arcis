// src/components/copilot/CopilotSettingsModal.tsx
// Dedicated Execution Speed (Fee) and Slippage Tolerance Settings Modal for Ask Arco.
// Follows Arcis Obsidian Luxury aesthetic (DESIGN.md) and integrates with SpeedFeeSelector.

import { AlertTriangle, Check, Save, SlidersHorizontal, X } from 'lucide-react'
import React, { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useBodyScrollLock } from '../../hooks/useBodyScrollLock'
import type { SpeedTier } from '../../config/feeTiers'
import { POOL_MAX_SLIPPAGE_BPS, POOL_MIN_SLIPPAGE_BPS } from '../../config/poolsConfig'
import type { SlippagePreset } from '../../types/walletSettings'
import { SpeedFeeSelector } from '../common/SpeedFeeSelector'

export interface CopilotSettingsModalProps {
  isOpen: boolean
  onClose: () => void
  slippage: number
  slippageType: SlippagePreset
  customSlippage: string
  speedTier: SpeedTier
  onSave: (settings: {
    slippage: number
    slippageType: SlippagePreset
    customSlippage: string
    speedTier: SpeedTier
  }) => void
  disabled?: boolean
}

export const CopilotSettingsModal: React.FC<CopilotSettingsModalProps> = ({
  isOpen,
  onClose,
  slippage: initialSlippage,
  slippageType: initialSlippageType,
  customSlippage: initialCustomSlippage,
  speedTier: initialSpeedTier,
  onSave,
  disabled = false,
}) => {
  const [selectedType, setSelectedType] = useState<SlippagePreset>(initialSlippageType)
  const [customVal, setCustomVal] = useState<string>(initialCustomSlippage)
  const [currentSlippage, setCurrentSlippage] = useState<number>(initialSlippage)
  const [selectedSpeedTier, setSelectedSpeedTier] = useState<SpeedTier>(initialSpeedTier)
  const [savedFeedback, setSavedFeedback] = useState<boolean>(false)

  // Sync state when modal opens or initial props change
  useEffect(() => {
    if (isOpen) {
      setSelectedType(initialSlippageType)
      setCustomVal(initialCustomSlippage)
      setCurrentSlippage(initialSlippage)
      setSelectedSpeedTier(initialSpeedTier)
      setSavedFeedback(false)
    }
  }, [isOpen, initialSlippage, initialSlippageType, initialCustomSlippage, initialSpeedTier])

  // Standard body scroll lock
  useBodyScrollLock(isOpen)

  // Accessibility: Close on Escape key
  useEffect(() => {
    if (!isOpen) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, onClose])

  if (!isOpen || typeof document === 'undefined') return null

  const handleSelectPreset = (preset: '0.1' | '0.5' | '1.0') => {
    setSelectedType(preset)
    const val = parseFloat(preset)
    setCurrentSlippage(val)
  }

  const handleToggleCustom = () => {
    setSelectedType('custom')
    const parsed = parseFloat(customVal)
    if (Number.isFinite(parsed) && parsed > 0) {
      const minPct = POOL_MIN_SLIPPAGE_BPS / 100
      const maxPct = POOL_MAX_SLIPPAGE_BPS / 100
      setCurrentSlippage(Math.min(maxPct, Math.max(minPct, parsed)))
    }
  }

  const handleChangeCustom = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value
    setCustomVal(raw)
    const parsed = parseFloat(raw)
    if (Number.isFinite(parsed) && parsed > 0) {
      const minPct = POOL_MIN_SLIPPAGE_BPS / 100
      const maxPct = POOL_MAX_SLIPPAGE_BPS / 100
      setCurrentSlippage(Math.min(maxPct, Math.max(minPct, parsed)))
    }
  }

  const isHighSlippageWarning =
    selectedType === 'custom' && parseFloat(customVal) > (POOL_MAX_SLIPPAGE_BPS / 100) * 0.75

  const handleSave = () => {
    const finalSlippage =
      selectedType === 'custom'
        ? Math.min(
          POOL_MAX_SLIPPAGE_BPS / 100,
          Math.max(POOL_MIN_SLIPPAGE_BPS / 100, parseFloat(customVal) || 1.0)
        )
        : parseFloat(selectedType) || 1.0

    onSave({
      slippage: finalSlippage,
      slippageType: selectedType,
      customSlippage: customVal,
      speedTier: selectedSpeedTier,
    })

    setSavedFeedback(true)
    setTimeout(() => {
      onClose()
    }, 450)
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[10000] flex items-center justify-center p-4 bg-black/75 backdrop-blur-md animate-fade-in overscroll-contain touch-none"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Ask Arco Execution Settings"
        className="w-full max-w-[480px] max-h-[90vh] overflow-y-auto rounded-3xl p-6 sm:p-7 shadow-2xl relative border space-y-5 animate-scale-in"
        style={{
          background: 'linear-gradient(180deg, rgba(16, 20, 36, 0.98) 0%, rgba(10, 12, 22, 0.99) 100%)',
          borderColor: 'rgba(255, 255, 255, 0.1)',
          boxShadow: '0 24px 64px -12px rgba(0, 0, 0, 0.9), 0 0 32px rgba(99, 102, 241, 0.15)',
          fontFamily: 'var(--font-app)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between pb-3.5 border-b border-white/[0.06]">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl flex items-center justify-center bg-indigo-500/10 border border-indigo-500/20 text-indigo-400">
              <SlidersHorizontal className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-base font-semibold text-white tracking-wide">
                Ask Arco Settings
              </h3>
              <p className="text-[11px] text-slate-400">Default slippage and gas execution speed</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close settings"
            className="w-8 h-8 rounded-full flex items-center justify-center text-slate-400 hover:text-white bg-white/[0.04] hover:bg-white/[0.1] border border-white/[0.06] transition-all cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Slippage Tolerance Section */}
        <div>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1 text-[12px] font-semibold tracking-wide text-slate-300 ml-3">
              <span className="text-slate-300">SLIPPAGE TOLERANCE</span>
            </div>
            <span className="text-xs text-indigo-400 font-semibold font-mono px-2.5 py-0.5 rounded-full bg-indigo-500/10 border border-indigo-500/20 mr-1">
              {currentSlippage.toFixed(1)}%
            </span>
          </div>

          <div className="p-2 rounded-2xl mt-2 space-y-2 bg-slate-950/40 border border-white/[0.04]">
            <div className="grid grid-cols-4 gap-2">
              {(['0.1', '0.5', '1.0'] as const).map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => handleSelectPreset(preset)}
                  className={`py-2 px-2.5 rounded-xl text-xs font-semibold transition-all text-center cursor-pointer ${selectedType === preset
                      ? 'text-white bg-indigo-500/20 border border-indigo-500/40 shadow-sm shadow-indigo-500/10'
                      : 'text-slate-400 hover:text-white bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.06]'
                    }`}
                >
                  {preset}%
                </button>
              ))}
              <button
                type="button"
                onClick={handleToggleCustom}
                className={`py-2 px-2.5 rounded-xl text-xs font-semibold transition-all text-center cursor-pointer ${selectedType === 'custom'
                    ? 'text-white bg-indigo-500/20 border border-indigo-500/40 shadow-sm shadow-indigo-500/10'
                    : 'text-slate-400 hover:text-white bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.06]'
                  }`}
              >
                Custom
              </button>
            </div>

            {selectedType === 'custom' && (
              <div className="space-y-1.5 pt-1 animate-fade-in">
                <div className="relative">
                  <input
                    type="number"
                    step="0.1"
                    min={POOL_MIN_SLIPPAGE_BPS / 100}
                    max={POOL_MAX_SLIPPAGE_BPS / 100}
                    placeholder="e.g. 1.5"
                    value={customVal}
                    onChange={handleChangeCustom}
                    autoFocus
                    className="w-full rounded-xl px-3.5 py-2 text-xs text-white focus:outline-none transition-all pr-8 bg-white/[0.04] border border-indigo-500/40 focus:border-indigo-500"
                  />
                  <span className="absolute right-3.5 top-1/2 -translate-y-1/2 text-xs font-semibold text-slate-400">
                    %
                  </span>
                </div>
                {isHighSlippageWarning && (
                  <div className="flex gap-2 text-xs text-amber-400 bg-amber-500/10 border border-amber-500/20 p-2 rounded-xl">
                    <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                    <span>High slippage may result in frontrunning or poor execution. Maximum allowed is {POOL_MAX_SLIPPAGE_BPS / 100}%.</span>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Speed & Execution Priority Section */}
        <div className="space-y-2 pt-1">
          <SpeedFeeSelector
            selectedTier={selectedSpeedTier}
            onSelectTier={setSelectedSpeedTier}
            context="swap"
            disabled={disabled}
          />
        </div>

        {/* Save button */}
        <button
          type="button"
          onClick={handleSave}
          disabled={disabled || savedFeedback}
          className="w-full flex items-center justify-center gap-2 py-3.5 px-6 rounded-full text-xs sm:text-sm font-semibold tracking-wide text-white transition-all duration-200 cursor-pointer shadow-lg shadow-purple-500/25 hover:scale-[1.01] hover:brightness-110 active:scale-[0.98] disabled:opacity-60"
          style={{
            fontFamily: 'var(--font-app)',
            background: 'linear-gradient(135deg, #9896ff 0%, #7c3aed 100%)',
            boxShadow: '0 6px 24px rgba(152, 150, 255, 0.3)',
          }}
        >
          {savedFeedback ? (
            <>
              <Check className="w-4 h-4 text-emerald-300 animate-scale-in" />
              <span className="text-emerald-200">Settings Saved!</span>
            </>
          ) : (
            <>
              <Save className="w-4 h-4" />
              <span>Save Preferences</span>
            </>
          )}
        </button>
      </div>
    </div>,
    document.body
  )
}

export default CopilotSettingsModal

