// Temporary live probe: exercises the PRODUCTION helpers the Gateway Fast
// receipt still uses, against a REAL Circle Gateway mint on Base Sepolia.
//
//   • the mint tx carries exactly ONE USDC movement — the full principal to the
//     recipient, with no fee movement. Circle charges its Gateway cost from the
//     unified Gateway balance at burn time instead, and Arcis charges no platform
//     fee on that route, which is why the Gateway receipt shows neither a
//     Platform Fee nor a Gateway Fee row.
//   • resolveDestinationUsdcMintAmount + gatewayDeliveredUsdc → the delivered
//     amount the receipt reports as Net Received.
//   • resolveBridgeNetworkFee → the Destination Fee row.
//
// Run with: npx tsx scratch/gateway-fee-probe.ts

import { resolveDestinationUsdcMintAmount, gatewayDeliveredUsdc } from '../src/services/gatewayService'
import { resolveBridgeNetworkFee } from '../src/services/bridgeService'

const BASE_RPC = 'https://base-sepolia-rpc.publicnode.com'
const GATEWAY_MINTER = '0x0022222ABE238Cc2C7Bb1f21003F0a260052475B'
const USDC_BASE_SEPOLIA = '0x036CbD53842c5426634e7929541eC2318f3dCF7e'
const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'
const ZERO_TOPIC = `0x${'0'.repeat(64)}`

async function rpc(method: string, params: any[]): Promise<any> {
  const res = await fetch(BASE_RPC, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  })
  const json: any = await res.json()
  if (json.error) throw new Error(`${method}: ${json.error.message}`)
  return json.result
}

/** Finds a recent Base Sepolia tx that called the Circle Gateway minter. */
async function findRecentGatewayMint(): Promise<string> {
  const latest = Number(await rpc('eth_blockNumber', []))
  const CHUNK = 2000
  for (let i = 0; i < 15; i++) {
    const to = latest - i * CHUNK
    const from = to - CHUNK + 1
    const logs: any[] = await rpc('eth_getLogs', [
      { address: GATEWAY_MINTER, fromBlock: `0x${from.toString(16)}`, toBlock: `0x${to.toString(16)}` },
    ])
    if (logs.length > 0) {
      console.log(`[gateway-probe] found ${logs.length} minter log(s) in blocks ${from}-${to}`)
      for (const log of logs) {
        const receipt: any = await rpc('eth_getTransactionReceipt', [log.transactionHash])
        const mint = (receipt?.logs ?? []).find(
          (l: any) =>
            String(l.address).toLowerCase() === USDC_BASE_SEPOLIA.toLowerCase() &&
            l.topics?.[0] === TRANSFER_TOPIC &&
            l.topics?.[1] === ZERO_TOPIC
        )
        if (mint && receipt.status === '0x1') return log.transactionHash
      }
    }
  }
  throw new Error('no Gateway mint with a USDC mint log found in the scanned window')
}

async function main() {
  let allOk = true
  const txHash: string = await findRecentGatewayMint()
  console.log(`[gateway-probe] live Gateway mint tx: ${txHash}`)

  const receipt: any = await rpc('eth_getTransactionReceipt', [txHash])
  const transfers = receipt.logs.filter(
    (l: any) => String(l.address).toLowerCase() === USDC_BASE_SEPOLIA.toLowerCase() && l.topics?.[0] === TRANSFER_TOPIC
  )
  const mints = transfers.filter((l: any) => l.topics[1] === ZERO_TOPIC)
  const nonMint = transfers.filter((l: any) => l.topics[1] !== ZERO_TOPIC)
  const recipient = `0x${mints[0].topics[2].slice(26)}`
  const expectedMinted = BigInt(mints[0].data)

  // 1) The mint tx carries exactly one USDC movement: the full principal.
  const noFeeMovement = mints.length === 1 && nonMint.length === 0
  if (!noFeeMovement) allOk = false
  console.log(
    `[gateway-probe] mint tx USDC movements: ${mints.length} mint(s), ${nonMint.length} non-mint (a mint-time fee would live here) ${noFeeMovement ? 'PASS' : 'FAIL'}`
  )

  // 2) Production resolver must read exactly what the raw receipt proves.
  const minted = await resolveDestinationUsdcMintAmount('Base_Sepolia', txHash, recipient)
  const delivered = minted === null ? null : gatewayDeliveredUsdc(minted)
  const readOk = minted === expectedMinted && delivered !== null
  if (!readOk) allOk = false
  console.log(
    `[gateway-probe] declared delivered amount -> ${delivered} (raw ${expectedMinted}) ${readOk ? 'PASS' : 'FAIL'}`
  )

  // 3) Unknown recipient must never yield a guessed amount.
  const wrongRecipient = await resolveDestinationUsdcMintAmount(
    'Base_Sepolia',
    txHash,
    '0x2222222222222222222222222222222222222222'
  )
  const nullOk = wrongRecipient === null
  if (!nullOk) allOk = false
  console.log(`[gateway-probe] unrelated recipient -> ${wrongRecipient} ${nullOk ? 'PASS' : 'FAIL'}`)

  // 4) Destination Fee row for the same mint must be denominated in Base's native ETH.
  const destFee = await resolveBridgeNetworkFee('Base_Sepolia', txHash)
  const destFeeOk = typeof destFee === 'string' && destFee.endsWith(' ETH')
  if (!destFeeOk) allOk = false
  console.log(`[gateway-probe] resolveBridgeNetworkFee -> ${destFee ?? 'undefined'} ${destFeeOk ? 'PASS' : 'FAIL'}`)

  console.log('[gateway-probe] overall:', allOk ? 'PASS' : 'FAIL')
  if (!allOk) process.exit(1)
}

main().catch((err) => {
  console.error('[gateway-probe] error:', err)
  process.exit(1)
})
