// api/__tests__/serverSigner.test.ts
// ARC-011: the same `PRIVATE_KEY` name meant "deployer" in the docs and "relayer" in the server, so
// a deploy key could authorize gasless sponsorship or vault distributions. These tests pin the
// dedicated-key policy and scan the server sources for any regression to the ambiguous read.

import { afterEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { privateKeyToAccount } from 'viem/accounts'

const RELAYER_KEY = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d'
const DISTRIBUTOR_KEY = '0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba'
const DEPLOY_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'

afterEach(() => {
  vi.unstubAllEnvs()
})

async function freshModule() {
  vi.resetModules()
  return import('../_utils/serverSigner')
}

describe('server signer key resolution', () => {
  it('uses the dedicated relayer key', async () => {
    const { getServerSignerAccount } = await freshModule()
    vi.stubEnv('RELAYER_PRIVATE_KEY', RELAYER_KEY)

    expect(getServerSignerAccount()?.address).toBe(privateKeyToAccount(RELAYER_KEY).address)
  })

  it('ignores the deploy key and warns that it is not a server key', async () => {
    const { getServerSignerAccount, DEPLOY_KEY_ENV, RELAYER_PRIVATE_KEY_ENV } = await freshModule()
    vi.stubEnv(DEPLOY_KEY_ENV, DEPLOY_KEY)
    vi.stubEnv(RELAYER_PRIVATE_KEY_ENV, '')

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      expect(getServerSignerAccount()).toBeNull()
      const logged = warn.mock.calls.map((call) => String(call[0])).join('\n')
      expect(logged).toContain(DEPLOY_KEY_ENV)
      expect(logged).toContain(RELAYER_PRIVATE_KEY_ENV)
    } finally {
      warn.mockRestore()
    }
  })

  it('rejects a malformed dedicated key instead of falling back to the deploy key', async () => {
    const { getServerSignerAccount } = await freshModule()
    vi.stubEnv('RELAYER_PRIVATE_KEY', '0xdeadbeef')
    vi.stubEnv('PRIVATE_KEY', DEPLOY_KEY)

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      expect(getServerSignerAccount()).toBeNull()
    } finally {
      warn.mockRestore()
    }
  })

  it('prefers DISTRIBUTOR_KEY for vault work and still accepts the relayer key', async () => {
    const { getServerSignerAccount } = await freshModule()
    vi.stubEnv('RELAYER_PRIVATE_KEY', RELAYER_KEY)
    vi.stubEnv('DISTRIBUTOR_KEY', DISTRIBUTOR_KEY)

    expect(getServerSignerAccount({ forVault: true })?.address).toBe(privateKeyToAccount(DISTRIBUTOR_KEY).address)

    vi.stubEnv('DISTRIBUTOR_KEY', '')
    expect(getServerSignerAccount({ forVault: true })?.address).toBe(privateKeyToAccount(RELAYER_KEY).address)
  })

  it('does not hand the relayer key to vault work when only DISTRIBUTOR_KEY is set', async () => {
    const { getServerSignerAccount } = await freshModule()
    vi.stubEnv('DISTRIBUTOR_KEY', DISTRIBUTOR_KEY)
    vi.stubEnv('RELAYER_PRIVATE_KEY', '')

    expect(getServerSignerAccount()).toBeNull()
    expect(getServerSignerAccount({ forVault: true })?.address).toBe(privateKeyToAccount(DISTRIBUTOR_KEY).address)
  })
})

describe('ambiguous PRIVATE_KEY reads stay removed', () => {
  const files = [
    'api/health.ts',
    'api/vault.ts',
    'api/_utils/vaultKeeper.ts',
    'api/_utils/serverSigner.ts',
    'scripts/distribute-yield.mjs',
  ]

  it.each(files)('%s never reads the deploy key as a server key', (file) => {
    const source = readFileSync(file, 'utf8')
    expect(source).not.toMatch(/(process|globalThis|local|global)\.(env|.*)\.PRIVATE_KEY\b/)
    expect(source).not.toMatch(/env\.PRIVATE_KEY\b(?!_)/)
  })

  it('the env template documents dedicated keys instead of a relayer PRIVATE_KEY', () => {
    const template = readFileSync('.env.example', 'utf8')
    expect(template).toMatch(/^RELAYER_PRIVATE_KEY=/m)
    expect(template).toMatch(/^DISTRIBUTOR_KEY=/m)
    expect(template).not.toMatch(/^PRIVATE_KEY=/m)
  })
})
