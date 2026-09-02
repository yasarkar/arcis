import { AppKit, type ChainDefinition } from '@circle-fin/app-kit'
import type { BridgeExecuteParams, BridgeStepProgress, BridgeStepName } from '../types/bridge'

// Create a single instance of AppKit to manage CCTP transfers
const kit = new AppKit()

/**
 * Dynamic Chain Loading
 * Gets all chains that support CCTP bridging operations.
 * Allows filtering by testnet or mainnet.
 */
export function getSupportedBridgeChains(isTestnet?: boolean): ChainDefinition[] {
  const chains = kit.getSupportedChains('bridge')
  if (isTestnet !== undefined) {
    return chains.filter((c) => c.isTestnet === isTestnet)
  }
  return chains
}

/**
 * Mapped helper to construct App Kit SDK BridgeParams from BridgeExecuteParams.
 */
function buildBridgeParams(params: BridgeExecuteParams) {
  const from = {
    adapter: params.sourceAdapter,
    chain: params.fromChain
  }

  let to: any
  if (params.destinationAdapter) {
    to = {
      adapter: params.destinationAdapter,
      chain: params.toChain,
      useForwarder: params.useForwarder ?? false
    }
  } else {
    to = {
      recipientAddress: params.recipientAddress,
      chain: params.toChain,
      useForwarder: true // Forwarding service is required when no destination adapter is supplied
    }
  }

  const bridgeParams: any = {
    from,
    to,
    amount: params.amount,
    token: 'USDC' as const
  }

  // Inject optional configuration.
  //
  // IMPORTANT: We deliberately do NOT pass `maxFee` here. The App Kit SDK
  // automatically calculates the correct maxFee = calculatedBurnFee + forwardingFee
  // when maxFee is omitted. If we supply our own maxFee while the Forwarding
  // Service is enabled, the SDK uses it DIRECTLY as the total provider fee
  // (per SDK source: "If user provided maxFee, use it directly as provider fee
  // regardless of forwarding or speed"), which can be lower than the actual
  // forwarding fee + CCTP protocol fee and cause the burn to revert with a
  // generic ONCHAIN_TRANSACTION_REVERTED on the source chain.
  //
  // We also explicitly disable `batchTransactions` (EIP-5792 batching via
  // wallet_sendCalls) so the approve -> burn flow always runs sequentially.
  // Some wallets (e.g. MetaMask) do not support wallet_sendCalls and this can
  // cause a generic revert on the source chain.
  if (params.transferSpeed || params.customFee) {
    bridgeParams.config = {
      ...(params.transferSpeed && { transferSpeed: params.transferSpeed }),
      ...(params.customFee && { customFee: params.customFee }),
      batchTransactions: false
    }
  } else {
    // Even when no optional config is supplied, disable batching explicitly.
    bridgeParams.config = {
      batchTransactions: false
    }
  }

  return bridgeParams
}

/**
 * Safely serializes any object to a JSON string, converting BigInt
 * values to strings so JSON.stringify never throws.
 */
export function safeStringify(obj: unknown): string {
  return JSON.stringify(obj, (_key, value) =>
    typeof value === 'bigint' ? value.toString() : value
  )
}

/**
 * Sanitizes a BridgeResult (or a payload containing one) for localStorage
 * persistence. Strips heavy nested transaction-receipt data from each step
 * and keeps only the fields needed for recovery/retry. Also converts any
 * BigInt values (e.g. gasUsed, blockNumber) into strings so the payload
 * can be safely JSON.stringify'd.
 */
export function sanitizeBridgeResult(result: any) {
  if (!result) return result

  const sanitized = JSON.parse(safeStringify(result))

  if (Array.isArray(sanitized.steps)) {
    sanitized.steps = sanitized.steps.map((step: any) => ({
      name: step.name,
      state: step.state,
      txHash: step.txHash,
      explorerUrl: step.explorerUrl,
      error: step.error || step.errorMessage
    }))
  }

  return sanitized
}

/**
 * Estimates the cross-chain bridge transaction costs including gas, 
 * CCTP protocol fee, and forwarder service fees.
 */
export async function estimateBridgeCost(params: BridgeExecuteParams) {
  try {
    const bridgeParams = buildBridgeParams(params)
    return await kit.estimateBridge(bridgeParams)
  } catch (err) {
    console.error('[bridgeService] Failed to estimate bridge cost:', err)
    throw err
  }
}

/**
 * Executes a CCTP bridge transaction and updates step progress in real-time.
 */
