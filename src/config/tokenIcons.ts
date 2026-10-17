// src/config/tokenIcons.ts
import TokenETH, { __iconNode as ethIconNode } from '@web3icons/react/icons/tokens/TokenETH'
import NetworkSonic, { __iconNode as sonicNetworkNode } from '@web3icons/react/icons/networks/NetworkSonic'
import TokenXPL, { __iconNode as xplTokenNode } from '@web3icons/react/icons/tokens/TokenXPL'
import TokenOKB, { __iconNode as okbTokenNode } from '@web3icons/react/icons/tokens/TokenOKB'
import NetworkXLayer from '@web3icons/react/icons/networks/NetworkXLayer'
import UsdcIcon from '../assets/Token-Icon/USDC Token.svg'
import EurcIcon from '../assets/Token-Icon/EURC Token.svg'
import CircleIcon from '../assets/Token-Icon/CIRCLE Token.svg'
import CirBtcIcon from '../assets/Token-Icon/cirBTC Token.svg'
import PhrsIcon from '../assets/Token-Icon/PHRS Token.svg'

/**
 * Web3Icon ETH node serialization to SVG data URI.
 * Generates an optimized, standalone SVG data URL from @web3icons/react TokenETH icon definition.
 */
function serializeIconNodes(nodes: Array<[string, Record<string, string>, any[]?]>): string {
  const render = (list: Array<[string, Record<string, string>, any[]?]>): string =>
    list
      .map(([tag, attrs, children]) => {
        const attrStr = Object.entries(attrs || {})
          .map(([k, v]) => `${k.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)}="${v}"`)
          .join(' ')
        const inner = children ? render(children) : ''
        return `<${tag} ${attrStr}>${inner}</${tag}>`
      })
      .join('')

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" fill="none" viewBox="0 0 24 24" class="web3icons">${render(nodes)}</svg>`
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`
}

export const EthIcon: string = serializeIconNodes(ethIconNode.branded as any)
export const WethIcon: string = EthIcon
export { TokenETH }

// Sonic (S) token white SVG icon:
// In web3icons, Sonic's branded variant is pure black (#000), which appears dark/invisible on dark themes.
// We map its mono path with a brilliant white (#ffffff) fill so the S token is crisp and clearly visible.
const sonicWhiteNodes: Array<[string, Record<string, string>, any[]?]> = (sonicNetworkNode.mono as any).map(
  ([tag, attrs, children]: [string, Record<string, string>, any[]?]) => [
    tag,
    { ...attrs, fill: '#ffffff' },
    children,
  ]
)
export const SonicIcon: string = serializeIconNodes(sonicWhiteNodes)
export const SIcon: string = SonicIcon
export { NetworkSonic }

// Plasma (XPL) token white SVG icon:
// In web3icons, XPL's branded variant is pure black (#000), which appears dark/invisible on dark themes.
// We map its mono path with a brilliant white (#ffffff) fill so the XPL token is crisp and clearly visible.
const xplWhiteNodes: Array<[string, Record<string, string>, any[]?]> = (xplTokenNode.mono as any).map(
  ([tag, attrs, children]: [string, Record<string, string>, any[]?]) => [
    tag,
    { ...attrs, fill: '#ffffff' },
    children,
  ]
)
export const XplIcon: string = serializeIconNodes(xplWhiteNodes)
export const PlasmaIcon: string = XplIcon
export { TokenXPL }

// OKB / X Layer token white SVG icon:
// In web3icons, TokenOKB only provides a mono variant (branded is undefined).
// We map its mono path with a brilliant white (#ffffff) fill so OKB is crisp and clearly visible.
const okbWhiteNodes: Array<[string, Record<string, string>, any[]?]> = (okbTokenNode.mono as any).map(
  ([tag, attrs, children]: [string, Record<string, string>, any[]?]) => [
    tag,
    { ...attrs, fill: '#ffffff' },
    children,
  ]
)
export const OkbIcon: string = serializeIconNodes(okbWhiteNodes)
export const XLayerIcon: string = OkbIcon
export { TokenOKB, NetworkXLayer }

// Pharos (PHRS) token icon
export const PharosIcon: string = PhrsIcon
export { PhrsIcon }

export const TOKEN_ICON_MAP: Record<string, string> = {
  USDC: UsdcIcon,
  EURC: EurcIcon,
  cirBTC: CirBtcIcon,
  BTC: CirBtcIcon,
  WETH: WethIcon,
  ETH: EthIcon,
  S: SonicIcon,
  SONIC: SonicIcon,
  XPL: XplIcon,
  PLASMA: XplIcon,
  OKB: OkbIcon,
  XLAYER: OkbIcon,
  'X-LAYER': OkbIcon,
  PHRS: PhrsIcon,
  PHAROS: PhrsIcon,
  'af-USDC': UsdcIcon,
  'af-USDC-EURC': EurcIcon,
  'af-USDC-cirBTC': CirBtcIcon,
}

export { UsdcIcon, EurcIcon, CircleIcon, CirBtcIcon }


