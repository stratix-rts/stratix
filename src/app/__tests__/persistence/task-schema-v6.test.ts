/**
 * 集成测试：StratixDatabase 的 schema v6 迁移（character_tasks.artifacts，task_048）。
 * 用真实的 sql.js 适配器开临时文件库，三个起点各验一遍：
 *   1. 全新库 → createTables 建的表直接带 artifacts 列，版本号落 6；
 *   2. v5 库（五态表、无 artifacts 列、版本 5）→ 跳过重建、ALTER ADD 补列、老数据零丢失、版本升 6；
 *   3. v4 库（四态表、无 artifacts 列、版本 4）→ 先五态重建再补列，两步迁移都不丢数据。
 * 读侧断言用 PRAGMA（列就位）+ upsertTask/loadRecentTasks（DAO 同一适配器 —— 迁移产物必须
 * 与 DAO 期望的形状一致，两边各写各的 DDL 就靠这层测试互相锁住）。
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { Database } from '@/stratix-database/sqlite-adapter';
import { StratixDatabase } from '@/stratix-database/StratixDatabase';
import {
  ensureCharacterTasksTable,
  loadRecentTasks,
  upsertTask,
  type PersistedTaskRecord,
} from '@/app/services/persistence/task-record-dao';

/** 在目标文件库里手工铺一张老形状的 character_tasks（columns 定义 CHECK 词表与是否带 artifacts）。 */
function seedLegacyTable(target: Database, statuses: string, extraColumns = ''): void {
  target.exec(`
    CREATE TABLE character_tasks (
      id TEXT PRIMARY KEY,
      character_id TEXT NOT NULL,
      prompt TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN (${statuses})),
      output TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL,
      started_at INTEGER,
      ended_at INTEGER${extraColumns}
    );
    CREATE TABLE schema_version (version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL);
    INSERT INTO schema_version (version, applied_at) VALUES (${statuses.includes('cancelled') ? 5 : 4}, 0);
    INSERT INTO character_tasks (id, character_id, prompt, status, output, created_at)
      VALUES ('task_old', 'ch-1', '老任务', 'completed', '老结果全文', 1700000000000);
  `);
}

/** 打开一个 StratixDatabase（init + initialize 走生产的完整迁移链）。 */
async function openAndInitialize(dir: string): Promise<StratixDatabase> {
  const db = new StratixDatabase({ dataDir: dir, filename: 'game' });
  await db.init();
  db.initialize();
  return db;
}

function columnNames(target: Database | StratixDatabase): string[] {
  const raw = target instanceof Database ? target : target.getDatabase();
  const rows = raw.prepare('PRAGMA table_info(character_tasks)').all() as Array<{ name?: string }>;
  return rows.map((row) => String(row.name));
}

function record(patch: Partial<PersistedTaskRecord> = {}): PersistedTaskRecord {
  return {
    id: 'task_new',
    characterId: 'ch-1',
    prompt: '新任务',
    status: 'completed',
    output: '新结果',
    createdAt: 1700000009999,
    startedAt: 1700000001000,
    endedAt: 1700000010000,
    artifacts: JSON.stringify({ files: [{ path: 'n.ts', added: 1 }], summary: 's' }),
    ...patch,
  };
}

describe('StratixDatabase schema v6（artifacts 列，task_048）', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stratix-schema-v6-'));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('全新库：createTables 建表即带 artifacts 列（v7 起版本号随目标 schema 走）', async () => {
    const db = await openAndInitialize(dir);
    try {
      expect(columnNames(db)).toContain('artifacts');
      const version = db
        .getDatabase()
        .prepare('SELECT MAX(version) AS v FROM schema_version')
        .get() as { v?: number };
      // task_049 起目标 schema 已是 v7（六态 + plan 列）—— 本用例的 artifacts 列语义不变，
      // 版本断言跟随目标（新鲜库就是最新形状，不存在「新库停在 v6」的中间态）。
      // @since v3.27（task_051）目标 schema 是 v8（+pipelines 表 +pipeline_id 列）。
      // @since v3.29（task_053）目标 schema 是 v9（+characters.context_enabled 列）。
      expect(version.v).toBe(9);
      // DAO 直接可用（迁移产物与 DAO 的 DDL 同构）
      ensureCharacterTasksTable(db.getDatabase());
      upsertTask(db.getDatabase(), record());
      expect(loadRecentTasks(db.getDatabase(), 'ch-1')[0]).toMatchObject({ id: 'task_new' });
    } finally {
      db.close();
    }
  });

  test('v5 库（五态、无 artifacts）→ ALTER ADD 补列，老数据零丢失，版本升 6', async () => {
    // 先用裸适配器铺一张 v5 老库
    const seed = new Database(path.join(dir, 'game.sqlite'));
    await seed.initialize();
    seedLegacyTable(seed, "'queued', 'running', 'completed', 'failed', 'cancelled'");
    seed.close();

    const db = await openAndInitialize(dir);
    try {
      expect(columnNames(db)).toContain('artifacts');
      // 老行零丢失；老行没有成果物（undefined —— 读侧归一口径）
      const old = loadRecentTasks(db.getDatabase(), 'ch-1')[0];
      expect(old).toMatchObject({ id: 'task_old', output: '老结果全文', artifacts: undefined });
      // 新行可写（列已就位）
      upsertTask(db.getDatabase(), record());
      const rows = loadRecentTasks(db.getDatabase(), 'ch-1');
      expect(rows).toHaveLength(2);
      expect(rows[1].artifacts).toBe(record().artifacts);
    } finally {
      db.close();
    }
  });

  test('v4 库（四态、无 artifacts）→ 五态重建 + 补列两步都跑，数据不丢', async () => {
    const seed = new Database(path.join(dir, 'game.sqlite'));
    await seed.initialize();
    seedLegacyTable(seed, "'queued', 'running', 'completed', 'failed'");
    seed.close();

    const db = await openAndInitialize(dir);
    try {
      expect(columnNames(db)).toContain('artifacts');
      const old = loadRecentTasks(db.getDatabase(), 'ch-1')[0];
      expect(old).toMatchObject({ id: 'task_old', output: '老结果全文', artifacts: undefined });
      // cancelled（五态）与 artifacts（v6）同时可用
      upsertTask(
        db.getDatabase(),
        record({ id: 'task_c', status: 'cancelled', output: '被取消', startedAt: null, artifacts: undefined })
      );
      expect(loadRecentTasks(db.getDatabase(), 'ch-1', 1)[0]).toMatchObject({
        id: 'task_c',
        status: 'cancelled',
      });
    } finally {
      db.close();
    }
  });
});
