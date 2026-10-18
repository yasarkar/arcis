// scripts/check-bundle-budget.mjs
//
// CI gate for the production JS budget: fails (exit 1) when dist/ grows past
// the pinned thresholds, so an eagerly-imported SDK or a misplaced static
// import is caught at build time instead of shipping silently.
//
// Baseline measured 2026-10-18 from `vite build` (P07 config); every limit
// carries ~10% headroom over that baseline. To re-baseline after an intended
// size change: rebuild, read the printed table, update BUDGETS below.
//
// Usage: `npm run budget` (requires dist/ — run `npm run build` first).
// Wired into `build:verified`, which is also the Vercel buildCommand.

import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'

const DIST_ASSETS = join(process.cwd(), 'dist', 'assets')

// All values are gzip bytes.
const BUDGETS = {
  // Eager vendor shell: react + react-dom + scheduler (manualChunks).
  'react-vendor': 70 * 1024,
  // Lazy token-icon index (JS-embedded SVGs — see the icon-sprite follow-up).
  'dynamicIconImports': 75 * 1024,
  // Largest single chunk (today the deliberate Web3 monolith ARC-027 keeps
  // whole; the gate pins it so it can never grow silently).
  'maxSingleChunk': 1300 * 1024,
  // Whole production JS payload.
  'totalJs': 7.8 * 1024 * 1024,
}

function chunkKey(fileName) {
  // Match the manualChunks family prefix directly: hashes may contain dashes,
  // so stripping a trailing `-hash.js` is unreliable (`react-vendor-X` would
  // collapse to `react`).
  if (fileName.startsWith('react-vendor-')) return 'react-vendor'
  if (fileName.startsWith('dynamicIconImports-')) return 'dynamicIconImports'
  return null
}

function kb(bytes) {
  return `${(bytes / 1024).toFixed(1)} KB`
}

const failures = []

if (!existsSync(DIST_ASSETS)) {
  console.error('[budget] dist/assets not found — run `npm run build` first.')
  process.exit(1)
}

const files = readdirSync(DIST_ASSETS).filter((f) => f.endsWith('.js'))
if (files.length === 0) {
  console.error('[budget] no JS chunks in dist/assets — nothing to check.')
  process.exit(1)
}

let total = 0
let largest = { file: '', size: 0 }
const pinned = new Map()

for (const file of files) {
  const size = gzipSync(readFileSync(join(DIST_ASSETS, file))).length
  total += size
  if (size > largest.size) largest = { file, size }
  const key = chunkKey(file)
  if (key) pinned.set(key, { file, size })
}

console.log('[budget] gzip sizes (budget in parentheses):')
for (const [key, { file, size }] of pinned) {
  const limit = BUDGETS[key]
  const ok = size <= limit
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${kb(size)} (≤ ${kb(limit)})  ${file}`)
  if (!ok) failures.push(`${key}: ${kb(size)} exceeds ${kb(limit)}`)
}

{
  const ok = largest.size <= BUDGETS.maxSingleChunk
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  largest chunk ${kb(largest.size)} (≤ ${kb(BUDGETS.maxSingleChunk)})  ${largest.file}`)
  if (!ok) failures.push(`largest chunk: ${kb(largest.size)} exceeds ${kb(BUDGETS.maxSingleChunk)}`)
}

{
  const ok = total <= BUDGETS.totalJs
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  total JS ${kb(total)} (≤ ${kb(BUDGETS.totalJs)}) across ${files.length} files`)
  if (!ok) failures.push(`total JS: ${kb(total)} exceeds ${kb(BUDGETS.totalJs)}`)
}

if (failures.length > 0) {
  console.error('\n[budget] BUDGET EXCEEDED:')
  for (const failure of failures) console.error(`  - ${failure}`)
  process.exit(1)
}

console.log('\n[budget] all budgets hold.')
