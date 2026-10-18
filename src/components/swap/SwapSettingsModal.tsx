import React from 'react'
import { createPortal } from 'react-dom'
import { Settings, X, AlertTriangle, Save } from 'lucide-react'
import { SpeedFeeSelector } from '../common/SpeedFeeSelector'
import type { SpeedTier } from '../../config/feeTiers'
import { POOL_MAX_SLIPPAGE_BPS } from '../../config/poolsConfig'

export interface SwapSettingsModalProps {
  isOpen: boolean
  onClose: () => void
  slippageTolerance: number
  selectedSlippageType: '0.1' | '0.5' | '1.0' | 'custom'
  customSlippage: string
  isHighSlippageWarning: boolean
  onSelectPreset: (type: '0.1' | '0.5' | '1.0') => void
  onToggleCustom: () => void
  onChangeCustom: (e: React.ChangeEvent<HTMLInputElement>) => void
  speedTier: SpeedTier
  onSelectTier: (tier: SpeedTier) => void
  onSave: () => void
  disabled?: boolean
}

export const SwapSettingsModal: React.FC<SwapSettingsModalProps> = ({
  isOpen,
  onClose,
  slippageTolerance,
  selectedSlippageType,
  customSlippage,
  isHighSlippageWarning,
  onSelectPreset,
  onToggleCustom,
  onChangeCustom,
  speedTier,
  onSelectTier,
  onSave,
  disabled = false,
}) => {
  if (!isOpen || typeof document === 'undefined') return null

  return createPortal(
    <div
      className="fixed inset-0 z-[250] flex items-center justify-center p-4 bg-black/70 backdrop-blur-md animate-fade-in overscroll-contain touch-none"
      onClick={onClose}
    >
      <div
        className="w-full max-w-[480px] rounded-3xl p-6 sm:p-7 shadow-2xl relative border space-y-5 animate-scale-in"
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
              <Settings className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-base font-semibold text-white tracking-wide">
                Swap Settings
              </h3>
              <p className="text-[11px] text-slate-400">Slippage and execution preferences</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-full flex items-center justify-center text-slate-400 hover:text-white bg-white/[0.04] hover:bg-white/[0.1] border border-white/[0.06] transition-all cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Slippage Tolerance */}
        <div>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1 text-[12px] font-semibold tracking-wide text-slate-300 ml-3">
              <span style={{ fontFamily: 'var(--font-app)' }}>SLIPPAGE TOLERANCE</span>
            </div>
            <span className="text-xs text-indigo-400 font-semibold font-mono px-2 py-0.5 rounded-full bg-indigo-500/10 border border-indigo-500/20 mr-3">
              {(slippageTolerance * 100).toFixed(1)}%
            </span>
          </div>

          <div className="p-2 rounded-2xl mt-2 space-y-2">
            <div className="grid grid-cols-4 gap-2">
              {(['0.1', '0.5', '1.0'] as const).map((type) => (
                <button
                  key={type}
                  type="button"
                  onClick={() => onSelectPreset(type)}
                  className={`py-2 px-2.5 rounded-xl text-xs font-semibold transition-all text-center cursor-pointer ${
                    selectedSlippageType === type
                      ? 'text-white bg-indigo-500/20 border border-indigo-500/40 shadow-sm'
                      : 'text-slate-400 hover:text-white bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.06]'
                  }`}
                >
                  {type}%
                </button>
              ))}
              <button
                type="button"
                onClick={onToggleCustom}
                className={`py-2 px-2.5 rounded-xl text-xs font-semibold transition-all text-center cursor-pointer ${
                  selectedSlippageType === 'custom'
                    ? 'text-white bg-indigo-500/20 border border-indigo-500/40 shadow-sm'
                    : 'text-slate-400 hover:text-white bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.06]'
                }`}
              >
                Custom
              </button>
            </div>

            {selectedSlippageType === 'custom' && (
              <div className="space-y-1.5 pt-1 animate-fade-in">
                <div className="relative">
                  <input
                    type="number"
                    step="0.1"
                    min="0.01"
                    max={POOL_MAX_SLIPPAGE_BPS / 100}
                    placeholder="e.g. 1.5"
                    value={customSlippage}
                    onChange={onChangeCustom}
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
                    <span>High slippage may result in frontrunning or poor execution.</span>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Speed Priority Section */}
        <div className="space-y-2 pt-1">
          <SpeedFeeSelector
            selectedTier={speedTier}
            onSelectTier={onSelectTier}
            context="swap"
            disabled={disabled}
          />
        </div>

        {/* Save button */}
        <button
          type="button"
          onClick={onSave}
          className="w-full flex items-center justify-center gap-2 py-3 px-4 rounded-xl text-xs font-semibold text-white bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-400 hover:to-purple-500 transition-all cursor-pointer shadow-md shadow-indigo-500/20"
        >
          <Save className="w-4 h-4" />
          <span>Save Settings</span>
        </button>
      </div>
    </div>,
    document.body
  )
}
