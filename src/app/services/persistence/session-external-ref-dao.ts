/**
 * 文件职责：**外部会话引用表** `session_external_refs` 的 SQLite DAO
 *   （@since v3.3，task_200 / M2-03）—— design §1.3.2 步 **N4b-1**。
 *
 * 权威依据：docs/DESIGN-project-map.md §1.3.2「`externalSessionId` 的处置（R1-40）」
 *   + §3.4 **R3**（chat / 互聊会话不得跨副本续发）：
 *
 * ```sql
 * CREATE TABLE IF NOT EXISTS session_external_refs (
 *   external_session_id TEXT NOT NULL,
 *   instance_id         TEXT NOT NULL,
 *   character_id        TEXT,
 *   session_id          TEXT,
 *   created_at          INTEGER NOT NULL,
 *   PRIMARY KEY (external_session_id, instance_id)   -- ← 联合键：R3 的判据
 * );
 * ```
 *
 * why 独立成表（裁决方案 b）：`externalSessionId` 是 **CLI 侧的 resume 凭据**，
 *   与角色行 id **无绑定关系** ⇒ N4b 重写 `characters.id` 时它不会跟着变
 *   ⇒ 「按角色找外部会话」与「按外部会话 id 找角色」两套 key 的对应关系会断裂。
 *   独立成表后：**id 重写与副本归属彻底解耦**。
 *
 * why 主键是 `(external_session_id, instance_id)` 联合键（R3 的判据）：
 *   切副本后 B 副本查 `(extId, B)` **查不到** ⇒ resume 不可能。
 *   联合键让「同一个外部会话 id 在两个副本里各有一条凭据」在库层面就被禁止
 *   （这正是 §3.4 要防的「跨副本携带上下文」）。
 *
 * why `instance_id` 是 NOT NULL（不是可空）：本表没有「NULL = 默认沙盒」的旧行语义 ——
 *   默认沙盒有自己的真实 id（`DEFAULT_INSTANCE_ID = 'wsp_sandbox'`），一律写实值。
 *   （与 `character_id_map` 的同款口径 —— 复合主键要真的约束住唯一性，列就不能可空。）
 *
 * why `character_id` / `session_id` 是**可空的辅助列**：
 *   联合键是 (extId, instance)，它们只是「这条凭据属于谁 / 属于哪场对话」的旁注，
 *   不参与唯一性 ⇒ 角色被删 / 内部会话不存在时不该挡住凭据本身。
 *
 * why 同一 (character_id, instance_id) 只留**最新一条**凭据（写入时剪枝）：
 *   CLI 侧会话被清理后回新 id（task_055 的自愈路径）⇒ 旧凭据已作废；
 *   留着它只会让读口二义（两个 ext id 同时有效？），也让表无界增长
 *   （perf 铁律：数据不许无限增长）⇒ 剪枝后表规模上界 = 角色数 × 副本数。
 *
 * 输入：一个 better-sqlite3 兼容的连接（`SqliteDatabaseLike`：prepare + exec）
 *   + 写入侧的 `SessionExternalRefInsert`（externalSessionId / instanceId / characterId? /
 *   sessionId? / createdAt）；IPC 入口拿到的是 **unknown 原始值** ⇒ 先过
 *   `parseSessionExternalRefInsert` 的形状校验；读取侧给 (externalSessionId, instanceId) 联合键
 *   或 (characterId, instanceId)，列表给可选 instanceId 过滤。
 * 输出：
 *   - `ensureSessionExternalRefsTable` —— 建表 + `idx_session_external_refs_character` 索引（幂等）；
 *   - `recordSessionExternalRef` —— 幂等 upsert 一行，并剪掉同 (character_id, instance_id) 下
 *     其它 ext id 的旧凭据；
 *   - `findSessionExternalRef` / `findSessionExternalRefByCharacter` —— 一行或 null；
 *   - `listSessionExternalRefs` —— 行数组（按 created_at, external_session_id 排序）；
 *   - `parseSessionExternalRefInsert` —— 合法形状或 null（脏形状一律拒）。
 *
 * 禁止事项：
 *   1. 不在这里做 id 重写 —— N4b 是独立的高风险交付物（整批单事务 + 校验脚本）；
 *      本文件只提供「表 + 读写」。
 *   2. 不认识 core 实体类型 —— 入参形状是**纯持久化形状**。
 *   3. 不拼 SQL 字符串 —— 值一律参数绑定（?），表名常量不出现在插值里。
 *
 * 表结构与 src/stratix-database/StratixDatabase.ts 的迁移 DDL 同构（两处同步改）。
 */

