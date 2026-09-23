// src/hooks/useMarketplaceServices.ts
// Hook for managing x402 marketplace services, filtering, execution, and session budget

import { useState, useEffect, useMemo, useCallback } from 'react'
import { useClearOnWalletDisconnect } from './useClearOnWalletDisconnect'
import {
  ARC_SERVICES_REGISTRY,
  MARKETPLACE_STATS,
} from '../config/servicesRegistry'
import { ecosystemStatsService } from '../services/ecosystemStatsService'
import {
  executeX402Call,
  getSessionBudget,
  saveSessionBudget,
  resetSessionBudget,
  type SessionBudgetState,
} from '../services/x402Client'
import type {
  x402Service,
  ServiceCategory,
  x402ExecutionResult,
  MarketplaceStats,
} from '../types/marketplace'

const CUSTOM_SERVICES_KEY = 'arcis_custom_registered_services_v2'

function loadCustomServices(): x402Service[] {
  try {
    const raw = localStorage.getItem(CUSTOM_SERVICES_KEY)
    if (raw) return JSON.parse(raw)
  } catch (e) {
    console.error('Failed to load custom services', e)
  }
  return []
}

function saveCustomServices(list: x402Service[]) {
  try {
    localStorage.setItem(CUSTOM_SERVICES_KEY, JSON.stringify(list))
  } catch (e) {
    console.error('Failed to save custom services', e)
  }
}

export function useMarketplaceServices(walletAddress?: string, provider?: any) {
  const [customServices, setCustomServices] = useState<x402Service[]>(loadCustomServices)
  const [services, setServices] = useState<x402Service[]>([
    ...ARC_SERVICES_REGISTRY,
    ...loadCustomServices(),
  ])
  const [stats, setStats] = useState<MarketplaceStats>(() => ecosystemStatsService.getStats())
  const [selectedCategory, setSelectedCategory] = useState<ServiceCategory>('All')
  const [searchQuery, setSearchQuery] = useState<string>('')
  const [filterCommunity, setFilterCommunity] = useState<'all' | 'verified' | 'community'>('all')

  // Modals
  const [isProviderHubOpen, setIsProviderHubOpen] = useState<boolean>(false)
  const [isRegisterModalOpen, setIsRegisterModalOpen] = useState<boolean>(false)
  
  // Subscribe to live ecosystem stats updates
  useEffect(() => {
    const unsubscribe = ecosystemStatsService.subscribe((updatedStats) => {
      setStats(updatedStats)
    })
    return () => unsubscribe()
  }, [])

  // Systematic input clearing on wallet disconnect
  useClearOnWalletDisconnect(() => {
    setSearchQuery('')
    setExecutionResult(null)
  })

  useEffect(() => {
    if (!walletAddress) {
      setSearchQuery('')
      setExecutionResult(null)
    }
  }, [walletAddress])

  // Active test modal state
  const [activeService, setActiveService] = useState<x402Service | null>(null)
  const [isPlaygroundOpen, setIsPlaygroundOpen] = useState<boolean>(false)
  const [isExecuting, setIsExecuting] = useState<boolean>(false)
  const [executionResult, setExecutionResult] = useState<x402ExecutionResult | null>(null)
  
  // Session Budget State
  const [sessionBudget, setSessionBudget] = useState<SessionBudgetState>(getSessionBudget())

  // Refresh session budget from storage
  const refreshSessionBudget = useCallback(() => {
    setSessionBudget(getSessionBudget())
  }, [])

  useEffect(() => {
    refreshSessionBudget()
  }, [refreshSessionBudget])

  const registerService = (newService: x402Service) => {
    const updated = [newService, ...customServices]
    setCustomServices(updated)
    saveCustomServices(updated)
    setServices([newService, ...services])
    ecosystemStatsService.incrementServiceCount()
  }

  // Filtered services
  const filteredServices = useMemo(() => {
    return services.filter((s) => {
      const matchesCategory = selectedCategory === 'All' || s.category === selectedCategory
      const q = searchQuery.toLowerCase().trim()
      const matchesSearch =
        !q ||
        s.name.toLowerCase().includes(q) ||
        s.description.toLowerCase().includes(q) ||
        s.tags.some((t) => t.toLowerCase().includes(q))
      const matchesCommunity =
        filterCommunity === 'all' ||
        (filterCommunity === 'verified' && s.provider.isVerified) ||
        (filterCommunity === 'community' && s.isCommunity)
      return matchesCategory && matchesSearch && matchesCommunity
    })
  }, [services, selectedCategory, searchQuery, filterCommunity])

  // Execute a service call
  const runService = async (service: x402Service, payload: Record<string, any>) => {
    setIsExecuting(true)
    setExecutionResult(null)
    try {
      const result = await executeX402Call(service, payload, walletAddress, provider)
      setExecutionResult(result)
      refreshSessionBudget()

      // Increment stats dynamically and persist across sessions
      if (result.success) {
        ecosystemStatsService.recordExecution(service.priceUsdc)
      }
      return result
    } catch (err: any) {
      const errRes: x402ExecutionResult = {
        statusCode: 500,
        success: false,
        error: err.message || 'Execution failed',
        executionTimeMs: 0,
        costUsdc: 0,
      }
      setExecutionResult(errRes)
      return errRes
    } finally {
      setIsExecuting(false)
    }
  }

  const openPlayground = (service: x402Service) => {
    setActiveService(service)
    setExecutionResult(null)
    setIsPlaygroundOpen(true)
  }

  const closePlayground = () => {
    setIsPlaygroundOpen(false)
  }

  const handleResetBudget = (amount = 1.0) => {
    resetSessionBudget(amount)
    refreshSessionBudget()
  }

  const toggleAutoApprove = (val: boolean) => {
    const updated = { ...sessionBudget, autoApprove: val }
    saveSessionBudget(updated)
    setSessionBudget(updated)
  }

  return {
    services,
    filteredServices,
    stats,
    selectedCategory,
    setSelectedCategory,
    searchQuery,
    setSearchQuery,
    filterCommunity,
    setFilterCommunity,
    activeService,
    isPlaygroundOpen,
    isExecuting,
    executionResult,
    sessionBudget,
    openPlayground,
    closePlayground,
    runService,
    handleResetBudget,
    toggleAutoApprove,
    refreshSessionBudget,
    isProviderHubOpen,
    setIsProviderHubOpen,
    isRegisterModalOpen,
    setIsRegisterModalOpen,
    registerService,
  }
}
