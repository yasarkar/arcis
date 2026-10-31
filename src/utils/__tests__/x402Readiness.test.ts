import { describe, expect, it } from 'vitest'
import { evaluateX402Readiness, type X402ReadinessInput, type X402RuntimeConfig } from '../x402Readiness'

const READY_CONFIG: X402RuntimeConfig = {
  settlementEnabled: true,
  payoutsReady: true,
  payoutsConfirmed: true,
  payoutIssues: [],
  storage: { driver: 'upstash-rest', shared: true },
  reconciliation: { configured: true, enabled: true, intervalMinutes: 5 },
  chainId: 5042002,
}

function input(overrides: Partial<X402ReadinessInput> = {}): X402ReadinessInput {
  return {
    walletAddress: '0x1111111111111111111111111111111111111111',
    authSource: 'evm',
    chainId: 5042002,
    gatewayBalanceUsdc: 1,
    gatewayBalanceLoading: false,
    priceUsdc: 0.005,
    config: READY_CONFIG,
    configLoading: false,
    configError: false,
    ...overrides,
  }
}

describe('evaluateX402Readiness', () => {
  it('reports every precondition as ready for a funded EOA on Arc Testnet', () => {
    const result = evaluateX402Readiness(input())
    expect(result.ready).toBe(true)
    expect(result.checks.map((check) => check.status)).toEqual(['ready', 'ready', 'ready', 'ready'])
  })

  it('blocks a missing payer wallet', () => {
    const result = evaluateX402Readiness(input({ walletAddress: undefined }))
    expect(result.ready).toBe(false)
    expect(result.checks.find((check) => check.id === 'wallet')?.status).toBe('blocked')
  })

  it('blocks passkey signers that cannot produce an EIP-3009 signature', () => {
    const result = evaluateX402Readiness(input({ authSource: 'passkey' }))
    expect(result.ready).toBe(false)
    expect(result.checks.find((check) => check.id === 'wallet')?.detail).toMatch(/external EOA or Circle Wallet/i)
  })

  it('accepts a Circle Wallet EOA once its typed-data challenge can be signed', () => {
    const result = evaluateX402Readiness(input({ authSource: 'ucw', ucwSignerAvailable: true }))
    expect(result.ready).toBe(true)
    expect(result.checks.find((check) => check.id === 'wallet')?.detail).toMatch(/Circle Wallet EOA/i)
    // No EIP-1193 chain is readable: the Circle challenge pins the ARC-TESTNET wallet.
    expect(result.checks.find((check) => check.id === 'network')?.status).toBe('ready')
  })

  it('blocks a Circle Wallet session that cannot sign its challenge', () => {
    const result = evaluateX402Readiness(input({ authSource: 'ucw', ucwSignerAvailable: false }))
    expect(result.ready).toBe(false)
    expect(result.checks.find((check) => check.id === 'wallet')?.detail).toMatch(/sign in again/i)
  })

  it('blocks a wallet on the wrong network and offers the Arc requirement', () => {
    const result = evaluateX402Readiness(input({ chainId: 84532 }))
    expect(result.ready).toBe(false)
    const network = result.checks.find((check) => check.id === 'network')
    expect(network?.status).toBe('blocked')
    expect(network?.detail).toContain('5042002')
  })

  it('blocks an underfunded Gateway balance and states the shortfall', () => {
    const result = evaluateX402Readiness(input({ gatewayBalanceUsdc: 0 }))
    expect(result.ready).toBe(false)
    const balance = result.checks.find((check) => check.id === 'gateway-balance')
    expect(balance?.status).toBe('blocked')
    expect(balance?.detail).toContain('0.005 USDC')
  })

  it('allows the exact call price without a rounding false negative', () => {
    const result = evaluateX402Readiness(input({ gatewayBalanceUsdc: 0.005, priceUsdc: 0.005 }))
    expect(result.ready).toBe(true)
  })

  it('blocks when paid settlement is disabled on the deployment', () => {
    const result = evaluateX402Readiness(input({ config: { ...READY_CONFIG, settlementEnabled: false } }))
    expect(result.ready).toBe(false)
    expect(result.checks.find((check) => check.id === 'settlement')?.detail).toMatch(/disabled/i)
  })

  it('blocks when provider payout addresses are not confirmed', () => {
    const result = evaluateX402Readiness(
      input({ config: { ...READY_CONFIG, payoutsReady: false, payoutsConfirmed: false } })
    )
    expect(result.ready).toBe(false)
    expect(result.checks.find((check) => check.id === 'settlement')?.detail).toMatch(/not confirmed/i)
  })

  it('blocks only the service whose payout address is unusable', () => {
    const config: X402RuntimeConfig = {
      ...READY_CONFIG,
      payoutsReady: false,
      payoutIssues: [{ serviceId: 'broken-service', address: '0x2222222222222222222222222222222222222222', reason: 'USDC token contract' }],
    }
    const broken = evaluateX402Readiness(input({ config, serviceId: 'broken-service' }))
    expect(broken.ready).toBe(false)
    expect(broken.checks.find((check) => check.id === 'settlement')?.detail).toMatch(/token contract/i)

    const healthy = evaluateX402Readiness(input({ config, serviceId: 'healthy-service' }))
    expect(healthy.ready).toBe(true)
    expect(healthy.checks.find((check) => check.id === 'settlement')?.status).toBe('ready')
  })

  it('treats an unreadable balance or config as unknown instead of blocking', () => {
    const result = evaluateX402Readiness(
      input({ gatewayBalanceUsdc: null, gatewayBalanceLoading: false, config: null, configError: true })
    )
    expect(result.ready).toBe(true)
    expect(result.checks.find((check) => check.id === 'gateway-balance')?.status).toBe('unknown')
    expect(result.checks.find((check) => check.id === 'settlement')?.status).toBe('unknown')
  })

  it('treats an unreported chain as unknown rather than a wrong network', () => {
    const result = evaluateX402Readiness(input({ chainId: undefined }))
    expect(result.ready).toBe(true)
    expect(result.checks.find((check) => check.id === 'network')?.status).toBe('unknown')
  })
})
