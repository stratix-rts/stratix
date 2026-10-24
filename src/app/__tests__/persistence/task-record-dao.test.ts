/**
 * 单测：角色任务 DAO（app/services/persistence/task-record-dao.ts，task_037）。
 *
 * 驱动说明：与 chat-history-dao.test.ts 同一策略 —— 用**真实的 sql.js 适配器**（生产同款）
 * 开临时文件库；DAO 的全部职责就是"建表 + 参数绑定 + 行映射"，mock 掉连接等于把它一起 mock 掉了。
 * 重开一次文件验证**落盘持久化**与旧库升级路径（character_tasks 在 agent 平台的 tasks 表旁自立门户）。
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { Database } from '@/stratix-database/sqlite-adapter';

import {
  ensureCharacterTasksTable,
  loadRecentTasks,
  upsertTask,
  type PersistedTaskRecord,
} from '../../services/persistence/task-record-dao';

function record(patch: Partial<PersistedTaskRecord> = {}): PersistedTaskRecord {
  return {
    id: 'task_1',
    characterId: 'ch-1',
    prompt: '侦察北门',
    status: 'queued',
    output: '',
    createdAt: 1700000000000,
    startedAt: null,
    endedAt: null,
    ...patch,
  };
}

describe('task-record-dao（真实 sql.js 适配器）', () => {
  let dbPath: string;
  let db: Database;

  beforeEach(async () => {
    dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'stratix-task-record-')), 'tasks.sqlite');
    db = new Database(dbPath);
    await db.initialize();
    ensureCharacterTasksTable(db);
  });

  afterEach(() => {
    db.close();
    fs.rmSync(path.dirname(dbPath), { recursive: true, force: true });
  });

  describe('upsert + load 全字段往返', () => {
    it('queued → running → completed 三段相位推进：同 id 覆盖，终态行带全文与时间戳', () => {
      upsertTask(db, record());
      upsertTask(db, record({ status: 'running', startedAt: 1700000001000 }));
      upsertTask(
        db,
        record({
          status: 'completed',
          output: '北门无敌情，一切正常。',
          startedAt: 1700000001000,
          endedAt: 1700000010000,
        })
      );

      expect(loadRecentTasks(db, 'ch-1')).toEqual([
        {
          id: 'task_1',
          characterId: 'ch-1',
          prompt: '侦察北门',
          status: 'completed',
          output: '北门无敌情，一切正常。',
          createdAt: 1700000000000,
          startedAt: 1700000001000,
          endedAt: 1700000010000,
        },
      ]);
    });

    it('failed 直达行（queued 守门拦截）：startedAt 保持 null', () => {
      upsertTask(db, record({ status: 'failed', output: '该 CLI 未安装，任务无法执行', endedAt: 1700000000500 }));
      const row = loadRecentTasks(db, 'ch-1')[0];
      expect(row.status).toBe('failed');
      expect(row.startedAt).toBeNull();
      expect(row.endedAt).toBe(1700000000500);
    });
  });

  describe('窗口与排序', () => {
    it('按角色隔离；最近 N 条（尾部窗口）按时间正序返回', () => {
      for (let i = 1; i <= 5; i += 1) {
        upsertTask(db, record({ id: `task_${i}`, createdAt: 1700000000000 + i }));
      }
      upsertTask(db, record({ id: 'task_other', characterId: 'ch-2', createdAt: 1700000000099 }));

      expect(loadRecentTasks(db, 'ch-1', 3).map((r) => r.id)).toEqual(['task_3', 'task_4', 'task_5']);
      expect(loadRecentTasks(db, 'ch-1').map((r) => r.id)).toHaveLength(5); // 缺省窗口 20
      expect(loadRecentTasks(db, 'ghost')).toEqual([]);
    });
  });

  describe('落盘持久化', () => {
    it('close 前显式 save → 重开文件库数据还在（真落盘，不是内存错觉）', async () => {
      upsertTask(db, record({ status: 'completed', output: '全文输出' }));
      await db.save();
      db.close();

      const reopened = new Database(dbPath);
      await reopened.initialize();
      ensureCharacterTasksTable(reopened); // IF NOT EXISTS 幂等：已存在的表不动
      const rows = loadRecentTasks(reopened, 'ch-1');
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ status: 'completed', output: '全文输出' });
      reopened.close();
    });
  });

  describe('与 agent 平台的 tasks 表共存（命名隔离）', () => {
    it('旁边有一张 v1 形状的 tasks 表（task_id 主键）也不冲突：各写各的', () => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS tasks (
          task_id TEXT PRIMARY KEY,
          zone_id TEXT NOT NULL,
          name TEXT NOT NULL
        )
      `);
      db.prepare('INSERT INTO tasks (task_id, zone_id, name) VALUES (?, ?, ?)').run('t-agent', 'zone-1', '平台任务');

      upsertTask(db, record());
      expect(loadRecentTasks(db, 'ch-1')).toHaveLength(1);
      const agentRows = db.prepare('SELECT task_id FROM tasks').all() as Array<{ task_id: string }>;
      expect(agentRows).toEqual([{ task_id: 't-agent' }]);
    });
  });
});
