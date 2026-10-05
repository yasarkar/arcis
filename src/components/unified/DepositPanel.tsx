import { useEffect, useMemo, useRef, useState } from 'react'
import { useAccount } from 'wagmi'
import {
  RefreshCw,
  AlertTriangle,
  ChevronDown,
  X,
  Ban,
  Info,
  ArrowDownRight,
  Fuel,
} from 'lucide-react'
import { NetworkIcon } from '@web3icons/react/dynamic'
import UsdcIcon from '../../assets/Token-Icon/USDC Token.svg'

import { depositToGateway, resolvePaidNetworkFee } from '../../services/gatewayService'
import { useBroadcast } from '../BroadcastNotification'
import { normalizeAppError } from '../../utils/errorNormalizer'
import { parseUnits, encodeFunctionData, erc20Abi, maxUint256, type Hex } from 'viem'
import { getResilientPublicClient, resilientWaitForReceipt } from '../../services/rpc'
import {
  GATEWAY_SUPPORTED_CHAINS,
  ACTIVE_GATEWAY_CONTRACTS,
  GATEWAY_WALLET_ABI,
  USDC_ADDRESSES,
} from '../../config/gatewayConfig'
import { CHAIN_META, CHAIN_DEFS, getChainDisplayName, isSolanaChain } from '../../config/chainMeta'
import { ensureNetwork } from '../../services/chainSwitchService'
import { setAutoSwitchPaused } from '../../hooks/useAutoSwitchArcChain'
import { mapChainKeyToCircleBlockchain } from '../../services/gatewayUcwService'
import { IS_TESTNET } from '../../config/arcChain'
import type { WalletBalancesRecord } from '../../hooks/useWalletTestnetBalances'
import type { UserOpCall } from '../../services/modularWalletService'
import type { ExecuteContractCallParams } from '../../hooks/useUserControlledWallet'
import {
  ARC_GAS_RESERVE_USDC,
  computeMaxDeposit,
  isArcChainKey,
  sanitizeDepositAmountInput,
  sortDepositChains,
  validateDepositAmount,
  type DepositFee,
  type DepositOutcome,
} from '../../utils/depositFlow'

const DEPOSIT_TOKEN = 'USDC' as const
const CROSS_CHAIN_ACTIVE_KEY = 'arcis_cross_chain_active'

/** Deposit is EVM-only: Solana domains are handled by dedicated wallet flows. */
const DEPOSIT_CHAIN_OPTIONS = GATEWAY_SUPPORTED_CHAINS.filter(
  (chainKey) => !isSolanaChain(chainKey) && Boolean(USDC_ADDRESSES[chainKey])
)
const ACTIVE_ARC_CHAIN_KEY = IS_TESTNET ? 'Arc_Testnet' : 'Arc'
const DEFAULT_DEPOSIT_CHAIN = DEPOSIT_CHAIN_OPTIONS.includes(ACTIVE_ARC_CHAIN_KEY)
  ? ACTIVE_ARC_CHAIN_KEY
  : DEPOSIT_CHAIN_OPTIONS[0] || ACTIVE_ARC_CHAIN_KEY

export type SendModularUserOpFn = (
  calls: UserOpCall[]
) => Promise<{ success: boolean; txHash?: string; error?: string }>
export type ExecuteUcwContractFn = (
  params: ExecuteContractCallParams
) => Promise<{ success: boolean; txHash?: string; error?: string }>

/** Minimal structural type for the wagmi connector used to access the EIP-1193 provider. */
export interface EvmConnectorLike {
  getProvider: () => Promise<any>
}

interface DepositPanelProps {
  walletAddress: string
  connector?: EvmConnectorLike
  walletConnected?: boolean
  activeAuthSource?: 'passkey' | 'ucw' | 'evm' | null
  sendModularUserOp?: SendModularUserOpFn
  executeUcwContract?: ExecuteUcwContractFn
  walletBalances: WalletBalancesRecord
  walletBalancesLoading: boolean
  walletBalancesFetching: boolean
  walletBalancesReady: boolean
  onRefetchWalletBalances: () => void
  onClose: () => void
  onSuccess: (outcome: DepositOutcome) => void
}

