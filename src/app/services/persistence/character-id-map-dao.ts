/**
 * 文件职责：**character id 重写映射表** `character_id_map` 的 SQLite DAO
 *   （@since v3.3，task_199 / M2-02）—— design §1.3.2 步 **N4c**。
 *
 * 权威依据：docs/DESIGN-project-map.md §1.3.2 步 N4c：
 *   建 `character_id_map(old_id, new_id, instance_id, created_at)` 表，**与数据同库、同事务**；
 *   它是 N4b（一次性 character id 重写）**唯一的回滚凭据**。
 *
 * why 落库而不是 `.stratix/state/`（R1-39 / R1-38）：
 *   `.stratix/state/` 是 gitignore 的本地态 ⇒ 机器坏了映射就没了；
 *   映射表必须与数据**同库备份、同事务写入、同寿命** ⇒ 回滚凭据和数据一起活、一起死。
 *
 * why 主键是 `(old_id, instance_id)` 复合键：
 *   N4b 之后角色 id 是 **instance 内唯一**（两种 id 格式并存：沙盒行 = 历史 id，
 *   其它 instance = `<roleId>_<instanceId>`）⇒ 映射天然带副本维度；
 *   复合键让「同一副本内一个旧 id 只映射一次」由数据库自己保证。
 *
 * why `new_id` 上建索引：
 *   回滚方向是**反向 UPDATE**（new → old）⇒ 按 new_id 反查是热路径。
 *
 * 禁止事项：
 *   1. 不在这里做 id 重写本身 —— N4b 是独立的高风险交付物（整批单事务 + 校验脚本）；
 *      本文件只提供「表 + 读写」，让 N4b 的事务能同事务写映射。
 *   2. 不认识 core 类型 —— 行映射的输入输出是纯持久化形状。
 *   3. 不拼 SQL 字符串 —— 值一律参数绑定（?），表名常量不出现在插值里。
 *
 * why 不 import game-save-dao 的 SqliteDatabaseLike：那边会 import 本文件的 ensure
 *   ⇒ 形成环（instance-scope.ts 已用同样的办法解环：本地声明结构类型）。
 */

import { type ProjectInstanceId } from '../../../core/types';

/** character_id_map 表名（与 StratixDatabase 里的 DDL 同名 —— 改一处必须同步另一处）。 */
export const CHARACTER_ID_MAP_TABLE = 'character_id_map';

/**
 * character_id_map 的一行。
 *
 * - `oldId`：重写**前**的角色行 id（历史 id）。
 * - `newId`：重写**后**的角色行 id（N4b 派生：`<roleId>_<instanceId>`）。
 * - `instanceId`：映射所属副本（N4b 只重写非默认沙盒的实例 ⇒ 这里总是具体副本 id）。
 * - `createdAt`：映射写入时刻（毫秒）。
 */
export interface PersistedCharacterIdMapRecord {
  readonly oldId: string;
  readonly newId: string;
  readonly instanceId: ProjectInstanceId;
  readonly createdAt: number;
}

/**
 * better-sqlite3 兼容的最小连接面（sql.js 适配器与 better-sqlite3 都满足）。
 * 本地声明（不 import game-save-dao）：那边 import 本文件 ⇒ 互相 import 会成环。
 */
export interface CharacterIdMapDatabase {
  prepare(sql: string): {
    run(...params: unknown[]): unknown;
    get(...params: unknown[]): unknown;
    all(...params: unknown[]): unknown[];
  };
  exec(sql: string): void;
}

/**
 * 建表 + 索引（IF NOT EXISTS：幂等，旧库新库都能直接调）。
 * 与 StratixDatabase 的 DDL 同构；那边负责 schema_version 迁移记录，这里是 DAO 自立兜底。
 */
