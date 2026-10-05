// src/components/unified/__tests__/assetDistributionPending.test.ts
// The asset breakdown must label pending (not yet indexed) deposits on the chain that
// received them, and amounts must render with grouped thousands.

import { describe, expect, it, vi } from 'vitest'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

vi.mock('@web3icons/react/dynamic', () => ({
  NetworkIcon: () => React.createElement('span', { 'data-testid': 'network-icon' }),
}))

import AssetDistributionList from '../AssetDistributionList'

describe('AssetDistributionList pending transparency', () => {
  it('shows the pending badge only on the chain that received the deposit', () => {
    const markup = renderToStaticMarkup(
      React.createElement(AssetDistributionList, {
        balances: [
          { domain: 0, chainKey: 'Base_Sepolia', name: 'Base Sepolia', balance: '125.00', status: 'success' as const },
          { domain: 1, chainKey: 'Arc_Testnet', name: 'Arc Testnet', balance: '0.00', status: 'success' as const },
        ],
        total: 125,
        loading: false,
        hasError: false,
        walletAddress: '0x0000000000000000000000000000000000000001',
        pendingByChain: { Base_Sepolia: 25 },
        onDeposit: () => {},
      })
    )

    expect(markup).toContain('25.00 PENDING')
    expect(markup).toContain('125.00')
    expect(markup.match(/PENDING/g)).toHaveLength(1)
  })

  it('renders grouped thousands for large balances', () => {
    const markup = renderToStaticMarkup(
      React.createElement(AssetDistributionList, {
        balances: [
          { domain: 0, chainKey: 'Base_Sepolia', name: 'Base Sepolia', balance: '1234.50', status: 'success' as const },
        ],
        total: 1234.5,
        loading: false,
        hasError: false,
        walletAddress: '0x0000000000000000000000000000000000000001',
        onDeposit: () => {},
      })
    )

    expect(markup).toContain('1,234.50')
  })
})
