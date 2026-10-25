/**
 * 文件职责：角色任务的 SQLite DAO（task_037）—— character_tasks 一张表的建表 / upsert / 按角色读最近 N 条。
 *   **只做数据搬运**：序列化、参数绑定、行映射。
 * 输入：一个 better-sqlite3 兼容的数据库连接（SqliteDatabaseLike）+ 持久化记录。
 * 输出：行 ↔ 记录（PersistedTaskRecord）的映射。
 * 禁止事项：
 *   1. import fs / path / electron —— 本文件不知道连接从哪来（生产 = stratix-database 单例，
 *      测试 = 内存/临时文件库），才能同时跑在主进程与单测里；
 *   2. 认识 hud / core 类型 —— 行映射的输入输出是**纯持久化形状**，
 *      「库行 ↔ CharacterTask」的翻译归调用方（task-service 的 TaskPersistRecord 与之同构）；
 *   3. 在这里定业务规则（何时写入、守门拦截）—— 时机与守门归 task-service；
 *   4. 拼 SQL 字符串 —— 一律参数绑定（?），表名常量不出现在插值里。
 *
 * why 独立表而不落 character_chat_messages（task_037 规格二选一，选独立表；表名从 tasks 调整为
 * character_tasks：v1 起已有一张 agent 平台的 tasks 表（task_id 主键），同名必撞）：
 *   任务与聊天是两条审计通道 —— 聊天是「人 ↔ 角色对话」（role 词表 / 会话回执 / 回填抽屉），
 *   任务是「派发 → 执行 → 产出」（状态机时间戳 / 全文输出 / 队列审计）。混进一张表
 *   要么给聊天表加一堆任务专用列（role 词表被撑破），要么把任务输出伪装成 assistant 消息
 *   （聊天历史回填时真假对话混流）。分离后两边各自的窗口、索引、审计语义都干净。
 *
 * 表名 character_tasks（why 不叫 tasks 见 CHARACTER_TASKS_TABLE 注释）。
 * 表结构与 src/stratix-database/StratixDatabase.ts 的 createTables/migrate 保持同构
 * （那边管 schema_version 迁移（v5），这边管 IF NOT EXISTS + 旧 CHECK 重建兜底：DAO 单独在
 * 旧库/测试库上也能就位 —— 四态 CHECK 老表必须先重建，否则 upsert cancelled 会炸约束）。
 *
 * ============ status CHECK 六态迁移（task_049，沿用 047 重建方案）============
 * @since v3.25 在五态之上扩 awaiting_approval（任务审批门）。仍走重建（CHECK 不可 ALTER）：
 *   五态表 → 临时表 character_tasks_v7（六态 CHECK + artifacts + plan 列）→ INSERT SELECT
 *   搬数据（五态都是六态子集，无冲突行；plan 列新建表缺省 ''）→ DROP → RENAME。
 *   指纹：建表 DDL 含 'awaiting_approval'；重建前置条件：artifacts 列已兑底
 *   （ensureArtifactsColumn 先行 —— INSERT SELECT 要引用它）。
 * 老库全谱：v4 四态 →（047 重建）五态 →（048 ALTER）+artifacts →（049 重建）六态+plan；
 *   v5 → 先 ALTER artifacts 再重建六态；v6 → 直接重建六态；v7 新库零成本直过。
 *
 * ============ status CHECK 五态迁移（task_047）============
 * SQLite 的 CHECK 约束不可 ALTER（既不能改也不能删），扩词表只有重建表一条路：
 *   建新表 → INSERT SELECT 搬数据 → DROP 旧表 → RENAME。选**重建时保留 CHECK（五态）**
 *   而不是干脆去掉 CHECK：词表约束是 DAO 的第一道闸（脏 status 在这里就炸，不流进
 *   loadRecentTasks 的词表归一），重建成本一次性、迁移 SQL 与建表 DDL 同构可审。
 * 老表识别：查 sqlite_master 的建表 DDL 是否已含 'cancelled'（只有 CHECK 里会出现这个词），
 *   含则跳过 —— 幂等，新库（createTables 建的五态表）零成本直过。
 *
 * @since v3.16，task_037；v3.23（task_047）status 词表增 cancelled + 旧表重建迁移；
 *   v3.24（task_048）增 artifacts 列（成果物 JSON，'' = 无；ALTER ADD 可加，无需重建）；
 *   v3.25（task_049）status 词表增 awaiting_approval + 重建迁移 + plan 列（计划草稿全文，
 *   '' = 无；随六态重建携带，六态表缺列时 ALTER ADD 兜底）；
 *   v3.26（task_050）增 aggregateTaskStatusCounts（按角色×状态 GROUP BY 聚合，
 *   派发推荐的成功率/平均耗时数据源）。
 */

