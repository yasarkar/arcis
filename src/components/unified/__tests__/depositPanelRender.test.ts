// src/components/unified/__tests__/depositPanelRender.test.ts
// Server-render smoke test for the extracted Gateway deposit panel: the form, its
// keyboard-accessible chain selector and the decimal amount input must render together.

import { describe, expect, it, vi } from 'vitest'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

vi.mock('wagmi', () => ({
  useAccount: () => ({ chainId: 5042002, connector: undefined }),
}))
vi.mock('../../BroadcastNotification', () => ({
  useBroadcast: () => ({ addBroadcast: vi.fn(() => 'broadcast-1'), updateBroadcast: vi.fn() }),
}))
vi.mock('../../../services/gatewayService', () => ({
  depositToGateway: vi.fn(),
  resolvePaidNetworkFee: vi.fn(),
}))
vi.mock('../../../services/chainSwitchService', () => ({ ensureNetwork: vi.fn() }))
vi.mock('../../../services/rpc', () => ({
  getResilientPublicClient: vi.fn(),
  resilientWaitForReceipt: vi.fn(),
}))
vi.mock('../../../services/gatewayUcwService', () => ({
  mapChainKeyToCircleBlockchain: vi.fn((key: string) => key),
}))
vi.mock('../../../hooks/useAutoSwitchArcChain', () => ({ setAutoSwitchPaused: vi.fn() }))
vi.mock('../../../utils/errorNormalizer', () => ({
  normalizeAppError: vi.fn((err: unknown) => ({
    message: String(err),
    isCanceled: false,
    title: '',
  })),
}))

import DepositPanel from '../DepositPanel'

function renderPanel(overrides: Record<string, unknown> = {}) {
  return renderToStaticMarkup(
    React.createElement(DepositPanel, {
      walletAddress: '0x0000000000000000000000000000000000000001',
      walletConnected: true,
      activeAuthSource: 'evm',
      walletBalances: {},
      walletBalancesLoading: false,
      walletBalancesFetching: false,
      walletBalancesReady: true,
      onRefetchWalletBalances: vi.fn(),
      onClose: vi.fn(),
      onSuccess: vi.fn(),
      ...overrides,
    }) as any
  )
}

describe('DepositPanel render', () => {
  it('renders the deposit form with an accessible chain selector and decimal amount input', () => {
    const markup = renderPanel()

    expect(markup).toContain('NETWORK')
    expect(markup).toContain('AMOUNT')
    expect(markup).toContain('DEPOSIT USDC TO GATEWAY')
    expect(markup).toContain('ub-select-trigger')
    expect(markup).toContain('aria-haspopup="listbox"')
    expect(markup).toContain('aria-expanded="false"')
    expect(markup).toContain('inputMode="decimal"')
    expect(markup).toContain('id="ub-deposit-amount"')
    expect(markup).toContain('aria-describedby="ub-deposit-amount-available"')
    // Chain menu is closed until the user opens it.
    expect(markup).not.toContain('role="listbox"')
    // MAX is disabled while the available balance is zero/loading.
    expect(markup).toContain('disabled')
  })

  it('does not attempt a network switch label when the wallet already sits on the deposit chain', () => {
    const markup = renderPanel()
    expect(markup).not.toContain('&amp; DEPOSIT')
    expect(markup).not.toContain('SWITCH TO')
  })
})
