import type {
  HistoryFilterType,
  HistorySortDirection,
  HistorySortField,
} from './HistoryTableHeader'

// P1-1: the History tab's filters live in the URL, so a filtered view survives a
// reload, the back button and a shared link. Only non-default values are written;
// query params this module does not own (and the location hash) are preserved.

export interface HistoryUrlState {
  type: HistoryFilterType
  network: string
  q: string
  from?: number
  to?: number
  min?: number
  max?: number
  recipient: string
  sortField: HistorySortField
  sortDirection: HistorySortDirection
  page: number
  /** Deep link to one transaction's receipt. */
  tx: string | null
}

export const DEFAULT_HISTORY_URL_STATE: HistoryUrlState = {
  type: 'all',
  network: 'all',
  q: '',
  recipient: '',
  sortField: 'time',
  sortDirection: 'desc',
  page: 1,
  tx: null,
}

const FILTER_TYPES: readonly HistoryFilterType[] = [
  'all',
  'send',
  'swap',
  'bridge',
  'deposit',
  'ai_service',
  'pool',
  'add_liquidity',
  'remove_liquidity',
  'harvest',
  'memo',
]

const SORT_FIELDS: readonly HistorySortField[] = ['time', 'amount', 'type', 'network']
const SORT_DIRECTIONS: readonly HistorySortDirection[] = ['asc', 'desc']

/** Every query key this module reads or writes. */
const URL_KEYS = ['type', 'network', 'q', 'from', 'to', 'min', 'max', 'recipient', 'sort', 'dir', 'page', 'tx'] as const

const TX_HASH_PATTERN = /^0x[a-fA-F0-9]{64}$/

function toSearchParams(search?: string): URLSearchParams {
  if (typeof search === 'string') {
    return new URLSearchParams(search.startsWith('?') ? search.slice(1) : search)
  }
  if (typeof window !== 'undefined' && window.location) {
    return new URLSearchParams(window.location.search)
  }
  return new URLSearchParams()
}

function parseFiniteNumber(raw: string | null): number | undefined {
  if (raw === null || raw.trim() === '') return undefined
  const value = Number(raw)
  return Number.isFinite(value) ? value : undefined
}

function parsePage(raw: string | null): number {
  if (raw === null || raw.trim() === '') return 1
  const value = Number(raw)
  return Number.isInteger(value) && value >= 1 ? value : 1
}

function parseFilterType(raw: string | null): HistoryFilterType {
  return raw && (FILTER_TYPES as readonly string[]).includes(raw) ? (raw as HistoryFilterType) : 'all'
}

function parseSortField(raw: string | null): HistorySortField {
  return raw && (SORT_FIELDS as readonly string[]).includes(raw) ? (raw as HistorySortField) : 'time'
}

function parseSortDirection(raw: string | null): HistorySortDirection {
  return raw && (SORT_DIRECTIONS as readonly string[]).includes(raw)
    ? (raw as HistorySortDirection)
    : 'desc'
}

/** Reads filter state from a query string (defaults to the current URL). */
export function readHistoryUrlState(search?: string): HistoryUrlState {
  const params = toSearchParams(search)
  const tx = params.get('tx')

  return {
    type: parseFilterType(params.get('type')),
    network: params.get('network')?.trim() || 'all',
    q: params.get('q') ?? '',
    from: parseFiniteNumber(params.get('from')),
    to: parseFiniteNumber(params.get('to')),
    min: parseFiniteNumber(params.get('min')),
    max: parseFiniteNumber(params.get('max')),
    recipient: params.get('recipient') ?? '',
    sortField: parseSortField(params.get('sort')),
    sortDirection: parseSortDirection(params.get('dir')),
    page: parsePage(params.get('page')),
    tx: tx && TX_HASH_PATTERN.test(tx) ? tx : null,
  }
}

/**
 * Builds the query string for a state: a copy of `base` with this module's keys
 * removed, then only the values that differ from the defaults.
 */
export function buildHistorySearchParams(state: HistoryUrlState, base?: URLSearchParams): URLSearchParams {
  const params = new URLSearchParams(base ? base.toString() : '')
  for (const key of URL_KEYS) params.delete(key)

  if (state.type !== DEFAULT_HISTORY_URL_STATE.type) params.set('type', state.type)
  if (state.network && state.network !== DEFAULT_HISTORY_URL_STATE.network) params.set('network', state.network)
  if (state.q.trim()) params.set('q', state.q.trim())
  if (Number.isFinite(state.from)) params.set('from', String(state.from))
  if (Number.isFinite(state.to)) params.set('to', String(state.to))
  if (Number.isFinite(state.min)) params.set('min', String(state.min))
  if (Number.isFinite(state.max)) params.set('max', String(state.max))
  if (state.recipient.trim()) params.set('recipient', state.recipient.trim())
  if (state.sortField !== DEFAULT_HISTORY_URL_STATE.sortField) params.set('sort', state.sortField)
  if (state.sortDirection !== DEFAULT_HISTORY_URL_STATE.sortDirection) params.set('dir', state.sortDirection)
  if (Number.isInteger(state.page) && state.page > 1) params.set('page', String(state.page))
  if (state.tx && TX_HASH_PATTERN.test(state.tx)) params.set('tx', state.tx)

  return params
}

/**
 * Writes the filter state into the current URL without adding a history entry.
 * The hash and unrelated query params are kept; an unchanged URL is left alone.
 */
export function writeHistoryUrlState(state: HistoryUrlState): void {
  if (typeof window === 'undefined' || !window.history || !window.location) return

  const current = new URLSearchParams(window.location.search)
  const params = buildHistorySearchParams(state, current)
  const query = params.toString()
  const next = `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash || ''}`
  const currentUrl = `${window.location.pathname}${window.location.search}${window.location.hash || ''}`

  if (next === currentUrl) return
  window.history.replaceState(window.history.state ?? null, '', next)
}
