import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { GET, POST, DELETE } from '../history'

describe('/api/history endpoint', () => {
  const testWallet = '0x1111111111111111111111111111111111111111'
  const otherWallet = '0x2222222222222222222222222222222222222222'

  it('GET returns empty list when no address is specified', async () => {
    const req = new Request('http://localhost/api/history', { method: 'GET' })
    const res = await GET(req)
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.success).toBe(true)
    expect(json.transactions).toEqual([])
  })

  it('POST rejects payloads missing userAddress and recipient', async () => {
    const req = new Request('http://localhost/api/history', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'send',
        amount: '10',
        tokenSymbol: 'USDC',
      }),
    })
    const res = await POST(req)
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.code).toBe('WALLET_REQUIRED')
  })

  it('POST rejects invalid userAddress format', async () => {
    const req = new Request('http://localhost/api/history', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'send',
        userAddress: '0xinvalid',
      }),
    })
    const res = await POST(req)
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.code).toBe('INVALID_ADDRESS')
  })

  it('POST saves and GET retrieves a pool liquidity transaction with complete metadata', async () => {
    const poolTx = {
      type: 'add_liquidity',
      txHash: '0xabc1237890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
      amount: '100',
      tokenSymbol: 'USDC',
      sourceChain: 'Arc_Testnet',
      userAddress: testWallet,
      poolId: 'usdc-eurc-pool',
      poolName: 'USDC / EURC Pool',
      lpMinted: '98.5',
      poolShare: 1.25,
      amountB: '95',
      tokenB: 'EURC',
      status: 'success',
    }

    const postReq = new Request('http://localhost/api/history', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(poolTx),
    })
    const postRes = await POST(postReq)
    expect(postRes.status).toBe(200)
    const postJson = await postRes.json()
    expect(postJson.success).toBe(true)
    expect(postJson.transaction.poolName).toBe('USDC / EURC Pool')
    expect(postJson.transaction.poolId).toBe('usdc-eurc-pool')
    expect(postJson.transaction.lpMinted).toBe('98.5')
    expect(postJson.transaction.amountB).toBe('95')
    expect(postJson.transaction.tokenB).toBe('EURC')

    // GET by connected wallet address
    const getReq = new Request(`http://localhost/api/history?address=${testWallet}`, { method: 'GET' })
    const getRes = await GET(getReq)
    expect(getRes.status).toBe(200)
    const getJson = await getRes.json()
    expect(getJson.success).toBe(true)
    expect(getJson.transactions.length).toBeGreaterThanOrEqual(1)

    const savedTx = getJson.transactions.find(
      (t: any) => t.txHash === poolTx.txHash
    )
    expect(savedTx).toBeDefined()
    expect(savedTx.userAddress).toBe(testWallet)
    expect(savedTx.poolName).toBe('USDC / EURC Pool')
    expect(savedTx.lpMinted).toBe('98.5')
    expect(savedTx.amountB).toBe('95')
    expect(savedTx.tokenB).toBe('EURC')
  })

  it('GET ensures strict wallet isolation for an unrelated wallet', async () => {
    const getReq = new Request(`http://localhost/api/history?address=${otherWallet}`, { method: 'GET' })
    const getRes = await GET(getReq)
    expect(getRes.status).toBe(200)
    const getJson = await getRes.json()
    expect(getJson.success).toBe(true)
    // The pool transaction saved for testWallet must NOT show up for otherWallet
    const crossTx = getJson.transactions.find(
      (t: any) => t.txHash === '0xabc1237890abcdef1234567890abcdef1234567890abcdef1234567890abcdef'
    )
    expect(crossTx).toBeUndefined()
  })

  it('DELETE remains disabled (403 FORBIDDEN) to protect transaction immutability', async () => {
    const req = new Request('http://localhost/api/history?address=' + testWallet, { method: 'DELETE' })
    const res = await DELETE(req)
    expect(res.status).toBe(403)
  })
})
