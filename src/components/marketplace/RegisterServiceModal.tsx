// src/components/marketplace/RegisterServiceModal.tsx
// Modal for developers to list and monetize custom x402 AI Services on Arcis

import { AlertCircle, Plus, Sparkles, X } from 'lucide-react'
import React, { useState } from 'react'
import { createPortal } from 'react-dom'
import type { Hex } from 'viem'
import UsdcIcon from '../../assets/Token-Icon/USDC Token.svg'
import { ARC_TESTNET_TOKENS } from '../../config/arcChain'
import { providerSignerErrorMessage, resolveProviderSigner } from '../../services/x402/providerAuthorization'
import { signServiceRegistration } from '../../services/x402/serviceRegistration'
import type { UcwTypedDataChallenge } from '../../services/ucwChallengeSigner'
import { SERVICE_CATEGORIES } from '../../config/x402/categories'
import { usdcToBaseUnits } from '../../config/x402/pricing'
import {
  CIRCLE_BATCHING_METADATA,
  DEFAULT_X402_DOMAIN,
  GATEWAY_CONTRACTS,
  X402_NETWORKS,
} from '../../config/x402/schemes'
import { soundService } from '../../services/soundService'
import MarketplaceSelect from './MarketplaceSelect'
import type { ServiceCategory, x402Service } from '../../types/marketplace'

interface RegisterServiceModalProps {
  isOpen: boolean
  onClose: () => void
  walletAddress?: string
  provider?: any
  /** Which wallet is active, so signing uses that wallet instead of an injected provider. */
  authSource?: 'passkey' | 'ucw' | 'evm' | null
  /** Circle Wallet typed-data challenge signer; a UCW EOA signs its listing through this. */
  ucwSignTypedData?: UcwTypedDataChallenge
  onRegisterService: (newService: x402Service, proof: { owner: string; nonce: Hex; deadline: number; signature: Hex }) => Promise<void>
}

const CATEGORIES: Exclude<ServiceCategory, 'All'>[] = SERVICE_CATEGORIES.map((c) => c.id)

