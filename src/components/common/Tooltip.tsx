import React from 'react'
import { Info } from 'lucide-react'

export type TooltipPosition = 'top' | 'bottom' | 'left' | 'right'
export type TooltipAlign = 'start' | 'center' | 'end'

export interface TooltipProps {
  content: React.ReactNode
  children: React.ReactNode
  position?: TooltipPosition
  align?: TooltipAlign
  maxWidth?: number | string
  showArrow?: boolean
  disabled?: boolean
  className?: string
  contentClassName?: string
}

export const Tooltip: React.FC<TooltipProps> = ({
  content,
  children,
  position = 'top',
  align = 'center',
  maxWidth = 260,
  showArrow = true,
  disabled = false,
  className = '',
  contentClassName = '',
}) => {
  if (disabled || !content) {
    return <>{children}</>
  }

  // Positioning logic
  let positionClasses = ''
  let arrowClasses = ''

  if (position === 'top') {
    if (align === 'start') {
      positionClasses = 'bottom-full mb-2 left-0'
      arrowClasses = 'top-full left-3 border-t-[#0c0f1e]'
    } else if (align === 'end') {
      positionClasses = 'bottom-full mb-2 right-0'
      arrowClasses = 'top-full right-3 border-t-[#0c0f1e]'
    } else {
      positionClasses = 'bottom-full mb-2 left-1/2 -translate-x-1/2'
      arrowClasses = 'top-full left-1/2 -translate-x-1/2 border-t-[#0c0f1e]'
    }
  } else if (position === 'bottom') {
    if (align === 'start') {
      positionClasses = 'top-full mt-2 left-0'
      arrowClasses = 'bottom-full left-3 border-b-[#0c0f1e]'
    } else if (align === 'end') {
      positionClasses = 'top-full mt-2 right-0'
      arrowClasses = 'bottom-full right-3 border-b-[#0c0f1e]'
    } else {
      positionClasses = 'top-full mt-2 left-1/2 -translate-x-1/2'
      arrowClasses = 'bottom-full left-1/2 -translate-x-1/2 border-b-[#0c0f1e]'
    }
  } else if (position === 'left') {
    positionClasses = 'right-full mr-2 top-1/2 -translate-y-1/2'
    arrowClasses = 'left-full top-1/2 -translate-y-1/2 border-l-[#0c0f1e]'
  } else if (position === 'right') {
    positionClasses = 'left-full ml-2 top-1/2 -translate-y-1/2'
    arrowClasses = 'right-full top-1/2 -translate-y-1/2 border-r-[#0c0f1e]'
  }

  const maxWidthStyle = typeof maxWidth === 'number' ? `${maxWidth}px` : maxWidth

  return (
    <div
      className={`relative group/tooltip inline-flex items-center hover:z-[9999999] group-hover/tooltip:z-[9999999] ${className}`}
      style={{ isolation: 'auto' }}
    >
      {children}

      {/* Floating Micro Tooltip Popover matching Swap/Bridge Breakdown Design */}
      <div
        role="tooltip"
        style={{ maxWidth: maxWidthStyle, zIndex: 9999999 }}
        className={`absolute z-[9999999] pointer-events-none hidden group-hover/tooltip:flex flex-col px-3 py-2 rounded-xl text-[12px] font-normal text-slate-100 bg-[#0c0f1e]/95 backdrop-blur-md border border-white/10 shadow-[0_8px_32px_rgba(0,0,0,0.6)] w-max leading-snug select-none animate-fade-in ${positionClasses} ${contentClassName}`}
      >
        {content}

        {showArrow && (
          <span
            style={{ zIndex: 10000000 }}
            className={`absolute border-4 border-transparent pointer-events-none ${arrowClasses}`}
          />
        )}
      </div>
    </div>
  )
}

export interface InfoTooltipProps {
  content: React.ReactNode
  position?: TooltipPosition
  align?: TooltipAlign
  size?: number
  maxWidth?: number | string
  className?: string
  iconClassName?: string
}

export const InfoTooltip: React.FC<InfoTooltipProps> = ({
  content,
  position = 'top',
  align = 'start',
  size = 14,
  maxWidth = 260,
  className = '',
  iconClassName = '',
}) => {
  return (
    <Tooltip
      content={content}
      position={position}
      align={align}
      maxWidth={maxWidth}
      className={`shrink-0 ${className}`}
    >
      <Info
        size={size}
        className={
          iconClassName ||
          'w-3.5 h-3.5 text-slate-400 hover:text-indigo-300 cursor-help transition-colors'
        }
      />
    </Tooltip>
  )
}

export default Tooltip
