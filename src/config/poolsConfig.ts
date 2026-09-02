// src/config/poolsConfig.ts
//
// Arcis Pools & Yield — Testnet-first configuration (Phase 5 rewrite).
// 3 clear categories: Liquidity, Vault, Cross-Chain.

import { ARC_TOKENS } from './arcChain'
import { CHAIN_META, CHAIN_DEFS, getChainIconId, getChainDisplayName } from './chainMeta'

export { CHAIN_META, CHAIN_DEFS, getChainIconId, getChainDisplayName }
export const POOLS_CHAIN_META = CHAIN_META
export const POOLS_CHAIN_DEFS = CHAIN_DEFS

export type PoolCategory = 'liquidity' | 'vault' | 'crosschain'
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
  lockPeriod: string
  riskLevel: PoolRiskLevel
  feeShare: string
  contractAddress: `0x${string}`
  depositTokenSymbol: string
  rewardTokenSymbol: string
  isFeatured?: boolean
  isLiveOnChain?: boolean
  executionMode?: 'testnet_sandbox' | 'onchain_verified' | 'preview'
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
  isCrossChainPool?: boolean
  supportedChainsCount?: number
  isFaucetToken?: boolean
  faucetTokenAddress?: `0x${string}`
}

// ── Gateway Depth & Speed Configuration ─────────────────────────────────────
export interface GatewayChainDepth {
  chainKey: string
  avgSettlementMs?: number
  availableLiquidityUsd?: number
}

export const GATEWAY_NETWORK_DEPTHS: GatewayChainDepth[] = [
  { chainKey: 'Arc_Testnet', avgSettlementMs: 380, availableLiquidityUsd: 1250000 },
  { chainKey: 'Ethereum_Sepolia', avgSettlementMs: 420, availableLiquidityUsd: 850000 },
  { chainKey: 'Base_Sepolia', avgSettlementMs: 390, availableLiquidityUsd: 920000 },
  { chainKey: 'Arbitrum_Sepolia', avgSettlementMs: 410, availableLiquidityUsd: 780000 },
  { chainKey: 'Optimism_Sepolia', avgSettlementMs: 430, availableLiquidityUsd: 640000 },
  { chainKey: 'Polygon_Amoy_Testnet', avgSettlementMs: 450, availableLiquidityUsd: 510000 },
  { chainKey: 'Avalanche_Fuji', avgSettlementMs: 400, availableLiquidityUsd: 430000 },
  { chainKey: 'HyperEVM_Testnet', avgSettlementMs: 350, availableLiquidityUsd: 320000 },
  { chainKey: 'Sei_Testnet', avgSettlementMs: 360, availableLiquidityUsd: 290000 },
  { chainKey: 'Solana_Devnet', avgSettlementMs: 440, availableLiquidityUsd: 670000 },
  { chainKey: 'Sonic_Testnet', avgSettlementMs: 340, availableLiquidityUsd: 410000 },
  { chainKey: 'Unichain_Sepolia', avgSettlementMs: 420, availableLiquidityUsd: 380000 },
  { chainKey: 'World_Chain_Sepolia', avgSettlementMs: 460, availableLiquidityUsd: 250000 },
]

// ── ERC-8183 / ERC-8004 AI Agent Bounty & Escrow Definitions ────────────────
export interface AgentBountyTask {
  id: string
  title: string
  description: string
  agentName: string
  agentAddress: string
  agentReputationScore: number
  escrowLockedUsdc: number
  sponsorCount: number
  status: 'in_progress' | 'completed' | 'proof_submitted'
  targetCompletionDate: string
  aprReward: number
  category: 'Arbitrage' | 'Security' | 'Oracle' | 'Liquidity' | string
  proofHash?: string
  // ── Yield-Generating Escrow Properties ──
  escrowYieldVault?: string
  accumulatedYieldUsdc?: number
  yieldApr?: number
  yieldBeneficiary?: 'Sponsor Cash-Back' | 'Agent Bonus' | 'Protocol Revenue'
  escrowStartTime?: number
}

