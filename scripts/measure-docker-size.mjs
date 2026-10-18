// scripts/measure-docker-size.mjs
//
// Records the production Docker image size for the P13 follow-up.
// Prints the image size (`docker image inspect <tag>` Size field) plus a
// `docker history` layer summary, so a toolchain or dependency regression
// shows up as a number instead of a feeling.
//
// Usage:
//   npm run docker:size -- [tag]        (defaults to arc-mini-app:latest,
//                                        builds it first if missing)
//   npm run docker:size -- --build       (force `docker build` first)
//
// Requires a running Docker daemon. Fails with exit 2 and a clear message
// when the daemon is unreachable (e.g. Docker Desktop stopped on Windows:
// "failed to connect to the docker API"), instead of printing a stale size.

import { execSync } from 'node:child_process'

const args = process.argv.slice(2)
const tag = args.find((a) => !a.startsWith('--')) || 'arc-mini-app:latest'
const forceBuild = args.includes('--build')

function sh(cmd, { stdio = 'pipe' } = {}) {
  try {
    return execSync(cmd, { stdio, encoding: 'utf8' })
  } catch (err) {
    const out = [err?.stdout, err?.stderr].filter(Boolean).join('\n')
    throw new Error(`command failed: ${cmd}\n${out || err?.message || err}`)
  }
}

function mb(bytes) {
  return `${(Number(bytes) / 1024 / 1024).toFixed(1)} MB`
}

let daemonOk = true
try {
  sh('docker info')
} catch (err) {
  daemonOk = false
  console.error('[docker:size] Docker daemon unreachable — start Docker Desktop (or dockerd) and retry.')
  console.error(`[docker:size] ${String(err.message).split('\n')[0]}`)
  process.exit(2)
}

if (daemonOk && (forceBuild || !sh(`docker images -q ${tag}`).trim())) {
  console.log(`[docker:size] building ${tag} …`)
  sh(`docker build -t ${tag} .`, { stdio: 'inherit' })
}

const inspectRaw = sh(`docker image inspect ${tag} --format "{{json .Size}}"`)
const sizeBytes = Number(JSON.parse(inspectRaw.trim()))
console.log(`\n[docker:size] ${tag}: ${mb(sizeBytes)} (${sizeBytes} bytes)`)

console.log('\n[docker:size] layers (largest first):')
const history = sh(`docker history ${tag} --no-trunc --format "{{.Size}}\t{{.CreatedBy}}"`)
const rows = history
  .trim()
  .split('\n')
  .map((line) => {
    const tab = line.indexOf('\t')
    return { size: line.slice(0, tab).trim(), cmd: line.slice(tab + 1).trim().slice(0, 110) }
  })
for (const row of rows.slice(0, 15)) console.log(`  ${row.size.padStart(12)}  ${row.cmd}`)
