// Temporary live probe: validates the fixed pollCctpDestinationTx end-to-end
// against a REAL Circle CCTP V2 Forwarding Service transfer on Base Sepolia.
// It searches recent forwarded burns, picks one whose destination mint is
// inside the poller's scan window, then runs the production poller against the
// live Iris API and the real destination RPC.
// Run with: npx tsx scratch/cctp-live-probe.ts
import { pollCctpDestinationTx, cctpMessageAmountMatches } from '../src/services/bridgeUcwService'
import { GATEWAY_DOMAINS, DOMAIN_TO_CHAIN, USDC_ADDRESSES } from '../src/config/gatewayConfig'

const BASE_RPC = 'https://base-sepolia-rpc.publicnode.com'
const TOKEN_MESSENGER = '0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA'
const DEPOSIT_FOR_BURN_TOPIC = '0x0c8c1cbdc5190613ebd485511d4e2812cfa45eecb79d845893331fedad5130a5'
const HOOK_SELECTOR = '0x779b432d' // depositForBurnWithHook

// Destinations with relatively slow blocks (so the 2000-block lookback covers
// the mint even if it happened a while ago) and reliable public RPCs.
const PREFERRED_DOMAINS = [
  GATEWAY_DOMAINS['Ethereum_Sepolia'],
  GATEWAY_DOMAINS['Arbitrum_Sepolia'],
  GATEWAY_DOMAINS['Optimism_Sepolia'],
  GATEWAY_DOMAINS['Polygon_Amoy_Testnet'],
  GATEWAY_DOMAINS['Base_Sepolia'],
]

async function rpc(url: string, method: string, params: any[]): Promise<any> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  })
  const json: any = await res.json()
  if (json.error) throw new Error(`${method}: ${JSON.stringify(json.error)}`)
  return json.result
}

async function main() {
  const latest = parseInt(await rpc(BASE_RPC, 'eth_blockNumber', []), 16)
  const lookback = 9000
  const chunks: Array<[number, number]> = []
  for (let end = latest; end > latest - lookback; end -= 950) {
    chunks.push([Math.max(0, end - 950), end])
  }

  let scanned = 0
  for (const [fromBlock, toBlock] of chunks) {
    const logs = await rpc(BASE_RPC, 'eth_getLogs', [{
      address: TOKEN_MESSENGER,
      fromBlock: '0x' + fromBlock.toString(16),
      toBlock: '0x' + toBlock.toString(16),
      topics: [DEPOSIT_FOR_BURN_TOPIC],
    }])
    scanned += logs.length
    for (const log of [...logs].reverse()) {
      const data = log.data.slice(2)
      const destinationDomain = parseInt(data.slice(64 * 2, 64 * 3), 16)
      if (!PREFERRED_DOMAINS.includes(destinationDomain)) continue
      const tx = await rpc(BASE_RPC, 'eth_getTransactionByHash', [log.transactionHash])
      if (!tx?.input?.startsWith(HOOK_SELECTOR)) continue

      const irisRes = await fetch(
        `https://iris-api-sandbox.circle.com/v2/messages/6?transactionHash=${log.transactionHash}`
      )
      if (!irisRes.ok) continue
      const iris: any = await irisRes.json()
      const message = iris?.messages?.[0]
      const body = message?.decodedMessage?.decodedMessageBody
      if (message?.status !== 'complete' || !body?.hookData) continue

      const destChain = DOMAIN_TO_CHAIN[destinationDomain]
      if (!destChain || !USDC_ADDRESSES[destChain]) continue
      const mintTxHash: string | undefined =
        message.destinationMintTxHash || message.forwardTxHash
      if (!mintTxHash || !/^0x[0-9a-fA-F]{64}$/.test(mintTxHash)) continue

      const amountUnits = BigInt(body.amount) - BigInt(body.feeExecuted)
      const amount = (Number(amountUnits) / 1e6).toFixed(6).replace(/0+$/, '').replace(/\.$/, '')
      if (amountUnits <= 0n) continue

      // Only accept transfers whose mint is inside the poller's lookback window.
      const destRpc = destChain === 'Base_Sepolia' ? BASE_RPC : undefined
      let mintBlock: number | null = null
      if (destRpc) {
        const receipt = await rpc(destRpc, 'eth_getTransactionReceipt', [mintTxHash])
        if (receipt?.blockNumber) mintBlock = parseInt(receipt.blockNumber, 16)
      }
      console.log('[probe] candidate forwarded transfer:', {
        burnTxHash: log.transactionHash,
        destChain,
        recipient: body.mintRecipient,
        amount,
        mintTxHash,
        mintBlock,
        scannedBurns: scanned,
      })

      const matches = cctpMessageAmountMatches(body, amountUnits)
      console.log('[probe] cctpMessageAmountMatches on live payload:', matches)

      const result = await pollCctpDestinationTx({
        sourceChain: 'Base_Sepolia',
        destChain,
        burnTxHash: log.transactionHash,
        recipientAddress: body.mintRecipient,
        amount,
        maxAttempts: 1,
        intervalMs: 0,
      })
      console.log('[probe] pollCctpDestinationTx:', result)
      const pass =
        matches &&
        result.status === 'confirmed' &&
        result.destTxHash?.toLowerCase() === mintTxHash.toLowerCase()
      console.log('[probe] RESULT:', pass ? 'PASS' : 'FAIL')
      if (pass) return
      console.log('[probe] mint likely outside the scan window; trying the next candidate...')
    }
  }
  console.log(`[probe] no in-window forwarded transfer found among ${scanned} burns`)
}

main().catch((err) => {
  console.error('[probe] error:', err)
  process.exit(1)
})
