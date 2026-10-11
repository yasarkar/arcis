/**
 * Is the modular-bundler 401 really an invalid key, or just a missing browser `Origin`?
 *
 * Circle's service may validate the calling origin, so a server-side fetch without `Origin` could be
 * rejected even with a healthy key. This repeats the exact SDK request with a few plausible origins.
 *
 * Run: set -a && . ./.env && set +a && npx tsx scratch/msca-origin-probe.ts
 */
import { randomUUID } from 'node:crypto'

const key = process.env.VITE_CLIENT_KEY
const clientUrl = process.env.VITE_CLIENT_URL
if (!key || !clientUrl) throw new Error('VITE_CLIENT_KEY / VITE_CLIENT_URL not set')

const url = `${clientUrl}/arcTestnet`
const origins: (string | undefined)[] = [
  undefined,
  'http://localhost:5173',
  'https://localhost:5173',
  'https://arc-mini-app.vercel.app',
]

async function probe(origin: string | undefined) {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${key}`,
    'X-AppInfo': 'platform=web;version=1.0.15;uri=node-verify',
  }
  if (origin) {
    headers.Origin = origin
    headers.Referer = `${origin}/`
  }

  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({ jsonrpc: '2.0', id: randomUUID(), method: 'eth_chainId', params: [] }),
  })
  const body = (await response.text()).replace(/\s+/g, ' ').slice(0, 160)
  console.log(`${origin ? origin.padEnd(34) : '(no Origin header)'.padEnd(34)} ${response.status}  ${body}`)
}

async function main() {
  console.log(`POST ${url}`)
  for (const origin of origins) await probe(origin)
}

main().catch((error) => {
  console.error('probe crashed:', error)
  process.exit(1)
})