export const DEFAULT_AGENT_BOUNTY_ADDRESS = '0x8004E88A91C27B4938D82A7401EF82B33F71D3A9'

export const AGENT_BOUNTIES_LIST: AgentBountyTask[] = [
  {
    id: 'bounty-1',
    title: 'Multi-Chain FX Rate Arbitrage Sentinel',
    description: 'Autonomous rebalancer detecting USDC/EURC deviations across Base Sepolia and Arc Testnet.',
    agentName: 'ArcSentinel-v4',
    agentAddress: '0x8004A7bE0919327e4A70889218EF99042b781B89',
    agentReputationScore: 99,
    escrowLockedUsdc: 2500,
    sponsorCount: 14,
    status: 'in_progress',
    targetCompletionDate: 'Active Escrow',
    aprReward: 16.4,
    category: 'Arbitrage',
    escrowYieldVault: 'Arcis Real-Yield Vault',
    accumulatedYieldUsdc: 42.60,
    yieldApr: 8.42,
    yieldBeneficiary: 'Sponsor Cash-Back',
    escrowStartTime: Date.now() - 1000 * 60 * 60 * 24 * 18, // 18 days ago
  },
  {
    id: 'bounty-2',
    title: 'Circle Gateway Sub-Second Finality Verifier',
    description: 'ZK-attestation validator checking sub-500ms burn-and-mint settlement across 9 testnet chains.',
    agentName: 'GatewayProver-01',
    agentAddress: '0x8004B99c1D227e748A938C0409A349A7818A2B99',
    agentReputationScore: 97,
    escrowLockedUsdc: 1800,
    sponsorCount: 9,
    status: 'proof_submitted',
    targetCompletionDate: 'Proof Pending Verification',
    aprReward: 14.8,
    category: 'Security',
    proofHash: '0x80041a87e2b4f910cd1e4832bf6e3a9c7710a91e5c2b9a4c871029e18b820a4b',
    escrowYieldVault: 'Arcis Real-Yield Vault (ERC-4626)',
    accumulatedYieldUsdc: 31.45,
    yieldApr: 8.42,
    yieldBeneficiary: 'Agent Bonus',
    escrowStartTime: Date.now() - 1000 * 60 * 60 * 24 * 12, // 12 days ago
  },
  {
    id: 'bounty-3',
    title: 'Arc High-Frequency DEX Liquidity Guard',
    description: 'Dynamic spread optimizer keeping slippage under 0.05% for StableSwap pools.',
    agentName: 'FluxOptimizer-AI',
    agentAddress: '0x8004C8827FA7194A198284729182C092847A8901',
    agentReputationScore: 95,
    escrowLockedUsdc: 3200,
    sponsorCount: 21,
    status: 'in_progress',
    targetCompletionDate: 'Active Escrow',
    aprReward: 15.2,
    category: 'Liquidity',
    escrowYieldVault: 'Arcis Real-Yield Vault',
    accumulatedYieldUsdc: 58.20,
    yieldApr: 8.42,
    yieldBeneficiary: 'Sponsor Cash-Back',
    escrowStartTime: Date.now() - 1000 * 60 * 60 * 24 * 24, // 24 days ago
  },
]

