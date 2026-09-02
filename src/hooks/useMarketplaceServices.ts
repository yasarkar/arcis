// src/hooks/useMarketplaceServices.ts
// Hook for managing x402 marketplace services, filtering, execution, and session budget

import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  ARC_SERVICES_REGISTRY,
  MARKETPLACE_STATS,
} from '../config/servicesRegistry'
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

export function useMarketplaceServices(walletAddress?: string) {
  const [services] = useState<x402Service[]>(ARC_SERVICES_REGISTRY)
  const [stats, setStats] = useState<MarketplaceStats>(MARKETPLACE_STATS)
  const [selectedCategory, setSelectedCategory] = useState<ServiceCategory>('All')
  const [searchQuery, setSearchQuery] = useState<string>('')
  
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
      return matchesCategory && matchesSearch
    })
  }, [services, selectedCategory, searchQuery])

  // Execute a service call
  const runService = async (service: x402Service, payload: Record<string, any>) => {
    setIsExecuting(true)
    setExecutionResult(null)
    try {
      const result = await executeX402Call(service, payload, walletAddress)
      setExecutionResult(result)
      refreshSessionBudget()

      // Increment stats slightly to feel dynamic
      if (result.success) {
        setStats((prev) => ({
          ...prev,
          totalCallsProcessed: prev.totalCallsProcessed + 1,
          totalVolumeUsdc: Number((prev.totalVolumeUsdc + service.priceUsdc).toFixed(4)),
          totalYieldGeneratedUsdc: Number((prev.totalYieldGeneratedUsdc + service.priceUsdc * 0.01).toFixed(4)),
        }))
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
  }
}
