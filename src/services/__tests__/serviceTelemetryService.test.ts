import { afterEach, describe, expect, it } from 'vitest'
import { serviceTelemetryService } from '../serviceTelemetryService'

const SERVICE_ID = 'arc-portfolio-risk-exposure-test'

afterEach(() => {
  // A success clears the stored reason, so tests start from the same state.
  serviceTelemetryService.recordExecution(SERVICE_ID, 10, true)
})

describe('serviceTelemetryService.lastFailure', () => {
  it('stores the reason a paid call was voided, so the catalog card can show it', () => {
    serviceTelemetryService.recordExecution(SERVICE_ID, 4200, false, {
      kind: 'model_budget',
      label: 'The model produced no narrative',
      detail: 'The model used its whole 1600-token completion budget.',
    })

    const entry = serviceTelemetryService.getOrCreateServiceTelemetry(SERVICE_ID)
    expect(entry.lastFailure).toMatchObject({
      kind: 'model_budget',
      label: 'The model produced no narrative',
      detail: 'The model used its whole 1600-token completion budget.',
    })
    expect(entry.lastFailure?.at).toBeGreaterThan(0)
    expect(entry.status).not.toBe('online')
  })

  it('clears the reason once a later call succeeds', () => {
    serviceTelemetryService.recordExecution(SERVICE_ID, 800, false, {
      kind: 'measurement_missing',
      label: 'A required on-chain measurement failed',
      detail: 'USDC balance',
    })
    expect(serviceTelemetryService.getOrCreateServiceTelemetry(SERVICE_ID).lastFailure).not.toBeNull()

    serviceTelemetryService.recordExecution(SERVICE_ID, 900, true)
    expect(serviceTelemetryService.getOrCreateServiceTelemetry(SERVICE_ID).lastFailure).toBeNull()
  })

  it('does not invent a reason when a failure has none', () => {
    serviceTelemetryService.recordExecution(SERVICE_ID, 500, false)
    expect(serviceTelemetryService.getOrCreateServiceTelemetry(SERVICE_ID).lastFailure).toBeFalsy()
  })
})
