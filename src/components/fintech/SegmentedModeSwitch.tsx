import React from 'react'

export interface ModeOption {
  id: string
  label: string
  icon?: React.ReactNode
  tooltip?: string
  badge?: string
}

interface SegmentedModeSwitchProps {
  options: ModeOption[]
  activeId: string
  onChange: (id: any) => void
  disabled?: boolean
  className?: string
}

export const SegmentedModeSwitch: React.FC<SegmentedModeSwitchProps> = ({
  options,
  activeId,
  onChange,
  disabled = false,
  className = '',
}) => {
  return (
    <div
      className={`grid p-1.5 rounded-full backdrop-blur-xl border border-white/[0.06] bg-black/40 ${className}`}
      style={{
        gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))`,
      }}
    >
      {options.map((opt) => {
        const isActive = activeId === opt.id
        return (
          <button
            key={opt.id}
            type="button"
            disabled={disabled}
            title={opt.tooltip}
            onClick={() => onChange(opt.id)}
            className={`py-2 px-3 sm:px-4 rounded-full text-xs font-semibold tracking-wide transition-all duration-200 flex items-center justify-center gap-2 cursor-pointer select-none ${
              isActive
                ? 'text-white bg-indigo-500/25 border border-indigo-500/45 shadow-md shadow-indigo-500/15'
                : 'text-slate-400 hover:text-white hover:bg-white/[0.04] border border-transparent'
            }`}
            style={{
              fontFamily: 'var(--font-app)',
            }}
          >
            {opt.icon}
            <span className="truncate">{opt.label}</span>
            {opt.badge && (
              <span className="text-[9px] font-bold px-1.5 py-0.2 rounded-full bg-indigo-500/20 text-indigo-300 border border-indigo-500/35">
                {opt.badge}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}
