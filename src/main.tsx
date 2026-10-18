import React, { useEffect, useSyncExternalStore } from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import './utils/logger' // Side-effect: installs safe console.warn/info polyfills at startup
import './index.css'
import '@rainbow-me/rainbowkit/styles.css'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { RainbowKitProvider, darkTheme, useConnectModal } from '@rainbow-me/rainbowkit'
import { arcTestnet } from './config/arcChain'
import {
  consumePendingConnectOpen,
  getPendingConnectOpenVersion,
  getWalletConfig,
  getWalletConfigVersion,
  subscribePendingConnectOpen,
  subscribeWalletConfig,
} from './config/walletConfigStore'

import { MultiChainWalletProvider } from './context/MultiChainWalletContext'
import { WagmiProvider } from 'wagmi'
import { GlobalErrorBoundary } from './components/common/GlobalErrorBoundary'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false, // Prevents sudden burst of dozens of RPC queries on alt-tab
      retry: 2,
      staleTime: 15_000,
    },
  },
})

/**
 * P03: opens the RainbowKit connect modal once the full wallet config is
 * active. The first Connect click upgrades the config (remounting the wallet
 * subtree below), then this component — mounted fresh inside the new tree —
 * consumes the pending flag and opens the modal with the complete wallet
 * list. Subsequent clicks open the modal directly with no remount.
 */
function DeferredConnectOpener() {
  const { openConnectModal } = useConnectModal()
  const pendingVersion = useSyncExternalStore(
    subscribePendingConnectOpen,
    getPendingConnectOpenVersion
  )

  useEffect(() => {
    if (pendingVersion === 0) return
    if (consumePendingConnectOpen()) {
      openConnectModal?.()
    }
  }, [pendingVersion, openConnectModal])

  return null
}

function WalletProviders() {
  // P03: remounts only when the config upgrades pre-connection (version bump
  // in `walletConfigStore`). The QueryClient above persists across remounts,
  // so cached balances/prices survive the upgrade.
  const configVersion = useSyncExternalStore(
    subscribeWalletConfig,
    getWalletConfigVersion
  )
  const config = getWalletConfig()

  return (
    <WagmiProvider key={configVersion} config={config}>
      <RainbowKitProvider
        initialChain={arcTestnet}
        modalSize="wide"
        appInfo={{
          appName: 'Arcis',
          learnMoreUrl: 'https://testnet.arcscan.app',
        }}
        showRecentTransactions={true}
        theme={darkTheme({
          accentColor: '#6366f1',
          accentColorForeground: 'white',
          borderRadius: 'large',
          overlayBlur: 'small',
        })}
      >
        <DeferredConnectOpener />
        <MultiChainWalletProvider>
          <App />
        </MultiChainWalletProvider>
      </RainbowKitProvider>
    </WagmiProvider>
  )
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <GlobalErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <WalletProviders />
      </QueryClientProvider>
    </GlobalErrorBoundary>
  </React.StrictMode>,
)
