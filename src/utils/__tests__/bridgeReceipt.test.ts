// src/utils/__tests__/bridgeReceipt.test.ts
//
// The bridge receipt is where "what arrives" is stated as a number, and four
// paths feed it: Gateway, injected-wallet CCTP, UCW CCTP, and the recovery of a
// burn whose mint is still in flight. These tests pin each one — plus the rule
// that an unproved delivery reports no net amount instead of an estimate.

import { describe, it, expect } from 'vitest'
import {
  buildBridgeReceipt,
  applyBridgeDelivery,
  resolveBridgeNetReceived,
} from '../bridgeReceipt'

const BURN = `0x${'b'.repeat(64)}`
const MINT = `0x${'m'.repeat(64)}`.replace(/m/g, 'a')
const BURN_EXPLORER = 'https://sepolia.etherscan.io/tx/burn'
const MINT_EXPLORER = 'https://sepolia.etherscan.io/tx/mint'

describe('resolveBridgeNetReceived', () => {
  it('reports nothing while the destination is unconfirmed', () => {
    expect(
      resolveBridgeNetReceived({ destinationConfirmed: false, mode: 'direct', amount: '10' })
    ).toBeUndefined()
    expect(
      resolveBridgeNetReceived({ destinationConfirmed: false, mode: 'gateway', amount: '10' })
    ).toBeUndefined()
  })

  it('settles Gateway on the measured mint amount, or the full principal', () => {
    expect(
      resolveBridgeNetReceived({ destinationConfirmed: true, mode: 'gateway', amount: '10', gatewayReceivedAmount: '9.99' })
    ).toBe('9.99')
    // Gateway never haircuts the principal: Circle bills its cost from the
    // unified balance, not from the bridged amount.
    expect(
      resolveBridgeNetReceived({ destinationConfirmed: true, mode: 'gateway', amount: '10' })
    ).toBe('10')
  })

  it('prefers the measured CCTP amount over the quoted fee', () => {
    expect(
      resolveBridgeNetReceived({
        destinationConfirmed: true,
        mode: 'direct',
        amount: '10',
        confirmedCctpReceivedAmount: '9.9775',
        fallbackFee: '0.20',
      })
    ).toBe('9.9775')
  })

  it('falls back to amount minus the quoted fee, never below zero', () => {
    expect(        resolveBridgeNetReceived({ destinationConfirmed: true, mode: 'direct', amount: '10', fallbackFee: '0.20' })
      ).toBe('9.800000')
    expect(
      resolveBridgeNetReceived({ destinationConfirmed: true, mode: 'direct', amount: '0.1', fallbackFee: '5' })
    ).toBe('0.000000')
  })
})

