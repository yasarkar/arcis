// Temporary live probe for the destination-mint scan mechanics.
//
// Uses the app's own RPC client and the FIXED getLogs call
// (`event: CCTP_MESSAGE_RECEIVED_ABI[0]`) against real Base Sepolia -> Arc
// Testnet transfers whose destination mint hash is known from Circle's Iris
// API. It mirrors pollCctpDestinationTx Step B exactly, except that the scan
// window is widened to cover these (already old) mints — the poller's own
// 2000-block floor only covers in-session transfers by design.
//
// Run with: npx tsx scratch/cctp-live-scan-probe.ts

import { decodeEventLog } from 'viem'
import {
  CCTP_MESSAGE_RECEIVED_ABI,
  CCTP_TOKEN_MESSENGER_ABI,
  cctpMessageAmountMatches,
  getCctpTokenMessenger,
  getCctpMessageTransmitter,
  parseCctpMessageNonce,
} from '../src/services/bridgeUcwService'
import { getResilientPublicClient } from '../src/services/rpc'
import { USDC_ADDRESSES, GATEWAY_DOMAINS } from '../src/config/gatewayConfig'

const MINT_AND_WITHDRAW_ABI = [{
  type: 'event', name: 'MintAndWithdraw',
  inputs: [
    { type: 'address', indexed: true, name: 'mintRecipient' },
    { type: 'uint256', indexed: false, name: 'amount' },
    { type: 'address', indexed: true, name: 'mintToken' },
    { type: 'uint256', indexed: false, name: 'feeCollected' },
  ],
}] as const

interface Case {
  label: string
  burnTxHash: string
  sourceChain: string
  destChain: string
  irisDomain: number
}

const CASES: Case[] = [
  {
    label: 'Forwarding Service burn (App Kit useForwarder, amount += fees)',
    burnTxHash: '0xf7e607302a867268c39abbc0b26cff864f9b0258d3eec16466bfa80ea0163ab9',
    sourceChain: 'Base_Sepolia',
    destChain: 'Arc_Testnet',
    irisDomain: 6,
  },
  {
    label: 'Plain self-mint burn (amount == user amount)',
    burnTxHash: '0x11965c122b2a53ccc7c636e02b9905953439660583c410a490cb8673ea5250c0',
    sourceChain: 'Base_Sepolia',
    destChain: 'Arc_Testnet',
    irisDomain: 6,
  },
]

async function runCase(c: Case) {
  console.log(`\n=== ${c.label}`)
  const irisRes = await fetch(
    `https://iris-api-sandbox.circle.com/v2/messages/${c.irisDomain}?transactionHash=${c.burnTxHash}`
  )
  const iris: any = await irisRes.json()
  const message = iris?.messages?.[0]
  if (!message) throw new Error(`Iris has no message for ${c.burnTxHash}`)
  const body = message.decodedMessage.decodedMessageBody
  const burnAmount = BigInt(body.amount)
  const feeExecuted = BigInt(body.feeExecuted)
  // Forwarded burns reserve the fees on top (user amount = gross - fee); a
  // plain self-mint burns exactly the user's amount.
  const forwarded = typeof body.hookData === 'string' && body.hookData.toLowerCase().startsWith('0x636374702d666f7277617264')
  const userAmountUnits = forwarded ? burnAmount - feeExecuted : burnAmount
  const amount = (Number(userAmountUnits) / 1e6).toFixed(6).replace(/0+$/, '').replace(/\.$/, '')
  const expectedMintTx = message.destinationMintTxHash || message.forwardTxHash

  console.log('[scan-probe] user amount:', amount, 'correlated burn amount:', burnAmount.toString())
  console.log('[scan-probe] amount correlation:', cctpMessageAmountMatches(body, userAmountUnits))

  const nonce = parseCctpMessageNonce(message.decodedMessage.nonce)
  if (nonce === null) throw new Error('nonce did not parse')

  const mintReceipt = await getResilientPublicClient(c.destChain).getTransactionReceipt({
    hash: expectedMintTx as `0x${string}`,
  })
  const mintBlock = mintReceipt.blockNumber

  // EXACT poller Step B, with the window widened around the known mint block.
  const receivedLogs = await getResilientPublicClient(c.destChain).getLogs({
    address: getCctpMessageTransmitter(c.destChain),
    event: CCTP_MESSAGE_RECEIVED_ABI[0],
    args: { nonce: `0x${nonce.toString(16).padStart(64, '0')}` as const },
    fromBlock: mintBlock - 5n,
    toBlock: mintBlock + 5n,
  })
  console.log('[scan-probe] MessageReceived logs found:', receivedLogs.length)

  let confirmedTx: string | undefined
  let receivedAmount: string | undefined
  let destFeeAmount: string | undefined
  for (const entry of receivedLogs) {
    if (!entry.transactionHash) continue
    if (entry.args?.messageBody?.toLowerCase() !== message.decodedMessage.messageBody.toLowerCase()) continue
    const receipt = await getResilientPublicClient(c.destChain).getTransactionReceipt({ hash: entry.transactionHash })
    if (receipt.status !== 'success') continue
    for (const log of receipt.logs) {
      if (log.address?.toLowerCase() !== getCctpTokenMessenger(c.destChain).toLowerCase()) continue
      try {
        const decoded = decodeEventLog({ abi: MINT_AND_WITHDRAW_ABI, data: log.data, topics: log.topics })
        const args = decoded.args as any
        const ok =
          String(args.mintRecipient).toLowerCase() === String(body.mintRecipient).toLowerCase() &&
          BigInt(args.amount) + BigInt(args.feeCollected || 0n) === burnAmount &&
          String(args.mintToken).toLowerCase() === USDC_ADDRESSES[c.destChain].toLowerCase()
        if (ok) {
          confirmedTx = receipt.transactionHash
          receivedAmount = (Number(BigInt(args.amount)) / 1e6).toString()
          // Circle's USDC fee collected at the mint (protocol + forwarding) —
          // NOT the destination network's gas, which is denominated in ETH.
          destFeeAmount = (Number(BigInt(args.feeCollected || 0n)) / 1e6).toString()
        }
      } catch {
        // not a MintAndWithdraw log
      }
    }
  }

  const matchesExpected = !!confirmedTx && confirmedTx.toLowerCase() === expectedMintTx.toLowerCase()
  console.log('[scan-probe] confirmed dest tx:', confirmedTx, 'received:', receivedAmount, 'destFee:', destFeeAmount)
  console.log('[scan-probe] expected Iris mint tx:', expectedMintTx)
  console.log('[scan-probe] RESULT:', matchesExpected ? 'PASS' : 'FAIL')
  return matchesExpected
}

// Keep the imports referenced so the probe always type-checks against the
// production ABI sources it claims to mimic.
void CCTP_TOKEN_MESSENGER_ABI
void GATEWAY_DOMAINS

async function main() {
  const results: boolean[] = []
  for (const c of CASES) {
    results.push(await runCase(c))
  }
  console.log('\n[scan-probe] overall:', results.every(Boolean) ? 'PASS' : 'FAIL')
}

main().catch((err) => {
  console.error('[scan-probe] error:', err)
  process.exit(1)
})
