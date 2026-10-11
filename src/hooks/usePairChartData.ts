import { useQuery } from '@tanstack/react-query'
import { getPairChartData, type ChartDataResult } from '../services/chartDataService'
import { useLiveTokenPrices } from './useLiveTokenPrices'
import { normalizeTokenSymbol } from '../services/tokenPriceService'

export function usePairChartData(
  tokenIn: string,
  tokenOut: string,
  timeframe: '1D' | '1W' | '1M' = '1D',
  focusToken?: string
) {
  const { data: livePrices } = useLiveTokenPrices()

  const normIn = normalizeTokenSymbol(tokenIn)
  const normOut = normalizeTokenSymbol(tokenOut)
  const activeFocus = focusToken ? normalizeTokenSymbol(focusToken) : normIn

  let liveAnchorPrice: number | undefined = undefined

  if (livePrices) {
    if (activeFocus === 'USDC') {
      liveAnchorPrice = 1.0
    } else if (livePrices[activeFocus] && livePrices[activeFocus] > 0) {
      liveAnchorPrice = livePrices[activeFocus]
    } else if (activeFocus === 'CIRBTC' && livePrices['BTC']) {
      liveAnchorPrice = livePrices['BTC']
    } else if (activeFocus === 'BTC' && livePrices['CIRBTC']) {
      liveAnchorPrice = livePrices['CIRBTC']
    } else if (activeFocus === 'WETH' && livePrices['ETH']) {
      liveAnchorPrice = livePrices['ETH']
    }
  }

  return useQuery<ChartDataResult>({
    queryKey: ['pairChartData', tokenIn, tokenOut, timeframe, activeFocus, liveAnchorPrice],
    queryFn: () => getPairChartData(tokenIn, tokenOut, timeframe, liveAnchorPrice, activeFocus),
    staleTime: 20_000,
    refetchInterval: 30_000,
  })
}
