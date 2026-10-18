import { defineConfig, loadEnv, Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { nodePolyfills } from 'vite-plugin-node-polyfills'
import { visualizer } from 'rollup-plugin-visualizer'
import path from 'path'
import { signInternalClientIpHeaders } from './api/_utils/trustedIp'

function apiPlugin(): Plugin {
  return {
    name: 'api-server-plugin',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (req.url && req.url.startsWith('/api/')) {
          try {
            const currentEnv = loadEnv(server.config.mode || 'development', process.cwd(), '')
            Object.assign(process.env, currentEnv)
            if (typeof globalThis !== 'undefined' && (globalThis as any).process?.env) {
              Object.assign((globalThis as any).process.env, currentEnv)
            }
            if (!process.env.CIRCLE_API_KEY && currentEnv.CIRCLE_API_KEY) {
              process.env.CIRCLE_API_KEY = currentEnv.CIRCLE_API_KEY
            }
            const host = req.headers.host || 'localhost:3000'
            const urlObj = new URL(req.url, `http://${host}`)
            const pathname = urlObj.pathname

            // Start capturing stream body immediately before any async microtasks/imports
            let bodyPromise: Promise<string> = Promise.resolve('')
            if (['POST', 'PUT', 'PATCH'].includes(req.method || '')) {
              bodyPromise = new Promise<string>((resolve) => {
                let bodyStr = ''
                req.on('data', (chunk) => {
                  bodyStr += chunk
                })
                req.on('end', () => resolve(bodyStr))
                req.on('error', () => resolve(''))
              })
            }

            let handler: any = null
            if (pathname === '/api/health') {
              const mod = await server.ssrLoadModule('/api/health.ts')
              if (req.method === 'GET') handler = mod.GET
            } else if (pathname === '/api/ucw') {
              const mod = await server.ssrLoadModule('/api/ucw.ts')
              handler = mod.POST
            } else if (pathname === '/api/swap') {
              const mod = await server.ssrLoadModule('/api/swap.ts')
              handler = mod.POST
            } else if (pathname === '/api/faucet') {
              const mod = await server.ssrLoadModule('/api/faucet.ts')
              handler = mod.POST
            } else if (pathname === '/api/cache') {
              const mod = await server.ssrLoadModule('/api/cache.ts')
              if (req.method === 'GET') handler = mod.GET
              else if (req.method === 'POST') handler = mod.POST
              else if (req.method === 'DELETE') handler = mod.DELETE
            } else if (pathname === '/api/relayer') {
              const mod = await server.ssrLoadModule('/api/relayer.ts')
              if (req.method === 'GET') handler = mod.GET
              else if (req.method === 'POST') handler = mod.POST
            } else if (pathname === '/api/copilot') {
              const mod = await server.ssrLoadModule('/api/copilot.ts')
              if (req.method === 'POST') handler = mod.POST
            } else if (pathname.startsWith('/api/x402')) {
              const mod = await server.ssrLoadModule('/api/x402.ts')
              if (req.method === 'GET') handler = mod.GET
              else if (req.method === 'POST') handler = mod.POST
            } else if (pathname === '/api/history') {
              const mod = await server.ssrLoadModule('/api/history.ts')
              if (req.method === 'GET') handler = mod.GET
              else if (req.method === 'POST') handler = mod.POST
              else if (req.method === 'DELETE') handler = mod.DELETE
            }

            if (handler) {
              const bodyStr = await bodyPromise
              const fullUrl = `http://${host}${req.url}`
              const reqHeaders: Record<string, string> = {}
              for (const [key, value] of Object.entries(req.headers)) {
                if (typeof value === 'string') reqHeaders[key.toLowerCase()] = value
                else if (Array.isArray(value)) reqHeaders[key.toLowerCase()] = value.join(', ')
              }
              // `encrypted` only exists on a TLS socket, so it is narrowed rather than assumed.
              const socket = req.socket as (typeof req.socket & { encrypted?: boolean }) | undefined
              signInternalClientIpHeaders(
                reqHeaders,
                socket?.remoteAddress || '127.0.0.1',
                socket?.encrypted ? 'https' : 'http'
              )

              const webReq = new Request(fullUrl, {
                method: req.method,
                headers: reqHeaders,
                body: ['POST', 'PUT', 'PATCH'].includes(req.method || '') && bodyStr ? bodyStr : undefined,
              })

              const response = await handler(webReq)
              const resBody = await response.text()

              res.statusCode = response.status
              response.headers.forEach((val: string, key: string) => {
                res.setHeader(key, val)
              })
              res.end(resBody)
              return
            }
          } catch (err: any) {
            console.error('Vite API Plugin Error:', err)
            res.statusCode = 500
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({
              success: false,
              error: err.message || 'Internal server error',
              code: 'INTERNAL_SERVER_ERROR',
              errorDetails: {
                code: 'INTERNAL_SERVER_ERROR',
                message: err.message || 'Internal server error',
                details: null,
              },
              timestamp: Date.now(),
            }))
            return
          }
        }
        next()
      })
    },
  }
}

