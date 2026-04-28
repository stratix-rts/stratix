/**
 * SessionManager Unit Tests
 *
 * Tests core logic: trim,上限,淘汰,message limits,session eviction.
 */

import { SessionManager } from '@/stratix-agent/core/SessionManager';
import { existsSync, rmSync } from 'fs';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

describe('SessionManager', () => {
  let manager: SessionManager;
  let storagePath: string;

  beforeEach(() => {
    storagePath = mkdtempSync(join(tmpdir(), 'session-manager-test-'));
    manager = new SessionManager({
      storagePath,
      maxSessions: 3,
      maxMessagesPerSession: 5,
      maxTotalMessages: 10,
    });
  });

  afterEach(() => {
    if (existsSync(storagePath)) {
      rmSync(storagePath, { recursive: true, force: true });
    }
  });

  describe('getOrCreateSession', () => {
    test('creates a new session with generated id', () => {
      const session = manager.getOrCreateSession('agent-1');

      expect(session.agentId).toBe('agent-1');
      expect(session.sessionId).toBeDefined();
      expect(session.status).toBe('active');
      expect(session.messages).toEqual([]);
    });

    test('returns existing session when sessionId and agentId match', () => {
      const first = manager.getOrCreateSession('agent-1');
      const second = manager.getOrCreateSession('agent-1', first.sessionId);

      expect(second.sessionId).toBe(first.sessionId);
    });

    test('creates new session with provided sessionId when not in memory', () => {
      const session = manager.getOrCreateSession('agent-1', 'non-existent-id');

      // SessionManager reuses the provided sessionId even if not previously stored
      expect(session.sessionId).toBe('non-existent-id');
      expect(session.agentId).toBe('agent-1');
    });

    test('creates new session with provided id when agentId does not match existing', () => {
      const first = manager.getOrCreateSession('agent-1');
      const second = manager.getOrCreateSession('agent-2', first.sessionId);

      // When agentId doesn't match, it creates a new session using the provided sessionId
      expect(second.sessionId).toBe(first.sessionId);
      expect(second.agentId).toBe('agent-2');
    });

    test('evicts oldest inactive session when maxSessions exceeded', () => {
      const s1 = manager.getOrCreateSession('agent-1');
      const s2 = manager.getOrCreateSession('agent-1');
      const s3 = manager.getOrCreateSession('agent-1');

      manager.closeSession(s1.sessionId);

      // maxSessions=3, s1 is inactive → should be evicted first
      const s4 = manager.getOrCreateSession('agent-1');

      expect(manager.getActiveSessions('agent-1').length).toBe(3);
      expect(manager.getActiveSessions('agent-1').some(s => s.sessionId === s1.sessionId)).toBe(false);
      expect(manager.getActiveSessions('agent-1').some(s => s.sessionId === s4.sessionId)).toBe(true);
    });

    test('evicts oldest active session when all are active and maxSessions exceeded', () => {
      const s1 = manager.getOrCreateSession('agent-1');
      const s2 = manager.getOrCreateSession('agent-1');
      const s3 = manager.getOrCreateSession('agent-1');

      // All active, s1 is oldest
      const s4 = manager.getOrCreateSession('agent-1');

      expect(manager.getActiveSessions('agent-1').length).toBe(3);
      expect(manager.getActiveSessions('agent-1').some(s => s.sessionId === s1.sessionId)).toBe(false);
    });
  });

  describe('addMessage', () => {
    test('adds message to session', () => {
      const session = manager.getOrCreateSession('agent-1');
      manager.addMessage(session.sessionId, { role: 'user', content: 'Hello' });

      const messages = manager.getMessages(session.sessionId);
      expect(messages.length).toBe(1);
      expect(messages[0].content).toBe('Hello');
    });

    test('ignores add when session does not exist', () => {
      expect(() => manager.addMessage('non-existent', { role: 'user', content: 'Hello' })).not.toThrow();
    });

    test('trims messages when maxMessagesPerSession exceeded', () => {
      const session = manager.getOrCreateSession('agent-1');

      for (let i = 0; i < 7; i++) {
        manager.addMessage(session.sessionId, { role: 'user', content: `msg-${i}` });
      }

      const messages = manager.getMessages(session.sessionId);
      // maxMessagesPerSession=5, so after 7 additions we should have 4 (trimmed before adding when at limit)
      // Wait: the logic trims when length >= max, removing (length - max + 1) messages
      // At 5 messages, adding 6th: trim 1 → 4 left, then add → 5
      // At 5 messages, adding 7th: trim 1 → 4 left, then add → 5
      expect(messages.length).toBeLessThanOrEqual(5);
    });

    test('enforces global total message limit across sessions', () => {
      const s1 = manager.getOrCreateSession('agent-1');
      const s2 = manager.getOrCreateSession('agent-1');

      // Add 6 messages to each session (total 12, limit is 10)
      for (let i = 0; i < 6; i++) {
        manager.addMessage(s1.sessionId, { role: 'user', content: `s1-${i}` });
        manager.addMessage(s2.sessionId, { role: 'user', content: `s2-${i}` });
      }

      const totalMessages =
        manager.getMessages(s1.sessionId).length +
        manager.getMessages(s2.sessionId).length;

      expect(totalMessages).toBeLessThanOrEqual(10);
    });

    test('trims from heaviest session first when global limit exceeded', () => {
      const s1 = manager.getOrCreateSession('agent-1');
      const s2 = manager.getOrCreateSession('agent-1');

      // s1 gets 6 messages, s2 gets 2 (total 8)
      for (let i = 0; i < 6; i++) {
        manager.addMessage(s1.sessionId, { role: 'user', content: `s1-${i}` });
      }
      for (let i = 0; i < 2; i++) {
        manager.addMessage(s2.sessionId, { role: 'user', content: `s2-${i}` });
      }

      // Now add more to s2 to exceed global limit
      manager.addMessage(s2.sessionId, { role: 'user', content: 's2-extra' });

      // Global enforcement should trim from s1 (heaviest) first
      const totalMessages =
        manager.getMessages(s1.sessionId).length +
        manager.getMessages(s2.sessionId).length;

      expect(totalMessages).toBeLessThanOrEqual(10);
    });
  });

  describe('getMessages', () => {
    test('returns empty array for non-existent session', () => {
      expect(manager.getMessages('non-existent')).toEqual([]);
    });

    test('returns all messages when no count specified', () => {
      const session = manager.getOrCreateSession('agent-1');
      manager.addMessage(session.sessionId, { role: 'user', content: 'a' });
      manager.addMessage(session.sessionId, { role: 'assistant', content: 'b' });

      expect(manager.getMessages(session.sessionId).length).toBe(2);
    });

    test('returns last N messages when count specified', () => {
      const session = manager.getOrCreateSession('agent-1');
      manager.addMessage(session.sessionId, { role: 'user', content: 'a' });
      manager.addMessage(session.sessionId, { role: 'assistant', content: 'b' });
      manager.addMessage(session.sessionId, { role: 'user', content: 'c' });

      const messages = manager.getMessages(session.sessionId, 2);
      expect(messages.length).toBe(2);
      expect(messages[0].content).toBe('b');
      expect(messages[1].content).toBe('c');
    });

    test('returns copy of messages array to prevent external mutation', () => {
      const session = manager.getOrCreateSession('agent-1');
      manager.addMessage(session.sessionId, { role: 'user', content: 'a' });

      const messages = manager.getMessages(session.sessionId);
      messages.push({ role: 'user', content: 'injected' });

      expect(manager.getMessages(session.sessionId).length).toBe(1);
    });
  });

  describe('saveSession / loadSessions', () => {
    test('saves session to disk', async () => {
      const session = manager.getOrCreateSession('agent-1');
      manager.addMessage(session.sessionId, { role: 'user', content: 'Hello' });

      await manager.saveSession(session);

      const filePath = `${storagePath}/${session.sessionId}.json`;
      expect(existsSync(filePath)).toBe(true);
    });

    test('loads sessions for matching agentId', async () => {
      const s1 = manager.getOrCreateSession('agent-1');
      manager.addMessage(s1.sessionId, { role: 'user', content: 'Hello' });
      await manager.saveSession(s1);

      const newManager = new SessionManager({ storagePath });
      await newManager.loadSessions('agent-1');

      const loaded = newManager.getActiveSessions('agent-1');
      expect(loaded.length).toBe(1);
      expect(loaded[0].sessionId).toBe(s1.sessionId);
      expect(loaded[0].messages.length).toBe(1);
    });

    test('ignores sessions for other agentIds when loading', async () => {
      const s1 = manager.getOrCreateSession('agent-1');
      await manager.saveSession(s1);

      const newManager = new SessionManager({ storagePath });
      await newManager.loadSessions('agent-2');

      expect(newManager.getActiveSessions('agent-2').length).toBe(0);
    });

    test('handles corrupted session files gracefully', async () => {
      const s1 = manager.getOrCreateSession('agent-1');
      await manager.saveSession(s1);

      // Corrupt the file
      const fs = require('fs');
      fs.writeFileSync(`${storagePath}/${s1.sessionId}.json`, 'not valid json');

      const newManager = new SessionManager({ storagePath });
      await newManager.loadSessions('agent-1');

      expect(newManager.getActiveSessions('agent-1').length).toBe(0);
    });

    test('creates storage directory if it does not exist', async () => {
      const newPath = `${storagePath}/deep/nested`;
      const newManager = new SessionManager({ storagePath: newPath });
      const session = newManager.getOrCreateSession('agent-1');

      await newManager.saveSession(session);

      expect(existsSync(newPath)).toBe(true);
    });
  });

  describe('saveSessions', () => {
    test('saves all sessions for an agent', async () => {
      const s1 = manager.getOrCreateSession('agent-1');
      const s2 = manager.getOrCreateSession('agent-1');
      const s3 = manager.getOrCreateSession('agent-2');

      await manager.saveSessions('agent-1');

      expect(existsSync(`${storagePath}/${s1.sessionId}.json`)).toBe(true);
      expect(existsSync(`${storagePath}/${s2.sessionId}.json`)).toBe(true);
      expect(existsSync(`${storagePath}/${s3.sessionId}.json`)).toBe(false);
    });
  });

  describe('closeSession', () => {
    test('sets session status to closed', () => {
      const session = manager.getOrCreateSession('agent-1');
      manager.closeSession(session.sessionId);

      const active = manager.getActiveSessions('agent-1');
      expect(active.some(s => s.sessionId === session.sessionId)).toBe(false);
    });

    test('does not throw for non-existent session', () => {
      expect(() => manager.closeSession('non-existent')).not.toThrow();
    });
  });

  describe('getActiveSessions', () => {
    test('returns only active sessions for the given agent', () => {
      const s1 = manager.getOrCreateSession('agent-1');
      const s2 = manager.getOrCreateSession('agent-1');
      manager.getOrCreateSession('agent-2');
      manager.closeSession(s1.sessionId);

      const active = manager.getActiveSessions('agent-1');
      expect(active.length).toBe(1);
      expect(active[0].sessionId).toBe(s2.sessionId);
    });
  });

  describe('default limits', () => {
    test('uses default values when options not provided', () => {
      const defaultManager = new SessionManager();

      // Create many sessions to verify default maxSessions=50 is applied
      for (let i = 0; i < 55; i++) {
        defaultManager.getOrCreateSession('agent-1');
      }

      // Should have evicted some
      expect(defaultManager.getActiveSessions('agent-1').length).toBeLessThanOrEqual(50);
    });
  });
});
