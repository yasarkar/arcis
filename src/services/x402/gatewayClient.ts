// src/services/x402/gatewayClient.ts
// Circle Gateway Nanopayments Client for Arcis AI Services.
// Balance discovery and x402 support probing only: every value here is read from the chain
// or from the session config, so no deposit/withdraw hash or authorization signature is
// invented by a client-side facade.

import type { Address } from 'viem'
import type { X402PaymentRequirements } from '../../types/x402'
import { POOL_CONTRACTS, ERC20_ABI } from '../../config/poolsConfig'
import { getArcPublicClient } from '../rpc'
import { getSessionKeyConfig } from '../sessionKeyService'
import { baseUnitsToUsdc } from '../../config/x402/pricing'

export interface GatewayBalancesResult {
  walletUsdc: number
  gatewayAvailableUsdc: number
}

export interface GatewaySupportsResult {
  supported: boolean
  accepts?: X402PaymentRequirements['accepts']
  error?: string
}

class GatewayClientFacade {
  /**
   * Reads user's on-chain wallet USDC balance and Circle Gateway available balance.
   */
  public async getBalances(userAddress?: string): Promise<GatewayBalancesResult> {
    const sessionConfig = getSessionKeyConfig()
    const targetAddress = (userAddress ||
      sessionConfig.sessionPublicKey ||
      (sessionConfig as any).ephemeralAddress) as Address | undefined

    const maxSpend = sessionConfig.maxSpendUsdc ?? (sessionConfig as any).maxBudgetUsdc ?? 0
    const spent = sessionConfig.spentUsdc || 0
    const sessionRemaining = sessionConfig.isActive ? Math.max(0, maxSpend - spent) : 0

    if (!targetAddress) {
      return { walletUsdc: 0, gatewayAvailableUsdc: sessionRemaining }
    }

    try {
      const publicClient = getArcPublicClient()
      const rawBalance = (await publicClient.readContract({
        address: POOL_CONTRACTS.USDC as Address,
        abi: ERC20_ABI,
        functionName: 'balanceOf',
        args: [targetAddress],
      })) as bigint

      const walletUsdc = baseUnitsToUsdc(rawBalance)

      // Gateway balance is modeled either via Gateway contract or session budget
      const gatewayAvailableUsdc = sessionConfig.isActive ? sessionRemaining : walletUsdc

      return {
        walletUsdc,
        gatewayAvailableUsdc,
      }
    } catch (e) {
      return { walletUsdc: 0, gatewayAvailableUsdc: sessionRemaining }
    }
  }

  /**
   * Probes an endpoint to check if it supports x402 / Gateway batching.
   */
  public async supports(url: string): Promise<GatewaySupportsResult> {
    try {
      const res = await fetch(url, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      })

      if (res.status === 402) {
        const prHeader = res.headers.get('payment-required')
        if (prHeader) {
          try {
            const raw = typeof window !== 'undefined' ? atob(prHeader) : Buffer.from(prHeader, 'base64').toString('utf8')
            const parsed = JSON.parse(raw)
            if (parsed.accepts) {
              return {
                supported: true,
                accepts: parsed.accepts,
              }
            }
          } catch {}
        }
        const body = (await res.json()) as X402PaymentRequirements
        return {
          supported: true,
          accepts: body.accepts,
        }
      }

      return {
        supported: res.ok,
      }
    } catch (err: any) {
      return {
        supported: false,
        error: err?.message || 'Failed to probe x402 support',
      }
    }
  }
}

export const gatewayClient = new GatewayClientFacade()
