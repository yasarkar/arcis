import { useState, useEffect, useRef, useCallback, lazy, Suspense } from 'react'
import { useAccount, useDisconnect } from 'wagmi'
import { useQueryClient } from '@tanstack/react-query'
import { useUserControlledWallet } from './hooks/useUserControlledWallet'
import { useModularWallet } from './hooks/useModularWallet'
import { clearAllAppInputs } from './utils/inputClearer'
import HomePage from './components/home/HomePage'
import Header from './components/Header'
import Footer from './components/Footer'
import HistoryTable from './components/HistoryTable'
import CopilotRobotWidget from './components/copilot/CopilotRobotWidget'
import { useArcCopilot } from './hooks/useArcCopilot'
import { useAutoSwitchArcChain } from './hooks/useAutoSwitchArcChain'
import { BroadcastProvider } from './components/BroadcastNotification'
import { prefetchGlobalData, prefetchAllWalletData, prefetchEssentialWalletData, prefetchDeferredWalletData } from './services/prefetchCoordinator'
import { SectionErrorBoundary } from './components/common/GlobalErrorBoundary'
import { logger } from './utils/logger'
import type { CopilotUcwHandlers } from './services/copilotExecutionService'

// ARC-027: the tabs, the four modals and both drawers are the heavy half of the app (the swap/bridge
// tabs alone pull in the CCTP and Gateway SDK surfaces). Each is loaded on demand — a tab when it is
// opened, a modal/drawer when its open flag flips — so the first paint no longer waits for all of it.
// Every one of these components returns null while closed, so mounting it only on open is a no-op
// behaviourally; the chunk request simply replaces the render that used to happen for nothing.
const UnifiedBalance = lazy(() => import('./components/UnifiedBalance'))
const PoolsTab = lazy(() => import('./components/pools/PoolsTab'))
const MarketplaceTab = lazy(() => import('./components/marketplace/MarketplaceTab'))
const SendModal = lazy(() => import('./components/SendModal'))
const SwapModal = lazy(() => import('./components/SwapModal'))
const BridgeModal = lazy(() => import('./components/BridgeModal'))
const CircleAuthModal = lazy(() => import('./components/CircleAuthModal'))
const FaucetModal = lazy(() => import('./components/FaucetModal'))
const PortfolioDrawer = lazy(() => import('./components/PortfolioDrawer'))
const ArcCopilotDrawer = lazy(() => import('./components/copilot/ArcCopilotDrawer'))

/** Placeholder for a lazily-loaded tab: keeps the page height stable while the chunk arrives. */
function TabLoadingFallback() {
  return (
    <div className="flex-1 flex items-center justify-center min-h-[40vh]" role="status" aria-live="polite">
      <div className="flex items-center gap-2 text-xs font-semibold text-slate-400">
        <span className="w-3.5 h-3.5 rounded-full border-2 border-slate-600 border-t-teal-300 animate-spin" />
        <span>Loading…</span>
      </div>
    </div>
  )
}

/** Scoped logger: skipped background work must be traceable without raw console noise. */
const log = logger.createScope('App')

function AutoChainSwitchWatcher() {
  useAutoSwitchArcChain()
  return null
}

interface CopilotHostProps {
  walletAddress: string
  connectedProvider: any
  activeAuthSource: 'passkey' | 'ucw' | 'evm' | null
  ucwAddress: string
  executeUcwTransfer?: CopilotUcwHandlers['executeUcwTransfer']
  executeUcwContract?: CopilotUcwHandlers['executeUcwContract']
  pollUcwChallengeTx?: CopilotUcwHandlers['pollChallengeTx']
  onNavigateToTab: (tab: string) => void
}

