/**
 * 文件职责：**会话摘要**的 SQLite DAO（task_092，schema v13）—— sessions 一张表的
 *   建表 / upsert 快照 / 按 kind+status 过滤分页 / 按 id 单读。
 *   **只做数据搬运**：序列化、参数绑定、行映射。
 * 输入：一个 better-sqlite3 兼容的数据库连接（SqliteDatabaseLike）+ 持久化记录。
 * 输出：行 ↔ 记录（PersistedSessionRecord）的双向映射。
 * 禁止事项：
 *   1. import fs / path / electron —— 连接从哪来不归本文件管（生产 = stratix-database 单例，
 *      测试 = 临时文件库），才能同时跑在主进程与单测里（与 task-record-dao 同纪律）；
 *   2. 认识 core 的**写入面** —— 本文件只认 core 的**词表类型**（SessionKind / SessionStatus，
 *      type-only import，不引运行时代码）；行 ↔ 会话域的翻译归 session-persister.ts；
 *   3. 在这里定业务规则（何时写入 / 落库时机）—— 时机在 S3 的组合根接线；
 *   4. 拼 SQL 字符串插值 —— 一律参数绑定（?），表名只走常量。
 *
 * why 摘要与事件分两张表（方案 docs/SESSION-PLAN.md §3）：
 *   - sessions = **可变的当前快照**（status / last_event_at / event_count 一直在动 → 需要 upsert）；
 *   - session_events = **append-only 的历史流**（seq 会话内单调 → 只插不改，见 session-event-dao）。
 *   分开的另一个理由：读列表（会话面板）只碰摘要表，不被事件流拖慢 —— 事件可能上千条，
 *   摘要永远只有一行。
 *
 * why participants 存 JSON 串而不是建关联表：参与者是**内联的小集合**（上限
 * MAX_SESSION_PARTICIPANTS = 8，core/session/types.ts），既不需要跨会话查询，也不需要按
 * 参与者反查 —— 建关联表只会带来 join 与第三张表的维护成本（core/types.ts 的 participants
 * 本来就是 string[]，映射是恒等变换）。
 *
 * 表结构与 src/stratix-database/StratixDatabase.ts 的 migrateSessions 同构（那边管
 * schema_version v13 迁移，这边 IF NOT EXISTS 兜底 —— DAO 单独在测试库 / 极端旧库上也能就位）。
 *
 * @since v3.43，task_092（schema v13）。
 */

import type { SessionKind, SessionStatus } from '../../../core/types';

import type { SqliteDatabaseLike } from './game-save-dao';

/** sessions 表名（与 StratixDatabase 的 DDL 同名 —— 两处同步改）。 */
export const SESSIONS_TABLE = 'sessions';

/**
 * 会话 kind 词表（与 core/types.ts 的 SessionKind 一一对应）。
 *
 * why 持久化层自己持一份词表：SQL 的 CHECK 兜底与 DAO 的防御性归一都需要**运行期**的值，
 * 而 core/types.ts 只给类型（type-only import 不引运行时代码 —— core 是纯逻辑层，
 * 持久化层不该反向依赖它的运行时）。
 * 编译期对齐：下面两条赋值把两份词表锁在一起（漏一个成员即编译报错）。
 */
export const PERSISTED_SESSION_KINDS: readonly SessionKind[] = [
  'character_chat',
  'peer_chat',
  'task_run',
  'mission_run',
  'shell_link',
];

/** 会话 status 词表（与 core/types.ts 的 SessionStatus 一一对应）。 */
export const PERSISTED_SESSION_STATUSES: readonly SessionStatus[] = [
  'active',
  'idle',
  'interrupted',
  'closed',
];

/** 编译期对齐检查：词表与 core 类型必须完全一致（少了成员 → 赋值报类型错）。 */
const _KIND_ALIGNMENT: readonly SessionKind[] = PERSISTED_SESSION_KINDS;
const _STATUS_ALIGNMENT: readonly SessionStatus[] = PERSISTED_SESSION_STATUSES;
void _KIND_ALIGNMENT;
void _STATUS_ALIGNMENT;

