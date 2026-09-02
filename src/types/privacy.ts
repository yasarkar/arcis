export type PrivacyLevel = 'public' | 'private' | 'selective';

export interface PrivacySettings {
  level: PrivacyLevel;
  hiddenChains: string[]; // Chain IDs that should be hidden in 'selective' mode
  autoHideBalances: boolean;
  encryptTransactions: boolean;
  maskSymbol: string;
}

export interface TransactionPrivacyConfig {
  isPrivate: boolean;
  hideAmount: boolean;
  hideRecipient: boolean;
  hideSourceChain: boolean;
  hideDestinationChain: boolean;
}

export const DEFAULT_PRIVACY_SETTINGS: PrivacySettings = {
  level: 'public',
  hiddenChains: [],
  autoHideBalances: false,
  encryptTransactions: false,
  maskSymbol: '••••',
};