function shimMissingConnectorsPlugin(): Plugin {
  return {
    name: 'shim-missing-connectors',
    transform(code, id) {
      if (id.includes('rainbowkit') && code.includes('import { gemini } from "wagmi/connectors"')) {
        return {
          code: code.replace(
            'import { gemini } from "wagmi/connectors";',
            'const gemini = () => ({ id: "gemini", name: "Gemini", type: "injected" });'
          ),
          map: null,
        }
      }
    },
  }
}

// P07: emits dist/bundle-stats.html (gitignored) for manual chunk audits.
// Only wired in when ANALYZE=1, so normal builds pay nothing for it.
function visualizerReportPlugin(): Plugin {
  return visualizer({
    filename: 'dist/bundle-stats.html',
    gzipSize: true,
    brotliSize: true,
  }) as unknown as Plugin
}

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  Object.assign(process.env, env)

  return {
    plugins: [
      react(),
      tailwindcss(),
      nodePolyfills({
        protocolImports: false,
        // P07: exclude server-only core modules so no browser chunk can pull
        // their shims in. If a dependency ever needs one of these, `vite build`
        // fails loudly ("externalized for browser compatibility") instead of
        // silently shipping a stub — the build is the guardrail.
        exclude: [
          'fs',
          'child_process',
          'cluster',
          'dgram',
          'dns',
          'net',
          'tls',
          'http',
          'https',
          'zlib',
          'readline',
          'repl',
          'vm',
          'module',
        ],
        // Audited browser need: `Buffer` is used by the x402 gateway
        // client + WalletConnect/Coinbase paths; `process.env` guards are
        // spread across config; `global` is needed by crypto-browserify/randombytes.
        globals: {
          Buffer: true,
          process: true,
          global: true,
        },
      }),
      apiPlugin(),
      shimMissingConnectorsPlugin(),
      // P07: bundle visualizer is dev-only and opt-in (`npm run build:analyze`);
      // it never runs in normal builds or CI.
      ...(process.env.ANALYZE === '1' ? [visualizerReportPlugin()] : []),
    ],
    resolve: {
      alias: {
        'wagmi/connectors': path.resolve(__dirname, 'src/config/wagmiConnectorsShim.ts'),
      },
      // P07: single React copy — duplicates break hooks and bloat the bundle.
      dedupe: ['react', 'react-dom'],
    },
    // P07: pre-bundle the always-eager vendor families so dev starts fast and
    // HMR doesn't re-resolve them per edit.
    optimizeDeps: {
      include: ['react', 'react-dom', '@tanstack/react-query'],
    },
    build: {
      // P07: modern target + esbuild minify; no sourcemaps in prod output.
      target: 'es2022',
      minify: 'esbuild',
      sourcemap: false,
      chunkSizeWarningLimit: 600,
      rollupOptions: {
        output: {
          // ARC-027: split only the vendor families that are eagerly needed by the shell and that
          // nothing lazy-only depends on, so the browser can cache them across app releases.
          //
          // Deliberately NOT listed: the Web3 stack (Circle SDKs, wagmi/RainbowKit, viem) and
          // `@web3icons`. Rollup reports mutually-importing groups as a circular chunk, and — the
          // reason this is not just a warning — a name in `manualChunks` forces *every* module it
          // matches into that chunk, so vendor code the app only reaches through `import()` gets
          // hoisted into the preloaded entry. Measured: grouping them produced one 8.65 MB
          // `web3-vendor` plus a 12.8 MB icon chunk on the critical path, worse than the monolith.
          // Those SDKs therefore stay with their lazy importers and become on-demand chunks.
          manualChunks(id: string) {
            if (!id.includes('node_modules')) return undefined
            const modulePath = id.replace(/\\/g, '/')

            if (/node_modules\/(react|react-dom|scheduler)\//.test(modulePath)) return 'react-vendor'
            if (modulePath.includes('/lucide-react/')) return 'icons'
            if (modulePath.includes('/@tanstack/')) return 'query-vendor'
            return undefined
          },
        },
      },
    },
    server: {
      port: 3000,
      open: true,
      // P07: don't let file churn outside the app trigger dev restarts/HMR.
      watch: {
        ignored: ['**/contracts/**', '**/dist/**', '**/docs/**'],
      },
    },
  }
})

