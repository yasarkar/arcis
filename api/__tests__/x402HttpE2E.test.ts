// api/__tests__/x402HttpE2E.test.ts
// End-to-end coverage for the x402 API boundary: the production Express server is booted as a
// child process and a signed authorization must fail closed unless a trusted settlement occurs.
//
// It also pins the boot regression this file was created for: the API server loads the same
// config modules as the Vite bundle, where `import.meta.env` does not exist, so a Vite-only
// env read used to crash the server before it could listen.

import { spawn, type ChildProcess } from 'node:child_process'
import { createServer } from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { getAddress, type Hex, type Address } from 'viem'
import { ARC_TESTNET_TOKENS } from '../../src/config/arcChain'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { gatewayIndexerManifest } from '../../src/config/x402/manifests/gatewayIndexer'
import {
  GATEWAY_BATCHED_DOMAIN,
  EIP3009_TRANSFER_WITH_AUTHORIZATION_TYPES,
} from '../../src/config/x402/schemes'
import { usdcToBaseUnits } from '../../src/config/x402/pricing'

const manifest = gatewayIndexerManifest
const providerAddress = getAddress(manifest.provider.address.toLowerCase())

let child: ChildProcess | undefined
let serverLogs = ''
let baseUrl = ''

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer()
    probe.once('error', reject)
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address()
      if (!address || typeof address === 'string') {
        probe.close(() => reject(new Error('Could not reserve a local port')))
        return
      }
      const { port } = address
      probe.close(() => resolve(port))
    })
  })
}

async function waitUntilReady(timeoutMs = 45_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (child?.exitCode !== null && child?.exitCode !== undefined) {
      throw new Error(`server.ts exited with code ${child.exitCode}:\n${serverLogs}`)
    }
    try {
      const res = await fetch(`${baseUrl}/api/health`)
      if (res.ok) return
    } catch {
      // not listening yet
    }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error(`server.ts never became ready:\n${serverLogs}`)
}

beforeAll(async () => {
  const port = await freePort()
  baseUrl = `http://127.0.0.1:${port}`

  // Boot the real server exactly like `npm run start` does, but from a directory without a
  // .env and without inherited VITE_* vars: the API process must not depend on the browser
  // bundle's environment, which is the regression this test exists to catch.
  const viteFreeEnv = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.startsWith('VITE_'))
  )
  const tsxCli = path.join(process.cwd(), 'node_modules', 'tsx', 'dist', 'cli.mjs')
  child = spawn(process.execPath, [tsxCli, path.join(process.cwd(), 'server.ts')], {
    cwd: os.tmpdir(),
    env: {
      ...viteFreeEnv,
      PORT: String(port),
      NODE_ENV: 'test',
      ENABLE_GATEWAY_SETTLE: 'false',
      GATEWAY_FACILITATOR_URL: '',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  child.stdout?.on('data', (chunk) => (serverLogs += String(chunk)))
  child.stderr?.on('data', (chunk) => (serverLogs += String(chunk)))

  await waitUntilReady()
}, 60_000)

afterAll(async () => {
  if (!child || child.exitCode !== null) return
  const exited = new Promise<void>((resolve) => child!.once('exit', () => resolve()))
  child.kill()
  await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 3_000))])
  if (child.exitCode === null && child.pid) child.kill('SIGKILL')
})

describe('production server + x402 over real HTTP', () => {
  it('boots under tsx without the Vite-only env crash and serves the catalog', async () => {
    const health = await fetch(`${baseUrl}/api/health`)
    expect(health.status).toBe(200)

    const catalog = await fetch(`${baseUrl}/api/x402/services`)
    expect(catalog.status).toBe(200)
    const catalogBody = await catalog.json()
    expect(catalogBody.success).toBe(true)
    expect(catalogBody.count).toBeGreaterThanOrEqual(5)

    // The regression this guards: a Vite-only `import.meta.env` read kills the server process.
    expect(serverLogs).not.toMatch(/Cannot read properties of undefined \(reading 'VITE_/)
    expect(serverLogs).toMatch(/Arcis Production Server/)
  })

  it('answers a 402 challenge, then rejects authorization without confirmed settlement', async () => {
    const challengeRes = await fetch(`${baseUrl}/api/x402/${manifest.id}`)
    expect(challengeRes.status).toBe(402)
    expect(challengeRes.headers.get('X-Payment-Recipient')?.toLowerCase()).toBe(
      providerAddress.toLowerCase()
    )
    const challenge = await challengeRes.json()
    expect(challenge.requirements.accepts[0].asset).toBe(ARC_TESTNET_TOKENS.USDC)

    const payer = privateKeyToAccount(generatePrivateKey())
    const nonce: Hex = `0x${Array.from({ length: 64 }, () => Math.floor(Math.random() * 16).toString(16)).join('')}`
    const requiredBaseUnits = usdcToBaseUnits(manifest.pricing.priceUsdc)

    const domain = {
      ...GATEWAY_BATCHED_DOMAIN,
      verifyingContract: getAddress(GATEWAY_BATCHED_DOMAIN.verifyingContract),
    }

    const authorization = {
      from: payer.address,
      to: providerAddress,
      value: BigInt(requiredBaseUnits),
      validAfter: 0n,
      validBefore: BigInt(Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60 + 100),
      nonce,
    }
    const signature = await payer.signTypedData({
      domain,
      types: EIP3009_TRANSFER_WITH_AUTHORIZATION_TYPES,
      primaryType: 'TransferWithAuthorization',
      message: authorization,
    })

    const gatewayOption = challenge.requirements.accepts[0]
    const paymentPayload = Buffer.from(JSON.stringify({
      x402Version: 2,
      payload: { signature, authorization: { ...authorization, value: authorization.value.toString(), validAfter: '0', validBefore: authorization.validBefore.toString() } },
      accepted: gatewayOption,
      resource: { url: manifest.serve.path, description: manifest.description, mimeType: 'application/json' },
    })).toString('base64')
    const paidRes = await fetch(`${baseUrl}/api/x402/${manifest.id}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Payment-Signature': paymentPayload,
      },
      body: JSON.stringify({ payload: { timeWindow: '1h' } }),
    })

    const ledgerRes = await fetch(`${baseUrl}/api/x402/provider/${providerAddress}`)
    const ledgerBefore = (await ledgerRes.json()).ledger
    expect(paidRes.status).toBe(503)
    const paid = await paidRes.json()
    expect(paid.statusCode).toBe(503)
    expect(paid.success).toBe(false)
    expect(paid.costUsdc).toBe(0)
    expect(paid.protocolFeeUsdc).toBe(0)
    expect(paid.providerEarnedUsdc).toBe(0)
    expect(paid.payment.status).toBe('authorized')
    expect(paid.payment.amountUsdc).toBe(0)
    expect(paid.payment.settlementRef).toBeUndefined()
    expect(paid.data).toBeUndefined()
    expect(paid.txHash).toBeUndefined()
    expect(paid.explorerUrl).toBeUndefined()

    const ledgerAfterRes = await fetch(`${baseUrl}/api/x402/provider/${providerAddress}`)
    const ledgerAfter = (await ledgerAfterRes.json()).ledger
    expect(ledgerAfter.availableUsdc).toBe(ledgerBefore.availableUsdc)
    expect(ledgerAfter.services).toEqual(ledgerBefore.services)
  }, 60_000)
})
