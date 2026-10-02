import { apiError } from './_utils/apiResponse'

const RELAYER_DISABLED_MESSAGE =
  'Gasless relayer is unavailable: sponsorship is disabled until its quota, replay-protection, and receipt-verification controls are production-ready.'

/** Quota is not exposed as eligibility while the sponsored transfer path is disabled. */
export async function GET(_req: Request) {
  return apiError(RELAYER_DISABLED_MESSAGE, 'RELAYER_DISABLED', 503)
}

/** Never accept or broadcast an EIP-3009 authorization while relayer controls are incomplete. */
export async function POST(_req: Request) {
  return apiError(RELAYER_DISABLED_MESSAGE, 'RELAYER_DISABLED', 503)
}
