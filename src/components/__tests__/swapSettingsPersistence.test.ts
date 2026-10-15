import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'

describe('SwapModal Settings Persistence & Parity with Send / Bridge', () => {
  const swapModalSource = readFileSync(
    resolve(__dirname, '../SwapModal.tsx'),
    'utf-8'
  )

  it('binds to useWalletSettings hook for wallet-scoped settings', () => {
    expect(swapModalSource).toContain('useWalletSettings(connectedAddress)')
    expect(swapModalSource).toContain('updateWalletSettings')
  })

  it('initializes slippage and speed tier from walletSettings', () => {
    expect(swapModalSource).toContain('walletSettings.swapSlippageType')
    expect(swapModalSource).toContain('walletSettings.swapCustomSlippage')
    expect(swapModalSource).toContain('walletSettings.swapSpeedTier')
  })

  it('defines handleSpeedTierChange callback to sync state and update walletSettings', () => {
    expect(swapModalSource).toContain('const handleSpeedTierChange = useCallback(')
    expect(swapModalSource).toContain('updateWalletSettings({ swapSpeedTier: tier })')
    expect(swapModalSource).toContain('onSelectTier={handleSpeedTierChange}')
  })

  it('persists slippage settings when presets or custom values are selected', () => {
    expect(swapModalSource).toContain("updateWalletSettings({ swapSlippageType: type, swapCustomSlippage: '' })")
    expect(swapModalSource).toContain("updateWalletSettings({ swapCustomSlippage: e.target.value, swapSlippageType: 'custom' })")
  })

  it('does NOT reset speedTier or slippage on modal open or mount', () => {
    // Extract the useEffect([isOpen]) block
    const isOpenEffectMatch = swapModalSource.match(
      /\/\/ Reset modal state on open\s+useEffect\(\(\) => \{([\s\S]*?)\}, \[isOpen\]\)/
    )
    expect(isOpenEffectMatch).not.toBeNull()
    const effectBody = isOpenEffectMatch![1]

    expect(effectBody).not.toContain("setSpeedTier('fast')")
    expect(effectBody).not.toContain("setSelectedSlippageType('0.5')")
    expect(effectBody).not.toContain("setCustomSlippage('')")
  })
})
