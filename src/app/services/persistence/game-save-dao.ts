/**
 * 文件职责：角色档案 + 单位站位的 SQLite DAO（task_033）—— characters 与 unit_positions
 *   两张表的建表 / upsert / 全量读。**只做数据搬运**：序列化、参数绑定、行映射。
 * 输入：一个 better-sqlite3 兼容的数据库连接（SqliteDatabaseLike）+ 持久化记录。
 * 输出：行 ↔ 记录（PersistedCharacterRecord / PersistedUnitPosition）的双向映射。
 * 禁止事项：
 *   1. import fs / path / electron —— 本文件不知道连接从哪来（连接由调用方给：
 *      生产 = stratix-database 单例，测试 = 内存库），才能同时跑在主进程与单测里；
 *   2. 认识 core 类型（CharacterView 等）—— 行映射的输入输出是**纯持久化形状**，
 *      「记录 ↔ CharacterView」的翻译归 game-save-coordinator.ts（渲染侧）；
 *   3. 在这里定业务规则（等级上限、名字合法性）—— 那是 core/character 的职责；
 *   4. 拼 SQL 字符串 —— 一律参数绑定（?），表名常量不出现在插值里。
 *
 * 驱动说明（why 不直接 import stratix-database）：
 *   生产驱动是 sql.js 适配器（src/stratix-database/sqlite-adapter.ts，better-sqlite3 兼容 API）。
 *   本文件只依赖 prepare/exec 的**结构类型**，不绑定具体驱动 —— 单测可换任意兼容连接，
 *   也避免 DAO 与数据库单例的生命周期耦合（谁初始化、谁传连接）。
 *
 * 表结构与 src/stratix-database/StratixDatabase.ts 的 createTables/migrate 保持同构
 * （那边管 schema_version 迁移，这边管 IF NOT EXISTS 兜底：DAO 单独在旧库/测试库上也能就位）。
 *
 * ============ 副本维度：instance_id 列（@since v3.3，task_198 / M2-01）============
 * 两张表各加一列 `instance_id`（**可空、无 DEFAULT**）—— design §1.3.2 步 N1。
 * 口径（步 N2）：旧行 `instance_id IS NULL` **语义** = 默认沙盒实例（DEFAULT_INSTANCE_ID）；
 * 查询按 `COALESCE(instance_id, 'wsp_sandbox')` 命中，**落库不改写**旧行。
 * why 列加在 DDL 末尾：与 ALTER ADD 落地的列序一致（新建库与老库升级后形状逐列相同）。
 * why 谓词与加列不写在这里：口径只有一份出处（instance-scope.ts），本文件只调用它。
 *
 * ============ 身份维度：role_id 列 + 复合唯一索引（@since v3.3，task_199 / M2-02）============
 * `characters` 加一列 `role_id`（**可空、无 DEFAULT**）—— design §1.3.2 步 **N4a**：
 * 角色行 =「roster 里哪个角色」的**权威归属声明**（= `.stratix/roster/<role-id>.json` 的 id）。
 * 旧行 `role_id IS NULL` = **未回填**（可延后填；与 instance_id 同款的加法语义，零数据改写）。
 * 复合唯一索引 `(role_id, instance_id)`：一个副本内一个 roster 角色只能有一行角色档案。
 * 同事务的 `character_id_map` 表（步 **N4c**）由 character-id-map-dao.ts 拥有，本文件只调它的 ensure。
 *
 * ============ external_session_id 列 = 只读兼容镜像（@since v3.3，task_200 / M2-03 N4b-1）============
 * `characters.external_session_id` 退化为**只读兼容镜像**：resume 的真相搬到独立表
 *   `session_external_refs`（联合键 `(external_session_id, instance_id)` = design §3.4 R3 的判据）。
 * 本文件**照写**该列（兼容期：旧代码/旧库仍读得到），但新代码的 resume 链路不再依赖它。
 *
 * @since v3.12，task_033；v3.3（task_198）两表加 instance_id 列 + 读口按副本过滤；
 * v3.3（task_199）characters 加 role_id 列 + 复合唯一索引。
 */

import type { ProjectInstanceId } from '../../../core/types';

import { ensureCharacterIdMapTable } from './character-id-map-dao';
import {
  ensureInstanceIdColumn,
  instanceScopeWhere,
  type InstanceReadOptions,
} from './instance-scope';

/** characters 表名（与 StratixDatabase 里的 DDL 同名 —— 改一处必须同步另一处）。 */
export const CHARACTERS_TABLE = 'characters';
/** unit_positions 表名（同上）。 */
export const UNIT_POSITIONS_TABLE = 'unit_positions';

