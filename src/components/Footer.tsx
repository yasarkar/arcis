import React, { useState } from 'react'
import {
  ExternalLink,
  Droplets,
  Check,
  Mail,
  ArrowRight
} from 'lucide-react'
import customLogo from '../assets/Arcis-Icon.svg'
import { arcTestnet } from '../config/arcChain'

type TabType = 'home' | 'unified' | 'send' | 'swap' | 'bridge' | 'pools' | 'ai-services' | 'history'

interface FooterProps {
  onNavigate?: (tab: TabType) => void
  onOpenFaucet?: () => void
}

export default function Footer({ onNavigate, onOpenFaucet }: FooterProps) {
  const [email, setEmail] = useState('')
  const [isSubscribed, setIsSubscribed] = useState(false)

  const handleNav = (tab: TabType) => {
    if (onNavigate) {
      onNavigate(tab)
      window.scrollTo({ top: 0, behavior: 'smooth' })
    }
  }

  const handleSubscribe = (e: React.FormEvent) => {
    e.preventDefault()
    if (!email || !email.includes('@')) return

    try {
      // Store in localStorage for persistent demo state
      const existing = JSON.parse(localStorage.getItem('arcis_subscribers') || '[]')
      if (!existing.includes(email)) {
        existing.push(email)
        localStorage.setItem('arcis_subscribers', JSON.stringify(existing))
      }
    } catch (err) {}

    setIsSubscribed(true)
    setEmail('')

    // Reset Joined button and confirmation message after 30 seconds
    setTimeout(() => {
      setIsSubscribed(false)
    }, 30000)
  }

  return (
    <footer className="w-full border-t border-white/10 bg-slate-950/80 backdrop-blur-2xl mt-auto relative z-10">
      {/* Ambient Top Glow Line */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-5/6 h-[1px] bg-gradient-to-r from-transparent via-indigo-500/40 to-transparent pointer-events-none" />

      <div className="w-full max-w-[1800px] 2xl:max-w-full mx-auto px-4 sm:px-8 md:px-12 lg:px-16 xl:px-20 py-12 md:py-16 flex flex-col gap-12">
        
        {/* Top 4-Column Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-12 gap-8 lg:gap-10">
          
          {/* Column 1: Brand & Description (4 cols) */}
          <div className="lg:col-span-4 flex flex-col gap-4">
            <button
              type="button"
              onClick={() => handleNav('home')}
              className="flex items-center gap-3 w-fit cursor-pointer group focus:outline-none"
              title="Arcis Protocol"
            >
              <img
                src={customLogo}
                alt="Arcis Logo"
                className="h-14 md:h-14 w-auto object-contain transition-transform duration-200 group-hover:scale-105"
              />
            </button>

            <p className="text-sm text-slate-400 font-normal leading-relaxed max-w-sm">
              The Next-Generation Stablecoin Liquidity & AI Agentic Settlement Protocol built natively for Arc Layer-1.
            </p>
          </div>

          {/* Column 2: Ecosystem DApps (2 cols) */}
          <div className="lg:col-span-2 flex flex-col gap-3">
            <div className="text-s font-mono font-semibold tracking-wider text-slate-300 uppercase">
              // ECOSYSTEM
            </div>
            <ul className="flex flex-col gap-2 text-sm text-slate-400">
              <li>
                <button
                  type="button"
                  onClick={() => handleNav('unified')}
                  className="hover:text-white transition-colors cursor-pointer text-left"
                >
                  Unified Balance
                </button>
              </li>
              <li>
                <button
                  type="button"
                  onClick={() => handleNav('send')}
                  className="hover:text-white transition-colors cursor-pointer text-left"
                >
                  Send
                </button>
              </li>
              <li>
                <button
                  type="button"
                  onClick={() => handleNav('swap')}
                  className="hover:text-white transition-colors cursor-pointer text-left"
                >
                  Swap
                </button>
              </li>
              <li>
                <button
                  type="button"
                  onClick={() => handleNav('bridge')}
                  className="hover:text-white transition-colors cursor-pointer text-left"
                >
                  Bridge
                </button>
              </li>
              <li>
                <button
                  type="button"
                  onClick={() => handleNav('pools')}
                  className="hover:text-white transition-colors cursor-pointer text-left"
                >
                  Pools
                </button>
              </li>
              <li>
                <button
                  type="button"
                  onClick={() => handleNav('ai-services')}
                  className="hover:text-white transition-colors cursor-pointer text-left"
                >
                  AI Services
                </button>
              </li>
            </ul>
          </div>

          {/* Column 3: Developers & Infrastructure (2 cols) */}
          <div className="lg:col-span-2 flex flex-col gap-3">
            <div className="text-s font-mono font-semibold tracking-wider text-slate-300 uppercase">
              // DEVELOPERS
            </div>
            <ul className="flex flex-col gap-2 text-sm text-slate-400">
              <li>
                <a
                  href={arcTestnet.blockExplorers?.default?.url || 'https://testnet.arcscan.app'}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:text-white transition-colors inline-flex items-center gap-1"
                >
                  <span>Explorer</span>
                </a>
              </li>
              <li>
                <a
                  href="https://docs.arc.io"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:text-white transition-colors inline-flex items-center gap-1"
                >
                  <span>Docs</span>
                </a>
              </li>
              <li>
                <a
                  href="https://faucet.circle.com"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:text-white transition-colors inline-flex items-center gap-1"
                >
                  <span>Faucet</span>
                </a>
              </li>
            </ul>
          </div>

          {/* Column 4: Subscribe for updates (4 cols) */}
          <div className="lg:col-span-4 flex flex-col gap-3">
            <div className="text-s font-mono font-semibold tracking-wider text-slate-300 uppercase">
              // SUBSCRIBE FOR UPDATES
            </div>
            
            <p className="text-xs text-slate-400 leading-relaxed max-w-sm">
              Get the latest Arcis news, yield updates, and protocol releases delivered to your inbox.
            </p>

            <form onSubmit={handleSubscribe} className="flex flex-col gap-2 mt-1 max-w-sm">
              <div className="flex items-stretch overflow-hidden rounded-xl border border-white/10 focus-within:border-indigo-400/60 focus-within:ring-1 focus-within:ring-indigo-400/30 bg-slate-900/90 transition-all">
                <div className="pl-3.5 pr-1 flex items-center text-slate-500 pointer-events-none">
                  <Mail size={14} />
                </div>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="Enter your email address"
                  required
                  disabled={isSubscribed}
                  className="flex-1 py-2.5 px-2 bg-transparent text-white text-xs placeholder:text-slate-500 focus:outline-none disabled:opacity-60 min-w-0"
                />
                <button
                  type="submit"
                  disabled={isSubscribed}
                  className="px-4 bg-blue-700 hover:bg-blue-600 active:scale-95 text-white text-xs font-semibold tracking-wide transition-all cursor-pointer disabled:bg-emerald-600/80 disabled:cursor-default flex items-center justify-center shrink-0 rounded-r-xl"
                >
                  {isSubscribed ? (
                    <span className="font-mono text-emerald-100">
                      Joined
                    </span>
                  ) : (
                    <span>Subscribe</span>
                  )}
                </button>
              </div>

              {isSubscribed && (
                <p className="text-[11px] text-emerald-400 font-mono flex items-center gap-1 animate-fade-in">
                  <span>You are subscribed to Arcis updates</span>
                </p>
              )}

              <p className="text-[11px] text-slate-500 leading-normal max-w-sm">
                By subscribing, you agree to receive email updates from Arcis Protocol. Unsubscribe anytime.
              </p>
            </form>
          </div>

        </div>

        {/* Bottom Horizontal Bar */}
        <div className="border-t border-white/5 pt-8 grid grid-cols-1 md:grid-cols-3 items-center gap-4 text-xs text-slate-500">
          <div className="hidden md:block"></div>
          <div className="text-center">
            <span>© 2026 Arcis Protocol. Built on Arc Layer-1 for stablecoin-first financial flows.</span>
          </div>
        </div>

      </div>
    </footer>
  )
}
