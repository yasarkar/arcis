import { useState, useEffect, useCallback } from 'react';
import { getSocialProviderInfo } from '../config/socialAuthConfig';

export interface UcwWalletInfo {
  id: string;
  address: string;
  blockchain: string;
  state: string;
  userToken?: string;
}

export type AuthMethodType = 'google' | 'apple' | 'facebook' | 'email' | 'pin' | null;
export type AuthPhaseType = 'idle' | 'requesting' | 'awaiting_code' | 'creating_wallet' | 'success' | 'error';

const UCW_TOKEN_EXPIRY_MS = 55 * 60 * 1000; // 55 minutes validity

export function cleanupCircleIframe(): void {
  if (typeof document === 'undefined') return;
  const iframe = document.getElementById('sdkIframe');
  if (iframe && iframe.parentNode) {
    iframe.parentNode.removeChild(iframe);
  }
}

export function parseCircleAuthError(err: any): string {
  if (!err) return 'Bilinmeyen bir hata oluştu.';
  const msg = err?.message || (typeof err === 'string' ? err : JSON.stringify(err));
  const code = err?.code || err?.response?.data?.code || err?.statusCode || err?.status;

  if (code === 401 || String(code) === '401' || msg.includes('401') || msg.toLowerCase().includes('invalid credentials')) {
    return 'Circle API kimlik doğrulama hatası (401). Lütfen Circle API anahtarınızı (CIRCLE_API_KEY) kontrol edin.';
  }
  if (code === 429 || String(code) === '429' || msg.includes('429') || msg.toLowerCase().includes('rate limit')) {
    return 'Çok fazla istek gönderildi. Lütfen bir süre bekleyip tekrar deneyin.';
  }
  if (code === 155130 || msg.includes('155130')) {
    return 'Doğrulama kodunun süresi doldu. Lütfen yeni bir kod isteyin.';
  }
  if (code === 155131 || msg.includes('155131')) {
    return 'Geçersiz OTP doğrulama belirteci. Lütfen tekrar deneyin.';
  }
  if (code === 155133 || code === 155134 || msg.includes('155133') || msg.includes('155134')) {
    return 'Girilen doğrulama kodu hatalı. Lütfen e-postanızı kontrol edip tekrar deneyin.';
  }
  if (code === 155141 || code === 155146 || msg.includes('155146')) {
    return 'Çok fazla hatalı deneme yapıldı. Güvenlik nedeniyle hesap geçici olarak kilitlendi. Lütfen birkaç dakika sonra tekrar deneyin.';
  }
  if (code === 155138 || msg.toLowerCase().includes('smtp') || msg.includes('email sending failed')) {
    return 'E-posta gönderim hatası: Circle Console üzerinde SMTP sağlayıcısı yapılandırılmamış olabilir.';
  }
  return msg || 'OTP işlemi sırasında bir hata oluştu.';
}

function isStoredTokenValid(): boolean {
  if (typeof window === 'undefined') return false;
  const token = localStorage.getItem('arc_ucw_user_token');
  const expiresAt = Number(localStorage.getItem('arc_ucw_token_expires_at') || 0);
  if (!token) return false;
  if (Date.now() > expiresAt) {
    // Session expired, purge stale storage
    localStorage.removeItem('arc_ucw_address');
    localStorage.removeItem('arc_ucw_user_token');
    localStorage.removeItem('arc_ucw_encryption_key');
    localStorage.removeItem('arc_ucw_auth_method');
    localStorage.removeItem('arc_ucw_token_expires_at');
    return false;
  }
  return true;
}

