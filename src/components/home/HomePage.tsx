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

  const protocolMetrics = [
    { label: 'CHAIN NETWORK', value: 'Arc Testnet', sub: 'Chain ID: 5042002', icon: Activity, color: '#38bdf8' },
    { label: 'BLOCK FINALITY', value: '< 1.0s', sub: 'Deterministic Finality', icon: Zap, color: '#a855f7' },
    { label: 'NATIVE GAS ASSET', value: 'USDC Only', sub: '0x3600...0000 (Zero ETH)', icon: Coins, color: '#22c55e' },
    { label: 'CROSS-CHAIN GATEWAY', value: '13+ Chains', sub: '<500ms Burn & Mint', icon: Globe, color: '#6366f1' },
    { label: 'SMART ACCOUNTS', value: 'WebAuthn MSCA', sub: 'Biometric Passkey / Gasless', icon: KeyRound, color: '#06b6d4' },
    { label: 'REAL-YIELD MODEL', value: 'ERC-4626 Vault', sub: '100% Protocol Volume Fees', icon: Layers, color: '#f59e0b' },
  ]

  const corePillars = [
    {
      id: 'unified',
      ref: '//01. MULTI-CHAIN LIQUIDITY NEXUS',
      title: '13+ Zincirde Tek Birleşik Bakiye',
      headline: 'Parçalanmış Likiditeye ve Köprü Çilesine Kesin Çözüm',
      description:
        'Circle Gateway ve CCTP entegrasyonu ile Ethereum, Base, Arbitrum, Solana, Avalanche ve Arc Testnet üzerindeki tüm USDC bakiyelerinizi tek bir havuzda birleştirin. <500ms yakma-basma hızıyla zincirler arası bekleme olmadan doğrudan dilediğiniz ağda harcayın.',
      bullets: [
        'Anında Birleşik Bakiye: Farklı cüzdan ve ağlardaki USDC tek çatı altında.',
        'Sıfır İkincil Token Riski: Sentetik veya sarılmış (wrapped) token değil, doğrudan native USDC.',
        'Sub-Second Cross-Chain Settlement: Gateway izin istemeyen mint mekanizması.',
      ],
      ctaText: 'Birleşik Bakiyeyi Başlat',
      actionTab: 'unified' as TabType,
      image: unifiedMultichainImg,
      accentColor: 'rgba(56, 189, 248, 0.25)',
      badgeBorder: 'border-sky-500/40 text-sky-400',
    },
    {
      id: 'native-gas',
      ref: '//02. NATIVE USDC GAS ENGINE',
      title: 'Sıfır ETH, Sıfır Volatilite: Doğrudan USDC ile Gaz',
      headline: 'Dalgalı Gas Maliyetlerine Son Veren İlk Kurumsal L1 Blokzinciri',
      description:
        'Arc blokzincirinde gaz ücretleri ETH yerine yerel olarak USDC (0x3600...0000) ile ödenir. Cüzdanınızda ETH bulundurma zorunluluğunu unutun. Tüm transferler, kontrat çağrıları ve takaslar mikro-kuruşluk sabit ve öngörülebilir USDC ücretleriyle gerçekleşir.',
      bullets: [
        'Tahmin Edilebilir Muhasebe: Şirketler ve kullanıcılar için sabit bütçelenebilir gas.',
        '18 Dec Native Gas & 6 Dec ERC-20 Çift Motor Mimarisi.',
        '1 saniyenin altında geri dönülemez kesinlik (sub-second deterministic finality).',
      ],
      ctaText: 'Hızlı Transfer Yap',
      actionTab: 'send' as TabType,
      image: nativeGasImg,
      accentColor: 'rgba(34, 197, 94, 0.25)',
      badgeBorder: 'border-emerald-500/40 text-emerald-400',
    },
    {
      id: 'passkey-msca',
      ref: '//03. BIOMETRIC PASSKEYS & MSCA',
      title: 'Tohum Kelimesiz, Biyometrik Web3 Girişi',
      headline: 'FaceID & TouchID ile Saniyeler İçinde Gazsız Akıllı Hesap',
      description:
        'Circle Modular Wallets ve ERC-6900 MSCA mimarisi ile tohum kelime (seed phrase) not alma veya kaybetme korkusu olmadan, donanım seviyesinde biyometrik güvenlikle giriş yapın. Circle Gas Station paymaster ile işlemlerinizi gaz ücreti ödemeden imzalayın.',
      bullets: [
        'WebAuthn / FIDO2 Donanım Enklav Koruması: Cihazınızın Secure Enclave çipiyle imzalama.',
        'Circle Gas Station Paymaster: Kullanıcı dostu tamamen sponsorsuz (gasless) işlemler.',
        'Sosyal Giriş (Google / Apple) ve MPC Kullanıcı Kontrollü Cüzdan Alternatifi.',
      ],
      ctaText: 'Passkey Girişi Yap',
      customAction: onOpenCircleAuth,
      image: passkeyVaultImg,
      accentColor: 'rgba(6, 182, 212, 0.25)',
      badgeBorder: 'border-cyan-500/40 text-cyan-400',
    },
    {
      id: 'real-yield',
      ref: '//04. DUAL-AMM & REAL-YIELD VAULTS',
      title: 'Sıfır Kaymalı FX ve Enflasyonsuz Gerçek Getiri',
      headline: 'Protokol İşlem Ücretlerinin %90\'ını Saf USDC Olarak Dağıtan ERC-4626 Kasası',
      description:
        'Çift AMM modelimiz, sabit varlıklar (USDC/EURC) için Sabit-Toplam (x + y = k) mekanizması ile sıfır kaymalı döviz takası sağlarken, piyasa varlıkları için Sabit-Çarpım (x * y = k) havuzları sunar. Üretilen tüm ücretler YieldVault (af-USDC) kasasında enflasyonsuz reel getiri olarak birikir.',
      bullets: [
        'Constant-Sum Zero Slippage: Kararlı kur paritelerinde tam 1:1 sermaye verimliliği.',
        'ERC-4626 Standart af-USDC Kasası: Otomatik bileşik getiri ve saf USDC temettüleri.',
        'Sıfır Enflasyonist Baskı: Değersiz farm tokenları yerine gerçek platform hacmi getirisi.',
      ],
      ctaText: 'Havuzları & Kasayı Gör',
      actionTab: 'pools' as TabType,
      image: realYieldImg,
      accentColor: 'rgba(245, 158, 11, 0.25)',
      badgeBorder: 'border-amber-500/40 text-amber-400',
    },
    {
      id: 'ai-agents',
      ref: '//05. AUTONOMOUS AGENTIC ECONOMY',
      title: 'Ajanlar İçin Otonom Mikro-Ödemeler & x402',
      headline: 'Yapay Zeka Ajanlarının Zincir İçi Sözleşme Yaptığı ve Ödeme Aldığı Platform',
      description:
        'HTTP 402 ve ERC-8183 / ERC-8004 protokolleri ile yapay zeka ajanları API çağrıları satın alabilir, veri kaynaklarına anlık ödeme yapabilir ve kontrat tabanlı görevleri otonom tamamlayabilir. Arcis AI Copilot ile doğal dilde doğrudan zincir içi işlem yönetimi gerçekleştirin.',
      bullets: [
        'x402 Pay-Per-Call API Protokolü: Kredi kartı veya üyelik gerektirmeden çağrı başına USDC mikro-ödeme.',
        'Yield-Generating Escrow: Ajan görevleri yürütülürken emanet havuzu ERC-4626 kasasında getiri üretir.',
        'Arcis AI Copilot: Doğal dille transfer, arbitraj ve takas yürüten otonom yapay zeka orkestratörü.',
      ],
      ctaText: 'AI Servislerini Keşfet',
      actionTab: 'ai-services' as TabType,
      image: agentSettlementImg,
      accentColor: 'rgba(168, 85, 247, 0.25)',
      badgeBorder: 'border-purple-500/40 text-purple-400',
    },
    {
      id: 'cross-chain-bridge',
      ref: '//06. UNIVERSAL ECOSYSTEM BRIDGES',
      title: 'EVM, Solana ve Injective Arasında Evrensel Köprü',
      headline: 'Farklı Kripto Ekosistemleri Tek Bir Akıcı Terminalde Buluşuyor',
      description:
        'Circle CCTP ve yerel adaptörler ile Solana Phantom, Injective Keplr ve EVM MetaMask/RainbowKit cüzdanlarınızı aynı anda bağlayın. Ekosistemler arasında kayıpsız, güvenli ve anlık çapraz transfer ve takas gerçekleştirin.',
      bullets: [
        'Doğrudan Circle CCTP v2 Doğrulayıcı Güvencesi.',
        'Solana SPL Token ve EVM ERC-20 Varlıkları Tek Arayüzde.',
        'Kayıp Önleme ve Otomatik En Uygun Rota Yönlendirmesi.',
      ],
      ctaText: 'Köprü & Takasa Git',
      actionTab: 'bridge' as TabType,
      image: heroNexusImg,
      accentColor: 'rgba(99, 102, 241, 0.25)',
      badgeBorder: 'border-indigo-500/40 text-indigo-400',
    },
  ]

  const comparisonRows = [
    { feature: 'Yerel Gaz Para Birimi', legacy: 'Volatil ETH, SOL, MATIC (Sürekli bakiye gerektirir)', arcis: 'Doğrudan Yerel USDC (0x3600...0000), Sıfır ETH' },
    { feature: 'İşlem Kesinliği & Hız', legacy: '12-60 saniye çoklu blok onayı ve re-org riski', arcis: '< 1.0 Saniye Deterministik Geri Dönülemez Kesinlik' },
    { feature: 'Çoklu Zincir Likiditesi', legacy: 'Parçalanmış havuzlar, sarılmış köprü tokenları (Wrapped)', arcis: 'Circle Gateway ile 13+ Ağda Tek Birleşik Bakiye (<500ms)' },
    { feature: 'Cüzdan Giriş & Güvenlik', legacy: '12-24 tohum kelime, phishing ve anahtar kaybetme riski', arcis: 'Biyometrik WebAuthn Passkey (FaceID/TouchID) + MSCA' },
    { feature: 'İşlem Ücreti Sponsorluğu', legacy: 'Kullanıcı her zaman kendi gasını ödemek zorundadır', arcis: 'Circle Gas Station Paymaster ile Tamamen Gazsız Deneyim' },
    { feature: 'Getiri Mekanizması', legacy: 'Enflasyonist, değeri hızla eriyen yönetim tokenları', arcis: 'ERC-4626 Gerçek Getiri (%90 Protokol Ücreti Saf USDC)' },
    { feature: 'Yapay Zeka & Ajan Desteği', legacy: 'Manuel cüzdan onayları, API anahtarı bağımlılıkları', arcis: 'ERC-8183 / ERC-8004 & x402 Otomatik Mikro-Ödemeler' },
  ]

  const faqItems = [
    {
      q: 'Arc L1 nedir ve USDC nasıl yerel gaz belirteci olarak kullanılır?',
      a: 'Arc, Circle tarafından kurumsal ve finansal akışlar için özel geliştirilmiş bir Layer-1 blokzinciridir. Geleneksel blokzincirlerde gaz için ETH veya AVAX gerekirken, Arc L1 motorunda gaz ücretleri yerel olarak doğrudan USDC (0x3600...0000) ile ödenir. Bu sayede işletmeler ve kullanıcılar kuruşluk ve sabit maliyetlerle işlem yapabilir.'
    },
    {
      q: 'Unified Balance (Birleşik Bakiye) nasıl çalışır?',
      a: 'Circle Gateway ve Unified Balance Kit sayesinde; Ethereum, Base, Arbitrum, Solana, Avalanche ve Arc Testnet üzerindeki USDC fonlarınız tek bir havuzda birleştirilir. Cüzdanınızdaki fonları köprülemek zorunda kalmadan, izin istemeyen yakma-basma mimarisiyle dilediğiniz ağda 500 milisaniyenin altında harcayabilirsiniz.'
    },
    {
      q: 'Passkey (Biyometrik) giriş tohum kelimelerden neden daha güvenlidir?',
      a: 'Passkey teknolojisi FIDO2 / WebAuthn standartlarını kullanır. Özel anahtar telefonunuzun veya bilgisayarınızın Secure Enclave çipinde donanımsal olarak saklanır ve asla dışarı sızdırılamaz. Tohum kelime kopyalama, kaybetme veya phishing yoluyla çalınma riski tamamen ortadan kalkar.'
    },
    {
      q: 'ERC-4626 Yield Vault kasasında getiri nasıl üretilir?',
      a: 'Arcis üzerindeki tüm transfer, swap ve köprü işlemlerinden alınan küçük protokol ücretlerinin %90\'ı doğrudan YieldVault kasasına saf USDC olarak aktarılır. Hiçbir enflasyonist farm tokenı basılmaz; getiriniz gerçek protokol kullanım hacminden beslenir ve af-USDC hisseniz üzerinden otomatik olarak katlanır.'
    },
    {
      q: 'Testnet USDC ve Arc Testnet fonlarını nasıl alabilirim?',
      a: 'Üst menüdeki veya bu sayfadaki "Faucet" butonuna tıklayarak Circle Faucet API üzerinden ücretsiz testnet USDC, EURC ve test varlıkları talep edebilirsiniz. Cüzdan adresinizi girip butona basmanız yeterlidir.'
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
            
            {/* Technical Eyebrow Tag */}
            <div className="inline-flex items-center gap-2.5 px-3.5 py-1.5 rounded-full border border-sky-400/30 bg-sky-950/40 w-fit backdrop-blur-md">
              <span className="w-2 h-2 rounded-full bg-sky-400 animate-ping" />
              <span className="arc-eyebrow text-xs tracking-widest text-sky-300 font-mono font-medium">
                ARC.RUNTIME | TESTNET 5042002
              </span>
            </div>

            {/* Main Welcome Heading */}
            <h1 className="text-3xl sm:text-4xl md:text-5xl lg:text-6xl font-extrabold tracking-tight leading-[1.1] text-white">
              Build & Scale <br />
              <span className="text-gradient">Real-World Finance</span> <br />
              on Arc L1.
            </h1>

            {/* Motto / Slogan */}
            <p className="text-base sm:text-lg md:text-xl text-slate-300 font-light leading-relaxed max-w-2xl">
              <strong className="text-white font-semibold">Arcis</strong>, Circle'ın yerel USDC gas mimarisine sahip Arc blokzinciri üzerinde inşa edilmiş, 
              <span className="text-sky-300 font-medium"> 13+ zincirde tek birleşik bakiye</span>, 
              <span className="text-purple-300 font-medium"> %100 gerçek getirili kasalar</span> ve 
              <span className="text-cyan-300 font-medium"> otonom AI ajan ödemeleri</span> sunan yeni nesil finansal işletim sistemidir.
            </p>

            {/* Fast Bullet Points */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 text-xs sm:text-sm text-slate-300">
              <div className="flex items-center gap-2.5">
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                <span>Sub-Second Deterministik Kesinlik (&lt;1s)</span>
              </div>
              <div className="flex items-center gap-2.5">
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                <span>Sıfır ETH — Tüm Gaz Yerel USDC</span>
              </div>
              <div className="flex items-center gap-2.5">
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                <span>Biyometrik Passkey ile Tohumsuz Giriş</span>
              </div>
              <div className="flex items-center gap-2.5">
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                <span>x402 Ajan Mikro-Ödemeleri ve Copilot</span>
              </div>
            </div>

            {/* Call To Action Button Group */}
            <div className="flex flex-wrap items-center gap-3 pt-4">
              <button
                type="button"
                onClick={() => onNavigate('unified')}
                className="arc-btn arc-btn-primary px-6 py-3.5 rounded-full text-sm font-semibold flex items-center gap-2 shadow-lg shadow-indigo-500/25 hover:shadow-indigo-500/40 hover:scale-105 active:scale-95 transition-all cursor-pointer"
              >
                <span>DApp'i Başlat (Unified Balance)</span>
                <ArrowRight className="w-4 h-4" />
              </button>

              {onOpenCircleAuth && (
                <button
                  type="button"
                  onClick={onOpenCircleAuth}
                  className="px-5 py-3.5 rounded-full text-sm font-medium border border-cyan-400/40 bg-cyan-950/30 hover:bg-cyan-900/40 text-cyan-200 hover:text-white flex items-center gap-2 transition-all cursor-pointer backdrop-blur-sm"
                >
                  <KeyRound className="w-4 h-4 text-cyan-400" />
                  <span>Passkey Girişi</span>
                </button>
              )}

              {onOpenFaucet && (
                <button
                  type="button"
                  onClick={onOpenFaucet}
                  className="px-5 py-3.5 rounded-full text-sm font-medium border border-white/15 bg-white/5 hover:bg-white/10 text-slate-300 hover:text-white flex items-center gap-2 transition-all cursor-pointer backdrop-blur-sm"
                  title="Testnet USDC ve Token İste"
                >
                  <Droplets className="w-4 h-4 text-sky-400" />
                  <span>Testnet Faucet</span>
                </button>
              )}

              <a
                href="#features-showcase"
                className="px-4 py-3.5 text-xs text-slate-400 hover:text-slate-200 flex items-center gap-1 transition-colors"
              >
                <span>Özellikleri Keşfet</span>
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
              
              {/* Floating Overlay Badge */}
              <div className="absolute bottom-4 left-4 right-4 p-3.5 rounded-xl backdrop-blur-xl bg-black/60 border border-white/10 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-lg bg-indigo-500/20 border border-indigo-400/30 flex items-center justify-center text-indigo-300">
                    <Database className="w-5 h-5" />
                  </div>
                  <div>
                    <div className="text-xs font-semibold text-white">Arcis Protocol Engine</div>
                    <div className="text-[10px] text-emerald-400 flex items-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                      Deterministic L1 Finality Active
                    </div>
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-xs font-mono font-bold text-sky-300">USDC Gas</div>
                  <div className="text-[10px] text-slate-400">Sub-penny fees</div>
                </div>
              </div>
            </div>
          </div>

        </div>
      </section>

      {/* ── 2. LIVE PROTOCOL & NETWORK METRICS TICKER ── */}
      <section className="w-full">
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 sm:gap-4">
          {protocolMetrics.map((m, idx) => {
            const Icon = m.icon
            return (
              <div
                key={idx}
                className="arc-card p-4 flex flex-col gap-2 rounded-2xl border border-white/5 bg-slate-900/60 hover:border-white/15 transition-all group"
              >
                <div className="flex items-center justify-between text-slate-400">
                  <span className="text-[10px] font-mono tracking-wider uppercase text-slate-400">{m.label}</span>
                  <Icon className="w-4 h-4 transition-transform group-hover:scale-110" style={{ color: m.color }} />
                </div>
                <div className="text-base sm:text-lg font-bold text-white tracking-tight">{m.value}</div>
                <div className="text-[11px] text-slate-400 truncate">{m.sub}</div>
              </div>
            )
          })}
        </div>
      </section>

      {/* ── 3. CORE PILLARS & INTERACTIVE FEATURE SHOWCASE ── */}
      <section id="features-showcase" className="w-full flex flex-col gap-16 md:gap-20 scroll-mt-24">
        
        {/* Section Header */}
        <div className="text-center max-w-3xl mx-auto flex flex-col gap-3">
          <div className="inline-flex items-center justify-center gap-2 text-xs font-mono text-sky-400 tracking-widest uppercase">
            <span>&#123;</span>
            <span>CORE ARCHITECTURE & PILLARS</span>
            <span>&#125;</span>
          </div>
          <h2 className="text-3xl sm:text-4xl md:text-5xl font-extrabold text-white tracking-tight">
            Gerçek Dünya Finansını Zincir Üstüne Taşıyan Mimari
          </h2>
          <p className="text-sm sm:text-base text-slate-400 leading-relaxed">
            Kurumsal ölçekte stablecoin akışları, çapraz zincir birleşik likidite ve otonom ajan koordinasyonu için Arc L1 altyapısının sağladığı tüm yetenekleri keşfedin.
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
                    
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs text-sky-400/90 tracking-wider">
                        {pillar.ref}
                      </span>
                    </div>

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
          <div className="inline-flex items-center justify-center gap-2 text-xs font-mono text-purple-400 tracking-widest uppercase">
            <span>// ARCHITECTURE COMPARISON</span>
          </div>
          <h2 className="text-2xl sm:text-3xl md:text-4xl font-extrabold text-white tracking-tight">
            Neden Arc L1 ve Arcis Protocol?
          </h2>
          <p className="text-xs sm:text-sm text-slate-400">
            Geleneksel DeFi ağları ile Circle'ın yerel USDC zincirindeki Arcis Protokolünün teknik karşılaştırması.
          </p>
        </div>

        <div className="overflow-x-auto rounded-2xl border border-white/10 bg-slate-900/60 backdrop-blur-md">
          <table className="w-full text-left text-xs sm:text-sm">
            <thead>
              <tr className="border-b border-white/10 bg-white/5 text-slate-300 font-mono">
                <th className="py-4 px-4 sm:px-6 font-semibold">ÖZELLİK / STANDART</th>
                <th className="py-4 px-4 sm:px-6 font-semibold text-rose-300">GELENEKSEL L1 / L2 AĞLARI</th>
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
          <div className="text-xs font-mono text-cyan-400 tracking-widest uppercase">
            <span>// FREQUENTLY ASKED QUESTIONS</span>
          </div>
          <h2 className="text-2xl sm:text-3xl md:text-4xl font-extrabold text-white">
            Sıkça Sorulan Sorular
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
