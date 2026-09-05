import { apiSuccess, apiError, safeJsonParse } from './utils/apiResponse'

function getApiKey(): string {
  const globalEnv = (typeof globalThis !== 'undefined' && (globalThis as any).process?.env) || {}
  const circleApiKey = globalEnv.CIRCLE_API_KEY || process.env.CIRCLE_API_KEY || globalEnv.VITE_CIRCLE_API_KEY || process.env.VITE_CIRCLE_API_KEY || ''
  return circleApiKey.trim()
}

export async function POST(req: Request) {
  const jsonResult = await safeJsonParse(req)
  if (!jsonResult.success) {
    return apiError(
      jsonResult.error || 'Invalid or malformed JSON payload in request body.',
      'INVALID_JSON',
      400
    )
  }

  const body = jsonResult.data || {}
  const {
    address,
    blockchain = 'ARC-TESTNET',
    usdc = true,
    eurc = false,
    native = true,
  } = body

  if (!address) {
    return apiError('Wallet address is required.', 'MISSING_ADDRESS', 400)
  }

  // Validate EVM / Solana address format basic check
  const isSolana = blockchain.includes('SOL')
  if (!isSolana && !address.startsWith('0x')) {
    return apiError('Invalid EVM address (must start with 0x).', 'INVALID_EVM_ADDRESS', 400)
  }

  const apiKey = getApiKey()
  if (!apiKey) {
    return apiError('CIRCLE_API_KEY is not configured on the server.', 'MISSING_API_KEY', 500)
  }

  try {
    // Call Circle's Official Faucet Drips API
    const circleResponse = await fetch('https://api.circle.com/v1/faucet/drips', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        address,
        blockchain,
        native: Boolean(native),
        usdc: Boolean(usdc),
        eurc: Boolean(eurc),
      }),
    })

    const data = await circleResponse.json().catch(() => ({}))

    if (!circleResponse.ok) {
      let errorMessage =
        data?.message ||
        data?.error ||
        `Circle Faucet request failed (HTTP ${circleResponse.status})`

      let errorCode = 'CIRCLE_FAUCET_ERROR'

      if (circleResponse.status === 403 || data?.code === 3 || errorMessage.toLowerCase().includes('forbidden')) {
        errorCode = 'FAUCET_ACCESS_RESTRICTED'
        errorMessage =
          'Circle Faucet API access requires developer account upgrade or daily limit reached. Please use the "Official Circle Faucet" button below to request tokens directly from the web faucet.'
      } else if (circleResponse.status === 429 || errorMessage.toLowerCase().includes('rate limit')) {
        errorCode = 'FAUCET_RATE_LIMITED'
        errorMessage =
          '24-hour Faucet request limit has been exceeded. Please try again later or visit the official Circle Faucet page.'
      }

      return apiError(errorMessage, errorCode, circleResponse.status, data)
    }

    return apiSuccess({
      message: 'Testnet tokens sent successfully!',
      data,
    })
  } catch (error: any) {
    console.error('Circle Faucet API Error:', error)
    return apiError(
      error?.message || 'Server error occurred in Circle Faucet proxy.',
      'FAUCET_INTERNAL_ERROR',
      500
    )
  }
}
