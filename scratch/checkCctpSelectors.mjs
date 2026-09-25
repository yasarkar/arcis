// scratch/checkCctpSelectors.mjs
// On-chain verification (read-only eth_call) that the CCTP V2 function selectors
// used by src/services/bridgeUcwService.ts exist on the Arc Testnet contracts.
//
// When a selector exists, the EVM returns a revert reason (e.g. allowance error).
// When a selector does NOT exist, the call returns empty revert data (no reason).

import { encodeFunctionData, toFunctionSelector } from 'viem'

const RPC = 'https://rpc.testnet.arc.network'
const TOKEN_MESSENGER = '0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA'
const TRANSMITTER = '0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275'
const USDC = '0x3600000000000000000000000000000000000000'
const PROBE = '0x1111111111111111111111111111111111111111'
const ZERO32 = '0x' + '0'.repeat(64)

const ABI_4 = [
  {
    type: 'function',
    name: 'depositForBurn',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'amount', type: 'uint256' },
      { name: 'destinationDomain', type: 'uint32' },
      { name: 'mintRecipient', type: 'bytes32' },
      { name: 'burnToken', type: 'address' },
    ],
    outputs: [{ name: '', type: 'uint64' }],
  },
]

const ABI_7 = [
  {
    type: 'function',
    name: 'depositForBurn',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'amount', type: 'uint256' },
      { name: 'destinationDomain', type: 'uint32' },
      { name: 'mintRecipient', type: 'bytes32' },
      { name: 'burnToken', type: 'address' },
      { name: 'destinationCaller', type: 'bytes32' },
      { name: 'maxFee', type: 'uint256' },
      { name: 'minFinalityThreshold', type: 'uint32' },
    ],
    outputs: [{ name: '', type: 'uint64' }],
  },
]

const ABI_RECEIVE = [
  {
    type: 'function',
    name: 'receiveMessage',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'message', type: 'bytes' },
      { name: 'attestation', type: 'bytes' },
    ],
    outputs: [{ name: 'success', type: 'bool' }],
  },
]

async function call(label, to, data) {
  const res = await fetch(RPC, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'eth_call',
      params: [{ to, data, from: PROBE }, 'latest'],
    }),
  })
  const json = await res.json()
  const err = json.error || {}
  const reason = json.error?.data ? json.error.data : null
  console.log(`\n=== ${label} ===`)
  console.log(`  selector: ${data.slice(0, 10)}`)
  console.log(`  result  : ${json.result ?? 'REVERT'}`)
  console.log(`  error   : ${err.message ?? '-'}`)
  console.log(`  data    : ${reason ?? '(empty)'}`)
  if (typeof err.data === 'string' && err.data.length > 2) {
    const hex = err.data.startsWith('0x') ? err.data : `0x${err.data}`
    // Error(string) => 0x08c379a0
    if (hex.startsWith('0x08c379a0')) {
      try {
        const len = parseInt(hex.slice(74, 138), 16)
        const msg = Buffer.from(hex.slice(138, 138 + len * 2), 'hex').toString('utf8')
        console.log(`  reason  : "${msg}"`)
      } catch {
        /* ignore */
      }
    }
  }
}

console.log('depositForBurn(uint256,uint32,bytes32,address) selector:', toFunctionSelector('depositForBurn(uint256,uint32,bytes32,address)'))
console.log('depositForBurn(uint256,uint32,bytes32,address,bytes32,uint256,uint32) selector:', toFunctionSelector('depositForBurn(uint256,uint32,bytes32,address,bytes32,uint256,uint32)'))

await call(
  'app code: 4-arg depositForBurn',
  TOKEN_MESSENGER,
  encodeFunctionData({
    abi: ABI_4,
    functionName: 'depositForBurn',
    args: [1_000_000n, 6, ZERO32, USDC],
  })
)

await call(
  'CCTP V2: 7-arg depositForBurn',
  TOKEN_MESSENGER,
  encodeFunctionData({
    abi: ABI_7,
    functionName: 'depositForBurn',
    args: [1_000_000n, 6, ZERO32, USDC, ZERO32, 5000n, 1000],
  })
)

await call(
  'MessageTransmitterV2 receiveMessage(bytes,bytes)',
  TRANSMITTER,
  encodeFunctionData({ abi: ABI_RECEIVE, functionName: 'receiveMessage', args: ['0x', '0x'] })
)