export default function DepositPanel({
  walletAddress,
  connector,
  walletConnected,
  activeAuthSource,
  sendModularUserOp,
  executeUcwContract,
  walletBalances,
  walletBalancesLoading,
  walletBalancesFetching,
  walletBalancesReady,
  onRefetchWalletBalances,
  onClose,
  onSuccess,
}: DepositPanelProps) {
  const { chainId } = useAccount()
  const { addBroadcast, updateBroadcast } = useBroadcast()

  const [depositChain, setDepositChain] = useState(DEFAULT_DEPOSIT_CHAIN)
  const [depositAmount, setDepositAmount] = useState('')
  const [depositing, setDepositing] = useState(false)
  const [isSwitchingNetwork, setIsSwitchingNetwork] = useState(false)
  const [depositError, setDepositError] = useState<string | null>(null)
  const [isCanceledError, setIsCanceledError] = useState(false)
  const [showChainDropdown, setShowChainDropdown] = useState(false)

  const amountInputRef = useRef<HTMLInputElement>(null)
  const chainTriggerRef = useRef<HTMLButtonElement>(null)
  const chainListRef = useRef<HTMLDivElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  // Pause background auto-switch only while the panel is mounted (it is only rendered when open).
  useEffect(() => {
    setAutoSwitchPaused(true)
    sessionStorage.setItem(CROSS_CHAIN_ACTIVE_KEY, 'true')
    return () => {
      setAutoSwitchPaused(false)
      sessionStorage.removeItem(CROSS_CHAIN_ACTIVE_KEY)
    }
  }, [])

  // Move keyboard focus to the amount field when the panel opens.
  useEffect(() => {
    amountInputRef.current?.focus()
  }, [])

  // Close the chain menu on outside click or Escape, returning focus to the trigger.
  useEffect(() => {
    if (!showChainDropdown) return
    const handlePointerDown = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setShowChainDropdown(false)
      }
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setShowChainDropdown(false)
        chainTriggerRef.current?.focus()
      }
    }
    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [showChainDropdown])

  // Focus the selected (or first enabled) option when the menu opens.
  useEffect(() => {
    if (!showChainDropdown) return
    const frame = window.requestAnimationFrame(() => {
      const list = chainListRef.current
      if (!list) return
      const selected = list.querySelector<HTMLElement>('[role="option"][aria-selected="true"]:not([disabled])')
      const first = list.querySelector<HTMLElement>('[role="option"]:not([disabled])')
      ;(selected || first)?.focus()
    })
    return () => window.cancelAnimationFrame(frame)
  }, [showChainDropdown])

  // Passkey wallets are bound to the active Arc network: lock the selector defensively.
  useEffect(() => {
    if (activeAuthSource === 'passkey' && !isArcChainKey(depositChain)) {
      setDepositChain(DEFAULT_DEPOSIT_CHAIN)
    }
  }, [activeAuthSource, depositChain])

  const targetChainDef = CHAIN_DEFS[depositChain]
  const isWrongDepositChain = Boolean(
    activeAuthSource === 'evm' &&
    targetChainDef &&
    chainId &&
    chainId !== targetChainDef.id
  )

  const selectedWalletItem = walletBalances[depositChain]
  const selectedWalletTokenBalance = selectedWalletItem?.usdc || '0.00'
  const isBalanceLoading = !walletBalancesReady && (walletBalancesLoading || walletBalancesFetching)

  const isInsufficientWalletBalance =
    walletBalancesReady &&
    depositAmount !== '' &&
    Number.parseFloat(depositAmount) > Number.parseFloat(selectedWalletTokenBalance)

  const isEip1193Flow = activeAuthSource !== 'passkey' && activeAuthSource !== 'ucw'
  const nativeGasToken = selectedWalletItem?.nativeToken
  const showNativeGasWarning = Boolean(
    isEip1193Flow &&
    !isArcChainKey(depositChain) &&
    walletBalancesReady &&
    nativeGasToken &&
    Number.parseFloat(nativeGasToken.amount) <= 0
  )

  const sortedDepositChains = useMemo(
    () => sortDepositChains(
      DEPOSIT_CHAIN_OPTIONS,
      walletBalances,
      getChainDisplayName,
      DEFAULT_DEPOSIT_CHAIN
    ),
    [walletBalances]
  )

  const resetDepositError = () => {
    if (depositError) {
      setDepositError(null)
      setIsCanceledError(false)
    }
  }

  const handleSwitchDepositNetwork = async (): Promise<boolean> => {
    if (!targetChainDef) return false
    setIsSwitchingNetwork(true)
    setDepositError(null)
    setIsCanceledError(false)
    try {
      const provider = await connector?.getProvider()
      const res = await ensureNetwork(targetChainDef, provider)
      if (!res.success) {
        if (res.isCanceled) {
          setIsCanceledError(true)
          setDepositError(`Network switch to ${targetChainDef.name} was canceled. Your deposit was not submitted.`)
        } else {
          setDepositError(res.error || `Failed to switch to ${targetChainDef.name}`)
        }
        return false
      }
      return true
    } catch (err: any) {
      setDepositError(err?.message || `Failed to switch to ${targetChainDef.name}`)
      return false
    } finally {
      setIsSwitchingNetwork(false)
    }
  }

  const handleAmountChange = (raw: string) => {
    const sanitized = sanitizeDepositAmountInput(raw)
    if (sanitized === null) return
    setDepositAmount(sanitized)
    resetDepositError()
  }

  const handleMax = () => {
    const next = computeMaxDeposit(
      selectedWalletTokenBalance,
      Boolean(selectedWalletItem?.nativeToken?.isArcGas),
      ARC_GAS_RESERVE_USDC
    )
    setDepositAmount(next)
    resetDepositError()
  }

  const handleDeposit = async (e: React.FormEvent) => {
    e.preventDefault()
    setDepositError(null)
    setIsCanceledError(false)

    if (depositing || isSwitchingNetwork) return

    const isConnected = Boolean(walletConnected || walletAddress || connector)
    if (!isConnected) {
      setDepositError('Wallet not connected. Please connect your wallet first.')
      return
    }

    const amountCheck = validateDepositAmount(depositAmount, selectedWalletTokenBalance)
    if (!amountCheck.ok) {
      setDepositError(amountCheck.error || 'Please enter a valid deposit amount')
      return
    }
    const normalizedAmount = depositAmount.trim()

    // Passkey wallets operate natively on Arc network
    if (activeAuthSource === 'passkey' && !isArcChainKey(depositChain)) {
      setDepositError('Passkey wallets currently operate on Arc network. Please select Arc for deposit, or connect MetaMask for other networks.')
      return
    }

    // Step 1: If using EVM and wallet is not on the chosen deposit chain, switch and continue in one flow.
    if (activeAuthSource === 'evm' && isWrongDepositChain) {
      const switched = await handleSwitchDepositNetwork()
      if (!switched) return
    }

    // Create pending broadcast notification
    const broadcastId = addBroadcast({
      type: 'deposit',
      title: 'Depositing to Gateway...',
      status: 'pending',
      badgeText: 'Pending',
      details: {
        amount: normalizedAmount,
        tokenSymbol: DEPOSIT_TOKEN,
        sourceChain: depositChain,
        network: depositChain,
      },
    })

    if (mountedRef.current) setDepositing(true)
    try {
      let txHash = ''
      let approveTxHash: string | undefined
      let networkFee: DepositFee | undefined
      let approvalFee: DepositFee | undefined
      let feeSponsored = false

      if (activeAuthSource === 'passkey' && sendModularUserOp) {
        // ── PASSKEY MSCA DEPOSIT (Circle Modular ERC-4337) ───────────
        const tokenAddress = USDC_ADDRESSES[depositChain]
        const gatewayWallet = ACTIVE_GATEWAY_CONTRACTS.gatewayWallet
        const amountBaseUnits = parseUnits(normalizedAmount, 6)

        const approveData = encodeFunctionData({
          abi: erc20Abi,
          functionName: 'approve',
          args: [gatewayWallet, maxUint256],
        })
        const depositData = encodeFunctionData({
          abi: GATEWAY_WALLET_ABI,
          functionName: 'deposit',
          args: [tokenAddress, amountBaseUnits],
        })

        const res = await sendModularUserOp([
          { to: tokenAddress, data: approveData },
          { to: gatewayWallet, data: depositData },
        ])

        if (!res.success) {
          throw new Error(res.error || 'Passkey deposit operation failed.')
        }
        txHash = res.txHash || ''
        // Passkey MSCA UserOps are gas-sponsored by Circle's Gas Station paymaster, so the
        // on-chain fee is NOT charged to this wallet. Report the sponsorship instead of
        // presenting the paymaster's receipt fee as if the user had paid it.
        feeSponsored = true
      } else if (activeAuthSource === 'ucw' && executeUcwContract) {
        // ── CIRCLE UCW DEPOSIT (Email OTP / User-Controlled Wallet) ─
        const tokenAddress = USDC_ADDRESSES[depositChain]
        const gatewayWallet = ACTIVE_GATEWAY_CONTRACTS.gatewayWallet
        const amountBaseUnits = parseUnits(normalizedAmount, 6)
        const targetBlockchain = mapChainKeyToCircleBlockchain(depositChain)

        // Step 1: Approve Gateway Wallet
        const approveRes = await executeUcwContract({
          contractAddress: tokenAddress,
          abiFunctionSignature: 'approve(address,uint256)',
          abiParameters: [gatewayWallet, amountBaseUnits.toString()],
          blockchain: targetBlockchain,
        })
        if (!approveRes.success) {
          throw new Error(approveRes.error || 'USDC approval challenge was not authorized.')
        }
        approveTxHash = approveRes.txHash

        // Wait for on-chain inclusion of approval to prevent Error -32603 nonce desync
        if (approveRes.txHash && approveRes.txHash.startsWith('0x')) {
          try {
            const publicClient = getResilientPublicClient(depositChain)
            await resilientWaitForReceipt(publicClient, approveRes.txHash as Hex, 'Gateway deposit approval')
          } catch (rErr) {
            console.warn('[DepositPanel UCW] Approval receipt wait warning:', rErr)
          }
        }

        // Step 2: Deposit to Gateway Wallet
        const depositRes = await executeUcwContract({
          contractAddress: gatewayWallet,
          abiFunctionSignature: 'deposit(address,uint256)',
          abiParameters: [tokenAddress, amountBaseUnits.toString()],
          blockchain: targetBlockchain,
        })
        if (!depositRes.success) {
          throw new Error(depositRes.error || 'Gateway deposit challenge was not authorized.')
        }
        txHash = depositRes.txHash || ''

        // Read the REAL fees from both receipts (gasUsed × effectiveGasPrice). The UCW wallet
        // pays its own gas, so these amounts are genuinely charged to the user.
        if (depositRes.txHash && depositRes.txHash.startsWith('0x')) {
          networkFee = await resolvePaidNetworkFee(depositChain, depositRes.txHash).catch(() => undefined)
        }
        if (approveTxHash && approveTxHash.startsWith('0x')) {
          approvalFee = await resolvePaidNetworkFee(depositChain, approveTxHash).catch(() => undefined)
        }
      } else if (connector) {
        // ── STANDARD EVM / WAGMI DEPOSIT (MetaMask, Rainbow) ─────────
        const provider = await connector.getProvider()
        const result = await depositToGateway(
          provider,
          depositChain,
          normalizedAmount,
          CHAIN_DEFS[depositChain],
          DEPOSIT_TOKEN
        )
        approveTxHash = result.approveTxHash || undefined
        txHash = result.depositTxHash
        networkFee = result.depositFee
        approvalFee = result.approvalFee
      } else {
        throw new Error('No active wallet signing method found. Please connect your wallet.')
      }

      // Update broadcast notification to success
      updateBroadcast(broadcastId, {
        type: 'deposit',
        title: 'Deposit Completed Successfully',
        status: 'success',
        badgeText: 'Confirmed',
        details: {
          amount: normalizedAmount,
          tokenSymbol: DEPOSIT_TOKEN,
          sourceChain: depositChain,
          network: depositChain,
          txHash,
          recipient: walletAddress,
        },
      })

      onSuccess({
        amount: normalizedAmount,
        chainKey: depositChain,
        txHash,
        approveTxHash,
        networkFee,
        approvalFee,
        feeSponsored,
      })
    } catch (err: any) {
      console.error('[DepositPanel] Deposit failed:', err)
      const normalized = normalizeAppError(err)
      const isCanceled = normalized.isCanceled

      if (mountedRef.current) {
        setIsCanceledError(isCanceled)
        setDepositError(normalized.message)
      }

      const status = isCanceled ? 'canceled' : 'failed'
      const title = isCanceled ? (normalized.title || 'Deposit Canceled') : (normalized.title || 'Deposit Failed')
      const badgeText = isCanceled ? 'Canceled' : 'Failed'

      updateBroadcast(broadcastId, {
        type: 'deposit',
        title,
        status,
        badgeText,
        message: normalized.message,
        details: {
          amount: normalizedAmount,
          tokenSymbol: DEPOSIT_TOKEN,
          sourceChain: depositChain,
          network: depositChain,
        },
      })
    } finally {
      if (mountedRef.current) setDepositing(false)
    }
  }

  const handleChainListKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const list = chainListRef.current
    if (!list) return
    const options = Array.from(list.querySelectorAll<HTMLElement>('[role="option"]:not([disabled])'))
    if (options.length === 0) return
    const currentIndex = options.findIndex((el) => el === document.activeElement)

    if (e.key === 'ArrowDown') {
      e.preventDefault()
      options[(currentIndex + 1) % options.length]?.focus()
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      options[(currentIndex - 1 + options.length) % options.length]?.focus()
    } else if (e.key === 'Home') {
      e.preventDefault()
      options[0]?.focus()
    } else if (e.key === 'End') {
      e.preventDefault()
      options[options.length - 1]?.focus()
    }
  }

  const submitDisabled =
    depositing || isSwitchingNetwork || (!isWrongDepositChain && isInsufficientWalletBalance)
  const amountErrorVisible = Boolean(depositError) && !isCanceledError && !isInsufficientWalletBalance

  return (
    <div
      id="ub-deposit-panel"
      className="ub-asset-card"
      style={{ marginBottom: 24, animation: 'arc-reveal 0.3s var(--ease-out-smooth)' }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20, gap: 12, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div
            style={{
              width: 42,
              height: 42,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--purple-1)',
            }}
          >
            <ArrowDownRight size={18} aria-hidden="true" />
          </div>
          <span className="arc-eyebrow" style={{ fontSize: 15, color: 'var(--base-colors--white)', fontWeight: 600 }}>
            DEPOSIT
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {(walletBalancesLoading || walletBalancesFetching) && (
            <span style={{ fontSize: 11, color: 'var(--secondary-colors--sky-sync)', display: 'flex', alignItems: 'center', gap: 6, fontFamily: 'var(--font-app)' }}>
              <RefreshCw size={11} className="arcis-spin" aria-hidden="true" /> Refreshing Wallet Balances...
            </span>
          )}
          <button
            type="button"
            onClick={onClose}
            aria-label="Close deposit panel"
            title="Close deposit panel"
            className="ub-action-btn"
            style={{ padding: '6px 10px' }}
          >
            <X size={14} aria-hidden="true" />
          </button>
        </div>
      </div>

      <form onSubmit={handleDeposit} className="space-y-4">
        {/* Chain selector with balances */}
        {/* While open the field raises its stacking order so the dropdown always paints above
            the fields that follow it in the form. */}
        <div
          style={{ position: 'relative', zIndex: showChainDropdown ? 40 : undefined }}
          ref={dropdownRef}
        >
          <label id="ub-deposit-network-label" className="ub-form-label" htmlFor="ub-deposit-network-trigger">
            NETWORK
          </label>
          <button
            ref={chainTriggerRef}
            id="ub-deposit-network-trigger"
            type="button"
            disabled={depositing}
            aria-haspopup="listbox"
            aria-expanded={showChainDropdown}
            aria-controls="ub-deposit-network-listbox"
            aria-labelledby="ub-deposit-network-label ub-deposit-network-trigger"
            className="ub-select-trigger"
            onClick={() => {
              setShowChainDropdown((prev) => {
                const next = !prev
                if (next && walletAddress) {
                  onRefetchWalletBalances()
                }
                return next
              })
            }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown' && !showChainDropdown) {
                e.preventDefault()
                setShowChainDropdown(true)
              }
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
              <NetworkIcon
                name={CHAIN_META[depositChain]?.iconId || 'ethereum'}
                variant={CHAIN_META[depositChain]?.iconId === 'solana' ? 'branded' : 'background'}
                size={24}
              />
              <span style={{ fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {getChainDisplayName(depositChain)}
              </span>
            </div>
            <ChevronDown
              size={16}
              aria-hidden="true"
              style={{
                transition: 'transform 0.25s var(--ease-out-smooth)',
                transform: showChainDropdown ? 'rotate(180deg)' : 'rotate(0deg)',
                color: 'var(--fp-3)',
                flexShrink: 0,
              }}
            />
          </button>

          {showChainDropdown && (
            <div
              ref={chainListRef}
              id="ub-deposit-network-listbox"
              role="listbox"
              aria-labelledby="ub-deposit-network-label"
              className="ub-select-menu"
              onKeyDown={handleChainListKeyDown}
            >
              {sortedDepositChains.map((c) => {
                const isSelected = depositChain === c
                const iconId = CHAIN_META[c]?.iconId || 'ethereum'
                const chainBalanceItem = walletBalances[c]
                const chainUsdcBalance = chainBalanceItem?.usdc || '0.00'
                const isChainLoading = !walletBalancesReady && (walletBalancesLoading || walletBalancesFetching)
                const isLockedForPasskey = activeAuthSource === 'passkey' && !isArcChainKey(c)

                return (
                  <button
                    key={c}
                    type="button"
                    role="option"
                    aria-selected={isSelected}
                    disabled={isLockedForPasskey}
                    title={isLockedForPasskey ? 'Passkey wallets currently operate on Arc network' : undefined}
                    onClick={() => {
                      setDepositChain(c)
                      setShowChainDropdown(false)
                    }}
                    className="ub-select-option"
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
                      <NetworkIcon
                        name={iconId}
                        variant={iconId === 'solana' ? 'branded' : 'background'}
                        size={22}
                      />
                      <span style={{ fontWeight: isSelected ? 600 : 400, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {getChainDisplayName(c)}
                      </span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0, marginLeft: 8 }}>
                      <span
                        style={{
                          fontSize: 12,
                          fontFamily: 'var(--fonts--space-grotesk)',
                          fontWeight: 500,
                          color: isSelected ? '#fff' : 'rgba(255, 255, 255, 0.65)',
                        }}
                      >
                        {isChainLoading ? (
                          <span style={{ opacity: 0.6 }}>...</span>
                        ) : (
                          `${chainUsdcBalance} USDC`
                        )}
                      </span>
                      {isSelected && (
                        <span
                          style={{
                            fontSize: 10,
                            fontFamily: 'var(--font-app)',
                            color: 'var(--purple-1)',
                            background: 'rgba(152, 150, 255, 0.15)',
                            border: '1px solid rgba(152, 150, 255, 0.3)',
                            padding: '2px 6px',
                            borderRadius: 6,
                            fontWeight: 600,
                            letterSpacing: '0.3px',
                          }}
                        >
                          SELECTED
                        </span>
                      )}
                    </div>
                  </button>
                )
              })}
            </div>
          )}
        </div>

        {/* Amount input with available balance & MAX */}
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6, gap: 12 }}>
            <label className="ub-form-label" htmlFor="ub-deposit-amount" style={{ marginBottom: 0 }}>
              AMOUNT
            </label>
            <div style={{ fontSize: 12, fontFamily: 'var(--font-app)', color: 'var(--fp-3)', display: 'flex', alignItems: 'center', gap: 8 }}>
              <span id="ub-deposit-amount-available">
                Available:{' '}
                <strong style={{ color: isBalanceLoading ? 'var(--fp-3)' : '#fff', fontWeight: 600 }}>
                  {isBalanceLoading ? 'Loading...' : `${selectedWalletTokenBalance} USDC`}
                </strong>
              </span>
              <button
                type="button"
                onClick={handleMax}
                disabled={depositing || isBalanceLoading || Number.parseFloat(selectedWalletTokenBalance) <= 0}
                aria-label={`Set maximum deposit amount (${ARC_GAS_RESERVE_USDC} USDC reserved for gas on Arc)`}
                style={{
                  background: 'rgba(152, 150, 255, 0.12)',
                  border: '1px solid rgba(152, 150, 255, 0.3)',
                  color: 'var(--purple-1)',
                  padding: '3px 10px',
                  borderRadius: 99,
                  fontSize: 10,
                  fontWeight: 700,
                  cursor: (depositing || isBalanceLoading || Number.parseFloat(selectedWalletTokenBalance) <= 0) ? 'not-allowed' : 'pointer',
                  opacity: (depositing || isBalanceLoading || Number.parseFloat(selectedWalletTokenBalance) <= 0) ? 0.5 : 1,
                  transition: 'all 0.15s ease',
                }}
              >
                MAX
              </button>
            </div>
          </div>

          <div style={{ position: 'relative' }}>
            <input
              ref={amountInputRef}
              id="ub-deposit-amount"
              type="text"
              inputMode="decimal"
              autoComplete="off"
              spellCheck={false}
              placeholder="0.00"
              value={depositAmount}
              onChange={(e) => handleAmountChange(e.target.value)}
              disabled={depositing}
              aria-invalid={amountErrorVisible || isInsufficientWalletBalance}
              aria-describedby={amountErrorVisible || isInsufficientWalletBalance ? 'ub-deposit-amount-error' : 'ub-deposit-amount-available'}
              className="ub-amount-input"
            />
            <div
              style={{
                position: 'absolute',
                right: 14,
                top: '50%',
                transform: 'translateY(-50%)',
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                pointerEvents: 'none',
              }}
            >
              <img src={UsdcIcon} alt="USDC" style={{ width: 22, height: 22, objectFit: 'contain' }} />
            </div>
          </div>
        </div>

        {isInsufficientWalletBalance && (
          <div
            id="ub-deposit-amount-error"
            role="alert"
            style={{ padding: '10px 14px', background: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.25)', borderRadius: 12, fontSize: 12, color: '#f87171', fontFamily: 'var(--font-app)', display: 'flex', alignItems: 'center', gap: 8 }}
          >
            <AlertTriangle size={14} style={{ flexShrink: 0 }} aria-hidden="true" />
            <span>Deposit amount ({depositAmount} USDC) exceeds your wallet balance of {selectedWalletTokenBalance} USDC on {getChainDisplayName(depositChain)}.</span>
          </div>
        )}

        {amountErrorVisible && (
          <div
            id="ub-deposit-amount-error"
            role="alert"
            style={{
              padding: '10px 14px',
              background: 'rgba(239, 68, 68, 0.1)',
              border: '1px solid rgba(239, 68, 68, 0.25)',
              borderRadius: 12,
              fontSize: 12,
              color: '#f87171',
              fontFamily: 'var(--font-app)',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
            }}
          >
            <AlertTriangle size={14} style={{ flexShrink: 0, color: '#f87171' }} aria-hidden="true" />
            <span>{depositError}</span>
          </div>
        )}

        {isCanceledError && depositError && (
          <div
            role="status"
            style={{
              padding: '10px 14px',
              background: 'rgba(245, 158, 11, 0.1)',
              border: '1px solid rgba(245, 158, 11, 0.25)',
              borderRadius: 12,
              fontSize: 12,
              color: '#fcd34d',
              fontFamily: 'var(--font-app)',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
            }}
          >
            <Ban size={14} style={{ flexShrink: 0, color: '#fbbf24' }} aria-hidden="true" />
            <span>{depositError}</span>
          </div>
        )}

        {showNativeGasWarning && nativeGasToken && (
          <div
            role="status"
            style={{
              padding: '10px 14px',
              background: 'rgba(245, 158, 11, 0.08)',
              border: '1px solid rgba(245, 158, 11, 0.22)',
              borderRadius: 12,
              fontSize: 12,
              color: '#fcd34d',
              fontFamily: 'var(--font-app)',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
            }}
          >
            <Fuel size={14} style={{ flexShrink: 0, color: '#fbbf24' }} aria-hidden="true" />
            <span>
              No {nativeGasToken.symbol} available on {getChainDisplayName(depositChain)} for network fees. Add a small amount of {nativeGasToken.symbol} before depositing.
            </span>
          </div>
        )}

        {/* Gateway settlement info */}
        <div
          style={{
            padding: '8px 12px',
            background: 'rgba(152, 150, 255, 0.05)',
            border: '1px solid rgba(152, 150, 255, 0.15)',
            borderRadius: 12,
            fontSize: 11,
            color: 'var(--fp-3)',
            fontFamily: 'var(--font-app)',
            display: 'flex',
            alignItems: 'center',
            gap: 7,
            lineHeight: 1.4,
          }}
        >
          <Info size={13} style={{ color: 'var(--purple-1)', flexShrink: 0 }} aria-hidden="true" />
          <span>Deposited funds may take up to 60 seconds to reflect in your Gateway balance. Your unified total updates instantly.</span>
        </div>

        <button
          type="submit"
          disabled={submitDisabled}
          style={{
            width: '100%',
            padding: '14px 0',
            borderRadius: 99,
            border: 'none',
            background: submitDisabled
              ? 'rgba(152, 150, 255, 0.3)'
              : isWrongDepositChain
                ? 'linear-gradient(135deg, #4f46e5 0%, #6366f1 100%)'
                : 'linear-gradient(135deg, #9896ff 0%, #7c3aed 100%)',
            color: '#fff',
            fontSize: 14,
            fontFamily: 'var(--font-app)',
            fontWeight: 600,
            cursor: submitDisabled ? 'not-allowed' : 'pointer',
            boxShadow: submitDisabled ? 'none' : '0 6px 24px rgba(152, 150, 255, 0.3)',
            transition: 'all 0.2s var(--ease-out-smooth)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
          }}
        >
          {isSwitchingNetwork ? (
            <>
              <RefreshCw size={15} className="arcis-spin" aria-hidden="true" />
              <span>SWITCHING TO {getChainDisplayName(depositChain).toUpperCase()} IN WALLET...</span>
            </>
          ) : isWrongDepositChain ? (
            <span>SWITCH TO {getChainDisplayName(depositChain).toUpperCase()} &amp; DEPOSIT</span>
          ) : depositing ? (
            'DEPOSITING...'
          ) : (
            'DEPOSIT USDC TO GATEWAY'
          )}
        </button>
      </form>
    </div>
  )
}
