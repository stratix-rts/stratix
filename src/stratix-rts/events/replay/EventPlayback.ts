/**
 * Event Playback
 * Replays recorded events with timing control
 */

import { rtsEventBus } from '../core/RTSEventBus';
import type { RTSEventName, RTSEventData } from '../types/RTSEventTypes';

import type {
  RecordingSession,
  RecordedEvent,
  PlaybackState,
  PlaybackSpeed,
  ReplayConfig,
  PlaybackProgress,
} from './types';
import { calculateDuration } from './types';

/**
 * Default playback configuration
 */
const DEFAULT_CONFIG: Required<ReplayConfig> = {
  loop: false,
  speed: 1,
  startPosition: 0,
  emitEvents: true,
};

/**
 * Minimum time between progress updates (ms)
 */
const PROGRESS_UPDATE_INTERVAL = 50;

export class EventPlayback {
  private session: RecordingSession | null = null;
  private config: Required<ReplayConfig> = { ...DEFAULT_CONFIG };
  private state: PlaybackState = 'idle';
  private currentEventIndex = 0;
  private playbackStartTime = 0;
  private playbackStartOffset = 0; // For pause/resume
  private speed: PlaybackSpeed = 1;
  private animationFrameId: number | null = null;
  private lastProgressUpdate = 0;

  /**
   * Load a recording session for playback
   */
  loadSession(session: RecordingSession, config?: ReplayConfig): void {
    if (this.state === 'playing') {
      this.stop();
    }

    this.session = session;
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.speed = this.config.speed ?? 1;
    this.state = 'idle';
    this.currentEventIndex = 0;
    this.playbackStartOffset = this.config.startPosition ?? 0;

    console.log(`[EventPlayback] Session loaded: ${session.id}, ${session.events.length} events, ${session.duration.toFixed(0)}ms`);
  }

  /**
   * Start or resume playback
   */
  play(): void {
    if (!this.session) {
      console.warn('[EventPlayback] No session loaded');
      return;
    }

    if (this.state === 'ended') {
      // Restart from beginning if not looping
      if (!this.config.loop) {
        this.seek(0);
      }
    }

    if (this.state === 'playing') {
      console.warn('[EventPlayback] Already playing');
      return;
    }

    this.state = 'playing';
    this.playbackStartTime = performance.now();
    // Adjust offset to account for pause duration
    this.playbackStartOffset = this.getCurrentTime();

    console.log(`[EventPlayback] Playing at ${this.speed}x speed`);
    this.startPlaybackLoop();
  }

  /**
   * Pause playback
   */
  pause(): void {
    if (this.state !== 'playing') {
      console.warn('[EventPlayback] Not playing');
      return;
    }

    this.state = 'paused';
    this.stopPlaybackLoop();

    console.log('[EventPlayback] Paused');
  }

  /**
   * Stop playback and reset to beginning
   */
  stop(): void {
    this.state = 'idle';
    this.currentEventIndex = 0;
    this.playbackStartOffset = 0;
    this.playbackStartTime = 0;
    this.stopPlaybackLoop();

    console.log('[EventPlayback] Stopped');
  }

  /**
   * Seek to a specific position in ms
   */
  seek(timeMs: number): void {
    if (!this.session) {
      console.warn('[EventPlayback] No session loaded');
      return;
    }

    // Clamp time to valid range
    const targetTime = Math.max(0, Math.min(timeMs, this.session.duration));
    this.playbackStartOffset = targetTime;

    // Find the event index corresponding to this time
    this.currentEventIndex = this.findEventIndexForTime(targetTime);

    if (this.state === 'playing') {
      this.playbackStartTime = performance.now();
    }

    console.log(`[EventPlayback] Seeked to ${targetTime.toFixed(0)}ms (event ${this.currentEventIndex})`);
  }

  /**
   * Set playback speed
   */
  setSpeed(speed: PlaybackSpeed): void {
    this.speed = speed;
    if (this.state === 'playing') {
      // Adjust start time to account for speed change
      const currentTime = this.getCurrentTime();
      this.playbackStartTime = performance.now();
      this.playbackStartOffset = currentTime;
    }
    console.log(`[EventPlayback] Speed set to ${speed}x`);
  }

