// api/_utils/serverSigner.ts
// Single owner of server-side signer-key resolution — audit ARC-011.
//
// `PRIVATE_KEY` is the Foundry deploy key (kept in `contracts/.env`). It is deliberately never read
// here: a deploy key must not be usable as the gasless relayer or the vault-distributor signer, and
// an operator who pastes one into the server environment should see "not configured" instead of a
// "configured" relayer that is really their deployer. Server processes use dedicated keys:
//
//   RELAYER_PRIVATE_KEY — gasless sponsorship and other server-side signing (required)
//   DISTRIBUTOR_KEY     — optional dedicated yield-vault distributor key; takes priority for vault work

import { privateKeyToAccount, type PrivateKeyAccount } from 'viem/accounts'

export const RELAYER_PRIVATE_KEY_ENV = 'RELAYER_PRIVATE_KEY'
export const DISTRIBUTOR_KEY_ENV = 'DISTRIBUTOR_KEY'
export const DEPLOY_KEY_ENV = 'PRIVATE_KEY'

/** A 32-byte hex key, with or without the 0x prefix. */
const PRIVATE_KEY_PATTERN = /^(0x)?[0-9a-fA-F]{64}$/

export interface ServerSignerKey {
  /** Which environment variable supplied the key. */
  envName: string
  privateKey: `0x${string}`
}

export interface ServerSignerOptions {
  /** Vault work may use the dedicated DISTRIBUTOR_KEY, falling back to the relayer key. */
  forVault?: boolean
}

function readEnv(name: string): string {
  const local = typeof process !== 'undefined' && process.env ? process.env[name] : undefined
  const globalValue = (globalThis as any)?.process?.env?.[name]
  return String(local ?? globalValue ?? '').trim()
}

let warnedAboutDeployKey = false

function warnAboutDeployKeyOnly(): void {
  if (warnedAboutDeployKey) return
  if (!readEnv(DEPLOY_KEY_ENV)) return
  warnedAboutDeployKey = true
  console.warn(
    `[serverSigner] ${DEPLOY_KEY_ENV} is set but no dedicated server key is. ` +
      `${DEPLOY_KEY_ENV} is reserved for the Foundry deploy scripts in contracts/.env and is ignored here — ` +
      `set ${RELAYER_PRIVATE_KEY_ENV} (and optionally ${DISTRIBUTOR_KEY_ENV}) instead.`
  )
}

export function resolveServerSignerKey(options: ServerSignerOptions = {}): ServerSignerKey | null {
  const candidates = options.forVault
    ? [DISTRIBUTOR_KEY_ENV, RELAYER_PRIVATE_KEY_ENV]
    : [RELAYER_PRIVATE_KEY_ENV]

  for (const envName of candidates) {
    const raw = readEnv(envName)
    if (!raw) continue
    if (!PRIVATE_KEY_PATTERN.test(raw)) {
      console.warn(`[serverSigner] ${envName} is not a 32-byte hex key; ignoring it.`)
      continue
    }
    return { envName, privateKey: (raw.startsWith('0x') ? raw : `0x${raw}`) as `0x${string}` }
  }

  warnAboutDeployKeyOnly()
  return null
}

/** Resolves and validates the server signer, or null when no dedicated key is configured. */
export function getServerSignerAccount(options: ServerSignerOptions = {}): PrivateKeyAccount | null {
  const resolved = resolveServerSignerKey(options)
  if (!resolved) return null
  try {
    return privateKeyToAccount(resolved.privateKey)
  } catch {
    return null
  }
}
