import React from 'react';
import { Lock, Globe, ShieldCheck, Zap, Sparkles } from 'lucide-react';
import { ApsPrivacyButton } from './ApsPrivacyButton';

interface ApsPrivacyCardProps {
  isPrivate: boolean;
  onToggle: () => void;
  disabled?: boolean;
  title?: string;
  description?: string;
  privateLabel?: string;
  publicLabel?: string;
  className?: string;
  icon?: React.ReactNode;
}

export const ApsPrivacyCard: React.FC<ApsPrivacyCardProps> = ({
  isPrivate,
  onToggle,
  disabled = false,
  title = 'Opt-in Privacy',
  description,
  privateLabel = 'APS Post-Quantum Encrypted',
  publicLabel = 'Standard Transparent EVM Execution',
  className = '',
  icon,
}) => {
  return (
    <div
      className={`group relative overflow-hidden rounded-xl transition-all duration-300 ${
        isPrivate
          ? 'bg-gradient-to-br from-[#412c5c]/40 via-[#1b3158]/50 to-[#2f578c]/40 border border-[#8656ef]/50 shadow-[0_0_24px_rgba(134,86,239,0.18)]'
          : 'bg-gradient-to-br from-[#1b3158]/30 via-[#0f2b46]/40 to-[#2f578c]/30 border border-[#2f578c]/40 shadow-[0_0_16px_rgba(47,87,140,0.12)]'
      } backdrop-blur-xl ${className}`}
    >
      {/* Background Ambient Glow Orbs */}
      <div
        className={`absolute -top-10 -right-10 w-28 h-28 rounded-full blur-2xl pointer-events-none transition-all duration-500 ${
          isPrivate ? 'bg-[#8656ef]/30 opacity-100' : 'bg-[#2f578c]/15 opacity-60'
        }`}
      />
      <div
        className={`absolute -bottom-10 -left-10 w-28 h-28 rounded-full blur-2xl pointer-events-none transition-all duration-500 ${
          isPrivate ? 'bg-[#664c88]/30 opacity-100' : 'bg-[#acc6e9]/10 opacity-40'
        }`}
      />

      <div className="relative p-3.5 flex items-center justify-between gap-4">
        {/* Left Section: Icon & Descriptive Header */}
        <div className="flex items-center gap-3 min-w-0">
          {/* Badge Icon Container */}
          <div
            className={`relative flex items-center justify-center w-9 h-9 rounded-lg shrink-0 transition-all duration-300 ${
              isPrivate
                ? 'bg-gradient-to-br from-[#412c5c] to-[#664c88] border border-[#8656ef]/60 shadow-[0_0_12px_rgba(134,86,239,0.4)]'
                : 'bg-gradient-to-br from-[#1b3158] to-[#2f578c] border border-[#acc6e9]/30'
            }`}
          >
            {isPrivate ? (
              <Lock className="w-4 h-4 text-[#FFD700]" strokeWidth={2} />
            ) : (
              icon || <Globe className="w-4 h-4 text-[#acc6e9]" strokeWidth={2} />
            )}
          </div>

          {/* Title & Metadata */}
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span
                className="text-[11px] font-mono tracking-widest uppercase font-bold"
                style={{
                  fontFamily: 'var(--fonts--space-mono)',
                  color: isPrivate ? '#FFD700' : '#acc6e9',
                }}
              >
                {title}
              </span>
            </div>

            <p
              className="text-[11px] mt-0.5 truncate font-sans"
              style={{
                fontFamily: 'var(--fonts--dm-sans)',
                color: isPrivate ? 'rgba(255, 215, 0, 0.85)' : 'rgba(172, 198, 233, 0.75)',
              }}
            >
              {description || (isPrivate ? privateLabel : publicLabel)}
            </p>
          </div>
        </div>

        {/* Right Section: Interactive APS Privacy Orbit Button */}
        <div className="flex items-center shrink-0">
          <ApsPrivacyButton
            isPrivate={isPrivate}
            onToggle={onToggle}
            disabled={disabled}
            size="md"
          />
        </div>
      </div>
    </div>
  );
};