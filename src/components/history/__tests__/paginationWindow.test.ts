import { describe, it, expect } from 'vitest'
import { getPaginationWindow, type PaginationWindowItem } from '../historyHelpers'

// P1-3: pagination must not render one button per page (500 rows at 10/page = 50 buttons).

const pagesOnly = (window: PaginationWindowItem[]): number[] =>
  window.filter((item): item is number => item !== 'gap')

describe('getPaginationWindow', () => {
  it('returns a single page when there is only one', () => {
    expect(getPaginationWindow(1, 1)).toEqual([1])
  })

  it('returns every page when the list fits in the cap', () => {
    expect(getPaginationWindow(1, 7)).toEqual([1, 2, 3, 4, 5, 6, 7])
  })

  it('centers the window with gaps on both sides', () => {
    expect(getPaginationWindow(5, 10)).toEqual([1, 'gap', 4, 5, 6, 'gap', 10])
  })

  it('does not add a leading gap on the first page', () => {
    expect(getPaginationWindow(1, 10)).toEqual([1, 2, 'gap', 10])
  })

  it('does not add a trailing gap on the last page', () => {
    expect(getPaginationWindow(10, 10)).toEqual([1, 'gap', 9, 10])
  })

  it('keeps the first pages contiguous near the start', () => {
    expect(getPaginationWindow(2, 10)).toEqual([1, 2, 3, 'gap', 10])
  })

  it('keeps the last pages contiguous near the end', () => {
    expect(getPaginationWindow(9, 10)).toEqual([1, 'gap', 8, 9, 10])
  })

  it('clamps an out-of-range current page', () => {
    expect(getPaginationWindow(0, 10)).toEqual(getPaginationWindow(1, 10))
    expect(getPaginationWindow(-4, 10)).toEqual(getPaginationWindow(1, 10))
    expect(getPaginationWindow(999, 10)).toEqual(getPaginationWindow(10, 10))
  })

  it('treats a zero total as a single page', () => {
    expect(getPaginationWindow(3, 0)).toEqual([1])
  })

  it('stays bounded for a long list (50 pages)', () => {
    const window = getPaginationWindow(25, 50)
    expect(window.length).toBeLessThanOrEqual(7)
    expect(window[0]).toBe(1)
    expect(window[window.length - 1]).toBe(50)
    expect(window).toContain(25)
  })

  it('never repeats a page, starts or ends with a gap, or leaves the range', () => {
    for (let current = 1; current <= 50; current += 1) {
      const window = getPaginationWindow(current, 50)
      const pages = pagesOnly(window)

      expect(window[0]).not.toBe('gap')
      expect(window[window.length - 1]).not.toBe('gap')
      expect(window.length).toBeLessThanOrEqual(7)
      expect(new Set(pages).size).toBe(pages.length)
      expect(pages).toContain(current)
      for (const page of pages) {
        expect(Number.isInteger(page)).toBe(true)
        expect(page).toBeGreaterThanOrEqual(1)
        expect(page).toBeLessThanOrEqual(50)
      }
    }
  })

  it('honors a larger maxButtons cap', () => {
    const window = getPaginationWindow(25, 50, 9)
    expect(window.length).toBeLessThanOrEqual(9)
    expect(window).toContain(25)
  })
})
