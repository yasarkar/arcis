// src/services/ucwTypedData.ts
// One preparer for every Circle user-controlled-wallet typed-data challenge
// (`POST /api/ucw?action=signTypedData`, used by Gateway transfers and x402 payments).
//
// Circle validates the payload with go-ethereum's EIP-712 encoder, and that has two
// consequences worth handling once instead of per caller:
//
//   1. `types` must declare `EIP712Domain` for every field carried in `domain`. The encoder
//      hashes the domain with `HashStruct("EIP712Domain", domain)` and rejects a domain with
//      more fields than the declaration:
//        `there is extra data provided in the message (0 < 4)`
//      That reads like a message error but it is 0 declared domain fields vs 4 provided.
//   2. The challenge body is JSON, so `bigint` cannot be sent. Their decimal string form
//      encodes to the same uint256 value, which leaves the signed hash untouched.

export interface CircleTypedData {
  domain?: Record<string, unknown>
  types?: Record<string, unknown>
  primaryType?: string
  message?: Record<string, unknown>
  [key: string]: unknown
}

/**
 * Structural constraint for callers: any concrete typed-data shape fits, including interfaces
 * whose fields are narrowly typed, without requiring an index signature on their side.
 */
export interface CircleTypedDataShape {
  domain?: object
  types?: object
  primaryType?: string
  message?: object
}

/**
 * Canonical EIP-712 domain fields, in the order that fixes the domain separator. Mirrors
 * viem's `getTypesForEIP712Domain`, so declaring them cannot change the signed hash.
 */
const EIP712_DOMAIN_FIELDS = [
  ['name', 'string'],
  ['version', 'string'],
  ['chainId', 'uint256'],
  ['verifyingContract', 'address'],
  ['salt', 'bytes32'],
] as const

/** Recursively makes a typed-data payload JSON-serializable (bigint → decimal string). */
function toJsonValue(value: unknown): unknown {
  if (typeof value === 'bigint') return value.toString()
  if (Array.isArray(value)) return value.map(toJsonValue)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, entry]) => [key, toJsonValue(entry)])
    )
  }
  return value
}

/** Declares the domain type only when the payload does not already declare it. */
function withEip712DomainType(
  types: Record<string, unknown> | undefined,
  domain: Record<string, unknown> | undefined
): Record<string, unknown> {
  const baseTypes = types && typeof types === 'object' ? types : {}
  if (Object.prototype.hasOwnProperty.call(baseTypes, 'EIP712Domain')) return baseTypes

  const domainFields = EIP712_DOMAIN_FIELDS.filter(
    ([name]) => domain?.[name] !== undefined && domain[name] !== null
  ).map(([name, type]) => ({ name, type }))

  return { EIP712Domain: domainFields, ...baseTypes }
}

/**
 * Prepares a typed-data payload for a Circle challenge: declares `EIP712Domain`, converts
 * every `bigint` to its decimal string form, and fails loudly when the primary type itself
 * is undeclared (otherwise Circle answers with the same cryptic "extra data" error).
 *
 * Idempotent: provider payloads that already declare the domain type and carry strings are
 * returned unchanged, so applying it at several boundaries is safe.
 */
export function prepareCircleTypedData<T extends CircleTypedDataShape>(
  typedData: T
): T & { types: Record<string, unknown> } {
  const normalized = toJsonValue(typedData) as CircleTypedData
  const types = withEip712DomainType(
    normalized.types as Record<string, unknown> | undefined,
    normalized.domain as Record<string, unknown> | undefined
  )

  if (normalized.primaryType && !types[normalized.primaryType]) {
    throw new Error(
      `Circle typed-data challenge is missing the declaration for its primary type "${normalized.primaryType}".`
    )
  }

  return { ...(normalized as unknown as T), types }
}
