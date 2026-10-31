import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  DEFAULT_HISTORY_URL_STATE,
  buildHistorySearchParams,
  readHistoryUrlState,
  writeHistoryUrlState,
  type HistoryUrlState,
} from '../historyUrlState'

// P1-1: History filters survive a reload / back button / shared link, and only
// non-default values reach the URL so a clean view keeps a clean address.

const TX_HASH = `0x${'ab'.repeat(32)}`

const FULL_STATE: HistoryUrlState = {
  type: 'bridge',
  network: 'base',
  q: '0xdead',
  from: 1_700_000_000_000,
  to: 1_700_100_000_000,
  min: 10,
  max: 500,
  recipient: '0x1234',
  sortField: 'amount',
  sortDirection: 'asc',
  page: 3,
  tx: TX_HASH,
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('readHistoryUrlState', () => {
  it('returns defaults for an empty search string', () => {
    expect(readHistoryUrlState('')).toEqual(DEFAULT_HISTORY_URL_STATE)
    expect(readHistoryUrlState('?')).toEqual(DEFAULT_HISTORY_URL_STATE)
  })

  it('parses every supported key, with or without the leading question mark', () => {
    const state = readHistoryUrlState(buildHistorySearchParams(FULL_STATE).toString())
    expect(state).toEqual(FULL_STATE)
    expect(readHistoryUrlState(`?${buildHistorySearchParams(FULL_STATE).toString()}`)).toEqual(FULL_STATE)
  })

  it('falls back to defaults for invalid values instead of throwing', () => {
    const state = readHistoryUrlState('?type=bogus&sort=bogus&dir=bogus&page=0&from=abc&to=&min=NaN&max=Infinity')

    expect(state.type).toBe('all')
    expect(state.sortField).toBe('time')
    expect(state.sortDirection).toBe('desc')
    expect(state.page).toBe(1)
    expect(state.from).toBeUndefined()
    expect(state.to).toBeUndefined()
    expect(state.min).toBeUndefined()
    expect(state.max).toBeUndefined()
  })

  it('requires a positive integer page', () => {
    expect(readHistoryUrlState('?page=3').page).toBe(3)
    expect(readHistoryUrlState('?page=2.7').page).toBe(1)
    expect(readHistoryUrlState('?page=-4').page).toBe(1)
  })

  it('accepts only a full 32-byte hex transaction hash for ?tx', () => {
    expect(readHistoryUrlState(`?tx=${TX_HASH}`).tx).toBe(TX_HASH)
    expect(readHistoryUrlState('?tx=0x1234').tx).toBeNull()
    expect(readHistoryUrlState(`?tx=${'zz'.repeat(32)}`).tx).toBeNull()
  })

  it('trims surrounding whitespace from free-text filters when writing', () => {
    const params = buildHistorySearchParams({ ...DEFAULT_HISTORY_URL_STATE, q: '  0xdead  ', recipient: ' 0xbeef ' })
    expect(params.get('q')).toBe('0xdead')
    expect(params.get('recipient')).toBe('0xbeef')
  })
})

describe('buildHistorySearchParams', () => {
  it('omits every default value', () => {
    expect(buildHistorySearchParams(DEFAULT_HISTORY_URL_STATE).toString()).toBe('')
    expect(buildHistorySearchParams({ ...DEFAULT_HISTORY_URL_STATE, page: 1, sortField: 'time', sortDirection: 'desc' }).toString()).toBe('')
  })

  it('preserves query params owned by other features', () => {
    const base = new URLSearchParams('foo=bar&type=send&page=9')
    const params = buildHistorySearchParams({ ...DEFAULT_HISTORY_URL_STATE, type: 'swap' }, base)

    expect(params.get('foo')).toBe('bar')
    expect(params.get('type')).toBe('swap')
    expect(params.get('page')).toBeNull()
  })

  it('keeps a non-default sort direction even when the sort field is the default', () => {
    const params = buildHistorySearchParams({ ...DEFAULT_HISTORY_URL_STATE, sortDirection: 'asc' })
    expect(params.get('sort')).toBeNull()
    expect(params.get('dir')).toBe('asc')
  })

  it('writes a non-default page and drops the deep-link hash when it is invalid', () => {
    const params = buildHistorySearchParams({ ...DEFAULT_HISTORY_URL_STATE, page: 4, tx: 'nope' })
    expect(params.get('page')).toBe('4')
    expect(params.get('tx')).toBeNull()
  })
})

describe('writeHistoryUrlState', () => {
  function stubWindow(search: string, hash = '#history') {
    const replaceState = vi.fn()
    vi.stubGlobal('window', {
      location: { pathname: '/app', search, hash },
      history: { replaceState, state: { navigationId: 7 } },
    })
    return replaceState
  }

  it('replaces the URL while keeping the hash and unrelated params', () => {
    const replaceState = stubWindow('?foo=bar&type=bridge')

    writeHistoryUrlState({ ...DEFAULT_HISTORY_URL_STATE, type: 'swap', page: 2 })

    expect(replaceState).toHaveBeenCalledTimes(1)
    expect(replaceState).toHaveBeenCalledWith({ navigationId: 7 }, '', '/app?foo=bar&type=swap&page=2#history')
  })

  it('does not touch the URL when the state already matches it', () => {
    const replaceState = stubWindow('?type=swap&page=2')

    writeHistoryUrlState({ ...DEFAULT_HISTORY_URL_STATE, type: 'swap', page: 2 })

    expect(replaceState).not.toHaveBeenCalled()
  })

  it('clears our query string when every filter returns to its default', () => {
    const replaceState = stubWindow('?type=swap&page=2&foo=bar')

    writeHistoryUrlState(DEFAULT_HISTORY_URL_STATE)

    expect(replaceState).toHaveBeenCalledWith({ navigationId: 7 }, '', '/app?foo=bar#history')
  })

  it('is a no-op outside the browser', () => {
    vi.stubGlobal('window', undefined)
    expect(() => writeHistoryUrlState(DEFAULT_HISTORY_URL_STATE)).not.toThrow()
  })
})
