/**
 * 夹具职责：**N4b 一次性 id 重写**的临时库夹具（@since v3.3，task_201 / M2-04）。
 *
 * why 是**真库真跑**而不是 mock：N4b 的全部价值在「真 SQL 兼容性 / 真事务 / 真 JSON blob」
 *   —— mock 掉连接等于把被测对象一起 mock 掉（与 character-role-id-and-id-map.test.ts 同纪律）。
 *
 * 夹具内容（一次覆盖六步要动的全部面）：
 *   - `characters`：默认沙盒行（历史 id，**一律不改**）+ 其它副本行（历史 id → 派生 id）；
 *   - `unit_positions`：每个角色一行的站位（校验③的单位 id 集合）；
 *   - `character_tasks`：指向角色行的普通列引用（校验④）；
 *   - `sessions`：`participants` 是 JSON blob（角色参与者 + 非角色参与者 link id）；
 *   - `exp_events` / `character_chat_messages`：另两处角色 id 引用面（附加完整性）。
 *
 * 破坏开关（造「校验不过 / 解析失败 / 前置阻断」三种失败场景）：
 *   - `brokenParticipants`：某条会话的 participants 不是合法 JSON ⇒ 整批回滚；
 *   - `danglingTask`：某条任务指向不存在的角色 ⇒ 校验④不过 ⇒ 整批回滚；
 *   - `missingRoleId`：某个副本行没有 role_id ⇒ 派生不出 id ⇒ **前置阻断**（不动数据）。
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { Database } from '@/stratix-database/sqlite-adapter';

import { ensureCharacterChatMessagesTable } from '@/app/services/persistence/chat-history-dao';
import { ensureExpEventsTable } from '@/app/services/persistence/exp-event-dao';
import { ensureGameSaveTables } from '@/app/services/persistence/game-save-dao';
import { ensureSessionsTable } from '@/app/services/persistence/session-dao';
import { ensureCharacterTasksTable } from '@/app/services/persistence/task-record-dao';

/** 夹具里的默认沙盒角色 id（历史格式 ⇒ 迁移后必须原样保留）。 */
export const SANDBOX_CHARACTER_ID = 'character_1700000000000_1';
/** 夹具里的沙盒角色 id（instance_id 显式写沙盒值 ⇒ 与 NULL 行同义）。 */
export const SANDBOX_CHARACTER_ID_2 = 'character_1700000000000_2';
/** 副本 A（wsp_beta）里的角色 id（历史格式 ⇒ 会被重写）。 */
export const BETA_CHARACTER_ID = 'character_1700000000000_3';
/** 副本 A（wsp_beta）里的第二个角色 id。 */
export const BETA_CHARACTER_ID_2 = 'character_1700000000000_4';
/** 副本 B（wsp_gamma）里的角色 id。 */
export const GAMMA_CHARACTER_ID = 'character_1700000000000_5';

/** 派生后的 id（夹具断言用）。 */
export const BETA_DERIVED_ID = 'alpha_wsp_beta';
export const BETA_DERIVED_ID_2 = 'beta_wsp_beta';
export const GAMMA_DERIVED_ID = 'alpha_wsp_gamma';

/** 破坏开关。 */
export interface N4bFixtureOptions {
  /** 造一条 participants 坏行（非法 JSON）。 */
  readonly brokenParticipants?: boolean;
  /** 造一条指向不存在角色的任务（校验④不过）。 */
  readonly danglingTask?: boolean;
  /** 造一个没有 role_id 的副本行（前置阻断）。 */
  readonly missingRoleId?: boolean;
}

/** 夹具的落盘位置。 */
export interface N4bFixture {
  readonly dir: string;
  readonly dbPath: string;
}

/** 造一个临时目录（夹具库放这里）。 */
export function makeFixtureDir(prefix = 'stratix-n4b-'): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

/**
 * 造一个**夹具库**（真 SQLite 文件；schema 由各 DAO 的 ensure* 就位 ⇒ 与生产同构）。
 *
 * @returns 夹具的目录与库文件路径。
 */
