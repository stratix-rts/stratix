/**
 * 集成测试：StratixDatabase 的 schema v17 迁移（编排层 `tasks` 表的 `project_id` 列退役，
 * task_206 / M2-09）。用真实的 sql.js 适配器开临时文件库，两个起点各验一遍：
 *   1. 全新库 → 建表即带**可空**的 project_id；新代码（TaskQueueService）写行**不带**该列；
 *   2. v16 库（project_id NOT NULL + 一行老数据）→ 重建表把列改可空，**老行与老值都保留**
 *      （物理删列留 M3），且此后能写入不带该列的新行。
 * 权威依据：docs/DESIGN-project-map.md §1.3.1.1 三条裁决第 1 条
 *   （「新代码不得写入 tasks.project_id 的语义」）。
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { Database } from '@/stratix-database/sqlite-adapter';
import {
  destroyDatabase,
  initializeDatabase,
  type StratixDatabase,
} from '@/stratix-database/StratixDatabase';
import { TaskQueueService } from '@/stratix-orchestration/task-queue/TaskQueueService';

function tempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function versionOf(db: StratixDatabase): number {
  const row = db
    .getDatabase()
    .prepare('SELECT MAX(version) AS v FROM schema_version')
    .get() as { v?: number };
  return Number(row.v ?? 0);
}

/** project_id 列的「是否 NOT NULL」——0 = 可空（退役后的目标形状）。 */
function projectIdNotNull(db: StratixDatabase): number {
  const rows = db
    .getDatabase()
    .prepare('PRAGMA table_info(tasks)')
    .all() as Array<{ name?: string; notnull?: number }>;
  const column = rows.find((row) => row.name === 'project_id');
  if (!column) throw new Error('tasks.project_id 列不存在');
  return Number(column.notnull ?? 0);
}

/** 铺一张 v16 形状的 tasks 表（project_id NOT NULL）+ 一行老数据 + 版本 16。 */
async function seedV16(target: Database): Promise<void> {
  target.exec(`
    CREATE TABLE tasks (
      task_id TEXT PRIMARY KEY,
      zone_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      type TEXT NOT NULL CHECK (type IN ('coding', 'writing', 'analysis', 'research', 'general')),
      priority INTEGER DEFAULT 5 CHECK (priority BETWEEN 1 AND 10),
      status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'assigned', 'in_progress', 'completed', 'failed', 'cancelled')),
      assigned_agent_id TEXT,
      dependencies TEXT DEFAULT '[]',
      context TEXT,
      result TEXT,
      error TEXT,
      created_at INTEGER NOT NULL,
      assigned_at INTEGER,
      started_at INTEGER,
      completed_at INTEGER
    );
    CREATE TABLE schema_version (version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL);
    INSERT INTO schema_version (version, applied_at) VALUES (16, 0);
    INSERT INTO tasks (task_id, zone_id, project_id, name, type, created_at)
      VALUES ('task_old', 'zone-1', 'legacy-project', '老任务', 'coding', 1700000000000);
  `);
}

describe('StratixDatabase schema v17（tasks.project_id 退役，task_206 / M2-09）', () => {
  afterEach(() => {
    destroyDatabase();
  });

  test('全新库：project_id 可空；新代码写行不带该列（列值 = NULL）', async () => {
    const dir = tempDir('stratix-tasks-v17-fresh-');
    try {
      const db = await initializeDatabase({ dataDir: dir, filename: 'game' });

      expect(versionOf(db)).toBe(17);
      expect(projectIdNotNull(db)).toBe(0);

      // 新代码（编排层建任务）—— INSERT 不含 project_id，且落库为 NULL。
      await TaskQueueService.getInstance().createTask('task_new', 'zone-1', '新任务', 'coding', {
        description: '新一代副本维度的任务',
      });

      const row = db
        .getDatabase()
        .prepare('SELECT task_id, project_id FROM tasks WHERE task_id = ?')
        .get('task_new') as { task_id?: string; project_id?: string | null } | undefined;
      expect(row?.task_id).toBe('task_new');
      expect(row?.project_id ?? null).toBeNull();
    } finally {
      destroyDatabase();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('v16 库（project_id NOT NULL）→ 重建改可空：老行与老值保留，新行可不带该列', async () => {
    const dir = tempDir('stratix-tasks-v17-from16-');
    const file = path.join(dir, 'game.sqlite');
    const seed = new Database(file);
    await seed.initialize();
    await seedV16(seed);
    seed.close();

    try {
      const db = await initializeDatabase({ dataDir: dir, filename: 'game' });

      expect(versionOf(db)).toBe(17);
      expect(projectIdNotNull(db)).toBe(0);

      // 老行零丢失，老值保留（物理删列留 M3 —— 本单只标退役，不动存量数据）。
      const old = db
        .getDatabase()
        .prepare('SELECT task_id, project_id, name FROM tasks WHERE task_id = ?')
        .get('task_old') as { task_id?: string; project_id?: string | null; name?: string } | undefined;
      expect(old).toMatchObject({ task_id: 'task_old', project_id: 'legacy-project', name: '老任务' });

      // 迁移后新代码照旧能写（不带 project_id 不再被 NOT NULL 拒掉）。
      await TaskQueueService.getInstance().createTask('task_after', 'zone-1', '迁移后新建', 'coding', {
        description: '迁移之后创建',
      });
      const created = db
        .getDatabase()
        .prepare('SELECT task_id, project_id FROM tasks WHERE task_id = ?')
        .get('task_after') as { task_id?: string; project_id?: string | null } | undefined;
      expect(created?.task_id).toBe('task_after');
      expect(created?.project_id ?? null).toBeNull();
    } finally {
      destroyDatabase();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('迁移幂等：重复 initialize 不炸（列已可空 ⇒ 直过）', async () => {
    const dir = tempDir('stratix-tasks-v17-idem-');
    try {
      const db = await initializeDatabase({ dataDir: dir, filename: 'game' });
      db.initialize();

      expect(versionOf(db)).toBe(17);
      expect(projectIdNotNull(db)).toBe(0);
    } finally {
      destroyDatabase();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
