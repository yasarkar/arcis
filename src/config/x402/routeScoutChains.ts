// src/config/x402/routeScoutChains.ts
// Destination chains the Gateway Fee & Route Scout quotes on Arc Testnet.
// EVM-only: the compare path prices CCTP forwarding, and the app's bridge surface excludes
// Solana. Both the manifest enum and the quote module read this list so they cannot drift.

export const ROUTE_SCOUT_DESTINATIONS = [
  'Ethereum_Sepolia',
  'Base_Sepolia',
  'Arbitrum_Sepolia',
  'Optimism_Sepolia',
  'Polygon_Amoy_Testnet',
  'Avalanche_Fuji',
] as const

export type RouteScoutDestination = (typeof ROUTE_SCOUT_DESTINATIONS)[number]
