// src/components/history/headerA11y.ts
//
// Pure accessibility helpers for the History table header (P3-1). Kept apart from
// the JSX so the sort semantics and the focus-trap arithmetic can be tested without
// a DOM.

import type { HistorySortDirection, HistorySortField } from './HistoryTableHeader'

export type AriaSortValue = 'ascending' | 'descending' | 'none'

/**
 * `aria-sort` belongs on the `th` of the sorted column and nowhere else: an
 * inactive column is `none`, not the (invalid) `false` or `asc`.
 */
export function getAriaSort(
  field: HistorySortField,
  currentField: HistorySortField,
  direction: HistorySortDirection
): AriaSortValue {
  if (field !== currentField) return 'none'
  return direction === 'asc' ? 'ascending' : 'descending'
}

/**
 * Accessible name for a sort button. The visible label alone ("NETWORK") does not
 * say the button sorts or which way it currently sorts, so the name carries both.
 */
export function getSortButtonLabel(
  label: string,
  field: HistorySortField,
  currentField: HistorySortField,
  direction: HistorySortDirection
): string {
  if (field !== currentField) return `Sort by ${label}`
  return `Sort by ${label}, currently ${direction === 'asc' ? 'ascending' : 'descending'}`
}

/**
 * Where Tab (or Shift+Tab) should move focus inside a trapped popover.
 *
 * Returns `null` when the browser's default movement already stays inside the
 * container, and the index to jump to when focus would leave it (or when focus is
 * not inside any focusable element yet). An empty container yields `null` so the
 * caller does not call `focus()` on nothing.
 */
export function getFocusTrapIndex(
  currentIndex: number,
  total: number,
  shiftKey: boolean
): number | null {
  if (total <= 0) return null
  if (currentIndex < 0 || currentIndex >= total) return shiftKey ? total - 1 : 0
  if (shiftKey && currentIndex === 0) return total - 1
  if (!shiftKey && currentIndex === total - 1) return 0
  return null
}
