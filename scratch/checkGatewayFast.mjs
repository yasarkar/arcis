// scratch/checkGatewayFast.mjs
// READ-ONLY verification of Circle Gateway testnet API for the Arc -> other-chain
// "Gateway Fast" (Unified Balance) flow used by UCW users.
// - POST /v1/balances  : confirms API health + Arc Testnet (domain 26) is accepted
// - POST /v1/estimate  : returns the canonical maxFee/maxBlockHeight for a burn intent
// No funds are moved (no /transfer, no on-chain writes).

const API = 'https://gateway-api-testnet.circle.com/v1'
const GW_WALLET = '0x0077777d7EBA4688BDeF3E311b846F25870A19B9'
const GW_MINTER = '0x0022222ABE238Cc2C7Bb1f21003F0a260052475B'

const toBytes32 = (a) => '0x' + a.toLowerCase().replace(/^0x/, '').padStart(64, '0')

const CHAINS = {
  Arc_Testnet: { domain: 26, usdc: '0x3600000000000000000000000000000000000000', id: 'ARC-TESTNET' },
  Base_Sepolia: { domain: 6, usdc: '0x036CbD53842c5426634e7929541eC2318f3dCF7e', id: 'BASE-SEPOLIA' },
  Ethereum_Sepolia: { domain: 0, usdc: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238', id: 'ETH-SEPOLIA' },
  Arbitrum_Sepolia: { domain: 3, usdc: '0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d', id: 'ARB-SEPOLIA' },
  Polygon_Amoy: { domain: 7, usdc: '0x41E94Eb019C0762f9Bfcf9Fb1E58725BfB0e7582', id: 'MATIC-AMOY' },
}

const PROBE_ADDRESS = '0x1111111111111111111111111111111111111111'

async function checkBalances() {
  const sources = Object.values(CHAINS).map((c) => ({ domain: c.domain, depositor: PROBE_ADDRESS }))
  const res = await fetch(`${API}/balances`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: 'USDC', sources }),
  })
  const text = await res.text()
  console.log(`\n=== /balances  ->  HTTP ${res.status} ===`)
  console.log(text.slice(0, 600))
  return res.ok
}

function buildSpec(source, dest, value) {
  return {
    version: 1,
    sourceDomain: source.domain,
    destinationDomain: dest.domain,
    sourceContract: toBytes32(GW_WALLET),
    destinationContract: toBytes32(GW_MINTER),
    sourceToken: toBytes32(source.usdc),
    destinationToken: toBytes32(dest.usdc),
    sourceDepositor: toBytes32(PROBE_ADDRESS),
    destinationRecipient: toBytes32(PROBE_ADDRESS),
    sourceSigner: toBytes32(PROBE_ADDRESS),
    destinationCaller: toBytes32('0x0000000000000000000000000000000000000000'),
    value: BigInt(value),
    salt: '0x' + 'ab'.repeat(32),
    hookData: '0x',
  }
}

function stringifyTypedData(obj) {
  return JSON.stringify(obj, (_k, v) => (typeof v === 'bigint' ? v.toString() : v))
}

async function estimate(label, source, dest, amountUsdc) {
  const value = BigInt(Math.round(amountUsdc * 1e6))
  const spec = buildSpec(source, dest, value)
  const forms = [
    ['object', JSON.stringify([{ spec }], (_k, v) => (typeof v === 'bigint' ? v.toString() : v))],
    ['string', JSON.stringify([{ spec: stringifyTypedData(spec) }])],
  ]
  for (const [form, body] of forms) {
    const res = await fetch(`${API}/estimate?enableForwarder=false`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    })
    const text = await res.text()
    console.log(`\n=== /estimate ${label} (${amountUsdc} USDC) [spec as ${form}] -> HTTP ${res.status} ===`)
    console.log(text.slice(0, 900))
    if (res.ok) return res.status
  }
  return 0
}

/** Project implementation's maxFee formula (src/services/gatewayUcwService.ts) */
function projectMaxFee(amountUsdc) {
  const amount = BigInt(Math.round(amountUsdc * 1e6))
  const transferFee = (amount * 5n) / 100_000n
  const calculated = transferFee + 50_000n
  const MIN = 1_000_000n
  return calculated < MIN ? MIN : calculated
}

const ok = await checkBalances()

// Arc Testnet -> Base Sepolia (the default route in BridgeModal)
await estimate('Arc_Testnet -> Base_Sepolia', CHAINS.Arc_Testnet, CHAINS.Base_Sepolia, 1)
await estimate('Arc_Testnet -> Base_Sepolia', CHAINS.Arc_Testnet, CHAINS.Base_Sepolia, 10)
await estimate('Arc_Testnet -> Arbitrum_Sepolia', CHAINS.Arc_Testnet, CHAINS.Arbitrum_Sepolia, 5)
await estimate('Arc_Testnet -> Polygon_Amoy', CHAINS.Arc_Testnet, CHAINS.Polygon_Amoy, 5)
await estimate('Arc_Testnet -> Ethereum_Sepolia', CHAINS.Arc_Testnet, CHAINS.Ethereum_Sepolia, 5)

console.log('\n=== Project maxFee formula vs. Circle 0.005% + gas ===')
for (const usdc of [1, 5, 10, 100]) {
  const project = Number(projectMaxFee(usdc)) / 1e6
  const circle = 0.05 + usdc * 0.00005
  console.log(`  ${usdc} USDC  ->  project=${project.toFixed(6)}  circle≈${circle.toFixed(6)}`)
}
console.log(`\n/balances reachable: ${ok}`)
