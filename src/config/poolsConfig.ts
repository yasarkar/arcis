// Arcis Pools & Yield — Testnet-first configuration (Phase 5 rewrite).
// 2 clear categories: Liquidity, Vault.
import { ARC_TOKENS } from './arcChain'
import { CHAIN_DEFS } from './chainMeta'

export const POOLS_CHAIN_DEFS = CHAIN_DEFS

export type PoolCategory = 'liquidity' | 'vault'
export type PoolRiskLevel = 'Safe' | 'Low' | 'Medium'

export interface RiskLevelConfig {
  id: PoolRiskLevel
  label: string
  shortLabel: string
  description: string
  color: string
  bgColor: string
  borderColor: string
  severity: 1 | 2 | 3
}

export const POOL_RISK_LEVELS: Record<PoolRiskLevel, RiskLevelConfig> = {
  Safe: {
    id: 'Safe',
    label: 'Safe (Stable Pairs)',
    shortLabel: 'Safe',
    description: 'Stablecoin pairs with near-zero impermanent loss.',
    color: '#01d062',
    bgColor: 'rgba(1, 208, 98, 0.12)',
    borderColor: 'rgba(1, 208, 98, 0.3)',
    severity: 1,
  },
  Low: {
    id: 'Low',
    label: 'Low Risk',
    shortLabel: 'Low',
    description: 'Single-asset vault with real USDC yield distribution.',
    color: '#38bdf8',
    bgColor: 'rgba(56, 189, 248, 0.12)',
    borderColor: 'rgba(56, 189, 248, 0.3)',
    severity: 2,
  },
  Medium: {
    id: 'Medium',
    label: 'Medium Risk',
    shortLabel: 'Medium',
    description: 'Volatile pair (BTC) subject to market fluctuations and impermanent loss.',
    color: '#fbbf24',
    bgColor: 'rgba(251, 191, 36, 0.12)',
    borderColor: 'rgba(251, 191, 36, 0.3)',
    severity: 3,
  },
}

export interface PoolToken {
  symbol: string
  name: string
  address?: `0x${string}`
  iconType: 'usdc' | 'eurc' | 'btc' | 'arc' | 'gateway' | 'weth'
  decimals: number
}

export interface PoolConfig {
  id: string
  name: string
  subtitle: string
  description: string
  category: PoolCategory
  tokens: PoolToken[]
  apy: number
  apyType: 'APY' | 'APR'
  apyBadge: string
  tvlUsd: number
  volume24hUsd: number
  clientVolumeUsd?: number
  lockPeriod: string
  riskLevel: PoolRiskLevel
  feeShare: string
  contractAddress: `0x${string}`
  depositTokenSymbol: string
  rewardTokenSymbol: string
  isFeatured?: boolean
  isLiveOnChain?: boolean
  executionMode?: 'onchain_verified' | 'preview'
  tags: string[]
  yieldOrigin: string
  yieldOriginDetails: string
  gasBenefitNote?: string
  howItWorksSteps?: { step: number; title: string; desc: string }[]
  isLpPool?: boolean
  lpTokenName?: string
  lpTokenSymbol?: string
  supportsZap?: boolean
  exchangeRate?: number
  feeTierPercent?: number
  reserves?: { tokenA: number; tokenB: number; ratioA: number; ratioB: number }
  totalLp?: string
  impermanentLossRisk?: 'Zero (Stable)' | 'Low' | 'Medium'
  paused?: boolean
}

// `import.meta.env` only exists inside the Vite bundle; the API server loads these same
// modules through tsx, where it is undefined. Read process.env first and guard the Vite
// access, the same way src/config/networks/networkRegistry.ts does.
function readEnv(key: string): string | undefined {
  const fromProcess = typeof process !== 'undefined' && process.env ? process.env[key] : undefined
  if (fromProcess) return fromProcess
  if (typeof import.meta !== 'undefined' && import.meta.env) {
    const fromVite = (import.meta.env as Record<string, string | undefined>)[key]
    if (fromVite) return fromVite
  }
  return undefined
}

// ── Active Pool Version ───────────────────────────────────────────────────────
// Directly reads VITE_POOL_VERSION from env (defaults to 'v4').
export const POOL_VERSION: string = (readEnv('VITE_POOL_VERSION') || 'v4').toLowerCase()
export const POOL_VERSION_V4 = POOL_VERSION === 'v4'