export default function RegisterServiceModal({
  isOpen,
  onClose,
  walletAddress,
  provider,
  authSource,
  ucwSignTypedData,
  onRegisterService,
}: RegisterServiceModalProps) {
  const [name, setName] = useState('')
  const [tagline, setTagline] = useState('')
  const [category, setCategory] = useState<Exclude<ServiceCategory, 'All'>>('Arbitrage')
  const [priceUsdc, setPriceUsdc] = useState<number>(0.005)
  const [endpointUrl, setEndpointUrl] = useState('')
  const [description, setDescription] = useState('')
  const [tags, setTags] = useState('AI, Alpha, Arc')
  const [payoutAddress, setPayoutAddress] = useState(walletAddress || '')
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [signedManifest, setSignedManifest] = useState<x402Service | null>(null)

  React.useEffect(() => {
    if (walletAddress && !payoutAddress) {
      setPayoutAddress(walletAddress)
    }
  }, [walletAddress])

  if (!isOpen) return null

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (isSubmitting) return
    setError(null)

    if (signedManifest) {
      void signAndPublish(signedManifest)
      return
    }

    if (!name.trim() || !endpointUrl.trim() || !description.trim()) {
      setError('Please fill in all required fields (Name, Endpoint, and Description).')
      soundService.play('error')
      return
    }

    const providerAddr = (payoutAddress.trim() || walletAddress || '').trim()
    if (!providerAddr || !/^0x[a-fA-F0-9]{40}$/.test(providerAddr)) {
      setError('Please provide a valid 0x EVM payout wallet address to receive your micro-USDC revenue.')
      soundService.play('error')
      return
    }

    const newId = `custom-${name.toLowerCase().replace(/[^a-z0-9]/g, '-')}-${Date.now().toString().slice(-4)}`
    const numericPrice = Number(priceUsdc) || 0.005

    const newService: x402Service = {
      id: newId,
      version: '1.0.0',
      name: name.trim(),
      tagline: tagline.trim() || name.trim(),
      category,
      engine: 'proxy',
      description: description.trim(),
      listing: {
        kind: 'community',
        ownerAddress: providerAddr,
        createdAt: Date.now(),
      },
      provider: {
        name: `${providerAddr.substring(0, 6)}...${providerAddr.substring(providerAddr.length - 4)} (Community)`,
        address: providerAddr,
        isVerified: false,
        reputationScore: 90,
      },
      pricing: {
        model: 'per_call',
        priceUsdc: numericPrice,
        maxAmountUsdc: numericPrice,
        protocolFeeBps: 0,
      },
      accepts: [
        {
          scheme: 'exact',
          network: X402_NETWORKS.CAIP2_ARC_TESTNET,
          asset: 'USDC',
          payTo: providerAddr,
          amount: usdcToBaseUnits(numericPrice),
          maxTimeoutSeconds: CIRCLE_BATCHING_METADATA.MAX_TIMEOUT_SECONDS,
          extra: {
            name: CIRCLE_BATCHING_METADATA.NAME,
            version: CIRCLE_BATCHING_METADATA.VERSION,
            verifyingContract: GATEWAY_CONTRACTS.testnet.gatewayWallet,
          },
          domain: {
            ...DEFAULT_X402_DOMAIN,
            verifyingContract: ARC_TESTNET_TOKENS.USDC,
          },
        },
      ],
      serve: {
        method: 'POST',
        path: `/api/x402/${newId}`,
      },
      upstream: {
        url: endpointUrl.trim(),
        method: 'POST',
      },
      requestSchema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          query: { type: 'string' },
        },
      },
      ui: {
        form: [
          {
            name: 'query',
            label: 'Query / Parameter',
            type: 'string',
            defaultValue: 'Arcis Alpha Query',
            description: 'Primary data parameter passed to the service.',
            required: true,
          },
        ],
      },
      examples: {
        request: { query: 'Arcis Alpha Query' },
        response: {
          status: 'SUCCESS',
          result: 'Service executed successfully via Arcis x402 Nanopayments.',
        },
      },
      sla: {
        p95LatencyMs: 120,
        uptimePct: 99.8,
        successRate: 99.8,
      },
      healthcheckUrl: '/api/x402/health',
      tags: tags.split(',').map((t) => t.trim()).filter(Boolean),
    }

    await signAndPublish(newService)
  }

  const signAndPublish = async (manifest: x402Service) => {
    // One rule for the provider signer across listing and withdrawal: an injected EOA or a
    // Circle UCW EOA (which signs through its challenge). A passkey/MSCA account cannot sign
    // anything the server recovers, so it is refused here instead of falling through.
    const resolved = resolveProviderSigner({
      authSource,
      walletAddress,
      provider,
      ucwSignTypedData,
      memo: `Arcis x402 service listing: ${manifest.name}`.slice(0, 120),
    })
    if (!resolved.ok) {
      setError(
        resolved.reason === 'no_wallet' || resolved.reason === 'no_provider'
          ? 'Connect the provider wallet to sign and publish this service.'
          : providerSignerErrorMessage(resolved.reason)
      )
      soundService.play('error')
      return
    }

    setIsSubmitting(true)
    setError(null)
    try {
      // Same EIP-712 payload for both wallet types; only the signer differs. A UCW wallet is an
      // EOA, so its Circle challenge returns an ecrecover-verifiable 65-byte signature.
      const proof = await signServiceRegistration({ owner: walletAddress!, manifest, signTypedData: resolved.signer })
      await onRegisterService(manifest, proof)
      soundService.play('success')
      onClose()
    } catch (err: any) {
      setSignedManifest(manifest)
      setError(err?.message || 'Service registration could not be signed or stored. Retry to publish this exact manifest.')
      soundService.play('error')
    } finally {
      setIsSubmitting(false)
    }
  }

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 overflow-y-auto">
      <div
        className="fixed inset-0 bg-black/85 backdrop-blur-[28px] transition-opacity animate-fade-in"
        onClick={onClose}
      />

      <div
        className="relative w-full max-w-lg rounded-[28px] overflow-hidden transition-all border border-white/[0.08] my-8 flex flex-col"
        style={{
          background: 'linear-gradient(180deg, rgba(14, 18, 28, 0.98) 0%, rgba(9, 12, 20, 0.99) 100%)',
          boxShadow: '0 32px 80px -16px rgba(0, 0, 0, 0.85), 0 0 0 1px rgba(255, 255, 255, 0.06), 0 0 60px rgba(112, 88, 248, 0.12)',
        }}
      >
        {/* Ambient Top Glow */}
        <div className="absolute top-0 right-0 w-72 h-72 bg-[radial-gradient(circle,rgba(112,88,248,0.12)_0%,transparent_70%)] pointer-events-none" />

        {/* Header */}
        <div className="relative flex items-center justify-between px-6 py-5 border-b border-white/[0.06] bg-white/[0.02]">
          <div className="flex items-center gap-3.5">
            <div className="w-10 h-10 rounded-2xl bg-[var(--purple-1)]/15 border border-[var(--purple-1)]/30 flex items-center justify-center text-[var(--color-brand-cyan)] shadow-inner">
              <Sparkles className="w-5 h-5 text-[var(--color-brand-cyan)]" />
            </div>
            <div>
              <h3 className="text-base font-bold text-white tracking-tight" style={{ fontFamily: 'var(--font-display, inherit)' }}>
                List New AI Service
              </h3>
              <p className="text-xs text-slate-400">
                Monetize your model and earn micro-USDC directly via x402 Pay-Per-Call
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="w-8 h-8 rounded-xl bg-white/[0.04] border border-white/[0.08] hover:bg-white/[0.08] text-slate-400 hover:text-white transition flex items-center justify-center cursor-pointer"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="relative p-6 space-y-4" key={signedManifest?.id || 'new-service'}>
          {error && (
            <div className="p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs flex items-center gap-2.5">
              <AlertCircle className="w-4 h-4 flex-shrink-0 text-rose-400" />
              <span>{error}</span>
            </div>
          )}

          <div className="space-y-1.5">
            <label className="text-[11px] font-mono tracking-wider uppercase text-slate-400">Service Name *</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Arc Sentinel MEV Oracle"
              required
              className="w-full px-3.5 py-2.5 rounded-xl bg-[rgba(10,13,22,0.85)] border border-white/[0.08] text-xs text-white placeholder-slate-500 focus:outline-none focus:border-[var(--purple-1)]/50 focus:ring-1 focus:ring-[var(--purple-1)]/40 transition"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-[11px] font-mono tracking-wider uppercase text-slate-400">Category</label>
              <MarketplaceSelect
                value={category}
                onChange={(val) => setCategory(val as any)}
                options={CATEGORIES.map((cat) => ({ value: cat, label: cat }))}
                menuTitle="Select Category"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-[11px] font-mono tracking-wider uppercase text-slate-400">Price per Call *</label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <img src={UsdcIcon} alt="USDC" className="w-4 h-4 rounded-full object-contain" />
                </div>
                <input
                  type="number"
                  step="0.001"
                  min="0.001"
                  max="1.0"
                  value={priceUsdc}
                  onChange={(e) => setPriceUsdc(parseFloat(e.target.value))}
                  required
                  className="w-full pl-9 pr-16 py-2.5 rounded-xl bg-[rgba(10,13,22,0.85)] border border-white/[0.08] text-xs text-white font-mono tabular-nums focus:outline-none focus:border-[var(--purple-1)]/50 focus:ring-1 focus:ring-[var(--purple-1)]/40 transition"
                />
                <div className="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none">
                  <span className="text-[11px] font-semibold text-slate-400 font-mono">USDC</span>
                </div>
              </div>
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-[11px] font-mono tracking-wider uppercase text-slate-400">Endpoint URL *</label>
            <input
              type="url"
              value={endpointUrl}
              onChange={(e) => setEndpointUrl(e.target.value)}
              placeholder="https://api.yourdomain.com/v1/oracle"
              required
              className="w-full px-3.5 py-2.5 rounded-xl bg-[rgba(10,13,22,0.85)] border border-white/[0.08] text-xs text-white font-mono placeholder-slate-500 focus:outline-none focus:border-[var(--purple-1)]/50 focus:ring-1 focus:ring-[var(--purple-1)]/40 transition"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-[11px] font-mono tracking-wider uppercase text-slate-400">Description *</label>
            <textarea
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Brief overview of what the service does and what data/signals it returns..."
              required
              className="w-full px-3.5 py-2 rounded-xl bg-[rgba(10,13,22,0.85)] border border-white/[0.08] text-xs text-white placeholder-slate-500 focus:outline-none focus:border-[var(--purple-1)]/50 focus:ring-1 focus:ring-[var(--purple-1)]/40 transition resize-none"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-[11px] font-mono tracking-wider uppercase text-slate-400">Tags (comma-separated)</label>
            <input
              type="text"
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              placeholder="Arbitrage, MEV, Live"
              className="w-full px-3.5 py-2 rounded-xl bg-[rgba(10,13,22,0.85)] border border-white/[0.08] text-xs text-slate-300 font-mono placeholder-slate-500 focus:outline-none focus:border-[var(--purple-1)]/50 focus:ring-1 focus:ring-[var(--purple-1)]/40 transition"
            />
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-[11px] font-mono tracking-wider uppercase text-slate-400">Payout Wallet Address *</label>
              <span className="text-[10px] font-mono text-[var(--color-brand-cyan)] bg-[var(--color-brand-cyan)]/10 px-2 py-0.5 rounded-md border border-[var(--color-brand-cyan)]/20">Arc Testnet USDC</span>
            </div>
            <input
              type="text"
              value={payoutAddress}
              onChange={(e) => setPayoutAddress(e.target.value)}
              placeholder="0x..."
              required
              className="w-full px-3.5 py-2.5 rounded-xl bg-[rgba(10,13,22,0.85)] border border-white/[0.08] text-xs text-white font-mono placeholder-slate-500 focus:outline-none focus:border-[var(--purple-1)]/50 focus:ring-1 focus:ring-[var(--purple-1)]/40 transition"
            />
            <p className="text-[10px] text-slate-500 font-mono">
              x402 micro-USDC revenues earned from service calls will settle directly to this address on Arc Testnet.
            </p>
          </div>

          <div className="pt-2">
            <button
              type="submit"
              disabled={isSubmitting}
              className="arc-btn arc-btn-primary w-full py-3 rounded-xl text-xs font-bold tracking-wider uppercase shadow-lg transition flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Plus className="w-4 h-4" />
              <span>{isSubmitting ? 'Signing & Publishing…' : signedManifest ? 'Retry Publish Signed Service' : 'Sign & Publish Service'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body
  )
}
