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
  iconType: 'usdc' | 'eurc' | 'btc' | 'arc' | 'gateway'
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
  impermanentLossRisk?: 'Zero (Stable)' | 'Low' | 'Medium'
  isFaucetToken?: boolean
  faucetTokenAddress?: `0x${string}`
}

// ── Deployed Contract Addresses (Arc Testnet — V3, mainnet-bound) ─────────────
// V3 restores the canonical Curve amplification constant Ann = A*4 (V2 silently used
// A*2 — see contracts/test/StableMathComparison.t.sol). These addresses were produced
// by `forge script script/DeployV3.s.sol --rpc-url arc_testnet --broadcast --verify`
// and verified on ArcScan testnet.
export const POOL_CONTRACTS = {
  USDC: ARC_TOKENS.USDC,
  EURC: ARC_TOKENS.EURC,
  cirBTC: ARC_TOKENS.cirBTC,
  // Deployed 2026-09-11 — hardened V3.2 set (24h rolling volume counters, totalYieldDistributed)
  // Owner: 0x3d839c9B5729aA3eA286d9BF7eBA5B7C542de772
  STABLE_SWAP_POOL: '0xCd0BcEc811E0d9C9d679DcDD73d9B20357e8fb22' as const, // StableSwapPoolV3
  CONSTANT_PRODUCT_POOL: '0xF3742bDF819211dd1dcBbF577F031Bb743318903' as const, // ConstantProductPoolV3
  YIELD_VAULT: '0x5e618f7f6591868827da40f73f869e3dE8F387CD' as const, // YieldVaultV3
  ARCIS_SWAP_ROUTER: '0x22733d5C4C91C7BEF2BED43e3f3F42B2d91DfcD4' as const, // ArcisSwapRouter (Single-tx atomic swap + fee)
}

// ── V3 (verified testnet) Deploy Targets ───────────────────────────────────────
// Same addresses as POOL_CONTRACTS; kept for mainnet migration. When deploying to
// Arc Mainnet, re-run contracts/script/DeployV3.s.sol --rpc-url arc_mainnet and
// update these to the mainnet addresses, then repoint POOL_CONTRACTS here.
export const POOL_CONTRACTS_V3 = {
  STABLE_SWAP_POOL: POOL_CONTRACTS.STABLE_SWAP_POOL as `0x${string}`,
  CONSTANT_PRODUCT_POOL: POOL_CONTRACTS.CONSTANT_PRODUCT_POOL as `0x${string}`,
  YIELD_VAULT: POOL_CONTRACTS.YIELD_VAULT as `0x${string}`,
  ARCIS_SWAP_ROUTER: POOL_CONTRACTS.ARCIS_SWAP_ROUTER as `0x${string}`,
}

// ── Pool Version & Slippage Helpers ───────────────────────────────────────────
// LIVE contracts are now V3 (mainnet-bound) on Arc Testnet.
export const POOL_VERSION_V3: boolean = (import.meta.env.VITE_POOL_VERSION ?? 'v3') === 'v3'
export const POOL_VERSION_V2: boolean = import.meta.env.VITE_POOL_V2 === 'true'

// Default AMM LP operation slippage tolerance (0.5%).
export const POOL_DEFAULT_SLIPPAGE_BPS = 50

