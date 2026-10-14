import React, { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useClearOnWalletDisconnect } from '../../hooks/useClearOnWalletDisconnect'
import { useBodyScrollLock } from '../../hooks/useBodyScrollLock'
import { Search, X, Check, Plus, ArrowLeft, Loader2, AlertCircle, Trash2 } from 'lucide-react'
import { TokenIcon, NetworkIcon } from '@web3icons/react/dynamic'
import { ChainIcon } from '../common/ChainIcon'
import { formatUnits, erc20Abi, isAddress } from 'viem'
import { getResilientPublicClient, resilientReadContract } from '../../services/rpc'
import {
  getStoredCustomTokens,
  saveCustomToken,
  type StoredCustomToken,
} from '../../utils/customTokensStorage'

export interface TokenItem {
  symbol: string
  name: string
  icon?: string
  web3TokenSymbol?: string
  balance?: string
  address?: string
}

export interface CustomTokenInfo {
  address: string
  symbol: string
  decimals: number
  balance: string
}

interface TokenSelectorModalProps {
  isOpen: boolean
  onClose: () => void
  tokens: TokenItem[]
  selectedToken: string
  onSelectToken: (symbol: string) => void
  /** Shows an "import custom ERC-20" entry that activates custom-token mode. */
  onSelectCustom?: () => void
  /** Dedicated callback when user imports and selects a custom token from within the modal */
  onSelectCustomToken?: (token: CustomTokenInfo) => void
  title?: string
  /** Current network key (e.g. 'Arc_Testnet') for verifying custom ERC-20 contracts */
  chainKey?: string
  /** Connected wallet address for checking user's custom token balance */
  connectedAddress?: string
  /** Currently active custom token info, if already selected */
  selectedCustomToken?: CustomTokenInfo | null
}

function formatTokenBalance(raw: bigint, decimals: number): string {
  const formatted = formatUnits(raw, decimals)
  const [whole, frac] = formatted.split('.')
  if (!frac) return whole
  const trimmed = frac.slice(0, Math.min(decimals, 6)).replace(/0+$/, '')
  return trimmed ? `${whole}.${trimmed}` : whole
}

