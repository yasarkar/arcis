// src/components/copilot/__tests__/inlineActionCardTemplates.test.ts
// Verifies the institutionalized, standardized Copilot action card templates:
// - Unified card shell (header with badge, hero asset panel, details table, action buttons)
// - Operation-specific headers, badges, metrics, and breakdown fields for Swap, Send, Bridge, Yield, and Session

import { describe, it, expect, vi } from 'vitest'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
vi.mock('../../../services/soundService', () => ({ playSound: vi.fn() }))
vi.mock('../../../services/tokenPriceService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../services/tokenPriceService')>()
  return {
    ...actual,
    getLiveTokenPrices: vi.fn().mockResolvedValue({
      USDC: 1,
      EURC: 1.08,
      cirBTC: 65000,
    }),
  }
})

import InlineActionCard, { buildActionAgainCommand } from '../InlineActionCard'
import type { CopilotMessage, CopilotActionPayload } from '../../../types/marketplace'

function renderAction(actionPayload: CopilotActionPayload): string {
  const message: CopilotMessage = {
    id: 'msg-preview-1',
    role: 'assistant',
    content: 'Review the transaction below',
    timestamp: Date.now(),
    actionPayload,
  }

  return renderToStaticMarkup(
    React.createElement(InlineActionCard, {
      message,
      onExecuteInline: async () => {},
      onNavigateToTab: () => {},
      onCloseDrawer: () => {},
    })
  )
}