export async function executeBridge(
  params: BridgeExecuteParams,
  onStepUpdate?: (step: BridgeStepProgress) => void
) {
  // Event listener to capture CCTP lifecycle events
  const handler = (payload: any) => {
    try {
      // Resolve step name (handles both event payload styles)
      const stepNameRaw = payload?.values?.name || payload?.action?.split('.').pop()
      const stepName = stepNameRaw as BridgeStepName

      if (['approve', 'burn', 'fetchAttestation', 'mint'].includes(stepName)) {
        const stepState = payload?.values?.state || payload?.state || 'pending'
        const txHash = payload?.values?.txHash || payload?.txHash
        const explorerUrl = payload?.values?.explorerUrl || payload?.explorerUrl
        const errorMessage = payload?.values?.error || payload?.values?.errorMessage || payload?.error || payload?.errorMessage

        onStepUpdate?.({
          name: stepName,
          state: stepState as 'pending' | 'success' | 'error',
          txHash,
          explorerUrl,
          errorMessage
        })
      }
    } catch (eventErr) {
      console.warn('[bridgeService] Error parsing lifecycle event:', eventErr)
    }
  }

  // Subscribe to all App Kit events
  kit.on('*', handler)

  try {
    const bridgeParams = buildBridgeParams(params)
    const result: any = await kit.bridge(bridgeParams)

    if (!result) {
      throw new Error('Bridge execution returned an empty response.')
    }

    // Check if the bridge result returned an error state
    if (result.state === 'error' || result.status === 'error' || result.status === 'failed') {
      const failedStep = result.steps?.find((s: any) => s.state === 'error' || s.errorMessage || s.error)
      const stepError = failedStep?.errorMessage || failedStep?.error?.message || failedStep?.error
      const generalError = result.errorMessage || result.error?.message || result.error
      const errorMsg = stepError || generalError || 'Bridge operation was cancelled or failed.'

      const errorObj: any = new Error(typeof errorMsg === 'string' ? errorMsg : JSON.stringify(errorMsg))
      if (failedStep?.error) {
        errorObj.cause = failedStep.error
      } else if (result.error) {
        errorObj.cause = result.error
      }
      throw errorObj
    }

    // Check if any step explicitly failed
    const errorStep = result.steps?.find((s: any) => s.state === 'error')
    if (errorStep) {
      const stepMsg = errorStep.errorMessage || errorStep.error?.message || errorStep.error || `Step ${errorStep.name} failed.`
      const errorObj: any = new Error(typeof stepMsg === 'string' ? stepMsg : JSON.stringify(stepMsg))
      if (errorStep.error) errorObj.cause = errorStep.error
      throw errorObj
    }

    return result
  } catch (err) {
    console.error('[bridgeService] Bridge execution failed:', err)
    throw err
  } finally {
    // Safely unsubscribe the event listener once the promise resolves or rejects
    kit.off('*', handler)
  }
}

/**
 * Retries a failed bridge transfer from the exact CCTP step that failed.
 */
export async function retryFailedBridge(
  failedResult: any,
  sourceAdapter: any,
  destinationAdapter?: any,
  onStepUpdate?: (step: BridgeStepProgress) => void
) {
  if (!failedResult) {
    throw new Error('No bridge result provided for retry.')
  }

  if (failedResult.state !== 'error') {
    throw new Error('Transaction is not in an error state. Retry is not needed.')
  }

  // Event listener to capture CCTP lifecycle events during retry
  const handler = (payload: any) => {
    try {
      const stepNameRaw = payload?.values?.name || payload?.action?.split('.').pop()
      const stepName = stepNameRaw as BridgeStepName

      if (['approve', 'burn', 'fetchAttestation', 'mint'].includes(stepName)) {
        const stepState = payload?.values?.state || payload?.state || 'pending'
        const txHash = payload?.values?.txHash || payload?.txHash
        const explorerUrl = payload?.values?.explorerUrl || payload?.explorerUrl
        const errorMessage = payload?.values?.error || payload?.values?.errorMessage || payload?.error || payload?.errorMessage

        onStepUpdate?.({
          name: stepName,
          state: stepState as 'pending' | 'success' | 'error',
          txHash,
          explorerUrl,
          errorMessage
        })
      }
    } catch (eventErr) {
      console.warn('[bridgeService] Error parsing lifecycle event:', eventErr)
    }
  }

  // Subscribe to all App Kit events during retry
  kit.on('*', handler)

  const retryContext = {
    from: sourceAdapter,
    to: destinationAdapter
  }

  try {
    if (typeof (kit as any).retry === 'function') {
      return await (kit as any).retry(failedResult, retryContext)
    } else if (typeof (kit as any).retryBridge === 'function') {
      return await (kit as any).retryBridge(failedResult, retryContext)
    } else {
      throw new Error('Retry method not found on AppKit SDK instance.')
    }
  } catch (err) {
    console.error('[bridgeService] Retry execution failed:', err)
    throw err
  } finally {
    // Safely unsubscribe the event listener once the promise resolves or rejects
    kit.off('*', handler)
  }
}
