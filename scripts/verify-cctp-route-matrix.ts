// scripts/verify-cctp-route-matrix.ts
//
// Live consistency check for `src/config/bridgeRouteMatrix.ts` against Circle.
//
// Run with `npm run verify:cctp-routes` (or `-- --registry-only` to skip the
// route checks). The vitest suite covers the same facts offline against recorded
// rows; this script is what catches CIRCLE moving them.
//
// Two layers, both required for a non-USDC route to exist:
//   1. Registry — `/v2/cctpx/tokens` must still list each matrix token with the
//      same bytes32 id, decimals and CCTP domains. The endpoint is paginated
//      (`nextPageAfter`); a single page silently hides most tokens.
//   2. Routes — App Kit must actually resolve every pair the matrix claims and
//      reject the pairs it does not, in both directions. USDC is checked against
//      the Bridge tab's own chain list, since its route table is local to the SDK
//      and "the SDK knows the route" is weaker than "this app can deliver it".
//
// Exit codes: 0 = matrix still accurate, 1 = definitive drift (fix the matrix),
// 2 = could not be determined (the registry was rate-limited; retry later).

import { AppKit } from '@circle-fin/app-kit'
import {
  CCTPX_ELIGIBLE_CHAINS,
  NON_USDC_TOKEN_DEPLOYMENTS,
  USDC_BRIDGE_CHAINS,
  USDC_EXCLUDED_CHAINS,
  getNonUsdcRoutePartners,
  type NonUsdcBridgeToken,
} from '../src/config/bridgeRouteMatrix'
import { BRIDGE_SELECTABLE_CHAINS } from '../src/config/bridgeConfig'
import { createHeadlessSessionAdapter } from '../src/services/sendService'

const REGISTRY_HOST = process.env.CCTP_REGISTRY_HOST ?? 'https://iris-api-sandbox.circle.com'
const ROUTE_CHECKS_ENABLED = !process.argv.includes('--registry-only')
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

interface RegistryDeployment {
  tokenId: string
  domainId: number
  tokenAddress: string
  tokenManagerAddress: string
}

interface RegistryToken {
  tokenId: string
  name: string
  symbol: string
  decimals: number
  deployments: RegistryDeployment[]
}

const mismatches: string[] = []
const inconclusive: string[] = []

function mismatch(message: string) {
  mismatches.push(message)
  console.log(`  MISMATCH    ${message}`)
}

function note(message: string) {
  console.log(`  ${message}`)
}

async function fetchPage(pageAfter?: string, attempt = 0): Promise<any> {
  const url = `${REGISTRY_HOST}/v2/cctpx/tokens${pageAfter ? `?pageAfter=${encodeURIComponent(pageAfter)}` : ''}`
  const response = await fetch(url)
  if (response.status === 429 || response.status >= 500) {
    if (attempt < 6) {
      const wait = 4000 * (attempt + 1)
      console.log(`  [HTTP ${response.status}] backing off ${wait}ms`)
      await sleep(wait)
      return fetchPage(pageAfter, attempt + 1)
    }
    throw new Error(`registry unreachable: HTTP ${response.status}`)
  }
  if (!response.ok) throw new Error(`registry returned HTTP ${response.status}`)
  return response.json()
}

async function fetchRegistry(): Promise<RegistryToken[]> {
  const tokens: RegistryToken[] = []
  const usedCursors = new Set<string>()
  let pageAfter: string | undefined
  let pages = 0

  do {
    if (pageAfter) {
      if (usedCursors.has(pageAfter)) break
      usedCursors.add(pageAfter)
    }
    const page = await fetchPage(pageAfter)
    tokens.push(...(page.data ?? []))
    pageAfter = page.nextPageAfter ?? undefined
    pages += 1
    if (pages > 40) break
    await sleep(400)
  } while (pageAfter)

  console.log(`  registry: ${tokens.length} rows across ${pages} page(s)`)
  return tokens
}

