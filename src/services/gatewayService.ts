// src/services/gatewayService.ts
//
// Circle Gateway service layer — deposit, balance query, and transfer.
// Gateway provides a unified USDC balance across multiple blockchains with
// instant (<500ms) crosschain transfers.

import {
  createPublicClient,
  createWalletClient,
  custom,
  erc20Abi,
  getContract,
  http,
  parseUnits,
  zeroAddress,
  type Chain,
} from 'viem'
import {
  GATEWAY_API,
  GATEWAY_CONTRACTS,
  GATEWAY_DOMAINS,
  GATEWAY_EIP712_DOMAIN,
  GATEWAY_EIP712_TYPES,
  GATEWAY_GAS_LIMITS,
  GATEWAY_MAX_FEE,
  GATEWAY_MINTER_ABI,
  GATEWAY_WALLET_ABI,
  USDC_ADDRESSES,
  EURC_ADDRESSES,
} from '../config/gatewayConfig'
import { ARC_METADATA } from '../config/arcChain'
import { CHAIN_DEFS } from '../config/chainMeta'

// ── Types ────────────────────────────────────────────────────────────────────

export interface GatewayBalanceItem {
  domain: number
  depositor: string
  /** Balance as a decimal string (human-readable USDC units, 6 decimals) */
  balance: string
}

export interface GatewayBalanceResponse {
  token: string
  balances: GatewayBalanceItem[]
}

export interface GatewayDepositResult {
  approveTxHash: string
  depositTxHash: string
  amount: string
  chain: string
}

export interface GatewayTransferResult {
  burnIntent: any
  signature: string
  attestation: string
  mintSignature: string
  mintTxHash: string
  amount: string
  sourceChain: string
  destinationChain: string
  recipient: string
}

export interface GatewayTransferParams {
  provider: any // EIP-1193 provider
  sourceChain: string
  destinationChain: string
  amount: string
  recipient?: string
  sourceChainDef: Chain
  destinationChainDef: Chain
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function toBytes32(address: `0x${string}`): `0x${string}` {
  return `0x${address.toLowerCase().replace(/^0x/, '').padStart(64, '0')}` as const
}

function randomHex32(): `0x${string}` {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  return `0x${Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')}` as const
}

async function ensureChain(provider: any, chain: Chain) {
  const chainIdHex = `0x${chain.id.toString(16)}`

  try {
    await provider.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: chainIdHex }],
    })
  } catch {
    await provider.request({
      method: 'wallet_addEthereumChain',
      params: [
        {
          chainId: chainIdHex,
          chainName: chain.name,
          nativeCurrency: chain.nativeCurrency,
          rpcUrls: chain.rpcUrls.default.http,
          blockExplorerUrls: chain.blockExplorers?.default?.url
            ? [chain.blockExplorers.default.url]
            : [],
        },
      ],
    })
  }
}

// ── Balance Query ────────────────────────────────────────────────────────────

/**
 * Query the Gateway unified balance for a wallet address across all supported
 * testnet chains. Returns the total confirmed balance and per-chain breakdown.
 */
export async function getGatewayBalances(
  address: string,
  network: 'testnet' | 'mainnet' = 'testnet'
): Promise<GatewayBalanceResponse> {
  const url = `${GATEWAY_API[network]}/balances`
  const isEvmAddress = address.startsWith('0x') && address.length === 42
  const isSolanaAddress = !address.startsWith('0x') && address.length >= 32 && address.length <= 44

  // Only include domains compatible with the address format:
  // - EVM addresses (0x...) → include all domains EXCEPT Solana (5)
  // - Solana addresses (base58) → include only Solana domain (5)
  const sources = Object.entries(GATEWAY_DOMAINS)
    .filter(([chainKey, domain]) => {
      if (isEvmAddress && domain === 5) return false // Skip Solana for EVM wallets
      if (isSolanaAddress && domain !== 5) return false // Only Solana for Solana wallets
      return true
    })
    .map(([chainKey, domain]) => ({
      domain,
      depositor: address,
    }))

  console.log(`[GatewayAPI] → POST ${url}`)
  console.log(`[GatewayAPI]   Address type: ${isEvmAddress ? 'EVM' : isSolanaAddress ? 'Solana' : 'unknown'}`)
  console.log(`[GatewayAPI]   Body:`, JSON.stringify({ token: 'USDC', sources }))

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      token: 'USDC',
      sources,
    }),
  })

  console.log(`[GatewayAPI] ← Status: ${response.status} ${response.statusText}`)

  if (!response.ok) {
    const errorBody = await response.text()
    console.error(`[GatewayAPI] ✗ Error response body:`, errorBody)
    throw new Error(`Gateway API error: ${response.status} - ${errorBody}`)
  }

  const data = (await response.json()) as GatewayBalanceResponse
  console.log(`[GatewayAPI] ✓ Success response:`, data)
  return data
}

