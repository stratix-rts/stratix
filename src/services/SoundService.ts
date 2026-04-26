/**
 * SoundService - Web Audio API based Sound Feedback System
 *
 * Generates all sounds programmatically using oscillator nodes.
 * No external audio files required.
 *
 * Sound types:
 * - taskComplete: ascending cheerful tone (task done)
 * - agentStatusChange: soft notification ping
 * - warning: low urgent buzz
 * - click: short crisp click feedback
 */

export type SoundType = 'taskComplete' | 'agentStatusChange' | 'warning' | 'click';

interface SoundConfig {
  frequency: number;
  duration: number;
  type: OscillatorType;
  envelope: {
    attack: number;
    decay: number;
    sustain: number;
    release: number;
  };
  volume: number;
  detune?: number;
  secondFrequency?: number;
  secondDuration?: number;
}

class SoundService {
  private static instance: SoundService;
  private audioContext: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private _enabled = true;
  private _volume = 0.5;

  private soundConfigs: Record<SoundType, SoundConfig> = {
    taskComplete: {
      frequency: 523.25, // C5
      duration: 0.15,
      type: 'sine',
      envelope: { attack: 0.01, decay: 0.1, sustain: 0.3, release: 0.1 },
      volume: 0.6,
      secondFrequency: 659.25, // E5
      secondDuration: 0.15,
    },
    agentStatusChange: {
      frequency: 880, // A5
      duration: 0.12,
      type: 'sine',
      envelope: { attack: 0.01, decay: 0.08, sustain: 0.2, release: 0.05 },
      volume: 0.4,
    },
    warning: {
      frequency: 220, // A3
      duration: 0.25,
      type: 'sawtooth',
      envelope: { attack: 0.01, decay: 0.15, sustain: 0.4, release: 0.1 },
      volume: 0.5,
    },
    click: {
      frequency: 1200,
      duration: 0.03,
      type: 'square',
      envelope: { attack: 0.001, decay: 0.02, sustain: 0.1, release: 0.01 },
      volume: 0.2,
    },
  };

  private constructor() {
    this.initAudioContext();
  }

  static getInstance(): SoundService {
    if (!SoundService.instance) {
      SoundService.instance = new SoundService();
    }
    return SoundService.instance;
  }

  private initAudioContext(): void {
    if (typeof window === 'undefined') return;

    try {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) {
        throw new Error('Web Audio API not supported');
      }
      this.audioContext = new AudioContextClass();
      this.masterGain = this.audioContext.createGain();
      this.masterGain.connect(this.audioContext.destination);
      this.masterGain.gain.value = this._volume;
    } catch (e) {
      console.warn('[SoundService] Failed to initialize AudioContext:', e);
    }
  }

  private ensureContext(): AudioContext | null {
    if (!this.audioContext) {
      this.initAudioContext();
    }

    if (this.audioContext && this.audioContext.state === 'suspended') {
      this.audioContext.resume();
    }

    return this.audioContext;
  }

  private playTone(
    frequency: number,
    duration: number,
    type: OscillatorType,
    envelope: SoundConfig['envelope'],
    volume: number,
    detune = 0,
    startTime?: number
  ): void {
    const ctx = this.ensureContext();
    if (!ctx || !this.masterGain) return;

    const now = startTime ?? ctx.currentTime;
    const osc = ctx.createOscillator();
    const gainNode = ctx.createGain();

    osc.type = type;
    osc.frequency.value = frequency;
    osc.detune.value = detune;

    const { attack, decay, sustain, release } = envelope;
    const peakVolume = volume * this._volume * (this._enabled ? 1 : 0);

    // ADSR envelope
    gainNode.gain.setValueAtTime(0, now);
    gainNode.gain.linearRampToValueAtTime(peakVolume, now + attack);
    gainNode.gain.linearRampToValueAtTime(peakVolume * sustain, now + attack + decay);
    gainNode.gain.setValueAtTime(peakVolume * sustain, now + duration - release);
    gainNode.gain.linearRampToValueAtTime(0, now + duration);

    osc.connect(gainNode);
    gainNode.connect(this.masterGain);

    osc.start(now);
    osc.stop(now + duration + 0.01);
  }

  play(sound: SoundType): void {
    if (!this._enabled) return;

    const config = this.soundConfigs[sound];
    if (!config) return;

    const ctx = this.ensureContext();
    if (!ctx) return;

    // First tone
    this.playTone(
      config.frequency,
      config.duration,
      config.type,
      config.envelope,
      config.volume,
      config.detune
    );

    // Second tone for taskComplete (chord progression)
    if (sound === 'taskComplete' && config.secondFrequency && config.secondDuration) {
      this.playTone(
        config.secondFrequency,
        config.secondDuration,
        config.type,
        config.envelope,
        config.volume,
        0,
        ctx.currentTime + config.duration * 0.8
      );

      // Third tone - G5 for a cheerful triad
      this.playTone(
        783.99, // G5
        config.secondDuration,
        config.type,
        config.envelope,
        config.volume * 0.8,
        0,
        ctx.currentTime + config.duration * 1.6
      );
    }

    // Warning: add a low rumble undertone
    if (sound === 'warning') {
      this.playTone(
        config.frequency * 0.5,
        config.duration,
        'sine',
        config.envelope,
        config.volume * 0.3
      );
    }
  }

  // Convenience methods
  playTaskComplete(): void {
    this.play('taskComplete');
  }

  playAgentStatusChange(): void {
    this.play('agentStatusChange');
  }

  playWarning(): void {
    this.play('warning');
  }

  playClick(): void {
    this.play('click');
  }

  // Settings
  get enabled(): boolean {
    return this._enabled;
  }

  set enabled(value: boolean) {
    this._enabled = value;
    this.persistSettings();
  }

  get volume(): number {
    return this._volume;
  }

  set volume(value: number) {
    this._volume = Math.max(0, Math.min(1, value));
    if (this.masterGain) {
      this.masterGain.gain.value = this._volume;
    }
    this.persistSettings();
  }

  private persistSettings(): void {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(
      'stratix-sound-settings',
      JSON.stringify({ enabled: this._enabled, volume: this._volume })
    );
  }

  loadSettings(): void {
    if (typeof localStorage === 'undefined') return;
    try {
      const saved = localStorage.getItem('stratix-sound-settings');
      if (saved) {
        const { enabled, volume } = JSON.parse(saved);
        this._enabled = enabled ?? true;
        this._volume = volume ?? 0.5;
        if (this.masterGain) {
          this.masterGain.gain.value = this._volume;
        }
      }
    } catch (e) {
      console.warn('[SoundService] Failed to parse saved settings:', e);
    }
  }

  destroy(): void {
    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
    }
  }
}

export const soundService = SoundService.getInstance();
