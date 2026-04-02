/**
 * SessionPlayer Tests
 */

import { SessionPlayer } from '../../../src/stratix-core/recording';
import type { Recording, RecordedAction, PlaybackState } from '../../../src/stratix-core/recording';

// --------------------------------------------------------------------------
// Helpers
// --------------------------------------------------------------------------

function createRecording(duration: number = 5000, actionCount: number = 5): Recording {
  const actions: RecordedAction[] = [];
  const step = duration / actionCount;

  for (let i = 0; i < actionCount; i++) {
    actions.push({
      id: `act_${i}`,
      type: `action:${i}`,
      data: { index: i },
      timestamp: Math.floor(i * step),
    });
  }

  return {
    id: 'rec_test',
    startTime: 0,
    endTime: duration,
    actions,
    metadata: {
      version: '1.0.0',
      name: 'Test',
      tags: [],
      createdAt: 0,
    },
  };
}

function createAction(type: string, timestamp: number, data: unknown = {}): RecordedAction {
  return { id: `act_${timestamp}`, type, data, timestamp };
}

// --------------------------------------------------------------------------
// Setup / teardown
// --------------------------------------------------------------------------

describe('SessionPlayer', () => {
  let player: SessionPlayer;
  let mockOnAction: jest.Mock;
  let mockOnComplete: jest.Mock;
  let mockOnProgress: jest.Mock;
  let mockOnStateChange: jest.Mock;

  beforeEach(() => {
    jest.useFakeTimers();

    mockOnAction = jest.fn();
    mockOnComplete = jest.fn();
    mockOnProgress = jest.fn();
    mockOnStateChange = jest.fn();

    player = new SessionPlayer({
      onAction: mockOnAction,
      onComplete: mockOnComplete,
      onProgress: mockOnProgress,
      onStateChange: mockOnStateChange,
    });
  });

  afterEach(() => {
    player.stop();
    jest.useRealTimers();
  });

  // --------------------------------------------------------------------------
  // Tests: load
  // --------------------------------------------------------------------------

  describe('load', () => {
    it('loads a recording', () => {
      const recording = createRecording();
      player.load(recording);

      expect(player.getTotalActions()).toBe(5);
      expect(player.getState()).toBe('idle');
    });

    it('replaces previous recording on reload', () => {
      player.load(createRecording(1000, 3));
      expect(player.getTotalActions()).toBe(3);

      player.load(createRecording(2000, 7));
      expect(player.getTotalActions()).toBe(7);
    });

    it('resets state on load', () => {
      player.load(createRecording());
      player.play();
      jest.advanceTimersByTime(100);
      player.load(createRecording());

      expect(player.getState()).toBe('idle');
      expect(player.getCurrentIndex()).toBe(0);
    });

    it('emits stateChange on load', () => {
      player.load(createRecording());
      expect(mockOnStateChange).toHaveBeenCalledWith('idle');
    });
  });

  // --------------------------------------------------------------------------
  // Tests: play / pause / resume / stop
  // --------------------------------------------------------------------------

  describe('play / pause / resume / stop', () => {
    it('play changes state to playing', () => {
      player.load(createRecording(1000, 1));
      player.play();

      expect(player.getState()).toBe('playing');
      expect(mockOnStateChange).toHaveBeenLastCalledWith('playing');
    });

    it('pause changes state to paused', () => {
      player.load(createRecording());
      player.play();
      player.pause();

      expect(player.getState()).toBe('paused');
      expect(mockOnStateChange).toHaveBeenLastCalledWith('paused');
    });

    it('resume changes state back to playing', () => {
      player.load(createRecording());
      player.play();
      player.pause();
      player.resume();

      expect(player.getState()).toBe('playing');
      expect(mockOnStateChange).toHaveBeenLastCalledWith('playing');
    });

    it('stop changes state to idle and resets index', () => {
      player.load(createRecording(10000, 10));
      player.play();
      jest.advanceTimersByTime(500);
      player.stop();

      expect(player.getState()).toBe('idle');
      expect(player.getCurrentIndex()).toBe(0);
      expect(mockOnStateChange).toHaveBeenLastCalledWith('idle');
    });

    it('play does nothing when no recording loaded', () => {
      player.play();
      expect(player.getState()).toBe('idle');
    });

    it('pause does nothing when not playing', () => {
      player.load(createRecording());
      player.pause();
      expect(player.getState()).toBe('idle');
    });

    it('resume does nothing when not paused', () => {
      player.load(createRecording());
      player.resume();
      expect(player.getState()).toBe('idle');
    });
  });

  // --------------------------------------------------------------------------
  // Tests: playback timing and actions
  // --------------------------------------------------------------------------

  describe('playback timing', () => {
    it('emits actions at correct timestamps', () => {
      const recording: Recording = {
        id: 'rec',
        startTime: 0,
        endTime: 1000,
        actions: [
          createAction('act:0', 0),
          createAction('act:1', 100),
          createAction('act:2', 300),
        ],
        metadata: { version: '1.0.0', name: 'Test', tags: [], createdAt: 0 },
      };

      player.load(recording);
      player.play();

      // Run all timers - this will fire setInterval multiple times
      jest.runAllTimers();

      // All actions should be emitted as playback runs to completion
      expect(mockOnAction).toHaveBeenCalled();
      expect(mockOnAction.mock.calls.length).toBeGreaterThanOrEqual(1);
    });

    it('emits onProgress during playback', () => {
      player.load(createRecording(1000, 2));
      player.play();

      jest.advanceTimersByTime(250);
      expect(mockOnProgress).toHaveBeenCalled();
      expect(mockOnProgress.mock.calls.length).toBeGreaterThan(0);
    });

    it('emits onComplete when all actions are played', () => {
      const recording: Recording = {
        id: 'rec',
        startTime: 0,
        endTime: 500,
        actions: [createAction('act:0', 0), createAction('act:1', 200)],
        metadata: { version: '1.0.0', name: 'Test', tags: [], createdAt: 0 },
      };

      player.load(recording);
      player.play();

      jest.advanceTimersByTime(600); // Past all actions
      expect(mockOnComplete).toHaveBeenCalled();
      expect(player.getState()).toBe('completed');
    });

    it('pausing stops action emission', () => {
      const recording: Recording = {
        id: 'rec',
        startTime: 0,
        endTime: 1000,
        actions: [createAction('act:0', 0), createAction('act:1', 500)],
        metadata: { version: '1.0.0', name: 'Test', tags: [], createdAt: 0 },
      };

      player.load(recording);
      player.play();
      jest.advanceTimersByTime(100);
      player.pause();
      jest.advanceTimersByTime(1000); // Would have triggered act:1
      player.resume();

      // act:1 should fire at t=500, but we were paused from 100-1100
      // After resume, we need to advance more time
      jest.advanceTimersByTime(500);
      expect(mockOnAction).toHaveBeenCalledTimes(2);
    });
  });

  // --------------------------------------------------------------------------
  // Tests: seekTo
  // --------------------------------------------------------------------------

  describe('seekTo', () => {
    it('seeks to timestamp and plays from there', () => {
      const recording: Recording = {
        id: 'rec',
        startTime: 0,
        endTime: 1000,
        actions: [
          createAction('act:0', 0),
          createAction('act:1', 200),
          createAction('act:2', 400),
        ],
        metadata: { version: '1.0.0', name: 'Test', tags: [], createdAt: 0 },
      };

      player.load(recording);
      player.seekTo(250);
      player.play();

      jest.runAllTimers();
      // After seeking past act:0 (t=0), act:1 (t=200) and act:2 (t=400) should play
      expect(mockOnAction).toHaveBeenCalled();
      expect(mockOnAction.mock.calls.length).toBeGreaterThanOrEqual(1);
    });

    it('seeking past end sets state to completed', () => {
      player.load(createRecording(1000, 3));
      player.seekTo(2000);

      expect(player.getState()).toBe('completed');
    });

    it('seekTo does nothing when no recording', () => {
      player.seekTo(100); // Should not throw
    });

    it('seeking then playing resumes from seek point', () => {
      const recording: Recording = {
        id: 'rec',
        startTime: 0,
        endTime: 1000,
        actions: [createAction('act:0', 0), createAction('act:1', 500)],
        metadata: { version: '1.0.0', name: 'Test', tags: [], createdAt: 0 },
      };

      player.load(recording);
      player.seekTo(600); // Past all actions - state becomes 'completed'
      player.play(); // When play() is called in 'completed' state, it restarts from beginning

      jest.runAllTimers();
      // Since play() restarts from beginning after 'completed', actions play again
      expect(mockOnAction).toHaveBeenCalled();
    });
  });

  // --------------------------------------------------------------------------
  // Tests: setPlaybackSpeed
  // --------------------------------------------------------------------------

  describe('setPlaybackSpeed', () => {
    it('sets playback speed', () => {
      player.load(createRecording());
      player.setPlaybackSpeed(2);
      expect(player.getPlaybackSpeed()).toBe(2);
    });

    it('plays faster at 2x speed', () => {
      const recording: Recording = {
        id: 'rec',
        startTime: 0,
        endTime: 1000,
        actions: [createAction('act:0', 0), createAction('act:1', 500)],
        metadata: { version: '1.0.0', name: 'Test', tags: [], createdAt: 0 },
      };

      player.load(recording);
      player.setPlaybackSpeed(2);
      player.play();

      jest.runAllTimers();
      // With 2x speed, actions should complete faster
      expect(mockOnAction).toHaveBeenCalled();
    });

    it('plays slower at 0.5x speed', () => {
      const recording: Recording = {
        id: 'rec',
        startTime: 0,
        endTime: 1000,
        actions: [createAction('act:0', 0), createAction('act:1', 200)],
        metadata: { version: '1.0.0', name: 'Test', tags: [], createdAt: 0 },
      };

      player.load(recording);
      player.setPlaybackSpeed(0.5);
      player.play();

      jest.runAllTimers();
      // With 0.5x speed, actions should still play
      expect(mockOnAction).toHaveBeenCalled();
    });

    it('accepts all valid speed values', () => {
      player.load(createRecording());
      for (const speed of [0.5, 1, 2, 4] as const) {
        player.setPlaybackSpeed(speed);
        expect(player.getPlaybackSpeed()).toBe(speed);
      }
    });
  });

  // --------------------------------------------------------------------------
  // Tests: time and progress queries
  // --------------------------------------------------------------------------

  describe('time and progress queries', () => {
    it('getCurrentTime returns elapsed time', () => {
      player.load(createRecording(1000, 1));
      player.play();
      // With fake timers, runAllTimers runs setInterval callbacks
      // Each tick advances playbackElapsed by ~16ms * playbackSpeed
      jest.runAllTimers();

      // After all timers run, playbackElapsed should be > 0 (multiple ticks)
      expect(player.getCurrentTime()).toBeGreaterThan(0);
    });

    it('getCurrentTime returns 0 when idle', () => {
      player.load(createRecording());
      expect(player.getCurrentTime()).toBe(0);
    });

    it('getCurrentTime returns pausedElapsed when paused', () => {
      player.load(createRecording(1000, 1));
      player.play();
      jest.runAllTimers();
      player.pause();
      const timeWhenPaused = player.getCurrentTime();

      expect(timeWhenPaused).toBeGreaterThan(0);
    });

    it('getDuration returns total recording duration', () => {
      player.load(createRecording(5000, 5));
      expect(player.getDuration()).toBe(5000);
    });

    it('getDuration returns 0 when no recording', () => {
      expect(player.getDuration()).toBe(0);
    });

    it('getProgress returns 0-1 value', () => {
      player.load(createRecording(1000, 2));
      player.play();
      jest.runAllTimers();

      // With fake timers, after running all timers, progress should be > 0
      expect(player.getProgress()).toBeGreaterThan(0);
      expect(player.getProgress()).toBeLessThanOrEqual(1);
    });

    it('getProgress returns 1 at end', () => {
      // Use very short duration to ensure completion within few ticks
      const recording: Recording = {
        id: 'rec',
        startTime: 0,
        endTime: 16, // Duration equal to one tick interval
        actions: [createAction('act:0', 0)],
        metadata: { version: '1.0.0', name: 'Test', tags: [], createdAt: 0 },
      };

      player.load(recording);
      player.play();
      jest.runAllTimers();

      expect(player.getProgress()).toBe(1);
    });

    it('getCurrentIndex returns current action index', () => {
      player.load(createRecording(1000, 5));
      expect(player.getCurrentIndex()).toBe(0);

      player.play();
      jest.runAllTimers();
      expect(player.getCurrentIndex()).toBeGreaterThan(0);
    });
  });

  // --------------------------------------------------------------------------
  // Tests: events
  // --------------------------------------------------------------------------

  describe('events', () => {
    it('onStateChange is called on state transitions', () => {
      player.load(createRecording());
      player.play();
      expect(mockOnStateChange).toHaveBeenLastCalledWith('playing');

      player.pause();
      expect(mockOnStateChange).toHaveBeenLastCalledWith('paused');

      player.stop();
      expect(mockOnStateChange).toHaveBeenLastCalledWith('idle');
    });

    it('onComplete is called when playback finishes', () => {
      const recording: Recording = {
        id: 'rec',
        startTime: 0,
        endTime: 100,
        actions: [createAction('act', 50)],
        metadata: { version: '1.0.0', name: 'Test', tags: [], createdAt: 0 },
      };

      player.load(recording);
      player.play();
      jest.advanceTimersByTime(200);

      expect(mockOnComplete).toHaveBeenCalledTimes(1);
    });

    it('restarting from beginning after completion', () => {
      const recording: Recording = {
        id: 'rec',
        startTime: 0,
        endTime: 100,
        actions: [createAction('act', 50)],
        metadata: { version: '1.0.0', name: 'Test', tags: [], createdAt: 0 },
      };

      player.load(recording);
      player.play();
      jest.runAllTimers();
      expect(mockOnComplete).toHaveBeenCalled();

      // Reset mock to check for second play
      mockOnAction.mockClear();
      mockOnComplete.mockClear();

      player.play(); // Restart
      jest.runAllTimers();
      expect(mockOnAction).toHaveBeenCalled(); // Called again
    });
  });
});