/**
 * Get the total confirmed Gateway balance for a wallet address.
 */
export async function getGatewayTotalBalance(
  address: string,
  network: 'testnet' | 'mainnet' = 'testnet'
): Promise<string> {
  const data = await getGatewayBalances(address, network)
  const total = (data.balances || []).reduce(
    (sum, item) => sum + parseFloat(item.balance),
    0
  )
  console.log(`[GatewayAPI] Total balance for ${address}: ${total.toFixed(6)} USDC`)
  return total.toFixed(6)
}

// ── Deposit ──────────────────────────────────────────────────────────────────

/**
 * Deposit USDC into the Gateway unified balance from a browser wallet.
 *
 * Flow:
 * 1. Approve the Gateway Wallet contract to spend USDC
 * 2. Call `deposit(token, value)` on the Gateway Wallet contract
 */
export async function depositToGateway(
  provider: any,
  chainKey: string,
  amount: string,
  chainDef: Chain,
  tokenSymbol: 'USDC' | 'EURC' = 'USDC'
): Promise<GatewayDepositResult> {
  const account = (await provider.request({
    method: 'eth_requestAccounts',
  })) as string[]

  if (!account?.[0]) {
    throw new Error('No wallet account returned')
  }

  const address = account[0] as `0x${string}`
  await ensureChain(provider, chainDef)

  const walletClient = createWalletClient({
    account: address,
    chain: chainDef,
    transport: custom(provider),
  })

  // IMPORTANT: Use a direct HTTP RPC transport for transaction receipts, NOT
  // the wallet provider. Wallets like MetaMask can't reliably return receipts
  // for chains they weren't specifically configured for, causing
  // "Timed out while waiting for transaction to be confirmed". Polling the
  // chain's RPC endpoint directly avoids this entirely.
  const rpcUrl = chainDef.rpcUrls?.default?.http?.[0] || ARC_METADATA.rpcHttpUrl
  console.log(`[Gateway Deposit] Using RPC: ${rpcUrl}`)

  const publicClient = createPublicClient({
    chain: chainDef,
    transport: http(rpcUrl, { timeout: 30_000, retryCount: 3 }),
    batch: { multicall: false },
    pollingInterval: 5000,
  })

  const tokenAddress = tokenSymbol === 'EURC' ? EURC_ADDRESSES[chainKey] : USDC_ADDRESSES[chainKey]
  if (!tokenAddress) {
    throw new Error(`No ${tokenSymbol} address configured for ${chainKey}`)
  }

  const gatewayWallet = GATEWAY_CONTRACTS.testnet.gatewayWallet
  const amountBaseUnits = parseUnits(amount, 6)

  // Pre-flight Step 0: Check token balance and enforce Arc Testnet native gas reserve
  try {
    const userBalance = await publicClient.readContract({
      address: tokenAddress,
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [address],
    })

    // On Arc Testnet, USDC is the native gas token.
    // Ensure user holds enough USDC for the deposit AND native gas fees (reserve 0.05 USDC = 50,000 units).
    const gasReserve = chainKey === 'Arc_Testnet' && tokenSymbol === 'USDC' ? parseUnits('0.05', 6) : 0n
    const requiredBalance = amountBaseUnits + gasReserve

    if (userBalance < requiredBalance) {
      if (chainKey === 'Arc_Testnet' && tokenSymbol === 'USDC') {
        throw new Error(
          `Insufficient USDC balance on Arc Testnet for deposit + gas. ` +
          `Your balance is ${(Number(userBalance) / 1e6).toFixed(6)} USDC, but depositing ${amount} USDC requires at least ${(Number(requiredBalance) / 1e6).toFixed(6)} USDC (reserving 0.05 USDC for gas).`
        )
      } else {
        throw new Error(
          `Insufficient ${tokenSymbol} balance. You have ${(Number(userBalance) / 1e6).toFixed(6)} ${tokenSymbol}, but requested ${amount}.`
        )
      }
    }
  } catch (balanceErr: any) {
    if (balanceErr.message?.includes('Insufficient')) {
      throw balanceErr
    }
    console.warn(`[Gateway Deposit] Balance pre-check skipped:`, balanceErr)
  }

  // Step 1 (Circle Official Spec): Approve Gateway Wallet to spend token
  const tokenContract = getContract({
    address: tokenAddress,
    abi: erc20Abi,
    client: walletClient,
  })

  console.log(`[Gateway Deposit] Step 1/2: Approving ${amount} ${tokenSymbol} on ${chainKey}...`)
  const approveTxHash = await tokenContract.write.approve(
    [gatewayWallet, amountBaseUnits],
    { account: address }
  )
  console.log(`[Gateway Deposit] Approve tx submitted: ${approveTxHash}`)
  const approveReceipt = await publicClient.waitForTransactionReceipt({
    hash: approveTxHash,
    timeout: 120_000, // 2 minutes — Arc RPC can be slow to propagate
    confirmations: 1,
  })
  console.log(`[Gateway Deposit] Approve confirmed in block ${approveReceipt.blockNumber}`)

  // Step 2 (Circle Official Spec): Call deposit on the Gateway Wallet contract
  const gatewayWalletContract = getContract({
    address: gatewayWallet,
    abi: GATEWAY_WALLET_ABI,
    client: walletClient,
  })

  console.log(`[Gateway Deposit] Step 2/2: Depositing ${amount} ${tokenSymbol} into Gateway...`)
  const depositTxHash = await gatewayWalletContract.write.deposit(
    [tokenAddress, amountBaseUnits],
    { account: address }
  )
  console.log(`[Gateway Deposit] Deposit tx submitted: ${depositTxHash}`)
  const depositReceipt = await publicClient.waitForTransactionReceipt({
    hash: depositTxHash,
    timeout: 120_000, // 2 minutes
    confirmations: 1,
  })
  if (depositReceipt.status === 'reverted') {
    throw new Error('Gateway deposit transaction reverted on-chain.')
  }
  console.log(`[Gateway Deposit] Deposit confirmed in block ${depositReceipt.blockNumber}`)
  console.log(`[Gateway Deposit] Deposit tx: ${depositTxHash}`)

  return {
    approveTxHash,
    depositTxHash,
    amount,
    chain: chainKey,
  }
}

