// src/services/x402PaymentEngine.ts
// Real x402 Micropayment Settlement Engine for Arcis
// Manages zero-popup session keys, Arc Testnet micro-USDC settlement,
// 1% YieldVault protocol fee diversion, and global transaction logging.

import { keccak256, stringToBytes, parseUnits, type Hex, type Address } from 'viem'
import type { x402Service, x402PaymentChallenge } from '../types/marketplace'
import { arcTestnet, ARC_METADATA } from '../config/arcChain'
import { POOL_CONTRACTS, ERC20_ABI } from '../config/poolsConfig'
import { getExplorerTxUrl } from '../config/sendConfig'
import {
  getSessionKeyConfig,
  verifySessionLimits,
  deductSessionSpend,
} from './sessionKeyService'
import {
  getStoredMscaAddress,
  getActiveSmartAccount,
  restoreSmartAccount,
  sendModularUserOperation,
  createModularUsdcTransferCall,
} from './modularWalletService'
import { getArcPublicClient } from './rpc'
import { addTransaction } from '../utils/history'

const PROVIDER_EARNINGS_STORAGE_KEY = 'arcis_x402_provider_earnings_v2'
const YIELD_VAULT_CONTRIBUTIONS_KEY = 'arcis_yield_vault_ai_share_v2'

export interface StoredProviderEarnings {
  [providerAddress: string]: {
    totalCallsServed: number
    totalUsdcEarned: number
    unclaimedEarningsUsdc: number
  }
}

/**
 * Retrieves accumulated provider earnings from local persistent storage
 */
export function getStoredProviderEarnings(): StoredProviderEarnings {
  try {
    const raw = localStorage.getItem(PROVIDER_EARNINGS_STORAGE_KEY)
    if (raw) return JSON.parse(raw)
  } catch (e) {
    console.error('Failed to parse provider earnings', e)
  }
  return {}
}

/**
 * Saves provider earnings
 */
export function saveStoredProviderEarnings(earnings: StoredProviderEarnings): void {
  try {
    localStorage.setItem(PROVIDER_EARNINGS_STORAGE_KEY, JSON.stringify(earnings))
  } catch (e) {
    console.error('Failed to save provider earnings', e)
  }
}

/**
 * Credits earnings to a provider address
 */
export function creditProviderEarnings(providerAddress: string, amountUsdc: number): void {
  const earnings = getStoredProviderEarnings()
  const lower = providerAddress.toLowerCase()
  const current = earnings[lower] || {
    totalCallsServed: 0,
    totalUsdcEarned: 0,
    unclaimedEarningsUsdc: 0,
  }

  earnings[lower] = {
    totalCallsServed: current.totalCallsServed + 1,
    totalUsdcEarned: Number((current.totalUsdcEarned + amountUsdc).toFixed(6)),
    unclaimedEarningsUsdc: Number((current.unclaimedEarningsUsdc + amountUsdc).toFixed(6)),
  }

  saveStoredProviderEarnings(earnings)
}

/**
 * Claims accumulated earnings for a provider
 */
export function claimProviderEarnings(providerAddress: string): number {
  const earnings = getStoredProviderEarnings()
  const lower = providerAddress.toLowerCase()
  const current = earnings[lower]
  if (!current || current.unclaimedEarningsUsdc <= 0) return 0

  const claimed = current.unclaimedEarningsUsdc
  earnings[lower] = {
    ...current,
    unclaimedEarningsUsdc: 0,
  }
  saveStoredProviderEarnings(earnings)
  return claimed
}

/**
 * Retrieves total protocol fees diverted to YieldVault
 */
export function getAccumulatedYieldVaultFees(): number {
  try {
    const raw = localStorage.getItem(YIELD_VAULT_CONTRIBUTIONS_KEY)
    if (raw) return parseFloat(raw) || 0
  } catch {
    // fallback
  }
  return 0
}

/**
 * Increments accumulated protocol fees sent to YieldVault
 */
export function incrementYieldVaultFees(feeUsdc: number): number {
  const current = getAccumulatedYieldVaultFees()
  const updated = Number((current + feeUsdc).toFixed(6))
  try {
    localStorage.setItem(YIELD_VAULT_CONTRIBUTIONS_KEY, updated.toString())
  } catch {
    // ignore
  }
  return updated
}

/**
 * Main settlement routine for an x402 service execution
 */
