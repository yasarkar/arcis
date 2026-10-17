// api/__tests__/boundedStore.test.ts
// ARC-008: the in-process x402 fallback stores must stay bounded by a TTL and an entry budget,
// because the durable KV path — not this memory — is what actually stops a replay.

import { describe, expect, it, vi } from 'vitest'
import { createBoundedTtlMap, createBoundedTtlSet } from '../_utils/boundedStore'

function clock(start = 1_000_000) {
  let current = start
  return {
    now: () => current,
    advance: (ms: number) => {
      current += ms
    },
  }
}

describe('createBoundedTtlSet', () => {
  it('tracks membership and refuses to re-add a live key', () => {
    const set = createBoundedTtlSet({ name: 'test', maxEntries: 10, ttlMs: 60_000 })

    expect(set.has('nonce-a')).toBe(false)
    expect(set.add('nonce-a')).toBe(true)
    expect(set.has('nonce-a')).toBe(true)
    expect(set.add('nonce-a')).toBe(false)
    expect(set.size()).toBe(1)
  })

  it('expires entries once the TTL passes', () => {
    const time = clock()
    const set = createBoundedTtlSet({ name: 'test', maxEntries: 10, ttlMs: 1_000, now: time.now })

    set.add('nonce-a')
    time.advance(999)
    expect(set.has('nonce-a')).toBe(true)

    time.advance(2)
    expect(set.has('nonce-a')).toBe(false)
    expect(set.size()).toBe(0)
  })

  it('keeps the entry budget and drops the oldest writes first', () => {
    const set = createBoundedTtlSet({ name: 'test', maxEntries: 3, ttlMs: 60_000 })

    for (const key of ['a', 'b', 'c', 'd', 'e']) set.add(key)

    expect(set.size()).toBe(3)
    expect(set.has('a')).toBe(false)
    expect(set.has('b')).toBe(false)
    expect(set.has('c')).toBe(true)
    expect(set.has('e')).toBe(true)
  })

  it('reports capacity eviction at most once a minute', () => {
    const time = clock()
    const onCapacityEviction = vi.fn()
    const set = createBoundedTtlSet({ name: 'test', maxEntries: 1, ttlMs: 60_000, onCapacityEviction, now: time.now })

    set.add('a')
    set.add('b')
    expect(onCapacityEviction).toHaveBeenCalledTimes(1)

    time.advance(1_000)
    set.add('c')
    set.add('d')
    expect(onCapacityEviction).toHaveBeenCalledTimes(1)

    time.advance(61_000)
    set.add('e')
    set.add('f')
    expect(onCapacityEviction).toHaveBeenCalledTimes(2)
  })

  it('refreshes the TTL when a key is written again', () => {
    const time = clock()
    const set = createBoundedTtlSet({ name: 'test', maxEntries: 10, ttlMs: 1_000, now: time.now })

    set.add('a')
    time.advance(900)
    set.delete('a')
    set.add('a')
    time.advance(900)

    expect(set.has('a')).toBe(true)
  })
})

describe('createBoundedTtlMap', () => {
  it('stores values, honors the TTL and the entry budget', () => {
    const time = clock()
    const map = createBoundedTtlMap<number>({ name: 'test', maxEntries: 2, ttlMs: 5_000, now: time.now })

    map.set('p1', 1)
    map.set('p2', 2)
    map.set('p3', 3)

    expect(map.size()).toBe(2)
    expect(map.get('p1')).toBeUndefined()
    expect(map.get('p2')).toBe(2)
    expect(map.get('p3')).toBe(3)

    time.advance(5_001)
    expect(map.get('p3')).toBeUndefined()
    expect(map.size()).toBe(0)
  })
})
