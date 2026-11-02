/**
 * 单测：会话域两张表的 DAO（app/services/persistence/session-dao.ts + session-event-dao.ts，
 * task_092，schema v13）。
 *
 * 驱动说明：与 exp-event-dao.test.ts 同一策略 —— 用**真实的 sql.js 适配器**（生产同款）
 * 开临时文件库；DAO 的全部职责就是「建表 + 参数绑定 + 行映射 + 分页切片」，mock 掉连接
 * 等于把它一起 mock 掉了。
 * 覆盖：upsert（新建 + 覆盖更新）/ append（append-only）/ 分页（kind+status 过滤 + limit/offset）/
 * beforeSeq 切片（向前翻页）+ 会话隔离 + 建表幂等。
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { Database } from '@/stratix-database/sqlite-adapter';

import {
  ensureSessionsTable,
  getSessionRecord,
  listSessionRecords,
  upsertSessionRecord,
  type PersistedSessionRecord,
} from '../../services/persistence/session-dao';
import {
  appendSessionEvent,
  ensureSessionEventsTable,
  listSessionEvents,
  type SessionEventInsert,
} from '../../services/persistence/session-event-dao';

function session(patch: Partial<PersistedSessionRecord> = {}): PersistedSessionRecord {
  return {
    id: 'session_peer_chat_1',
    kind: 'peer_chat',
    title: '互聊：侦察北门',
    participants: ['agent-a', 'agent-b'],
    status: 'active',
    refId: null,
    createdAt: 1_000,
    lastEventAt: 1_000,
    closedAt: null,
    eventCount: 1,
    ...patch,
  };
}

function event(patch: Partial<SessionEventInsert> = {}): SessionEventInsert {
  return {
    sessionId: 'session_peer_chat_1',
    seq: 1,
    type: 'created',
    payload: { title: '互聊：侦察北门', participants: ['agent-a', 'agent-b'] },
    createdAt: 1_000,
    ...patch,
  };
}

describe('session-dao + session-event-dao（真实 sql.js 适配器）', () => {
  let dbPath: string;
  let db: Database;

  beforeEach(async () => {
    dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'stratix-session-dao-')), 'sessions.sqlite');
    db = new Database(dbPath);
    await db.initialize();
  });

  afterEach(() => {
    db.close();
    fs.rmSync(path.dirname(dbPath), { recursive: true, force: true });
  });

  describe('建表（幂等）', () => {
    it('ensure 跑两次不抛、表只有一张（IF NOT EXISTS 幂等）', () => {
      ensureSessionsTable(db);
      ensureSessionsTable(db);
      ensureSessionEventsTable(db);
      ensureSessionEventsTable(db);

      const tables = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('sessions','session_events')")
        .all() as Array<{ name: string }>;
      expect(tables.map((t) => t.name).sort()).toEqual(['session_events', 'sessions']);
    });
  });

  describe('upsertSessionRecord（快照语义）', () => {
    it('新建后可按 id 读回，全字段往返（participants 是数组）', () => {
      upsertSessionRecord(db, session());

      const row = getSessionRecord(db, 'session_peer_chat_1');
      expect(row).toEqual({
        id: 'session_peer_chat_1',
        kind: 'peer_chat',
        title: '互聊：侦察北门',
        participants: ['agent-a', 'agent-b'],
        status: 'active',
        refId: null,
        createdAt: 1_000,
        lastEventAt: 1_000,
        closedAt: null,
        eventCount: 1,
      });
    });

    it('同一 id 再 upsert = 覆盖更新（状态 / 计数 / 收尾时刻），不新增行', () => {
      upsertSessionRecord(db, session());
      upsertSessionRecord(
        db,
        session({
          status: 'closed',
          lastEventAt: 2_000,
          closedAt: 2_000,
          eventCount: 5,
          participants: ['agent-a', 'agent-b', 'agent-c'],
        })
      );

      const row = getSessionRecord(db, 'session_peer_chat_1');
      expect(row?.status).toBe('closed');
      expect(row?.lastEventAt).toBe(2_000);
      expect(row?.closedAt).toBe(2_000);
      expect(row?.eventCount).toBe(5);
      expect(row?.participants).toHaveLength(3);
      expect(
        (db.prepare('SELECT COUNT(*) AS n FROM sessions').get() as { n?: number }).n
      ).toBe(1);
    });

    it('库里没有的 id 返回 null（不编造）', () => {
      expect(getSessionRecord(db, 'ghost')).toBeNull();
    });
  });

  describe('listSessionRecords（kind+status 过滤 + 分页）', () => {
    beforeEach(() => {
      upsertSessionRecord(db, session({ id: 's-1', kind: 'peer_chat', status: 'active', createdAt: 1_000 }));
      upsertSessionRecord(db, session({ id: 's-2', kind: 'peer_chat', status: 'closed', createdAt: 2_000 }));
      upsertSessionRecord(db, session({ id: 's-3', kind: 'task_run', status: 'active', createdAt: 3_000 }));
      upsertSessionRecord(db, session({ id: 's-4', kind: 'task_run', status: 'idle', createdAt: 4_000 }));
    });

    it('不过滤 = 全部，按创建时间倒序（最新的在前）', () => {
      const rows = listSessionRecords(db);
      expect(rows.map((r) => r.id)).toEqual(['s-4', 's-3', 's-2', 's-1']);
    });

    it('kind 过滤：只出该 kind 的会话', () => {
      const rows = listSessionRecords(db, { kind: 'peer_chat' });
      expect(rows.map((r) => r.id)).toEqual(['s-2', 's-1']);
    });

    it('status 过滤：只出该状态的会话', () => {
      const rows = listSessionRecords(db, { status: 'active' });
      expect(rows.map((r) => r.id)).toEqual(['s-3', 's-1']);
    });

    it('kind + status 组合过滤', () => {
      const rows = listSessionRecords(db, { kind: 'task_run', status: 'active' });
      expect(rows.map((r) => r.id)).toEqual(['s-3']);
    });

    it('limit / offset 分页：窗口在倒序流上切片', () => {
      expect(listSessionRecords(db, { limit: 2 }).map((r) => r.id)).toEqual(['s-4', 's-3']);
      expect(listSessionRecords(db, { limit: 2, offset: 2 }).map((r) => r.id)).toEqual(['s-2', 's-1']);
      expect(listSessionRecords(db, { offset: 3 }).map((r) => r.id)).toEqual(['s-1']);
    });

    it('超出范围的 offset 返回空数组（不越界报错）', () => {
      expect(listSessionRecords(db, { offset: 99 })).toEqual([]);
    });
  });

  describe('appendSessionEvent + listSessionEvents（append-only + beforeSeq 切片）', () => {
    beforeEach(() => {
      appendSessionEvent(db, event({ seq: 1, type: 'created', createdAt: 1_000 }));
      appendSessionEvent(db, event({ seq: 2, type: 'message', payload: { author: 'a', text: '在吗' }, createdAt: 2_000 }));
      appendSessionEvent(db, event({ seq: 3, type: 'message', payload: { author: 'b', text: '在' }, createdAt: 3_000 }));
      appendSessionEvent(db, event({ seq: 4, type: 'interrupt', payload: { reason: '超时' }, createdAt: 4_000 }));
    });

    it('默认读最新一段，返回 seq 正序（从旧到新）', () => {
      const rows = listSessionEvents(db, 'session_peer_chat_1');
      expect(rows.map((r) => r.seq)).toEqual([1, 2, 3, 4]);
      expect(rows[1]?.payload).toEqual({ author: 'a', text: '在吗' });
      expect(rows[3]?.type).toBe('interrupt');
    });

    it('limit 取尾部 N 条（最新的那批），仍是正序', () => {
      const rows = listSessionEvents(db, 'session_peer_chat_1', { limit: 2 });
      expect(rows.map((r) => r.seq)).toEqual([3, 4]);
    });

    it('beforeSeq 切片：只取该 seq 之前的一段（向前翻页）', () => {
      const rows = listSessionEvents(db, 'session_peer_chat_1', { beforeSeq: 3 });
      expect(rows.map((r) => r.seq)).toEqual([1, 2]);
    });

    it('beforeSeq + limit 组合：先切片再取窗口', () => {
      const rows = listSessionEvents(db, 'session_peer_chat_1', { beforeSeq: 3, limit: 1 });
      expect(rows.map((r) => r.seq)).toEqual([2]);
    });

    it('会话隔离：别的会话读不到本会话的事件', () => {
      expect(listSessionEvents(db, 'session_other')).toEqual([]);
    });

    it('同一会话重复 seq 撞主键 → 抛错（append-only 不许改写历史）', () => {
      expect(() => appendSessionEvent(db, event({ seq: 2 }))).toThrow();
    });
  });

  describe('落盘持久化（真落盘，不是内存错觉）', () => {
    it('close 前 save → 重开文件库数据还在', async () => {
      upsertSessionRecord(db, session());
      appendSessionEvent(db, event());
      await db.save();
      db.close();

      const reopened = new Database(dbPath);
      await reopened.initialize();
      expect(getSessionRecord(reopened, 'session_peer_chat_1')?.title).toBe('互聊：侦察北门');
      expect(listSessionEvents(reopened, 'session_peer_chat_1')).toHaveLength(1);
      reopened.close();
    });
  });
});
