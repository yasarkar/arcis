import { describe, it, expect, vi, beforeEach } from 'vitest'

const { bridgeMock, onMock, offMock } = vi.hoisted(() => ({
  bridgeMock: vi.fn(),
  onMock: vi.fn(),
  offMock: vi.fn(),
}))

vi.mock('@circle-fin/app-kit', () => ({
  AppKit: class {
    on = onMock
    off = offMock
    bridge = (...args: any[]) => bridgeMock(...args)
    estimateBridge = vi.fn()
    getSupportedChains = vi.fn(() => [])
  },
}))

import { executeBridge } from '../bridgeService'

const burnHash = `0x${'ab'.repeat(32)}`

const baseParams = {
  fromChain: 'Base_Sepolia',
  toChain: 'Optimism_Sepolia',
  amount: '25',
  sourceAdapter: { provider: null },
  recipientAddress: `0x${'11'.repeat(20)}`,
  useForwarder: true,
  transferSpeed: 'FAST' as const,
}

describe('executeBridge failure recovery', () => {
  beforeEach(() => {
    bridgeMock.mockReset()
    onMock.mockReset()
    offMock.mockReset()
  })

  it('attaches the sanitized partial result so a post-burn failure can be recovered', async () => {
    bridgeMock.mockResolvedValue({
      state: 'error',
      steps: [
        { name: 'approve', state: 'success', txHash: `0x${'aa'.repeat(32)}`, receipt: { heavy: 'payload' } },
        { name: 'burn', state: 'success', txHash: burnHash, explorerUrl: `https://explorer/tx/${burnHash}` },
        { name: 'mint', state: 'error', errorMessage: 'destination mint reverted' },
      ],
    })

    let caught: any
    try {
      await executeBridge(baseParams)
    } catch (err) {
      caught = err
    }

    expect(caught).toBeInstanceOf(Error)
    expect(caught.message).toContain('destination mint reverted')

    // Recovery context: the caller can see the source burn already succeeded...
    expect(Array.isArray(caught.bridgeResult?.steps)).toBe(true)
    const steps = caught.bridgeResult.steps
    expect(steps).toHaveLength(3)
    const burnStep = steps.find((s: any) => s.name === 'burn')
    expect(burnStep.state).toBe('success')
    expect(burnStep.txHash).toBe(burnHash)

    // ...while heavy receipt payloads are stripped before the error escapes.
    expect(steps[0].receipt).toBeUndefined()
    expect(JSON.stringify(caught.bridgeResult).length).toBeLessThan(2000)
  })

  it('does not attach a bridgeResult to wallet-level errors (nothing was burned)', async () => {
    bridgeMock.mockRejectedValue(new Error('User rejected the request'))

    let caught: any
    try {
      await executeBridge(baseParams)
    } catch (err) {
      caught = err
    }

    expect(caught?.message).toBe('User rejected the request')
    expect(caught?.bridgeResult).toBeUndefined()
  })

  it('always disables batchTransactions so approve and burn run sequentially', async () => {
    bridgeMock.mockResolvedValue({ state: 'success', steps: [] })

    await executeBridge(baseParams)

    expect(bridgeMock).toHaveBeenCalledTimes(1)
    const sent = bridgeMock.mock.calls[0][0]
    expect(sent.config.batchTransactions).toBe(false)
    expect(sent.token).toBe('USDC')

    // Lifecycle listener is always cleaned up.
    expect(onMock).toHaveBeenCalledWith('*', expect.any(Function))
    expect(offMock).toHaveBeenCalledWith('*', expect.any(Function))
  })
})