import type { SqliteDatabaseLike } from './game-save-dao';

/** character_tasks 表名（与 StratixDatabase 里的 DDL 同名 —— 改一处必须同步另一处）。
 * why 不叫 tasks：tasks 表自 v1 起就是 agent 平台的任务队列（task_id 主键 / zone 形状），
 * 角色任务表对齐 character_chat_messages 的先例（character_ 前缀 = 游戏存档域），零冲突。 */
export const CHARACTER_TASKS_TABLE = 'character_tasks';

/** 任务状态词表（与表 CHECK 约束一致，即 core/types.ts 的 TaskStatus；@since v3.25 六态）。 */
export type PersistedTaskStatus =
  | 'queued'
  | 'running'
  | 'awaiting_approval'
  | 'completed'
  | 'failed'
  | 'cancelled';

/** character_tasks 表的一行。id 是 core 侧的任务 id（TEXT 主键 —— core 造 id，库不自增）。 */
export interface PersistedTaskRecord {
  readonly id: string;
  readonly characterId: string;
  readonly prompt: string;
  readonly status: PersistedTaskStatus;
  /**
   * completed=执行结果全文；failed=失败原因；queued/running=空串；
   * @since v3.25 awaiting_approval=计划全文（task_049：挂起快照的 output 落全文，便于审计直读）。
   */
  readonly output: string;
  readonly createdAt: number;
  /** 开工时间；未开工（queued 直达 failed 的守门拦截）为 null。 */
  readonly startedAt: number | null;
  /** 收尾时间；未收尾为 null。 */
  readonly endedAt: number | null;
  /**
   * 任务成果物（task_048）：parseTaskArtifacts 产出的 JSON 字符串（files + summary），
   * '' / 缺省 = 无（解析不出 / 老记录 / 非终态快照）。可选而非必填：老调用方
   * （事件快照路径）与老库行都不携带它，upsert 缺省落 ''。
   */
  readonly artifacts?: string;
  /**
   * 计划草稿全文（task_049）：awaiting_approval / 被驳回的 failed / 批准后完成的记录携带
   * （审批链路存档：驳回的计划、按哪份计划做完的都在）；'' / 缺省 = 无。
   */
  readonly plan?: string;
}

/** 词表导出给 IPC 校验层用（主进程拒绝表外 status，别让脏词进 CHECK 约束炸 IPC）。 */
export const PERSISTED_TASK_STATUSES: readonly PersistedTaskStatus[] = [
  'queued',
  'running',
  'awaiting_approval',
  'completed',
  'failed',
  'cancelled',
];

/**
 * 按角色×状态聚合的一行（task_050）：派发智能推荐的成功率/平均耗时数据源。
 * count = 该角色该相位的条数；avgDurationMs = 该相位下（ended−started）的平均值
 * （started/ended 任一为 NULL 的行被 AVG 自动排除 —— 未开工/未收尾的行没有耗时可言），
 * 无样本 = null（调用方显示「未知」，不编 0）。
 */
export interface PersistedTaskStatRow {
  readonly characterId: string;
  readonly status: PersistedTaskStatus;
  readonly count: number;
  readonly avgDurationMs: number | null;
}

/** 建表 DDL（六态 CHECK + artifacts + plan，@since v3.25 task_049）—— 与 StratixDatabase 的 DDL 同构，两处同步改。 */
const CHARACTER_TASKS_DDL = `
  CREATE TABLE IF NOT EXISTS ${CHARACTER_TASKS_TABLE} (
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
  )`;