// ── Deployed Contract Addresses (Arc Testnet) ────────────────────────────────
export const POOL_CONTRACTS = {
  USDC: ARC_TOKENS.USDC,
  EURC: ARC_TOKENS.EURC,
  cirBTC: ARC_TOKENS.cirBTC,
  tcirBTC: '0x6a32d40a9f9aca0c2b244c53d7c35c0dffbbb8d2' as const,
  STABLE_SWAP_POOL: '0x6d8fda7557d1c0a945a955557e10a4e70a129d20' as const,
  CONSTANT_PRODUCT_POOL: '0x179c9d7f75b0aee8ffe9451fec060b9639220fe6' as const,
  CONSTANT_PRODUCT_POOL_TCIRBTC: '0x24f09544f554b26c44cf309cfafe448a1a9d3c1f' as const,
  YIELD_VAULT: '0x4a4f0c1dd34c5433a228cbc3a499fabf18e3156d' as const,
}

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
    apy: 6.15, apyType: 'APR', apyBadge: '6.15% FX Fee APR',
    tvlUsd: 532000, volume24hUsd: 142300, lockPeriod: 'No Lock',
    riskLevel: 'Safe', feeShare: '0.12% Swap Fee to LPs',
    contractAddress: POOL_CONTRACTS.STABLE_SWAP_POOL,
    depositTokenSymbol: 'USDC + EURC', rewardTokenSymbol: 'LP Fees (USDC/EURC)',
    isFeatured: true, isLiveOnChain: true, executionMode: 'onchain_verified',
    yieldOrigin: 'FX Swap Fees',
    yieldOriginDetails: 'A 0.12% fee from users exchanging between USDC and EURC is distributed to liquidity providers on every swap.',
    gasBenefitNote: 'Gas fees on Arc are paid in USDC — no ETH needed.',
    howItWorksSteps: [
      { step: 1, title: 'Provide Liquidity', desc: 'Deposit USDC + EURC (or use 1-Click Zap with USDC).' },
      { step: 2, title: 'Receive LP Token', desc: 'Get af-USDC-EURC representing your pool share.' },
      { step: 3, title: 'Collect FX Fees', desc: 'Earn a fee on every USD–EUR conversion.' },
      { step: 4, title: 'Zero IL', desc: 'Stable fiat pegs eliminate impermanent loss.' },
    ],
    tags: ['StableSwap', 'FX Market', 'Zero IL', '1-Click Zap'],
    isLpPool: true, lpTokenName: 'Arcis USDC-EURC LP', lpTokenSymbol: 'af-USDC-EURC',
    supportsZap: true, exchangeRate: 1.082, feeTierPercent: 0.12,
    reserves: { tokenA: 266000, tokenB: 245841, ratioA: 50, ratioB: 50 },
    impermanentLossRisk: 'Zero (Stable)',
  },
  {
    id: 'usdc-tcirbtc-pool',
    name: 'USDC / tcirBTC Test Pool',
    subtitle: 'Test with mintable tcirBTC — get free tokens from the faucet.',
    description: 'Practice providing Bitcoin liquidity using mintable tcirBTC. Every user can mint test tokens instantly.',
    category: 'liquidity',
    tokens: [
      { symbol: 'USDC', name: 'USD Coin', address: POOL_CONTRACTS.USDC, iconType: 'usdc', decimals: 6 },
      { symbol: 'tcirBTC', name: 'Test cirBTC', address: POOL_CONTRACTS.tcirBTC, iconType: 'btc', decimals: 8 },
    ],
    apy: 12.8, apyType: 'APR', apyBadge: '12.80% Test Yield',
    tvlUsd: 50000, volume24hUsd: 10000, lockPeriod: 'No Lock',
    riskLevel: 'Medium', feeShare: '0.25% Swap Fee to LPs',
    contractAddress: POOL_CONTRACTS.CONSTANT_PRODUCT_POOL_TCIRBTC,
    depositTokenSymbol: 'USDC + tcirBTC', rewardTokenSymbol: 'LP Fees',
    isFeatured: true, isLiveOnChain: true, executionMode: 'onchain_verified',
    yieldOrigin: 'Test Swap Volume Fees (0.25%)',
    yieldOriginDetails: 'Practice pool with mintable tcirBTC. Get free tokens from the faucet to test liquidity provision and swaps.',
    gasBenefitNote: 'Click "Get tcirBTC" on the pool card to receive free test tokens.',
    howItWorksSteps: [
      { step: 1, title: 'Get tcirBTC', desc: 'Click the faucet button to mint free test Bitcoin tokens.' },
      { step: 2, title: 'Add Liquidity', desc: 'Deposit USDC + tcirBTC or use 1-Click Zap.' },
      { step: 3, title: 'Swap & Earn', desc: 'Test swap fees and LP mechanics risk-free.' },
      { step: 4, title: 'Reset Anytime', desc: 'No real value — perfect for learning.' },
    ],
    tags: ['Testnet', 'Faucet', 'Practice', 'No Real Value'],
    isLpPool: true, lpTokenName: 'Arcis USDC-tcirBTC LP', lpTokenSymbol: 'af-USDC-tcBTC',
    supportsZap: true, exchangeRate: 96500, feeTierPercent: 0.25,
    reserves: { tokenA: 25000, tokenB: 0.259, ratioA: 50, ratioB: 50 },
    impermanentLossRisk: 'Medium',
    isFaucetToken: true,
    faucetTokenAddress: POOL_CONTRACTS.tcirBTC,
  },
  {
    id: 'usdc-yield-vault',
    name: 'USDC Yield Vault',
    subtitle: 'Deposit USDC, earn real USDC yield — no lockup, no inflation.',
    description: 'A single-asset ERC-4626 vault. Deposit USDC and receive vault shares that appreciate.',
    category: 'vault',
    tokens: [
      { symbol: 'USDC', name: 'USD Coin', address: POOL_CONTRACTS.USDC, iconType: 'usdc', decimals: 6 },
    ],
    apy: 8.42, apyType: 'APR', apyBadge: '8.42% Real Yield (USDC)',
    tvlUsd: 785300, volume24hUsd: 195400, lockPeriod: 'Flexible (Unstake Anytime)',
    riskLevel: 'Low', feeShare: '90% Protocol Revenue Share',
    contractAddress: POOL_CONTRACTS.YIELD_VAULT,
    depositTokenSymbol: 'USDC', rewardTokenSymbol: 'USDC',
    isFeatured: true, isLiveOnChain: true, executionMode: 'onchain_verified',
    yieldOrigin: 'Arcis Protocol Revenue Share',
    yieldOriginDetails: '90% of protocol fees from Send, Swap, and Bridge transactions are paid to vault depositors.',
    gasBenefitNote: 'Zero token inflation. Rewards are paid in 100% real USDC cash.',
    howItWorksSteps: [
      { step: 1, title: 'Deposit USDC', desc: 'Lock USDC in the revenue vault.' },
      { step: 2, title: 'Track Volume', desc: 'Platform trading fees accumulate in real time.' },
      { step: 3, title: 'Claim in USDC', desc: 'Claim your accrued USDC dividend rewards.' },
      { step: 4, title: 'Flexible Exit', desc: 'Unstake anytime with zero penalty.' },
    ],
    tags: ['Real Yield', 'Fee Sharing', 'Revenue Share', 'USDC Payout'],
    supportsZap: true,
  },
  {
    id: 'gateway-settlement-pool',
    name: 'Gateway Cross-Chain Settlement Pool',
    subtitle: 'Provide instant USDC settlement liquidity across 9 testnet chains.',
    description: 'Liquidity for Circle Gateway sub-second (<500ms) cross-chain burn and mint settlements.',
    category: 'crosschain',
    tokens: [
      { symbol: 'USDC', name: 'USD Coin (Gateway)', address: POOL_CONTRACTS.USDC, iconType: 'gateway', decimals: 6 },
    ],
    apy: 7.25, apyType: 'APR', apyBadge: '7.25% Cross-Chain Routing APR',
    tvlUsd: 2100000, volume24hUsd: 540000, lockPeriod: 'Flexible (Instant Settlement)',
    riskLevel: 'Low', feeShare: '0.03% Gateway Settlement Fee to LPs',
    contractAddress: POOL_CONTRACTS.USDC,
    depositTokenSymbol: 'USDC (Any Chain)', rewardTokenSymbol: 'USDC',
    isFeatured: true, isLiveOnChain: true, executionMode: 'onchain_verified',
    isCrossChainPool: true, supportedChainsCount: 9,
    yieldOrigin: '9-Chain Instant Routing & Settlement Fees',
    yieldOriginDetails: 'Capital powers the liquidity buffer for sub-second cross-chain transfers.',
    gasBenefitNote: 'Circle Gateway allows multi-chain capital efficiency.',
    howItWorksSteps: [
      { step: 1, title: 'Deposit USDC', desc: 'Add your unified USDC balance to the Gateway vault.' },
      { step: 2, title: 'Multi-Chain Buffer', desc: 'Funds power instant transfers on 9 chains.' },
      { step: 3, title: 'Collect Routing Fees', desc: 'Earn 0.03% protocol fee on settlements.' },
      { step: 4, title: 'Instant Exit', desc: 'Release and withdraw your USDC anytime.' },
    ],
    tags: ['Gateway', 'Cross-Chain', '<500ms Finality', '9 Testnet Chains'],
    supportsZap: true,
  },
]