// ── Transfer (Burn + Mint) ───────────────────────────────────────────────────

/**
 * Transfer USDC from the Gateway unified balance to a destination chain.
 *
 * Flow:
 * 1. Build a Gateway burn intent (EIP-712 typed data)
 * 2. Sign it with the source wallet
 * 3. Submit to the Gateway `/transfer` API
 * 4. Switch to the destination chain
 * 5. Call `gatewayMint` on the destination chain
 */
export async function transferFromGateway(
  params: GatewayTransferParams
): Promise<GatewayTransferResult> {
  const {
    provider,
    sourceChain,
    destinationChain,
    amount,
    recipient,
    sourceChainDef,
    destinationChainDef,
  } = params

  const accounts = (await provider.request({
    method: 'eth_requestAccounts',
  })) as string[]

  if (!accounts?.[0]) {
    throw new Error('No wallet account returned')
  }

  const account = accounts[0] as `0x${string}`
  const destRecipient = (recipient || account) as `0x${string}`

  const sourceDomain = GATEWAY_DOMAINS[sourceChain]
  const destinationDomain = GATEWAY_DOMAINS[destinationChain]
  if (sourceDomain === undefined || destinationDomain === undefined) {
    throw new Error(`Unsupported chain: ${sourceChain} or ${destinationChain}`)
  }

  const sourceUsdc = USDC_ADDRESSES[sourceChain]
  const destUsdc = USDC_ADDRESSES[destinationChain]
  if (!sourceUsdc || !destUsdc) {
    throw new Error(`No USDC address configured for ${sourceChain} or ${destinationChain}`)
  }

  const gatewayWallet = GATEWAY_CONTRACTS.testnet.gatewayWallet
  const gatewayMinter = GATEWAY_CONTRACTS.testnet.gatewayMinter

  // Step 1: Switch to source chain and sign the burn intent
  await ensureChain(provider, sourceChainDef)

  const sourceWalletClient = createWalletClient({
    account,
    chain: sourceChainDef,
    transport: custom(provider),
  })

  const burnIntent = {
    maxBlockHeight: 2n ** 256n - 1n,
    maxFee: GATEWAY_MAX_FEE,
    spec: {
      version: 1,
      sourceDomain,
      destinationDomain,
      sourceContract: toBytes32(gatewayWallet),
      destinationContract: toBytes32(gatewayMinter),
      sourceToken: toBytes32(sourceUsdc),
      destinationToken: toBytes32(destUsdc),
      sourceDepositor: toBytes32(account),
      destinationRecipient: toBytes32(destRecipient),
      sourceSigner: toBytes32(account),
      destinationCaller: toBytes32(zeroAddress),
      value: parseUnits(amount, 6),
      salt: randomHex32(),
      hookData: '0x' as const,
    },
  }

  const signature = await sourceWalletClient.signTypedData({
    domain: GATEWAY_EIP712_DOMAIN,
    types: GATEWAY_EIP712_TYPES,
    primaryType: 'BurnIntent',
    message: burnIntent,
  })

  // Step 2: Submit to the Gateway API
  const apiResponse = await fetch(`${GATEWAY_API.testnet}/transfer`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(
      [{ burnIntent, signature }],
      (_key, value) => (typeof value === 'bigint' ? value.toString() : value)
    ),
  })

  if (!apiResponse.ok) {
    throw new Error(
      `Gateway API request failed: ${apiResponse.status} ${await apiResponse.text()}`
    )
  }

  const { attestation, signature: mintSignature } = (await apiResponse.json()) as {
    attestation: `0x${string}`
    signature: `0x${string}`
  }

  // Step 3: Switch to destination chain and mint
  await ensureChain(provider, destinationChainDef)

  const destinationWalletClient = createWalletClient({
    account,
    chain: destinationChainDef,
    transport: custom(provider),
  })

  // Direct HTTP RPC for mint receipt polling (wallet provider can't reliably
  // return receipts for arbitrary chains).
  const destRpcUrl = destinationChainDef.rpcUrls?.default?.http?.[0] || CHAIN_DEFS.Base_Sepolia.rpcUrls.default.http[0]
  console.log(`[Gateway Transfer] Destination RPC: ${destRpcUrl}`)

  const destinationPublicClient = createPublicClient({
    chain: destinationChainDef,
    transport: http(destRpcUrl, { timeout: 30_000, retryCount: 3 }),
    batch: { multicall: false },
    pollingInterval: 5000,
  })

  const gatewayMinterContract = getContract({
    address: gatewayMinter,
    abi: GATEWAY_MINTER_ABI,
    client: destinationWalletClient,
  })

  const mintTxHash = await gatewayMinterContract.write.gatewayMint(
    [attestation, mintSignature],
    { account, gas: GATEWAY_GAS_LIMITS.mint }
  )
  const mintReceipt = await destinationPublicClient.waitForTransactionReceipt({ hash: mintTxHash })
  if (mintReceipt.status === 'reverted') {
    throw new Error('Gateway mint transaction reverted on-chain.')
  }

  return {
    burnIntent,
    signature,
    attestation,
    mintSignature,
    mintTxHash,
    amount,
    sourceChain,
    destinationChain,
    recipient: destRecipient,
  }
}

// ── Fee Estimation ───────────────────────────────────────────────────────────
/**
 * Estimate the Gateway transfer fee for a given amount and chain pair.
 * Returns the estimated fee in USDC (human-readable).
 */
export async function estimateGatewayTransfer(
  sourceChain: string,
  destinationChain: string,
  amount: string
): Promise<string> {
  // Gateway charges a 0.005% transfer fee (0.025 USDC per 500 USDC)
  const amountNum = parseFloat(amount)
  const fee = amountNum * 0.00005
  return fee.toFixed(6)
}