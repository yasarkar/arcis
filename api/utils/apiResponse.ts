// api/utils/apiResponse.ts
// Standardized API Response Envelope & Safe JSON Parser for Arcis Protocol Services (100% English)

export interface ApiErrorDetail {
  code: string
  message: string
  details?: any
}

export interface ApiErrorResponse {
  success: false
  error: string
  code: string
  errorDetails: ApiErrorDetail
  timestamp: number
  [key: string]: any
}

export interface ApiSuccessResponse {
  success: true
  timestamp: number
  [key: string]: any
}

/**
 * Creates a standardized JSON success response.
 * Spreads payload fields directly to the top-level for 100% backward compatibility with frontend consumers.
 */
export function apiSuccess<T extends Record<string, any>>(
  payload: T,
  status = 200,
  headers?: Record<string, string>
): Response {
  return Response.json(
    {
      success: true,
      timestamp: Date.now(),
      ...payload,
    },
    {
      status,
      headers: {
        'Content-Type': 'application/json',
        ...(headers || {}),
      },
    }
  )
}

/**
 * Creates a standardized JSON error response (100% English).
 * Provides top-level `error` string alongside structured `code` and `errorDetails`.
 */
export function apiError(
  message: string,
  code = 'INTERNAL_ERROR',
  status = 500,
  details?: any,
  extraFields?: Record<string, any>
): Response {
  return Response.json(
    {
      success: false,
      error: message,
      code,
      errorDetails: {
        code,
        message,
        details: details || null,
      },
      timestamp: Date.now(),
      ...(extraFields || {}),
    },
    {
      status,
      headers: {
        'Content-Type': 'application/json',
      },
    }
  )
}

/**
 * Safely parses JSON from an incoming Web Request without throwing unhandled exceptions.
 * Handles empty bodies, non-JSON streams, and malformed strings gracefully.
 */
export async function safeJsonParse<T = any>(
  req: Request,
  fallback: T = {} as T
): Promise<{ success: boolean; data: T; error?: string }> {
  try {
    const text = await req.text()
    if (!text || !text.trim()) {
      return { success: true, data: fallback }
    }
    const parsed = JSON.parse(text)
    return { success: true, data: parsed }
  } catch (err: any) {
    return {
      success: false,
      data: fallback,
      error: err?.message || 'Malformed JSON payload in request body.',
    }
  }
}
