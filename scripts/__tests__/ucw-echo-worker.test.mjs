import { describe, expect, it } from 'vitest'
import worker from '../../smoke/ucw-echo/index.js'

const ENDPOINT = 'https://ucw-smoke-echo.example.workers.dev/'

function post(body, init = {}) {
  return worker.fetch(
    new Request(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: typeof body === 'string' ? body : JSON.stringify(body),
      ...init,
    })
  )
}

describe('ucw smoke echo upstream', () => {
  it('returns the JSON contract api/x402.ts requires of a community upstream', async () => {
    const response = await post({ query: 'hello' })
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('application/json')
    expect(response.headers.get('cache-control')).toBe('no-store')
    const body = await response.json()
    expect(body).toMatchObject({ status: 'SUCCESS', result: 'ucw-smoke-ok', echo: { query: 'hello' } })
    expect(typeof body.status).toBe('string')
    expect(body.status).not.toBe('UNAVAILABLE')
  })

  it('answers GET so the host can be checked in a browser', async () => {
    const response = await worker.fetch(new Request(ENDPOINT))
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ status: 'SUCCESS', method: 'GET' })
  })

  it('rejects other methods instead of echoing them', async () => {
    const response = await worker.fetch(new Request(ENDPOINT, { method: 'PUT', body: 'x' }))
    expect(response.status).toBe(405)
    expect(await response.json()).toMatchObject({ status: 'ERROR' })
  })

  it('rejects a non-JSON body', async () => {
    const response = await post('not json')
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ status: 'ERROR' })
  })

  it('caps the echoed body', async () => {
    const response = await post({ padding: 'x'.repeat(64 * 1024) })
    expect(response.status).toBe(413)
    expect(await response.json()).toMatchObject({ status: 'ERROR' })
  })

  it('echoes only the body, never request headers', async () => {
    const response = await post({ query: 'x' }, { headers: { 'Content-Type': 'application/json', Authorization: 'Bearer secret-value' } })
    const text = await response.text()
    expect(text).not.toContain('secret-value')
    expect(text).not.toContain('authorization')
  })
})
