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
 * @since v3.12，task_033。
 */

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
  /** 外部会话 id（各家 CLI 原样透传）；未建立会话为 null。 */
  readonly externalSessionId: string | null;
  readonly createdAt: number;
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
      external_session_id TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS ${UNIT_POSITIONS_TABLE} (
      character_id TEXT PRIMARY KEY,
      x REAL NOT NULL,
      y REAL NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_characters_kind ON ${CHARACTERS_TABLE}(kind);
  `);
}

/**
 * 批量 upsert 角色档案（按 id 冲突时全字段覆盖）。
 * why 全字段覆盖而不是按列 diff：档案是 core 侧单一真相的整体快照，
 *   广播里变了哪个字段调用方不必逐个说清（少一条易漏的同步路径）。
 */
export function upsertCharacters(db: SqliteDatabaseLike, records: readonly PersistedCharacterRecord[]): void {
  const stmt = db.prepare(`
    INSERT INTO ${CHARACTERS_TABLE}
      (id, name, kind, persona, level, exp, appearance, body_type, skin_id, external_session_id, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
      updated_at = excluded.updated_at
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
      r.createdAt,
      now
    );
  }
}

/** 全量读角色档案（按创建时间升序 —— 恢复后的顺序与建档顺序一致，HUD 列表不跳变）。 */
export function loadCharacters(db: SqliteDatabaseLike): PersistedCharacterRecord[] {
  const rows = db
    .prepare(`SELECT id, name, kind, persona, level, exp, appearance, body_type, skin_id, external_session_id, created_at
              FROM ${CHARACTERS_TABLE} ORDER BY created_at ASC, id ASC`)
    .all() as Array<Record<string, unknown>>;
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
    createdAt: Number(row.created_at ?? 0),
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

/** 全量读单位站位。 */
export function loadUnitPositions(db: SqliteDatabaseLike): PersistedUnitPosition[] {
  const rows = db
    .prepare(`SELECT character_id, x, y FROM ${UNIT_POSITIONS_TABLE}`)
    .all() as Array<Record<string, unknown>>;
  return rows.map((row) => ({
    characterId: String(row.character_id),
    x: Number(row.x),
    y: Number(row.y),
  }));
}

/** 一次取齐恢复快照（渲染层 loadSnapshot 的后端）。 */
export function loadGameSnapshot(db: SqliteDatabaseLike): GameSaveSnapshot {
  return {
    characters: loadCharacters(db),
    unitPositions: loadUnitPositions(db),
  };
}
