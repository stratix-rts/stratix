/**
 * 文件职责：agent 健康事件的 SQLite DAO（task_054）—— agent_health_events 一张表的
 *   建表 / 插入 / unhealthy 计数。**只做数据搬运**：参数绑定、行映射，不认识业务时机。
 * 表：agent_health_events(id 自增, kind, event, created_at)。
 *   event 词表 = 'online' | 'offline' | 'unhealthy'（CHECK 约束兜底）：
 *   - offline / online：health-monitor 防抖判定的掉线 / 恢复翻转（各一条审计）；
 *   - unhealthy：transport 执行期 exit 码异常（非 0 且非用户 abort），一次一条 ——
 *     「它崩过几次」的长期真相（进程内计数会随重启归零，库里这行才是审计口径）。
 * why 独立表而不是 characters 加列（task_054 规格二选一）：健康是**事件流**（时间序、
 *   可多次发生），列只能存「最后一次」，崩溃历史会被覆盖 —— 独立表按 (kind, created_at)
 *   索引，天然是审计流；characters 表也保持「角色档案」的纯粹（不掺运行时健康态）。
 * 禁止事项：
 *   1. import fs / path / electron —— 本文件不知道连接从哪来（生产 = stratix-database 单例，
 *      测试 = 内存 / 临时文件库），才能同时跑在主进程与单测里（与 task-record-dao 同纪律）；
 *   2. 认识 core / hud 类型 —— 入参形状是**纯持久化形状**（AgentHealthEventInsert）；
 *   3. 在这里定业务规则（何时插入 / 防抖判定）—— 时机与判定归 health-monitor；
 *   4. 拼 SQL 字符串 —— 一律参数绑定（?），表名常量不出现在插值里。
 *
 * 表结构与 src/stratix-database/StratixDatabase.ts 的迁移 DDL 同构（那边管 schema_version
 *   v10 迁移，这边管 IF NOT EXISTS 兜底 —— DAO 单独在测试库 / 极端旧库上也能就位）。
 *
 * @since v3.30，task_054（schema v10）。
 */

import type { SqliteDatabaseLike } from './game-save-dao';

/** agent_health_events 表名（与 StratixDatabase 的迁移 DDL 同名 —— 两处同步改）。 */
export const AGENT_HEALTH_EVENTS_TABLE = 'agent_health_events';

/** 健康事件词表（与表 CHECK 约束一致）。 */
export type PersistedAgentHealthEventKind = 'online' | 'offline' | 'unhealthy';

/** 词表导出给 IPC 校验层用（主进程拒绝表外 event，别让脏词进 CHECK 约束炸 IPC）。 */
export const PERSISTED_AGENT_HEALTH_EVENTS: readonly PersistedAgentHealthEventKind[] = [
  'online',
  'offline',
  'unhealthy',
];

/** 插入行（id / 自增归库）。 */
export interface AgentHealthEventInsert {
  /** agent 种类（AgentKind 词表的字符串 —— 存档形状不 import core 类型）。 */
  readonly kind: string;
  /** 事件类型（PersistedAgentHealthEventKind 词表）。 */
  readonly event: PersistedAgentHealthEventKind;
  /** 发生时刻（epoch ms）。 */
  readonly createdAt: number;
}

/** 建表 DDL —— 与 StratixDatabase 的 migrateAgentHealthEvents 同构，两处同步改。 */
const AGENT_HEALTH_EVENTS_DDL = `
  CREATE TABLE IF NOT EXISTS ${AGENT_HEALTH_EVENTS_TABLE} (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kind TEXT NOT NULL,
    event TEXT NOT NULL CHECK (event IN ('online', 'offline', 'unhealthy')),
    created_at INTEGER NOT NULL
  )`;

/** 就位兜底：老库 / 测试库上单独调用也能建表（幂等）。 */
export function ensureAgentHealthEventsTable(db: SqliteDatabaseLike): void {
  db.exec(AGENT_HEALTH_EVENTS_DDL);
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_agent_health_events_kind_time ON ${AGENT_HEALTH_EVENTS_TABLE}(kind, created_at)`
  );
}

/** 插入一条健康事件（append-only：本表没有 update 语义，历史就是历史）。 */
export function insertAgentHealthEvent(db: SqliteDatabaseLike, insert: AgentHealthEventInsert): void {
  ensureAgentHealthEventsTable(db);
  db.prepare(`INSERT INTO ${AGENT_HEALTH_EVENTS_TABLE} (kind, event, created_at) VALUES (?, ?, ?)`).run(
    insert.kind,
    insert.event,
    insert.createdAt
  );
}

/** 按 kind 数 unhealthy 次数（统计口；kind 缺省 = 全 kind 合计）。 */
export function countUnhealthyEvents(db: SqliteDatabaseLike, kind?: string): number {
  ensureAgentHealthEventsTable(db);
  const row = (
    kind === undefined
      ? db.prepare(`SELECT COUNT(*) AS n FROM ${AGENT_HEALTH_EVENTS_TABLE} WHERE event = 'unhealthy'`).get()
      : db
          .prepare(
            `SELECT COUNT(*) AS n FROM ${AGENT_HEALTH_EVENTS_TABLE} WHERE kind = ? AND event = 'unhealthy'`
          )
          .get(kind)
  ) as { n: number } | undefined;
  return row?.n ?? 0;
}
