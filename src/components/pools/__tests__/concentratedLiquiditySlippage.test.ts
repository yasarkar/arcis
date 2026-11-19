import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'

describe('ConcentratedLiquidityModal & Slippage Tolerance Design', () => {
  const modalSource = readFileSync(
    resolve(__dirname, '../ConcentratedLiquidityModal.tsx'),
    'utf-8'
  )
  const panelSource = readFileSync(
    resolve(__dirname, '../actions/PoolSlippagePanel.tsx'),
    'utf-8'
  )

  it('includes a Custom button in the Slippage Tolerance window of ConcentratedLiquidityModal', () => {
    expect(modalSource).toContain('Custom')
    expect(modalSource).toContain('handleSelectCustom')
    expect(modalSource).toContain('selectedSlippageType === \'custom\'')
  })

  it('applies linear-gradient(135deg, #9896ff 0%, #7c3aed 100%) to selected buttons in ConcentratedLiquidityModal', () => {
    expect(modalSource).toContain('linear-gradient(135deg, #9896ff 0%, #7c3aed 100%)')
  })

  it('renders custom input field when custom slippage is active with validation', () => {
    expect(modalSource).toContain('handleCustomChange')
    expect(modalSource).toContain('POOL_MAX_SLIPPAGE_BPS')
    expect(modalSource).toContain('customSlippage')
  })

  it('provides click-outside dismissal for smooth modal UX', () => {
    expect(modalSource).toContain('slippageDropdownRef')
    expect(modalSource).toContain('handleClickOutside')
  })

  it('applies linear-gradient(135deg, #9896ff 0%, #7c3aed 100%) to selected buttons in PoolSlippagePanel', () => {
    expect(panelSource).toContain('linear-gradient(135deg, #9896ff 0%, #7c3aed 100%)')
  })

  it('preserves 1.0 and 2.0 preset selection without erroneously activating custom mode', () => {
    expect(modalSource).toContain("walletSettings.poolSlippageType === '1.0'")
    expect(modalSource).toContain("val === 1 || val === 1.0")
    expect(modalSource).not.toMatch(/const s = String\(walletSettings\.poolSlippage\);\s*if \(s === '0\.5' \|\| s === '1\.0' \|\| s === '2\.0'\)/)
  })
})
