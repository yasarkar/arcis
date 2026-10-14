// src/utils/singleFlight.ts
//
// Collapses duplicate in-flight requests and backs off rate-limited ones.
//
// Why this exists: the Bridge tab's fee preview re-quotes on every (debounced)
// keystroke, and every quote is an unauthenticated call to Circle's Iris API.
// Typing "100" could fire three quotes for the same route. The quote itself is
// keyed by route+amount, so two concurrent calls with the same key are always
// the same question — asking twice only burns rate limit.
//
// Deliberately NOT a value cache: a quote is never served after the request that
// produced it finishes, so a caller never signs a fee older than its own call
// (which matters for the burn's `maxFee`).

interface InFlightEntry<T> {
  promise: Promise<T>
}

const inFlight = new Map<string, InFlightEntry<unknown>>()

/** Per-key "do not ask again before" timestamps, set after a 429/rate-limit answer. */
const backoffUntil = new Map<string, number>()

/** How long a rate-limited key stays parked before the next attempt. */
export const RATE_LIMIT_BACKOFF_MS = 15_000

export class RateLimitedError extends Error {
  constructor(message = 'The upstream service rate-limited this request; retry shortly.') {
    super(message)
    this.name = 'RateLimitedError'
  }
}

/**
 * True when `error` (or an HTTP status) means the upstream asked us to slow
 * down. Circle's Iris and Gateway both answer 429 when they do.
 */
export function isRateLimited(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? '')
  return /\b429\b|rate.?limit|too many requests/i.test(message)
}

/**
 * Runs `factory` with at most one in-flight execution per `key`. Concurrent
 * callers with the same key share the first promise. A rejected promise is not
 * cached — the next caller retries.
 */
export async function singleFlight<T>(key: string, factory: () => Promise<T>): Promise<T> {
  const existing = inFlight.get(key)
  if (existing) return existing.promise as Promise<T>

  const entry: InFlightEntry<T> = { promise: factory() }
  inFlight.set(key, entry as InFlightEntry<unknown>)
  try {
    return await entry.promise
  } finally {
    // Only clear our own entry: a newer call may already have replaced it.
    if (inFlight.get(key) === (entry as InFlightEntry<unknown>)) inFlight.delete(key)
  }
}

/**
 * Like {@link singleFlight}, but refuses to call `factory` while the key is
 * inside its rate-limit backoff window, throwing {@link RateLimitedError} so the
 * caller can fall back to a static estimate instead of hammering the endpoint.
 * A rate-limited answer from `factory` arms the backoff for the same key.
 */
export async function singleFlightWithBackoff<T>(
  key: string,
  factory: () => Promise<T>,
  options: { bypassBackoff?: boolean } = {}
): Promise<T> {
  const parkedUntil = backoffUntil.get(key)
  // A fund-moving path must always be allowed to try: `bypassBackoff` is what
  // keeps a preview's rate-limit park from blocking an execution the user just
  // asked for. The call is still single-flighted either way.
  if (!options.bypassBackoff && parkedUntil !== undefined && Date.now() < parkedUntil) {
    throw new RateLimitedError()
  }

  try {
    return await singleFlight(key, factory)
  } catch (error) {
    if (isRateLimited(error)) {
      backoffUntil.set(key, Date.now() + RATE_LIMIT_BACKOFF_MS)
    }
    throw error
  }
}

/** Test seam: drop every in-flight entry and backoff window. */
export function resetSingleFlightState(): void {
  inFlight.clear()
  backoffUntil.clear()
}
