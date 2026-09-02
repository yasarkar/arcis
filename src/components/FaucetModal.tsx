import React, { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import {
  X,
  Droplets,
  ExternalLink,
  AlertCircle,
  RefreshCw,
  Check,
  Sparkles,
  ChevronDown,
  Clipboard,
} from 'lucide-react'
import { NetworkIcon } from '@web3icons/react/dynamic'
import { isAddress } from 'viem'
import { useBroadcast } from './BroadcastNotification'
import CircleIcon from '../assets/Token-Icon/CIRCLE Token.svg'
import UsdcIcon from '../assets/Token-Icon/USDC Token.svg'
import EurcIcon from '../assets/Token-Icon/EURC Token.svg'
import { getChainIconId } from '../config/chainMeta'
import { ARC_METADATA } from '../config/arcChain'

interface FaucetModalProps {
  isOpen: boolean
  onClose: () => void
  connectedAddress?: string
  onSuccess?: () => void
  addToast?: (
    title: string,
    description: string,
    type?: 'info' | 'success' | 'warning' | 'error' | 'pending',
    txHash?: string,
    network?: string
  ) => string
}

interface NativeTokenConfig {
  iconId: string
  name: string
  primaryColor: string
  gradient: string
  borderColor: string
  glowColor: string
  badgeColor: string
}

const NATIVE_TOKEN_CONFIG: Record<string, NativeTokenConfig> = {
  ETH: {
    iconId: 'ethereum',
    name: 'ETH',
    primaryColor: '#8b5cf6',
    gradient: 'linear-gradient(135deg, rgba(139, 92, 246, 0.25) 0%, rgba(124, 58, 237, 0.15) 100%)',
    borderColor: 'rgba(139, 92, 246, 0.5)',
    glowColor: 'rgba(139, 92, 246, 0.25)',
    badgeColor: '#c4b5fd',
  },
  POL: {
    iconId: 'polygon-amoy',
    name: 'POL',
    primaryColor: '#a855f7',
    gradient: 'linear-gradient(135deg, rgba(168, 85, 247, 0.25) 0%, rgba(147, 51, 234, 0.15) 100%)',
    borderColor: 'rgba(168, 85, 247, 0.5)',
    glowColor: 'rgba(168, 85, 247, 0.25)',
    badgeColor: '#d8b4fe',
  },
  AVAX: {
    iconId: 'avalanche-fuji',
    name: 'AVAX',
    primaryColor: '#ef4444',
    gradient: 'linear-gradient(135deg, rgba(239, 68, 68, 0.25) 0%, rgba(220, 38, 38, 0.15) 100%)',
    borderColor: 'rgba(239, 68, 68, 0.5)',
    glowColor: 'rgba(239, 68, 68, 0.25)',
    badgeColor: '#fca5a5',
  },
  SOL: {
    iconId: 'solana',
    name: 'SOL',
    primaryColor: '#14b8a6',
    gradient: 'linear-gradient(135deg, rgba(20, 184, 166, 0.25) 0%, rgba(13, 148, 136, 0.15) 100%)',
    borderColor: 'rgba(20, 184, 166, 0.5)',
    glowColor: 'rgba(20, 184, 166, 0.25)',
    badgeColor: '#5eead4',
  },
}

interface FaucetNetwork {
  id: string
  name: string
  blockchainCode: string
  iconId: string
  nativeSymbol: string
  isSolana?: boolean
}

const SUPPORTED_FAUCET_NETWORKS: FaucetNetwork[] = [
  {
    id: 'arc-testnet',
    name: 'Arc Testnet',
    blockchainCode: 'ARC-TESTNET',
    iconId: 'arc',
    nativeSymbol: 'USDC',
  },
  {
    id: 'base-sepolia',
    name: 'Base Sepolia',
    blockchainCode: 'BASE-SEPOLIA',
    iconId: 'base-sepolia',
    nativeSymbol: 'ETH',
  },
  {
    id: 'eth-sepolia',
    name: 'Ethereum Sepolia',
    blockchainCode: 'ETH-SEPOLIA',
    iconId: 'ethereum',
    nativeSymbol: 'ETH',
  },
  {
    id: 'arb-sepolia',
    name: 'Arbitrum Sepolia',
    blockchainCode: 'ARB-SEPOLIA',
    iconId: 'arbitrum-sepolia',
    nativeSymbol: 'ETH',
  },
  {
    id: 'op-sepolia',
    name: 'Optimism Sepolia',
    blockchainCode: 'OP-SEPOLIA',
    iconId: 'optimism-sepolia',
    nativeSymbol: 'ETH',
  },
  {
    id: 'matic-amoy',
    name: 'Polygon PoS Amoy',
    blockchainCode: 'MATIC-AMOY',
    iconId: 'polygon-amoy',
    nativeSymbol: 'POL',
  },
  {
    id: 'avax-fuji',
    name: 'Avalanche Fuji',
    blockchainCode: 'AVAX-FUJI',
    iconId: 'avalanche-fuji',
    nativeSymbol: 'AVAX',
  },
  {
    id: 'uni-sepolia',
    name: 'Unichain Sepolia',
    blockchainCode: 'UNI-SEPOLIA',
    iconId: 'unichain',
    nativeSymbol: 'ETH',
  },
  {
    id: 'sol-devnet',
    name: 'Solana Devnet',
    blockchainCode: 'SOL-DEVNET',
    iconId: 'solana',
    nativeSymbol: 'SOL',
    isSolana: true,
  },
]

const isValidEvmAddress = (addr: string): boolean => {
  if (!addr) return false
  const trimmed = addr.trim()
  return isAddress(trimmed) || /^0x[a-fA-F0-9]{40}$/.test(trimmed)
}

export default function FaucetModal({
  isOpen,
  onClose,
  connectedAddress = '',
  onSuccess,
}: FaucetModalProps) {
  const { addBroadcast, updateBroadcast } = useBroadcast()
  const [recipientAddress, setRecipientAddress] = useState(connectedAddress)
  const [recipientError, setRecipientError] = useState<string | null>(null)
  const [selectedNetwork, setSelectedNetwork] = useState<FaucetNetwork>(
    SUPPORTED_FAUCET_NETWORKS[0]
  )
  const [isNetworkDropdownOpen, setIsNetworkDropdownOpen] = useState(false)

  // Token options
  const [requestUsdc, setRequestUsdc] = useState(true)
  const [requestEurc, setRequestEurc] = useState(false)
  const [requestNative, setRequestNative] = useState(true)

  // States
  const [isLoading, setIsLoading] = useState(false)

  const isArcChain =
    selectedNetwork.blockchainCode === 'ARC-TESTNET' ||
    selectedNetwork.id === 'arc-testnet'

  const nativeConfig =
    NATIVE_TOKEN_CONFIG[selectedNetwork.nativeSymbol] || NATIVE_TOKEN_CONFIG['ETH']

  const isRecipientValid = recipientAddress
    ? selectedNetwork.isSolana
      ? recipientAddress.trim().length >= 32
      : isValidEvmAddress(recipientAddress)
    : false

  // Synchronize connected address when modal opens or connected address changes
  useEffect(() => {
    if (isOpen && connectedAddress) {
      setRecipientAddress(connectedAddress)
      setRecipientError(null)
    }
  }, [isOpen, connectedAddress])

  if (!isOpen) return null

  const handlePasteAddress = async () => {
    try {
      const text = await navigator.clipboard.readText()
      if (text) {
        const val = text.trim()
        setRecipientAddress(val)
        if (!selectedNetwork.isSolana && !isValidEvmAddress(val)) {
          setRecipientError('Please enter a valid EVM address (e.g. 0x...).')
        } else {
          setRecipientError(null)
        }
      }
    } catch {
      // Fallback
    }
  }

  const handleUseConnected = () => {
    if (connectedAddress) {
      setRecipientAddress(connectedAddress)
      setRecipientError(null)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    const trimmedAddress = recipientAddress.trim()
    if (!trimmedAddress) {
      setRecipientError('Recipient address is required.')
      return
    }

    if (!selectedNetwork.isSolana && !isValidEvmAddress(trimmedAddress)) {
      setRecipientError('Please enter a valid EVM address (42-character 0x string).')
      return
    }

    const isArc =
      selectedNetwork.blockchainCode === 'ARC-TESTNET' ||
      selectedNetwork.id === 'arc-testnet'

    if (isArc) {
      if (!requestUsdc && !requestEurc) {
        addBroadcast({
          title: 'No Token Selected',
          status: 'failed',
          badgeText: 'Faucet',
          message: 'Please select USDC or EURC to request.',
          autoClose: true,
          autoCloseDelay: 5000,
        })
        return
      }
    } else {
      if (!requestUsdc && !requestEurc && !requestNative) {
        addBroadcast({
          title: 'No Token Selected',
          status: 'failed',
          badgeText: 'Faucet',
          message: 'Please select at least one token to request.',
          autoClose: true,
          autoCloseDelay: 5000,
        })
        return
      }
    }

    const selectedTokenList: string[] = []
    if (requestUsdc) selectedTokenList.push('USDC')
    if (requestEurc) selectedTokenList.push('EURC')
    if (!isArc && requestNative) selectedTokenList.push(selectedNetwork.nativeSymbol)
    const tokenSummary = selectedTokenList.join(' + ')

    setIsLoading(true)
    setRecipientError(null)

    const broadcastId = addBroadcast({
      title: `Requesting ${tokenSummary} Faucet...`,
      status: 'pending',
      badgeText: 'Faucet',
      message: `Sending faucet drip request on ${selectedNetwork.name}...`,
      details: {
        isFaucet: true,
        faucetTokens: tokenSummary,
        network: selectedNetwork.name,
        recipient: trimmedAddress ? `${trimmedAddress.slice(0, 6)}...${trimmedAddress.slice(-4)}` : undefined,
      },
    })

    try {
      const response = await fetch('/api/faucet', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          address: trimmedAddress,
          blockchain: selectedNetwork.blockchainCode,
          usdc: requestUsdc,
          eurc: requestEurc,
          native: isArc ? requestUsdc : requestNative,
        }),
      })

      const result = await response.json()

      if (!response.ok || !result.success) {
        const errorDetail =
          result.error ||
          result.message ||
          result.details?.message ||
          'Failed to request testnet tokens.'

        updateBroadcast(broadcastId, {
          title: 'Faucet Request Failed',
          status: 'failed',
          badgeText: 'Failed',
          message: errorDetail,
          details: {
            isFaucet: true,
            faucetTokens: tokenSummary,
            network: selectedNetwork.name,
            recipient: trimmedAddress ? `${trimmedAddress.slice(0, 8)}...${trimmedAddress.slice(-6)}` : undefined,
          },
          autoClose: true,
          autoCloseDelay: 7000,
        })
        return
      }

      // Success
      updateBroadcast(broadcastId, {
        title: 'Faucet Request Successful! 🎉',
        status: 'success',
        badgeText: 'Success',
        message: `Your requested ${tokenSummary} on ${selectedNetwork.name} have been sent to your wallet.`,
        details: {
          isFaucet: true,
          faucetTokens: tokenSummary,
          network: selectedNetwork.name,
          recipient: trimmedAddress ? `${trimmedAddress.slice(0, 6)}...${trimmedAddress.slice(-4)}` : undefined,
        },
        autoClose: true,
        autoCloseDelay: 6000,
      })

      if (onSuccess) {
        onSuccess()
      }
    } catch (err: any) {
      console.error('Faucet request error:', err)
      const errMessage =
        err.message || 'An error occurred while connecting to the server.'

      updateBroadcast(broadcastId, {
        title: 'Connection Error',
        status: 'failed',
        badgeText: 'Failed',
        message: errMessage,
        autoClose: true,
        autoCloseDelay: 7000,
      })
    } finally {
      setIsLoading(false)
    }
  }

  const modalContent = (
    <div
      className="fixed inset-0 z-[999] flex items-center justify-center p-4 sm:p-6 overflow-y-auto"
      style={{
        background: 'rgba(5, 7, 15, 0.78)',
        backdropFilter: 'blur(16px)',
        WebkitBackdropFilter: 'blur(16px)',
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && !isLoading) {
          onClose()
        }
      }}
    >
      {/* Modal Container */}
      <div
        className="relative w-full max-w-lg rounded-3xl overflow-hidden shadow-2xl transition-all border animate-in fade-in zoom-in-95 duration-200"
        style={{
          background: 'linear-gradient(180deg, rgba(20, 24, 44, 0.95) 0%, rgba(12, 14, 26, 0.98) 100%)',
          borderColor: 'rgba(255, 255, 255, 0.1)',
          boxShadow: '0 25px 60px -15px rgba(0, 0, 0, 0.8), 0 0 40px rgba(99, 102, 241, 0.15)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Glow ambient header accent */}
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-3/4 h-24 bg-gradient-to-r from-blue-500/20 via-indigo-500/30 to-purple-500/20 blur-3xl pointer-events-none" />

        {/* Modal Header */}
        <div className="relative flex items-center justify-between px-6 pt-6 pb-4 border-b border-white/10">
          <div className="flex items-center gap-3">
            <div
              className="w-10 h-10 rounded-2xl flex items-center justify-center shadow-lg"
            >
              <Droplets className="w-5 h-5 text-indigo-400" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3
                  className="text-base font-bold text-white tracking-wide"
                  style={{ fontFamily: 'var(--font-app)' }}
                >
                  Request Testnet Tokens
                </h3>
              </div>
              <p className="text-xs text-slate-400">
                Claim Testnet USDC, EURC, and Native gas tokens directly.
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            disabled={isLoading}
            className="text-slate-400 hover:text-white p-2 rounded-full hover:bg-white/5 transition-colors cursor-pointer disabled:opacity-50"
            title="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Form Body with Frosted Glass Overlay */}
        <div className="relative p-6">
          {/* Underlying Form (Frosted / Blurred) */}
          <form onSubmit={handleSubmit} className="space-y-5 opacity-25 blur-[3px] pointer-events-none select-none" tabIndex={-1} aria-hidden="true">
            {/* 1. Recipient Address Section */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs mb-1.5">
                <label
                  className="block text-xs font-semibold tracking-wide text-slate-300 ml-3"
                  style={{ fontFamily: 'var(--font-app)' }}
                >
                  RECIPIENT ADDRESS
                </label>
              </div>

              <div className="relative flex items-center">
                <input
                  type="text"
                  disabled
                  value={recipientAddress || '0x...'}
                  placeholder="0x..."
                  className="w-full rounded-2xl pl-4 pr-16 py-3.5 text-xs md:text-sm font-mono text-white bg-[rgba(15,18,33,0.85)] border border-white/10"
                />
              </div>
            </div>

            {/* 2. Target Blockchain Network Selector */}
            <div className="space-y-1.5">
              <label
                className="block text-xs font-semibold tracking-wide text-slate-300 mb-1.5 ml-3"
                style={{ fontFamily: 'var(--font-app)' }}
              >
                CHAIN
              </label>

              <div className="relative">
                <div
                  className="w-full flex items-center justify-between px-4 py-3 rounded-2xl"
                  style={{
                    border: '1px solid rgba(255, 255, 255, 0.1)',
                    background: 'rgba(15, 18, 33, 0.85)',
                  }}
                >
                  <div className="flex items-center gap-3">
                    <div className="w-6 h-6 rounded-full flex items-center justify-center p-0.5 overflow-hidden">
                      <NetworkIcon
                        name={getChainIconId(selectedNetwork.iconId)}
                        variant={selectedNetwork.isSolana ? 'branded' : 'background'}
                        size={18}
                      />
                    </div>
                    <div className="text-sm font-semibold text-white tracking-wide">
                      {selectedNetwork.name}
                    </div>
                  </div>
                  <ChevronDown className="w-4 h-4 text-slate-400" />
                </div>
              </div>
            </div>

            {/* 3. Token Selection Chips */}
            <div className="grid grid-cols-2 gap-3">
              <div
                className="flex flex-col items-center gap-2 p-4 rounded-2xl border"
                style={{
                  background: 'linear-gradient(135deg, rgba(39, 117, 202, 0.2) 0%, rgba(59, 130, 246, 0.12) 100%)',
                  borderColor: 'rgba(59, 130, 246, 0.5)',
                }}
              >
                <img src={UsdcIcon} alt="USDC" className="w-7 h-7 object-contain" />
                <span className="text-xs font-bold text-white">USDC</span>
              </div>

              <div
                className="flex flex-col items-center gap-2 p-4 rounded-2xl border"
                style={{
                  background: 'rgba(15, 18, 33, 0.6)',
                  borderColor: 'rgba(255, 255, 255, 0.08)',
                }}
              >
                <img src={EurcIcon} alt="EURC" className="w-7 h-7 object-contain" />
                <span className="text-xs font-bold text-white">EURC</span>
              </div>
            </div>

            {/* Submit Action Button */}
            <div
              className="w-full flex items-center justify-center gap-2 py-3.5 px-6 rounded-2xl text-sm font-semibold text-white"
              style={{
                background:
                  'linear-gradient(135deg, rgba(99, 102, 241, 0.9) 0%, rgba(139, 92, 246, 0.9) 50%, rgba(59, 130, 246, 0.9) 100%)',
              }}
            >
              <Droplets className="w-4 h-4 text-white" />
              <span>Request Tokens</span>
            </div>
          </form>

          {/* Frosted Glass Overlay Card with "Live on Mainnet" */}
          <div
            className="absolute inset-3 sm:inset-4 rounded-3xl flex flex-col items-center justify-center p-6 text-center z-20 overflow-hidden"
            style={{
              background: 'linear-gradient(135deg, rgba(15, 18, 36, 0.75) 0%, rgba(8, 10, 22, 0.85) 100%)',
              backdropFilter: 'blur(16px)',
              WebkitBackdropFilter: 'blur(16px)',
              border: '1px solid rgba(255, 255, 255, 0.12)',
              boxShadow: '0 8px 32px 0 rgba(0, 0, 0, 0.5), inset 0 0 24px rgba(99, 102, 241, 0.08)',
            }}
          >
            {/* Ambient subtle glow inside card */}
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-48 h-32 bg-indigo-500/20 rounded-full blur-3xl pointer-events-none" />

            <div className="relative flex flex-col items-center gap-3 max-w-xs">
              {/* Centered Main Title: Live on Mainnet */}
              <h4
                className="text-2xl sm:text-3xl font-extrabold tracking-tight text-white"
                style={{
                  fontFamily: 'var(--font-app)',
                  textShadow: '0 2px 14px rgba(99, 102, 241, 0.5)',
                  background: 'linear-gradient(135deg, #ffffff 30%, #c7d2fe 70%, #818cf8 100%)',
                  WebkitBackgroundClip: 'text',
                  WebkitTextFillColor: 'transparent',
                }}
              >
                Live on Mainnet
              </h4>

              {/* Descriptive Subtext */}
              <p className="text-xs text-slate-300/85 leading-relaxed">
                Direct in-app faucet streaming will be live on Mainnet. Please use the official Circle Faucet link below for Testnet tokens.
              </p>
            </div>
          </div>
        </div>

        {/* Modal Bottom / Fallback Section: Official Circle Faucet */}
        <div
          className="px-6 py-4 border-t flex flex-col sm:flex-row items-center justify-between gap-3"
          style={{
            background: 'rgba(10, 13, 24, 0.65)',
            borderColor: 'rgba(255, 255, 255, 0.08)',
          }}
        >
          <div className="flex items-center gap-2.5 text-left w-full sm:w-auto">
            <img src={CircleIcon} alt="Circle" className="w-5 h-5 object-contain flex-shrink-0" />
            <div className="text-[11px] text-slate-400">
              <span className="text-slate-200 font-medium block">Official Web Faucet</span>
              For manual requests and additional networks
            </div>
          </div>

          <a
            href={ARC_METADATA.faucetUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="hidden md:flex ub-action-btn"
            title="Official Circle Faucet"
          >
            <span>Official Circle Faucet</span>
            <ExternalLink className="w-3.5 h-3.5 opacity-70" />
          </a>
        </div>
      </div>
    </div>
  )

  return createPortal(modalContent, document.body)
}
