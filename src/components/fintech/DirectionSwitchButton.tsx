import React from 'react'
import { ArrowUpDown, ArrowRightLeft } from 'lucide-react'

export interface DirectionSwitchButtonProps {
  onClick: () => void
  disabled?: boolean
  className?: string
  title?: string
  orientation?: 'vertical' | 'horizontal'
  showDividingLine?: boolean
}

export const DirectionSwitchButton: React.FC<DirectionSwitchButtonProps> = ({
  onClick,
  disabled = false,
  className = '',
  title = 'Switch direction',
  orientation = 'vertical',
  showDividingLine = orientation === 'vertical',
}) => {
  return (
    <div className={`relative flex items-center justify-center my-1 z-10 ${className}`}>
      {/* Subtle dividing line across the gap */}
      {showDividingLine && (
        <div className="absolute inset-0 flex items-center" aria-hidden="true">
          <div className="w-full border-white/[0.06]" />
        </div>
      )}

      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        title={title}
        className="relative z-10 w-10 h-10 rounded-full flex items-center justify-center bg-[#0e111f] border border-white/10 hover:border-indigo-500/50 hover:bg-[#15192c] text-slate-300 hover:text-white shadow-lg hover:shadow-indigo-500/20 hover:scale-105 active:scale-95 transition-all duration-200 cursor-pointer group disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {orientation === 'horizontal' ? (
          <ArrowRightLeft className="w-4.5 h-4.5 text-slate-400 group-hover:text-indigo-300 transition-transform duration-300 group-hover:rotate-180" />
        ) : (
          <ArrowUpDown className="w-4.5 h-4.5 text-slate-400 group-hover:text-indigo-300 transition-transform duration-300 group-hover:rotate-180" />
        )}
      </button>
    </div>
  )
}
