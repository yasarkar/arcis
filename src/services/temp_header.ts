// src/services/modularWalletService.ts
// Circle Modular Wallets (ERC-4337 & ERC-6900) Engine with WebAuthn Passkey Authentication
// Supports Arc Testnet (5042002), Gas Station Paymaster, and REAL UserOps via Circle Bundler

import {
  createPublicClient,
  defineChain,
  http,
  type Hex,
  parseUnits,
} from 'viem'
import {
  type P256Credential,
  type WebAuthnAccount,
  createBundlerClient,
  toWebAuthnAccount,
} from 'viem/account-abstraction'
import {
  WebAuthnMode,
  toCircleSmartAccount,
  toModularTransport,
  toPasskeyTransport,
  toWebAuthnCredential,
  encodeTransfer,
  ContractAddress,
} from '@circle-fin/modular-wallets-core'
