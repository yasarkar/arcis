// src/utils/safeEip1193Provider.ts
//
// React 19.2 DEV's Performance Track (`logComponentRender` -> `addObjectDiffToProperties`
// -> `addObjectToProperties`) enumerates every own non-`_` property on changed component
// props (`for (const key in obj) ... obj[key]`).
//
// Browser wallet extensions (MetaMask, Backpack, Rabby, OKX, etc.) inject `window.ethereum`
// / EIP-1193 providers wrapped in JS `Proxy` objects whose `get` traps can throw
// `TypeError: s[c].bind is not a function` when enumerated by React's dev logger.
// That uncaught exception inside `commitPassiveMountOnFiber` leaves React's
// `executionContext` stuck in `CommitContext`, permanently deadlocking the app with
// `Error: Should not already be working.` on every subsequent click.
//
// Wrapping the raw provider in a plain EIP-1193 facade keeps the extension Proxy inside a
// closure and exposes only plain forwarding methods (`request`, and optionally `on` /
// `removeListener`). React's prop-diff inspector never touches the extension Proxy while
// every EIP-1193 consumer (`viem` `custom()`, `@circle-fin/adapter-viem-v2`, `chainSwitchService`,
// etc.) continues to work identically.

const SAFE_PROVIDER_MARKER = Symbol('arcis.safeEip1193Provider')

export interface SafeEip1193Provider {
  request: (args: { method: string; params?: unknown[] | Record<string, unknown> }) => Promise<any>
  on?: (event: string, listener: (...args: any[]) => void) => void
  removeListener?: (event: string, listener: (...args: any[]) => void) => void
}

export interface SafeEvmConnectorLike {
  getProvider: () => Promise<SafeEip1193Provider | null>
}

function hasCallableMethod(target: any, methodName: string): boolean {
  try {
    return typeof target[methodName] === 'function'
  } catch {
    return false
  }
}

/**
 * Wraps a raw injected EIP-1193 provider (often a wallet extension `Proxy`) in a plain,
 * safely-enumerable facade so React 19.2 DEV prop-diff inspection never invokes hostile
 * `Proxy` `get` traps.
 */
export function wrapSafeEip1193Provider(rawProvider: unknown): SafeEip1193Provider | null {
  if (!rawProvider || typeof rawProvider !== 'object') {
    return null
  }

  if ((rawProvider as Record<symbol, unknown>)[SAFE_PROVIDER_MARKER] === true) {
    return rawProvider as SafeEip1193Provider
  }

  const target = rawProvider as Record<string, any>
  if (!hasCallableMethod(target, 'request')) {
    return null
  }

  const facade: SafeEip1193Provider = {
    request: (args) => target.request(args),
  }

  if (hasCallableMethod(target, 'on')) {
    facade.on = (event, listener) => {
      target.on(event, listener)
    }
  }

  if (hasCallableMethod(target, 'removeListener')) {
    facade.removeListener = (event, listener) => {
      target.removeListener(event, listener)
    }
  }

  Object.defineProperty(facade, SAFE_PROVIDER_MARKER, {
    value: true,
    enumerable: false,
    configurable: false,
    writable: false,
  })

  return facade
}

/**
 * Wraps a wagmi connector into a plain `{ getProvider }` facade so passing it as a React
 * prop never exposes internal connector properties or nested wallet Proxies to React 19.2
 * DEV prop-diff enumeration.
 */
export function wrapSafeEvmConnector(rawConnector: unknown): SafeEvmConnectorLike | undefined {
  if (!rawConnector || typeof rawConnector !== 'object') {
    return undefined
  }

  const target = rawConnector as Record<string, any>
  if (!hasCallableMethod(target, 'getProvider')) {
    return undefined
  }

  return {
    getProvider: async () => wrapSafeEip1193Provider(await target.getProvider()),
  }
}
