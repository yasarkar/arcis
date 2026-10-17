import type { CopilotActionPayload } from '../types/marketplace'
import type { InlineExecutionReceipt, SessionActionType, SessionKeyConfig } from '../types/sessionKey'
import { logger } from '../utils/logger'

/** Scoped logger: the in-process queue must keep draining after a failed task. */
const log = logger.createScope('sessionSpendLedger')

const PREFIX = 'arcis_session_spend_v1_'
export interface SessionSpendReservation {
  id: string
  sessionId: string
  actionType: SessionActionType
  amountMicros: number
  fingerprint: string
  action: CopilotActionPayload
  state: 'reserved' | 'signing' | 'pending' | 'committed' | 'released'
  createdAt: number
  txHash?: string
  userOpHash?: string
  phase?: 'approval' | 'spend'
  receipt?: InlineExecutionReceipt
}
interface Ledger {
  version: 1
  spentBySession: Record<string, number>
  reservations: Record<string, SessionSpendReservation>
}
const empty = (): Ledger => ({ version: 1, spentBySession: {}, reservations: {} })
const queues = new Map<string, Promise<unknown>>()
export function spendMicros(amount: number): number {
  const micros = Math.ceil(amount * 1e6)
  if (!Number.isFinite(amount) || amount <= 0 || !Number.isSafeInteger(micros)) throw new Error('Invalid session spend amount.')
  return micros
}
const key = (wallet: string) => PREFIX + wallet.trim().toLowerCase()

export function readSessionSpendLedger(wallet: string): Ledger {
  if (typeof localStorage === 'undefined') throw new Error('Durable session budget storage is unavailable.')
  const raw = localStorage.getItem(key(wallet))
  if (!raw) return empty()
  const value = JSON.parse(raw) as Ledger
  if (value.version !== 1 || !value.spentBySession || !value.reservations) throw new Error('Invalid session budget journal; execution is blocked.')
  for (const record of Object.values(value.reservations)) {
    if (!record || !Number.isSafeInteger(record.amountMicros) || record.amountMicros <= 0 ||
      !['reserved', 'signing', 'pending', 'committed', 'released'].includes(record.state)) throw new Error('Invalid session budget reservation.')
  }
  for (const amount of Object.values(value.spentBySession)) if (!Number.isSafeInteger(amount) || amount < 0) throw new Error('Invalid committed budget.')
  return value
}

/** Browser never falls back to a per-tab mutex. Node tests can use a shared in-process queue. */
export async function withSessionSpendLock<T>(wallet: string, operation: () => T | Promise<T>): Promise<T> {
  const name = key(wallet)
  if (typeof navigator !== 'undefined' && navigator.locks?.request) {
    return navigator.locks.request(name, { mode: 'exclusive' }, operation)
  }
  if (typeof window !== 'undefined') throw new Error('Atomic session budget locking is unavailable in this browser; execution is blocked.')
  const previous = queues.get(name) ?? Promise.resolve()
  // Best-effort: a previous task's rejection was already reported to its own caller, and swallowing
  // it here is what keeps the queue draining instead of wedging every later session spend.
  const task = previous.catch((err) => log.debug('Previous session-budget task failed; continuing the queue.', err)).then(operation)
  queues.set(name, task)
  try { return await task } finally { if (queues.get(name) === task) queues.delete(name) }
}

function write(wallet: string, ledger: Ledger): void {
  localStorage.setItem(key(wallet), JSON.stringify(ledger))
  // Never authorize a signer on a swallowed/quota write failure.
  if (localStorage.getItem(key(wallet)) !== JSON.stringify(ledger)) throw new Error('Session budget reservation could not be persisted.')
}
export function outstandingSpendMicros(ledger: Ledger): number {
  return Object.values(ledger.reservations).filter(r => !['released', 'committed'].includes(r.state)).reduce((sum, r) => sum + r.amountMicros, 0)
}
export function sessionSpendSnapshot(wallet: string, config: SessionKeyConfig): { spentUsdc: number; reservedUsdc: number } {
  const ledger = readSessionSpendLedger(wallet)
  return { spentUsdc: Math.max(config.spentUsdc || 0, (ledger.spentBySession[config.sessionId] || 0) / 1e6), reservedUsdc: outstandingSpendMicros(ledger) / 1e6 }
}
export async function admitSessionSpend(wallet: string, configReader: () => SessionKeyConfig, input: Omit<SessionSpendReservation, 'sessionId' | 'state' | 'createdAt'>): Promise<SessionSpendReservation> {
  return withSessionSpendLock(wallet, () => {
    const config = configReader()
    const ledger = readSessionSpendLedger(wallet)
    const prior = ledger.reservations[input.id]
    if (prior) {
      if (prior.fingerprint !== input.fingerprint) throw new Error('Draft identity changed; prepare a new transaction.')
      return prior
    }
    if (!config.isActive || Date.now() > config.expiresAt) throw new Error('Session inactive or expired; no transaction was signed.')
    if (!config.allowedActions.includes(input.actionType)) throw new Error('Action is not authorized by this session.')
    if (input.amountMicros > Math.floor(config.maxPerTxUsdc * 1e6)) throw new Error('Session per-transaction cap exceeded.')
    const spent = Math.max(Math.ceil(config.spentUsdc * 1e6), ledger.spentBySession[config.sessionId] || 0)
    if (spent + outstandingSpendMicros(ledger) + input.amountMicros > Math.floor(config.maxSpendUsdc * 1e6)) throw new Error('Session budget limit reached; pending transactions reserve the remaining budget.')
    if (Object.keys(ledger.reservations).length >= 1000) throw new Error('Session journal is full; execution is blocked until records are reviewed.')
    ledger.spentBySession[config.sessionId] = spent
    const reservation: SessionSpendReservation = { ...input, sessionId: config.sessionId, state: 'reserved', createdAt: Date.now() }
    ledger.reservations[input.id] = reservation
    write(wallet, ledger)
    return reservation
  })
}

export async function updateSessionSpend(wallet: string, id: string, update: Partial<Pick<SessionSpendReservation, 'state' | 'txHash' | 'userOpHash' | 'phase' | 'receipt'>>): Promise<SessionSpendReservation> {
  return withSessionSpendLock(wallet, () => {
    const ledger = readSessionSpendLedger(wallet)
    const record = ledger.reservations[id]
    if (!record) throw new Error('Session reservation was not found.')
    if (record.state === 'committed' || record.state === 'released') return record
    if (update.state === 'committed') {
      const prior = ledger.spentBySession[record.sessionId] || 0
      ledger.spentBySession[record.sessionId] = prior + record.amountMicros
    }
    Object.assign(record, update)
    write(wallet, ledger)
    return record
  })
}

export async function claimSessionSpend(wallet: string, id: string): Promise<boolean> {
  return withSessionSpendLock(wallet, () => {
    const ledger = readSessionSpendLedger(wallet)
    const record = ledger.reservations[id]
    if (!record || record.state !== 'reserved') return false
    // Persist before entering an async signer. A crash here is unknown, never auto-released.
    record.state = 'signing'
    write(wallet, ledger)
    return true
  })
}