export function ensureCharacterIdMapTable(db: CharacterIdMapDatabase): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS ${CHARACTER_ID_MAP_TABLE} (
      old_id TEXT NOT NULL,
      new_id TEXT NOT NULL,
      instance_id TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (old_id, instance_id)
    );
    CREATE INDEX IF NOT EXISTS idx_character_id_map_new ON ${CHARACTER_ID_MAP_TABLE}(new_id);
  `);
}

/**
 * 写一条映射（同事务由调用方保证 —— N4b 的整批重写就是「同事务改数据 + 同事务写映射」）。
 *
 * 幂等：同一 (old_id, instance_id) 重复写 ⇒ 覆盖 new_id / created_at，不新增行
 *   （映射表是「凭据」不是「流水」⇒ 重跑一次迁移不该堆出两条互相矛盾的凭据）。
 */
export function recordCharacterIdMapping(
  db: CharacterIdMapDatabase,
  record: PersistedCharacterIdMapRecord
): void {
  db.prepare(
    `INSERT INTO ${CHARACTER_ID_MAP_TABLE} (old_id, new_id, instance_id, created_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(old_id, instance_id) DO UPDATE SET
       new_id = excluded.new_id,
       created_at = excluded.created_at`
  ).run(record.oldId, record.newId, record.instanceId, record.createdAt);
}

/** 按旧 id + 副本查映射（正向：新 id 是怎么来的）。查不到为 null。 */
export function findCharacterIdMappingByOldId(
  db: CharacterIdMapDatabase,
  oldId: string,
  instanceId: ProjectInstanceId
): PersistedCharacterIdMapRecord | null {
  const row = db
    .prepare(
      `SELECT old_id, new_id, instance_id, created_at FROM ${CHARACTER_ID_MAP_TABLE}
       WHERE old_id = ? AND instance_id = ?`
    )
    .get(oldId, instanceId) as Record<string, unknown> | undefined;
  return row ? toRecord(row) : null;
}

/** 按新 id 查映射（反向：回滚时 new → old）。查不到为 null。 */
export function findCharacterIdMappingByNewId(
  db: CharacterIdMapDatabase,
  newId: string
): PersistedCharacterIdMapRecord | null {
  const row = db
    .prepare(
      `SELECT old_id, new_id, instance_id, created_at FROM ${CHARACTER_ID_MAP_TABLE}
       WHERE new_id = ?`
    )
    .get(newId) as Record<string, unknown> | undefined;
  return row ? toRecord(row) : null;
}

/**
 * 列映射（按副本过滤；不给 instanceId ⇒ 列全部）。
 *
 * why 默认沙盒也有可能是映射的 instance：步 N4b 只重写非默认沙盒的行，
 *   但映射表是**通用凭据** ⇒ 查全部时不能偷偷把沙盒行藏起来。
 */
export function listCharacterIdMappings(
  db: CharacterIdMapDatabase,
  instanceId?: ProjectInstanceId
): PersistedCharacterIdMapRecord[] {
  const rows = (
    instanceId === undefined
      ? db
          .prepare(
            `SELECT old_id, new_id, instance_id, created_at FROM ${CHARACTER_ID_MAP_TABLE}
             ORDER BY created_at, old_id`
          )
          .all()
      : db
          .prepare(
            `SELECT old_id, new_id, instance_id, created_at FROM ${CHARACTER_ID_MAP_TABLE}
             WHERE instance_id = ? ORDER BY created_at, old_id`
          )
          .all(instanceId)
  ) as Array<Record<string, unknown>>;
  return rows.map(toRecord);
}

/**
 * 行 → 记录（纯形状映射；数值列显式转 Number，避免 sqlite 驱动返回字符串）。
 *
 * ⚠️ 映射表里的 instance_id 是 **NOT NULL**（NOT NULL 才会让复合主键真的约束住唯一性）
 *   ⇒ 映射永远记具体副本 id，不存在「NULL = 默认沙盒」的旧行语义。
 */
function toRecord(row: Record<string, unknown>): PersistedCharacterIdMapRecord {
  return {
    oldId: String(row.old_id),
    newId: String(row.new_id),
    instanceId: String(row.instance_id) as ProjectInstanceId,
    createdAt: Number(row.created_at),
  };
}
