/**
 * SessionRecorder Tests
 */

import { SessionRecorder } from '../../../src/stratix-core/recording';
import type { Recording, RecordedAction } from '../../../src/stratix-core/recording';

// --------------------------------------------------------------------------
// Helpers
// --------------------------------------------------------------------------

function createRecording(): Recording {
  return {
    id: 'rec_123_abc',
    startTime: 1000,
    endTime: 5000,
    actions: [
      { id: 'act_1', type: 'agent:move', data: { agentId: 'a1', x: 100, y: 200 }, timestamp: 0 },
      { id: 'act_2', type: 'agent:move', data: { agentId: 'a1', x: 150, y: 250 }, timestamp: 500 },
      { id: 'act_3', type: 'zone:select', data: { zoneId: 'z1' }, timestamp: 1000 },
    ],
    metadata: {
      version: '1.0.0',
      name: 'Test Recording',
      tags: [],
      createdAt: 1000,
    },
  };
}

// --------------------------------------------------------------------------
// Setup / teardown
// --------------------------------------------------------------------------

describe('SessionRecorder', () => {
  let recorder: SessionRecorder;

  beforeEach(() => {
    recorder = new SessionRecorder();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  // --------------------------------------------------------------------------
  // Tests: startRecording / stopRecording
  // --------------------------------------------------------------------------

  describe('startRecording / stopRecording', () => {
    it('starts a new recording with default name', () => {
      recorder.startRecording();
      expect(recorder.isActive()).toBe(true);
    });

    it('starts a new recording with custom name', () => {
      recorder.startRecording('My Session');
      expect(recorder.isActive()).toBe(true);
    });

    it('starts a new recording with name and description', () => {
      recorder.startRecording('My Session', 'Test description');
      expect(recorder.isActive()).toBe(true);
    });

    it('stopRecording returns a Recording object', () => {
      recorder.startRecording('Test');
      jest.advanceTimersByTime(1000);
      const recording = recorder.stopRecording();

      expect(recording.id).toMatch(/^rec_/);
      expect(recording.startTime).toBeGreaterThan(0);
      expect(recording.endTime).toBeGreaterThanOrEqual(recording.startTime);
      expect(recording.metadata.name).toBe('Test');
    });

    it('stopRecording clears isActive', () => {
      recorder.startRecording();
      recorder.stopRecording();
      expect(recorder.isActive()).toBe(false);
    });

    it('calling stopRecording twice returns empty recording', () => {
      recorder.startRecording('Test');
      recorder.stopRecording();
      const second = recorder.stopRecording();

      expect(second.id).toBe('');
      expect(second.actions).toEqual([]);
    });
  });

  // --------------------------------------------------------------------------
  // Tests: recordAction
  // --------------------------------------------------------------------------

  describe('recordAction', () => {
    it('records an action with auto-timestamp', () => {
      recorder.startRecording();
      jest.advanceTimersByTime(500);
      recorder.recordAction('agent:move', { agentId: 'a1', x: 100, y: 200 });

      const recording = recorder.stopRecording();
      expect(recording.actions).toHaveLength(1);
      expect(recording.actions[0].type).toBe('agent:move');
      expect(recording.actions[0].data).toEqual({ agentId: 'a1', x: 100, y: 200 });
      expect(recording.actions[0].timestamp).toBe(500);
    });

    it('records multiple actions with increasing timestamps', () => {
      recorder.startRecording();

      recorder.recordAction('agent:move', { agentId: 'a1' });
      jest.advanceTimersByTime(200);
      recorder.recordAction('zone:select', { zoneId: 'z1' });
      jest.advanceTimersByTime(300);
      recorder.recordAction('agent:stop', { agentId: 'a1' });

      const recording = recorder.stopRecording();
      expect(recording.actions).toHaveLength(3);
      expect(recording.actions[0].timestamp).toBe(0);
      expect(recording.actions[1].timestamp).toBe(200);
      expect(recording.actions[2].timestamp).toBe(500);
    });

    it('does not record when not recording', () => {
      recorder.recordAction('agent:move', { agentId: 'a1' });
      const recording = recorder.stopRecording();
      expect(recording.actions).toHaveLength(0);
    });
  });

  // --------------------------------------------------------------------------
  // Tests: pause / resume
  // --------------------------------------------------------------------------

  describe('pause / resume', () => {
    it('pause sets isPausedState to true', () => {
      recorder.startRecording();
      recorder.pause();
      expect(recorder.isPausedState()).toBe(true);
    });

    it('resume clears isPausedState', () => {
      recorder.startRecording();
      recorder.pause();
      recorder.resume();
      expect(recorder.isPausedState()).toBe(false);
    });

    it('actions are not recorded while paused', () => {
      recorder.startRecording();
      recorder.recordAction('action:1', { n: 1 });
      jest.advanceTimersByTime(100);
      recorder.pause();
      jest.advanceTimersByTime(1000); // This time should NOT be counted
      recorder.recordAction('action:2', { n: 2 }); // Should be ignored
      recorder.resume();
      recorder.recordAction('action:3', { n: 3 });

      const recording = recorder.stopRecording();
      expect(recording.actions).toHaveLength(2);
      expect(recording.actions[0].data).toEqual({ n: 1 });
      expect(recording.actions[1].data).toEqual({ n: 3 });
    });

    it('timestamps are adjusted after pause/resume', () => {
      recorder.startRecording();
      recorder.recordAction('action:1', {});
      jest.advanceTimersByTime(100);
      recorder.pause();
      jest.advanceTimersByTime(500); // Paused time
      recorder.resume();
      jest.advanceTimersByTime(100);
      recorder.recordAction('action:2', {});

      const recording = recorder.stopRecording();
      expect(recording.actions).toHaveLength(2);
      // First action at t=100, second at t=200 (100 + 100, not 100 + 500 + 100)
      expect(recording.actions[1].timestamp).toBe(200);
    });

    it('pause does nothing when not recording', () => {
      recorder.pause();
      expect(recorder.isPausedState()).toBe(false);
    });

    it('resume does nothing when not paused', () => {
      recorder.startRecording();
      recorder.resume(); // Should not throw
      expect(recorder.isPausedState()).toBe(false);
    });
  });

  // --------------------------------------------------------------------------
  // Tests: metadata
  // --------------------------------------------------------------------------

  describe('metadata', () => {
    it('records name in metadata', () => {
      recorder.startRecording('Test Session');
      recorder.stopRecording();
      // Recording name is stored in metadata
    });

    it('addTag adds a tag to the recording', () => {
      recorder.startRecording('Test');
      recorder.addTag('important');
      recorder.addTag('demo');
      recorder.addTag('important'); // Duplicate - should not be added twice

      const recording = recorder.stopRecording();
      expect(recording.metadata.tags).toEqual(['important', 'demo']);
    });
  });

  // --------------------------------------------------------------------------
  // Tests: state queries
  // --------------------------------------------------------------------------

  describe('state queries', () => {
    it('isActive returns true during recording', () => {
      recorder.startRecording();
      expect(recorder.isActive()).toBe(true);
    });

    it('isActive returns false when not recording', () => {
      expect(recorder.isActive()).toBe(false);
    });

    it('getActionCount returns correct count', () => {
      recorder.startRecording();
      recorder.recordAction('a', {});
      recorder.recordAction('b', {});
      expect(recorder.getActionCount()).toBe(2);
    });

    it('getElapsedTime returns time since start', () => {
      recorder.startRecording();
      jest.advanceTimersByTime(1234);
      expect(recorder.getElapsedTime()).toBe(1234);
    });

    it('getElapsedTime returns 0 when not recording', () => {
      expect(recorder.getElapsedTime()).toBe(0);
    });
  });

  // --------------------------------------------------------------------------
  // Tests: captureSnapshot
  // --------------------------------------------------------------------------

  describe('captureSnapshot', () => {
    it('returns a StateSnapshot object', () => {
      recorder.startRecording();
      const snapshot = recorder.captureSnapshot();

      expect(snapshot).not.toBeNull();
      expect(snapshot!.timestamp).toBeGreaterThanOrEqual(0);
      expect(snapshot!.state).toBeDefined();
    });

    it('snapshot includes agents, zones, sessions, ui, mcp', () => {
      recorder.startRecording();
      const snapshot = recorder.captureSnapshot();

      expect(snapshot!.state).toHaveProperty('agents');
      expect(snapshot!.state).toHaveProperty('zones');
      expect(snapshot!.state).toHaveProperty('sessions');
      expect(snapshot!.state).toHaveProperty('ui');
      expect(snapshot!.state).toHaveProperty('mcp');
    });
  });

  // --------------------------------------------------------------------------
  // Tests: recordActionWithSnapshot
  // --------------------------------------------------------------------------

  describe('recordActionWithSnapshot', () => {
    it('records action with snapshot attached', () => {
      recorder.startRecording();
      recorder.recordActionWithSnapshot('agent:move', { agentId: 'a1' });

      const recording = recorder.stopRecording();
      expect(recording.actions).toHaveLength(1);
      expect(recording.actions[0].snapshot).toBeDefined();
      expect(recording.actions[0].snapshot!.timestamp).toBeGreaterThanOrEqual(0);
    });
  });
});
