import React from 'react'
import { SlidersHorizontal, AlertTriangle } from 'lucide-react'
import { POOL_MAX_SLIPPAGE_BPS } from '../../../config/poolsConfig'

interface PoolSlippagePanelProps {
  showSettings: boolean
  slippage: number
  selectedSlippageType: '0.1' | '0.5' | '1.0' | 'custom'
  customSlippage: string
  onSelectSlippageType: (type: '0.1' | '0.5' | '1.0' | 'custom') => void
  onChangeCustomSlippage: (val: string) => void
}

export const PoolSlippagePanel: React.FC<PoolSlippagePanelProps> = ({
  showSettings,
  slippage,
  selectedSlippageType,
  customSlippage,
  onSelectSlippageType,
  onChangeCustomSlippage,
}) => {
  if (!showSettings) return null

  return (
    <div
      className="animate-in fade-in slide-in-from-top-2 duration-200"
      style={{
        background: 'rgba(15, 18, 35, 0.95)',
        border: '1px solid rgba(152, 150, 255, 0.3)',
        borderRadius: 16,
        padding: '14px 16px',
        marginBottom: 16,
        boxShadow: '0 8px 24px rgba(0, 0, 0, 0.4)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <SlidersHorizontal className="w-4 h-4 text-indigo-400" />
          <span style={{ fontSize: 12, fontWeight: 600, color: '#fff', letterSpacing: '0.5px' }}>
            SLIPPAGE
          </span>
        </div>
        <span
          style={{
            fontSize: 12,
            fontFamily: 'monospace',
            fontWeight: 600,
            color: 'var(--purple-1)',
            background: 'rgba(152, 150, 255, 0.15)',
            border: '1px solid rgba(152, 150, 255, 0.3)',
            padding: '4px 10px',
            borderRadius: 99,
          }}
        >
          {slippage.toFixed(1)}%
        </span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
        {(['0.1', '0.5', '1.0'] as const).map((type) => (
          <button
            key={type}
            type="button"
            onClick={() => onSelectSlippageType(type)}
            style={{
              padding: '6px 0',
              borderRadius: 10,
              border: selectedSlippageType === type ? '1px solid rgba(152, 150, 255, 0.6)' : '1px solid rgba(255, 255, 255, 0.08)',
              background: selectedSlippageType === type ? 'rgba(152, 150, 255, 0.25)' : 'rgba(255, 255, 255, 0.04)',
              color: selectedSlippageType === type ? '#fff' : 'var(--fp-3)',
              fontSize: 12,
              fontWeight: 600,
              cursor: 'pointer',
              transition: 'all 0.15s ease',
            }}
          >
            {type}%
          </button>
        ))}
        <button
          type="button"
          onClick={() => onSelectSlippageType('custom')}
          style={{
            padding: '6px 0',
            borderRadius: 10,
            border: selectedSlippageType === 'custom' ? '1px solid rgba(152, 150, 255, 0.6)' : '1px solid rgba(255, 255, 255, 0.08)',
            background: selectedSlippageType === 'custom' ? 'rgba(152, 150, 255, 0.25)' : 'rgba(255, 255, 255, 0.04)',
            color: selectedSlippageType === 'custom' ? '#fff' : 'var(--fp-3)',
            fontSize: 12,
            fontWeight: 600,
            cursor: 'pointer',
            transition: 'all 0.15s ease',
          }}
        >
          Custom
        </button>
      </div>

      {selectedSlippageType === 'custom' && (
        <div style={{ marginTop: 10 }}>
          <div style={{ position: 'relative' }}>
            <input
              type="number"
              step="0.1"
              min="0.01"
              max={POOL_MAX_SLIPPAGE_BPS / 100}
              placeholder="e.g. 1.0"
              value={customSlippage}
              onChange={(e) => onChangeCustomSlippage(e.target.value)}
              autoFocus
              style={{
                width: '100%',
                background: 'rgba(255, 255, 255, 0.05)',
                border: '1px solid rgba(152, 150, 255, 0.4)',
                borderRadius: 10,
                padding: '7px 28px 7px 12px',
                fontSize: 12,
                color: '#fff',
                outline: 'none',
              }}
            />
            <span style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', fontSize: 12, color: 'var(--fp-3)', fontWeight: 600 }}>
              %
            </span>
          </div>
          {slippage > 1.5 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6, fontSize: 11, color: '#f59e0b' }}>
              <AlertTriangle size={12} />
              <span>High slippage may result in unfavorable execution (strictly capped at 2.0% max).</span>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
