/**
 * Replay System
 * Event recording and playback functionality
 */

export {
  ReplayManager,
  replayManager,
  EventRecorder,
  eventRecorder,
  EventPlayback,
  eventPlayback,
} from './ReplayManager';

// Re-export types explicitly to avoid export conflicts
export type {
  RecordedEvent,
  RecordingSession,
  PlaybackState,
  PlaybackSpeed,
  ReplayConfig,
  PlaybackProgress,
  ReplayEventName,
} from './types';

// Re-export for backward compatibility with internal usage
export { generateSessionId, calculateDuration } from './types';
