import { defineConfig, loadEnv, Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { nodePolyfills } from 'vite-plugin-node-polyfills'
import path from 'path'

function apiPlugin(): Plugin {
  return {
    name: 'api-server-plugin',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (req.url && req.url.startsWith('/api/')) {
          try {
            const currentEnv = loadEnv(server.config.mode || 'development', process.cwd(), '')
            Object.assign(process.env, currentEnv)
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
            }

            if (handler) {
              const bodyStr = await bodyPromise
              const fullUrl = `http://${host}${req.url}`
              const webReq = new Request(fullUrl, {
                method: req.method,
                headers: req.headers as Record<string, string>,
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
            res.end(JSON.stringify({ success: false, error: err.message || 'Internal server error' }))
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

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  Object.assign(process.env, env)

  return {
    plugins: [react(), tailwindcss(), nodePolyfills(), apiPlugin(), shimMissingConnectorsPlugin()],
    resolve: {
      alias: {
        'wagmi/connectors': path.resolve(__dirname, 'src/config/wagmiConnectorsShim.ts'),
      },
    },
    server: {
      port: 3000,
      open: true,
    },
  }
})

