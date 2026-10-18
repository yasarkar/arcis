import UsdcIcon from '../../assets/Token-Icon/USDC Token.svg'
import EurcIcon from '../../assets/Token-Icon/EURC Token.svg'
import CircleIcon from '../../assets/Token-Icon/CIRCLE Token.svg'
import CirBtcIcon from '../../assets/Token-Icon/cirBTC Token.svg'
import { PinnedTokenIcon } from '../common/PinnedIcons'

export function cleanTokenSymbol(raw?: string): string {
  if (!raw) return 'USDC'
  return raw.replace(/\s*\(.*?\)/g, '').trim() || 'USDC'
}

export function RenderTokenIcon({ symbol }: { symbol?: string }) {
  const clean = cleanTokenSymbol(symbol)
  const symUpper = clean.toUpperCase()

  if (symUpper === 'USDC' || symUpper.includes('USDC')) {
    return <img src={UsdcIcon} alt="USDC" className="w-4 h-4 rounded-full inline-block shrink-0 object-contain" />
  }
  if (symUpper === 'EURC' || symUpper.includes('EURC')) {
    return <img src={EurcIcon} alt="EURC" className="w-4 h-4 rounded-full inline-block shrink-0 object-contain" />
  }
  if (symUpper === 'CIRBTC' || symUpper === 'BTC' || symUpper === 'WBTC') {
    return <img src={CirBtcIcon} alt="cirBTC" className="w-4 h-4 rounded-full inline-block shrink-0 object-contain" />
  }
  if (symUpper === 'CIRCLE' || symUpper === 'CRCL') {
    return <img src={CircleIcon} alt="CIRCLE" className="w-4 h-4 rounded-full inline-block shrink-0 object-contain" />
  }
  if (symUpper === 'ETH' || symUpper === 'WETH' || symUpper.includes('ETH')) {
    return <PinnedTokenIcon symbol="eth" className="w-4 h-4 rounded-full inline-block shrink-0" size={16} />
  }
  if (symUpper === 'POL' || symUpper === 'MATIC') {
    return <PinnedTokenIcon symbol="matic" className="w-4 h-4 rounded-full inline-block shrink-0" size={16} />
  }
  if (symUpper === 'AVAX') {
    return <PinnedTokenIcon symbol="avax" className="w-4 h-4 rounded-full inline-block shrink-0" size={16} />
  }
  if (symUpper === 'SOL') {
    return <PinnedTokenIcon symbol="sol" className="w-4 h-4 rounded-full inline-block shrink-0" size={16} />
  }

  return (
    <PinnedTokenIcon
      symbol={clean.toLowerCase()}
      className="w-4 h-4 rounded-full inline-block shrink-0"
      size={16}
      fallback={
        <span className="w-4 h-4 rounded-full bg-indigo-500/20 border border-indigo-400/30 inline-flex items-center justify-center text-[8px] font-bold text-indigo-300 select-none">
          {clean.slice(0, 2).toUpperCase()}
        </span>
      }
    />
  )
}
