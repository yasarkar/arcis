// Temporary probe: does Circle deduct its Gateway fee from the minted principal
// at mint time, or from the unified Gateway balance on the source domain?
//
// It prints every log of a real Base Sepolia gatewayMint transaction and flags
// any USDC movement besides the expected mint-to-recipient, which is where a
// mint-time fee deduction would have to appear.
//
// Run with: npx tsx scratch/gateway-mint-log-probe.ts <txHash>

const BASE_RPC = 'https://base-sepolia-rpc.publicnode.com'
const USDC = '0x036CbD53842c5426634e7929541eC2318f3dCF7e'
const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'

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

const addr = (topic: string) => `0x${topic.slice(26)}`

async function main() {
  const txHash =
    process.argv[2] || '0x2269acc73b3d8daa4d2ce83688ec190c6e40bb3cd81708ea8b0f7ce86affbab4'
  const receipt: any = await rpc('eth_getTransactionReceipt', [txHash])
  console.log(`tx ${txHash}\n  status=${receipt.status} from=${receipt.from} to=${receipt.to}`)
  console.log(`  gasUsed=${Number(receipt.gasUsed)} gasPrice=${receipt.effectiveGasPrice}`)

  const usdcLogs: any[] = []
  for (const [i, log] of (receipt.logs as any[]).entries()) {
    const isUsdc = String(log.address).toLowerCase() === USDC.toLowerCase()
    const isTransfer = log.topics?.[0] === TRANSFER_TOPIC
    console.log(
      `  log[${i}] addr=${log.address} topic0=${log.topics?.[0]?.slice(0, 10)} nTopics=${log.topics?.length}`
    )
    if (isUsdc && isTransfer) {
      usdcLogs.push({
        from: addr(log.topics[1]),
        to: addr(log.topics[2]),
        value: BigInt(log.data),
      })
    }
  }

  console.log('\nUSDC movements in the mint tx:')
  for (const l of usdcLogs) {
    console.log(`  ${l.value} subunits  from=${l.from} to=${l.to}`)
  }
  const mints = usdcLogs.filter((l) => l.from === '0x0000000000000000000000000000000000000000')
  const feeMoves = usdcLogs.filter((l) => l.from !== '0x0000000000000000000000000000000000000000')
  console.log(
    `\n  mint-to-recipient logs: ${mints.length}, non-mint USDC movements (would carry a mint-time fee): ${feeMoves.length}`
  )
  console.log(
    mints.length === 1 && feeMoves.length === 0
      ? '  => full principal minted, no mint-time fee deduction visible'
      : '  => inspect the extra movements above for a fee deduction'
  )
}

main().catch((err) => {
  console.error('[gateway-mint-log] error:', err)
  process.exit(1)
})
