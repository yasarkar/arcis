import { useState } from 'react'
import {
  Sparkles,
  ArrowRight,
  ShieldCheck,
  Zap,
  Coins,
  Globe,
  Layers,
  Bot,
  Cpu,
  ExternalLink,
  ChevronDown,
  Check,
  ArrowUpRight,
  ArrowRightLeft,
  Lock,
  Droplets,
  Terminal,
  Gauge,
  KeyRound,
  Compass,
  FileText,
  Activity,
  CheckCircle2,
  Database,
  Shuffle
} from 'lucide-react'
import { NetworkIcon } from '@web3icons/react/dynamic'

// Visual Artwork Assets
import heroNexusImg from '../../assets/hero/arcis_hero_nexus.jpg'
import unifiedMultichainImg from '../../assets/hero/arcis_unified_multichain.jpg'
import nativeGasImg from '../../assets/hero/arcis_native_gas.jpg'
import passkeyVaultImg from '../../assets/hero/arcis_passkey_vault.jpg'
import realYieldImg from '../../assets/hero/arcis_real_yield.jpg'
import agentSettlementImg from '../../assets/hero/arcis_agent_settlement.jpg'

import { arcTestnet } from '../../config/arcChain'

type TabType = 'home' | 'unified' | 'send' | 'swap' | 'bridge' | 'pools' | 'ai-services' | 'history'

interface HomePageProps {
  onNavigate: (tab: TabType) => void
  onOpenCircleAuth?: () => void
  onOpenFaucet?: () => void
  walletConnected?: boolean
  walletAddress?: string
}

