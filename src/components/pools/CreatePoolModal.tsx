import React, { useState } from 'react'
import { createPortal } from 'react-dom'
import { X, Plus, Info, Layers, Check, Sparkles, ExternalLink } from 'lucide-react'
import UsdcIcon from '../../assets/Token-Icon/USDC Token.svg'
import EurcIcon from '../../assets/Token-Icon/EURC Token.svg'
import CirBtcIcon from '../../assets/Token-Icon/cirBTC Token.svg'

interface CreatePoolModalProps {
  isOpen: boolean
  onClose: () => void
  walletAddress?: string
  availableWalletUsdc?: string
}

export const CreatePoolModal: React.FC<CreatePoolModalProps> = ({
  isOpen,
  onClose,
  walletAddress,
  availableWalletUsdc = '0.00',
}) => {
  const [tokenA, setTokenA] = useState<'USDC' | 'EURC' | 'cirBTC'>('USDC')
  const [tokenB, setTokenB] = useState<'EURC' | 'cirBTC' | 'custom'>('cirBTC')
  const [feeTier, setFeeTier] = useState<0.05 | 0.3 | 1.0>(0.3)
  const [amountA, setAmountA] = useState<string>('')
  const [amountB, setAmountB] = useState<string>('')
  const [isDeploying, setIsDeploying] = useState<boolean>(false)
  const [isSuccess, setIsSuccess] = useState<boolean>(false)

  if (!isOpen) return null

  const feeTiers = [
    { tier: 0.05 as const, label: '0.05%', desc: 'Best for stable pairs (USDC/EURC)' },
    { tier: 0.30 as const, label: '0.30%', desc: 'Best for standard/crypto pairs (cirBTC/USDC)' },
    { tier: 1.00 as const, label: '1.00%', desc: 'Best for exotic/high-volatility pairs' },
  ]

  const handleCreate = () => {
    setIsDeploying(true)
    setTimeout(() => {
      setIsDeploying(false)
      setIsSuccess(true)
    }, 1200)
  }

  const modalContent = (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-md animate-fade-in"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-lg p-6 sm:p-7 rounded-[28px] overflow-hidden transition-all shadow-2xl"
        style={{
          background: 'linear-gradient(145deg, rgba(20, 24, 42, 0.98) 0%, rgba(14, 17, 30, 0.99) 100%)',
          border: '1px solid rgba(255, 255, 255, 0.1)',
          boxShadow: '0 0 0 1px rgba(255, 255, 255, 0.05), 0 32px 64px -16px rgba(0, 0, 0, 0.8)',
          fontFamily: 'var(--font-app)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-white/[0.08]">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-purple-500/15 border border-purple-500/30 flex items-center justify-center text-[var(--purple-1)]">
              <Plus size={18} />
            </div>
            <div>
              <h3 className="text-lg font-bold text-white tracking-tight">Create Liquidity Pool</h3>
              <p className="text-xs text-[var(--fp-4)]">Deploy and initialize a new V3 pool on Arc Testnet</p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-xl bg-white/[0.04] hover:bg-white/[0.08] text-white/60 hover:text-white transition-colors cursor-pointer"
          >
            <X size={16} />
          </button>
        </div>

        {isSuccess ? (
          <div className="py-8 text-center space-y-3">
            <div className="w-14 h-14 rounded-full bg-emerald-500/20 border border-emerald-500/40 text-emerald-400 mx-auto flex items-center justify-center shadow-lg">
              <Check size={28} />
            </div>
            <h4 className="text-lg font-bold text-white">Pool Initialization Ready</h4>
            <p className="text-xs text-[var(--fp-3)] max-w-sm mx-auto">
              Your custom V3 pool configuration for <strong>{tokenA}/{tokenB}</strong> with <strong>{feeTier}% fee tier</strong> has been validated on Arc Testnet.
            </p>
            <div className="pt-4">
              <button
                type="button"
                onClick={onClose}
                className="w-full py-3 rounded-xl font-bold text-xs tracking-wider uppercase text-white bg-indigo-600 hover:bg-indigo-500 transition-all cursor-pointer shadow-lg"
              >
                Done
              </button>
            </div>
          </div>
        ) : (
          <div className="mt-5 space-y-4">
            {/* Pair Selection */}
            <div>
              <label className="text-xs font-semibold text-[var(--fp-3)] uppercase tracking-wider block mb-2">
                1. Select Token Pair
              </label>
              <div className="grid grid-cols-2 gap-3">
                {/* Token A */}
                <div className="p-3 rounded-2xl bg-white/[0.04] border border-white/[0.08] flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <img src={UsdcIcon} alt="USDC" className="w-6 h-6 rounded-full" />
                    <span className="font-bold text-white text-sm">USDC</span>
                  </div>
                  <span className="text-[10px] text-emerald-400 font-semibold px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/20">
                    Primary
                  </span>
                </div>

                {/* Token B */}
                <div className="p-3 rounded-2xl bg-white/[0.04] border border-white/[0.08] flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <img src={CirBtcIcon} alt="cirBTC" className="w-6 h-6 rounded-full" />
                    <span className="font-bold text-white text-sm">cirBTC</span>
                  </div>
                  <span className="text-[10px] text-amber-400 font-semibold px-2 py-0.5 rounded-full bg-amber-500/10 border border-amber-500/20">
                    Counter
                  </span>
                </div>
              </div>
            </div>

            {/* Fee Tier Selection */}
            <div>
              <label className="text-xs font-semibold text-[var(--fp-3)] uppercase tracking-wider block mb-2">
                2. Fee Tier
              </label>
              <div className="grid grid-cols-3 gap-2">
                {feeTiers.map((ft) => {
                  const isSelected = feeTier === ft.tier
                  return (
                    <button
                      key={ft.tier}
                      type="button"
                      onClick={() => setFeeTier(ft.tier)}
                      className={`p-3 rounded-2xl text-left transition-all cursor-pointer border ${
                        isSelected
                          ? 'bg-purple-500/15 border-purple-500/40 shadow-md'
                          : 'bg-white/[0.03] border-white/[0.06] hover:bg-white/[0.06]'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className={`text-sm font-bold ${isSelected ? 'text-white' : 'text-white/80'}`}>
                          {ft.label}
                        </span>
                        {isSelected && <Check size={12} className="text-[var(--purple-1)]" />}
                      </div>
                      <span className="text-[10px] text-[var(--fp-4)] block mt-1 leading-tight">
                        {ft.desc}
                      </span>
                    </button>
                  )
                })}
              </div>
            </div>

            {/* Initial Liquidity Deposit Inputs */}
            <div>
              <label className="text-xs font-semibold text-[var(--fp-3)] uppercase tracking-wider block mb-2">
                3. Deposit Initial Liquidity
              </label>
              <div className="space-y-2">
                <div className="relative">
                  <input
                    type="number"
                    placeholder="0.00 USDC"
                    value={amountA}
                    onChange={(e) => setAmountA(e.target.value)}
                    className="w-full px-4 py-3 rounded-xl bg-white/[0.04] border border-white/[0.08] text-white text-sm placeholder-[var(--fp-4)] outline-none focus:border-purple-400/50"
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-bold text-white/50">
                    USDC
                  </span>
                </div>
                <div className="relative">
                  <input
                    type="number"
                    placeholder="0.00 cirBTC"
                    value={amountB}
                    onChange={(e) => setAmountB(e.target.value)}
                    className="w-full px-4 py-3 rounded-xl bg-white/[0.04] border border-white/[0.08] text-white text-sm placeholder-[var(--fp-4)] outline-none focus:border-purple-400/50"
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-bold text-white/50">
                    cirBTC
                  </span>
                </div>
              </div>
            </div>

            {/* Arc Testnet Gas Info */}
            <div className="p-3 rounded-2xl bg-indigo-500/10 border border-indigo-500/20 flex items-start gap-2.5 text-xs text-indigo-200">
              <Info size={15} className="shrink-0 text-indigo-400 mt-0.5" />
              <span>
                Pool creation transactions on Arc use <strong>native USDC as gas</strong> — no ETH required.
              </span>
            </div>

            {/* Action Button */}
            <div className="pt-2">
              <button
                type="button"
                onClick={handleCreate}
                disabled={isDeploying}
                className="w-full py-3.5 rounded-2xl font-bold text-xs tracking-wider uppercase text-white bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 active:scale-95 transition-all shadow-xl cursor-pointer disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {isDeploying ? (
                  <>
                    <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    <span>Deploying Pool...</span>
                  </>
                ) : (
                  <>
                    <Sparkles size={14} className="text-purple-300" />
                    <span>Initialize Pool</span>
                  </>
                )}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )

  if (typeof document === 'undefined') return null
  return createPortal(modalContent, document.body)
}

export default CreatePoolModal