// Converts a percent tolerance (e.g. 0.5) to bps, clamped to [10, 1000].
export function poolSlippageBps(tolerancePercent: number): number {
  if (!Number.isFinite(tolerancePercent) || tolerancePercent <= 0) return POOL_DEFAULT_SLIPPAGE_BPS
  return Math.max(10, Math.min(1000, Math.round(tolerancePercent * 100)))
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

// Canonical Gateway Constants (O2)
export const GATEWAY_BASE_LIQUIDITY = 3_145_000
export const GATEWAY_ROUTING_APY = 7.25

// ── Master Pools Directory ───────────────────────────────────────────────────
export const ARCIS_POOLS: PoolConfig[] = [
  {
    id: 'usdc-eurc-stable-pool',
    name: 'USDC / EURC Stable Pool',
    subtitle: 'Earn FX swap fees from USD–EUR conversions with near-zero loss.',
    description: 'Provide liquidity for foreign exchange swaps between Circle USDC and EURC on Arc.',
    category: 'liquidity',
    tokens: [
      { symbol: 'USDC', name: 'USD Coin', address: POOL_CONTRACTS.USDC, iconType: 'usdc', decimals: 6 },
      { symbol: 'EURC', name: 'Euro Coin', address: POOL_CONTRACTS.EURC, iconType: 'eurc', decimals: 6 },
    ],
    apy: 6.15, apyType: 'APY', apyBadge: '6.15% Variable FX APY (Est.)',
    tvlUsd: 0, volume24hUsd: 0.00, lockPeriod: 'No Lock',
    riskLevel: 'Safe', feeShare: '0.12% Swap Fee to LPs',
    contractAddress: POOL_CONTRACTS.STABLE_SWAP_POOL,
    depositTokenSymbol: 'USDC + EURC', rewardTokenSymbol: 'LP Fees (USDC/EURC)',
    isFeatured: true, isLiveOnChain: true, executionMode: 'onchain_verified',
    yieldOrigin: 'FX Swap Fees (Direct Reserve Accrual)',
    yieldOriginDetails: 'A 0.12% fee from users exchanging between USDC and EURC is added directly to pool reserves on every swap, increasing LP share value.',
    gasBenefitNote: 'Gas fees on Arc are paid in USDC — no ETH needed.',
    howItWorksSteps: [
      { step: 1, title: 'Provide Liquidity', desc: 'Deposit USDC + EURC (or single-token USDC via Zap).' },
      { step: 2, title: 'Receive LP Token', desc: 'Get af-USDC-EURC representing your pool share.' },
      { step: 3, title: 'Accumulate FX Fees', desc: 'Swap fees compound directly into pool reserves.' },
      { step: 4, title: 'Realize Upon Exit', desc: 'Burn LP tokens to withdraw principal + accumulated fee share.' },
    ],
    tags: ['StableSwap', 'FX Market', 'Zero IL', 'Single Asset'],
    isLpPool: true, lpTokenName: 'Arcis USDC-EURC LP', lpTokenSymbol: 'af-USDC-EURC',
    supportsZap: true, feeTierPercent: 0.12,
    reserves: { tokenA: 0, tokenB: 0, ratioA: 50, ratioB: 50 },
    impermanentLossRisk: 'Zero (Stable)',
  },
  {
    id: 'usdc-cirbtc-pool',
    name: 'USDC / cirBTC Liquidity Pool',
    subtitle: 'Provide liquidity for Circle Wrapped Bitcoin on Arc Testnet.',
    description: 'AMM pool for swaps between native USDC and Circle Wrapped Bitcoin (cirBTC) using constant-product pricing.',
    category: 'liquidity',
    tokens: [
      { symbol: 'USDC', name: 'USD Coin', address: POOL_CONTRACTS.USDC, iconType: 'usdc', decimals: 6 },
      { symbol: 'cirBTC', name: 'Circle Wrapped Bitcoin', address: POOL_CONTRACTS.cirBTC, iconType: 'btc', decimals: 8 },
    ],
    apy: 12.8, apyType: 'APY', apyBadge: '12.80% Dynamic Fee APY (Est.)',
    tvlUsd: 0, volume24hUsd: 0.00, lockPeriod: 'No Lock',
    riskLevel: 'Medium', feeShare: '0.25% Swap Fee to LPs',
    contractAddress: POOL_CONTRACTS.CONSTANT_PRODUCT_POOL,
    depositTokenSymbol: 'USDC + cirBTC', rewardTokenSymbol: 'LP Fees (USDC/cirBTC)',
    isFeatured: true, isLiveOnChain: true, executionMode: 'onchain_verified',
    yieldOrigin: 'Swap Volume Fees (0.25% Direct Accrual)',
    yieldOriginDetails: 'A 0.25% fee from traders swapping between USDC and cirBTC accrues inside the constant-product reserves.',
    gasBenefitNote: 'Gas fees on Arc are paid in USDC — zero ETH or BTC needed for gas.',
    howItWorksSteps: [
      { step: 1, title: 'Provide Liquidity', desc: 'Deposit USDC + cirBTC (or single-token USDC via Zap).' },
      { step: 2, title: 'Receive LP Token', desc: 'Get af-USDC-cirBTC representing your pool share.' },
      { step: 3, title: 'Earn Trading Fees', desc: 'Trading fees automatically grow the reserve ratio.' },
      { step: 4, title: 'Flexible Withdraw', desc: 'Redeem LP tokens anytime to claim principal + fee growth.' },
    ],
    tags: ['ConstantProduct', 'Bitcoin', 'Dual AMM', 'Single Asset'],
    isLpPool: true, lpTokenName: 'Arcis USDC-cirBTC LP', lpTokenSymbol: 'af-USDC-cirBTC',
    supportsZap: true, feeTierPercent: 0.25,
    reserves: { tokenA: 0, tokenB: 0, ratioA: 50, ratioB: 50 },
    impermanentLossRisk: 'Medium',
  },
  {
    id: 'usdc-yield-vault',
    name: 'USDC Yield Vault',
    subtitle: 'Deposit USDC, earn real USDC yield via ERC-4626 share appreciation.',
    description: 'A single-asset ERC-4626 vault. Deposited USDC receives shares that appreciate as protocol fees are distributed.',
    category: 'vault',
    tokens: [
      { symbol: 'USDC', name: 'USD Coin', address: POOL_CONTRACTS.USDC, iconType: 'usdc', decimals: 6 },
    ],
    apy: 8.42, apyType: 'APY', apyBadge: '8.42% Vault Yield (Est.)',
    tvlUsd: 0, volume24hUsd: 0.00, lockPeriod: 'Flexible (Unstake Anytime)',
    riskLevel: 'Low', feeShare: '90% Protocol Revenue Share',
    contractAddress: POOL_CONTRACTS.YIELD_VAULT,
    depositTokenSymbol: 'USDC', rewardTokenSymbol: 'USDC',
    isFeatured: true, isLiveOnChain: true, executionMode: 'onchain_verified',
    yieldOrigin: 'Arcis Protocol Revenue Share (ERC-4626)',
    yieldOriginDetails: '90% of protocol fees from Send, Swap, and Bridge transactions are distributed into the vault, raising totalAssets and share price.',
    gasBenefitNote: 'Zero token inflation. Rewards are paid in 100% real USDC cash upon redeeming shares.',
    howItWorksSteps: [
      { step: 1, title: 'Deposit USDC', desc: 'Deposit USDC into the ERC-4626 yield vault.' },
      { step: 2, title: 'Share Appreciation', desc: 'Protocol revenue increases totalAssets, driving up each share value.' },
      { step: 3, title: 'Auto-Compounding', desc: 'Yield compounds automatically without manual claiming or harvest gas.' },
      { step: 4, title: 'Redeem for USDC', desc: 'Redeem your shares anytime to withdraw principal + accumulated USDC yield.' },
    ],
    tags: ['ERC-4626', 'Real Yield', 'Revenue Share', 'USDC Payout'],
    supportsZap: true,
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

export const CONSTANT_PRODUCT_ABI = STABLE_SWAP_ABI


export const YIELD_VAULT_ABI = [
  { type: 'function', name: 'deposit', stateMutability: 'nonpayable', inputs: [{ name: 'assets', type: 'uint256' }, { name: 'receiver', type: 'address' }], outputs: [{ name: 'shares', type: 'uint256' }] },
  { type: 'function', name: 'redeem', stateMutability: 'nonpayable', inputs: [{ name: 'shares', type: 'uint256' }, { name: 'receiver', type: 'address' }, { name: 'owner', type: 'address' }], outputs: [{ name: 'assets', type: 'uint256' }] },
  { type: 'function', name: 'previewDeposit', stateMutability: 'view', inputs: [{ name: 'assets', type: 'uint256' }], outputs: [{ name: 'shares', type: 'uint256' }] },
  { type: 'function', name: 'previewRedeem', stateMutability: 'view', inputs: [{ name: 'shares', type: 'uint256' }], outputs: [{ name: 'assets', type: 'uint256' }] },
  { type: 'function', name: 'totalAssets', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'totalSupply', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'balanceOf', stateMutability: 'view', inputs: [{ name: 'account', type: 'address' }], outputs: [{ type: 'uint256' }] },
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
] as const