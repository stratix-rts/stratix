/**
 * SessionRecorder - Records user actions as a timeline
 *
 * Captures RTS commands and state snapshots for later playback
 */

import { stratixStateStore } from '../state/StratixStateStore';
import type { Recording, RecordedAction, StateSnapshot, RecordingMetadata } from './types';

/**
 * ID generator for recordings and actions
 */
function generateId(prefix: string): string {
  const random = Math.random().toString(36).substring(2, 9);
  return `${prefix}_${Date.now()}_${random}`;
}

/**
 * SessionRecorder captures user actions with timestamps and state snapshots
 */
export class SessionRecorder {
  private isRecording: boolean = false;
  private isPaused: boolean = false;
  private recordingId: string = '';
  private startTime: number = 0;
  private pausedTime: number = 0;
  private actions: RecordedAction[] = [];
  private name: string = '';
  private description: string = '';
  private tags: string[] = [];
  private snapshotInterval: number = 5000; // ms between automatic snapshots
  private snapshotTimer: ReturnType<typeof setInterval> | null = null;

  /**
   * Start a new recording session
   */
  startRecording(name: string = `Recording ${Date.now()}`, description?: string): void {
    if (this.isRecording) {
      console.warn('[SessionRecorder] Already recording');
      return;
    }

    this.recordingId = generateId('rec');
    this.name = name;
    this.description = description ?? '';
    this.tags = [];
    this.actions = [];
    this.startTime = Date.now();
    this.pausedTime = 0;
    this.isPaused = false;
    this.isRecording = true;

    this.startSnapshotTimer();

    console.log(`[SessionRecorder] Started recording: ${name}`);
  }

  /**
   * Stop recording and return the completed Recording
   */
  stopRecording(): Recording {
    if (!this.isRecording) {
      console.warn('[SessionRecorder] Not recording');
      return this.createEmptyRecording();
    }

    this.stopSnapshotTimer();

    const endTime = Date.now();
    const recording: Recording = {
      id: this.recordingId,
      startTime: this.startTime,
      endTime,
      actions: [...this.actions],
      metadata: this.createMetadata(endTime),
    };

    this.isRecording = false;
    this.isPaused = false;

    console.log(`[SessionRecorder] Stopped recording: ${this.name}, ${this.actions.length} actions captured`);

    return recording;
  }

  /**
   * Record an action with auto-generated timestamp
   */
  recordAction(type: string, data: unknown): void {
    if (!this.isRecording || this.isPaused) {
      return;
    }

    const action: RecordedAction = {
      id: generateId('act'),
      type,
      data,
      timestamp: this.getCurrentTimestamp(),
    };

    this.actions.push(action);
  }

  /**
   * Pause recording (actions will not be recorded)
   */
  pause(): void {
    if (!this.isRecording || this.isPaused) {
      return;
    }
    this.isPaused = true;
    this.pausedTime = Date.now();
    console.log('[SessionRecorder] Paused');
  }

  /**
   * Resume recording after pause
   */
  resume(): void {
    if (!this.isRecording || !this.isPaused) {
      return;
    }

    // Adjust start time to account for paused duration
    const pausedDuration = Date.now() - this.pausedTime;
    this.startTime += pausedDuration;
    this.isPaused = false;
    this.pausedTime = 0;

    console.log('[SessionRecorder] Resumed');
  }

  /**
   * Add a tag to the current recording
   */
  addTag(tag: string): void {
    if (!this.tags.includes(tag)) {
      this.tags.push(tag);
    }
  }

  /**
   * Check if currently recording
   */
  isActive(): boolean {
    return this.isRecording;
  }

  /**
   * Check if recording is paused
   */
  isPausedState(): boolean {
    return this.isPaused;
  }

  /**
   * Get current action count
   */
  getActionCount(): number {
    return this.actions.length;
  }

  /**
   * Get elapsed recording time in ms
   */
  getElapsedTime(): number {
    if (!this.isRecording) {
      return 0;
    }
    return this.getCurrentTimestamp();
  }

  /**
   * Capture a state snapshot from StratixStateStore
   */
  captureSnapshot(): StateSnapshot | null {
    try {
      const state = {
        agents: Array.from(stratixStateStore.select('agents').entries()),
        zones: Array.from(stratixStateStore.select('zones').entries()),
        sessions: Array.from(stratixStateStore.select('sessions').entries()),
        ui: { ...stratixStateStore.select('ui') },
        mcp: { ...stratixStateStore.select('mcp') },
      };

      return {
        state,
        timestamp: this.getCurrentTimestamp(),
      };
    } catch (error) {
      console.warn('[SessionRecorder] Failed to capture snapshot:', error);
      return null;
    }
  }

  /**
   * Record an action with an associated state snapshot
   */
  recordActionWithSnapshot(type: string, data: unknown): void {
    if (!this.isRecording || this.isPaused) {
      return;
    }

    const snapshot = this.captureSnapshot();

    const action: RecordedAction = {
      id: generateId('act'),
      type,
      data,
      timestamp: this.getCurrentTimestamp(),
      snapshot: snapshot ?? undefined,
    };

    this.actions.push(action);
  }

  // ============ Private Methods ============

  private getCurrentTimestamp(): number {
    return Date.now() - this.startTime;
  }

  private createMetadata(endTime: number): RecordingMetadata {
    return {
      version: '1.0.0',
      name: this.name,
      description: this.description,
      tags: [...this.tags],
      createdAt: this.startTime,
    };
  }

  private createEmptyRecording(): Recording {
    return {
      id: '',
      startTime: 0,
      endTime: 0,
      actions: [],
      metadata: {
        version: '1.0.0',
        name: '',
        tags: [],
        createdAt: 0,
      },
    };
  }

  private startSnapshotTimer(): void {
    this.stopSnapshotTimer();
    this.snapshotTimer = setInterval(() => {
      if (this.isRecording && !this.isPaused) {
        this.recordAction('system:snapshot', { timestamp: Date.now() });
      }
    }, this.snapshotInterval);
  }

  private stopSnapshotTimer(): void {
    if (this.snapshotTimer !== null) {
      clearInterval(this.snapshotTimer);
      this.snapshotTimer = null;
    }
  }
}
