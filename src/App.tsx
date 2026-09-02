import { useState, useEffect } from 'react'
import { useAccount, useDisconnect } from 'wagmi'
import { useQueryClient } from '@tanstack/react-query'
import { useUserControlledWallet } from './hooks/useUserControlledWallet'
import { useModularWallet } from './hooks/useModularWallet'
import CircleAuthModal from './components/CircleAuthModal'
import FaucetModal from './components/FaucetModal'
import UnifiedBalance from './components/UnifiedBalance'
import HomePage from './components/home/HomePage'
import Header from './components/Header'
import Footer from './components/Footer'
import HistoryTable from './components/HistoryTable'
import PoolsTab from './components/pools/PoolsTab'
import SendModal from './components/SendModal'
import BridgeModal from './components/BridgeModal'
import SwapModal from './components/SwapModal'
import MarketplaceTab from './components/marketplace/MarketplaceTab'
import CopilotRobotWidget from './components/copilot/CopilotRobotWidget'
import { useArcCopilot } from './hooks/useArcCopilot'
import { useAutoSwitchArcChain } from './hooks/useAutoSwitchArcChain'
import { BroadcastProvider } from './components/BroadcastNotification'
import ArcCopilotDrawer from './components/copilot/ArcCopilotDrawer'

function AutoChainSwitchWatcher() {
  useAutoSwitchArcChain()
  return null
}