describe('buildBridgeReceipt', () => {
  const base = {
    amount: '10',
    tokenSymbol: 'USDC',
    tokenIcon: 'usdc',
    sourceChain: 'Base_Sepolia',
    destChain: 'Arc_Testnet',
  }

  it('Gateway, confirmed: the mint is the receipt transaction', () => {
    const receipt = buildBridgeReceipt({
      ...base,
      mode: 'gateway',
      destinationConfirmed: true,
      mintTxHash: MINT,
      destExplorerUrl: MINT_EXPLORER,
      netReceived: '10',
    })

    expect(receipt.txHash).toBe(MINT)
    expect(receipt.destTxHash).toBe(MINT)
    expect(receipt.sourceTxHash).toBeUndefined()
    expect(receipt.explorerUrl).toBe(MINT_EXPLORER)
    expect(receipt.sourceExplorerUrl).toBeUndefined()
    expect(receipt.destExplorerUrl).toBe(MINT_EXPLORER)
    expect(receipt.netReceived).toBe('10')
  })

  it('Gateway, pending: no transaction hash and no net amount', () => {
    const receipt = buildBridgeReceipt({
      ...base,
      mode: 'gateway',
      destinationConfirmed: false,
      mintTxHash: MINT,
    })

    expect(receipt.txHash).toBeUndefined()
    expect(receipt.destTxHash).toBeUndefined()
    expect(receipt.explorerUrl).toBeUndefined()
    expect(receipt.destExplorerUrl).toBeUndefined()
    expect(receipt.netReceived).toBeUndefined()
  })

  it('CCTP, confirmed: the burn stays primary and the mint is the destination', () => {
    const receipt = buildBridgeReceipt({
      ...base,
      mode: 'direct',
      destinationConfirmed: true,
      burnTxHash: BURN,
      mintTxHash: MINT,
      sourceExplorerUrl: BURN_EXPLORER,
      destExplorerUrl: MINT_EXPLORER,
      netReceived: '9.98',
    })

    expect(receipt.txHash).toBe(BURN)
    expect(receipt.sourceTxHash).toBe(BURN)
    expect(receipt.destTxHash).toBe(MINT)
    // While a CCTP transfer has a source burn, the primary link is that burn —
    // the transaction the user signed.
    expect(receipt.explorerUrl).toBe(BURN_EXPLORER)
    expect(receipt.sourceExplorerUrl).toBe(BURN_EXPLORER)
    expect(receipt.destExplorerUrl).toBe(MINT_EXPLORER)
    expect(receipt.netReceived).toBe('9.98')
  })

  it('CCTP (UCW), pending: the burn is shown, the mint is not claimed', () => {
    const receipt = buildBridgeReceipt({
      ...base,
      mode: 'direct',
      destinationConfirmed: false,
      burnTxHash: BURN,
      mintTxHash: MINT,
      sourceExplorerUrl: BURN_EXPLORER,
      destExplorerUrl: MINT_EXPLORER,
    })

    expect(receipt.txHash).toBe(BURN)
    expect(receipt.sourceTxHash).toBe(BURN)
    expect(receipt.destTxHash).toBeUndefined()
    expect(receipt.destExplorerUrl).toBeUndefined()
    expect(receipt.explorerUrl).toBe(BURN_EXPLORER)
    expect(receipt.netReceived).toBeUndefined()
  })

  it('recovery after a failed mint: source burn only, still no net amount', () => {
    const receipt = buildBridgeReceipt({
      ...base,
      mode: 'direct',
      destinationConfirmed: false,
      burnTxHash: BURN,
      sourceExplorerUrl: BURN_EXPLORER,
      networkFee: '0.0001 USDC',
    })

    expect(receipt.txHash).toBe(BURN)
    expect(receipt.sourceExplorerUrl).toBe(BURN_EXPLORER)
    expect(receipt.destTxHash).toBeUndefined()
    expect(receipt.netReceived).toBeUndefined()
    expect(receipt.networkFee).toBe('0.0001 USDC')
    expect(receipt.mode).toBe('direct')
  })
})

describe('applyBridgeDelivery', () => {
  const receipt = buildBridgeReceipt({
    amount: '10',
    tokenSymbol: 'USDC',
    tokenIcon: 'usdc',
    sourceChain: 'Base_Sepolia',
    destChain: 'Arc_Testnet',
    mode: 'direct',
    destinationConfirmed: false,
    burnTxHash: BURN,
    sourceExplorerUrl: BURN_EXPLORER,
    destFee: '0.000042 ETH',
  })

  it('adds what the destination poll resolved', () => {
    const updated = applyBridgeDelivery(receipt, {
      destTxHash: MINT,
      destExplorerUrl: MINT_EXPLORER,
      netReceived: '9.9775',
    })

    expect(updated).toMatchObject({
      txHash: BURN,
      destTxHash: MINT,
      destExplorerUrl: MINT_EXPLORER,
      netReceived: '9.9775',
      destFee: '0.000042 ETH',
    })
  })

  it('keeps the current value for every field the poll could not resolve', () => {
    const updated = applyBridgeDelivery(receipt, {
      destTxHash: MINT,
      destExplorerUrl: undefined,
      netReceived: undefined,
      destFee: undefined,
    })

    expect(updated!.destTxHash).toBe(MINT)
    // A poll that could not read the destination fee must not blank the fee the
    // receipt already showed.
    expect(updated!.destFee).toBe('0.000042 ETH')
    expect(updated!.netReceived).toBeUndefined()
  })

  it('leaves an absent receipt absent', () => {
    expect(applyBridgeDelivery(null, { destTxHash: MINT })).toBeNull()
    expect(applyBridgeDelivery(undefined, { destTxHash: MINT })).toBeNull()
  })
})
