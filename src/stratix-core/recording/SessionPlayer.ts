/**
 * SessionPlayer - Plays back recorded sessions
 *
 * Replays recorded actions with original timing or accelerated playback
 */

import type { Recording, RecordedAction, PlaybackState, PlaybackSpeed } from './types';

export interface SessionPlayerEvents {
  onAction?: (action: RecordedAction, index: number) => void;
  onComplete?: () => void;
  onProgress?: (progress: number, currentTime: number) => void;
  onStateChange?: (state: PlaybackState) => void;
}

/**
 * SessionPlayer replays recorded sessions with timing control
 */
export class SessionPlayer {
  private recording: Recording | null = null;
  private state: PlaybackState = 'idle';
  private playbackSpeed: PlaybackSpeed = 1;
  private currentIndex: number = 0;
  // Time tracking: use playbackElapsed directly instead of Date.now() offsets
  private playbackElapsed: number = 0; // accumulated playback time in ms
  private lastTickTime: number = 0; // last real time when tick was called
  private events: SessionPlayerEvents = {};
  private animationFrameId: number | null = null;

  constructor(events?: SessionPlayerEvents) {
    if (events) {
      this.events = events;
    }
  }

  /**
   * Load a recording for playback
   */
  load(recording: Recording): void {
    if (this.state === 'playing') {
      this.stop();
    }

    this.recording = recording;
    this.state = 'idle';
    this.currentIndex = 0;
    this.playbackElapsed = 0;
    this.lastTickTime = 0;

    this.emitStateChange();
  }

  /**
   * Start or resume playback
   */
  play(): void {
    if (!this.recording) {
      console.warn('[SessionPlayer] No recording loaded');
      return;
    }

    if (this.state === 'completed') {
      // Restart from beginning
      this.currentIndex = 0;
      this.playbackElapsed = 0;
    }

    if (this.state === 'playing') {
      return;
    }

    this.state = 'playing';
    this.lastTickTime = Date.now();
    this.emitStateChange();

    this.runPlaybackLoop();
  }

  /**
   * Pause playback
   */
  pause(): void {
    if (this.state !== 'playing') {
      return;
    }

    this.state = 'paused';
    this.stopPlaybackLoop();
    this.emitStateChange();
  }

  /**
   * Resume from pause
   */
  resume(): void {
    if (this.state !== 'paused') {
      return;
    }

    this.state = 'playing';
    this.lastTickTime = Date.now();
    this.emitStateChange();

    this.runPlaybackLoop();
  }

  /**
   * Stop playback and reset to beginning
   */
  stop(): void {
    this.stopPlaybackLoop();
    this.state = 'idle';
    this.currentIndex = 0;
    this.playbackElapsed = 0;
    this.lastTickTime = 0;
    this.emitStateChange();
  }

  /**
   * Seek to a specific timestamp
   */
  seekTo(timestamp: number): void {
    if (!this.recording) {
      return;
    }

    // Find the action index at or just after the timestamp
    const targetIndex = this.recording.actions.findIndex(
      (action) => action.timestamp >= timestamp
    );

    if (targetIndex === -1) {
      // Timestamp is past all actions, go to end
      this.currentIndex = this.recording.actions.length;
      this.state = 'completed';
    } else {
      this.currentIndex = targetIndex;
      if (this.state !== 'playing') {
        this.playbackElapsed = timestamp;
      }
    }

    if (this.state === 'playing') {
      this.lastTickTime = Date.now();
    }
  }

  /**
   * Set playback speed (0.5, 1, 2, or 4)
   */
  setPlaybackSpeed(rate: PlaybackSpeed): void {
    this.playbackSpeed = rate;
  }

  /**
   * Get current playback state
   */
  getState(): PlaybackState {
    return this.state;
  }

  /**
   * Get current playback speed
   */
  getPlaybackSpeed(): PlaybackSpeed {
    return this.playbackSpeed;
  }

  /**
   * Get current action index
   */
  getCurrentIndex(): number {
    return this.currentIndex;
  }

  /**
   * Get total number of actions
   */
  getTotalActions(): number {
    return this.recording?.actions.length ?? 0;
  }

  /**
   * Get current playback time in ms
   */
  getCurrentTime(): number {
    if (!this.recording) {
      return 0;
    }

    if (this.state === 'idle') {
      return 0;
    }

    return this.playbackElapsed;
  }

  /**
   * Get total duration in ms
   */
  getDuration(): number {
    if (!this.recording) {
      return 0;
    }
    return this.recording.endTime - this.recording.startTime;
  }

  /**
   * Get current progress (0-1)
   */
  getProgress(): number {
    const duration = this.getDuration();
    if (duration === 0) {
      return 0;
    }
    return Math.min(1, this.playbackElapsed / duration);
  }

  // ============ Private Methods ============

  private runPlaybackLoop(): void {
    this.stopPlaybackLoop();

    // Use setInterval which works with Jest fake timers
    // The interval fires frequently (16ms) to allow precise timing control
    this.animationFrameId = setInterval(() => {
      if (this.state !== 'playing') {
        return;
      }
      this.tick();
    }, 16) as unknown as number;
  }

  private stopPlaybackLoop(): void {
    if (this.animationFrameId !== null) {
      clearInterval(this.animationFrameId);
      this.animationFrameId = null;
    }
  }

  private tick(): void {
    if (!this.recording || this.state !== 'playing') {
      return;
    }

    // Calculate elapsed playback time since last tick
    const now = Date.now();
    const deltaReal = now - this.lastTickTime;
    this.lastTickTime = now;
    this.playbackElapsed += deltaReal * this.playbackSpeed;

    const duration = this.getDuration();

    // Emit progress
    this.events.onProgress?.(this.getProgress(), this.playbackElapsed);

    // Find and emit actions that should play now
    while (
      this.currentIndex < this.recording.actions.length &&
      this.recording.actions[this.currentIndex].timestamp <= this.playbackElapsed
    ) {
      const action = this.recording.actions[this.currentIndex];
      this.events.onAction?.(action, this.currentIndex);
      this.currentIndex++;
    }

    // Check for completion
    if (this.currentIndex >= this.recording.actions.length && duration > 0) {
      this.state = 'completed';
      this.stopPlaybackLoop();
      this.events.onComplete?.();
      this.emitStateChange();
    }
  }

  private emitStateChange(): void {
    this.events.onStateChange?.(this.state);
  }
}
