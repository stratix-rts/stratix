/**
 * 单测：流水线 DAO + 任务表 pipeline_id 列（app/services/persistence/pipeline-record-dao.ts
 * 与 task-record-dao.ts 的 task_051 增量）。
 *
 * 驱动说明：与 task-record-dao.test.ts 同一策略 —— 真实 sql.js 适配器开临时文件库；
 * 重开一次验证落盘与**旧库升级路径**（v7 六态表无 pipeline_id → ALTER ADD 迁移；
 * CASE 守卫「相位快照不抹掉归属标记」是本表的核心写入口径，必须落在真库上断言）。
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
import {
  ensurePipelinesTable,
  loadRecentPipelines,
  upsertPipeline,
  type PersistedPipelineRecord,
} from '../../services/persistence/pipeline-record-dao';

function taskRecord(patch: Partial<PersistedTaskRecord> = {}): PersistedTaskRecord {
  return {
    id: 'task_1',
    characterId: 'ch-1',
    prompt: '侦察北门',
    status: 'queued',
    output: '',
    createdAt: 1_700_000_000_000,
    startedAt: null,
    endedAt: null,
    ...patch,
  };
}

function pipelineRecord(patch: Partial<PersistedPipelineRecord> = {}): PersistedPipelineRecord {
  return {
    id: 'pipeline_1',
    name: '实现+审阅',
    issue: '修复登录页',
    status: 'running',
    steps: JSON.stringify([
      { characterId: 'ch-1', taskId: 'task_1', phase: 'queued', prompt: '实现：修复登录页' },
      { characterId: null, taskId: null, phase: 'pending', prompt: '' },
    ]),
    createdAt: 1_700_000_000_000,
    finishedAt: null,
    ...patch,
  };
}

function makeDbPath(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stratix-pipeline-dao-'));
  return path.join(dir, 'game.sqlite');
}

/** 开库 + 初始化（sql.js 适配器要求；与 task-record-dao.test.ts 同一手法）。 */
async function openDb(file: string): Promise<InstanceType<typeof Database>> {
  const db = new Database(file);
  await db.initialize();
  return db;
}

describe('pipelines 表（task_051）', () => {
  it('建表幂等 + upsert 往返（running → 终态覆盖，finishedAt 收口）', async () => {
    const file = makeDbPath();
    const db = await openDb(file);
    ensurePipelinesTable(db);
    ensurePipelinesTable(db); // 幂等：重复 ensure 不炸（老库 DAO 自立兜底路径）

    upsertPipeline(db, pipelineRecord());
    let rows = loadRecentPipelines(db);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: 'pipeline_1', name: '实现+审阅', status: 'running', finishedAt: null });
    expect(JSON.parse(rows[0].steps)).toHaveLength(2);

    // 相位迁移：整线 completed（steps JSON 与 finishedAt 全字段覆盖）。
    upsertPipeline(db, pipelineRecord({ status: 'completed', finishedAt: 1_700_000_000_900 }));
    rows = loadRecentPipelines(db);
    expect(rows[0]).toMatchObject({ id: 'pipeline_1', status: 'completed', finishedAt: 1_700_000_000_900 });

    db.close();
    // 落盘持久化：重开库还在（生产 = 应用重启后的审计窗口）。
    const reopened = await openDb(file);
    rows = loadRecentPipelines(reopened);
    expect(rows[0]).toMatchObject({ id: 'pipeline_1', status: 'completed' });
    reopened.close();
    fs.rmSync(path.dirname(file), { recursive: true, force: true });
  });

  it('loadRecentPipelines 按 created_at 倒序 + 词表外 status 防御性归一', async () => {
    const file = makeDbPath();
    const db = await openDb(file);
    ensurePipelinesTable(db);
    upsertPipeline(db, pipelineRecord({ id: 'p_a', createdAt: 100 }));
    upsertPipeline(db, pipelineRecord({ id: 'p_b', createdAt: 300 }));
    upsertPipeline(db, pipelineRecord({ id: 'p_c', createdAt: 200 }));
    expect(loadRecentPipelines(db).map((row) => row.id)).toEqual(['p_b', 'p_c', 'p_a']);

    db.close();
    fs.rmSync(path.dirname(file), { recursive: true, force: true });
  });
});

