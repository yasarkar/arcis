import React, { Component, type ReactNode } from 'react'
import { PinnedNetworkIcon } from './PinnedIcons'
import { getChainIconId } from '../../config/chainMeta'
import PhrsIcon from '../../assets/Token-Icon/PHRS Token.svg'

interface ChainIconErrorBoundaryProps {
  fallback: ReactNode
  children: ReactNode
}

interface ChainIconErrorBoundaryState {
  hasError: boolean
}

class ChainIconErrorBoundary extends Component<ChainIconErrorBoundaryProps, ChainIconErrorBoundaryState> {
  constructor(props: ChainIconErrorBoundaryProps) {
    super(props)
    this.state = { hasError: false }
  }

  static getDerivedStateFromError(): ChainIconErrorBoundaryState {
    return { hasError: true }
  }

  componentDidCatch(error: Error) {
    console.warn('[ChainIcon] Failed to render dynamic network icon, using fallback:', error)
  }

  render() {
    if (this.state.hasError) {
      return this.props.fallback
    }
    return this.props.children
  }
}

/**
 * Authentic Morph L2 Network Logo (Emerald folding geometric ribbon)
 */
export const MorphIcon: React.FC<{ size?: number; className?: string }> = ({ size = 22, className = '' }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    className={className}
    role="img"
    aria-label="Morph"
  >
    <rect width="24" height="24" rx="12" fill="url(#morph-gradient)" />
    <path
      d="M6.5 16.5V7.5L12 12.2L17.5 7.5V16.5H15.2V11L12 13.8L8.8 11V16.5H6.5Z"
      fill="#FFFFFF"
    />
    <defs>
      <linearGradient id="morph-gradient" x1="0" y1="0" x2="24" y2="24" gradientUnits="userSpaceOnUse">
        <stop stopColor="#38D68B" />
        <stop offset="1" stopColor="#059669" />
      </linearGradient>
    </defs>
  </svg>
)

/**
 * Authentic Pharos Network Logo (Using official PHRS Token / Network SVG)
 */
export const PharosIcon: React.FC<{ size?: number; className?: string }> = ({ size = 22, className = '' }) => (
  <img
    src={PhrsIcon}
    alt="Pharos"
    width={size}
    height={size}
    style={{ width: size, height: size, objectFit: 'contain' }}
    className={`rounded-full shrink-0 ${className}`}
    role="img"
    aria-label="Pharos"
  />
)

/**
 * Generic gradient fallback for any unknown or non-standard blockchain network.
 */
export const GenericChainFallbackIcon: React.FC<{ name?: string; size?: number; className?: string }> = ({
  name = 'Network',
  size = 22,
  className = '',
}) => {
  const clean = name.replace(/_Testnet|_Sepolia|Testnet|Network/gi, '').trim()
  const initials =
    clean
      .split(/[\s_-]+/)
      .filter(Boolean)
      .map((w) => w[0]?.toUpperCase())
      .slice(0, 2)
      .join('') || 'NW'

  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        background: 'linear-gradient(135deg, #6366f1 0%, #3b82f6 100%)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: Math.max(Math.floor(size * 0.38), 8),
        fontWeight: 700,
        color: '#FFFFFF',
        fontFamily: 'var(--font-app)',
        letterSpacing: '-0.3px',
        userSelect: 'none',
      }}
      className={className}
      role="img"
      aria-label={name}
    >
      {initials}
    </div>
  )
}

export interface ChainIconProps {
  chainKeyOrIconId: string
  name?: string
  size?: number
  className?: string
  variant?: 'branded' | 'mono' | 'background'
}

/**
 * Centralized, resilient Blockchain Network Icon Component.
 * Supports all Web3Icons, with first-class custom SVG support for Morph and Pharos,
 * and robust graceful fallback for unlisted networks.
 */
export const ChainIcon: React.FC<ChainIconProps> = ({
  chainKeyOrIconId,
  name,
  size = 22,
  className = 'rounded-full overflow-hidden',
  variant,
}) => {
  const normalized = (chainKeyOrIconId || '').toLowerCase().trim()

  // 1. Morph Network custom icon
  if (normalized.includes('morph')) {
    return <MorphIcon size={size} className={className} />
  }

  // 2. Pharos Network custom icon
  if (normalized.includes('pharos')) {
    return <PharosIcon size={size} className={className} />
  }

  // 3. Web3Icons resolution
  const iconId = getChainIconId(chainKeyOrIconId)
  if (iconId === 'morph') {
    return <MorphIcon size={size} className={className} />
  }
  if (iconId === 'pharos') {
    return <PharosIcon size={size} className={className} />
  }

  const effectiveVariant = variant || (iconId === 'solana' ? 'branded' : 'background')
  const fallbackElement = <GenericChainFallbackIcon name={name || chainKeyOrIconId} size={size} className={className} />

  return (
    <ChainIconErrorBoundary fallback={fallbackElement}>
      <PinnedNetworkIcon
        name={iconId}
        variant={effectiveVariant}
        size={size}
        className={className}
        fallback={fallbackElement}
      />
    </ChainIconErrorBoundary>
  )
}

export default ChainIcon
