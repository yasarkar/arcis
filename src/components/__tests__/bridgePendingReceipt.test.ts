// src/components/__tests__/bridgePendingReceipt.test.ts
// The CCTP pending bridge receipt must present its pending state as a two-line
// main title: "Bridge Pending" on top and "Destination Confirmation Required"
// centered as a second headline line beneath it — instead of one long
// single-line title joined with a hyphen.

import { describe, expect, it, vi } from 'vitest'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  BridgeSuccessReceipt,
  type BridgeSuccessReceiptProps,
} from '../fintech/BridgeSuccessReceipt'
import { getChainIconId } from '../../config/chainMeta'

// The sound service touches localStorage at import time; the receipt visual does not depend on it.
vi.mock('../../services/soundService', () => ({ playSound: vi.fn() }))

const baseProps: Omit<BridgeSuccessReceiptProps, 'pending'> = {
  amount: '25',
  sourceChain: 'Arc_Testnet',
  destChain: 'Base_Sepolia',
  sourceChainName: 'Arc Testnet',
  destChainName: 'Base Sepolia',
  sourceIconId: getChainIconId('Arc_Testnet'),
  destIconId: getChainIconId('Base_Sepolia'),
  recipient: `0x${'1'.repeat(40)}`,
  mode: 'direct',
  onBridgeAgain: () => {},
  isInline: true,
}

function renderReceipt(props: Partial<BridgeSuccessReceiptProps> = {}): string {
  return renderToStaticMarkup(
    React.createElement(BridgeSuccessReceipt, {
      ...baseProps,
      ...props,
    } as BridgeSuccessReceiptProps)
  )
}

function headingOf(markup: string): string {
  return markup.match(/<h3[\s\S]*?<\/h3>/)?.[0] ?? ''
}

describe('CCTP bridge pending receipt — two-line main title', () => {
  it('renders "Bridge Pending" with the second line as its own headline block', () => {
    const heading = headingOf(renderReceipt({ pending: true }))

    expect(heading).toContain('Bridge Pending')
    expect(heading).toContain('Destination Confirmation Required')
    // The second line is a block-level line inside the same headline element,
    // so it centers beneath line 1 with identical headline styling.
    expect(heading).toMatch(
      /<span class="block[^"]*">Destination Confirmation Required<\/span>/
    )
    // The old single-line joined form must be gone.
    expect(heading).not.toContain('Bridge Pending - Destination Confirmation Required')
  })

  it('keeps both lines inside one heading element (one main title, two lines)', () => {
    const markup = renderReceipt({ pending: true })
    const h3Count = (markup.match(/<h3/g) ?? []).length

    expect(h3Count).toBe(1)
    const heading = headingOf(markup)
    const titlePos = heading.indexOf('Bridge Pending')
    const sublinePos = heading.indexOf('Destination Confirmation Required')
    expect(titlePos).toBeGreaterThan(-1)
    expect(sublinePos).toBeGreaterThan(titlePos)
  })

  it('still shows the pending subtitle and the awaiting footer', () => {
    const markup = renderReceipt({ pending: true })

    expect(markup).toContain(
      'The source transaction was submitted. Destination mint is not yet verified; no final delivery is claimed.'
    )
    expect(markup).toContain('Awaiting Destination Confirmation')
  })

  it('renders a single-line headline once the bridge is confirmed', () => {
    const markup = renderReceipt({ pending: false })

    expect(headingOf(markup)).toContain('Bridge Finalized!')
    expect(markup).not.toContain('Destination Confirmation Required')
  })
})
