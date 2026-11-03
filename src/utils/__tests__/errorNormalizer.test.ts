import { describe, it, expect } from 'vitest'
import { detectPoolCustomError, normalizeAppError } from '../errorNormalizer'
import { MIN_DIRECT_BRIDGE_AMOUNT } from '../../config/constants'

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

  it('correctly maps MetaMask RPC endpoint circuit breaker error to RPC_LIMIT_EXCEEDED instead of CONTRACT_REVERT', () => {
    const mmRpcErr = new Error(
      'The contract function "deposit" reverted with the following reason:\nRPC endpoint returned too many errors, retrying in 0,46 minutes. Consider using a different RPC endpoint.'
    )

    const normalized = normalizeAppError(mmRpcErr)
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

  it('correctly normalizes Circle insufficient native gas error to INSUFFICIENT_NATIVE_GAS with clear English guidance', () => {
    const circleGasErr = new Error('the asset amount owned by the wallet is insufficient for the transaction')

    const normalized = normalizeAppError(circleGasErr)
    expect(normalized.code).toBe('INSUFFICIENT_NATIVE_GAS')
    expect(normalized.category).toBe('INSUFFICIENT_GAS')
    expect(normalized.title).toBe('Insufficient Native Gas (ETH)')
    expect(normalized.message).toContain('native gas tokens (ETH)')
    expect(normalized.message).toContain('fund your wallet with testnet ETH')
  })

  it('correctly normalizes Circle insufficient gas error on Arc Testnet to INSUFFICIENT_USDC_FOR_GAS', () => {
    const circleGasErr = new Error('the asset amount owned by the wallet is insufficient for the transaction')

    const normalized = normalizeAppError(circleGasErr, 'Arc_Testnet')
    expect(normalized.code).toBe('INSUFFICIENT_USDC_FOR_GAS')
    expect(normalized.category).toBe('INSUFFICIENT_GAS')
    expect(normalized.title).toBe('Insufficient USDC for Gas')
    expect(normalized.message).toContain('Insufficient USDC for Arc gas fees')
    expect(normalized.message).not.toContain('ETH')
  })

  it('correctly normalizes CCTP Max fee must be less than amount simulation error to CCTP_MIN_FEE_VIOLATION', () => {
    const simulationErr = new Error('Simulation failed on Arc Testnet: Max fee must be less than amount')

    const normalized = normalizeAppError(simulationErr)
    expect(normalized.code).toBe('CCTP_MIN_FEE_VIOLATION')
    expect(normalized.category).toBe('VALIDATION')
    expect(normalized.title).toBe('Bridge Amount Below CCTP Fee')
    expect(normalized.message).toContain('must be greater than the CCTP forwarder fee')
    expect(normalized.actionHint).toContain(`at least ${MIN_DIRECT_BRIDGE_AMOUNT.toFixed(2)} USDC`)
  })
})

describe('EURC/cirBTC V4 pool custom errors', () => {
  it('translates LiquidityLockedThisBlock (viem-decoded name) into a wait-and-retry message', () => {
    const err = new Error(
      'The contract function "removeLiquidity" reverted with the following custom error:\n\nLiquidityLockedThisBlock()'
    )
    const normalized = normalizeAppError(err)
    expect(normalized.code).toBe('LIQUIDITY_LOCKED_THIS_BLOCK')
    expect(normalized.isRetryable).toBe(true)
    expect(normalized.message).toMatch(/wait a moment and retry/i)
    expect(normalized.message).not.toContain('Smart contract rejected')
  })

  it('matches by 4-byte selector, including through the cause chain and paymaster-flavoured bundler text', () => {
    const bundlerErr = new Error('UserOperation reverted during simulation (paymaster ok): execution reverted, data 0x8a822af3')
    expect(normalizeAppError(bundlerErr).code).toBe('LIQUIDITY_LOCKED_THIS_BLOCK')

    const wrapped: any = new Error('Execution failed')
    wrapped.cause = { data: { errorName: 'DeadlineExpired' } }
    expect(detectPoolCustomError(wrapped)).toBe('DEADLINE_EXPIRED')
    expect(normalizeAppError(wrapped).title).toBe('Transaction Expired')
  })

  it('translates DeadAddressTransferBlocked and RenounceDisabled', () => {
    expect(normalizeAppError(new Error('reverted: DeadAddressTransferBlocked()')).code).toBe('DEAD_ADDRESS_TRANSFER_BLOCKED')
    expect(normalizeAppError(new Error('execution reverted: 0x89051165')).code).toBe('RENOUNCE_DISABLED')
  })

  it('does not hijack unrelated reverts', () => {
    expect(detectPoolCustomError(new Error('execution reverted: ERC4626: deposit more than max'))).toBeNull()
    expect(normalizeAppError(new Error('execution reverted: ERC4626: deposit more than max')).code).toBe('CONTRACT_REVERT')
  })

  it('correctly normalizes Viem UnknownRpcError and custom eth_gasPrice failure to WALLET_RPC_ERROR', () => {
    const viemErr: any = new Error('An unknown RPC error occurred.')
    viemErr.name = 'ContractFunctionExecutionError'
    viemErr.shortMessage = 'An unknown RPC error occurred.'
    viemErr.details = 'RPC 0x12c1 Custom eth_gasPrice: RPC endpoint returned HTTP client error.'
    viemErr.cause = {
      name: 'UnknownRpcError',
      message: 'An unknown RPC error occurred.',
      details: 'RPC 0x12c1 Custom eth_gasPrice: RPC endpoint returned HTTP client error.',
    }

    const normalized = normalizeAppError(viemErr)
    expect(normalized.code).toBe('WALLET_RPC_ERROR')
    expect(normalized.category).toBe('RPC_NETWORK')
    expect(normalized.title).toBe('Wallet RPC Communication Error')
    expect(normalized.message).toContain('eth_gasPrice')
    expect(normalized.isRetryable).toBe(true)
  })
})
