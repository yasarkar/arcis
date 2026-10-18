import type { BreakdownItem } from '../../components/fintech'
import type { SwapQuoteResult } from '../../types/swap'
import { SPEED_TIERS, type SpeedTier } from '../../config/feeTiers'
import {
  STABLE_SWAP_LP_FEE_BPS,
  CONSTANT_PRODUCT_LP_FEE_BPS,
  WETH_CONSTANT_PRODUCT_LP_FEE_BPS,
} from '../../config/poolsConfig'
import { formatFeeDecimals } from '../../utils/tokenUtils'

export interface BuildSwapBreakdownParams {
  estimatedOutput: string
  rate: string
  isEstimating: boolean
  fromChain: string
  tokenIn: string
  tokenOut: string
  stopLimit: string
  slippageTolerance: number
  amountIn: string
  quoteFees: SwapQuoteResult['fees']
  rawPlatformFeeNum: number | null
  platformFeeEnabled: boolean
  platformFeeAmount: string | null
  platformFeePercent: string
  speedTier: SpeedTier
}

export function buildSwapBreakdown({
  estimatedOutput,
  rate,
  isEstimating,
  fromChain,
  tokenIn,
  tokenOut,
  stopLimit,
  slippageTolerance,
  amountIn,
  quoteFees,
  rawPlatformFeeNum,
  platformFeeEnabled,
  platformFeeAmount,
  platformFeePercent,
  speedTier,
}: BuildSwapBreakdownParams): BreakdownItem[] {
  if (!estimatedOutput || !rate || isEstimating) return []

  const isArcNative = fromChain === 'Arc_Testnet'
  const isWethRoute = tokenIn === 'WETH' || tokenOut === 'WETH'
  const isCirBtcRoute = tokenIn === 'cirBTC' || tokenOut === 'cirBTC'
  const lpPoolName = isArcNative
    ? isWethRoute
      ? '(USDC/WETH LP)'
      : isCirBtcRoute
        ? '(AMM LP Pool)'
        : '(StableSwap LP)'
    : '(AppKit Route)'

  // Liquidity Provider fee calculation: show amount instead of percentage next to pool name
  const lpQuoteFee = quoteFees?.find((f) => f.type === 'swap' || f.type === 'provider')
  const parsedAmtIn = parseFloat(amountIn)
  const platFeeVal = rawPlatformFeeNum || 0
  const netSwapAmtIn = Math.max(0, (isNaN(parsedAmtIn) ? 0 : parsedAmtIn) - platFeeVal)
  const lpBps = isArcNative
    ? isWethRoute
      ? Number(WETH_CONSTANT_PRODUCT_LP_FEE_BPS)
      : isCirBtcRoute
        ? Number(CONSTANT_PRODUCT_LP_FEE_BPS)
        : Number(STABLE_SWAP_LP_FEE_BPS)
    : 2
  const fallbackLpFeeNum = (netSwapAmtIn * lpBps) / 10000
  const lpFeeNum = lpQuoteFee ? parseFloat(lpQuoteFee.amount) : fallbackLpFeeNum

  let lpFeeFormatted = '0.00'
  if (lpFeeNum > 0) {
    if (tokenIn === 'cirBTC' || tokenIn === 'WETH') {
      lpFeeFormatted = lpFeeNum < 0.000001 ? '< 0.000001' : parseFloat(lpFeeNum.toFixed(6)).toString()
    } else if (lpFeeNum < 0.01) {
      lpFeeFormatted = lpFeeNum < 0.0001 ? '< 0.0001' : parseFloat(lpFeeNum.toFixed(4)).toString()
    } else {
      lpFeeFormatted = formatFeeDecimals(lpFeeNum, 2)
    }
  }

  const lpFeeDisplay = `${lpFeeFormatted} ${tokenIn} ${lpPoolName}`

  const tierConfig = SPEED_TIERS[speedTier] || SPEED_TIERS.fast

  const executionTimeValue =
    tierConfig.timeEstimate.swap === 'Instant'
      ? '< 500 ms (Instant)'
      : `${tierConfig.timeEstimate.swap} (${tierConfig.label})`

  const rawNetworkFeeValue =
    fromChain === 'Arc_Testnet'
      ? `~${tierConfig.arcGas?.estimatedCostUsdc || '0.00053'} USDC`
      : '< 0.001 ETH'
  const networkFeeValue = rawNetworkFeeValue.replace(/(\d+)\.(\d{6,})/g, (_m, intPart, decPart) => {
    const rounded = (Math.round(parseFloat(`${intPart}.${decPart}`) * 1e5) / 1e5).toFixed(5)
    return parseFloat(rounded).toString()
  })

  return [
    {
      label: 'Exchange Rate',
      tooltip: 'The current market conversion rate between the selected token pair.',
      value: `1 ${tokenIn} = ${rate} ${tokenOut}`,
    },
    {
      label: 'Min. Received',
      tooltip: 'The guaranteed minimum amount you will receive after maximum slippage tolerance.',
      value: `${stopLimit} ${tokenOut}`,
    },
    {
      label: 'Slippage Tolerance',
      tooltip: 'The maximum price difference tolerated before the transaction automatically reverts.',
      value: `${(slippageTolerance * 100).toFixed(1)}%`,
    },
    {
      label: 'Network Fee',
      tooltip: 'Estimated smart contract execution gas fee paid natively in USDC on Arc.',
      value: networkFeeValue,
    },
    {
      label: 'Liquidity Provider Fee',
      tooltip: 'Fee rewarded directly to liquidity pool providers supporting this trade.',
      value: lpFeeDisplay,
    },
    {
      label: 'Platform Fee',
      tooltip: 'Arcis Treasury protocol fee for routing and multi-token liquidity indexing.',
      value: (() => {
        const devQuoteFee = quoteFees?.find((f) => f.type === 'developer')
        const displayedPlatformFeeAmount = devQuoteFee
          ? formatFeeDecimals(parseFloat(devQuoteFee.amount), 2)
          : platformFeeAmount
        return platformFeeEnabled && displayedPlatformFeeAmount
          ? `${displayedPlatformFeeAmount} ${tokenIn} (${platformFeePercent})`
          : '0.00 USDC (Free)'
      })(),
    },
    {
      label: 'Execution Time',
      tooltip: 'Estimated duration to execute and finalize the swap transaction onchain based on selected speed tier.',
      value: executionTimeValue,
    },
  ]
}
