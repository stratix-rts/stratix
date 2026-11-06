/**
 * 集成测试：M2-01 的六表 instance_id 列（@since v3.3，task_198）——
 *   权威依据 docs/DESIGN-project-map.md §1.3.2 **步 N1**（六表各加 instance_id 列，nullable）
 *   + **步 N2**（旧行 `instance_id IS NULL` 语义 = 默认沙盒实例 DEFAULT_INSTANCE_ID =
 *   'wsp_sandbox'；查询按 `COALESCE(instance_id, 'wsp_sandbox')` 命中；**落库不改写**）。
 *
 * 四条验收逐条落到可执行的断言：
 *   ① 六列加好且 **nullable**（PRAGMA table_info：notnull = 0、无 DEFAULT 值）；
 *   ② COALESCE 查询语义：旧行（instance_id IS NULL）**命中默认沙盒**、对其它副本**不可见**；
 *   ③ 零数据改写：迁移 / ensure 跑完后旧行的 instance_id 仍是 NULL，其余列逐字段原样；
 *   ④ 迁移可重跑幂等（ensure 与 initialize 重跑：不炸、列不重复、行数不变）。
 *
 * 驱动：真实 sql.js 适配器 + 临时文件库（与其它 schema 测试同口径 —— 迁移逻辑的价值恰在
 *   「真 SQL 兼容性」，mock 掉连接等于把被测对象一起 mock 掉）。
 *
 * why 「老库」不手写 DDL 而是从当前 DDL 反推：v14 相对 v13 **只**多了 instance_id 一列，
 *   所以「v13 形状」= 当前建表 DDL 去掉该列。手工抄一份 DDL 会随上游演进悄悄漂移
 *   （抄漏一列 ⇒ 测试测的是一个假的老库），反推则永远等于真实的 v13 形状。
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { DEFAULT_INSTANCE_ID } from '@/core/types';
import { Database } from '@/stratix-database/sqlite-adapter';
import { StratixDatabase } from '@/stratix-database/StratixDatabase';

import {
  ensureExpEventsTable,
  insertExpEvent,
  loadExpEventsSince,
} from '@/app/services/persistence/exp-event-dao';
import {
  ensureGameSaveTables,
  loadCharacters,
  loadUnitPositions,
  upsertCharacters,
  upsertUnitPositions,
  type PersistedCharacterRecord,
} from '@/app/services/persistence/game-save-dao';
import { INSTANCE_SCOPED_TABLES } from '@/app/services/persistence/instance-scope';
import {
  appendSessionEvent,
  ensureSessionEventsTable,
  listSessionEvents,
} from '@/app/services/persistence/session-event-dao';
import { ensureSessionsTable, listSessionRecords } from '@/app/services/persistence/session-dao';
import {
  ensureCharacterTasksTable,
  loadRecentTasks,
  upsertTask,
} from '@/app/services/persistence/task-record-dao';

/** 另一个副本的 id（用来验证「旧行对非沙盒副本不可见」）。 */
const OTHER_INSTANCE = 'wsp_other';

/** DAO 层兜底的一次性建表调用（六表全建）。 */
function ensureAllTables(raw: Database): void {
  ensureGameSaveTables(raw);
  ensureCharacterTasksTable(raw);
  ensureSessionsTable(raw);
  ensureSessionEventsTable(raw);
  ensureExpEventsTable(raw);
}

function tempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

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

/** 表的列信息（PRAGMA 不支持参数绑定，表名是测试内常量）。 */
function columnInfo(raw: Database, table: string): Array<Record<string, unknown>> {
  return raw.prepare(`PRAGMA table_info(${table})`).all() as Array<Record<string, unknown>>;
}

/** 一行里的 instance_id 原值（null / 字符串）。 */
function instanceIdOf(raw: Database, table: string, where: string): unknown {
  const row = raw.prepare(`SELECT instance_id FROM ${table} WHERE ${where}`).get() as
    | { instance_id?: unknown }
    | undefined;
  return row?.instance_id ?? null;
}

/**
 * 把一张表重建成「v13 形状」：DDL 去掉 instance_id 列，其余一模一样；行数据原样搬过去。
 *
 * why 用重建（而不是手写 DDL）：v14 相对 v13 只多了 instance_id 一列 ⇒ 「v13 形状」
 *   = 当前 DDL 去掉该列。抄 DDL 会随上游演进漂移；反推永远等于真实的 v13 形状。
 */
