import { getExplorerTxUrl, getExplorerAddressUrl } from '../../config/sendConfig'

export const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
]

export const CHAIN_DISPLAY_NAMES: Record<string, string> = {
  Arc_Testnet: 'Arc Testnet',
  Ethereum_Sepolia: 'Ethereum Sepolia',
  Base_Sepolia: 'Base Sepolia',
  Arbitrum_Sepolia: 'Arbitrum Sepolia',
  Optimism_Sepolia: 'Optimism Sepolia',
  Polygon_Amoy_Testnet: 'Polygon Amoy',
  Avalanche_Fuji: 'Avalanche Fuji',
  HyperEVM_Testnet: 'HyperEVM Testnet',
  Sei_Testnet: 'Sei Testnet',
  Solana_Devnet: 'Solana Devnet',
  Sonic_Testnet: 'Sonic Testnet',
  Unichain_Sepolia: 'Unichain Sepolia',
  World_Chain_Sepolia: 'World Sepolia'
}

export const formatChain = (chainKey: string) => {
  return CHAIN_DISPLAY_NAMES[chainKey] || chainKey.replace(/_/g, ' ')
}

export const formatAddress = (addr?: string) => {
  if (!addr) return '-'
  if (addr.length < 12) return addr
  return `${addr.substring(0, 6)}...${addr.substring(addr.length - 4)}`
}

export const getExplorerLink = (hash: string, chainKey: string) => {
  return getExplorerTxUrl(chainKey, hash)
}

export const getAddressExplorerLink = (addr?: string, chainKey?: string) => {
  return getExplorerAddressUrl(chainKey, addr)
}

export const formatUtcTime = (timestamp: number) => {
  const d = new Date(timestamp)
  const pad = (n: number) => n.toString().padStart(2, '0')
  const hours = pad(d.getUTCHours())
  const minutes = pad(d.getUTCMinutes())
  const seconds = pad(d.getUTCSeconds())
  const month = MONTH_NAMES[d.getUTCMonth()].substring(0, 3)
  const day = d.getUTCDate()
  const year = d.getUTCFullYear()
  return `${hours}:${minutes}:${seconds} ${month} ${day}, ${year}`
}

export const getRelativeTime = (timestamp: number) => {
  const diff = Date.now() - timestamp
  if (diff < 30000) return 'Just now'

  const mins = Math.floor(diff / 60000)
  if (mins < 60) return `${mins} min${mins > 1 ? 's' : ''} ago`

  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours} hour${hours > 1 ? 's' : ''} ago`

  const days = Math.floor(hours / 24)
  return `${days} day${days > 1 ? 's' : ''} ago`
}

export const formatDisplayDate = (isoStr: string) => {
  if (!isoStr) return ''
  const d = new Date(isoStr)
  if (isNaN(d.getTime())) return isoStr
  const pad = (n: number) => n.toString().padStart(2, '0')
  return `${pad(d.getMonth() + 1)}/${pad(d.getDate())}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export const formatAmountDisplay = (val?: string) => {
  if (!val) return '0'
  const cleanStr = val.toString().replace(/^-/, '').trim()
  const num = parseFloat(cleanStr)
  if (isNaN(num)) return cleanStr
  if (num === 0) return '0'
  if (num < 0.0001) return num.toFixed(6)
  if (num < 1) return parseFloat(num.toFixed(4)).toString()
  return parseFloat(num.toFixed(2)).toString()
}
