import { useState, useEffect, useCallback, useRef } from 'react';
import { getSocialProviderInfo } from '../config/socialAuthConfig';
import { normalizeCircleBlockchain } from '../utils/circleBlockchain';
import { isRealTxHash } from '../utils/ucwTxHash';

export interface UcwWalletInfo {
  id: string;
  address: string;
  blockchain: string;
  state: string;
  userToken?: string;
}

export interface ExecuteContractCallParams {
  contractAddress: string;
  abiFunctionSignature?: string;
  abiParameters?: any[];
  callData?: string;
  amount?: string;
  blockchain?: string;
  walletId?: string;
}

export interface SignTypedDataParams {
  data: any;
  memo?: string;
  blockchain?: string;
  walletId?: string;
}

export interface ExecuteTransferParams {
  destinationAddress: string;
  amount: string;
  tokenId?: string;
  tokenAddress?: string;
  tokenSymbol?: string;
  blockchain?: string;
  feeLevel?: 'LOW' | 'MEDIUM' | 'HIGH';
  walletId?: string;
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
  if (code === 155138 || msg.toLowerCase().includes('smtp') || msg.includes('email sending failed')) {
    return 'E-posta gönderim hatası: Circle Console üzerinde SMTP sağlayıcısı yapılandırılmamış olabilir.';
  }
  if (code === 155104 || String(code) === '155104') {
    return 'Oturum süreniz doldu (Geçersiz kullanıcı belirteci). Lütfen yeniden giriş yapın.';
  }
  if (code === 155101 || String(code) === '155101') {
    return 'Cihaz oturumu bulunamadı. Lütfen sayfayı yenileyip tekrar deneyin.';
  }
  if (code === 155130 || String(code) === '155130') {
    return 'Doğrulama kodunun (OTP) süresi doldu. Lütfen yeni bir kod isteyin.';
  }
  if (code === 155131 || String(code) === '155131') {
    return 'Geçersiz doğrulama kodu belirteci. Lütfen yeni bir kod isteyin.';
  }
  if (code === 155133 || String(code) === '155133') {
    return 'Girdiğiniz doğrulama kodu geçersiz. Lütfen 6 haneli kodu kontrol edin.';
  }
  if (code === 155134 || String(code) === '155134') {
    return 'Doğrulama kodu eşleşmedi. Lütfen e-postanıza gelen kodu doğru girdiğinizden emin olun.';
  }
  if (code === 155146 || String(code) === '155146') {
    return '3 hatalı deneme nedeniyle güvenlik kilidi uygulandı. Lütfen yeni bir doğrulama kodu talep edin.';
  }
  if (code === 155106 || String(code) === '155106') {
    return 'Kullanıcı hesabı zaten tanımlı.';
  }
  return msg || 'İşlem sırasında bir hata oluştu.';
}

/**
 * The Circle user token for the life of this tab.
 *
 * It authorizes challenge signing on the user's wallet, so it is deliberately
 * NOT persisted in browser storage: it lives here, and the API mirrors it into a
 * signed httpOnly cookie (`/api/ucw?action=establishSession`) that no script on
 * this origin can read. Server-side wallet operations therefore resolve the token
 * from the cookie, and this memory copy is only a convenience for the calls this
 * tab makes itself.
 *
 * `encryptionKey` is different and stays in storage: Circle's own web SDK needs
 * it *in the browser* to run `setAuthentication(...)`/`execute(...)` for a user
 * challenge, so it cannot be moved behind an httpOnly cookie without replacing
 * the wallet architecture.
 */
let ucwSessionUserToken = ''
/**
 * Device tokens for Circle's social-login re-auth, held in this tab's memory.
 * They are credentials as well, so they follow the same rule as the user token:
 * memory plus the session cookie, never browser storage.
 */
let ucwSessionDeviceToken = ''
let ucwSessionDeviceEncryptionKey = ''

