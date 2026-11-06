/**
 * 夹具职责：**N7 一次性归属迁移**的临时库夹具（@since v3.3，task_203 / M2-06）。
 *
 * why 是**真库真跑**而不是 mock：N7 的全部价值在「真 SQL / 真事务 / 真唯一索引 / 真联合主键」
 *   —— mock 掉连接等于把被测对象一起 mock 掉（与 n4b-fixture.ts 同纪律）。
 *
 * 夹具内容（一次覆盖 N7 要动的全部面）：
 *   - **默认沙盒**的行：`instance_id IS NULL`（存量老行）与显式 `'wsp_sandbox'`（两种原值都要能被还原）；
 *   - **目标副本** `wsp_x`：一行**已物化**的角色（`role_id` 非空 = N6 的签名）；
 *   - **别的副本** `wsp_y`：用来验「不串副本」（迁移不该碰它）；
 *   - 任务 / 会话 / 外部凭据 / 跟随行（站位、经验事件、会话事件）。
 *
 * 破坏开关（造「前置阻断」场景）：
 *   - `unmaterializedTarget`：目标副本**没有**物化行 ⇒ N7 必须拒绝执行；
 *   - `roleConflict`：沙盒行的 `role_id` 与目标副本既有行撞车 ⇒ 复合唯一索引会拒绝；
 *   - `externalRefConflict`：目标副本已有同名的外部凭据 ⇒ 联合主键会拒绝。
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { Database } from '@/stratix-database/sqlite-adapter';

import { ensureCharacterIdMapTable } from '@/app/services/persistence/character-id-map-dao';
import { ensureExpEventsTable } from '@/app/services/persistence/exp-event-dao';
import { ensureGameSaveTables } from '@/app/services/persistence/game-save-dao';
import { ensureSessionEventsTable } from '@/app/services/persistence/session-event-dao';
import { ensureSessionExternalRefsTable } from '@/app/services/persistence/session-external-ref-dao';
import { ensureSessionsTable } from '@/app/services/persistence/session-dao';
import { ensureCharacterTasksTable } from '@/app/services/persistence/task-record-dao';

/** 目标副本（已物化）。 */
export const TARGET_INSTANCE = 'wsp_x';
/** 别的副本（用来验「不串副本」）。 */
export const OTHER_INSTANCE = 'wsp_y';
/** 默认沙盒。 */
export const SANDBOX_INSTANCE = 'wsp_sandbox';

/** 沙盒角色一（`instance_id IS NULL` = 存量老行）。 */
export const SANDBOX_CHARACTER_1 = 'character_sandbox_1';
/** 沙盒角色二（`instance_id` 显式 = 沙盒值）。 */
export const SANDBOX_CHARACTER_2 = 'character_sandbox_2';
/** 目标副本里已物化的角色（N6 物化行：id = `<roleId>_<instanceId>`，`role_id` 非空）。 */
export const TARGET_CHARACTER = 'scout_wsp_x';
/** 别的副本里的角色。 */
export const OTHER_CHARACTER = 'character_other_1';

/** 破坏开关。 */
export interface N7FixtureOptions {
  /** 目标副本**没有**物化行（⇒ N7 必须拒绝执行）。 */
  readonly unmaterializedTarget?: boolean;
  /** 沙盒角色的 `role_id` 与目标副本既有行撞车。 */
  readonly roleConflict?: boolean;
  /** 目标副本已有同名的外部会话凭据。 */
  readonly externalRefConflict?: boolean;
}

/** 夹具的落盘位置。 */
export interface N7Fixture {
  readonly dir: string;
  readonly dbPath: string;
}

/** 造一个临时目录（夹具库放这里）。 */
export function makeN7FixtureDir(prefix = 'stratix-n7-'): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

/**
 * 造一个**夹具库**（真 SQLite 文件；schema 由各 DAO 的 `ensure*` 就位 ⇒ 与生产同构）。
 */
