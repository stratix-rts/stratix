/**
 * 集成测试：StratixDatabase 的 schema v7 迁移（character_tasks 六态 CHECK + plan 列，task_049）。
 * 用真实的 sql.js 适配器开临时文件库，四个起点各验一遍：
 *   1. 全新库 → createTables 建的表直接带六态 CHECK + plan 列，版本号落 7；
 *   2. v6 库（五态 + artifacts、版本 6）→ 重建六态表（带 artifacts 与 plan），老数据
 *      （含 artifacts）零丢失，版本升 7；
 *   3. v5 库（五态、无 artifacts、版本 5）→ 先补 artifacts 再重建六态，plan 列就位；
 *   4. v4 库（四态、版本 4）→ 五态重建 + artifacts + 六态重建三步全跑，老行不丢。
 * 迁移后还要能落 awaiting_approval 快照（审批门的挂起行）与 plan 全文（驳回存档），
 * 并被 loadRecentTasks 读回 —— 迁移产物必须与 DAO 期望的形状一致（同 v6 测试的互锁口径）。
 * 另验 DAO 自立路径（ensureCharacterTasksTable 在没有 StratixDatabase 迁移记录时也能就位）。
 * @since v3.27（task_051）目标 schema 升 v8：版本断言跟随目标（8），v8 专属迁移面
 * （pipelines 表 + pipeline_id 列）见 task-schema-v8.test.ts。
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

/**
 * 在目标文件库里手工铺一张老形状的 character_tasks。
 * statusCheck 决定 CHECK 词表（四态 / 五态），withArtifacts 决定有无 artifacts 列
 * （v6 形状），version 决定 schema_version 落点。
 */
function seedLegacyTable(
  target: Database,
  statusCheck: string,
  version: number,
  withArtifacts: boolean
): void {
  const artifactsColumn = withArtifacts ? `,\n      artifacts TEXT NOT NULL DEFAULT ''` : '';
  const artifactsValue = withArtifacts
    ? `JSON.stringify` // 占位不用 —— 下面 INSERT 用显式列名，artifacts 有 DEFAULT ''
    : '';
  void artifactsValue; // 仅为可读性；INSERT 显式列名，artifacts 落 DEFAULT ''
  target.exec(`
    CREATE TABLE character_tasks (
      id TEXT PRIMARY KEY,
      character_id TEXT NOT NULL,
      prompt TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN (${statusCheck})),
      output TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL,
      started_at INTEGER,
      ended_at INTEGER${artifactsColumn}
    );
    CREATE TABLE schema_version (version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL);
    INSERT INTO schema_version (version, applied_at) VALUES (${version}, 0);
    INSERT INTO character_tasks (id, character_id, prompt, status, output, created_at${withArtifacts ? ', artifacts' : ''})
      VALUES ('task_old', 'ch-1', '老任务', 'completed', '老结果全文', 1700000000000${withArtifacts ? `, '{"files":[]}'` : ''});
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

/** 建表 DDL 指纹：CHECK 词表里是否已含六态（'awaiting_approval' 只会出现在 CHECK 里）。 */
function hasSixStateCheck(target: Database | StratixDatabase): boolean {
  const raw = target instanceof Database ? target : target.getDatabase();
  const row = raw
    .prepare(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'character_tasks'`)
    .get() as { sql?: string } | undefined;
  return typeof row?.sql === 'string' && row.sql.includes("'awaiting_approval'");
}

function versionOf(target: Database | StratixDatabase): number {
  const raw = target instanceof Database ? target : target.getDatabase();
  const row = raw.prepare('SELECT MAX(version) AS v FROM schema_version').get() as { v?: number };
  return Number(row.v ?? 0);
}

function record(patch: Partial<PersistedTaskRecord> = {}): PersistedTaskRecord {
  return {
    id: 'task_new',
    characterId: 'ch-1',
    prompt: '新任务',
    status: 'awaiting_approval',
    output: '一、先收集资料\n二、再动手实现',
    createdAt: 1700000009999,
    startedAt: 1700000001000,
    endedAt: null,
    plan: '一、先收集资料\n二、再动手实现',
    ...patch,
  };
}