// ── Contract Address Helpers ──────────────────────────────────────────────────
const V4_ZERO = '0x0000000000000000000000000000000000000000' as `0x${string}`
const v4Address = (value: string | undefined, fallback: `0x${string}` = V4_ZERO): `0x${string}` =>
  value && /^0x[a-fA-F0-9]{40}$/.test(value) ? (value as `0x${string}`) : fallback

// ── Active Contract Addresses ─────────────────────────────────────────────────
export const POOL_CONTRACTS = {
  STABLE_SWAP_POOL: v4Address(readEnv('VITE_POOL_V4_STABLE_SWAP'), '0xC3EdDA15AdfaC31ADfC23aC86dC96d791f72bE8a'),
  CONSTANT_PRODUCT_POOL: v4Address(readEnv('VITE_POOL_V4_CONSTANT_PRODUCT'), '0xf0e5f1d5C36a8362D96A8a43a441c6bb29416349'),
  YIELD_VAULT: v4Address(readEnv('VITE_POOL_V4_YIELD_VAULT'), '0xb2a6D2BF896b431a77FB9198519fE334Caf39e9A'),
  WETH_POOL: v4Address(readEnv('VITE_POOL_V4_WETH_POOL'), '0x4fB42dBbA5AD26723106bd56cA647dEb4a75Cd90'),
  EURC_WETH_POOL: v4Address(readEnv('VITE_POOL_V4_EURC_WETH_POOL'), '0x94f1fB8ab07146BB2C1f2A9AF155d51413a45809'),
  ARCIS_SWAP_ROUTER: v4Address(readEnv('VITE_POOL_V4_ROUTER'), '0x22733d5C4C91C7BEF2BED43e3f3F42B2d91DfcD4'),
  USDC: ARC_TOKENS.USDC,
  EURC: ARC_TOKENS.EURC,
  cirBTC: ARC_TOKENS.cirBTC,
  WETH: ARC_TOKENS.WETH,
}

export const POOL_CONTRACTS_V4 = POOL_CONTRACTS

// ERC-4626 vault share decimals (9 virtual decimals on V4, 6 on older standards).
export const VAULT_SHARE_DECIMALS = POOL_VERSION_V4 ? 9 : 6

export const POOL_USDC = ARC_TOKENS.USDC
export const POOL_EURC = ARC_TOKENS.EURC
export const POOL_CIRBTC = ARC_TOKENS.cirBTC
export const POOL_WETH = ARC_TOKENS.WETH

// ── AMM pool-state read plan ──────────────────────────────────────────────────
export const AMM_POOL_STATE_READ_FNS = [
  'reserveA',
  'reserveB',
  'totalLp',
  'unclaimedFeeA',
  'unclaimedFeeB',
  'feeReserveA',
  'feeReserveB',
  'swapFeeBps',
  'volume24hA',
  'volume24hB',
] as const

export const AMM_POOL_STATE_READ_FNS_V4 = AMM_POOL_STATE_READ_FNS

// Default AMM LP operation slippage tolerance (0.5%).
export const POOL_DEFAULT_SLIPPAGE_BPS = 50

// ── Deployed V3 pool invariants — SINGLE SOURCE OF TRUTH (audit #14) ──────────────
// Previously hard-coded in swapService, poolMath, SwapModal and usePoolsData. These must stay
// in sync with the deployed contracts (enforced by utils/__tests__/poolContractConstants.test.ts):
//   contracts/src/v3/StableSwapPoolV3.sol  → `uint256 public constant A = 100;` (Ann = A * n**n = A*4)
//   contracts/script/DeployV3.s.sol        → StableSwapPoolV3(..., 12, ...) / ConstantProductPoolV3(..., 25, ...)

/** Curve Stableswap amplification coefficient (A). */
export const STABLE_SWAP_AMP = 100n

/** `Ann = A * n**n` for a 2-token pool → multiplier 4 (V3 corrected V2's A*2 bug). */
export const STABLE_SWAP_ANN_MULTIPLIER = 4n

/** USDC/EURC StableSwap LP fee: 12 bps (0.12%). */
export const STABLE_SWAP_LP_FEE_BPS = 12n

/** USDC/cirBTC Constant-Product LP fee: 25 bps (0.25%). */
export const CONSTANT_PRODUCT_LP_FEE_BPS = 25n

/** USDC/WETH Constant-Product LP fee: 30 bps (0.30%). */
export const WETH_CONSTANT_PRODUCT_LP_FEE_BPS = 30n

