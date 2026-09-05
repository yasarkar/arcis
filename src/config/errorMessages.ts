// src/config/errorMessages.ts
// Standardized Web3 Error Messages Dictionary for Arcis Protocol (100% English)

import type { ErrorCategory } from '../types/errors'

export interface ErrorDefinition {
  category: ErrorCategory
  title: string
  message: string
  actionHint?: string
  isCanceled: boolean
  isRetryable: boolean
}

export const ERROR_DEFINITIONS: Record<string, ErrorDefinition> = {
  // 1. User Cancellation
  USER_CANCELED: {
    category: 'WALLET_REJECTION',
    title: 'Transaction Canceled',
    message: 'You canceled the confirmation request in your wallet. No balance was deducted.',
    actionHint: 'Click the action button again whenever you are ready to confirm.',
    isCanceled: true,
    isRetryable: true,
  },

  // 2. Arc L1 USDC Gas Floor Violation
  GAS_PRICE_UNDERPRICED: {
    category: 'INSUFFICIENT_GAS',
    title: 'Gas Price Below Protocol Floor',
    message: 'Arc L1 Testnet enforces a minimum base fee of 20 Gwei ($0.000000020 USDC/gas). Your wallet proposed a gas price below this threshold.',
    actionHint: 'Please select "Fast" or "Turbo" speed tier in the speed selector to meet the minimum fee.',
    isCanceled: false,
    isRetryable: true,
  },

  // 3. Insufficient USDC on Arc L1 (Native Gas Token)
  INSUFFICIENT_USDC_FOR_GAS: {
    category: 'INSUFFICIENT_GAS',
    title: 'Insufficient USDC for Gas',
    message: 'On Arc L1, all transaction gas fees are settled natively in USDC instead of ETH. Your wallet does not hold sufficient USDC to cover gas.',
    actionHint: 'Claim free testnet USDC from the Circle Faucet or deposit USDC into your wallet.',
    isCanceled: false,
    isRetryable: false,
  },

  // 4. Insufficient Token Balance
  INSUFFICIENT_BALANCE: {
    category: 'INSUFFICIENT_BALANCE',
    title: 'Insufficient Balance',
    message: 'The requested transaction amount exceeds your available token balance.',
    actionHint: 'Enter a lower amount or top up your wallet with test tokens.',
    isCanceled: false,
    isRetryable: false,
  },

  // 5. Slippage Tolerance Exceeded
  SLIPPAGE_EXCEEDED: {
    category: 'SLIPPAGE_EXCEEDED',
    title: 'Slippage Tolerance Exceeded',
    message: 'The market price changed during transaction confirmation and exceeded your allowed slippage tolerance.',
    actionHint: 'Increase your slippage tolerance in settings or try again with smaller size.',
    isCanceled: false,
    isRetryable: true,
  },

  // 6. Liquidity Route Not Found
  NO_LIQUIDITY_ROUTE: {
    category: 'NO_ROUTE',
    title: 'No Active Liquidity Route',
    message: 'No testnet liquidity pool route was found for this token pair or specified amount.',
    actionHint: 'Try swapping USDC ↔ EURC or adjust the input amount.',
    isCanceled: false,
    isRetryable: false,
  },

  // 7. CCTP Min Fee Violation
  CCTP_MIN_FEE_VIOLATION: {
    category: 'VALIDATION',
    title: 'Transfer Amount Below CCTP Minimum',
    message: 'The bridge amount must be higher than the CCTP relayer forwarding fee (approximately 0.055 USDC).',
    actionHint: 'Please enter at least 0.10 USDC for cross-chain bridging.',
    isCanceled: false,
    isRetryable: false,
  },

  // 8. ERC-20 Allowance Needed
  INSUFFICIENT_ALLOWANCE: {
    category: 'CONTRACT_REVERT',
    title: 'Token Spending Approval Required',
    message: 'The smart contract requires an approved spending allowance for your tokens.',
    actionHint: 'Confirm the initial token approval request in your wallet.',
    isCanceled: false,
    isRetryable: true,
  },

  // 9. Circle AppKit Treasury / Recipient Chain Mismatch
  TREASURY_RECIPIENT_MISMATCH: {
    category: 'VALIDATION',
    title: 'Treasury Recipient Format Mismatch',
    message: 'Per Circle AppKit rules, the custom protocol fee recipient address must match the format of the source blockchain.',
    actionHint: 'Verify the treasury configuration matches EVM or Solana address format.',
    isCanceled: false,
    isRetryable: false,
  },

  // 10. Wallet / RPC Desync (MetaMask -32603)
  WALLET_RPC_DESYNC: {
    category: 'WALLET_DESYNC',
    title: 'Wallet Nonce Desynchronization',
    message: 'Your wallet internal transaction queue is out of sync with the network RPC node (Error -32603).',
    actionHint: 'Open MetaMask > Settings > Advanced > click "Clear activity tab data" to resync your transaction nonce.',
    isCanceled: false,
    isRetryable: true,
  },

  // 11. Network Timeout
  NETWORK_TIMEOUT: {
    category: 'RPC_NETWORK',
    title: 'Network Timeout',
    message: 'The Arc L1 RPC node did not respond in time or the network connection dropped.',
    actionHint: 'Check your internet connection and try submitting the transaction again.',
    isCanceled: false,
    isRetryable: true,
  },

  // 12. Smart Contract Reverted
  CONTRACT_REVERT: {
    category: 'CONTRACT_REVERT',
    title: 'Contract Execution Reverted',
    message: 'The blockchain smart contract rejected the transaction.',
    actionHint: 'Review transaction parameters and verify your token allowances.',
    isCanceled: false,
    isRetryable: false,
  },

  // 13. Passkey / WebAuthn Errors
  PASSKEY_CANCELED: {
    category: 'PASSKEY_AUTH',
    title: 'Biometric Verification Canceled',
    message: 'FaceID, TouchID, or Passkey confirmation was canceled or timed out.',
    actionHint: 'Click to try again and authenticate on your device.',
    isCanceled: true,
    isRetryable: true,
  },
  PASSKEY_ALREADY_EXISTS: {
    category: 'PASSKEY_AUTH',
    title: 'Passkey Already Registered',
    message: 'A passkey credential is already registered on this device and browser.',
    actionHint: 'Use "Login with FaceID" instead of creating a new passkey.',
    isCanceled: false,
    isRetryable: false,
  },
  PASSKEY_DOMAIN_MISMATCH: {
    category: 'PASSKEY_AUTH',
    title: 'Domain Security Mismatch',
    message: 'The WebAuthn passkey origin does not match the current domain (RP ID mismatch).',
    actionHint: 'Ensure you are accessing Arcis from an authorized domain.',
    isCanceled: false,
    isRetryable: false,
  },
  PASSKEY_NOT_SUPPORTED: {
    category: 'PASSKEY_AUTH',
    title: 'Biometrics Not Supported',
    message: 'Your device or browser does not support WebAuthn passkeys or no authenticator is configured.',
    actionHint: 'Enable Windows Hello, TouchID, or connect with a standard Web3 wallet.',
    isCanceled: false,
    isRetryable: false,
  },

  // 14. Validation Errors
  VALIDATION_SAME_TOKEN: {
    category: 'VALIDATION',
    title: 'Identical Tokens Selected',
    message: 'Source and destination tokens must be different for same-chain swaps.',
    actionHint: 'Select a different destination token to trade.',
    isCanceled: false,
    isRetryable: false,
  },
  VALIDATION_INVALID_AMOUNT: {
    category: 'VALIDATION',
    title: 'Invalid Amount',
    message: 'Please enter a valid amount greater than zero.',
    actionHint: 'Enter a numeric value above 0.00.',
    isCanceled: false,
    isRetryable: false,
  },
  VALIDATION_INVALID_ADDRESS: {
    category: 'VALIDATION',
    title: 'Invalid Recipient Address',
    message: 'The specified recipient address format is invalid.',
    actionHint: 'Provide a valid 0x EVM address (42 characters) or Solana public key.',
    isCanceled: false,
    isRetryable: false,
  },
  VALIDATION_SELF_TRANSFER: {
    category: 'VALIDATION',
    title: 'Identical Recipient Address',
    message: 'The destination address is identical to your connected wallet.',
    actionHint: 'Specify a different recipient address to proceed.',
    isCanceled: false,
    isRetryable: false,
  },

  // 15. Default Unknown Fallback
  UNKNOWN_ERROR: {
    category: 'UNKNOWN',
    title: 'Transaction Failed',
    message: 'The transaction could not be completed on the blockchain. Please verify parameters and try again.',
    actionHint: 'Check your balance and network status before retrying.',
    isCanceled: false,
    isRetryable: true,
  },
}
