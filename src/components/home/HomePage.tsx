import { useState } from 'react'
import { ArrowRight, ChevronDown, Check, CheckCircle2 } from 'lucide-react'
import { NetworkIcon } from '@web3icons/react/dynamic'

// Visual Artwork Assets
import heroTitaniumCardImg from '../../assets/hero/Arcis_Titanium_Card.jpg'
import unifiedVaultImg from '../../assets/hero/Arcis_Unified_Vault.jpg'
import passkeyVaultImg from '../../assets/hero/arcis_passkey_vault.jpg'
import nativeGasImg from '../../assets/hero/arcis_native_gas.jpg'
import realYieldImg from '../../assets/hero/arcis_real_yield.jpg'
import aiAgentImg from '../../assets/hero/Arcis_AI_Agent.jpg'
import universalBridgeImg from '../../assets/hero/Arcis_Universal_Bridge.jpg'
import usdcTokenImg from '../../assets/Token-Icon/USDC Token.svg'

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

  type MetricSilhouetteType = 'speed' | 'usdc' | 'multichain' | 'yield'

  // Scattered crypto raindrops (Solana, Ethereum, Injective, Base, Arbitrum, Monad, Avalanche, Polygon, etc.)
  const cryptoRainDrops = [
    // Left zone
    { chain: 'solana', left: '3%', duration: 4.6, delay: -1.2, drift: -4, size: 32 },
    { chain: 'ethereum', left: '10%', duration: 5.8, delay: -3.7, drift: 3, size: 34 },
    { chain: 'injective', left: '18%', duration: 4.1, delay: -0.6, drift: -2, size: 30 },
    { chain: 'base', left: '25%', duration: 5.2, delay: -2.5, drift: 4, size: 28 },
    { chain: 'monad', left: '33%', duration: 4.4, delay: -4.3, drift: -3, size: 30 },

    // Middle zone
    { chain: 'arbitrum-one', left: '41%', duration: 3.8, delay: -1.5, drift: 2, size: 32 },
    { chain: 'optimism', left: '49%', duration: 5.0, delay: -3.1, drift: -4, size: 28 },
    { chain: 'hyper-evm', left: '56%', duration: 4.5, delay: -0.9, drift: 3, size: 30 },
    { chain: 'polygon', left: '63%', duration: 4.2, delay: -2.2, drift: -2, size: 32 },
    { chain: 'avalanche', left: '70%', duration: 5.5, delay: -4.0, drift: 4, size: 34 },

    // Right zone
    { chain: 'solana', left: '77%', duration: 4.3, delay: -1.8, drift: -3, size: 36 },
    { chain: 'injective', left: '83%', duration: 5.1, delay: -0.4, drift: 2, size: 32 },
    { chain: 'ethereum', left: '89%', duration: 4.0, delay: -2.8, drift: -4, size: 34 },
    { chain: 'sei-network', left: '94%', duration: 5.3, delay: -3.5, drift: 1, size: 28 },
    { chain: 'unichain', left: '98%', duration: 4.7, delay: -1.1, drift: -2, size: 30 },
  ]

  const keyMetrics: Array<{
    value: string
    label: string
    desc: string
    color: string
    silhouetteType: MetricSilhouetteType
  }> = [
      {
        value: '< 1.0s',
        label: 'Finality',
        desc: 'Instant, deterministic settlement on Arc',
        color: '#a855f7',
        silhouetteType: 'speed',
      },
      {
        value: 'Native USDC',
        label: 'Gas Engine',
        desc: 'Pay transaction fees in USDC, zero ETH needed',
        color: '#2775ca',
        silhouetteType: 'usdc',
      },
      {
        value: '13+ Chains',
        label: 'Liquidity',
        desc: 'One unified balance across major networks',
        color: '#38bdf8',
        silhouetteType: 'multichain',
      },
      {
        value: '100% Real',
        label: 'Real Yield',
        desc: 'USDC earnings funded directly by protocol fees',
        color: '#f59e0b',
        silhouetteType: 'yield',
      },
    ]

  const renderMetricSilhouette = (type: MetricSilhouetteType) => {
    switch (type) {
      case 'speed':
        return (
          <svg
            viewBox="0 0 140 140"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            className="w-full h-full"
          >
            <defs>
              <linearGradient id="speedGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#a855f7" stopOpacity="0.8" />
                <stop offset="100%" stopColor="#c084fc" stopOpacity="0.2" />
              </linearGradient>
            </defs>
            {/* Rotating speed dial ring */}
            <g className="animate-chrono-spin" style={{ transformOrigin: '70px 70px' }}>
              <circle cx="70" cy="70" r="58" stroke="#a855f7" strokeWidth="1.5" strokeDasharray="4 6" opacity="0.4" />
              <circle cx="70" cy="70" r="46" stroke="#c084fc" strokeWidth="1" strokeDasharray="2 4" opacity="0.4" />
              <path d="M70 14 V22 M70 118 V126 M14 70 H22 M118 70 H126" stroke="#a855f7" strokeWidth="2" strokeLinecap="round" opacity="0.45" />
            </g>
            {/* Speed pulse Arc Arch & Lightning */}
            <g className="animate-speed-pulse" style={{ transformOrigin: '70px 70px' }}>
              {/* Arc L1 Arch Icon silhouette */}
              <path
                d="M70 32 C75.5 32 80.5 36.8 84 45.5 C85.8 50 87.1 55.5 87.9 61.5 C88 62 88.5 65 88.6 70 H88.5 C87.8 69.4 79.8 63 66.5 65 C66.7 62.7 67 60.5 67.4 58.4 C72.6 58.2 77.2 58.8 80.7 59.6 C80 55.1 78.9 51 77.5 47.5 C75.3 41.8 72.4 38.3 70 38.3 C67.5 38.3 64.6 41.8 62.4 47.5 C61.8 48.9 61.3 50.4 60.9 52 C60.3 54.2 59.8 56.5 59.4 59 C58.8 62.6 58.4 66.5 58.3 70.5 H51.4 C51.7 61 53.3 52 56 45.5 C59.5 36.8 64.5 32 70 32 Z"
                fill="url(#speedGrad)"
                opacity="0.5"
              />
              {/* Dynamic lightning beam */}
              <path
                d="M74 38 L52 74 H68 L64 104 L88 66 H72 L76 38 Z"
                fill="url(#speedGrad)"
                opacity="0.85"
              />
            </g>
            <circle cx="98" cy="48" r="2.5" fill="#c084fc" opacity="0.8" />
            <circle cx="42" cy="94" r="2" fill="#a855f7" opacity="0.6" />
            <circle cx="106" cy="88" r="1.5" fill="#e9d5ff" opacity="0.7" />
          </svg>
        )

      case 'usdc':
        return (
          <div className="relative w-full h-full flex items-center justify-center">
            {/* Glowing counter-rotating gas orbit rings in USDC Blue tones */}
            <svg
              viewBox="0 0 140 140"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
              className="absolute inset-0 w-full h-full"
            >
              {/* Outer Gas Ring - Clockwise (USDC Royal Blue) */}
              <g className="animate-orbit-cw" style={{ transformOrigin: '70px 70px' }}>
                <circle cx="70" cy="70" r="62" stroke="#2775ca" strokeWidth="1.5" strokeDasharray="5 7" opacity="0.5" />
                <path d="M70 8 A62 62 0 0 1 132 70" stroke="#3b82f6" strokeWidth="2.5" strokeLinecap="round" opacity="0.85" />
                <circle cx="132" cy="70" r="3.5" fill="#3b82f6" opacity="0.95" />
              </g>

              {/* Inner Gas Ring - Counter Clockwise (Electric Blue) */}
              <g className="animate-orbit-ccw" style={{ transformOrigin: '70px 70px' }}>
                <circle cx="70" cy="70" r="48" stroke="#60a5fa" strokeWidth="1" strokeDasharray="3 5" opacity="0.45" />
                <path d="M70 118 A48 48 0 0 1 22 70" stroke="#60a5fa" strokeWidth="2" strokeLinecap="round" opacity="0.8" />
                <circle cx="22" cy="70" r="3" fill="#93c5fd" opacity="0.95" />
              </g>
            </svg>
            {/* Authentic Levitating USDC Token Image with Blue Glow */}
            <img
              src={usdcTokenImg}
              alt="Native USDC Background"
              className="w-20 h-20 sm:w-24 sm:h-24 object-contain filter drop-shadow-[0_0_24px_rgba(39,117,202,0.8)] drop-shadow-[0_0_12px_rgba(59,130,246,0.55)] animate-float-coin"
            />
          </div>
        )

      case 'multichain':
        return (
          <svg
            viewBox="0 0 140 140"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            className="w-full h-full"
          >
            <defs>
              <linearGradient id="chainGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#38bdf8" stopOpacity="0.8" />
                <stop offset="100%" stopColor="#818cf8" stopOpacity="0.3" />
              </linearGradient>
            </defs>
            <ellipse cx="70" cy="70" rx="58" ry="24" stroke="#38bdf8" strokeWidth="1.5" strokeDasharray="4 6" transform="rotate(-30 70 70)" opacity="0.4" />
            <ellipse cx="70" cy="70" rx="58" ry="24" stroke="#818cf8" strokeWidth="1.5" strokeDasharray="4 6" transform="rotate(30 70 70)" opacity="0.4" />
            <circle cx="70" cy="70" r="54" stroke="#38bdf8" strokeWidth="1" strokeDasharray="2 6" opacity="0.3" />
            {/* Gateway Hub */}
            <circle cx="70" cy="70" r="14" fill="url(#chainGrad)" opacity="0.6" />
            <circle cx="70" cy="70" r="6" fill="#ffffff" opacity="0.95" />
            {/* Interconnected spoke lines */}
            <line x1="70" y1="70" x2="114" y2="44" stroke="#38bdf8" strokeWidth="1.5" strokeDasharray="2 3" opacity="0.6" />
            <line x1="70" y1="70" x2="26" y2="96" stroke="#38bdf8" strokeWidth="1.5" strokeDasharray="2 3" opacity="0.6" />
            <line x1="70" y1="70" x2="114" y2="96" stroke="#818cf8" strokeWidth="1.5" strokeDasharray="2 3" opacity="0.6" />
            <line x1="70" y1="70" x2="26" y2="44" stroke="#818cf8" strokeWidth="1.5" strokeDasharray="2 3" opacity="0.6" />
            <line x1="70" y1="70" x2="70" y2="16" stroke="#38bdf8" strokeWidth="1.5" strokeDasharray="2 3" opacity="0.6" />
            <line x1="70" y1="70" x2="70" y2="124" stroke="#38bdf8" strokeWidth="1.5" strokeDasharray="2 3" opacity="0.6" />
            {/* Blockchain node vertices */}
            <circle cx="114" cy="44" r="7" fill="#38bdf8" opacity="0.85" />
            <circle cx="26" cy="96" r="6.5" fill="#818cf8" opacity="0.75" />
            <circle cx="114" cy="96" r="6.5" fill="#60a5fa" opacity="0.75" />
            <circle cx="26" cy="44" r="6" fill="#38bdf8" opacity="0.75" />
            <circle cx="70" cy="16" r="5.5" fill="#a78bfa" opacity="0.8" />
            <circle cx="70" cy="124" r="5" fill="#38bdf8" opacity="0.75" />
            <circle cx="70" cy="70" r="19" stroke="#38bdf8" strokeWidth="1" opacity="0.5" />
          </svg>
        )

      case 'yield':
        return (
          <svg
            viewBox="0 0 140 140"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            className="w-full h-full"
          >
            <defs>
              <linearGradient id="yieldAreaGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#f59e0b" stopOpacity="0.45" />
                <stop offset="100%" stopColor="#f59e0b" stopOpacity="0.0" />
              </linearGradient>
              <linearGradient id="yieldLineGrad" x1="0%" y1="100%" x2="100%" y2="0%">
                <stop offset="0%" stopColor="#fbbf24" stopOpacity="0.5" />
                <stop offset="100%" stopColor="#f59e0b" stopOpacity="1" />
              </linearGradient>
            </defs>
            {/* Staggered Dividend Equalizer bars */}
            <rect x="22" y="90" width="8" height="26" rx="2" fill="#f59e0b" style={{ transformOrigin: '26px 116px', animation: 'yieldBarWave 2.4s ease-in-out infinite', animationDelay: '0.0s' }} />
            <rect x="36" y="80" width="8" height="36" rx="2" fill="#f59e0b" style={{ transformOrigin: '40px 116px', animation: 'yieldBarWave 2.4s ease-in-out infinite', animationDelay: '0.2s' }} />
            <rect x="50" y="68" width="8" height="48" rx="2" fill="#f59e0b" style={{ transformOrigin: '54px 116px', animation: 'yieldBarWave 2.4s ease-in-out infinite', animationDelay: '0.4s' }} />
            <rect x="64" y="58" width="8" height="58" rx="2" fill="#f59e0b" style={{ transformOrigin: '68px 116px', animation: 'yieldBarWave 2.4s ease-in-out infinite', animationDelay: '0.6s' }} />
            <rect x="78" y="46" width="8" height="70" rx="2" fill="#f59e0b" style={{ transformOrigin: '82px 116px', animation: 'yieldBarWave 2.4s ease-in-out infinite', animationDelay: '0.8s' }} />
            <rect x="92" y="32" width="8" height="84" rx="2" fill="#f59e0b" style={{ transformOrigin: '96px 116px', animation: 'yieldBarWave 2.4s ease-in-out infinite', animationDelay: '1.0s' }} />
            {/* Compounding Curve with glow */}
            <path
              d="M18 106 C40 102 60 90 76 66 C88 48 104 32 118 20 L118 116 L18 116 Z"
              fill="url(#yieldAreaGrad)"
            />
            <path
              d="M18 106 C40 102 60 90 76 66 C88 48 104 32 118 20"
              stroke="url(#yieldLineGrad)"
              strokeWidth="3"
              strokeLinecap="round"
              className="animate-yield-curve"
            />
            {/* Twinkling Yield Peak & Sparkles */}
            <g className="animate-yield-sparkle" style={{ transformOrigin: '118px 20px' }}>
              <circle cx="118" cy="20" r="5" fill="#f59e0b" />
              <circle cx="118" cy="20" r="9" stroke="#f59e0b" strokeWidth="1.5" opacity="0.7" />
            </g>
            <g className="animate-yield-sparkle" style={{ transformOrigin: '124px 16px', animationDelay: '0.7s' }}>
              <path d="M124 10 L126 14 L130 16 L126 18 L124 22 L122 18 L118 16 L122 14 Z" fill="#fbbf24" opacity="0.95" />
            </g>
            <g className="animate-yield-sparkle" style={{ transformOrigin: '42px 50px', animationDelay: '1.3s' }}>
              <path d="M42 46 L43 49 L46 50 L43 51 L42 54 L41 51 L38 50 L41 49 Z" fill="#fde68a" opacity="0.8" />
            </g>
          </svg>
        )
    }
  }

  const corePillars = [
    {
      id: 'unified',
      title: 'One Unified Balance across 13+ Chains',
      headline: 'Your USDC everywhere, without fragmented wallets or bridging hassle',
      description:
        'Stop juggling balances across different networks. Arcis pools your USDC across Ethereum, Solana, Base, Arbitrum, and Arc into a single balance you can spend or transfer instantly anywhere.',
      bullets: [
        'Instant Cross-Chain Spending: Move and use your USDC across supported networks in under 500ms.',
        'True Native USDC: Powered by Circle Gateway and CCTP no wrapped tokens, no synthetic risk.',
        'Zero Waiting Periods: Instant burn-and-mint settlement replaces legacy lock-and-wait bridges.',
      ],
      ctaText: 'Open Unified Balance',
      actionTab: 'unified' as TabType,
      image: unifiedVaultImg,
      accentColor: 'rgba(56, 189, 248, 0.25)',
      badgeBorder: 'border-sky-500/40 text-sky-400',
    },
    {
      id: 'passkey-msca',
      title: 'Biometric Passkey Login',
      headline: 'Sign in with Face ID or Touch ID no 24-word seed phrases to lose',
      description:
        'Create and access your smart wallet in seconds using your device\'s built-in biometric security. Experience seamless, sponsored transactions where you never have to manage private keys or calculate gas fees.',
      bullets: [
        'Hardware-Grade Security: Keys stay protected inside your device\'s secure enclave (Face ID, Touch ID, Windows Hello).',
        '100% Gasless Experience: Circle Gas Station sponsors transactions so you can start immediately.',
        'Social & Passkey Freedom: Log in with biometrics, Google, or Apple with instant account recovery.',
      ],
      ctaText: 'Connect with Passkey',
      customAction: onOpenCircleAuth,
      image: passkeyVaultImg,
      accentColor: 'rgba(6, 182, 212, 0.25)',
      badgeBorder: 'border-cyan-500/40 text-cyan-400',
    },
    {
      id: 'native-gas',
      title: 'Native USDC Gas Engine',
      headline: 'Pay gas directly in USDC. No ETH, no volatile gas tokens.',
      description:
        'Arc L1 eliminates unpredictable gas fee spikes. Every transfer, swap, and contract interaction is paid directly in USDC with sub-cent, predictable costs that make budgeting simple.',
      bullets: [
        'Predictable, Flat Fees: Gas costs a fraction of a cent in USDC, with zero crypto price surprises.',
        'Zero ETH Required: You only ever need USDC in your wallet to send, swap, and interact.',
        'Sub-Second Finality: Transactions settle irreversibly on-chain in under one second.',
      ],
      ctaText: 'Send Instant Transfer',
      actionTab: 'send' as TabType,
      image: nativeGasImg,
      accentColor: 'rgba(34, 197, 94, 0.25)',
      badgeBorder: 'border-emerald-500/40 text-emerald-400',
    },
    {
      id: 'real-yield',
      title: 'Zero-Slippage FX & Real USDC Yield',
      headline: '90% of protocol fees distributed directly to vault depositors',
      description:
        'Swap stablecoins like USDC and EURC at true 1:1 rates with zero slippage. Deposit into the Arcis Vault to earn real, compounding yields paid purely in USDC never in volatile or inflationary reward tokens.',
      bullets: [
        '1:1 Zero-Slippage Swaps: Trade stable pairs with exact price parity and no slippage loss.',
        '100% Real Yield: Earnings come exclusively from actual transaction fees and protocol volume.',
        'Auto-Compounding Vault: Your USDC compounds automatically in an audited ERC-4626 standard vault.',
      ],
      ctaText: 'Explore Pools & Vault',
      actionTab: 'pools' as TabType,
      image: realYieldImg,
      accentColor: 'rgba(245, 158, 11, 0.25)',
      badgeBorder: 'border-amber-500/40 text-amber-400',
      imageContainerClass: 'ml-4 sm:ml-8 md:ml-12 lg:ml-16 xl:ml-20',
    },
    {
      id: 'ai-agents',
      title: 'Autonomous AI Agents & Micropayments',
      headline: 'Pay-per-use APIs and intelligent AI automation on-chain',
      description:
        'Let AI agents work and transact autonomously. Use natural language to send funds or execute swaps with Arcis Copilot, and access premium AI services with instant pay-per-call micropayments no API keys or subscriptions required.',
      bullets: [
        'x402 Pay-Per-Call: Stream fractions of a cent per request directly with USDC.',
        'Arcis AI Copilot: Execute complex on-chain actions simply by chatting in plain language.',
        'Automated Job Escrow: Funds stay secured in escrow while agents complete verified tasks.',
      ],
      ctaText: 'Explore AI Services',
      actionTab: 'ai-services' as TabType,
      image: aiAgentImg,
      accentColor: 'rgba(168, 85, 247, 0.25)',
      badgeBorder: 'border-purple-500/40 text-purple-400',
    },
    {
      id: 'cross-chain-bridge',
      title: 'Universal Cross-Chain Terminal',
      headline: 'Move USDC seamlessly across EVM, Solana, and Cosmos ecosystems',
      description:
        'Connect your favorite wallets (MetaMask, Phantom, or Keplr) and transfer USDC anywhere in seconds. Powered by native Circle CCTP, eliminating wrapped token lockups and bridge exploits.',
      bullets: [
        'Circle CCTP Protocol: Direct native burning and minting with zero wrapped token risk.',
        'Multi-Wallet Simplicity: Connect EVM, Solana, and Injective wallets at the same time.',
        'Smart Route Optimization: Automatic best routing with built-in slippage protection.',
      ],
      ctaText: 'Bridge & Swap Tokens',
      actionTab: 'bridge' as TabType,
      image: universalBridgeImg,
      accentColor: 'rgba(99, 102, 241, 0.25)',
      badgeBorder: 'border-indigo-500/40 text-indigo-400',
    },
  ]

  const comparisonRows = [
    {
      feature: 'Gas Currency',
      legacy: 'Volatile tokens (ETH, SOL) required for gas fees',
      arcis: 'Native USDC (Zero ETH needed)',
    },
    {
      feature: 'Finality & Speed',
      legacy: '12–60s multi-block wait with risk of reorgs',
      arcis: '< 1.0s instant deterministic finality',
    },
    {
      feature: 'Cross-Chain Liquidity',
      legacy: 'Fragmented pools, wrapped tokens, slow bridging',
      arcis: '13+ Chains unified balance via Circle Gateway (<500ms)',
    },
    {
      feature: 'Wallet Onboarding',
      legacy: 'Complex 24-word seed phrases with risk of loss',
      arcis: 'Biometric Passkeys (Face ID / Touch ID) + Smart Accounts',
    },
    {
      feature: 'Gas Sponsorship',
      legacy: 'Users must always hold native tokens for every action',
      arcis: 'Circle Gas Station for 100% gasless user experience',
    },
    {
      feature: 'Yield Source',
      legacy: 'Inflationary farm tokens with rapidly depreciating value',
      arcis: 'Real yield from 90% of protocol fees paid in pure USDC',
    },
    {
      feature: 'AI & Micropayments',
      legacy: 'Manual wallet signatures and off-chain API subscriptions',
      arcis: 'x402 protocol: automated pay-per-call USDC micropayments',
    },
  ]

  const faqItems = [
    {
      q: 'What is Arc L1 and why does it use USDC as native gas?',
      a: 'Arc is a purpose-built Layer-1 blockchain by Circle engineered for seamless financial flows. Unlike traditional networks that require volatile tokens like ETH or SOL for fees, Arc uses native USDC directly. This gives you predictable, sub-penny transaction costs without market volatility.'
    },
    {
      q: 'How does Unified Balance work across multiple blockchains?',
      a: 'Powered by Circle Gateway, Arcis pools your USDC across 13+ networks (including Ethereum, Solana, Base, and Arbitrum) into one spendable balance. You can spend or move your funds instantly anywhere in under 500ms without traditional bridging delays.'
    },
    {
      q: 'Why are Biometric Passkeys safer than seed phrases?',
      a: 'Passkeys use your device\'s built-in hardware security (such as Face ID, Touch ID, or Windows Hello). Your cryptographic keys never leave your device, eliminating phishing attacks, clipboard hijackers, and lost seed phrases entirely.'
    },
    {
      q: 'Where does the yield in the Arcis Vault come from?',
      a: 'All returns come from real protocol economic activity. 90% of fees collected across stablecoin FX swaps, transfers, and cross-chain volume are directed into the vault as auto-compounding USDC dividends—with zero token inflation.'
    },
    {
      q: 'How can I get testnet funds to explore Arcis?',
      a: 'Click the "Faucet" button in the top navigation bar to request free testnet USDC, EURC, and native Arc gas tokens directly to test all features risk-free.'
    }
  ]

  return (
    <div className="w-full flex flex-col gap-16 md:gap-24 pb-20 animate-fade-in text-slate-100">

      {/* ── 1. HERO BANNER SECTION ── */}
      <section className="arc-card relative w-full rounded-3xl overflow-hidden border border-white/10 p-6 md:p-10 lg:p-12 transition-all group"
        style={{
          background: 'linear-gradient(145deg, rgba(16, 20, 35, 0.95) 0%, rgba(8, 10, 18, 0.98) 100%)',
          boxShadow: '0 20px 60px -15px rgba(0, 0, 0, 0.7), inset 0 1px 0 rgba(255, 255, 255, 0.1)',
        }}
      >
        {/* Glow Spheres */}
        <div className="absolute -top-32 -left-32 w-96 h-96 bg-indigo-500/20 rounded-full blur-[140px] pointer-events-none" />
        <div className="absolute -bottom-32 -right-32 w-96 h-96 bg-cyan-500/20 rounded-full blur-[140px] pointer-events-none" />

        {/* Background Hero Visual Artwork (Dynamic Levitation, Orbit Rings & Atmospheric Shimmer) */}
        <div className="absolute -right-48 sm:-right-64 md:-right-80 lg:-right-88 xl:-right-[26rem] top-1/2 -translate-y-1/2 w-[620px] sm:w-[780px] md:w-[940px] lg:w-[1120px] xl:w-[1260px] pointer-events-none select-none z-0 opacity-60 sm:opacity-75 md:opacity-90 lg:opacity-100 transition-all duration-700">
          
          {/* Pulsing Multi-layered Atmospheric Backlight */}
          <div className="absolute inset-0 bg-gradient-to-tr from-blue-600/30 via-cyan-500/20 to-indigo-600/35 rounded-full blur-[130px] pointer-events-none -z-10 animate-hero-glow group-hover:scale-110 group-hover:opacity-95 transition-all duration-700" />
          <div className="absolute top-1/4 left-1/4 w-3/5 h-3/5 bg-sky-400/20 rounded-full blur-[90px] pointer-events-none -z-10 animate-pulse" style={{ animationDuration: '4s' }} />

          {/* Futuristic Concentric Orbit Rings & High-Tech Data Arcs */}
          <svg
            viewBox="0 0 800 800"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            className="absolute inset-0 w-full h-full pointer-events-none select-none -z-10 opacity-35 group-hover:opacity-60 transition-opacity duration-700"
          >
            {/* Outer Slow Clockwise Orbit Ring */}
            <g className="animate-orbit-cw" style={{ transformOrigin: '400px 400px', animationDuration: '28s' }}>
              <circle cx="400" cy="400" r="320" stroke="#38bdf8" strokeWidth="1.5" strokeDasharray="6 14" opacity="0.4" />
              <path d="M400 80 A320 320 0 0 1 720 400" stroke="#818cf8" strokeWidth="2.5" strokeLinecap="round" opacity="0.75" />
              <circle cx="720" cy="400" r="6" fill="#38bdf8" className="filter drop-shadow-[0_0_8px_#38bdf8]" />
              <circle cx="80" cy="400" r="4.5" fill="#818cf8" />
            </g>

            {/* Middle Counter-Clockwise Orbit Ring */}
            <g className="animate-orbit-ccw" style={{ transformOrigin: '400px 400px', animationDuration: '20s' }}>
              <circle cx="400" cy="400" r="255" stroke="#a855f7" strokeWidth="1.2" strokeDasharray="4 10" opacity="0.35" />
              <path d="M400 655 A255 255 0 0 1 145 400" stroke="#22d3ee" strokeWidth="2" strokeLinecap="round" opacity="0.8" />
              <circle cx="145" cy="400" r="5" fill="#22d3ee" className="filter drop-shadow-[0_0_8px_#22d3ee]" />
            </g>

            {/* Inner Speed Track & Reticle Crosshairs */}
            <g className="animate-chrono-spin" style={{ transformOrigin: '400px 400px', animationDuration: '42s' }}>
              <circle cx="400" cy="400" r="190" stroke="#38bdf8" strokeWidth="1" strokeDasharray="2 8" opacity="0.3" />
              <line x1="400" y1="170" x2="400" y2="190" stroke="#38bdf8" strokeWidth="2" opacity="0.6" />
              <line x1="400" y1="610" x2="400" y2="630" stroke="#38bdf8" strokeWidth="2" opacity="0.6" />
              <line x1="170" y1="400" x2="190" y2="400" stroke="#38bdf8" strokeWidth="2" opacity="0.6" />
              <line x1="610" y1="400" x2="630" y2="400" stroke="#38bdf8" strokeWidth="2" opacity="0.6" />
            </g>
          </svg>

          {/* Floating Titanium Card Container */}
          <div className="relative w-full h-full animate-hero-float group-hover:scale-[1.03] transition-transform duration-700 ease-out">
            <img
              src={heroTitaniumCardImg}
              alt="Arcis L1 Institutional Layer 1 Titanium Card"
              className="w-full h-auto object-contain transform scale-100 lg:scale-105 filter drop-shadow-[0_20px_50px_rgba(0,0,0,0.85)] group-hover:drop-shadow-[0_25px_65px_rgba(39,117,202,0.35)] transition-all duration-700"
              style={{
                WebkitMaskImage: 'radial-gradient(ellipse 75% 70% at 50% 50%, rgba(0,0,0,1) 25%, rgba(0,0,0,0.85) 50%, rgba(0,0,0,0.25) 75%, rgba(0,0,0,0) 100%)',
                maskImage: 'radial-gradient(ellipse 75% 70% at 50% 50%, rgba(0,0,0,1) 25%, rgba(0,0,0,0.85) 50%, rgba(0,0,0,0.25) 75%, rgba(0,0,0,0) 100%)',
              }}
            />

            {/* Metallic Dynamic Light Shimmer Sweep */}
            <div
              className="absolute inset-0 pointer-events-none overflow-hidden"
              style={{
                WebkitMaskImage: 'radial-gradient(ellipse 75% 70% at 50% 50%, rgba(0,0,0,1) 25%, rgba(0,0,0,0.85) 50%, rgba(0,0,0,0.25) 75%, rgba(0,0,0,0) 100%)',
                maskImage: 'radial-gradient(ellipse 75% 70% at 50% 50%, rgba(0,0,0,1) 25%, rgba(0,0,0,0.85) 50%, rgba(0,0,0,0.25) 75%, rgba(0,0,0,0) 100%)',
              }}
            >
              <div className="w-[30%] h-[200%] absolute -top-1/2 bg-gradient-to-r from-transparent via-white/20 to-transparent -skew-x-12 animate-hero-shimmer" />
            </div>

            {/* Dynamic Energy Node Sparkles */}
            <div
              className="absolute top-[28%] left-[22%] w-2 h-2 rounded-full bg-cyan-300 animate-hero-particle shadow-[0_0_12px_#38bdf8]"
              style={{ ['--p-drift-x' as string]: '10px', ['--p-drift-y' as string]: '-14px', animationDelay: '0s' }}
            />
            <div
              className="absolute top-[64%] left-[35%] w-2.5 h-2.5 rounded-full bg-indigo-300 animate-hero-particle shadow-[0_0_14px_#818cf8]"
              style={{ ['--p-drift-x' as string]: '-12px', ['--p-drift-y' as string]: '-18px', animationDelay: '1.2s' }}
            />
            <div
              className="absolute top-[35%] right-[25%] w-2 h-2 rounded-full bg-sky-200 animate-hero-particle shadow-[0_0_10px_#bae6fd]"
              style={{ ['--p-drift-x' as string]: '14px', ['--p-drift-y' as string]: '-10px', animationDelay: '2.1s' }}
            />
            <div
              className="absolute top-[52%] right-[18%] w-1.5 h-1.5 rounded-full bg-purple-300 animate-hero-particle shadow-[0_0_8px_#c084fc]"
              style={{ ['--p-drift-x' as string]: '-8px', ['--p-drift-y' as string]: '-12px', animationDelay: '2.8s' }}
            />
          </div>

        </div>

        {/* Foreground Content: Messaging & CTAs */}
        <div className="relative z-10 max-w-2xl lg:max-w-3xl xl:max-w-4xl flex flex-col gap-6 text-left py-2">

          {/* Main Welcome Heading */}
          <h1 className="text-3xl sm:text-4xl md:text-5xl lg:text-6xl font-extrabold tracking-tight leading-[1.1] text-white">
            Build & Scale <br />
            <span className="text-gradient">Real-World Finance</span> <br />
            on Arc
          </h1>

          {/* Motto / Slogan */}
          <p className="text-base sm:text-lg md:text-xl text-slate-300 font-light leading-relaxed max-w-2xl">
            <strong className="text-white font-semibold">Arcis</strong> is the all-in-one financial operating system built on Arc.
            Pay gas in native USDC, access unified liquidity across 13+ chains, and earn sustainable real yield without bridges or seed phrases.
          </p>

          {/* Fast Bullet Points */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 text-xs sm:text-sm text-slate-300">
            <div className="flex items-center gap-2.5">
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
              <span>&lt; 1.0s Instant Finality</span>
            </div>
            <div className="flex items-center gap-2.5">
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
              <span>Native USDC Gas (Zero ETH)</span>
            </div>
            <div className="flex items-center gap-2.5">
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
              <span>Biometric Passkey Login</span>
            </div>
            <div className="flex items-center gap-2.5">
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
              <span>Automated AI Micropayments</span>
            </div>
          </div>

          {/* Call To Action Button Group */}
          <div className="flex flex-wrap items-center gap-3 pt-4">
            <button
              type="button"
              onClick={() => onNavigate('unified')}
              className="arc-btn arc-btn-primary px-6 py-3.5 rounded-full text-sm font-semibold flex items-center gap-2 shadow-lg shadow-indigo-500/25 hover:shadow-indigo-500/40 hover:scale-105 active:scale-95 transition-all cursor-pointer"
            >
              <span>Launch App</span>
              <ArrowRight className="w-4 h-4" />
            </button>
            <a
              href="#features-showcase"
              className="text-[13px] px-2 py-3.5 text-slate-400 hover:text-slate-200 flex items-center gap-1 transition-colors"
            >
              <span>Explore Features</span>
              <ChevronDown className="w-3.5 h-3.5" />
            </a>
          </div>

        </div>
      </section>

      {/* ── 2. KEY PROTOCOL HIGHLIGHTS (CLEAN & CLEAR) ── */}
      <section className="w-full">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 md:gap-5">
          {keyMetrics.map((m, idx) => {
            return (
              <div
                key={idx}
                className="relative overflow-hidden group p-5 sm:p-6 rounded-2xl border border-white/10 bg-slate-900/60 backdrop-blur-xl flex flex-col justify-between gap-4 hover:border-white/25 hover:bg-slate-900/80 transition-all duration-300 hover:shadow-2xl hover:-translate-y-0.5"
                style={{
                  boxShadow: '0 10px 30px -10px rgba(0, 0, 0, 0.5), inset 0 1px 0 rgba(255, 255, 255, 0.06)'
                }}
              >
                {/* Top Border Gradient Accent */}
                <div
                  className="absolute top-0 left-0 right-0 h-[1.5px] opacity-40 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none"
                  style={{
                    background: `linear-gradient(90deg, transparent 0%, ${m.color} 50%, transparent 100%)`
                  }}
                />

                {/* Bottom-Right Ambient Color Glow */}
                <div
                  className="absolute -right-6 -bottom-6 w-32 h-32 rounded-full blur-[45px] pointer-events-none opacity-20 group-hover:opacity-45 transition-opacity duration-500"
                  style={{ backgroundColor: m.color }}
                />

                {/* Background Silhouette / Visual */}
                {m.silhouetteType === 'multichain' ? (
                  <>
                    {/* Ambient orbital constellation backdrop */}
                    <div className="absolute -right-2 -bottom-2 sm:-right-3 sm:-bottom-3 w-24 h-24 sm:w-28 sm:h-28 md:w-32 md:h-32 pointer-events-none select-none z-0 opacity-15 flex items-center justify-center">
                      {renderMetricSilhouette('multichain')}
                    </div>

                    {/* Scattered Raindrop Shower of Chain Icons (Left, Center, Right) */}
                    <div className="absolute inset-0 pointer-events-none select-none z-0 overflow-hidden">
                      {cryptoRainDrops.map((drop, idx) => (
                        <div
                          key={`drop-${idx}-${drop.chain}`}
                          className="absolute top-0 animate-crypto-rain flex items-center justify-center rounded-full bg-slate-950/80 border border-sky-400/30 shadow-[0_2px_10px_rgba(56,189,248,0.25)] backdrop-blur-[2px]"
                          style={{
                            left: drop.left,
                            width: drop.size,
                            height: drop.size,
                            animationDuration: `${drop.duration}s`,
                            animationDelay: `${drop.delay}s`,
                            ['--drift-x' as string]: `${drop.drift}px`,
                          }}
                        >
                          <NetworkIcon name={drop.chain} size={Math.round(drop.size * 0.65)} variant="branded" />
                        </div>
                      ))}
                    </div>
                  </>
                ) : (
                  <div className="absolute -right-2 -bottom-2 sm:-right-3 sm:-bottom-3 w-24 h-24 sm:w-28 sm:h-28 md:w-32 md:h-32 pointer-events-none select-none z-0 transition-all duration-500 ease-out group-hover:scale-110 group-hover:opacity-40 opacity-20 sm:opacity-25 flex items-center justify-center">
                    {renderMetricSilhouette(m.silhouetteType)}
                  </div>
                )}

                {/* Card Header & Badge */}
                <div className="relative z-10 flex items-center justify-between">
                  <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">{m.label}</span>
                </div>

                {/* Card Value & Description */}
                <div className="relative z-10">
                  <div className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight drop-shadow-md">
                    {m.value}
                  </div>
                  <div className="text-xs text-slate-300 mt-1 font-normal leading-relaxed drop-shadow-sm">
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
            Built for Modern On-Chain Finance
          </h2>
          <p className="text-sm sm:text-base text-slate-400 leading-relaxed">
            Instant settlement, unified cross-chain balances, and autonomous agent orchestration powered by Arc.
          </p>
        </div>

        {/* Feature Cards Loop */}
        <div className="flex flex-col gap-14 md:gap-20">
          {corePillars.map((pillar, idx) => {
            const isReversed = idx % 2 === 1
            return (
              <div
                key={pillar.id}
                className="arc-card rounded-3xl p-6 sm:p-8 md:p-10 lg:p-12 border border-white/10 bg-gradient-to-b from-slate-900/80 to-slate-950/90 relative overflow-hidden group"
              >
                {/* Background Ambient Glow */}
                <div
                  className="absolute top-0 right-0 w-96 h-96 rounded-full blur-[140px] pointer-events-none opacity-35 group-hover:opacity-60 transition-opacity"
                  style={{ background: pillar.accentColor }}
                />

                {/* Background Visual Artwork (Ambient Background Layer, Feather-Dissolved) */}
                {pillar.image && (
                  <div
                    className={`absolute ${
                      isReversed
                        ? '-left-28 sm:-left-36 md:-left-48 lg:-left-56 xl:-left-56'
                        : '-right-20 sm:-right-28 md:-right-36 lg:-right-40 xl:-right-48'
                    } ${pillar.imageContainerClass || ''} top-1/2 -translate-y-1/2 w-[400px] sm:w-[520px] md:w-[640px] lg:w-[760px] xl:w-[860px] pointer-events-none select-none z-0 opacity-40 sm:opacity-55 md:opacity-75 lg:opacity-90 transition-all duration-700`}
                  >
                    {/* Soft Backlight */}
                    <div
                      className="absolute inset-0 rounded-full blur-[110px] pointer-events-none opacity-35 -z-10"
                      style={{ background: pillar.accentColor }}
                    />

                    <img
                      src={pillar.image}
                      alt={pillar.title}
                      className="w-full h-auto object-contain transform scale-90 sm:scale-95 group-hover:scale-100 transition-transform duration-700 ease-out"
                      loading="lazy"
                      style={{
                        WebkitMaskImage:
                          'radial-gradient(ellipse 75% 70% at 50% 50%, rgba(0,0,0,1) 15%, rgba(0,0,0,0.8) 42%, rgba(0,0,0,0.2) 68%, rgba(0,0,0,0) 100%)',
                        maskImage:
                          'radial-gradient(ellipse 75% 70% at 50% 50%, rgba(0,0,0,1) 15%, rgba(0,0,0,0.8) 42%, rgba(0,0,0,0.2) 68%, rgba(0,0,0,0) 100%)',
                      }}
                    />
                  </div>
                )}

                {/* Foreground Content: Text & Bullets */}
                <div
                  className={`relative z-10 max-w-xl lg:max-w-2xl xl:max-w-3xl flex flex-col gap-5 text-left py-2 ${
                    isReversed ? 'lg:ml-auto' : ''
                  }`}
                >
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
              </div>
            )
          })}
        </div>

      </section>

      {/* ── 4. TECHNICAL COMPARISON MATRIX ── */}
      <section className="w-full flex flex-col gap-8">
        <div className="text-center max-w-3xl mx-auto flex flex-col gap-2">
          <h2 className="text-2xl sm:text-3xl md:text-4xl font-extrabold text-white tracking-tight">
            Why Arcis on Arc L1?
          </h2>
          <p className="text-xs sm:text-sm text-slate-400">
            See how native USDC gas and unified liquidity transform the on-chain financial experience.
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
      <section className="w-full max-w-4xl lg:max-w-5xl mx-auto flex flex-col gap-6">
        <div className="text-center flex flex-col gap-2">
          <h2 className="text-2xl sm:text-3xl md:text-4xl font-extrabold text-white">
            Frequently Asked Questions
          </h2>
          <p className="text-xs sm:text-sm text-slate-400">
            Everything you need to know about Arcis, Arc L1, and native USDC finance.
          </p>
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
