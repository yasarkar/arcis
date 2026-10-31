# UCW smoke-test echo upstream

`index.js` is a 30-line Worker used by `docs/ucw-x402-smoke-test-plan.md` as the community service's upstream (TC-2 registers a listing pointing at it, TC-3 needs it to return a settled result).

Why it exists: `api/x402.ts` proxies community services and then requires the upstream response to be a JSON **object** with a `status` **string** other than `"UNAVAILABLE"`. Public echo services such as `httpbin.org` or `postman-echo.com` do not return `status`, so a payment against them is accepted and then voided — no provider earnings appear, and TC-3 cannot run.

Contract:

```bash
curl -sS -X POST https://<host>/ -H 'content-type: application/json' -d '{"query":"hello"}'
# {"status":"SUCCESS","result":"ucw-smoke-ok","service":"arcis-ucw-smoke-echo","method":"POST","echo":{"query":"hello"}}
```

It echoes only the parsed body (64 KiB cap) and never headers or environment values.

Current deployment (Freebuff Sites, preview environment): `https://site-7639e6df17d44e5e8798cdb475b52e7f.freebuff.page/`, allowlisted in `.env` as `site-7639e6df17d44e5e8798cdb475b52e7f.freebuff.page`.

## Deploy

Any public HTTPS host works. The server additionally requires the host to be listed in `X402_UPSTREAM_HOST_ALLOWLIST` and to resolve to public IP addresses.

Cloudflare Workers (your own account):

```bash
cd smoke/ucw-echo
npx wrangler deploy            # or: npx wrangler dev for a local check (not usable as an upstream)
```

Then set, in the app's `.env`, the host without a scheme or path:

```bash
X402_UPSTREAM_HOST_ALLOWLIST=arcis-ucw-smoke-echo.<your-subdomain>.workers.dev
```

## Verify

```bash
npm run preflight:ucw-smoke -- --live \
  --endpoint=https://arcis-ucw-smoke-echo.<your-subdomain>.workers.dev/
```

`[PASS] Echo endpoint contract` (or `[PASS] Echo endpoint` before the network probe) means both the URL rules and the `status` contract hold.