export async function createN4bFixtureDb(
  dir: string,
  options: N4bFixtureOptions = {}
): Promise<N4bFixture> {
  const dbPath = path.join(dir, 'stratix.db.sqlite');
  const db = new Database(dbPath);
  await db.initialize();

  ensureGameSaveTables(db);
  ensureCharacterTasksTable(db);
  ensureSessionsTable(db);
  ensureExpEventsTable(db);
  ensureCharacterChatMessagesTable(db);

  const insertCharacter = db.prepare(
    `INSERT INTO characters (id, name, kind, persona, level, exp, external_session_id, context_enabled, created_at, updated_at, instance_id, role_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const now = 1700000000000;
  // 默认沙盒行（instance_id = NULL ⇒ 语义 = 默认沙盒）：id 一律不改。
  insertCharacter.run(
    SANDBOX_CHARACTER_ID,
    '沙盒甲',
    'claude',
    '',
    3,
    120,
    null,
    1,
    now,
    now,
    null,
    'alpha'
  );
  // 默认沙盒行（instance_id 显式 = 沙盒值）：同样不改。
  insertCharacter.run(
    SANDBOX_CHARACTER_ID_2,
    '沙盒乙',
    'claude',
    '',
    1,
    0,
    null,
    1,
    now + 1,
    now + 1,
    'wsp_sandbox',
    null
  );
  // 副本 wsp_beta 的两个角色。
  insertCharacter.run(
    BETA_CHARACTER_ID,
    '副本甲',
    'claude',
    '',
    5,
    400,
    null,
    1,
    now + 2,
    now + 2,
    'wsp_beta',
    'alpha'
  );
  insertCharacter.run(
    BETA_CHARACTER_ID_2,
    '副本乙',
    'claude',
    '',
    2,
    30,
    null,
    1,
    now + 3,
    now + 3,
    'wsp_beta',
    'beta'
  );
  // 副本 wsp_gamma 的一个角色。
  insertCharacter.run(
    GAMMA_CHARACTER_ID,
    '副本丙',
    'claude',
    '',
    1,
    0,
    null,
    1,
    now + 4,
    now + 4,
    'wsp_gamma',
    'alpha'
  );
  if (options.missingRoleId) {
    insertCharacter.run(
      'character_1700000000000_6',
      '副本丁',
      'claude',
      '',
      1,
      0,
      null,
      1,
      now + 5,
      now + 5,
      'wsp_delta',
      null
    );
  }

  // 站位：每个角色一行（校验③：unit_id 集合 == characters.id × PREFIX）。
  const insertPosition = db.prepare(
    'INSERT INTO unit_positions (character_id, x, y, updated_at, instance_id) VALUES (?, ?, ?, ?, ?)'
  );
  const positions: Array<[string, number, number, string | null]> = [
    [SANDBOX_CHARACTER_ID, 100, 200, null],
    [SANDBOX_CHARACTER_ID_2, 120, 220, 'wsp_sandbox'],
    [BETA_CHARACTER_ID, 300, 400, 'wsp_beta'],
    [BETA_CHARACTER_ID_2, 320, 420, 'wsp_beta'],
    [GAMMA_CHARACTER_ID, 500, 600, 'wsp_gamma'],
  ];
  for (const [characterId, x, y, instanceId] of positions) {
    insertPosition.run(characterId, x, y, now, instanceId);
  }

  // 角色任务（指向角色行的普通列）。
  const insertTask = db.prepare(
    `INSERT INTO character_tasks (id, character_id, prompt, status, output, created_at, instance_id)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  );
  insertTask.run('task_beta_1', BETA_CHARACTER_ID, '跑个活', 'completed', 'done', now, 'wsp_beta');
  insertTask.run('task_sandbox_1', SANDBOX_CHARACTER_ID, '沙盒活', 'completed', 'done', now, null);
  insertTask.run(
    'task_gamma_1',
    GAMMA_CHARACTER_ID,
    '副本活',
    'completed',
    'done',
    now,
    'wsp_gamma'
  );
  if (options.danglingTask) {
    // 指向不存在的角色 ⇒ 校验④（character_tasks 全部可解析）不过 ⇒ 整批回滚。
    insertTask.run('task_ghost_1', 'character_ghost', '幽灵活', 'completed', 'done', now, 'wsp_beta');
  }

  // 会话（participants 是 JSON blob）。
  const insertSession = db.prepare(
    `INSERT INTO sessions (id, kind, title, participants, status, ref_id, created_at, last_event_at, event_count, instance_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  insertSession.run(
    'session_beta_1',
    'character_chat',
    '副本甲的对话',
    JSON.stringify([BETA_CHARACTER_ID, SANDBOX_CHARACTER_ID]),
    'closed',
    null,
    now,
    now,
    3,
    'wsp_beta'
  );
  insertSession.run(
    'session_link_1',
    'shell_link',
    'CLI 链接会话',
    JSON.stringify(['link_abc']),
    'closed',
    null,
    now,
    now,
    1,
    'wsp_beta'
  );
  insertSession.run(
    'session_gamma_1',
    'peer_chat',
    '副本丙的互聊',
    JSON.stringify([GAMMA_CHARACTER_ID]),
    'closed',
    null,
    now,
    now,
    2,
    'wsp_gamma'
  );
  if (options.brokenParticipants) {
    // 坏行：不是合法 JSON ⇒ 重写时抛错 ⇒ 整批回滚。
    insertSession.run(
      'session_broken_1',
      'character_chat',
      '坏行会话',
      '{not-json',
      'closed',
      null,
      now,
      now,
      1,
      'wsp_beta'
    );
  }

  // 另两处角色 id 引用面（附加完整性）。
  const insertExp = db.prepare(
    'INSERT INTO exp_events (character_id, delta, reason, level, created_at, instance_id) VALUES (?, ?, ?, ?, ?, ?)'
  );
  insertExp.run(BETA_CHARACTER_ID, 20, 'task_completed', 5, now, 'wsp_beta');
  insertExp.run(SANDBOX_CHARACTER_ID, 10, 'chat_round', 3, now, null);

  const insertChat = db.prepare(
    'INSERT INTO character_chat_messages (character_id, role, content, session_ref, created_at) VALUES (?, ?, ?, ?, ?)'
  );
  insertChat.run(BETA_CHARACTER_ID, 'user', '在吗', 'session_beta_1', now);
  insertChat.run(SANDBOX_CHARACTER_ID, 'user', '在吗', null, now);

  db.save();
  db.close();
  return { dir, dbPath };
}

/** 读一行 characters 的 id（测试断言用）。 */
export async function readCharacterIds(dbPath: string): Promise<string[]> {
  const db = new Database(dbPath);
  await db.initialize();
  const rows = db.prepare('SELECT id FROM characters ORDER BY id').all() as Array<{ id: string }>;
  db.close();
  return rows.map((row) => String(row.id));
}
