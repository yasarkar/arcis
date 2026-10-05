// src/components/__tests__/bridgeReceiptFeeRows.test.ts
// The bridge receipt stacks fee rows like every other receipt: Platform Fee,
// the source-chain Network Fee, and — once the destination mint is verified —
// the Destination Network Fee: the REAL gas that chain charged for the mint, in its
// native currency (ETH on Base, USDC on Arc), resolved from the mint receipt
// exactly like the source row. Circle's old combined "Bridge Fee" row was
// removed per product decision, so no row may ever say "Bridge Fee". Both
// Network Fee and Destination Network Fee must be REAL on-chain values (resolved by
// BridgeModal), never estimates.
//
// Gateway Fast shows neither a Platform Fee nor a Gateway Fee row: Arcis charges
// nothing on that route and Circle bills its own cost from the user's unified
// Gateway balance, so no fee is deducted from the bridged amount. The source row
// still reads 0.00 (with the gasless reason in its tooltip) because an EIP-712 burn intent never submits a
// source-chain transaction — that row must not vanish, and it must never quote
// the CCTP gas estimate the Direct route charges.

import { describe, expect, it, vi } from 'vitest'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  BridgeSuccessReceipt,
  type BridgeSuccessReceiptProps,
} from '../fintech/BridgeSuccessReceipt'
import { UnifiedSuccessReceipt } from '../fintech/UnifiedSuccessReceipt'

// The sound service touches localStorage at import time; the receipt visual does not depend on it.
vi.mock('../../services/soundService', () => ({ playSound: vi.fn() }))

const baseProps: Omit<BridgeSuccessReceiptProps, 'platformFee' | 'networkFee'> = {
  amount: '25',
  sourceChain: 'Arc_Testnet',
  destChain: 'Base_Sepolia',
  sourceChainName: 'Arc Testnet',
  destChainName: 'Base Sepolia',
  sourceIconId: 'arc',
  destIconId: 'base',
  recipient: `0x${'1'.repeat(40)}`,
  mode: 'direct',
  onBridgeAgain: () => {},
  isInline: true,
}

function renderFees(props: Partial<BridgeSuccessReceiptProps>): string {
  return renderToStaticMarkup(
    React.createElement(BridgeSuccessReceipt, {
      ...baseProps,
      ...props,
    } as BridgeSuccessReceiptProps)
  )
}

describe('bridge receipt fee rows', () => {
  it('stacks Platform Fee and Source Network Fee as the only fee rows', () => {
    const markup = renderFees({
      platformFee: '0.50 USDC',
      networkFee: '0.0000198 USDC',
    })

    expect(markup).toContain('Platform Fee:')
    expect(markup).toContain('0.50 USDC')
    // Bridge receipts name the source row after the chain it belongs to.
    expect(markup).toContain('Source Network Fee:')
    expect(markup).toContain('0.0000198 USDC')
    // The protocol-fee row is gone from the bridge receipt.
    expect(markup).not.toContain('Bridge Fee:')
    expect(markup).not.toContain('Protocol Fee:')
  })

  it('orders the rows Platform Fee → Source Network Fee', () => {
    const markup = renderFees({ platformFee: '0.50 USDC', networkFee: '0.0000198 USDC' })

    const platformPos = markup.indexOf('Platform Fee:')
    const networkPos = markup.indexOf('Source Network Fee:')

    expect(platformPos).toBeGreaterThan(-1)
    expect(networkPos).toBeGreaterThan(platformPos)
  })

  it('omits the Source Network Fee row when the real gas could not be verified', () => {
    const markup = renderFees({ platformFee: '0.50 USDC' })

    expect(markup).not.toContain('Source Network Fee:')
    expect(markup).toContain('Platform Fee:')
  })

  it('shows the verified destination-chain fee in the destination native currency', () => {
    const markup = renderFees({
      platformFee: '0.50 USDC',
      networkFee: '0.0000198 USDC',
      // Arc -> Base: the destination mint's real gas is ETH on Base, not USDC.
      destinationFee: '0.0000011 ETH',
    })

    expect(markup).toContain('Destination Network Fee:')
    expect(markup).toContain('0.0000011 ETH')
  })

  it('omits the Destination Network Fee row until the destination mint is verified', () => {
    const markup = renderFees({ platformFee: '0.50 USDC', networkFee: '0.0000198 USDC' })

    expect(markup).not.toContain('Destination Network Fee:')
  })

  it('orders the rows Platform Fee → Source Network Fee → Destination Network Fee', () => {
    const markup = renderFees({
      platformFee: '0.50 USDC',
      networkFee: '0.0000198 USDC',
      destinationFee: '0.0000011 ETH',
    })

    const platformPos = markup.indexOf('Platform Fee:')
    const networkPos = markup.indexOf('Source Network Fee:')
    const destPos = markup.indexOf('Destination Network Fee:')

    expect(networkPos).toBeGreaterThan(platformPos)
    expect(destPos).toBeGreaterThan(networkPos)
  })

  it('discloses a free platform fee honestly when none is charged', () => {
    const markup = renderFees({ platformFee: '0.00 USDC (Free)' })

    expect(markup).toContain('Platform Fee:')
    expect(markup).toContain('0.00 USDC (Free)')
  })
})