/** 五态重建的临时表名（task_047，v4 → v5）。 */
const CHARACTER_TASKS_MIGRATION_TABLE = 'character_tasks_v5';

/** 六态重建的临时表名（task_049，五态 → 六态；沿用 047 方案）。 */
const CHARACTER_TASKS_V7_MIGRATION_TABLE = 'character_tasks_v7';

/**
 * 旧表识别（task_047）：character_tasks 的建表 DDL 里是否已含五态 CHECK。
 * 'cancelled' 只会出现在 CHECK 词表里，作为指纹足够；DDL 不存在（表还没有）返回 false，
 * 由调用方走 CREATE IF NOT EXISTS 建五态新表。
 */
function hasFiveStatusCheck(db: SqliteDatabaseLike): boolean {
  const row = db
    .prepare(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?`)
    .get(CHARACTER_TASKS_TABLE) as { sql?: string } | undefined;
  return typeof row?.sql === 'string' && row.sql.includes("'cancelled'");
}

/**
 * 四态老表 → 五态重建迁移（task_047）：SQLite 的 CHECK 不可 ALTER，只能重建表
 * （见文件头「status CHECK 五态迁移」的方案取舍）。幂等：已是五态或表不存在时 no-op。
 * 数据零丢失：INSERT SELECT 全字段搬运（老词表四态都是新词表的子集，无冲突行）。
 */
function migrateTaskStatusCheckToFive(db: SqliteDatabaseLike): void {
  const tables = db
    .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`)
    .get(CHARACTER_TASKS_TABLE) as { name?: string } | undefined;
  if (!tables?.name) return; // 表不存在：交给 ensure 的 CREATE IF NOT EXISTS 建五态新表
  if (hasFiveStatusCheck(db)) return; // 已是五态：幂等直过

  db.exec(`
    CREATE TABLE ${CHARACTER_TASKS_MIGRATION_TABLE} (
      id TEXT PRIMARY KEY,
      character_id TEXT NOT NULL,
      prompt TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'completed', 'failed', 'cancelled')),
      output TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL,
      started_at INTEGER,
      ended_at INTEGER
    );
    INSERT INTO ${CHARACTER_TASKS_MIGRATION_TABLE}
      (id, character_id, prompt, status, output, created_at, started_at, ended_at)
      SELECT id, character_id, prompt, status, output, created_at, started_at, ended_at
      FROM ${CHARACTER_TASKS_TABLE};
    DROP TABLE ${CHARACTER_TASKS_TABLE};
    ALTER TABLE ${CHARACTER_TASKS_MIGRATION_TABLE} RENAME TO ${CHARACTER_TASKS_TABLE};
    CREATE INDEX IF NOT EXISTS idx_tasks_character
      ON ${CHARACTER_TASKS_TABLE}(character_id, created_at);
  `);
}

/**
 * 旧表识别（task_049）：建表 DDL 是否已含六态 CHECK（'awaiting_approval' 指纹）。
 * 同 hasFiveStatusCheck 的口径：DDL 不存在返回 false，由调用方走 CREATE IF NOT EXISTS。
 */
function hasSixStatusCheck(db: SqliteDatabaseLike): boolean {
  const row = db
    .prepare(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?`)
    .get(CHARACTER_TASKS_TABLE) as { sql?: string } | undefined;
  return typeof row?.sql === 'string' && row.sql.includes("'awaiting_approval'");
}

/**
 * 五态表 → 六态重建迁移（task_049，沿用 047 重建方案）：SQLite 的 CHECK 不可 ALTER，
 * 扩词表只有重建一条路。**前置条件：artifacts 列已就位**（ensureArtifactsColumn 先行 ——
 * INSERT SELECT 要搬运它）。幂等：已是六态或表不存在时 no-op。数据零丢失：五态词表是
 * 六态子集；plan 列是新表才有，老行落缺省 ''。
 */
function migrateTaskStatusCheckToSix(db: SqliteDatabaseLike): void {
  const tables = db
    .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`)
    .get(CHARACTER_TASKS_TABLE) as { name?: string } | undefined;
  if (!tables?.name) return; // 表不存在：交给 ensure 的 CREATE IF NOT EXISTS 建六态新表
  if (hasSixStatusCheck(db)) return; // 已是六态：幂等直过

  db.exec(`
    CREATE TABLE ${CHARACTER_TASKS_V7_MIGRATION_TABLE} (
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
    INSERT INTO ${CHARACTER_TASKS_V7_MIGRATION_TABLE}
      (id, character_id, prompt, status, output, created_at, started_at, ended_at, artifacts)
      SELECT id, character_id, prompt, status, output, created_at, started_at, ended_at, artifacts
      FROM ${CHARACTER_TASKS_TABLE};
    DROP TABLE ${CHARACTER_TASKS_TABLE};
    ALTER TABLE ${CHARACTER_TASKS_V7_MIGRATION_TABLE} RENAME TO ${CHARACTER_TASKS_TABLE};
    CREATE INDEX IF NOT EXISTS idx_tasks_character
      ON ${CHARACTER_TASKS_TABLE}(character_id, created_at);
  `);
}

