// scripts/distribute-yield.mjs
// Automated & Manual Yield Distribution Script for Arcis USDC Yield Vault (ERC-4626) on Arc Testnet.
// Usage:
//   node scripts/distribute-yield.mjs --amount 10
//   node scripts/distribute-yield.mjs --amount 25 --key 0x...
//   node scripts/distribute-yield.mjs --transfer-to 0xcb29758C8c2E5E333ec8edB99Dea0F287bf0e804 --key 0x...

import 'dotenv/config'
import {
  createPublicClient,
  createWalletClient,
  http,
  parseUnits,
  formatUnits,
  parseAbi,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'

// ── Arc Testnet Definition ──────────────────────────────────────────────────
const arcTestnet = {
  id: 5042002,
  name: 'Arc Testnet',
  nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
  rpcUrls: {
    default: { http: [process.env.VITE_ARC_RPC_URL || 'https://rpc.testnet.arc.network', 'https://rpc.testnet.arc.io'] },
  },
}

// ── Contract Addresses ──────────────────────────────────────────────────────
const ARC_USDC = (process.env.VITE_POOL_USDC || '0x3600000000000000000000000000000000000000')
const YIELD_VAULT = (process.env.VITE_POOL_V4_YIELD_VAULT || '0xb2a6D2BF896b431a77FB9198519fE334Caf39e9A')

// ── ABIs ────────────────────────────────────────────────────────────────────
const ERC20_ABI = parseAbi([
  'function balanceOf(address account) view returns (uint256)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)',
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',
])

const YIELD_VAULT_ABI = parseAbi([
  'function owner() view returns (address)',
  'function totalAssets() view returns (uint256)',
  'function totalSupply() view returns (uint256)',
  'function totalYieldDistributed() view returns (uint256)',
  'function performanceFeeBps() view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function distributeYield(uint256 amount) external',
  'function transferOwnership(address newOwner) external',
  'event YieldDistributed(uint256 netAmount, uint256 feeAmount)',
])

// ── Parse CLI Args ──────────────────────────────────────────────────────────
function parseArgs() {
  const args = process.argv.slice(2)
  const parsed = {
    amount: '10', // Default 10 USDC
    key: null,
    transferTo: null,
    help: false,
  }

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--amount' || args[i] === '-a') {
      parsed.amount = args[++i]
    } else if (args[i] === '--key' || args[i] === '-k') {
      parsed.key = args[++i]
    } else if (args[i] === '--transfer-to' || args[i] === '-t') {
      parsed.transferTo = args[++i]
    } else if (args[i] === '--help' || args[i] === '-h') {
      parsed.help = true
    }
  }
  return parsed
}

