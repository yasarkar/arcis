import React from 'react'
import { PinnedNetworkIcon, PinnedTokenIcon } from '../common/PinnedIcons'
import { UsdcIcon, EurcIcon, CirBtcIcon, PhrsIcon } from '../../config/tokenIcons'

interface PortfolioAssetIconProps {
  symbol: string
  size?: number
  className?: string
}

export function PortfolioAssetIcon({ symbol, size = 24, className = 'w-full h-full object-contain' }: PortfolioAssetIconProps) {
  const s = symbol.toLowerCase()
  if (s === 'usdc') return <img src={UsdcIcon} alt="USDC" className={className} />
  if (s === 'eurc') return <img src={EurcIcon} alt="EURC" className={className} />
  if (s === 'cirbtc') return <img src={CirBtcIcon} alt="cirBTC" className={className} />
  if (s === 'weth' || s === 'eth') {
    return <PinnedTokenIcon symbol="eth" variant="branded" size={size} className={className} />
  }
  if (s === 'pol' || s === 'matic') {
    return <PinnedTokenIcon symbol="pol" variant="branded" size={size} className={className} />
  }
  if (s === 'avax') {
    return <PinnedTokenIcon symbol="avax" variant="branded" size={size} className={className} />
  }
  if (s === 'sei') {
    return <PinnedTokenIcon symbol="sei" variant="branded" size={size} className={className} />
  }
  if (s === 's' || s === 'sonic') {
    return <PinnedNetworkIcon name="sonic" variant="mono" size={size} className="text-white" />
  }
  if (s === 'phrs' || s === 'pharos') {
    return <img src={PhrsIcon} alt="PHRS" className={className} />
  }
  if (s === 'xpl' || s === 'plasma') {
    return <PinnedTokenIcon symbol="xpl" variant="mono" size={size} className="text-white" />
  }
  if (s === 'okb' || s === 'xlayer' || s === 'x-layer') {
    return <PinnedTokenIcon symbol="okb" variant="mono" size={size} className="text-white" />
  }
  return <PinnedTokenIcon symbol={s} variant="branded" size={size} className={className} />
}