/**
 * plan 列兑底（task_049，schema v7）：六态表但缺 plan 列（手改库边角）→ ALTER ADD。
 * 与 artifacts 同理：加列不涉及 CHECK，不用重建。
 */
function ensurePlanColumn(db: SqliteDatabaseLike): void {
  const columns = db.prepare(`PRAGMA table_info(${CHARACTER_TASKS_TABLE})`).all() as Array<{
    name?: string;
  }>;
  if (columns.some((column) => column.name === 'plan')) return;
  db.exec(`ALTER TABLE ${CHARACTER_TASKS_TABLE} ADD COLUMN plan TEXT NOT NULL DEFAULT ''`);
}

/**
 * 建表 + 索引（幂等，旧库新库都能直接调）：
 * 老库全谱就位 —— 四态重建五态（047）→ CREATE IF NOT EXISTS（新库直接建六态全列表）→
 * 补 artifacts 列（048，六态重建的前置）→ 五态重建六态（049）→ 补 plan 列（兑底）。
 * 与 StratixDatabase 的 DDL 同构；那边负责 schema_version 迁移记录（v7），这里是 DAO 自立兑底。
 * upsert 语义（core 会按相位推进同一条任务：queued → running → awaiting → 终态）要求
 * id 冲突时全字段覆盖。
 */
export function ensureCharacterTasksTable(db: SqliteDatabaseLike): void {
  migrateTaskStatusCheckToFive(db);
  db.exec(`
    ${CHARACTER_TASKS_DDL};
    CREATE INDEX IF NOT EXISTS idx_tasks_character
      ON ${CHARACTER_TASKS_TABLE}(character_id, created_at);
  `);
  ensureArtifactsColumn(db);
  migrateTaskStatusCheckToSix(db);
  ensurePlanColumn(db);
}

/**
 * artifacts 列兑底（task_048，schema v6）：老表（v5 及更早建的、没有该列）→ ALTER ADD。
 * 加列不涉及 CHECK 约束（SQLite 的 ALTER ADD COLUMN 足够），不用重建表 —— 与五态迁移
 * 的重建方案不同（那边是被 CHECK 逼的）。PRAGMA 不支持参数绑定，表名是内部常量非外部输入。
 */
function ensureArtifactsColumn(db: SqliteDatabaseLike): void {
  const columns = db.prepare(`PRAGMA table_info(${CHARACTER_TASKS_TABLE})`).all() as Array<{
    name?: string;
  }>;
  if (columns.some((column) => column.name === 'artifacts')) return;
  db.exec(`ALTER TABLE ${CHARACTER_TASKS_TABLE} ADD COLUMN artifacts TEXT NOT NULL DEFAULT ''`);
}

/**
 * upsert 一条任务（按 id 冲突时全字段覆盖 —— core 的相位推进会多次写同一条任务：
 * queued 落一次、running 落一次、终态落一次（终态带全文输出））。
 */
