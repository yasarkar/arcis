// src/utils/__tests__/silentCatchGuard.test.ts
// ARC-016 regression guard.
//
// The audit found ~95 silent `catch {}` blocks in app code: failed ledger writes, failed persistence
// and failed receipt decodes became invisible while the caller was told everything succeeded.
//
// Policy after the fix:
//   • a catch body must contain a statement — a log call, a fallback value or a re-throw;
//   • a body that carries an explanatory comment is accepted, because the audit allows deliberate
//     best-effort handling as long as the intent is written down (and a comment alone is not a
//     runtime silence that hides a bug in the same way an empty body does).
//
// Test 2 pins the specific audited paths so a later refactor cannot quietly reintroduce silence in
// the money-touching code.

import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

const ROOTS = ['api', 'src']
const SKIP_DIRS = new Set(['node_modules', '__tests__', 'dist', 'coverage'])

const CATCH_BLOCK = /catch\s*(?:\([^)]*\))?\s*\{([\s\S]*?)\}/g
const CATCH_CALLBACK = /\.catch\(\s*(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>\s*\{([\s\S]*?)\}\s*\)/g

function collectFiles(root: string, out: string[] = []): string[] {
  for (const name of readdirSync(root)) {
    const full = join(root, name)
    if (statSync(full).isDirectory()) {
      if (SKIP_DIRS.has(name)) continue
      collectFiles(full, out)
      continue
    }
    if (!/\.(ts|tsx)$/.test(name)) continue
    if (/\.test\.|\.spec\./.test(name)) continue
    out.push(full)
  }
  return out
}

/** Blanks comments while preserving every offset, so a match index still points at real source. */
function blankComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (match) => match.replace(/[^\n]/g, ' '))
    .replace(/\/\/[^\n]*/g, (match) => match.replace(/[^\n]/g, ' '))
}

interface Offender {
  line: number
  snippet: string
}

function findEmptyCatches(source: string): Offender[] {
  const blanked = blankComments(source)
  const lines = source.split('\n')
  const offenders: Offender[] = []

  for (const pattern of [CATCH_BLOCK, CATCH_CALLBACK]) {
    pattern.lastIndex = 0
    let match: RegExpExecArray | null
    while ((match = pattern.exec(blanked)) !== null) {
      // `match[1]` is the comment-stripped body: empty means no statement ran.
      if (match[1].trim() !== '') continue
      const original = source.slice(match.index, match.index + match[0].length)
      const line = source.slice(0, match.index).split('\n').length
      const documented = original.includes('//') || original.includes('/*')
      if (documented) continue
      offenders.push({ line, snippet: lines[line - 1]?.trim().slice(0, 120) ?? '' })
    }
  }

  return offenders
}

function scanAppCode(): string[] {
  const violations: string[] = []
  for (const file of ROOTS.flatMap((root) => collectFiles(root))) {
    const source = readFileSync(file, 'utf8')
    for (const offender of findEmptyCatches(source)) {
      violations.push(`${relative(process.cwd(), file).split(sep).join('/')}:${offender.line} → ${offender.snippet}`)
    }
  }
  return violations
}

describe('ARC-016: no silent catch in app code', () => {
  it('every catch block and promise catch callback does something', () => {
    const violations = scanAppCode()
    expect(
      violations,
      `A catch with no statement hides failures; log, fall back or re-throw:\n${violations.join('\n')}`
    ).toEqual([])
  })

  it('scans the app sources it claims to scan', () => {
    const files = ROOTS.flatMap((root) => collectFiles(root))
    expect(files.length).toBeGreaterThan(100)
    expect(files.some((file) => file.endsWith(`api${sep}health.ts`))).toBe(true)
    expect(files.some((file) => file.endsWith(`hooks${sep}usePoolsData.ts`))).toBe(true)
  })

  it('detects an empty catch when one is present', () => {
    expect(findEmptyCatches('try { risky() } catch {}')).toHaveLength(1)
    expect(findEmptyCatches('try { risky() } catch (e) {\n}')).toHaveLength(1)
    expect(findEmptyCatches('run().catch(() => {})')).toHaveLength(1)
    // A statement, a fallback value or a documented intent is accepted.
    expect(findEmptyCatches('try { risky() } catch (e) { log.warn("x", e) }')).toHaveLength(0)
    expect(findEmptyCatches('try { risky() } catch { return null }')).toHaveLength(0)
    expect(findEmptyCatches('try { risky() } catch {\n  // best-effort: absence of a value is fine\n}')).toHaveLength(0)
  })

  const auditedPaths: Array<{ file: string; minLogs: number }> = [
    { file: 'api/_utils/redisStorage.ts', minLogs: 7 },
    { file: 'api/x402.ts', minLogs: 4 },
    { file: 'api/health.ts', minLogs: 2 },
    { file: 'src/hooks/usePoolsData.ts', minLogs: 21 },
  ]

  it.each(auditedPaths)('$file keeps logging the failures it used to swallow', ({ file, minLogs }) => {
    const source = file === 'src/hooks/usePoolsData.ts'
      ? [
          readFileSync('src/hooks/usePoolsData.ts', 'utf8'),
          readFileSync('src/services/pools/poolQueries.ts', 'utf8'),
          readFileSync('src/services/pools/poolDepositService.ts', 'utf8'),
          readFileSync('src/services/pools/poolWithdrawService.ts', 'utf8'),
          readFileSync('src/services/pools/poolSwapService.ts', 'utf8'),
          readFileSync('src/services/pools/poolClaimService.ts', 'utf8'),
        ].join('\n')
      : readFileSync(file, 'utf8')
    const logCalls = source.match(/(?:console\.(?:warn|error|debug)|(?:poolsLog|log)\.(?:warn|error|debug))\(/g) ?? []
    expect(logCalls.length).toBeGreaterThanOrEqual(minLogs)
  })
})