describe('StratixDatabase schema v7（六态 + plan 列，task_049）', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stratix-schema-v7-'));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('全新库：createTables 建表即六态 + plan 列，版本号 7，awaiting 快照可写可读', async () => {
    const db = await openAndInitialize(dir);
    try {
      expect(hasSixStateCheck(db)).toBe(true);
      expect(columnNames(db)).toEqual(expect.arrayContaining(['artifacts', 'plan']));
      expect(versionOf(db)).toBe(12); // v12（task_061）起目标 schema 是 12（exp_events）
      // 六态词表全走一遍：挂起行 + 驳回行都能进（CHECK 不炸就是迁移成功的硬证据）
      upsertTask(db.getDatabase(), record());
      upsertTask(
        db.getDatabase(),
        record({ id: 'task_rej', status: 'failed', output: '计划被驳回', endedAt: 1700000010000, createdAt: 1700000010000 })
      );
      const rows = loadRecentTasks(db.getDatabase(), 'ch-1');
      expect(rows).toHaveLength(2);
      // loadRecentTasks 回升序（旧→新）：挂起行在前、驳回行在后（createdAt 递增）
      expect(rows[0]).toMatchObject({ id: 'task_new', status: 'awaiting_approval', plan: record().plan });
      expect(rows[1]).toMatchObject({ id: 'task_rej', status: 'failed', plan: record().plan });
    } finally {
      db.close();
    }
  });

  test('v6 库（五态 + artifacts）→ 重建六态，artifacts 老数据零丢失，版本升 7，plan 可写', async () => {
    const seed = new Database(path.join(dir, 'game.sqlite'));
    await seed.initialize();
    seedLegacyTable(
      seed,
      "'queued', 'running', 'completed', 'failed', 'cancelled'",
      6,
      true
    );
    seed.close();

    const db = await openAndInitialize(dir);
    try {
      expect(hasSixStateCheck(db)).toBe(true);
      expect(columnNames(db)).toEqual(expect.arrayContaining(['artifacts', 'plan']));
      expect(versionOf(db)).toBe(12); // v12（task_061）起目标 schema 是 12（exp_events）
      // 老行零丢失：artifacts（v6 加列）随重建搬运，plan 是新列落缺省（读侧 undefined）
      const old = loadRecentTasks(db.getDatabase(), 'ch-1')[0];
      expect(old).toMatchObject({ id: 'task_old', output: '老结果全文', plan: undefined });
      expect(old.artifacts).toBe('{"files":[]}');
      // 六态词表 + plan 列可用
      upsertTask(db.getDatabase(), record());
      const rows = loadRecentTasks(db.getDatabase(), 'ch-1');
      expect(rows).toHaveLength(2);
      expect(rows[1]).toMatchObject({ id: 'task_new', status: 'awaiting_approval' });
    } finally {
      db.close();
    }
  });

  test('v5 库（五态、无 artifacts）→ 补 artifacts 后重建六态，三步迁移数据不丢', async () => {
    const seed = new Database(path.join(dir, 'game.sqlite'));
    await seed.initialize();
    seedLegacyTable(
      seed,
      "'queued', 'running', 'completed', 'failed', 'cancelled'",
      5,
      false
    );
    seed.close();

    const db = await openAndInitialize(dir);
    try {
      expect(hasSixStateCheck(db)).toBe(true);
      expect(columnNames(db)).toEqual(expect.arrayContaining(['artifacts', 'plan']));
      expect(versionOf(db)).toBe(12); // v12（task_061）起目标 schema 是 12（exp_events）
      const old = loadRecentTasks(db.getDatabase(), 'ch-1')[0];
      expect(old).toMatchObject({ id: 'task_old', output: '老结果全文' });
      upsertTask(db.getDatabase(), record());
      expect(loadRecentTasks(db.getDatabase(), 'ch-1')[1]).toMatchObject({
        id: 'task_new',
        status: 'awaiting_approval',
        plan: record().plan,
      });
    } finally {
      db.close();
    }
  });

  test('v4 库（四态）→ 五态重建 + artifacts + 六态重建全链，老行不丢', async () => {
    const seed = new Database(path.join(dir, 'game.sqlite'));
    await seed.initialize();
    seedLegacyTable(seed, "'queued', 'running', 'completed', 'failed'", 4, false);
    seed.close();

    const db = await openAndInitialize(dir);
    try {
      expect(hasSixStateCheck(db)).toBe(true);
      expect(columnNames(db)).toEqual(expect.arrayContaining(['artifacts', 'plan']));
      expect(versionOf(db)).toBe(12); // v12（task_061）起目标 schema 是 12（exp_events）
      const old = loadRecentTasks(db.getDatabase(), 'ch-1')[0];
      expect(old).toMatchObject({ id: 'task_old', output: '老结果全文' });
      // 五态（cancelled）与六态（awaiting_approval）都可用 —— 全链迁移后的表两代词表都收
      upsertTask(
        db.getDatabase(),
        record({ id: 'task_c', status: 'cancelled', output: '被取消', plan: undefined, createdAt: 1700000008888 })
      );
      upsertTask(db.getDatabase(), record());
      const rows = loadRecentTasks(db.getDatabase(), 'ch-1');
      expect(rows).toHaveLength(3);
      // 升序（旧→新）：老行 → cancelled → awaiting
      expect(rows[1]).toMatchObject({ id: 'task_c', status: 'cancelled' });
      expect(rows[2]).toMatchObject({ id: 'task_new', status: 'awaiting_approval' });
    } finally {
      db.close();
    }
  });

  test('DAO 自立路径：ensureCharacterTasksTable 直接在 v6 老库上就位（无 schema_version 记录）', async () => {
    const seed = new Database(path.join(dir, 'game.sqlite'));
    await seed.initialize();
    // 只铺表不铺 schema_version —— 模拟「DAO 单独面对旧库」（测试库 / 手工恢复场景）
    seed.exec(`
      CREATE TABLE character_tasks (
        id TEXT PRIMARY KEY,
        character_id TEXT NOT NULL,
        prompt TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'completed', 'failed', 'cancelled')),
        output TEXT NOT NULL DEFAULT '',
        created_at INTEGER NOT NULL,
        started_at INTEGER,
        ended_at INTEGER,
        artifacts TEXT NOT NULL DEFAULT ''
      );
      INSERT INTO character_tasks (id, character_id, prompt, status, output, created_at)
        VALUES ('task_old', 'ch-1', '老任务', 'completed', '老结果全文', 1700000000000);
    `);
    ensureCharacterTasksTable(seed);
    expect(hasSixStateCheck(seed)).toBe(true);
    expect(columnNames(seed)).toContain('plan');
    const old = loadRecentTasks(seed, 'ch-1')[0];
    expect(old).toMatchObject({ id: 'task_old', output: '老结果全文' });
    upsertTask(seed, record());
    expect(loadRecentTasks(seed, 'ch-1')[1]).toMatchObject({
      id: 'task_new',
      status: 'awaiting_approval',
      plan: record().plan,
    });
    seed.close();
  });

  test('幂等：v7 库再跑一次 initialize 不重建不丢数据', async () => {
    const db = await openAndInitialize(dir);
    await db.init();
    db.initialize(); // 二次 initialize
    upsertTask(db.getDatabase(), record());
    // 残留的迁移临时表不该存在（重建失败会留在库里）
    const leftovers = db
      .getDatabase()
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'character_tasks_v%'`)
      .all() as Array<{ name?: string }>;
    expect(leftovers).toHaveLength(0);
    expect(loadRecentTasks(db.getDatabase(), 'ch-1')[0]).toMatchObject({ id: 'task_new' });
    db.close();
  });
});
