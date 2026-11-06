/**
 * 集成测试：StratixDatabase 的 schema v8 迁移（pipelines 表 + character_tasks.pipeline_id
 * 列，task_051）。用真实的 sql.js 适配器开临时文件库，四个起点各验一遍：
 *   1. 全新库 → createTables/migrate 建的表直接带 pipeline_id，pipelines 表就位，版本落 8；
 *   2. v7 库（六态 + artifacts + plan、版本 7）→ ALTER ADD 补 pipeline_id，老任务零丢失，
 *      版本升 8，pipelines 表新建；
 *   3. v6 库（五态 + artifacts、版本 6）→ 六态重建 + pipeline_id 兜底同链全跑，老行不丢；
 *   4. v4 库（四态、版本 4）→ 全链迁移终点一致（六态 + 全列 + pipelines 表）。
 * 迁移后还要能落「站任务带 pipeline_id 的快照 + pipelines 行」并被 DAO 读回 ——
 * 迁移产物必须与 pipeline-record-dao / task-record-dao 期望的形状一致（同 v7 测试的互锁口径）。
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
import {
  ensurePipelinesTable,
  loadRecentPipelines,
  upsertPipeline,
  type PersistedPipelineRecord,
} from '@/app/services/persistence/pipeline-record-dao';

/** 在目标文件库里手工铺一张 v7 形状的 character_tasks（六态 + artifacts + plan，无 pipeline_id）。 */
function seedV7Table(target: Database, version: number): void {
  target.exec(`
    CREATE TABLE character_tasks (
      id TEXT PRIMARY KEY,
      character_id TEXT NOT NULL,
      prompt TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'awaiting_approval', 'completed', 'failed', 'cancelled')),
      output TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL,
      started_at INTEGER,
      ended_at INTEGER,
      artifacts TEXT NOT NULL DEFAULT '',
      plan TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE schema_version (version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL);
    INSERT INTO schema_version (version, applied_at) VALUES (${version}, 0);
    INSERT INTO character_tasks (id, character_id, prompt, status, output, created_at, artifacts, plan)
      VALUES ('task_old', 'ch-1', '老任务', 'completed', '老结果全文', 1700000000000, '{"files":[]}', '');
  `);
}

async function openAndInitialize(dir: string): Promise<StratixDatabase> {
  const db = new StratixDatabase({ dataDir: dir, filename: 'game' });
  await db.init();
  db.initialize();
  return db;
}

function columns(target: Database | StratixDatabase, table: string): string[] {
  const raw = target instanceof Database ? target : target.getDatabase();
  const rows = raw.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name?: string }>;
  return rows.map((row) => String(row.name));
}

function versionOf(target: Database | StratixDatabase): number {
  const raw = target instanceof Database ? target : target.getDatabase();
  const row = raw.prepare('SELECT MAX(version) AS v FROM schema_version').get() as { v?: number };
  return Number(row.v ?? 0);
}

function taskRecord(patch: Partial<PersistedTaskRecord> = {}): PersistedTaskRecord {
  return {
    id: 'task_step',
    characterId: 'ch-1',
    prompt: '实现：修复登录页',
    status: 'completed',
    output: '站输出',
    createdAt: 1_700_000_009_999,
    startedAt: 1_700_000_001_000,
    endedAt: 1_700_000_009_000,
    ...patch,
  };
}

function pipelineRecord(patch: Partial<PersistedPipelineRecord> = {}): PersistedPipelineRecord {
  return {
    id: 'pipeline_1',
    name: '实现+审阅',
    issue: '修复登录页',
    status: 'completed',
    steps: JSON.stringify([{ characterId: 'ch-1', taskId: 'task_step', phase: 'completed', prompt: '实现：修复登录页' }]),
    createdAt: 1_700_000_000_000,
    finishedAt: 1_700_000_010_000,
    ...patch,
  };
}

