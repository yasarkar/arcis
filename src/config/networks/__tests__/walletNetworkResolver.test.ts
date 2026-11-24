import { describe, it, expect } from 'vitest'
import {
  TESTNET_NETWORKS,
  getNetwork,
  getNetworksByCapability,
} from '../networkRegistry'
import {
  getChainSupportedTokens,
  getWalletSupportedChains,
  isChainSupportedByWallet,
  resolveSupportedToken,
  resolveWalletSupportedChain,
  type AppSurface,
  type TransferMode,
  type WalletAuthSource,
} from '../walletNetworkResolver'
import { isCircleUcwChain } from '../../../utils/circleBlockchain'
import { BRIDGE_SELECTABLE_CHAINS, BRIDGE_GATEWAY_SELECTABLE_CHAINS } from '../../bridgeConfig'

describe('walletNetworkResolver — wallet-aware testnet networks & dynamic tokens', () => {
  const AUTH_SOURCES: WalletAuthSource[] = ['evm', 'ucw', 'passkey', null]
  const SURFACES: AppSurface[] = ['send', 'bridge', 'swap', 'deposit']
  const MODES: TransferMode[] = ['direct', 'gateway']

  it('never leaks any mainnet chain across any wallet, surface, or mode in testnet build', () => {
    for (const authSource of AUTH_SOURCES) {
      for (const surface of SURFACES) {
        for (const mode of MODES) {
          const chains = getWalletSupportedChains({ surface, authSource, mode, isTestnet: true })
          expect(chains.length, `${surface}/${mode}/${String(authSource)}`).toBeGreaterThan(0)
          for (const key of chains) {
            const net = getNetwork(key)
            expect(net, `missing network ${key}`).toBeDefined()
            expect(net!.testnet, `${key} must be testnet`).toBe(true)
          }
          expect(chains[0]).toBe('Arc_Testnet')
        }
      }
    }
  })

  it('keeps networkRegistry capabilities.ucw strictly aligned with CIRCLE_UCW_BLOCKCHAIN_MAP', () => {
    const registryUcwEvmKeys = getNetworksByCapability('ucw', true)
      .map((n) => n.key)
      .sort()
    const expectedUcwEvm = [
      'Arbitrum_Sepolia',
      'Arc_Testnet',
      'Avalanche_Fuji',
      'Base_Sepolia',
      'Ethereum_Sepolia',
      'Monad_Testnet',
      'Optimism_Sepolia',
      'Polygon_Amoy_Testnet',
      'Unichain_Sepolia',
    ]

    expect(registryUcwEvmKeys).toEqual(expectedUcwEvm)
    for (const key of Object.keys(TESTNET_NETWORKS)) {
      if (key === 'Solana_Devnet') continue
      expect(TESTNET_NETWORKS[key].capabilities.ucw).toBe(isCircleUcwChain(key))
    }
  })

  describe('Send surface chain filtering by connected wallet', () => {
    it('offers all 26 Circle testnets for EVM wallets in direct mode and 13 in gateway mode', () => {
      const direct = getWalletSupportedChains({ surface: 'send', authSource: 'evm', mode: 'direct' })
      const gateway = getWalletSupportedChains({ surface: 'send', authSource: 'evm', mode: 'gateway' })
      expect(direct).toHaveLength(26)
      expect(gateway).toHaveLength(13)
      expect(direct).toContain('Solana_Devnet')
      expect(gateway).toContain('Solana_Devnet')
    })

    it('restricts Circle UCW wallets to UCW EVM testnets (9 direct, 8 gateway)', () => {
      const direct = getWalletSupportedChains({ surface: 'send', authSource: 'ucw', mode: 'direct' })
      const gateway = getWalletSupportedChains({ surface: 'send', authSource: 'ucw', mode: 'gateway' })
      expect(direct).toHaveLength(9)
      expect(direct).toContain('Unichain_Sepolia')
      expect(direct).toContain('Monad_Testnet')
      expect(direct).not.toContain('Solana_Devnet')
      expect(direct).not.toContain('Cronos_Testnet')
      expect(direct).not.toContain('Plasma_Testnet')

      expect(gateway).toHaveLength(8)
      expect(gateway).toContain('Unichain_Sepolia')
      expect(gateway).not.toContain('Monad_Testnet')
    })

    it('restricts Passkey (Modular Smart Account) wallets to Arc_Testnet only', () => {
      expect(getWalletSupportedChains({ surface: 'send', authSource: 'passkey', mode: 'direct' })).toEqual(['Arc_Testnet'])
      expect(getWalletSupportedChains({ surface: 'send', authSource: 'passkey', mode: 'gateway' })).toEqual(['Arc_Testnet'])
      expect(getWalletSupportedChains({ surface: 'deposit', authSource: 'passkey', mode: 'gateway' })).toEqual(['Arc_Testnet'])
    })
  })

  describe('Bridge surface chain filtering by connected wallet & mode', () => {
    it('exposes all 22 forwarder-verified EVM CCTP v2 testnets in direct mode and 12 EVM Gateway testnets in gateway mode for EVM', () => {
      const directSources = getWalletSupportedChains({ surface: 'bridge', authSource: 'evm', mode: 'direct', side: 'source' })
      const gatewaySources = getWalletSupportedChains({ surface: 'bridge', authSource: 'evm', mode: 'gateway', side: 'source' })
      expect(directSources).toHaveLength(22)
      expect(directSources).toEqual(expect.arrayContaining(BRIDGE_SELECTABLE_CHAINS))
      expect(directSources).toContain('Ink_Testnet')
      expect(directSources).toContain('Monad_Testnet')
      expect(directSources).not.toContain('Solana_Devnet')
      expect(directSources).not.toContain('Injective_Testnet')
      expect(directSources).not.toContain('Morph_Testnet')
      expect(directSources).not.toContain('Pharos_Testnet')

      expect(gatewaySources).toHaveLength(12)
      expect(gatewaySources).toEqual(expect.arrayContaining(BRIDGE_GATEWAY_SELECTABLE_CHAINS))
    })

    it('restricts UCW bridge sources to UCW EVM chains while allowing all reachable CCTP destinations in direct mode', () => {
      const ucwDirectSources = getWalletSupportedChains({ surface: 'bridge', authSource: 'ucw', mode: 'direct', side: 'source' })
      const ucwDirectDests = getWalletSupportedChains({
        surface: 'bridge',
        authSource: 'ucw',
        mode: 'direct',
        side: 'destination',
        pairedChain: 'Arc_Testnet',
        token: 'USDC',
      })
      expect(ucwDirectSources).toHaveLength(9)
      expect(ucwDirectDests).toHaveLength(21)

      const ucwGwSources = getWalletSupportedChains({ surface: 'bridge', authSource: 'ucw', mode: 'gateway', side: 'source' })
      const ucwGwDests = getWalletSupportedChains({ surface: 'bridge', authSource: 'ucw', mode: 'gateway', side: 'destination' })
      expect(ucwGwSources).toHaveLength(8)
      expect(ucwGwDests).toHaveLength(8)
    })

    it('restricts Passkey bridge sources to Arc_Testnet while keeping valid destinations reachable', () => {
      const passkeySources = getWalletSupportedChains({ surface: 'bridge', authSource: 'passkey', mode: 'direct', side: 'source' })
      const passkeyDests = getWalletSupportedChains({
        surface: 'bridge',
        authSource: 'passkey',
        mode: 'direct',
        side: 'destination',
        pairedChain: 'Arc_Testnet',
        token: 'USDC',
      })
      expect(passkeySources).toEqual(['Arc_Testnet'])
      expect(passkeyDests.length).toBe(21)
      expect(passkeyDests).not.toContain('Arc_Testnet')
    })
  })

  describe('Swap & Deposit surfaces', () => {
    it('isolates Swap strictly to Arc_Testnet for every wallet type', () => {
      for (const authSource of AUTH_SOURCES) {
        expect(getWalletSupportedChains({ surface: 'swap', authSource })).toEqual(['Arc_Testnet'])
      }
    })

    it('filters DepositPanel chains to 12 for EVM, 8 for UCW, and 1 for Passkey', () => {
      expect(getWalletSupportedChains({ surface: 'deposit', authSource: 'evm', mode: 'gateway' })).toHaveLength(12)
      expect(getWalletSupportedChains({ surface: 'deposit', authSource: 'ucw', mode: 'gateway' })).toHaveLength(8)
      expect(getWalletSupportedChains({ surface: 'deposit', authSource: 'passkey', mode: 'gateway' })).toEqual(['Arc_Testnet'])
    })
  })

  describe('Dynamic per-network token catalogs', () => {
    it('returns exact deployed + native coins per chain on Send (Direct) and USDC-only on Send (Gateway)', () => {
      const arcSend = getChainSupportedTokens({ surface: 'send', chainKey: 'Arc_Testnet', authSource: 'evm', mode: 'direct' })
      expect(arcSend.map((t) => t.symbol)).toEqual(['USDC', 'EURC', 'cirBTC', 'WETH'])

      const worldSend = getChainSupportedTokens({ surface: 'send', chainKey: 'World_Chain_Sepolia', authSource: 'evm', mode: 'direct' })
      expect(worldSend.map((t) => t.symbol)).toEqual(['USDC', 'EURC', 'ETH'])

      const inkSend = getChainSupportedTokens({ surface: 'send', chainKey: 'Ink_Testnet', authSource: 'evm', mode: 'direct' })
      expect(inkSend.map((t) => t.symbol)).toEqual(['USDC', 'EURC', 'ETH'])

      const amoySend = getChainSupportedTokens({ surface: 'send', chainKey: 'Polygon_Amoy_Testnet', authSource: 'evm', mode: 'direct' })
      expect(amoySend.map((t) => t.symbol)).toEqual(['USDC', 'POL'])

      const monadSend = getChainSupportedTokens({ surface: 'send', chainKey: 'Monad_Testnet', authSource: 'ucw', mode: 'direct' })
      expect(monadSend.map((t) => t.symbol)).toEqual(['USDC', 'MON'])

      const gatewaySend = getChainSupportedTokens({ surface: 'send', chainKey: 'Arc_Testnet', authSource: 'evm', mode: 'gateway' })
      expect(gatewaySend.map((t) => t.symbol)).toEqual(['USDC'])
    })

    it('dynamically adjusts Bridge tokens by source/dest pair, wallet type, and mode', () => {
      const arcToEthEvm = getChainSupportedTokens({
        surface: 'bridge',
        chainKey: 'Arc_Testnet',
        destChainKey: 'Ethereum_Sepolia',
        authSource: 'evm',
        mode: 'direct',
      })
      expect(arcToEthEvm.map((t) => t.symbol)).toEqual(['USDC', 'EURC', 'cirBTC', 'WETH'])

      const ethToArcEvmWithWrap = getChainSupportedTokens({
        surface: 'bridge',
        chainKey: 'Ethereum_Sepolia',
        destChainKey: 'Arc_Testnet',
        authSource: 'evm',
        mode: 'direct',
        canAutoWrapEth: true,
      })
      expect(ethToArcEvmWithWrap.map((t) => t.symbol)).toEqual(['USDC', 'EURC', 'cirBTC', 'WETH', 'ETH'])

      // UCW cannot auto-wrap native ETH
      const ethToArcUcw = getChainSupportedTokens({
        surface: 'bridge',
        chainKey: 'Ethereum_Sepolia',
        destChainKey: 'Arc_Testnet',
        authSource: 'ucw',
        mode: 'direct',
        canAutoWrapEth: true,
      })
      expect(ethToArcUcw.map((t) => t.symbol)).toEqual(['USDC', 'EURC', 'cirBTC', 'WETH'])

      // Ink_Testnet <-> Arc_Testnet supports USDC and EURC (domain 21)
      const inkToArc = getChainSupportedTokens({
        surface: 'bridge',
        chainKey: 'Ink_Testnet',
        destChainKey: 'Arc_Testnet',
        authSource: 'evm',
        mode: 'direct',
      })
      expect(inkToArc.map((t) => t.symbol)).toEqual(['USDC', 'EURC'])

      // Monad_Testnet <-> Arc_Testnet supports USDC only
      const monadToArc = getChainSupportedTokens({
        surface: 'bridge',
        chainKey: 'Monad_Testnet',
        destChainKey: 'Arc_Testnet',
        authSource: 'evm',
        mode: 'direct',
      })
      expect(monadToArc.map((t) => t.symbol)).toEqual(['USDC'])

      // Gateway bridge mode is strictly USDC-only
      const gwTokens = getChainSupportedTokens({
        surface: 'bridge',
        chainKey: 'Arc_Testnet',
        destChainKey: 'Ethereum_Sepolia',
        authSource: 'evm',
        mode: 'gateway',
      })
      expect(gwTokens.map((t) => t.symbol)).toEqual(['USDC'])
    })

    it('clamps unsupported chains and tokens safely on wallet/network changes', () => {
      expect(isChainSupportedByWallet('Ethereum', 'evm')).toBe(false)
      expect(resolveWalletSupportedChain('Monad_Testnet', ['Arc_Testnet'])).toBe('Arc_Testnet')
      const amoyTokens = getChainSupportedTokens({ surface: 'send', chainKey: 'Polygon_Amoy_Testnet', mode: 'direct' })
      expect(resolveSupportedToken('EURC', amoyTokens)).toBe('USDC')
      expect(resolveSupportedToken('POL', amoyTokens)).toBe('POL')
    })
  })
})
