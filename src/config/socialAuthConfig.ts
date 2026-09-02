// src/config/socialAuthConfig.ts
// Social OAuth Authentication Configuration & Client ID Validation for Circle UCW

export type SocialProvider = 'google' | 'apple' | 'facebook'

export interface SocialProviderInfo {
  id: SocialProvider
  name: string
  envKey: string
  isConfigured: boolean
  clientId: string
  helpMessage: string
  docUrl: string
}

function isValidConfigKey(key: string | undefined): boolean {
  if (!key) return false
  const trimmed = key.trim()
  if (trimmed.length < 5) return false
  if (trimmed.startsWith('YOUR_') || trimmed.startsWith('your_') || trimmed === 'undefined' || trimmed === 'null') {
    return false
  }
  return true
}

export function getSocialProviderInfo(provider: SocialProvider): SocialProviderInfo {
  const googleClientId = (import.meta.env.VITE_GOOGLE_CLIENT_ID as string || '').trim()
  const appleClientId = (import.meta.env.VITE_APPLE_CLIENT_ID as string || '').trim()
  const facebookAppId = (import.meta.env.VITE_FACEBOOK_APP_ID as string || '').trim()

  switch (provider) {
    case 'google': {
      const isConfigured = isValidConfigKey(googleClientId)
      return {
        id: 'google',
        name: 'Google',
        envKey: 'VITE_GOOGLE_CLIENT_ID',
        isConfigured,
        clientId: googleClientId,
        helpMessage: isConfigured
          ? 'Google OAuth kimliği hazır.'
          : 'Google ile giriş için VITE_GOOGLE_CLIENT_ID .env dosyasına eklenmeli ve Circle Developer Console > User-Controlled Wallets > Social Logins alanında Google OAuth yapılandırılmalıdır.',
        docUrl: 'https://developers.google.com/identity/gsi/web/guides/overview',
      }
    }
    case 'apple': {
      const isConfigured = isValidConfigKey(appleClientId)
      return {
        id: 'apple',
        name: 'Apple',
        envKey: 'VITE_APPLE_CLIENT_ID',
        isConfigured,
        clientId: appleClientId,
        helpMessage: isConfigured
          ? 'Apple Sign-In kimliği hazır.'
          : 'Apple ile giriş için VITE_APPLE_CLIENT_ID (Service ID) .env dosyasına eklenmeli ve Circle Developer Console üzerinde Apple OAuth yapılandırılmalıdır.',
        docUrl: 'https://developer.apple.com/sign-in-with-apple/',
      }
    }
    case 'facebook': {
      const isConfigured = isValidConfigKey(facebookAppId)
      return {
        id: 'facebook',
        name: 'Facebook',
        envKey: 'VITE_FACEBOOK_APP_ID',
        isConfigured,
        clientId: facebookAppId,
        helpMessage: isConfigured
          ? 'Facebook App ID hazır.'
          : 'Facebook ile giriş için VITE_FACEBOOK_APP_ID .env dosyasına eklenmeli ve Circle Developer Console üzerinde Facebook App ID yapılandırılmalıdır.',
        docUrl: 'https://developers.facebook.com/docs/development/create-an-app',
      }
    }
  }
}

export function isSocialProviderConfigured(provider: SocialProvider): boolean {
  return getSocialProviderInfo(provider).isConfigured
}

export function getAllSocialProviders(): SocialProviderInfo[] {
  return [
    getSocialProviderInfo('google'),
    getSocialProviderInfo('apple'),
    getSocialProviderInfo('facebook'),
  ]
}
