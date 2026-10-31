// src/utils/x402Readiness.ts
// Pure evaluation of the four preconditions for a paid x402 call on Arc Testnet.
//
// "unknown" never blocks: the server remains authoritative, and a missing client-side signal must
// not turn into a false claim that a call cannot be made. Only a measured failure blocks.

import { arcTestnet } from '../config/arcChain'

export type ReadinessStatus = 'ready' | 'blocked' | 'unknown'

export interface ReadinessCheck {
  id: 'wallet' | 'network' | 'gateway-balance' | 'settlement'
  label: string
  status: ReadinessStatus
  detail: string
}

export interface X402RuntimeConfig {
  settlementEnabled: boolean
  payoutsReady: boolean
  payoutsConfirmed: boolean
  payoutIssues: { serviceId: string; address: string; reason: string }[]
  storage: { driver: string; shared: boolean }
  reconciliation: { configured: boolean; enabled: boolean; intervalMinutes: number }
  chainId: number
}

export interface X402ReadinessInput {
  walletAddress?: string
  authSource?: 'passkey' | 'ucw' | 'evm' | null
  /** True when the active Circle Wallet can run its typed-data challenge. */
  ucwSignerAvailable?: boolean
  chainId?: number
  gatewayBalanceUsdc?: number | null
  gatewayBalanceLoading?: boolean
  priceUsdc: number
  serviceId?: string
  config?: X402RuntimeConfig | null
  configLoading?: boolean
  configError?: boolean
}

export interface X402ReadinessResult {
  ready: boolean
  checks: ReadinessCheck[]
}

export function evaluateX402Readiness(input: X402ReadinessInput): X402ReadinessResult {
  const checks: ReadinessCheck[] = []

  // 1. Payer type — Circle's batched EIP-3009 authorization needs an EOA key holder. Both an
  // injected EOA and a Circle Wallet created as an EOA produce an ecrecover-verifiable
  // signature; a passkey/MSCA smart account does not (ERC-1271 is not accepted here).
  if (!input.walletAddress) {
    checks.push({
      id: 'wallet',
      label: 'Payer wallet',
      status: 'blocked',
      detail: 'Connect an external EOA or a Circle Wallet to sign the payment authorization.',
    })
  } else if (input.authSource === 'ucw' && input.ucwSignerAvailable) {
    checks.push({
      id: 'wallet',
      label: 'Payer wallet',
      status: 'ready',
      detail: `Circle Wallet EOA ${input.walletAddress.slice(0, 6)}…${input.walletAddress.slice(-4)} (PIN/biometric signature)`,
    })
  } else if (input.authSource !== 'evm') {
    checks.push({
      id: 'wallet',
      label: 'Payer wallet',
      status: 'blocked',
      detail: input.authSource === 'ucw'
        ? 'The Circle Wallet session cannot sign a payment challenge yet. Sign in again with your Circle Wallet (PIN or biometrics).'
        : 'This wallet type cannot sign x402 batch payments. Select an external EOA or Circle Wallet.',
    })
  } else {
    checks.push({
      id: 'wallet',
      label: 'Payer wallet',
      status: 'ready',
      detail: `External EOA ${input.walletAddress.slice(0, 6)}…${input.walletAddress.slice(-4)}`,
    })
  }

  // 2. Network — the challenge, the token and the Gateway domain are all Arc Testnet.
  if (input.authSource === 'ucw') {
    // No EIP-1193 chain to read: the Circle challenge route pins the ARC-TESTNET wallet,
    // and a signature from another chain's domain fails ecrecover on the server.
    checks.push({
      id: 'network',
      label: 'Settlement network',
      status: 'ready',
      detail: `${arcTestnet.name} (chain ${arcTestnet.id}) — selected by the Circle challenge`,
    })
  } else if (input.chainId === undefined) {
    checks.push({
      id: 'network',
      label: 'Settlement network',
      status: 'unknown',
      detail: `Wallet network was not reported. The call requires ${arcTestnet.name}.`,
    })
  } else if (input.chainId !== arcTestnet.id) {
    checks.push({
      id: 'network',
      label: 'Settlement network',
      status: 'blocked',
      detail: `Switch the wallet to ${arcTestnet.name} (chain ${arcTestnet.id}).`,
    })
  } else {
    checks.push({
      id: 'network',
      label: 'Settlement network',
      status: 'ready',
      detail: `${arcTestnet.name} (chain ${arcTestnet.id})`,
    })
  }

  // 3. Gateway balance — the payer must already hold enough USDC in Gateway on Arc Testnet.
  const price = Math.max(0, input.priceUsdc)
  if (input.gatewayBalanceLoading) {
    checks.push({
      id: 'gateway-balance',
      label: 'Gateway balance',
      status: 'unknown',
      detail: 'Checking the Arc Testnet Gateway balance…',
    })
  } else if (input.gatewayBalanceUsdc === null || input.gatewayBalanceUsdc === undefined) {
    checks.push({
      id: 'gateway-balance',
      label: 'Gateway balance',
      status: 'unknown',
      detail: 'Gateway balance could not be read; the payment may still be rejected by Circle.',
    })
  } else if (input.gatewayBalanceUsdc + 1e-9 < price) {
    checks.push({
      id: 'gateway-balance',
      label: 'Gateway balance',
      status: 'blocked',
      detail: `Deposit at least ${price} USDC into Circle Gateway on ${arcTestnet.name}; current balance is ${input.gatewayBalanceUsdc.toFixed(4)} USDC.`,
    })
  } else {
    checks.push({
      id: 'gateway-balance',
      label: 'Gateway balance',
      status: 'ready',
      detail: `${input.gatewayBalanceUsdc.toFixed(4)} USDC available for a ${price} USDC call.`,
    })
  }

  // 4. Server settlement configuration — a challenge is only useful when it can settle.
  if (input.configLoading || (!input.config && !input.configError)) {
    checks.push({
      id: 'settlement',
      label: 'Paid settlement',
      status: 'unknown',
      detail: 'Checking whether paid settlement is enabled on this deployment…',
    })
  } else if (!input.config) {
    checks.push({
      id: 'settlement',
      label: 'Paid settlement',
      status: 'unknown',
      detail: 'Settlement configuration could not be read; the server will reject the call if it is disabled.',
    })
  } else if (!input.config.settlementEnabled) {
    checks.push({
      id: 'settlement',
      label: 'Paid settlement',
      status: 'blocked',
      detail: 'Paid calls are disabled on this deployment. No charge can be made.',
    })
  } else if (!input.config.payoutsConfirmed) {
    checks.push({
      id: 'settlement',
      label: 'Paid settlement',
      status: 'blocked',
      detail: 'Provider payout addresses are not confirmed by the operator yet, so settlement is paused.',
    })
  } else if (input.serviceId && input.config.payoutIssues.some((issue) => issue.serviceId === input.serviceId)) {
    // Only this service is paused: the server applies the same per-manifest payout check.
    const issue = input.config.payoutIssues.find((entry) => entry.serviceId === input.serviceId)
    checks.push({
      id: 'settlement',
      label: 'Paid settlement',
      status: 'blocked',
      detail: `This service's payout address cannot receive funds (${issue?.reason || 'unusable payout address'}).`,
    })
  } else {
    checks.push({
      id: 'settlement',
      label: 'Paid settlement',
      status: 'ready',
      detail: `Circle Gateway testnet with ${input.config.storage.shared ? input.config.storage.driver : 'process-local'} storage.`,
    })
  }

  return { ready: checks.every((check) => check.status !== 'blocked'), checks }
}