function rebuildWithoutInstanceId(raw: Database, table: string): void {
  const row = raw.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?").get(table) as
    | { sql?: string }
    | undefined;
  const ddl = String(row?.sql ?? '');
  // 列定义后面还跟着别的列 → 连同后面的逗号一起去掉；它自己是最后一列 → 连同前面的逗号一起去掉。
  const legacyDdl = ddl.replace(/instance_id TEXT\s*,/g, '').replace(/,\s*instance_id TEXT/g, '');
  expect(legacyDdl.length).toBeGreaterThan(0);
  expect(legacyDdl).not.toMatch(/instance_id\s+TEXT/);
  raw.exec(`CREATE TABLE ${table}_legacy_v13 AS SELECT * FROM ${table}`);
  raw.exec(`DROP TABLE ${table}`);
  raw.exec(legacyDdl);
  // 搬运时跳过 instance_id（新表没有这一列）—— 其余列逐列原样搬。
  const columns = (raw.prepare(`PRAGMA table_info(${table}_legacy_v13)`).all() as Array<Record<string, unknown>>)
    .map((column) => String(column.name))
    .filter((name) => name !== 'instance_id');
  const columnList = columns.join(', ');
  raw.exec(`INSERT INTO ${table} (${columnList}) SELECT ${columnList} FROM ${table}_legacy_v13`);
  raw.exec(`DROP TABLE ${table}_legacy_v13`);
}

/** 六表全部降级成 v13 形状（无 instance_id 列），数据原样。 */
function downgradeSixTablesToV13(raw: Database): void {
  for (const table of INSTANCE_SCOPED_TABLES) {
    rebuildWithoutInstanceId(raw, table);
  }
}

function characterRecord(patch: Partial<PersistedCharacterRecord> = {}): PersistedCharacterRecord {
  return {
    id: 'character_legacy',
    name: '老鸦',
    agentKind: 'codex',
    persona: '老兵',
    level: 3,
    exp: 77,
    appearanceJson: null,
    bodyType: null,
    skinId: null,
    externalSessionId: null,
    contextEnabled: true,
    createdAt: 1000,
    ...patch,
  };
}

