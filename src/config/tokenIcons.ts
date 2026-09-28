// src/config/tokenIcons.ts
import UsdcIcon from '../assets/Token-Icon/USDC Token.svg'
import EurcIcon from '../assets/Token-Icon/EURC Token.svg'
import CircleIcon from '../assets/Token-Icon/CIRCLE Token.svg'
import CirBtcIcon from '../assets/Token-Icon/cirBTC Token.svg'
import WethIcon from '../assets/Token-Icon/WETH Token.svg'
import UsycIcon from '../assets/Token-Icon/USYC Token.svg'

export const TOKEN_ICON_MAP: Record<string, string> = {
  USDC: UsdcIcon,
  EURC: EurcIcon,
  cirBTC: CirBtcIcon,
  BTC: CirBtcIcon,
  WETH: WethIcon,
  ETH: WethIcon,
  USYC: UsycIcon,
  'af-USDC': UsdcIcon,
  'af-USDC-EURC': EurcIcon,
  'af-USDC-cirBTC': CirBtcIcon,
}

export { UsdcIcon, EurcIcon, CircleIcon, CirBtcIcon, WethIcon, UsycIcon }

