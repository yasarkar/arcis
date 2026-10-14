import React, { useState, useEffect, useRef, useMemo } from 'react'
import { Clipboard, X, Check, AlertCircle} from 'lucide-react'
import { useRecentRecipients } from '../../hooks/useRecentRecipients'
import type { ChainFamily } from '../../utils/recentRecipients'

export interface RecipientAddressFieldProps {
  value: string
  onChange: (val: string) => void
  label?: string
  placeholder?: string
  error?: string | null
  isValid?: boolean
  disabled?: boolean
  onPaste?: () => void
  onBlur?: () => void
  onClear?: () => void
  rightBadge?: React.ReactNode
  className?: string
  chainFamily?: ChainFamily
  connectedAddress?: string
  autoSaveValidOnBlur?: boolean
  showRecentDropdown?: boolean
}

export const RecipientAddressField: React.FC<RecipientAddressFieldProps> = ({
  value,
  onChange,
  label = 'RECIPIENT ADDRESS',
  placeholder = '0x... or ENS name',
  error,
  isValid = false,
  disabled = false,
  onPaste,
  onBlur,
  onClear,
  rightBadge,
  className = '',
  chainFamily = 'all',
  connectedAddress,
  autoSaveValidOnBlur = true,
  showRecentDropdown = true,
}) => {
  const [isDropdownOpen, setIsDropdownOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  const { recipients, save, remove, clearAll } = useRecentRecipients(
    chainFamily,
    connectedAddress
  )

  // Close dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsDropdownOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [])

  // Filter recipients based on what user typed (if any)
  const filteredRecipients = useMemo(() => {
    if (!value || !value.trim()) return recipients
    const lower = value.trim().toLowerCase()
    return recipients.filter(
      (r) =>
        r.address.toLowerCase().includes(lower) ||
        (r.label && r.label.toLowerCase().includes(lower))
    )
  }, [recipients, value])

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

  const handleBlur = () => {
    if (autoSaveValidOnBlur && isValid && value && value.trim()) {
      save({
        address: value.trim(),
        chainFamily: chainFamily === 'all' ? undefined : chainFamily,
      })
    }
    onBlur?.()
  }

  const hasDropdownItems = showRecentDropdown && filteredRecipients.length > 0
  const isDropdownAttached = isDropdownOpen && hasDropdownItems

  return (
    <div ref={containerRef} className={`relative w-full ${className}`}>
      {/* Main Input Box */}
      <div
        className={`p-4 sm:p-5 transition-all duration-200 ${
          isDropdownAttached ? 'rounded-t-2xl rounded-b-none' : 'rounded-2xl'
        } ${
          error
            ? 'bg-rose-500/[0.06] border border-rose-500/30'
            : isValid
            ? 'bg-[#121626]/85 hover:bg-[#15192c]/90 focus-within:bg-[#15192c] border border-indigo-500/30 focus-within:border-indigo-500/50'
            : 'bg-[#121626]/85 hover:bg-[#15192c]/90 focus-within:bg-[#15192c] border border-white/[0.06] hover:border-white/[0.12] focus-within:border-indigo-500/40'
        }`}
      >
        {/* Header */}
        <div className="flex items-center justify-between gap-2 mb-2.5">
          <div className="flex items-center gap-2">
            <span
              className="text-[12px] font-semibold tracking-wider text-slate-400 uppercase"
              style={{ fontFamily: 'var(--font-app)' }}
            >
              {label}
            </span>
          </div>

          <div className="flex items-center gap-2">
            {rightBadge}
            {isValid && !error && (
              <span
                className="text-[11px] text-indigo-300/90 font-medium flex items-center gap-1 animate-fade-in"
                title="Verified Address"
              >
                <Check className="w-3.5 h-3.5 text-indigo-400" />
              </span>
            )}
            {value ? (
              <button
                type="button"
                onClick={handleClear}
                disabled={disabled}
                title="Clear address"
                className="text-xs text-slate-400 hover:text-red-400 transition-colors flex items-center gap-1 cursor-pointer active:scale-95"
              >
                <X className="w-4 h-4" />
              </button>
            ) : (
              <button
                type="button"
                onClick={handlePaste}
                disabled={disabled}
                className="text-xs font-medium text-indigo-400 hover:text-indigo-300 transition-colors flex items-center gap-1 cursor-pointer active:scale-95"
              >
                <Clipboard className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>

        {/* Input */}
        <div className="relative flex items-center">
          <input
            type="text"
            value={value}
            onChange={(e) => {
              onChange(e.target.value.trim())
              if (!isDropdownOpen && showRecentDropdown && recipients.length > 0) {
                setIsDropdownOpen(true)
              }
            }}
            onFocus={() => {
              if (showRecentDropdown && recipients.length > 0) {
                setIsDropdownOpen(true)
              }
            }}
            placeholder={placeholder}
            disabled={disabled}
            onBlur={handleBlur}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                setIsDropdownOpen(false)
              }
            }}
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

      {/* Attached Droplist (Bitişik Dropdown) */}
      {isDropdownAttached && (
        <div
          className="absolute left-0 right-0 top-full rounded-b-2xl overflow-hidden z-50 transition-all duration-150 animate-fade-in"
          style={{
            marginTop: '-1px', // Seamless connection to input bottom border
            background: 'linear-gradient(180deg, rgba(16, 20, 36, 0.98) 0%, rgba(12, 15, 28, 0.99) 100%)',
            backdropFilter: 'blur(24px)',
            WebkitBackdropFilter: 'blur(24px)',
            borderWidth: '1px',
            borderStyle: 'solid',
            borderColor: error
              ? 'rgba(244, 63, 94, 0.3)'
              : isValid
              ? 'rgba(99, 102, 241, 0.4)'
              : 'rgba(99, 102, 241, 0.3)',
            borderTop: 'none',
            boxShadow: '0 20px 40px -8px rgba(0, 0, 0, 0.9), 0 0 20px rgba(99, 102, 241, 0.12)',
          }}
        >
          {/* Items List */}
          <div className="max-h-52 overflow-y-auto custom-scrollbar divide-y divide-white/[0.04]">
            {filteredRecipients.map((item) => {
              const isSelected = value.trim().toLowerCase() === item.address.toLowerCase()
              return (
                <div
                  key={item.address}
                  onMouseDown={(e) => {
                    e.preventDefault()
                    onChange(item.address)
                    setIsDropdownOpen(false)
                  }}
                  className={`w-full flex items-center justify-between px-4 py-2.5 text-xs transition cursor-pointer group ${
                    isSelected
                      ? 'bg-indigo-500/15 text-indigo-300 font-medium'
                      : 'text-slate-200 hover:bg-white/[0.06] hover:text-white'
                  }`}
                >
                  <div className="flex items-center gap-2.5 min-w-0 pr-2">
                    <div className="flex flex-col min-w-0">
                      <span
                        className="font-mono text-xs text-slate-200 group-hover:text-white truncate"
                        title={item.address}
                      >
                      {item.address}
                      </span>
                      <div className="flex items-center gap-2 text-[10px] text-slate-500">
                        {item.label && (
                          <span className="text-indigo-400/90 font-medium truncate max-w-[120px]">
                            {item.label}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
