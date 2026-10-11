import React, { useState, useMemo } from 'react'
import { Eye, EyeOff, ChevronDown, Layers, Wallet, Check, Plus } from 'lucide-react'
import { POOL_VERSION_V4, type PoolConfig } from '../../config/poolsConfig'
import type { UserPoolPosition } from '../../hooks/usePoolsData'
import PositionCard, { type PositionItem } from './PositionCard'

interface MyPositionsSectionProps {
  pools: (PoolConfig & { userPosition?: UserPoolPosition })[]
  walletConnected: boolean
  walletAddress?: string
  onClaim: (poolId: string) => void
  onAddLiquidity: (pool?: PoolConfig) => void
  onRemoveLiquidity: (pool?: PoolConfig) => void
  isClaiming: boolean
  claimingPoolId: string | null
}

export const MyPositionsSection: React.FC<MyPositionsSectionProps> = ({
  pools,
  walletConnected,
  walletAddress,
  onClaim,
  onAddLiquidity,
  onRemoveLiquidity,
  isClaiming,
  claimingPoolId,
}) => {
  const [isMasked, setIsMasked] = useState<boolean>(false)
  const [typeFilter, setTypeFilter] = useState<'All' | 'Liquidity' | 'Vaults'>('All')
  const [statusFilter, setStatusFilter] = useState<'All' | 'Active' | 'In Range'>('All')

  const [showTypeDropdown, setShowTypeDropdown] = useState<boolean>(false)
  const [showStatusDropdown, setShowStatusDropdown] = useState<boolean>(false)

  // Map ONLY real deployed contract pools on Arc Testnet where user has an active deposit
  const realPositions: PositionItem[] = useMemo(() => {
    if (!walletConnected) return []

    return pools
      .filter((p) => {
        const stakedUsd = p.userPosition?.stakedUsd || 0
        const stakedAmount = parseFloat(p.userPosition?.stakedAmount || '0')
        const earnedUsd = p.userPosition?.earnedUsd || 0
        return stakedUsd > 0 || stakedAmount > 0 || earnedUsd > 0
      })
      .map((p) => {
        const stakedUsd = p.userPosition?.stakedUsd || 0
        const earnedUsd = p.userPosition?.earnedUsd || 0
        const isBtc = p.id === 'usdc-cirbtc-pool'
        const isEurc = p.id === 'usdc-eurc-stable-pool'
        const isVault = p.id === 'usdc-yield-vault'

        let name = p.name || 'cirBTC / USDC'
        let token1Symbol = 'cirBTC'
        let token2Symbol = 'USDC'
        let version = POOL_VERSION_V4 ? 'V4' : 'V3'
        let feeTier = `${(p.feeTierPercent || 0.25).toFixed(2)}%`
        let token1IconType: 'btc' | 'eurc' | 'usdc' = 'btc'
        let token2IconType: 'btc' | 'eurc' | 'usdc' = 'usdc'

        if (isEurc) {
          name = 'EURC / USDC'
          token1Symbol = 'EURC'
          token1IconType = 'eurc'
          feeTier = `${(p.feeTierPercent || 0.12).toFixed(2)}%`
        } else if (isVault) {
          name = 'USDC Vault'
          token1Symbol = 'USDC'
          token1IconType = 'usdc'
          version = 'V4'
          feeTier = 'ERC-4626'
        }

        // Dynamic Price & Range Resolution
        const livePrice = (p.exchangeRate && p.exchangeRate > 0) ? p.exchangeRate : 82739.99

        let minPriceNum = Math.round(livePrice * (1 - 0.1883) * 100) / 100
        let maxPriceNum = Math.round(livePrice * (1 + 0.2280) * 100) / 100

        if (typeof window !== 'undefined' && walletAddress) {
          try {
            const cached = localStorage.getItem(`arcis_clamm_position_${walletAddress.toLowerCase()}_${p.id}`)
            if (cached) {
              const data = JSON.parse(cached)
              if (data.minPrice && data.maxPrice) {
                minPriceNum = Number(data.minPrice)
                maxPriceNum = Number(data.maxPrice)
              }
            }
          } catch (e) {
            console.warn('[MyPositionsSection] Range cache read error:', e)
          }
        }

        const inRange = livePrice >= minPriceNum && livePrice <= maxPriceNum
        const minRange = minPriceNum.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
        const maxRange = maxPriceNum.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
        const currentPriceDisplay = `Price ${livePrice.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USDC per cirBTC`

        // Real On-Chain Token Breakdown
        const token1Amount = p.userPosition?.tokenBStaked || '0.00' // cirBTC
        const token2Amount = p.userPosition?.tokenAStaked || '0.00' // USDC

        // Real Ratio Calculation from actual holdings
        const valB = (parseFloat(token1Amount) || 0) * livePrice
        const valA = parseFloat(token2Amount) || 0
        const totalVal = valA + valB
        let token1Ratio = 50
        let token2Ratio = 50
        if (totalVal > 0) {
          token1Ratio = Math.max(1, Math.min(99, Math.round((valB / totalVal) * 100)))
          token2Ratio = 100 - token1Ratio
        }

        return {
          id: p.id,
          poolId: p.id,
          name,
          token1Symbol,
          token2Symbol,
          token1Amount,
          token2Amount,
          version,
          feeTier,
          apr: p.apy,
          unclaimedFeesUsd: earnedUsd,
          positionUsd: stakedUsd,
          token1Ratio,
          token2Ratio,
          token1IconType,
          token2IconType,
          minRange,
          maxRange,
          currentPriceDisplay,
          inRange,
          poolConfig: p,
        }
      })
  }, [pools, walletConnected, walletAddress])

  // Filter positions
  const displayedPositions = useMemo(() => {
    return realPositions.filter((pos) => {
      // Type filter
      if (typeFilter === 'Liquidity' && pos.poolConfig?.category !== 'liquidity') return false
      if (typeFilter === 'Vaults' && pos.poolConfig?.category !== 'vault') return false

      // Status filter
      if (statusFilter === 'Active' && pos.positionUsd <= 0) return false
      if (statusFilter === 'In Range' && !pos.inRange) return false

      return true
    })
  }, [realPositions, typeFilter, statusFilter])

  // If user has no active positions on-chain, do not render My Positions at all
  if (!walletConnected || realPositions.length === 0) {
    return null
  }

  return (
    <div className="w-full mt-12 mb-8">
      {/* ── Section Header (Title + Eye Toggle + Filter Dropdowns) ── */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 pb-6">
        {/* Left: Title + Eye Visibility Toggle */}
        <div className="flex items-center gap-3">
          <h3 className="text-xl sm:text-2xl font-bold text-white tracking-tight">
            My Positions
          </h3>

          {/* Eye Icon Button (Toggles Balance Masking) */}
          <button
            type="button"
            onClick={() => setIsMasked((prev) => !prev)}
            className="w-8 h-8 rounded-full bg-white/[0.05] hover:bg-white/[0.1] border border-white/10 flex items-center justify-center text-white/70 hover:text-white transition-all cursor-pointer shadow-sm active:scale-95"
            title={isMasked ? 'Reveal balances' : 'Hide balances'}
            aria-label="Toggle position balances visibility"
          >
            {isMasked ? <EyeOff size={15} /> : <Eye size={15} />}
          </button>
        </div>

        {/* Right: Dropdown Filters (Matching Screenshot) */}
        <div className="flex items-center gap-2.5">
          {/* Dropdown 1: Type Filter */}
          <div className="relative">
            <button
              type="button"
              onClick={() => {
                setShowTypeDropdown((prev) => !prev)
                setShowStatusDropdown(false)
              }}
              className="flex items-center gap-2 px-3.5 py-1.5 rounded-full text-xs font-semibold text-white/90 bg-white/[0.04] hover:bg-white/[0.08] border border-white/10 hover:border-white/20 transition-all cursor-pointer shadow-sm"
            >
              <span>{typeFilter === 'All' ? 'All Types' : typeFilter}</span>
              <ChevronDown
                size={13}
                className={`transition-transform duration-200 text-white/60 ${showTypeDropdown ? 'rotate-180' : ''}`}
              />
            </button>

            {showTypeDropdown && (
              <div
                className="absolute right-0 top-full mt-1.5 min-w-[130px] p-1.5 rounded-2xl border border-white/10 shadow-2xl z-30 flex flex-col gap-1"
                style={{
                  background: 'rgba(15, 18, 32, 0.96)',
                  backdropFilter: 'blur(20px)',
                }}
              >
                {(['All', 'Liquidity', 'Vaults'] as const).map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => {
                      setTypeFilter(t)
                      setShowTypeDropdown(false)
                    }}
                    className={`w-full text-left px-3 py-1.5 rounded-xl text-xs font-medium transition-colors flex items-center justify-between cursor-pointer ${
                      typeFilter === t ? 'bg-purple-500/20 text-white' : 'text-white/70 hover:bg-white/[0.05]'
                    }`}
                  >
                    <span>{t === 'All' ? 'All Types' : t}</span>
                    {typeFilter === t && <Check size={12} className="text-[var(--purple-1)]" />}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Dropdown 2: Status Filter */}
          <div className="relative">
            <button
              type="button"
              onClick={() => {
                setShowStatusDropdown((prev) => !prev)
                setShowTypeDropdown(false)
              }}
              className="flex items-center gap-2 px-3.5 py-1.5 rounded-full text-xs font-semibold text-white/90 bg-white/[0.04] hover:bg-white/[0.08] border border-white/10 hover:border-white/20 transition-all cursor-pointer shadow-sm"
            >
              <span>{statusFilter}</span>
              <ChevronDown
                size={13}
                className={`transition-transform duration-200 text-white/60 ${showStatusDropdown ? 'rotate-180' : ''}`}
              />
            </button>

            {showStatusDropdown && (
              <div
                className="absolute right-0 top-full mt-1.5 min-w-[130px] p-1.5 rounded-2xl border border-white/10 shadow-2xl z-30 flex flex-col gap-1"
                style={{
                  background: 'rgba(15, 18, 32, 0.96)',
                  backdropFilter: 'blur(20px)',
                }}
              >
                {(['All', 'Active', 'In Range'] as const).map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => {
                      setStatusFilter(s)
                      setShowStatusDropdown(false)
                    }}
                    className={`w-full text-left px-3 py-1.5 rounded-xl text-xs font-medium transition-colors flex items-center justify-between cursor-pointer ${
                      statusFilter === s ? 'bg-purple-500/20 text-white' : 'text-white/70 hover:bg-white/[0.05]'
                    }`}
                  >
                    <span>{s}</span>
                    {statusFilter === s && <Check size={12} className="text-[var(--purple-1)]" />}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Real Positions Cards Grid ── */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5 sm:gap-6 items-stretch">
        {displayedPositions.map((pos) => (
          <PositionCard
            key={pos.id}
            position={pos}
            isMasked={isMasked}
            onClaim={onClaim}
            onAddLiquidity={onAddLiquidity}
            onRemoveLiquidity={onRemoveLiquidity}
            isClaiming={isClaiming}
            claimingPoolId={claimingPoolId}
          />
        ))}
      </div>

      {/* Empty State only when user has positions, but none match the current filter */}
      {displayedPositions.length === 0 && (
        <div
          className="p-8 rounded-[26px] text-center border flex flex-col items-center justify-center gap-2.5"
          style={{
            background: 'rgba(15, 18, 32, 0.7)',
            borderColor: 'rgba(255, 255, 255, 0.08)',
          }}
        >
          <div className="w-10 h-10 rounded-2xl bg-white/[0.04] border border-white/10 flex items-center justify-center text-[var(--purple-1)]">
            <Layers size={20} />
          </div>
          <h4 className="text-sm font-bold text-white">No Positions Match Filter</h4>
          <p className="text-xs text-[var(--fp-4)] max-w-sm">
            You have active positions, but none match the current "{typeFilter}" or "{statusFilter}" filter.
          </p>
          <button
            type="button"
            onClick={() => {
              setTypeFilter('All')
              setStatusFilter('All')
            }}
            className="mt-1 px-4 py-2 rounded-xl text-xs font-semibold text-white bg-white/[0.08] hover:bg-white/[0.15] transition-colors cursor-pointer"
          >
            Reset Filters
          </button>
        </div>
      )}
    </div>
  )
}

export default MyPositionsSection
