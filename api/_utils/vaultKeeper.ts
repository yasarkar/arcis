// api/_utils/vaultKeeper.ts
// Arcis Protocol - Automated USDC Yield Vault Keeper Service
// Periodically checks accumulated platform revenue and executes on-chain distributeYield.

import {
  createPublicClient,
  createWalletClient,
  http,
  parseUnits,
  formatUnits,
  parseAbi,
} from 'viem'
import { getServerSignerAccount } from './serverSigner'

const arcTestnet = {
  id: 5042002,
  name: 'Arc Testnet',
  nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
  rpcUrls: {
    default: { http: [process.env.VITE_ARC_RPC_URL || 'https://rpc.testnet.arc.network', 'https://rpc.testnet.arc.io'] },
  },
}

const ARC_USDC = (process.env.VITE_POOL_USDC || '0x3600000000000000000000000000000000000000') as `0x${string}`
const YIELD_VAULT = (process.env.VITE_POOL_V4_YIELD_VAULT || '0xb2a6D2BF896b431a77FB9198519fE334Caf39e9A') as `0x${string}`

const ERC20_ABI = parseAbi([
  'function balanceOf(address account) view returns (uint256)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)',
])

const YIELD_VAULT_ABI = parseAbi([
  'function owner() view returns (address)',
  'function totalAssets() view returns (uint256)',
  'function totalSupply() view returns (uint256)',
  'function totalYieldDistributed() view returns (uint256)',
  'function performanceFeeBps() view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function distributeYield(uint256 amount) external',
])

export interface KeeperStatus {
  enabled: boolean
  isRunning: boolean
  lastRunTimestamp: number | null
  lastRunTxHash: string | null
  lastError: string | null
  intervalMinutes: number
  distributeAmountUsdc: number
  totalAutomatedDistributions: number
}

const keeperState: KeeperStatus = {
  enabled: process.env.VAULT_KEEPER_ENABLED !== 'false',
  isRunning: false,
  lastRunTimestamp: null,
  lastRunTxHash: null,
  lastError: null,
  intervalMinutes: parseInt(process.env.VAULT_KEEPER_INTERVAL_MINUTES || '60', 10), // Default: every 1 hour
  distributeAmountUsdc: parseFloat(process.env.VAULT_KEEPER_AMOUNT_USDC || '5'), // Default: 5 USDC per tick
  totalAutomatedDistributions: 0,
}

let timerHandle: NodeJS.Timeout | null = null

function getPublicClient() {
  return createPublicClient({
    chain: arcTestnet,
    transport: http(arcTestnet.rpcUrls.default.http[0]),
  })
}

// ARC-011: the vault signer is a dedicated key (DISTRIBUTOR_KEY, else RELAYER_PRIVATE_KEY).
// The Foundry deploy key (PRIVATE_KEY) is never used for fund movement.
function getRelayerAccount() {
  return getServerSignerAccount({ forVault: true })
}

/**
 * Execute on-chain yield distribution via the relayer account.
 */
