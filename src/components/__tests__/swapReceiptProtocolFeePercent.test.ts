import React from 'react'
import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { UnifiedSuccessReceipt } from '../fintech/UnifiedSuccessReceipt'

describe('Swap Receipt Protocol Fee with Percentage', () => {
  it('renders both the fee amount and the percentage side by side for swap', () => {
    const markup = renderToStaticMarkup(
      React.createElement(UnifiedSuccessReceipt, {
        type: 'swap',
        amountIn: '100',
        amountOut: '99.88',
        tokenIn: 'USDC',
        tokenOut: 'EURC',
        fee: '1.00 USDC (1.00%)',
        speedTier: 'Fast',
        onActionAgain: () => {},
      })
    )

    expect(markup).toContain('Protocol Fee:')
    expect(markup).toContain('1.00 USDC')
    expect(markup).toContain('(1.00%)')
    expect(markup).toContain('Fast')
  })

  it('renders raw fee gracefully when no percentage is provided', () => {
    const markup = renderToStaticMarkup(
      React.createElement(UnifiedSuccessReceipt, {
        type: 'swap',
        amountIn: '100',
        amountOut: '99.88',
        tokenIn: 'USDC',
        tokenOut: 'EURC',
        fee: '0.50 USDC',
        onActionAgain: () => {},
      })
    )

    expect(markup).toContain('Protocol Fee:')
    expect(markup).toContain('0.50 USDC')
  })
})
