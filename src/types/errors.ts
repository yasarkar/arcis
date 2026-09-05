// src/types/errors.ts
// Arcis Protocol Centralized Error Types & Interfaces (100% English)

export type ErrorCategory =
  | 'WALLET_REJECTION'     // User canceled / rejected transaction in wallet
  | 'INSUFFICIENT_GAS'     // Arc L1 USDC gas floor or insufficient funds
  | 'INSUFFICIENT_BALANCE' // Token balance is less than transfer/swap/deposit amount
  | 'SLIPPAGE_EXCEEDED'    // Price moved beyond slippage tolerance
  | 'NO_ROUTE'             // Liquidity pool or swap route not found
  | 'CONTRACT_REVERT'      // Smart contract execution reverted with reason
  | 'PASSKEY_AUTH'         // WebAuthn / FaceID / TouchID biometric error
  | 'RPC_NETWORK'          // RPC node timeout, network drop, or connection failure
  | 'WALLET_DESYNC'        // MetaMask / wallet internal RPC error or nonce mismatch
  | 'VALIDATION'           // Invalid address, zero/negative amount, or invalid inputs
  | 'SERVER_API'           // Backend /api/* service error
  | 'UNKNOWN'              // Uncategorized error

export interface ArcisAppError {
  category: ErrorCategory
  code: string                 // Machine-readable code, e.g. 'USER_CANCELED', 'ARC_GAS_UNDERPRICED'
  title: string                // Human-readable title for UI alerts / notifications
  message: string              // Clean, friendly explanation without raw stack traces
  actionHint?: string          // Actionable advice for the user to resolve the issue
  isCanceled: boolean          // True if user deliberately aborted the request
  isRetryable: boolean         // True if repeating the action might succeed
  rawMessage?: string          // Original unformatted error text for technical debugging
  txHash?: string              // On-chain transaction hash if available
}

export type ErrorSeverity = 'info' | 'warning' | 'error'

export interface ErrorNotificationPayload {
  title: string
  message: string
  category: ErrorCategory
  severity: ErrorSeverity
  isCanceled: boolean
  actionHint?: string
}
