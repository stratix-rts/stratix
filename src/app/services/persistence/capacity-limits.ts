/**
 * 文件职责：**落库层三池的容量口径**（@since v3.3，task_205 / M2-08）——
 *   计数 / 判定 / 写入护栏 / 从属行随行清理 / 归档行选取。
 *
 * 权威依据：docs/DESIGN-project-map.md §1.4 **M2 行（右列：落库表跨 instance 总量上限）**
 *   ① `characters`：全局上限 `MAX_CHARACTERS_TOTAL` + 每 instance 上限 `MAX_CHARACTERS_PER_INSTANCE`
 *      ⇒ **超限拒新**（绝不静默挤掉已有角色 —— 角色是用户亲手建的，丢掉即数据丢失）；
 *   ② `session_events`：每 instance 每会话 N 条 + 每 instance 总 M 条 ⇒ **超限滚动归档最老**
 *      （归档到 `history/`，历史不丢，只是不在热表里）；
 *   ③ `exp_events` / `unit_positions`：**随 `characters` 同步清理**（无独立池）。
 *
 * ============ 副本口径（唯一的归一口径）============
 *   本模块的所有「按副本」计数都走 `instance-scope.ts` 的 `instanceScopeWhere`
 *   （`COALESCE(instance_id, 'wsp_sandbox') = ?`）—— 旧行（instance_id IS NULL）归默认沙盒。
 *   why 不在这里另写一份 COALESCE：同一批旧行在不同文件里落进不同副本 ⇒ 老数据「部分消失」
 *   （instance-scope.ts 文件头已就这条口径写过同款纪律）。本模块只调用，不重写。
 *
 * 输入：一个 better-sqlite3 兼容连接（`SqliteDatabaseLike`）+ 副本 id / 角色 id 清单。
 * 输出：计数、容量判定、写入护栏的过滤结果、从属行清理结果、待归档的事件行。
 * 禁止事项：
 *   1. import fs / path / electron —— 本模块**零 IO**：落盘（归档写文件）归 session-event-archive.ts，
 *      本模块只负责「哪些行该走」（与 project-archive.ts 的纯逻辑 / node 适配分离同一纪律）；
 *   2. 认识 core 的运行时类型 —— 入参是**纯持久化形状**（id 串 + 行）；
 *   3. 改写事件内容 —— 归档是「搬走」，不是「改写」（append-only 是事件表的立表理由）；
 *   4. 在这里定业务时机 —— 「什么时候检查」归调用方（写入路径），本模块只回答「能不能写 / 该搬谁」。
 *
 * @since v3.3（task_205 / M2-08）。
 */

import {
  MAX_CHARACTERS_PER_INSTANCE,
  MAX_CHARACTERS_TOTAL,
} from '../../../core/capacity';
import { DEFAULT_INSTANCE_ID, type ProjectInstanceId } from '../../../core/types';

import { EXP_EVENTS_TABLE } from './exp-event-dao';
import {
  CHARACTERS_TABLE,
  UNIT_POSITIONS_TABLE,
  type PersistedCharacterRecord,
  type SqliteDatabaseLike,
} from './game-save-dao';
import { instanceScopeWhere } from './instance-scope';
import { SESSION_EVENTS_TABLE } from './session-event-dao';

// ============================================================================
// 池一：characters（超限拒新）
// ============================================================================

/** 角色池的容量判定结果。 */
export interface CharacterCapacityStatus {
  /** 全库角色行数（跨副本）。 */
  readonly total: number;
  /** 全局上限。 */
  readonly totalLimit: number;
  /** 目标副本的行数。 */
  readonly instanceCount: number;
  /** 每副本上限。 */
  readonly instanceLimit: number;
  /** 还能不能再新建（false ⇒ 必须拒新）。 */
  readonly ok: boolean;
  /** 拒新的原因（ok 为 true 时为 null）。 */
  readonly reason: 'instance-limit' | 'total-limit' | null;
}

/** 全库角色行数（**跨副本** —— 这是「无界增长」的那条线）。 */
export function countCharacters(db: SqliteDatabaseLike): number {
  const row = db.prepare(`SELECT COUNT(*) AS n FROM ${CHARACTERS_TABLE}`).get() as
    | { n?: number }
    | undefined;
  return Number(row?.n ?? 0);
}

