import { describe, expect, it } from 'vitest'
import { GET, POST } from '../relayer'

describe('gasless relayer safe-off boundary', () => {
  it('does not advertise an eligible sponsored quota while the endpoint is disabled', async () => {
    const response = await GET(new Request('http://localhost/api/relayer?address=0x1111111111111111111111111111111111111111'))
    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toMatchObject({
      success: false,
      code: 'RELAYER_DISABLED',
    })
  })

  it('rejects EIP-3009 submissions before parsing or broadcasting them', async () => {
    const response = await POST(new Request('http://localhost/api/relayer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: '0x1111111111111111111111111111111111111111', to: '0x2222222222222222222222222222222222222222', value: '1000000' }),
    }))
    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toMatchObject({
      success: false,
      code: 'RELAYER_DISABLED',
    })
  })
})