/** sessions 的一行（会话摘要快照）。 */
export interface PersistedSessionRecord {
  readonly id: string;
  readonly kind: SessionKind;
  readonly title: string;
  /** 参与者（角色 id / agent id / clientId，视 kind 而定）。 */
  readonly participants: readonly string[];
  readonly status: SessionStatus;
  /** 关联实体 id（task_run → taskId 等）；无关联为 null。 */
  readonly refId: string | null;
  readonly createdAt: number;
  readonly lastEventAt: number;
  /** 收尾时刻；未收尾为 null。 */
  readonly closedAt: number | null;
  /** 事件计数（摘要计数；事件本体在 session_events 表）。 */
  readonly eventCount: number;
}

/**
 * 列表过滤条件（kind / status 可选；limit / offset 分页）。
 * why 不做成「全必填」：面板要「全部会话」视图（两个过滤都不给 = 不过滤）。
 */
export interface SessionListFilter {
  readonly kind?: SessionKind;
  readonly status?: SessionStatus;
  /** 条数上限；缺省 50（与聊天窗口同量级）。 */
  readonly limit?: number;
  /** 偏移；缺省 0。 */
  readonly offset?: number;
}

/** 建表 DDL —— 与 StratixDatabase 的 migrateSessions 同构，两处同步改。 */
const SESSIONS_DDL = `
  CREATE TABLE IF NOT EXISTS ${SESSIONS_TABLE} (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    title TEXT NOT NULL,
    participants TEXT NOT NULL DEFAULT '[]',
    status TEXT NOT NULL,
    ref_id TEXT,
    created_at INTEGER NOT NULL,
    last_event_at INTEGER NOT NULL,
    closed_at INTEGER,
    event_count INTEGER NOT NULL DEFAULT 0
  )`;

/**
 * 就位兜底：老库 / 测试库上单独调用也能建表（幂等）。
 * 索引按查询形状建：
 *   - (kind, status)：面板的 kind+status 组合过滤；
 *   - (created_at)：列表默认按创建时间倒序（分页 ORDER BY 走索引，不扫全表）。
 */
