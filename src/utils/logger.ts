// src/utils/logger.ts
// Arcis Protocol Centralized Structured Logger
// Provides scoped logging, timestamps, and environment-aware output formatting.
//
// ALSO installs safe global console.warn / console.info polyfills when missing.
// The polyfill guarantees that the existing 89+ `console.warn(...)` call sites
// across the app never throw 'not a function' in Node, browsers, sandboxes, or
// test runners. Load this module as a side-effect early (see src/main.tsx).

// ── Safe console polyfill (runs on import, wrapped to never throw) ──────────
try {
  if (typeof console !== 'undefined') {
    if (typeof console.warn !== 'function') {
      const fallback = typeof console.error === 'function'
        ? console.error.bind(console)
        : (typeof console.log === 'function' ? console.log.bind(console) : () => {})
      Object.defineProperty(console, 'warn', { value: fallback, writable: true })
    }
    if (typeof console.info !== 'function') {
      const infoFallback = typeof console.log === 'function' ? console.log.bind(console) : () => {}
      Object.defineProperty(console, 'info', { value: infoFallback, writable: true })
    }
  }
} catch {
  // Silent fallback if console object is non-configurable / frozen in strict sandboxes
}

// ── Structured logger ────────────────────────────────────────────────────────
export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

interface LogEntry {
  level: LogLevel
  scope?: string
  message: string
  details?: any
  timestamp: string
}

class ArcisLogger {
  private isDev =
    (typeof process !== 'undefined' && process.env?.NODE_ENV !== 'production') ||
    (typeof import.meta !== 'undefined' && (import.meta as any).env?.DEV)

  private formatTimestamp(): string {
    return new Date().toISOString()
  }

  private write(level: LogLevel, scope: string | undefined, message: string, details?: any) {
    if (!this.isDev && level === 'debug') {
      return // Silence debug in production
    }

    const entry: LogEntry = {
      level,
      scope,
      message,
      details,
      timestamp: this.formatTimestamp(),
    }

    const prefix = scope ? `[Arcis:${scope}]` : `[Arcis]`

    if (this.isDev) {
      const styles = {
        debug: 'color: #94a3b8;',
        info: 'color: #38bdf8; font-weight: bold;',
        warn: 'color: #f59e0b; font-weight: bold;',
        error: 'color: #ef4444; font-weight: bold;',
      }
      const method = typeof console[level] === 'function' ? console[level] : console.log
      if (details !== undefined) {
        method(`%c${prefix} ${message}`, styles[level], details)
      } else {
        method(`%c${prefix} ${message}`, styles[level])
      }
    } else {
      // Production structured JSON or concise format
      if (level === 'error' || level === 'warn') {
        const json = JSON.stringify(entry)
        if (typeof console[level] === 'function') {
          console[level](json)
        } else if (typeof console.warn === 'function') {
          console.warn(json)
        } else {
          console.log(json)
        }
      }
    }
  }

  debug(message: string, details?: any) {
    this.write('debug', undefined, message, details)
  }

  info(message: string, details?: any) {
    this.write('info', undefined, message, details)
  }

  warn(message: string, details?: any) {
    this.write('warn', undefined, message, details)
  }

  error(message: string, details?: any) {
    this.write('error', undefined, message, details)
  }

  createScope(scope: string) {
    return {
      debug: (msg: string, details?: any) => this.write('debug', scope, msg, details),
      info: (msg: string, details?: any) => this.write('info', scope, msg, details),
      warn: (msg: string, details?: any) => this.write('warn', scope, msg, details),
      error: (msg: string, details?: any) => this.write('error', scope, msg, details),
    }
  }
}

// Named export for explicit method usage + default singleton.
export const logger = new ArcisLogger()
export default logger
