/**
 * 集成测试：StratixDatabase 的 schema v12 迁移（exp_events 表，task_061）。
 * 两个起点各验一遍：
 *   1. 全新库 → 迁移链建出 exp_events，版本落 12；
 *   2. v11 老库（有角色 / 任务 / 对话数据、无 exp_events、版本 11）→ 新表就位、老数据零丢失、版本升 12。
 * 迁移后还要能落「来源行 + level_up 里程碑行」并被 DAO 读回 —— 迁移产物必须与
 * exp-event-dao 期望的形状一致（同 task-schema-v8 的互锁口径）。
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { Database } from '@/stratix-database/sqlite-adapter';
import { StratixDatabase } from '@/stratix-database/StratixDatabase';
import {
  ensureExpEventsTable,
  insertExpEvent,
  loadExpEventsSince,
} from '@/app/services/persistence/exp-event-dao';

async function openAndInitialize(dir: string): Promise<StratixDatabase> {
  const db = new StratixDatabase({ dataDir: dir, filename: 'game' });
  await db.init();
  db.initialize();
  return db;
}

function versionOf(raw: Database): number {
  const row = raw.prepare('SELECT MAX(version) AS v FROM schema_version').get() as { v?: number };
  return Number(row.v ?? 0);
}

describe('schema v12 迁移：exp_events 表（真实 sql.js 文件库）', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stratix-exp-v12-'));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('全新库：表就位、版本落目标 schema、DAO 直插直读', async () => {
    const db = await openAndInitialize(dir);
    const raw = db.getDatabase();

    expect(
      raw.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='exp_events'").all()
    ).toHaveLength(1);
    expect(versionOf(raw)).toBe(15); // 目标 schema 已到 v15（task_199 的 role_id / character_id_map 是其后一步，v12 的 exp_events 仍在迁移链里）

    insertExpEvent(raw, { characterId: 'ch-1', delta: 50, reason: 'task_completed', level: null, createdAt: 1 });
    insertExpEvent(raw, { characterId: 'ch-1', delta: 0, reason: 'level_up', level: 2, createdAt: 2 });
    const rows = loadExpEventsSince(raw, 'ch-1', 0);
    expect(rows).toHaveLength(2);
    expect(rows[1]).toMatchObject({ reason: 'level_up', level: 2 });
    db.close();
  });

  it('v11 老库（角色/任务/对话健在、无 exp_events）：新表补建、老数据零丢失、版本升 12', async () => {
    // 先用迁移链铺一个"老库"（版本 12 之前的老库在此用 11 号铺法表达）：
    // 直接开库 → 手工把版本压回 11、DROP exp_events，模拟 v11 起点再重跑 initialize。
    const db = await openAndInitialize(dir);
    const raw = db.getDatabase();
    raw.exec(`
      DROP TABLE exp_events;
      DELETE FROM schema_version;
      INSERT INTO schema_version (version, applied_at) VALUES (11, 0);
    `);
    // 铺老数据：角色 / 任务 / 对话各一行（跨表共存是既有能力，这里锚定"零丢失"）。
    raw.exec(`
      INSERT INTO characters (id, name, kind, persona, level, exp, context_enabled, created_at, updated_at)
        VALUES ('ch-old', '老鸦', 'codex', '老兵', 3, 77, 1, 1600000000000, 1600000000000);
      INSERT INTO character_tasks (id, character_id, prompt, status, output, created_at, artifacts, plan, pipeline_id)
        VALUES ('task_old', 'ch-old', '老任务', 'completed', '老输出', 1700000000000, '', '', '');
      INSERT INTO character_chat_messages (character_id, role, content, session_ref, created_at)
        VALUES ('ch-old', 'user', '老对话', NULL, 1700000000001);
    `);
    expect(versionOf(raw)).toBe(11);

    db.initialize(); // 版本号低于目标 → 重跑迁移链
    expect(versionOf(raw)).toBe(15); // 目标 schema 已到 v15（task_199 的 role_id / character_id_map 是其后一步，v12 的 exp_events 仍在迁移链里）
    expect(raw.prepare('SELECT COUNT(*) AS n FROM characters').get()).toMatchObject({ n: 1 });
    expect(raw.prepare('SELECT COUNT(*) AS n FROM character_tasks').get()).toMatchObject({ n: 1 });
    expect(raw.prepare('SELECT COUNT(*) AS n FROM character_chat_messages').get()).toMatchObject({ n: 1 });

    // 迁移产物可写可读（与 DAO 互锁）。
    insertExpEvent(raw, { characterId: 'ch-old', delta: 5, reason: 'chat_round', level: null, createdAt: 3 });
    expect(loadExpEventsSince(raw, 'ch-old', 0)).toHaveLength(1);
    db.close();
  });

  it('重开老文件库（已 12 版）：不再重建、索引幂等', async () => {
    const db = await openAndInitialize(dir);
    db.close();

    const reopened = await openAndInitialize(dir);
    const raw = reopened.getDatabase();
    expect(versionOf(raw)).toBe(15); // 目标 schema 已到 v15（task_199 的 role_id / character_id_map 是其后一步，v12 的 exp_events 仍在迁移链里）
    expect(
      raw.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_exp_events_character_time'").all()
    ).toHaveLength(1);
    reopened.close();
  });
});
