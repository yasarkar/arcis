// src/components/unified/__tests__/depositReceipt.test.ts
// Verifies that a confirmed Gateway deposit (as wired in UnifiedBalance) renders through the
// shared UnifiedSuccessReceipt template with the Gateway wording, amount and explorer link.

import { describe, expect, it, vi } from 'vitest'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { UnifiedSuccessReceipt } from '../../fintech/UnifiedSuccessReceipt'
import { getChainIconId } from '../../../config/chainMeta'
import { getExplorerTxUrl } from '../../../config/sendConfig'

// The sound service touches localStorage at import time; the receipt visual does not depend on it.
vi.mock('../../../services/soundService', () => ({ playSound: vi.fn() }))

const TX_HASH = `0x${'a'.repeat(64)}`

describe('Gateway deposit success receipt', () => {
  it('renders Gateway-specific deposit copy instead of the vault deposit defaults', () => {
    const markup = renderToStaticMarkup(
      React.createElement(UnifiedSuccessReceipt, {
        type: 'deposit',
        subtitle: 'USDC deposited into your Gateway unified balance via Circle Gateway',
        method: 'Circle Gateway Deposit',
        amount: '125.5',
        tokenSymbol: 'USDC',
        network: 'Arc_Testnet',
        networkIconId: getChainIconId('Arc_Testnet'),
        txHash: TX_HASH,
        explorerUrl: getExplorerTxUrl('Arc_Testnet', TX_HASH),
        isInline: true,
        onActionAgain: () => {},
      })
    )

    expect(markup).toContain('Deposit Finalized!')
    expect(markup).toContain('USDC deposited into your Gateway unified balance via Circle Gateway')
    expect(markup).toContain('Circle Gateway Deposit')
    expect(markup).toContain('Deposited Amount')
    expect(markup).toContain('125.5')
    expect(markup).not.toContain('Yield Vault')
    expect(markup).toContain('arcscan')
    expect(markup).toContain('DEPOSIT AGAIN')
  })

  it('prints the REAL receipt fee (and the approval fee) when they were resolved', () => {
    const markup = renderToStaticMarkup(
      React.createElement(UnifiedSuccessReceipt, {
        type: 'deposit',
        subtitle: 'USDC deposited into your Gateway unified balance via Circle Gateway',
        method: 'Circle Gateway Deposit',
        amount: '125.5',
        tokenSymbol: 'USDC',
        network: 'Arc_Testnet',
        networkIconId: getChainIconId('Arc_Testnet'),
        txHash: TX_HASH,
        explorerUrl: getExplorerTxUrl('Arc_Testnet', TX_HASH),
        networkFee: '0.000792866025 USDC',
        approvalFee: '0.00031 USDC',
        isInline: true,
        onActionAgain: () => {},
      })
    )

    expect(markup).toContain('Network Fee:')
    expect(markup).toContain('0.000792866025 USDC')
    expect(markup).toContain('Approval Fee:')
    expect(markup).toContain('0.00031 USDC')
    expect(markup).not.toContain('Sponsored')
  })

  it('reports a sponsored deposit instead of a fake zero fee when nothing was charged', () => {
    const markup = renderToStaticMarkup(
      React.createElement(UnifiedSuccessReceipt, {
        type: 'deposit',
        amount: '125.5',
        tokenSymbol: 'USDC',
        network: 'Arc_Testnet',
        txHash: TX_HASH,
        feeSponsored: true,
        isInline: true,
        onActionAgain: () => {},
      })
    )

    expect(markup).toContain('Network Fee:')
    expect(markup).toContain('Sponsored')
  })

  it('omits the fee row entirely when the receipt could not be read', () => {
    const markup = renderToStaticMarkup(
      React.createElement(UnifiedSuccessReceipt, {
        type: 'deposit',
        amount: '125.5',
        tokenSymbol: 'USDC',
        network: 'Arc_Testnet',
        txHash: TX_HASH,
        isInline: true,
        onActionAgain: () => {},
      })
    )

    expect(markup).not.toContain('Network Fee:')
    expect(markup).not.toContain('Approval Fee:')
  })
})
