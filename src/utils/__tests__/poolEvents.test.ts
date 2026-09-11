import { describe, it, expect } from 'vitest'
import { decodeEventLog, encodeEventTopics, encodeAbiParameters, parseUnits, formatUnits } from 'viem'
import { STABLE_SWAP_ABI, CONSTANT_PRODUCT_ABI } from '../../config/poolsConfig'

describe('Pool Event Decoding (K1 & K2)', () => {
  const dummyUser = '0x1234567890123456789012345678901234567890'
  const dummyProvider = '0x1234567890123456789012345678901234567890'
  const dummyUsdc = '0x3600000000000000000000000000000000000000'
  const dummyEurc = '0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a'
  const dummyCirBtc = '0xf0C4a4CE82A5746AbAAd9425360Ab04fbBA432BF'

  describe('Swapped Event Decoding (K2)', () => {
    it('decodes Swapped event for 6-decimal tokens (USDC -> EURC)', () => {
      const amountIn = parseUnits('100.50', 6)
      const amountOut = parseUnits('100.38', 6)

      // StableSwap Swapped event ABI:
      // event Swapped(address indexed user, address tokenIn, uint256 amountIn, uint256 amountOut)
      const swappedAbiItem = STABLE_SWAP_ABI.find(
        (x) => x.type === 'event' && x.name === 'Swapped'
      )!

      const topics = encodeEventTopics({
        abi: [swappedAbiItem],
        eventName: 'Swapped',
        args: {
          user: dummyUser,
        },
      })

      const data = encodeAbiParameters(
        [{ type: 'address' }, { type: 'uint256' }, { type: 'uint256' }],
        [dummyUsdc, amountIn, amountOut]
      )

      const decoded = decodeEventLog({
        abi: STABLE_SWAP_ABI,
        eventName: 'Swapped',
        data,
        topics: topics as [`0x${string}`, ...`0x${string}`[]],
      })

      expect(decoded.args.user.toLowerCase()).toBe(dummyUser.toLowerCase())
      expect(decoded.args.amountIn).toBe(amountIn)
      expect(decoded.args.amountOut).toBe(amountOut)
      expect(formatUnits(decoded.args.amountOut, 6)).toBe('100.38')
    })

    it('decodes Swapped event for 8-decimal tokens (USDC -> cirBTC)', () => {
      const amountIn = parseUnits('65000', 6)
      const amountOut = parseUnits('1.00000000', 8)

      const swappedAbiItem = CONSTANT_PRODUCT_ABI.find(
        (x) => x.type === 'event' && x.name === 'Swapped'
      )!

      const topics = encodeEventTopics({
        abi: [swappedAbiItem],
        eventName: 'Swapped',
        args: {
          user: dummyUser,
        },
      })

      const data = encodeAbiParameters(
        [{ type: 'address' }, { type: 'uint256' }, { type: 'uint256' }],
        [dummyUsdc, amountIn, amountOut]
      )

      const decoded = decodeEventLog({
        abi: CONSTANT_PRODUCT_ABI,
        eventName: 'Swapped',
        data,
        topics: topics as [`0x${string}`, ...`0x${string}`[]],
      })

      expect(decoded.args.amountOut).toBe(amountOut)
      expect(formatUnits(decoded.args.amountOut, 8)).toBe('1')
    })

    it('gracefully skips non-Swapped logs without throwing', () => {
      // Dummy log with random topic
      const randomLog = {
        data: '0x00' as `0x${string}`,
        topics: ['0x1111111111111111111111111111111111111111111111111111111111111111' as `0x${string}`],
      }

      let decodedFound = false
      try {
        const decoded = decodeEventLog({
          abi: STABLE_SWAP_ABI,
          eventName: 'Swapped',
          data: randomLog.data,
          topics: randomLog.topics as any,
        })
        if (decoded?.args) decodedFound = true
      } catch {
        // Expected to fail silently
      }

      expect(decodedFound).toBe(false)
    })
  })

  describe('LiquidityAdded Event Decoding (K1)', () => {
    it('decodes LiquidityAdded event and extracts raw lpMinted', () => {
      const amountA = parseUnits('500', 6)
      const amountB = parseUnits('500', 6)
      const lpMinted = parseUnits('1000', 18) // 18 decimals LP token

      const addedAbiItem = STABLE_SWAP_ABI.find(
        (x) => x.type === 'event' && x.name === 'LiquidityAdded'
      )!

      const topics = encodeEventTopics({
        abi: [addedAbiItem],
        eventName: 'LiquidityAdded',
        args: {
          provider: dummyProvider,
        },
      })

      const data = encodeAbiParameters(
        [{ type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }],
        [amountA, amountB, lpMinted]
      )

      const decoded = decodeEventLog({
        abi: STABLE_SWAP_ABI,
        eventName: 'LiquidityAdded',
        data,
        topics: topics as [`0x${string}`, ...`0x${string}`[]],
      })

      expect(decoded.args.provider.toLowerCase()).toBe(dummyProvider.toLowerCase())
      expect(decoded.args.amountA).toBe(amountA)
      expect(decoded.args.amountB).toBe(amountB)
      expect(decoded.args.lpMinted).toBe(lpMinted)
      expect(formatUnits(decoded.args.lpMinted, 18)).toBe('1000')
    })
  })
})