/** EURC/WETH Constant-Product LP fee: 30 bps (0.30%). */
export const EURC_WETH_CONSTANT_PRODUCT_LP_FEE_BPS = 30n

// O3: slippage is clamped to a safe band so a fat-fingered or oversized tolerance can never
// silently widen the min-out guard. The upper bound was 10% (1000 bps); it is now 2% (200 bps).
export const POOL_MIN_SLIPPAGE_BPS = 10
export const POOL_MAX_SLIPPAGE_BPS = 200

// Converts a percent tolerance (e.g. 0.5) to bps, clamped to
// [POOL_MIN_SLIPPAGE_BPS, POOL_MAX_SLIPPAGE_BPS]. Single source of truth for every pool path.
export function poolSlippageBps(tolerancePercent: number): number {
  if (!Number.isFinite(tolerancePercent) || tolerancePercent <= 0) return POOL_DEFAULT_SLIPPAGE_BPS
  return Math.max(
    POOL_MIN_SLIPPAGE_BPS,
    Math.min(POOL_MAX_SLIPPAGE_BPS, Math.round(tolerancePercent * 100))
  )
}

// minOut = expectedOut * (10000 - slipBps) / 10000 — mirrors zapIn guard.
export function poolMinOut(expectedOut: bigint, slipBps: number): bigint {
  if (expectedOut <= 0n) return 0n
  return (expectedOut * (10000n - BigInt(slipBps))) / 10000n
}

// minLpShares = expectedShares * (10000 - slipBps) / 10000.
export function poolMinLpShares(expectedShares: bigint, slipBps: number): bigint {
  return poolMinOut(expectedShares, slipBps)
}

// Canonical Gateway Constants — deprecated mock values neutralized to 0; all metrics are read live on-chain
/** @deprecated All liquidity metrics are live on-chain; synthetic base liquidity is disabled */
export const GATEWAY_BASE_LIQUIDITY = 0
/** @deprecated All APY metrics are live on-chain; synthetic routing APY is disabled */
export const GATEWAY_ROUTING_APY = 0

