function getApiKey(): string {
  const circleApiKey = process.env.CIRCLE_API_KEY || process.env.VITE_CIRCLE_API_KEY || ''
  return circleApiKey.trim()
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}))
    const {
      address,
      blockchain = 'ARC-TESTNET',
      usdc = true,
      eurc = false,
      native = true,
    } = body

    if (!address) {
      return Response.json(
        { success: false, error: 'Wallet address is required.' },
        { status: 400 }
      )
    }

    // Validate EVM / Solana address format basic check
    const isSolana = blockchain.includes('SOL')
    if (!isSolana && !address.startsWith('0x')) {
      return Response.json(
        { success: false, error: 'Invalid EVM address (must start with 0x).' },
        { status: 400 }
      )
    }

    const apiKey = getApiKey()
    if (!apiKey) {
      return Response.json(
        {
          success: false,
          error: 'CIRCLE_API_KEY is not configured.',
        },
        { status: 500 }
      )
    }

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

      if (circleResponse.status === 403 || data?.code === 3 || errorMessage.toLowerCase().includes('forbidden')) {
        errorMessage =
          'Circle Faucet API access requires developer account upgrade or daily limit reached. Please use the "Official Circle Faucet" button below to request tokens directly from the web faucet.'
      } else if (circleResponse.status === 429 || errorMessage.toLowerCase().includes('rate limit')) {
        errorMessage =
          '24-hour Faucet request limit has been exceeded. Please try again later or visit the official Circle Faucet page.'
      }

      return Response.json(
        {
          success: false,
          error: errorMessage,
          details: data,
        },
        { status: circleResponse.status }
      )
    }

    return Response.json({
      success: true,
      message: 'Testnet tokens sent successfully!',
      data,
    })
  } catch (error: any) {
    console.error('Circle Faucet API Error:', error)
    return Response.json(
      {
        success: false,
        error: error.message || 'Server error occurred.',
      },
      { status: 500 }
    )
  }
}
