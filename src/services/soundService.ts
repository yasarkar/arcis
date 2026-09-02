// src/services/soundService.ts
// Ultra-low latency Web Audio API Sound Synthesizer & Haptic Feedback Engine for Arcis

export type SoundType = 'success' | 'error' | 'cancel' | 'send' | 'pop' | 'faucet'

class SoundService {
  private ctx: AudioContext | null = null
  private isMuted: boolean = false

  constructor() {
    const saved = localStorage.getItem('arcis_copilot_sfx_enabled')
    // Default to enabled (true)
    this.isMuted = saved !== null ? saved === 'false' : false
  }

  private getAudioContext(): AudioContext | null {
    if (typeof window === 'undefined') return null

    if (!this.ctx) {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext
      if (AudioCtx) {
        this.ctx = new AudioCtx()
      }
    }

    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {})
    }

    return this.ctx
  }

  public isEnabled(): boolean {
    return !this.isMuted
  }

  public setEnabled(enabled: boolean): void {
    this.isMuted = !enabled
    localStorage.setItem('arcis_copilot_sfx_enabled', String(enabled))
  }

  public toggle(): boolean {
    const nextState = this.isMuted // if currently muted, next state is enabled (true)
    this.setEnabled(nextState)
    if (nextState) {
      this.play('pop')
    }
    return nextState
  }

  public play(type: SoundType): void {
    if (this.isMuted) return

    const ctx = this.getAudioContext()
    if (!ctx) return

    try {
      const now = ctx.currentTime

      switch (type) {
        case 'success': {
          // 3-note harmonic uplifting chord arpeggio (C5 -> E5 -> G5)
          const notes = [523.25, 659.25, 783.99]
          notes.forEach((freq, i) => {
            const osc = ctx.createOscillator()
            const gain = ctx.createGain()
            osc.type = 'sine'
            osc.frequency.setValueAtTime(freq, now + i * 0.08)

            gain.gain.setValueAtTime(0, now + i * 0.08)
            gain.gain.linearRampToValueAtTime(0.12, now + i * 0.08 + 0.02)
            gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.08 + 0.28)

            osc.connect(gain)
            gain.connect(ctx.destination)

            osc.start(now + i * 0.08)
            osc.stop(now + i * 0.08 + 0.3)
          })

          // Haptic double tick on mobile
          if (typeof navigator !== 'undefined' && navigator.vibrate) {
            try {
              navigator.vibrate([40, 60, 40])
            } catch {}
          }
          break
        }

        case 'error': {
          // Low 2-tone warning alert (G#3 -> F3)
          const notes = [207.65, 174.61]
          notes.forEach((freq, i) => {
            const osc = ctx.createOscillator()
            const gain = ctx.createGain()
            osc.type = 'triangle'
            osc.frequency.setValueAtTime(freq, now + i * 0.1)

            gain.gain.setValueAtTime(0, now + i * 0.1)
            gain.gain.linearRampToValueAtTime(0.15, now + i * 0.1 + 0.02)
            gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.1 + 0.22)

            osc.connect(gain)
            gain.connect(ctx.destination)

            osc.start(now + i * 0.1)
            osc.stop(now + i * 0.1 + 0.25)
          })

          if (typeof navigator !== 'undefined' && navigator.vibrate) {
            try {
              navigator.vibrate([60, 100, 60])
            } catch {}
          }
          break
        }

        case 'cancel': {
          // Descending neutral tap (D5 -> B4)
          const notes = [587.33, 493.88]
          notes.forEach((freq, i) => {
            const osc = ctx.createOscillator()
            const gain = ctx.createGain()
            osc.type = 'sine'
            osc.frequency.setValueAtTime(freq, now + i * 0.06)

            gain.gain.setValueAtTime(0, now + i * 0.06)
            gain.gain.linearRampToValueAtTime(0.09, now + i * 0.06 + 0.015)
            gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.06 + 0.15)

            osc.connect(gain)
            gain.connect(ctx.destination)

            osc.start(now + i * 0.06)
            osc.stop(now + i * 0.06 + 0.16)
          })

          if (typeof navigator !== 'undefined' && navigator.vibrate) {
            try {
              navigator.vibrate(30)
            } catch {}
          }
          break
        }

        case 'send': {
          // Futuristic laser frequency sweep (698Hz -> 880Hz)
          const osc = ctx.createOscillator()
          const gain = ctx.createGain()
          osc.type = 'sine'
          osc.frequency.setValueAtTime(698.46, now)
          osc.frequency.exponentialRampToValueAtTime(880.0, now + 0.07)

          gain.gain.setValueAtTime(0, now)
          gain.gain.linearRampToValueAtTime(0.08, now + 0.015)
          gain.gain.exponentialRampToValueAtTime(0.001, now + 0.09)

          osc.connect(gain)
          gain.connect(ctx.destination)

          osc.start(now)
          osc.stop(now + 0.1)
          break
        }

        case 'pop': {
          // Short subtle tactile click
          const osc = ctx.createOscillator()
          const gain = ctx.createGain()
          osc.type = 'sine'
          osc.frequency.setValueAtTime(1200, now)

          gain.gain.setValueAtTime(0, now)
          gain.gain.linearRampToValueAtTime(0.06, now + 0.004)
          gain.gain.exponentialRampToValueAtTime(0.001, now + 0.025)

          osc.connect(gain)
          gain.connect(ctx.destination)

          osc.start(now)
          osc.stop(now + 0.03)
          break
        }

        case 'faucet': {
          // Glistening coin/waterdrop chime (880Hz -> 1320Hz -> 1760Hz)
          const freqs = [880, 1318.51, 1760]
          freqs.forEach((freq, i) => {
            const osc = ctx.createOscillator()
            const gain = ctx.createGain()
            osc.type = 'sine'
            osc.frequency.setValueAtTime(freq, now + i * 0.07)

            gain.gain.setValueAtTime(0, now + i * 0.07)
            gain.gain.linearRampToValueAtTime(0.12, now + i * 0.07 + 0.02)
            gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.07 + 0.25)

            osc.connect(gain)
            gain.connect(ctx.destination)

            osc.start(now + i * 0.07)
            osc.stop(now + i * 0.07 + 0.28)
          })

          if (typeof navigator !== 'undefined' && navigator.vibrate) {
            try {
              navigator.vibrate(50)
            } catch {}
          }
          break
        }
      }
    } catch (err) {
      console.warn('[soundService] Error playing audio tone:', err)
    }
  }
}

export const soundService = new SoundService()
export const playSound = (type: SoundType) => soundService.play(type)
