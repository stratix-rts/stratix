/**
 * Session Recording and Playback System
 *
 * Barrel export for recording module
 */

// Types
export type {
  Recording,
  RecordedAction,
  StateSnapshot,
  RecordingMetadata,
  PlaybackState,
  PlaybackSpeed,
  PlaybackEvents,
} from './types';

// Classes
export { SessionRecorder } from './SessionRecorder';
export { SessionPlayer, type SessionPlayerEvents } from './SessionPlayer';
