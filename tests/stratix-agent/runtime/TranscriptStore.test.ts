/**
 * TranscriptStore Unit Tests
 * Tests for file-based JSONL transcript persistence
 */

import { TranscriptStore } from '@/stratix-agent/runtime/TranscriptStore';
import { TranscriptEntry } from '@/stratix-agent/runtime/types';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('TranscriptStore', () => {
  let store: TranscriptStore;
  let tempDir: string;

  beforeEach(() => {
    tempDir = path.join(os.tmpdir(), `transcript-test-${Date.now()}`);
    store = new TranscriptStore(tempDir);
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

  const createEntry = (sessionId: string, turnId: string, role: 'user' | 'assistant' | 'system', content: string): TranscriptEntry => ({
    sessionId,
    turnId,
    role,
    content,
    timestamp: Date.now(),
  });

  describe('constructor', () => {
    test('creates base directory if it does not exist', () => {
      expect(fs.existsSync(tempDir)).toBe(true);
    });

    test('reuses existing directory', () => {
      fs.mkdirSync(tempDir, { recursive: true });
      const store2 = new TranscriptStore(tempDir);
      expect(fs.existsSync(tempDir)).toBe(true);
    });
  });

  describe('append', () => {
    test('appends a single entry to transcript file', async () => {
      const entry = createEntry('session-1', 'turn-1', 'user', 'Hello');
      await store.append(entry);

      const content = await fs.promises.readFile(path.join(tempDir, 'session-1.jsonl'), 'utf-8');
      const lines = content.trim().split('\n');
      expect(lines.length).toBe(1);
      expect(JSON.parse(lines[0])).toMatchObject({ sessionId: 'session-1', turnId: 'turn-1', role: 'user', content: 'Hello' });
    });

    test('appends multiple entries to same session', async () => {
      await store.append(createEntry('session-1', 'turn-1', 'user', 'Hello'));
      await store.append(createEntry('session-1', 'turn-2', 'assistant', 'Hi there'));

      const content = await fs.promises.readFile(path.join(tempDir, 'session-1.jsonl'), 'utf-8');
      const lines = content.trim().split('\n');
      expect(lines.length).toBe(2);
    });

    test('creates separate files for different sessions', async () => {
      await store.append(createEntry('session-1', 'turn-1', 'user', 'Hello'));
      await store.append(createEntry('session-2', 'turn-1', 'user', 'World'));

      const files = await fs.promises.readdir(tempDir);
      expect(files.sort()).toEqual(['session-1.jsonl', 'session-2.jsonl']);
    });
  });

  describe('appendBatch', () => {
    test('appends multiple entries in a single batch', async () => {
      const entries = [
        createEntry('session-1', 'turn-1', 'user', 'Hello'),
        createEntry('session-1', 'turn-2', 'assistant', 'Hi'),
        createEntry('session-1', 'turn-3', 'user', 'How are you?'),
      ];
      await store.appendBatch(entries);

      const content = await fs.promises.readFile(path.join(tempDir, 'session-1.jsonl'), 'utf-8');
      const lines = content.trim().split('\n');
      expect(lines.length).toBe(3);
    });

    test('batch uses first entry sessionId for filename', async () => {
      const entries = [
        createEntry('session-1', 'turn-1', 'user', 'Hello'),
        createEntry('session-1', 'turn-2', 'assistant', 'Hi'),
      ];
      await store.appendBatch(entries);

      expect(fs.existsSync(path.join(tempDir, 'session-1.jsonl'))).toBe(true);
    });
  });

  describe('query', () => {
    beforeEach(async () => {
      // Create test data
      const now = Date.now();
      await store.append({ sessionId: 'session-1', turnId: 'turn-1', role: 'user', content: 'Hello', timestamp: now });
      await store.append({ sessionId: 'session-1', turnId: 'turn-2', role: 'assistant', content: 'Hi', timestamp: now + 100 });
      await store.append({ sessionId: 'session-1', turnId: 'turn-3', role: 'user', content: 'How are you', timestamp: now + 200 });
      await store.append({ sessionId: 'session-2', turnId: 'turn-1', role: 'user', content: 'Other', timestamp: now });
    });

    test('queries by sessionId', async () => {
      const results = await store.query({ sessionId: 'session-1' });
      expect(results.length).toBe(3);
    });

    test('returns empty array for non-existent session', async () => {
      const results = await store.query({ sessionId: 'non-existent' });
      expect(results).toEqual([]);
    });

    test('filters by time range', async () => {
      const now = Date.now();
      const results = await store.query({
        sessionId: 'session-1',
        startTime: now + 50,
        endTime: now + 150,
      });
      expect(results.length).toBe(1);
      expect(results[0].turnId).toBe('turn-2');
    });

    test('respects limit parameter', async () => {
      const results = await store.query({ sessionId: 'session-1', limit: 2 });
      expect(results.length).toBe(2);
    });

    test('queries across all sessions when no sessionId provided', async () => {
      const results = await store.query({ limit: 10 });
      expect(results.length).toBe(4);
    });
  });

  describe('getBySession', () => {
    test('returns all entries for a session', async () => {
      await store.append(createEntry('session-1', 'turn-1', 'user', 'Hello'));
      await store.append(createEntry('session-1', 'turn-2', 'assistant', 'Hi'));

      const entries = await store.getBySession('session-1');
      expect(entries.length).toBe(2);
    });

    test('returns empty array for non-existent session', async () => {
      const entries = await store.getBySession('non-existent');
      expect(entries).toEqual([]);
    });
  });

  describe('getByTimeRange', () => {
    test('filters entries within time range', async () => {
      const now = Date.now();
      await store.append({ sessionId: 'session-1', turnId: 'turn-1', role: 'user', content: 'Hello', timestamp: now });
      await store.append({ sessionId: 'session-1', turnId: 'turn-2', role: 'assistant', content: 'Hi', timestamp: now + 100 });
      await store.append({ sessionId: 'session-1', turnId: 'turn-3', role: 'user', content: 'There', timestamp: now + 200 });

      const entries = await store.getByTimeRange('session-1', now + 50, now + 150);
      expect(entries.length).toBe(1);
      expect(entries[0].turnId).toBe('turn-2');
    });
  });

  describe('deleteSession', () => {
    test('deletes transcript file for session', async () => {
      await store.append(createEntry('session-1', 'turn-1', 'user', 'Hello'));
      expect(fs.existsSync(path.join(tempDir, 'session-1.jsonl'))).toBe(true);

      await store.deleteSession('session-1');
      expect(fs.existsSync(path.join(tempDir, 'session-1.jsonl'))).toBe(false);
    });

    test('does not throw for non-existent session', async () => {
      await expect(store.deleteSession('non-existent')).resolves.not.toThrow();
    });
  });

  describe('getTranscriptSize', () => {
    test('returns file size in bytes', async () => {
      await store.append(createEntry('session-1', 'turn-1', 'user', 'Hello world'));
      const size = await store.getTranscriptSize('session-1');
      expect(size).toBeGreaterThan(0);
    });

    test('returns 0 for non-existent session', async () => {
      const size = await store.getTranscriptSize('non-existent');
      expect(size).toBe(0);
    });
  });

  describe('filterEntries', () => {
    test('sorts by timestamp ascending via query', async () => {
      const now = Date.now();
      await store.append({ sessionId: 'session-1', turnId: 'turn-3', role: 'user', content: 'Third', timestamp: now + 200 });
      await store.append({ sessionId: 'session-1', turnId: 'turn-1', role: 'user', content: 'First', timestamp: now });
      await store.append({ sessionId: 'session-1', turnId: 'turn-2', role: 'user', content: 'Second', timestamp: now + 100 });

      // query() with no filters uses filterEntries which sorts by timestamp
      const entries = await store.query({ sessionId: 'session-1' });
      expect(entries[0].turnId).toBe('turn-1');
      expect(entries[1].turnId).toBe('turn-2');
      expect(entries[2].turnId).toBe('turn-3');
    });

    test('getBySession returns entries in file order (unsorted)', async () => {
      const now = Date.now();
      await store.append({ sessionId: 'session-1', turnId: 'turn-3', role: 'user', content: 'Third', timestamp: now + 200 });
      await store.append({ sessionId: 'session-1', turnId: 'turn-1', role: 'user', content: 'First', timestamp: now });
      await store.append({ sessionId: 'session-1', turnId: 'turn-2', role: 'user', content: 'Second', timestamp: now + 100 });

      // getBySession returns entries in file order, not sorted
      const entries = await store.getBySession('session-1');
      expect(entries.length).toBe(3);
      // First appended is turn-3
      expect(entries[0].turnId).toBe('turn-3');
    });
  });

  describe('readFileEntries', () => {
    test('handles empty file gracefully', async () => {
      const emptyFile = path.join(tempDir, 'empty.jsonl');
      await fs.promises.writeFile(emptyFile, '', 'utf-8');

      const entries = await store.getBySession('empty');
      expect(entries).toEqual([]);
    });

    test('skips empty lines', async () => {
      const file = path.join(tempDir, 'skip-empty.jsonl');
      await fs.promises.writeFile(file, '{"sessionId":"s1","turnId":"t1","role":"user","content":"Hi","timestamp":123}\n\n{"sessionId":"s1","turnId":"t2","role":"assistant","content":"Hello","timestamp":124}\n', 'utf-8');

      const entries = await store.getBySession('skip-empty');
      expect(entries.length).toBe(2);
    });

    test('returns empty array on read error', async () => {
      // Create a file with invalid JSON
      const badFile = path.join(tempDir, 'bad.jsonl');
      await fs.promises.writeFile(badFile, '{invalid json}', 'utf-8');

      const entries = await store.getBySession('bad');
      expect(entries).toEqual([]);
    });
  });
});