/** Mirrors the session into the API's httpOnly cookie. Never throws. */
async function persistUcwSession(payload: {
  userToken?: string;
  encryptionKey?: string;
  walletId?: string;
  address?: string;
  deviceToken?: string;
  deviceEncryptionKey?: string;
}): Promise<boolean> {
  try {
    const res = await fetch('/api/ucw?action=establishSession', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    return Boolean(res.ok && data?.success)
  } catch {
    // The cookie is an optimization over the in-memory token: a failure here must
    // not break a login that already succeeded.
    return false
  }
}

/** Drops the server-side session cookie (best effort). */
async function clearUcwSession(): Promise<void> {
  try {
    await fetch('/api/ucw?action=clearSession', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
  } catch {
    // Ignore: the local state is cleared by the caller regardless.
  }
}

/**
 * Removes the legacy credential keys an earlier build left in localStorage.
 * Called after the session has been re-established from them, so a returning user
 * is migrated instead of logged out.
 */
function purgeLegacyUcwCredentials(): void {
  if (typeof window === 'undefined') return
  localStorage.removeItem('arc_ucw_user_token')
  localStorage.removeItem('arc_ucw_device_token')
  localStorage.removeItem('arc_ucw_device_encryption_key')
}

/**
 * Whether this tab may restore a UCW identity on load. The token is no longer in
 * storage, so the address + expiry are the local evidence; the API's cookie is
 * the authority and `getSession` reconciles the two on mount.
 */
function isStoredTokenValid(): boolean {
  if (typeof window === 'undefined') return false;
  const address = localStorage.getItem('arc_ucw_address');
  const expiresAt = Number(localStorage.getItem('arc_ucw_token_expires_at') || 0);
  if (!address) return false;
  if (Date.now() > expiresAt) {
    // Session expired, purge stale storage
    localStorage.removeItem('arc_ucw_address');
    localStorage.removeItem('arc_ucw_encryption_key');
    localStorage.removeItem('arc_ucw_auth_method');
    localStorage.removeItem('arc_ucw_token_expires_at');
    purgeLegacyUcwCredentials();
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
    return isInitialValid ? ucwSessionUserToken : '';
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
  const [deviceId, setDeviceId] = useState<string>(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('arc_ucw_device_id') || '';
    }
    return '';
  });

  const circleAppId = import.meta.env.VITE_CIRCLE_APP_ID || '';

  const sdkRef = useRef<any>(null);
  const initPromiseRef = useRef<Promise<any> | null>(null);
  const onLoginCompleteRef = useRef<((err: unknown, result: unknown) => void) | null>(null);

  /**
   * Restores this tab's UCW session on load.
   *
   * Two steps, in order:
   *   1. Migration — a build before the session cookie left `arc_ucw_user_token`
   *      in localStorage. Re-establish the cookie from it once, then delete it, so
   *      a returning user is migrated instead of logged out.
   *   2. Rehydration — the token itself is not in storage, so ask the API (which
   *      reads its own httpOnly cookie) for it and keep it in memory only.
   */
  useEffect(() => {
    if (typeof window === 'undefined') return
    let cancelled = false

    const restoreSession = async () => {
      const legacyToken = localStorage.getItem('arc_ucw_user_token')
      if (legacyToken) {
        ucwSessionUserToken = legacyToken
        setUserToken(legacyToken)
        await persistUcwSession({
          userToken: legacyToken,
          encryptionKey: localStorage.getItem('arc_ucw_encryption_key') || undefined,
          address: localStorage.getItem('arc_ucw_address') || undefined,
        })
        purgeLegacyUcwCredentials()
      }

      if (cancelled || ucwSessionUserToken) return
      if (!isStoredTokenValid()) return

      try {
        const res = await fetch('/api/ucw?action=issueSessionToken', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        })
        const data = await res.json().catch(() => ({}))
        if (cancelled || !res.ok || !data?.success || typeof data.userToken !== 'string' || !data.userToken) {
          return
        }
        ucwSessionUserToken = data.userToken
        setUserToken(data.userToken)
        if (typeof data.encryptionKey === 'string' && data.encryptionKey) setEncryptionKey(data.encryptionKey)
        if (typeof data.address === 'string' && data.address) setUcwAddress(data.address)
      } catch {
        // Offline: the tab keeps the identity-only state and the next request to
        // an authenticated action will report that the session is gone.
      }
    }

    void restoreSession()
    return () => {
      cancelled = true
    }
  }, [])

  // Circle Official Authentication Completion Callback (for Social & Email OTP)
  const onLoginComplete = useCallback(async (err: unknown, result: unknown) => {
    if (err) {
      console.error("[Circle UCW] Auth Callback Error:", err);
      const userFriendlyMsg = parseCircleAuthError(err);
      setError(userFriendlyMsg);
      setAuthPhase('error');
      setIsLoading(false);
      return;
    }

    if (result && typeof result === 'object') {
      const { userToken: uToken, encryptionKey: eKey } = result as { userToken: string; encryptionKey: string };
      if (uToken && eKey) {
        console.log("[Circle UCW] OTP Verification successful! Starting wallet initialization...");
        setAuthPhase('creating_wallet');
        setIsLoading(true);
        setUserToken(uToken);
        setEncryptionKey(eKey);
        // Memory + httpOnly cookie for the token; only the SDK key (which Circle's
        // web SDK must read in the browser) stays in storage.
        ucwSessionUserToken = uToken;
        void persistUcwSession({ userToken: uToken, encryptionKey: eKey });
        localStorage.setItem('arc_ucw_encryption_key', eKey);
        localStorage.setItem('arc_ucw_token_expires_at', String(Date.now() + UCW_TOKEN_EXPIRY_MS));

        // Initialize User & Wallets
        try {
          // Allow Circle's OTP verification iframe to cleanly unmount before next challenge
          await new Promise((r) => setTimeout(r, 600));

          console.log("[Circle UCW] Initializing user via backend...");
          const initRes = await fetch('/api/ucw?action=initializeUser', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userToken: uToken }),
          });
          const initData = await initRes.json();
          console.log("[Circle UCW] initializeUser response:", initData);

          const targetSdk = sdkRef.current || sdkInstance;

          if (initData.success && initData.challengeId && targetSdk) {
            console.log("[Circle UCW] User requires wallet creation challenge. Executing challengeId:", initData.challengeId);
            targetSdk.setAuthentication({ userToken: uToken, encryptionKey: eKey });

            await new Promise<void>((resolve, reject) => {
              targetSdk.execute(initData.challengeId, (cErr: any) => {
                if (cErr) {
                  console.error("[Circle UCW] Challenge execution error:", cErr);
                  const msg = parseCircleAuthError(cErr);
                  setError(msg);
                  setAuthPhase('error');
                  setIsLoading(false);
                  reject(new Error(msg));
                  return;
                }
                console.log("[Circle UCW] Challenge executed successfully!");
                resolve();
              });
            });
          }

          // Fetch user wallets and ensure an Arc Testnet wallet exists
          console.log("[Circle UCW] Fetching user wallets...");
          const wRes = await fetch('/api/ucw?action=getUserWallets', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userToken: uToken }),
          });
          const wData = await wRes.json();
          console.log("[Circle UCW] getUserWallets response:", wData);

          const arcWallet = (wData.wallets || []).find((w: any) =>
            w.blockchain?.toUpperCase().includes('ARC')
          );
          let walletAddr = arcWallet?.address || wData.wallets?.[0]?.address;

          // If user exists but has no wallet created on Arc Testnet yet, create one
          if (!arcWallet) {
            console.log("[Circle UCW] No wallet found for user on Arc Testnet. Requesting createUserWallet on ARC-TESTNET...");
            const cwRes = await fetch('/api/ucw?action=createUserWallet', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ userToken: uToken, blockchain: 'ARC-TESTNET' }),
            });
            const cwData = await cwRes.json();
            console.log("[Circle UCW] createUserWallet response:", cwData);

            if (cwData.success && cwData.challengeId && targetSdk) {
              targetSdk.setAuthentication({ userToken: uToken, encryptionKey: eKey });
              await new Promise<void>((resolve, reject) => {
                targetSdk.execute(cwData.challengeId, (cwErr: any) => {
                  if (cwErr) {
                    console.error("[Circle UCW] createUserWallet challenge error:", cwErr);
                    const msg = parseCircleAuthError(cwErr);
                    setError(msg);
                    setAuthPhase('error');
                    setIsLoading(false);
                    reject(new Error(msg));
                    return;
                  }
                  resolve();
                });
              });
            }

            // Refetch wallets to guarantee Arc wallet is loaded
            const retryWRes = await fetch('/api/ucw?action=getUserWallets', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ userToken: uToken }),
            });
            const retryWData = await retryWRes.json();
            const retryArcWallet = (retryWData.wallets || []).find((w: any) =>
              w.blockchain?.toUpperCase().includes('ARC')
            );
            walletAddr = retryArcWallet?.address || retryWData.wallets?.[0]?.address || cwData.address;
          }

          if (walletAddr) {
            console.log("[Circle UCW] ✅ Successfully resolved wallet address:", walletAddr);
            const savedMethod = (localStorage.getItem('arc_ucw_auth_method') as AuthMethodType) || 'email';
            setUcwAddress(walletAddr);
            setAuthMethod(savedMethod);
            setAuthPhase('success');
            localStorage.setItem('arc_ucw_address', walletAddr);
            localStorage.setItem('arc_ucw_auth_method', savedMethod);
            setIsLoading(false);
            setOtpStep('input');
          } else {
            console.warn("[Circle UCW] ❌ Could not obtain wallet address from Circle API.");
            setError("Circle servisinden cüzdan adresi alınamadı. Lütfen tekrar deneyin.");
            setAuthPhase('error');
            setIsLoading(false);
          }
        } catch (e: any) {
          console.error("[Circle UCW] Error setting up wallet after auth:", e);
          const msg = parseCircleAuthError(e);
          setError(msg);
          setAuthPhase('error');
          setIsLoading(false);
        }
      }
    }
  }, [sdkInstance]);

  // Keep latest onLoginComplete callback reference
  useEffect(() => {
    onLoginCompleteRef.current = onLoginComplete;
  }, [onLoginComplete]);

  // Asynchronous SDK Initializer with promise caching and non-blocking deviceId negotiation
  const initializeSdk = useCallback(async () => {
    if (!circleAppId) {
      console.error("VITE_CIRCLE_APP_ID is missing. Circle User-Controlled Wallets cannot initialize.");
      return null;
    }
    if (sdkRef.current) return sdkRef.current;
    if (initPromiseRef.current) return initPromiseRef.current;

    initPromiseRef.current = (async () => {
      try {
        const { W3SSdk } = await import('@circle-fin/w3s-pw-web-sdk');

        // From this tab's memory: a device token is a credential and is never
        // written to browser storage. A reload re-authenticates (which is what
        // refreshing a device token is for), so no restore path is needed here.
        const storedDeviceToken = ucwSessionDeviceToken;
        const storedDeviceEncryptionKey = ucwSessionDeviceEncryptionKey;

        const sdk = new W3SSdk(
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
          (err: unknown, result: unknown) => {
            if (onLoginCompleteRef.current) {
              onLoginCompleteRef.current(err, result);
            }
          }
        );

        // Instantly register SDK instance so methods can execute without waiting for iframe handshake
        sdkRef.current = sdk;
        setSdkInstance(sdk);

        // Preload cached deviceId if available
        const cachedDeviceId = localStorage.getItem('arc_ucw_device_id');
        if (cachedDeviceId) {
          setDeviceId(cachedDeviceId);
        }

        // Establish session with Circle iframe via getDeviceId with timeout guard
        try {
          const timeoutPromise = new Promise<string>((_, reject) =>
            setTimeout(() => reject(new Error('Iframe handshake timeout (check Brave Shields / AdBlock)')), 7000)
          );
          const dId = await Promise.race([sdk.getDeviceId(), timeoutPromise]);
          if (dId) {
            setDeviceId(dId);
            localStorage.setItem('arc_ucw_device_id', dId);
          }
        } catch (devErr: any) {
          console.warn("[Circle UCW] Note on getDeviceId handshake:", devErr?.message || devErr);
        }

        return sdk;
      } catch (err: any) {
        console.error("Failed to initialize Circle W3S Web SDK:", err);
        const msg = err?.message || "Circle Web SDK başlatılamadı. Reklam engelleyici veya Brave Shields kullanıyorsanız lütfen kapatın.";
        setError(msg);
        return null;
      } finally {
        initPromiseRef.current = null;
      }
    })();

    return initPromiseRef.current;
  }, [circleAppId]);

  // Ensure SDK is fully ready before triggering user interactions
  const ensureSdk = useCallback(async (): Promise<any> => {
    if (sdkRef.current) return sdkRef.current;
    if (initPromiseRef.current) {
      try {
        const sdk = await initPromiseRef.current;
        if (sdk) return sdk;
      } catch (e) {
        console.warn("[Circle UCW] Error awaiting SDK initialization promise:", e);
      }
    }
    return await initializeSdk();
  }, [initializeSdk]);

  // Initialize Web SDK on component mount
  useEffect(() => {
    initializeSdk();
  }, [initializeSdk]);

  // Step 1: Request Email OTP
  const requestEmailOtp = useCallback(async (email: string) => {
    setIsLoading(true);
    setAuthPhase('requesting');
    setError(null);
    try {
      if (!circleAppId) {
        const errMsg = 'VITE_CIRCLE_APP_ID ortam değişkenlerinde yapılandırılmamış (.env dosyasını kontrol edin).';
        setError(errMsg);
        setAuthPhase('error');
        setIsLoading(false);
        return { success: false, error: errMsg };
      }

      const activeSdk = sdkInstance || (await ensureSdk());
      if (!activeSdk) {
        const errMsg = 'Circle Web SDK başlatılamadı. Brave Shields veya Reklam Engelleyici (AdBlock) kullanıyorsanız lütfen devre dışı bırakıp sayfayı yenileyin.';
        setError(errMsg);
        setAuthPhase('error');
        setIsLoading(false);
        return { success: false, error: errMsg };
      }

      // Obtain current deviceId (cache -> state -> sdk fallback)
      let currentDeviceId = deviceId || localStorage.getItem('arc_ucw_device_id') || '';
      if (!currentDeviceId && typeof activeSdk.getDeviceId === 'function') {
        try {
          const timeoutPromise = new Promise<string>((_, reject) =>
            setTimeout(() => reject(new Error('Device ID handshake timeout')), 6000)
          );
          currentDeviceId = await Promise.race([activeSdk.getDeviceId(), timeoutPromise]);
          if (currentDeviceId) {
            localStorage.setItem('arc_ucw_device_id', currentDeviceId);
            setDeviceId(currentDeviceId);
          }
        } catch (e) {
          console.warn('[Circle UCW] Fallback getDeviceId attempt failed:', e);
        }
      }

      if (!currentDeviceId) {
        const errMsg = 'Circle güvenlik oturumu (iframe/deviceId) kurulamadı. Tarayıcınızda Brave Shields veya reklam engelleyici varsa devre dışı bırakıp sayfayı yenileyin.';
        setError(errMsg);
        setAuthPhase('error');
        setIsLoading(false);
        return { success: false, error: errMsg };
      }

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
      activeSdk.updateConfigs({
        appSettings: { appId: circleAppId },
        loginConfigs: {
          deviceToken: data.deviceToken,
          deviceEncryptionKey: data.deviceEncryptionKey,
          otpToken: data.otpToken,
        },
      });

      // Device tokens are credentials too: they go to the session cookie rather
      // than to browser storage.
      void persistUcwSession({
        userToken: userToken || ucwSessionUserToken,
        deviceToken: data.deviceToken,
        deviceEncryptionKey: data.deviceEncryptionKey,
      });

      // Launch Circle's hosted OTP input UI modal
      activeSdk.verifyOtp();

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
  }, [circleAppId, sdkInstance, deviceId, ensureSdk]);

  // Step 2: Fallback Verify Email OTP Code (In-App or Hosted UI completion)
  const verifyEmailOtpCode = useCallback(async (otpCode?: string) => {
    setIsLoading(true);
    setError(null);
    try {
      if (!circleAppId) {
        const errMsg = 'VITE_CIRCLE_APP_ID ortam değişkenlerinde yapılandırılmamış.';
        setError(errMsg);
        setAuthPhase('error');
        setIsLoading(false);
        return { success: false, error: errMsg };
      }

      const activeSdk = sdkInstance || (await ensureSdk());
      if (!activeSdk) {
        const errMsg = 'Circle Web SDK başlatılamadı. Lütfen sayfayı yenileyin.';
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
          throw new Error('Circle sisteminde bu kullanıcıya ait cüzdan adresi bulunamadı.');
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
      activeSdk.verifyOtp();
      setIsLoading(false);
      return { success: true };
    } catch (err: any) {
      const errMsg = parseCircleAuthError(err);
      setError(errMsg);
      setAuthPhase('error');
      setIsLoading(false);
      return { success: false, error: errMsg };
    }
  }, [circleAppId, sdkInstance, userToken, ensureSdk]);

  // Helper to re-open the Circle verification window if closed or obscured
  const reopenOtpVerificationWindow = useCallback(() => {
    const activeSdk = sdkInstance || sdkRef.current;
    if (activeSdk) {
      try {
        activeSdk.verifyOtp();
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
      if (!circleAppId) {
        const errMsg = 'VITE_CIRCLE_APP_ID ortam değişkenlerinde yapılandırılmamış.';
        setError(errMsg);
        setIsLoading(false);
        return { success: false, error: errMsg };
      }

      const activeSdk = sdkInstance || (await ensureSdk());
      if (!activeSdk) {
        const errMsg = 'Circle Web SDK başlatılamadı. Brave Shields veya Reklam Engelleyici (AdBlock) kullanıyorsanız lütfen devre dışı bırakın.';
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
      ucwSessionUserToken = data.userToken;
      void persistUcwSession({ userToken: data.userToken, encryptionKey: data.encryptionKey });
      localStorage.setItem('arc_ucw_encryption_key', data.encryptionKey);
      localStorage.setItem('arc_ucw_token_expires_at', String(Date.now() + UCW_TOKEN_EXPIRY_MS));

      activeSdk.setAuthentication({
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
          activeSdk.execute(pinData.challengeId, async (err: any) => {
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
  }, [circleAppId, sdkInstance, ensureSdk]);

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

      if (!circleAppId) {
        const errMsg = 'VITE_CIRCLE_APP_ID ortam değişkenlerinde yapılandırılmamış.';
        setError(errMsg);
        setIsLoading(false);
        return { success: false, error: errMsg };
      }

      const activeSdk = sdkInstance || (await ensureSdk());
      if (!activeSdk) {
        const errMsg = 'Circle Web SDK başlatılamadı. Brave Shields veya Reklam Engelleyici (AdBlock) kullanıyorsanız lütfen devre dışı bırakın.';
        setError(errMsg);
        setIsLoading(false);
        return { success: false, error: errMsg };
      }

      // Step 1: Obtain deviceId if not set yet
      let currentDeviceId = deviceId || localStorage.getItem('arc_ucw_device_id') || '';
      if (!currentDeviceId && typeof activeSdk.getDeviceId === 'function') {
        try {
          const timeoutPromise = new Promise<string>((_, reject) =>
            setTimeout(() => reject(new Error('Device ID timeout')), 6000)
          );
          currentDeviceId = await Promise.race([activeSdk.getDeviceId(), timeoutPromise]);
          if (currentDeviceId) {
            localStorage.setItem('arc_ucw_device_id', currentDeviceId);
            setDeviceId(currentDeviceId);
          }
        } catch (devErr) {
          console.warn('[Circle UCW] Social login device ID retrieval failed:', devErr);
        }
      }

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

      // Device tokens for post-OAuth redirect restoration: kept in memory for this
      // tab and mirrored into the httpOnly session cookie, never in storage.
      ucwSessionDeviceToken = data.deviceToken;
      ucwSessionDeviceEncryptionKey = data.deviceEncryptionKey;
      void persistUcwSession({
        userToken: userToken || ucwSessionUserToken,
        deviceToken: data.deviceToken,
        deviceEncryptionKey: data.deviceEncryptionKey,
      });

      activeSdk.updateConfigs({
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
      if (typeof activeSdk.performLogin === 'function') {
        activeSdk.performLogin(sdkProvider);
      } else if (typeof activeSdk.performSocialLogin === 'function') {
        activeSdk.performSocialLogin(sdkProvider);
      }
      setIsLoading(false);
      return { success: true };
    } catch (err: any) {
      const errMsg = err.message || 'Social login error';
      setError(errMsg);
      setIsLoading(false);
      return { success: false, error: errMsg };
    }
  }, [circleAppId, sdkInstance, deviceId, ensureSdk]);

  // Helper: resolve the blockchain param through the shared fail-closed whitelist.
  // The previous substring heuristic collapsed unknown chains into ETH-SEPOLIA
  // (e.g. Unichain_Sepolia) and rewrote mainnet identifiers to their testnet
  // counterparts (ETH → ETH-SEPOLIA) — both sign the challenge on the wrong
  // chain. Unknown chains now throw, which each caller surfaces as
  // { success: false, error }.
  const normalizeCircleBlockchainParam = useCallback((bc?: string): string | undefined => {
    if (!bc) return undefined;
    return normalizeCircleBlockchain(bc);
  }, []);

  // Helper: Ensure user wallet exists on the target blockchain (auto-creates if missing)
  const ensureWalletForChain = useCallback(
    async (
      targetBlockchain: string,
      targetSdk: any,
      uToken: string,
      eKey: string
    ): Promise<boolean> => {
      try {
        console.log(`[Circle UCW] Ensuring wallet on ${targetBlockchain}...`);
        const cwRes = await fetch('/api/ucw?action=createUserWallet', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userToken: uToken, blockchain: targetBlockchain }),
        });
        const cwData = await cwRes.json();
        if (cwData.alreadyExists) {
          return true;
        }
        if (cwData.success && cwData.challengeId && targetSdk) {
          targetSdk.setAuthentication({ userToken: uToken, encryptionKey: eKey });
          await new Promise<void>((resolve, reject) => {
            targetSdk.execute(cwData.challengeId, (cwErr: any) => {
              if (cwErr) {
                reject(new Error(parseCircleAuthError(cwErr)));
                return;
              }
              resolve();
            });
          });
          return true;
        }
        return Boolean(cwData.success);
      } catch (err) {
        console.warn(`[Circle UCW] ensureWalletForChain failed for ${targetBlockchain}:`, err);
        return false;
      }
    },
    []
  );

  // Helper: Poll Circle API for broadcasted on-chain transaction hash
  const pollForTxHash = useCallback(
    async (
      uToken: string,
      challengeId?: string,
      walletId?: string,
      blockchain?: string
    ): Promise<string | undefined> => {
      const maxAttempts = 20;
      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        await new Promise((r) => setTimeout(r, 1800));
        try {
          const pollRes = await fetch('/api/ucw?action=getLatestTransaction', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              userToken: uToken,
              challengeId,
              walletId,
              blockchain,
            }),
          });
          const pollData = await pollRes.json();
          if (
            pollData.success &&
            pollData.txHash &&
            typeof pollData.txHash === 'string' &&
            pollData.txHash.startsWith('0x')
          ) {
            console.log(`[Circle UCW] Found txHash on attempt ${attempt}:`, pollData.txHash);
            return pollData.txHash;
          }
        } catch (pErr) {
          console.warn(`[Circle UCW] Poll txHash attempt ${attempt} warning:`, pErr);
        }
      }
      return undefined;
    },
    []
  );

  /**
   * Resolves the broadcast hash of a challenge that has already executed.
   *
   * This lives next to the session on purpose: fund-moving services receive it
   * as a callback instead of reading `arc_ucw_user_token` out of browser storage
   * themselves. Returns `undefined` while Circle has not published the hash yet;
   * callers must treat that as "still pending", never as success.
   */
  const pollChallengeTx = useCallback(
    async (challengeId?: string, blockchain?: string): Promise<string | undefined> => {
      // The API resolves the token from its own httpOnly cookie; this memory copy
      // is only what this tab still holds for the current session.
      const uToken = userToken || ucwSessionUserToken
      if (!challengeId) return undefined
      return pollForTxHash(uToken, challengeId, undefined, blockchain)
    },
    [userToken, pollForTxHash]
  )

  // ── Action: Execute Smart Contract Call via Circle Challenge ─────────
  const executeContractCall = useCallback(
    async (params: {
      contractAddress: string;
      abiFunctionSignature?: string;
      abiParameters?: any[];
      callData?: string;
      amount?: string;
      blockchain?: string;
      walletId?: string;
    }): Promise<{
      success: boolean;
      txHash?: string;
      /** The challenge executed, but Circle has not published the broadcast hash yet. */
      hashPending?: boolean;
      challengeId?: string;
      error?: string;
    }> => {
      try {
        const uToken = userToken || ucwSessionUserToken;
        const eKey =
          encryptionKey ||
          (typeof window !== 'undefined' ? localStorage.getItem('arc_ucw_encryption_key') || '' : '');

        if (!uToken || !eKey) {
          return {
            success: false,
            error: 'Oturum süresi doldu veya cüzdan bağlı değil. Lütfen yeniden giriş yapın.',
          };
        }




        const activeSdk = sdkRef.current || sdkInstance || (await ensureSdk());
        if (!activeSdk) {
          return { success: false, error: 'Circle Web SDK başlatılamadı.' };
        }

        const targetBlockchain = normalizeCircleBlockchainParam(params.blockchain) || 'ARC-TESTNET';

        const requestChallenge = async () => {
          const res = await fetch('/api/ucw?action=createContractExecution', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              userToken: uToken,
              contractAddress: params.contractAddress,
              abiFunctionSignature: params.abiFunctionSignature,
              abiParameters: params.abiParameters,
              callData: params.callData,
              amount: params.amount,
              blockchain: targetBlockchain,
              walletId: params.walletId,
            }),
          });
          return res.json();
        };

        let data = await requestChallenge();

        // Multi-chain auto-wallet provisioning if not yet initialized on target chain
        if (
          !data.success &&
          (data.code === 'NO_WALLET_FOR_BLOCKCHAIN' ||
            data.error?.includes('NO_WALLET_FOR_BLOCKCHAIN')) &&
          targetBlockchain
        ) {
          console.log(
            `[Circle UCW] No wallet exists for ${targetBlockchain}. Auto-creating multi-chain wallet...`
          );
          const created = await ensureWalletForChain(targetBlockchain, activeSdk, uToken, eKey);
          if (created) {
            console.log(
              `[Circle UCW] Multi-chain wallet created for ${targetBlockchain}. Retrying contract execution...`
            );
            data = await requestChallenge();
          }
        }

        if (!data.success || !data.challengeId) {
          return {
            success: false,
            error: data.error || 'Akıllı sözleşme çağrısı challenge oluşturulamadı.',
          };
        }

        // Execute challenge in Circle SDK iframe
        activeSdk.setAuthentication({ userToken: uToken, encryptionKey: eKey });

        await new Promise<void>((resolve, reject) => {
          activeSdk.execute(data.challengeId, (cErr: any) => {
            if (cErr) {
              const parsed = parseCircleAuthError(cErr);
              reject(new Error(parsed));
              return;
            }
            resolve();
          });
        });

        // Poll for the broadcasted on-chain transaction hash.
        const txHash = await pollForTxHash(uToken, data.challengeId, data.walletId, targetBlockchain);

        // Never hand callers a placeholder. `pending_<challengeId>` is not a transaction, and returning
        // it as `txHash` let callers report success with nothing verifiable on chain. Report the real
        // hash when Circle published one, otherwise surface the pending state explicitly.
        if (!isRealTxHash(txHash)) {
          return {
            success: true,
            hashPending: true,
            challengeId: data.challengeId,
          };
        }

        return {
          success: true,
          txHash,
        };
      } catch (err: any) {
        console.error('[Circle UCW] executeContractCall error:', err);
        const errMsg = err?.message || 'İşlem sırasında bir hata oluştu.';
        return { success: false, error: errMsg };
      }
    },
    [userToken, encryptionKey, sdkInstance, ensureSdk, normalizeCircleBlockchainParam, ensureWalletForChain, pollForTxHash]
  );

  // ── Action: Sign Typed Data (EIP-712) via Circle Challenge ───────────
  const signTypedData = useCallback(
    async (params: {
      data: any;
      memo?: string;
      blockchain?: string;
      walletId?: string;
    }): Promise<{ success: boolean; signature?: string; error?: string }> => {
      try {
        const uToken = userToken || ucwSessionUserToken;
        const eKey =
          encryptionKey ||
          (typeof window !== 'undefined' ? localStorage.getItem('arc_ucw_encryption_key') || '' : '');

        if (!uToken || !eKey) {
          return {
            success: false,
            error: 'Oturum süresi doldu veya cüzdan bağlı değil. Lütfen yeniden giriş yapın.',
          };
        }




        const activeSdk = sdkRef.current || sdkInstance || (await ensureSdk());
        if (!activeSdk) {
          return { success: false, error: 'Circle Web SDK başlatılamadı.' };
        }

        const targetBlockchain = normalizeCircleBlockchainParam(params.blockchain) || 'ARC-TESTNET';

        const requestChallenge = async () => {
          const res = await fetch('/api/ucw?action=signTypedData', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              userToken: uToken,
              data: params.data,
              memo: params.memo,
              blockchain: targetBlockchain,
              walletId: params.walletId,
            }),
          });
          return res.json();
        };

        let data = await requestChallenge();

        // Multi-chain auto-wallet provisioning if not yet initialized on target chain
        if (
          !data.success &&
          (data.code === 'NO_WALLET_FOR_BLOCKCHAIN' ||
            data.error?.includes('NO_WALLET_FOR_BLOCKCHAIN')) &&
          targetBlockchain
        ) {
          console.log(
            `[Circle UCW] No wallet exists for ${targetBlockchain}. Auto-creating wallet for signTypedData...`
          );
          const created = await ensureWalletForChain(targetBlockchain, activeSdk, uToken, eKey);
          if (created) {
            data = await requestChallenge();
          }
        }

        if (!data.success || !data.challengeId) {
          return {
            success: false,
            error: data.error || 'İmza isteği challenge oluşturulamadı.',
          };
        }

        // Execute challenge in Circle SDK iframe
        activeSdk.setAuthentication({ userToken: uToken, encryptionKey: eKey });

        const signResult = await new Promise<{ success: boolean; signature?: string; error?: string }>(
          (resolve) => {
            activeSdk.execute(data.challengeId, (cErr: any, cResult: any) => {
              if (cErr) {
                const parsed = parseCircleAuthError(cErr);
                resolve({ success: false, error: parsed });
                return;
              }

              const rawSig =
                cResult?.signature ||
                cResult?.data?.signature ||
                cResult?.data?.signatureString ||
                (typeof cResult === 'string' && cResult.startsWith('0x') ? cResult : undefined);

              if (rawSig) {
                resolve({ success: true, signature: rawSig });
              } else {
                const fallbackSig = cResult?.signature || cResult?.data;
                resolve({
                  success: true,
                  signature: typeof fallbackSig === 'string' ? fallbackSig : JSON.stringify(fallbackSig),
                });
              }
            });
          }
        );

        return signResult;
      } catch (err: any) {
        console.error('[Circle UCW] signTypedData error:', err);
        const errMsg = err?.message || 'İmzalama sırasında bir hata oluştu.';
        return { success: false, error: errMsg };
      }
    },
    [userToken, encryptionKey, sdkInstance, ensureSdk, normalizeCircleBlockchainParam, ensureWalletForChain]
  );

  // ── Action: Execute Direct Token Transfer via Circle Challenge ───────
  const executeTransfer = useCallback(
    async (params: {
      destinationAddress: string;
      amount: string;
      tokenId?: string;
      tokenAddress?: string;
      tokenSymbol?: string;
      blockchain?: string;
      feeLevel?: 'LOW' | 'MEDIUM' | 'HIGH';
      walletId?: string;
    }): Promise<{
      success: boolean;
      txHash?: string;
      /** The challenge executed, but Circle has not published the broadcast hash yet. */
      hashPending?: boolean;
      challengeId?: string;
      error?: string;
    }> => {
      try {
        const uToken = userToken || ucwSessionUserToken;
        const eKey =
          encryptionKey ||
          (typeof window !== 'undefined' ? localStorage.getItem('arc_ucw_encryption_key') || '' : '');

        if (!uToken || !eKey) {
          return {
            success: false,
            error: 'Oturum süresi doldu veya cüzdan bağlı değil. Lütfen yeniden giriş yapın.',
          };
        }




        const activeSdk = sdkRef.current || sdkInstance || (await ensureSdk());
        if (!activeSdk) {
          return { success: false, error: 'Circle Web SDK başlatılamadı.' };
        }

        const targetBlockchain = normalizeCircleBlockchainParam(params.blockchain) || 'ARC-TESTNET';

        const requestChallenge = async () => {
          const res = await fetch('/api/ucw?action=createTransfer', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              userToken: uToken,
              destinationAddress: params.destinationAddress,
              amount: params.amount,
              tokenId: params.tokenId,
              tokenAddress: params.tokenAddress,
              tokenSymbol: params.tokenSymbol,
              blockchain: targetBlockchain,
              feeLevel: params.feeLevel || 'MEDIUM',
              walletId: params.walletId,
            }),
          });
          return res.json();
        };

        let data = await requestChallenge();

        // Multi-chain auto-wallet provisioning if not yet initialized on target chain
        if (
          !data.success &&
          (data.code === 'NO_WALLET_FOR_BLOCKCHAIN' ||
            data.error?.includes('NO_WALLET_FOR_BLOCKCHAIN')) &&
          targetBlockchain
        ) {
          console.log(
            `[Circle UCW] No wallet exists for ${targetBlockchain}. Auto-creating wallet for transfer...`
          );
          const created = await ensureWalletForChain(targetBlockchain, activeSdk, uToken, eKey);
          if (created) {
            data = await requestChallenge();
          }
        }

        if (!data.success || !data.challengeId) {
          return {
            success: false,
            error: data.error || 'Transfer challenge oluşturulamadı.',
          };
        }

        // Execute challenge in Circle SDK iframe
        activeSdk.setAuthentication({ userToken: uToken, encryptionKey: eKey });

        await new Promise<void>((resolve, reject) => {
          activeSdk.execute(data.challengeId, (cErr: any) => {
            if (cErr) {
              const parsed = parseCircleAuthError(cErr);
              reject(new Error(parsed));
              return;
            }
            resolve();
          });
        });

        // Poll for the broadcasted on-chain transaction hash.
        const txHash = await pollForTxHash(uToken, data.challengeId, data.walletId, targetBlockchain);

        // Same rule as executeContractCall: never hand callers a fabricated `pending_<challengeId>`
        // hash. The send UI rendered it as a real explorer link and a "success" receipt.
        if (!isRealTxHash(txHash)) {
          return {
            success: true,
            hashPending: true,
            challengeId: data.challengeId,
          };
        }

        return {
          success: true,
          txHash,
        };
      } catch (err: any) {
        console.error('[Circle UCW] executeTransfer error:', err);
        const errMsg = err?.message || 'Transfer sırasında bir hata oluştu.';
        return { success: false, error: errMsg };
      }
    },
    [userToken, encryptionKey, sdkInstance, ensureSdk, normalizeCircleBlockchainParam, ensureWalletForChain, pollForTxHash]
  );

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
    localStorage.removeItem('arc_ucw_encryption_key');
    localStorage.removeItem('arc_ucw_auth_method');
    localStorage.removeItem('arc_ucw_token_expires_at');
    ucwSessionUserToken = '';
    // Drop the server session too, so a signed-out tab cannot keep acting for the
    // wallet through the cookie alone.
    void clearUcwSession();
    purgeLegacyUcwCredentials();
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
    isSdkReady: Boolean(sdkInstance || sdkRef.current),
    requestEmailOtp,
    verifyEmailOtpCode,
    reopenOtpVerificationWindow,
    cleanupIframe,
    loginWithEmail,
    loginWithPin,
    loginWithSocial,
    executeContractCall,
    signTypedData,
    executeTransfer,
    pollChallengeTx,
    disconnectUcw,
    setOtpStep,
    setAuthPhase,
  };
}