describe('M2-01：六表 instance_id 列 + 沙盒 COALESCE 语义（task_198）', () => {
  describe('① 六列加好且 nullable', () => {
    let dir: string;
    let raw: Database;

    beforeEach(async () => {
      dir = tempDir('stratix-instance-id-');
      raw = new Database(path.join(dir, 'save.sqlite'));
      await raw.initialize();
    });

    afterEach(() => {
      raw.close();
      fs.rmSync(dir, { recursive: true, force: true });
    });

    it('DAO 的 ensure* 之后：六张表都有 instance_id，且可空、无 DEFAULT', () => {
      ensureAllTables(raw);

      expect([...INSTANCE_SCOPED_TABLES].sort()).toEqual(
        [
          'characters',
          'character_tasks',
          'exp_events',
          'session_events',
          'sessions',
          'unit_positions',
        ].sort()
      );

      for (const table of INSTANCE_SCOPED_TABLES) {
        const column = columnInfo(raw, table).find((c) => String(c.name) === 'instance_id');
        expect(column).toBeDefined(); // 列存在
        expect(Number(column?.notnull)).toBe(0); // 可空
        expect(column?.dflt_value ?? null).toBeNull(); // 无 DEFAULT ⇒ 旧行落 NULL
      }
    });

    it('StratixDatabase 全新库：六张表都有 instance_id，且可空、无 DEFAULT', async () => {
      const db = await openAndInitialize(dir);
      const raw2 = db.getDatabase();
      for (const table of INSTANCE_SCOPED_TABLES) {
        const column = columnInfo(raw2, table).find((c) => String(c.name) === 'instance_id');
        expect(column).toBeDefined();
        expect(Number(column?.notnull)).toBe(0);
        expect(column?.dflt_value ?? null).toBeNull();
      }
      db.close();
    });
  });

  describe('② COALESCE 查询语义：旧行命中沙盒、对其它副本不可见', () => {
    let dir: string;
    let raw: Database;

    beforeEach(async () => {
      dir = tempDir('stratix-instance-scope-');
      raw = new Database(path.join(dir, 'save.sqlite'));
      await raw.initialize();
      ensureAllTables(raw);

      // 旧行：走 DAO 写入口 —— **写侧还没有 instance_id**（写侧归 M2 后续任务）
      // ⇒ 这些行落 NULL，正是「旧行 = 默认沙盒」的形状。
      upsertCharacters(raw, [characterRecord()]);
      upsertUnitPositions(raw, [{ characterId: 'character_legacy', x: 10, y: 20 }]);
      upsertTask(raw, {
        id: 'task_legacy',
        characterId: 'character_legacy',
        prompt: '老任务',
        status: 'completed',
        output: '老输出',
        createdAt: 1000,
        startedAt: null,
        endedAt: null,
      });
      raw.prepare(
        `INSERT INTO sessions (id, kind, title, participants, status, ref_id, created_at, last_event_at, closed_at, event_count)
         VALUES ('session_legacy', 'peer_chat', '老会话', '[]', 'closed', NULL, 1000, 1000, NULL, 1)`
      ).run();
      appendSessionEvent(raw, {
        sessionId: 'session_legacy',
        seq: 1,
        type: 'created',
        payload: { title: '老会话' },
        createdAt: 1000,
      });
      insertExpEvent(raw, {
        characterId: 'character_legacy',
        delta: 50,
        reason: 'task_completed',
        level: null,
        createdAt: 1000,
      });

      // 标了别的副本的行：用原生 SQL 铺（写侧还没接 instance_id）。
      raw.prepare(
        `INSERT INTO characters (id, name, kind, persona, level, exp, appearance, body_type, skin_id,
           external_session_id, context_enabled, created_at, updated_at, instance_id)
         VALUES ('character_other', '别家角色', 'codex', '', 1, 0, NULL, NULL, NULL, NULL, 1, 2000, 2000, ?)`
      ).run(OTHER_INSTANCE);
      raw.prepare(
        `INSERT INTO unit_positions (character_id, x, y, updated_at, instance_id)
         VALUES ('character_other', 30, 40, 2000, ?)`
      ).run(OTHER_INSTANCE);
      raw.prepare(
        `INSERT INTO character_tasks (id, character_id, prompt, status, output, created_at, artifacts, plan, pipeline_id, mission_id, instance_id)
         VALUES ('task_other', 'character_other', '别家任务', 'completed', '', 2000, '', '', '', NULL, ?)`
      ).run(OTHER_INSTANCE);
      raw.prepare(
        `INSERT INTO sessions (id, kind, title, participants, status, ref_id, created_at, last_event_at, closed_at, event_count, instance_id)
         VALUES ('session_other', 'peer_chat', '别家会话', '[]', 'closed', NULL, 2000, 2000, NULL, 1, ?)`
      ).run(OTHER_INSTANCE);
      raw.prepare(
        `INSERT INTO session_events (session_id, seq, type, payload, created_at, instance_id)
         VALUES ('session_other', 1, 'created', '{}', 2000, ?)`
      ).run(OTHER_INSTANCE);
      raw.prepare(
        `INSERT INTO exp_events (character_id, delta, reason, level, created_at, instance_id)
         VALUES ('character_other', 10, 'chat_round', NULL, 2000, ?)`
      ).run(OTHER_INSTANCE);
    });

    afterEach(() => {
      raw.close();
      fs.rmSync(dir, { recursive: true, force: true });
    });

    it('characters / unit_positions：沙盒命中旧行，其它副本只命中自己的行', () => {
      const sandbox = loadCharacters(raw, { instanceId: DEFAULT_INSTANCE_ID });
      expect(sandbox.map((c) => c.id)).toEqual(['character_legacy']);
      expect(
        loadUnitPositions(raw, { instanceId: DEFAULT_INSTANCE_ID }).map((p) => p.characterId)
      ).toEqual(['character_legacy']);

      const other = loadCharacters(raw, { instanceId: OTHER_INSTANCE });
      expect(other.map((c) => c.id)).toEqual(['character_other']);
      expect(loadUnitPositions(raw, { instanceId: OTHER_INSTANCE }).map((p) => p.characterId)).toEqual([
        'character_other',
      ]);

      // 不过滤 = 读全表（旧调用方零改动的口径）
      expect(loadCharacters(raw).map((c) => c.id).sort()).toEqual([
        'character_legacy',
        'character_other',
      ]);
    });

    it('character_tasks / exp_events：沙盒命中旧行，其它副本不可见', () => {
      expect(
        loadRecentTasks(raw, 'character_legacy', 20, { instanceId: DEFAULT_INSTANCE_ID }).map((t) => t.id)
      ).toEqual(['task_legacy']);
      expect(loadRecentTasks(raw, 'character_legacy', 20, { instanceId: OTHER_INSTANCE })).toHaveLength(0);
      expect(
        loadRecentTasks(raw, 'character_other', 20, { instanceId: OTHER_INSTANCE }).map((t) => t.id)
      ).toEqual(['task_other']);

      expect(
        loadExpEventsSince(raw, 'character_legacy', 0, { instanceId: DEFAULT_INSTANCE_ID })
      ).toHaveLength(1);
      expect(loadExpEventsSince(raw, 'character_legacy', 0, { instanceId: OTHER_INSTANCE })).toHaveLength(0);
      expect(loadExpEventsSince(raw, 'character_other', 0, { instanceId: OTHER_INSTANCE })).toHaveLength(1);
    });

    it('sessions / session_events：沙盒命中旧行，其它副本不可见', () => {
      expect(listSessionRecords(raw, { instanceId: DEFAULT_INSTANCE_ID }).map((s) => s.id)).toEqual([
        'session_legacy',
      ]);
      expect(listSessionRecords(raw, { instanceId: OTHER_INSTANCE }).map((s) => s.id)).toEqual([
        'session_other',
      ]);
      expect(listSessionRecords(raw)).toHaveLength(2);

      expect(listSessionEvents(raw, 'session_legacy', { instanceId: DEFAULT_INSTANCE_ID })).toHaveLength(1);
      expect(listSessionEvents(raw, 'session_legacy', { instanceId: OTHER_INSTANCE })).toHaveLength(0);
      expect(listSessionEvents(raw, 'session_other', { instanceId: OTHER_INSTANCE })).toHaveLength(1);
    });
  });

  describe('③ 零数据改写 + ④ 幂等（DAO 层兜底）', () => {
    let dir: string;
    let raw: Database;

    beforeEach(async () => {
      dir = tempDir('stratix-instance-idem-');
      raw = new Database(path.join(dir, 'save.sqlite'));
      await raw.initialize();
      ensureAllTables(raw);
      upsertCharacters(raw, [characterRecord({ id: 'ch-old', name: '老鸦', persona: '旧设定' })]);
      upsertUnitPositions(raw, [{ characterId: 'ch-old', x: 10, y: 20 }]);
      // 把六表降级成 v13 形状（无 instance_id 列）—— 模拟 task_198 之前的老库。
      downgradeSixTablesToV13(raw);
    });

    afterEach(() => {
      raw.close();
      fs.rmSync(dir, { recursive: true, force: true });
    });

    it('ensure* 之后：旧行 instance_id 仍是 NULL、其它列原样、行数不变', () => {
      ensureAllTables(raw);

      expect(instanceIdOf(raw, 'characters', "id = 'ch-old'")).toBeNull();
      expect(instanceIdOf(raw, 'unit_positions', "character_id = 'ch-old'")).toBeNull();
      expect(
        raw
          .prepare('SELECT name, kind, persona, level, exp, created_at FROM characters WHERE id = ?')
          .get('ch-old')
      ).toMatchObject({
        name: '老鸦',
        kind: 'codex',
        persona: '旧设定',
        level: 3,
        exp: 77,
        created_at: 1000,
      });
      expect(raw.prepare('SELECT x, y FROM unit_positions WHERE character_id = ?').get('ch-old')).toMatchObject({
        x: 10,
        y: 20,
      });
      expect(raw.prepare('SELECT COUNT(*) AS n FROM characters').get()).toMatchObject({ n: 1 });
    });

    it('ensure* 重跑：不炸、列不重复、行数不变', () => {
      expect(() => {
        ensureAllTables(raw);
        ensureAllTables(raw);
      }).not.toThrow();

      for (const table of INSTANCE_SCOPED_TABLES) {
        expect(columnInfo(raw, table).filter((c) => String(c.name) === 'instance_id')).toHaveLength(1);
      }
      expect(raw.prepare('SELECT COUNT(*) AS n FROM characters').get()).toMatchObject({ n: 1 });
      expect(instanceIdOf(raw, 'characters', "id = 'ch-old'")).toBeNull();
    });
  });

  describe('StratixDatabase 迁移链（schema v14）', () => {
    let dir: string;
    let opened: StratixDatabase | null = null;

    beforeEach(() => {
      dir = tempDir('stratix-instance-v14-');
    });

    afterEach(() => {
      // 先关库（定时落盘仍在跑）再删临时目录 —— 否则关闭前的异步 save 会撞上已删目录。
      try {
        opened?.close();
      } catch {
        // 已关闭：忽略。
      }
      opened = null;
      fs.rmSync(dir, { recursive: true, force: true });
    });

    it('全新库：六表都有 instance_id、版本落 14', async () => {
      const db = await openAndInitialize(dir);
      opened = db;
      const raw = db.getDatabase();
      expect(versionOf(raw)).toBe(14);
      for (const table of INSTANCE_SCOPED_TABLES) {
        expect(columnInfo(raw, table).some((c) => String(c.name) === 'instance_id')).toBe(true);
      }
      db.close();
    });

    it('v13 老库：六表补列、旧行零改写（instance_id 仍 NULL）、版本升 14', async () => {
      const db = await openAndInitialize(dir);
      opened = db;
      const raw = db.getDatabase();

      // 铺老数据（走 DAO 写入口 ⇒ 写侧不写 instance_id ⇒ 行落 NULL）。
      upsertCharacters(raw, [characterRecord({ id: 'ch-old', name: '老鸦', persona: '旧设定' })]);
      upsertTask(raw, {
        id: 'task_old',
        characterId: 'ch-old',
        prompt: '老任务',
        status: 'completed',
        output: '老输出',
        createdAt: 1000,
        startedAt: null,
        endedAt: null,
      });
      raw.prepare(
        `INSERT INTO sessions (id, kind, title, participants, status, ref_id, created_at, last_event_at, closed_at, event_count)
         VALUES ('sess_old', 'peer_chat', '老会话', '[]', 'closed', NULL, 1000, 1000, NULL, 1)`
      ).run();

      // 降级成 v13 老库：六表无 instance_id 列 + 版本号退回 13。
      downgradeSixTablesToV13(raw);
      raw.exec('DELETE FROM schema_version');
      raw.exec('INSERT INTO schema_version (version, applied_at) VALUES (13, 0)');
      expect(versionOf(raw)).toBe(13);

      db.initialize(); // 版本号低于目标 → 重跑迁移链
      expect(versionOf(raw)).toBe(14);
      for (const table of INSTANCE_SCOPED_TABLES) {
        expect(columnInfo(raw, table).some((c) => String(c.name) === 'instance_id')).toBe(true);
      }

      // 零数据改写：旧行的 instance_id 仍是 NULL（= 默认沙盒），其余字段原样。
      expect(instanceIdOf(raw, 'characters', "id = 'ch-old'")).toBeNull();
      expect(instanceIdOf(raw, 'character_tasks', "id = 'task_old'")).toBeNull();
      expect(instanceIdOf(raw, 'sessions', "id = 'sess_old'")).toBeNull();
      expect(raw.prepare('SELECT COUNT(*) AS n FROM characters').get()).toMatchObject({ n: 1 });
      expect(raw.prepare('SELECT COUNT(*) AS n FROM character_tasks').get()).toMatchObject({ n: 1 });
      expect(raw.prepare('SELECT COUNT(*) AS n FROM sessions').get()).toMatchObject({ n: 1 });
      expect(
        raw.prepare('SELECT name, persona, level, exp FROM characters WHERE id = ?').get('ch-old')
      ).toMatchObject({
        name: '老鸦',
        persona: '旧设定',
        level: 3,
        exp: 77,
      });
      expect(
        raw.prepare('SELECT prompt, status, output FROM character_tasks WHERE id = ?').get('task_old')
      ).toMatchObject({
        prompt: '老任务',
        status: 'completed',
        output: '老输出',
      });

      // 迁移产物可读：旧行按 COALESCE 命中默认沙盒，对其它副本不可见。
      expect(loadCharacters(raw, { instanceId: DEFAULT_INSTANCE_ID }).map((c) => c.id)).toEqual(['ch-old']);
      expect(loadCharacters(raw, { instanceId: OTHER_INSTANCE })).toHaveLength(0);
      db.close();
    });

    it('重开已 14 版的库：不再重建、列不重复（迁移可重复执行）', async () => {
      const first = await openAndInitialize(dir);
      first.close();

      const reopened = await openAndInitialize(dir);
      opened = reopened;
      const raw = reopened.getDatabase();
      expect(versionOf(raw)).toBe(14);
      for (const table of INSTANCE_SCOPED_TABLES) {
        expect(columnInfo(raw, table).filter((c) => String(c.name) === 'instance_id')).toHaveLength(1);
      }
      reopened.close();
    });
  });
});
