/**
 * Replay System Types
 * Defines types for the event recording and playback system
 */

import type { RTSEventName, RTSEventData } from '../types/RTSEventTypes';

/**
 * A single recorded event with relative timestamp
 */
export interface RecordedEvent {
  readonly event: RTSEventName;
  readonly data: RTSEventData<RTSEventName>;
  /** Relative time in milliseconds from recording start */
  readonly timestamp: number;
}

/**
 * A complete recording session
 */
export interface RecordingSession {
  readonly id: string;
  readonly name: string;
  readonly startTime: number; // Absolute timestamp when recording started
  readonly endTime: number;   // Absolute timestamp when recording ended
  readonly events: RecordedEvent[];
  readonly duration: number;  // Total duration in ms
  /** Metadata about the recording */
  readonly metadata?: {
    readonly agentCount?: number;
    readonly zoneCount?: number;
    readonly description?: string;
  };
}

/**
 * Playback state
 */
export type PlaybackState = 'idle' | 'playing' | 'paused' | 'ended';

/**
 * Playback speed options
 */
export type PlaybackSpeed = 0.25 | 0.5 | 1 | 1.5 | 2 | 4;

/**
 * Replay configuration options
 */
export interface ReplayConfig {
  /** Whether to loop playback */
  readonly loop?: boolean;
  /** Playback speed multiplier */
  readonly speed?: PlaybackSpeed;
  /** Start position in ms (for seeking) */
  readonly startPosition?: number;
  /** Whether to emit events during playback (vs dry-run) */
  readonly emitEvents?: boolean;
}

/**
 * Progress update callback
 */
export type ProgressCallback = (progress: PlaybackProgress) => void;

/**
 * Current playback progress
 */
export interface PlaybackProgress {
  readonly state: PlaybackState;
  readonly currentTime: number;
  readonly duration: number;
  /** Progress as percentage 0-100 */
  readonly percentage: number;
  /** Current event index */
  readonly eventIndex: number;
  /** Total events in recording */
  readonly totalEvents: number;
}

/**
 * Replay event names for UI updates
 */
export interface ReplayEvents {
  readonly 'replay:state_changed': {
    readonly state: PlaybackState;
  };
  'replay:progress': PlaybackProgress;
  'replay:recording_started': {
    sessionId: string;
  };
  'replay:recording_stopped': {
    session: RecordingSession;
  };
  'replay:session_loaded': {
    session: RecordingSession;
  };
  'replay:error': {
    error: string;
  };
}

export type ReplayEventName = keyof ReplayEvents;
export type ReplayEventData<K extends ReplayEventName> = ReplayEvents[K];

/**
 * Generate a unique session ID
 */
export function generateSessionId(): string {
  return `replay_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * Calculate total duration of recorded events
 */
export function calculateDuration(events: RecordedEvent[]): number {
  if (events.length === 0) return 0;
  return events[events.length - 1].timestamp;
}