export async function executeYieldDistribution(amountUsdc?: number) {
  const amountToDistribute = amountUsdc ?? keeperState.distributeAmountUsdc
  if (amountToDistribute <= 0) {
    throw new Error('Distribution amount must be greater than zero')
  }

  const client = getPublicClient()
  const relayer = getRelayerAccount()
  if (!relayer) {
    throw new Error('No server signer key configured: set DISTRIBUTOR_KEY or RELAYER_PRIVATE_KEY (PRIVATE_KEY is reserved for the Foundry deploy scripts)')
  }

  const vaultOwner = await client.readContract({
    address: YIELD_VAULT,
    abi: YIELD_VAULT_ABI,
    functionName: 'owner',
  })

  if (relayer.address.toLowerCase() !== vaultOwner.toLowerCase()) {
    throw new Error(`Relayer (${relayer.address}) is not the owner of YieldVault (${vaultOwner})`)
  }

  const amountUnits = parseUnits(amountToDistribute.toString(), 6)

  // Verify USDC Balance
  const signerBal = await client.readContract({
    address: ARC_USDC,
    abi: ERC20_ABI,
    functionName: 'balanceOf',
    args: [relayer.address],
  })

  if (signerBal < amountUnits) {
    throw new Error(`Insufficient relayer USDC. Required: ${amountToDistribute}, Available: ${formatUnits(signerBal, 6)}`)
  }

  const walletClient = createWalletClient({
    account: relayer,
    chain: arcTestnet,
    transport: http(arcTestnet.rpcUrls.default.http[0]),
  })

  // Approve if needed
  const currentAllowance = await client.readContract({
    address: ARC_USDC,
    abi: ERC20_ABI,
    functionName: 'allowance',
    args: [relayer.address, YIELD_VAULT],
  })

  if (currentAllowance < amountUnits) {
    console.log(`[VaultKeeper] Approving ${amountToDistribute} USDC for YieldVault...`)
    const approveTx = await walletClient.writeContract({
      address: ARC_USDC,
      abi: ERC20_ABI,
      functionName: 'approve',
      args: [YIELD_VAULT, amountUnits],
    })
    await client.waitForTransactionReceipt({ hash: approveTx })
  }

  // Execute distributeYield
  console.log(`[VaultKeeper] Broadcasting distributeYield(${amountToDistribute} USDC)...`)
  const txHash = await walletClient.writeContract({
    address: YIELD_VAULT,
    abi: YIELD_VAULT_ABI,
    functionName: 'distributeYield',
    args: [amountUnits],
  })

  const receipt = await client.waitForTransactionReceipt({ hash: txHash })

  const [newAssets, newDistributed] = await Promise.all([
    client.readContract({ address: YIELD_VAULT, abi: YIELD_VAULT_ABI, functionName: 'totalAssets' }),
    client.readContract({ address: YIELD_VAULT, abi: YIELD_VAULT_ABI, functionName: 'totalYieldDistributed' }),
  ])

  keeperState.lastRunTimestamp = Date.now()
  keeperState.lastRunTxHash = txHash
  keeperState.lastError = null
  keeperState.totalAutomatedDistributions += 1

  console.log(`[VaultKeeper] ✅ Yield Distributed successfully! Tx: ${txHash} | Total Assets: ${formatUnits(newAssets, 6)} USDC`)

  return {
    txHash,
    status: receipt.status,
    grossDistributedUsdc: amountToDistribute.toString(),
    newTotalAssetsUsdc: formatUnits(newAssets, 6),
    newTotalYieldDistributedUsdc: formatUnits(newDistributed, 6),
    explorerUrl: `https://testnet.arcscan.app/tx/${txHash}`,
  }
}

/**
 * Single keeper tick: checks readiness and executes distribution.
 */
async function keeperTick() {
  if (keeperState.isRunning) {
    return
  }

  keeperState.isRunning = true
  try {
    const relayer = getRelayerAccount()
    if (!relayer) {
      console.log('[VaultKeeper] Skipping: relayer key not configured.')
      return
    }

    const client = getPublicClient()
    const vaultOwner = await client.readContract({
      address: YIELD_VAULT,
      abi: YIELD_VAULT_ABI,
      functionName: 'owner',
    })

    if (relayer.address.toLowerCase() !== vaultOwner.toLowerCase()) {
      console.log(`[VaultKeeper] Relayer (${relayer.address}) is not vault owner (${vaultOwner}). Skipping.`)
      return
    }

    const relayerBal = await client.readContract({
      address: ARC_USDC,
      abi: ERC20_ABI,
      functionName: 'balanceOf',
      args: [relayer.address],
    })

    const requiredUnits = parseUnits(keeperState.distributeAmountUsdc.toString(), 6)
    if (relayerBal < requiredUnits) {
      console.warn(`[VaultKeeper] Low relayer balance: ${formatUnits(relayerBal, 6)} USDC < ${keeperState.distributeAmountUsdc} USDC`)
      return
    }

    await executeYieldDistribution(keeperState.distributeAmountUsdc)
  } catch (err: any) {
    keeperState.lastError = err?.message || String(err)
    console.error('[VaultKeeper] Tick failed:', keeperState.lastError)
  } finally {
    keeperState.isRunning = false
  }
}

/**
 * Start the Vault Keeper background loop.
 */
export function startVaultKeeper() {
  if (!keeperState.enabled) {
    console.log('[VaultKeeper] Disabled via VAULT_KEEPER_ENABLED=false')
    return
  }

  if (timerHandle) {
    clearInterval(timerHandle)
  }

  const intervalMs = Math.max(keeperState.intervalMinutes, 1) * 60 * 1000
  console.log(`[VaultKeeper] 🤖 Initialized. Running every ${keeperState.intervalMinutes}m (${keeperState.distributeAmountUsdc} USDC/tick).`)

  // Initial check after 30 seconds of server startup
  setTimeout(() => {
    keeperTick().catch((e) => console.error('[VaultKeeper] Initial tick error:', e))
  }, 30000)

  // Periodic timer
  timerHandle = setInterval(() => {
    keeperTick().catch((e) => console.error('[VaultKeeper] Interval tick error:', e))
  }, intervalMs)
}

/**
 * Stop the Vault Keeper background loop.
 */
export function stopVaultKeeper() {
  if (timerHandle) {
    clearInterval(timerHandle)
    timerHandle = null
  }
  console.log('[VaultKeeper] Stopped.')
}

/**
 * Get current keeper diagnostics and stats.
 */
export function getKeeperStatus(): KeeperStatus {
  return { ...keeperState }
}
