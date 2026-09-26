// src/config/errorMessages.ts
// Standardized Web3 Error Messages Dictionary for Arcis Protocol (100% English)

import type { ErrorCategory } from '../types/errors'

export interface ErrorDefinition {
  category: ErrorCategory
  title: string
  message: string
  isCanceled: boolean
  isRetryable: boolean
  isActionable?: boolean
}

export const ERROR_DEFINITIONS: Record<string, ErrorDefinition> = {
  // 1. User Cancellation
  USER_CANCELED: {
    category: 'WALLET_REJECTION',
    title: 'Transaction Canceled',
    message: 'Transaction canceled in wallet. Try again whenever you are ready.',
    isCanceled: true,
    isRetryable: true,
  },

  // 1b. Network Switch Cancellation
  NETWORK_SWITCH_CANCELED: {
    category: 'WALLET_REJECTION',
    title: 'Network Switch Canceled',
    message: 'The network switch request was canceled in your wallet. Please approve the switch to proceed.',
    isCanceled: true,
    isRetryable: true,
  },

  // 2. Arc L1 USDC Gas Floor Violation
  GAS_PRICE_UNDERPRICED: {
    category: 'INSUFFICIENT_GAS',
    title: 'Gas Price Below Protocol Floor',
    message: 'Gas price is below the Arc 20 Gwei floor. Select Fast or Turbo speed and retry.',
    isCanceled: false,
    isRetryable: true,
  },

  // 3. Insufficient USDC on Arc L1 (Native Gas Token)
  INSUFFICIENT_USDC_FOR_GAS: {
    category: 'INSUFFICIENT_GAS',
    title: 'Insufficient USDC for Gas',
    message: 'Insufficient USDC for Arc gas fees. Please deposit or claim USDC from faucet.',
    isCanceled: false,
    isRetryable: false,
  },

  // 3b. Insufficient Native Gas Token (ETH) on External EVM Networks (Base, Sepolia, etc.)
  INSUFFICIENT_NATIVE_GAS: {
    category: 'INSUFFICIENT_GAS',
    title: 'Insufficient Native Gas (ETH)',
    message: 'Insufficient native gas tokens (ETH). Please fund your wallet with testnet ETH or use Arc Testnet.',
    isCanceled: false,
    isRetryable: false,
  },

  // 4. Insufficient Token Balance
  INSUFFICIENT_BALANCE: {
    category: 'INSUFFICIENT_BALANCE',
    title: 'Insufficient Balance',
    message: 'Amount exceeds available balance. Enter a lower amount or top up your wallet.',
    isCanceled: false,
    isRetryable: false,
  },

  // 5. Slippage Tolerance Exceeded
  SLIPPAGE_EXCEEDED: {
    category: 'SLIPPAGE_EXCEEDED',
    title: 'Slippage Tolerance Exceeded',
    message: 'Price moved beyond slippage tolerance. Increase slippage in settings or try a smaller amount.',
    isCanceled: false,
    isRetryable: true,
  },

  // 6. Liquidity Route Not Found
  NO_LIQUIDITY_ROUTE: {
    category: 'NO_ROUTE',
    title: 'No Active Liquidity Route',
    message: 'No liquidity route found for this pair. Try adjusting the amount or trade USDC ↔ EURC.',
    isCanceled: false,
    isRetryable: false,
  },

  // 7. CCTP Min Fee Violation
  CCTP_MIN_FEE_VIOLATION: {
    category: 'VALIDATION',
    title: 'Transfer Amount Below CCTP Minimum',
    message: 'Bridge amount must exceed the CCTP relayer fee. Please enter at least 0.10 USDC.',
    isCanceled: false,
    isRetryable: false,
  },

  // 8. ERC-20 Allowance Needed
  INSUFFICIENT_ALLOWANCE: {
    category: 'CONTRACT_REVERT',
    title: 'Token Spending Approval Required',
    message: 'Token approval required. Please approve spending allowance in your wallet.',
    isCanceled: false,
    isRetryable: true,
  },

  // 9. Circle AppKit Treasury / Recipient Chain Mismatch
  TREASURY_RECIPIENT_MISMATCH: {
    category: 'VALIDATION',
    title: 'Treasury Recipient Format Mismatch',
    message: 'Fee recipient format mismatch. Verify the treasury address matches the source chain.',
    isCanceled: false,
    isRetryable: false,
  },

  // 10. Wallet / RPC Desync (-32603)
  WALLET_RPC_DESYNC: {
    category: 'WALLET_DESYNC',
    title: 'Wallet Nonce Desynchronization',
    message: 'Wallet transaction queue is desynced with network. Wait a few seconds and try again.',
    isCanceled: false,
    isRetryable: true,
  },

  // 11. Network Timeout
  NETWORK_TIMEOUT: {
    category: 'RPC_NETWORK',
    title: 'Network Timeout',
    message: 'Network request timed out. Please check your connection and try again.',
    isCanceled: false,
    isRetryable: true,
  },

  // 11b. RPC Rate / Request Limit Exceeded (-32005 / LimitExceededRpcError)
  RPC_LIMIT_EXCEEDED: {
    category: 'RPC_NETWORK',
    title: 'Network Limit Reached',
    message: 'Network request limit reached. Please wait a few seconds and try again.',
    isCanceled: false,
    isRetryable: true,
  },

  // 12. Smart Contract Reverted
  CONTRACT_REVERT: {
    category: 'CONTRACT_REVERT',
    title: 'Contract Execution Reverted',
    message: 'Smart contract rejected the transaction. Review parameters and token allowances.',
    isCanceled: false,
    isRetryable: false,
  },

  // 13. Passkey / WebAuthn Errors
  PASSKEY_CANCELED: {
    category: 'PASSKEY_AUTH',
    title: 'Biometric Verification Canceled',
    message: 'Biometric confirmation was canceled or timed out. Please try again on your device.',
    isCanceled: true,
    isRetryable: true,
    isActionable: true,
  },
  PASSKEY_ALREADY_EXISTS: {
    category: 'PASSKEY_AUTH',
    title: 'Passkey Already Registered',
    message: 'Passkey is already registered on this device. Please log in instead of creating a new one.',
    isCanceled: false,
    isRetryable: false,
    isActionable: true,
  },
  PASSKEY_DOMAIN_MISMATCH: {
    category: 'PASSKEY_AUTH',
    title: 'Domain Security Mismatch',
    message: 'Passkey origin mismatch. Please ensure you access Arcis from an authorized domain.',
    isCanceled: false,
    isRetryable: false,
    isActionable: true,
  },
  PASSKEY_NOT_SUPPORTED: {
    category: 'PASSKEY_AUTH',
    title: 'Biometrics Not Supported',
    message: 'Device does not support passkeys. Enable biometrics or connect a Web3 wallet.',
    isCanceled: false,
    isRetryable: false,
    isActionable: false,
  },
  CIRCLE_ENTITY_CONFIG_MISSING: {
    category: 'PASSKEY_AUTH',
    title: 'Circle Modular Config Missing',
    message: 'Modular Config incomplete. Register your domain in Circle Console > Modular Wallets.',
    isCanceled: false,
    isRetryable: false,
    isActionable: true,
  },
  CLIENT_KEY_UNAUTHORIZED: {
    category: 'PASSKEY_AUTH',
    title: 'Circle Client Key Unauthorized',
    message: 'Domain unauthorized. Add this origin to Allowed Domains in Circle Developer Console.',
    isCanceled: false,
    isRetryable: false,
    isActionable: true,
  },
  PAYMASTER_SPONSORSHIP_ERROR: {
    category: 'PASSKEY_AUTH',
    title: 'Gas Station Sponsorship Error',
    message: 'Gas Station could not sponsor gas. Check your balance in Circle Console.',
    isCanceled: false,
    isRetryable: true,
    isActionable: true,
  },
  WEBAUTHN_PROTOCOL_BAD_REQUEST: {
    category: 'PASSKEY_AUTH',
    title: 'WebAuthn Protocol Error',
    message: 'WebAuthn protocol error. Ensure the domain in Circle Console excludes ports or protocols.',
    isCanceled: false,
    isRetryable: true,
    isActionable: true,
  },
  NO_STORED_PASSKEY: {
    category: 'PASSKEY_AUTH',
    title: 'No Stored Passkey Found',
    message: 'No registered passkey on this device. Click "Create New Passkey" to register.',
    isCanceled: false,
    isRetryable: true,
    isActionable: true,
  },
  UNKNOWN_PASSKEY_ERROR: {
    category: 'PASSKEY_AUTH',
    title: 'Passkey Operation Failed',
    message: 'Biometric verification failed. Please refresh the page and try again.',
    isCanceled: false,
    isRetryable: true,
    isActionable: true,
  },

  // 14. Validation Errors
  VALIDATION_SAME_TOKEN: {
    category: 'VALIDATION',
    title: 'Identical Tokens Selected',
    message: 'Source and destination tokens must be different. Select a different token to trade.',
    isCanceled: false,
    isRetryable: false,
  },
  VALIDATION_INVALID_AMOUNT: {
    category: 'VALIDATION',
    title: 'Invalid Amount',
    message: 'Please enter a valid amount greater than zero.',
    isCanceled: false,
    isRetryable: false,
  },
  VALIDATION_INVALID_ADDRESS: {
    category: 'VALIDATION',
    title: 'Invalid Recipient Address',
    message: 'Invalid recipient address format. Provide a valid 0x EVM or Solana address.',
    isCanceled: false,
    isRetryable: false,
  },
  VALIDATION_SELF_TRANSFER: {
    category: 'VALIDATION',
    title: 'Identical Recipient Address',
    message: 'Destination address is identical to connected wallet. Specify a different address.',
    isCanceled: false,
    isRetryable: false,
  },

  // 15. Default Unknown Fallback
  UNKNOWN_ERROR: {
    category: 'UNKNOWN',
    title: 'Transaction Failed',
    message: 'Transaction failed on blockchain. Check your balance and network status before retrying.',
    isCanceled: false,
    isRetryable: true,
  },
}
