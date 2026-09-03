import React from 'react'

interface FintechCardProps {
  title: string
  icon?: React.ReactNode
  subtitle?: string
  pill?: React.ReactNode
  headerActions?: React.ReactNode
  children: React.ReactNode
  isInline?: boolean
  maxWidth?: number | string
  minHeight?: number | string
  className?: string
}

export const FintechCard: React.FC<FintechCardProps> = ({
  title,
  icon,
  subtitle,
  pill,
  headerActions,
  children,
  isInline = false,
  maxWidth = 580,
  minHeight,
  className = '',
}) => {
  const effectiveMaxWidth = typeof maxWidth === 'number' ? `${maxWidth}px` : maxWidth
  const effectiveMinHeight = minHeight
    ? typeof minHeight === 'number'
      ? `${minHeight}px`
      : minHeight
    : isInline
    ? '620px'
    : undefined

  return (
    <div
      className={`relative w-full arc-animate-reveal flex flex-col justify-between transition-all duration-300 ${
        isInline ? '' : 'overflow-y-auto max-h-[92vh]'
      } ${className}`}
      style={{
        maxWidth: effectiveMaxWidth,
        minHeight: effectiveMinHeight,
        margin: isInline ? '0 auto' : undefined,
        padding: isInline ? '32px 36px 36px 36px' : '28px 28px 32px 28px',
        borderRadius: '32px',
        background: 'linear-gradient(180deg, rgba(14, 17, 30, 0.96) 0%, rgba(10, 12, 22, 0.98) 100%)',
        backdropFilter: 'blur(24px)',
        WebkitBackdropFilter: 'blur(24px)',
        border: '1px solid rgba(255, 255, 255, 0.08)',
        boxShadow: isInline
          ? '0 0 0 1px rgba(255, 255, 255, 0.05), 0 28px 56px -12px rgba(0, 0, 0, 0.7)'
          : '0 0 0 1px rgba(255, 255, 255, 0.08), 0 36px 72px -12px rgba(0, 0, 0, 0.85)',
      }}
    >
      {/* Subtle top ambient glow */}
      <div
        className="pointer-events-none absolute -top-24 left-1/2 -translate-x-1/2 w-64 h-32 rounded-full blur-3xl opacity-30"
        style={{
          background: 'radial-gradient(ellipse at center, rgba(99, 102, 241, 0.45) 0%, rgba(168, 85, 247, 0.15) 70%, transparent 100%)',
        }}
      />

      {/* Card Header */}
      <div className="relative z-30 flex items-center justify-between pb-4 mb-4 border-b border-white/[0.06]">
        <div className="flex items-center gap-2.5">
          {icon && (
            <div className="w-8 h-8 rounded-xl flex items-center justify-center bg-white/[0.04] border border-white/[0.08] text-[var(--purple-1)] shadow-inner">
              {icon}
            </div>
          )}
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-base font-semibold tracking-wide text-white" style={{ fontFamily: 'var(--font-app)' }}>
                {title}
              </h2>
              {pill}
            </div>
            {subtitle && (
              <p className="text-[11px] text-slate-400 font-normal leading-tight mt-0.5">
                {subtitle}
              </p>
            )}
          </div>
        </div>

        {headerActions && (
          <div className="flex items-center gap-1.5">
            {headerActions}
          </div>
        )}
      </div>

      {/* Card Body */}
      <div className="relative z-10 flex-1 flex flex-col">
        {children}
      </div>
    </div>
  )
}
