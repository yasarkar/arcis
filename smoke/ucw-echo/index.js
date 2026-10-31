// smoke/ucw-echo/index.js
// Minimal public upstream for docs/ucw-x402-smoke-test-plan.md (TC-2 / TC-3).
//
// A community x402 service is proxied to this URL, and api/x402.ts refuses the result unless the
// response is a JSON object carrying a `status` string other than "UNAVAILABLE"
// (`isX402ServiceResultAvailable`). Ready-made echo services (httpbin, postman-echo) do not return
// that field, so a paid call against them is accepted and then voided with no ledger credit.
//
// It echoes only the request body (capped), never headers or environment, so it is safe to expose.

const MAX_BODY_BYTES = 64 * 1024

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
  })
}

export default {
  async fetch(request) {
    if (request.method === 'GET') {
      return json({ status: 'SUCCESS', result: 'ucw-smoke-ok', service: 'arcis-ucw-smoke-echo', method: 'GET' })
    }
    if (request.method !== 'POST') {
      return json({ status: 'ERROR', error: 'Use GET or POST.' }, 405)
    }

    const text = await request.text()
    if (text.length > MAX_BODY_BYTES) {
      return json({ status: 'ERROR', error: 'Request body is too large for the smoke echo.' }, 413)
    }

    let payload
    try {
      payload = text ? JSON.parse(text) : {}
    } catch {
      return json({ status: 'ERROR', error: 'Request body must be JSON.' }, 400)
    }

    return json({
      status: 'SUCCESS',
      result: 'ucw-smoke-ok',
      service: 'arcis-ucw-smoke-echo',
      method: 'POST',
      echo: payload,
    })
  },
}
