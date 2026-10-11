/**
 * Which Circle modular endpoint accepts the configured client key?
 *
 * The app builds `${VITE_CLIENT_URL}/arcTestnet` and authenticates with `VITE_CLIENT_KEY`. The live
 * verification got HTTP 401 there, so this probes the host/path matrix (prod vs staging, with and
 * without the chain suffix) plus the passkey (rp_*) transport the login flow uses, to tell a stale
 * key apart from an environment mismatch.
 *
 * Run: set -a && . ./.env && set +a && npx tsx scratch/msca-bundler-credential-probe.ts
 */
import { randomUUID } from 'node:crypto'

const key = process.env.VITE_CLIENT_KEY
const baseUrl = process.env.VITE_CLIENT_URL
if (!key || !baseUrl) throw new Error('VITE_CLIENT_KEY / VITE_CLIENT_URL not set')

const stagingBase = baseUrl.replace('modular-sdk.circle.com', 'modular-sdk-staging.circle.com')

const PROBES: { label: string; url: string; method: string; params: unknown[] }[] = [
  { label: 'app URL (prod host + /arcTestnet)', url: `${baseUrl}/arcTestnet`, method: 'eth_chainId', params: [] },
  { label: 'staging host + /arcTestnet', url: `${stagingBase}/arcTestnet`, method: 'eth_chainId', params: [] },
  { label: 'prod host, no chain suffix', url: baseUrl, method: 'eth_chainId', params: [] },
  { label: 'staging host, no chain suffix', url: stagingBase, method: 'eth_chainId', params: [] },
  // Passkey transport uses the bare URL in the app; rp_* is what registration/login call.
  { label: 'passkey rp_getLoginOptions (prod host)', url: baseUrl, method: 'rp_getLoginOptions', params: [{}] },
  { label: 'passkey rp_getLoginOptions (staging host)', url: stagingBase, method: 'rp_getLoginOptions', params: [{}] },
]

async function probe(entry: (typeof PROBES)[number]) {
  try {
    const response = await fetch(entry.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`,
        'X-AppInfo': 'platform=web;version=1.0.15;uri=node-verify',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: randomUUID(), method: entry.method, params: entry.params }),
    })
    const text = (await response.text()).slice(0, 220)
    const accepted = response.ok && !text.includes('"error"')
    console.log(`${accepted ? 'OK   ' : 'REJECT'} ${String(response.status).padEnd(4)} ${entry.label}\n        ${text}`)
  } catch (error) {
    console.log(`ERROR      ${entry.label}\n        ${(error as Error).message.slice(0, 200)}`)
  }
}

async function main() {
  console.log(`key prefix ${key!.split(':')[0]}, url host ${new URL(baseUrl!).host}`)
  for (const entry of PROBES) await probe(entry)
}

main().catch((error) => {
  console.error('probe crashed:', error)
  process.exit(1)
})
