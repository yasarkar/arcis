import React from 'react'
import { Clipboard, X, Check, AlertCircle } from 'lucide-react'

interface RecipientAddressFieldProps {
  value: string
  onChange: (val: string) => void
  label?: string
  placeholder?: string
  error?: string | null
  isValid?: boolean
  validText?: string
  disabled?: boolean
  onPaste?: () => void
  onClear?: () => void
  rightBadge?: React.ReactNode
  className?: string
}

export const RecipientAddressField: React.FC<RecipientAddressFieldProps> = ({
  value,
  onChange,
  label = 'RECIPIENT ADDRESS',
  placeholder = '0x... or ENS name',
  error,
  isValid = false,
  validText = 'Valid Address',
  disabled = false,
  onPaste,
  onClear,
  rightBadge,
  className = '',
}) => {
  const handlePaste = async () => {
    if (onPaste) {
      onPaste()
      return
    }
    try {
      const text = await navigator.clipboard.readText()
      if (text) {
        onChange(text.trim())
      }
    } catch (err) {
      console.error('Failed to read clipboard:', err)
    }
  }

  const handleClear = () => {
    if (onClear) {
      onClear()
    } else {
      onChange('')
    }
  }

  return (
    <div
      className={`rounded-2xl p-4 sm:p-5 transition-all duration-200 ${
        error
          ? 'bg-rose-500/[0.06] border border-rose-500/30'
          : isValid
          ? 'bg-[#121626]/85 hover:bg-[#15192c]/90 focus-within:bg-[#15192c] border border-indigo-500/30 focus-within:border-indigo-500/50'
          : 'bg-[#121626]/85 hover:bg-[#15192c]/90 focus-within:bg-[#15192c] border border-white/[0.06] hover:border-white/[0.12] focus-within:border-indigo-500/40'
      } ${className}`}
    >
      {/* Header */}
      <div className="flex items-center justify-between gap-2 mb-2.5">
        <span
          className="text-[12px] font-semibold tracking-wider text-slate-400 uppercase"
          style={{ fontFamily: 'var(--font-app)' }}
        >
          {label}
        </span>

        <div className="flex items-center gap-2.5">
          {isValid && !error && (
            <span className="text-[11px] text-indigo-300/90 font-medium flex items-center gap-1">
              <Check className="w-3.5 h-3.5 text-indigo-400" />
              <span>{validText || 'Verified'}</span>
            </span>
          )}
          {rightBadge}
          {value ? (
            <button
              type="button"
              onClick={handleClear}
              disabled={disabled}
              className="text-xs text-slate-400 hover:text-slate-200 transition-colors flex items-center gap-1 cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
              <span>Clear</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={handlePaste}
              disabled={disabled}
              className="text-xs font-medium text-indigo-400 hover:text-indigo-300 transition-colors flex items-center gap-1 cursor-pointer active:scale-95"
            >
              <Clipboard className="w-3.5 h-3.5" />
              <span>Paste</span>
            </button>
          )}
        </div>
      </div>

      {/* Input */}
      <div className="relative flex items-center">
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value.trim())}
          placeholder={placeholder}
          disabled={disabled}
          autoComplete="off"
          autoCorrect="off"
          spellCheck="false"
          className="w-full bg-transparent border-0 p-0 font-mono text-sm sm:text-base text-white placeholder-slate-600 focus:outline-none"
        />
      </div>

      {/* Footer Error Status (if any) */}
      {error && (
        <div className="mt-2.5 pt-1.5 border-t border-white/[0.04] flex items-center gap-1.5 text-xs text-rose-400 animate-fade-in">
          <AlertCircle className="w-3.5 h-3.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}
    </div>
  )
}
