// src/components/pools/AgentBountyHubModal.tsx
//
// Interactive AI Agent Bounty & Yield-Generating Escrow Hub for ArcFlow (ERC-8183 & ERC-8004).
// Automatically routes idle escrow capital into ArcFlow Real-Yield Vault (ERC-4626) at 8.42% APY.
// Supports crowdfunding sponsorship, proof verification, sponsor cash-back dividend claims, and task creation.

import React, { useState } from 'react'
import { createPortal } from 'react-dom'
import {
  X,
  Bot,
  ShieldCheck,
  Plus,
  RefreshCw,
  TrendingUp,
  Gift,
  Zap,
  Sparkles,
  CheckCircle2,
  Lock,
} from 'lucide-react'
import { useAgentBounties } from '../../hooks/useAgentBounties'
import type { AgentBountyTask } from '../../config/poolsConfig'

interface AgentBountyHubModalProps {
  isOpen: boolean
  onClose: () => void
  walletAddress: string
  availableWalletUsdc: string
  onSponsorSuccess?: (taskTitle: string, amount: string) => void
  onCreateSuccess?: (taskTitle: string, amount: string) => void
}

const ARC_GAS_RESERVE_USDC = 0.50

export default function AgentBountyHubModal({
  isOpen,
  onClose,
  walletAddress,
  availableWalletUsdc,
  onSponsorSuccess,
  onCreateSuccess,
}: AgentBountyHubModalProps) {
  const {
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
  } = useAgentBounties(walletAddress)

  const [activeTab, setActiveTab] = useState<'tasks' | 'create'>('tasks')
  
  // Sponsorship state
  const [sponsoringTaskId, setSponsoringTaskId] = useState<string | null>(null)
  const [sponsorAmount, setSponsorAmount] = useState<string>('50')
  
  // Create task state
  const [newTitle, setNewTitle] = useState<string>('')
  const [newDesc, setNewDesc] = useState<string>('')
  const [newReward, setNewReward] = useState<string>('100')
  const [newCategory, setNewCategory] = useState<string>('Arbitrage')
  const [newYieldBeneficiary, setNewYieldBeneficiary] = useState<'Sponsor Cash-Back' | 'Agent Bonus' | 'Protocol Revenue'>('Sponsor Cash-Back')

  const [isProcessing, setIsProcessing] = useState<boolean>(false)
  const [claimingBountyId, setClaimingBountyId] = useState<string | null>(null)
  const [claimSuccessMessage, setClaimSuccessMessage] = useState<string | null>(null)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  if (!isOpen) return null

  const walletBal = parseFloat(availableWalletUsdc || '0')

  const handleSponsorSubmit = async (bounty: AgentBountyTask) => {
    const amtNum = parseFloat(sponsorAmount)

    if (isNaN(amtNum) || amtNum <= 0) {
      setErrorMsg('Please enter a valid sponsorship amount.')
      return
    }

    if (amtNum > walletBal) {
      setErrorMsg(`Amount exceeds your available balance of ${walletBal.toFixed(2)} USDC.`)
      return
    }

    setIsProcessing(true)
    setErrorMsg(null)
    setClaimSuccessMessage(null)
    try {
      await sponsorBounty(bounty.id, sponsorAmount)
      if (onSponsorSuccess) onSponsorSuccess(bounty.title, sponsorAmount)
      setSponsoringTaskId(null)
      setSponsorAmount('50')
    } catch (err: any) {
      setErrorMsg(err.message || 'Sponsorship failed.')
    } finally {
      setIsProcessing(false)
    }
  }

  const handleClaimYieldDividend = async (bounty: AgentBountyTask) => {
    setClaimingBountyId(bounty.id)
    setErrorMsg(null)
    setClaimSuccessMessage(null)
    try {
      const res = await claimBountyRewards(bounty.id)
      setClaimSuccessMessage(`Successfully claimed +$${res.claimedUsdc} USDC escrow yield dividend on Arc Testnet!`)
    } catch (err: any) {
      setErrorMsg(err.message || 'Claim failed.')
    } finally {
      setClaimingBountyId(null)
    }
  }

  const handleCreateSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newTitle.trim() || !newDesc.trim()) {
      setErrorMsg('Please enter a title and description for the agent task.')
      return
    }

    const rewardNum = parseFloat(newReward)
    if (isNaN(rewardNum) || rewardNum <= 0) {
      setErrorMsg('Please enter a valid bounty reward amount.')
      return
    }
    if (rewardNum > walletBal) {
      setErrorMsg(`Reward exceeds your available balance of ${walletBal.toFixed(2)} USDC.`)
      return
    }

    setIsProcessing(true)
    setErrorMsg(null)
    setClaimSuccessMessage(null)
    try {
      await createBounty(newTitle, newDesc, newReward, newCategory as any, newYieldBeneficiary)
      if (onCreateSuccess) onCreateSuccess(newTitle, newReward)
      setActiveTab('tasks')
      setNewTitle('')
      setNewDesc('')
      setNewReward('100')
    } catch (err: any) {
      setErrorMsg(err.message || 'Task creation failed.')
    } finally {
      setIsProcessing(false)
    }
  }

  if (typeof document === 'undefined') return null

  return createPortal(
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        width: '100vw',
        height: '100vh',
        zIndex: 99999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '16px',
        background: 'rgba(0, 0, 0, 0.75)',
        backdropFilter: 'blur(16px)',
        WebkitBackdropFilter: 'blur(16px)',
        animation: 'arc-reveal 0.2s cubic-bezier(0.16, 1, 0.3, 1)',
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && !isProcessing) onClose()
      }}
    >
      <div
        className="ub-hero-card"
        style={{
          width: '100%',
          maxWidth: 780,
          maxHeight: '90vh',
          overflowY: 'auto',
          background: 'linear-gradient(180deg, rgba(17, 21, 38, 0.98) 0%, rgba(11, 13, 24, 0.99) 100%)',
          border: '1px solid rgba(236, 72, 153, 0.35)',
          boxShadow: '0 24px 64px -12px rgba(0, 0, 0, 0.9), 0 0 32px rgba(236, 72, 153, 0.15)',
          borderRadius: 24,
          padding: '28px',
          position: 'relative',
          fontFamily: 'var(--font-app)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Close Button */}
        <button
          onClick={onClose}
          disabled={isProcessing}
          type="button"
          className="ub-action-btn"
          style={{
            position: 'absolute',
            top: 20,
            right: 20,
            padding: 8,
            borderRadius: '50%',
          }}
          title="Close Hub"
        >
          <X size={16} />
        </button>

        {/* Modal Header */}
        <div style={{ marginBottom: 18, paddingRight: 40 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <Bot size={18} style={{ color: '#f472b6' }} />
            <span
              className="arc-eyebrow"
              style={{ fontSize: 12, color: '#f472b6', fontWeight: 600, letterSpacing: '1.5px' }}
            >
              ERC-8183 / ERC-8004 AI AGENT ESCROW & BOUNTY HUB
            </span>
          </div>
          <h2
            style={{
              margin: 0,
              fontSize: 22,
              fontFamily: 'var(--fonts--space-grotesk)',
              fontWeight: 600,
              color: '#fff',
            }}
          >
            Yield-Generating Agent Escrows
          </h2>
          <p style={{ margin: '4px 0 0 0', fontSize: 13, color: 'var(--fp-3)', fontFamily: 'var(--font-app)', lineHeight: 1.4 }}>
            Bounty funds locked in escrow never sit idle — they automatically generate <strong>8.42% APY</strong> in the ArcFlow Real-Yield Vault while autonomous AI agents execute tasks.
          </p>
        </div>

        {/* ── Yield-Generating Engine Banner ── */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: 10,
            padding: '10px 14px',
            background: 'linear-gradient(135deg, rgba(236, 72, 153, 0.12) 0%, rgba(99, 102, 241, 0.12) 100%)',
            border: '1px solid rgba(236, 72, 153, 0.3)',
            borderRadius: 14,
            marginBottom: 18,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div
              style={{
                width: 28,
                height: 28,
                borderRadius: '50%',
                background: 'rgba(236, 72, 153, 0.2)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#f472b6',
              }}
            >
              <Zap size={15} />
            </div>
            <div>
              <span style={{ color: '#fff', fontSize: 12, fontWeight: 600, display: 'block' }}>
                Zero-Idle Escrow Architecture
              </span>
              <span style={{ color: '#bae6fd', fontSize: 11 }}>
                All locked USDC generates continuous yield on Arc Testnet until agent verification.
              </span>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span
              style={{
                background: 'rgba(1, 208, 98, 0.15)',
                border: '1px solid rgba(1, 208, 98, 0.35)',
                color: 'var(--earned-green)',
                padding: '3px 8px',
                borderRadius: 99,
                fontSize: 11,
                fontWeight: 700,
              }}
            >
              +8.42% APY Vault Auto-Routing
            </span>
          </div>
        </div>

        {/* ── Summary Stats Strip (4 Columns) ── */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
            gap: 10,
            background: 'rgba(11, 13, 24, 0.75)',
            border: '1px solid rgba(255, 255, 255, 0.08)',
            borderRadius: 16,
            padding: '14px 16px',
            marginBottom: 20,
          }}
        >
          <div>
            <span style={{ fontSize: 10, color: 'var(--fp-4)', display: 'block' }}>TOTAL ESCROW LOCKED</span>
            <span style={{ fontSize: 16, fontWeight: 700, color: '#fff', fontFamily: 'var(--fonts--space-grotesk)' }}>
              ${totalEscrowUsdc.toLocaleString()} USDC
            </span>
          </div>

          <div>
            <span style={{ fontSize: 10, color: 'var(--fp-4)', display: 'block' }}>TOTAL ACCRUED YIELD</span>
            <span style={{ fontSize: 16, fontWeight: 700, color: 'var(--earned-green)', fontFamily: 'var(--fonts--space-grotesk)' }}>
              +${totalEscrowYieldEarnedUsdc.toFixed(2)} USDC
            </span>
          </div>

          <div>
            <span style={{ fontSize: 10, color: 'var(--fp-4)', display: 'block' }}>MY SPONSORED STAKE</span>
            <span style={{ fontSize: 16, fontWeight: 700, color: '#f472b6', fontFamily: 'var(--fonts--space-grotesk)' }}>
              ${userTotalSponsoredUsdc.toFixed(2)} USDC
            </span>
          </div>

          <div>
            <span style={{ fontSize: 10, color: 'var(--fp-4)', display: 'block' }}>MY CLAIMABLE DIVIDEND</span>
            <span style={{ fontSize: 16, fontWeight: 700, color: '#38bdf8', fontFamily: 'var(--fonts--space-grotesk)' }}>
              +${userTotalSponsorYieldEarnedUsdc.toFixed(2)} USDC
            </span>
          </div>
        </div>

        {/* ── Tab Switcher (Tasks vs Create) ── */}
        <div
          style={{
            display: 'flex',
            background: 'rgba(11, 13, 24, 0.8)',
            border: '1px solid rgba(255, 255, 255, 0.08)',
            borderRadius: 14,
            padding: 4,
            marginBottom: 20,
          }}
        >
          <button
            type="button"
            onClick={() => {
              setActiveTab('tasks')
              setErrorMsg(null)
              setClaimSuccessMessage(null)
            }}
            style={{
              flex: 1,
              padding: '8px 0',
              borderRadius: 10,
              border: 'none',
              fontSize: 13,
              fontFamily: 'var(--font-app)',
              fontWeight: activeTab === 'tasks' ? 600 : 500,
              color: activeTab === 'tasks' ? '#fff' : 'var(--fp-3)',
              background:
                activeTab === 'tasks'
                  ? 'linear-gradient(135deg, rgba(236, 72, 153, 0.25) 0%, rgba(219, 39, 119, 0.3) 100%)'
                  : 'transparent',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 6,
              transition: 'all 0.2s ease',
            }}
          >
            <Bot size={14} />
            <span>Active Tasks & Escrows ({bounties.length})</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setActiveTab('create')
              setErrorMsg(null)
              setClaimSuccessMessage(null)
            }}
            style={{
              flex: 1,
              padding: '8px 0',
              borderRadius: 10,
              border: 'none',
              fontSize: 13,
              fontFamily: 'var(--font-app)',
              fontWeight: activeTab === 'create' ? 600 : 500,
              color: activeTab === 'create' ? '#fff' : 'var(--fp-3)',
              background:
                activeTab === 'create'
                  ? 'linear-gradient(135deg, rgba(236, 72, 153, 0.25) 0%, rgba(219, 39, 119, 0.3) 100%)'
                  : 'transparent',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 6,
              transition: 'all 0.2s ease',
            }}
          >
            <Plus size={14} />
            <span>Create New Agent Task</span>
          </button>
        </div>

        {/* Notifications & Error messages */}
        {claimSuccessMessage && (
          <div
            style={{
              padding: '10px 14px',
              background: 'rgba(1, 208, 98, 0.1)',
              border: '1px solid rgba(1, 208, 98, 0.35)',
              borderRadius: 12,
              fontSize: 12,
              color: 'var(--earned-green)',
              marginBottom: 16,
              display: 'flex',
              alignItems: 'center',
              gap: 8,
            }}
          >
            <CheckCircle2 size={15} /> <span>{claimSuccessMessage}</span>
          </div>
        )}

        {errorMsg && (
          <div
            style={{
              padding: '10px 14px',
              background: 'rgba(239, 68, 68, 0.1)',
              border: '1px solid rgba(239, 68, 68, 0.3)',
              borderRadius: 12,
              fontSize: 12,
              color: '#f87171',
              marginBottom: 16,
            }}
          >
            {errorMsg}
          </div>
        )}

        {/* ── Tab 1: Tasks List ── */}
        {activeTab === 'tasks' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {bounties.map((bounty) => {
              const userAmt = userSponsored[bounty.id] || 0
              const isSponsoringThis = sponsoringTaskId === bounty.id
              const poolYield = bounty.accumulatedYieldUsdc || 0
              const userYieldShare = userAmt > 0 && bounty.escrowLockedUsdc > 0
                ? (userAmt / bounty.escrowLockedUsdc) * poolYield
                : 0
              const userClaimed = claimedYields[bounty.id] || 0
              const userClaimable = Math.max(0, userYieldShare - userClaimed)

              return (
                <div
                  key={bounty.id}
                  style={{
                    background: 'rgba(15, 18, 32, 0.85)',
                    border: '1px solid rgba(255, 255, 255, 0.08)',
                    borderRadius: 16,
                    padding: '16px 18px',
                    transition: 'all 0.2s ease',
                  }}
                >
                  {/* Task Top Row */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        <h4 style={{ margin: 0, fontSize: 15, color: '#fff', fontFamily: 'var(--fonts--space-grotesk)' }}>
                          {bounty.title}
                        </h4>
                        <span
                          style={{
                            fontSize: 10,
                            fontFamily: 'var(--font-app)',
                            fontWeight: 700,
                            background: 'rgba(236, 72, 153, 0.15)',
                            border: '1px solid rgba(236, 72, 153, 0.35)',
                            color: '#f472b6',
                            padding: '1px 6px',
                            borderRadius: 99,
                          }}
                        >
                          {bounty.category}
                        </span>

                        {/* Status Badge */}
                        <span
                          style={{
                            fontSize: 10,
                            fontFamily: 'var(--font-app)',
                            fontWeight: 700,
                            padding: '1px 6px',
                            borderRadius: 99,
                            background:
                              bounty.status === 'completed'
                                ? 'rgba(1, 208, 98, 0.15)'
                                : bounty.status === 'proof_submitted'
                                ? 'rgba(59, 130, 246, 0.15)'
                                : 'rgba(251, 191, 36, 0.15)',
                            border:
                              bounty.status === 'completed'
                                ? '1px solid rgba(1, 208, 98, 0.35)'
                                : bounty.status === 'proof_submitted'
                                ? '1px solid rgba(59, 130, 246, 0.35)'
                                : '1px solid rgba(251, 191, 36, 0.35)',
                            color:
                              bounty.status === 'completed'
                                ? 'var(--earned-green)'
                                : bounty.status === 'proof_submitted'
                                ? '#60a5fa'
                                : '#fbbf24',
                          }}
                        >
                          {bounty.status === 'completed'
                            ? '✓ COMPLETED'
                            : bounty.status === 'proof_submitted'
                            ? '⚡ PROOF SUBMITTED'
                            : '⏳ IN PROGRESS'}
                        </span>
                      </div>

                      <p style={{ margin: '4px 0 0 0', fontSize: 12, color: 'var(--fp-3)', lineHeight: 1.4 }}>
                        {bounty.description}
                      </p>
                    </div>

                    <div style={{ textAlign: 'right', minWidth: 90 }}>
                      <span style={{ fontSize: 16, fontWeight: 700, color: 'var(--earned-green)', fontFamily: 'var(--fonts--space-grotesk)' }}>
                        {bounty.aprReward}% APR
                      </span>
                      <span style={{ fontSize: 10, color: 'var(--fp-4)', display: 'block' }}>
                        Bounty Reward
                      </span>
                    </div>
                  </div>

                  {/* ── Yield-Generating Escrow Details Bar ── */}
                  <div
                    style={{
                      background: 'rgba(56, 189, 248, 0.06)',
                      border: '1px solid rgba(56, 189, 248, 0.18)',
                      borderRadius: 10,
                      padding: '8px 12px',
                      marginTop: 10,
                      marginBottom: 10,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      flexWrap: 'wrap',
                      gap: 8,
                      fontSize: 11,
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <TrendingUp size={13} style={{ color: '#38bdf8' }} />
                      <span style={{ color: '#bae6fd' }}>
                        <strong>Escrow Yield Vault:</strong> +${poolYield.toFixed(2)} USDC generated @ {bounty.yieldApr || 8.42}% APY
                      </span>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span
                        style={{
                          fontSize: 10,
                          color: '#e0e7ff',
                          background: 'rgba(99, 102, 241, 0.2)',
                          border: '1px solid rgba(99, 102, 241, 0.35)',
                          padding: '1px 6px',
                          borderRadius: 6,
                          fontWeight: 600,
                        }}
                      >
                        Policy: {bounty.yieldBeneficiary || 'Sponsor Cash-Back'}
                      </span>

                      {userClaimable > 0 && (
                        <button
                          type="button"
                          onClick={() => handleClaimYieldDividend(bounty)}
                          disabled={claimingBountyId === bounty.id}
                          style={{
                            background: 'linear-gradient(135deg, #01d062 0%, #059669 100%)',
                            border: '1px solid rgba(1, 208, 98, 0.4)',
                            borderRadius: 6,
                            padding: '2px 8px',
                            color: '#fff',
                            fontSize: 10.5,
                            fontWeight: 700,
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            gap: 4,
                          }}
                        >
                          <Gift size={11} />
                          <span>{claimingBountyId === bounty.id ? 'Claiming...' : `Claim +$${userClaimable.toFixed(2)} Dividend`}</span>
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Agent Identity & Reputation Strip */}
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      flexWrap: 'wrap',
                      gap: 8,
                      fontSize: 11,
                      color: 'var(--fp-4)',
                      borderTop: '1px solid rgba(255, 255, 255, 0.05)',
                      paddingTop: 10,
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <Bot size={13} style={{ color: '#f472b6' }} />
                      <span style={{ color: '#fff', fontWeight: 500 }}>{bounty.agentName}</span>
                      <span
                        style={{
                          background: 'rgba(1, 208, 98, 0.1)',
                          color: 'var(--earned-green)',
                          padding: '1px 5px',
                          borderRadius: 4,
                          fontSize: 10,
                          fontWeight: 600,
                        }}
                      >
                        Rep: {bounty.agentReputationScore}/100
                      </span>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                      <span>
                        Escrow: <strong style={{ color: '#fff' }}>${bounty.escrowLockedUsdc.toLocaleString()} USDC</strong> ({bounty.sponsorCount} sponsors)
                      </span>

                      {userAmt > 0 && (
                        <span style={{ color: '#f472b6', fontWeight: 600 }}>
                          My Stake: ${userAmt.toFixed(2)}
                        </span>
                      )}

                      <button
                        type="button"
                        onClick={() => setSponsoringTaskId(isSponsoringThis ? null : bounty.id)}
                        className="ub-action-btn"
                        style={{
                          padding: '4px 10px',
                          fontSize: 11,
                          background: isSponsoringThis ? 'rgba(236, 72, 153, 0.25)' : 'rgba(255, 255, 255, 0.05)',
                          borderColor: isSponsoringThis ? 'rgba(236, 72, 153, 0.45)' : 'rgba(255, 255, 255, 0.1)',
                          color: isSponsoringThis ? '#fff' : '#f472b6',
                        }}
                      >
                        {isSponsoringThis ? 'Cancel' : '+ Sponsor Task'}
                      </button>
                    </div>
                  </div>

                  {/* Proof Hash (If submitted/completed) */}
                  {bounty.proofHash && (
                    <div
                      style={{
                        marginTop: 8,
                        padding: '6px 10px',
                        background: 'rgba(1, 208, 98, 0.06)',
                        border: '1px solid rgba(1, 208, 98, 0.15)',
                        borderRadius: 8,
                        fontSize: 10,
                        color: 'var(--fp-3)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                      }}
                    >
                      <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        <ShieldCheck size={11} style={{ color: 'var(--earned-green)' }} />
                        <span>Proof Hash (ERC-8004): {bounty.proofHash.slice(0, 14)}...{bounty.proofHash.slice(-10)}</span>
                      </span>
                      <span style={{ color: 'var(--earned-green)', fontWeight: 600 }}>VERIFIED</span>
                    </div>
                  )}

                  {/* Inline Sponsor Input Box with Arc Gas Shield MAX */}
                  {isSponsoringThis && (
                    <div
                      style={{
                        marginTop: 12,
                        padding: '14px',
                        background: 'rgba(236, 72, 153, 0.08)',
                        border: '1px solid rgba(236, 72, 153, 0.25)',
                        borderRadius: 12,
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 10,
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 11 }}>
                        <span style={{ color: 'var(--fp-3)' }}>Fund Escrow & Earn Yield Dividend</span>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span style={{ color: 'var(--fp-3)' }}>
                            Available: <strong style={{ color: '#fff' }}>{availableWalletUsdc} USDC</strong>
                          </span>
                          <button
                            type="button"
                            onClick={() => {
                              const maxSponsor = Math.max(0, walletBal - ARC_GAS_RESERVE_USDC)
                              setSponsorAmount(maxSponsor.toFixed(2))
                            }}
                            style={{
                              background: 'rgba(236, 72, 153, 0.2)',
                              border: '1px solid rgba(236, 72, 153, 0.4)',
                              borderRadius: 4,
                              padding: '1px 5px',
                              color: '#f472b6',
                              fontSize: 9.5,
                              fontWeight: 700,
                              cursor: 'pointer',
                            }}
                            title="Max amount reserving $0.50 for Arc gas"
                          >
                            MAX (Keep $0.50 Gas)
                          </button>
                        </div>
                      </div>

                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                        <div style={{ flex: 1, minWidth: 160, position: 'relative' }}>
                          <input
                            type="number"
                            step="any"
                            min="1"
                            placeholder="Amount in USDC"
                            value={sponsorAmount}
                            onChange={(e) => setSponsorAmount(e.target.value)}
                            style={{
                              width: '100%',
                              background: 'rgba(11, 13, 24, 0.85)',
                              border: '1px solid rgba(255, 255, 255, 0.15)',
                              borderRadius: 10,
                              padding: '8px 12px',
                              paddingRight: '40px',
                              color: '#fff',
                              fontSize: 14,
                              outline: 'none',
                            }}
                          />
                          <span style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', fontSize: 11, color: 'var(--fp-4)' }}>
                            USDC
                          </span>
                        </div>

                        <button
                          type="button"
                          onClick={() => handleSponsorSubmit(bounty)}
                          disabled={isProcessing}
                          className="ub-action-btn ub-action-btn-primary"
                          style={{
                            background: 'linear-gradient(135deg, #ec4899 0%, #db2777 100%)',
                            borderColor: 'rgba(236, 72, 153, 0.4)',
                            padding: '8px 18px',
                            fontSize: 12,
                          }}
                        >
                          {isProcessing ? 'Confirming on Arc...' : `Sponsor $${sponsorAmount} USDC`}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}

        {/* ── Tab 2: Create New Bounty Form ── */}
        {activeTab === 'create' && (
          <form onSubmit={handleCreateSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div>
              <label style={{ fontSize: 11, color: 'var(--fp-3)', display: 'block', marginBottom: 4 }}>
                TASK TITLE
              </label>
              <input
                type="text"
                required
                placeholder="e.g. Real-Time Mempool Arbitrage & Liquidity Sentinel"
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                style={{
                  width: '100%',
                  background: 'rgba(11, 13, 24, 0.85)',
                  border: '1px solid rgba(255, 255, 255, 0.12)',
                  borderRadius: 12,
                  padding: '10px 14px',
                  color: '#fff',
                  fontSize: 14,
                  outline: 'none',
                }}
              />
            </div>

            <div>
              <label style={{ fontSize: 11, color: 'var(--fp-3)', display: 'block', marginBottom: 4 }}>
                TASK DESCRIPTION & EXECUTION CRITERIA
              </label>
              <textarea
                rows={3}
                required
                placeholder="Describe what the autonomous AI agent must accomplish, expected deliverables, and cryptographic proof verification required..."
                value={newDesc}
                onChange={(e) => setNewDesc(e.target.value)}
                style={{
                  width: '100%',
                  background: 'rgba(11, 13, 24, 0.85)',
                  border: '1px solid rgba(255, 255, 255, 0.12)',
                  borderRadius: 12,
                  padding: '10px 14px',
                  color: '#fff',
                  fontSize: 13,
                  outline: 'none',
                  resize: 'none',
                }}
              />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div>
                <label style={{ fontSize: 11, color: 'var(--fp-3)', display: 'block', marginBottom: 4 }}>
                  CATEGORY
                </label>
                <select
                  value={newCategory}
                  onChange={(e) => setNewCategory(e.target.value)}
                  style={{
                    width: '100%',
                    background: 'rgba(11, 13, 24, 0.85)',
                    border: '1px solid rgba(255, 255, 255, 0.12)',
                    borderRadius: 12,
                    padding: '10px 14px',
                    color: '#fff',
                    fontSize: 13,
                    outline: 'none',
                    cursor: 'pointer',
                  }}
                >
                  <option value="Arbitrage">Arbitrage & DEX</option>
                  <option value="Security">Security & Audit</option>
                  <option value="Oracle">Oracle & Data</option>
                  <option value="Liquidity">Liquidity Guard</option>
                  <option value="Bridge">Bridge Watchdog</option>
                </select>
              </div>

              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                  <label style={{ fontSize: 11, color: 'var(--fp-3)' }}>
                    INITIAL ESCROW REWARD (USDC)
                  </label>
                  <button
                    type="button"
                    onClick={() => {
                      const maxReward = Math.max(0, walletBal - ARC_GAS_RESERVE_USDC)
                      setNewReward(maxReward.toFixed(2))
                    }}
                    style={{
                      background: 'rgba(236, 72, 153, 0.2)',
                      border: '1px solid rgba(236, 72, 153, 0.4)',
                      borderRadius: 4,
                      padding: '1px 5px',
                      color: '#f472b6',
                      fontSize: 9.5,
                      fontWeight: 700,
                      cursor: 'pointer',
                    }}
                  >
                    MAX (Keep $0.50 Gas)
                  </button>
                </div>
                <input
                  type="number"
                  min="10"
                  step="any"
                  required
                  value={newReward}
                  onChange={(e) => setNewReward(e.target.value)}
                  style={{
                    width: '100%',
                    background: 'rgba(11, 13, 24, 0.85)',
                    border: '1px solid rgba(255, 255, 255, 0.12)',
                    borderRadius: 12,
                    padding: '10px 14px',
                    color: '#fff',
                    fontSize: 14,
                    outline: 'none',
                  }}
                />
              </div>
            </div>

            {/* Yield Beneficiary Strategy Selection */}
            <div>
              <label style={{ fontSize: 11, color: 'var(--fp-3)', display: 'block', marginBottom: 4 }}>
                ESCROW YIELD BENEFICIARY POLICY (8.42% APY Vault)
              </label>
              <select
                value={newYieldBeneficiary}
                onChange={(e) => setNewYieldBeneficiary(e.target.value as any)}
                style={{
                  width: '100%',
                  background: 'rgba(11, 13, 24, 0.85)',
                  border: '1px solid rgba(56, 189, 248, 0.3)',
                  borderRadius: 12,
                  padding: '10px 14px',
                  color: '#fff',
                  fontSize: 13,
                  outline: 'none',
                  cursor: 'pointer',
                }}
              >
                <option value="Sponsor Cash-Back">Sponsor Cash-Back (Yield distributed proportionally to task sponsors)</option>
                <option value="Agent Bonus">Agent Bonus (Yield added to agent payout upon successful proof verification)</option>
                <option value="Protocol Revenue">Protocol Revenue Share (Yield auto-routed to ArcFlow Vault LPs)</option>
              </select>
            </div>

            <button
              type="submit"
              disabled={isProcessing}
              style={{
                marginTop: 8,
                width: '100%',
                padding: '12px 0',
                borderRadius: 99,
                border: 'none',
                background: 'linear-gradient(135deg, #ec4899 0%, #db2777 100%)',
                color: '#fff',
                fontSize: 14,
                fontFamily: 'var(--font-app)',
                fontWeight: 600,
                cursor: isProcessing ? 'not-allowed' : 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8,
              }}
            >
              {isProcessing ? (
                <>
                  <RefreshCw size={15} className="arcflow-spin" />
                  <span>CREATING YIELD-GENERATING ESCROW ON ARC...</span>
                </>
              ) : (
                <>
                  <Plus size={16} />
                  <span>LAUNCH AGENT BOUNTY ESCROW (${newReward} USDC)</span>
                </>
              )}
            </button>
          </form>
        )}
      </div>
    </div>,
    document.body
  )
}
