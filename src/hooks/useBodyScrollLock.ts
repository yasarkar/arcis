import { useEffect } from 'react'

let activeLockCount = 0
let originalOverflow = ''
let originalPaddingRight = ''

export function lockBodyScroll(): void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return

  if (activeLockCount === 0) {
    originalOverflow = document.body.style.overflow
    originalPaddingRight = document.body.style.paddingRight

    // Compute scrollbar width to prevent desktop layout jump
    const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth
    if (scrollbarWidth > 0) {
      document.body.style.paddingRight = `${scrollbarWidth}px`
    }
    document.body.style.overflow = 'hidden'
  }

  activeLockCount++
}

export function unlockBodyScroll(): void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return

  activeLockCount--
  if (activeLockCount <= 0) {
    activeLockCount = 0
    document.body.style.overflow = originalOverflow
    document.body.style.paddingRight = originalPaddingRight
  }
}

export function getActiveBodyScrollLockCount(): number {
  return activeLockCount
}

/**
 * Custom hook to lock body scrolling when a modal or overlay is open.
 * - Supports multiple nested or simultaneous modals using a reference counter.
 * - Prevents layout shift (content jumping) on desktop browsers by compensating
 *   for the disappearing vertical scrollbar width via `paddingRight`.
 */
export function useBodyScrollLock(isLocked: boolean): void {
  useEffect(() => {
    if (!isLocked) return

    lockBodyScroll()

    return () => {
      unlockBodyScroll()
    }
  }, [isLocked])
}