// ── Master Pools Directory ───────────────────────────────────────────────────
export const ARCIS_POOLS: PoolConfig[] = [
  {
    id: 'usdc-eurc-stable-pool',
    name: 'USDC / EURC',
    subtitle: 'Curve-style ultra-low slippage pool for Circle native stablecoins.',
    description: 'Stableswap AMM pool (A=100) optimized for frictionless, near-zero slippage swaps between native USDC and EURC with 0.12% fee tier.',
    category: 'liquidity',
    tokens: [
      { symbol: 'USDC', name: 'USD Coin', address: POOL_CONTRACTS.USDC, iconType: 'usdc', decimals: 6 },
      { symbol: 'EURC', name: 'Euro Coin', address: POOL_CONTRACTS.EURC, iconType: 'eurc', decimals: 6 },
    ],
    apy: 6.15,
    apyType: 'APR',
    apyBadge: '6.15% APR • Dynamic Real Yield',
    tvlUsd: 0,
    volume24hUsd: 0,
    lockPeriod: 'No Lock',
    riskLevel: 'Safe',
    feeShare: '0.12% Swap Fee to LPs',
    contractAddress: POOL_CONTRACTS.STABLE_SWAP_POOL,
    depositTokenSymbol: 'USDC + EURC',
    rewardTokenSymbol: 'LP Share Growth (USDC / EURC)',
    isFeatured: true,
    isLiveOnChain: true,
    executionMode: 'onchain_verified',
    yieldOrigin: 'Foreign Exchange Swap Volume (0.12% Fee)',
    yieldOriginDetails: 'Every swap between native USDC and EURC contributes a 0.12% fee directly to pool reserves, naturally appreciating LP token value without impermanent loss.',
    gasBenefitNote: 'Gas fees on Arc are paid in USDC — zero ETH needed for gas.',
    howItWorksSteps: [
      { step: 1, title: 'Deposit Stablecoins', desc: 'Deposit USDC, EURC, or both with 1-Click Zap.' },
      { step: 2, title: 'Receive afUSDC-EURC', desc: 'Receive LP tokens representing your proportional pool ownership.' },
      { step: 3, title: 'Earn Trading Fees', desc: 'Earn 0.12% on all swaps between USDC and EURC on Arc.' },
      { step: 4, title: 'Withdraw Anytime', desc: 'Exit anytime to reclaim principal and accumulated swap earnings.' },
    ],
    tags: ['StableSwap', 'Circle Native', 'Zero IL', 'Dual Stable'],
    isLpPool: true,
    lpTokenName: 'Arcis USDC-EURC LP',
    lpTokenSymbol: 'afUSDC-EURC',
    supportsZap: true,
    feeTierPercent: 0.12,
    reserves: { tokenA: 0, tokenB: 0, ratioA: 50, ratioB: 50 },
    impermanentLossRisk: 'Zero (Stable)',
    paused: false,
  },
  {
    id: 'usdc-cirbtc-pool',
    name: 'USDC / cirBTC',
    subtitle: 'Constant Product (x·y=k) liquidity pool for Circle Wrapped Bitcoin on Arc.',
    description: 'Constant product AMM pool with 0.25% swap fee tier and pro-rata real fee streaming to LPs in USDC and cirBTC.',
    category: 'liquidity',
    tokens: [
      { symbol: 'USDC', name: 'USD Coin', address: POOL_CONTRACTS.USDC, iconType: 'usdc', decimals: 6 },
      { symbol: 'cirBTC', name: 'Circle Wrapped Bitcoin', address: POOL_CONTRACTS.cirBTC, iconType: 'btc', decimals: 8 },
    ],
    apy: 12.8,
    apyType: 'APR',
    apyBadge: '12.80% APR • Dynamic Real Yield',
    tvlUsd: 0,
    volume24hUsd: 0,
    lockPeriod: 'No Lock',
    riskLevel: 'Medium',
    feeShare: '0.25% Swap Fee to LPs',
    contractAddress: POOL_CONTRACTS.CONSTANT_PRODUCT_POOL,
    depositTokenSymbol: 'USDC + cirBTC',
    rewardTokenSymbol: 'LP Share Growth (USDC / cirBTC)',
    isFeatured: true,
    isLiveOnChain: true,
    executionMode: 'onchain_verified',
    yieldOrigin: 'Bitcoin Swap Volume (0.25% Fee)',
    yieldOriginDetails: 'Every swap between USDC and cirBTC contributes a 0.25% fee directly to fee reserves, allowing LPs to harvest pure USDC and cirBTC yield.',
    gasBenefitNote: 'Gas fees on Arc are paid in USDC — zero ETH needed for gas.',
    howItWorksSteps: [
      { step: 1, title: 'Deposit Tokens', desc: 'Deposit USDC + cirBTC proportionally with 1-Click Zap.' },
      { step: 2, title: 'Receive afUSDC-cirBTC', desc: 'Receive standardized 18-decimal LP tokens representing your pool share.' },
      { step: 3, title: 'Earn Trading Fees', desc: 'Accumulate 0.25% fee on all swaps between USDC and cirBTC.' },
      { step: 4, title: 'Harvest Anytime', desc: 'Harvest real USDC and cirBTC swap fees anytime without burning LP tokens.' },
    ],
    tags: ['Constant Product', 'Bitcoin', 'Circle Wrapped BTC', 'Real Yield', 'Concentrated Liquidity'],
    isLpPool: true,
    lpTokenName: 'Arcis USDC-cirBTC LP',
    lpTokenSymbol: 'af-USDC-cirBTC',
    supportsZap: true,
    feeTierPercent: 0.25,
    reserves: { tokenA: 0, tokenB: 0, ratioA: 50, ratioB: 50 },
    impermanentLossRisk: 'Medium',
    paused: false,
  },
  {
    id: 'usdc-yield-vault',
    name: 'USDC Yield Vault',
    subtitle: 'Deposit USDC, earn real USDC yield — no lockup, no inflation.',
    description: 'A single-asset ERC-4626 vault. Deposit USDC and receive vault shares that appreciate as protocol revenue accumulates.',
    category: 'vault',
    tokens: [
      { symbol: 'USDC', name: 'USD Coin', address: POOL_CONTRACTS.USDC, iconType: 'usdc', decimals: 6 },
    ],
    apy: 8.42,
    apyType: 'APR',
    apyBadge: '8.42% APR • Real Yield (USDC)',
    tvlUsd: 0,
    volume24hUsd: 0,
    lockPeriod: 'Flexible (Unstake Anytime)',
    riskLevel: 'Low',
    feeShare: '90% Protocol Revenue Share',
    contractAddress: POOL_CONTRACTS.YIELD_VAULT,
    depositTokenSymbol: 'USDC',
    rewardTokenSymbol: 'USDC',
    isFeatured: true,
    isLiveOnChain: true,
    executionMode: 'onchain_verified',
    yieldOrigin: 'Arcis Protocol Revenue Share',
    yieldOriginDetails: '90% of protocol fees from Send, Swap, and Bridge transactions are distributed to vault depositors.',
    gasBenefitNote: 'Zero token inflation. Rewards are paid in 100% real USDC cash.',
    howItWorksSteps: [
      { step: 1, title: 'Deposit USDC', desc: 'Deposit USDC into the single-asset revenue vault.' },
      { step: 2, title: 'Track Volume', desc: 'Protocol trading fees accumulate in real time.' },
      { step: 3, title: 'Harvest in USDC', desc: 'Harvest accrued USDC rewards directly to your wallet.' },
      { step: 4, title: 'Flexible Exit', desc: 'Redeem vault shares anytime with zero penalty.' },
    ],
    tags: ['ERC-4626', 'Single Asset', 'Real Yield', 'Zero IL'],
    supportsZap: true,
  },
  {
    id: 'usdc-weth-pool',
    name: 'USDC / WETH',
    subtitle: 'Constant Product (x·y=k) liquidity pool for Bridged Ether on Arc.',
    description: 'Constant product AMM pool with 0.30% swap fee tier and pro-rata real fee streaming to LPs in USDC and WETH.',
    category: 'liquidity',
    tokens: [
      { symbol: 'USDC', name: 'USD Coin', address: POOL_CONTRACTS.USDC, iconType: 'usdc', decimals: 6 },
      { symbol: 'WETH', name: 'Wrapped Ether', address: POOL_CONTRACTS.WETH, iconType: 'weth', decimals: 18 },
    ],
    apy: 15.4,
    apyType: 'APR',
    apyBadge: '15.40% APR • Dynamic Real Yield',
    tvlUsd: 0,
    volume24hUsd: 0,
    lockPeriod: 'No Lock',
    riskLevel: 'Medium',
    feeShare: '0.30% Swap Fee to LPs',
    contractAddress: POOL_CONTRACTS.WETH_POOL,
    depositTokenSymbol: 'USDC + WETH',
    rewardTokenSymbol: 'LP Share Growth (USDC / WETH)',
    isFeatured: true,
    isLiveOnChain: true,
    executionMode: 'onchain_verified',
    yieldOrigin: 'Ether Swap Volume (0.30% Fee)',
    yieldOriginDetails: 'Every swap between USDC and WETH contributes a 0.30% fee directly to fee reserves, allowing LPs to harvest pure USDC and WETH yield.',
    gasBenefitNote: 'Gas fees on Arc are paid in USDC — zero ETH needed for gas.',
    howItWorksSteps: [
      { step: 1, title: 'Deposit Tokens', desc: 'Deposit USDC + WETH proportionally with 1-Click Zap.' },
      { step: 2, title: 'Receive afUSDC-WETH', desc: 'Receive standardized 18-decimal LP tokens representing your pool share.' },
      { step: 3, title: 'Earn Trading Fees', desc: 'Accumulate 0.30% fee on all swaps between USDC and WETH.' },
      { step: 4, title: 'Harvest Anytime', desc: 'Harvest real USDC and WETH swap fees anytime without burning LP tokens.' },
    ],
    tags: ['Constant Product', 'Ethereum', 'Bridged WETH', 'Real Yield', 'Concentrated Liquidity'],
    isLpPool: true,
    lpTokenName: 'Arcis USDC-WETH LP',
    lpTokenSymbol: 'af-USDC-WETH',
    supportsZap: true,
    feeTierPercent: 0.30,
    reserves: { tokenA: 0, tokenB: 0, ratioA: 50, ratioB: 50 },
    impermanentLossRisk: 'Medium',
    paused: false,
  },
  {
    id: 'eurc-weth-pool',
    name: 'EURC / WETH',
    subtitle: 'Constant Product (x·y=k) liquidity pool for Euro and Bridged Ether on Arc.',
    description: 'Constant product AMM pool with 0.30% swap fee tier for direct EURC and WETH trading, with real on-chain fee streaming to LPs in EURC and WETH.',
    category: 'liquidity',
    tokens: [
      { symbol: 'EURC', name: 'Euro Coin', address: POOL_CONTRACTS.EURC, iconType: 'eurc', decimals: 6 },
      { symbol: 'WETH', name: 'Wrapped Ether', address: POOL_CONTRACTS.WETH, iconType: 'weth', decimals: 18 },
    ],
    apy: 14.8,
    apyType: 'APR',
    apyBadge: '14.80% APR • Dynamic Real Yield',
    tvlUsd: 0,
    volume24hUsd: 0,
    lockPeriod: 'No Lock',
    riskLevel: 'Medium',
    feeShare: '0.30% Swap Fee to LPs',
    contractAddress: POOL_CONTRACTS.EURC_WETH_POOL,
    depositTokenSymbol: 'EURC + WETH',
    rewardTokenSymbol: 'LP Share Growth (EURC / WETH)',
    isFeatured: true,
    isLiveOnChain: true,
    executionMode: 'onchain_verified',
    yieldOrigin: 'Euro-Ether Swap Volume (0.30% Fee)',
    yieldOriginDetails: 'Every swap between EURC and WETH contributes a 0.30% fee directly to fee reserves, allowing LPs to harvest pure EURC and WETH yield.',
    gasBenefitNote: 'Gas fees on Arc are paid in USDC — zero ETH needed for gas.',
    howItWorksSteps: [
      { step: 1, title: 'Deposit Tokens', desc: 'Deposit EURC + WETH proportionally with 1-Click Zap.' },
      { step: 2, title: 'Receive afEURC-WETH', desc: 'Receive standardized 18-decimal LP tokens representing your pool share.' },
      { step: 3, title: 'Earn Trading Fees', desc: 'Accumulate 0.30% fee on all swaps between EURC and WETH.' },
      { step: 4, title: 'Harvest Anytime', desc: 'Harvest real EURC and WETH swap fees anytime without burning LP tokens.' },
    ],
    tags: ['Constant Product', 'Ethereum', 'EURC Forex', 'Real Yield', 'Cross-Pair', 'Concentrated Liquidity'],
    isLpPool: true,
    lpTokenName: 'Arcis EURC-WETH LP',
    lpTokenSymbol: 'af-EURC-WETH',
    supportsZap: true,
    feeTierPercent: 0.30,
    reserves: { tokenA: 0, tokenB: 0, ratioA: 50, ratioB: 50 },
    impermanentLossRisk: 'Medium',
    paused: false,
  },
]