/**
 * 某副本的角色行数（COALESCE 口径：默认沙盒命中旧行 `instance_id IS NULL`）。
 *
 * why 走 instance-scope 的谓词而不是自己写 `instance_id = ?`：旧行是 NULL，
 *   直接比会**命不中**它们 ⇒ 沙盒的角色数会被少算（上限形同虚设）。
 */
export function countInstanceCharacters(
  db: SqliteDatabaseLike,
  instanceId: ProjectInstanceId
): number {
  const scope = instanceScopeWhere(instanceId, 'WHERE ');
  const row = db
    .prepare(`SELECT COUNT(*) AS n FROM ${CHARACTERS_TABLE} ${scope.sql}`)
    .get(...scope.params) as { n?: number } | undefined;
  return Number(row?.n ?? 0);
}

/**
 * 角色池容量判定（**能不能再建一个**）。
 *
 * why 两个上限都要判：每副本 64 防「一个副本撑爆广播」，
 *   全局 512 防「副本一多就无界」（落库表整体驻留内存）。
 * why 先判副本再判全局：副本满了是**更具体**的原因（告诉调用方「这个副本满了」比
 *   「全库满了」有用 —— 前者可以换一个副本建，后者只能清理）。
 */
export function readCharacterCapacity(
  db: SqliteDatabaseLike,
  instanceId: ProjectInstanceId
): CharacterCapacityStatus {
  const total = countCharacters(db);
  const instanceCount = countInstanceCharacters(db, instanceId);
  if (instanceCount >= MAX_CHARACTERS_PER_INSTANCE) {
    return {
      total,
      totalLimit: MAX_CHARACTERS_TOTAL,
      instanceCount,
      instanceLimit: MAX_CHARACTERS_PER_INSTANCE,
      ok: false,
      reason: 'instance-limit',
    };
  }
  if (total >= MAX_CHARACTERS_TOTAL) {
    return {
      total,
      totalLimit: MAX_CHARACTERS_TOTAL,
      instanceCount,
      instanceLimit: MAX_CHARACTERS_PER_INSTANCE,
      ok: false,
      reason: 'total-limit',
    };
  }
  return {
    total,
    totalLimit: MAX_CHARACTERS_TOTAL,
    instanceCount,
    instanceLimit: MAX_CHARACTERS_PER_INSTANCE,
    ok: true,
    reason: null,
  };
}

/** 写入护栏的结果：哪些能写、哪些被拒。 */
export interface CharacterCapacityFilterResult {
  /** 通过护栏的记录（**已存在的老行也在内** —— 改档不受容量限制）。 */
  readonly accepted: readonly PersistedCharacterRecord[];
  /** 被拒的新行 id（拒新，不拒改）。 */
  readonly rejected: readonly string[];
}

/**
 * 写入护栏：**新行**按容量筛掉，**老行**照写（改档不是新建）。
 *
 * why 区分新旧：`upsertCharacters` 是「全量快照回写」语义 —— 一批记录里既有新建的也有改过的；
 *   若把容量判定套在整批上，副本满位时**改个名字都写不进去**（存量角色会僵在旧值）。
 * why 老行按 id 判定存在：角色的身份就是行 id（`characters.id` 是主键）。
 *
 * @param instanceId 缺省归属（记录自带 instanceId 时以记录为准；两者都无 ⇒ 默认沙盒）。
 */
