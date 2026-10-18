// src/components/common/PinnedIcons.tsx
//
// Pinned replacements for `@web3icons/react/dynamic` (TokenIcon/NetworkIcon).
//
// The dynamic entry resolves icons through a variable `import()`, which Vite
// cannot tree-shake: it emitted one chunk per catalog icon (~1,834 Token
// chunks + index ≈ 4.07 MB gzip, over half the production JS budget). Every
// symbol the app can actually render is enumerable (token lists, pool configs,
// chain registry), so each is imported statically here and anything else
// falls back to a letter avatar — the same fallback the dynamic components
// already rendered for unknown symbols.
//
// Rule for new icons: pin the symbol below (static import), never reintroduce
// the dynamic entry.

import React from 'react'
import TokenETH from '@web3icons/react/icons/tokens/TokenETH'
import TokenPOL from '@web3icons/react/icons/tokens/TokenPOL'
import TokenMATIC from '@web3icons/react/icons/tokens/TokenMATIC'
import TokenAVAX from '@web3icons/react/icons/tokens/TokenAVAX'
import TokenSOL from '@web3icons/react/icons/tokens/TokenSOL'
import TokenSEI from '@web3icons/react/icons/tokens/TokenSEI'
import TokenXPL from '@web3icons/react/icons/tokens/TokenXPL'
import TokenOKB from '@web3icons/react/icons/tokens/TokenOKB'
import NetworkSolana from '@web3icons/react/icons/networks/NetworkSolana'
import NetworkInjective from '@web3icons/react/icons/networks/NetworkInjective'
import NetworkSonic from '@web3icons/react/icons/networks/NetworkSonic'
import NetworkEthereum from '@web3icons/react/icons/networks/NetworkEthereum'
import NetworkBase from '@web3icons/react/icons/networks/NetworkBase'
import NetworkMonad from '@web3icons/react/icons/networks/NetworkMonad'
import NetworkArbitrumOne from '@web3icons/react/icons/networks/NetworkArbitrumOne'
import NetworkOptimism from '@web3icons/react/icons/networks/NetworkOptimism'
import NetworkHyperEvm from '@web3icons/react/icons/networks/NetworkHyperEvm'
import NetworkPolygon from '@web3icons/react/icons/networks/NetworkPolygon'
import NetworkAvalanche from '@web3icons/react/icons/networks/NetworkAvalanche'
import NetworkSeiNetwork from '@web3icons/react/icons/networks/NetworkSeiNetwork'
import NetworkUnichain from '@web3icons/react/icons/networks/NetworkUnichain'
import NetworkWorld from '@web3icons/react/icons/networks/NetworkWorld'
import NetworkInk from '@web3icons/react/icons/networks/NetworkInk'
import NetworkLinea from '@web3icons/react/icons/networks/NetworkLinea'
import NetworkLineaSepolia from '@web3icons/react/icons/networks/NetworkLineaSepolia'
import NetworkPlume from '@web3icons/react/icons/networks/NetworkPlume'
import NetworkXdc from '@web3icons/react/icons/networks/NetworkXdc'
import NetworkCronos from '@web3icons/react/icons/networks/NetworkCronos'
import NetworkCodex from '@web3icons/react/icons/networks/NetworkCodex'
import NetworkEdgeless from '@web3icons/react/icons/networks/NetworkEdgeless'
import NetworkPlasma from '@web3icons/react/icons/networks/NetworkPlasma'
import NetworkXLayer from '@web3icons/react/icons/networks/NetworkXLayer'
import NetworkArc from '@web3icons/react/icons/networks/NetworkArc'
import NetworkBaseSepolia from '@web3icons/react/icons/networks/NetworkBaseSepolia'
import NetworkArbitrumSepolia from '@web3icons/react/icons/networks/NetworkArbitrumSepolia'
import NetworkOptimismSepolia from '@web3icons/react/icons/networks/NetworkOptimismSepolia'
import NetworkPolygonAmoy from '@web3icons/react/icons/networks/NetworkPolygonAmoy'
import NetworkAvalancheFuji from '@web3icons/react/icons/networks/NetworkAvalancheFuji'
import NetworkMonadTestnet from '@web3icons/react/icons/networks/NetworkMonadTestnet'
import { TOKEN_ICON_MAP } from '../../config/tokenIcons'
import { GenericChainFallbackIcon } from './ChainIcon'

type IconVariant = 'branded' | 'mono' | 'background'

