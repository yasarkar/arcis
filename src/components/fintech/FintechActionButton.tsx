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
      className={`w-full py-4 px-6 rounded-full font-semibold text-sm sm:text-base tracking-wide transition-all duration-200 flex items-center justify-center gap-2 select-none ${
        isActionable
          ? 'text-white shadow-lg shadow-purple-500/25 hover:shadow-purple-500/35 hover:scale-[1.01] hover:brightness-110 active:scale-[0.98] cursor-pointer'
          : 'bg-white/[0.04] text-slate-500 border border-white/[0.06] cursor-not-allowed opacity-80'
      } ${className}`}
      style={{
        fontFamily: 'var(--font-app)',
        ...(isActionable
          ? {
              background: 'linear-gradient(135deg, #9896ff 0%, #7c3aed 100%)',
              boxShadow: '0 6px 24px rgba(152, 150, 255, 0.3)',
            }
          : {}),
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
