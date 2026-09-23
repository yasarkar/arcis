// src/hooks/useServiceTelemetry.ts
// React hook to access live physical network latency & verified success rates for AI Services

import { useState, useEffect, useCallback } from 'react'
import {
  serviceTelemetryService,
  type ServiceTelemetryData,
} from '../services/serviceTelemetryService'
import type { x402Service } from '../types/marketplace'

export function useServiceTelemetry(services: x402Service[] = []) {
  const [telemetryMap, setTelemetryMap] = useState<Record<string, ServiceTelemetryData>>({})
  const [isProbing, setIsProbing] = useState<boolean>(false)

  useEffect(() => {
    const unsubscribe = serviceTelemetryService.subscribe((updated) => {
      setTelemetryMap(updated)
    })

    if (services.length > 0) {
      serviceTelemetryService.startAutoProbing(services, 20000)
    }

    return () => {
      unsubscribe()
      serviceTelemetryService.stopAutoProbing()
    }
  }, [services])

  const probeAll = useCallback(async () => {
    if (services.length === 0) return
    setIsProbing(true)
    try {
      await serviceTelemetryService.probeAllServices(services)
    } finally {
      setIsProbing(false)
    }
  }, [services])

  const probeSingle = useCallback(async (service: x402Service) => {
    return await serviceTelemetryService.probeService(service)
  }, [])

  const getServiceTelemetry = useCallback(
    (service: x402Service): ServiceTelemetryData => {
      if (telemetryMap[service.id]) {
        return telemetryMap[service.id]
      }
      return serviceTelemetryService.getOrCreateServiceTelemetry(
        service.id,
        service.latencyMs,
        service.successRate
      )
    },
    [telemetryMap]
  )

  return {
    telemetryMap,
    isProbing,
    probeAll,
    probeSingle,
    getServiceTelemetry,
  }
}
