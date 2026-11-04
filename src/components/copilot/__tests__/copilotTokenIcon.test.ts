import { describe, it, expect } from 'vitest'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  CopilotTokenIcon,
  CopilotNetworkBadge,
  resolveCopilotTokenIconSrc,
} from '../CopilotTokenIcon'
import { TOKEN_ICON_MAP } from '../../../config/tokenIcons'

describe('CopilotTokenIcon & Token Icon Resolution', () => {
  it('resolves canonical token icons accurately from TOKEN_ICON_MAP', () => {
    expect(resolveCopilotTokenIconSrc('USDC')).toBe(TOKEN_ICON_MAP.USDC)
    expect(resolveCopilotTokenIconSrc('EURC')).toBe(TOKEN_ICON_MAP.EURC)
    expect(resolveCopilotTokenIconSrc('cirBTC')).toBe(TOKEN_ICON_MAP.cirBTC)
    expect(resolveCopilotTokenIconSrc('BTC')).toBe(TOKEN_ICON_MAP.cirBTC)
    expect(resolveCopilotTokenIconSrc('WBTC')).toBe(TOKEN_ICON_MAP.cirBTC)
    expect(resolveCopilotTokenIconSrc('WETH')).toBe(TOKEN_ICON_MAP.WETH)
    expect(resolveCopilotTokenIconSrc('ETH')).toBe(TOKEN_ICON_MAP.ETH)
    expect(resolveCopilotTokenIconSrc('CIRCLE')).toBe(TOKEN_ICON_MAP.CIRCLE)
    expect(resolveCopilotTokenIconSrc('PHRS')).toBe(TOKEN_ICON_MAP.PHRS)
    expect(resolveCopilotTokenIconSrc('SONIC')).toBe(TOKEN_ICON_MAP.SONIC)
    expect(resolveCopilotTokenIconSrc('PLASMA')).toBe(TOKEN_ICON_MAP.PLASMA)
    expect(resolveCopilotTokenIconSrc('OKB')).toBe(TOKEN_ICON_MAP.OKB)
  })

  it('renders official SVG image element for WETH and ETH instead of text glyph', () => {
    const htmlWeth = renderToStaticMarkup(React.createElement(CopilotTokenIcon, { symbol: 'WETH' }))
    const htmlEth = renderToStaticMarkup(React.createElement(CopilotTokenIcon, { symbol: 'ETH' }))

    expect(htmlWeth).toContain('<img')
    expect(htmlWeth).toContain('alt="WETH"')
    expect(htmlEth).toContain('<img')
    expect(htmlEth).toContain('alt="ETH"')
    // Should NOT contain the old plain text Ξ glyph
    expect(htmlWeth).not.toContain('Ξ')
    expect(htmlEth).not.toContain('Ξ')
  })

  it('renders official SVG for cirBTC, BTC, and WBTC', () => {
    const htmlCirBtc = renderToStaticMarkup(React.createElement(CopilotTokenIcon, { symbol: 'cirBTC' }))
    const htmlBtc = renderToStaticMarkup(React.createElement(CopilotTokenIcon, { symbol: 'BTC' }))
    const htmlWbtc = renderToStaticMarkup(React.createElement(CopilotTokenIcon, { symbol: 'WBTC' }))

    expect(htmlCirBtc).toContain('<img')
    expect(htmlBtc).toContain('<img')
    expect(htmlWbtc).toContain('<img')
    expect(htmlCirBtc).toContain('alt="cirBTC"')
    expect(htmlBtc).toContain('alt="BTC"')
    expect(htmlWbtc).toContain('alt="WBTC"')
    expect(htmlCirBtc).toContain('data:image/svg+xml')
    expect(htmlBtc).toContain('data:image/svg+xml')
    expect(htmlWbtc).toContain('data:image/svg+xml')
  })

  it('renders specialized vault badge for af-USDC with emerald indicator', () => {
    const html = renderToStaticMarkup(React.createElement(CopilotTokenIcon, { symbol: 'af-USDC' }))

    expect(html).toContain('alt="af-USDC"')
    expect(html).toContain('bg-emerald-500')
  })

  it('renders stylized fallback initial for unrecognized tokens', () => {
    const html = renderToStaticMarkup(React.createElement(CopilotTokenIcon, { symbol: 'UNKNOWNTOKEN' }))

    expect(html).toContain('U')
    expect(html).not.toContain('<img')
  })

  it('renders CopilotNetworkBadge with Arc Logo for Arc and ChainIcon for others', () => {
    const htmlArc = renderToStaticMarkup(
      React.createElement(CopilotNetworkBadge, { chainName: 'Arc Testnet' })
    )
    const htmlSepolia = renderToStaticMarkup(
      React.createElement(CopilotNetworkBadge, { chainName: 'Ethereum Sepolia' })
    )

    expect(htmlArc).toContain('Arc-Icon.svg')
    expect(htmlArc).toContain('Arc Testnet')
    expect(htmlSepolia).toContain('Ethereum Sepolia')
  })
})
