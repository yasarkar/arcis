import React, { useState, useEffect, useRef } from 'react'
import { useClearOnWalletDisconnect } from '../hooks/useClearOnWalletDisconnect'
import {
  X,
  Mail,
  Shield,
  Sparkles,
  CheckCircle2,
  AlertCircle,
  ArrowRight,
  Key,
  Fingerprint,
  ChevronDown,
  Loader,
  RefreshCw,
} from 'lucide-react'
import arcLogo from '../assets/Arcis-Icon.svg'
import googleLogo from '../assets/Social-Login-Icon/google-logo.svg.svg'
import appleLogo from '../assets/Social-Login-Icon/apple-logo.svg.svg'
import facebookLogo from '../assets/Social-Login-Icon/facebook-logo.svg.svg'
import { getSocialProviderInfo } from '../config/socialAuthConfig'
import {
  getSavedAuthEmails,
  saveAuthEmail,
  removeSavedAuthEmail,
  clearAllSavedAuthEmails,
} from '../utils/savedAuthEmails'

interface CircleAuthModalProps {
  isOpen: boolean
  onClose: () => void
  onRequestOtp: (email: string) => Promise<{ success: boolean; error?: string }>
  onVerifyOtp?: (code?: string) => Promise<{ success: boolean; address?: string; error?: string }>
  onReopenOtpVerification?: () => boolean
  onCleanupIframe?: () => void
  onLoginSocial: (provider: 'google' | 'apple' | 'facebook') => Promise<{ success: boolean; address?: string; error?: string }>
  onRegisterPasskey?: (username: string) => Promise<{ success: boolean; address?: string; error?: string }>
  onLoginPasskey?: () => Promise<{ success: boolean; address?: string; error?: string }>
  isPasskeyConnected?: boolean
  mscaAddress?: string
  isUcwConnected?: boolean
  ucwAddress?: string
  authPhase?: 'idle' | 'requesting' | 'awaiting_code' | 'creating_wallet' | 'success' | 'error'
  error?: string | null
  hasStoredCredential?: boolean
  isLoading: boolean
  otpStep?: 'input' | 'verify'
  setOtpStep?: (step: 'input' | 'verify') => void
  pendingEmail?: string
}

