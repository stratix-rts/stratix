/**
 * 单测：角色任务 DAO（app/services/persistence/task-record-dao.ts，task_037）。
 *
 * 驱动说明：与 chat-history-dao.test.ts 同一策略 —— 用**真实的 sql.js 适配器**（生产同款）
 * 开临时文件库；DAO 的全部职责就是"建表 + 参数绑定 + 行映射"，mock 掉连接等于把它一起 mock 掉了。
 * 重开一次文件验证**落盘持久化**与旧库升级路径（character_tasks 在 agent 平台的 tasks 表旁自立门户）。
 * @since v3.24（task_048）追加 artifacts 列的往返 / 相位覆盖 / v5 老表（无该列）ALTER ADD 迁移。
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

  // ============================================================================
  // 五态词表与旧表迁移（@since v3.23，task_047）
  // ============================================================================

  describe('cancelled 相位往返（五态 CHECK）', () => {
    it('queued → cancelled：占位文案入行，startedAt 保持 null（没跑过）', () => {
      upsertTask(db, record());
      upsertTask(
        db,
        record({ status: 'cancelled', output: '任务在排队时被取消', endedAt: 1700000000500 })
      );
      const row = loadRecentTasks(db, 'ch-1')[0];
      expect(row.status).toBe('cancelled');
      expect(row.startedAt).toBeNull();
      expect(row.endedAt).toBe(1700000000500);
      expect(row.output).toBe('任务在排队时被取消');
    });
  });

  describe('四态老表迁移（SQLite CHECK 不可 ALTER → 重建表）', () => {
    /** 手工建一张 v4 形状的四态表并插两行老数据。 */
    function seedLegacyFourStatusTable(target: Database): void {
      target.exec(`
        CREATE TABLE character_tasks (
          id TEXT PRIMARY KEY,
          character_id TEXT NOT NULL,
          prompt TEXT NOT NULL,
          status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'completed', 'failed')),
          output TEXT NOT NULL DEFAULT '',
          created_at INTEGER NOT NULL,
          started_at INTEGER,
          ended_at INTEGER
        )
      `);
      target
        .prepare(
          'INSERT INTO character_tasks (id, character_id, prompt, status, output, created_at) VALUES (?, ?, ?, ?, ?, ?)'
        )
        .run('task_old_1', 'ch-1', '老任务', 'completed', '老结果', 1700000000000);
      target
        .prepare(
          'INSERT INTO character_tasks (id, character_id, prompt, status, output, created_at) VALUES (?, ?, ?, ?, ?, ?)'
        )
        .run('task_old_2', 'ch-1', '排队中的老任务', 'queued', '', 1700000000001);
    }

    it('老表重建：老数据零丢失、新 cancelled 可写入、临时表不留残骸、幂等可重跑', async () => {
      // 用独立文件库（当前 db 的表已是五态，重开一个空白库模拟老库）
      const legacyPath = path.join(path.dirname(dbPath), 'legacy.sqlite');
      const legacy = new Database(legacyPath);
      try {
        await legacy.initialize();
        seedLegacyFourStatusTable(legacy);

        // DAO 就位 → 迁移自动发生
        ensureCharacterTasksTable(legacy);

        // 老数据还在（全字段搬运）
        const rows = loadRecentTasks(legacy, 'ch-1');
        expect(rows.map((r) => r.id)).toEqual(['task_old_1', 'task_old_2']);
        expect(rows[0]).toMatchObject({ status: 'completed', output: '老结果' });

        // cancelled 能写入（新 CHECK 五态生效；窗口取最新一条 = createdAt 最大的 task_new）
        upsertTask(
          legacy,
          record({
            id: 'task_new',
            status: 'cancelled',
            output: '任务在排队时被取消',
            endedAt: 1,
            createdAt: 1700000009999,
          })
        );
        expect(loadRecentTasks(legacy, 'ch-1', 1)[0]).toMatchObject({ id: 'task_new', status: 'cancelled' });

        // 临时表不留残骸；幂等重跑不再重建（DDL 不变即可，重跑不抛）
        const tables = legacy.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as Array<{
          name: string;
        }>;
        expect(tables.some((t) => t.name === 'character_tasks_v5')).toBe(false);
        expect(() => ensureCharacterTasksTable(legacy)).not.toThrow();
      } finally {
        legacy.close();
      }
    });
  });
  // ============================================================================
  // artifacts 列（@since v3.24，task_048）
  // ============================================================================

  describe('artifacts 列往返与相位覆盖', () => {
    const artifactsJson = JSON.stringify({
      files: [{ path: 'src/a.ts', added: 3, removed: 1 }],
      summary: '已完成修改。',
    });

    it('completed 带成果物 JSON → 全文往返；queued/running 快照（缺省）落空串不占行', () => {
      upsertTask(db, record());
      upsertTask(db, record({ status: 'running', startedAt: 1700000001000 }));
      upsertTask(
        db,
        record({
          status: 'completed',
          output: '全文输出',
          startedAt: 1700000001000,
          endedAt: 1700000010000,
          artifacts: artifactsJson,
        })
      );
      const row = loadRecentTasks(db, 'ch-1')[0];
      expect(row.artifacts).toBe(artifactsJson);
    });

    it('同 id 相位推进的 upsert 覆盖 artifacts（ON CONFLICT 全字段覆盖语义）', () => {
      upsertTask(db, record({ status: 'completed', output: 'v1', endedAt: 1, artifacts: artifactsJson }));
      upsertTask(db, record({ status: 'completed', output: 'v2', endedAt: 2 }));
      expect(loadRecentTasks(db, 'ch-1')[0]).toMatchObject({ output: 'v2', artifacts: undefined });
    });

    it('读侧宽容：列里的空串归一为 undefined（消费方口径：undefined = 无成果物）', () => {
      upsertTask(db, record({ status: 'completed', output: 'x', endedAt: 1 }));
      expect(loadRecentTasks(db, 'ch-1')[0].artifacts).toBeUndefined();
    });
  });

  describe('v5 老表迁移（无 artifacts 列 → ALTER ADD）', () => {
    /** 手工建一张 v5 形状的五态表（有 cancelled、无 artifacts 列）并插老数据。 */
    function seedLegacyFiveStatusTable(target: Database): void {
      target.exec(`
        CREATE TABLE character_tasks (
          id TEXT PRIMARY KEY,
          character_id TEXT NOT NULL,
          prompt TEXT NOT NULL,
          status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'completed', 'failed', 'cancelled')),
          output TEXT NOT NULL DEFAULT '',
          created_at INTEGER NOT NULL,
          started_at INTEGER,
          ended_at INTEGER
        )
      `);
      target
        .prepare(
          'INSERT INTO character_tasks (id, character_id, prompt, status, output, created_at) VALUES (?, ?, ?, ?, ?, ?)'
        )
        .run('task_v5', 'ch-1', '老任务', 'completed', '老结果', 1700000000000);
    }

    it('v5 老表：ensure 后列补齐、老数据零丢失、老行 artifacts 为 undefined、新行可写', async () => {
      const legacyPath = path.join(path.dirname(dbPath), 'legacy-v5.sqlite');
      const legacy = new Database(legacyPath);
      try {
        await legacy.initialize();
        seedLegacyFiveStatusTable(legacy);

        ensureCharacterTasksTable(legacy); // → ALTER ADD artifacts

        // 老数据还在，老行没有成果物（undefined，不是 null 不是空串）
        const rows = loadRecentTasks(legacy, 'ch-1');
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({ id: 'task_v5', output: '老结果', artifacts: undefined });

        // 新行可写可读（列已就位）
        const newArtifacts = JSON.stringify({ files: [{ path: 'n.ts' }], summary: '' });
        upsertTask(
          legacy,
          record({
            id: 'task_new',
            status: 'completed',
            output: '新结果',
            endedAt: 1,
            createdAt: 1700000009999,
            artifacts: newArtifacts,
          })
        );
        expect(loadRecentTasks(legacy, 'ch-1', 1)[0].artifacts).toBe(newArtifacts);

        // 幂等：已有列再 ensure 不抛不重建
        expect(() => ensureCharacterTasksTable(legacy)).not.toThrow();
      } finally {
        legacy.close();
      }
    });
  });
});
