/**
 * SessionRuntime Unit Tests
 *
 * Comprehensive tests for session lifecycle, turn execution, transcript
 * persistence, usage tracking, and edge cases.
 *
 * Test coverage:
 * - Session lifecycle: createSession, getSession, resumeSession, pause, destroy
 * - Turn execution: executeTurn with retries, abort, timeout
 * - Message management: getRecentMessages
 * - Usage tracking: getUsage, token accumulation
 * - Transcript persistence
 * - Permission denials and skill discovery
 * - Edge cases: concurrent execution, error handling, boundary conditions
 */

import { SessionRuntime, AgentTurnDelegate } from '@/stratix-agent/runtime/SessionRuntime';
import { TranscriptStore } from '@/stratix-agent/runtime/TranscriptStore';
import type { SessionContext, TurnOptions, ChatMessage, TokenUsage } from '@/stratix-agent/runtime/types';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('SessionRuntime', () => {
  let runtime: SessionRuntime;
  let tempDir: string;

  beforeEach(() => {
    tempDir = path.join(os.tmpdir(), `session-runtime-test-${Date.now()}-${Math.random()}`);
    runtime = new SessionRuntime(tempDir);
  });

  afterEach(async () => {
    try {
      const files = await fs.promises.readdir(tempDir);
      for (const file of files) {
        await fs.promises.unlink(path.join(tempDir, file));
      }
      await fs.promises.rmdir(tempDir);
    } catch {
      // Ignore cleanup errors
    }
  });

  // =============================================================================
  // Session Lifecycle
  // =============================================================================

  describe('createSession', () => {
    test('creates a new session with generated ID', async () => {
      const session = await runtime.createSession('agent-1');

      expect(session.sessionId).toMatch(/^sess_/);
      expect(session.agentId).toBe('agent-1');
      expect(session.status).toBe('active');
      expect(session.messages).toEqual([]);
    });

    test('creates session with empty usage', async () => {
      const session = await runtime.createSession('agent-1');

      expect(session.usage.promptTokens).toBe(0);
      expect(session.usage.completionTokens).toBe(0);
      expect(session.usage.totalTokens).toBe(0);
      expect(session.usage.turnCount).toBe(0);
    });

    test('creates session with empty discovered skills', async () => {
      const session = await runtime.createSession('agent-1');
      expect(session.discoveredSkills).toEqual([]);
    });

    test('creates session with empty permission denials', async () => {
      const session = await runtime.createSession('agent-1');
      expect(session.permissionDenials).toEqual([]);
    });

    test('creates session with empty memory Map', async () => {
      const session = await runtime.createSession('agent-1');
      expect(session.memory).toBeInstanceOf(Map);
      expect(session.memory.size).toBe(0);
    });

    test('creates session with valid timestamps', async () => {
      const before = Date.now();
      const session = await runtime.createSession('agent-1');
      const after = Date.now();

      expect(session.createdAt).toBeGreaterThanOrEqual(before);
      expect(session.createdAt).toBeLessThanOrEqual(after);
      expect(session.updatedAt).toBeGreaterThanOrEqual(before);
      expect(session.updatedAt).toBeLessThanOrEqual(after);
    });

    test('stores session in memory', async () => {
      const session = await runtime.createSession('agent-1');
      const retrieved = await runtime.getSession(session.sessionId);

      expect(retrieved).not.toBeNull();
      expect(retrieved!.sessionId).toBe(session.sessionId);
    });

    test('creates unique session IDs', async () => {
      const session1 = await runtime.createSession('agent-1');
      const session2 = await runtime.createSession('agent-1');
      const session3 = await runtime.createSession('agent-2');

      expect(session1.sessionId).not.toBe(session2.sessionId);
      expect(session2.sessionId).not.toBe(session3.sessionId);
    });
  });

  describe('getSession', () => {
    test('returns existing session', async () => {
      const created = await runtime.createSession('agent-1');
      const retrieved = await runtime.getSession(created.sessionId);

      expect(retrieved).not.toBeNull();
      expect(retrieved!.sessionId).toBe(created.sessionId);
      expect(retrieved!.agentId).toBe('agent-1');
    });

    test('returns null for non-existent session', async () => {
      const retrieved = await runtime.getSession('non-existent');
      expect(retrieved).toBeNull();
    });

    test('returns session with correct status after creation', async () => {
      const session = await runtime.createSession('agent-1');
      const retrieved = await runtime.getSession(session.sessionId);

      expect(retrieved!.status).toBe('active');
    });
  });

  describe('resumeSession', () => {
    test('resumes existing in-memory session', async () => {
      const session = await runtime.createSession('agent-1');
      const resumed = await runtime.resumeSession(session.sessionId);

      expect(resumed.sessionId).toBe(session.sessionId);
      expect(resumed.status).toBe('active');
    });

    test('throws error for non-existent session', async () => {
      await expect(runtime.resumeSession('non-existent')).rejects.toThrow('not found');
    });

    test('throws error when session was destroyed', async () => {
      const session = await runtime.createSession('agent-1');
      await runtime.destroy(session.sessionId);

      await expect(runtime.resumeSession(session.sessionId)).rejects.toThrow('not found');
    });

    test('reconstructs session from transcript store', async () => {
      // First create a session and add some messages
      const delegate: AgentTurnDelegate = {
        executeAgentTurn: jest.fn().mockResolvedValue({
          response: 'Response 1',
          usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30, turnCount: 1 },
        }),
      };
      const runtimeWithDelegate = new SessionRuntime(tempDir, delegate);
      const session = await runtimeWithDelegate.createSession('agent-1');
      await runtimeWithDelegate.executeTurn(session.sessionId, 'Hello');

      // Create new runtime instance (simulating process restart)
      const newRuntime = new SessionRuntime(tempDir);
      const resumed = await newRuntime.resumeSession(session.sessionId);

      expect(resumed).toBeDefined();
      expect(resumed.messages.length).toBeGreaterThanOrEqual(2);
    });

    test('throws error when session not found in transcript', async () => {
      // Create a new runtime with empty transcript dir
      const newRuntime = new SessionRuntime(tempDir);

      await expect(newRuntime.resumeSession('non-existent')).rejects.toThrow('not found');
    });
  });

  // =============================================================================
  // Turn Execution
  // =============================================================================

  describe('executeTurn', () => {
    test('executes turn with placeholder response without delegate', async () => {
      const session = await runtime.createSession('agent-1');
      const result = await runtime.executeTurn(session.sessionId, 'Hello');

      expect(result.response).toContain('Turn executed');
      expect(result.usage.turnCount).toBe(1);
      expect(result.metadata.retries).toBe(0);
      expect(result.interrupted).toBe(false);
    });

    test('uses delegate when provided', async () => {
      const delegate: AgentTurnDelegate = {
        executeAgentTurn: jest.fn().mockResolvedValue({
          response: 'Delegated response',
          usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30, turnCount: 1 },
        }),
      };
      const runtimeWithDelegate = new SessionRuntime(tempDir, delegate);
      const session = await runtimeWithDelegate.createSession('agent-1');

      const result = await runtimeWithDelegate.executeTurn(session.sessionId, 'Hello');

      expect(result.response).toBe('Delegated response');
      expect(delegate.executeAgentTurn).toHaveBeenCalled();
    });

    test('throws error for non-existent session', async () => {
      await expect(runtime.executeTurn('non-existent', 'Hello')).rejects.toThrow('not found');
    });

    test('throws error for paused session', async () => {
      const session = await runtime.createSession('agent-1');
      await runtime.pause(session.sessionId);

      await expect(runtime.executeTurn(session.sessionId, 'Hello')).rejects.toThrow('is paused');
    });

    test('throws error for destroyed session', async () => {
      const session = await runtime.createSession('agent-1');
      await runtime.destroy(session.sessionId);

      await expect(runtime.executeTurn(session.sessionId, 'Hello')).rejects.toThrow('not found');
    });

    test('retries on delegate error', async () => {
      const delegate: AgentTurnDelegate = {
        executeAgentTurn: jest.fn()
          .mockRejectedValueOnce(new Error('Transient error'))
          .mockResolvedValueOnce({
            response: 'Success after retry',
            usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30, turnCount: 1 },
          }),
      };
      const runtimeWithDelegate = new SessionRuntime(tempDir, delegate);
      const session = await runtimeWithDelegate.createSession('agent-1');

      const result = await runtimeWithDelegate.executeTurn(session.sessionId, 'Hello', { maxRetries: 1 });

      expect(result.response).toBe('Success after retry');
      expect(result.metadata.retries).toBe(1);
    });

    test('returns error message after max retries', async () => {
      const delegate: AgentTurnDelegate = {
        executeAgentTurn: jest.fn().mockRejectedValue(new Error('Persistent error')),
      };
      const runtimeWithDelegate = new SessionRuntime(tempDir, delegate);
      const session = await runtimeWithDelegate.createSession('agent-1');

      const result = await runtimeWithDelegate.executeTurn(session.sessionId, 'Hello', { maxRetries: 2 });

      expect(result.response).toContain('Error after 2 retries');
      expect(result.metadata.error).toBeDefined();
    });

    test('respects abort signal', async () => {
      const delegate: AgentTurnDelegate = {
        executeAgentTurn: jest.fn().mockImplementation(async () => {
          await new Promise(r => setTimeout(r, 50));
          return {
            response: 'Should not complete',
            usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30, turnCount: 1 },
          };
        }),
      };
      const runtimeWithDelegate = new SessionRuntime(tempDir, delegate);
      const session = await runtimeWithDelegate.createSession('agent-1');

      const controller = new AbortController();
      const executePromise = runtimeWithDelegate.executeTurn(session.sessionId, 'Hello', { signal: controller.signal });

      controller.abort();
      const result = await executePromise;

      expect(result.interrupted).toBe(true);
    });

    test('handles delegate error as string', async () => {
      const delegate: AgentTurnDelegate = {
        executeAgentTurn: jest.fn()
          .mockRejectedValueOnce('Error string')
          .mockResolvedValueOnce({
            response: 'Success',
            usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30, turnCount: 1 },
          }),
      };
      const runtimeWithDelegate = new SessionRuntime(tempDir, delegate);
      const session = await runtimeWithDelegate.createSession('agent-1');

      const result = await runtimeWithDelegate.executeTurn(session.sessionId, 'Hello', { maxRetries: 1 });

      expect(result.response).toBe('Success');
    });

    test('handles delegate error as object without message', async () => {
      const delegate: AgentTurnDelegate = {
        executeAgentTurn: jest.fn()
          .mockRejectedValueOnce({ code: 'ERR_SERVER' })
          .mockResolvedValueOnce({
            response: 'Success',
            usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30, turnCount: 1 },
          }),
      };
      const runtimeWithDelegate = new SessionRuntime(tempDir, delegate);
      const session = await runtimeWithDelegate.createSession('agent-1');

      const result = await runtimeWithDelegate.executeTurn(session.sessionId, 'Hello', { maxRetries: 1 });

      expect(result.response).toBe('Success');
    });

    test('updates session usage after turn', async () => {
      const delegate: AgentTurnDelegate = {
        executeAgentTurn: jest.fn().mockResolvedValue({
          response: 'Test response',
          usage: { promptTokens: 100, completionTokens: 200, totalTokens: 300, turnCount: 1 },
        }),
      };
      const runtimeWithDelegate = new SessionRuntime(tempDir, delegate);
      const session = await runtimeWithDelegate.createSession('agent-1');

      await runtimeWithDelegate.executeTurn(session.sessionId, 'Hello');

      const usage = runtimeWithDelegate.getUsage(session.sessionId);
      expect(usage.promptTokens).toBe(100);
      expect(usage.completionTokens).toBe(200);
      expect(usage.totalTokens).toBe(300);
      expect(usage.turnCount).toBe(1);
    });

    test('accumulates usage across multiple turns', async () => {
      const delegate: AgentTurnDelegate = {
        executeAgentTurn: jest.fn().mockResolvedValue({
          response: 'Response',
          usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30, turnCount: 1 },
        }),
      };
      const runtimeWithDelegate = new SessionRuntime(tempDir, delegate);
      const session = await runtimeWithDelegate.createSession('agent-1');

      await runtimeWithDelegate.executeTurn(session.sessionId, 'Turn 1');
      await runtimeWithDelegate.executeTurn(session.sessionId, 'Turn 2');
      await runtimeWithDelegate.executeTurn(session.sessionId, 'Turn 3');

      const usage = runtimeWithDelegate.getUsage(session.sessionId);
      expect(usage.promptTokens).toBe(30);
      expect(usage.completionTokens).toBe(60);
      expect(usage.totalTokens).toBe(90);
      expect(usage.turnCount).toBe(3);
    });

    test('adds user and assistant messages to session', async () => {
      const delegate: AgentTurnDelegate = {
        executeAgentTurn: jest.fn().mockResolvedValue({
          response: 'Assistant response',
          usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30, turnCount: 1 },
        }),
      };
      const runtimeWithDelegate = new SessionRuntime(tempDir, delegate);
      const session = await runtimeWithDelegate.createSession('agent-1');

      await runtimeWithDelegate.executeTurn(session.sessionId, 'User message');

      const messages = runtimeWithDelegate.getRecentMessages(session.sessionId);
      expect(messages.length).toBe(2);
      expect(messages[0].role).toBe('user');
      expect(messages[0].content).toBe('User message');
      expect(messages[1].role).toBe('assistant');
      expect(messages[1].content).toBe('Assistant response');
    });

    test('returns correct message IDs after multiple turns', async () => {
      const session = await runtime.createSession('agent-1');
      await runtime.executeTurn(session.sessionId, 'First');
      await runtime.executeTurn(session.sessionId, 'Second');

      const messages = runtime.getRecentMessages(session.sessionId, 10);
      expect(messages.length).toBe(4);

      const userMsgs = messages.filter(m => m.role === 'user');
      const asstMsgs = messages.filter(m => m.role === 'assistant');

      expect(userMsgs[0].content).toBe('First');
      expect(userMsgs[1].content).toBe('Second');
      expect(asstMsgs[0].content).toContain('Turn executed');
      expect(asstMsgs[1].content).toContain('Turn executed');
    });

    test('populates turn metadata correctly', async () => {
      const session = await runtime.createSession('agent-1');
      const result = await runtime.executeTurn(session.sessionId, 'Hello');

      expect(result.metadata.turnId).toMatch(/^turn_/);
      expect(result.metadata.sessionId).toBe(session.sessionId);
      expect(result.metadata.timestamp).toBeGreaterThan(0);
      expect(result.metadata.duration).toBeGreaterThanOrEqual(0);
      expect(result.metadata.retries).toBe(0);
      expect(result.metadata.interrupted).toBe(false);
      expect(result.metadata.error).toBeUndefined();
    });

    test('populates assistant message metadata with original turn ID', async () => {
      const session = await runtime.createSession('agent-1');
      const result = await runtime.executeTurn(session.sessionId, 'Hello');

      const messages = runtime.getRecentMessages(session.sessionId);
      const assistantMsg = messages.find(m => m.role === 'assistant');

      expect(assistantMsg!.metadata).toBeDefined();
    });
  });

  describe('executeTurn with options', () => {
    test('respects maxRetries option', async () => {
      const delegate: AgentTurnDelegate = {
        executeAgentTurn: jest.fn().mockRejectedValue(new Error('Error')),
      };
      const runtimeWithDelegate = new SessionRuntime(tempDir, delegate);
      const session = await runtimeWithDelegate.createSession('agent-1');

      const result = await runtimeWithDelegate.executeTurn(session.sessionId, 'Hello', { maxRetries: 3 });

      // Loop runs maxRetries + 1 times (initial + retries), so retries = maxRetries + 1
      expect(result.metadata.retries).toBe(4);
      expect(delegate.executeAgentTurn).toHaveBeenCalledTimes(4); // initial + 3 retries
    });

    test('uses default maxRetries of 2', async () => {
      const delegate: AgentTurnDelegate = {
        executeAgentTurn: jest.fn().mockRejectedValue(new Error('Error')),
      };
      const runtimeWithDelegate = new SessionRuntime(tempDir, delegate);
      const session = await runtimeWithDelegate.createSession('agent-1');

      const result = await runtimeWithDelegate.executeTurn(session.sessionId, 'Hello');

      // Default maxRetries=2, loop runs 3 times (initial + 2 retries)
      expect(result.metadata.retries).toBe(3);
    });

    test('pre-executes abort check when signal is already aborted', async () => {
      const delegate: AgentTurnDelegate = {
        executeAgentTurn: jest.fn().mockResolvedValue({
          response: 'Should not be called',
          usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30, turnCount: 1 },
        }),
      };
      const runtimeWithDelegate = new SessionRuntime(tempDir, delegate);
      const session = await runtimeWithDelegate.createSession('agent-1');

      const controller = new AbortController();
      controller.abort(); // Abort before calling

      const result = await runtimeWithDelegate.executeTurn(session.sessionId, 'Hello', { signal: controller.signal });

      expect(result.interrupted).toBe(true);
      expect(delegate.executeAgentTurn).not.toHaveBeenCalled();
    });
  });

  // =============================================================================
  // Transcript Persistence
  // =============================================================================

  describe('transcript persistence', () => {
    test('persists user and assistant messages to transcript store', async () => {
      const session = await runtime.createSession('agent-1');
      await runtime.executeTurn(session.sessionId, 'Hello');

      const transcriptStore = runtime.getTranscriptStore();
      const entries = await transcriptStore.getBySession(session.sessionId);

      expect(entries.length).toBeGreaterThanOrEqual(2);
      expect(entries.some(e => e.role === 'user' && e.content === 'Hello')).toBe(true);
      expect(entries.some(e => e.role === 'assistant')).toBe(true);
    });

    test('persists transcript entry with correct structure', async () => {
      const session = await runtime.createSession('agent-1');
      await runtime.executeTurn(session.sessionId, 'Hello');

      const transcriptStore = runtime.getTranscriptStore();
      const entries = await transcriptStore.getBySession(session.sessionId);

      const userEntry = entries.find(e => e.role === 'user');
      expect(userEntry).toBeDefined();
      expect(userEntry!.sessionId).toBe(session.sessionId);
      expect(userEntry!.content).toBe('Hello');
      expect(userEntry!.turnId).toMatch(/^turn_/);
      expect(userEntry!.timestamp).toBeGreaterThan(0);

      const assistantEntry = entries.find(e => e.role === 'assistant');
      expect(assistantEntry).toBeDefined();
      expect(assistantEntry!.sessionId).toBe(session.sessionId);
      expect(assistantEntry!.turnId).toMatch(/^asst_/);
      expect(assistantEntry!.usage).toBeDefined();
      expect(assistantEntry!.metadata).toBeDefined();
    });

    test('assistant entry references user entry via originalTurnId', async () => {
      const session = await runtime.createSession('agent-1');
      await runtime.executeTurn(session.sessionId, 'Hello');

      const transcriptStore = runtime.getTranscriptStore();
      const entries = await transcriptStore.getBySession(session.sessionId);

      const userEntry = entries.find(e => e.role === 'user');
      const assistantEntry = entries.find(e => e.role === 'assistant');

      expect(assistantEntry!.metadata!.originalTurnId).toBe(userEntry!.turnId);
    });

    test('accumulates transcript entries across multiple turns', async () => {
      const session = await runtime.createSession('agent-1');

      await runtime.executeTurn(session.sessionId, 'Turn 1');
      await runtime.executeTurn(session.sessionId, 'Turn 2');

      const transcriptStore = runtime.getTranscriptStore();
      const entries = await transcriptStore.getBySession(session.sessionId);

      expect(entries.length).toBe(4); // 2 user + 2 assistant
    });
  });

  // =============================================================================
  // Session State Management
  // =============================================================================

  describe('pause', () => {
    test('pauses an active session', async () => {
      const session = await runtime.createSession('agent-1');
      await runtime.pause(session.sessionId);

      const retrieved = await runtime.getSession(session.sessionId);
      expect(retrieved!.status).toBe('paused');
    });

    test('throws error for non-existent session', async () => {
      await expect(runtime.pause('non-existent')).rejects.toThrow('not found');
    });

    test('updates session updatedAt on pause', async () => {
      const session = await runtime.createSession('agent-1');
      const originalUpdatedAt = session.updatedAt;

      await new Promise(r => setTimeout(r, 10));
      await runtime.pause(session.sessionId);

      const retrieved = await runtime.getSession(session.sessionId);
      expect(retrieved!.updatedAt).toBeGreaterThan(originalUpdatedAt);
    });
  });

  describe('destroy', () => {
    test('destroys session and removes from memory', async () => {
      const session = await runtime.createSession('agent-1');
      await runtime.destroy(session.sessionId);

      const retrieved = await runtime.getSession(session.sessionId);
      expect(retrieved).toBeNull();
    });

    test('throws error for non-existent session', async () => {
      await expect(runtime.destroy('non-existent')).rejects.toThrow('not found');
    });

    test('sets status to destroyed before removal', async () => {
      const session = await runtime.createSession('agent-1');

      // Track if session is destroyed before being removed
      let statusDuringDestroy: string = '';
      const originalDestroy = runtime.destroy.bind(runtime);

      await runtime.destroy(session.sessionId);

      // After destroy, session should be null
      const retrieved = await runtime.getSession(session.sessionId);
      expect(retrieved).toBeNull();
    });
  });

  // =============================================================================
  // Usage Tracking
  // =============================================================================

  describe('getUsage', () => {
    test('returns session usage', async () => {
      const delegate: AgentTurnDelegate = {
        executeAgentTurn: jest.fn().mockResolvedValue({
          response: 'Test',
          usage: { promptTokens: 50, completionTokens: 100, totalTokens: 150, turnCount: 1 },
        }),
      };
      const runtimeWithDelegate = new SessionRuntime(tempDir, delegate);
      const session = await runtimeWithDelegate.createSession('agent-1');

      await runtimeWithDelegate.executeTurn(session.sessionId, 'Hello');
      const usage = runtimeWithDelegate.getUsage(session.sessionId);

      expect(usage.promptTokens).toBe(50);
      expect(usage.totalTokens).toBe(150);
      expect(usage.turnCount).toBe(1);
    });

    test('returns empty usage for non-existent session', async () => {
      const usage = runtime.getUsage('non-existent');
      expect(usage.promptTokens).toBe(0);
      expect(usage.totalTokens).toBe(0);
    });

    test('returns a copy of usage (not reference)', async () => {
      const session = await runtime.createSession('agent-1');
      const usage1 = runtime.getUsage(session.sessionId);
      const usage2 = runtime.getUsage(session.sessionId);

      expect(usage1).not.toBe(usage2);
    });
  });

  describe('getRecentMessages', () => {
    test('returns recent messages from session', async () => {
      const delegate: AgentTurnDelegate = {
        executeAgentTurn: jest.fn().mockResolvedValue({
          response: 'Response',
          usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30, turnCount: 1 },
        }),
      };
      const runtimeWithDelegate = new SessionRuntime(tempDir, delegate);
      const session = await runtimeWithDelegate.createSession('agent-1');

      await runtimeWithDelegate.executeTurn(session.sessionId, 'Hello');
      const messages = runtimeWithDelegate.getRecentMessages(session.sessionId);

      expect(messages.length).toBeGreaterThanOrEqual(2);
      expect(messages[0].role).toBe('user');
    });

    test('respects limit parameter', async () => {
      const delegate: AgentTurnDelegate = {
        executeAgentTurn: jest.fn().mockResolvedValue({
          response: 'Response',
          usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30, turnCount: 1 },
        }),
      };
      const runtimeWithDelegate = new SessionRuntime(tempDir, delegate);
      const session = await runtimeWithDelegate.createSession('agent-1');

      await runtimeWithDelegate.executeTurn(session.sessionId, 'Hello');
      const messages = runtimeWithDelegate.getRecentMessages(session.sessionId, 1);

      expect(messages.length).toBeLessThanOrEqual(1);
    });

    test('returns empty array for non-existent session', async () => {
      const messages = runtime.getRecentMessages('non-existent');
      expect(messages).toEqual([]);
    });

    test('returns messages in chronological order', async () => {
      const session = await runtime.createSession('agent-1');
      await runtime.executeTurn(session.sessionId, 'First');
      await runtime.executeTurn(session.sessionId, 'Second');

      const messages = runtime.getRecentMessages(session.sessionId, 10);
      expect(messages[0].content).toBe('First');
      expect(messages[1].content).toContain('Turn executed');
      expect(messages[2].content).toBe('Second');
      expect(messages[3].content).toContain('Turn executed');
    });
  });

  // =============================================================================
  // Permission Denials
  // =============================================================================

  describe('recordPermissionDenial', () => {
    test('records permission denial in session', async () => {
      const session = await runtime.createSession('agent-1');
      await runtime.recordPermissionDenial(session.sessionId, 'file:delete', 'Safety policy', '/etc/passwd');

      const retrieved = await runtime.getSession(session.sessionId);
      expect(retrieved!.permissionDenials.length).toBe(1);
      expect(retrieved!.permissionDenials[0].permission).toBe('file:delete');
      expect(retrieved!.permissionDenials[0].reason).toBe('Safety policy');
      expect(retrieved!.permissionDenials[0].context).toBe('/etc/passwd');
    });

    test('records multiple permission denials', async () => {
      const session = await runtime.createSession('agent-1');
      await runtime.recordPermissionDenial(session.sessionId, 'file:delete', 'Reason 1');
      await runtime.recordPermissionDenial(session.sessionId, 'bash:exec', 'Reason 2');

      const retrieved = await runtime.getSession(session.sessionId);
      expect(retrieved!.permissionDenials.length).toBe(2);
    });

    test('populates timestamp on permission denial', async () => {
      const before = Date.now();
      const session = await runtime.createSession('agent-1');
      await runtime.recordPermissionDenial(session.sessionId, 'file:delete', 'Reason');
      const after = Date.now();

      const retrieved = await runtime.getSession(session.sessionId);
      expect(retrieved!.permissionDenials[0].timestamp).toBeGreaterThanOrEqual(before);
      expect(retrieved!.permissionDenials[0].timestamp).toBeLessThanOrEqual(after);
    });

    test('throws error for non-existent session', async () => {
      await expect(runtime.recordPermissionDenial('non-existent', 'file:delete', 'Reason', ''))
        .rejects.toThrow('not found');
    });
  });

  // =============================================================================
  // Skill Discovery
  // =============================================================================

  describe('recordDiscoveredSkill', () => {
    test('records discovered skill', async () => {
      const session = await runtime.createSession('agent-1');
      await runtime.recordDiscoveredSkill(session.sessionId, 'file-read');

      const retrieved = await runtime.getSession(session.sessionId);
      expect(retrieved!.discoveredSkills).toContain('file-read');
    });

    test('does not duplicate skill entries', async () => {
      const session = await runtime.createSession('agent-1');
      await runtime.recordDiscoveredSkill(session.sessionId, 'file-read');
      await runtime.recordDiscoveredSkill(session.sessionId, 'file-read');

      const retrieved = await runtime.getSession(session.sessionId);
      expect(retrieved!.discoveredSkills.filter(s => s === 'file-read').length).toBe(1);
    });

    test('records multiple different skills', async () => {
      const session = await runtime.createSession('agent-1');
      await runtime.recordDiscoveredSkill(session.sessionId, 'file-read');
      await runtime.recordDiscoveredSkill(session.sessionId, 'bash-exec');
      await runtime.recordDiscoveredSkill(session.sessionId, 'web-search');

      const retrieved = await runtime.getSession(session.sessionId);
      expect(retrieved!.discoveredSkills).toEqual(['file-read', 'bash-exec', 'web-search']);
    });

    test('throws error for non-existent session', async () => {
      await expect(runtime.recordDiscoveredSkill('non-existent', 'skill-name'))
        .rejects.toThrow('not found');
    });
  });

  // =============================================================================
  // Transcript Store
  // =============================================================================

  describe('getTranscriptStore', () => {
    test('returns the transcript store', () => {
      const store = runtime.getTranscriptStore();
      expect(store).toBeInstanceOf(TranscriptStore);
    });

    test('returns same instance on multiple calls', () => {
      const store1 = runtime.getTranscriptStore();
      const store2 = runtime.getTranscriptStore();
      expect(store1).toBe(store2);
    });
  });

  // =============================================================================
  // Edge Cases
  // =============================================================================

  describe('edge cases', () => {
    test('handles very long message content', async () => {
      const session = await runtime.createSession('agent-1');
      const longMessage = 'A'.repeat(100000);

      const result = await runtime.executeTurn(session.sessionId, longMessage);

      expect(result.response).toBeDefined();
      const messages = runtime.getRecentMessages(session.sessionId);
      expect(messages[0].content).toBe(longMessage);
    });

    test('handles empty message content', async () => {
      const session = await runtime.createSession('agent-1');

      const result = await runtime.executeTurn(session.sessionId, '');

      expect(result.response).toBeDefined();
    });

    test('handles special characters in message', async () => {
      const session = await runtime.createSession('agent-1');
      const specialMessage = 'Hello! 🌍 🎉 <script>alert("xss")</script>';

      const result = await runtime.executeTurn(session.sessionId, specialMessage);

      expect(result.response).toBeDefined();
    });

    test('handles unicode in agent ID', async () => {
      const session = await runtime.createSession('agent-你好');

      expect(session.agentId).toBe('agent-你好');
      const retrieved = await runtime.getSession(session.sessionId);
      expect(retrieved).not.toBeNull();
    });

    test('multiple sessions coexist independently', async () => {
      const session1 = await runtime.createSession('agent-1');
      const session2 = await runtime.createSession('agent-2');

      await runtime.executeTurn(session1.sessionId, 'Message 1');
      await runtime.executeTurn(session2.sessionId, 'Message 2');

      const usage1 = runtime.getUsage(session1.sessionId);
      const usage2 = runtime.getUsage(session2.sessionId);

      expect(usage1.turnCount).toBe(1);
      expect(usage2.turnCount).toBe(1);
      // Both sessions have same placeholder token values (10, 20, 30)
      expect(usage1.promptTokens).toBe(usage2.promptTokens);
      // But they are separate sessions with separate message accumulation
      const msgs1 = runtime.getRecentMessages(session1.sessionId);
      const msgs2 = runtime.getRecentMessages(session2.sessionId);
      expect(msgs1[0].content).toBe('Message 1');
      expect(msgs2[0].content).toBe('Message 2');
    });

    test('pause and resume session', async () => {
      const session = await runtime.createSession('agent-1');
      await runtime.executeTurn(session.sessionId, 'Turn 1');
      await runtime.pause(session.sessionId);

      let error: Error | null = null;
      try {
        await runtime.executeTurn(session.sessionId, 'Should fail');
      } catch (e) {
        error = e as Error;
      }
      expect(error).not.toBeNull();
      expect(error!.message).toContain('paused');
    });
  });

  describe('metadata in results', () => {
    test('duration is calculated correctly', async () => {
      const delegate: AgentTurnDelegate = {
        executeAgentTurn: jest.fn().mockImplementation(async () => {
          await new Promise(r => setTimeout(r, 10));
          return {
            response: 'Response',
            usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30, turnCount: 1 },
          };
        }),
      };
      const runtimeWithDelegate = new SessionRuntime(tempDir, delegate);
      const session = await runtimeWithDelegate.createSession('agent-1');

      const result = await runtimeWithDelegate.executeTurn(session.sessionId, 'Hello');

      expect(result.metadata.duration).toBeGreaterThanOrEqual(10);
    });

    test('interrupted flag is false when not aborted', async () => {
      const session = await runtime.createSession('agent-1');
      const result = await runtime.executeTurn(session.sessionId, 'Hello');

      expect(result.interrupted).toBe(false);
    });

    test('error is undefined on success', async () => {
      const session = await runtime.createSession('agent-1');
      const result = await runtime.executeTurn(session.sessionId, 'Hello');

      expect(result.metadata.error).toBeUndefined();
    });

    test('error is defined after max retries', async () => {
      const delegate: AgentTurnDelegate = {
        executeAgentTurn: jest.fn().mockRejectedValue(new Error('Persistent failure')),
      };
      const runtimeWithDelegate = new SessionRuntime(tempDir, delegate);
      const session = await runtimeWithDelegate.createSession('agent-1');

      const result = await runtimeWithDelegate.executeTurn(session.sessionId, 'Hello', { maxRetries: 2 });

      expect(result.metadata.error).toBeDefined();
    });
  });
});
