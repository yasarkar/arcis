import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { isRealTxHash, resolveUcwTxHash, ucwHashPendingMessage } from '../ucwTxHash'

// A Circle UCW challenge can finish (the user signed in the SDK iframe) before Circle publishes
// the broadcast transaction hash. The hook used to return `pending_<challengeId>` as `txHash`,
// which the pools UI reported as a confirmed harvest with an explorer link that could never exist.
// These tests pin the guard that removed the fabricated hash from the UCW harvest path.
const REAL_HASH = '0x3a49e6949b03368c0950a30f45cd7c0e45ee3a4ff309336986cd96524c1b5bd5'

const ucwSource = readFileSync(new URL('../../hooks/useUserControlledWallet.ts', import.meta.url), 'utf8')
const poolsSource = [
  readFileSync(new URL('../../hooks/usePoolsData.ts', import.meta.url), 'utf8'),
  readFileSync(new URL('../../services/pools/poolClaimService.ts', import.meta.url), 'utf8'),
].join('\n')
const sendModalSource = readFileSync(new URL('../../components/SendModal.tsx', import.meta.url), 'utf8')

describe('ucwTxHash — no placeholder is ever a transaction hash', () => {
  describe('isRealTxHash', () => {
    it('accepts a 32-byte hex hash', () => {
      expect(isRealTxHash(REAL_HASH)).toBe(true)
    })

    it('accepts an uppercase 32-byte hex hash', () => {
      expect(isRealTxHash('0x' + 'AB'.repeat(32))).toBe(true)
    })

    it('rejects the polled-out challenge placeholder', () => {
      expect(isRealTxHash('pending_challenge-abc-123')).toBe(false)
    })

    it('rejects short, empty, missing, and non-string values', () => {
      expect(isRealTxHash('0x1234')).toBe(false)
      expect(isRealTxHash('0x')).toBe(false)
      expect(isRealTxHash('')).toBe(false)
      expect(isRealTxHash(undefined)).toBe(false)
      expect(isRealTxHash(null)).toBe(false)
      expect(isRealTxHash(42)).toBe(false)
    })

    it('rejects a 64-char value that is not hexadecimal', () => {
      expect(isRealTxHash('0x' + 'g'.repeat(64))).toBe(false)
      expect(isRealTxHash('zz49e6949b03368c0950a30f45cd7c0e45ee3a4ff309336986cd96524c1b5bd5')).toBe(false)
    })
  })

  describe('resolveUcwTxHash', () => {
    it('returns the real hash when Circle published one', () => {
      expect(resolveUcwTxHash({ success: true, txHash: REAL_HASH })).toBe(REAL_HASH)
    })

    it('returns null for a placeholder hash so callers cannot report success', () => {
      expect(resolveUcwTxHash({ success: true, txHash: 'pending_challenge-abc-123' })).toBeNull()
    })

    it('returns null while the result reports the hash as still pending', () => {
      expect(resolveUcwTxHash({ success: true, hashPending: true, challengeId: 'abc' })).toBeNull()
    })

    it('returns null for missing/empty results', () => {
      expect(resolveUcwTxHash(null)).toBeNull()
      expect(resolveUcwTxHash(undefined)).toBeNull()
      expect(resolveUcwTxHash({ success: true })).toBeNull()
      expect(resolveUcwTxHash({ success: true, txHash: '' })).toBeNull()
    })
  })

  describe('ucwHashPendingMessage', () => {
    it('names the action and warns that the transaction may still settle', () => {
      const msg = ucwHashPendingMessage('Harvest')
      expect(msg).toContain('Harvest')
      expect(msg).toMatch(/has not published the on-chain transaction hash/i)
      expect(msg).toMatch(/before retrying/i)
    })
  })
})

describe('UCW harvest path — source pins', () => {
  const executeContractCallRegion = ucwSource.slice(
    ucwSource.indexOf('const executeContractCall = useCallback('),
    ucwSource.indexOf('const signTypedData = useCallback('),
  )

  it('executeContractCall never fabricates a pending_ placeholder as txHash', () => {
    expect(executeContractCallRegion).not.toMatch(/pending_\$\{/)
    expect(executeContractCallRegion).toMatch(/hashPending: true/)
    expect(executeContractCallRegion).toMatch(/isRealTxHash\(txHash\)/)
  })

  it('executeTransfer has the same guard (no fabricated hash on the send path)', () => {
    const transferRegion = ucwSource.slice(
      ucwSource.indexOf('const executeTransfer = useCallback('),
      ucwSource.indexOf('const disconnectUcw = useCallback('),
    )
    expect(transferRegion).not.toMatch(/pending_\$\{/)
    expect(transferRegion).toMatch(/hashPending: true/)
    expect(transferRegion).toMatch(/isRealTxHash\(txHash\)/)
  })

  it('no UCW hook path can return a fabricated pending_ hash any more', () => {
    expect(ucwSource).not.toMatch(/`pending_\$\{/)
    expect(ucwSource).not.toMatch(/txHash \|\| `pending_/)
  })

  it('SendModal surfaces a pending transfer instead of a fake success + explorer link', () => {
    expect(sendModalSource).not.toMatch(/ucwResult\.txHash \|\| ''/)
    expect(sendModalSource).toMatch(/!ucwResult\.txHash/)
    expect(sendModalSource).toMatch(/Confirmation Pending/)
  })

  it('polls long enough to prefer a real hash over surfacing the pending state', () => {
    expect(ucwSource).toMatch(/const maxAttempts = 20;/)
  })

  it('the pools harvest branch resolves the hash and refuses to claim success without one', () => {
    const marker = poolsSource.indexOf('Harvest authorization failed.')
    expect(marker).toBeGreaterThan(-1)
    const harvestUcwBranch = poolsSource.slice(marker, marker + 1200)

    expect(harvestUcwBranch).toMatch(/resolveUcwTxHash\(res\)/)
    expect(harvestUcwBranch).toMatch(/throw new Error\(ucwHashPendingMessage\('Harvest'\)\)/)
    // The old code accepted `res.txHash || ''` and reported success with nothing verifiable.
    expect(harvestUcwBranch).not.toMatch(/res\.txHash \|\| ''/)
    expect(harvestUcwBranch).not.toMatch(/pending_/)
  })
})
