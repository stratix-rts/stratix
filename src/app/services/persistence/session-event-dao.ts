/**
 * 文件职责：**会话事件流**的 SQLite DAO（task_092，schema v13）—— session_events 一张表的
 *   建表 / 追加（append-only）/ 按会话分页读（beforeSeq 游标切片）。
 *   **只做数据搬运**：序列化、参数绑定、行映射。
 * 输入：一个 better-sqlite3 兼容的数据库连接（SqliteDatabaseLike）+ 事件行。
 * 输出：行 ↔ 事件（PersistedSessionEvent）的映射。
 * 禁止事项：
 *   1. import fs / path / electron —— 连接从哪来不归本文件管（生产 = stratix-database 单例，
 *      测试 = 临时文件库），才能同时跑在主进程与单测里（与 session-dao 同纪律）；
 *   2. 认识 hud / core 的写入面 —— 本文件只做行搬运，事件信封 ↔ 行的翻译归 session-persister.ts；
 *   3. 在这里改事件（update / delete）—— **append-only 是这张表的立表理由**：
 *      事件流是「发生过什么」的审计真相，改写即毁证；
 *   4. 拼 SQL 字符串插值 —— 一律参数绑定（?），表名只走常量。
 *
 * why 主键是 (session_id, seq) 而不是自增 id：
 *   seq 是**会话内**单调序号（core/session/types.ts 的事件信封，事件重放 / 分页都靠它定序），
 *   复合主键天然保证「同一会话内 seq 不重复」，也让「取某会话的某一段」是一次范围扫描
 *   （索引前缀命中），不需要额外的自增列去反查。
 *
 * why payload 存 JSON 串：事件载荷是**按 type 变化的形状**（core/session/types.ts 的
 *   SessionEventPayloadMap：created / message / round / interrupt / resumed / closed 各不相同）。
 *   建六张表或六组列都会把表结构钉死在事件类型上 —— 2b 加一种事件类型就要改表。
 *   JSON 串 + type 列（类型判断靠 type，不靠 payload 猜）是这里的取舍点。
 *
 * 表结构与 src/stratix-database/StratixDatabase.ts 的 migrateSessionEvents 同构
 *   （那边管 schema_version v13 迁移，这边 IF NOT EXISTS 兜底）。
 *
 * @since v3.43，task_092（schema v13）。
 */

import type { SqliteDatabaseLike } from './game-save-dao';

/** session_events 表名（与 StratixDatabase 的 DDL 同名 —— 两处同步改）。 */
export const SESSION_EVENTS_TABLE = 'session_events';

/** session_events 的一行（一条事件）。 */
export interface PersistedSessionEvent {
  readonly sessionId: string;
  /** 会话内单调序号（从 1 起）。 */
  readonly seq: number;
  /** 事件类型（created / message / round / interrupt / resumed / closed…）。 */
  readonly type: string;
  /** 事件载荷（库里是 JSON 串，读出时已解析；解析失败为 null）。 */
  readonly payload: unknown;
  readonly createdAt: number;
}

/** 追加一行事件的入参（payload 传对象；DAO 负责序列化）。 */
export interface SessionEventInsert {
  readonly sessionId: string;
  readonly seq: number;
  readonly type: string;
  readonly payload: unknown;
  readonly createdAt: number;
}

/** 事件分页参数：beforeSeq 是游标（取该序号**之前**的一段）；limit 缺省 50。 */
export interface SessionEventPageOptions {
  /** 游标：只取 seq < beforeSeq 的事件；缺省 = 取最新的一段。 */
  readonly beforeSeq?: number;
  readonly limit?: number;
}

/** 建表 DDL —— 与 StratixDatabase 的 migrateSessionEvents 同构，两处同步改。 */
const SESSION_EVENTS_DDL = `
  CREATE TABLE IF NOT EXISTS ${SESSION_EVENTS_TABLE} (
    session_id TEXT NOT NULL,
    seq INTEGER NOT NULL,
    type TEXT NOT NULL,
    payload TEXT NOT NULL DEFAULT '{}',
    created_at INTEGER NOT NULL,
    PRIMARY KEY (session_id, seq)
  )`;