describe('InlineActionCard Institutional Templates', () => {
  it('preserves the approved tolerance when preparing Swap Again', () => {
    expect(buildActionAgainCommand(undefined, { type: 'interactive_swap', title: '', data: {
      amount: 10, fromToken: 'USDC', toToken: 'EURC', slippageBps: 10,
    } })).toBe('swap 10 USDC to EURC slippage 0.1%')
  })

  it.each([10, 50, 100, 200])('shows canonical %s bps and the exact signed minimum', slippageBps => {
    const html = renderAction({ type: 'interactive_swap', title: '', data: {
      amount: 50, fromToken: 'USDC', toToken: 'cirBTC', estimatedOut: '0.00000123',
      minReceived: '0.00000121', slippageBps,
    } })
    expect(html).toContain(`${slippageBps / 100}%`)
    expect(html).toContain('0.00000121 cirBTC')
    expect(html).not.toContain('disabled=""')
  })

  it.each([{ slippageBps: 1, minReceived: '45' }, { slippageBps: 100, minReceived: undefined },
    { slippageBps: 100, slippage: 0.1, minReceived: '45' }])('disables unsafe or conflicting swap cards', fields => {
    const html = renderAction({ type: 'interactive_swap', title: '', data: {
      amount: 50, fromToken: 'USDC', toToken: 'EURC', estimatedOut: '46', ...fields,
    } })
    expect(html).toContain('disabled=""')
  })
  it('renders a standardized Swap Order template with operation header, hero conversion and pool specs', () => {
    const html = renderAction({
      type: 'interactive_swap',
      title: 'Swap 50 USDC to EURC',
      data: {
        amount: 50,
        fromToken: 'USDC',
        toToken: 'EURC',
        estimatedOut: 46.25,
        minReceived: '45.8',
        slippageBps: 50,
        estimatedFeeUsdc: 0.00053,
      },
    })

    // Header
    expect(html).toContain('Token Swap')
    expect(html).toContain('Arc Testnet AMM')

    // Hero Panel (You Pay -> You Receive)
    expect(html).toContain('You Pay')
    expect(html).toContain('50')
    expect(html).toContain('You Receive')
    expect(html).toContain('~46.25')

    // Details Rows
    expect(html).toContain('Exchange Rate')
    expect(html).toContain('1 USDC ≈ 0.9250 EURC')
    expect(html).toContain('Minimum Received')
    expect(html).toContain('45.8 EURC')
    expect(html).toContain('Slippage Tolerance')
    expect(html).toContain('0.5%')
    expect(html).toContain('Network Fee')

    // Action Buttons
    expect(html).toContain('Confirm Swap')
    expect(html).toContain('Swap Page')
  })

  it('renders Quote Required when Swap quote is not available', () => {
    const html = renderAction({
      type: 'interactive_swap',
      title: 'Swap 10 USDC to EURC',
      data: {
        amount: 10,
        fromToken: 'USDC',
        toToken: 'EURC',
        estimatedOut: 0,
      },
    })

    expect(html).toContain('Quote Required')
    expect(html).toContain('disabled=""')
  })

  it('renders a standardized Direct Transfer template with recipient copy button, memo, and L1 gas note', () => {
    const html = renderAction({
      type: 'interactive_send',
      title: 'Send 25 USDC',
      data: {
        amount: 25,
        tokenSymbol: 'USDC',
        recipient: '0x5f8f4cc0403332fc9c22a23222ddb9b267bf2e70',
        memo: 'Invoice 1024',
        estimatedFeeUsdc: 0.000053,
      },
    })

    // Header & Theme (matches Cross-Chain Bridge indigo theme, no sky/blue classes)
    expect(html).toContain('Token Transfer')
    expect(html).toContain('Arc Testnet')
    expect(html).toContain('border-indigo-500/40')
    expect(html).toContain('text-indigo-400')
    expect(html).not.toContain('sky-')

    // Hero Panel
    expect(html).toContain('Send Amount')
    expect(html).toContain('25')

    // Details Rows
    expect(html).toContain('Recipient')
    expect(html).toContain('0x5f8f4c...bf2e70')
    expect(html).toContain('<button')
    expect(html).toContain('Memo')
    expect(html).toContain('Invoice 1024')
    expect(html).toContain('Network')
    expect(html).toContain('Arc Testnet')
    expect(html).toContain('Network Fee')
    expect(html).toContain('Finality')
    expect(html).toContain('Instant')

    // Buttons
    expect(html).toContain('Confirm Transfer')
    expect(html).toContain('Send Page')
  })

  it('renders a standardized Cross-Chain Bridge template with route badges, CCTP indicator and speed', () => {
    const html = renderAction({
      type: 'interactive_bridge',
      title: 'Bridge 100 USDC',
      data: {
        amount: 100,
        fromChain: 'Arc Testnet',
        toChain: 'Base Sepolia',
      },
    })

    // Header
    expect(html).toContain('Cross-Chain Bridge')
    expect(html).toContain('Circle Gateway')

    // Hero Panel
    expect(html).toContain('Bridge Amount')
    expect(html).toContain('100')
    expect(html).toContain('Base Sepolia')

    // Details Rows
    expect(html).toContain('Bridge Route')
    expect(html).toContain('Arc Testnet')
    expect(html).toContain('Base Sepolia')
    expect(html).toContain('Circle Gateway')
    expect(html).toContain('Transfer Speed')
    expect(html).toContain('Protocol Fee')
    expect(html).toContain('0 USDC')

    // Buttons
    expect(html).toContain('Confirm Bridge')
    expect(html).toContain('Bridge Page')
  })

  it('renders a standardized Yield Vault Deposit template with APY, strategy and 1Y yield projection', () => {
    const html = renderAction({
      type: 'interactive_deposit',
      title: 'Deposit 200 USDC into YieldVault',
      data: {
        amount: 200,
        estimatedYieldUsdcYearly: 16.84,
      },
    })

    // Header
    expect(html).toContain('Yield Vault Deposit')
    expect(html).toContain('Continuous Compounding')

    // Hero Panel
    expect(html).toContain('Deposit Amount')
    expect(html).toContain('200')
    expect(html).toContain('Est. 1Y Yield')
    expect(html).toContain('<span>+</span>')
    expect(html).toContain('16.84')
    expect(html).toContain('Variable APY (~8.4%)')

    // Details Rows
    expect(html).toContain('Vault Strategy')
    expect(html).toContain('USDC Yield Vault')
    expect(html).toContain('APY')
    expect(html).toContain('Variable (Simulated ~8.4%)')
    expect(html).toContain('Continuous (Per-Block)')
    expect(html).toContain('None (Instant Liquidity)')

    // Buttons
    expect(html).toContain('Confirm Deposit')
    expect(html).toContain('Pool Page')
  })

  it('renders a standardized LP Pool Deposit card for 1-Click Zap and Dual-Asset with slippage guard', () => {
    const zapHtml = renderAction({
      type: 'interactive_lp_deposit',
      title: 'Zap 100 USDC into USDC / EURC LP',
      data: {
        poolId: 'usdc-eurc-stable-pool',
        poolName: 'USDC / EURC',
        lpMode: 'zap',
        tokenA: 'USDC',
        tokenB: 'EURC',
        amount: 100,
        amountA: 100,
        amountADecimal: '100',
        lpTokenSymbol: 'afUSDC-EURC',
        estimatedLpOut: '99.500000',
        minLpShares: '99.002500',
        minLpSharesRaw: '99002500000000000000',
        poolSharePct: 0.512,
        feeTierPercent: 0.12,
        apy: '6.15% APR',
        impermanentLossRisk: 'Zero (Stable)',
        slippageBps: 50,
        estimatedFeeUsdc: '0.00125',
      },
    })

    expect(zapHtml).toContain('USDC / EURC Pool')
    expect(zapHtml).toContain('1-Click Zap')
    expect(zapHtml).toContain('afUSDC-EURC')
    expect(zapHtml).toContain('Confirm 1-Click Zap')
    expect(zapHtml).toContain('max-w-[390px]')
    expect(zapHtml).not.toContain('disabled=""')

    const unguardedDualHtml = renderAction({
      type: 'interactive_lp_deposit',
      title: 'Add Liquidity: EURC / WETH',
      data: {
        poolId: 'eurc-weth-pool',
        poolName: 'EURC / WETH',
        lpMode: 'dual',
        tokenA: 'EURC',
        tokenB: 'WETH',
        amountA: 100,
        amountB: 0.04,
        slippageBps: 50,
      },
    })
    expect(unguardedDualHtml).toContain('You Supply')
    expect(unguardedDualHtml).toContain('max-w-[620px]')
    expect(unguardedDualHtml).toContain('flex-nowrap')
    expect(unguardedDualHtml).toContain('>+<')
    expect(unguardedDualHtml).toContain('Quote Required')
    expect(unguardedDualHtml).toContain('disabled=""')

    expect(
      buildActionAgainCommand(undefined, {
        type: 'interactive_lp_deposit',
        title: '',
        data: { poolId: 'usdc-eurc-stable-pool', poolName: 'USDC / EURC', lpMode: 'zap', amountA: 50 },
      })
    ).toBe('zap 50 USDC into USDC / EURC pool')

    expect(
      buildActionAgainCommand(undefined, {
        type: 'interactive_lp_deposit',
        title: '',
        data: { poolId: 'eurc-weth-pool', poolName: 'EURC / WETH', lpMode: 'dual', tokenA: 'EURC', tokenB: 'WETH', amountA: 100, amountB: 0.04 },
      })
    ).toBe('add 100 EURC and 0.04 WETH to EURC / WETH pool')
  })

  it('renders a Claim All Fees confirmation card with per-pool breakdown', () => {
    const html = renderAction({
      type: 'interactive_claim_fees',
      title: 'Claim All Fees',
      data: {
        claimScope: 'all',
        totalClaimableUsd: 5.08,
        estimatedFeeUsdc: '0.00110',
        claimPools: [
          {
            poolId: 'usdc-eurc-stable-pool',
            poolName: 'USDC / EURC',
            poolAddress: '0xC3EdDA15AdfaC31ADfC23aC86dC96d791f72bE8a',
            isVault: false,
            tokenA: 'USDC',
            tokenB: 'EURC',
            feeADecimal: '1.5',
            feeBDecimal: '1',
            feeARaw: '1500000',
            feeBRaw: '1000000',
            estimatedUsd: 2.58,
          },
          {
            poolId: 'usdc-yield-vault',
            poolName: 'USDC Yield Vault',
            poolAddress: '0xb2a6D2BF896b431a77FB9198519fE334Caf39e9A',
            isVault: true,
            tokenA: 'USDC',
            feeADecimal: '2.5',
            feeARaw: '2500000',
            estimatedUsd: 2.5,
          },
        ],
      },
    })

    expect(html).toContain('Claim All Fees')
    expect(html).toContain('Total Claimable')
    expect(html).toContain('4') // 1.5 USDC + 2.5 USDC aggregated
    expect(html).toContain('USDC')
    expect(html).toContain('>+<')
    expect(html).toContain('EURC')
    expect(html).toContain('$5.0800 USD')
    expect(html).toContain('Network Fee')
    expect(html).not.toContain('USDC Yield Vault')
    expect(html).toContain('Confirm Claim All (2)')
    expect(html).not.toContain('disabled=""')
    expect(buildActionAgainCommand(undefined, { type: 'interactive_claim_fees', title: '', data: { claimScope: 'all' } })).toBe('claim all fees')
  })

  it('renders an AMM LP Remove confirmation card with side-by-side You Receive, You Remove, and slippage guard', () => {
    const html = renderAction({
      type: 'interactive_lp_remove',
      title: 'Remove 50% LP from USDC / EURC',
      data: {
        poolId: 'usdc-eurc-stable-pool',
        poolName: 'USDC / EURC',
        tokenA: 'USDC',
        tokenB: 'EURC',
        lpTokenSymbol: 'afUSDC-EURC',
        removeMode: 'percent',
        removePercent: 50,
        lpAmount: 50,
        lpAmountDecimal: '50',
        lpAmountRaw: '50000000000000000000',
        estimatedOutA: '50',
        estimatedOutB: '45',
        minOutA: '49.75',
        minOutB: '44.775',
        minOutARaw: '49750000',
        minOutBRaw: '44775000',
        estimatedWithdrawUsd: 98.6,
        slippageBps: 50,
        estimatedFeeUsdc: '0.00095',
      },
    })

    expect(html).toContain('USDC / EURC Remove LP')
    expect(html).toContain('You Receive')
    expect(html).toContain('You Remove')
    expect(html).toContain('50')
    expect(html).toContain('45')
    expect(html).toContain('Min. Received')
    expect(html).toContain('49.75 USDC + 44.775 EURC')
    expect(html).toContain('Confirm Remove LP')
    expect(html).toContain('max-w-[620px]')
    expect(html).not.toContain('disabled=""')

    // Missing minOut guards disables Confirm
    const unguarded = renderAction({
      type: 'interactive_lp_remove',
      title: 'Remove 50% LP from USDC / EURC',
      data: {
        poolId: 'usdc-eurc-stable-pool',
        poolName: 'USDC / EURC',
        lpAmountRaw: '50000000000000000000',
        slippageBps: 50,
      },
    })
    expect(unguarded).toContain('Quote Required')
    expect(unguarded).toContain('disabled=""')

    expect(
      buildActionAgainCommand(undefined, {
        type: 'interactive_lp_remove',
        title: '',
        data: { poolName: 'USDC / EURC', removeMode: 'percent', removePercent: 50 },
      })
    ).toBe('remove 50% LP from USDC / EURC pool')
  })

  it('renders a standardized Session Security Configuration template with header and action button', () => {
    const html = renderAction({
      type: 'configure_session',
      title: 'Configure Autonomous Session Policy',
      data: {},
    })

    // Header
    expect(html).toContain('Session Key Authorization')
    expect(html).toContain('Smart Account Policy')

    // Omitted Hero and Details
    expect(html).not.toContain('Authorize an ephemeral ECDSA session key')
    expect(html).not.toContain('Execution Mode')
    expect(html).not.toContain('Gas Paymaster')
    expect(html).not.toContain('Spending Policy')
    expect(html).not.toContain('Key Storage')

    // Button
    expect(html).toContain('Configure Autonomous Session Policy')
    expect(html).toContain('linear-gradient(135deg, #9896ff 0%, #7c3aed 100%)')
    expect(html).not.toContain('#ffaa6b')
  })

  it('renders subscript zero notation for tiny crypto amounts like cirBTC (0.00000035 -> 0.0₆35)', () => {
    const html = renderAction({
      type: 'interactive_send',
      title: 'Transfer 0.00000035 cirBTC',
      data: {
        amount: 0.00000035,
        tokenSymbol: 'cirBTC',
        recipient: '0x1234567890123456789012345678901234567890',
        network: 'Arc Testnet',
      },
    })

    expect(html).toContain('0.0₆35')
    expect(html).toContain('cirBTC')
  })

  // ARC-025: the card is the only confirmation screen, so a recipient the browser has never paid
  // and a tolerance wider than 1% are surfaced before the confirm button, not after.
  it('warns before confirming a transfer to an unseen recipient', () => {
    const html = renderAction({
      type: 'interactive_send',
      title: 'Send 25 USDC',
      data: {
        amount: 25,
        tokenSymbol: 'USDC',
        recipient: '0x9d2f5f5f0f4e2f5b2c1a3d4e5f60718293a4b5c6',
      },
    })

    expect(html).toContain('Pre-confirmation warnings')
    expect(html).toContain('First transfer to this address')
  })

  it('warns before confirming a swap whose slippage exceeds the caution line', () => {
    const html = renderAction({
      type: 'interactive_swap',
      title: 'Swap 50 USDC to EURC',
      data: {
        amount: 50,
        fromToken: 'USDC',
        toToken: 'EURC',
        estimatedOut: '46.25',
        minReceived: '45.5',
        slippageBps: 150,
      },
    })

    expect(html).toContain('Pre-confirmation warnings')
    expect(html).toContain('Slippage tolerance is 1.5%')
  })

  it('shows no slippage warning at the 1% caution line', () => {
    const html = renderAction({
      type: 'interactive_swap',
      title: 'Swap 50 USDC to EURC',
      data: {
        amount: 50,
        fromToken: 'USDC',
        toToken: 'EURC',
        estimatedOut: '46.25',
        minReceived: '45.8',
        slippageBps: 100,
      },
    })

    expect(html).not.toContain('Pre-confirmation warnings')
    expect(html).not.toContain('Slippage tolerance is 1%')
  })
})