export default function App() {
  const queryClient = useQueryClient()
  const [activeTab, setActiveTab] = useState<'home' | 'unified' | 'pools' | 'send' | 'swap' | 'bridge' | 'ai-services' | 'history'>('home')
  
  // Auto-scroll to top when switching tabs so user starts at the top of the tab
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' })
  }, [activeTab])
  
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
  } = useModularWallet()

  // 2. Circle UCW Integration
  const {
    ucwAddress,
    isUcwConnected,
    isLoading: isUcwLoading,
    otpStep,
    pendingEmail,
    requestEmailOtp,
    verifyEmailOtpCode,
    loginWithPin,
    loginWithSocial,
    disconnectUcw,
    setOtpStep,
  } = useUserControlledWallet()

  const [isCircleAuthOpen, setIsCircleAuthOpen] = useState<boolean>(false)
  const [isFaucetOpen, setIsFaucetOpen] = useState<boolean>(false)

  useEffect(() => {
    if (connector) {
      connector.getProvider().then(setConnectedProvider).catch(console.error)
    } else {
      setConnectedProvider(null)
    }
  }, [connector])

  // Dynamic Active Wallet Resolution (Passkey vs UCW vs EVM)
  const [preferredAuthSource, setPreferredAuthSource] = useState<'passkey' | 'ucw' | 'evm' | null>(null)

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

  // Central refresh helper for all balances (Gateway + Wallet Testnets)
  const refreshBalances = () => {
    queryClient.invalidateQueries({ queryKey: ['gatewayBalances'] })
    queryClient.invalidateQueries({ queryKey: ['walletTestnetBalances'] })
  }

  // Connect / Disconnect Wallet handler
  const handleDisconnectAll = () => {
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
  }

  // Arcis AI Copilot (Autonomous Orchestrator with Real On-Chain Execution)
  const copilot = useArcCopilot(walletAddress, connectedProvider)

  return (
    <BroadcastProvider>
      <AutoChainSwitchWatcher />
      <div className="min-h-screen flex flex-col selection:bg-indigo-500/30">
        {/* Background ambient light */}
        <div className="absolute top-0 left-1/4 w-96 h-96 bg-brand-primary/10 rounded-full blur-[120px] pointer-events-none animate-pulse-slow"></div>
        <div className="absolute top-0 right-1/4 w-96 h-96 bg-brand-secondary/10 rounded-full blur-[120px] pointer-events-none animate-pulse-slow"></div>

        {/* Header */}
        <Header
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          walletConnected={walletConnected}
          walletAddress={walletAddress}
          onConnect={() => setActiveTab('unified')}
          onDisconnect={handleDisconnectAll}
          isPasskeyConnected={isPasskeyConnected}
          mscaAddress={mscaAddress}
          isUcwConnected={isUcwConnected}
          ucwAddress={ucwAddress}
          activeAuthSource={activeAuthSource}
          onSelectActiveAuthSource={(source) => setPreferredAuthSource(source)}
          onOpenCircleAuth={() => setIsCircleAuthOpen(true)}
          onDisconnectUcw={disconnectUcw}
          onDisconnectPasskey={disconnectPasskey}
          onOpenFaucet={() => setIsFaucetOpen(true)}
          isRestoring={isModularRestoring}
        />

        {/* Main Container */}
        <main className="flex-1 max-w-7xl mx-auto w-full px-4 sm:px-6 md:px-8 py-6 md:py-10 flex flex-col gap-6 min-h-[calc(100vh+80px)]">
          
          {/* Workspace Content */}
          <section className="flex-1 min-w-0 flex flex-col min-h-[calc(100vh-60px)] pb-12">

            {/* Arcis Homepage / Overview Tab */}
            {activeTab === 'home' && (
              <HomePage
                onNavigate={(tab) => setActiveTab(tab)}
                onOpenCircleAuth={() => setIsCircleAuthOpen(true)}
                onOpenFaucet={() => setIsFaucetOpen(true)}
                walletConnected={walletConnected}
                walletAddress={walletAddress}
              />
            )}
            
            {/* Unified Balance Tab */}
            {activeTab === 'unified' && (
              <div className="flex-1 flex flex-col min-h-[calc(100vh-80px)]">
                <UnifiedBalance onNavigate={(tab) => setActiveTab(tab)} connector={connector} />
              </div>
            )}

            {/* Pools & Yield Hub Tab */}
            {activeTab === 'pools' && (
              <div className="flex-1 flex flex-col min-h-[calc(100vh-80px)]">
                <PoolsTab
                  walletAddress={walletAddress}
                  walletConnected={walletConnected}
                  provider={connectedProvider}
                />
              </div>
            )}

            {/* AI Services (x402 Marketplace) Tab */}
            {activeTab === 'ai-services' && (
              <div className="flex-1 flex flex-col min-h-[calc(100vh-80px)]">
                <MarketplaceTab
                  walletAddress={walletAddress}
                  walletConnected={walletConnected}
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
                  currentChainId={5042002}
                  onSuccess={() => {
                    refreshBalances()
                  }}
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
                  onSuccess={() => {
                    refreshBalances()
                  }}
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
                  onSuccess={() => {
                    refreshBalances()
                  }}
                />
              </div>
            )}

            {/* History Tab */}
            {activeTab === 'history' && (
              <div className="flex-1 flex flex-col min-h-[calc(100vh-80px)]">
                <HistoryTable />
              </div>
            )}

          </section>
        </main>

        {/* Global Floating Cybernetic Robot Widget (Bottom-Left) */}
        <CopilotRobotWidget
          isOpen={copilot.isOpen}
          onClick={copilot.toggleOpen}
          isAnalyzing={copilot.isAnalyzing}
        />

        {/* Arcis AI Copilot Side Drawer */}
        <ArcCopilotDrawer
          isOpen={copilot.isOpen}
          onClose={() => copilot.setIsOpen(false)}
          messages={copilot.messages}
          currentSteps={copilot.currentSteps}
          isAnalyzing={copilot.isAnalyzing}
          sessionConfig={copilot.sessionConfig}
          onSendMessage={copilot.executeQuery}
          onClearChat={copilot.clearChat}
          onActivateSession={copilot.activateSession}
          onRevokeSession={copilot.revokeSession}
          onToggleAutoExecute={copilot.toggleAutoExecute}
          onExecuteInline={copilot.executeInlineAction}
          onNavigateToTab={(tab) => setActiveTab(tab as any)}
          onOpenFaucet={() => setIsFaucetOpen(true)}
        />

        {/* Global Professional Footer */}
        <Footer
          onNavigate={(tab) => setActiveTab(tab)}
          onOpenFaucet={() => setIsFaucetOpen(true)}
        />

        {/* Circle User-Controlled Wallets & Passkey Auth Modal */}
        <CircleAuthModal
          isOpen={isCircleAuthOpen}
          onClose={() => setIsCircleAuthOpen(false)}
          onRegisterPasskey={registerPasskey}
          onLoginPasskey={loginPasskey}
          isPasskeyConnected={isPasskeyConnected}
          mscaAddress={mscaAddress}
          hasStoredCredential={hasStoredCredential}
          onRequestOtp={requestEmailOtp}
          onVerifyOtp={verifyEmailOtpCode}
          onLoginPin={loginWithPin}
          onLoginSocial={loginWithSocial}
          isLoading={isUcwLoading || isModularLoading}
          otpStep={otpStep}
          setOtpStep={setOtpStep}
          pendingEmail={pendingEmail}
        />

        {/* Circle Testnet Faucet Modal */}
        <FaucetModal
          isOpen={isFaucetOpen}
          onClose={() => setIsFaucetOpen(false)}
          connectedAddress={walletAddress}
          onSuccess={refreshBalances}
        />
      </div>
    </BroadcastProvider>
  )
}