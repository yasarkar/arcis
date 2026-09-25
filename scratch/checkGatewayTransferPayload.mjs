// scratch/checkGatewayTransferPayload.mjs
// Validates the EXACT burn-intent payload/signature shape produced by
// src/services/gatewayUcwService.ts against the live Gateway testnet /transfer API.
// A freshly generated random key is used, so the depositor has zero Gateway balance:
// the API can only reject with a balance error -> no funds can move.

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
console.log('Ephemeral depositor (zero Gateway balance):', account.address)

/** Mirrors src/services/gatewayUcwService.ts exactly, including the 1 USDC maxFee floor. */
function buildBurnIntent(amountUsdcStr, maxFeeOverride) {
  const amount = BigInt(Math.round(parseFloat(amountUsdcStr) * 1e6))
  const transferFee = (amount * 5n) / 100_000n
  const gasBuffer = 50_000n
  const calculatedFee = transferFee + gasBuffer
  const MIN = 1_000_000n
  const maxFee = maxFeeOverride ?? (calculatedFee < MIN ? MIN : calculatedFee)
  return {
    maxBlockHeight: 2n ** 256n - 1n,
    maxFee,
    spec: {
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
      value: amount,
      salt: '0x' + randomBytes(32).toString('hex'),
      hookData: '0x',
    },
  }
}

async function submit(label, amountUsdc, maxFeeOverride) {
  const burnIntent = buildBurnIntent(amountUsdc, maxFeeOverride)
  const signature = await account.signTypedData({
    types: TYPES,
    domain: { name: 'GatewayWallet', version: '1' },
    primaryType: 'BurnIntent',
    message: burnIntent,
  })
  const res = await fetch(`${API}/transfer`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify([{ burnIntent, signature }], (_k, v) =>
      typeof v === 'bigint' ? v.toString() : v
    ),
  })
  const text = await res.text()
  console.log(`\n=== /transfer [${label}] amount=${amountUsdc} maxFee=${(Number(burnIntent.maxFee) / 1e6).toFixed(6)} -> HTTP ${res.status} ===`)
  console.log(text.slice(0, 500))
}

// 1. Exactly what the app sends today (1 USDC floor)
await submit('project formula', '10')
// 2. Circle's own /estimate value (0.00385 USDC)
await submit('circle estimate fee', '10', 3850n)

// 3. Derive the real required fee per amount (API reports value + fee)
console.log('\n=== Real required balance per amount (maxFee = 1 USDC floor) ===')
for (const amt of ['0.001', '0.01', '0.1', '1', '10', '100', '1000', '10000']) {
  await submit('scaling', amt)
}