export async function createN7FixtureDb(
  dir: string,
  options: N7FixtureOptions = {}
): Promise<N7Fixture> {
  const dbPath = path.join(dir, 'stratix.db.sqlite');
  const db = new Database(dbPath);
  await db.initialize();

  ensureGameSaveTables(db);
  ensureCharacterTasksTable(db);
  ensureSessionsTable(db);
  ensureSessionEventsTable(db);
  ensureExpEventsTable(db);
  ensureSessionExternalRefsTable(db);
  ensureCharacterIdMapTable(db);

  const now = 1700000000000;

  const insertCharacter = db.prepare(
    `INSERT INTO characters (id, name, kind, persona, level, exp, external_session_id, context_enabled, created_at, updated_at, instance_id, role_id)
     VALUES (?, ?, ?, ?, ?, ?, NULL, 1, ?, ?, ?, ?)`
  );
  // 沙盒角色一：instance_id IS NULL（存量老行的口径）。
  insertCharacter.run(
    SANDBOX_CHARACTER_1,
    '沙盒甲',
    'claude',
    '沙盒里干活的甲',
    3,
    120,
    now,
    now,
    null,
    options.roleConflict ? 'scout' : null
  );
  // 沙盒角色二：instance_id 显式 = 沙盒值（与 NULL 行语义同源、字节不同）。
  insertCharacter.run(
    SANDBOX_CHARACTER_2,
    '沙盒乙',
    'claude',
    '沙盒里干活的乙',
    1,
    0,
    now + 1,
    now + 1,
    SANDBOX_INSTANCE,
    null
  );
  // 目标副本：N6 物化行（role_id 非空 = 已物化的签名）。
  if (!options.unmaterializedTarget) {
    insertCharacter.run(
      TARGET_CHARACTER,
      '斥候',
      'claude',
      '目标项目的角色',
      1,
      0,
      now + 2,
      now + 2,
      TARGET_INSTANCE,
      'scout'
    );
  }
  // 别的副本：迁移不该碰它。
  insertCharacter.run(
    OTHER_CHARACTER,
    '别处的人',
    'claude',
    '别的副本',
    2,
    10,
    now + 3,
    now + 3,
    OTHER_INSTANCE,
    'builder'
  );

  // 站位（跟随行：主键 = character_id）。
  const insertPosition = db.prepare(
    'INSERT INTO unit_positions (character_id, x, y, updated_at, instance_id) VALUES (?, ?, ?, ?, ?)'
  );
  insertPosition.run(SANDBOX_CHARACTER_1, 10, 20, now, null);
  insertPosition.run(SANDBOX_CHARACTER_2, 30, 40, now, SANDBOX_INSTANCE);
  insertPosition.run(OTHER_CHARACTER, 50, 60, now, OTHER_INSTANCE);

  // 任务。
  const insertTask = db.prepare(
    `INSERT INTO character_tasks (id, character_id, prompt, status, output, created_at, instance_id)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  );
  insertTask.run('task_sandbox_1', SANDBOX_CHARACTER_1, '沙盒活一', 'completed', 'done', now, null);
  insertTask.run(
    'task_sandbox_2',
    SANDBOX_CHARACTER_2,
    '沙盒活二',
    'failed',
    'boom',
    now + 1,
    SANDBOX_INSTANCE
  );
  insertTask.run('task_other_1', OTHER_CHARACTER, '别处的活', 'completed', 'done', now + 2, OTHER_INSTANCE);

  // 会话（participants 是 JSON blob：角色参与者 + 非角色参与者）。
  const insertSession = db.prepare(
    `INSERT INTO sessions (id, kind, title, participants, status, ref_id, created_at, last_event_at, event_count, instance_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  insertSession.run(
    'session_sandbox_1',
    'character_chat',
    '沙盒甲的对话',
    JSON.stringify([SANDBOX_CHARACTER_1]),
    'closed',
    null,
    now,
    now,
    2,
    null
  );
  insertSession.run(
    'session_sandbox_2',
    'shell_link',
    'CLI 链接会话',
    JSON.stringify(['link_abc']),
    'closed',
    null,
    now + 1,
    now + 1,
    1,
    SANDBOX_INSTANCE
  );
  insertSession.run(
    'session_other_1',
    'peer_chat',
    '别处的互聊',
    JSON.stringify([OTHER_CHARACTER]),
    'closed',
    null,
    now + 2,
    now + 2,
    1,
    OTHER_INSTANCE
  );

  // 会话事件（跟随行：主键 = (session_id, seq)）。
  const insertEvent = db.prepare(
    'INSERT INTO session_events (session_id, seq, type, payload, created_at, instance_id) VALUES (?, ?, ?, ?, ?, ?)'
  );
  insertEvent.run('session_sandbox_1', 0, 'message', '{}', now, null);
  insertEvent.run('session_sandbox_1', 1, 'message', '{}', now + 1, SANDBOX_INSTANCE);
  insertEvent.run('session_other_1', 0, 'message', '{}', now + 2, OTHER_INSTANCE);

  // 经验事件（跟随行）。
  const insertExp = db.prepare(
    'INSERT INTO exp_events (character_id, delta, reason, level, created_at, instance_id) VALUES (?, ?, ?, ?, ?, ?)'
  );
  insertExp.run(SANDBOX_CHARACTER_1, 20, 'task_completed', 3, now, null);
  insertExp.run(SANDBOX_CHARACTER_2, 5, 'chat_round', 1, now + 1, SANDBOX_INSTANCE);

  // 外部会话凭据（联合键 (external_session_id, instance_id)）。
  const insertRef = db.prepare(
    `INSERT INTO session_external_refs (external_session_id, instance_id, character_id, session_id, created_at)
     VALUES (?, ?, ?, ?, ?)`
  );
  insertRef.run('ext_sandbox_1', SANDBOX_INSTANCE, SANDBOX_CHARACTER_1, 'session_sandbox_1', now);
  if (options.externalRefConflict) {
    insertRef.run('ext_sandbox_1', TARGET_INSTANCE, SANDBOX_CHARACTER_1, 'session_sandbox_1', now + 1);
  }

  db.save();
  db.close();
  return { dir, dbPath };
}

/** 一行的原始 `instance_id` 值（`null` = 那一列本来就是 NULL）。 */
export type RawInstanceId = string | null;

/** 读某张表的 `行标识 → 原始 instance_id` 映射（测试断言用）。 */
export function readInstanceIds(
  db: Database,
  table: string,
  keyExpression: string
): Map<string, RawInstanceId> {
  const rows = db
    .prepare(`SELECT ${keyExpression} AS row_key, instance_id FROM ${table}`)
    .all() as Array<{ row_key?: unknown; instance_id?: unknown }>;
  const map = new Map<string, RawInstanceId>();
  for (const row of rows) {
    const key = String(row.row_key);
    const value = row.instance_id === null || row.instance_id === undefined ? null : String(row.instance_id);
    map.set(key, value);
  }
  return map;
}

/** 读 `character_id_map` 的全部行（测试断言用）。 */
export function readCharacterIdMap(
  db: Database
): Array<{ old_id: string; new_id: string; instance_id: string; created_at: number }> {
  const rows = db
    .prepare('SELECT old_id, new_id, instance_id, created_at FROM character_id_map ORDER BY old_id')
    .all() as Array<Record<string, unknown>>;
  return rows.map((row) => ({
    old_id: String(row.old_id),
    new_id: String(row.new_id),
    instance_id: String(row.instance_id),
    created_at: Number(row.created_at),
  }));
}

/** 读 N7 台账的全部行（测试断言用）。 */
export function readAttributionLedger(
  db: Database
): Array<{
  row_kind: string;
  row_id: string;
  original_instance_id: RawInstanceId;
  source_instance_id: string;
  target_instance_id: string;
}> {
  const rows = db
    .prepare(
      `SELECT row_kind, row_id, original_instance_id, source_instance_id, target_instance_id
         FROM instance_attribution_map ORDER BY row_kind, row_id`
    )
    .all() as Array<Record<string, unknown>>;
  return rows.map((row) => ({
    row_kind: String(row.row_kind),
    row_id: String(row.row_id),
    original_instance_id:
      row.original_instance_id === null || row.original_instance_id === undefined
        ? null
        : String(row.original_instance_id),
    source_instance_id: String(row.source_instance_id),
    target_instance_id: String(row.target_instance_id),
  }));
}