// P08: the copilot subscription lives here, not in App. Every copilot state
// update (messages streaming, analyzing ticks, drawer open/close) re-renders
// only this subtree; the shell (Header/tabs/prefetch effects) stays put.
function CopilotHost({
  walletAddress,
  connectedProvider,
  activeAuthSource,
  ucwAddress,
  executeUcwTransfer,
  executeUcwContract,
  pollUcwChallengeTx,
  onNavigateToTab,
}: CopilotHostProps) {
  // Arcis AI Copilot (Autonomous Orchestrator with Real On-Chain Execution)
  // Circle UCW signs via user challenges, so the copilot needs the UCW executors to route
  // send/swap/deposit/bridge through the active UCW wallet instead of a session key or EOA.
  const copilot = useArcCopilot(walletAddress, connectedProvider, {
    authSource: activeAuthSource,
    executeUcwTransfer,
    executeUcwContract,
    // The copilot's UCW bridge resolves its burn hash through this callback
    // rather than reading the Circle session token from browser storage.
    pollChallengeTx: pollUcwChallengeTx,
  })

  return (
    <>
      {/* Global Floating Cybernetic Robot Widget (Bottom-Left) */}
      <CopilotRobotWidget
        isOpen={copilot.isOpen}
        onClick={copilot.toggleOpen}
        isAnalyzing={copilot.isAnalyzing}
      />

      {/* Arcis AI Copilot Side Drawer */}
      <SectionErrorBoundary title="Arco AI Copilot is temporarily unavailable">
        {copilot.isOpen && (
        <Suspense fallback={null}>
        <ArcCopilotDrawer
          isOpen={copilot.isOpen}
          onClose={() => copilot.setIsOpen(false)}
          messages={copilot.messages}
          currentSteps={copilot.currentSteps}
          isAnalyzing={copilot.isAnalyzing}
          sessionConfig={copilot.sessionConfig}
          walletAddress={walletAddress || ucwAddress}
          onSendMessage={copilot.executeQuery}
          onClearChat={copilot.clearChat}
          onActivateSession={copilot.activateSession}
          onRevokeSession={copilot.revokeSession}
          onToggleAutoExecute={copilot.toggleAutoExecute}
          onExecuteInline={copilot.executeInlineAction}
          onNavigateToTab={(tab) => onNavigateToTab(tab as any)}
        />
        </Suspense>
        )}
      </SectionErrorBoundary>
    </>
  )
}

