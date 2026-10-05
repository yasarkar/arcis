// Temporary probe: who submits the destination CCTP mint (i.e. who pays the
// destination-chain gas) for forwarded transfers?
// Run with: npx tsx scratch/mint-senders.ts

const call = async (url: string, method: string, params: any[], ms = 25000) => {
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    signal: AbortSignal.timeout(ms),
  })
  const j: any = await r.json()
  if (j.error) throw new Error(JSON.stringify(j.error))
  return j.result
}

async function main() {
  const arcToBaseMint = '0x9d6fe36dff7348b06050a52ad0f1d4c56eca47cfe711499314a5ff45fc562596'
  const baseToArcMint = '0x8d60aa0b25cd8913ff7206d605967dce8419828bac5dca78b586e31c6e492dd9'

  const baseTx = await call('https://base-sepolia-rpc.publicnode.com', 'eth_getTransactionByHash', [arcToBaseMint])
  console.log('[senders] Arc->Base mint on Base  — from:', baseTx.from, 'to:', baseTx.to)

  for (const rpc of ['https://rpc.testnet.arc.network', 'https://rpc.testnet.arc.io']) {
    try {
      const arcTx = await call(rpc, 'eth_getTransactionByHash', [baseToArcMint])
      console.log('[senders] Base->Arc mint on Arc   — from:', arcTx.from, 'to:', arcTx.to, `(${rpc})`)
      return
    } catch (err: any) {
      console.log('[senders] arc rpc failed:', rpc, err.message)
    }
  }
}

main().catch((err) => {
  console.error('[senders] error:', err)
  process.exit(1)
})
