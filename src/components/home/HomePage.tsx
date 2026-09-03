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
import heroNexusImg from '../../assets/hero/arcis_unified_multichain.jpg'
import unifiedMultichainImg from '../../assets/hero/arcis_unified_multichain.jpg'
import nativeGasImg from '../../assets/hero/arcis_native_gas.jpg'
import passkeyVaultImg from '../../assets/hero/arcis_passkey_vault.jpg'
import realYieldImg from '../../assets/hero/arcis_real_yield.jpg'
import agentSettlementImg from '../../assets/hero/arcis_agent_settlement.jpg'
import usdcTokenImg from '../../assets/Token-Icon/USDC Token.svg'

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
        label: 'Block Finality',
        desc: 'Sub-second deterministic settlement',
        color: '#a855f7',
        silhouetteType: 'speed',
      },
      {
        value: 'Native USDC',
        label: 'Gas Engine',
        desc: 'Zero ETH needed for fees',
        color: '#2775ca',
        silhouetteType: 'usdc',
      },
      {
        value: '13+ Chains',
        label: 'Unified Balance',
        desc: 'Instant cross-chain liquidity',
        color: '#38bdf8',
        silhouetteType: 'multichain',
      },
      {
        value: '100% Real',
        label: 'Protocol Yield',
        desc: 'Compounding fee dividends',
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
        'On Arc L1, transaction fees are paid natively in USDC instead of volatile native tokens like ETH. Never worry about holding ETH for gas. Every transfer, contract call, and swap executes with predictable, sub-penny USDC transaction fees.',
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

        <div className="relative z-10 grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-8 items-center">

          {/* Left Column: Messaging & CTAs */}
          <div className="lg:col-span-6 xl:col-span-6 flex flex-col gap-6 text-left">

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

          {/* Right Column: Hero Visual Artwork (Larger, Borderless, Feathered & Dispersed) */}
          <div className="lg:col-span-6 xl:col-span-6 relative flex justify-center items-center py-4 lg:py-0">

            {/* Ambient Color Dispersion Layers (Görselin renklerini dışarıya yumuşakça dağıtan hareler) */}
            <div className="absolute -inset-4 md:-inset-8 bg-gradient-to-tr from-blue-600/30 via-sky-500/25 to-indigo-600/30 rounded-full blur-[80px] md:blur-[110px] opacity-75 pointer-events-none -z-10 animate-pulse-slow" />
            <div className="absolute inset-0 bg-sky-400/20 rounded-full blur-[140px] opacity-60 pointer-events-none -z-10" />

            {/* Borderless Image Container with Radial Feather Mask */}
            <div className="relative w-full max-w-xl lg:max-w-2xl xl:max-w-3xl group flex justify-center">
              <img
                src={heroNexusImg}
                alt="Arcis Economic Operating System Nexus"
                className="w-full h-auto object-cover transform group-hover:scale-[1.02] transition-transform duration-700 ease-out"
                style={{
                  WebkitMaskImage: 'radial-gradient(ellipse 88% 84% at 50% 50%, rgba(0,0,0,1) 48%, rgba(0,0,0,0.85) 68%, rgba(0,0,0,0) 100%)',
                  maskImage: 'radial-gradient(ellipse 88% 84% at 50% 50%, rgba(0,0,0,1) 48%, rgba(0,0,0,0.85) 68%, rgba(0,0,0,0) 100%)',
                }}
              />
            </div>
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