export default function App() {
  const queryClient = useQueryClient()
  const [activeTab, setActiveTab] = useState<'home' | 'unified' | 'pools' | 'send' | 'swap' | 'bridge' | 'ai-services' | 'history'>('home')
  const [chainPrefill, setChainPrefill] = useState<{ chainKey: string; timestamp: number } | null>(null)

  // P08: stable identities for memoized Header/Footer/drawers.
  const handleNavigateToTab = useCallback((tab: string, chainKey?: string) => {
    if (chainKey) {
      setChainPrefill({ chainKey, timestamp: Date.now() })
    }
    setActiveTab(tab as any)
  }, [])

  const handleConnect = useCallback(() => setActiveTab('unified'), [])
  const handleSelectActiveAuthSource = useCallback(
    (source: 'passkey' | 'ucw' | 'evm') => setPreferredAuthSource(source),
    []
  )
  const handleOpenCircleAuth = useCallback(() => setIsCircleAuthOpen(true), [])
  const handleOpenFaucet = useCallback(() => setIsFaucetOpen(true), [])
  const handleOpenPortfolio = useCallback(() => setIsPortfolioOpen(true), [])
  const handleTabNavigate = useCallback((tab: string) => setActiveTab(tab as any), [])
  
  // Controlled dev test hook for GlobalErrorBoundary verification (?testCrash=true)
  if (import.meta.env.DEV && typeof window !== 'undefined' && window.location.search.includes('testCrash=true')) {
    throw new Error('SimulationFault: Synthetic UI Render Exception triggered for ErrorBoundary verification.')
  }
  
  // Auto-scroll to top when switching tabs so user starts at the top of the tab
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' })
  }, [activeTab])

  // P10: pause infinite decorative animations while the tab is hidden so
  // background polling doesn't burn GPU/CTU on invisible frames. Resuming is
  // automatic — `animation-play-state` keeps each animation's position.
  useEffect(() => {
    const root = typeof document !== 'undefined' ? document.documentElement : null
    if (!root) return
    const sync = () => root.classList.toggle('tab-hidden', document.hidden)
    sync()
    document.addEventListener('visibilitychange', sync)
    return () => document.removeEventListener('visibilitychange', sync)
  }, [])
  
  const { address, isConnected, connector } = useAccount()
  const { disconnect } = useDisconnect()
  const [connectedProvider, setConnectedProvider] = useState<any>(null)

  // 1. Circle Modular Wallets (WebAuthn Passkey + MSCA) Integration
  const {
    isPasskeyConnected,
    mscaAddress,
    isLoading: isModularLoading,
    isRestoring: isModularRestoring,
    hasStoredCredential,
    register: registerPasskey,
    login: loginPasskey,
    disconnect: disconnectPasskey,
    sendUserOp: sendModularUserOp,
  } = useModularWallet()

  // 2. Circle UCW Integration
  const {
    ucwAddress,
    isUcwConnected,
    isLoading: isUcwLoading,
    authPhase: ucwAuthPhase,
    error: ucwError,
    otpStep,
    pendingEmail,
    requestEmailOtp,
    verifyEmailOtpCode,
    reopenOtpVerificationWindow,
    cleanupIframe,
    loginWithPin,
    loginWithSocial,
    executeContractCall: executeUcwContract,
    signTypedData: executeUcwSignTypedData,
    executeTransfer: executeUcwTransfer,
    pollChallengeTx: pollUcwChallengeTx,
    disconnectUcw,
    setOtpStep,
  } = useUserControlledWallet()

  const [isCircleAuthOpen, setIsCircleAuthOpen] = useState<boolean>(false)
  const [isFaucetOpen, setIsFaucetOpen] = useState<boolean>(false)
  const [isPortfolioOpen, setIsPortfolioOpen] = useState<boolean>(false)

  useEffect(() => {
    let active = true
    if (connector) {
      connector
        .getProvider()
        .then((p) => {
          if (active) setConnectedProvider(p)
        })
        .catch(console.error)
    } else {
      setConnectedProvider(null)
    }
    return () => {
      active = false
    }
  }, [connector])

  // Dynamic Active Wallet Resolution (Passkey vs UCW vs EVM)
  const [preferredAuthSource, setPreferredAuthSource] = useState<'passkey' | 'ucw' | 'evm' | null>(null)

  // P08: single auto-sync for the preferred auth source (was three separate
  // effects). Only a *newly established* connection updates the preference,
  // so a manual selection via the Header switcher is never fought on unrelated
  // re-renders. When several sources connect on one tick the legacy effect
  // order (evm → passkey → ucw) decided; the sequential sets below keep that.
  const prevConnRef = useRef({ evm: false, passkey: false, ucw: false })
  useEffect(() => {
    const prev = prevConnRef.current
    const nowEvm = Boolean(isConnected && address)
    const nowPasskey = Boolean(isPasskeyConnected && mscaAddress)
    const nowUcw = Boolean(isUcwConnected && ucwAddress)
    if (nowEvm && !prev.evm) setPreferredAuthSource('evm')
    if (nowPasskey && !prev.passkey) setPreferredAuthSource('passkey')
    if (nowUcw && !prev.ucw) setPreferredAuthSource('ucw')
    prevConnRef.current = { evm: nowEvm, passkey: nowPasskey, ucw: nowUcw }
  }, [isConnected, address, isPasskeyConnected, mscaAddress, isUcwConnected, ucwAddress])

  // Compute effective active auth source based on active connection states
  const activeAuthSource = (() => {
    if (preferredAuthSource === 'passkey' && isPasskeyConnected && mscaAddress) return 'passkey'
    if (preferredAuthSource === 'ucw' && isUcwConnected && ucwAddress) return 'ucw'
    if (preferredAuthSource === 'evm' && isConnected && address) return 'evm'

    // Default priority: Passkey MSCA (gasless) -> Circle UCW -> Wagmi EOA
    if (isPasskeyConnected && mscaAddress) return 'passkey'
    if (isUcwConnected && ucwAddress) return 'ucw'
    if (isConnected && address) return 'evm'
    return null
  })()

  // Active wallet address based on resolved auth source
  const walletAddress = activeAuthSource === 'passkey'
    ? mscaAddress
    : activeAuthSource === 'ucw'
    ? ucwAddress
    : activeAuthSource === 'evm'
    ? (address || '')
    : ''

  const walletConnected = Boolean(walletAddress)

  // P06: leading-edge throttle for the central refresh. A single tx success can
  // fan out here from several sources on the same tick (modal onSuccess plus
  // hook-level refetches); the first call sweeps immediately so balances never
  // look stale, repeats within the window are dropped.
  const lastRefreshAtRef = useRef(0)
  const REFRESH_THROTTLE_MS = 750
  // P08: stable identity so memoized children (Header/Footer/modals) don't
  // re-render just because the shell did.
  const refreshBalances = useCallback(() => {
    const now = Date.now()
    if (now - lastRefreshAtRef.current < REFRESH_THROTTLE_MS) return
    lastRefreshAtRef.current = now
    queryClient.invalidateQueries({ queryKey: ['gatewayBalances'] })
    queryClient.invalidateQueries({ queryKey: ['walletTestnetBalances'] })
    queryClient.invalidateQueries({ queryKey: ['onchainPoolState'] })
    if (walletAddress) {
      prefetchAllWalletData(queryClient, walletAddress).catch((err) => {
        // Best-effort prefetch: the panels fetch their own data, so a failed warm-up only costs the
        // first paint's latency and must not surface as an error to the user.
        log.debug('Wallet data prefetch failed; panels will fetch on demand:', err)
      })
    }
  }, [queryClient, walletAddress])

  // Eager background prefetch for global pool metrics (TVL, 24h Vol, Vaults) and token prices on app launch
  useEffect(() => {
    prefetchGlobalData(queryClient).catch((err) => {
      console.warn('[App] Background global prefetch failed:', err)
    })
  }, [queryClient])

  // P06: split connect-time prefetch into essential-first + idle-deferred.
  // Gateway + USDC-subset balances warm immediately (interactive balances);
  // the full record, pool positions, history, and portfolio snapshot follow
  // when the browser is idle. Panels self-fetch on mount, so deferring only
  // costs warm-up latency, never correctness.
  useEffect(() => {
    if (!walletAddress || !walletAddress.trim()) return
    const address = walletAddress
    prefetchEssentialWalletData(queryClient, address).catch((err) => {
      console.warn('[App] Background essential prefetch failed:', err)
    })

    let idleHandle: number | null = null
    let fallbackTimer: ReturnType<typeof setTimeout> | null = null
    const runDeferred = () => {
      idleHandle = null
      fallbackTimer = null
      prefetchDeferredWalletData(queryClient, address).catch((err) => {
        console.warn('[App] Background deferred prefetch failed:', err)
      })
    }
    if (typeof window !== 'undefined' && typeof window.requestIdleCallback === 'function') {
      idleHandle = window.requestIdleCallback(runDeferred, { timeout: 3000 })
    } else {
      fallbackTimer = setTimeout(runDeferred, 2000)
    }
    return () => {
      if (idleHandle !== null && typeof window !== 'undefined' && typeof window.cancelIdleCallback === 'function') {
        window.cancelIdleCallback(idleHandle)
      }
      if (fallbackTimer !== null) clearTimeout(fallbackTimer)
    }
  }, [walletAddress, queryClient])

  // Track previous connection state to trigger clearing inputs on wallet disconnect
  const prevWalletConnectedRef = useRef(walletConnected)
  const prevAddressRef = useRef(walletAddress)

  useEffect(() => {
    const wasConnected = prevWalletConnectedRef.current
    const hadAddress = Boolean(prevAddressRef.current)

    // Trigger clear inputs if previously connected and now disconnected
    if ((wasConnected && !walletConnected) || (hadAddress && !walletAddress)) {
      clearAllAppInputs()
    }

    prevWalletConnectedRef.current = walletConnected
    prevAddressRef.current = walletAddress
  }, [walletConnected, walletAddress])

  // Connect / Disconnect Wallet handler (P08: stable identity for memoized Header)
  const handleDisconnectAll = useCallback(() => {
    if (isPasskeyConnected) {
      disconnectPasskey()
    }
    if (isUcwConnected) {
      disconnectUcw()
    }
    if (isConnected) {
      disconnect()
    }
    setPreferredAuthSource(null)
    clearAllAppInputs()
  }, [isPasskeyConnected, disconnectPasskey, isUcwConnected, disconnectUcw, isConnected, disconnect])

  // P08: single-destination disconnects (stable identity for memoized Header).
  // Declared after the wallet hooks — they close over the disconnect fns.
  const handleDisconnectUcwOnly = useCallback(() => {
    disconnectUcw()
    clearAllAppInputs()
  }, [disconnectUcw])
  const handleDisconnectPasskeyOnly = useCallback(() => {
    disconnectPasskey()
    clearAllAppInputs()
  }, [disconnectPasskey])

  return (
    <BroadcastProvider>
      <AutoChainSwitchWatcher />
      <div className="min-h-screen flex flex-col selection:bg-indigo-500/30 overflow-x-hidden w-full max-w-full relative">
        {/* Background ambient light (P10: home tab only — the two 120px-blur
            orbs cost a compositor layer on every tab; identity unchanged on home) */}
        {activeTab === 'home' && (
          <>
            <div className="ambient-orb absolute top-0 left-1/4 w-96 h-96 bg-brand-primary/10 rounded-full blur-[120px] pointer-events-none animate-pulse-slow"></div>
            <div className="ambient-orb absolute top-0 right-1/4 w-96 h-96 bg-brand-secondary/10 rounded-full blur-[120px] pointer-events-none animate-pulse-slow"></div>
          </>
        )}

        {/* Header */}
        <Header
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          walletConnected={walletConnected}
          walletAddress={walletAddress}
          onConnect={handleConnect}
          onDisconnect={handleDisconnectAll}
          isPasskeyConnected={isPasskeyConnected}
          mscaAddress={mscaAddress}
          isUcwConnected={isUcwConnected}
          ucwAddress={ucwAddress}
          activeAuthSource={activeAuthSource}
          onSelectActiveAuthSource={handleSelectActiveAuthSource}
          onOpenCircleAuth={handleOpenCircleAuth}
          onDisconnectUcw={handleDisconnectUcwOnly}
          onDisconnectPasskey={handleDisconnectPasskeyOnly}
          onOpenFaucet={handleOpenFaucet}
          isRestoring={isModularRestoring}
          onOpenPortfolio={handleOpenPortfolio}
        />

        {/* Main Container */}
        <main
          className={`flex-1 mx-auto w-full py-6 md:py-10 flex flex-col gap-6 min-h-[calc(100vh+80px)] ${
            activeTab === 'home'
              ? 'max-w-[1380px] px-4 sm:px-6 md:px-8'
              : 'max-w-7xl px-4 sm:px-6 md:px-8'
          }`}
        >
          
          {/* Workspace Content */}
          <SectionErrorBoundary title="This workspace section encountered an error">
            <section className="flex-1 min-w-0 flex flex-col min-h-[calc(100vh-60px)] pb-12">
            <Suspense fallback={<TabLoadingFallback />}>

            {/* Arcis Homepage / Overview Tab */}
            {activeTab === 'home' && (
              <HomePage
                onNavigate={handleTabNavigate}
                onOpenCircleAuth={handleOpenCircleAuth}
                onOpenFaucet={handleOpenFaucet}
                walletConnected={walletConnected}
                walletAddress={walletAddress}
              />
            )}
            
            {/* Unified Balance Tab */}
            {activeTab === 'unified' && (
              <div className="flex-1 flex flex-col min-h-[calc(100vh-80px)]">
                <UnifiedBalance
                  connector={connector}
                  connectedAddress={walletAddress}
                  walletConnected={walletConnected}
                  activeAuthSource={activeAuthSource}
                  sendModularUserOp={sendModularUserOp}
                  executeUcwContract={executeUcwContract}
                />
              </div>
            )}

            {/* Pools & Yield Hub Tab */}
            {activeTab === 'pools' && (
              <div className="flex-1 flex flex-col min-h-[calc(100vh-80px)]">
                <PoolsTab
                  walletAddress={walletAddress}
                  walletConnected={walletConnected}
                  provider={connectedProvider}
                  authSource={activeAuthSource}
                  executeUcwContract={executeUcwContract}
                />
              </div>
            )}

            {/* AI Services (x402 Marketplace) Tab */}
            {activeTab === 'ai-services' && (
              <div className="flex-1 flex flex-col min-h-[calc(100vh-80px)]">
                <MarketplaceTab
                  walletAddress={walletAddress}
                  walletConnected={walletConnected}
                  provider={connectedProvider}
                  authSource={activeAuthSource}
                  onNavigate={handleTabNavigate}
                />
              </div>
            )}

            {/* Send Tab (Rendered inline) */}
            {activeTab === 'send' && (
              <div className="flex-1 flex flex-col items-center justify-start py-4 sm:py-8 min-h-[calc(100vh-80px)]">
                <SendModal
                  isOpen={true}
                  isInline={true}
                  onClose={() => {}}
                  connectedAddress={walletAddress}
                  provider={connectedProvider}
                  authSource={activeAuthSource}
                  initialChainKey={chainPrefill?.chainKey}
                  initialChainNonce={chainPrefill?.timestamp}
                  executeUcwTransfer={executeUcwTransfer}
                  onSuccess={refreshBalances}
                />
              </div>
            )}

            {/* Swap Tab (Rendered inline) */}
            {activeTab === 'swap' && (
              <div className="flex-1 flex flex-col items-center justify-start py-4 sm:py-8 min-h-[calc(100vh-80px)]">
                <SwapModal
                  isOpen={true}
                  isInline={true}
                  onClose={() => {}}
                  connectedAddress={walletAddress}
                  provider={connectedProvider}
                  currentChainId={5042002}
                  authSource={activeAuthSource}
                  initialChainKey={chainPrefill?.chainKey}
                  initialChainNonce={chainPrefill?.timestamp}
                  executeUcwContract={executeUcwContract}
                  onSuccess={refreshBalances}
                />
              </div>
            )}

            {/* Bridge Tab (Rendered inline) */}
            {activeTab === 'bridge' && (
              <div className="flex-1 flex flex-col items-center justify-start py-4 sm:py-8 min-h-[calc(100vh-80px)]">
                <BridgeModal
                  isOpen={true}
                  isInline={true}
                  onClose={() => {}}
                  connectedAddress={walletAddress}
                  provider={connectedProvider}
                  currentChainId={5042002}
                  authSource={activeAuthSource}
                  initialSourceChain={chainPrefill?.chainKey}
                  initialChainNonce={chainPrefill?.timestamp}
                  executeUcwContract={executeUcwContract}
                  signTypedData={executeUcwSignTypedData}
                  resolveUcwChallengeTx={pollUcwChallengeTx}
                  onSuccess={refreshBalances}
                />
              </div>
            )}

            {/* History Tab */}
            {activeTab === 'history' && (
              <div className="flex-1 flex flex-col min-h-[calc(100vh-80px)]">
                <HistoryTable walletAddress={walletAddress} />
              </div>
            )}

            </Suspense>
            </section>
          </SectionErrorBoundary>
        </main>

        <CopilotHost
          walletAddress={walletAddress}
          connectedProvider={connectedProvider}
          activeAuthSource={activeAuthSource}
          ucwAddress={ucwAddress}
          executeUcwTransfer={executeUcwTransfer}
          executeUcwContract={executeUcwContract}
          pollUcwChallengeTx={pollUcwChallengeTx}
          onNavigateToTab={handleNavigateToTab}
        />

        {/* Global Professional Footer */}
        <Footer
          onNavigate={handleTabNavigate}
          onOpenFaucet={handleOpenFaucet}
        />

        {/* Circle User-Controlled Wallets & Passkey Auth Modal */}
        {isCircleAuthOpen && (
        <Suspense fallback={null}>
        <CircleAuthModal
          isOpen={isCircleAuthOpen}
          onClose={() => setIsCircleAuthOpen(false)}
          onRegisterPasskey={registerPasskey}
          onLoginPasskey={loginPasskey}
          isPasskeyConnected={isPasskeyConnected}
          mscaAddress={mscaAddress}
          isUcwConnected={isUcwConnected}
          ucwAddress={ucwAddress}
          authPhase={ucwAuthPhase}
          error={ucwError}
          hasStoredCredential={hasStoredCredential}
          onRequestOtp={requestEmailOtp}
          onVerifyOtp={verifyEmailOtpCode}
          onReopenOtpVerification={reopenOtpVerificationWindow}
          onCleanupIframe={cleanupIframe}
          onLoginPin={loginWithPin}
          onLoginSocial={loginWithSocial}
          isLoading={isUcwLoading || isModularLoading}
          otpStep={otpStep}
          setOtpStep={setOtpStep}
          pendingEmail={pendingEmail}
        />
        </Suspense>
        )}

        {/* Circle Testnet Faucet Modal */}
        {isFaucetOpen && (
        <Suspense fallback={null}>
        <FaucetModal
          isOpen={isFaucetOpen}
          onClose={() => setIsFaucetOpen(false)}
          connectedAddress={walletAddress}
          onSuccess={refreshBalances}
        />
        </Suspense>
        )}

        {/* Circle Multi-Chain Portfolio Side Drawer */}
        {isPortfolioOpen && (
        <Suspense fallback={null}>
        <PortfolioDrawer
          isOpen={isPortfolioOpen}
          onClose={() => setIsPortfolioOpen(false)}
          walletAddress={walletAddress || ucwAddress || ''}
          authSource={activeAuthSource}
          onNavigateToTab={handleNavigateToTab}
          onOpenFaucet={handleOpenFaucet}
        />
        </Suspense>
        )}
      </div>
    </BroadcastProvider>
  )
}