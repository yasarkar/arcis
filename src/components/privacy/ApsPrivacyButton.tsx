import React from 'react';
import { ChevronRight } from 'lucide-react';

interface ApsPrivacyButtonProps {
  isPrivate: boolean;
  onToggle: () => void;
  size?: 'sm' | 'md' | 'lg';
  showLabel?: boolean;
  disabled?: boolean;
  className?: string;
}

export const ApsPrivacyButton: React.FC<ApsPrivacyButtonProps> = ({
  isPrivate,
  onToggle,
  size = 'md',
  showLabel = false,
  disabled = false,
  className = '',
}) => {
  // Dimensions per size
  const sizeMap = {
    sm: { box: 'w-9 h-9', icon: 'w-4 h-4', svg: 36, stroke: 2, radius: 15.5 },
    md: { box: 'w-11 h-11', icon: 'w-5 h-5', svg: 44, stroke: 2.2, radius: 19 },
    lg: { box: 'w-14 h-14', icon: 'w-6 h-6', svg: 56, stroke: 2.8, radius: 24.5 },
  };

  const currentSize = sizeMap[size] || sizeMap.md;
  const viewBox = `0 0 ${currentSize.svg} ${currentSize.svg}`;
  const center = currentSize.svg / 2;

  return (
    <div className={`inline-flex items-center gap-2.5 ${className}`}>
      <button
        type="button"
        onClick={onToggle}
        disabled={disabled}
        aria-label={isPrivate ? 'Disable APS Privacy' : 'Enable APS Privacy'}
        title={isPrivate ? 'APS Post-Quantum Encrypted (Click to unlock)' : 'EVM Transparent (Click to lock & encrypt)'}
        className={`group relative flex items-center justify-center ${currentSize.box} rounded-full transition-all duration-400 ease-in-out cursor-pointer outline-none select-none ${
          disabled ? 'opacity-50 cursor-not-allowed' : 'hover:scale-[1.08] active:scale-[0.95]'
        }`}
      >
        {/* Ambient Dark Background & Inner Glow (Active state only) */}
        <div
          className={`absolute inset-0 rounded-full transition-all duration-400 ease-in-out ${
            isPrivate
              ? 'bg-gradient-to-br from-[#1a1508]/90 via-[#2a1d06]/80 to-[#120e04]/90 border border-[#FFD700]/40 shadow-[0_0_18px_rgba(255,215,0,0.25)] backdrop-blur-md'
              : 'bg-transparent border-transparent shadow-none'
          }`}
        />

        {/* Idle State: Stemless ChevronRight > Icon with Hover Stream */}
        <div
          className={`absolute z-20 flex items-center justify-center pointer-events-none transition-all duration-400 ease-in-out ${
            isPrivate
              ? 'opacity-0 scale-50 -rotate-45'
              : 'opacity-100 scale-100 rotate-0 text-[#acc6e9]'
          }`}
        >
          {/* Default static chevron when NOT hovered */}
          <ChevronRight
            className={`${currentSize.icon} transition-all duration-300 group-hover:opacity-0 group-hover:scale-75`}
            strokeWidth={2.5}
          />

          {/* Streaming chevrons stream > > > when hovered */}
          <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-300 overflow-hidden w-full h-full">
            <ChevronRight
              className={`absolute ${currentSize.icon} text-[#acc6e9] aps-chevron-flow-1`}
              strokeWidth={2.5}
            />
            <ChevronRight
              className={`absolute ${currentSize.icon} text-[#acc6e9] aps-chevron-flow-2`}
              strokeWidth={2.5}
            />
            <ChevronRight
              className={`absolute ${currentSize.icon} text-[#acc6e9] aps-chevron-flow-3`}
              strokeWidth={2.5}
            />
          </div>
        </div>

        {/* SVG Container for Orbit and Morphing Lock */}
        <svg
          viewBox={viewBox}
          className="relative z-10 w-full h-full overflow-visible pointer-events-none"
        >
          <defs>
            {/* Gold Gradient for Orbit & Active Lock */}
            <linearGradient id="apsGoldGradient" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#FFD700" />
              <stop offset="50%" stopColor="#FFC107" />
              <stop offset="100%" stopColor="#FFA500" />
            </linearGradient>

            {/* Glowing Gold Filter */}
            <filter id="apsGoldGlowFilter" x="-30%" y="-30%" width="160%" height="160%">
              <feGaussianBlur stdDeviation="1.8" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>

          {/* 1. Golden Orbit (Altın Yörünge) Outer SVG Arc */}
          <g
            className={`transition-opacity duration-500 ease-in-out ${
              isPrivate ? 'opacity-100' : 'opacity-0'
            }`}
          >
            {/* Rotating Arc Group */}
            <circle
              cx={center}
              cy={center}
              r={currentSize.radius}
              fill="none"
              stroke="url(#apsGoldGradient)"
              strokeWidth={currentSize.stroke}
              strokeLinecap="round"
              strokeDasharray={`${currentSize.radius * 2.2} ${currentSize.radius * 1.8}`}
              filter="url(#apsGoldGlowFilter)"
              className="animate-aps-orbit"
              style={{ transformOrigin: `${center}px ${center}px` }}
            />
            {/* Secondary subtle counter-glow ring */}
            <circle
              cx={center}
              cy={center}
              r={currentSize.radius}
              fill="none"
              stroke="#FFD700"
              strokeWidth={currentSize.stroke * 0.4}
              strokeOpacity="0.4"
              strokeDasharray="4 8"
            />
          </g>

          {/* 2. Active State Morphing Lock: Body & Shackle */}
          <g
            className={`transition-all duration-400 ease-in-out ${
              isPrivate ? 'opacity-100 scale-100' : 'opacity-0 scale-75'
            }`}
            style={{ transformOrigin: `${center}px ${center}px` }}
          >
            {/* Lock Shackle (Üst Halka) - Slides down from above and locks */}
            <path
              d={`M ${center - 5} ${center} V ${center - 5} C ${center - 5} ${center - 8.5} ${center - 2.8} ${center - 11} ${center} ${center - 11} C ${center + 2.8} ${center - 11} ${center + 5} ${center - 8.5} ${center + 5} ${center - 5} V ${center}`}
              fill="none"
              stroke="url(#apsGoldGradient)"
              strokeWidth="2.2"
              strokeLinecap="round"
              style={{
                transition: 'transform 0.4s cubic-bezier(0.34, 1.56, 0.64, 1), opacity 0.35s ease-in-out',
                transform: isPrivate ? 'translateY(0px)' : 'translateY(-4px)',
              }}
              filter="url(#apsGoldGlowFilter)"
            />

            {/* Lock Base Body */}
            <rect
              x={center - 7}
              y={center - 1}
              width={14}
              height={11}
              rx={3}
              fill="url(#apsGoldGradient)"
              style={{
                filter: 'drop-shadow(0 0 6px rgba(255, 215, 0, 0.6))',
              }}
            />

            {/* Keyhole detail inside Lock Base */}
            <circle
              cx={center}
              cy={center + 3.2}
              r="1.3"
              fill="#120e04"
            />
            <rect
              x={center - 0.7}
              y={center + 3.2}
              width="1.4"
              height="2.3"
              rx="0.5"
              fill="#120e04"
            />
          </g>
        </svg>
      </button>

      {/* Optional Label */}
      {showLabel && (
        <div className="flex flex-col text-left select-none">
          <span
            className={`font-mono font-bold tracking-wider uppercase text-[11px] transition-colors duration-300 ${
              isPrivate ? 'text-[#FFD700]' : 'text-[#acc6e9]'
            }`}
            style={{ fontFamily: 'var(--fonts--space-mono)' }}
          >
            {isPrivate ? 'APS LOCKED' : 'APS IDLE'}
          </span>
          <span className="text-[10px] text-slate-400 font-sans leading-none mt-0.5">
            {isPrivate ? 'Encrypted' : 'Public'}
          </span>
        </div>
      )}
    </div>
  );
};