export const TokenSelectorModal: React.FC<TokenSelectorModalProps> = ({
  isOpen,
  onClose,
  tokens,
  selectedToken,
  onSelectToken,
  onSelectCustom,
  onSelectCustomToken,
  title = 'Select a token',
  chainKey = 'Arc_Testnet',
  connectedAddress,
  selectedCustomToken,
}) => {
  const [view, setView] = useState<'list' | 'custom'>('list')
  const [search, setSearch] = useState('')
  const searchInputRef = useRef<HTMLInputElement>(null)
  const customInputRef = useRef<HTMLInputElement>(null)

  useBodyScrollLock(isOpen)

  const [customAddress, setCustomAddress] = useState('')
  const [isInspecting, setIsInspecting] = useState(false)
  const [inspectionResult, setInspectionResult] = useState<CustomTokenInfo | null>(null)
  const [inspectionError, setInspectionError] = useState<string | null>(null)

  const [storedTokens, setStoredTokens] = useState<StoredCustomToken[]>([])
  const [storedBalances, setStoredBalances] = useState<Record<string, string>>({})

  // Load stored custom tokens for active chain
  useEffect(() => {
    if (isOpen) {
      setStoredTokens(getStoredCustomTokens(chainKey))
    }
  }, [isOpen, chainKey])

  // Fetch live wallet balances for stored custom tokens on active chain
  useEffect(() => {
    if (!isOpen || storedTokens.length === 0 || !connectedAddress || !isAddress(connectedAddress)) {
      return
    }

    let isMounted = true
    const fetchStoredBalances = async () => {
      try {
        const client = getResilientPublicClient(chainKey)
        const entries = await Promise.allSettled(
          storedTokens.map(async (t) => {
            const bal = await resilientReadContract(client, {
              address: t.address as `0x${string}`,
              abi: erc20Abi,
              functionName: 'balanceOf',
              args: [connectedAddress as `0x${string}`],
            })
            return {
              address: t.address,
              balance: formatTokenBalance(bal as bigint, t.decimals),
            }
          })
        )

        if (isMounted) {
          const map: Record<string, string> = {}
          entries.forEach((res, i) => {
            if (res.status === 'fulfilled') {
              map[res.value.address] = res.value.balance
            } else {
              map[storedTokens[i].address] = '0.00'
            }
          })
          setStoredBalances(map)
        }
      } catch (err) {
        console.warn('[TokenSelectorModal] Error fetching stored tokens balance:', err)
      }
    }

    fetchStoredBalances()
    return () => {
      isMounted = false
    }
  }, [isOpen, chainKey, connectedAddress, storedTokens])

  useClearOnWalletDisconnect(() => {
    setSearch('')
    setCustomAddress('')
    setInspectionResult(null)
    setInspectionError(null)
    setView('list')
  })

  useEffect(() => {
    if (isOpen) {
      setSearch('')
      setView('list')
      setInspectionError(null)
      if (selectedCustomToken) {
        setCustomAddress(selectedCustomToken.address)
        setInspectionResult(selectedCustomToken)
      } else {
        setCustomAddress('')
        setInspectionResult(null)
      }
      const timer = setTimeout(() => searchInputRef.current?.focus(), 50)
      return () => clearTimeout(timer)
    }
  }, [isOpen, selectedCustomToken])

  useEffect(() => {
    if (view === 'custom') {
      const timer = setTimeout(() => customInputRef.current?.focus(), 50)
      return () => clearTimeout(timer)
    }
  }, [view])

  // ESC key to close
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        if (view === 'custom') {
          setView('list')
        } else {
          onClose()
        }
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, onClose, view])

  // Custom ERC-20 live inspection effect
  useEffect(() => {
    if (!isOpen || view !== 'custom') return

    const trimmed = customAddress.trim()
    if (!trimmed) {
      setInspectionResult(null)
      setInspectionError(null)
      setIsInspecting(false)
      return
    }

    if (!isAddress(trimmed)) {
      setInspectionResult(null)
      setInspectionError('Invalid address format. Enter a 42-character 0x hex address.')
      setIsInspecting(false)
      return
    }

    let isMounted = true
    setIsInspecting(true)
    setInspectionError(null)

    const timer = setTimeout(async () => {
      try {
        const client = getResilientPublicClient(chainKey)
        const [symbol, decimals, balance] = await Promise.all([
          resilientReadContract(client, {
            address: trimmed as `0x${string}`,
            abi: erc20Abi,
            functionName: 'symbol',
          }),
          resilientReadContract(client, {
            address: trimmed as `0x${string}`,
            abi: erc20Abi,
            functionName: 'decimals',
          }),
          connectedAddress && isAddress(connectedAddress)
            ? resilientReadContract(client, {
                address: trimmed as `0x${string}`,
                abi: erc20Abi,
                functionName: 'balanceOf',
                args: [connectedAddress as `0x${string}`],
              })
            : Promise.resolve(0n),
        ])

        if (isMounted) {
          const dec = Number(decimals)
          const formattedBal = formatTokenBalance(balance as bigint, dec)
          setInspectionResult({
            address: trimmed,
            symbol: String(symbol),
            decimals: dec,
            balance: formattedBal,
          })
          setIsInspecting(false)
        }
      } catch (err) {
        if (isMounted) {
          console.error('[TokenSelectorModal] ERC-20 inspection failed:', err)
          setInspectionResult(null)
          setInspectionError('Could not verify ERC-20 contract on this network. Please check the contract address.')
          setIsInspecting(false)
        }
      }
    }, 350)

    return () => {
      isMounted = false
      clearTimeout(timer)
    }
  }, [customAddress, chainKey, connectedAddress, view, isOpen])

  if (!isOpen || typeof document === 'undefined') return null

  const trimmedSearch = search.trim()
  const isSearchAddress = isAddress(trimmedSearch)

  const filteredTokens = tokens.filter((t) => {
    const query = trimmedSearch.toLowerCase()
    return (
      t.symbol.toLowerCase().includes(query) ||
      t.name.toLowerCase().includes(query)
    )
  })

  const chainDisplayName = chainKey.replace(/_/g, ' ')
  const supportsCustom = Boolean(onSelectCustomToken || onSelectCustom)

  const filteredStoredTokens = supportsCustom
    ? storedTokens.filter((st) => {
        const query = trimmedSearch.toLowerCase()
        return (
          st.symbol.toLowerCase().includes(query) ||
          st.address.toLowerCase().includes(query) ||
          (st.name && st.name.toLowerCase().includes(query))
        )
      })
    : []

  return createPortal(
    <div
      className="fixed inset-0 z-[300] flex items-center justify-center p-4 bg-black/75 backdrop-blur-md animate-fade-in overscroll-contain touch-none"
      onClick={onClose}
    >
      <div
        className="w-full max-w-[400px] rounded-3xl p-5 shadow-2xl relative border flex flex-col space-y-4 animate-scale-in"
        style={{
          background: 'linear-gradient(180deg, rgba(16, 20, 36, 0.98) 0%, rgba(10, 12, 22, 0.99) 100%)',
          borderColor: 'rgba(255, 255, 255, 0.1)',
          boxShadow: '0 24px 64px -12px rgba(0, 0, 0, 0.9), 0 0 32px rgba(99, 102, 241, 0.12)',
          fontFamily: 'var(--font-app)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {view === 'custom' ? (
          <>
            {/* Custom Token View Header */}
            <div className="flex items-center justify-between pb-3 border-b border-white/[0.06]">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setView('list')
                    setInspectionError(null)
                  }}
                  className="w-8 h-8 rounded-full flex items-center justify-center text-slate-400 hover:text-white bg-white/[0.04] hover:bg-white/[0.1] border border-white/[0.06] transition-all cursor-pointer"
                  title="Back to token list"
                >
                  <ArrowLeft className="w-4 h-4" />
                </button>
                <h3 className="text-base font-semibold text-white tracking-wide">
                  Import Custom Token
                </h3>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="w-8 h-8 rounded-full flex items-center justify-center text-slate-400 hover:text-white bg-white/[0.04] hover:bg-white/[0.1] border border-white/[0.06] transition-all cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Network Notice */}
            <div className="flex items-center justify-between px-3 py-1.5 rounded-xl bg-white/[0.03] border border-white/[0.06] text-[11px] text-slate-400">
              <span>Active Network</span>
              <div className="flex items-center gap-1.5 font-semibold text-indigo-300">
                <div className="w-3.5 h-3.5 rounded-full overflow-hidden flex items-center justify-center shrink-0">
                  <ChainIcon
                    chainKeyOrIconId={chainKey}
                    name={chainDisplayName}
                    size={14}
                    className="rounded-full"
                  />
                </div>
                <span>{chainDisplayName}</span>
              </div>
            </div>

            {/* Contract Address Input */}
            <div className="space-y-1.5">
              <label className="text-[11px] font-medium text-slate-300">
                Contract Address
              </label>
              <div className="relative">
                <input
                  ref={customInputRef}
                  type="text"
                  placeholder="0x..."
                  value={customAddress}
                  onChange={(e) => setCustomAddress(e.target.value.trim())}
                  className="w-full rounded-xl px-3.5 py-2.5 text-xs font-mono text-white bg-white/[0.04] hover:bg-white/[0.06] focus:bg-white/[0.08] border border-white/[0.08] focus:border-indigo-500/50 focus:outline-none transition-all pr-14"
                />
                {customAddress && (
                  <button
                    type="button"
                    onClick={() => {
                      setCustomAddress('')
                      setInspectionResult(null)
                      setInspectionError(null)
                    }}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white text-xs px-1.5 py-0.5 rounded cursor-pointer transition-colors"
                  >
                    Clear
                  </button>
                )}
              </div>
            </div>

            {/* Inspection Status / Preview Card */}
            {isInspecting && (
              <div className="p-3.5 rounded-2xl bg-indigo-500/10 border border-indigo-500/25 flex items-center gap-2.5 text-xs text-indigo-300 animate-fade-in">
                <Loader2 className="w-4 h-4 animate-spin shrink-0 text-indigo-400" />
                <span>Querying ERC-20 contract properties...</span>
              </div>
            )}

            {inspectionError && !isInspecting && (
              <div className="p-3.5 rounded-2xl bg-rose-500/10 border border-rose-500/25 flex items-start gap-2.5 text-xs text-rose-400 animate-fade-in">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <span className="leading-relaxed">{inspectionError}</span>
              </div>
            )}

            {inspectionResult && !isInspecting && (
              <div className="p-3.5 rounded-2xl bg-white/[0.04] border border-indigo-500/30 space-y-2.5 animate-fade-in">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <div className="w-9 h-9 rounded-full bg-indigo-500/20 border border-indigo-500/40 flex items-center justify-center font-bold text-sm text-indigo-300 shrink-0">
                      T
                    </div>
                    <div>
                      <div className="font-semibold text-xs text-white">
                        {inspectionResult.symbol}
                      </div>
                      <div className="text-[10px] text-slate-400">
                        {inspectionResult.decimals} decimals
                      </div>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-[10px] text-slate-400">Wallet Balance</div>
                    <div className="text-xs font-semibold text-slate-200 tabular-nums">
                      {inspectionResult.balance} {inspectionResult.symbol}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Submit / Action Button */}
            <div className="pt-2">
              <button
                type="button"
                disabled={!inspectionResult || isInspecting}
                onClick={() => {
                  if (inspectionResult) {
                    saveCustomToken({
                      address: inspectionResult.address,
                      symbol: inspectionResult.symbol,
                      decimals: inspectionResult.decimals,
                      chainKey,
                    })
                    setStoredTokens(getStoredCustomTokens(chainKey))
                    if (onSelectCustomToken) {
                      onSelectCustomToken(inspectionResult)
                    } else if (onSelectCustom) {
                      onSelectCustom()
                    }
                    onClose()
                  }
                }}
                className={`w-full py-3 rounded-2xl font-semibold text-xs tracking-wider uppercase transition-all flex items-center justify-center gap-2 ${
                  inspectionResult && !isInspecting
                    ? 'bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg shadow-indigo-500/25 cursor-pointer'
                    : 'bg-white/[0.05] text-slate-500 border border-white/[0.06] cursor-not-allowed'
                }`}
              >
                {inspectionResult
                  ? `Import ${inspectionResult.symbol}`
                  : 'Enter Valid Contract Address'}
              </button>
            </div>
          </>
        ) : (
          <>
            {/* Modal Header */}
            <div className="flex items-center justify-between pb-3 border-b border-white/[0.06]">
              <h3 className="text-base font-semibold text-white tracking-wide">
                {title}
              </h3>
              <button
                type="button"
                onClick={onClose}
                className="w-8 h-8 rounded-full flex items-center justify-center text-slate-400 hover:text-white bg-white/[0.04] hover:bg-white/[0.1] border border-white/[0.06] transition-all cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Search Input */}
            <div className="relative">
              <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                ref={searchInputRef}
                type="text"
                placeholder="Search by name, symbol, or paste address..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full rounded-xl pl-9.5 pr-4 py-2.5 text-xs text-white bg-white/[0.04] hover:bg-white/[0.06] focus:bg-white/[0.08] border border-white/[0.08] focus:border-indigo-500/50 focus:outline-none transition-all"
              />
            </div>

            {/* Fast detected contract card when address is pasted in search */}
            {isSearchAddress && supportsCustom && (
              <div className="p-3 rounded-2xl bg-indigo-500/10 border border-indigo-500/25 flex items-center justify-between animate-fade-in">
                <div className="min-w-0 pr-2">
                  <div className="text-xs font-semibold text-white">ERC-20 Address Detected</div>
                  <div className="text-[10px] text-indigo-300 font-mono truncate">{trimmedSearch}</div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setCustomAddress(trimmedSearch)
                    setView('custom')
                  }}
                  className="px-3 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium shrink-0 transition-all cursor-pointer"
                >
                  Inspect
                </button>
              </div>
            )}

            {/* Custom ERC-20 import entry */}
            {supportsCustom && (
              <button
                type="button"
                onClick={() => {
                  setView('custom')
                  setInspectionError(null)
                }}
                className="w-full px-5 py-2.5 rounded-xl border border-dashed border-white/[0.12] hover:border-indigo-500/40 hover:bg-white/[0.04] text-[11px] text-slate-400 hover:text-indigo-300 transition-all cursor-pointer flex items-center justify-between group"
              >
                <div className="flex items-center gap-3">
                  <Plus className="w-4 h-4 text-indigo-400 group-hover:rotate-90 transition-transform" />
                  <span>Import custom ERC-20 contract…</span>
                </div>
              </button>
            )}

            {/* Token List */}
            <div className="max-h-[300px] overflow-y-auto overscroll-contain space-y-1 pr-1">
              {/* Stored Custom Tokens */}
              {supportsCustom &&
                filteredStoredTokens.map((st) => {
                  const isSelected =
                    (selectedCustomToken &&
                      selectedCustomToken.address.toLowerCase() === st.address.toLowerCase()) ||
                    selectedToken === st.symbol
                  const bal =
                    storedBalances[st.address] ||
                    (selectedCustomToken?.address.toLowerCase() === st.address.toLowerCase()
                      ? selectedCustomToken.balance
                      : '0.00')

                  return (
                    <div
                      key={st.address}
                      onClick={() => {
                        if (onSelectCustomToken) {
                          onSelectCustomToken({
                            address: st.address,
                            symbol: st.symbol,
                            decimals: st.decimals,
                            balance: bal,
                          })
                        } else {
                          onSelectToken(st.symbol)
                        }
                        onClose()
                      }}
                      className={`group w-full text-left px-3.5 py-2.5 rounded-xl transition-all flex items-center justify-between cursor-pointer ${
                        isSelected
                          ? 'bg-indigo-500/15 border border-indigo-500/30 text-white'
                          : 'hover:bg-white/[0.05] border border-transparent text-slate-300 hover:text-white'
                      }`}
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="w-7 h-7 rounded-full bg-indigo-500/20 border border-indigo-500/40 flex items-center justify-center font-bold text-xs text-indigo-300 shrink-0">
                          T
                        </div>
                        <div className="min-w-0">
                          <div className="font-semibold text-xs text-white flex items-center gap-1.5 truncate">
                            <span>{st.symbol}</span>
                            <span className="text-[9px] px-1.5 py-0.5 rounded bg-indigo-500/25 text-indigo-300 font-normal shrink-0">
                              Custom
                            </span>
                          </div>
                          <div className="text-[10px] text-slate-400 font-mono truncate">
                            {st.address.slice(0, 6)}...{st.address.slice(-4)}
                          </div>
                        </div>
                      </div>
                    </div>
                  )
                })}

              {/* In-flight selected custom token if not in stored list */}
              {supportsCustom &&
                selectedCustomToken &&
                !storedTokens.some(
                  (st) => st.address.toLowerCase() === selectedCustomToken.address.toLowerCase()
                ) && (
                  <button
                    type="button"
                    onClick={() => {
                      onSelectToken(selectedCustomToken.symbol)
                      onClose()
                    }}
                    className={`w-full text-left px-3.5 py-2.5 rounded-xl transition-all flex items-center justify-between cursor-pointer ${
                      selectedToken === selectedCustomToken.symbol
                        ? 'bg-indigo-500/15 border border-indigo-500/30 text-white'
                        : 'hover:bg-white/[0.05] border border-transparent text-slate-300 hover:text-white'
                    }`}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-7 h-7 rounded-full bg-indigo-500/20 border border-indigo-500/40 flex items-center justify-center font-bold text-xs text-indigo-300 shrink-0">
                        T
                      </div>
                      <div className="min-w-0">
                        <div className="font-semibold text-xs text-white flex items-center gap-1.5 truncate">
                          <span>{selectedCustomToken.symbol}</span>
                          <span className="text-[9px] px-1.5 py-0.5 rounded bg-indigo-500/25 text-indigo-300 font-normal shrink-0">
                            Custom
                          </span>
                        </div>
                        <div className="text-[10px] text-slate-400 font-mono truncate">
                          {selectedCustomToken.address.slice(0, 6)}...{selectedCustomToken.address.slice(-4)}
                        </div>
                      </div>
                    </div>

                    <div className="text-right flex items-center gap-2 shrink-0 ml-2">
                      <div className="tabular-nums text-xs font-medium text-slate-300">
                        {selectedCustomToken.balance}
                      </div>
                      {selectedToken === selectedCustomToken.symbol && (
                        <Check className="w-4 h-4 text-indigo-400" />
                      )}
                    </div>
                  </button>
                )}

              {filteredTokens.length === 0 &&
              filteredStoredTokens.length === 0 &&
              (!selectedCustomToken || !supportsCustom) ? (
                <div className="py-8 text-center text-xs text-slate-400">
                  No tokens found.
                </div>
              ) : (
                filteredTokens.map((t) => {
                  const isSelected = selectedToken === t.symbol
                  return (
                    <button
                      key={t.symbol}
                      type="button"
                      onClick={() => {
                        onSelectToken(t.symbol)
                        onClose()
                      }}
                      className={`w-full text-left px-3.5 py-2.5 rounded-xl transition-all flex items-center justify-between cursor-pointer ${
                        isSelected
                          ? 'bg-indigo-500/15 border border-indigo-500/30 text-white'
                          : 'hover:bg-white/[0.05] border border-transparent text-slate-300 hover:text-white'
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        {t.icon ? (
                          <img src={t.icon} alt={t.symbol} className="w-7 h-7 object-contain rounded-full shrink-0" />
                        ) : t.web3TokenSymbol ? (
                          <div className="w-7 h-7 rounded-full overflow-hidden flex items-center justify-center shrink-0">
                            {t.web3TokenSymbol === 's' || t.web3TokenSymbol === 'sonic' ? (
                              <NetworkIcon name="sonic" variant="mono" size={24} className="text-white" />
                            ) : t.web3TokenSymbol === 'xpl' || t.web3TokenSymbol === 'plasma' ? (
                              <TokenIcon symbol="xpl" variant="mono" size={24} className="text-white" />
                            ) : t.web3TokenSymbol === 'okb' || t.web3TokenSymbol === 'xlayer' || t.web3TokenSymbol === 'x-layer' ? (
                              <TokenIcon symbol="okb" variant="mono" size={24} className="text-white" />
                            ) : (
                              <TokenIcon
                                symbol={t.web3TokenSymbol}
                                variant="branded"
                                size={28}
                                className="rounded-full"
                              />
                            )}
                          </div>
                        ) : (
                          <div className="w-7 h-7 rounded-full bg-white/[0.08] flex items-center justify-center font-bold text-xs">
                            {t.symbol.slice(0, 2)}
                          </div>
                        )}
                        <div>
                          <div className="font-semibold text-xs text-white leading-tight">
                            {t.symbol}
                          </div>
                          <div className="text-[10px] text-slate-400 leading-tight">
                            {t.name}
                          </div>
                        </div>
                      </div>

                      <div className="text-right flex items-center gap-2">
                        {t.balance !== undefined && (
                          <div className="tabular-nums text-xs font-medium text-slate-300">
                            {t.balance}
                          </div>
                        )}
                        {isSelected && (
                          <Check className="w-4 h-4 text-indigo-400" />
                        )}
                      </div>
                    </button>
                  )
                })
              )}
            </div>
          </>
        )}
      </div>
    </div>,
    document.body
  )
}
