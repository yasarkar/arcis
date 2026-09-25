// scratch/checkGatewayForwarder.mjs
// READ-ONLY probe of the Gateway Forwarding Service.
// Confirms (a) /estimate?enableForwarder=true returns a maxFee that already
// includes the forwarding fee and (b) how /transfer?enableForwarder=true reports
// the required source balance. No funds can move (zero-balance ephemeral key).

import { randomBytes } from 'node:crypto'
import { privateKeyToAccount } from 'viem/accounts'

const API = 'https://gateway-api-testnet.circle.com/v1'
const GW_WALLET = '0x0077777d7EBA4688BDeF3E311b846F25870A19B9'
const GW_MINTER = '0x0022222ABE238Cc2C7Bb1f21003F0a260052475B'
const SOURCE = { domain: 26, usdc: '0x3600000000000000000000000000000000000000' }
const DEST = { domain: 6, usdc: '0x036CbD53842c5426634e7929541eC2318f3dCF7e' }

const toBytes32 = (a) => '0x' + a.toLowerCase().replace(/^0x/, '').padStart(64, '0')
const ZERO32 = toBytes32('0x0000000000000000000000000000000000000000')

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

function spec(value) {
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

const stringify = (o) => JSON.stringify(o, (_k, v) => (typeof v === 'bigint' ? v.toString() : v))

async function estimate(amountUsdc, enableForwarder) {
  const res = await fetch(`${API}/estimate?enableForwarder=${enableForwarder}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: stringify([{ spec: spec(BigInt(Math.round(amountUsdc * 1e6))) }]),
  })
  const text = await res.text()
  let maxFee = null
  try {
    const json = JSON.parse(text)
    const item = Array.isArray(json) ? json[0] : json?.body?.[0]
    maxFee = item?.burnIntent?.maxFee ?? null
  } catch {
    /* ignore */
  }
  console.log(
    `\n=== /estimate?enableForwarder=${enableForwarder} (${amountUsdc} USDC) -> HTTP ${res.status}` +
    (maxFee ? `  maxFee=${maxFee} (${(Number(maxFee) / 1e6).toFixed(6)} USDC)` : '') + ' ==='
  )
  if (!maxFee) console.log(text.slice(0, 400))
  return maxFee ? BigInt(maxFee) : null
}

async function submit(amountUsdc, maxFee, enableForwarder) {
  const burnIntent = {
    maxBlockHeight: 2n ** 256n - 1n,
    maxFee,
    spec: spec(BigInt(Math.round(amountUsdc * 1e6))),
  }
  const signature = await account.signTypedData({
    types: TYPES,
    domain: { name: 'GatewayWallet', version: '1' },
    primaryType: 'BurnIntent',
    message: burnIntent,
  })
  const res = await fetch(`${API}/transfer?enableForwarder=${enableForwarder}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: stringify([{ burnIntent, signature }]),
  })
  const text = await res.text()
  console.log(
    `\n=== /transfer?enableForwarder=${enableForwarder} (${amountUsdc} USDC, maxFee=${(Number(maxFee) / 1e6).toFixed(6)}) -> HTTP ${res.status} ===`
  )
  console.log(text.slice(0, 400))
}

const fee1 = await estimate(1, true)
const fee10 = await estimate(10, true)
await estimate(10, false)

if (fee1) await submit(1, fee1, true)
if (fee10) await submit(10, fee10, true)

// Probe which buffer makes the forwarding fee check pass, and read the resulting
// "required" figure (value + gas + transfer + forwarding fee).
console.log('\n### Buffer probe (1 USDC, forwarding enabled) ###')
for (const total of [60_000n, 70_000n, 100_000n, 250_000n, 300_000n, 400_000n]) {
  await submit(1, total, true)
}
