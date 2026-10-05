import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../chainSwitchService', () => ({
  ensureNetwork: vi.fn(),
}))

import { ensureNetwork } from '../chainSwitchService'
import { patchViemAdapterChainSwitch } from '../sendService'

const amoyChain = { chainId: 80002, name: 'Polygon Amoy' }
const amoyError = new Error(
  'Failed to switch to chain Polygon Amoy (ID: 80002): An error occurred when attempting to switch chain.'
)

describe('patchViemAdapterChainSwitch resilient fallback', () => {
  beforeEach(() => {
    vi.mocked(ensureNetwork).mockReset()
  })

  it('recovers a real switch failure through the centralized wallet switcher', async () => {
    vi.mocked(ensureNetwork).mockResolvedValue({ success: true, chainId: 80002 })
    const adapter = {
      switchToChain: vi.fn().mockRejectedValue(amoyError),
    }
    const patched = patchViemAdapterChainSwitch(adapter, { request: vi.fn() })

    await expect(patched.switchToChain(amoyChain)).resolves.toBeUndefined()
    expect(ensureNetwork).toHaveBeenCalledWith(80002, expect.anything())
  })

  it('rethrows the original error when the resilient switch also fails', async () => {
    vi.mocked(ensureNetwork).mockResolvedValue({ success: false, error: 'canceled in wallet' })
    const adapter = {
      switchToChain: vi.fn().mockRejectedValue(amoyError),
    }
    const patched = patchViemAdapterChainSwitch(adapter, { request: vi.fn() })

    await expect(patched.switchToChain(amoyChain)).rejects.toThrow(
      'Failed to switch to chain Polygon Amoy (ID: 80002)'
    )
  })

  it('still bypasses method-not-supported errors without prompting the wallet', async () => {
    const adapter = {
      switchToChain: vi
        .fn()
        .mockRejectedValue(new Error('wallet_switchEthereumChain does not exist / is not available')),
    }
    const patched = patchViemAdapterChainSwitch(adapter, { request: vi.fn() })

    await expect(patched.switchToChain(amoyChain)).resolves.toBeUndefined()
    expect(ensureNetwork).not.toHaveBeenCalled()
  })

  it('recovers ensureChain failures the same way', async () => {
    vi.mocked(ensureNetwork).mockResolvedValue({ success: true, chainId: 80002 })
    const adapter = {
      switchToChain: vi.fn().mockRejectedValue(amoyError),
      ensureChain: vi.fn().mockRejectedValue(amoyError),
    }
    const patched = patchViemAdapterChainSwitch(adapter, { request: vi.fn() })

    await expect(patched.ensureChain(amoyChain)).resolves.toBeUndefined()
    expect(ensureNetwork).toHaveBeenCalledWith(80002, expect.anything())
  })
})
