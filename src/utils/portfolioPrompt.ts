// src/utils/portfolioPrompt.ts
// Single owner of the portfolio → LLM prompt serialization contract.
//
// Both sides of the Copilot call use this one function:
//   - the browser, via portfolioContextService (which re-exports it for its existing callers)
//   - the serverless proxy, via api/copilot.ts
// Because the serializer is shared, the field names can never drift between what the client sends
// and what the model receives. Keep this module dependency-free — api/ routes import it and must
// not pull in browser-only services.

/** The portfolio fields the prompt contract understands. Structurally satisfied by PortfolioSnapshot. */
export interface PortfolioPromptInput {
  walletAddress?: string
  liquidUsdc?: number
  liquidEurc?: number
  liquidWeth?: number
  liquidCirBtc?: number
  vaultStakedUsdc?: number
  vaultApy?: number
  estimatedYearlyYieldUsdc?: number
  gatewayTotalUsdc?: number
  gatewayBreakdown?: Array<{ chainName?: string; balanceUsdc?: number }>
  totalNetWorthUsd?: number
  healthScore?: number
  recommendedVaultDeposit?: number
  sessionBudgetLeftUsdc?: number
  hasActiveSession?: boolean
}

export const EMPTY_PORTFOLIO_PROMPT = 'USER LIVE PORTFOLIO SNAPSHOT: (Wallet not connected)'

/**
 * Returns the snapshot's liquid balance for a copilot token, or null when the snapshot does not
 * carry that field. Used for pre-confirm balance checks so an over-spend is caught before broadcast.
 */
export function availableTokenBalance(
  portfolio: PortfolioPromptInput | null | undefined,
  tokenSymbol: string
): number | null {
  if (!portfolio || typeof portfolio !== 'object') return null
  const map: Record<string, number | undefined> = {
    USDC: portfolio.liquidUsdc,
    EURC: portfolio.liquidEurc,
    cirBTC: portfolio.liquidCirBtc,
    WETH: portfolio.liquidWeth,
  }
  const value = map[tokenSymbol]
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

const DEFAULT_VAULT_APY = 8.42

/** Coerces anything that is not a finite number to 0, so the prompt never renders NaN/undefined. */
function toNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

/**
 * Serializes a portfolio snapshot into the prompt block injected into the system message.
 * Returns the "not connected" placeholder when no snapshot was supplied.
 */
export function formatPortfolioForPrompt(portfolio?: PortfolioPromptInput | null): string {
  if (!portfolio || typeof portfolio !== 'object') return EMPTY_PORTFOLIO_PROMPT

  const liquidUsdc = toNumber(portfolio.liquidUsdc)
  const liquidEurc = toNumber(portfolio.liquidEurc)
  const liquidWeth = toNumber(portfolio.liquidWeth)
  const liquidCirBtc = toNumber(portfolio.liquidCirBtc)
  const vaultStakedUsdc = toNumber(portfolio.vaultStakedUsdc)
  const vaultApy = toNumber(portfolio.vaultApy) || DEFAULT_VAULT_APY
  const estimatedYearlyYieldUsdc =
    portfolio.estimatedYearlyYieldUsdc !== undefined
      ? toNumber(portfolio.estimatedYearlyYieldUsdc)
      : vaultStakedUsdc * (vaultApy / 100)
  const gatewayTotalUsdc = toNumber(portfolio.gatewayTotalUsdc)
  const totalNetWorthUsd = toNumber(portfolio.totalNetWorthUsd)
  const healthScore = toNumber(portfolio.healthScore)
  const recommendedVaultDeposit = toNumber(portfolio.recommendedVaultDeposit)
  const sessionBudgetLeftUsdc = toNumber(portfolio.sessionBudgetLeftUsdc)

  const breakdown = Array.isArray(portfolio.gatewayBreakdown) ? portfolio.gatewayBreakdown : []
  const gatewayInfo =
    gatewayTotalUsdc > 0 && breakdown.length > 0
      ? `${gatewayTotalUsdc.toFixed(2)} USDC (${breakdown
          .map((chain) => `${chain.chainName}: ${toNumber(chain.balanceUsdc)}`)
          .join(', ')})`
      : `${gatewayTotalUsdc.toFixed(2)} USDC`

  return `LIVE USER ON-CHAIN PORTFOLIO SNAPSHOT:
- Connected Address: ${portfolio.walletAddress || 'unknown'}
- Liquid USDC (Arc Testnet): ${liquidUsdc.toFixed(2)} USDC (0% idle yield)
- Liquid EURC (Arc Testnet): ${liquidEurc.toFixed(2)} EURC
- Liquid WETH (Arc Testnet): ${liquidWeth.toFixed(4)} WETH
- Liquid cirBTC (Arc Testnet): ${liquidCirBtc.toFixed(6)} cirBTC
- Real-Yield Vault (af-USDC): ${vaultStakedUsdc.toFixed(2)} USDC allocated (Earning ${vaultApy}% APY = +${estimatedYearlyYieldUsdc.toFixed(2)}/year passive yield)
- Circle Gateway Omnichain USDC: ${gatewayInfo}
- Total Net Worth: ${totalNetWorthUsd.toFixed(2)} USD
- Portfolio DeFi Health Score: ${healthScore}/100
- Recommended Vault Allocation: ${recommendedVaultDeposit.toFixed(2)} USDC
- Autonomous Session Budget Remaining: ${sessionBudgetLeftUsdc.toFixed(2)} USDC (Session ${portfolio.hasActiveSession ? 'Active' : 'Inactive'})`
}