export function useUserControlledWallet() {
  const isInitialValid = isStoredTokenValid();

  const [ucwAddress, setUcwAddress] = useState<string>(() => {
    return isInitialValid ? localStorage.getItem('arc_ucw_address') || '' : '';
  });
  const [userToken, setUserToken] = useState<string>(() => {
    return isInitialValid ? localStorage.getItem('arc_ucw_user_token') || '' : '';
  });
  const [encryptionKey, setEncryptionKey] = useState<string>(() => {
    return isInitialValid ? localStorage.getItem('arc_ucw_encryption_key') || '' : '';
  });
  const [authMethod, setAuthMethod] = useState<AuthMethodType>(() => {
    return isInitialValid ? ((localStorage.getItem('arc_ucw_auth_method') as AuthMethodType) || null) : null;
  });
  
  const [otpStep, setOtpStep] = useState<'input' | 'verify'>('input');
  const [authPhase, setAuthPhase] = useState<AuthPhaseType>('idle');
  const [pendingEmail, setPendingEmail] = useState<string>('');
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [sdkInstance, setSdkInstance] = useState<any>(null);
  const [deviceId, setDeviceId] = useState<string>('');

  const circleAppId = import.meta.env.VITE_CIRCLE_APP_ID || '';

  // Initialize Web SDK with Social Login & Email OTP Callback
  useEffect(() => {
    let mounted = true;
    async function initSdk() {
      if (!circleAppId) {
        console.error("VITE_CIRCLE_APP_ID is missing. Circle User-Controlled Wallets cannot initialize.");
        return;
      }
      try {
        const { W3SSdk } = await import('@circle-fin/w3s-pw-web-sdk');

        let sdk: any;

        // Circle Official Authentication Completion Callback (for Social & Email OTP)
        const onLoginComplete = async (err: unknown, result: unknown) => {
          if (err) {
            console.error("Circle Auth Callback Error:", err);
            const userFriendlyMsg = parseCircleAuthError(err);
            setError(userFriendlyMsg);
            setAuthPhase('error');
            setIsLoading(false);
            return;
          }

          if (result && typeof result === 'object') {
            const { userToken: uToken, encryptionKey: eKey } = result as { userToken: string; encryptionKey: string };
            if (uToken && eKey) {
              setAuthPhase('creating_wallet');
              setIsLoading(true);
              setUserToken(uToken);
              setEncryptionKey(eKey);
              localStorage.setItem('arc_ucw_user_token', uToken);
              localStorage.setItem('arc_ucw_encryption_key', eKey);
              localStorage.setItem('arc_ucw_token_expires_at', String(Date.now() + UCW_TOKEN_EXPIRY_MS));

              // Initialize User & Wallets
              try {
                const initRes = await fetch('/api/ucw?action=initializeUser', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ userToken: uToken }),
                });
                const initData = await initRes.json();

                const targetSdk = sdk || sdkInstance;

                if (initData.success && initData.challengeId && targetSdk) {
                  // User needs wallet creation via challenge execution
                  targetSdk.setAuthentication({ userToken: uToken, encryptionKey: eKey });
                  targetSdk.execute(initData.challengeId, async (cErr: any) => {
                    if (cErr) {
                      console.error("Challenge execution error:", cErr);
                      const msg = parseCircleAuthError(cErr);
                      setError(msg);
                      setAuthPhase('error');
                      setIsLoading(false);
                      return;
                    }
                    const wRes = await fetch('/api/ucw?action=getUserWallets', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ userToken: uToken }),
                    });
                    const wData = await wRes.json();
                    const walletAddr = wData.wallets?.[0]?.address;

                    if (mounted) {
                      if (walletAddr) {
                        setUcwAddress(walletAddr);
                        setAuthMethod('email');
                        setAuthPhase('success');
                        localStorage.setItem('arc_ucw_address', walletAddr);
                        localStorage.setItem('arc_ucw_auth_method', 'email');
                        setIsLoading(false);
                        setOtpStep('input');
                      } else {
                        setError("Circle servisinden cüzdan adresi alınamadı.");
                        setAuthPhase('error');
                        setIsLoading(false);
                      }
                    }
                  });
                } else {
                  // User already initialized (code 155106) or wallets ready
                  const wRes = await fetch('/api/ucw?action=getUserWallets', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ userToken: uToken }),
                  });
                  const wData = await wRes.json();
                  const walletAddr = wData.wallets?.[0]?.address;

                  if (mounted) {
                    if (walletAddr) {
                      setUcwAddress(walletAddr);
                      setAuthMethod('email');
                      setAuthPhase('success');
                      localStorage.setItem('arc_ucw_address', walletAddr);
                      localStorage.setItem('arc_ucw_auth_method', 'email');
                      setIsLoading(false);
                      setOtpStep('input');
                    } else {
                      setError("Kullanıcı için mevcut cüzdan bulunamadı.");
                      setAuthPhase('error');
                      setIsLoading(false);
                    }
                  }
                }
              } catch (e: any) {
                console.error("Error setting up wallet after auth:", e);
                const msg = parseCircleAuthError(e);
                setError(msg);
                setAuthPhase('error');
                setIsLoading(false);
              }
            }
          }
        };

        const storedDeviceToken = localStorage.getItem('arc_ucw_device_token') || '';
        const storedDeviceEncryptionKey = localStorage.getItem('arc_ucw_device_encryption_key') || '';

        sdk = new W3SSdk(
          {
            appSettings: { appId: circleAppId },
            loginConfigs: {
              deviceToken: storedDeviceToken,
              deviceEncryptionKey: storedDeviceEncryptionKey,
              google: {
                clientId: import.meta.env.VITE_GOOGLE_CLIENT_ID || '',
                redirectUri: window.location.origin,
                selectAccountPrompt: true,
              },
              facebook: {
                appId: import.meta.env.VITE_FACEBOOK_APP_ID || '',
                redirectUri: window.location.origin,
              },
              apple: {
                clientId: import.meta.env.VITE_APPLE_CLIENT_ID || '',
                redirectUri: window.location.origin,
              } as any,
            },
          },
          onLoginComplete
        );

        // MANDATORY: getDeviceId establishes session with Circle iframe
        const dId = await sdk.getDeviceId();
        if (mounted) {
          setDeviceId(dId);
          setSdkInstance(sdk);
        }
      } catch (err: any) {
        console.error("Failed to initialize Circle W3S Web SDK:", err);
        if (mounted) {
          setError(err.message || "Failed to initialize Circle Web SDK");
        }
      }
    }

    initSdk();
    return () => {
      mounted = false;
    };
  }, [circleAppId]);

  // Step 1: Request Email OTP
  const requestEmailOtp = useCallback(async (email: string) => {
    setIsLoading(true);
    setAuthPhase('requesting');
    setError(null);
    try {
      if (!circleAppId || !sdkInstance) {
        const errMsg = !circleAppId
          ? 'VITE_CIRCLE_APP_ID is not configured in environment.'
          : 'Circle Web SDK is not initialized yet.';
        setError(errMsg);
        setAuthPhase('error');
        setIsLoading(false);
        return { success: false, error: errMsg };
      }

      // Obtain current deviceId
      const currentDeviceId = deviceId || (await sdkInstance.getDeviceId());

      // Live flow: request device token & OTP token for email login via backend
      const res = await fetch('/api/ucw?action=requestEmailOtp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deviceId: currentDeviceId, email }),
      });
      const data = await res.json();
      if (!data.success) {
        const friendlyError = parseCircleAuthError(data);
        throw new Error(friendlyError || data.error || 'Failed to send Email OTP');
      }

      // Update SDK config with returned tokens
      sdkInstance.updateConfigs({
        appSettings: { appId: circleAppId },
        loginConfigs: {
          deviceToken: data.deviceToken,
          deviceEncryptionKey: data.deviceEncryptionKey,
          otpToken: data.otpToken,
        },
      });

      // Store device tokens for state continuity
      localStorage.setItem('arc_ucw_device_token', data.deviceToken);
      localStorage.setItem('arc_ucw_device_encryption_key', data.deviceEncryptionKey);

      // Launch Circle's hosted OTP input UI modal
      sdkInstance.verifyOtp();

      setPendingEmail(email);
      setOtpStep('verify');
      setAuthPhase('awaiting_code');
      setIsLoading(false);
      return { success: true };
    } catch (err: any) {
      const errMsg = parseCircleAuthError(err);
      setError(errMsg);
      setAuthPhase('error');
      setIsLoading(false);
      return { success: false, error: errMsg };
    }
  }, [circleAppId, sdkInstance, deviceId]);

  // Step 2: Fallback Verify Email OTP Code (In-App or Hosted UI completion)
  const verifyEmailOtpCode = useCallback(async (otpCode?: string) => {
    setIsLoading(true);
    setError(null);
    try {
      if (!circleAppId || !sdkInstance) {
        const errMsg = !circleAppId
          ? 'VITE_CIRCLE_APP_ID is not configured in environment.'
          : 'Circle Web SDK is not initialized yet.';
        setError(errMsg);
        setAuthPhase('error');
        setIsLoading(false);
        return { success: false, error: errMsg };
      }

      // If userToken is already populated via callback, finalize wallet
      if (userToken) {
        const wRes = await fetch('/api/ucw?action=getUserWallets', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userToken }),
        });
        const wData = await wRes.json();
        const address = wData.wallets?.[0]?.address;

        if (!address) {
          throw new Error('No wallet address found for the current user in Circle system');
        }

        setUcwAddress(address);
        setAuthMethod('email');
        setAuthPhase('success');
        localStorage.setItem('arc_ucw_address', address);
        localStorage.setItem('arc_ucw_auth_method', 'email');
        setIsLoading(false);
        setOtpStep('input');
        return { success: true, address };
      }

      // Trigger OTP modal iframe if not already visible
      sdkInstance.verifyOtp();
      setIsLoading(false);
      return { success: true };
    } catch (err: any) {
      const errMsg = parseCircleAuthError(err);
      setError(errMsg);
      setAuthPhase('error');
      setIsLoading(false);
      return { success: false, error: errMsg };
    }
  }, [circleAppId, sdkInstance, userToken]);

  // Helper to re-open the Circle verification window if closed or obscured
  const reopenOtpVerificationWindow = useCallback(() => {
    if (sdkInstance) {
      try {
        sdkInstance.verifyOtp();
        return true;
      } catch (e) {
        console.warn('[useUserControlledWallet] reopenOtpVerificationWindow error:', e);
      }
    }
    return false;
  }, [sdkInstance]);

  // Helper to cleanly remove Circle iframe from DOM on modal close or cancel
  const cleanupIframe = useCallback(() => {
    cleanupCircleIframe();
    setAuthPhase('idle');
  }, []);

  // Login via Email direct wrapper
  const loginWithEmail = useCallback(async (email: string) => {
    return requestEmailOtp(email);
  }, [requestEmailOtp]);

  // Login via PIN & Security Questions
  const loginWithPin = useCallback(async (userIdInput?: string) => {
    setIsLoading(true);
    setError(null);
    try {
      const uId = userIdInput || `user_${Date.now()}`;
      if (!circleAppId || !sdkInstance) {
        const errMsg = !circleAppId
          ? 'VITE_CIRCLE_APP_ID is not configured in environment.'
          : 'Circle Web SDK is not initialized yet.';
        setError(errMsg);
        setIsLoading(false);
        return { success: false, error: errMsg };
      }

      // Step 1: Create User Token
      const res = await fetch('/api/ucw?action=createUserToken', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: uId }),
      });
      const data = await res.json();
      if (!data.success) {
        throw new Error(data.error || 'Failed to generate user token');
      }

      setUserToken(data.userToken);
      setEncryptionKey(data.encryptionKey);
      localStorage.setItem('arc_ucw_user_token', data.userToken);
      localStorage.setItem('arc_ucw_encryption_key', data.encryptionKey);
      localStorage.setItem('arc_ucw_token_expires_at', String(Date.now() + UCW_TOKEN_EXPIRY_MS));

      sdkInstance.setAuthentication({
        userToken: data.userToken,
        encryptionKey: data.encryptionKey,
      });

      // Step 2: Request PIN challenge
      const pinRes = await fetch('/api/ucw?action=createPinWallet', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userToken: data.userToken }),
      });
      const pinData = await pinRes.json();

      if (pinData.success && pinData.challengeId) {
        return new Promise<{ success: boolean; address?: string; error?: string }>((resolve) => {
          sdkInstance.execute(pinData.challengeId, async (err: any) => {
            if (err) {
              const errMsg = err.message || 'Challenge failed';
              setError(errMsg);
              setIsLoading(false);
              resolve({ success: false, error: errMsg });
              return;
            }

            const wRes = await fetch('/api/ucw?action=getUserWallets', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ userToken: data.userToken }),
            });
            const wData = await wRes.json();
            const createdAddr = wData.wallets?.[0]?.address;

            if (!createdAddr) {
              const errMsg = 'No wallet address found after PIN challenge execution';
              setError(errMsg);
              setIsLoading(false);
              resolve({ success: false, error: errMsg });
              return;
            }

            setUcwAddress(createdAddr);
            setAuthMethod('pin');
            localStorage.setItem('arc_ucw_address', createdAddr);
            localStorage.setItem('arc_ucw_auth_method', 'pin');
            setIsLoading(false);
            resolve({ success: true, address: createdAddr });
          });
        });
      } else {
        throw new Error(pinData.error || 'Failed to create PIN challenge');
      }
    } catch (err: any) {
      const errMsg = err.message || 'PIN login failed';
      setError(errMsg);
      setIsLoading(false);
      return { success: false, error: errMsg };
    }
  }, [circleAppId, sdkInstance]);

  // Login via Social (Google / Apple / Facebook)
  const loginWithSocial = useCallback(async (provider: 'google' | 'apple' | 'facebook') => {
    setIsLoading(true);
    setError(null);
    try {
      // Step 0: Validate client ID configuration
      const providerInfo = getSocialProviderInfo(provider);
      if (!providerInfo.isConfigured) {
        console.warn(`[Circle UCW] ⚠️ ${providerInfo.name} OAuth is not configured: ${providerInfo.envKey} is missing in .env`);
        setError(providerInfo.helpMessage);
        setIsLoading(false);
        return { success: false, error: providerInfo.helpMessage };
      }

      setAuthMethod(provider);
      localStorage.setItem('arc_ucw_auth_method', provider);

      if (!circleAppId || !sdkInstance) {
        const errMsg = !circleAppId
          ? 'VITE_CIRCLE_APP_ID is not configured in environment.'
          : 'Circle Web SDK is not initialized yet.';
        setError(errMsg);
        setIsLoading(false);
        return { success: false, error: errMsg };
      }

      // Step 1: Obtain deviceId if not set yet
      const currentDeviceId = deviceId || (await sdkInstance.getDeviceId());

      // Step 2: Create device token for social login
      const res = await fetch('/api/ucw?action=createSocialDeviceToken', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deviceId: currentDeviceId }),
      });
      const data = await res.json();
      if (!data.success) {
        throw new Error(data.error || 'Failed to create social device token');
      }

      // Store device tokens for post-OAuth redirect restoration
      localStorage.setItem('arc_ucw_device_token', data.deviceToken);
      localStorage.setItem('arc_ucw_device_encryption_key', data.deviceEncryptionKey);

      sdkInstance.updateConfigs({
        appSettings: { appId: circleAppId },
        loginConfigs: {
          deviceToken: data.deviceToken,
          deviceEncryptionKey: data.deviceEncryptionKey,
          google: {
            clientId: providerInfo.id === 'google' ? providerInfo.clientId : (import.meta.env.VITE_GOOGLE_CLIENT_ID || ''),
            redirectUri: window.location.origin,
            selectAccountPrompt: true,
          },
          facebook: {
            appId: providerInfo.id === 'facebook' ? providerInfo.clientId : (import.meta.env.VITE_FACEBOOK_APP_ID || ''),
            redirectUri: window.location.origin,
          },
          apple: {
            clientId: providerInfo.id === 'apple' ? providerInfo.clientId : (import.meta.env.VITE_APPLE_CLIENT_ID || ''),
            redirectUri: window.location.origin,
          } as any,
        },
      });

      // Step 3: Trigger Social OAuth Redirect
      const providerMap: Record<string, string> = {
        google: 'Google',
        facebook: 'Facebook',
        apple: 'Apple',
      };
      const sdkProvider = providerMap[provider] || provider;
      if (typeof sdkInstance.performLogin === 'function') {
        sdkInstance.performLogin(sdkProvider);
      } else if (typeof sdkInstance.performSocialLogin === 'function') {
        sdkInstance.performSocialLogin(sdkProvider);
      }
      setIsLoading(false);
      return { success: true };
    } catch (err: any) {
      const errMsg = err.message || 'Social login error';
      setError(errMsg);
      setIsLoading(false);
      return { success: false, error: errMsg };
    }
  }, [circleAppId, sdkInstance, deviceId]);

  // Disconnect UCW
  const disconnectUcw = useCallback(() => {
    cleanupCircleIframe();
    setUcwAddress('');
    setUserToken('');
    setEncryptionKey('');
    setAuthMethod(null);
    setOtpStep('input');
    setAuthPhase('idle');
    setPendingEmail('');
    localStorage.removeItem('arc_ucw_address');
    localStorage.removeItem('arc_ucw_user_token');
    localStorage.removeItem('arc_ucw_encryption_key');
    localStorage.removeItem('arc_ucw_auth_method');
    localStorage.removeItem('arc_ucw_token_expires_at');
    localStorage.removeItem('arc_ucw_device_token');
    localStorage.removeItem('arc_ucw_device_encryption_key');
  }, []);

  return {
    ucwAddress,
    userToken,
    authMethod,
    authPhase,
    otpStep,
    pendingEmail,
    isUcwConnected: Boolean(ucwAddress),
    isLoading,
    error,
    requestEmailOtp,
    verifyEmailOtpCode,
    reopenOtpVerificationWindow,
    cleanupIframe,
    loginWithEmail,
    loginWithPin,
    loginWithSocial,
    disconnectUcw,
    setOtpStep,
    setAuthPhase,
  };
}