/**
 * characters 表的一行（appearance 存 JSON 串）。
 * 字段覆盖 CharacterView 全量 + createdAt：恢复时能原样重建档案。
 * bodyType 是 appearance.bodyType 的冗余列（任务规格要求）：SQL 侧可按体型查/统计，不必解 JSON。
 */
export interface PersistedCharacterRecord {
  readonly id: string;
  readonly name: string;
  /** 绑定的 agent 种类（AgentKind 原样存串）；未绑定为 null。 */
  readonly agentKind: string | null;
  readonly persona: string;
  readonly level: number;
  readonly exp: number;
  /** CharacterAppearance 的 JSON 串；无外观为 null。 */
  readonly appearanceJson: string | null;
  /** 体型（appearance.bodyType 冗余列）；无外观为 null。 */
  readonly bodyType: string | null;
  /** 皮肤 id（渲染侧资源键，core 不解析）；无皮肤为 null。 */
  readonly skinId: string | null;
  /**
   * 外部会话 id（各家 CLI 原样透传）；未建立会话为 null。
   *
   * ⚠️ @since v3.3（task_200 / N4b-1）：本字段是 `characters.external_session_id` 列的
   *   **只读兼容镜像** —— resume 的真相在 `session_external_refs` 表（联合键
   *   `(external_session_id, instance_id)` = design §3.4 R3 的判据）。
   *   写侧仍会照写（兼容期），读侧新链路不依赖它。
   */
  readonly externalSessionId: string | null;
  /**
   * 角色级上下文注入开关（@since v3.29，task_053；context_enabled 列镜像）。
   * true = 对话 / 任务首发附 <stratix-context> 块。缺省 true（开关语义的归一在
   * game-save-coordinator：CharacterView.contextEnabled 缺省 ≡ true）。
   */
  readonly contextEnabled: boolean;
  readonly createdAt: number;
  /**
   * 所属副本（`instance_id` 列镜像；@since v3.3，task_205 / M2-08）。
   *
   * why 现在写这一列：M2-01 只加了列与**读口**过滤，写侧一直不写 ⇒ 角色行永远落 NULL
   *   （按 COALESCE 归默认沙盒）⇒ 副本维度的容量判定（「这个副本有几个角色」）无从算起。
   *   本单把写侧补上：容量护栏按副本计账，前提是行**带着**归属。
   * 缺省 / null = 未归属（老行、用户手建的散兵 —— 与 core 的 CharacterView.instanceId 同款语义）。
   */
  readonly instanceId?: ProjectInstanceId | null;
}

/** unit_positions 表的一行：角色 → 战场世界坐标。 */
export interface PersistedUnitPosition {
  readonly characterId: string;
  readonly x: number;
  readonly y: number;
}

/** 启动恢复用的完整快照（loadSnapshot 一次取齐，渲染层一次 IPC 拿走）。 */
export interface GameSaveSnapshot {
  readonly characters: readonly PersistedCharacterRecord[];
  readonly unitPositions: readonly PersistedUnitPosition[];
}

/**
 * better-sqlite3 兼容的最小连接面（sql.js 适配器与 better-sqlite3 都满足）。
 * why run/get/all 返回 unknown：两个驱动的返回类型不同（RunResult 等），DAO 不消费它们。
 */
