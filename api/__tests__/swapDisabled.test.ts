import { describe, expect, it } from 'vitest'
import { GET, POST } from '../swap'

describe('server-controlled swap safe-off boundary (SEC-03)', () => {
  it('never advertises an executable swap route while authorization is undefined', async () => {
    const response = await GET(new Request('http://localhost/api/swap'))
    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toMatchObject({
      success: false,
      code: 'SWAP_AUTHORIZATION_REQUIRED',
    })
  })

  it('refuses a swap request before parsing or executing anything', async () => {
    const response = await POST(
      new Request('http://localhost/api/swap', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          walletId: 'dev-controlled-wallet',
          tokenIn: 'USDC',
          tokenOut: 'EURC',
          amountIn: '1000000',
        }),
      })
    )
    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toMatchObject({
      success: false,
      code: 'SWAP_AUTHORIZATION_REQUIRED',
    })
  })
})
