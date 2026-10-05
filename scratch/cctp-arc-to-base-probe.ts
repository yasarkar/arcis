// Temporary live probe: inspects REAL Arc Testnet -> Base Sepolia CCTP V2
// transfers to decide what the receipt's "Destination Fee" row must show.
//
// For each recent forwarded burn it compares:
//   • the CCTP fee collected at the destination mint (USDC, on-chain), and
//   • the destination mint transaction's real gas fee (ETH), like the receipt's
//     source-chain Network Fee already does.
//
// Run with: npx tsx scratch/cctp-arc-to-base-probe.ts

import { decodeEventLog } from 'viem'
import { GATEWAY_DOMAINS } from '../src/config/gatewayConfig'

const ARC_RPC = 'https://rpc.testnet.arc.network'
const BASE_RPC = 'https://base-sepolia-rpc.publicnode.com'
const TOKEN_MESSENGER = '0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA'
const DEPOSIT_FOR_BURN_TOPIC = '0x0c8c1cbdc5190613ebd485511d4e2812cfa45eecb79d845893331fedad5130a5'
const HOOK_SELECTOR = '0x779b432d' // depositForBurnWithHook
const IRIS_DOMAIN = 26 // Arc Testnet source domain

const MINT_AND_WITHDRAW_ABI = [{
  type: 'event', name: 'MintAndWithdraw',
  inputs: [
    { type: 'address', indexed: true, name: 'mintRecipient' },
    { type: 'uint256', indexed: false, name: 'amount' },
    { type: 'address', indexed: true, name: 'mintToken' },
    { type: 'uint256', indexed: false, name: 'feeCollected' },
  ],
}] as const

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function rpc(url: string, method: string, params: any[]): Promise<any> {
  for (let attempt = 1; attempt <= 4; attempt++) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    })
    const json: any = await res.json()
    if (!json.error) return json.result
    if (json.error?.code !== -32005 || attempt === 4) {
      throw new Error(`${method}: ${JSON.stringify(json.error)}`)
    }
    await sleep(600 * attempt)
  }
}

async function main() {
  console.log('[arc->base] Arc domain from config:', GATEWAY_DOMAINS['Arc_Testnet'], 'Base domain:', GATEWAY_DOMAINS['Base_Sepolia'])

  const latest = parseInt(await rpc(ARC_RPC, 'eth_blockNumber', []), 16)
  console.log('[arc->base] latest Arc block:', latest)

  let scanned = 0
  let candidates = 0
  let forwardedFound = 0
  for (let end = latest; end > latest - 20000; end -= 300) {
    const fromBlock = Math.max(0, end - 299)
    let logs: any[]
    try {
      logs = await rpc(ARC_RPC, 'eth_getLogs', [{
        address: TOKEN_MESSENGER,
        fromBlock: '0x' + fromBlock.toString(16),
        toBlock: '0x' + end.toString(16),
        topics: [DEPOSIT_FOR_BURN_TOPIC],
      }])
    } catch (err: any) {
      console.log('[arc->base] scan chunk failed:', fromBlock, '-', end, err.message)
      await sleep(500)
      continue
    }
    await sleep(250)
    scanned += logs.length
    for (const log of [...logs].reverse()) {
      const data = log.data.slice(2)
      const destinationDomain = parseInt(data.slice(64 * 2, 64 * 3), 16)
      if (destinationDomain !== 6) continue // Base Sepolia
      candidates++
      // The app's UCW burns are batched through an ERC-4337 entry point, so the
      // outer tx input is never the depositForBurn selector. Whether the burn
      // used the Forwarding Service is decided by Iris below (hookData marker).
      const tx = await rpc(ARC_RPC, 'eth_getTransactionByHash', [log.transactionHash])
      await sleep(120)
      const selector = (tx?.input || '').slice(0, 10)
      console.log(`[arc->base] candidate ${log.transactionHash} outerSelector=${selector}`)
      forwardedFound++

      const irisRes = await fetch(
        `https://iris-api-sandbox.circle.com/v2/messages/${IRIS_DOMAIN}?transactionHash=${log.transactionHash}`
      )
      if (!irisRes.ok) continue
      const iris: any = await irisRes.json()
      const message = iris?.messages?.[0]
      const body = message?.decodedMessage?.decodedMessageBody
      if (!body) {
        console.log('[arc->base]   no Iris message body yet; status:', message?.status)
        continue
      }
      if (!body.hookData) {
        console.log('[arc->base]   plain burn (no forwarding hook); status:', message?.status,
          'amountUsdc:', Number(BigInt(body.amount)) / 1e6, 'feeExecutedUsdc:', Number(BigInt(body.feeExecuted || '0')) / 1e6)
        continue
      }
      if (message?.status !== 'complete') {
        console.log('[arc->base]   forwarded but not complete yet; status:', message?.status)
        continue
      }

      const mintTxHash: string | undefined = message.destinationMintTxHash || message.forwardTxHash
      if (!mintTxHash) continue

      const amountUnits = BigInt(body.amount)
      const maxFee = BigInt(body.maxFee || '0')
      const feeExecuted = BigInt(body.feeExecuted || '0')
      console.log('\n[arc->base] forwarded burn found:', {
        burnTxHash: log.transactionHash,
        mintTxHash,
        messageAmountUsdc: Number(amountUnits) / 1e6,
        maxFeeUsdc: Number(maxFee) / 1e6,
        feeExecutedUsdc: Number(feeExecuted) / 1e6,
        userAmountUsdc: Number(amountUnits - feeExecuted) / 1e6,
        hookData: body.hookData,
        mintRecipient: body.mintRecipient,
      })

      const receipt = await rpc(BASE_RPC, 'eth_getTransactionReceipt', [mintTxHash])
      const gasUsed = BigInt(receipt.gasUsed)
      const gasPrice = BigInt(receipt.effectiveGasPrice)
      const gasFeeWei = gasUsed * gasPrice
      console.log('[arc->base] destination mint tx (Base):', {
        status: receipt.status,
        gasUsed: gasUsed.toString(),
        effectiveGasPriceGwei: Number(gasPrice) / 1e9,
        gasFeeEth: Number(gasFeeWei) / 1e18,
      })

      for (const logEntry of receipt.logs) {
        if (logEntry.address?.toLowerCase() !== TOKEN_MESSENGER.toLowerCase()) continue
        try {
          const decoded = decodeEventLog({ abi: MINT_AND_WITHDRAW_ABI, data: logEntry.data, topics: logEntry.topics })
          const args = decoded.args as any
          console.log('[arc->base] MintAndWithdraw:', {
            mintRecipient: args.mintRecipient,
            mintedAmountUsdc: Number(BigInt(args.amount)) / 1e6,
            feeCollectedUsdc: Number(BigInt(args.feeCollected || 0n)) / 1e6,
          })
        } catch {
          // unrelated log
        }
      }

      if (forwardedFound >= 3) return
    }
  }
  console.log(`\n[arc->base] scanned ${scanned} burn logs, ${candidates} Arc->Base candidates, ${forwardedFound} forwarded; done.`)
}

main().catch((err) => {
  console.error('[arc->base] error:', err)
  process.exit(1)
})
