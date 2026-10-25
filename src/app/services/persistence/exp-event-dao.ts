/**
 * 文件职责：角色经验事件的 SQLite DAO（task_061，schema v12）—— exp_events 一张表的
 *   建表 / 插入 / 近窗读取 / 全场活跃度聚合。**只做数据搬运**：参数绑定、行映射，不认识业务时机。
 * 表：exp_events(id 自增, character_id, delta, reason, level, created_at)。
 *   reason 词表 = ExpSource ∪ {'level_up'}（CHECK 约束兜底）：
 *   - task_completed / task_failed / chat_round：exp.gained 事件逐条落库（delta = amount）；
 *   - level_up：升级结算时落一行（delta = 0，level = 升级后等级）—— 成长曲线的里程碑标记真相源。
 * why 独立表（task_061 规格钦点）：exp 变更此前无历史表 —— characters 只存当前 exp/level 快照，
 *   「角色怎么长大的」无处可查；exp_events 是 append-only 审计流，曲线 / 热力 / 时间线全从这取。
 * 聚合口径（aggregateCharacterActivity）：character_chat_messages ∪ character_tasks ∪ exp_events
 *   三表 UNION ALL 后按 character_id GROUP BY —— 对话条数 / 任务条数 / 经验事件数 / 最近活跃时间；
 *   再 LEFT JOIN characters 补 created_at（履历时间线的「建档」锚点）。三态各自计数而不是只取
 *   MAX(created_at) 的原因：全场总览的「活跃度」排行需要可分键（对话 / 任务 / 经验各自可见）。
 * 禁止事项：
 *   1. import fs / path / electron —— 连接从哪来不归本文件管（生产 = stratix-database 单例，
 *      测试 = 临时文件库），才能同时跑在主进程与单测里（与 task-record-dao 同纪律）；
 *   2. 认识 core / hud 类型 —— 入参形状是纯持久化形状（ExpEventInsert）；
 *   3. 在这里定业务时机（何时落库）—— 写入时机在 app/services/progression-service；
 *   4. 拼 SQL 字符串插值 —— 一律参数绑定（?），表名只走常量（DDL 里的表名常量插值是既有先例）。
 *
 * 表结构与 src/stratix-database/StratixDatabase.ts 的 migrateExpEvents 同构（那边管
 *   schema_version v12 迁移，这边 IF NOT EXISTS 兜底 —— DAO 单独在测试库 / 极端旧库上也能就位）。
 *
 * @since v3.36，task_061（schema v12）。
 */

import { ensureCharacterChatMessagesTable } from './chat-history-dao';
import { CHARACTERS_TABLE, ensureGameSaveTables, type SqliteDatabaseLike } from './game-save-dao';
import { CHARACTER_TASKS_TABLE, ensureCharacterTasksTable } from './task-record-dao';

/** exp_events 表名（与 StratixDatabase 的迁移 DDL 同名 —— 两处同步改）。 */
export const EXP_EVENTS_TABLE = 'exp_events';

/**
 * 经验事件 reason 词表（与表 CHECK 约束一致）。前三个 = core ExpSource 的字符串形态
 * （持久化形状不 import core 类型，与 AgentHealthEventInsert 的 kind 同口径）；
 * level_up 是本表新增的里程碑行（delta 恒 0，level 携带升级后等级）。
 */
export type PersistedExpEventReason = 'task_completed' | 'task_failed' | 'chat_round' | 'level_up';

/** 词表导出给 IPC 校验层用（主进程拒绝表外 reason，别让脏词进 CHECK 约束炸 IPC）。 */
export const PERSISTED_EXP_EVENT_REASONS: readonly PersistedExpEventReason[] = [
  'task_completed',
  'task_failed',
  'chat_round',
  'level_up',
];

/** 插入行（id 自增归库）。 */
export interface ExpEventInsert {
  readonly characterId: string;
  /** 经验增量：exp 来源行恒 > 0；level_up 里程碑行恒 0。 */
  readonly delta: number;
  readonly reason: PersistedExpEventReason;
  /** 升级后等级；仅 reason = 'level_up' 非 null（其余行 null）。 */
  readonly level: number | null;
  /** 发生时刻（epoch ms）。 */
  readonly createdAt: number;
}

/** 表的一行（读取形状；id 是自增 rowid）。 */
export interface PersistedExpEvent extends ExpEventInsert {
  readonly id: number;
}

/** 建表 DDL —— 与 StratixDatabase 的 migrateExpEvents 同构，两处同步改。 */
const EXP_EVENTS_DDL = `
  CREATE TABLE IF NOT EXISTS ${EXP_EVENTS_TABLE} (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    character_id TEXT NOT NULL,
    delta INTEGER NOT NULL,
    reason TEXT NOT NULL CHECK (reason IN ('task_completed', 'task_failed', 'chat_round', 'level_up')),
    level INTEGER,
    created_at INTEGER NOT NULL
  )`;

