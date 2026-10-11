// Phase 1.5 — education layer.
//
// Honest, plain-language explanations the pool UI can surface as tooltips/onboarding. These are
// deliberately kept as pure data + pure functions so the copy can be unit-tested and cannot silently
// drift from the mechanics (impermanent loss, on-chain fee accrual, and the real-vs-estimated split).

export const POOL_EDUCATION = {
  /** Why an LP's position can underperform simply holding, by risk band. */
  impermanentLoss: {
    'Zero (Stable)':
      'USDC and EURC are both fiat-pegged, so the pool ratio barely moves and impermanent loss is ' +
      'minimal. Accrued swap fees are what you earn for providing the liquidity.',
    Low:
      'The two assets can drift apart, so a small impermanent loss is possible. Swap fees accrue to ' +
      'offset it, but they are compensation for risk — not a guarantee.',
    Medium:
      'One asset is volatile, so the pool rebalances as its price moves and the position can ' +
      'underperform simply holding it — this is impermanent loss. Fees compensate for that risk; ' +
      'they do not remove it.',
  } as Record<string, string>,

  /** How a swap fee becomes LP value on chain. */
  feeAccrual:
    'Every swap pays a fee (0.12% on the stable pool, 0.25% on the USDC/cirBTC pool). On chain the ' +
    'fee is credited to LP reward accounting outside the trading reserves. Your share appears as ' +
    'pendingFees(lp) and is paid to you when you Harvest — harvesting never burns your LP principal.',

  /** Which part of a displayed APY is measured vs projected. */
  realVsEstimated:
    'Only swap fees that were actually paid on chain are real. The base incentive component is an ' +
    'estimate of the incentive program and is not guaranteed. Labels mark estimated parts explicitly ' +
    '(e.g. "Incentive Est."); realized fees are shown separately.',
} as const

/** Tooltip copy for a pool's impermanent-loss risk, with a safe generic fallback. */
export function impermanentLossExplainer(riskLevel?: string): string {
  if (riskLevel && POOL_EDUCATION.impermanentLoss[riskLevel]) {
    return POOL_EDUCATION.impermanentLoss[riskLevel]
  }
  return (
    'Liquidity provision can underperform simply holding the two assets when their prices diverge. ' +
    'Swap fees accrue to compensate for that risk.'
  )
}

/** Tooltip copy describing what the displayed APY figure is made of. */
export function apySourceExplainer(apyType?: string): string {
  const kind = (apyType || 'APY').trim() || 'APY'
  return `${kind} can combine two parts: realized on-chain swap fees, and an estimated incentive component. ${POOL_EDUCATION.realVsEstimated}`
}

/** Tooltip copy for a pool's fee tier / distribution row. */
export function feeAccrualExplainer(): string {
  return POOL_EDUCATION.feeAccrual
}
