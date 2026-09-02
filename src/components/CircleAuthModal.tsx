import React, { useState, useEffect } from 'react'
import {
  X,
  Mail,
  Shield,
  Sparkles,
  CheckCircle2,
  AlertCircle,
  ArrowRight,
  KeyRound,
  Key,
  RefreshCw,
  Fingerprint,
  Zap,
  Lock,
  Smartphone,
} from 'lucide-react'
import circleTokenIcon from '../assets/Token-Icon/CIRCLE Token.svg'
import arcLogo from '../assets/ArcFlow-Icon.svg'
import googleLogo from '../assets/Social-Login-Icon/google-logo.svg.svg'
import appleLogo from '../assets/Social-Login-Icon/apple-logo.svg.svg'
import facebookLogo from '../assets/Social-Login-Icon/facebook-logo.svg.svg'
import { getSocialProviderInfo, isSocialProviderConfigured } from '../config/socialAuthConfig'

interface CircleAuthModalProps {
  isOpen: boolean
  onClose: () => void
  onRequestOtp: (email: string) => Promise<{ success: boolean; error?: string }>
  onVerifyOtp: (code: string) => Promise<{ success: boolean; address?: string; error?: string }>
  onLoginPin: () => Promise<{ success: boolean; address?: string; error?: string }>
  onLoginSocial: (provider: 'google' | 'apple' | 'facebook') => Promise<{ success: boolean; address?: string; error?: string }>
  onRegisterPasskey?: (username: string) => Promise<{ success: boolean; address?: string; error?: string }>
  onLoginPasskey?: () => Promise<{ success: boolean; address?: string; error?: string }>
  isPasskeyConnected?: boolean
  mscaAddress?: string
  hasStoredCredential?: boolean
  isLoading: boolean
  otpStep: 'input' | 'verify'
  setOtpStep: (step: 'input' | 'verify') => void
  pendingEmail: string
}

