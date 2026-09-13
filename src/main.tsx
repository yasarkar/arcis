import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import './utils/logger' // Side-effect: installs safe console.warn/info polyfills at startup
import './index.css'
import '@rainbow-me/rainbowkit/styles.css'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { RainbowKitProvider, darkTheme } from '@rainbow-me/rainbowkit'
import { config } from './config/wagmi'
import { arcTestnet } from './config/arcChain'

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

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <GlobalErrorBoundary>
      <WagmiProvider config={config}>
        <QueryClientProvider client={queryClient}>
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
            <MultiChainWalletProvider>
              <App />
            </MultiChainWalletProvider>
          </RainbowKitProvider>
        </QueryClientProvider>
      </WagmiProvider>
    </GlobalErrorBoundary>
  </React.StrictMode>,
)
