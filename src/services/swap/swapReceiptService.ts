import { formatFeeDecimals } from '../../utils/tokenUtils'
import { verifyArcSwapReceipt } from '../copilotExecutionService'
import { resolveArcActualFeeUsdc } from '../arcGasService'
import { logger } from '../../utils/logger'

const swapLog = logger.createScope('swapReceiptService')

export interface SwapActualsParams {
  amountIn: string
  tokenIn: string
  tokenOut: string
  recipient: string
}

export interface SwapActualsResult {
  actualAmountOut?: string
  networkFee?: string
}

/**
 * Receipt enrichment: reads the real received amount and exact network fee
 * from the mined receipt on Arc instead of relying solely on quote estimates.
 */
export async function fetchSwapActuals(
  txHash: string,
  p: SwapActualsParams,
  isArcNativeSwap: boolean
): Promise<SwapActualsResult> {
  const actuals: SwapActualsResult = {}
  if (!isArcNativeSwap || !txHash || !txHash.startsWith('0x')) return actuals

  try {
    const proof = await verifyArcSwapReceipt(
      txHash as `0x${string}`,
      p.recipient,
      p.tokenIn,
      p.tokenOut,
      parseFloat(p.amountIn)
    )
    if (proof.status === 'success' && Number.isFinite(proof.amountOut) && proof.amountOut > 0) {
      actuals.actualAmountOut = formatFeeDecimals(proof.amountOut, p.tokenOut === 'cirBTC' ? 8 : 6)
    }
  } catch (actualErr) {
    swapLog.warn('Actual received amount lookup failed:', actualErr)
  }

  try {
    const fee = await resolveArcActualFeeUsdc(txHash)
    if (fee?.feeUsdc != null && Number.isFinite(fee.feeUsdc)) {
      const feeVal = fee.feeUsdc
      const formattedFee =
        feeVal > 0 && feeVal < 0.00001
          ? '< 0.00001'
          : parseFloat(feeVal.toFixed(5)).toString()
      const safeFeeStr =
        formattedFee.includes('.') && formattedFee.split('.')[1].length < 2
          ? Number(formattedFee).toFixed(2)
          : formattedFee
      actuals.networkFee = `${safeFeeStr} USDC`
    }
  } catch (feeErr) {
    swapLog.warn('Actual network fee lookup failed:', feeErr)
  }

  return actuals
}