/**
 * 就位兜底：老库 / 测试库上单独调用也能建表（幂等）。
 * created_at 索引按「按时间捞事件」的形状建（跨会话的时间线查询）。
 */
export function ensureSessionEventsTable(db: SqliteDatabaseLike): void {
  db.exec(SESSION_EVENTS_DDL);
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_session_events_created_at ON ${SESSION_EVENTS_TABLE}(created_at)`
  );
}

/**
 * 追加一条事件（append-only：本表没有 update / delete 语义，历史就是历史）。
 * 重复 seq 会撞主键 → 抛错（调用方不该写重复 seq；重复即 bug，不该被静默吞掉）。
 */
export function appendSessionEvent(db: SqliteDatabaseLike, event: SessionEventInsert): void {
  ensureSessionEventsTable(db);
  db.prepare(`
    INSERT INTO ${SESSION_EVENTS_TABLE} (session_id, seq, type, payload, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(
    event.sessionId,
    event.seq,
    event.type,
    serializePayload(event.payload),
    event.createdAt
  );
}

/**
 * 读某会话的一段事件（**seq 正序**：从旧到新）。
 *
 * 分页口径（与 chat-history-dao 的 beforeId 窗口同一口径）：
 *   - 缺省 beforeSeq = 取**最新** limit 条（倒序取窗口后反转为正序）；
 *   - 给了 beforeSeq = 取该游标**之前**的 limit 条（向前翻页），同样返回正序。
 *
 * why 返回正序：历史抽屉按时间正序回填（与 loadChatMessages 同一口径）；
 *   窗口是「尾部 N 条」，方向是「从旧到新」—— 两件事分开说，别混。
 */
export function listSessionEvents(
  db: SqliteDatabaseLike,
  sessionId: string,
  options: SessionEventPageOptions = {}
): PersistedSessionEvent[] {
  ensureSessionEventsTable(db);
  const limit = clampLimit(options.limit);
  const beforeSeq =
    typeof options.beforeSeq === 'number' && Number.isFinite(options.beforeSeq)
      ? Math.floor(options.beforeSeq)
      : null;
  const rows = db
    .prepare(
      `SELECT session_id, seq, type, payload, created_at
       FROM ${SESSION_EVENTS_TABLE}
       WHERE session_id = ?${beforeSeq === null ? '' : ' AND seq < ?'}
       ORDER BY seq DESC
       LIMIT ?`
    )
    .all(...(beforeSeq === null ? [sessionId, limit] : [sessionId, beforeSeq, limit])) as Array<
    Record<string, unknown>
  >;
  // DESC 取窗口后反转为正序：查询按 seq 切片，展示始终「从旧到新」。
  return rows.map(mapEventRow).reverse();
}

/** limit 收紧到 [1, 200]；非数字回落缺省 50（外部输入不可信）。 */
function clampLimit(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 50;
  return Math.max(1, Math.min(Math.floor(value), 200));
}

/** 载荷序列化：对象 / 数组 → JSON 串；其余原样转字符串（绝不留 undefined 撞 NOT NULL）。 */
function serializePayload(payload: unknown): string {
  if (typeof payload === 'string') return payload;
  try {
    return JSON.stringify(payload ?? {});
  } catch {
    // 循环引用 / 不可序列化的载荷：不丢事件，退化成空对象（payload 只是附加信息）。
    return '{}';
  }
}

/** 行 → 事件。payload 解析失败为 null（不抛 —— 读路径不该因一行脏数据炸掉）。 */
function mapEventRow(row: Record<string, unknown>): PersistedSessionEvent {
  return {
    sessionId: String(row.session_id ?? ''),
    seq: Number(row.seq ?? 0),
    type: String(row.type ?? ''),
    payload: parsePayload(row.payload),
    createdAt: Number(row.created_at ?? 0),
  };
}

/** payload JSON 串 → 值；解析失败 / 非串返回 null。 */
function parsePayload(value: unknown): unknown {
  if (typeof value !== 'string' || value.length === 0) return null;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}
