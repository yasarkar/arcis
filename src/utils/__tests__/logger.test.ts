import { describe, it, expect, vi } from 'vitest'
import { logger, default as defaultLogger } from '../logger'

describe('Arcis logger shim & structured API', () => {
  it('exports the structured logger singleton via named and default bindings', () => {
    expect(logger).toBe(defaultLogger)
    expect(typeof logger.warn).toBe('function')
    expect(typeof logger.info).toBe('function')
    expect(typeof logger.error).toBe('function')
    expect(typeof logger.debug).toBe('function')
    expect(typeof logger.createScope).toBe('function')
  })

  it('createScope returns scoped wrappers for all levels', () => {
    const scoped = logger.createScope('pool-op')
    expect(typeof scoped.warn).toBe('function')
    expect(typeof scoped.error).toBe('function')
    expect(typeof scoped.info).toBe('function')
    expect(typeof scoped.debug).toBe('function')
  })

  it('does not throw when invoked (integration safety)', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    try {
      expect(() => logger.warn('safe warn')).not.toThrow()
      expect(() => logger.error('safe error')).not.toThrow()
      expect(() => logger.info('safe info')).not.toThrow()
      expect(() => logger.debug('safe debug')).not.toThrow()
    } finally {
      warnSpy.mockRestore()
      errorSpy.mockRestore()
      logSpy.mockRestore()
    }
  })

  it('degrades gracefully even if console.warn is temporarily missing (strict/sandbox env)', () => {
    const originalWarn = Object.getOwnPropertyDescriptor(console, 'warn')
    Object.defineProperty(console, 'warn', { value: undefined, writable: true, configurable: true })
    try {
      expect(() => logger.warn('resilient under missing console.warn')).not.toThrow()
    } finally {
      if (originalWarn) {
        Object.defineProperty(console, 'warn', originalWarn)
      } else {
        delete (console as any).warn
      }
    }
  })
})