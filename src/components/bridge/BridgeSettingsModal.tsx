import React from 'react'
import { createPortal } from 'react-dom'
import { Settings, X, Save } from 'lucide-react'
import { SpeedFeeSelector } from '../common/SpeedFeeSelector'
import type { SpeedTier } from '../../config/feeTiers'

interface BridgeSettingsModalProps {
  isOpen: boolean
  onClose: () => void
  speedTier: SpeedTier
  onSelectTier: (tier: SpeedTier) => void
  onSave: () => void
  disabled?: boolean
}

export const BridgeSettingsModal: React.FC<BridgeSettingsModalProps> = ({
  isOpen,
  onClose,
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
                Bridge Settings
              </h3>
              <p className="text-[11px] text-slate-400">Execution speed and network gas priority</p>
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

        {/* Speed & Execution Priority Section */}
        <div className="space-y-2 pt-1">
          <SpeedFeeSelector
            selectedTier={speedTier}
            onSelectTier={onSelectTier}
            context="bridge"
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
