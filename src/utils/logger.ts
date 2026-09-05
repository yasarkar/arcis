// src/utils/logger.ts
// Arcis Protocol Centralized Structured Logger
// Provides scoped logging, timestamps, and environment-aware output formatting.

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

      if (details !== undefined) {
        console[level](`%c${prefix} ${message}`, styles[level], details)
      } else {
        console[level](`%c${prefix} ${message}`, styles[level])
      }
    } else {
      // Production structured JSON or concise format
      if (level === 'error' || level === 'warn') {
        console[level](JSON.stringify(entry))
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

export const logger = new ArcisLogger()