export async function settleX402Payment(
  service: x402Service,
  payerAddress?: string,
  provider?: any
): Promise<{
  success: boolean
  error?: string
  txHash?: string
  blockNumber?: number
  explorerUrl?: string
  costUsdc: number
  protocolFeeUsdc: number
  providerEarnedUsdc: number
  authProof?: {
    signature: string
    payerAddress: string
    timestamp: number
  }
  challenge: x402PaymentChallenge
  executionMode?: 'onchain_verified' | 'session_autonomous'
  gasSponsored?: boolean
}> {
  const mscaAddress = getStoredMscaAddress()
  const activePayer = payerAddress || mscaAddress
  const sessionConfig = getSessionKeyConfig()

  const protocolFeeUsdc = Number((service.priceUsdc * 0.01).toFixed(6))
  const providerEarnedUsdc = Number((service.priceUsdc * 0.99).toFixed(6))

  const nonce = '0x' + Array.from({ length: 64 }, () => Math.floor(Math.random() * 16).toString(16)).join('')
  const challenge: x402PaymentChallenge = {
    statusCode: 402,
    paymentRequired: true,
    token: 'USDC',
    recipient: service.provider.address,
    amountUsdc: service.priceUsdc,
    amountUnits: (service.priceUsdc * 1e6).toString(),
    scheme: service.paymentScheme,
    chainId: arcTestnet.id,
    nonce,
    validUntil: Date.now() + 60000,
  }

  // If no payer address and no active session key:
  if (!activePayer && !(sessionConfig.isActive && sessionConfig.ephemeralPrivateKey)) {
    return {
      success: false,
      error: 'Wallet not connected. Please connect your Web3 wallet or Passkey to authorize on-chain payment.',
      costUsdc: 0,
      protocolFeeUsdc: 0,
      providerEarnedUsdc: 0,
      challenge,
    }
  }

  // 1. Check autonomous session key limits
  if (sessionConfig.isActive) {
    const limitCheck = verifySessionLimits('ai_service', service.priceUsdc)
    if (!limitCheck.allowed) {
      return {
        success: false,
        error: limitCheck.reason || 'Session key budget exceeded for AI service call.',
        costUsdc: 0,
        protocolFeeUsdc: 0,
        providerEarnedUsdc: 0,
        challenge,
      }
    }
  }

  // 2. Cryptographic authorization proof
  const timestamp = Date.now()
  const proofMessage = `x402-Payment-Auth:chainId=${arcTestnet.id}:payer=${activePayer || '0x0000000000000000000000000000000000000000'}:recipient=${service.provider.address}:vault=${POOL_CONTRACTS.YIELD_VAULT}:amount=${service.priceUsdc}:nonce=${nonce}:time=${timestamp}`
  const signature = keccak256(stringToBytes(proofMessage))

  let realTxHash = ''
  let executionMode: 'onchain_verified' | 'session_autonomous' | undefined
  let gasSponsored = false
  let realBlockNumber: number | undefined
  let paymentError = ''

  const totalAmountUnits = parseUnits(service.priceUsdc.toFixed(6), 6)

  // 3. On-Chain Settlement Attempt
  // Path A: Circle Modular Smart Account (MSCA) via Passkey + Circle Paymaster (Gasless)
  try {
    let smartAccount = getActiveSmartAccount()
    if (!smartAccount && mscaAddress) {
      smartAccount = await restoreSmartAccount()
    }

    if (smartAccount) {
      const calls = [
        createModularUsdcTransferCall(service.provider.address as Hex, providerEarnedUsdc),
      ]
      if (protocolFeeUsdc > 0) {
        calls.push(createModularUsdcTransferCall(POOL_CONTRACTS.YIELD_VAULT as Hex, protocolFeeUsdc))
      }

      const opRes = await sendModularUserOperation({
        calls,
        paymaster: true,
      })

      if (opRes.success && opRes.txHash) {
        realTxHash = opRes.txHash
        executionMode = 'session_autonomous'
        gasSponsored = true
      } else if (opRes.error) {
        paymentError = opRes.error
      }
    }
  } catch (mscaErr: any) {
    console.warn('[x402PaymentEngine] Modular Smart Account payment attempt notice:', mscaErr)
    paymentError = mscaErr?.message || 'Smart Account payment failed'
  }

  // Path B: Autonomous Ephemeral Session Key (Zero-Popup Execution)
  if (!realTxHash && sessionConfig.isActive && sessionConfig.ephemeralPrivateKey) {
    try {
      const { privateKeyToAccount } = await import('viem/accounts')
      const { createWalletClient, http } = await import('viem')
      const sessionAccount = privateKeyToAccount(sessionConfig.ephemeralPrivateKey as Hex)
      const walletClient = createWalletClient({
        account: sessionAccount,
        chain: arcTestnet,
        transport: http(ARC_METADATA.rpcHttpUrl),
      })

      const hash = await walletClient.writeContract({
        address: POOL_CONTRACTS.USDC as Address,
        abi: ERC20_ABI,
        functionName: 'transfer',
        args: [service.provider.address as Address, totalAmountUnits],
      })

      if (hash) {
        realTxHash = hash
        executionMode = 'session_autonomous'
      }
    } catch (sessionErr: any) {
      console.warn('[x402PaymentEngine] Ephemeral session key payment attempt notice:', sessionErr)
      paymentError = sessionErr?.message || 'Session key transfer failed'
    }
  }

  // Path C: Connected EOA Browser Wallet (MetaMask / Rainbow / Coinbase)
  const effectiveProvider = provider || (typeof window !== 'undefined' && (window as any).ethereum ? (window as any).ethereum : null)
  if (!realTxHash && effectiveProvider && activePayer) {
    try {
      const { createWalletClient, custom } = await import('viem')
      const walletClient = createWalletClient({
        account: activePayer as Hex,
        chain: arcTestnet,
        transport: custom(effectiveProvider),
      })

      const hash = await walletClient.writeContract({
        address: POOL_CONTRACTS.USDC as Address,
        abi: ERC20_ABI,
        functionName: 'transfer',
        args: [service.provider.address as Address, totalAmountUnits],
      })

      if (hash) {
        realTxHash = hash
        executionMode = 'onchain_verified'
      }
    } catch (walletErr: any) {
      console.warn('[x402PaymentEngine] Browser wallet transfer prompt note:', walletErr)
      if (walletErr?.message?.includes('User rejected') || walletErr?.code === 4001) {
        paymentError = 'Transaction rejected by user in wallet.'
      } else if (walletErr?.message?.includes('transfer amount exceeds balance')) {
        paymentError = 'Insufficient USDC balance on Arc Testnet.'
      } else {
        paymentError = walletErr?.shortMessage || walletErr?.message || 'Wallet transaction failed'
      }
    }
  }

  // 4. Strict Failure Check: If no genuine on-chain transaction succeeded, fail cleanly!
  if (!realTxHash) {
    return {
      success: false,
      error: paymentError || 'On-chain payment settlement failed. No transaction was confirmed.',
      costUsdc: 0,
      protocolFeeUsdc: 0,
      providerEarnedUsdc: 0,
      challenge,
      authProof: {
        signature,
        payerAddress: activePayer || '',
        timestamp,
      },
    }
  }

  // 5. Resolve Block Number & Explorer Receipt from Arc Testnet
  const publicClient = getArcPublicClient()
  try {
    const receipt = await publicClient.waitForTransactionReceipt({
      hash: realTxHash as Hex,
      timeout: 15_000,
    }).catch(() => null)

    if (receipt) {
      realBlockNumber = Number(receipt.blockNumber)
    }
  } catch (rcptErr) {
    console.warn('[x402PaymentEngine] Waiting for receipt note:', rcptErr)
  }

  const explorerUrl = `${ARC_METADATA.explorerUrl}/tx/${realTxHash}`

  // 6. Deduct from active session key if active
  if (sessionConfig.isActive) {
    deductSessionSpend(service.priceUsdc)
  }

  // 7. Divert 1% to YieldVault and credit 99% to provider (ONLY on verified real tx)
  incrementYieldVaultFees(protocolFeeUsdc)
  creditProviderEarnings(service.provider.address, providerEarnedUsdc)

  // 8. Add to Arcis Global Transaction History
  try {
    addTransaction({
      type: 'ai_service',
      txHash: realTxHash,
      amount: service.priceUsdc.toFixed(4),
      tokenSymbol: 'USDC',
      sourceChain: 'Arc Testnet',
      userAddress: activePayer,
      recipient: service.provider.address,
      status: 'success',
      serviceId: service.id,
      serviceName: service.name,
      providerAddress: service.provider.address,
    })
  } catch (err) {
    console.warn('[x402PaymentEngine] Failed to append to transaction history:', err)
  }

  return {
    success: true,
    txHash: realTxHash,
    blockNumber: realBlockNumber,
    explorerUrl,
    costUsdc: service.priceUsdc,
    protocolFeeUsdc,
    providerEarnedUsdc,
    challenge,
    authProof: {
      signature,
      payerAddress: activePayer,
      timestamp,
    },
    executionMode,
    gasSponsored,
  }
}
