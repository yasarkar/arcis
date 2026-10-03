import { apiSuccess, apiError, safeJsonParse } from './_utils/apiResponse'
import { extractTrustedClientIp } from './_utils/trustedIp'
import { checkRateLimit } from './_utils/rateLimiter'

function getApiKey(): string {
  const globalEnv = (typeof globalThis !== 'undefined' && (globalThis as any).process?.env) || {}
  const circleApiKey = globalEnv.CIRCLE_API_KEY || process.env.CIRCLE_API_KEY || ''
  return circleApiKey.trim()
}

export const ALLOWED_FAUCET_TESTNETS = new Set([
  'ARC-TESTNET',
  'BASE-SEPOLIA',
  'ETH-SEPOLIA',
  'ARB-SEPOLIA',
  'OP-SEPOLIA',
  'MATIC-AMOY',
  'POLY-AMOY',
  'AVAX-FUJI',
  'UNI-SEPOLIA',
  'SOL-DEVNET',
])

const EVM_ADDRESS_REGEX = /^0x[0-9a-fA-F]{40}$/
const SOLANA_ADDRESS_REGEX = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/

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

  // 1. Primitive type checks
  if (typeof address !== 'string' || !address.trim()) {
    return apiError('Wallet address is required and must be a non-empty string.', 'INVALID_INPUT', 400)
  }
  if (typeof blockchain !== 'string' || !blockchain.trim()) {
    return apiError('Blockchain network must be a non-empty string.', 'INVALID_INPUT', 400)
  }

  if (typeof usdc !== 'boolean' && typeof usdc !== 'undefined') {
    return apiError('usdc flag must be a boolean.', 'INVALID_INPUT', 400)
  }
  if (typeof eurc !== 'boolean' && typeof eurc !== 'undefined') {
    return apiError('eurc flag must be a boolean.', 'INVALID_INPUT', 400)
  }
  if (typeof native !== 'boolean' && typeof native !== 'undefined') {
    return apiError('native flag must be a boolean.', 'INVALID_INPUT', 400)
  }

  const cleanAddress = address.trim()
  const cleanBlockchain = blockchain.trim().toUpperCase()

  // 2. Testnet allowlist
  if (!ALLOWED_FAUCET_TESTNETS.has(cleanBlockchain)) {
    return apiError(
      `Unsupported testnet blockchain: "${blockchain}". Supported networks: ${Array.from(ALLOWED_FAUCET_TESTNETS).join(', ')}`,
      'UNSUPPORTED_BLOCKCHAIN',
      400
    )
  }

  // 3. Address format validation
  const isSolana = cleanBlockchain.includes('SOL')
  if (isSolana) {
    if (!SOLANA_ADDRESS_REGEX.test(cleanAddress)) {
      return apiError('Invalid Solana wallet address format.', 'INVALID_SOLANA_ADDRESS', 400)
    }
  } else {
    if (!EVM_ADDRESS_REGEX.test(cleanAddress)) {
      return apiError(
        'Invalid EVM wallet address format (must start with 0x followed by 40 hexadecimal characters).',
        'INVALID_EVM_ADDRESS',
        400
      )
    }
  }

  // 4. Token flags validation
  const reqUsdc = Boolean(usdc)
  const reqEurc = Boolean(eurc)
  const reqNative = Boolean(native)
  if (!reqUsdc && !reqEurc && !reqNative) {
    return apiError(
      'At least one token type (usdc, eurc, or native) must be requested.',
      'NO_TOKENS_REQUESTED',
      400
    )
  }

  // 5. Local sliding-window rate limit checks (by IP and by target address)
  const clientIp = extractTrustedClientIp(req)
  const ipLimit = await checkRateLimit(`faucet:ip:${clientIp}`, 5, 60_000)
  if (!ipLimit.allowed) {
    return apiError(
      `Rate limit exceeded for your IP address. Please retry after ${ipLimit.retryAfterSeconds} seconds.`,
      'FAUCET_RATE_LIMITED',
      429,
      { retryAfterSeconds: ipLimit.retryAfterSeconds }
    )
  }

  const addrKey = cleanAddress.toLowerCase()
  const addrLimit = await checkRateLimit(`faucet:addr:${addrKey}`, 3, 60_000)
  if (!addrLimit.allowed) {
    return apiError(
      `Rate limit exceeded for this wallet address. Please retry after ${addrLimit.retryAfterSeconds} seconds.`,
      'FAUCET_RATE_LIMITED',
      429,
      { retryAfterSeconds: addrLimit.retryAfterSeconds }
    )
  }

  // 6. Upstream API key check
  const apiKey = getApiKey()
  if (!apiKey) {
    return apiError('CIRCLE_API_KEY is not configured on the server.', 'MISSING_API_KEY', 500)
  }

  // 7. Call Circle's Official Faucet Drips API with 8s timeout budget
  try {
    const circleResponse = await fetch('https://api.circle.com/v1/faucet/drips', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        address: cleanAddress,
        blockchain: cleanBlockchain,
        native: reqNative,
        usdc: reqUsdc,
        eurc: reqEurc,
      }),
      signal: AbortSignal.timeout(8000),
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
    if (error?.name === 'TimeoutError' || error?.name === 'AbortError') {
      return apiError(
        'Upstream Circle Faucet API request timed out (8s limit exceeded). Please try again later.',
        'FAUCET_TIMEOUT',
        504
      )
    }

    console.error('Circle Faucet API Error:', error)
    return apiError(
      error?.message || 'Server error occurred in Circle Faucet proxy.',
      'FAUCET_INTERNAL_ERROR',
      500
    )
  }
}
