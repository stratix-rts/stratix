/**
 * Session Recording and Playback Types
 *
 * Type definitions for RTS command recording and playback system
 */

export type PlaybackSpeed = 0.5 | 1 | 2 | 4;

export type PlaybackState = 'idle' | 'playing' | 'paused' | 'completed';

/**
 * A single recorded action in a session
 */
export interface RecordedAction {
  /** Unique action ID */
  id: string;
  /** Action type identifier (e.g., 'agent:move', 'zone:create') */
  type: string;
  /** Action payload data */
  data: unknown;
  /** Timestamp relative to recording start (ms) */
  timestamp: number;
  /** Optional state snapshot taken with this action */
  snapshot?: StateSnapshot;
}

/**
 * State snapshot for capturing full system state at a point in time
 */
export interface StateSnapshot {
  /** Serialized state data */
  state: Record<string, unknown>;
  /** Snapshot timestamp */
  timestamp: number;
}

/**
 * Recording metadata
 */
export interface RecordingMetadata {
  /** Recording version */
  version: string;
  /** Session name */
  name: string;
  /** Session description */
  description?: string;
  /** Screen resolution */
  resolution?: {
    width: number;
    height: number;
  };
  /** Tags for categorization */
  tags: string[];
  /** Recording start time (Unix timestamp) */
  createdAt: number;
}

/**
 * Complete recording session
 */
export interface Recording {
  /** Unique recording ID */
  id: string;
  /** Recording start time (Unix timestamp) */
  startTime: number;
  /** Recording end time (Unix timestamp) */
  endTime: number;
  /** All recorded actions */
  actions: RecordedAction[];
  /** Recording metadata */
  metadata: RecordingMetadata;
}

/**
 * Events emitted by SessionPlayer during playback
 */
export interface PlaybackEvents {
  /** Emitted when an action is about to be played */
  onAction: (action: RecordedAction, index: number) => void;
  /** Emitted when playback completes */
  onComplete: () => void;
  /** Emitted on playback progress (0-1) */
  onProgress: (progress: number, currentTime: number) => void;
}