async function checkRegistry() {
  console.log('\n1) Registry deployments')
  let tokens: RegistryToken[]
  try {
    tokens = await fetchRegistry()
  } catch (error) {
    inconclusive.push(`registry read failed: ${(error as Error).message}`)
    console.log(`  INCONCLUSIVE ${(error as Error).message}`)
    return
  }

  for (const symbol of Object.keys(NON_USDC_TOKEN_DEPLOYMENTS) as NonUsdcBridgeToken[]) {
    const expected = NON_USDC_TOKEN_DEPLOYMENTS[symbol]
    const row = tokens.find((token) => token.tokenId === expected.tokenId)

    if (!row) {
      mismatch(`${symbol}: token id ${expected.tokenId} is no longer listed in the registry`)
      continue
    }
    if (row.decimals !== expected.decimals) {
      mismatch(`${symbol}: decimals changed ${expected.decimals} -> ${row.decimals}`)
    }

    const domains = [...new Set(row.deployments.map((deployment) => deployment.domainId))].sort(
      (a, b) => a - b
    )
    const expectedDomains = [...expected.domains].sort((a, b) => a - b)
    if (domains.join(',') !== expectedDomains.join(',')) {
      mismatch(
        `${symbol}: deployments changed [${expectedDomains.join(', ')}] -> [${domains.join(', ')}]`
      )
      continue
    }
    note(`${symbol.padEnd(6)} ok — id, decimals and domains ${domains.join(', ')} unchanged`)

    // The matrix must equal what the two gates imply, computed here from the
    // registry row independently of the matrix's own derivation: the source needs
    // a deployment too, otherwise there is nothing to burn on that chain.
    for (const fromChain of Object.keys(CCTPX_ELIGIBLE_CHAINS)) {
      const sourceDeployed = domains.includes(CCTPX_ELIGIBLE_CHAINS[fromChain])
      const expectedPartners = sourceDeployed
        ? Object.keys(CCTPX_ELIGIBLE_CHAINS)
            .filter((chainKey) => chainKey !== fromChain)
            .filter((chainKey) => domains.includes(CCTPX_ELIGIBLE_CHAINS[chainKey]))
            .sort()
        : []
      const actualPartners = [...getNonUsdcRoutePartners(symbol, fromChain)].sort()
      if (expectedPartners.join(',') !== actualPartners.join(',')) {
        mismatch(
          `${symbol} from ${fromChain}: matrix says [${actualPartners.join(', ')}] but registry implies [${expectedPartners.join(', ')}]`
        )
      }
    }
  }
}

/** Route-check failures that mean "ask again", never "unsupported". */
const TRANSIENT_ROUTE_CHECK =
  /could not complete the route check|fetch failed|timed out|ECONNRESET|503|502/

/**
 * Estimates with bounded backoff. The registry rate-limits after a burst (the
 * 429 clears in tens of seconds), and a transient answer must never be recorded
 * as a verdict — so it is retried, then reported as inconclusive.
 */
async function estimateWithRetry(
  token: string,
  from: string,
  to: string,
  adapter?: any
): Promise<string> {
  let message = await estimate(token, from, to, adapter)
  for (const wait of [5000, 12000, 25000]) {
    if (!TRANSIENT_ROUTE_CHECK.test(message)) return message
    console.log(`  [transient] ${token} ${from} -> ${to}; retrying in ${wait}ms`)
    await sleep(wait)
    message = await estimate(token, from, to, adapter)
  }
  return message
}