export function ensureSessionsTable(db: SqliteDatabaseLike): void {
  db.exec(SESSIONS_DDL);
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_sessions_kind_status ON ${SESSIONS_TABLE}(kind, status)`
  );
  db.exec(`CREATE INDEX IF NOT EXISTS idx_sessions_created_at ON ${SESSIONS_TABLE}(created_at)`);
}

/**
 * upsert 一条会话摘要（**快照语义**：会话状态一动就整体覆盖一行）。
 *
 * why upsert 而不是 insert：会话是活的（active → idle → interrupted → closed），
 * 每次状态迁移都要把最新摘要写回同一行；append-only 是事件表的事，不是摘要表的事。
 */
export function upsertSessionRecord(db: SqliteDatabaseLike, record: PersistedSessionRecord): void {
  ensureSessionsTable(db);
  db.prepare(`
    INSERT INTO ${SESSIONS_TABLE}
      (id, kind, title, participants, status, ref_id, created_at, last_event_at, closed_at, event_count)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      kind = excluded.kind,
      title = excluded.title,
      participants = excluded.participants,
      status = excluded.status,
      ref_id = excluded.ref_id,
      last_event_at = excluded.last_event_at,
      closed_at = excluded.closed_at,
      event_count = excluded.event_count
  `).run(
    record.id,
    record.kind,
    record.title,
    JSON.stringify(record.participants ?? []),
    record.status,
    record.refId ?? null,
    record.createdAt,
    record.lastEventAt,
    record.closedAt ?? null,
    record.eventCount
  );
}

/**
 * 读一条会话摘要；库里没有返回 null（**不编造**）。
 * why id 走参数绑定：id 是外部来源的字符串，拼 SQL 即注入面。
 */
export function getSessionRecord(db: SqliteDatabaseLike, id: string): PersistedSessionRecord | null {
  ensureSessionsTable(db);
  const row = db
    .prepare(
      `SELECT id, kind, title, participants, status, ref_id, created_at, last_event_at, closed_at, event_count
       FROM ${SESSIONS_TABLE}
       WHERE id = ?`
    )
    .get(id) as Record<string, unknown> | undefined;
  return row ? mapSessionRow(row) : null;
}

/**
 * 按 kind / status 过滤分页读会话摘要（**创建时间倒序** —— 最新的会话在最前）。
 *
 * why 倒序：会话面板是「最近发生过什么」的列表（用户关心正在发生和刚结束的），
 * 正序会让最老的排第一、最新的要翻到最后。
 * why 分页而不是全量：会话条数上限 MAX_SESSIONS = 200（core/types.ts），
 * 但外部 client 可能按任意 kind 过滤 —— 分页是接口纪律，不靠上限兜底。
 */
export function listSessionRecords(
  db: SqliteDatabaseLike,
  filter: SessionListFilter = {}
): PersistedSessionRecord[] {
  ensureSessionsTable(db);
  const limit = clampLimit(filter.limit);
  const offset = clampOffset(filter.offset);
  const conditions: string[] = [];
  const params: unknown[] = [];
  if (filter.kind) {
    conditions.push('kind = ?');
    params.push(filter.kind);
  }
  if (filter.status) {
    conditions.push('status = ?');
    params.push(filter.status);
  }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const rows = db
    .prepare(
      `SELECT id, kind, title, participants, status, ref_id, created_at, last_event_at, closed_at, event_count
       FROM ${SESSIONS_TABLE}
       ${where}
       ORDER BY created_at DESC, id DESC
       LIMIT ? OFFSET ?`
    )
    .all(...params, limit, offset) as Array<Record<string, unknown>>;
  return rows.map(mapSessionRow);
}

/**
 * 数一数命中过滤条件的会话总数（**不带分页**）。
 *
 * why 需要它：列表接口要报 `total`（命中总数）与 `truncated`（本页是否截断）——
 *   只取一页的行数分不清"总共就这么多"与"还有更多在下一页"。计数与取页是两句 SQL，
 *   但过滤条件共用同一套（kind / status），口径不会漂。
 *
 * @since v3.43，task_096（会话读口 / MCP session_list）。
 */
export function countSessionRecords(db: SqliteDatabaseLike, filter: SessionListFilter = {}): number {
  ensureSessionsTable(db);
  const conditions: string[] = [];
  const params: unknown[] = [];
  if (filter.kind) {
    conditions.push('kind = ?');
    params.push(filter.kind);
  }
  if (filter.status) {
    conditions.push('status = ?');
    params.push(filter.status);
  }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const row = db
    .prepare(`SELECT COUNT(*) AS n FROM ${SESSIONS_TABLE} ${where}`)
    .get(...params) as Record<string, unknown> | undefined;
  return Number(row?.n ?? 0);
}

/** limit 收紧到 [1, 200]；非数字回落缺省 50（外部输入不可信 —— 与读 API 同一纪律）。 */
function clampLimit(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 50;
  return Math.max(1, Math.min(Math.floor(value), 200));
}

/** offset 收紧到 [0, ∞)；负数按 0 处理（负偏移没有语义，退回第一页而不是报错）。 */
function clampOffset(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return 0;
  return Math.floor(value);
}

/** 行 → 记录。participants 是 JSON 串；解析失败按空数组处理（不抛 —— 读路径不该炸）。 */
function mapSessionRow(row: Record<string, unknown>): PersistedSessionRecord {
  return {
    id: String(row.id ?? ''),
    kind: normalizeKind(row.kind),
    title: String(row.title ?? ''),
    participants: parseParticipants(row.participants),
    status: normalizeStatus(row.status),
    refId: row.ref_id === null || row.ref_id === undefined ? null : String(row.ref_id),
    createdAt: Number(row.created_at ?? 0),
    lastEventAt: Number(row.last_event_at ?? 0),
    closedAt: row.closed_at === null || row.closed_at === undefined ? null : Number(row.closed_at),
    eventCount: Number(row.event_count ?? 0),
  };
}

/** kind 防御性归一：词表外（老库 / 脏行）归 'peer_chat'，不抛 —— 读路径不该因一行脏数据炸掉。 */
function normalizeKind(value: unknown): SessionKind {
  const raw = String(value ?? '');
  return (PERSISTED_SESSION_KINDS as readonly string[]).includes(raw)
    ? (raw as SessionKind)
    : 'peer_chat';
}

/** status 防御性归一：词表外归 'closed'（未知状态当作已收尾 —— 宁可少显示，不可假装在办）。 */
function normalizeStatus(value: unknown): SessionStatus {
  const raw = String(value ?? '');
  return (PERSISTED_SESSION_STATUSES as readonly string[]).includes(raw)
    ? (raw as SessionStatus)
    : 'closed';
}

/** participants JSON 串 → 数组；解析失败 / 形状不对一律归空数组。 */
function parseParticipants(value: unknown): readonly string[] {
  if (typeof value !== 'string' || value.length === 0) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is string => typeof item === 'string');
  } catch {
    return [];
  }
}
