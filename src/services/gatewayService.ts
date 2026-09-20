// Circle Gateway service layer — deposit, balance query, and transfer.
// Gateway provides a unified USDC balance across multiple blockchains with
// instant (<500ms) crosschain transfers.
import {
  createWalletClient,
  custom,
  erc20Abi,
  getContract,
  maxUint256,
  parseUnits,
  formatUnits,
  zeroAddress,
  type Chain,
} from 'viem'
import { getResilientPublicClient, resilientReadContract, resilientWaitForReceipt } from './rpc'
import { checkCeilingStatus, setSpendingCeiling } from './spendingCeilingService'
import {
  ACTIVE_GATEWAY_API,
  ACTIVE_GATEWAY_CONTRACTS,
  GATEWAY_API,
  GATEWAY_CONTRACTS,
  GATEWAY_DOMAINS,
  GATEWAY_EIP712_DOMAIN,
  GATEWAY_EIP712_TYPES,
  GATEWAY_GAS_LIMITS,
  GATEWAY_MINTER_ABI,
  GATEWAY_WALLET_ABI,
  USDC_ADDRESSES,
  EURC_ADDRESSES,
} from '../config/gatewayConfig'
import { IS_TESTNET } from '../config/arcChain'

// ── Types ────────────────────────────────────────────────────────────────────

