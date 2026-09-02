import React from 'react';
import { Globe, Lock, Shield, Zap, Info } from 'lucide-react';
import { PrivacyLevel } from '../../types/privacy';
import { usePrivacy } from '../../hooks/usePrivacy';
import { ApsPrivacyButton } from './ApsPrivacyButton';

interface PrivacyToggleProps {
  compact?: boolean;
  className?: string;
  showDetails?: boolean;
}

export const PrivacyToggle: React.FC<PrivacyToggleProps> = ({
  compact = false,
  className = '',
  showDetails = false,
}) => {
  const { level, setPrivacyLevel } = usePrivacy();

  const options: {
    level: PrivacyLevel;
    label: string;
    subLabel: string;
    icon: React.ReactNode;
    description: string;
    accentColor: string;
    badgeBg: string;
    activeBorder: string;
  }[] = [
    {
      level: 'public',
      label: 'Public',
      subLabel: 'EVM Standard',
      icon: <Globe className="w-3.5 h-3.5" />,
      description: 'All balances and transaction histories are visible on the chain.',
      accentColor: 'text-[#acc6e9]',
      badgeBg: 'bg-[#2f578c]/30 text-[#acc6e9] border-[#2f578c]/50',
      activeBorder: 'border-[#acc6e9]/40 shadow-[0_0_12px_rgba(47,87,140,0.3)]',
    },
    {
      level: 'private',
      label: 'Private',
      subLabel: 'APS Encrypted',
      icon: <Lock className="w-3.5 h-3.5" />,
      description: 'All balances and transaction histories are hidden with APS post-quantum encryption.',
      accentColor: 'text-[#FFD700]',
      badgeBg: 'bg-[#412c5c]/60 text-[#FFD700] border-[#FFD700]/40',
      activeBorder: 'border-[#FFD700]/50 shadow-[0_0_16px_rgba(255,215,0,0.25)]',
    },
    {
      level: 'selective',
      label: 'Selective',
      subLabel: 'Custom Scope',
      icon: <Shield className="w-3.5 h-3.5" />,
      description: 'Only the balances of the special chains you specify are masked.',
      accentColor: 'text-amber-300',
      badgeBg: 'bg-amber-950/40 text-amber-400 border-amber-500/30',
      activeBorder: 'border-amber-500/40 shadow-[0_0_12px_rgba(245,158,11,0.2)]',
    },
  ];

  const activeOption = options.find((o) => o.level === level) || options[0];
  const isPrivateActive = level === 'private';

  if (compact) {
    return (
      <div
        className={`relative inline-flex items-center p-1 rounded-xl bg-[#0b101d]/90 border border-[#2f578c]/40 backdrop-blur-xl shadow-lg gap-2 ${className}`}
      >
        <ApsPrivacyButton
          isPrivate={isPrivateActive}
          onToggle={() => setPrivacyLevel(isPrivateActive ? 'public' : 'private')}
          size="sm"
        />
        <div className="flex items-center gap-1">
          {options.map((opt) => {
            const active = level === opt.level;
            return (
              <button
                key={opt.level}
                type="button"
                onClick={() => setPrivacyLevel(opt.level)}
                title={`${opt.label} (${opt.subLabel}): ${opt.description}`}
                className={`relative z-10 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-mono transition-all duration-200 cursor-pointer ${
                  active
                    ? 'bg-gradient-to-r from-[#1b3158] to-[#2f578c] text-white font-semibold shadow-md border border-[#acc6e9]/40'
                    : 'text-slate-400 hover:text-white hover:bg-white/5'
                }`}
                style={{ fontFamily: 'var(--fonts--space-mono)' }}
              >
                <span className={active ? 'text-[#acc6e9]' : 'text-slate-400'}>{opt.icon}</span>
                <span className="uppercase text-[11px] tracking-wider">{opt.label}</span>
                {active && (
                  <span className="w-1.5 h-1.5 rounded-full bg-[#acc6e9] shadow-[0_0_6px_#acc6e9] animate-pulse" />
                )}
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div
      className={`relative overflow-hidden rounded-2xl bg-gradient-to-br from-[#1b3158]/80 via-[#0f2b46]/90 to-[#1b3158]/80 border border-[#2f578c]/40 p-4 shadow-2xl backdrop-blur-xl transition-all ${className}`}
    >
      {/* Decorative background glow */}
      <div className="absolute top-0 right-0 w-32 h-32 bg-[#8656ef]/10 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute bottom-0 left-0 w-32 h-32 bg-[#2f578c]/10 rounded-full blur-3xl pointer-events-none" />

      {/* Control Panel Header with Golden Orbit Privacy Button */}
      <div className="flex items-center justify-between mb-3 pb-2.5 border-b border-[#2f578c]/30">
        <div className="flex items-center gap-2">
          <span className="flex items-center justify-center w-6 h-6 rounded-md bg-[#2f578c]/30 border border-[#acc6e9]/30 text-[#acc6e9]">
            <Zap className="w-3.5 h-3.5" />
          </span>
          <span
            className="text-xs font-mono tracking-widest text-[#acc6e9] uppercase font-bold"
            style={{ fontFamily: 'var(--fonts--space-mono)' }}
          >
            APS OPT-IN PRIVACY
          </span>
        </div>

        <ApsPrivacyButton
          isPrivate={isPrivateActive}
          onToggle={() => setPrivacyLevel(isPrivateActive ? 'public' : 'private')}
          size="sm"
        />
      </div>


      {/* Segmented Switch Buttons */}
      <div className="grid grid-cols-3 gap-2 p-1.5 rounded-xl bg-[#0b101d]/90 border border-[#2f578c]/30">
        {options.map((opt) => {
          const active = level === opt.level;
          return (
            <button
              key={opt.level}
              type="button"
              title={opt.description}
              onClick={() => setPrivacyLevel(opt.level)}
              className={`relative flex flex-col items-center justify-center p-2.5 rounded-lg transition-all duration-200 cursor-pointer ${
                active
                  ? `bg-gradient-to-br from-[#1b3158] to-[#2f578c] text-white shadow-lg border ${opt.activeBorder}`
                  : 'text-slate-400 hover:text-white hover:bg-white/5 border border-transparent'
              }`}
            >
              <div className="flex items-center gap-1.5 mb-1">
                <span className={active ? opt.accentColor : 'text-slate-400'}>{opt.icon}</span>
                <span
                  className="text-xs font-bold uppercase tracking-wider"
                  style={{ fontFamily: 'var(--fonts--space-mono)' }}
                >
                  {opt.label}
                </span>
              </div>
              <span
                className="text-[9px] font-mono text-slate-400 opacity-80"
                style={{ fontFamily: 'var(--fonts--space-mono)' }}
              >
                {opt.subLabel}
              </span>
            </button>
          );
        })}
      </div>

      {/* Active Mode Details Footer */}
      {showDetails && (
        <div className="mt-3 p-2.5 rounded-lg bg-[#0b101d]/60 border border-[#2f578c]/20 flex items-start gap-2 text-xs font-mono">
          <Info className="w-3.5 h-3.5 text-[#acc6e9] shrink-0 mt-0.5" />
          <p className="text-[11px] text-slate-300 font-sans leading-tight">
            {activeOption.description}
          </p>
        </div>
      )}
    </div>
  );
};
