/**
 * Replay Manager
 * Unified interface for recording and playback, emits events for UI updates
 */

import { rtsEventBus } from '../core/RTSEventBus';
import { eventRecorder, EventRecorder } from './EventRecorder';
import { eventPlayback, EventPlayback } from './EventPlayback';
import type {
  RecordingSession,
  PlaybackState,
  PlaybackSpeed,
  PlaybackProgress,
  ReplayConfig,
  ReplayEvents,
  RecordedEvent,
} from './types';
import { generateSessionId } from './types';

/**
 * Replay Manager - provides unified recording/playback interface
 */
export class ReplayManager {
  private recorder: EventRecorder;
  private playback: EventPlayback;
  private progressUpdateInterval: ReturnType<typeof setInterval> | null = null;

  constructor() {
    this.recorder = eventRecorder;
    this.playback = eventPlayback;
  }

  // ==================== Recording ====================

  /**
   * Start recording events
   */
  startRecording(name?: string): string {
    const sessionId = this.recorder.startRecording(name);
    this.emit('replay:recording_started', { sessionId });
    return sessionId;
  }

  /**
   * Stop recording and return the session
   */
  stopRecording(metadata?: RecordingSession['metadata']): RecordingSession | null {
    const session = this.recorder.stopRecording(metadata);
    if (session) {
      this.emit('replay:recording_stopped', { session });
    }
    return session;
  }

  /**
   * Cancel current recording
   */
  cancelRecording(): void {
    this.recorder.cancelRecording();
  }

  /**
   * Whether currently recording
   */
  isRecording(): boolean {
    return this.recorder.isCurrentlyRecording();
  }

  // ==================== Playback ====================

  /**
   * Load a session for playback
   */
  loadSession(session: RecordingSession, config?: ReplayConfig): void {
    this.playback.loadSession(session, config);
    this.emit('replay:session_loaded', { session });
    this.startProgressUpdates();
  }

  /**
   * Start/resume playback
   */
  play(): void {
    this.playback.play();
    this.emitStateChange();
  }

  /**
   * Pause playback
   */
  pause(): void {
    this.playback.pause();
    this.emitStateChange();
  }

  /**
   * Stop playback
   */
  stop(): void {
    this.playback.stop();
    this.emitStateChange();
    this.stopProgressUpdates();
  }

  /**
   * Toggle play/pause
   */
  toggle(): void {
    this.playback.toggle();
    this.emitStateChange();
  }

  /**
   * Seek to position in ms
   */
  seek(timeMs: number): void {
    this.playback.seek(timeMs);
  }

  /**
   * Set playback speed
   */
  setSpeed(speed: PlaybackSpeed): void {
    this.playback.setSpeed(speed);
  }

  /**
   * Get current progress
   */
  getProgress(): PlaybackProgress | null {
    return this.playback.getProgress();
  }

  /**
   * Get current playback state
   */
  getState(): PlaybackState {
    return this.playback.getState();
  }

  /**
   * Get loaded session
   */
  getSession(): RecordingSession | null {
    return this.playback.getSession();
  }

  /**
   * Get current time in ms
   */
  getCurrentTime(): number {
    return this.playback.getCurrentTime();
  }

  /**
   * Get duration in ms
   */
  getDuration(): number {
    const session = this.playback.getSession();
    return session?.duration ?? 0;
  }

  /**
   * Step forward one event
   */
  stepForward(): void {
    this.playback.stepEvent(true);
  }

  /**
   * Step backward one event
   */
  stepBackward(): void {
    this.playback.stepEvent(false);
  }

  /**
   * Whether playback is active (playing or paused)
   */
  isPlaybackActive(): boolean {
    const state = this.playback.getState();
    return state === 'playing' || state === 'paused';
  }

  // ==================== Storage ====================

  /**
   * Save a session to localStorage
   */
  saveSession(session: RecordingSession): void {
    try {
      const sessions = this.getSavedSessions();
      sessions.push(session);
      localStorage.setItem('rts_replay_sessions', JSON.stringify(sessions));
      console.log(`[ReplayManager] Session saved: ${session.id}`);
    } catch (error) {
      console.error('[ReplayManager] Failed to save session:', error);
    }
  }

  /**
   * Load a session from storage by ID
   */
  getSavedSession(id: string): RecordingSession | null {
    const sessions = this.getSavedSessions();
    return sessions.find(s => s.id === id) ?? null;
  }

  /**
   * Get all saved sessions
   */
  getSavedSessions(): RecordingSession[] {
    try {
      const data = localStorage.getItem('rts_replay_sessions');
      return data ? JSON.parse(data) : [];
    } catch {
      return [];
    }
  }

  /**
   * Delete a saved session
   */
  deleteSession(id: string): void {
    try {
      const sessions = this.getSavedSessions().filter(s => s.id !== id);
      localStorage.setItem('rts_replay_sessions', JSON.stringify(sessions));
    } catch (error) {
      console.error('[ReplayManager] Failed to delete session:', error);
    }
  }

  /**
   * Clear all saved sessions
   */
  clearSavedSessions(): void {
    localStorage.removeItem('rts_replay_sessions');
  }

  // ==================== Export/Import ====================

  /**
   * Export a session as JSON string
   */
  exportSession(session: RecordingSession): string {
    return JSON.stringify(session, null, 2);
  }

  /**
   * Import a session from JSON string
   */
  importSession(json: string): RecordingSession | null {
    try {
      const session = JSON.parse(json) as RecordingSession;
      // Assign new ID to avoid conflicts
      session.id = generateSessionId();
      return session;
    } catch (error) {
      console.error('[ReplayManager] Failed to import session:', error);
      this.emit('replay:error', { error: 'Invalid session format' });
      return null;
    }
  }

  // ==================== Internal ====================

  private emit<K extends keyof ReplayEvents>(
    event: K,
    data: ReplayEvents[K]
  ): void {
    rtsEventBus.emit(event, data as any);
  }

  private emitStateChange(): void {
    this.emit('replay:state_changed', { state: this.playback.getState() });
  }

  private startProgressUpdates(): void {
    if (this.progressUpdateInterval) return;

    this.progressUpdateInterval = setInterval(() => {
      const progress = this.getProgress();
      if (progress && progress.state === 'playing') {
        this.emit('replay:progress', progress);
      }
    }, 50);
  }

  private stopProgressUpdates(): void {
    if (this.progressUpdateInterval) {
      clearInterval(this.progressUpdateInterval);
      this.progressUpdateInterval = null;
    }
  }

  /**
   * Clean up resources
   */
  destroy(): void {
    this.stopProgressUpdates();
    this.recorder.cancelRecording();
    this.playback.destroy();
  }
}

export const replayManager = new ReplayManager();
export { EventRecorder, eventRecorder } from './EventRecorder';
export { EventPlayback, eventPlayback } from './EventPlayback';
export * from './types';