// Gateway Fast is a route Circle and Arc provide end to end: Arcis charges no
// platform fee on it, so the receipt must not present a Platform Fee row — and it
// has no Gateway Fee row either, because that route's own cost is Circle's and is
// billed from the user's unified Gateway balance, not from the bridged amount.
describe('gateway fast transfer receipt rows', () => {
  it('never renders a Platform Fee or Gateway Fee row for a Gateway Fast bridge', () => {
    const markup = renderFees({
      mode: 'gateway',
      // Handed a platform fee anyway: the Gateway route must still suppress it.
      platformFee: '0.50 USDC',
      sourceFeeGasless: true,
      destinationFee: '0.0000011 ETH',
    })

    expect(markup).not.toContain('Platform Fee:')
    expect(markup).not.toContain('Gateway Fee:')
    expect(markup).not.toContain('0.50 USDC')
    // Nor the old "free" wording that used to stand in for those rows.
    expect(markup).not.toContain('(Free)')
    expect(markup).not.toContain('Gateway route')
  })

  it('keeps the gasless source row and the verified destination fee', () => {
    const markup = renderFees({
      mode: 'gateway',
      sourceFeeGasless: true,
      destinationFee: '0.0000011 ETH',
    })

    expect(markup).toContain('Source Network Fee:')
    expect(markup).toContain('0.00 USDC')
    // The reason must be disclosed, not just the zero.
    expect(markup).toContain('EIP-712 burn intent')
    expect(markup).toContain('Destination Network Fee:')
    expect(markup).toContain('0.0000011 ETH')
  })

  it('orders the gateway rows Source Network Fee → Destination Network Fee', () => {
    const markup = renderFees({
      mode: 'gateway',
      sourceFeeGasless: true,
      destinationFee: '0.0000011 ETH',
    })

    const sourcePos = markup.indexOf('Source Network Fee:')
    const destPos = markup.indexOf('Destination Network Fee:')

    expect(sourcePos).toBeGreaterThan(-1)
    expect(destPos).toBeGreaterThan(sourcePos)
  })

  it('never labels a Direct bridge as gasless', () => {
    const markup = renderFees({ platformFee: '0.50 USDC', networkFee: '0.0000198 USDC' })

    expect(markup).not.toContain('gasless')
  })
})

describe('protocol fee row suppression is bridge-specific', () => {
  const render = (type: 'bridge' | 'swap', fee: string) =>
    renderToStaticMarkup(
      React.createElement(UnifiedSuccessReceipt, {
        type,
        fee,
        amountIn: '1',
        amountOut: '1',
        onActionAgain: () => {},
        isInline: true,
      } as any)
    )

  it('never renders a protocol fee row for bridge receipts', () => {
    const markup = render('bridge', '0.554663 USDC')

    expect(markup).not.toContain('Bridge Fee:')
    expect(markup).not.toContain('Protocol Fee:')
    expect(markup).not.toContain('0.554663')
  })

  it('keeps the Protocol Fee row for every other receipt type', () => {
    const markup = render('swap', '0.554663 USDC')

    expect(markup).toContain('Protocol Fee:')
    expect(markup).toContain('0.554663 USDC')
  })
})
