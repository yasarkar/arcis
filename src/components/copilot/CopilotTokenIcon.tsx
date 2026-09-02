// Unified token and network icon components for Arcis Copilot
import { NetworkIcon } from '@web3icons/react/dynamic'
import UsdcIcon from '../../assets/Token-Icon/USDC Token.svg'
import EurcIcon from '../../assets/Token-Icon/EURC Token.svg'
import CircleIcon from '../../assets/Token-Icon/CIRCLE Token.svg'
import CirBtcIcon from '../../assets/Token-Icon/cirBTC Token.svg'
import ArcLogo from '../../assets/Arc-Icon.svg'
import { getChainIconId } from '../../config/chainMeta'

interface TokenIconProps {
  symbol?: string
  className?: string
}

export function CopilotTokenIcon({ symbol = 'USDC', className = 'w-4 h-4' }: TokenIconProps) {
  const sym = symbol.toUpperCase().trim()

  if (sym === 'USDC') {
    return <img src={UsdcIcon} alt="USDC" className={`${className} object-contain inline-block`} />
  }
  if (sym === 'EURC') {
    return <img src={EurcIcon} alt="EURC" className={`${className} object-contain inline-block`} />
  }
  if (sym === 'CIRBTC' || sym === 'WBTC' || sym === 'BTC') {
    return <img src={CirBtcIcon} alt="cirBTC" className={`${className} object-contain inline-block`} />
  }
  if (sym === 'CIRCLE') {
    return <img src={CircleIcon} alt="CIRCLE" className={`${className} object-contain inline-block`} />
  }
  if (sym === 'AF-USDC' || sym === 'AFUSDC') {
    return (
      <div className="relative inline-flex items-center justify-center">
        <img src={UsdcIcon} alt="af-USDC" className={`${className} object-contain inline-block`} />
        <span className="absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full bg-emerald-500 border border-slate-900" />
      </div>
    )
  }
  if (sym === 'WETH' || sym === 'ETH') {
    return (
      <div className={`${className} rounded-full bg-indigo-500/20 border border-indigo-400/40 inline-flex items-center justify-center text-[9px] font-bold text-indigo-300 select-none`}>
        Ξ
      </div>
    )
  }

  // Fallback circle with symbol initial
  return (
    <div className={`${className} rounded-full bg-slate-800 border border-slate-700 inline-flex items-center justify-center text-[9px] font-bold text-cyan-300 select-none`}>
      {sym.slice(0, 1)}
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

  if (iconOnly) {
    if (isArc) {
      return <img src={ArcLogo} alt="Arc" className="w-4 h-4 object-contain inline-block" />
    }
    return (
      <div className="w-4 h-4 rounded-full overflow-hidden inline-flex items-center justify-center bg-slate-900">
        <NetworkIcon id={iconId} className="w-5 h-5" />
      </div>
    )
  }

  return (
    <div className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-lg bg-slate-900/90 text-xs font-semibold text-slate-200 select-text ${className}`}>
      {isArc ? (
        <img src={ArcLogo} alt="Arc" className="w-3.5 h-3.5 object-contain" />
      ) : (
        <NetworkIcon id={iconId} className="w-3.5 h-3.5" />
      )}
      <span className="select-text">{chainName}</span>
    </div>
  )
}
