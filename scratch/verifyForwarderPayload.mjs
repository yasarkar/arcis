// scratch/verifyForwarderPayload.mjs
// Verifies the payload that the FIXED app now produces for the UCW Gateway Fast
// flow: /estimate?enableForwarder=true -> +5% (min +0.002 USDC) buffer ->
// /transfer?enableForwarder=true. A zero-balance ephemeral key is used, so the
// only possible outcome is a balance error (funds can never move).

import { randomBytes } from 'node:crypto'
import { privateKeyToAccount } from 'viem/accounts'

const API = 'https://gateway-api-testnet.circle.com/v1'
const GW_WALLET = '0x0077777d7EBA4688BDeF3E311b846F25870A19B9'
const GW_MINTER = '0x0022222ABE238Cc2C7Bb1f21003F0a260052475B'
const SOURCE = { domain: 26, usdc: '0x3600000000000000000000000000000000000000' }
const DEST = { domain: 6, usdc: '0x036CbD53842c5426634e7929541eC2318f3dCF7e' }

const toBytes32 = (a) => '0x' + a.toLowerCase().replace(/^0x/, '').padStart(64, '0')
const ZERO32 = toBytes32('0x0000000000000000000000000000000000000000')
const stringify = (o) => JSON.stringify(o, (_k, v) => (typeof v === 'bigint' ? v.toString() : v))

const TYPES = {
  EIP712Domain: [
    { name: 'name', type: 'string' },
    { name: 'version', type: 'string' },
  ],
  TransferSpec: [
    { name: 'version', type: 'uint32' },
    { name: 'sourceDomain', type: 'uint32' },
    { name: 'destinationDomain', type: 'uint32' },
    { name: 'sourceContract', type: 'bytes32' },
    { name: 'destinationContract', type: 'bytes32' },
    { name: 'sourceToken', type: 'bytes32' },
    { name: 'destinationToken', type: 'bytes32' },
    { name: 'sourceDepositor', type: 'bytes32' },
    { name: 'destinationRecipient', type: 'bytes32' },
    { name: 'sourceSigner', type: 'bytes32' },
    { name: 'destinationCaller', type: 'bytes32' },
    { name: 'value', type: 'uint256' },
    { name: 'salt', type: 'bytes32' },
    { name: 'hookData', type: 'bytes' },
  ],
  BurnIntent: [
    { name: 'maxBlockHeight', type: 'uint256' },
    { name: 'maxFee', type: 'uint256' },
    { name: 'spec', type: 'TransferSpec' },
  ],
}

const account = privateKeyToAccount('0x' + randomBytes(32).toString('hex'))
console.log('Ephemeral depositor:', account.address)

function specFor(value) {
  return {
    version: 1,
    sourceDomain: SOURCE.domain,
    destinationDomain: DEST.domain,
    sourceContract: toBytes32(GW_WALLET),
    destinationContract: toBytes32(GW_MINTER),
    sourceToken: toBytes32(SOURCE.usdc),
    destinationToken: toBytes32(DEST.usdc),
    sourceDepositor: toBytes32(account.address),
    destinationRecipient: toBytes32(account.address),
    sourceSigner: toBytes32(account.address),
    destinationCaller: ZERO32,
    value,
    salt: '0x' + randomBytes(32).toString('hex'),
    hookData: '0x',
  }
}

/** Mirrors src/services/gatewayUcwService.ts estimateGatewayMaxFee(useForwarder=true) */
function appMaxFee(quoted) {
  const percent = (quoted * 500n) / 10_000n
  return quoted + (percent > 2_000n ? percent : 2_000n)
}

async function run(amountUsdc) {
  const value = BigInt(Math.round(amountUsdc * 1e6))
  const spec = specFor(value)

  const estRes = await fetch(`${API}/estimate?enableForwarder=true`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: stringify([{ spec }]),
  })
  const estJson = await estRes.json()
  const item = Array.isArray(estJson) ? estJson[0] : estJson?.body?.[0]
  const quoted = BigInt(item.burnIntent.maxFee)
  const maxFee = appMaxFee(quoted)

  const burnIntent = {
    maxBlockHeight: BigInt(item.burnIntent.maxBlockHeight || 2n ** 256n - 1n),
    maxFee,
    spec,
  }
  const signature = await account.signTypedData({
    types: TYPES,
    domain: { name: 'GatewayWallet', version: '1' },
    primaryType: 'BurnIntent',
    message: burnIntent,
  })

  const res = await fetch(`${API}/transfer?enableForwarder=true`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: stringify([{ burnIntent, signature }]),
  })
  const body = await res.text()

  const forwardingFeeError = body.includes('Insufficient total maxFee')
  console.log(`\n=== ${amountUsdc} USDC (Arc -> Base Sepolia, forwarder) ===`)
  console.log(`  quoted maxFee : ${quoted} (${(Number(quoted) / 1e6).toFixed(6)} USDC)`)
  console.log(`  app maxFee    : ${maxFee} (${(Number(maxFee) / 1e6).toFixed(6)} USDC)`)
  console.log(`  /transfer     : HTTP ${res.status} ${forwardingFeeError ? '<-- FORWARDING FEE STILL REJECTED' : ''}`)
  console.log(`  body          : ${body.slice(0, 220)}`)
  return !forwardingFeeError && res.status === 400
}

const ok1 = await run(1)
const ok10 = await run(10)

// Sanity check the polling endpoint error shape used by pollForwardedGatewayTransfer
const pollRes = await fetch(`${API}/transfer/00000000-0000-0000-0000-000000000000`)
console.log(`\n=== GET /transfer/<unknown id> -> HTTP ${pollRes.status} ===`)
console.log((await pollRes.text()).slice(0, 200))

console.log(
  `\nRESULT: forwarding payload accepted by the Gateway API for both amounts: ${ok1 && ok10}`
)