/** 就位兜底：老库 / 测试库上单独调用也能建表（幂等）。索引按「单角色近窗读取」的查询形状建。 */
export function ensureExpEventsTable(db: SqliteDatabaseLike): void {
  db.exec(EXP_EVENTS_DDL);
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_exp_events_character_time ON ${EXP_EVENTS_TABLE}(character_id, created_at)`
  );
}

/** 插入一条经验事件（append-only：本表没有 update 语义，历史就是历史）。 */
export function insertExpEvent(db: SqliteDatabaseLike, insert: ExpEventInsert): void {
  ensureExpEventsTable(db);
  db.prepare(
    `INSERT INTO ${EXP_EVENTS_TABLE} (character_id, delta, reason, level, created_at) VALUES (?, ?, ?, ?, ?)`
  ).run(insert.characterId, insert.delta, insert.reason, insert.level, insert.createdAt);
}

/**
 * 读某角色自 sinceMs 起（含）的经验事件（created_at 升序 —— 曲线 / 热力按时间正序消费）。
 * 建档前的角色（无行）返回空数组：空态由调用方渲染引导语，这里不编数据。
 */
export function loadExpEventsSince(db: SqliteDatabaseLike, characterId: string, sinceMs: number): PersistedExpEvent[] {
  ensureExpEventsTable(db);
  const rows = db
    .prepare(
      `SELECT id, character_id, delta, reason, level, created_at
       FROM ${EXP_EVENTS_TABLE}
       WHERE character_id = ? AND created_at >= ?
       ORDER BY created_at ASC, id ASC`
    )
    .all(characterId, sinceMs) as Array<Record<string, unknown>>;
  return rows.map((row) => ({
    id: Number(row.id ?? 0),
    characterId: String(row.character_id),
    delta: Number(row.delta ?? 0),
    reason: (PERSISTED_EXP_EVENT_REASONS as readonly string[]).includes(String(row.reason))
      ? (String(row.reason) as PersistedExpEventReason)
      : 'chat_round',
    level: row.level === null || row.level === undefined ? null : Number(row.level),
    createdAt: Number(row.created_at ?? 0),
  }));
}

/**
 * 全场活跃度聚合的一行（character 左表 + 三源 UNION 的计数）。
 * 空库 / 无任何活动：chatCount/taskCount/expEventCount = 0、lastActiveAt = null ——
 * 行仍然在（characters 表里有角色就有行），HUD 侧「无数据 → 引导语」的判定看计数与 lastActiveAt。
 */
export interface PersistedActivityRow {
  readonly characterId: string;
  readonly chatCount: number;
  readonly taskCount: number;
  readonly expEventCount: number;
  /** 三源里最近一次 created_at；从未活动 = null。 */
  readonly lastActiveAt: number | null;
  /** characters 表的建档时刻（履历时间线锚点）；行缺失（理论不可能，LEFT JOIN 兜底）= null。 */
  readonly createdAt: number | null;
}

/**
 * 全场活跃度聚合：character_chat_messages ∪ character_tasks ∪ exp_events 三源按角色计数。
 * why UNION ALL 而不是三张表三查再拼：一次 GROUP BY 在 SQL 侧收拢，行映射只有一份
 * （三查拼装要三份口径注释，必然漂移）。三源表可能各自缺席（极旧库）—— ensure 全部幂等就位。
 */
export function aggregateCharacterActivity(db: SqliteDatabaseLike): PersistedActivityRow[] {
  ensureGameSaveTables(db);
  ensureCharacterChatMessagesTable(db);
  ensureCharacterTasksTable(db);
  ensureExpEventsTable(db);
  const rows = db
    .prepare(
      `SELECT c.id AS character_id, c.created_at AS created_at,
              COALESCE(u.chat_count, 0) AS chat_count,
              COALESCE(u.task_count, 0) AS task_count,
              COALESCE(u.exp_count, 0) AS exp_count,
              u.last_active_at AS last_active_at
       FROM ${CHARACTERS_TABLE} c
       LEFT JOIN (
         SELECT character_id,
                SUM(CASE WHEN src = 'chat' THEN 1 ELSE 0 END) AS chat_count,
                SUM(CASE WHEN src = 'task' THEN 1 ELSE 0 END) AS task_count,
                SUM(CASE WHEN src = 'exp' THEN 1 ELSE 0 END) AS exp_count,
                MAX(at_ms) AS last_active_at
         FROM (
           SELECT character_id, created_at AS at_ms, 'chat' AS src FROM character_chat_messages
           UNION ALL
           SELECT character_id, created_at, 'task' FROM ${CHARACTER_TASKS_TABLE}
           UNION ALL
           SELECT character_id, created_at, 'exp' FROM ${EXP_EVENTS_TABLE}
         ) merged
         GROUP BY character_id
       ) u ON u.character_id = c.id
       ORDER BY c.created_at ASC, c.id ASC`
    )
    .all() as Array<Record<string, unknown>>;
  return rows.map((row) => ({
    characterId: String(row.character_id),
    chatCount: Number(row.chat_count ?? 0),
    taskCount: Number(row.task_count ?? 0),
    expEventCount: Number(row.exp_count ?? 0),
    lastActiveAt:
      row.last_active_at === null || row.last_active_at === undefined ? null : Number(row.last_active_at),
    createdAt: row.created_at === null || row.created_at === undefined ? null : Number(row.created_at),
  }));
}
