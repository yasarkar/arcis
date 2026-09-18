import React, { useState } from 'react';
import { Lock, Unlock, ShieldCheck } from 'lucide-react';

interface PrivacyLockButtonProps {
  isPrivate: boolean;
  onToggle: () => void;
  disabled?: boolean;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
  tooltipPosition?: 'top' | 'bottom' | 'left' | 'right';
}

export const PrivacyLockButton: React.FC<PrivacyLockButtonProps> = ({
  isPrivate,
  onToggle,
  disabled = false,
  size = 'md',
  className = '',
  tooltipPosition = 'bottom',
}) => {
  const [showTooltip, setShowTooltip] = useState(false);

  const sizeClasses = {
    sm: 'w-7 h-7 rounded-full',
    md: 'w-8 h-8 rounded-full',
    lg: 'w-9 h-9 rounded-full',
  };

  const iconSizes = {
    sm: 14,
    md: 16,
    lg: 18,
  };

  const tooltipPosClasses = {
    top: 'bottom-full mb-2 left-1/2 -translate-x-1/2',
    bottom: 'top-full mt-2 right-0',
    left: 'right-full mr-2 top-1/2 -translate-y-1/2',
    right: 'left-full ml-2 top-1/2 -translate-y-1/2',
  };

  const tooltipArrowClasses = {
    top: 'top-full left-1/2 -translate-x-1/2 border-t-[#0c0f1e]',
    bottom: 'bottom-full right-3 border-b-[#0c0f1e]',
    left: 'left-full top-1/2 -translate-y-1/2 border-l-[#0c0f1e]',
    right: 'right-full top-1/2 -translate-y-1/2 border-r-[#0c0f1e]',
  };

  return (
    <div
      className={`relative inline-flex items-center select-none ${showTooltip ? 'z-[9999999]' : 'z-20'} ${className}`}
      onMouseEnter={() => setShowTooltip(true)}
      onMouseLeave={() => setShowTooltip(false)}
    >
      <button
        type="button"
        disabled={disabled}
        onClick={onToggle}
        aria-label={isPrivate ? 'Privacy Masking Active (Click to disable)' : 'Privacy Masking Off (Click to enable)'}
        className={`group relative flex items-center justify-center transition-all duration-200 cursor-pointer outline-none ${
          sizeClasses[size]
        } ${
          disabled ? 'opacity-40 cursor-not-allowed' : 'active:scale-95 hover:scale-105'
        } ${
          isPrivate
            ? 'text-white bg-[rgba(152,150,255,0.2)] border border-[rgba(152,150,255,0.45)] shadow-[0_0_14px_rgba(152,150,255,0.3)]'
            : 'text-slate-400 hover:text-white bg-white/[0.04] hover:bg-white/[0.1] border border-white/[0.06] hover:border-white/[0.15]'
        }`}
      >
        {/* Subtle glow orb behind icon when active */}
        {isPrivate && (
          <span className="absolute inset-0 rounded-full bg-[#8656ef]/20 blur-md pointer-events-none animate-pulse" />
        )}

        {/* Lock / Unlock Icon with micro-transition */}
        <div className="relative z-10 transition-transform duration-200 group-hover:scale-110">
          {isPrivate ? (
            <Lock
              size={iconSizes[size]}
              className="text-[#c4b5fd] transition-colors"
              strokeWidth={2.2}
            />
          ) : (
            <Unlock
              size={iconSizes[size]}
              className="text-slate-400 group-hover:text-slate-200 transition-colors"
              strokeWidth={2}
            />
          )}
        </div>
      </button>

      {/* Floating Micro Tooltip matching Swap/Bridge Breakdown */}
      {showTooltip && (
        <div
          role="tooltip"
          style={{ zIndex: 9999999 }}
          className={`absolute z-[9999999] pointer-events-none px-3 py-2 rounded-xl text-[12px] font-normal text-slate-100 bg-[#0c0f1e]/95 backdrop-blur-md border border-white/10 shadow-[0_8px_32px_rgba(0,0,0,0.6)] leading-snug whitespace-nowrap select-none animate-fade-in ${
            tooltipPosClasses[tooltipPosition]
          }`}
        >
          <div className="flex items-center gap-1.5 font-medium">
            {isPrivate ? (
              <>
                <ShieldCheck className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
                <span className="text-slate-200">APS Encrypted Transfer</span>
              </>
            ) : (
              <>
                <Unlock className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                <span className="text-slate-300">Public Transfer</span>
              </>
            )}
          </div>
          <span
            style={{ zIndex: 10000000 }}
            className={`absolute border-4 border-transparent pointer-events-none ${tooltipArrowClasses[tooltipPosition]}`}
          />
        </div>
      )}
    </div>
  );
};
