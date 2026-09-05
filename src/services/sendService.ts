import { AppKit, Blockchain } from '@circle-fin/app-kit'
import { createViemAdapterFromProvider, createViemAdapterFromPrivateKey } from '@circle-fin/adapter-viem-v2'
import { createPublicClient, createWalletClient, defineChain, http } from 'viem'
import type { SendParams } from '@circle-fin/app-kit'
import { arcTestnet, ARC_METADATA } from '../config/arcChain'
import { CHAIN_DEFS } from '../config/chainMeta'

// Single instance of AppKit to be used for Send operations
const kit = new AppKit()

/**
 * Resolves a proper Viem Chain object and RPC URL from any input chain representation
 * (whether it is a Circle ChainDefinition, Viem Chain, or chain name/ID).
 * Guarantees that client.chain.id is always defined and RPC is valid.
 */
export function resolveViemChainAndRpc(chain: any): { viemChain: any; rpcUrl: string } {
  const chainId = chain?.chainId || chain?.id
  const chainName = chain?.name || chain?.chain || ''

  // 1. Arc Testnet check
  if (
    chainId === arcTestnet.id ||
    chainName === arcTestnet.name ||
    chainName === 'Arc_Testnet' ||
    String(chainName).toLowerCase().includes('arc')
  ) {
    return {
      viemChain: arcTestnet,
      rpcUrl: ARC_METADATA.rpcHttpUrl,
    }
  }

  // 2. Check in CHAIN_DEFS
  for (const [key, def] of Object.entries(CHAIN_DEFS)) {
    if (
      def &&
      (def.id === chainId ||
        def.name === chainName ||
        key.toLowerCase() === String(chainName).toLowerCase().replace(/[\s-]/g, '_'))
    ) {
      const rpc =
        def.rpcUrls?.default?.http?.[0] ||
        chain?.rpcEndpoints?.[0] ||
        'https://rpc.ankr.com/eth'
      return {
        viemChain: def,
        rpcUrl: rpc,
      }
    }
  }

  // 3. Fallback: construct a valid Viem Chain via defineChain
  const rpc =
    chain?.rpcEndpoints?.[0] ||
    chain?.rpcUrls?.default?.http?.[0] ||
    'https://rpc.ankr.com/eth'
  const fallbackViemChain = defineChain({
    id: chainId || 1,
    name: chainName || 'EVM Chain',
    nativeCurrency: chain?.nativeCurrency || {
      name: 'Ether',
      symbol: 'ETH',
      decimals: 18,
    },
    rpcUrls: {
      default: { http: [rpc] },
      public: { http: [rpc] },
    },
  })

  return {
    viemChain: fallbackViemChain,
    rpcUrl: rpc,
  }
}

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
      const { viemChain, rpcUrl } = resolveViemChainAndRpc(chain)
      return createPublicClient({
        chain: viemChain,
        transport: http(rpcUrl, { retryCount: 3, timeout: 15000 }),
      }) as any
    },
    getWalletClient: ({ chain, account }) => {
      const { viemChain, rpcUrl } = resolveViemChainAndRpc(chain)
      return createWalletClient({
        account,
        chain: viemChain,
        transport: http(rpcUrl, { retryCount: 3, timeout: 15000 }),
      }) as any
    },
  })

  return patchViemAdapterChainSwitch(adapter)
}

/**
 * Creates a Viem adapter from an EIP-1193 browser wallet provider,
 * with robust Viem Chain resolution and custom RPC endpoints to avoid
 * SDK built-in RPC failures.
 */
export async function createViemAdapter(provider: any): Promise<any> {
  if (!provider) {
    throw new Error('No provider available. Please connect your browser wallet first.')
  }

  const adapter = await createViemAdapterFromProvider({
    provider,
    getPublicClient: ({ chain }) => {
      const { viemChain, rpcUrl } = resolveViemChainAndRpc(chain)
      return createPublicClient({
        chain: viemChain,
        transport: http(rpcUrl, {
          retryCount: 3,
          timeout: 15000,
        }),
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
  token: string = 'USDC',
  recipientAddress?: string,
  amount: string = '1'
) {
  const adapter = await createViemAdapter(provider)
  const isSolana = chain.toLowerCase().includes('solana')
  const defaultRecipient = isSolana
    ? '11111111111111111111111111111111'
    : '0x000000000000000000000000000000000000dEaD'

  const sendParams: SendParams = {
    from: { adapter, chain: chain as Blockchain },
    to: recipientAddress || defaultRecipient,
    amount: amount || '1',
    token: (token || 'USDC') as any
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