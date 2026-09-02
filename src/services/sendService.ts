import { AppKit, Blockchain } from '@circle-fin/app-kit'
import { createViemAdapterFromProvider, createViemAdapterFromPrivateKey } from '@circle-fin/adapter-viem-v2'
import { createPublicClient, createWalletClient, http } from 'viem'
import type { SendParams } from '@circle-fin/app-kit'
import { ArcTestnet, BaseSepolia } from '@circle-fin/app-kit/chains'
import { arcTestnet, ARC_METADATA } from '../config/arcChain'
import { CHAIN_DEFS } from '../config/chainMeta'

// Single instance of AppKit to be used for Send operations
const kit = new AppKit()

/**
 * Patch helper to safely handle chain switching in ViemAdapter when running in the browser.
 * Prevents throwing "wallet_switchEthereumChain does not exist / is not available"
 * when using node JSON-RPC transports (such as private key / headless session keys) or custom providers.
 */
export function patchViemAdapterChainSwitch(adapter: any): any {
  if (!adapter) return adapter

  const originalSwitchToChain = adapter.switchToChain?.bind(adapter)

  adapter.switchToChain = async function (chain: any) {
    try {
      // 1. Initialize the wallet client for the chain if available
      if (typeof this.initializeWalletClient === 'function') {
        await this.initializeWalletClient(chain)
      }

      // 2. If an original switchToChain exists, attempt it, but safely catch RPC method not supported
      if (originalSwitchToChain) {
        try {
          await originalSwitchToChain(chain)
        } catch (switchErr: any) {
          const msg = switchErr?.message || String(switchErr || '')
          if (
            msg.includes('wallet_switchEthereumChain') ||
            msg.includes('method not supported') ||
            msg.includes('does not exist / is not available') ||
            msg.includes('Method not found') ||
            msg.includes('MethodNotSupportedRpcError')
          ) {
            console.warn('[ViemAdapter] Bypassed unsupported wallet_switchEthereumChain on RPC node')
            return
          }
          throw switchErr
        }
      }
    } catch (err: any) {
      const msg = err?.message || String(err || '')
      if (
        msg.includes('wallet_switchEthereumChain') ||
        msg.includes('method not supported') ||
        msg.includes('does not exist / is not available') ||
        msg.includes('Method not found') ||
        msg.includes('MethodNotSupportedRpcError')
      ) {
        console.warn('[ViemAdapter] Safely bypassed chain switch RPC error')
        return
      }
      throw err
    }
  }

  const originalEnsureChain = adapter.ensureChain?.bind(adapter)
  adapter.ensureChain = async function (targetChain: any) {
    try {
      if (typeof this.validateChainSupport === 'function') {
        this.validateChainSupport(targetChain)
      }
      await this.switchToChain(targetChain)
    } catch (err: any) {
      const msg = err?.message || String(err || '')
      if (
        msg.includes('wallet_switchEthereumChain') ||
        msg.includes('method not supported') ||
        msg.includes('does not exist / is not available') ||
        msg.includes('Method not found') ||
        msg.includes('MethodNotSupportedRpcError')
      ) {
        console.warn('[ViemAdapter] Safely bypassed ensureChain RPC error')
        return
      }
      throw err
    }
  }

  return adapter
}

/**
 * Creates a headless Viem adapter from a raw private key,
 * with custom RPC endpoints for Arc Testnet and Base Sepolia,
 * enabling zero-popup, headless on-chain execution for Session Keys (ERC-6900).
 */