async function estimate(token: string, from: string, to: string, adapter?: any): Promise<string> {
  adapter ??= createHeadlessSessionAdapter(`0x${'11'.repeat(32)}` as `0x${string}`)
  try {
    await new AppKit().estimateBridge({
      from: { adapter, chain: from },
      to: { recipientAddress: '0x0000000000000000000000000000000000000001', chain: to, useForwarder: true },
      amount: '1',
      token,
    } as any)
    return ''
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
}

async function checkRoutes() {
  console.log('\n3) Live non-USDC route checks')
  const appKitToken: Record<NonUsdcBridgeToken, string> = {
    EURC: 'EURC',
    WETH: 'wETH',
    cirBTC: 'cirBTC',
  }

  const eligibleChains = Object.keys(CCTPX_ELIGIBLE_CHAINS)

  for (const symbol of Object.keys(NON_USDC_TOKEN_DEPLOYMENTS) as NonUsdcBridgeToken[]) {
    // Every pair the matrix claims, not just the Arc-centric ones.
    const pairs: Array<[string, string]> = []
    for (let i = 0; i < eligibleChains.length; i += 1) {
      for (let j = i + 1; j < eligibleChains.length; j += 1) {
        const [a, b] = [eligibleChains[i], eligibleChains[j]]
        if (getNonUsdcRoutePartners(symbol, a).includes(b)) pairs.push([a, b])
      }
    }

    for (const [a, b] of pairs) {
      for (const [from, to] of [
        [a, b],
        [b, a],
      ]) {
        const message = await estimateWithRetry(appKitToken[symbol], from, to)
        if (message === '') {
          note(`${symbol.padEnd(6)} ${from} -> ${to} ok`)
        } else if (TRANSIENT_ROUTE_CHECK.test(message)) {
          inconclusive.push(`${symbol} ${from} -> ${to}: ${message}`)
          note(`${symbol.padEnd(6)} ${from} -> ${to} INCONCLUSIVE (${message})`)
        } else {
          mismatch(`${symbol} ${from} -> ${to} should route but failed: ${message}`)
        }
        await sleep(1200)
      }
    }
  }

  // Negatives: eligible chains the token is NOT deployed on must be rejected
  // definitively — that is what tells "unsupported" apart from "retry later".
  const negatives: Array<[NonUsdcBridgeToken, string]> = [
    ['EURC', 'Optimism_Sepolia'],
    ['WETH', 'Base_Sepolia'],
    ['cirBTC', 'Base_Sepolia'],
  ]
  for (const [symbol, to] of negatives) {
    const message = await estimateWithRetry(appKitToken[symbol], 'Arc_Testnet', to)
    if (/is not supported for token/.test(message)) {
      note(`${symbol.padEnd(6)} Arc_Testnet -> ${to} correctly rejected`)
    } else if (TRANSIENT_ROUTE_CHECK.test(message)) {
      inconclusive.push(`${symbol} Arc_Testnet -> ${to}: ${message}`)
      note(`${symbol.padEnd(6)} Arc_Testnet -> ${to} INCONCLUSIVE`)
    } else {
      mismatch(
        `${symbol} Arc_Testnet -> ${to} is in the matrix as unsupported but the SDK accepted it (${message || 'resolved'})`
      )
    }
    await sleep(1200)
  }
}

/**
 * USDC reach is a claim about the app's chain list, so it is verified against
 * that list: every chain the Bridge tab offers must resolve live in both
 * directions, and anything the matrix excludes must not be offered.
 */
async function checkUsdcReach() {
  console.log('\n2) USDC reach (standard CCTPv2)')

  const missing = BRIDGE_SELECTABLE_CHAINS.filter((chain) => !USDC_BRIDGE_CHAINS.includes(chain))
  if (missing.length > 0) {
    mismatch(
      `USDC matrix is missing Bridge-tab chains [${missing.join(', ')}] — measure them before shipping`
    )
  }

  for (const [chainKey, reason] of Object.entries(USDC_EXCLUDED_CHAINS)) {
    if (BRIDGE_SELECTABLE_CHAINS.includes(chainKey) || USDC_BRIDGE_CHAINS.includes(chainKey)) {
      mismatch(`${chainKey} is excluded for USDC yet still offered: ${reason}`)
    } else {
      note(`${chainKey.padEnd(22)} excluded — ${reason.slice(0, 80)}…`)
    }
  }

  const adapter = createHeadlessSessionAdapter(`0x${'11'.repeat(32)}` as `0x${string}`)
  for (const chain of USDC_BRIDGE_CHAINS.filter((c) => c !== 'Arc_Testnet')) {
    for (const [from, to] of [
      ['Arc_Testnet', chain],
      [chain, 'Arc_Testnet'],
    ]) {
      const message = await estimateWithRetry('USDC', from, to, adapter)
      if (message === '') {
        note(`USDC   ${from} -> ${to} ok`)
      } else if (TRANSIENT_ROUTE_CHECK.test(message)) {
        inconclusive.push(`USDC ${from} -> ${to}: ${message}`)
        note(`USDC   ${from} -> ${to} INCONCLUSIVE (${message})`)
      } else {
        mismatch(
          `USDC ${from} -> ${to} is in the matrix but the SDK rejected it: ${message} — remove the chain or record why`
        )
      }
      await sleep(300)
    }
  }
}

async function main() {
  console.log(`CCTP route matrix verification against ${REGISTRY_HOST}`)
  await checkRegistry()
  if (ROUTE_CHECKS_ENABLED) {
    await checkUsdcReach()
    console.log('')
    await checkRoutes()
  } else {
    console.log('\n2) Live route checks skipped (--registry-only)')
  }

  console.log('\n=== result ===')
  if (mismatches.length > 0) {
    console.log(`${mismatches.length} mismatch(es):`)
    for (const item of mismatches) console.log(`  - ${item}`)
    if (inconclusive.length > 0) console.log(`${inconclusive.length} check(s) could not be determined`)
    process.exit(1)
  }
  if (inconclusive.length > 0) {
    console.log(`matrix consistent, but ${inconclusive.length} check(s) could not be determined:`)
    for (const item of inconclusive) console.log(`  - ${item}`)
    process.exit(2)
  }
  console.log('matrix is consistent with Circle (registry + live routes)')
}

main().catch((error) => {
  console.error('verification crashed:', error)
  process.exit(2)
})
