/**
 * SoundEffects - Synthesized sound effects using Web Audio API
 * Generates simple sounds programmatically without external audio files
 */

export interface SoundEffectOptions {
  frequency?: number;
  duration?: number;
  type?: OscillatorType;
}

export class SoundEffects {
  private static instance: SoundEffects;
  private audioContext: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private _volume: number = 1.0;
  private _muted: boolean = false;

  private constructor() {}

  static getInstance(): SoundEffects {
    if (!SoundEffects.instance) {
      SoundEffects.instance = new SoundEffects();
    }
    return SoundEffects.instance;
  }

  private ensureContext(): AudioContext {
    if (!this.audioContext) {
      this.audioContext = new AudioContext();
      this.masterGain = this.audioContext.createGain();
      this.masterGain.connect(this.audioContext.destination);
      this.masterGain.gain.value = this._muted ? 0 : this._volume;
    }
    return this.audioContext;
  }

  private playTone(startFreq: number, endFreq: number, duration: number, type: OscillatorType = 'sine'): void {
    const ctx = this.ensureContext();
    const oscillator = ctx.createOscillator();
    const gainNode = ctx.createGain();

    oscillator.type = type;
    oscillator.frequency.setValueAtTime(startFreq, ctx.currentTime);
    if (endFreq !== startFreq) {
      oscillator.frequency.exponentialRampToValueAtTime(endFreq, ctx.currentTime + duration / 1000);
    }

    gainNode.gain.setValueAtTime(0.3, ctx.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + duration / 1000);

    oscillator.connect(gainNode);
    gainNode.connect(this.masterGain!);

    oscillator.start(ctx.currentTime);
    oscillator.stop(ctx.currentTime + duration / 1000);
  }

  private playSimpleTone(frequency: number, duration: number, type: OscillatorType = 'sine'): void {
    this.playTone(frequency, frequency, duration, type);
  }

  /**
   * Short click sound (200Hz, 50ms)
   */
  playSelect(): void {
    this.playSimpleTone(200, 50, 'square');
  }

  /**
   * Ascending tone (300->600Hz, 100ms)
   */
  playCommand(): void {
    this.playTone(300, 600, 100, 'sine');
  }

  /**
   * Pleasant ding (800Hz, 200ms)
   */
  playSuccess(): void {
    this.playTone(800, 800, 200, 'sine');
  }

  /**
   * Low buzz (150Hz, 150ms)
   */
  playError(): void {
    this.playSimpleTone(150, 150, 'sawtooth');
  }

  /**
   * Two-tone warning (500->400Hz, 200ms)
   */
  playAlert(): void {
    this.playTone(500, 400, 200, 'triangle');
  }

  /**
   * Set master volume (0-1)
   */
  setVolume(level: number): void {
    this._volume = Math.max(0, Math.min(1, level));
    if (this.masterGain) {
      this.masterGain.gain.setValueAtTime(this._muted ? 0 : this._volume, this.audioContext!.currentTime);
    }
  }

  /**
   * Toggle mute state
   */
  setMuted(muted: boolean): void {
    this._muted = muted;
    if (this.masterGain) {
      this.masterGain.gain.setValueAtTime(muted ? 0 : this._volume, this.audioContext!.currentTime);
    }
  }

  /**
   * Check if currently muted
   */
  isMuted(): boolean {
    return this._muted;
  }

  /**
   * Get current volume level
   */
  getVolume(): number {
    return this._volume;
  }

  /**
   * Clean up audio context
   */
  destroy(): void {
    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
      this.masterGain = null;
    }
  }
}

export const soundEffects = SoundEffects.getInstance();
