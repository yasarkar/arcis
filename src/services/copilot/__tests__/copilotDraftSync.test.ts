import { describe, expect, it, vi, beforeEach } from 'vitest'
import type { CopilotActionPayload } from '../../../types/marketplace'

vi.mock('../../swapService', () => ({
  getSwapEstimate: vi.fn(),
}))

vi.mock('../copilotLpRemoveQuote', () => ({
  getCopilotLpRemoveQuote: vi.fn(),
}))

vi.mock('../../arcGasService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../arcGasService')>()
  return {
    ...actual,
    getDynamicArcGasOptions: vi.fn(),
  }
})

import { getSwapEstimate } from '../../swapService'
import { getDynamicArcGasOptions } from '../../arcGasService'
import { getCopilotLpRemoveQuote } from '../copilotLpRemoveQuote'
import { isSettingsSyncableDraft, syncDraftWithExecutionSettings } from '../copilotDraftSync'

describe('syncDraftWithExecutionSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getDynamicArcGasOptions).mockResolvedValue({
      isDynamic: true,
      maxFeePerGas: 30_000_000_000n,
      maxPriorityFeePerGas: 2_000_000_000n,
      baseFee: 20_000_000_000n,
      source: 'rpc',
    } as any)
  })

  it('updates swap slippageBps, minReceived, estimatedOut, and network fee from live quote & gas tier', async () => {
    vi.mocked(getSwapEstimate).mockResolvedValue({
      estimatedOutput: '92.50',
      stopLimit: '90.65',
      rate: '0.9250',
      fees: [],
    } as any)

    const draft: CopilotActionPayload = {
      type: 'interactive_swap',
      title: '🔄 Confirm Swap: 100 USDC ➔ 92.50 EURC',
      draftId: 'draft-1',
      revision: 1,
      data: {
        amount: 100,
        fromToken: 'USDC',
        toToken: 'EURC',
        slippageBps: 50,
        estimatedOut: '92.50',
        minReceived: '92.0375',
        estimatedFeeUsdc: '0.00240',
      },
    }

    const updated = await syncDraftWithExecutionSettings(
      draft,
      { copilotSlippage: 2.0, copilotSpeedTier: 'turbo' },
      '0x1111111111111111111111111111111111111111'
    )

    expect(updated).not.toBeNull()
    expect(updated?.draftId).toBe('draft-1')
    expect(updated?.revision).toBe(1)
    expect(updated?.data?.slippageBps).toBe(200)
    expect(updated?.data?.slippage).toBeUndefined()
    expect(updated?.data?.minReceived).toBe('90.65')
    expect(updated?.data?.estimatedOut).toBe('92.50')
    expect(updated?.data?.estimatedFeeUsdc).toBe('0.00360')
    expect(getSwapEstimate).toHaveBeenCalledWith(
      expect.objectContaining({
        tokenIn: 'USDC',
        tokenOut: 'EURC',
        amountIn: '100',
        slippageBps: 200,
      })
    )
    expect(getDynamicArcGasOptions).toHaveBeenCalledWith(undefined, 'turbo', 120_000n)
  })

  it('recalculates minReceived deterministically if live swap quote fails', async () => {
    vi.mocked(getSwapEstimate).mockRejectedValue(new Error('RPC timeout'))

    const draft: CopilotActionPayload = {
      type: 'interactive_swap',
      title: '🔄 Confirm Swap: 100 USDC ➔ 100 EURC',
      draftId: 'draft-2',
      revision: 1,
      data: {
        amount: 100,
        fromToken: 'USDC',
        toToken: 'EURC',
        slippageBps: 50,
        estimatedOut: '100',
        minReceived: '99.5',
      },
    }

    const updated = await syncDraftWithExecutionSettings(
      draft,
      { copilotSlippage: 1.5, copilotSpeedTier: 'standard' }
    )

    expect(updated?.data?.slippageBps).toBe(150)
    expect(updated?.data?.minReceived).toBe('98.5')
  })

  it('updates send card network fee using the exact native vs ERC-20 vs memo gas limit', async () => {
    const nativeSend: CopilotActionPayload = {
      type: 'interactive_send',
      title: 'Send 10 USDC',
      data: {
        amount: 10,
        tokenSymbol: 'USDC',
        recipient: '0x2222222222222222222222222222222222222222',
        estimatedFeeUsdc: '0.00042',
      },
    }

    const updatedNative = await syncDraftWithExecutionSettings(
      nativeSend,
      { copilotSlippage: 0.5, copilotSpeedTier: 'turbo' }
    )
    expect(getDynamicArcGasOptions).toHaveBeenCalledWith(undefined, 'turbo', 21_000n)
    expect(updatedNative?.data?.estimatedFeeUsdc).toBe('0.00063')

    const memoSend: CopilotActionPayload = {
      ...nativeSend,
      data: { ...nativeSend.data, memo: 'Invoice #42' },
    }
    await syncDraftWithExecutionSettings(
      memoSend,
      { copilotSlippage: 0.5, copilotSpeedTier: 'fast' }
    )
    expect(getDynamicArcGasOptions).toHaveBeenCalledWith(undefined, 'fast', 75_000n)
  })

  it('updates deposit card network fee when gas speed tier changes', async () => {
    const depositDraft: CopilotActionPayload = {
      type: 'interactive_deposit',
      title: 'Deposit 50 USDC',
      data: {
        amount: 50,
        tokenSymbol: 'USDC',
      },
    }

    const updated = await syncDraftWithExecutionSettings(
      depositDraft,
      { copilotSlippage: 0.5, copilotSpeedTier: 'turbo' }
    )
    expect(getDynamicArcGasOptions).toHaveBeenCalledWith(undefined, 'turbo', 120_000n)
    expect(updated?.data?.estimatedFeeUsdc).toBe('0.00360')
  })

  it('ignores non-transactional payloads', async () => {
    const nonTx: CopilotActionPayload = {
      type: 'configure_session',
      title: 'Open Session Settings',
      data: {},
    }
    expect(isSettingsSyncableDraft(nonTx)).toBe(false)
    const updated = await syncDraftWithExecutionSettings(
      nonTx,
      { copilotSlippage: 1.0, copilotSpeedTier: 'fast' }
    )
    expect(updated).toBeNull()
  })

  it('live-syncs interactive_lp_remove slippage, minOutA/minOutB, and fee estimate (ARCO-06)', async () => {
    vi.mocked(getCopilotLpRemoveQuote).mockResolvedValue({
      ok: true,
      quote: {
        removeMode: 'percent',
        removePercent: 50,
        lpAmount: 10,
        lpAmountDecimal: '10',
        lpAmountRaw: '10000000',
        userLpBalanceDecimal: '20',
        estimatedOutA: '50',
        estimatedOutB: '46',
        minOutA: '49.5',
        minOutB: '45.54',
        minOutARaw: '49500000',
        minOutBRaw: '45540000',
        estimatedWithdrawUsd: 99.68,
        slippageBps: 100,
        estimatedFeeUsdc: '0.00420',
        feeEstimateSource: 'rpc',
      },
    })

    const lpRemoveDraft: CopilotActionPayload = {
      type: 'interactive_lp_remove',
      title: 'Remove 50% LP from USDC/EURC',
      draftId: 'draft-lp-rm-1',
      revision: 1,
      data: {
        poolId: 'usdc-eurc-stable-pool',
        removeMode: 'percent',
        removePercent: 50,
        slippageBps: 50,
        minOutA: '49.75',
        minOutB: '45.77',
        estimatedFeeUsdc: '0.00240',
      },
    }

    expect(isSettingsSyncableDraft(lpRemoveDraft)).toBe(true)
    const updated = await syncDraftWithExecutionSettings(
      lpRemoveDraft,
      { copilotSlippage: 1.0, copilotSpeedTier: 'turbo' },
      '0x1111111111111111111111111111111111111111'
    )

    expect(updated?.data?.slippageBps).toBe(100)
    expect(updated?.data?.minOutA).toBe('49.5')
    expect(updated?.data?.minOutB).toBe('45.54')
    expect(updated?.data?.minOutARaw).toBe('49500000')
    expect(updated?.data?.minOutBRaw).toBe('45540000')
    expect(updated?.data?.estimatedFeeUsdc).toBe('0.00420')
    expect(getCopilotLpRemoveQuote).toHaveBeenCalledWith(
      expect.objectContaining({
        walletAddress: '0x1111111111111111111111111111111111111111',
        removePercent: 50,
        slippageBps: 100,
        speedTier: 'turbo',
      })
    )
  })

  it('keeps previous slippageBps consistent if LP remove quote throws while still refreshing gas fee (ARCO-06)', async () => {
    vi.mocked(getCopilotLpRemoveQuote).mockRejectedValue(new Error('RPC temporary failure'))

    const lpRemoveDraft: CopilotActionPayload = {
      type: 'interactive_lp_remove',
      title: 'Remove 50% LP from USDC/EURC',
      data: {
        poolId: 'usdc-eurc-stable-pool',
        removeMode: 'percent',
        removePercent: 50,
        slippageBps: 50,
        minOutA: '49.75',
        minOutB: '45.77',
        estimatedFeeUsdc: '0.00240',
      },
    }

    const updated = await syncDraftWithExecutionSettings(
      lpRemoveDraft,
      { copilotSlippage: 2.0, copilotSpeedTier: 'turbo' },
      '0x1111111111111111111111111111111111111111'
    )

    expect(updated?.data?.slippageBps).toBe(50)
    expect(updated?.data?.minOutA).toBe('49.75')
    expect(updated?.data?.estimatedFeeUsdc).toBe('0.00360')
  })

  it('live-syncs interactive_claim_fees network fee scaled by pool count (ARCO-06)', async () => {
    const claimDraft: CopilotActionPayload = {
      type: 'interactive_claim_fees',
      title: 'Claim All Fees',
      draftId: 'draft-claim-1',
      revision: 1,
      data: {
        claimPools: [
          {
            poolId: 'usdc-eurc-stable-pool',
            poolName: 'USDC / EURC',
            poolAddress: '0x1111111111111111111111111111111111111111',
            isVault: false,
            tokenA: 'USDC',
            tokenB: 'EURC',
            feeADecimal: '1.2',
            feeARaw: '1200000',
            estimatedUsd: 1.2,
          },
          {
            poolId: 'usdc-cirbtc-pool',
            poolName: 'USDC / cirBTC',
            poolAddress: '0x2222222222222222222222222222222222222222',
            isVault: false,
            tokenA: 'USDC',
            tokenB: 'cirBTC',
            feeADecimal: '2.5',
            feeARaw: '2500000',
            estimatedUsd: 2.5,
          },
        ],
        estimatedFeeUsdc: '0.00400',
      },
    }

    expect(isSettingsSyncableDraft(claimDraft)).toBe(true)
    const updated = await syncDraftWithExecutionSettings(
      claimDraft,
      { copilotSlippage: 1.0, copilotSpeedTier: 'turbo' },
      '0x1111111111111111111111111111111111111111'
    )

    expect(getDynamicArcGasOptions).toHaveBeenCalledWith(undefined, 'turbo', 240_000n)
    expect(updated?.data?.estimatedFeeUsdc).toBe('0.00720')
  })
})
