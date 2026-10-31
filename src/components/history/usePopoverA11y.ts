// src/components/history/usePopoverA11y.ts
//
// The history filter popovers open from a header button and must be operable
// without a mouse (P3-1). This hook gives each popover the three pieces the
// roadmap calls for and that a plain `div` never gets for free:
//
//   - initial focus moves into the popover,
//   - Escape closes it,
//   - Tab / Shift+Tab wrap inside it instead of escaping into the table,
//   - focus returns to the trigger when the popover is dismissed from the keyboard.
//
// Focus is only restored when it was still inside the popover (or on `body`), so
// closing a popover by clicking elsewhere in the page does not yank focus back to
// the filter button the user just left.

import { useEffect, useRef } from 'react'
import { getFocusTrapIndex } from './headerA11y'

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

function getFocusable(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (element) => element.offsetParent !== null || element === document.activeElement
  )
}

export function usePopoverA11y<T extends HTMLElement = HTMLDivElement>(
  open: boolean,
  onClose: () => void
) {
  const ref = useRef<T | null>(null)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  useEffect(() => {
    if (!open) return
    const container = ref.current
    if (!container) return

    const previouslyFocused =
      document.activeElement instanceof HTMLElement ? document.activeElement : null

    // Prefer the first text field so the amount/recipient popovers are ready to
    // type in; otherwise focus the container itself and let Tab reach the controls.
    const initialTarget =
      container.querySelector<HTMLElement>('input:not([type="hidden"])') ?? container
    initialTarget.focus({ preventScroll: true })

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        onCloseRef.current()
        return
      }
      if (event.key !== 'Tab') return

      const focusable = getFocusable(container)
      const index = focusable.indexOf(document.activeElement as HTMLElement)
      const target = getFocusTrapIndex(index, focusable.length, event.shiftKey)
      if (target === null) return
      event.preventDefault()
      focusable[target]?.focus({ preventScroll: true })
    }

    container.addEventListener('keydown', handleKeyDown)
    return () => {
      container.removeEventListener('keydown', handleKeyDown)
      const active = document.activeElement
      const focusWasInside =
        !active || active === document.body || container.contains(active)
      if (focusWasInside && previouslyFocused?.isConnected) {
        previouslyFocused.focus({ preventScroll: true })
      }
    }
  }, [open])

  return ref
}
