// Temporary live probe: exercises the PRODUCTION resolveBridgeNetworkFee the
// receipt now uses for the Destination Fee row, against real destination mint
// transactions (Arc -> Base and Base -> Arc).
//
// Expected:
//   • Base Sepolia destination mint -> fee in ETH (destination native token)
//   • Arc Testnet destination mint   -> fee in USDC (Arc native gas token)
//
// Run with: npx tsx scratch/dest-fee-probe.ts

import { resolveBridgeNetworkFee } from '../src/services/bridgeService'

const CASES = [
  {
    label: 'Arc -> Base destination mint (09d6fe3…)',
    chain: 'Base_Sepolia',
    tx: '0x9d6fe36dff7348b06050a52ad0f1d4c56eca47cfe711499314a5ff45fc562596',
  },
  {
    label: 'Arc -> Base destination mint (04e75ec…)',
    chain: 'Base_Sepolia',
    tx: '0x4e75ec200080c32cc8d95f2f3fd64dee2a119ae4eb03f18a38cfa2f91c59c189',
  },
  {
    label: 'Base -> Arc destination mint (08d60aa…)',
    chain: 'Arc_Testnet',
    tx: '0x8d60aa0b25cd8913ff7206d605967dce8419828bac5dca78b586e31c6e492dd9',
  },
] as const

async function main() {
  let allOk = true
  for (const c of CASES) {
    const fee = await resolveBridgeNetworkFee(c.chain, c.tx)
    const ok = typeof fee === 'string' && (c.chain === 'Arc_Testnet' ? fee.endsWith(' USDC') : fee.endsWith(' ETH'))
    if (!ok) allOk = false
    console.log(`[dest-fee] ${c.label} -> ${fee ?? 'undefined'} ${ok ? 'PASS' : 'FAIL'}`)
  }
  console.log('[dest-fee] overall:', allOk ? 'PASS' : 'FAIL')
}

main().catch((err) => {
  console.error('[dest-fee] error:', err)
  process.exit(1)
})
