import React from 'react'
import { Tooltip } from '../common/Tooltip'

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
        const buttonElement = (
          <button
            type="button"
            disabled={disabled}
            onClick={() => onChange(opt.id)}
            className={`w-full py-2 px-3 sm:px-4 rounded-full text-xs font-semibold tracking-wide transition-all duration-200 flex items-center justify-center gap-2 cursor-pointer select-none ${
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

        return opt.tooltip ? (
          <Tooltip
            key={opt.id}
            content={opt.tooltip}
            position="top"
            align="center"
            className="w-full flex justify-center"
          >
            {buttonElement}
          </Tooltip>
        ) : (
          <React.Fragment key={opt.id}>{buttonElement}</React.Fragment>
        )
      })}
    </div>
  )
}