export interface SqliteDatabaseLike {
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
export function ensureGameSaveTables(db: SqliteDatabaseLike): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS ${CHARACTERS_TABLE} (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      kind TEXT,
      persona TEXT NOT NULL DEFAULT '',
      level INTEGER NOT NULL DEFAULT 1,
      exp INTEGER NOT NULL DEFAULT 0,
      appearance TEXT,
      body_type TEXT,
      skin_id TEXT,
      -- external_session_id = **只读兼容镜像**（@since v3.3，task_200 / M2-03 N4b-1）：
      --   真相在 session_external_refs 表（联合键 (external_session_id, instance_id) = design §3.4 R3 的判据）。
      --   本列保留只为兼容旧代码/旧库；新代码的 resume 链路**不读**它（design §1.3.2 R1-40 裁决方案 b）。
      --   兼容期**仍照写**（镜像写入保持，见 chat-service 的 applySession），直到旧链路退役。
      external_session_id TEXT,
      context_enabled INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      instance_id TEXT,
      role_id TEXT
    );
    CREATE TABLE IF NOT EXISTS ${UNIT_POSITIONS_TABLE} (
      character_id TEXT PRIMARY KEY,
      x REAL NOT NULL,
      y REAL NOT NULL,
      updated_at INTEGER NOT NULL,
      instance_id TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_characters_kind ON ${CHARACTERS_TABLE}(kind);
  `);
  // v9 兜底（task_053）：旧库（v8 及以前的 characters 表）补 context_enabled。
  // DEFAULT 1：存量行一律归「开」—— 缺省即开的开关语义，迁移不猜旧档案偏好。
  ensureContextEnabledColumn(db);
  // v14 兜底（task_198）：旧库补 instance_id 列（可空、无 DEFAULT ⇒ 存量行原样留 NULL）。
  ensureInstanceIdColumn(db, CHARACTERS_TABLE);
  ensureInstanceIdColumn(db, UNIT_POSITIONS_TABLE);
  // v15 兜底（task_199，步 N4a）：旧库补 role_id 列 + 复合唯一索引 (role_id, instance_id)。
  ensureRoleIdColumn(db);
  // v15 兜底（task_199，步 N4c）：character_id_map 表（角色 id 重写映射 = N4b 唯一回滚凭据）。
  ensureCharacterIdMapTable(db);
}

/**
 * 旧 characters 表补 role_id 列 + 复合唯一索引（幂等）。
 *
 * 列：可空、**无 DEFAULT** ⇒ 存量行落 NULL =「未回填」（步 N4a 的加法语义：
 * 加列不碰存量数据；回填可以延后到 roster 物化那一步）。
 *
 * 索引：`(role_id, instance_id)` 复合唯一 —— 一个副本内一个 roster 角色只能有一行角色档案。
 * SQLite 的唯一索引把 NULL 视为彼此不同 ⇒ 旧行（role_id IS NULL）之间**不冲突**
 * ⇒ 索引能在存量库上直接建成，也讓「role_id 延后回填」成立（回填时才受约束）。
 * 必须在加列**之后**建：老库的 characters 表没有 role_id 列时建索引会报「no such column」。
 */
function ensureRoleIdColumn(db: SqliteDatabaseLike): void {
  const rows = db.prepare(`PRAGMA table_info(${CHARACTERS_TABLE})`).all() as Array<Record<string, unknown>>;
  const hasColumn = rows.some((row) => String(row.name) === 'role_id');
  if (!hasColumn) {
    db.exec(`ALTER TABLE ${CHARACTERS_TABLE} ADD COLUMN role_id TEXT`);
  }
  db.exec(
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_characters_role_instance ON ${CHARACTERS_TABLE}(role_id, instance_id)`
  );
}

/** 旧 characters 表补 context_enabled 列（存在性探测 → ALTER ADD；幂等）。 */
function ensureContextEnabledColumn(db: SqliteDatabaseLike): void {
  const rows = db.prepare(`PRAGMA table_info(${CHARACTERS_TABLE})`).all() as Array<Record<string, unknown>>;
  const hasColumn = rows.some((row) => String(row.name) === 'context_enabled');
  if (!hasColumn) {
    db.exec(`ALTER TABLE ${CHARACTERS_TABLE} ADD COLUMN context_enabled INTEGER NOT NULL DEFAULT 1`);
  }
}

/**
 * 批量 upsert 角色档案（按 id 冲突时全字段覆盖）。
 * why 全字段覆盖而不是按列 diff：档案是 core 侧单一真相的整体快照，
 *   广播里变了哪个字段调用方不必逐个说清（少一条易漏的同步路径）。
 *
 * ★ `instance_id` 的写侧（@since v3.3，task_205 / M2-08）：
 *   冲突时用 `COALESCE(excluded.instance_id, <原值>)` —— 来件**没带**归属就**不清**原值。
 *   why 不能直接覆盖成 NULL：老渲染层回写的档案不带归属（M2-01 的写侧欠账），
 *   直接覆盖会把 roster 物化时写好的副本归属**抹成 NULL** ⇒ 副本维度的容量计账失准。
 */
export function upsertCharacters(db: SqliteDatabaseLike, records: readonly PersistedCharacterRecord[]): void {
  const stmt = db.prepare(`
    INSERT INTO ${CHARACTERS_TABLE}
      (id, name, kind, persona, level, exp, appearance, body_type, skin_id, external_session_id, context_enabled, created_at, updated_at, instance_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      kind = excluded.kind,
      persona = excluded.persona,
      level = excluded.level,
      exp = excluded.exp,
      appearance = excluded.appearance,
      body_type = excluded.body_type,
      skin_id = excluded.skin_id,
      external_session_id = excluded.external_session_id,
      context_enabled = excluded.context_enabled,
      updated_at = excluded.updated_at,
      instance_id = COALESCE(excluded.instance_id, ${CHARACTERS_TABLE}.instance_id)
  `);
  const now = Date.now();
  for (const r of records) {
    stmt.run(
      r.id,
      r.name,
      r.agentKind,
      r.persona,
      r.level,
      r.exp,
      r.appearanceJson,
      r.bodyType,
      r.skinId,
      r.externalSessionId,
      r.contextEnabled ? 1 : 0,
      r.createdAt,
      now,
      r.instanceId ?? null
    );
  }
}