export function createHeadlessSessionAdapter(privateKey: string): any {
  if (!privateKey) {
    throw new Error('No session private key provided.')
  }

  const adapter = createViemAdapterFromPrivateKey({
    privateKey: privateKey as `0x${string}`,
    getPublicClient: ({ chain }) => {
      // Use custom RPC for Arc Testnet to avoid SDK built-in RPC failures
      if (chain.id === arcTestnet.id || chain.name === arcTestnet.name) {
        return createPublicClient({
          chain: ArcTestnet as any,
          transport: http(ARC_METADATA.rpcHttpUrl, {
            retryCount: 3,
            timeout: 15000,
          }),
        }) as any
      }
      if (chain.id === CHAIN_DEFS.Base_Sepolia.id || chain.name === CHAIN_DEFS.Base_Sepolia.name) {
        return createPublicClient({
          chain: BaseSepolia as any,
          transport: http(CHAIN_DEFS.Base_Sepolia.rpcUrls.default.http[0], {
            retryCount: 3,
            timeout: 15000,
          }),
        }) as any
      }
      return createPublicClient({
        chain,
        transport: http(),
      }) as any
    },
    getWalletClient: ({ chain, account }) => {
      const isArc = chain.id === arcTestnet.id || chain.name === arcTestnet.name
      const isBase = chain.id === CHAIN_DEFS.Base_Sepolia.id || chain.name === CHAIN_DEFS.Base_Sepolia.name
      const targetChain = isArc ? (ArcTestnet as any) : isBase ? (BaseSepolia as any) : chain
      const rpcUrl = isArc
        ? ARC_METADATA.rpcHttpUrl
        : isBase
        ? CHAIN_DEFS.Base_Sepolia.rpcUrls.default.http[0]
        : undefined

      return createWalletClient({
        account,
        chain: targetChain,
        transport: rpcUrl ? http(rpcUrl, { retryCount: 3, timeout: 15000 }) : http(),
      }) as any
    },
  })

  return patchViemAdapterChainSwitch(adapter)
}

/**
 * Creates a Viem adapter from an EIP-1193 browser wallet provider,
 * with custom RPC endpoints for Arc Testnet and Base Sepolia to avoid
 * SDK built-in RPC failures.
 */
export async function createViemAdapter(provider: any): Promise<any> {
  if (!provider) {
    throw new Error('No provider available. Please connect your browser wallet first.')
  }

  const adapter = await createViemAdapterFromProvider({
    provider,
    getPublicClient: ({ chain }) => {
      // Use custom RPC for Arc Testnet to avoid SDK built-in RPC failures
      if (chain.id === arcTestnet.id || chain.name === arcTestnet.name) {
        return createPublicClient({
          chain: ArcTestnet as any,
          transport: http(ARC_METADATA.rpcHttpUrl, {
            retryCount: 3,
            timeout: 15000,
          }),
        }) as any
      }
      // Use custom RPC for Base Sepolia to avoid SDK built-in RPC failures
      if (chain.id === CHAIN_DEFS.Base_Sepolia.id || chain.name === CHAIN_DEFS.Base_Sepolia.name) {
        return createPublicClient({
          chain: BaseSepolia as any,
          transport: http(CHAIN_DEFS.Base_Sepolia.rpcUrls.default.http[0], {
            retryCount: 3,
            timeout: 15000,
          }),
        }) as any
      }
      // For other chains, use default transport
      return createPublicClient({
        chain,
        transport: http(),
      }) as any
    },
  })

  return patchViemAdapterChainSwitch(adapter)
}

/**
 * Estimates the gas fee for sending a token on a specific chain.
 */
export async function estimateGas(
  provider: any,
  chain: string,
  token: string,
  recipientAddress: string,
  amount: string
) {
  const adapter = await createViemAdapter(provider)
  const sendParams: SendParams = {
    from: { adapter, chain: chain as Blockchain },
    to: recipientAddress,
    amount,
    token: token as any
  }
  return kit.estimateSend(sendParams)
}

/**
 * Executes a token send operation on a specific chain using the App Kit SDK.
 */
export async function sendToken(
  provider: any,
  chain: string,
  token: string,
  recipientAddress: string,
  amount: string
) {
  const adapter = await createViemAdapter(provider)
  const sendParams: SendParams = {
    from: { adapter, chain: chain as Blockchain },
    to: recipientAddress,
    amount,
    token: token as any
  }
  return kit.send(sendParams)
}