export default function CircleAuthModal({
  isOpen,
  onClose,
  onRequestOtp,
  onVerifyOtp,
  onLoginPin,
  onLoginSocial,
  onRegisterPasskey,
  onLoginPasskey,
  isPasskeyConnected,
  mscaAddress,
  hasStoredCredential,
  isLoading,
  otpStep,
  setOtpStep,
  pendingEmail,
}: CircleAuthModalProps) {
  const [email, setEmail] = useState('')
  const [otpCode, setOtpCode] = useState('')
  const [passkeyName, setPasskeyName] = useState('')
  const [showPasskeyRegister, setShowPasskeyRegister] = useState(false)
  const [viewMode, setViewMode] = useState<'auth' | 'pin'>('auth')
  const [statusMessage, setStatusMessage] = useState<{ text: string; isError?: boolean; isSuccess?: boolean } | null>(null)
  const [autoLoginPhase, setAutoLoginPhase] = useState<'idle' | 'authenticating' | 'success' | 'failed'>('idle')
  const [autoLoginAddress, setAutoLoginAddress] = useState<string>('')

  // Reset modal state on open/reopen
  useEffect(() => {
    if (isOpen) {
      setStatusMessage(null)
      setEmail('')
      setOtpCode('')
      setPasskeyName('')
      setShowPasskeyRegister(false)
      setViewMode('auth')
      setOtpStep('input')
      setAutoLoginPhase('idle')
      setAutoLoginAddress('')
    }
  }, [isOpen, setOtpStep])

  // Auto-login: When modal opens with a stored credential, trigger passkey login automatically
  useEffect(() => {
    if (!isOpen || !hasStoredCredential || !onLoginPasskey) return
    if (autoLoginPhase !== 'idle') return

    let cancelled = false
    setAutoLoginPhase('authenticating')

    onLoginPasskey().then((res) => {
      if (cancelled) return
      if (res.success && res.address) {
        setAutoLoginAddress(res.address)
        setAutoLoginPhase('success')
        setTimeout(() => {
          if (!cancelled) onClose()
        }, 1200)
      } else {
        setAutoLoginPhase('failed')
      }
    }).catch(() => {
      if (!cancelled) setAutoLoginPhase('failed')
    })

    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, hasStoredCredential])

  // Auto-clear statusMessage after 6 seconds
  useEffect(() => {
    if (statusMessage) {
      const timer = setTimeout(() => {
        setStatusMessage(null)
      }, 6000)
      return () => clearTimeout(timer)
    }
  }, [statusMessage])

  if (!isOpen) return null

  // Email Validation Helper
  const isValidEmail = (emailStr: string) => {
    const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/
    return emailRegex.test(emailStr.trim())
  }

  // ─────────────────────────────────────────────────────────────
  // PASSKEY HANDLERS (WebAuthn / FaceID / TouchID)
  // ─────────────────────────────────────────────────────────────
  const handlePasskeyLogin = async () => {
    if (!onLoginPasskey) return
    setStatusMessage({ text: 'Biyometrik doğrulama (FaceID / TouchID) başlatılıyor...' })
    const res = await onLoginPasskey()
    if (res.success && res.address) {
      setStatusMessage({
        text: `Passkey Smart Account bağlandı: ${res.address.slice(0, 6)}...${res.address.slice(-4)}`,
        isSuccess: true,
      })
      setTimeout(() => {
        onClose()
      }, 1200)
    } else {
      setStatusMessage({ text: res.error || 'Passkey girişi tamamlanamadı.', isError: true })
    }
  }

  const handlePasskeyRegister = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!onRegisterPasskey) return
    const uname = passkeyName.trim() || `arcflow_user_${Math.floor(Math.random() * 10000)}`
    setStatusMessage({ text: 'Yeni biyometrik Passkey ve Circle Smart Account oluşturuluyor...' })
    const res = await onRegisterPasskey(uname)
    if (res.success && res.address) {
      setStatusMessage({
        text: `Circle Smart Account oluşturuldu: ${res.address.slice(0, 6)}...${res.address.slice(-4)}`,
        isSuccess: true,
      })
      setTimeout(() => {
        onClose()
      }, 1200)
    } else {
      setStatusMessage({ text: res.error || 'Passkey kaydı tamamlanamadı.', isError: true })
    }
  }

  // ─────────────────────────────────────────────────────────────
  // EMAIL OTP HANDLERS
  // ─────────────────────────────────────────────────────────────
  const handleEmailRequest = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!email.trim()) {
      setStatusMessage({ text: 'Lütfen geçerli bir e-posta adresi girin.', isError: true })
      return
    }

    if (!isValidEmail(email)) {
      setStatusMessage({ text: 'Geçersiz e-posta formatı. Lütfen kontrol edin.', isError: true })
      return
    }
    setStatusMessage({ text: 'Doğrulama kodu e-postanıza gönderiliyor...' })
    const res = await onRequestOtp(email)
    if (res.success) {
      setStatusMessage({
        text: `Doğrulama kodu ${email} adresine gönderildi.`,
        isSuccess: true,
      })
    } else {
      setStatusMessage({ text: res.error || 'OTP kodu gönderilemedi.', isError: true })
    }
  }

  const handleOtpVerify = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!otpCode || otpCode.length < 4) {
      setStatusMessage({ text: 'Lütfen 6 haneli doğrulama kodunu girin.', isError: true })
      return
    }

    setStatusMessage({ text: 'OTP doğrulanıyor ve Circle cüzdanı bağlanıyor...' })
    const res = await onVerifyOtp(otpCode)
    if (res.success) {
      setStatusMessage({
        text: res.address
          ? `Circle cüzdanı bağlandı: ${res.address.slice(0, 6)}...${res.address.slice(-4)}`
          : `Circle cüzdanı başarıyla doğrulandı.`,
        isSuccess: true,
      })
      setTimeout(() => {
        onClose()
      }, 1500)
    } else {
      setStatusMessage({ text: res.error || 'OTP doğrulaması başarısız oldu.', isError: true })
    }
  }

  // ─────────────────────────────────────────────────────────────
  // PIN & SOCIAL HANDLERS
  // ─────────────────────────────────────────────────────────────
  const handlePinSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setStatusMessage({ text: 'Circle PIN & MPC cüzdan kurulumu başlatılıyor...' })
    const res = await onLoginPin()
    if (res.success) {
      setStatusMessage({
        text: res.address
          ? `Circle PIN cüzdanı bağlandı: ${res.address.slice(0, 6)}...${res.address.slice(-4)}`
          : `Circle PIN cüzdan kurulumu tamamlandı.`,
        isSuccess: true,
      })
      setTimeout(() => {
        onClose()
      }, 1500)
    } else {
      setStatusMessage({ text: res.error || 'PIN cüzdan kurulumu başarısız oldu.', isError: true })
    }
  }

  const handleSocialClick = async (provider: 'google' | 'apple' | 'facebook') => {
    const info = getSocialProviderInfo(provider)
    if (!info.isConfigured) {
      setStatusMessage({ text: info.helpMessage, isError: true })
      return
    }

    setStatusMessage({ text: `${info.name} ile giriş başlatılıyor...` })
    const res = await onLoginSocial(provider)
    if (res.success) {
      setStatusMessage({
        text: res.address
          ? `Sosyal giriş ile bağlandı: ${res.address.slice(0, 6)}...${res.address.slice(-4)}`
          : `Sosyal giriş tamamlanıyor...`,
        isSuccess: true,
      })
      setTimeout(() => {
        onClose()
      }, 1500)
    } else {
      setStatusMessage({ text: res.error || 'Sosyal giriş başlatılamadı.', isError: true })
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#07080d]/85 backdrop-blur-2xl animate-fade-in select-text">
      {/* Superellipse Modal Card */}
      <div
        className="ub-asset-card arc-animate-reveal relative w-full max-w-lg overflow-hidden border border-white/[0.08] shadow-2xl"
        style={{
          borderRadius: '28px',
          background: 'rgba(13, 15, 27, 0.95)',
          boxShadow: '0 0 0 1px rgba(255, 255, 255, 0.08), 0 24px 64px -12px rgba(0, 0, 0, 0.8), 0 0 40px rgba(99, 102, 241, 0.15)',
        }}
      >
        {/* Ambient Gradient Glow */}
        <div className="absolute -top-28 -left-28 w-64 h-64 bg-indigo-500/20 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute -bottom-28 -right-28 w-64 h-64 bg-cyan-500/15 rounded-full blur-3xl pointer-events-none" />

        {/* Close Button */}
        <button
          onClick={onClose}
          className="absolute top-5 right-5 w-8 h-8 rounded-full flex items-center justify-center text-slate-400 hover:text-white bg-white/[0.04] hover:bg-white/[0.1] border border-white/[0.06] transition-all cursor-pointer z-10"
        >
          <X className="w-4 h-4" />
        </button>

        {/* Modal Top Header Branding */}
        <div className="px-6 pt-6 pb-2 md:px-7 md:pt-7">
          <div className="flex items-center justify-between mb-4">
            <img src={arcLogo} alt="ArcFlow Logo" className="h-10 w-auto object-contain" />
          </div>

          {viewMode === 'auth' && autoLoginPhase !== 'authenticating' && autoLoginPhase !== 'success' && (
            <div className="space-y-2 mt-10">
              <h2 className="text-2xl text-slate-300 tracking-tight">
                Sign up / Login
              </h2>
              <p className="text-xs text-slate-400">
                Connect seamlessly with email, Passkey or social accounts.
              </p>
            </div>
          )}
        </div>

        {/* Status / Alert Message */}
        {statusMessage && autoLoginPhase !== 'authenticating' && autoLoginPhase !== 'success' && (
          <div className="px-6 md:px-7 pt-1">
            <div
              className={`p-3 rounded-2xl text-xs flex items-center gap-2.5 border transition backdrop-blur-md ${statusMessage.isError
                  ? 'bg-rose-950/60 border-rose-500/40 text-rose-200'
                  : statusMessage.isSuccess
                    ? 'bg-emerald-950/60 border-emerald-500/40 text-emerald-200'
                    : 'bg-indigo-950/60 border-indigo-500/40 text-indigo-200'
                }`}
            >
              {statusMessage.isError ? (
                <AlertCircle className="w-4 h-4 shrink-0 text-rose-400" />
              ) : statusMessage.isSuccess ? (
                <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-400" />
              ) : (
                <Sparkles className="w-4 h-4 shrink-0 animate-spin text-cyan-300" />
              )}
              <span className="leading-snug">{statusMessage.text}</span>
            </div>
          </div>
        )}

        {/* ═══════════════════════════════════════════════════════════════ */}
        {/* AUTO-LOGIN OVERLAY: Authenticating / Success phases           */}
        {/* ═══════════════════════════════════════════════════════════════ */}
        {autoLoginPhase === 'authenticating' && (
          <div className="p-8 md:p-10 flex flex-col items-center justify-center gap-5 min-h-[280px] animate-fade-in">
            {/* Pulsing Fingerprint Animation */}
            <div className="relative">
              <div className="absolute inset-0 w-20 h-20 rounded-full bg-cyan-500/20 animate-ping" />
              <div className="relative w-20 h-20 rounded-full bg-gradient-to-tr from-cyan-500 to-indigo-600 flex items-center justify-center shadow-lg shadow-cyan-500/30">
                <Fingerprint className="w-10 h-10 text-white" />
              </div>
            </div>
            <div className="text-center space-y-1.5">
              <h3 className="text-lg font-bold text-white tracking-tight">Biyometrik Doğrulama</h3>
              <p className="text-xs text-slate-400 leading-relaxed">
                FaceID veya TouchID ile kimliğinizi doğrulayın.<br />
                Tarayıcı penceresindeki istemi onaylayın.
              </p>
            </div>
            {/* Loading dots */}
            <div className="flex items-center gap-1.5">
              <div className="w-2 h-2 rounded-full bg-cyan-400 animate-bounce" style={{ animationDelay: '0ms' }} />
              <div className="w-2 h-2 rounded-full bg-cyan-400 animate-bounce" style={{ animationDelay: '150ms' }} />
              <div className="w-2 h-2 rounded-full bg-cyan-400 animate-bounce" style={{ animationDelay: '300ms' }} />
            </div>
            {/* Skip link for impatient users */}
            <button
              type="button"
              onClick={() => setAutoLoginPhase('failed')}
              className="text-[11px] text-slate-500 hover:text-slate-300 transition mt-2 cursor-pointer"
            >
              Diğer yöntemlerle giriş yap →
            </button>
          </div>
        )}

        {autoLoginPhase === 'success' && (
          <div className="p-8 md:p-10 flex flex-col items-center justify-center gap-5 min-h-[280px] animate-fade-in">
            {/* Success Check Animation */}
            <div className="relative">
              <div className="absolute inset-0 w-20 h-20 rounded-full bg-emerald-500/20 animate-ping" style={{ animationDuration: '1.5s' }} />
              <div className="relative w-20 h-20 rounded-full bg-gradient-to-tr from-emerald-500 to-cyan-500 flex items-center justify-center shadow-lg shadow-emerald-500/30">
                <CheckCircle2 className="w-10 h-10 text-white" />
              </div>
            </div>
            <div className="text-center space-y-1.5">
              <h3 className="text-lg font-bold text-white tracking-tight">Bağlantı Başarılı</h3>
              <p className="text-xs text-emerald-300 font-mono font-semibold">
                MSCA: {autoLoginAddress.slice(0, 8)}...{autoLoginAddress.slice(-6)}
              </p>
              <p className="text-[11px] text-slate-400">Passkey Smart Account bağlandı.</p>
            </div>
          </div>
        )}

        {/* MAIN VIEW MODE: Passkeys, Email, Social — only when not auto-login overlay */}
        {viewMode === 'auth' && autoLoginPhase !== 'authenticating' && autoLoginPhase !== 'success' && (
          <div className="px-6 pt-3 pb-2 md:px-7 md:pt-3 md:pb-2.5 space-y-3.5 max-h-[80vh] overflow-y-auto custom-scrollbar">
            {otpStep === 'input' ? (
              <>
                {/* ═════════════════════════════════════════════════════════ */}
                {/* 1. EMAIL FORM (PRIMARY INPUT)                            */}
                {/* ═════════════════════════════════════════════════════════ */}
                <form onSubmit={handleEmailRequest} className="space-y-3">
                  <div>
                    <label className="block text-xs font-bold text-slate-200 mb-1.5">
                      Email address
                    </label>
                    <div className="relative">
                      <input
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="Email"
                        disabled={isLoading}
                        className={`w-full rounded-xl px-4 py-3.5 pl-11 pr-11 text-xs text-white placeholder-slate-500 focus:outline-none transition-all ${isValidEmail(email)
                            ? 'border-emerald-500/60 focus:border-emerald-400 focus:ring-1 focus:ring-emerald-400/40'
                            : 'border-white/[0.12] focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500/50'
                          }`}
                        style={{
                          background: 'rgba(255, 255, 255, 0.04)',
                          border: '1px solid rgba(255, 255, 255, 0.1)',
                        }}
                      />
                      <Mail className="w-4 h-4 text-slate-400 absolute left-4 top-1/2 -translate-y-1/2 pointer-events-none" />

                      {isValidEmail(email) && (
                        <CheckCircle2 className="w-4 h-4 text-emerald-400 absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none" />
                      )}
                    </div>
                    <p className="text-[12px] text-slate-400 mt-1.5">
                      We'll send an email with a verification code.
                    </p>
                  </div>

                  <button
                    type="submit"
                    disabled={isLoading}
                    className="w-full py-3.5 rounded-full text-xs font-extrabold text-white bg-blue-900 hover:bg-blue-800 transition-all shadow-lg shadow-blue-600/20 flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50 active:scale-[0.99] uppercase tracking-wider"
                  >
                    {isLoading ? (
                      <>
                        <Sparkles className="w-4 h-4 animate-spin text-purple-200" />
                        <span>SENDING CODE...</span>
                      </>
                    ) : (
                      <span>CONTINUE</span>
                    )}
                  </button>
                </form>

                {/* Divider Line: or */}
                <div className="relative flex items-center justify-center my-4">
                  <div className="border-t border-white/[0.1] w-full" />
                  <span className="bg-[#0d0f1b] px-3 text-[11px] text-slate-500 lowercase font-medium">or</span>
                  <div className="border-t border-white/[0.1] w-full" />
                </div>

                {/* ═════════════════════════════════════════════════════════ */}
                {/* 2. CONTINUE WITH STACK (PASSKEY & SOCIALS)                */}
                {/* ═════════════════════════════════════════════════════════ */}
                <div className="space-y-2.5">
                  {/* Passkey (FaceID / TouchID) Option */}
                  {!showPasskeyRegister ? (
                    <div className="space-y-1">
                      <div className="flex justify-end px-1 pb-0.5">
                        <button
                          type="button"
                          onClick={() => setShowPasskeyRegister(true)}
                          className="text-[11px] text-slate-400 hover:text-cyan-400 transition cursor-pointer"
                        >
                          Create new Passkey
                        </button>
                      </div>
                      <button
                        type="button"
                        onClick={handlePasskeyLogin}
                        disabled={isLoading}
                        className="w-full rounded-2xl py-3 px-4 flex items-center bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.08] text-white text-xs font-semibold transition-all cursor-pointer group shadow-sm"
                      >
                        <div className="w-5 h-5 flex items-center justify-center text-cyan-400 mr-3 shrink-0">
                          <Fingerprint className="w-4 h-4" />
                        </div>
                        <span className="flex-1 text-center pr-5">Continue with Passkey</span>
                      </button>
                    </div>
                  ) : (
                    <div className="p-3.5 rounded-2xl bg-white/[0.03] border border-cyan-500/30 space-y-2.5 animate-fade-in">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-semibold text-white flex items-center gap-1.5">
                          <span>New Passkey Smart Account</span>
                        </span>
                        <button
                          type="button"
                          onClick={() => setShowPasskeyRegister(false)}
                          className="text-[11px] text-slate-400 hover:text-white transition cursor-pointer"
                        >
                          Cancel
                        </button>
                      </div>

                      <form onSubmit={handlePasskeyRegister} className="flex gap-2">
                        <input
                          type="text"
                          value={passkeyName}
                          onChange={(e) => setPasskeyName(e.target.value)}
                          placeholder="Wallet name (e.g. My Passkey)"
                          className="flex-1 rounded-xl px-3.5 py-2.5 text-xs bg-slate-950/80 border border-white/[0.12] focus:border-cyan-500 text-white placeholder-slate-500 focus:outline-none transition-colors"
                        />
                        <button
                          type="submit"
                          disabled={isLoading}
                          className="px-4 py-2.5 rounded-xl bg-blue-900 hover:bg-blue-800 text-white text-xs font-bold transition-all cursor-pointer disabled:opacity-50 active:scale-[0.99]"
                        >
                          Create
                        </button>
                      </form>
                    </div>
                  )}

                  {/* Google */}
                  <button
                    type="button"
                    onClick={() => handleSocialClick('google')}
                    disabled={isLoading}
                    className="w-full rounded-2xl py-3 px-4 flex items-center bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.08] text-white text-xs font-semibold transition-all cursor-pointer group shadow-sm"
                  >
                    <div className="w-5 h-5 flex items-center justify-center mr-3 shrink-0">
                      <img src={googleLogo} alt="Google" className="w-4 h-4 object-contain" />
                    </div>
                    <span className="flex-1 text-center pr-5">Continue with Google</span>
                  </button>

                  {/* Apple */}
                  <button
                    type="button"
                    onClick={() => handleSocialClick('apple')}
                    disabled={isLoading}
                    className="w-full rounded-2xl py-3 px-4 flex items-center bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.08] text-white text-xs font-semibold transition-all cursor-pointer group shadow-sm"
                  >
                    <div className="w-5 h-5 flex items-center justify-center mr-3 shrink-0">
                      <img src={appleLogo} alt="Apple" className="w-4 h-4 object-contain brightness-0 invert" />
                    </div>
                    <span className="flex-1 text-center pr-5">Continue with Apple</span>
                  </button>

                  {/* Facebook */}
                  <button
                    type="button"
                    onClick={() => handleSocialClick('facebook')}
                    disabled={isLoading}
                    className="w-full rounded-2xl py-3 px-4 flex items-center bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.08] text-white text-xs font-semibold transition-all cursor-pointer group shadow-sm"
                  >
                    <div className="w-5 h-5 flex items-center justify-center mr-3 shrink-0">
                      <img src={facebookLogo} alt="Facebook" className="w-4 h-4 object-contain" />
                    </div>
                    <span className="flex-1 text-center pr-5">Continue with Facebook</span>
                  </button>
                </div>

                {/* Terms and Privacy Policy Footer */}
                <div className="pt-1.5 text-center space-y-1">
                  <p className="text-[12px] text-slate-400 leading-relaxed">
                    By continuing, you agree to our{' '}
                    <a href="#" className="text-blue-400 hover:underline font-medium">
                      Terms of Use
                    </a>{' '}
                    &amp;{' '}
                    <a href="#" className="text-blue-400 hover:underline font-medium">
                      Privacy Policy
                    </a>
                    .
                  </p>

                  {/* Optional Circle PIN Link */}
                  <button
                    type="button"
                    onClick={() => setViewMode('pin')}
                    className="text-[11px] text-slate-400 hover:text-cyan-400 transition cursor-pointer inline-flex items-center gap-1"
                  >
                    <div className="w-3 h-3 rounded-full overflow-hidden shrink-0" style={{ clipPath: 'circle(50%)' }}>
                      <img src={circleTokenIcon} alt="Circle" className="w-full h-full object-cover" />
                    </div>
                    <span>Circle PIN Login</span>
                  </button>
                </div>
              </>
            ) : (
              /* OTP Code Entry View (Step 2) */
              <form onSubmit={handleOtpVerify} className="space-y-5">
                <div>
                  <h2 className="text-xl font-bold text-white tracking-tight mb-1">
                    6 Haneli Kodu Girin
                  </h2>
                  <p className="text-xs text-slate-400 leading-relaxed">
                    Doğrulama kodu <span className="text-white font-mono font-semibold">{pendingEmail || email}</span> adresine gönderildi.
                  </p>
                </div>

                <div>
                  <div className="flex justify-between items-center mb-2">
                    <label className="text-xs font-semibold text-slate-300">
                      Doğrulama Kodu
                    </label>
                    <button
                      type="button"
                      onClick={() => setOtpStep('input')}
                      className="text-xs text-indigo-400 hover:text-indigo-300 flex items-center gap-1 cursor-pointer font-medium"
                    >
                      <RefreshCw className="w-3 h-3" /> E-postayı Değiştir
                    </button>
                  </div>

                  <div className="relative flex items-center">
                    <input
                      type="text"
                      maxLength={6}
                      value={otpCode}
                      onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, ''))}
                      placeholder="• • • • • •"
                      disabled={isLoading}
                      className="w-full rounded-2xl px-4 py-4 pl-12 text-center text-xl tracking-[0.6em] font-mono text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition"
                      style={{
                        background: 'rgba(11, 13, 24, 0.75)',
                        border: '1px solid rgba(255, 255, 255, 0.1)',
                      }}
                    />
                    <KeyRound className="w-5 h-5 text-indigo-400 absolute left-4 top-1/2 -translate-y-1/2 pointer-events-none" />
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={isLoading}
                  className="ub-action-btn ub-action-btn-primary w-full py-3.5 rounded-full text-xs font-bold text-white shadow-lg flex items-center justify-center gap-2 transition cursor-pointer disabled:opacity-50 active:scale-[0.99] mt-6"
                >
                  {isLoading ? (
                    <>
                      <Sparkles className="w-4 h-4 animate-spin text-purple-200" />
                      DOĞRULANIYOR...
                    </>
                  ) : (
                    <>
                      <span>DOĞRULA VE BAĞLAN</span>
                      <ArrowRight className="w-4 h-4" />
                    </>
                  )}
                </button>
              </form>
            )}
          </div>
        )}

        {/* ALTERNATE VIEW MODE: PIN & Security Questions */}
        {viewMode === 'pin' && autoLoginPhase !== 'authenticating' && autoLoginPhase !== 'success' && (
          <div className="p-5 md:p-6 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-xl font-bold text-white tracking-tight">
                  6 Haneli PIN Oluştur
                </h2>
                <p className="text-xs text-slate-400">
                  Non-custodial cüzdanınız için MPC tabanlı 2-of-2 anahtar koruması.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setViewMode('auth')}
                className="text-xs text-indigo-400 hover:text-indigo-300 font-semibold cursor-pointer"
              >
                ← Geri
              </button>
            </div>

            <div className="grid grid-cols-3 gap-2 py-1">
              <div className="p-2.5 rounded-2xl text-center space-y-1 bg-indigo-500/10 border border-indigo-500/30">
                <span className="text-[10px] font-mono text-indigo-300 uppercase block font-bold">1. PIN</span>
                <span className="text-[11px] text-white font-medium">6 Haneli PIN</span>
              </div>
              <div className="p-2.5 rounded-2xl text-center space-y-1 bg-white/[0.03] border border-white/[0.08]">
                <span className="text-[10px] font-mono text-slate-400 uppercase block font-bold">2. Kurtarma</span>
                <span className="text-[11px] text-slate-400 font-medium">2 Soru</span>
              </div>
              <div className="p-2.5 rounded-2xl text-center space-y-1 bg-white/[0.03] border border-white/[0.08]">
                <span className="text-[10px] font-mono text-slate-400 uppercase block font-bold">3. Onay</span>
                <span className="text-[11px] text-slate-400 font-medium">Sözleşme</span>
              </div>
            </div>

            <div className="p-4 rounded-2xl text-xs space-y-2 bg-indigo-500/5 border border-indigo-500/20">
              <div className="flex items-center gap-2 text-indigo-300 font-semibold">
                <Shield className="w-4 h-4 text-indigo-400" />
                <span>Sorularınızı güvende tutun</span>
              </div>
              <ul className="space-y-1.5 text-[11px] list-disc list-inside text-slate-300 leading-relaxed">
                <li>Non-custodial cüzdanınızı kurtarmanın tek yolu budur.</li>
                <li>Circle yanıtlarınızı saklamaz, anahtarlar sizin kontrolünüzdedir.</li>
              </ul>
            </div>

            <form onSubmit={handlePinSubmit} className="space-y-4">
              <button
                type="submit"
                disabled={isLoading}
                className="ub-action-btn ub-action-btn-primary w-full py-3.5 rounded-full text-xs font-bold text-white shadow-lg flex items-center justify-center gap-2 transition cursor-pointer disabled:opacity-50 active:scale-[0.99]"
              >
                {isLoading ? (
                  <>
                    <Sparkles className="w-4 h-4 animate-spin text-purple-200" />
                    PIN YÜKLENİYOR...
                  </>
                ) : (
                  <>
                    <Key className="w-4 h-4 text-purple-300" />
                    <span>PIN VE KURTARMA KURULUMUNU BAŞLAT</span>
                    <ArrowRight className="w-4 h-4" />
                  </>
                )}
              </button>
            </form>
          </div>
        )}
      </div>
    </div>
  )
}
