import { describe, expect, it } from 'vitest'
import { getAriaSort, getFocusTrapIndex, getSortButtonLabel } from '../headerA11y'

describe('getAriaSort', () => {
  it('marks the sorted column with its direction', () => {
    expect(getAriaSort('time', 'time', 'desc')).toBe('descending')
    expect(getAriaSort('time', 'time', 'asc')).toBe('ascending')
  })

  it('marks every inactive sortable column as none', () => {
    expect(getAriaSort('amount', 'time', 'asc')).toBe('none')
    expect(getAriaSort('network', 'time', 'desc')).toBe('none')
  })
})

describe('getSortButtonLabel', () => {
  it('announces the action for an inactive column', () => {
    expect(getSortButtonLabel('Network', 'network', 'time', 'desc')).toBe('Sort by Network')
  })

  it('announces the current direction for the active column', () => {
    expect(getSortButtonLabel('Time', 'time', 'time', 'desc')).toBe(
      'Sort by Time, currently descending'
    )
    expect(getSortButtonLabel('Time', 'time', 'time', 'asc')).toBe(
      'Sort by Time, currently ascending'
    )
  })
})

describe('getFocusTrapIndex', () => {
  it('does nothing when there is nothing to focus', () => {
    expect(getFocusTrapIndex(0, 0, false)).toBeNull()
    expect(getFocusTrapIndex(-1, 0, true)).toBeNull()
  })

  it('lets the browser move focus while it stays inside the popover', () => {
    expect(getFocusTrapIndex(1, 5, false)).toBeNull()
    expect(getFocusTrapIndex(3, 5, true)).toBeNull()
  })

  it('wraps from the last element forward and from the first element backward', () => {
    expect(getFocusTrapIndex(4, 5, false)).toBe(0)
    expect(getFocusTrapIndex(0, 5, true)).toBe(4)
  })

  it('pulls focus back in when it is outside the focusable list', () => {
    expect(getFocusTrapIndex(-1, 5, false)).toBe(0)
    expect(getFocusTrapIndex(-1, 5, true)).toBe(4)
    expect(getFocusTrapIndex(9, 5, false)).toBe(0)
    expect(getFocusTrapIndex(9, 5, true)).toBe(4)
  })
})
