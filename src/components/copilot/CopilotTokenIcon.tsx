// src/components/copilot/CopilotTokenIcon.tsx
// Unified token and network icon components for Arcis Copilot.
// Aligned with the canonical TOKEN_ICON_MAP and ChainIcon resolvers.
import React from 'react'
import { ChainIcon } from '../common/ChainIcon'
import ArcLogo from '../../assets/Arc-Icon.svg'
import { getChainIconId } from '../../config/chainMeta'
import { TOKEN_ICON_MAP, UsdcIcon } from '../../config/tokenIcons'

interface TokenIconProps {
  symbol?: string
  className?: string
}

/**
 * Resolves token SVG icons for Copilot inline confirm cards and previews.
 * Resolves exact matches and aliases through TOKEN_ICON_MAP, with special
 * handling for vault shares (e.g. af-USDC with yield badge).
 */
export function resolveCopilotTokenIconSrc(symbol?: string): string | undefined {
  if (!symbol) return TOKEN_ICON_MAP.USDC

  const clean = symbol.trim()
  const upper = clean.toUpperCase()

  // 1. Arc Testnet Bitcoin priority: ensure cirBTC / BTC / WBTC map directly to cirBTC icon
  if (upper === 'CIRBTC' || upper === 'BTC' || upper === 'WBTC') {
    return TOKEN_ICON_MAP.cirBTC
  }

  // 2. Exact match in TOKEN_ICON_MAP
  if (TOKEN_ICON_MAP[clean]) return TOKEN_ICON_MAP[clean]
  if (TOKEN_ICON_MAP[upper]) return TOKEN_ICON_MAP[upper]

  // 3. Case-insensitive lookup
  const lower = clean.toLowerCase()
  const foundKey = Object.keys(TOKEN_ICON_MAP).find((k) => k.toLowerCase() === lower)
  if (foundKey) return TOKEN_ICON_MAP[foundKey]

  return undefined
}

export function CopilotTokenIcon({ symbol = 'USDC', className = 'w-4 h-4' }: TokenIconProps) {
  const sym = (symbol || 'USDC').trim()
  const upper = sym.toUpperCase()

  // Special vault share styling: af-USDC renders USDC logo with an emerald yield dot
  if (upper === 'AF-USDC' || upper === 'AFUSDC') {
    return (
      <div className="relative inline-flex items-center justify-center">
        <img src={UsdcIcon} alt="af-USDC" className={`${className} object-contain inline-block`} />
        <span className="absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full bg-emerald-500 border border-slate-900" />
      </div>
    )
  }

  const iconSrc = resolveCopilotTokenIconSrc(sym)

  if (iconSrc) {
    return (
      <img
        src={iconSrc}
        alt={sym}
        className={`${className} object-contain inline-block`}
      />
    )
  }

  // Graceful fallback circle with symbol initial
  return (
    <div
      className={`${className} rounded-full bg-[#161926] border border-white/[0.08] inline-flex items-center justify-center text-[9px] font-bold text-indigo-200 select-none`}
    >
      {sym.slice(0, 1).toUpperCase() || '?'}
    </div>
  )
}

interface NetworkBadgeProps {
  chainName: string
  className?: string
  iconOnly?: boolean
}

export function CopilotNetworkBadge({ chainName, className = '', iconOnly = false }: NetworkBadgeProps) {
  const iconId = getChainIconId(chainName)
  const isArc = chainName.toLowerCase().includes('arc')
  const effectiveChain = iconId || chainName

  if (iconOnly) {
    if (isArc) {
      return <img src={ArcLogo} alt="Arc" className="w-5 h-5 object-contain inline-block" />
    }
    return (
      <span className="w-5 h-5 rounded-full overflow-hidden inline-flex items-center justify-center bg-slate-900">
        <ChainIcon chainKeyOrIconId={effectiveChain} size={20} className="w-5 h-5 rounded-full" />
      </span>
    )
  }

  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-lg bg-slate-900/90 text-sm font-semibold text-slate-200 select-text ${className}`}
    >
      {isArc ? (
        <img src={ArcLogo} alt="Arc" className="w-5 h-5 object-contain" />
      ) : (
        <ChainIcon chainKeyOrIconId={effectiveChain} size={20} className="w-5 h-5 rounded-full" />
      )}
      <span className="select-text">{chainName}</span>
    </span>
  )
}
