/**
 * Replay System Types
 * Defines types for the event recording and playback system
 */

import type { RTSEventName, RTSEventData, AllRTSEvents } from '../types/RTSEventTypes';

/**
 * A single recorded event with relative timestamp
 */
export interface RecordedEvent {
  event: RTSEventName;
  data: RTSEventData<RTSEventName>;
  /** Relative time in milliseconds from recording start */
  timestamp: number;
}

/**
 * A complete recording session
 */
export interface RecordingSession {
  id: string;
  name: string;
  startTime: number; // Absolute timestamp when recording started
  endTime: number;   // Absolute timestamp when recording ended
  events: RecordedEvent[];
  duration: number;  // Total duration in ms
  /** Metadata about the recording */
  metadata?: {
    agentCount?: number;
    zoneCount?: number;
    description?: string;
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
  loop?: boolean;
  /** Playback speed multiplier */
  speed?: PlaybackSpeed;
  /** Start position in ms (for seeking) */
  startPosition?: number;
  /** Whether to emit events during playback (vs dry-run) */
  emitEvents?: boolean;
}

/**
 * Progress update callback
 */
export type ProgressCallback = (progress: PlaybackProgress) => void;

/**
 * Current playback progress
 */
export interface PlaybackProgress {
  state: PlaybackState;
  currentTime: number;
  duration: number;
  /** Progress as percentage 0-100 */
  percentage: number;
  /** Current event index */
  eventIndex: number;
  /** Total events in recording */
  totalEvents: number;
}

/**
 * Replay event names for UI updates
 */
export interface ReplayEvents {
  'replay:state_changed': {
    state: PlaybackState;
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
