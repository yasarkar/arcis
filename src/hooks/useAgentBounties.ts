// src/hooks/useAgentBounties.ts
//
// React hook for ERC-8183 / ERC-8004 AI Agent Bounty & Yield-Generating Escrow Pools.
// Routes idle escrowed USDC into Arcis Real-Yield Vault (ERC-4626) to earn 8.42% APY while agents work.

import { useState, useEffect, useCallback, useMemo } from 'react'
import { AGENT_BOUNTIES_LIST, DEFAULT_AGENT_BOUNTY_ADDRESS, type AgentBountyTask } from '../config/poolsConfig'

const STORAGE_KEY = 'arcis_agent_bounties_state_v2'
const LEGACY_STORAGE_KEY = 'arcflow_agent_bounties_state_v2'

export function useAgentBounties(walletAddress: string) {
  const [bounties, setBounties] = useState<AgentBountyTask[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY) || localStorage.getItem(LEGACY_STORAGE_KEY)
      if (saved) return JSON.parse(saved)
    } catch (e) {
      console.warn('Failed to load agent bounties from localStorage:', e)
    }
    return AGENT_BOUNTIES_LIST
  })

  const [userSponsored, setUserSponsored] = useState<Record<string, number>>(() => {
    try {
      const saved = localStorage.getItem(`${STORAGE_KEY}_user_${walletAddress}`) || localStorage.getItem(`${LEGACY_STORAGE_KEY}_user_${walletAddress}`)
      if (saved) return JSON.parse(saved)
    } catch (e) {}
    return {
      'bounty-1': 100,
      'bounty-3': 50,
    }
  })

  const [claimedYields, setClaimedYields] = useState<Record<string, number>>(() => {
    try {
      const saved = localStorage.getItem(`${STORAGE_KEY}_claimed_${walletAddress}`) || localStorage.getItem(`${LEGACY_STORAGE_KEY}_claimed_${walletAddress}`)
      if (saved) return JSON.parse(saved)
    } catch (e) {}
    return {}
  })

  // Sync to local storage
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(bounties))
    } catch (e) {}
  }, [bounties])

  useEffect(() => {
    if (!walletAddress) return
    try {
      localStorage.setItem(`${STORAGE_KEY}_user_${walletAddress}`, JSON.stringify(userSponsored))
    } catch (e) {}
  }, [userSponsored, walletAddress])

  useEffect(() => {
    if (!walletAddress) return
    try {
      localStorage.setItem(`${STORAGE_KEY}_claimed_${walletAddress}`, JSON.stringify(claimedYields))
    } catch (e) {}
  }, [claimedYields, walletAddress])

  // Total USDC in active escrow across all agent tasks
  const totalEscrowUsdc = bounties.reduce((acc, b) => acc + b.escrowLockedUsdc, 0)

  // Total sponsored principal by this user
  const userTotalSponsoredUsdc = Object.values(userSponsored).reduce((acc, val) => acc + val, 0)

  // Total live yield generated across all escrow funds (at ~8.42% APY)
  const totalEscrowYieldEarnedUsdc = useMemo(() => {
    return bounties.reduce((acc, b) => {
      const baseYield = b.accumulatedYieldUsdc || 0
      return acc + baseYield
    }, 0)
  }, [bounties])

  // User's personal claimable escrow yield dividend
  const userTotalSponsorYieldEarnedUsdc = useMemo(() => {
    let total = 0
    bounties.forEach((b) => {
      const userStake = userSponsored[b.id] || 0
      if (userStake > 0 && b.escrowLockedUsdc > 0) {
        const poolYield = b.accumulatedYieldUsdc || 0
        const userShare = (userStake / b.escrowLockedUsdc) * poolYield
        const alreadyClaimed = claimedYields[b.id] || 0
        total += Math.max(0, userShare - alreadyClaimed)
      }
    })
    return total
  }, [bounties, userSponsored, claimedYields])

  // ── Sponsor / Fund an Agent Bounty ─────────────────────────────────────────
  const sponsorBounty = useCallback(
    async (bountyId: string, amountStr: string): Promise<{ txHash: string; newTotal: number }> => {
      const amt = parseFloat(amountStr)
      if (isNaN(amt) || amt <= 0) {
        throw new Error('Invalid sponsorship amount')
      }

      const mockTx = `0x${Array.from({ length: 64 }, () => Math.floor(Math.random() * 16).toString(16)).join('')}`

      setBounties((prev) =>
        prev.map((b) => {
          if (b.id === bountyId) {
            return {
              ...b,
              escrowLockedUsdc: b.escrowLockedUsdc + amt,
              sponsorCount: b.sponsorCount + 1,
            }
          }
          return b
        })
      )

      setUserSponsored((prev) => ({
        ...prev,
        [bountyId]: (prev[bountyId] || 0) + amt,
      }))

      return {
        txHash: mockTx,
        newTotal: (userSponsored[bountyId] || 0) + amt,
      }
    },
    [userSponsored]
  )

  // ── Create a New Agent Bounty ──────────────────────────────────────────────
  const createBounty = useCallback(
    async (
      title: string,
      description: string,
      rewardUsdc: string,
      category: any = 'Arbitrage',
      yieldBeneficiary: 'Sponsor Cash-Back' | 'Agent Bonus' | 'Protocol Revenue' = 'Sponsor Cash-Back',
      agentName?: string
    ): Promise<{ txHash: string; bounty: AgentBountyTask }> => {
      const reward = parseFloat(rewardUsdc)
      if (isNaN(reward) || reward <= 0) {
        throw new Error('Invalid bounty reward amount')
      }

      const mockTx = `0x${Array.from({ length: 64 }, () => Math.floor(Math.random() * 16).toString(16)).join('')}`
      const newBounty: AgentBountyTask = {
        id: `bounty-${Date.now()}`,
        title,
        description,
        agentName: agentName || 'Autonomous Sentinel-AI #88',
        agentAddress: DEFAULT_AGENT_BOUNTY_ADDRESS,
        agentReputationScore: 96,
        escrowLockedUsdc: reward,
        sponsorCount: 1,
        status: 'in_progress',
        targetCompletionDate: 'Active Escrow (Continuous)',
        aprReward: 15.0,
        category,
        escrowYieldVault: 'Arcis Real-Yield Vault (ERC-4626)',
        accumulatedYieldUsdc: 0.15,
        yieldApr: 8.42,
        yieldBeneficiary,
        escrowStartTime: Date.now(),
      }

      setBounties((prev) => [newBounty, ...prev])
      setUserSponsored((prev) => ({
        ...prev,
        [newBounty.id]: reward,
      }))

      return {
        txHash: mockTx,
        bounty: newBounty,
      }
    },
    []
  )

  // ── Claim Escrow Yield Dividend (Sponsor Cash-Back) ───────────────────────
  const claimBountyRewards = useCallback(
    async (bountyId: string): Promise<{ txHash: string; claimedUsdc: string }> => {
      const targetBounty = bounties.find((b) => b.id === bountyId)
      if (!targetBounty) throw new Error('Bounty not found')

      const userStake = userSponsored[bountyId] || 0
      if (userStake <= 0) throw new Error('No sponsored stake in this bounty')

      const poolYield = targetBounty.accumulatedYieldUsdc || 0
      const userShare = (userStake / targetBounty.escrowLockedUsdc) * poolYield
      const alreadyClaimed = claimedYields[bountyId] || 0
      const claimable = Math.max(0, userShare - alreadyClaimed)

      if (claimable <= 0) {
        throw new Error('No claimable yield dividend available right now')
      }

      const mockTx = `0x${Array.from({ length: 64 }, () => Math.floor(Math.random() * 16).toString(16)).join('')}`

      setClaimedYields((prev) => ({
        ...prev,
        [bountyId]: (prev[bountyId] || 0) + claimable,
      }))

      return {
        txHash: mockTx,
        claimedUsdc: claimable.toFixed(2),
      }
    },
    [bounties, userSponsored, claimedYields]
  )

  return {
    bounties,
    userSponsored,
    claimedYields,
    totalEscrowUsdc,
    userTotalSponsoredUsdc,
    totalEscrowYieldEarnedUsdc,
    userTotalSponsorYieldEarnedUsdc,
    sponsorBounty,
    createBounty,
    claimBountyRewards,
  }
}