export interface PinnedTokenIconProps {
  symbol: string
  variant?: IconVariant
  size?: number | string
  className?: string
  /** Rendered when the symbol is not pinned (defaults to a letter avatar). */
  fallback?: React.ReactNode
}

export interface PinnedNetworkIconProps {
  name: string
  variant?: IconVariant
  size?: number | string
  className?: string
  /** Rendered when the network id is not pinned. */
  fallback?: React.ReactNode
}

function LetterAvatar({ label, size = 24, className = '' }: { label: string; size?: number | string; className?: string }) {
  const initial = (label.trim().charAt(0) || '?').toUpperCase()
  const numericSize = typeof size === 'number' ? size : Number(size) || 24
  return (
    <span
      aria-label={label}
      role="img"
      className={`rounded-full bg-slate-800 border border-slate-700 inline-flex items-center justify-center font-bold text-cyan-300 select-none shrink-0 ${className}`}
      style={{ width: size, height: size, fontSize: Math.max(Math.floor(numericSize * 0.42), 8) }}
    >
      {initial}
    </span>
  )
}

const PINNED_TOKENS: Record<string, React.ComponentType<any>> = {
  eth: TokenETH,
  pol: TokenPOL,
  matic: TokenMATIC,
  avax: TokenAVAX,
  sol: TokenSOL,
  sei: TokenSEI,
  xpl: TokenXPL,
  plasma: TokenXPL,
  okb: TokenOKB,
  xlayer: TokenOKB,
  'x-layer': TokenOKB,
  // No TokenSonic exists in the catalog; the Sonic network mark doubles as
  // the S-token mark (PortfolioDrawer already did this with NetworkIcon).
  s: NetworkSonic,
  sonic: NetworkSonic,
}

export function PinnedTokenIcon({ symbol, variant = 'branded', size = 24, className, fallback }: PinnedTokenIconProps) {
  const key = (symbol || '').toLowerCase().trim()

  // App-issued data-URL icons (USDC/EURC/cirBTC/…) resolve without web3icons.
  const dataUrl = TOKEN_ICON_MAP[symbol] || TOKEN_ICON_MAP[key.toUpperCase()] || TOKEN_ICON_MAP[key]
  if (dataUrl) {
    return <img src={dataUrl} alt={symbol} width={size} height={size} className={`object-contain ${className || ''}`} />
  }

  const Pinned = PINNED_TOKENS[key]
  if (Pinned) {
    return <Pinned variant={variant} size={size} className={className} />
  }

  if (fallback !== undefined) return <>{fallback}</>
  return <LetterAvatar label={symbol} size={size} className={className} />
}

const PINNED_NETWORKS: Record<string, React.ComponentType<any>> = {
  solana: NetworkSolana,
  injective: NetworkInjective,
  sonic: NetworkSonic,
  ethereum: NetworkEthereum,
  base: NetworkBase,
  monad: NetworkMonad,
  'arbitrum-one': NetworkArbitrumOne,
  optimism: NetworkOptimism,
  'hyper-evm': NetworkHyperEvm,
  polygon: NetworkPolygon,
  avalanche: NetworkAvalanche,
  'sei-network': NetworkSeiNetwork,
  unichain: NetworkUnichain,
  world: NetworkWorld,
  ink: NetworkInk,
  linea: NetworkLinea,
  'linea-sepolia': NetworkLineaSepolia,
  plume: NetworkPlume,
  xdc: NetworkXdc,
  cronos: NetworkCronos,
  codex: NetworkCodex,
  edgeless: NetworkEdgeless,
  plasma: NetworkPlasma,
  'x-layer': NetworkXLayer,
  xlayer: NetworkXLayer,
  arc: NetworkArc,
  'base-sepolia': NetworkBaseSepolia,
  'arbitrum-sepolia': NetworkArbitrumSepolia,
  'optimism-sepolia': NetworkOptimismSepolia,
  'polygon-amoy': NetworkPolygonAmoy,
  'avalanche-fuji': NetworkAvalancheFuji,
  'monad-testnet': NetworkMonadTestnet,
}

export function PinnedNetworkIcon({ name, variant = 'branded', size = 22, className, fallback }: PinnedNetworkIconProps) {
  const key = (name || '').toLowerCase().trim()
  const Pinned = PINNED_NETWORKS[key]
  if (Pinned) {
    return <Pinned variant={variant} size={size} className={className} />
  }
  if (fallback !== undefined) return <>{fallback}</>
  return <GenericChainFallbackIcon name={name} size={typeof size === 'number' ? size : Number(size) || 22} className={className} />
}