export interface GatewayBalanceItem {
  domain: number
  depositor: string
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
  effectiveAmount?: string
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

import { assertNetwork } from './chainSwitchService'

export async function ensureChain(provider: any, chain: Chain): Promise<void> {
  await assertNetwork(chain, provider)
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

  // Use centralized resilient RPC client with multi-endpoint fallback
  const publicClient = getResilientPublicClient(chainDef)

  const tokenAddress = tokenSymbol === 'EURC' ? EURC_ADDRESSES[chainKey] : USDC_ADDRESSES[chainKey]
  if (!tokenAddress) {
    throw new Error(`No ${tokenSymbol} address configured for ${chainKey}`)
  }

  const gatewayWallet = GATEWAY_CONTRACTS.testnet.gatewayWallet
  const amountBaseUnits = parseUnits(amount, 6)

  // Pre-flight Step 0: Check token balance and enforce Arc Testnet native gas reserve
  try {
    const userBalance = await resilientReadContract(publicClient, {
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

  // Step 1 (Circle Official Spec): Check allowance and approve Gateway Wallet if needed
  let approveTxHash = ''
  let currentAllowance = 0n
  try {
    currentAllowance = await resilientReadContract(publicClient, {
      address: tokenAddress,
      abi: erc20Abi,
      functionName: 'allowance',
      args: [address, gatewayWallet],
    })
    console.log(`[Gateway Deposit] Current allowance for ${gatewayWallet}: ${(Number(currentAllowance) / 1e6).toFixed(6)} ${tokenSymbol}`)
  } catch (allowanceErr) {
    console.warn(`[Gateway Deposit] Could not read allowance, will attempt approve:`, allowanceErr)
  }

  const ceilingStatus = checkCeilingStatus(address, tokenSymbol, amount)
  const requiresApprove = currentAllowance < amountBaseUnits

  if (requiresApprove) {
    console.log(
      `[Gateway Deposit] Step 1/2: Approving ceiling ${ceilingStatus.suggestedCeiling} ${tokenSymbol} on ${chainKey} (Current Ceiling: ${ceilingStatus.currentCeiling})...`
    )

    // Calculate safe gas limit for approve
    let gasLimit: bigint = GATEWAY_GAS_LIMITS.approve
    try {
      const estimatedGas = await publicClient.estimateContractGas({
        address: tokenAddress,
        abi: erc20Abi,
        functionName: 'approve',
        args: [gatewayWallet, maxUint256],
        account: address,
      })
      gasLimit = (estimatedGas * 130n) / 100n // +30% buffer
    } catch (gasErr) {
      console.warn(`[Gateway Deposit] Approve gas estimate fallback to 100_000:`, gasErr)
      gasLimit = 100_000n
    }

    try {
      approveTxHash = await walletClient.writeContract({
        address: tokenAddress,
        abi: erc20Abi,
        functionName: 'approve',
        args: [gatewayWallet, maxUint256],
        chain: chainDef,
        account: address,
        gas: gasLimit,
      })
      console.log(`[Gateway Deposit] Approve tx submitted: ${approveTxHash}`)
      const approveRes = await resilientWaitForReceipt(
        publicClient,
        approveTxHash as `0x${string}`,
        'Gateway Deposit Approve',
        120_000
      )
      if (approveRes.status === 'reverted') {
        throw new Error('Token approval reverted on-chain.')
      }
      setSpendingCeiling(address, tokenSymbol, ceilingStatus.suggestedCeiling, approveTxHash)
      console.log(`[Gateway Deposit] Approve confirmed in block ${approveRes.blockNumber}, ceiling recorded: ${ceilingStatus.suggestedCeiling} ${tokenSymbol}`)
    } catch (err: any) {
      console.error(`[Gateway Deposit] Approve failed:`, err)
      throw err
    }
  } else {
    if (ceilingStatus.suggestedCeiling > ceilingStatus.currentCeiling) {
      setSpendingCeiling(address, tokenSymbol, ceilingStatus.suggestedCeiling)
    }
    console.log(
      `[Gateway Deposit] Step 1/2 skipped: Allowance already sufficient on-chain (${(Number(currentAllowance) / 1e6).toFixed(2)} >= ${amount} ${tokenSymbol})`
    )
  }

  // Step 2 (Circle Official Spec): Call deposit on the Gateway Wallet contract
  let depositGasLimit: bigint = GATEWAY_GAS_LIMITS.deposit
  try {
    const estimatedGas = await publicClient.estimateContractGas({
      address: gatewayWallet,
      abi: GATEWAY_WALLET_ABI,
      functionName: 'deposit',
      args: [tokenAddress, amountBaseUnits],
      account: address,
    })
    depositGasLimit = (estimatedGas * 130n) / 100n
  } catch (gasErr) {
    console.warn(`[Gateway Deposit] Deposit gas estimate fallback to 150_000:`, gasErr)
    depositGasLimit = 150_000n
  }

  console.log(`[Gateway Deposit] Step 2/2: Depositing ${amount} ${tokenSymbol} into Gateway...`)
  const depositTxHash = await walletClient.writeContract({
    address: gatewayWallet,
    abi: GATEWAY_WALLET_ABI,
    functionName: 'deposit',
    args: [tokenAddress, amountBaseUnits],
    chain: chainDef,
    account: address,
    gas: depositGasLimit,
  })
  console.log(`[Gateway Deposit] Deposit tx submitted: ${depositTxHash}`)
  const depositRes = await resilientWaitForReceipt(
    publicClient,
    depositTxHash as `0x${string}`,
    'Gateway Deposit',
    120_000
  )
  if (depositRes.status === 'reverted') {
    throw new Error('Gateway deposit transaction reverted on-chain.')
  }
  console.log(`[Gateway Deposit] Deposit confirmed in block ${depositRes.blockNumber}`)
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

  const gatewayWallet = ACTIVE_GATEWAY_CONTRACTS.gatewayWallet
  const gatewayMinter = ACTIVE_GATEWAY_CONTRACTS.gatewayMinter

  // Step 1: Switch to source chain and sign the burn intent
  await ensureChain(provider, sourceChainDef)

  const sourceWalletClient = createWalletClient({
    account,
    chain: sourceChainDef,
    transport: custom(provider),
  })

  // Dynamic maxFee calculation (Circle Gateway requirement: user balance must cover amount + maxFee):
  // For same-chain withdrawal: 0 transfer fee + 0.05 USDC gas buffer (50_000 units)
  // For cross-chain: 0.005% transfer fee + 0.05 USDC gas buffer
  // Note: Circle Gateway API enforces a minimum maxFee threshold of 1.0 USDC (1_000_000 subunits)
  const isSameChain = sourceDomain === destinationDomain
  const transferFee = isSameChain ? 0n : (parseUnits(amount, 6) * 5n) / 100_000n
  const gasBuffer = 50_000n // 0.05 USDC buffer for burn execution
  const calculatedFee = transferFee + gasBuffer
  const minGatewayMaxFee = parseUnits('1.0', 6) // Minimum 1.0 USDC enforced by Circle Gateway
  const maxFee = calculatedFee < minGatewayMaxFee ? minGatewayMaxFee : calculatedFee

  let burnValue = parseUnits(amount, 6)

  // Pre-flight check: Ensure user balance on source domain covers burnValue + maxFee
  try {
    const balancesResp = await getGatewayBalances(account, IS_TESTNET ? 'testnet' : 'mainnet')
    const sourceItem = balancesResp.balances?.find((b) => b.domain === sourceDomain)
    if (sourceItem) {
      const sourceBalanceUnits = parseUnits(sourceItem.balance || '0', 6)
      if (sourceBalanceUnits < maxFee) {
        throw new Error(
          `Insufficient Gateway balance on ${sourceChain}. ` +
          `Available: ${sourceItem.balance} USDC, which is less than the required Gateway routing fee buffer (${(Number(maxFee) / 1e6).toFixed(2)} USDC).`
        )
      }
      // If user requested their full balance or amount + maxFee > balance, auto-adjust burnValue
      if (burnValue + maxFee > sourceBalanceUnits) {
        const safeBurnValue = sourceBalanceUnits - maxFee
        console.log(
          `[transferFromGateway] Auto-adjusted withdrawal value from ${(Number(burnValue) / 1e6).toFixed(2)} to ${(Number(safeBurnValue) / 1e6).toFixed(2)} USDC to cover ${(Number(maxFee) / 1e6).toFixed(2)} USDC Gateway routing fee.`
        )
        burnValue = safeBurnValue
      }
    }
  } catch (checkErr: any) {
    if (checkErr.message?.includes('Insufficient Gateway balance')) {
      throw checkErr
    }
    console.warn('[transferFromGateway] Pre-flight balance check warning:', checkErr)
  }

  const burnIntent = {
    maxBlockHeight: 2n ** 256n - 1n,
    maxFee,
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
      value: burnValue,
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
  const apiResponse = await fetch(`${ACTIVE_GATEWAY_API}/transfer`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(
      [{ burnIntent, signature }],
      (_key, value) => (typeof value === 'bigint' ? value.toString() : value)
    ),
  })

  if (!apiResponse.ok) {
    let errorDetail = ''
    try {
      const errJson = await apiResponse.json()
      errorDetail = errJson.message || errJson.error || JSON.stringify(errJson)
    } catch {
      errorDetail = await apiResponse.text().catch(() => '')
    }

    if (errorDetail?.toLowerCase().includes('unauthorized') || apiResponse.status === 400) {
      throw new Error(
        `Circle Gateway could not process withdrawal: ${errorDetail || 'Unauthorized'}. ` +
        `Please ensure your Gateway balance is confirmed and sufficient to cover ${amount} USDC.`
      )
    }

    throw new Error(`Gateway API request failed (${apiResponse.status}): ${errorDetail}`)
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

  // Centralized resilient client for destination chain
  const destinationPublicClient = getResilientPublicClient(destinationChainDef)

  const gatewayMinterContract = getContract({
    address: gatewayMinter,
    abi: GATEWAY_MINTER_ABI,
    client: destinationWalletClient,
  })

  let mintGasLimit: bigint = GATEWAY_GAS_LIMITS.mint
  try {
    const estimatedGas = await destinationPublicClient.estimateContractGas({
      address: gatewayMinter,
      abi: GATEWAY_MINTER_ABI,
      functionName: 'gatewayMint',
      args: [attestation, mintSignature],
      account,
    })
    mintGasLimit = (estimatedGas * 130n) / 100n
  } catch (gasErr) {
    console.warn('[transferFromGateway] Mint gas estimate fallback to 250_000:', gasErr)
    mintGasLimit = 250_000n
  }

  const mintTxHash = await gatewayMinterContract.write.gatewayMint(
    [attestation, mintSignature],
    { account, gas: mintGasLimit }
  )
  const mintRes = await resilientWaitForReceipt(destinationPublicClient, mintTxHash as `0x${string}`, 'Gateway Mint')
  if (mintRes.status === 'reverted') {
    throw new Error('Gateway mint transaction reverted on-chain.')
  }

  return {
    burnIntent,
    signature,
    attestation,
    mintSignature,
    mintTxHash,
    amount,
    effectiveAmount: formatUnits(burnValue, 6),
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