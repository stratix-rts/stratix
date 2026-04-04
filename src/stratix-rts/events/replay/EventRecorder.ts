/**
 * Event Recorder
 * Captures events from the RTSEventBus for later playback
 */

import { rtsEventBus } from '../core/RTSEventBus';
import type { RTSEventName, RTSEventData } from '../types/RTSEventTypes';

import type { RecordedEvent, RecordingSession } from './types';
import { generateSessionId, calculateDuration } from './types';

/**
 * Events to exclude from recording (internal/loopback events)
 */
const EXCLUDED_EVENTS: RTSEventName[] = [
  'replay:state_changed',
  'replay:progress',
  'replay:recording_started',
  'replay:recording_stopped',
  'replay:session_loaded',
  'replay:error',
];

/**
 * Maximum events to record (prevent memory issues)
 */
const MAX_RECORDING_EVENTS = 10000;

export class EventRecorder {
  private isRecording = false;
  private recordingId: string | null = null;
  private recordingName: string | null = null;
  private startTime: number = 0;
  private events: RecordedEvent[] = [];
  private unsubscribe: (() => void) | null = null;

  /**
   * Start recording events
   */
  startRecording(name?: string): string {
    if (this.isRecording) {
      console.warn('[EventRecorder] Already recording, call stopRecording first');
      return this.recordingId!;
    }

    this.recordingId = generateSessionId();
    this.recordingName = name ?? null;
    this.startTime = performance.now();
    this.events = [];
    this.isRecording = true;

    // Subscribe to all events
    this.unsubscribe = rtsEventBus.onAny((event, data) => {
      if (this.isRecording) {
        this.recordEvent(event as RTSEventName, data as RTSEventData<RTSEventName>);
      }
    });

    console.log(`[EventRecorder] Recording started: ${this.recordingId}`);
    return this.recordingId;
  }

  /**
   * Record a single event
   */
  private recordEvent(event: RTSEventName, data: RTSEventData<RTSEventName>): void {
    // Skip excluded events
    if (EXCLUDED_EVENTS.includes(event)) {
      return;
    }

    // Check max events limit
    if (this.events.length >= MAX_RECORDING_EVENTS) {
      console.warn('[EventRecorder] Max events reached, stopping recording');
      this.stopRecording();
      return;
    }

    const timestamp = performance.now() - this.startTime;

    this.events.push({
      event,
      data,
      timestamp,
    });
  }

  /**
   * Stop recording and return the session
   */
  stopRecording(metadata?: RecordingSession['metadata']): RecordingSession | null {
    if (!this.isRecording) {
      console.warn('[EventRecorder] Not recording');
      return null;
    }

    const endTime = performance.now();
    const session: RecordingSession = {
      id: this.recordingId!,
      name: this.recordingName ?? `Recording ${new Date().toLocaleTimeString()}`,
      startTime: this.startTime,
      endTime,
      events: [...this.events],
      duration: calculateDuration(this.events),
      metadata,
    };

    // Cleanup
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }

    this.isRecording = false;
    this.recordingId = null;
    this.recordingName = null;

    console.log(`[EventRecorder] Recording stopped: ${session.id}, ${session.events.length} events, ${session.duration.toFixed(0)}ms`);

    return session;
  }

  /**
   * Get current recording state
   */
  isCurrentlyRecording(): boolean {
    return this.isRecording;
  }

  /**
   * Get current recording ID
   */
  getCurrentRecordingId(): string | null {
    return this.recordingId;
  }

  /**
   * Get number of events recorded so far
   */
  getEventCount(): number {
    return this.events.length;
  }

  /**
   * Get current recording time in ms
   */
  getCurrentTime(): number {
    if (!this.isRecording) return 0;
    return performance.now() - this.startTime;
  }

  /**
   * Cancel recording without creating a session
   */
  cancelRecording(): void {
    if (!this.isRecording) return;

    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }

    this.isRecording = false;
    this.recordingId = null;
    this.recordingName = null;
    this.events = [];

    console.log('[EventRecorder] Recording cancelled');
  }
}

export const eventRecorder = new EventRecorder();
