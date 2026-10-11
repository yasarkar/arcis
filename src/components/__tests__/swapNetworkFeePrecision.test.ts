import React from 'react'
import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { UnifiedSuccessReceipt } from '../fintech/UnifiedSuccessReceipt'

describe('Swap Receipt Network Fee Precision (Max 5 Decimals)', () => {
  it('clamps a long-decimal network fee to at most 5 decimal places', () => {
    const markup = renderToStaticMarkup(
      React.createElement(UnifiedSuccessReceipt, {
        type: 'swap',
        amountIn: '100',
        amountOut: '99.88',
        tokenIn: 'USDC',
        tokenOut: 'EURC',
        networkFee: '0.0004812345678 USDC',
        onActionAgain: () => {},
      })
    )

    expect(markup).toContain('Network Fee:')
    expect(markup).toContain('0.00048 USDC')
    expect(markup).not.toContain('0.0004812345678')
  })

  it('keeps standard 5-decimal network fee intact', () => {
    const markup = renderToStaticMarkup(
      React.createElement(UnifiedSuccessReceipt, {
        type: 'swap',
        amountIn: '100',
        amountOut: '99.88',
        tokenIn: 'USDC',
        tokenOut: 'EURC',
        networkFee: '0.00053 USDC',
        onActionAgain: () => {},
      })
    )

    expect(markup).toContain('Network Fee:')
    expect(markup).toContain('0.00053 USDC')
  })

  it('keeps short decimal network fee intact', () => {
    const markup = renderToStaticMarkup(
      React.createElement(UnifiedSuccessReceipt, {
        type: 'swap',
        amountIn: '100',
        amountOut: '99.88',
        tokenIn: 'USDC',
        tokenOut: 'EURC',
        networkFee: '0.00 USDC',
        onActionAgain: () => {},
      })
    )

    expect(markup).toContain('Network Fee:')
    expect(markup).toContain('0.00 USDC')
  })
})