async function main() {
  const opts = parseArgs()

  if (opts.help) {
    console.log(`
Arcis USDC Yield Vault - Yield Distributor CLI
────────────────────────────────────────────────
Options:
  --amount, -a <number>       Gross USDC amount to distribute (default: 10)
  --key, -k <hex>             Private key of distributor/owner
  --transfer-to, -t <address> Transfer vault ownership to a relayer/bot address
  --help, -h                  Show this help screen

Examples:
  node scripts/distribute-yield.mjs --amount 10
  node scripts/distribute-yield.mjs --amount 50 --key 0x...
  node scripts/distribute-yield.mjs --transfer-to 0xcb29758C8c2E5E333ec8edB99Dea0F287bf0e804 --key 0x...
`)
    process.exit(0)
  }

  console.log('\n========================================================')
  console.log('   ARCIS PROTOCOL — USDC YIELD VAULT DISTRIBUTOR')
  console.log('========================================================\n')

  const publicClient = createPublicClient({
    chain: arcTestnet,
    transport: http(arcTestnet.rpcUrls.default.http[0]),
  })

  // 1. Inspect Yield Vault on Arc Testnet
  console.log(`[1/4] Checking Yield Vault contract at: ${YIELD_VAULT}`)
  const [vaultOwner, currentAssets, currentDistributed, perfFeeBps, shareDecimals] = await Promise.all([
    publicClient.readContract({ address: YIELD_VAULT, abi: YIELD_VAULT_ABI, functionName: 'owner' }),
    publicClient.readContract({ address: YIELD_VAULT, abi: YIELD_VAULT_ABI, functionName: 'totalAssets' }),
    publicClient.readContract({ address: YIELD_VAULT, abi: YIELD_VAULT_ABI, functionName: 'totalYieldDistributed' }),
    publicClient.readContract({ address: YIELD_VAULT, abi: YIELD_VAULT_ABI, functionName: 'performanceFeeBps' }),
    publicClient.readContract({ address: YIELD_VAULT, abi: YIELD_VAULT_ABI, functionName: 'decimals' }),
  ])

  console.log(`      • Vault Owner:             ${vaultOwner}`)
  console.log(`      • Total Assets:            ${formatUnits(currentAssets, 6)} USDC`)
  console.log(`      • Total Distributed So Far:${formatUnits(currentDistributed, 6)} USDC`)
  console.log(`      • Protocol Performance Fee:${Number(perfFeeBps) / 100}% (${perfFeeBps} bps)`)
  console.log(`      • Share Decimals:          ${shareDecimals}\n`)

  // 2. Resolve Signer Account
  // ARC-011: dedicated keys only. PRIVATE_KEY is the Foundry deploy key (contracts/.env) and must
  // not sign fund movement here, exactly as the server-side resolver (api/_utils/serverSigner.ts) does.
  const rawKey = opts.key || process.env.DISTRIBUTOR_KEY || process.env.RELAYER_PRIVATE_KEY
  if (!rawKey) {
    console.error('❌ Error: No private key provided.')
    console.error('   Please pass --key <privateKey> or set DISTRIBUTOR_KEY (or RELAYER_PRIVATE_KEY) in .env.')
    console.error('   PRIVATE_KEY is reserved for the Foundry deploy scripts in contracts/.env.')
    process.exit(1)
  }

  const formattedKey = rawKey.startsWith('0x') ? rawKey : `0x${rawKey}`
  const account = privateKeyToAccount(formattedKey)
  console.log(`[2/4] Signer Wallet Connected: ${account.address}`)

  const walletClient = createWalletClient({
    account,
    chain: arcTestnet,
    transport: http(arcTestnet.rpcUrls.default.http[0]),
  })

  // 3. Handle Ownership Transfer if requested
  if (opts.transferTo) {
    if (account.address.toLowerCase() !== vaultOwner.toLowerCase()) {
      console.error(`❌ Permission Denied: Only the current owner (${vaultOwner}) can transfer ownership.`)
      console.error(`   Signer is: ${account.address}`)
      process.exit(1)
    }

    console.log(`\n⏳ Transferring YieldVault ownership to: ${opts.transferTo}...`)
    const tx = await walletClient.writeContract({
      address: YIELD_VAULT,
      abi: YIELD_VAULT_ABI,
      functionName: 'transferOwnership',
      args: [opts.transferTo],
    })
    console.log(`   Tx Hash: ${tx}`)
    console.log(`   Waiting for confirmation...`)
    await publicClient.waitForTransactionReceipt({ hash: tx })
    console.log(`✅ Ownership successfully transferred to ${opts.transferTo}!\n`)
    process.exit(0)
  }

  // Verify Signer is Vault Owner
  if (account.address.toLowerCase() !== vaultOwner.toLowerCase()) {
    console.error('\n⚠️  PERMISSION MISMATCH')
    console.error(`   YieldVaultV4 requires the caller of distributeYield() to be its owner.`)
    console.error(`   • Current Contract Owner : ${vaultOwner}`)
    console.error(`   • Your Signer Address    : ${account.address}\n`)
    console.error('   Solutions:')
    console.error(`   A. Pass the owner\'s private key via:`)
    console.error(`      node scripts/distribute-yield.mjs --amount ${opts.amount} --key <OWNER_PRIVATE_KEY>\n`)
    console.error(`   B. Transfer ownership from ${vaultOwner} to your relayer/bot (${account.address}):`)
    console.error(`      cast send ${YIELD_VAULT} "transferOwnership(address)" ${account.address} --rpc-url https://rpc.testnet.arc.network --interactive\n`)
    console.error(`   C. Or run directly with cast from the owner account:`)
    console.error(`      cast send ${ARC_USDC} "approve(address,uint256)" ${YIELD_VAULT} ${parseUnits(opts.amount, 6)} --rpc-url https://rpc.testnet.arc.network --interactive`)
    console.error(`      cast send ${YIELD_VAULT} "distributeYield(uint256)" ${parseUnits(opts.amount, 6)} --rpc-url https://rpc.testnet.arc.network --interactive\n`)
    process.exit(1)
  }

  // 4. Check USDC Balance & Allowance
  const amountToDistribute = parseUnits(opts.amount, 6)
  const signerUsdcBalance = await publicClient.readContract({
    address: ARC_USDC,
    abi: ERC20_ABI,
    functionName: 'balanceOf',
    args: [account.address],
  })

  console.log(`[3/4] Checking balances:`)
  console.log(`      • Signer USDC Balance:     ${formatUnits(signerUsdcBalance, 6)} USDC`)
  console.log(`      • Amount to Distribute:    ${opts.amount} USDC`)

  if (signerUsdcBalance < amountToDistribute) {
    console.error(`❌ Insufficient USDC balance! Needed: ${opts.amount} USDC, Available: ${formatUnits(signerUsdcBalance, 6)} USDC`)
    process.exit(1)
  }

  const currentAllowance = await publicClient.readContract({
    address: ARC_USDC,
    abi: ERC20_ABI,
    functionName: 'allowance',
    args: [account.address, YIELD_VAULT],
  })

  if (currentAllowance < amountToDistribute) {
    console.log(`      • Approving ${opts.amount} USDC for YieldVault...`)
    const approveTx = await walletClient.writeContract({
      address: ARC_USDC,
      abi: ERC20_ABI,
      functionName: 'approve',
      args: [YIELD_VAULT, amountToDistribute],
    })
    console.log(`        Approve Tx: ${approveTx}`)
    await publicClient.waitForTransactionReceipt({ hash: approveTx })
    console.log(`        Approval confirmed!`)
  } else {
    console.log(`      • Sufficient allowance already granted.`)
  }

  // 5. Execute distributeYield
  console.log(`\n[4/4] Executing distributeYield(${opts.amount} USDC)...`)
  const txHash = await walletClient.writeContract({
    address: YIELD_VAULT,
    abi: YIELD_VAULT_ABI,
    functionName: 'distributeYield',
    args: [amountToDistribute],
  })

  console.log(`      • Transaction submitted: ${txHash}`)
  console.log(`      • Waiting for on-chain confirmation...`)
  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash })

  if (receipt.status === 'success') {
    const [newAssets, newDistributed] = await Promise.all([
      publicClient.readContract({ address: YIELD_VAULT, abi: YIELD_VAULT_ABI, functionName: 'totalAssets' }),
      publicClient.readContract({ address: YIELD_VAULT, abi: YIELD_VAULT_ABI, functionName: 'totalYieldDistributed' }),
    ])

    const grossNum = parseFloat(opts.amount)
    const feeNum = (grossNum * Number(perfFeeBps)) / 10000
    const netNum = grossNum - feeNum

    console.log('\n🎉 ========================================================')
    console.log('   YIELD DISTRIBUTION SUCCESSFUL!')
    console.log('========================================================')
    console.log(`   • Tx Hash:            ${txHash}`)
    console.log(`   • Explorer:           https://testnet.arcscan.app/tx/${txHash}`)
    console.log(`   • Gross Distributed:  ${grossNum.toFixed(2)} USDC`)
    console.log(`   • Net Yield Added:    +${netNum.toFixed(2)} USDC (Appreciates Share Value)`)
    console.log(`   • Performance Fee:    ${feeNum.toFixed(2)} USDC (Retained by Protocol)`)
    console.log(`   • New Total Assets:   ${formatUnits(newAssets, 6)} USDC`)
    console.log(`   • Total Distributed:  ${formatUnits(newDistributed, 6)} USDC`)
    console.log('\n💡 Depositors can now see real Claimable Yield in the Arcis UI!')
    console.log('   The APY rate will update dynamically on-chain.')
  } else {
    console.error('❌ Transaction reverted on-chain.')
  }
}

main().catch((err) => {
  console.error('\n❌ Execution error:', err.shortMessage || err.message || err)
  process.exit(1)
})