  /**
   * Get current playback time in ms
   */
  getCurrentTime(): number {
    if (this.state !== 'playing') {
      return this.playbackStartOffset;
    }

    const elapsed = performance.now() - this.playbackStartTime;
    return this.playbackStartOffset + (elapsed * this.speed);
  }

  /**
   * Get playback progress
   */
  getProgress(): PlaybackProgress | null {
    if (!this.session) return null;

    const currentTime = this.getCurrentTime();
    const duration = this.session.duration;

    return {
      state: this.state,
      currentTime,
      duration,
      percentage: duration > 0 ? (currentTime / duration) * 100 : 0,
      eventIndex: this.currentEventIndex,
      totalEvents: this.session.events.length,
    };
  }

  /**
   * Get current state
   */
  getState(): PlaybackState {
    return this.state;
  }

  /**
   * Get current session
   */
  getSession(): RecordingSession | null {
    return this.session;
  }

  /**
   * Get playback speed
   */
  getSpeed(): PlaybackSpeed {
    return this.speed;
  }

  /**
   * Toggle play/pause
   */
  toggle(): void {
    if (this.state === 'playing') {
      this.pause();
    } else {
      this.play();
    }
  }

  private startPlaybackLoop(): void {
    const loop = () => {
      if (this.state !== 'playing') return;

      this.processPlayback();
      this.animationFrameId = requestAnimationFrame(loop);
    };

    this.animationFrameId = requestAnimationFrame(loop);
  }

  private stopPlaybackLoop(): void {
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
  }

  private processPlayback(): void {
    if (!this.session || this.state !== 'playing') return;

    const currentTime = this.getCurrentTime();
    const events = this.session.events;

    // Process events up to current time
    while (
      this.currentEventIndex < events.length &&
      events[this.currentEventIndex].timestamp <= currentTime
    ) {
      const event = events[this.currentEventIndex];
      this.emitRecordedEvent(event);
      this.currentEventIndex++;
    }

    // Update progress periodically
    const now = performance.now();
    if (now - this.lastProgressUpdate >= PROGRESS_UPDATE_INTERVAL) {
      this.lastProgressUpdate = now;
      // Progress updates handled by getProgress() call
    }

    // Check if playback ended
    if (this.currentEventIndex >= events.length) {
      if (this.config.loop) {
        this.seek(0);
        this.play();
      } else {
        this.state = 'ended';
        this.stopPlaybackLoop();
        console.log('[EventPlayback] Playback ended');
      }
    }
  }

  private emitRecordedEvent(event: RecordedEvent): void {
    if (!this.config.emitEvents) return;

    try {
      rtsEventBus.emit(event.event, event.data);
    } catch (error) {
      console.error(`[EventPlayback] Error emitting event ${event.event}:`, error);
    }
  }

  private findEventIndexForTime(timeMs: number): number {
    if (!this.session) return 0;

    const events = this.session.events;
    let low = 0;
    let high = events.length - 1;

    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      if (events[mid].timestamp < timeMs) {
        low = mid + 1;
      } else if (events[mid].timestamp > timeMs) {
        high = mid - 1;
      } else {
        return mid;
      }
    }

    return low;
  }

  /**
   * Step forward/backward by one event
   */
  stepEvent(forward: boolean): void {
    if (!this.session) return;

    if (forward) {
      if (this.currentEventIndex < this.session.events.length) {
        const event = this.session.events[this.currentEventIndex];
        this.emitRecordedEvent(event);
        this.currentEventIndex++;
        this.playbackStartOffset = event.timestamp;
      }
    } else {
      if (this.currentEventIndex > 0) {
        this.currentEventIndex--;
        const event = this.session.events[this.currentEventIndex];
        this.playbackStartOffset = event.timestamp;
      }
    }
  }

  /**
   * Clean up resources
   */
  destroy(): void {
    this.stop();
    this.session = null;
  }
}

export const eventPlayback = new EventPlayback();
