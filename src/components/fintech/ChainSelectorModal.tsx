import React, { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { Search, X, Check } from 'lucide-react'
import { NetworkIcon } from '@web3icons/react/dynamic'

interface ChainItem {
  chain: string
  name: string
}

interface ChainSelectorModalProps {
  isOpen: boolean
  onClose: () => void
  chains: ChainItem[]
  selectedChain: string
  onSelectChain: (chainKey: string) => void
  getChainIconId: (chainKey: string) => string
  title?: string
}

export const ChainSelectorModal: React.FC<ChainSelectorModalProps> = ({
  isOpen,
  onClose,
  chains,
  selectedChain,
  onSelectChain,
  getChainIconId,
  title = 'Select Network',
}) => {
  const [search, setSearch] = useState('')
  const searchInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (isOpen) {
      setSearch('')
      const timer = setTimeout(() => searchInputRef.current?.focus(), 50)
      return () => clearTimeout(timer)
    }
  }, [isOpen])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, onClose])

  if (!isOpen || typeof document === 'undefined') return null

  const filteredChains = chains.filter((c) => {
    const query = search.toLowerCase().trim()
    return (
      c.name.toLowerCase().includes(query) ||
      c.chain.toLowerCase().includes(query)
    )
  })

  return createPortal(
    <div
      className="fixed inset-0 z-[300] flex items-center justify-center p-4 bg-black/75 backdrop-blur-md animate-fade-in"
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
            placeholder="Search network..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-xl pl-9.5 pr-4 py-2.5 text-xs text-white bg-white/[0.04] hover:bg-white/[0.06] focus:bg-white/[0.08] border border-white/[0.08] focus:border-indigo-500/50 focus:outline-none transition-all"
          />
        </div>

        {/* Chain List */}
        <div className="max-h-[300px] overflow-y-auto space-y-1 pr-1">
          {filteredChains.length === 0 ? (
            <div className="py-8 text-center text-xs text-slate-400">
              No networks found.
            </div>
          ) : (
            filteredChains.map((c) => {
              const iconId = getChainIconId(c.chain)
              const isSelected = selectedChain === c.chain
              return (
                <button
                  key={c.chain}
                  type="button"
                  onClick={() => {
                    onSelectChain(c.chain)
                    onClose()
                  }}
                  className={`w-full text-left px-3.5 py-2.5 rounded-xl transition-all flex items-center justify-between cursor-pointer ${
                    isSelected
                      ? 'bg-indigo-500/15 border border-indigo-500/30 text-white'
                      : 'hover:bg-white/[0.05] border border-transparent text-slate-300 hover:text-white'
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    <div className="w-6 h-6 rounded-full overflow-hidden flex items-center justify-center shrink-0">
                      <NetworkIcon
                        name={iconId}
                        variant={iconId === 'solana' ? 'branded' : 'background'}
                        size={22}
                        className="rounded-full overflow-hidden"
                      />
                    </div>
                    <span className="font-semibold text-xs text-white">
                      {c.name}
                    </span>
                  </div>

                  {isSelected && (
                    <Check className="w-4 h-4 text-indigo-400" />
                  )}
                </button>
              )
            })
          )}
        </div>
      </div>
    </div>,
    document.body
  )
}
