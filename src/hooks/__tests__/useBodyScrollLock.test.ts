import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  lockBodyScroll,
  unlockBodyScroll,
  getActiveBodyScrollLockCount,
} from '../useBodyScrollLock'

describe('useBodyScrollLock manager', () => {
  const originalWindow = globalThis.window
  const originalDocument = globalThis.document

  let mockBodyStyle: { overflow: string; paddingRight: string }

  beforeEach(() => {
    mockBodyStyle = { overflow: '', paddingRight: '' }

    // Mock minimal DOM window and document if running in node env
    const mockDocument = {
      body: {
        style: mockBodyStyle,
      },
      documentElement: {
        clientWidth: 1000,
      },
    }

    const mockWindow = {
      innerWidth: 1016, // 16px scrollbar difference
    }

    // @ts-ignore
    globalThis.document = mockDocument
    // @ts-ignore
    globalThis.window = mockWindow
  })

  afterEach(() => {
    // Reset active locks
    while (getActiveBodyScrollLockCount() > 0) {
      unlockBodyScroll()
    }
    // @ts-ignore
    globalThis.window = originalWindow
    // @ts-ignore
    globalThis.document = originalDocument
  })

  it('locks body overflow and compensates scrollbar padding when locked', () => {
    expect(getActiveBodyScrollLockCount()).toBe(0)
    lockBodyScroll()

    expect(getActiveBodyScrollLockCount()).toBe(1)
    expect(globalThis.document.body.style.overflow).toBe('hidden')
    expect(globalThis.document.body.style.paddingRight).toBe('16px')

    unlockBodyScroll()
    expect(getActiveBodyScrollLockCount()).toBe(0)
    expect(globalThis.document.body.style.overflow).toBe('')
    expect(globalThis.document.body.style.paddingRight).toBe('')
  })

  it('handles multiple modals via reference counting', () => {
    lockBodyScroll() // Modal 1 opens
    expect(getActiveBodyScrollLockCount()).toBe(1)
    expect(globalThis.document.body.style.overflow).toBe('hidden')

    lockBodyScroll() // Modal 2 opens
    expect(getActiveBodyScrollLockCount()).toBe(2)
    expect(globalThis.document.body.style.overflow).toBe('hidden')

    unlockBodyScroll() // Modal 1 closes
    expect(getActiveBodyScrollLockCount()).toBe(1)
    expect(globalThis.document.body.style.overflow).toBe('hidden') // Still locked!

    unlockBodyScroll() // Modal 2 closes
    expect(getActiveBodyScrollLockCount()).toBe(0)
    expect(globalThis.document.body.style.overflow).toBe('') // Now unlocked
  })

  it('restores original body styles when unlocked', () => {
    globalThis.document.body.style.overflow = 'scroll'
    globalThis.document.body.style.paddingRight = '10px'

    lockBodyScroll()
    expect(globalThis.document.body.style.overflow).toBe('hidden')

    unlockBodyScroll()
    expect(globalThis.document.body.style.overflow).toBe('scroll')
    expect(globalThis.document.body.style.paddingRight).toBe('10px')
  })
})
