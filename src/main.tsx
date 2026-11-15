import React, { useSyncExternalStore } from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import './utils/logger' // Side-effect: installs safe console.warn/info polyfills at startup
import './index.css'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  getWalletConfig,
  getWalletConfigVersion,
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

function WalletProviders() {
  // Remounts only when the config upgrades pre-connection (version bump in walletConfigStore)
  const configVersion = useSyncExternalStore(
    subscribeWalletConfig,
    getWalletConfigVersion
  )
  const config = getWalletConfig()

  return (
    <WagmiProvider key={configVersion} config={config}>
      <MultiChainWalletProvider>
        <App />
      </MultiChainWalletProvider>
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
  </React.StrictMode>
)