export function filterCharactersWithinCapacity(
  db: SqliteDatabaseLike,
  records: readonly PersistedCharacterRecord[],
  instanceId?: ProjectInstanceId
): CharacterCapacityFilterResult {
  const existingIds = new Set(
    (db.prepare(`SELECT id FROM ${CHARACTERS_TABLE}`).all() as Array<Record<string, unknown>>).map(
      (row) => String(row.id ?? '')
    )
  );
  let total = countCharacters(db);
  /** 各副本的当前行数（懒加载 + 缓存 —— 一批里同副本的行只查一次）。 */
  const instanceCounts = new Map<ProjectInstanceId, number>();

  const accepted: PersistedCharacterRecord[] = [];
  const rejected: string[] = [];

  for (const record of records) {
    if (existingIds.has(record.id)) {
      accepted.push(record);
      continue;
    }
    const scope = record.instanceId ?? instanceId ?? DEFAULT_INSTANCE_ID;
    let instanceCount = instanceCounts.get(scope);
    if (instanceCount === undefined) {
      instanceCount = countInstanceCharacters(db, scope);
      instanceCounts.set(scope, instanceCount);
    }
    if (instanceCount >= MAX_CHARACTERS_PER_INSTANCE) {
      rejected.push(record.id);
      continue;
    }
    if (total >= MAX_CHARACTERS_TOTAL) {
      rejected.push(record.id);
      continue;
    }
    instanceCount += 1;
    instanceCounts.set(scope, instanceCount);
    total += 1;
    existingIds.add(record.id);
    accepted.push(record);
  }

  return { accepted, rejected };
}

// ============================================================================
// 池二：session_events（超限滚动归档最老）
// ============================================================================

/** 某副本的事件总条数（COALESCE 口径）。 */
export function countInstanceSessionEvents(
  db: SqliteDatabaseLike,
  instanceId: ProjectInstanceId
): number {
  const scope = instanceScopeWhere(instanceId, 'WHERE ');
  const row = db
    .prepare(`SELECT COUNT(*) AS n FROM ${SESSION_EVENTS_TABLE} ${scope.sql}`)
    .get(...scope.params) as { n?: number } | undefined;
  return Number(row?.n ?? 0);
}

/** 某副本里某个会话的事件条数（会话内 seq 连续 ⇒ 用主键前缀扫）。 */
export function countSessionEventsForSession(
  db: SqliteDatabaseLike,
  sessionId: string,
  instanceId: ProjectInstanceId
): number {
  const scope = instanceScopeWhere(instanceId, 'AND ');
  const row = db
    .prepare(
      `SELECT COUNT(*) AS n FROM ${SESSION_EVENTS_TABLE} WHERE session_id = ?${scope.sql}`
    )
    .get(sessionId, ...scope.params) as { n?: number } | undefined;
  return Number(row?.n ?? 0);
}

/** 一行事件（归档 / 删除的最小单位）。 */
export interface SessionEventRow {
  readonly sessionId: string;
  readonly seq: number;
  readonly type: string;
  readonly payload: unknown;
  readonly createdAt: number;
}

/**
 * 取**最老**的若干行事件（待归档的那一批）。
 *
 * why 排序口径分两种：指定会话时按 `seq` 升序（会话内 seq 就是时间序）；
 *   不指定会话时按 `created_at` 升序（跨会话的时间序）—— 两种都是「最老的先走」。
 * why 带 LIMIT：一次只搬走**刚好超限的那几行**（不多搬 —— 归档文件也是有限的）。
 */
export function selectOldestSessionEvents(
  db: SqliteDatabaseLike,
  options: {
    readonly instanceId: ProjectInstanceId;
    readonly sessionId?: string;
    readonly limit: number;
  }
): SessionEventRow[] {
  const scope = instanceScopeWhere(options.instanceId, 'WHERE ');
  const limit = Math.max(0, Math.floor(options.limit));
  if (limit === 0) return [];
  const bySession = typeof options.sessionId === 'string' && options.sessionId.length > 0;
  const order = bySession ? 'seq ASC' : 'created_at ASC, session_id ASC, seq ASC';
  const rows = db
    .prepare(
      `SELECT session_id, seq, type, payload, created_at
       FROM ${SESSION_EVENTS_TABLE}
       ${bySession ? `${scope.sql} AND session_id = ?` : scope.sql}
       ORDER BY ${order}
       LIMIT ?`
    )
    .all(...(bySession ? [...scope.params, options.sessionId as string, limit] : [...scope.params, limit])) as Array<
    Record<string, unknown>
  >;
  return rows.map((row) => ({
    sessionId: String(row.session_id ?? ''),
    seq: Number(row.seq ?? 0),
    type: String(row.type ?? ''),
    payload: parsePayload(row.payload),
    createdAt: Number(row.created_at ?? 0),
  }));
}

/**
 * 删掉已归档的行（**归档成功之后**才调 —— 先搬走再删，搬失败就一行都不删）。
 *
 * why 按 (session_id, seq) 删：那是本表的复合主键 ⇒ 精确定位到行，不会误删同 seq 的别会话事件。
 */
