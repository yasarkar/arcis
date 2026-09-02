// src/utils/passkeyErrorUtils.ts
// Comprehensive WebAuthn / Passkey Error Parser & Environment Inspector for Circle Modular Wallets

export interface ParsedPasskeyError {
  code: string
  title: string
  message: string
  isActionable: boolean
  actionHint?: string
}

/**
 * Checks whether the current browser and environment support WebAuthn / Passkeys.
 */
export function checkPasskeySupport(): {
  isSupported: boolean
  isSecureContext: boolean
  hasPublicKeyCredential: boolean
  reason?: string
} {
  if (typeof window === 'undefined') {
    return { isSupported: false, isSecureContext: false, hasPublicKeyCredential: false, reason: 'SSR Environment' }
  }

  const isSecureContext = window.isSecureContext === true
  const hasPublicKeyCredential = typeof window.PublicKeyCredential !== 'undefined'

  if (!isSecureContext) {
    return {
      isSupported: false,
      isSecureContext: false,
      hasPublicKeyCredential,
      reason: 'Passkey / WebAuthn güvenli bağlantı (HTTPS veya localhost) gerektirir.',
    }
  }

  if (!hasPublicKeyCredential) {
    return {
      isSupported: false,
      isSecureContext: true,
      hasPublicKeyCredential: false,
      reason: 'Tarayıcınız veya cihazınız WebAuthn (Passkey) standardını desteklemiyor.',
    }
  }

  return {
    isSupported: true,
    isSecureContext: true,
    hasPublicKeyCredential: true,
  }
}

/**
 * Parses raw WebAuthn, DOMExceptions, and Circle Modular SDK errors into human-friendly explanations.
 */
export function parsePasskeyError(err: any): ParsedPasskeyError {
  const errName = err?.name || ''
  const rawMsg = err?.message || String(err)
  const origin = typeof window !== 'undefined' ? window.location.origin : 'current domain'

  // 1. User Canceled / Biometrics Timed Out
  if (errName === 'NotAllowedError' || rawMsg.includes('NotAllowedError') || rawMsg.includes('canceled') || rawMsg.includes('timed out')) {
    return {
      code: 'USER_CANCELED',
      title: 'Biyometrik Doğrulama İptal Edildi',
      message: 'FaceID, TouchID veya Passkey doğrulaması kullanıcı tarafından iptal edildi ya da zaman aşımına uğradı.',
      isActionable: true,
      actionHint: 'Tekrar denemek için butona tıklayın ve cihaz onayını verin.',
    }
  }

  // 2. Already Registered on this Device
  if (errName === 'InvalidStateError' || rawMsg.includes('InvalidStateError') || rawMsg.includes('already exists')) {
    return {
      code: 'ALREADY_EXISTS',
      title: 'Cihazda Zaten Kayıtlı Passkey Var',
      message: 'Bu cihaz ve tarayıcıda kayıtlı bir Passkey zaten mevcut.',
      isActionable: true,
      actionHint: 'Yeni kayıt yerine "FaceID ile Giriş Yap" butonunu kullanabilirsiniz.',
    }
  }

  // 3. Security / Domain (RP ID) Mismatch
  if (errName === 'SecurityError' || rawMsg.includes('SecurityError') || rawMsg.includes('relying party') || rawMsg.includes('RP ID')) {
    return {
      code: 'SECURITY_DOMAIN_MISMATCH',
      title: 'Passkey Alan Adı (Domain) Uyuşmazlığı',
      message: `WebAuthn anahtarı bu etki alanı (${origin}) ile eşleşmiyor veya izinli değil.`,
      isActionable: true,
      actionHint: 'Circle Developer Console üzerinde geçerli alan adınızın yapılandırıldığından emin olun.',
    }
  }

  // 4. Not Supported or Device Constraint
  if (errName === 'NotSupportedError' || errName === 'ConstraintError' || rawMsg.includes('not supported')) {
    return {
      code: 'NOT_SUPPORTED',
      title: 'Cihaz / Tarayıcı Desteği Yok',
      message: 'Cihazınızda biyometrik kimlik doğrulayıcı (FaceID, Windows Hello, TouchID) etkinleştirilmemiş olabilir.',
      isActionable: false,
      actionHint: 'Cihaz ayarlarınızdan biyometrik kilidi açın veya farklı bir tarayıcı deneyin.',
    }
  }

  // 5. Circle Console Modular Entity Config Missing
  if (rawMsg.includes('Cannot find the entity config') || rawMsg.includes('entity config') || rawMsg.includes('EntityConfigNotFound')) {
    return {
      code: 'CIRCLE_ENTITY_CONFIG_MISSING',
      title: 'Circle Modular Wallets Alan Adı Yapılandırması Eksik',
      message: `Circle Console üzerinde bu alan adı (${origin}) için Modular Wallets Configurator henüz tamamlanmamış.`,
      isActionable: true,
      actionHint: 'Circle Console > Wallets > Modular Wallets > Configurator sekmesine giderek alan adınızı kaydedin.',
    }
  }

  // 6. Client Key / Origin Unauthorized
  if (rawMsg.includes('Invalid credentials') || rawMsg.includes('Unauthorized') || rawMsg.includes('401') || rawMsg.includes('403')) {
    return {
      code: 'CLIENT_KEY_UNAUTHORIZED',
      title: 'Circle Client Key Yetki Hatası',
      message: `Mevcut alan adı (${origin}), Circle Developer Console > API & Client Keys altındaki 'Allowed Domains' listesinde yer almıyor.`,
      isActionable: true,
      actionHint: 'Circle Console üzerinde bu origin adresini Allowed Domains listesine ekleyin.',
    }
  }

  // 7. Gas Station / Paymaster Error
  if (rawMsg.includes('AA21') || rawMsg.includes('paymaster') || rawMsg.includes('Gas Station') || rawMsg.includes('prefund')) {
    return {
      code: 'PAYMASTER_SPONSORSHIP_ERROR',
      title: 'Gas Station Sponsorluk Hatası',
      message: 'İşlem için Circle Gas Station gaz sponsorluğu sağlanamadı.',
      isActionable: true,
      actionHint: 'Circle Console > Gas Station testnet bakiyesini kontrol edin.',
    }
  }

  // 8. WebAuthn Protocol Bad Request (Domain format or unregistered credential)
  if (rawMsg.includes('Bad request for the Webauthn protocol') || rawMsg.includes('Webauthn protocol')) {
    return {
      code: 'WEBAUTHN_PROTOCOL_BAD_REQUEST',
      title: 'WebAuthn Protokol Hatası',
      message: 'WebAuthn protokolü isteği reddetti. Circle Console üzerinde Passkey Domain adı port ve protokol olmadan (sadece "localhost") girilmelidir.',
      isActionable: true,
      actionHint: '1) Circle Console > Modular Wallets > Passkey kısmındaki alan adını sadece "localhost" olarak güncelleyin. 2) İlk defa giriş yapıyorsanız "Yeni Passkey Aç" butonunu kullanın.',
    }
  }

  // 9. Generic / Unknown Error
  return {
    code: 'UNKNOWN_PASSKEY_ERROR',
    title: 'Passkey İşlemi Başarısız',
    message: rawMsg || 'Bilinmeyen bir biyometrik doğrulama hatası oluştu.',
    isActionable: true,
  }
}
