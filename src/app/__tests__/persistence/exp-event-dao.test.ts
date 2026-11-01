/**
 * 单测：角色经验事件 DAO（app/services/persistence/exp-event-dao.ts，task_061，schema v12）。
 *
 * 驱动说明：与 task-record-dao.test.ts 同一策略 —— 用**真实的 sql.js 适配器**（生产同款）
 * 开临时文件库；DAO 的全部职责就是"建表 + 参数绑定 + 行映射 + UNION 聚合"，mock 掉连接
 * 等于把它一起 mock 掉了。聚合口的三源表（character_chat_messages / character_tasks /
 * characters）都按生产形状铺数据，验证 LEFT JOIN 补建档时刻与三源计数合流。
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { Database } from '@/stratix-database/sqlite-adapter';

import { upsertCharacters, ensureGameSaveTables, type PersistedCharacterRecord } from '../../services/persistence/game-save-dao';
import { ensureCharacterChatMessagesTable, insertChatMessage } from '../../services/persistence/chat-history-dao';
import {
  aggregateCharacterActivity,
  ensureExpEventsTable,
  insertExpEvent,
  loadExpEventsSince,
  type ExpEventInsert,
} from '../../services/persistence/exp-event-dao';
import { ensureCharacterTasksTable, upsertTask, type PersistedTaskRecord } from '../../services/persistence/task-record-dao';

function expEvent(patch: Partial<ExpEventInsert> = {}): ExpEventInsert {
  return {
    characterId: 'ch-1',
    delta: 50,
    reason: 'task_completed',
    level: null,
    createdAt: 1_700_000_000_000,
    ...patch,
  };
}

function character(patch: Partial<PersistedCharacterRecord> = {}): PersistedCharacterRecord {
  return {
    id: 'ch-1',
    name: '白鸦',
    agentKind: 'codex',
    persona: '侦察兵',
    level: 2,
    exp: 120,
    appearanceJson: null,
    bodyType: null,
    skinId: null,
    externalSessionId: null,
    contextEnabled: true,
    createdAt: 1_600_000_000_000,
    ...patch,
  };
}

function task(patch: Partial<PersistedTaskRecord> = {}): PersistedTaskRecord {
  return {
    id: 'task_1',
    characterId: 'ch-1',
    prompt: '侦察北门',
    status: 'completed',
    output: '无敌情',
    createdAt: 1_700_000_000_000,
    startedAt: 1_700_000_000_500,
    endedAt: 1_700_000_009_000,
    ...patch,
  };
}

describe('exp-event-dao（真实 sql.js 适配器）', () => {
  let dbPath: string;
  let db: Database;

  beforeEach(async () => {
    dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'stratix-exp-event-')), 'exp.sqlite');
    db = new Database(dbPath);
    await db.initialize();
    ensureExpEventsTable(db);
  });

  afterEach(() => {
    db.close();
    fs.rmSync(path.dirname(dbPath), { recursive: true, force: true });
  });

  describe('insert + loadExpEventsSince 往返', () => {
    it('来源行 / level_up 里程碑行全字段往返；按 created_at 升序返回', () => {
      insertExpEvent(db, expEvent({ delta: 50, reason: 'task_completed', createdAt: 1000 }));
      insertExpEvent(db, expEvent({ delta: 10, reason: 'task_failed', createdAt: 2000 }));
      insertExpEvent(db, expEvent({ delta: 5, reason: 'chat_round', createdAt: 1500 }));
      insertExpEvent(db, expEvent({ delta: 0, reason: 'level_up', level: 3, createdAt: 2500 }));

      const rows = loadExpEventsSince(db, 'ch-1', 0);
      expect(rows.map((r) => r.reason)).toEqual(['task_completed', 'chat_round', 'task_failed', 'level_up']);
      expect(rows[3]).toMatchObject({ delta: 0, reason: 'level_up', level: 3 });
      expect(rows[0]!.level).toBeNull();
    });

    it('按角色隔离；sinceMs 是闭区间下界（当天边界事件不丢）', () => {
      insertExpEvent(db, expEvent({ characterId: 'ch-1', createdAt: 1000 }));
      insertExpEvent(db, expEvent({ characterId: 'ch-1', createdAt: 2000 }));
      insertExpEvent(db, expEvent({ characterId: 'ch-2', createdAt: 1500 }));

      expect(loadExpEventsSince(db, 'ch-1', 1000)).toHaveLength(2);
      expect(loadExpEventsSince(db, 'ch-1', 1001)).toHaveLength(1);
      expect(loadExpEventsSince(db, 'ghost', 0)).toEqual([]);
    });

    it('落盘持久化：close 前 save → 重开文件库数据还在（真落盘，不是内存错觉）', async () => {
      insertExpEvent(db, expEvent({ reason: 'chat_round', delta: 5 }));
      await db.save();
      db.close();

      const reopened = new Database(dbPath);
      await reopened.initialize();
      ensureExpEventsTable(reopened); // IF NOT EXISTS 幂等：已存在的表不动
      const rows = loadExpEventsSince(reopened, 'ch-1', 0);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ characterId: 'ch-1', delta: 5, reason: 'chat_round' });
      reopened.close();
    });
  });

  describe('aggregateCharacterActivity（三源 UNION + LEFT JOIN 建档）', () => {
    it('对话 / 任务 / 经验事件各自计数 + 三源最近活跃；无活动角色零计数不缺席', () => {
      ensureGameSaveTables(db);
      ensureCharacterChatMessagesTable(db);
      ensureCharacterTasksTable(db);
      upsertCharacters(db, [character(), character({ id: 'ch-2', name: '灰隼', createdAt: 1_610_000_000_000 })]);

      insertChatMessage(db, { characterId: 'ch-1', role: 'user', content: '你好', sessionRef: null, createdAt: 1_700_000_000_100 });
      insertChatMessage(db, { characterId: 'ch-1', role: 'assistant', content: '收到', sessionRef: null, createdAt: 1_700_000_000_200 });
      upsertTask(db, task({ characterId: 'ch-1', status: 'completed', endedAt: 1_700_000_000_250 }));
      insertExpEvent(db, expEvent({ characterId: 'ch-1', delta: 5, reason: 'chat_round', createdAt: 1_700_000_000_300 }));

      const rows = aggregateCharacterActivity(db);
      expect(rows).toHaveLength(2); // characters 左表：无活动的 ch-2 也在
      const byId = new Map(rows.map((r) => [r.characterId, r]));
      expect(byId.get('ch-1')).toEqual({
        characterId: 'ch-1',
        chatCount: 2,
        taskCount: 1,
        expEventCount: 1,
        lastActiveAt: 1_700_000_000_300,
        createdAt: 1_600_000_000_000,
      });
      expect(byId.get('ch-2')).toEqual({
        characterId: 'ch-2',
        chatCount: 0,
        taskCount: 0,
        expEventCount: 0,
        lastActiveAt: null,
        createdAt: 1_610_000_000_000,
      });
    });

    it('三源时间交错时 lastActiveAt 取全局最大（不是单源最大）', () => {
      ensureGameSaveTables(db);
      ensureCharacterChatMessagesTable(db);
      ensureCharacterTasksTable(db);
      upsertCharacters(db, [character()]);
      // 对话最旧、任务居中、经验事件最新：聚合行必须报最新的那条。
      insertChatMessage(db, { characterId: 'ch-1', role: 'user', content: '早', sessionRef: null, createdAt: 100 });
      upsertTask(db, task({ status: 'completed', createdAt: 200, endedAt: 250 }));
      insertExpEvent(db, expEvent({ createdAt: 300 }));

      const row = aggregateCharacterActivity(db)[0];
      expect(row?.lastActiveAt).toBe(300);
    });

    it('空库（只有建表没数据）返回空数组，不抛', () => {
      ensureGameSaveTables(db);
      ensureCharacterChatMessagesTable(db);
      ensureCharacterTasksTable(db);
      expect(aggregateCharacterActivity(db)).toEqual([]);
    });
  });
});