export function deleteSessionEventRows(
  db: SqliteDatabaseLike,
  rows: readonly SessionEventRow[]
): number {
  const stmt = db.prepare(
    `DELETE FROM ${SESSION_EVENTS_TABLE} WHERE session_id = ? AND seq = ?`
  );
  let deleted = 0;
  for (const row of rows) {
    stmt.run(row.sessionId, row.seq);
    deleted += 1;
  }
  return deleted;
}

// ============================================================================
// 池三：exp_events / unit_positions（随 characters 同步清理，无独立池）
// ============================================================================

/** 随行清理的结果（各表实际删掉几行）。 */
export interface CharacterCascadeResult {
  /** 删掉的 `characters` 行数。 */
  readonly characters: number;
  /** 删掉的 `exp_events` 行数（经验事件流 —— 角色的审计尾巴）。 */
  readonly expEvents: number;
  /** 删掉的 `unit_positions` 行数（角色的战场站位）。 */
  readonly unitPositions: number;
}

/**
 * 删角色 ⇒ **连同它的从属行一起删**（`exp_events` / `unit_positions`）。
 *
 * why 随行清理：这两张表**没有独立池**（design §1.4 M2 行 ③）——
 *   它们的存在意义完全依附于角色（没有角色的经验事件与站位是孤儿）；
 *   不跟着角色一起清 ⇒ 角色删了、它的成长史与站位还躺在库里 ⇒ 表照样无界增长。
 * why 一个事务：角色行与从属行要么一起没、要么一起在 —— 半截状态（角色没了、经验还在）
 *   会让「角色已删除」的判定与从属数据对不上。
 */
export function deleteCharacterCascade(
  db: SqliteDatabaseLike,
  characterIds: readonly string[]
): CharacterCascadeResult {
  const ids = characterIds.filter((id) => typeof id === 'string' && id.length > 0);
  if (ids.length === 0) return { characters: 0, expEvents: 0, unitPositions: 0 };

  // 先数后删：计数走 SELECT COUNT（run 的返回值形状各驱动不一，不拿它当计数）。
  let characters = 0;
  let expEvents = 0;
  let unitPositions = 0;
  db.exec('BEGIN');
  try {
    const countCharactersOf = db.prepare(
      `SELECT COUNT(*) AS n FROM ${CHARACTERS_TABLE} WHERE id = ?`
    );
    const countExpOf = db.prepare(
      `SELECT COUNT(*) AS n FROM ${EXP_EVENTS_TABLE} WHERE character_id = ?`
    );
    const countPositionOf = db.prepare(
      `SELECT COUNT(*) AS n FROM ${UNIT_POSITIONS_TABLE} WHERE character_id = ?`
    );
    const deleteCharacter = db.prepare(`DELETE FROM ${CHARACTERS_TABLE} WHERE id = ?`);
    const deleteExp = db.prepare(`DELETE FROM ${EXP_EVENTS_TABLE} WHERE character_id = ?`);
    const deletePosition = db.prepare(`DELETE FROM ${UNIT_POSITIONS_TABLE} WHERE character_id = ?`);
    for (const id of ids) {
      characters += Number((countCharactersOf.get(id) as { n?: number } | undefined)?.n ?? 0);
      expEvents += Number((countExpOf.get(id) as { n?: number } | undefined)?.n ?? 0);
      unitPositions += Number(
        (countPositionOf.get(id) as { n?: number } | undefined)?.n ?? 0
      );
      deleteCharacter.run(id);
      deleteExp.run(id);
      deletePosition.run(id);
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  return { characters, expEvents, unitPositions };
}

/** 载荷 JSON 串 → 值；解析失败 / 非串返回 null（不抛 —— 读路径不该因一行脏数据炸掉）。 */
function parsePayload(value: unknown): unknown {
  if (typeof value !== 'string' || value.length === 0) return null;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

/** 上限常量再导出（调用方不必再去 core/capacity 拿 —— 一处入口）。 */
export {
  MAX_CHARACTERS_PER_INSTANCE,
  MAX_CHARACTERS_TOTAL,
};
