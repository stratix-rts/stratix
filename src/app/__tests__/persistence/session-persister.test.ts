/**
 * 单测：会话持久化注入件（app/services/persistence/session-persister.ts，task_092）。
 *
 * 覆盖三件事：
 *   1. **缺省 = 不落库**：端口未附着（dao = null）时，注入件是空操作 —— 不写库、不抛、不警告
 *      （没接存储是正常配置，不是故障）；
 *   2. 接上 DAO 时真落库：sessions 摘要一行 + session_events 事件一行（真 SQLite，不 mock）；
 *   3. 落库失败（DAO 抛错）只记一行警告、绝不打断会话回路（与 makeExpEventPersister 同口径）。
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { Database } from '@/stratix-database/sqlite-adapter';

import type { SessionEvent, SessionRecord } from '../../../core/session/types';
import { ensureSessionsTable } from '../../services/persistence/session-dao';
import { ensureSessionEventsTable } from '../../services/persistence/session-event-dao';
import {
  createSessionPersistenceDao,
  createSessionPersister,
  type SessionPersistenceDao,
} from '../../services/persistence/session-persister';

function record(patch: Partial<SessionRecord> = {}): SessionRecord {
  return {
    id: 'session_peer_chat_1',
    kind: 'peer_chat',
    title: '互聊：侦察北门',
    participants: ['agent-a', 'agent-b'],
    status: 'active',
    createdAt: 1_000,
    lastEventAt: 1_000,
    closedAt: null,
    eventCount: 1,
    ...patch,
  };
}

function envelope(patch: Partial<SessionEvent> = {}): SessionEvent {
  return {
    sessionId: 'session_peer_chat_1',
    seq: 1,
    type: 'created',
    payload: { title: '互聊：侦察北门', participants: ['agent-a', 'agent-b'] },
    createdAt: 1_000,
    ...patch,
  } as SessionEvent;
}

function countRows(db: Database, table: string): number {
  return Number((db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n?: number }).n ?? 0);
}

describe('session-persister（会话持久化注入件）', () => {
  let dbPath: string;
  let db: Database;
  let logs: string[];

  beforeEach(async () => {
    dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'stratix-session-persister-')), 'sessions.sqlite');
    db = new Database(dbPath);
    await db.initialize();
    ensureSessionsTable(db);
    ensureSessionEventsTable(db);
    logs = [];
  });

  afterEach(() => {
    db.close();
    fs.rmSync(path.dirname(dbPath), { recursive: true, force: true });
  });

  describe('缺省注入 = 不落库', () => {
    it('dao = null：persistSession / persistEvent 都是空操作（不写库、不抛、不警告）', () => {
      const persister = createSessionPersister(null, (line) => logs.push(line));

      expect(() => persister.persistSession(record())).not.toThrow();
      expect(() => persister.persistEvent(envelope())).not.toThrow();

      expect(countRows(db, 'sessions')).toBe(0);
      expect(countRows(db, 'session_events')).toBe(0);
      // 没接存储是正常配置，不是故障 → 不该刷警告噪音。
      expect(logs).toEqual([]);
    });
  });

  describe('接上 DAO 时真落库', () => {
    it('会话摘要 upsert 进 sessions 表（参与者存成 JSON 串，读回是数组）', () => {
      const persister = createSessionPersister(createSessionPersistenceDao(db), (line) => logs.push(line));
      persister.persistSession(record({ refId: 'task-7' }));

      const row = db.prepare('SELECT * FROM sessions WHERE id = ?').get('session_peer_chat_1') as
        | Record<string, unknown>
        | undefined;
      expect(row).toBeDefined();
      expect(String(row?.kind)).toBe('peer_chat');
      expect(String(row?.status)).toBe('active');
      expect(String(row?.participants)).toBe('["agent-a","agent-b"]');
      expect(String(row?.ref_id)).toBe('task-7');
      expect(Number(row?.event_count)).toBe(1);
      expect(logs).toEqual([]);
    });

    it('会话事件 append 进 session_events 表（payload 存 JSON 串）', () => {
      const persister = createSessionPersister(createSessionPersistenceDao(db), (line) => logs.push(line));
      persister.persistEvent(envelope({ seq: 2, type: 'message', payload: { author: 'a', text: '在吗' } } as SessionEvent));

      const row = db.prepare('SELECT * FROM session_events WHERE session_id = ? AND seq = ?').get(
        'session_peer_chat_1',
        2
      ) as Record<string, unknown> | undefined;
      expect(row).toBeDefined();
      expect(String(row?.type)).toBe('message');
      expect(String(row?.payload)).toBe('{"author":"a","text":"在吗"}');
      expect(logs).toEqual([]);
    });

    it('同一会话再落一次摘要 = 覆盖一行（快照语义），不新增行', () => {
      const persister = createSessionPersister(createSessionPersistenceDao(db), (line) => logs.push(line));
      persister.persistSession(record());
      persister.persistSession(record({ status: 'closed', closedAt: 2_000, eventCount: 4 }));

      expect(countRows(db, 'sessions')).toBe(1);
      const row = db.prepare('SELECT status, closed_at, event_count FROM sessions').get() as
        | Record<string, unknown>
        | undefined;
      expect(String(row?.status)).toBe('closed');
      expect(Number(row?.closed_at)).toBe(2_000);
      expect(Number(row?.event_count)).toBe(4);
    });
  });

  describe('落库失败不打断会话回路', () => {
    it('DAO 抛错 → 只记一行警告，绝不把异常抛给调用方', () => {
      const brokenDao: SessionPersistenceDao = {
        upsertSession: () => {
          throw new Error('db is locked');
        },
        appendSessionEvent: () => {
          throw new Error('db is locked');
        },
      };
      const persister = createSessionPersister(brokenDao, (line) => logs.push(line));

      expect(() => persister.persistSession(record())).not.toThrow();
      expect(() => persister.persistEvent(envelope())).not.toThrow();

      expect(logs).toHaveLength(2);
      expect(logs[0]).toContain('db is locked');
      expect(logs[0]).toContain('session_peer_chat_1');
      expect(logs[1]).toContain('session_peer_chat_1');
    });
  });
});
