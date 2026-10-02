import { hashTypedData, keccak256, stringToHex, type Address, type Hex } from 'viem'
import { arcTestnet } from '../arcChain'
import { GATEWAY_CONTRACTS } from './schemes'

export const X402_AUTHORIZATION_DOMAIN = {
  name: 'Arcis x402 Registry',
  version: '1',
  chainId: arcTestnet.id,
  verifyingContract: GATEWAY_CONTRACTS.testnet.gatewayWallet,
} as const

export const SERVICE_REGISTRATION_TYPES = {
  ServiceRegistration: [
    { name: 'owner', type: 'address' },
    { name: 'manifestHash', type: 'bytes32' },
    { name: 'nonce', type: 'bytes32' },
    { name: 'deadline', type: 'uint256' },
  ],
} as const

export const PROVIDER_LEDGER_TYPES = {
  ProviderLedgerAuthorization: [
    { name: 'providerAddress', type: 'address' },
    { name: 'amountMicros', type: 'uint256' },
    { name: 'nonce', type: 'bytes32' },
    { name: 'deadline', type: 'uint256' },
  ],
} as const

function stableJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  const record = value as Record<string, unknown>
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(',')}}`
}

export function hashServiceManifest(manifest: unknown): Hex {
  return keccak256(stringToHex(stableJson(manifest)))
}

export function serviceRegistrationDigest(params: {
  owner: Address
  manifest: unknown
  nonce: Hex
  deadline: bigint
}): Hex {
  return hashTypedData({
    domain: X402_AUTHORIZATION_DOMAIN,
    types: SERVICE_REGISTRATION_TYPES,
    primaryType: 'ServiceRegistration',
    message: {
      owner: params.owner,
      manifestHash: hashServiceManifest(params.manifest),
      nonce: params.nonce,
      deadline: params.deadline,
    },
  })
}
