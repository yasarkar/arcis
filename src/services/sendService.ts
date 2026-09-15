import { AppKit, Blockchain } from '@circle-fin/app-kit'
import { createViemAdapterFromProvider, createViemAdapterFromPrivateKey } from '@circle-fin/adapter-viem-v2'
import { createPublicClient, createWalletClient, defineChain, http, erc20Abi, maxUint256 } from 'viem'
import type { SendParams } from '@circle-fin/app-kit'
import { arcTestnet, ARC_METADATA } from '../config/arcChain'
import { CHAIN_DEFS } from '../config/chainMeta'
import { getResilientPublicClient, resilientReadContract } from './rpc'
import { checkCeilingStatus, setSpendingCeiling } from './spendingCeilingService'
import { USDC_ADDRESSES } from '../config/gatewayConfig'

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
 * Patch helper to intercept allowance approval requests in ViemAdapter.
 * When a transaction amount is within the user's previously authorized ceiling
 * AND on-chain allowance is already sufficient, it returns a 'noop' action
 * so that CCTP bridge (and any AppKit flow) skips the approve wallet popup entirely!
 * When approval IS needed (first time or ceiling elevated), it elevates allowance to maxUint256
 * and persists the new spending ceiling in localStorage upon wallet execution.
 */
export function patchViemAdapterAllowanceCeiling(adapter: any): any {
  if (!adapter) return adapter

  const originalPrepareAction = adapter.prepareAction?.bind(adapter)
  if (!originalPrepareAction) return adapter

  adapter.prepareAction = async function (action: string, params: any, ctx: any) {
    if (
      action === 'usdc.increaseAllowance' ||
      action === 'token.increaseAllowance' ||
      action === 'token.approve' ||
      action === 'usdc.approve'
    ) {
      try {
        const requiredAmountBigInt = BigInt(params?.amount ?? 0n)
        const tokenDecimals = 6
        const amountNum = Number(requiredAmountBigInt) / 10 ** tokenDecimals
        const amountStr = amountNum.toString()

        // Get user wallet address
        const walletAddress =
          ctx?.address ||
          params?.address ||
          (typeof adapter.getAddress === 'function' ? await adapter.getAddress(params?.chain || ctx?.chain) : '')

        if (walletAddress && amountNum > 0) {
          const ceilingStatus = checkCeilingStatus(walletAddress, 'USDC', amountStr)

          // Read on-chain allowance with robust chain/token address resolution
          let onChainAllowance = 0n
          let readSuccessful = false
          try {
            const chainParam = params?.chain || ctx?.chain
            const { viemChain } = resolveViemChainAndRpc(chainParam)
            const publicClient = getResilientPublicClient(viemChain)

            const spender = params?.delegate || params?.spender
            const chainKey = typeof chainParam === 'string' ? chainParam : (chainParam?.name || '')
            const normalizedKey = chainKey.replace(/[\s-]/g, '_')
            const normalizedViem = viemChain?.name ? viemChain.name.replace(/[\s-]/g, '_') : ''
            const chainId = Number(chainParam?.id || viemChain?.id || 0)

            const tokenAddr =
              params?.tokenAddress ||
              params?.token ||
              params?.chain?.usdcAddress ||
              ctx?.chain?.usdcAddress ||
              (chainId === 5042002 || chainId === 0x4cef52 ? ('0x3600000000000000000000000000000000000000' as `0x${string}`) : undefined) ||
              USDC_ADDRESSES[chainKey] ||
              USDC_ADDRESSES[normalizedKey] ||
              (viemChain?.name ? USDC_ADDRESSES[viemChain.name] : undefined) ||
              (normalizedViem ? USDC_ADDRESSES[normalizedViem] : undefined)

            if (tokenAddr && spender && publicClient) {
              onChainAllowance = await resilientReadContract(publicClient, {
                address: tokenAddr as `0x${string}`,
                abi: erc20Abi,
                functionName: 'allowance',
                args: [walletAddress as `0x${string}`, spender as `0x${string}`],
              })
              readSuccessful = true
            }
          } catch (readErr) {
            console.warn('[ViemAdapter Ceiling] Could not read on-chain allowance:', readErr)
          }

          console.log(
            `[ViemAdapter Ceiling] Action: ${action} | Amount: ${amountStr} USDC | Ceiling: ${ceilingStatus.currentCeiling} USDC | OnChainAllowance: ${onChainAllowance.toString()} (ReadSuccess: ${readSuccessful})`
          )

          // 1. If on-chain allowance is ALREADY sufficient for this transaction:
          // Skip approval completely to prevent any addition overflow and give instant 1-click execution!
          if (readSuccessful && onChainAllowance >= requiredAmountBigInt) {
            console.log(
              `[ViemAdapter Ceiling] Skipping approval! On-chain allowance (${(Number(onChainAllowance) / 10 ** tokenDecimals).toFixed(2)} USDC) >= required (${amountStr} USDC). Returning noop.`
            )
            if (ceilingStatus.suggestedCeiling > ceilingStatus.currentCeiling) {
              setSpendingCeiling(walletAddress, 'USDC', ceilingStatus.suggestedCeiling)
            }
            return {
              type: 'noop',
              execute: async () => '0xnoop',
            }
          }

          // Fallback: If allowance read failed but user already confirmed within local ceiling:
          if (!readSuccessful && ceilingStatus.isWithinCeiling) {
            console.log(
              `[ViemAdapter Ceiling] Skipping approval! Amount (${amountStr} USDC) is within authorized ceiling (${ceilingStatus.currentCeiling} USDC). Returning noop.`
            )
            return {
              type: 'noop',
              execute: async () => '0xnoop',
            }
          }

          // 2. On-chain approval is genuinely required.
          // CRITICAL OVERFLOW FIX:
          // For 'increaseAllowance', passing maxUint256 will cause "SafeMath: addition overflow" if onChainAllowance > 0.
          // Instead, compute a safe high ceiling that will never overflow uint256 (e.g. 10M USDC).
          const isIncreaseAllowance =
            action === 'usdc.increaseAllowance' || action === 'token.increaseAllowance'

          const SAFE_CEILING_CAP = 10_000_000n * 10n ** BigInt(tokenDecimals)
          const targetCap = requiredAmountBigInt > SAFE_CEILING_CAP ? requiredAmountBigInt : SAFE_CEILING_CAP

          let safeAmount: bigint
          if (isIncreaseAllowance) {
            const delta = targetCap > onChainAllowance ? targetCap - onChainAllowance : requiredAmountBigInt
            safeAmount = delta > 0n ? delta : requiredAmountBigInt
          } else {
            safeAmount = targetCap
          }

          const modifiedParams = {
            ...params,
            amount: safeAmount,
          }

          console.log(
            `[ViemAdapter Ceiling] Preparing safe approval: action=${action}, amount=${safeAmount.toString()} (ceiling=${ceilingStatus.suggestedCeiling} USDC)`
          )
          const prepared = await originalPrepareAction(action, modifiedParams, ctx)

          // Intercept execute to record the new ceiling when user confirms in their wallet
          if (prepared && typeof prepared.execute === 'function') {
            const originalExecute = prepared.execute.bind(prepared)
            prepared.execute = async function (overrides?: any) {
              const txHash = await originalExecute(overrides)
              if (txHash && txHash !== '0xnoop') {
                try {
                  setSpendingCeiling(walletAddress, 'USDC', ceilingStatus.suggestedCeiling, txHash)
                  console.log(
                    `[ViemAdapter Ceiling] Persisted new ceiling: ${ceilingStatus.suggestedCeiling} USDC (tx: ${txHash})`
                  )
                } catch (persistErr) {
                  console.warn('[ViemAdapter Ceiling] Failed to persist ceiling:', persistErr)
                }
              }
              return txHash
            }
          }

          return prepared
        }
      } catch (err) {
        console.warn('[ViemAdapter Ceiling] Error in ceiling check, falling back to original prepareAction:', err)
      }
    }

    return originalPrepareAction(action, params, ctx)
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
      const { viemChain } = resolveViemChainAndRpc(chain)
      return getResilientPublicClient(viemChain) as any
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

  return patchViemAdapterAllowanceCeiling(patchViemAdapterChainSwitch(adapter))
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
      const { viemChain } = resolveViemChainAndRpc(chain)
      return getResilientPublicClient(viemChain) as any
    },
  })

  return patchViemAdapterAllowanceCeiling(patchViemAdapterChainSwitch(adapter))
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