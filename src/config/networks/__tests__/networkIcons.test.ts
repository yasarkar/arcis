import { describe, it, expect } from 'vitest'
import fs from 'fs'
import { TESTNET_NETWORKS, MAINNET_NETWORKS, ALL_NETWORKS } from '../networkRegistry'
import {
  getChainIconId,
  getChainDisplayName,
  isKnownChain,
  resolveCanonicalChainKey,
  CHAIN_META,
} from '../../chainMeta'
import { networks as web3Networks } from '@web3icons/common'

describe('26 Blockchain Networks & Web3-Icons Architecture Verification', () => {
  // Read all available compiled network icon component files from @web3icons/react
  const networkComponentFiles = fs
    .readdirSync('./node_modules/@web3icons/react/dist/icons/networks')
    .filter((f) => f.startsWith('Network') && f.endsWith('.js'))
    .map((f) => f.replace(/^Network|\.js$/g, ''))

  const byId = new Map<string, any>()
  const byName = new Map<string, any>()
  const byShortName = new Map<string, any>()

  for (const nw of web3Networks) {
    if (nw.id) byId.set(nw.id.toLowerCase(), nw)
    if (nw.name) byName.set(nw.name.toLowerCase(), nw)
    if (nw.shortName) byShortName.set(nw.shortName.toLowerCase(), nw)
  }

  const EXPECTED_26_TESTNET_KEYS = [
    'Arc_Testnet',
    'Ethereum_Sepolia',
    'Base_Sepolia',
    'Arbitrum_Sepolia',
    'Optimism_Sepolia',
    'Polygon_Amoy_Testnet',
    'Avalanche_Fuji',
    'HyperEVM_Testnet',
    'Sei_Testnet',
    'Sonic_Testnet',
    'Unichain_Sepolia',
    'World_Chain_Sepolia',
    'Solana_Devnet',
    'Monad_Testnet',
    'Ink_Testnet',
    'Linea_Sepolia',
    'Plume_Testnet',
    'Injective_Testnet',
    'XDC_Apothem',
    'Codex_Testnet',
    'Cronos_Testnet',
    'Edge_Testnet',
    'Morph_Testnet',
    'Pharos_Testnet',
    'Plasma_Testnet',
    'X_Layer_Testnet',
  ]

  it('verifies the project has exactly 26 testnet networks configured', () => {
    const keys = Object.keys(TESTNET_NETWORKS)
    expect(keys).toHaveLength(26)
    expect(keys.sort()).toEqual([...EXPECTED_26_TESTNET_KEYS].sort())
  })

  it('verifies that each of the 26 networks has complete UI metadata and matching iconId', () => {
    for (const key of EXPECTED_26_TESTNET_KEYS) {
      const net = TESTNET_NETWORKS[key]
      expect(net, `Network ${key} must exist in TESTNET_NETWORKS`).toBeDefined()
      expect(net.ui, `Network ${key} must have ui metadata`).toBeDefined()
      expect(net.ui.iconId, `Network ${key} must have non-empty iconId`).toBeTruthy()
      expect(net.ui.name, `Network ${key} must have ui.name`).toBeTruthy()
      expect(net.ui.color, `Network ${key} must have brand color`).toMatch(/^#/)
      expect(net.ui.gradient, `Network ${key} must have gradient`).toContain('linear-gradient')

      // Verify centralized CHAIN_META adapter
      const meta = CHAIN_META[key]
      expect(meta, `CHAIN_META must contain ${key}`).toBeDefined()
      expect(meta.iconId).toBe(net.ui.iconId)
      expect(meta.name).toBe(net.name)

      // Verify resolver helper functions
      expect(getChainIconId(key), `getChainIconId(${key})`).toBe(net.ui.iconId)
      expect(getChainDisplayName(key), `getChainDisplayName(${key})`).toBe(net.name)
      expect(isKnownChain(key), `isKnownChain(${key})`).toBe(true)
      expect(resolveCanonicalChainKey(key), `resolveCanonicalChainKey(${key})`).toBe(key)
    }
  })

  it('verifies the 24 standard networks resolve to authentic @web3icons components', () => {
    // 24 networks that are supported natively by @web3icons
    const web3SupportedKeys = EXPECTED_26_TESTNET_KEYS.filter(
      (k) => k !== 'Morph_Testnet' && k !== 'Pharos_Testnet'
    )
    expect(web3SupportedKeys).toHaveLength(24)

    for (const key of web3SupportedKeys) {
      const net = TESTNET_NETWORKS[key]
      const iconId = net.ui.iconId

      // Lookup in @web3icons/common metadata table
      const metaMatch =
        byId.get(iconId.toLowerCase()) ||
        byId.get(iconId.toLowerCase().replace(/[^a-z0-9]/g, '-')) ||
        byName.get(iconId.toLowerCase()) ||
        byShortName.get(iconId.toLowerCase())

      expect(
        metaMatch,
        `Network ${key} with iconId "${iconId}" must exist in @web3icons/common`
      ).toBeDefined()

      // Verify the filePath points to a valid network icon
      expect(metaMatch.filePath).toMatch(/^network:/)

      // Verify the compiled React component file exists in @web3icons/react
      const iconName = metaMatch.filePath.split(':')[1]
      const compName = iconName.replace(/(?:^|-)([a-z0-9])/g, (_: string, c: string) =>
        c.toUpperCase()
      )
      const exists = networkComponentFiles.some(
        (f) => f.toLowerCase() === compName.toLowerCase()
      )
      expect(
        exists,
        `Component Network${compName} for ${key} (${iconId}) must exist in @web3icons/react`
      ).toBe(true)
    }
  })

  it('verifies that Morph and Pharos are recognized as custom SVG providers', () => {
    // Morph and Pharos are cutting-edge L2/L1 networks not yet present in upstream @web3icons.
    // They are handled with dedicated first-class custom SVGs in ChainIcon.tsx.
    const morphNet = TESTNET_NETWORKS['Morph_Testnet']
    const pharosNet = TESTNET_NETWORKS['Pharos_Testnet']

    expect(morphNet.ui.iconId).toBe('morph')
    expect(pharosNet.ui.iconId).toBe('pharos')

    expect(getChainIconId('Morph_Testnet')).toBe('morph')
    expect(getChainIconId('Pharos_Testnet')).toBe('pharos')
    expect(getChainIconId('morph')).toBe('morph')
    expect(getChainIconId('pharos')).toBe('pharos')
  })

  it('verifies fuzzy resolution for all 26 networks through getChainIconId', () => {
    for (const key of EXPECTED_26_TESTNET_KEYS) {
      const net = TESTNET_NETWORKS[key]
      const iconId = net.ui.iconId

      // Test lowercase
      expect(getChainIconId(key.toLowerCase())).toBe(iconId)
      // Test without underscores
      expect(getChainIconId(key.replace(/_/g, ' '))).toBe(iconId)
      // Test without suffix
      const baseKey = key.replace(/_Testnet|_Sepolia/g, '')
      expect(getChainIconId(baseKey)).toBe(iconId)
    }
  })
})
