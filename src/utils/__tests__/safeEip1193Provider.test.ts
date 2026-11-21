import { describe, expect, it, vi } from 'vitest'
import { wrapSafeEip1193Provider, wrapSafeEvmConnector } from '../safeEip1193Provider'

/**
 * Simulates a wallet extension (`inpage.js`) Proxy whose `get` trap throws
 * `TypeError: s[c].bind is not a function` when enumerated by React 19.2 DEV's
 * `addObjectToProperties` (`for (var key in obj) ... obj[key]`).
 */
function createHostileExtensionProvider() {
  const requestSpy = vi.fn(async function (this: any, args: { method: string }) {
    if (this !== proxy) {
      throw new Error('Lost provider `this` binding')
    }
    return args.method === 'eth_chainId' ? '0x4cef52' : ['0x1234']
  })
  const onSpy = vi.fn()
  const removeListenerSpy = vi.fn()

  const innerTarget: Record<string, any> = {
    request: requestSpy,
    on: onSpy,
    removeListener: removeListenerSpy,
    // Non-function enumerable property that causes hostile `.bind()` trap to blow up
    providerState: { broken: true },
  }

  const proxy: any = new Proxy(innerTarget, {
    get(target, prop, receiver) {
      if (prop === 'providerState') {
        // Mirrors `inpage.js:567 Uncaught TypeError: s[c].bind is not a function`
        return (target[prop] as any).bind(target)
      }
      return Reflect.get(target, prop, receiver)
    },
  })

  return { proxy, requestSpy, onSpy, removeListenerSpy }
}

/** Mirrors React 19.2 DEV's `addObjectToProperties` loop in `react-dom_client.js`. */
function simulateReact19PropDiffWalk(obj: Record<string, any>) {
  const visited: Array<[string, string]> = []
  for (const key in obj) {
    if (Object.prototype.hasOwnProperty.call(obj, key) && key[0] !== '_') {
      const value = obj[key]
      visited.push([key, typeof value])
      if (value && typeof value === 'object') {
        simulateReact19PropDiffWalk(value)
      }
    }
  }
  return visited
}

describe('safeEip1193Provider', () => {
  it('reproduces the React 19.2 DEV crash on a raw hostile extension Proxy and prevents it when wrapped', async () => {
    const { proxy, requestSpy, onSpy, removeListenerSpy } = createHostileExtensionProvider()

    // Raw extension Proxy crashes when walked by React 19.2 DEV prop diffing
    expect(() => simulateReact19PropDiffWalk({ connectedProvider: proxy })).toThrow(
      /bind is not a function/i
    )

    // Wrapped facade is 100% safe to enumerate deeply
    const safe = wrapSafeEip1193Provider(proxy)
    expect(safe).not.toBeNull()
    expect(() => simulateReact19PropDiffWalk({ connectedProvider: safe })).not.toThrow()
    expect(Object.keys(safe!)).toEqual(['request', 'on', 'removeListener'])

    // Forwarding preserves method execution and `this` binding on the underlying Proxy
    await expect(safe!.request({ method: 'eth_chainId' })).resolves.toBe('0x4cef52')
    expect(requestSpy).toHaveBeenCalledWith({ method: 'eth_chainId' })

    const listener = () => {}
    safe!.on?.('accountsChanged', listener)
    safe!.removeListener?.('accountsChanged', listener)
    expect(onSpy).toHaveBeenCalledWith('accountsChanged', listener)
    expect(removeListenerSpy).toHaveBeenCalledWith('accountsChanged', listener)
  })

  it('is idempotent when wrapping an already-wrapped provider', () => {
    const { proxy } = createHostileExtensionProvider()
    const first = wrapSafeEip1193Provider(proxy)
    const second = wrapSafeEip1193Provider(first)
    expect(second).toBe(first)
  })

  it('returns null for nullish or non-EIP-1193 inputs', () => {
    expect(wrapSafeEip1193Provider(null)).toBeNull()
    expect(wrapSafeEip1193Provider(undefined)).toBeNull()
    expect(wrapSafeEip1193Provider({})).toBeNull()
    expect(wrapSafeEip1193Provider('not-a-provider')).toBeNull()
  })

  it('wraps wagmi connectors so hostile connector properties are never enumerated and getProvider returns a safe facade', async () => {
    const { proxy } = createHostileExtensionProvider()
    const hostileConnector = {
      id: 'injected',
      provider: proxy,
      getProvider: async () => proxy,
    }

    // Raw connector with nested extension proxy crashes React 19.2 DEV prop diffing
    expect(() => simulateReact19PropDiffWalk({ connector: hostileConnector })).toThrow(
      /bind is not a function/i
    )

    const safeConnector = wrapSafeEvmConnector(hostileConnector)
    expect(safeConnector).toBeDefined()
    expect(() => simulateReact19PropDiffWalk({ connector: safeConnector })).not.toThrow()
    expect(Object.keys(safeConnector!)).toEqual(['getProvider'])

    const resolvedProvider = await safeConnector!.getProvider()
    expect(resolvedProvider).not.toBeNull()
    expect(() => simulateReact19PropDiffWalk({ provider: resolvedProvider })).not.toThrow()
    await expect(resolvedProvider!.request({ method: 'eth_chainId' })).resolves.toBe('0x4cef52')
  })

  it('returns undefined for nullish or invalid connectors', () => {
    expect(wrapSafeEvmConnector(null)).toBeUndefined()
    expect(wrapSafeEvmConnector(undefined)).toBeUndefined()
    expect(wrapSafeEvmConnector({})).toBeUndefined()
  })
})
