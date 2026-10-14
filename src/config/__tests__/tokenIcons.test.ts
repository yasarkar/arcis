import { describe, it, expect } from 'vitest'
import {
  EthIcon,
  WethIcon,
  SonicIcon,
  SIcon,
  PhrsIcon,
  PharosIcon,
  XplIcon,
  PlasmaIcon,
  OkbIcon,
  XLayerIcon,
  TOKEN_ICON_MAP,
  TokenETH,
  NetworkSonic,
  TokenXPL,
  TokenOKB,
  NetworkXLayer,
} from '../tokenIcons'

describe('tokenIcons configuration', () => {
  it('provides official @web3icons ETH SVG data URI for EthIcon and WethIcon', () => {
    expect(EthIcon).toBeDefined()
    expect(typeof EthIcon).toBe('string')
    expect(EthIcon.startsWith('data:image/svg+xml')).toBe(true)
    expect(WethIcon).toBe(EthIcon)

    // Decoded SVG check
    const decodedSvg = decodeURIComponent(EthIcon.replace(/^data:image\/svg\+xml;utf8,/, ''))
    expect(decodedSvg).toContain('<svg')
    expect(decodedSvg).toContain('class="web3icons"')
    expect(decodedSvg).toContain('viewBox="0 0 24 24"')
    expect(decodedSvg).toContain('fill="#8FFCF3"')
  })

  it('provides official @web3icons Sonic white SVG data URI for SonicIcon and SIcon', () => {
    expect(SonicIcon).toBeDefined()
    expect(typeof SonicIcon).toBe('string')
    expect(SonicIcon.startsWith('data:image/svg+xml')).toBe(true)
    expect(SIcon).toBe(SonicIcon)

    // Decoded SVG check ensuring white fill
    const decodedSvg = decodeURIComponent(SonicIcon.replace(/^data:image\/svg\+xml;utf8,/, ''))
    expect(decodedSvg).toContain('<svg')
    expect(decodedSvg).toContain('class="web3icons"')
    expect(decodedSvg).toContain('viewBox="0 0 24 24"')
    expect(decodedSvg).toContain('fill="#ffffff"')
  })

  it('provides official @web3icons Plasma white SVG data URI for XplIcon and PlasmaIcon', () => {
    expect(XplIcon).toBeDefined()
    expect(typeof XplIcon).toBe('string')
    expect(XplIcon.startsWith('data:image/svg+xml')).toBe(true)
    expect(PlasmaIcon).toBe(XplIcon)

    // Decoded SVG check ensuring white fill
    const decodedSvg = decodeURIComponent(XplIcon.replace(/^data:image\/svg\+xml;utf8,/, ''))
    expect(decodedSvg).toContain('<svg')
    expect(decodedSvg).toContain('class="web3icons"')
    expect(decodedSvg).toContain('viewBox="0 0 24 24"')
    expect(decodedSvg).toContain('fill="#ffffff"')
  })

  it('provides official @web3icons OKB / X Layer white SVG data URI for OkbIcon and XLayerIcon', () => {
    expect(OkbIcon).toBeDefined()
    expect(typeof OkbIcon).toBe('string')
    expect(OkbIcon.startsWith('data:image/svg+xml')).toBe(true)
    expect(XLayerIcon).toBe(OkbIcon)

    // Decoded SVG check ensuring white fill
    const decodedSvg = decodeURIComponent(OkbIcon.replace(/^data:image\/svg\+xml;utf8,/, ''))
    expect(decodedSvg).toContain('<svg')
    expect(decodedSvg).toContain('class="web3icons"')
    expect(decodedSvg).toContain('viewBox="0 0 24 24"')
    expect(decodedSvg).toContain('fill="#ffffff"')
  })

  it('provides official PHRS Token SVG for PhrsIcon and PharosIcon', () => {
    expect(PhrsIcon).toBeDefined()
    expect(typeof PhrsIcon).toBe('string')
    expect(PharosIcon).toBe(PhrsIcon)
  })

  it('maps both ETH and WETH to the official web3icons ETH icon in TOKEN_ICON_MAP', () => {
    expect(TOKEN_ICON_MAP.WETH).toBe(WethIcon)
    expect(TOKEN_ICON_MAP.ETH).toBe(EthIcon)
  })

  it('maps S and SONIC to the white SonicIcon in TOKEN_ICON_MAP', () => {
    expect(TOKEN_ICON_MAP.S).toBe(SonicIcon)
    expect(TOKEN_ICON_MAP.SONIC).toBe(SonicIcon)
  })

  it('maps XPL and PLASMA to the white XplIcon in TOKEN_ICON_MAP', () => {
    expect(TOKEN_ICON_MAP.XPL).toBe(XplIcon)
    expect(TOKEN_ICON_MAP.PLASMA).toBe(XplIcon)
  })

  it('maps OKB, XLAYER, and X-LAYER to the white OkbIcon in TOKEN_ICON_MAP', () => {
    expect(TOKEN_ICON_MAP.OKB).toBe(OkbIcon)
    expect(TOKEN_ICON_MAP.XLAYER).toBe(OkbIcon)
    expect(TOKEN_ICON_MAP['X-LAYER']).toBe(OkbIcon)
  })

  it('maps PHRS and PHAROS to PhrsIcon in TOKEN_ICON_MAP', () => {
    expect(TOKEN_ICON_MAP.PHRS).toBe(PhrsIcon)
    expect(TOKEN_ICON_MAP.PHAROS).toBe(PhrsIcon)
  })

  it('exports TokenETH, NetworkSonic, TokenXPL, TokenOKB, and NetworkXLayer components from @web3icons/react', () => {
    expect(TokenETH).toBeDefined()
    expect(typeof TokenETH).toBe('object')
    expect(NetworkSonic).toBeDefined()
    expect(typeof NetworkSonic).toBe('object')
    expect(TokenXPL).toBeDefined()
    expect(typeof TokenXPL).toBe('object')
    expect(TokenOKB).toBeDefined()
    expect(typeof TokenOKB).toBe('object')
    expect(NetworkXLayer).toBeDefined()
    expect(typeof NetworkXLayer).toBe('object')
  })
})