/**
 * 全量读角色档案（按创建时间升序 —— 恢复后的顺序与建档顺序一致，HUD 列表不跳变）。
 *
 * @param options.instanceId 给了 ⇒ 只读该副本的行（`COALESCE(instance_id, 'wsp_sandbox')` 命中，
 *   步 N2 口径：默认沙盒命中旧行即 NULL 行，其它副本只命中自己标了 id 的行）。
 */
export function loadCharacters(
  db: SqliteDatabaseLike,
  options: InstanceReadOptions = {}
): PersistedCharacterRecord[] {
  const scope = instanceScopeWhere(options.instanceId);
  const rows = db
    .prepare(
      `SELECT id, name, kind, persona, level, exp, appearance, body_type, skin_id, external_session_id, context_enabled, created_at, instance_id
              FROM ${CHARACTERS_TABLE} ${scope.sql} ORDER BY created_at ASC, id ASC`
    )
    .all(...scope.params) as Array<Record<string, unknown>>;
  return rows.map((row) => ({
    id: String(row.id),
    name: String(row.name),
    agentKind: row.kind === null || row.kind === undefined ? null : String(row.kind),
    persona: String(row.persona ?? ''),
    level: Number(row.level ?? 1),
    exp: Number(row.exp ?? 0),
    appearanceJson: row.appearance === null || row.appearance === undefined ? null : String(row.appearance),
    bodyType: row.body_type === null || row.body_type === undefined ? null : String(row.body_type),
    skinId: row.skin_id === null || row.skin_id === undefined ? null : String(row.skin_id),
    externalSessionId:
      row.external_session_id === null || row.external_session_id === undefined
        ? null
        : String(row.external_session_id),
    // 旧行无列（迁移前的竞态窗口）/ 值异常都归 true —— 缺省即开。
    contextEnabled: Number(row.context_enabled ?? 1) !== 0,
    createdAt: Number(row.created_at ?? 0),
    // 归属镜像（@since v3.3，task_205）：NULL = 未归属（老行 / 手建散兵）。
    // why 缺省不写这个键：未归属行**不带** instanceId 键（与读出前的形状一致 ⇒ 往返保真）。
    ...(row.instance_id === null || row.instance_id === undefined
      ? {}
      : { instanceId: String(row.instance_id) }),
  }));
}

/** 批量 upsert 单位站位（按 characterId 冲突时覆盖坐标）。 */
export function upsertUnitPositions(
  db: SqliteDatabaseLike,
  entries: readonly PersistedUnitPosition[]
): void {
  const stmt = db.prepare(`
    INSERT INTO ${UNIT_POSITIONS_TABLE} (character_id, x, y, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(character_id) DO UPDATE SET
      x = excluded.x,
      y = excluded.y,
      updated_at = excluded.updated_at
  `);
  const now = Date.now();
  for (const p of entries) {
    stmt.run(p.characterId, p.x, p.y, now);
  }
}

/**
 * 全量读单位站位。
 *
 * @param options.instanceId 给了 ⇒ 只读该副本的行（步 N2 的 COALESCE 命中口径）。
 */
export function loadUnitPositions(
  db: SqliteDatabaseLike,
  options: InstanceReadOptions = {}
): PersistedUnitPosition[] {
  const scope = instanceScopeWhere(options.instanceId);
  const rows = db
    .prepare(`SELECT character_id, x, y FROM ${UNIT_POSITIONS_TABLE} ${scope.sql}`)
    .all(...scope.params) as Array<Record<string, unknown>>;
  return rows.map((row) => ({
    characterId: String(row.character_id),
    x: Number(row.x),
    y: Number(row.y),
  }));
}

/**
 * 一次取齐恢复快照（渲染层 loadSnapshot 的后端）。
 *
 * @param options.instanceId 给了 ⇒ 角色与站位都只取该副本的行（步 N2 口径）。
 */
export function loadGameSnapshot(
  db: SqliteDatabaseLike,
  options: InstanceReadOptions = {}
): GameSaveSnapshot {
  return {
    characters: loadCharacters(db, options),
    unitPositions: loadUnitPositions(db, options),
  };
}
