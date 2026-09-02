import React from 'react';
import { Globe, Lock, Shield } from 'lucide-react';
import { PrivacyLevel } from '../../types/privacy';

interface PrivacyBadgeProps {
  level?: PrivacyLevel;
  isPrivate?: boolean;
  className?: string;
  showText?: boolean;
}

export const PrivacyBadge: React.FC<PrivacyBadgeProps> = ({
  level,
  isPrivate,
  className = '',
  showText = true,
}) => {
  const currentLevel = isPrivate !== undefined ? (isPrivate ? 'private' : 'public') : level || 'public';

  const badgeConfig = {
    public: {
      bg: 'bg-[#1b3158]/50',
      text: 'text-[#acc6e9]',
      border: 'border-[#2f578c]/40 shadow-[0_0_8px_rgba(47,87,140,0.15)]',
      icon: <Globe className="w-3 h-3" />,
      label: 'Public EVM',
    },
    private: {
      bg: 'bg-[#412c5c]/70',
      text: 'text-[#ccb6fc]',
      border: 'border-[#8656ef]/50 shadow-[0_0_10px_rgba(134,86,239,0.25)]',
      icon: <Lock className="w-3 h-3" />,
      label: 'APS Encrypted',
    },
    selective: {
      bg: 'bg-amber-950/40',
      text: 'text-amber-300',
      border: 'border-amber-500/30 shadow-[0_0_8px_rgba(245,158,11,0.15)]',
      icon: <Shield className="w-3 h-3" />,
      label: 'Selective Privacy',
    },
  };

  const config = badgeConfig[currentLevel];

  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-mono border backdrop-blur-md transition-all ${config.bg} ${config.text} ${config.border} ${className}`}
      style={{ fontFamily: 'var(--fonts--space-mono)' }}
      title={`Privacy Mode: ${config.label}`}
    >
      <span className="shrink-0">{config.icon}</span>
      {showText && <span className="uppercase text-[10px] tracking-wider font-semibold">{config.label}</span>}
    </span>
  );
};