import type { SqliteDatabaseLike } from './game-save-dao';

/** session_external_refs 表名（与 StratixDatabase 里的 DDL 同名 —— 改一处必须同步另一处）。 */
export const SESSION_EXTERNAL_REFS_TABLE = 'session_external_refs';

/** 联合键反查索引名（按角色 + 副本定位凭据 —— resume 读口的热路径）。 */
export const SESSION_EXTERNAL_REFS_CHARACTER_INDEX = 'idx_session_external_refs_character';

/**
 * session_external_refs 的一行。
 *
 * - `externalSessionId`：CLI 侧会话 id（resume 凭据本身；联合键的第一半）。
 * - `instanceId`：凭据所属副本（联合键的第二半；R3 的判据就在这一半上）。
 * - `characterId`：角色行 id（辅助列，可空）。
 * - `sessionId`：Stratix 内部会话 id（辅助列，可空 —— 没有内部会话时为 null）。
 * - `createdAt`：凭据写入时刻（epoch ms）。
 */
export interface PersistedSessionExternalRef {
  readonly externalSessionId: string;
  readonly instanceId: string;
  readonly characterId: string | null;
  readonly sessionId: string | null;
  readonly createdAt: number;
}

/** 写入侧形状（IPC 入口用；与 PersistedSessionExternalRef 同构，createdAt 由调用方给）。 */
export type SessionExternalRefInsert = PersistedSessionExternalRef;

/**
 * 建表 + 索引（IF NOT EXISTS：幂等，旧库新库都能直接调）。
 * 与 StratixDatabase 的迁移 DDL 同构；那边负责 schema_version 迁移记录，这里是 DAO 自立兜底。
 */
