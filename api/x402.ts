// api/x402.ts
// Vite Dev Server SSR Endpoint for x402 AI Services & Nanopayment Facilitation
import { arcTestnet } from '../src/config/arcChain'
import { DEFAULT_DEMO_PAYER_ADDRESS } from '../src/config/servicesRegistry'

export async function GET(req: Request) {
  const url = new URL(req.url)
  const pathname = url.pathname

  if (pathname.includes('/api/x402/services')) {
    return new Response(JSON.stringify({
      success: true,
      protocol: 'x402-Gateway-V1',
      chainId: arcTestnet.id,
      gasToken: arcTestnet.nativeCurrency.symbol,
      settlementSpeed: '<500ms',
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  return new Response(JSON.stringify({ error: 'Endpoint not found' }), {
    status: 404,
    headers: { 'Content-Type': 'application/json' },
  })
}

export async function POST(req: Request) {
  try {
    const authHeader = req.headers.get('authorization')
    const url = new URL(req.url)

    // If no auth header, return standard HTTP 402 Payment Required
    if (!authHeader || !authHeader.includes('x402')) {
      return new Response(JSON.stringify({
        error: 'Payment Required',
        statusCode: 402,
        scheme: 'GatewayWalletBatched',
        token: 'USDC',
        recipient: DEFAULT_DEMO_PAYER_ADDRESS,
        minPriceUsdc: 0.005,
        network: `${arcTestnet.name} (${arcTestnet.id})`,
        gatewayAttestationRequired: false,
      }), {
        status: 402,
        headers: {
          'Content-Type': 'application/json',
          'X-Payment-Required': 'true',
          'X-Payment-Token': 'USDC',
          'X-Payment-Amount': '0.005',
          'X-Payment-Recipient': DEFAULT_DEMO_PAYER_ADDRESS,
          'X-Payment-Scheme': 'GatewayWalletBatched',
        },
      })
    }

    const body = await req.json()
    return new Response(JSON.stringify({
      success: true,
      statusCode: 200,
      verifiedPayer: DEFAULT_DEMO_PAYER_ADDRESS,
      amountSettledUsdc: 0.005,
      timestamp: Date.now(),
      payload: body,
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (err: any) {
    return new Response(JSON.stringify({ success: false, error: err.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
}