export default function HomePage({
  onNavigate,
  onOpenCircleAuth,
  onOpenFaucet,
  walletConnected,
  walletAddress,
}: HomePageProps) {
  const [openFaqIndex, setOpenFaqIndex] = useState<number | null>(null)

  const toggleFaq = (idx: number) => {
    setOpenFaqIndex(openFaqIndex === idx ? null : idx)
  }

  const keyMetrics = [
    {
      value: '< 1.0s',
      label: 'Block Finality',
      desc: 'Sub-second deterministic settlement',
      icon: Zap,
      color: '#a855f7',
    },
    {
      value: 'Native USDC',
      label: 'Gas Engine',
      desc: 'Zero ETH needed for fees',
      icon: Coins,
      color: '#22c55e',
    },
    {
      value: '13+ Chains',
      label: 'Unified Balance',
      desc: 'Instant cross-chain liquidity',
      icon: Globe,
      color: '#38bdf8',
    },
    {
      value: '100% Real',
      label: 'Protocol Yield',
      desc: 'Compounding fee dividends',
      icon: Layers,
      color: '#f59e0b',
    },
  ]

  const corePillars = [
    {
      id: 'unified',
      title: 'Unified Balance Across 13+ Chains',
      headline: 'The Ultimate Solution to Fragmented Liquidity and Bridge Friction',
      description:
        'Aggregate your USDC balances across Ethereum, Base, Arbitrum, Solana, Avalanche, and Arc Testnet into a single unified vault powered by Circle Gateway and CCTP. Spend or transfer instantly (<500ms burn-and-mint) on any supported chain with zero waiting periods.',
      bullets: [
        'Instant Unified Balance: Consolidate scattered USDC across all your wallets and networks.',
        'Zero Secondary Token Risk: Direct native USDC settlement without synthetic or wrapped tokens.',
        'Sub-Second Cross-Chain Settlement: Permissionless Gateway burn-and-mint architecture.',
      ],
      ctaText: 'Launch Unified Balance',
      actionTab: 'unified' as TabType,
      image: unifiedMultichainImg,
      accentColor: 'rgba(56, 189, 248, 0.25)',
      badgeBorder: 'border-sky-500/40 text-sky-400',
    },
    {
      id: 'native-gas',
      title: 'Zero ETH, Zero Volatility: Native USDC Gas Engine',
      headline: 'The First Institutional L1 Blockchain Eliminating Gas Price Volatility',
      description:
        'On Arc L1, transaction fees are paid natively in USDC (0x3600...0000) instead of volatile native tokens like ETH. Never worry about holding ETH for gas. Every transfer, contract call, and swap executes with predictable, sub-penny USDC transaction fees.',
      bullets: [
        'Predictable Accounting: Fixed, forecastable gas fees for enterprises and retail users alike.',
        'Dual Gas Engine: 18 Dec Native Gas & 6 Dec ERC-20 dual precision architecture.',
        'Sub-Second Deterministic Finality: Irreversible on-chain settlement in under 1 second.',
      ],
      ctaText: 'Send Instant Transfer',
      actionTab: 'send' as TabType,
      image: nativeGasImg,
      accentColor: 'rgba(34, 197, 94, 0.25)',
      badgeBorder: 'border-emerald-500/40 text-emerald-400',
    },
    {
      id: 'passkey-msca',
      title: 'Seedless Biometric Web3: FaceID & TouchID Login',
      headline: 'Gasless Modular Smart Accounts Created in Seconds',
      description:
        'Experience seamless Web3 onboarding with Circle Modular Wallets and ERC-6900 MSCA architecture. Log in using your device\'s biometric sensors (FaceID, TouchID, Windows Hello) with zero seed phrase loss risk. Sign transactions with zero gas fees via Circle Gas Station paymaster.',
      bullets: [
        'WebAuthn / FIDO2 Hardware Enclave Security: Private keys secured within device hardware chips.',
        'Circle Gas Station Paymaster: 100% gas-sponsored transactions for frictionless UX.',
        'Flexible Social Login: MPC User-Controlled Wallets via Google or Apple authentication.',
      ],
      ctaText: 'Connect with Passkey',
      customAction: onOpenCircleAuth,
      image: passkeyVaultImg,
      accentColor: 'rgba(6, 182, 212, 0.25)',
      badgeBorder: 'border-cyan-500/40 text-cyan-400',
    },
    {
      id: 'real-yield',
      title: 'Zero-Slippage FX & Non-Inflationary Real Yield',
      headline: 'ERC-4626 Vault Distributing 90% of Protocol Fees in Pure USDC Dividends',
      description:
        'Our dual-AMM architecture provides Constant-Sum (x + y = k) zero-slippage swaps for stablecoin pairs (USDC/EURC) and Constant-Product (x * y = k) liquidity for market assets. 90% of all protocol fees compound directly into the YieldVault (af-USDC) as real, non-inflationary yields.',
      bullets: [
        'Constant-Sum Zero Slippage: 1:1 capital efficiency on stable FX pairs without price impact.',
        'ERC-4626 af-USDC Vault: Auto-compounding real yields paid purely in USDC dividends.',
        'Zero Token Inflation: Sustainable yield generated entirely from real protocol volume.',
      ],
      ctaText: 'Explore Pools & Vault',
      actionTab: 'pools' as TabType,
      image: realYieldImg,
      accentColor: 'rgba(245, 158, 11, 0.25)',
      badgeBorder: 'border-amber-500/40 text-amber-400',
    },
    {
      id: 'ai-agents',
      title: 'Autonomous AI Agent Economy & x402 Micropayments',
      headline: 'On-Chain Identity, Job Escrows, and Real-Time Settlement for Autonomous Agents',
      description:
        'Empower autonomous AI agents with on-chain identity (ERC-8004), verifiable job contracts (ERC-8183), and sub-penny micropayments via the HTTP 402 protocol. Execute natural-language on-chain operations and smart contract actions with Arcis AI Copilot.',
      bullets: [
        'x402 Pay-Per-Call Protocol: Pay-as-you-go USDC micropayments without API keys or subscriptions.',
        'Yield-Generating Escrow: Idle bounty and escrow funds earn vault yields during job execution.',
        'Arcis AI Copilot: Autonomous on-chain AI orchestrator for natural language transfers and swaps.',
      ],
      ctaText: 'Explore AI Services',
      actionTab: 'ai-services' as TabType,
      image: agentSettlementImg,
      accentColor: 'rgba(168, 85, 247, 0.25)',
      badgeBorder: 'border-purple-500/40 text-purple-400',
    },
    {
      id: 'cross-chain-bridge',
      title: 'Universal Bridge Across EVM, Solana & Injective',
      headline: 'Connecting Leading Ecosystems into a Single Seamless Terminal',
      description:
        'Connect Solana Phantom, Injective Keplr, and EVM wallets (MetaMask, Rainbow) simultaneously. Move USDC effortlessly across distinct blockchain ecosystems with direct Circle CCTP validator attestation and optimal route execution.',
      bullets: [
        'Native Circle CCTP v2 Protocol: Zero wrapped-token bridge risks.',
        'Unified Multi-Ecosystem Interface: Manage EVM, Solana SPL, and Injective from one place.',
        'Slippage Protection: Automated best-execution routing across all chains.',
      ],
      ctaText: 'Bridge & Swap Tokens',
      actionTab: 'bridge' as TabType,
      image: heroNexusImg,
      accentColor: 'rgba(99, 102, 241, 0.25)',
      badgeBorder: 'border-indigo-500/40 text-indigo-400',
    },
  ]

  const comparisonRows = [
    {
      feature: 'Native Gas Currency',
      legacy: 'Volatile ETH, SOL, MATIC (Requires constant native token balance)',
      arcis: 'Native USDC (0x3600...0000), Zero ETH Required',
    },
    {
      feature: 'Settlement & Finality Speed',
      legacy: '12–60s multi-block confirmations with re-organization risks',
      arcis: '< 1.0s Sub-Second Deterministic Finality',
    },
    {
      feature: 'Cross-Chain Liquidity',
      legacy: 'Fragmented liquidity pools, wrapped tokens, slow bridging',
      arcis: '13+ Chains Unified Balance via Circle Gateway (<500ms)',
    },
    {
      feature: 'Wallet Onboarding & Security',
      legacy: '12–24 seed phrases, high risk of phishing and key loss',
      arcis: 'Biometric WebAuthn Passkeys (FaceID/TouchID) + MSCA',
    },
    {
      feature: 'Gas Fee Sponsorship',
      legacy: 'Users must always hold and pay native gas for each tx',
      arcis: 'Circle Gas Station Paymaster for 100% Gasless UX',
    },
    {
      feature: 'Yield Mechanism',
      legacy: 'Inflationary farm tokens with rapidly depreciating value',
      arcis: 'ERC-4626 Real Yield (90% Protocol Volume Fees in Pure USDC)',
    },
    {
      feature: 'AI & Agent Integration',
      legacy: 'Manual wallet confirmations, centralized API keys',
      arcis: 'ERC-8183 / ERC-8004 & x402 Automated USDC Micropayments',
    },
  ]

  const faqItems = [
    {
      q: 'What is Arc L1 and how does it use USDC as native gas?',
      a: 'Arc is a purpose-built Layer-1 blockchain engineered by Circle for enterprise financial flows. Unlike traditional blockchains that require ETH or SOL for gas, Arc\'s execution engine uses native USDC (0x3600...0000) directly for transaction fees. This allows developers and businesses to operate with predictable, sub-penny costs without price volatility.'
    },
    {
      q: 'How does Unified Balance work across multiple blockchains?',
      a: 'Powered by Circle Gateway and the Unified Balance Kit, your USDC across Ethereum, Base, Arbitrum, Solana, Avalanche, and Arc Testnet is aggregated into a single spendable pool. You can spend or transfer your funds on any connected chain in under 500ms using permissionless burn-and-mint settlement, without traditional bridging delays.'
    },
    {
      q: 'Why are Biometric Passkeys safer than seed phrases?',
      a: 'Passkeys leverage the FIDO2 / WebAuthn open standard. Your private keys are securely generated and stored inside your device\'s hardware enclave (such as Apple Secure Enclave or Windows TPM) and never leave the device. This completely eliminates phishing attacks, clipboard hijacking, and seed phrase loss.'
    },
    {
      q: 'How is yield generated in the ERC-4626 Yield Vault?',
      a: '90% of all platform fees collected from transfers, stablecoin FX swaps, and cross-chain actions are routed directly to the YieldVault. No inflationary reward tokens are minted; all returns represent genuine protocol volume compounding directly into your af-USDC share value.'
    },
    {
      q: 'Where can I obtain Testnet USDC and Arc Testnet funds?',
      a: 'Click the "Testnet Faucet" button in the navigation or on this page to request free testnet USDC, EURC, and native Arc gas tokens directly via the Circle Faucet API.'
    }
  ]

  return (
    <div className="w-full flex flex-col gap-16 md:gap-24 pb-20 animate-fade-in text-slate-100">
      
      {/* ── 1. HERO BANNER SECTION ── */}
      <section className="relative w-full rounded-3xl overflow-hidden border border-white/10 p-6 md:p-12 lg:p-16 transition-all"
        style={{
          background: 'linear-gradient(145deg, rgba(16, 20, 35, 0.95) 0%, rgba(8, 10, 18, 0.98) 100%)',
          boxShadow: '0 20px 60px -15px rgba(0, 0, 0, 0.7), inset 0 1px 0 rgba(255, 255, 255, 0.1)',
        }}
      >
        {/* Glow Spheres */}
        <div className="absolute -top-32 -left-32 w-96 h-96 bg-indigo-500/20 rounded-full blur-[140px] pointer-events-none" />
        <div className="absolute -bottom-32 -right-32 w-96 h-96 bg-cyan-500/20 rounded-full blur-[140px] pointer-events-none" />

        <div className="relative z-10 grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-12 items-center">
          
          {/* Left Column: Messaging & CTAs */}
          <div className="lg:col-span-7 flex flex-col gap-6 text-left">

            {/* Main Welcome Heading */}
            <h1 className="text-3xl sm:text-4xl md:text-5xl lg:text-6xl font-extrabold tracking-tight leading-[1.1] text-white">
              Build & Scale <br />
              <span className="text-gradient">Real-World Finance</span> <br />
              on Arc
            </h1>

            {/* Motto / Slogan */}
            <p className="text-base sm:text-lg md:text-xl text-slate-300 font-light leading-relaxed max-w-2xl">
              <strong className="text-white font-semibold">Arcis</strong> is the next-generation economic operating system built on Arc 
              Circle's blockchain with native USDC gas delivering 
              <span className="text-sky-300 font-medium"> unified liquidity across 13+ chains</span>, 
              <span className="text-purple-300 font-medium"> 100% real-yield vaults</span>, and 
              <span className="text-cyan-300 font-medium"> autonomous AI agent settlement</span>.
            </p>

            {/* Fast Bullet Points */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 text-xs sm:text-sm text-slate-300">
              <div className="flex items-center gap-2.5">
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                <span>Sub-Second Deterministic Finality (&lt;1.0s)</span>
              </div>
              <div className="flex items-center gap-2.5">
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                <span>Zero ETH — Native USDC Gas Engine</span>
              </div>
              <div className="flex items-center gap-2.5">
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                <span>Seedless Biometric Passkeys (WebAuthn)</span>
              </div>
              <div className="flex items-center gap-2.5">
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                <span>x402 Agent Micropayments & AI Copilot</span>
              </div>
            </div>

            {/* Call To Action Button Group */}
            <div className="flex flex-wrap items-center gap-3 pt-4">
              <button
                type="button"
                onClick={() => onNavigate('unified')}
                className="arc-btn arc-btn-primary px-6 py-3.5 rounded-full text-sm font-semibold flex items-center gap-2 shadow-lg shadow-indigo-500/25 hover:shadow-indigo-500/40 hover:scale-105 active:scale-95 transition-all cursor-pointer"
              >
                <span>DApp</span>
                <ArrowRight className="w-4 h-4" />
              </button>
              <a
                href="#features-showcase"
                className="px-4 py-3.5 text-xs text-slate-400 hover:text-slate-200 flex items-center gap-1 transition-colors"
              >
                <span>Explore Features</span>
                <ChevronDown className="w-3.5 h-3.5 animate-bounce" />
              </a>
            </div>

          </div>

          {/* Right Column: Hero Visual Artwork */}
          <div className="lg:col-span-5 relative flex justify-center items-center">
            <div className="relative w-full max-w-lg rounded-2xl overflow-hidden border border-white/15 shadow-2xl group">
              <img
                src={heroNexusImg}
                alt="Arcis Economic Operating System Nexus"
                className="w-full h-auto object-cover transform group-hover:scale-105 transition-transform duration-700"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent pointer-events-none" />
            </div>
          </div>

        </div>
      </section>

      {/* ── 2. KEY PROTOCOL HIGHLIGHTS (CLEAN & CLEAR) ── */}
      <section className="w-full">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 md:gap-5">
          {keyMetrics.map((m, idx) => {
            const Icon = m.icon
            return (
              <div
                key={idx}
                className="p-5 sm:p-6 rounded-2xl border border-white/8 bg-slate-900/50 backdrop-blur-xl flex flex-col justify-between gap-3 hover:border-white/15 hover:bg-slate-900/70 transition-all duration-200"
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-slate-400 uppercase tracking-wider">{m.label}</span>
                  <div
                    className="w-8 h-8 rounded-lg flex items-center justify-center"
                    style={{ backgroundColor: `${m.color}15`, border: `1px solid ${m.color}30` }}
                  >
                    <Icon className="w-4 h-4" style={{ color: m.color }} />
                  </div>
                </div>

                <div>
                  <div className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight">
                    {m.value}
                  </div>
                  <div className="text-xs text-slate-400 mt-1 font-normal">
                    {m.desc}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </section>

      {/* ── 3. CORE PILLARS & INTERACTIVE FEATURE SHOWCASE ── */}
      <section id="features-showcase" className="w-full flex flex-col gap-16 md:gap-20 scroll-mt-24">
        
        {/* Section Header */}
        <div className="text-center max-w-3xl mx-auto flex flex-col gap-3">
          <h2 className="text-3xl sm:text-4xl md:text-5xl font-extrabold text-white tracking-tight">
            Purpose-Built Architecture for Real-World Finance
          </h2>
          <p className="text-sm sm:text-base text-slate-400 leading-relaxed">
            Explore institutional-grade stablecoin flows, cross-chain unified liquidity, and autonomous agent orchestration powered by Arc.
          </p>
        </div>

        {/* Feature Cards Loop */}
        <div className="flex flex-col gap-14 md:gap-20">
          {corePillars.map((pillar, idx) => {
            const isReversed = idx % 2 === 1
            return (
              <div
                key={pillar.id}
                className="arc-card rounded-3xl p-6 sm:p-8 md:p-10 border border-white/10 bg-gradient-to-b from-slate-900/80 to-slate-950/90 relative overflow-hidden group"
              >
                {/* Background Ambient Glow */}
                <div
                  className="absolute top-0 right-0 w-80 h-80 rounded-full blur-[120px] pointer-events-none opacity-40 group-hover:opacity-70 transition-opacity"
                  style={{ background: pillar.accentColor }}
                />

                <div className={`grid grid-cols-1 lg:grid-cols-12 gap-8 md:gap-12 items-center ${isReversed ? 'lg:flex-row-reverse' : ''}`}>
                  
                  {/* Text Column */}
                  <div className={`lg:col-span-7 flex flex-col gap-5 text-left ${isReversed ? 'lg:order-2' : 'lg:order-1'}`}>
                    
                    <h3 className="text-2xl sm:text-3xl md:text-4xl font-bold text-white tracking-tight leading-snug">
                      {pillar.title}
                    </h3>

                    <h4 className="text-sm sm:text-base font-semibold text-sky-300">
                      {pillar.headline}
                    </h4>

                    <p className="text-sm sm:text-base text-slate-300 leading-relaxed font-normal">
                      {pillar.description}
                    </p>

                    {/* Bullet Points */}
                    <ul className="flex flex-col gap-2.5 pt-2 text-xs sm:text-sm text-slate-300">
                      {pillar.bullets.map((b, bIdx) => (
                        <li key={bIdx} className="flex items-start gap-2.5">
                          <Check className="w-4 h-4 text-emerald-400 mt-0.5 shrink-0" />
                          <span>{b}</span>
                        </li>
                      ))}
                    </ul>

                    {/* Action Button */}
                    <div className="pt-4">
                      {pillar.customAction ? (
                        <button
                          type="button"
                          onClick={pillar.customAction}
                          className="arc-btn arc-btn-primary px-5 py-3 rounded-full text-xs sm:text-sm font-semibold inline-flex items-center gap-2 cursor-pointer shadow-lg transition-transform hover:scale-105 active:scale-95"
                        >
                          <span>{pillar.ctaText}</span>
                          <ArrowRight className="w-4 h-4" />
                        </button>
                      ) : pillar.actionTab ? (
                        <button
                          type="button"
                          onClick={() => {
                            if (pillar.actionTab) {
                              onNavigate(pillar.actionTab)
                            }
                          }}
                          className="arc-btn arc-btn-primary px-5 py-3 rounded-full text-xs sm:text-sm font-semibold inline-flex items-center gap-2 cursor-pointer shadow-lg transition-transform hover:scale-105 active:scale-95"
                        >
                          <span>{pillar.ctaText}</span>
                          <ArrowRight className="w-4 h-4" />
                        </button>
                      ) : null}
                    </div>

                  </div>

                  {/* Visual Artwork Column */}
                  <div className={`lg:col-span-5 relative flex justify-center items-center ${isReversed ? 'lg:order-1' : 'lg:order-2'}`}>
                    <div className="relative w-full rounded-2xl overflow-hidden border border-white/15 shadow-2xl group-hover:border-sky-400/40 transition-colors">
                      <img
                        src={pillar.image}
                        alt={pillar.title}
                        className="w-full h-auto object-cover transform group-hover:scale-105 transition-transform duration-700"
                        loading="lazy"
                      />
                      <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent pointer-events-none" />
                    </div>
                  </div>

                </div>
              </div>
            )
          })}
        </div>

      </section>

      {/* ── 4. TECHNICAL COMPARISON MATRIX ── */}
      <section className="w-full flex flex-col gap-8">
        <div className="text-center max-w-2xl mx-auto flex flex-col gap-2">
          <h2 className="text-2xl sm:text-3xl md:text-4xl font-extrabold text-white tracking-tight">
            Why Arc L1 and Arcis Protocol?
          </h2>
          <p className="text-xs sm:text-sm text-slate-400">
            A technical architectural comparison between legacy DeFi networks and Arcis on Arc L1.
          </p>
        </div>

        <div className="overflow-x-auto rounded-2xl border border-white/10 bg-slate-900/60 backdrop-blur-md">
          <table className="w-full text-left text-xs sm:text-sm">
            <thead>
              <tr className="border-b border-white/10 bg-white/5 text-slate-300 font-mono">
                <th className="py-4 px-4 sm:px-6 font-semibold">FEATURE</th>
                <th className="py-4 px-4 sm:px-6 font-semibold text-rose-300">LEGACY L1 / L2</th>
                <th className="py-4 px-4 sm:px-6 font-semibold text-emerald-300">ARCIS ON ARC L1</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {comparisonRows.map((row, idx) => (
                <tr key={idx} className="hover:bg-white/[0.02] transition-colors">
                  <td className="py-4 px-4 sm:px-6 font-medium text-white">{row.feature}</td>
                  <td className="py-4 px-4 sm:px-6 text-slate-400 flex items-center gap-2">
                    <span className="text-rose-400 font-bold">✕</span>
                    <span>{row.legacy}</span>
                  </td>
                  <td className="py-4 px-4 sm:px-6 text-emerald-200 font-medium">
                    <div className="flex items-center gap-2">
                      <span className="text-emerald-400 font-bold">✓</span>
                      <span>{row.arcis}</span>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* ── 5. FREQUENTLY ASKED QUESTIONS (FAQ) ── */}
      <section className="w-full max-w-4xl mx-auto flex flex-col gap-6">
        <div className="text-center flex flex-col gap-2">
          <h2 className="text-2xl sm:text-3xl md:text-4xl font-extrabold text-white">
            FAQ
          </h2>
        </div>

        <div className="flex flex-col gap-3">
          {faqItems.map((item, idx) => {
            const isOpen = openFaqIndex === idx
            return (
              <div
                key={idx}
                className="rounded-2xl border border-white/10 bg-slate-900/50 overflow-hidden transition-all"
              >
                <button
                  type="button"
                  onClick={() => toggleFaq(idx)}
                  className="w-full py-4 px-6 text-left flex items-center justify-between gap-4 cursor-pointer hover:bg-white/[0.02] transition-colors"
                >
                  <span className="text-sm sm:text-base font-semibold text-white">{item.q}</span>
                  <ChevronDown
                    className={`w-5 h-5 text-sky-400 shrink-0 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`}
                  />
                </button>
                {isOpen && (
                  <div className="px-6 pb-5 pt-1 text-xs sm:text-sm text-slate-300 leading-relaxed border-t border-white/5 animate-fade-in">
                    {item.a}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </section>
    </div>
  )
}
