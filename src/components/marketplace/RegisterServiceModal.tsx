// src/components/marketplace/RegisterServiceModal.tsx
// Modal for developers to list and monetize custom x402 AI Services on Arcis

import React, { useState } from 'react'
import { createWalletClient, custom, type Hex } from 'viem'
import { createPortal } from 'react-dom'
import { X, Sparkles, Plus, Layers, Zap, AlertCircle } from 'lucide-react'
import type { x402Service, ServiceCategory } from '../../types/marketplace'
import { SERVICE_CATEGORIES } from '../../config/x402/categories'
import {
  CIRCLE_BATCHING_METADATA,
  DEFAULT_X402_DOMAIN,
  GATEWAY_CONTRACTS,
  X402_NETWORKS,
} from '../../config/x402/schemes'
import { ARC_TESTNET_TOKENS } from '../../config/arcChain'
import { usdcToBaseUnits } from '../../config/x402/pricing'
import { X402_AUTHORIZATION_DOMAIN, hashServiceManifest } from '../../config/x402/authorization'
import { arcTestnet } from '../../config/arcChain'
import { soundService } from '../../services/soundService'
import UsdcIcon from '../../assets/Token-Icon/USDC Token.svg'

interface RegisterServiceModalProps {
  isOpen: boolean
  onClose: () => void
  walletAddress?: string
  provider?: any
  onRegisterService: (newService: x402Service, proof: { owner: string; nonce: Hex; deadline: number; signature: Hex }) => Promise<void>
}

const CATEGORIES: Exclude<ServiceCategory, 'All'>[] = SERVICE_CATEGORIES.map((c) => c.id)

export default function RegisterServiceModal({
  isOpen,
  onClose,
  walletAddress,
  provider,
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
    const effectiveProvider = provider || (typeof window !== 'undefined' ? (window as any).ethereum : null)
    if (!effectiveProvider || !walletAddress) {
      setError('Connect the provider wallet to sign and publish this service.')
      soundService.play('error')
      return
    }

    setIsSubmitting(true)
    setError(null)
    try {
      const walletClient = createWalletClient({
        account: walletAddress as Hex,
        chain: arcTestnet,
        transport: custom(effectiveProvider),
      })
      const nonce = `0x${Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) => byte.toString(16).padStart(2, '0')).join('')}` as Hex
      const deadline = Math.floor(Date.now() / 1000) + 5 * 60
      const signature = await walletClient.signTypedData({
        account: walletAddress as Hex,
        domain: X402_AUTHORIZATION_DOMAIN,
        types: {
          ServiceRegistration: [
            { name: 'owner', type: 'address' },
            { name: 'manifestHash', type: 'bytes32' },
            { name: 'nonce', type: 'bytes32' },
            { name: 'deadline', type: 'uint256' },
          ],
        },
        primaryType: 'ServiceRegistration',
        message: {
          owner: walletAddress as Hex,
          manifestHash: hashServiceManifest(manifest),
          nonce,
          deadline: BigInt(deadline),
        },
      })
      await onRegisterService(manifest, { owner: walletAddress, nonce, deadline, signature })
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
        className="fixed inset-0 bg-black/80 backdrop-blur-md transition-opacity animate-fade-in"
        onClick={onClose}
      />

      <div
        className="relative w-full max-w-lg rounded-3xl overflow-hidden shadow-2xl transition-all border border-indigo-500/30 my-8 flex flex-col"
        style={{
          background: 'linear-gradient(180deg, rgba(16, 19, 34, 0.98) 0%, rgba(10, 12, 22, 0.99) 100%)',
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.8), 0 0 40px rgba(99, 102, 241, 0.2)',
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-5 border-b border-slate-800/80 bg-slate-900/40">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-indigo-500/15 border border-indigo-500/30 flex items-center justify-center text-indigo-400">
              <Sparkles className="w-5 h-5 text-indigo-400" />
            </div>
            <div>
              <h3 className="text-base font-bold text-white tracking-tight">
                List New AI Service
              </h3>
              <p className="text-xs text-slate-400">
                Monetize your model and earn micro-USDC directly via x402 Pay-Per-Call
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4" key={signedManifest?.id || 'new-service'}>
          {error && (
            <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs flex items-center gap-2">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <div className="space-y-1">
            <label className="text-xs font-semibold text-slate-300">Service Name *</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Arc Sentinel MEV Oracle"
              required
              className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950/80 border border-slate-800 text-xs text-white focus:outline-none focus:border-indigo-500 transition"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-xs font-semibold text-slate-300">Category</label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value as any)}
                className="w-full px-3 py-2.5 rounded-xl bg-slate-950/80 border border-slate-800 text-xs text-white focus:outline-none focus:border-indigo-500 transition cursor-pointer"
              >
                {CATEGORIES.map((cat) => (
                  <option key={cat} value={cat}>
                    {cat}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1">
              <label className="text-xs font-semibold text-slate-300">Price per Call *</label>
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
                  className="w-full pl-9 pr-16 py-2.5 rounded-xl bg-slate-950/80 border border-slate-800 text-xs text-white font-mono focus:outline-none focus:border-indigo-500 transition"
                />
                <div className="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none">
                  <span className="text-[11px] font-semibold text-slate-400 font-mono">USDC</span>
                </div>
              </div>
            </div>
          </div>

          <div className="space-y-1">
            <label className="text-xs font-semibold text-slate-300">Endpoint URL *</label>
            <input
              type="url"
              value={endpointUrl}
              onChange={(e) => setEndpointUrl(e.target.value)}
              placeholder="https://api.yourdomain.com/v1/oracle"
              required
              className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950/80 border border-slate-800 text-xs text-white font-mono focus:outline-none focus:border-indigo-500 transition"
            />
          </div>

          <div className="space-y-1">
            <label className="text-xs font-semibold text-slate-300">Description *</label>
            <textarea
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Brief overview of what the service does and what data/signals it returns..."
              required
              className="w-full px-3.5 py-2 rounded-xl bg-slate-950/80 border border-slate-800 text-xs text-white focus:outline-none focus:border-indigo-500 transition resize-none"
            />
          </div>

          <div className="space-y-1">
            <label className="text-xs font-semibold text-slate-300">Tags (comma-separated)</label>
            <input
              type="text"
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              placeholder="Arbitrage, MEV, Live"
              className="w-full px-3.5 py-2 rounded-xl bg-slate-950/80 border border-slate-800 text-xs text-slate-300 focus:outline-none focus:border-indigo-500 transition font-mono"
            />
          </div>

          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold text-slate-300">Payout Wallet Address *</label>
              <span className="text-[10px] text-cyan-400 font-mono">Arc Testnet USDC</span>
            </div>
            <input
              type="text"
              value={payoutAddress}
              onChange={(e) => setPayoutAddress(e.target.value)}
              placeholder="0x..."
              required
              className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950/80 border border-slate-800 text-xs text-white font-mono focus:outline-none focus:border-indigo-500 transition"
            />
            <p className="text-[10px] text-slate-500">
              x402 micro-USDC revenues earned from service calls will settle to this address.
            </p>
          </div>

          <div className="pt-2">
            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full py-3 rounded-xl bg-gradient-to-r from-indigo-600 via-purple-600 to-cyan-600 hover:brightness-110 text-white font-bold text-xs tracking-wide shadow-lg shadow-indigo-500/25 transition flex items-center justify-center gap-2 cursor-pointer"
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
