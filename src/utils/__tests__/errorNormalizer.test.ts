import { describe, it, expect } from 'vitest'
import { normalizeAppError } from '../errorNormalizer'

describe('errorNormalizer', () => {
  it('correctly maps Viem rate-limited revert error to RPC_LIMIT_EXCEEDED instead of CONTRACT_REVERT', () => {
    const viemRateLimitErr = new Error(
      'ContractFunctionExecutionError: The contract function "deposit" reverted with the following reason:\nRequest is being rate limited.\n\nContract Call:\n  address: 0x5e618f7f6591868827da40f73f869e3dE8F387CD\n  function: deposit(uint256 assets, address receiver)'
    )

    const normalized = normalizeAppError(viemRateLimitErr)
    expect(normalized.code).toBe('RPC_LIMIT_EXCEEDED')
    expect(normalized.category).toBe('RPC_NETWORK')
    expect(normalized.isRetryable).toBe(true)
    expect(normalized.message).not.toContain('Smart contract rejected')
  })

  it('correctly maps genuine contract revert errors to CONTRACT_REVERT', () => {
    const realRevertErr = new Error(
      'The contract function "deposit" reverted with the following reason:\nERC4626: deposit more than max'
    )

    const normalized = normalizeAppError(realRevertErr)
    expect(normalized.code).toBe('CONTRACT_REVERT')
    expect(normalized.message).toContain('ERC4626: deposit more than max')
  })

  it('correctly identifies user canceled errors', () => {
    const userRejectErr = {
      code: 4001,
      message: 'User rejected the request.',
    }

    const normalized = normalizeAppError(userRejectErr)
    expect(normalized.isCanceled).toBe(true)
    expect(normalized.code).toBe('USER_CANCELED')
  })

  it('correctly identifies network switch cancellations instead of misclassifying as NETWORK_TIMEOUT', () => {
    const networkSwitchErr = new Error('The network switch request was canceled in the wallet.')

    const normalized = normalizeAppError(networkSwitchErr)
    expect(normalized.isCanceled).toBe(true)
    expect(normalized.code).toBe('NETWORK_SWITCH_CANCELED')
    expect(normalized.title).toBe('Network Switch Canceled')
    expect(normalized.message).toContain('The network switch request was canceled in your wallet')
    expect(normalized.message).not.toContain('The Arc L1 RPC node did not respond')
  })

  it('correctly identifies network switch cancellation with explicit isNetworkSwitchCanceled flag', () => {
    const customErr: any = new Error('Wallet is not connected to target network.')
    customErr.isCanceled = true
    customErr.isNetworkSwitchCanceled = true

    const normalized = normalizeAppError(customErr)
    expect(normalized.isCanceled).toBe(true)
    expect(normalized.code).toBe('NETWORK_SWITCH_CANCELED')
    expect(normalized.title).toBe('Network Switch Canceled')
  })

  it('correctly normalizes wallet request already pending (-32002) with WALLET_DESYNC category', () => {
    const pendingErr = {
      code: -32002,
      message: 'Resource unavailable - request already pending for origin',
    }

    const normalized = normalizeAppError(pendingErr)
    expect(normalized.category).toBe('WALLET_DESYNC')
    expect(normalized.code).toBe('REQUEST_ALREADY_PENDING')
    expect(normalized.title).toBe('Wallet Request Pending')
    expect(normalized.isRetryable).toBe(true)
  })
})