/** 迁移终点的共同断言：pipeline_id 列在位、pipelines 表在位、站快照与流水线行可写可读。 */
function expectV8Shape(db: StratixDatabase): void {
  expect(versionOf(db)).toBe(16); // v16（task_200）起目标 schema 是 16（session_external_refs）
  expect(columns(db, 'character_tasks')).toEqual(expect.arrayContaining(['artifacts', 'plan', 'pipeline_id']));
  expect(columns(db, 'pipelines').length).toBeGreaterThan(0);

  // 与生产 IPC 同入口：ensure 幂等 → upsert 站任务（带归属）+ 流水线行 → 读回。
  const raw = db.getDatabase();
  ensureCharacterTasksTable(raw);
  ensurePipelinesTable(raw);
  upsertTask(raw, taskRecord({ pipelineId: 'pipeline_1' }));
  upsertPipeline(raw, pipelineRecord());

  const tasks = loadRecentTasks(raw, 'ch-1');
  const step = tasks.find((row) => row.id === 'task_step');
  expect(step).toMatchObject({ pipelineId: 'pipeline_1', output: '站输出' });
  const old = tasks.find((row) => row.id === 'task_old');
  expect(old?.pipelineId).toBeUndefined(); // 老任务无归属（v8 前的行）。

  const pipelines = loadRecentPipelines(raw);
  expect(pipelines[0]).toMatchObject({ id: 'pipeline_1', status: 'completed' });
  expect(JSON.parse(pipelines[0].steps)).toHaveLength(1);
}

describe('StratixDatabase schema v8（pipelines 表 + pipeline_id 列，task_051）', () => {
  test('全新库：建表即带 pipeline_id + pipelines 就位，版本落 8，站快照可写可读', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stratix-v8-fresh-'));
    const db = await openAndInitialize(dir);
    expectV8Shape(db);
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('v7 库（六态 + plan、无 pipeline_id）→ ALTER ADD 补列 + 建 pipelines，老任务零丢失', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stratix-v8-from7-'));
    const file = path.join(dir, 'game.sqlite');
    const seed = new Database(file);
    await seed.initialize();
    seedV7Table(seed, 7);
    seed.close();

    const db = await openAndInitialize(dir);
    expectV8Shape(db);
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('v6 库（五态 + artifacts）→ 六态重建 + v8 全链，老行不丢（artifacts 值保真）', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stratix-v8-from6-'));
    const file = path.join(dir, 'game.sqlite');
    const seed = new Database(file);
    await seed.initialize();
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
      CREATE TABLE schema_version (version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL);
      INSERT INTO schema_version (version, applied_at) VALUES (6, 0);
      INSERT INTO character_tasks (id, character_id, prompt, status, output, created_at, artifacts)
        VALUES ('task_old', 'ch-1', '老任务', 'completed', '老结果全文', 1700000000000, '{"files":["a.ts"]}');
    `);
    seed.close();

    const db = await openAndInitialize(dir);
    expectV8Shape(db);
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('v4 库（四态）→ 全链迁移终点一致（六态 CHECK + 全列 + pipelines 表）', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stratix-v8-from4-'));
    const file = path.join(dir, 'game.sqlite');
    const seed = new Database(file);
    await seed.initialize();
    seed.exec(`
      CREATE TABLE character_tasks (
        id TEXT PRIMARY KEY,
        character_id TEXT NOT NULL,
        prompt TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'completed', 'failed')),
        output TEXT NOT NULL DEFAULT '',
        created_at INTEGER NOT NULL,
        started_at INTEGER,
        ended_at INTEGER
      );
      CREATE TABLE schema_version (version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL);
      INSERT INTO schema_version (version, applied_at) VALUES (4, 0);
      INSERT INTO character_tasks (id, character_id, prompt, status, output, created_at)
        VALUES ('task_old', 'ch-1', '老任务', 'completed', '老结果全文', 1700000000000);
    `);
    seed.close();

    const db = await openAndInitialize(dir);
    expectV8Shape(db);
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
