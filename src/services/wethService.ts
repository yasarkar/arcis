// src/services/wethService.ts
// Service for wrapping Native ETH into WETH (and unwrapping WETH to ETH)
// Enables seamless cross-chain bridging of native ETH from EVM testnets (Sepolia, Base, etc.)
// into Arc Testnet WETH (ERC-20).

import { parseEther, encodeFunctionData, type Hex } from 'viem'
import { WETH_ADDRESSES } from '../config/gatewayConfig'
import { TESTNET_NETWORKS, MAINNET_NETWORKS } from '../config/networks/networkRegistry'
import { getResilientPublicClient } from './rpc'

export const WETH_ABI = [
  {
    type: 'function',
    name: 'deposit',
    stateMutability: 'payable',
    inputs: [],
    outputs: [],
  },
  {
    type: 'function',
    name: 'withdraw',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'wad', type: 'uint256' }],
    outputs: [],
  },
] as const

/**
 * Resolves the canonical WETH9 contract address for a given chain key.
 */
export function getWethAddress(chainKey: string): `0x${string}` | null {
  if (!chainKey) return null
  if (WETH_ADDRESSES[chainKey]) return WETH_ADDRESSES[chainKey]

  const net = TESTNET_NETWORKS[chainKey] || MAINNET_NETWORKS[chainKey]
  const tokenAddr = net?.tokens?.WETH
  if (tokenAddr && tokenAddr.startsWith('0x')) {
    return tokenAddr as `0x${string}`
  }
  return null
}

/**
 * Checks whether the source chain supports native ETH auto-wrapping to WETH.
 * Arc Testnet uses USDC as native gas and has no native ETH, so auto-wrap only
 * applies when bridging FROM an external EVM chain with native ETH (e.g. Sepolia, Base Sepolia).
 */
export function canAutoWrapEth(chainKey: string): boolean {
  if (!chainKey) return false
  if (chainKey === 'Arc_Testnet' || chainKey === 'Arc') return false

  const net = TESTNET_NETWORKS[chainKey] || MAINNET_NETWORKS[chainKey]
  const isNativeEth = net?.nativeCurrency?.symbol === 'ETH'
  const hasWeth = Boolean(getWethAddress(chainKey))

  return Boolean(isNativeEth && hasWeth)
}

export const LEGACY_SEPOLIA_WETH = '0x7b79995e5f793A07Bc00c21412e50Ecae098E7f9' as const

export interface WrapEthParams {
  provider: any
  chainKey: string
  amount: string
  fromAddress?: string
  wethAddress?: `0x${string}`
}

export interface WrapEthResult {
  txHash: string
  wethAddress: `0x${string}`
  amount: string
}

/**
 * Wraps native ETH into WETH on the specified source chain by calling WETH.deposit{value: amount}().
 * Awaits receipt confirmation so that WETH balance is ready for subsequent CCTP approval/burn.
 */
export async function wrapEth(params: WrapEthParams): Promise<WrapEthResult> {
  const { provider, chainKey, amount, fromAddress } = params

  if (!provider || typeof provider.request !== 'function') {
    throw new Error('No wallet provider available for ETH wrapping.')
  }

  const wethAddress = params.wethAddress || getWethAddress(chainKey)
  if (!wethAddress) {
    throw new Error(`WETH contract is not configured on network: ${chainKey}`)
  }

  const parsedAmount = parseFloat(amount)
  if (isNaN(parsedAmount) || parsedAmount <= 0) {
    throw new Error('Wrap amount must be greater than zero.')
  }

  const valueWei = parseEther(amount)

  // Resolve sender account address
  let account = fromAddress
  if (!account) {
    try {
      const accounts = await provider.request({ method: 'eth_accounts' })
      account = accounts?.[0]
    } catch {
      // ignore
    }
  }
  if (!account) {
    const requested = await provider.request({ method: 'eth_requestAccounts' })
    account = requested?.[0]
  }
  if (!account) {
    throw new Error('No active wallet account found to sign ETH wrapping.')
  }

  const calldata = encodeFunctionData({
    abi: WETH_ABI,
    functionName: 'deposit',
  })

  // Submit deposit transaction via wallet provider
  const txHash: string = await provider.request({
    method: 'eth_sendTransaction',
    params: [
      {
        from: account,
        to: wethAddress,
        value: `0x${valueWei.toString(16)}`,
        data: calldata,
      },
    ],
  })

  if (!txHash || !txHash.startsWith('0x')) {
    throw new Error('ETH wrap transaction did not return a valid hash.')
  }

  // Wait for on-chain inclusion
  try {
    const publicClient = getResilientPublicClient(chainKey)
    if (publicClient?.waitForTransactionReceipt) {
      await publicClient.waitForTransactionReceipt({
        hash: txHash as Hex,
      })
    }
  } catch (receiptErr) {
    console.warn('[wethService] Non-blocking receipt poll notice:', receiptErr)
  }

  return {
    txHash,
    wethAddress,
    amount,
  }
}

/**
 * Unwraps WETH into native ETH on the specified chain by calling WETH.withdraw(wad).
 */
export async function unwrapWeth(params: WrapEthParams): Promise<{ txHash: string }> {
  const { provider, chainKey, amount, fromAddress } = params

  if (!provider || typeof provider.request !== 'function') {
    throw new Error('No wallet provider available for WETH unwrapping.')
  }

  const wethAddress = params.wethAddress || getWethAddress(chainKey)
  if (!wethAddress) {
    throw new Error(`WETH contract is not configured on network: ${chainKey}`)
  }

  const parsedAmount = parseFloat(amount)
  if (isNaN(parsedAmount) || parsedAmount <= 0) {
    throw new Error('Unwrap amount must be greater than zero.')
  }

  const valueWei = parseEther(amount)

  let account = fromAddress
  if (!account) {
    const accounts = await provider.request({ method: 'eth_accounts' })
    account = accounts?.[0]
  }
  if (!account) {
    const requested = await provider.request({ method: 'eth_requestAccounts' })
    account = requested?.[0]
  }
  if (!account) {
    throw new Error('No active wallet account found to sign WETH unwrapping.')
  }

  const calldata = encodeFunctionData({
    abi: WETH_ABI,
    functionName: 'withdraw',
    args: [valueWei],
  })

  const txHash: string = await provider.request({
    method: 'eth_sendTransaction',
    params: [
      {
        from: account,
        to: wethAddress,
        data: calldata,
      },
    ],
  })

  try {
    const publicClient = getResilientPublicClient(chainKey)
    if (publicClient?.waitForTransactionReceipt) {
      await publicClient.waitForTransactionReceipt({
        hash: txHash as Hex,
      })
    }
  } catch (receiptErr) {
    console.warn('[wethService] Non-blocking receipt poll notice:', receiptErr)
  }

  return { txHash }
}
