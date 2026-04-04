/**
 * SessionRuntime Unit Tests
 * Tests for session lifecycle, turn execution, and usage tracking
 */

import { SessionRuntime, AgentTurnDelegate } from '@/stratix-agent/runtime/SessionRuntime';
import { TranscriptStore } from '@/stratix-agent/runtime/TranscriptStore';
import { SessionContext, TokenUsage } from '@/stratix-agent/runtime/types';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('SessionRuntime', () => {
  let runtime: SessionRuntime;
  let tempDir: string;

  beforeEach(() => {
    tempDir = path.join(os.tmpdir(), `session-runtime-test-${Date.now()}`);
    runtime = new SessionRuntime(tempDir);
  });

  afterEach(async () => {
    // Cleanup
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

    test('stores session in memory', async () => {
      const session = await runtime.createSession('agent-1');
      const retrieved = await runtime.getSession(session.sessionId);

      expect(retrieved).not.toBeNull();
      expect(retrieved!.sessionId).toBe(session.sessionId);
    });
  });

  describe('getSession', () => {
    test('returns existing session', async () => {
      const created = await runtime.createSession('agent-1');
      const retrieved = await runtime.getSession(created.sessionId);

      expect(retrieved).not.toBeNull();
      expect(retrieved!.sessionId).toBe(created.sessionId);
    });

    test('returns null for non-existent session', async () => {
      const retrieved = await runtime.getSession('non-existent');
      expect(retrieved).toBeNull();
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

    test('throws error when session was destroyed (not in memory)', async () => {
      const session = await runtime.createSession('agent-1');
      await runtime.destroy(session.sessionId);
      // After destroy, session is removed from memory, so resume throws "not found"
      await expect(runtime.resumeSession(session.sessionId)).rejects.toThrow('not found');
    });
  });

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

      // After destroy, session is removed from memory, so executeTurn throws "not found"
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

    test('persists messages to transcript', async () => {
      const session = await runtime.createSession('agent-1');
      await runtime.executeTurn(session.sessionId, 'Hello');

      const transcriptStore = runtime.getTranscriptStore();
      const entries = await transcriptStore.getBySession(session.sessionId);

      expect(entries.length).toBeGreaterThanOrEqual(2); // user + assistant
      expect(entries.some(e => e.role === 'user' && e.content === 'Hello')).toBe(true);
    });
  });

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
  });

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
    });

    test('returns empty usage for non-existent session', async () => {
      const usage = runtime.getUsage('non-existent');
      expect(usage.promptTokens).toBe(0);
      expect(usage.totalTokens).toBe(0);
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
  });

  describe('recordPermissionDenial', () => {
    test('records permission denial in session', async () => {
      const session = await runtime.createSession('agent-1');
      await runtime.recordPermissionDenial(session.sessionId, 'file:delete', 'Safety policy', '/etc/passwd');

      const retrieved = await runtime.getSession(session.sessionId);
      expect(retrieved!.permissionDenials.length).toBe(1);
      expect(retrieved!.permissionDenials[0].permission).toBe('file:delete');
      expect(retrieved!.permissionDenials[0].reason).toBe('Safety policy');
    });

    test('throws error for non-existent session', async () => {
      await expect(runtime.recordPermissionDenial('non-existent', 'file:delete', 'Reason', ''))
        .rejects.toThrow('not found');
    });
  });

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

    test('throws error for non-existent session', async () => {
      await expect(runtime.recordDiscoveredSkill('non-existent', 'skill-name'))
        .rejects.toThrow('not found');
    });
  });

  describe('getTranscriptStore', () => {
    test('returns the transcript store', () => {
      const store = runtime.getTranscriptStore();
      expect(store).toBeInstanceOf(TranscriptStore);
    });
  });
});