// ── Contract ABIs ────────────────────────────────────────────────────────────
export const ERC20_ABI = [
  { type: 'function', name: 'balanceOf', stateMutability: 'view', inputs: [{ name: 'account', type: 'address' }], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'allowance', stateMutability: 'view', inputs: [{ name: 'owner', type: 'address' }, { name: 'spender', type: 'address' }], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'approve', stateMutability: 'nonpayable', inputs: [{ name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [{ type: 'bool' }] },
  { type: 'function', name: 'transfer', stateMutability: 'nonpayable', inputs: [{ name: 'to', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [{ type: 'bool' }] },
  { type: 'function', name: 'transferFrom', stateMutability: 'nonpayable', inputs: [{ name: 'from', type: 'address' }, { name: 'to', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [{ type: 'bool' }] },
] as const

export const STABLE_SWAP_ABI = [
  // SECURITY: only slippage-guarded overloads are exposed. The old 2-arg addLiquidity /
  // 1-arg removeLiquidity ABI entries were REMOVED together with the contract overloads —
  // callers must always pass explicit minLpShares / minOut values.
  { type: 'function', name: 'addLiquidity', stateMutability: 'nonpayable', inputs: [{ name: 'amountAIn', type: 'uint256' }, { name: 'amountBIn', type: 'uint256' }, { name: 'minLpShares', type: 'uint256' }], outputs: [{ name: 'lpShares', type: 'uint256' }] },
  { type: 'function', name: 'removeLiquidity', stateMutability: 'nonpayable', inputs: [{ name: 'lpAmount', type: 'uint256' }, { name: 'minOutA', type: 'uint256' }, { name: 'minOutB', type: 'uint256' }], outputs: [{ name: 'outA', type: 'uint256' }, { name: 'outB', type: 'uint256' }] },
  { type: 'function', name: 'swap', stateMutability: 'nonpayable', inputs: [{ name: 'tokenIn', type: 'address' }, { name: 'tokenOut', type: 'address' }, { name: 'amountIn', type: 'uint256' }, { name: 'minOut', type: 'uint256' }], outputs: [{ name: 'amountOut', type: 'uint256' }] },
  { type: 'function', name: 'reserveA', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'reserveB', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'totalLp', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'unclaimedFeeA', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'unclaimedFeeB', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  // V4 on-chain per-LP fee accounting — replaces every client-side checkpoint.
  { type: 'function', name: 'pendingFees', stateMutability: 'view', inputs: [{ name: 'lp', type: 'address' }], outputs: [{ name: 'feeA', type: 'uint256' }, { name: 'feeB', type: 'uint256' }] },
  { type: 'function', name: 'harvest', stateMutability: 'nonpayable', inputs: [], outputs: [{ name: 'feeA', type: 'uint256' }, { name: 'feeB', type: 'uint256' }] },
  { type: 'function', name: 'feeReserveA', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'feeReserveB', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  {
    type: 'event',
    name: 'FeesHarvested',
    inputs: [
      { name: 'lp', type: 'address', indexed: true },
      { name: 'feeA', type: 'uint256', indexed: false },
      { name: 'feeB', type: 'uint256', indexed: false },
    ],
  },
  { type: 'function', name: 'accumulatedFeeA', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'accumulatedFeeB', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'swapFeeBps', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'balanceOf', stateMutability: 'view', inputs: [{ name: 'account', type: 'address' }], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'pause', stateMutability: 'nonpayable', inputs: [], outputs: [] },
  { type: 'function', name: 'unpause', stateMutability: 'nonpayable', inputs: [], outputs: [] },
  { type: 'function', name: 'paused', stateMutability: 'view', inputs: [], outputs: [{ type: 'bool' }] },
  // 24H rolling counters (V3.2 lazy reset)
  { type: 'function', name: 'e24hVolumeA', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'e24hVolumeB', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'e24hWindowStart', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'volume24hA', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'volume24hB', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'getVirtualPrice', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'VERSION', stateMutability: 'view', inputs: [], outputs: [{ type: 'string' }] },
  { type: 'function', name: 'lpFeeBps', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'protocolFeeBps', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'totalFeeBps', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  // Events for transaction receipt decoding (K1, K2)
  {
    type: 'event',
    name: 'LiquidityAdded',
    inputs: [
      { name: 'provider', type: 'address', indexed: true },
      { name: 'amountA', type: 'uint256', indexed: false },
      { name: 'amountB', type: 'uint256', indexed: false },
      { name: 'lpMinted', type: 'uint256', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'LiquidityRemoved',
    inputs: [
      { name: 'provider', type: 'address', indexed: true },
      { name: 'lpAmount', type: 'uint256', indexed: false },
      { name: 'amountA', type: 'uint256', indexed: false },
      { name: 'amountB', type: 'uint256', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'Swapped',
    inputs: [
      { name: 'user', type: 'address', indexed: true },
      { name: 'tokenIn', type: 'address', indexed: false },
      { name: 'amountIn', type: 'uint256', indexed: false },
      { name: 'amountOut', type: 'uint256', indexed: false },
    ],
  },
] as const

// Note: CONSTANT_PRODUCT_ABI intentionally aliases STABLE_SWAP_ABI.
// On Arc Testnet, both Constant-Product and Curve-style pools share the identical
// external interface (swap, addLiquidity, removeLiquidity, reserveA, reserveB, totalLp).
export const CONSTANT_PRODUCT_ABI = STABLE_SWAP_ABI


export const YIELD_VAULT_ABI = [
  { type: 'function', name: 'deposit', stateMutability: 'nonpayable', inputs: [{ name: 'assets', type: 'uint256' }, { name: 'receiver', type: 'address' }], outputs: [{ name: 'shares', type: 'uint256' }] },
  { type: 'function', name: 'redeem', stateMutability: 'nonpayable', inputs: [{ name: 'shares', type: 'uint256' }, { name: 'receiver', type: 'address' }, { name: 'owner', type: 'address' }], outputs: [{ name: 'assets', type: 'uint256' }] },
  { type: 'function', name: 'previewDeposit', stateMutability: 'view', inputs: [{ name: 'assets', type: 'uint256' }], outputs: [{ name: 'shares', type: 'uint256' }] },
  { type: 'function', name: 'previewRedeem', stateMutability: 'view', inputs: [{ name: 'shares', type: 'uint256' }], outputs: [{ name: 'assets', type: 'uint256' }] },
  { type: 'function', name: 'previewWithdraw', stateMutability: 'view', inputs: [{ name: 'shares', type: 'uint256' }], outputs: [{ name: 'assets', type: 'uint256' }] },
  // H4: guarded entrypoints — deposits carry a min-shares guard and exits a min-assets guard
  // so a share-price manipulation between quote and execution reverts instead of underpaying.
  { type: 'function', name: 'depositWithMinShares', stateMutability: 'nonpayable', inputs: [{ name: 'assets', type: 'uint256' }, { name: 'receiver', type: 'address' }, { name: 'minShares', type: 'uint256' }], outputs: [{ name: 'shares', type: 'uint256' }] },
  { type: 'function', name: 'redeemWithMinAssets', stateMutability: 'nonpayable', inputs: [{ name: 'shares', type: 'uint256' }, { name: 'receiver', type: 'address' }, { name: 'owner_', type: 'address' }, { name: 'minAssets', type: 'uint256' }], outputs: [{ name: 'assets', type: 'uint256' }] },
  { type: 'function', name: 'decimals', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint8' }] },
  // V4 on-chain cost basis + real harvest (no localStorage checkpoint).
  { type: 'function', name: 'pendingYield', stateMutability: 'view', inputs: [{ name: 'user', type: 'address' }], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'principalAssets', stateMutability: 'view', inputs: [{ name: 'user', type: 'address' }], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'harvest', stateMutability: 'nonpayable', inputs: [], outputs: [{ name: 'amount', type: 'uint256' }] },
  {
    type: 'event',
    name: 'YieldHarvested',
    inputs: [
      { name: 'user', type: 'address', indexed: true },
      { name: 'amount', type: 'uint256', indexed: false },
    ],
  },
  { type: 'function', name: 'totalAssets', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'totalSupply', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'balanceOf', stateMutability: 'view', inputs: [{ name: 'account', type: 'address' }], outputs: [{ type: 'uint256' }] },
  {
    type: 'event',
    name: 'Deposit',
    inputs: [
      { name: 'sender', type: 'address', indexed: true },
      { name: 'owner', type: 'address', indexed: true },
      { name: 'assets', type: 'uint256', indexed: false },
      { name: 'shares', type: 'uint256', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'Withdraw',
    inputs: [
      { name: 'sender', type: 'address', indexed: true },
      { name: 'receiver', type: 'address', indexed: true },
      { name: 'owner', type: 'address', indexed: true },
      { name: 'assets', type: 'uint256', indexed: false },
      { name: 'shares', type: 'uint256', indexed: false },
    ],
  },
] as const

export const ARCIS_SWAP_ROUTER_ABI = [
  {
    type: 'function',
    name: 'swapWithFee',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'pool', type: 'address' },
      { name: 'tokenIn', type: 'address' },
      { name: 'tokenOut', type: 'address' },
      { name: 'amountIn', type: 'uint256' },
      { name: 'minOut', type: 'uint256' },
      { name: 'treasury', type: 'address' },
      { name: 'feeBps', type: 'uint256' },
    ],
    outputs: [{ name: 'amountOut', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'zapIn',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'pool', type: 'address' },
      { name: 'tokenIn', type: 'address' },
      { name: 'tokenOther', type: 'address' },
      { name: 'amountIn', type: 'uint256' },
      { name: 'swapRatioBps', type: 'uint256' },
      { name: 'minSwapOut', type: 'uint256' },
      { name: 'minLpOut', type: 'uint256' },
      { name: 'to', type: 'address' },
    ],
    outputs: [{ name: 'lpShares', type: 'uint256' }],
  },
  {
    type: 'event',
    name: 'SwapWithFee',
    inputs: [
      { name: 'user', type: 'address', indexed: true },
      { name: 'pool', type: 'address', indexed: true },
      { name: 'tokenIn', type: 'address', indexed: false },
      { name: 'tokenOut', type: 'address', indexed: false },
      { name: 'amountIn', type: 'uint256', indexed: false },
      { name: 'amountOut', type: 'uint256', indexed: false },
      { name: 'feeAmount', type: 'uint256', indexed: false },
      { name: 'treasury', type: 'address', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'ZapIn',
    inputs: [
      { name: 'user', type: 'address', indexed: true },
      { name: 'pool', type: 'address', indexed: true },
      { name: 'tokenIn', type: 'address', indexed: false },
      { name: 'amountIn', type: 'uint256', indexed: false },
      { name: 'swappedIn', type: 'uint256', indexed: false },
      { name: 'swappedOut', type: 'uint256', indexed: false },
      { name: 'lpShares', type: 'uint256', indexed: false },
    ],
  },
] as const