export function ensureSessionExternalRefsTable(db: SqliteDatabaseLike): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS ${SESSION_EXTERNAL_REFS_TABLE} (
      external_session_id TEXT NOT NULL,
      instance_id TEXT NOT NULL,
      character_id TEXT,
      session_id TEXT,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (external_session_id, instance_id)
    );
    CREATE INDEX IF NOT EXISTS ${SESSION_EXTERNAL_REFS_CHARACTER_INDEX}
      ON ${SESSION_EXTERNAL_REFS_TABLE}(character_id, instance_id);
  `);
}

/**
 * 写一条凭据（幂等 upsert：同一 (extId, instanceId) 重复写 ⇒ 覆盖辅助列与时间，不新增行）。
 *
 * 剪枝：同一 (character_id, instance_id) 下的**其它** ext id 一并删掉
 *   （旧凭据已作废 —— CLI 侧会话被清理后回新 id；见文件头「为什么只留最新一条」）。
 *
 * why 先插后删：插失败时旧凭据还在（resume 仍可用，只是可能指向已被 CLI 清理的会话 ——
 *   那是 task_055 已有的自愈路径，不是数据丢失）；反过来先删后插，插失败就**凭据全丢**。
 */
export function recordSessionExternalRef(db: SqliteDatabaseLike, insert: SessionExternalRefInsert): void {
  ensureSessionExternalRefsTable(db);
  db.prepare(
    `INSERT INTO ${SESSION_EXTERNAL_REFS_TABLE}
       (external_session_id, instance_id, character_id, session_id, created_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(external_session_id, instance_id) DO UPDATE SET
       character_id = excluded.character_id,
       session_id = excluded.session_id,
       created_at = excluded.created_at`
  ).run(
    insert.externalSessionId,
    insert.instanceId,
    insert.characterId,
    insert.sessionId,
    insert.createdAt
  );
  if (insert.characterId === null) return;
  db.prepare(
    `DELETE FROM ${SESSION_EXTERNAL_REFS_TABLE}
       WHERE character_id = ? AND instance_id = ? AND external_session_id <> ?`
  ).run(insert.characterId, insert.instanceId, insert.externalSessionId);
}

/**
 * 联合键查找（R3 的判据原语）：按 (externalSessionId, instanceId) 命中一行。
 *
 * 切副本后用**别的** instanceId 查同一 extId ⇒ 查不到 ⇒ resume 不可能。
 */
export function findSessionExternalRef(
  db: SqliteDatabaseLike,
  externalSessionId: string,
  instanceId: string
): PersistedSessionExternalRef | null {
  const row = db
    .prepare(
      `SELECT external_session_id, instance_id, character_id, session_id, created_at
         FROM ${SESSION_EXTERNAL_REFS_TABLE}
        WHERE external_session_id = ? AND instance_id = ?`
    )
    .get(externalSessionId, instanceId) as Record<string, unknown> | undefined;
  return row ? toRecord(row) : null;
}

/**
 * 按 (character_id, instance_id) 查该角色在**本副本**的凭据（resume 读口）。
 *
 * why 要带 instance_id：R3 —— 凭据是**副本级**的；只按角色查会把别的副本的凭据
 *   捞进来 ⇒ 跨副本携带上下文（§3.4 要禁止的那件事）。
 */
export function findSessionExternalRefByCharacter(
  db: SqliteDatabaseLike,
  characterId: string,
  instanceId: string
): PersistedSessionExternalRef | null {
  const row = db
    .prepare(
      `SELECT external_session_id, instance_id, character_id, session_id, created_at
         FROM ${SESSION_EXTERNAL_REFS_TABLE}
        WHERE character_id = ? AND instance_id = ?`
    )
    .get(characterId, instanceId) as Record<string, unknown> | undefined;
  return row ? toRecord(row) : null;
}

/**
 * 列凭据（按副本过滤；不给 instanceId ⇒ 列全部）。
 *
 * why 默认沙盒也在列出的范围内：凭据表是**通用记录**（与 character_id_map 同款口径）
 *   ⇒ 查全部时不该偷偷把沙盒行藏起来。
 */
export function listSessionExternalRefs(
  db: SqliteDatabaseLike,
  instanceId?: string
): PersistedSessionExternalRef[] {
  const rows = (
    instanceId === undefined
      ? db
          .prepare(
            `SELECT external_session_id, instance_id, character_id, session_id, created_at
               FROM ${SESSION_EXTERNAL_REFS_TABLE}
              ORDER BY created_at, external_session_id`
          )
          .all()
      : db
          .prepare(
            `SELECT external_session_id, instance_id, character_id, session_id, created_at
               FROM ${SESSION_EXTERNAL_REFS_TABLE}
              WHERE instance_id = ? ORDER BY created_at, external_session_id`
          )
          .all(instanceId)
  ) as Array<Record<string, unknown>>;
  return rows.map(toRecord);
}

/**
 * IPC 入口的形状校验（主进程用）：脏形状一律拒（拒绝即回 {ok:false}，调用方只警告不阻断对话）。
 *
 * why 校验放这里而不放 IPC 层：DAO 是唯一知道「这张表要什么」的地方
 *   —— 校验规则与 DDL 同处一份，不会随 IPC 层改口径而漂移。
 */
export function parseSessionExternalRefInsert(raw: unknown): SessionExternalRefInsert | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const value = raw as Record<string, unknown>;
  const externalSessionId = value.externalSessionId;
  const instanceId = value.instanceId;
  if (typeof externalSessionId !== 'string' || externalSessionId.length === 0) return null;
  if (typeof instanceId !== 'string' || instanceId.length === 0) return null;
  const characterId = value.characterId;
  const sessionId = value.sessionId;
  const createdAt = value.createdAt;
  return {
    externalSessionId,
    instanceId,
    characterId: typeof characterId === 'string' && characterId.length > 0 ? characterId : null,
    sessionId: typeof sessionId === 'string' && sessionId.length > 0 ? sessionId : null,
    createdAt: typeof createdAt === 'number' && Number.isFinite(createdAt) ? createdAt : Date.now(),
  };
}

/**
 * 行 → 记录（纯形状映射；数值列显式转 Number，避免 sqlite 驱动返回字符串）。
 */
function toRecord(row: Record<string, unknown>): PersistedSessionExternalRef {
  return {
    externalSessionId: String(row.external_session_id),
    instanceId: String(row.instance_id),
    characterId: row.character_id === null || row.character_id === undefined ? null : String(row.character_id),
    sessionId: row.session_id === null || row.session_id === undefined ? null : String(row.session_id),
    createdAt: Number(row.created_at),
  };
}