export function upsertTask(db: SqliteDatabaseLike, record: PersistedTaskRecord): void {
  db.prepare(`
    INSERT INTO ${CHARACTER_TASKS_TABLE}
      (id, character_id, prompt, status, output, created_at, started_at, ended_at, artifacts, plan)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      status = excluded.status,
      output = excluded.output,
      started_at = excluded.started_at,
      ended_at = excluded.ended_at,
      artifacts = excluded.artifacts,
      plan = excluded.plan
  `).run(
    record.id,
    record.characterId,
    record.prompt,
    record.status,
    record.output,
    record.createdAt,
    record.startedAt,
    record.endedAt,
    record.artifacts ?? '',
    record.plan ?? ''
  );
}

/**
 * 读某角色最近 limit 条任务（按 created_at 倒序取窗口后反转为时间正序 —— 与
 * loadChatMessages 同一口径：窗口是「尾部 N 条」，顺序是「从旧到新」）。
 * limit 缺省 20（038 的队列可见性量级；聊天窗口是 50，任务没有回填流只看列表，20 够）。
 */
export function loadRecentTasks(
  db: SqliteDatabaseLike,
  characterId: string,
  limit = 20
): PersistedTaskRecord[] {
  const rows = db
    .prepare(
      `SELECT id, character_id, prompt, status, output, created_at, started_at, ended_at, artifacts, plan
       FROM ${CHARACTER_TASKS_TABLE}
       WHERE character_id = ?
       ORDER BY created_at DESC, id DESC
       LIMIT ?`
    )
    .all(characterId, limit) as Array<Record<string, unknown>>;
  return rows
    .map((row) => ({
      id: String(row.id),
      characterId: String(row.character_id),
      prompt: String(row.prompt ?? ''),
      status: (PERSISTED_TASK_STATUSES as readonly string[]).includes(String(row.status))
        ? (String(row.status) as PersistedTaskStatus)
        : 'failed', // CHECK 约束兜底：词表外的 status 理论上进不来，防御性归一不抛
      output: String(row.output ?? ''),
      createdAt: Number(row.created_at ?? 0),
      startedAt: row.started_at === null || row.started_at === undefined ? null : Number(row.started_at),
      endedAt: row.ended_at === null || row.ended_at === undefined ? null : Number(row.ended_at),
      // 老库行（v5 及以前）没有该列 → undefined（消费方口径：undefined = 无成果物，降级纯文本）。
      artifacts: typeof row.artifacts === 'string' && row.artifacts.length > 0 ? row.artifacts : undefined,
      // 计划草稿（task_049）：同 artifacts 口径 —— 老库行 / 非审批任务 → undefined。
      plan: typeof row.plan === 'string' && row.plan.length > 0 ? row.plan : undefined,
    }))
    .reverse();
}

/**
 * 按角色×状态聚合统计（@since v3.26，task_050）：SQL GROUP BY character_id, status ——
 * 派发智能推荐的历史成功率（completed/(completed+failed)）与平均完成时长（completed+failed
 * 的 ended−started 均值）的数据源。一条 SQL 出全量（角色数有限、状态六枚，行数天然有界），
 * 不在 JS 里拉全表再数 —— 统计口径交给数据库，DAO 只做行映射（与文件头「只做数据搬运」一致）。
 * 词表外 status（理论不可能，CHECK 兜底）防御性归一为 failed —— 与 loadRecentTasks 同口径不抛。
 * 空表 / 无终态行 → 空数组（调用方按「无历史」处理，不退全 0）。
 */
export function aggregateTaskStatusCounts(db: SqliteDatabaseLike): PersistedTaskStatRow[] {
  const rows = db
    .prepare(
      `SELECT character_id, status, COUNT(*) AS cnt, AVG(ended_at - started_at) AS avg_ms
       FROM ${CHARACTER_TASKS_TABLE}
       GROUP BY character_id, status`
    )
    .all() as Array<Record<string, unknown>>;
  return rows.map((row) => ({
    characterId: String(row.character_id),
    status: (PERSISTED_TASK_STATUSES as readonly string[]).includes(String(row.status))
      ? (String(row.status) as PersistedTaskStatRow['status'])
      : 'failed',
    count: Number(row.cnt ?? 0),
    avgDurationMs: row.avg_ms === null || row.avg_ms === undefined ? null : Number(row.avg_ms),
  }));
}
