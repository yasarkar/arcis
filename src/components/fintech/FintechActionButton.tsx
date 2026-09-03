import React from 'react'
import { RefreshCw } from 'lucide-react'

interface FintechActionButtonProps {
  children: React.ReactNode
  onClick?: (e: React.MouseEvent<HTMLButtonElement>) => void
  type?: 'button' | 'submit'
  disabled?: boolean
  loading?: boolean
  loadingText?: string
  icon?: React.ReactNode
  className?: string
  style?: React.CSSProperties
}

export const FintechActionButton: React.FC<FintechActionButtonProps> = ({
  children,
  onClick,
  type = 'submit',
  disabled = false,
  loading = false,
  loadingText,
  icon,
  className = '',
  style,
}) => {
  const isActionable = !disabled && !loading

  return (
    <button
      type={type}
      onClick={onClick}
      disabled={!isActionable}
      className={`w-full py-4 px-6 rounded-2xl font-semibold text-sm sm:text-base tracking-wide transition-all duration-200 flex items-center justify-center gap-2 select-none ${
        isActionable
          ? 'bg-gradient-to-r from-indigo-500 via-indigo-600 to-purple-600 hover:from-indigo-400 hover:via-indigo-500 hover:to-purple-500 text-white shadow-lg shadow-indigo-500/25 active:scale-[0.99] cursor-pointer'
          : 'bg-white/[0.04] text-slate-500 border border-white/[0.06] cursor-not-allowed opacity-80'
      } ${className}`}
      style={{
        fontFamily: 'var(--font-app)',
        ...style,
      }}
    >
      {loading ? (
        <>
          <RefreshCw className="w-4 h-4 animate-spin text-white" />
          <span>{loadingText || 'PROCESSING...'}</span>
        </>
      ) : (
        <>
          {icon}
          <span>{children}</span>
        </>
      )}
    </button>
  )
}
