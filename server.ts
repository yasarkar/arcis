// server.ts
// Arcis Protocol Standalone Production Express Server
// Serves static SPA build from dist/ and handles all /api/* backend services

import express, { type Request as ExpRequest, type Response as ExpResponse, type NextFunction } from 'express'
import cors from 'cors'
import dotenv from 'dotenv'
import path from 'path'
import { fileURLToPath } from 'url'
import fs from 'fs'

// Load environment variables from .env
dotenv.config()

// Handlers
import * as healthHandler from './api/health'
import * as ucwHandler from './api/ucw'
import * as relayerHandler from './api/relayer'
import * as swapHandler from './api/swap'
import * as faucetHandler from './api/faucet'
import * as cacheHandler from './api/cache'
import * as copilotHandler from './api/copilot'
import * as x402Handler from './api/x402'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const app = express()
const PORT = process.env.PORT || 3000

// ─────────────────────────────────────────────────────────────
// 1. GLOBAL MIDDLEWARE
// ─────────────────────────────────────────────────────────────
app.use(cors({
  origin: process.env.CORS_ORIGIN || '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'X-Payer-Address'],
  credentials: true,
}))

app.use(express.json({ limit: '5mb' }))
app.use(express.urlencoded({ extended: true, limit: '5mb' }))

// Security Headers Middleware
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('X-Frame-Options', 'DENY')
  res.setHeader('X-XSS-Protection', '1; mode=block')
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin')
  next()
})

// ─────────────────────────────────────────────────────────────
// 2. WEB REQUEST ADAPTER HELPER
// ─────────────────────────────────────────────────────────────
function adapt(handler: (req: Request) => Promise<Response>) {
  return async (req: ExpRequest, res: ExpResponse, next: NextFunction) => {
    try {
      const fullUrl = `${req.protocol}://${req.get('host')}${req.originalUrl}`
      const headers: Record<string, string> = {}
      for (const [key, value] of Object.entries(req.headers)) {
        if (typeof value === 'string') headers[key] = value
        else if (Array.isArray(value)) headers[key] = value.join(', ')
      }

      const body = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) && req.body && Object.keys(req.body).length > 0
        ? JSON.stringify(req.body)
        : undefined

      const webReq = new Request(fullUrl, {
        method: req.method,
        headers,
        body,
      })

      const response = await handler(webReq)
      res.status(response.status)
      response.headers.forEach((val, key) => {
        res.setHeader(key, val)
      })
      const text = await response.text()
      res.send(text)
    } catch (err) {
      next(err)
    }
  }
}

// ─────────────────────────────────────────────────────────────
// 3. API ROUTE DEFINITIONS
// ─────────────────────────────────────────────────────────────
// System Health
app.get('/api/health', adapt(healthHandler.GET))

// Circle User-Controlled Wallets (UCW)
app.post('/api/ucw', adapt(ucwHandler.POST))
app.options('/api/ucw', adapt(ucwHandler.OPTIONS))

// Gasless Relayer Service (Arc Testnet)
app.get('/api/relayer', adapt(relayerHandler.GET))
app.post('/api/relayer', adapt(relayerHandler.POST))

// DEX Swap Execution
app.post('/api/swap', adapt(swapHandler.POST))

// Circle Faucet Proxy
app.post('/api/faucet', adapt(faucetHandler.POST))

// Redis Cache Layer
app.get('/api/cache', adapt(cacheHandler.GET))
app.post('/api/cache', adapt(cacheHandler.POST))
app.delete('/api/cache', adapt(cacheHandler.DELETE))

// AI Copilot Orchestrator (GPT-4o-mini)
app.post('/api/copilot', adapt(copilotHandler.POST))

// x402 Marketplace & Services (Matches /api/x402 and /api/x402/*)
app.use('/api/x402', (req, res, next) => {
  if (req.method === 'GET') return adapt(x402Handler.GET)(req, res, next)
  if (req.method === 'POST') return adapt(x402Handler.POST)(req, res, next)
  next()
})

// ─────────────────────────────────────────────────────────────
// 4. STATIC FRONTEND SPA SERVING
// ─────────────────────────────────────────────────────────────
const distPath = path.resolve(__dirname, 'dist')

if (fs.existsSync(distPath)) {
  app.use(express.static(distPath, { maxAge: '1h', index: false }))

  // SPA fallback for HTML5 History API (Handles all remaining non-static requests)
  app.use((req, res, next) => {
    if (req.method === 'GET' && !req.url.startsWith('/api/')) {
      return res.sendFile(path.join(distPath, 'index.html'))
    }
    if (req.url.startsWith('/api/')) {
      return res.status(404).json({ success: false, error: `API endpoint '${req.url}' not found.` })
    }
    next()
  })
} else {
  console.warn('[Server] ⚠️ dist/ directory not found. Run "npm run build" to build frontend assets.')
  app.get('/', (_req, res) => {
    res.status(200).send(`
      <div style="font-family: system-ui, sans-serif; padding: 40px; text-align: center;">
        <h2>⚡ Arcis Protocol API Server Running</h2>
        <p>Frontend bundle is not built yet. Run <code>npm run build</code> to generate the SPA distribution.</p>
        <p><a href="/api/health">Check /api/health</a></p>
      </div>
    `)
  })
}

// ─────────────────────────────────────────────────────────────
// 5. GLOBAL ERROR HANDLER
// ─────────────────────────────────────────────────────────────
app.use((err: any, _req: ExpRequest, res: ExpResponse, _next: NextFunction) => {
  console.error('[Server Error]:', err)
  res.status(500).json({
    success: false,
    error: err?.message || 'Internal Server Error',
  })
})

// ─────────────────────────────────────────────────────────────
// 6. SERVER STARTUP
// ─────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`
  ╔════════════════════════════════════════════════════════════════╗
  ║                 ⚡ Arcis Production Server ⚡                  ║
  ╠════════════════════════════════════════════════════════════════╣
  ║  • Server URL:      http://localhost:${PORT}                    ║
  ║  • Healthcheck:     http://localhost:${PORT}/api/health         ║
  ║  • Environment:     ${(process.env.NODE_ENV || 'production').padEnd(35)}║
  ║  • Static Assets:   ${(fs.existsSync(distPath) ? 'dist/ (Loaded)' : 'dist/ (Missing - Run build)').padEnd(35)}║
  ╚════════════════════════════════════════════════════════════════╝
  `)
})