export default function CircleAuthModal({
  isOpen,
  onClose,
  onRequestOtp,
  onVerifyOtp: _onVerifyOtp,
  onReopenOtpVerification: _onReopenOtpVerification,
  onCleanupIframe,
  onLoginSocial,
  onRegisterPasskey,
  onLoginPasskey,
  isPasskeyConnected: _isPasskeyConnected,
  mscaAddress: _mscaAddress,
  isUcwConnected,
  ucwAddress,
  authPhase,
  error: externalError,
  hasStoredCredential,
  isLoading,
  otpStep: _otpStep,
  setOtpStep,
  pendingEmail: _pendingEmail,
}: CircleAuthModalProps) {
  const [email, setEmail] = useState('')
  const [passkeyName, setPasskeyName] = useState('')
  const [showPasskeyRegister, setShowPasskeyRegister] = useState(false)
  const [statusMessage, setStatusMessage] = useState<{ text: string; isError?: boolean; isSuccess?: boolean } | null>(null)
  const [autoLoginPhase, setAutoLoginPhase] = useState<'idle' | 'authenticating' | 'success' | 'failed'>('idle')
  const [autoLoginAddress, setAutoLoginAddress] = useState<string>('')
  const [savedEmails, setSavedEmails] = useState<string[]>([])
  const [showSavedDropdown, setShowSavedDropdown] = useState(false)

  const emailInputRef = useRef<HTMLInputElement>(null)
  const savedDropdownRef = useRef<HTMLDivElement>(null)

  const handleClose = () => {
    if (onCleanupIframe) onCleanupIframe()
    onClose()
  }

  // Close saved accounts dropdown on outside click
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (savedDropdownRef.current && !savedDropdownRef.current.contains(event.target as Node)) {
        setShowSavedDropdown(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  // Auto-close modal when UCW wallet successfully connects
  useEffect(() => {
    if (isOpen && isUcwConnected && ucwAddress) {
      const timer = setTimeout(() => {
        handleClose()
      }, 1400)
      return () => clearTimeout(timer)
    }
  }, [isOpen, isUcwConnected, ucwAddress])

  // Synchronize external error and authPhase changes
  useEffect(() => {
    if (externalError) {
      setStatusMessage({ text: externalError, isError: true })
    }
  }, [externalError])

  useEffect(() => {
    if (authPhase === 'creating_wallet') {
      setStatusMessage({ text: 'Verification successful! Preparing Circle wallet, please wait...', isSuccess: false })
    } else if (authPhase === 'success') {
      setStatusMessage({ text: 'Wallet successfully connected!', isSuccess: true })
    }
  }, [authPhase])

  // Systematic input clearing on wallet disconnect
  useClearOnWalletDisconnect(() => {
    setEmail('')
    setPasskeyName('')
    setStatusMessage(null)
    setShowSavedDropdown(false)
  })

  // Reset modal state on open/reopen & load saved emails
  useEffect(() => {
    if (isOpen) {
      setStatusMessage(null)
      const stored = getSavedAuthEmails()
      setSavedEmails(stored)
      setEmail('')
      setPasskeyName('')
      setShowPasskeyRegister(false)
      if (setOtpStep) setOtpStep('input')
      setAutoLoginPhase('idle')
      setAutoLoginAddress('')
      setShowSavedDropdown(false)
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
    setStatusMessage({ text: 'Initiating biometric verification (FaceID / TouchID)...' })
    const res = await onLoginPasskey()
    if (res.success && res.address) {
      setStatusMessage({
        text: `Passkey Smart Account connected: ${res.address.slice(0, 6)}...${res.address.slice(-4)}`,
        isSuccess: true,
      })
      setTimeout(() => {
        onClose()
      }, 1200)
    } else {
      setStatusMessage({ text: res.error || 'Passkey login could not be completed.', isError: true })
    }
  }

  const handlePasskeyRegister = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!onRegisterPasskey) return
    const uname = passkeyName.trim() || `arcis_user_${Math.floor(Math.random() * 10000)}`
    setStatusMessage({ text: 'Creating biometric Passkey & Circle Smart Account...' })
    const res = await onRegisterPasskey(uname)
    if (res.success && res.address) {
      setStatusMessage({
        text: `Circle Smart Account created: ${res.address.slice(0, 6)}...${res.address.slice(-4)}`,
        isSuccess: true,
      })
      setTimeout(() => {
        onClose()
      }, 1200)
    } else {
      setStatusMessage({ text: res.error || 'Passkey registration could not be completed.', isError: true })
    }
  }

  // ─────────────────────────────────────────────────────────────
  // EMAIL OTP HANDLERS
  // ─────────────────────────────────────────────────────────────
  const handleEmailRequest = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!email.trim()) {
      setStatusMessage({ text: 'Please enter a valid email address.', isError: true })
      return
    }

    if (!isValidEmail(email)) {
      setStatusMessage({ text: 'Invalid email format. Please verify your email address.', isError: true })
      return
    }
    setStatusMessage({ text: 'Sending verification code to your email...' })
    const res = await onRequestOtp(email)
    if (res.success) {
      const updated = saveAuthEmail(email)
      setSavedEmails(updated)
      setShowSavedDropdown(false)
      // Keep modal open with prompt to enter code in Circle's window; auto-close will trigger upon wallet connection
      if (setOtpStep) setOtpStep('verify')
    } else {
      setStatusMessage({ text: res.error || 'Failed to send OTP code.', isError: true })
    }
  }

  const handleSelectSavedEmail = (selectedEmail: string) => {
    setEmail(selectedEmail)
    setShowSavedDropdown(false)
  }

  const displayEmails = email.trim() && !savedEmails.includes(email.trim().toLowerCase())
    ? savedEmails.filter((item) => item.toLowerCase().includes(email.trim().toLowerCase()))
    : savedEmails

  const isDropdownOpen = showSavedDropdown && savedEmails.length > 0 && displayEmails.length > 0

  // ─────────────────────────────────────────────────────────────
  // SOCIAL HANDLERS
  // ─────────────────────────────────────────────────────────────
  const handleSocialClick = async (provider: 'google' | 'apple' | 'facebook') => {
    const info = getSocialProviderInfo(provider)
    if (!info.isConfigured) {
      setStatusMessage({ text: info.helpMessage, isError: true })
      return
    }

    setStatusMessage({ text: `Initiating ${info.name} login...` })
    const res = await onLoginSocial(provider)
    if (res.success) {
      setStatusMessage({
        text: res.address
          ? `Connected via social login: ${res.address.slice(0, 6)}...${res.address.slice(-4)}`
          : `Completing social login...`,
        isSuccess: true,
      })
      setTimeout(() => {
        onClose()
      }, 1500)
    } else {
      setStatusMessage({ text: res.error || 'Social login could not be initiated.', isError: true })
    }
  }

  return (
    <div
      className="fixed inset-0 z-[10010] flex items-center justify-center p-4 bg-[#07080d]/90 backdrop-blur-md animate-fade-in select-text"
      style={{ zIndex: 10010 }}
    >
      {/* Superellipse Modal Card */}
      <div
        className="ub-asset-card arc-animate-reveal relative w-full max-w-lg overflow-hidden border border-white/[0.08] shadow-2xl"
        style={{
          borderRadius: '28px',
          background: 'rgba(13, 15, 27, 0.95)',
          boxShadow: '0 0 0 1px rgba(255, 255, 255, 0.08), 0 24px 64px -12px rgba(0, 0, 0, 0.8), 0 0 40px rgba(99, 102, 241, 0.15)',
        }}
      >

        {/* Close Button */}
        <button
          onClick={handleClose}
          className="absolute top-5 right-5 w-8 h-8 rounded-full flex items-center justify-center text-slate-400 hover:text-white bg-white/[0.04] hover:bg-white/[0.1] border border-white/[0.06] transition-all cursor-pointer z-10"
        >
          <X className="w-4 h-4" />
        </button>

        {/* Modal Top Header Branding */}
        <div className="px-6 pt-6 pb-2 md:px-7 md:pt-7">
          <div className="flex items-center justify-between mb-4">
            <img src={arcLogo} alt="Arcis Logo" className="h-10 w-auto object-contain" />
          </div>

          {autoLoginPhase !== 'authenticating' && autoLoginPhase !== 'success' && !(isUcwConnected && ucwAddress) && (
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
        {statusMessage && autoLoginPhase !== 'authenticating' && autoLoginPhase !== 'success' && !(isUcwConnected && ucwAddress) && (
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
                <Loader className="w-4 h-4 shrink-0 animate-spin text-cyan-300" />
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
              <h3 className="text-lg font-bold text-white tracking-tight">Biometric Verification</h3>
              <p className="text-xs text-slate-400 leading-relaxed">
                Verify your identity using FaceID, TouchID, or your security key.<br />
                Confirm the biometric prompt in your browser window.
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
              Sign in with other methods →
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
              <h3 className="text-lg font-bold text-white tracking-tight">Connection Successful</h3>
              <p className="text-xs text-emerald-300 font-mono font-semibold">
                MSCA: {autoLoginAddress.slice(0, 8)}...{autoLoginAddress.slice(-6)}
              </p>
              <p className="text-[11px] text-slate-400">Passkey Smart Account connected.</p>
            </div>
          </div>
        )}

        {/* MAIN VIEW MODE: Passkeys, Email, Social — only when not auto-login overlay and not connected */}
        {autoLoginPhase !== 'authenticating' && autoLoginPhase !== 'success' && !(isUcwConnected && ucwAddress) && (
          <div className="px-6 pt-3 pb-2 md:px-7 md:pt-3 md:pb-2.5 space-y-3.5 max-h-[80vh] overflow-y-auto custom-scrollbar">
            {/* ═════════════════════════════════════════════════════════ */}
            {/* 1. EMAIL FORM (PRIMARY INPUT)                            */}
            {/* ═════════════════════════════════════════════════════════ */}
            <form onSubmit={handleEmailRequest} className="space-y-3">
              <div>
                <label className="block text-xs font-bold text-slate-200 mb-1.5">
                  Email address
                </label>

                <div className="relative" ref={savedDropdownRef}>
                  <input
                    ref={emailInputRef}
                    type="email"
                    value={email}
                    onChange={(e) => {
                      setEmail(e.target.value)
                      if (savedEmails.length > 0) setShowSavedDropdown(true)
                    }}
                    onClick={() => {
                      if (savedEmails.length > 0) setShowSavedDropdown(true)
                    }}
                    onFocus={() => {
                      if (savedEmails.length > 0) setShowSavedDropdown(true)
                    }}
                    placeholder="Email"
                    disabled={isLoading}
                    className={`w-full px-4 py-3.5 pl-11 pr-14 text-xs text-white placeholder-slate-500 focus:outline-none transition-all ${isDropdownOpen
                      ? 'rounded-t-xl rounded-b-none'
                      : 'rounded-xl'
                      }`}
                    style={{
                      background: 'rgba(255, 255, 255, 0.04)',
                      borderWidth: '1px',
                      borderStyle: 'solid',
                      borderColor: 'rgba(255, 255, 255, 0.1)',
                    }}
                  />
                  <Mail className="w-4 h-4 text-slate-400 absolute left-4 top-1/2 -translate-y-1/2 pointer-events-none" />

                  {/* Right icons: Clear & Chevron */}
                  <div className="absolute right-3.5 top-1/2 -translate-y-1/2 flex items-center gap-1.5">
                    {email && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation()
                          setEmail('')
                          setShowSavedDropdown(true)
                          emailInputRef.current?.focus()
                        }}
                        className="p-1 rounded-full text-slate-400 hover:text-white hover:bg-white/10 transition cursor-pointer"
                        title="Clear"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    )}
                    {savedEmails.length > 0 && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation()
                          setShowSavedDropdown((prev) => !prev)
                        }}
                        className="p-1 rounded-md text-slate-400 hover:text-indigo-400 transition cursor-pointer"
                        title="Saved emails"
                      >
                        <ChevronDown
                          className={`w-4 h-4 transition-transform duration-200 ${isDropdownOpen ? 'rotate-180 text-indigo-400' : ''
                            }`}
                        />
                      </button>
                    )}
                  </div>

                  {/* Attached Droplist */}
                  {isDropdownOpen && (
                    <div
                      className="absolute left-0 right-0 top-full rounded-b-xl overflow-hidden z-50 transition-all duration-150 shadow-2xl animate-fade-in"
                      style={{
                        marginTop: '-1px', // Seamless connection to input bottom border
                        background: 'rgba(255, 255, 255, 0.04)',
                        borderWidth: '1px',
                        borderStyle: 'solid',
                        borderColor: 'rgba(255, 255, 255, 0.1)',
                        backdropFilter: 'blur(20px)',
                        WebkitBackdropFilter: 'blur(20px)',
                        borderTop: 'none',
                        boxShadow: '0 20px 40px -8px rgba(0, 0, 0, 0.9), 0 0 20px rgba(6, 182, 212, 0.15)',
                      }}
                    >
                      <div className="max-h-48 overflow-y-auto custom-scrollbar divide-y divide-white/[0.04]">
                        {displayEmails.map((savedEmail, idx) => {
                          const isSelected = email.trim().toLowerCase() === savedEmail
                          return (
                            <div
                              key={savedEmail}
                              onClick={() => handleSelectSavedEmail(savedEmail)}
                              className={`w-full flex items-center justify-between px-3.5 py-2.5 text-xs transition cursor-pointer group ${isSelected
                                ? 'bg-cyan-500/15 text-cyan-300 font-medium'
                                : 'text-slate-200 hover:bg-white/[0.06] hover:text-white'
                                }`}
                            >
                              <div className="flex items-center gap-2.5 min-w-0 pr-2">
                                <span className="truncate">{savedEmail}</span>
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  )}
                </div>

                <p className="text-[12px] text-slate-400 mt-1.5">
                  We'll send an email with a verification code.
                </p>
              </div>

              <button
                type="submit"
                disabled={isLoading}
                className={`w-full py-3.5 px-6 rounded-full font-semibold text-xs sm:text-sm tracking-wide transition-all duration-200 flex items-center justify-center gap-2 select-none uppercase ${
                  !isLoading
                    ? 'text-white hover:scale-[1.01] hover:brightness-110 active:scale-[0.98] cursor-pointer'
                    : 'bg-white/[0.04] text-slate-500 border border-white/[0.06] cursor-not-allowed opacity-80'
                }`}
                style={{
                  fontFamily: 'var(--font-app)',
                  ...(!isLoading
                    ? {
                        background: 'linear-gradient(135deg, #9896ff 0%, #7c3aed 100%)',
                        boxShadow: '0 6px 24px rgba(152, 150, 255, 0.3)',
                      }
                    : {}),
                }}
              >
                {isLoading ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin text-white" />
                    <span>SENDING CODE...</span>
                  </>
                ) : (
                  <>
                    <span>CONTINUE</span>
                    <ArrowRight className="w-3.5 h-3.5 text-white" />
                  </>
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
                    className="w-full rounded-2xl py-3 px-4 flex items-center bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.08] text-white text-xm font-semibold transition-all cursor-pointer group shadow-sm"
                  >
                    <div className="w-5 h-5 flex items-center justify-center text-cyan-400 mr-3 shrink-0">
                      <Fingerprint className="w-5 h-5" />
                    </div>
                    <span className="flex-1 text-center pr-5">Continue with Passkey</span>
                  </button>
                </div>
              ) : (
                <div className="p-3.5 rounded-2xl bg-white/[0.03] space-y-2.5 animate-fade-in">
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
                      className={`px-5 py-2.5 rounded-full font-semibold text-xs tracking-wide transition-all duration-200 flex items-center justify-center gap-1.5 cursor-pointer select-none active:scale-[0.98] hover:scale-[1.01] hover:brightness-110 ${
                        !isLoading
                          ? 'text-white'
                          : 'bg-white/[0.04] text-slate-500 border border-white/[0.06] cursor-not-allowed opacity-80'
                      }`}
                      style={{
                        fontFamily: 'var(--font-app)',
                        ...(!isLoading
                          ? {
                              background: 'linear-gradient(135deg, #9896ff 0%, #7c3aed 100%)',
                              boxShadow: '0 6px 24px rgba(152, 150, 255, 0.3)',
                            }
                          : {}),
                      }}
                    >
                      {isLoading ? (
                        <>
                          <RefreshCw className="w-3.5 h-3.5 animate-spin text-white" />
                          <span>Creating...</span>
                        </>
                      ) : (
                        <span>Create</span>
                      )}
                    </button>
                  </form>
                </div>
              )}

              {/* Google */}
              <button
                type="button"
                onClick={() => handleSocialClick('google')}
                disabled={isLoading}
                className="w-full rounded-2xl py-3 px-4 flex items-center bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.08] text-white text-xm font-semibold transition-all cursor-pointer group shadow-sm"
              >
                <div className="w-5 h-5 flex items-center justify-center mr-3 shrink-0">
                  <img src={googleLogo} alt="Google" className="w-5 h-5 object-contain" />
                </div>
                <span className="flex-1 text-center pr-5">Continue with Google</span>
              </button>

              {/* Apple (Disabled & Blurred) */}
              <button
                type="button"
                disabled
                aria-disabled="true"
                title="Apple Sign-In is temporarily unavailable"
                className="w-full rounded-2xl py-3 px-4 flex items-center bg-white/[0.02] border border-white/[0.05] text-white/50 text-xm font-semibold cursor-not-allowed opacity-40 select-none shadow-sm transition-all"
                style={{ filter: 'blur(0.8px)' }}
              >
                <div className="w-5 h-5 flex items-center justify-center mr-3 shrink-0">
                  <img src={appleLogo} alt="Apple" className="w-5 h-5 object-contain brightness-0 invert opacity-60" />
                </div>
                <span className="flex-1 text-center pr-5">Continue with Apple</span>
              </button>

              {/* Facebook (Disabled & Blurred) */}
              <button
                type="button"
                disabled
                aria-disabled="true"
                title="Facebook Sign-In is temporarily unavailable"
                className="w-full rounded-2xl py-3 px-4 flex items-center bg-white/[0.02] border border-white/[0.05] text-white/50 text-xm font-semibold cursor-not-allowed opacity-40 select-none shadow-sm transition-all"
                style={{ filter: 'blur(0.8px)' }}
              >
                <div className="w-5 h-5 flex items-center justify-center mr-3 shrink-0">
                  <img src={facebookLogo} alt="Facebook" className="w-5 h-5 object-contain opacity-60" />
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
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
