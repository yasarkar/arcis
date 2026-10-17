// src/config/walletConfigStore.ts
//
// P03: versioned holder for the active wagmi config.
//
// First paint uses the minimal eager config from `./wagmi` (no WalletConnect /
// Coinbase SDKs). The first Connect click calls `requestFullWalletConnect()`,
// which loads the full config and bumps the version so `main.tsx` remounts the
// wallet provider subtree *before* the connect modal opens. The upgrade only
// ever happens pre-connection: if a session already exists the eager config
// stays, so an active session can never be dropped by a remount.

import type { Config } from 'wagmi'
import {
  config as eagerConfig,
  ensureFullWalletConfig,
} from './wagmi'

let activeConfig: Config = eagerConfig
let configVersion = 0
let pendingConnectOpen = 0

const listeners = new Set<() => void>()

function emit() {
  for (const listener of listeners) {
    try {
      listener()
    } catch {
      // A failing subscriber must never break the upgrade for others.
    }
  }
}

export function subscribeWalletConfig(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function getWalletConfigVersion(): number {
  return configVersion
}

export function getWalletConfig(): Config {
  return activeConfig
}

/** True once the full (WalletConnect + Coinbase) config is active. */
export function isFullWalletConfigActive(): boolean {
  return configVersion > 0
}

function requestConnectOpen() {
  pendingConnectOpen += 1
  emit()
}

function takePendingConnectOpen(): boolean {
  if (pendingConnectOpen === 0) return false
  pendingConnectOpen = 0
  return true
}

export function subscribePendingConnectOpen(listener: () => void): () => void {
  return subscribeWalletConfig(listener)
}

export function getPendingConnectOpenVersion(): number {
  return pendingConnectOpen
}

export function consumePendingConnectOpen(): boolean {
  const pending = takePendingConnectOpen()
  if (pending) emit()
  return pending
}

let upgradeInFlight: Promise<Config> | null = null

/**
 * Ensures the full wallet list is active, then signals that the connect modal
 * should open. Safe to call on every Connect click: after the first upgrade it
 * only flips the pending-open flag. Must only be called pre-connection (the
 * sole caller is the disconnected-state Connect button).
 */
export async function requestFullWalletConnect(): Promise<void> {
  if (isFullWalletConfigActive()) {
    requestConnectOpen()
    return
  }
  if (!upgradeInFlight) {
    upgradeInFlight = ensureFullWalletConfig().then((full) => {
      activeConfig = full
      configVersion += 1
      emit()
      return full
    })
  }
  try {
    await upgradeInFlight
  } finally {
    // A failed upgrade must not wedge future clicks: allow a retry, and still
    // open the modal with the eager wallets so Connect keeps working.
    if (!isFullWalletConfigActive()) upgradeInFlight = null
  }
  requestConnectOpen()
}