export const ARCFLOW_POOLS = ARCIS_POOLS

// ── Contract ABIs ────────────────────────────────────────────────────────────
export const ERC20_ABI = [
  { type: 'function', name: 'balanceOf', stateMutability: 'view', inputs: [{ name: 'account', type: 'address' }], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'allowance', stateMutability: 'view', inputs: [{ name: 'owner', type: 'address' }, { name: 'spender', type: 'address' }], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'approve', stateMutability: 'nonpayable', inputs: [{ name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [{ type: 'bool' }] },
] as const

export const STABLE_SWAP_ABI = [
  { type: 'function', name: 'addLiquidity', stateMutability: 'nonpayable', inputs: [{ name: 'amountAIn', type: 'uint256' }, { name: 'amountBIn', type: 'uint256' }], outputs: [{ name: 'lpShares', type: 'uint256' }] },
  { type: 'function', name: 'removeLiquidity', stateMutability: 'nonpayable', inputs: [{ name: 'lpAmount', type: 'uint256' }], outputs: [{ name: 'outA', type: 'uint256' }, { name: 'outB', type: 'uint256' }] },
  { type: 'function', name: 'swap', stateMutability: 'nonpayable', inputs: [{ name: 'tokenIn', type: 'address' }, { name: 'tokenOut', type: 'address' }, { name: 'amountIn', type: 'uint256' }, { name: 'minOut', type: 'uint256' }], outputs: [{ name: 'amountOut', type: 'uint256' }] },
  { type: 'function', name: 'reserveA', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'reserveB', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'totalLp', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'unclaimedFeeA', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'unclaimedFeeB', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'balanceOf', stateMutability: 'view', inputs: [{ name: 'account', type: 'address' }], outputs: [{ type: 'uint256' }] },
] as const

export const CONSTANT_PRODUCT_ABI = STABLE_SWAP_ABI

// MockERC20 (mintable) ABI — used for tcirBTC faucet
export const MOCK_ERC20_ABI = [
  ...ERC20_ABI,
  { type: 'function', name: 'mint', stateMutability: 'nonpayable', inputs: [{ name: 'to', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [] as undefined[] },
] as const

export const YIELD_VAULT_ABI = [
  { type: 'function', name: 'deposit', stateMutability: 'nonpayable', inputs: [{ name: 'assets', type: 'uint256' }, { name: 'receiver', type: 'address' }], outputs: [{ name: 'shares', type: 'uint256' }] },
  { type: 'function', name: 'redeem', stateMutability: 'nonpayable', inputs: [{ name: 'shares', type: 'uint256' }, { name: 'receiver', type: 'address' }, { name: 'owner', type: 'address' }], outputs: [{ name: 'assets', type: 'uint256' }] },
  { type: 'function', name: 'previewDeposit', stateMutability: 'view', inputs: [{ name: 'assets', type: 'uint256' }], outputs: [{ name: 'shares', type: 'uint256' }] },
  { type: 'function', name: 'previewRedeem', stateMutability: 'view', inputs: [{ name: 'shares', type: 'uint256' }], outputs: [{ name: 'assets', type: 'uint256' }] },
  { type: 'function', name: 'totalAssets', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'totalSupply', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'balanceOf', stateMutability: 'view', inputs: [{ name: 'account', type: 'address' }], outputs: [{ type: 'uint256' }] },
] as const