describe('character_tasks.pipeline_id（task_051，schema v8）', () => {
  it('新库：列随建表就位，往返读出 pipelineId（空串归 undefined）', async () => {
    const file = makeDbPath();
    const db = await openDb(file);
    ensureCharacterTasksTable(db);
    upsertTask(db, taskRecord({ pipelineId: 'pipeline_1' }));
    const rows = loadRecentTasks(db, 'ch-1');
    expect(rows[0].pipelineId).toBe('pipeline_1');

    // 普通任务（无归属）落列 '' → 读出 undefined（与 artifacts/plan 同口径）。
    upsertTask(db, taskRecord({ id: 'task_2', createdAt: 1 }));
    const byId = new Map(loadRecentTasks(db, 'ch-1').map((row) => [row.id, row]));
    expect(byId.get('task_1')?.pipelineId).toBe('pipeline_1');
    expect(byId.get('task_2')?.pipelineId).toBeUndefined();
    db.close();
    fs.rmSync(path.dirname(file), { recursive: true, force: true });
  });

  it('词表外 status 防御性归一：无 CHECK 的手造老表 → 读路径归一 failed，不炸不透传', async () => {
    const file = makeDbPath();
    const db = await openDb(file);
    // 本表 CHECK 连 UPDATE 都挡（sql.js 严格）—— 手造一张无 CHECK 的同名老表
    // （ensure 的 IF NOT EXISTS 对它直过），脏词只能从这种边角进来。
    db.exec(`CREATE TABLE pipelines (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, issue TEXT NOT NULL,
      status TEXT NOT NULL, steps TEXT NOT NULL, created_at INTEGER NOT NULL, finished_at INTEGER
    )`);
    ensurePipelinesTable(db); // 幂等直过（表已在），不加 CHECK 不炸。
    db.exec(`INSERT INTO pipelines VALUES ('p_x', '名字', '议题', 'paused', '[]', 1, NULL)`);
    const rows = loadRecentPipelines(db);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: 'p_x', status: 'failed' });
    db.close();
    fs.rmSync(path.dirname(file), { recursive: true, force: true });
  });

  it('v7 旧库迁移：六态表（无 pipeline_id）→ ALTER ADD 兑底，老行为不回归', async () => {
    const file = makeDbPath();
    const db = await openDb(file);
    // 手工造一张 v7 形状的表（六态 CHECK + artifacts + plan，无 pipeline_id）。
    db.exec(`
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
      )
    `);
    // 兜底路径：ensure 先 ALTER ADD（v8 列），随后 upsert 才有列可写 —— 与 StratixDatabase
    // 迁移后的 DAO 自立路径同一入口（主进程每次 IPC 前 ensure）。
    ensureCharacterTasksTable(db);
    upsertTask(db, taskRecord());
    const columns = db.prepare('PRAGMA table_info(character_tasks)').all() as Array<{ name: string }>;
    expect(columns.some((column) => column.name === 'pipeline_id')).toBe(true);
    const rows = loadRecentTasks(db, 'ch-1');
    expect(rows[0].pipelineId).toBeUndefined(); // 老任务无归属。

    // 迁移后的库能继续写归属（新功能不因旧库降级）。
    upsertTask(db, taskRecord({ pipelineId: 'pipeline_9' }));
    expect(loadRecentTasks(db, 'ch-1')[0].pipelineId).toBe('pipeline_9');
    db.close();
    fs.rmSync(path.dirname(file), { recursive: true, force: true });
  });

  it('CASE 守卫：相位快照（不带 pipelineId）不抹掉已标记的归属', async () => {
    const file = makeDbPath();
    const db = await openDb(file);
    ensureCharacterTasksTable(db);
    // 站任务入列 → stamp 标记归属。
    upsertTask(db, taskRecord({ pipelineId: 'pipeline_1' }));
    // 相位快照跟上（task-service 的路径：不带 pipelineId）—— 归属不得被空串覆盖。
    upsertTask(db, taskRecord({ status: 'running', startedAt: 5 }));
    upsertTask(db, taskRecord({ status: 'completed', output: '完成', endedAt: 9 }));
    expect(loadRecentTasks(db, 'ch-1')[0]).toMatchObject({ status: 'completed', pipelineId: 'pipeline_1' });
    db.close();
    fs.rmSync(path.dirname(file), { recursive: true, force: true });
  });
});
