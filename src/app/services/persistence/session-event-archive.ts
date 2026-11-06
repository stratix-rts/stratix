/**
 * 文件职责：**会话事件的滚动归档**（@since v3.3，task_205 / M2-08）——
 *   `session_events` 超出副本级容量时，把**最老**的那几行搬进
 *   `.stratix/history/session-events-YYYYMM.jsonl`（**append-only**），再从热表里删掉。
 *
 * 权威依据：docs/DESIGN-project-map.md §1.4 **M2 行 ②**（`session_events` 每 instance 每会话 N 条
 *   + 每 instance 总 M 条 ⇒ 超出**滚动归档**到 `history/`；R1-20：落库层没有行数上限）。
 *
 * ============ 为什么是「归档」而不是「丢弃」============
 *   `session_events` 是 **append-only 的审计流**（立表理由：改写即毁证）。
 *   超限时**丢掉最老的事件** = 毁证 ⇒ 只能**搬走**：热表里没有了，账本里还在。
 *   归档格式沿用 M1-06 的 `history/*.jsonl` 纪律（`v` / `ts` / `kind` / `ignorable` / `payload`）
 *   —— 同一套行格式 ⇒ 读方只有一份解析器。
 *
 * ============ 归档的先后（不能反）============
 *   **先落盘、后删行**：落盘失败 ⇒ 一行都不删（热表里还留着，下次再搬）；
 *   反过来（先删后写）一旦落盘失败就是**数据丢失** —— 比「表大了一点」严重得多。
 *
 * 输入：一个 better-sqlite3 兼容连接 + 实例根目录解析口 + append-only 落盘口。
 * 输出：容量守门端口（追加事件后调一次）。
 * 禁止事项：
 *   1. import fs —— 本模块**零 IO**：落盘归 node 侧适配（project-archive-node.ts 的 appender）；
 *   2. 改写事件内容 —— 归档是「原样搬走」（payload 照抄，不加工、不截断）；
 *   3. 在这里定业务时机 —— 「什么时候检查」归写入路径（service 的存储件），本模块只回答「该搬谁」；
 *   4. 删掉没归档成功的行 —— 落盘失败就一行都不删（见上）。
 *
 * @since v3.3（task_205 / M2-08）。
 */

import { join } from 'path';

import {
  MAX_SESSION_EVENTS_PER_INSTANCE,
  MAX_SESSION_EVENTS_PER_SESSION,
} from '../../../core/capacity';
import { DEFAULT_INSTANCE_ID, type ProjectInstanceId } from '../../../core/types';

import {
  countInstanceSessionEvents,
  countSessionEventsForSession,
  deleteSessionEventRows,
  selectOldestSessionEvents,
  type SessionEventRow,
} from './capacity-limits';
import type { SqliteDatabaseLike } from './game-save-dao';
import type { ArchiveAppender } from './project-archive';
import { lookupSessionInstanceId } from './session-event-dao';

/**
 * 归档行格式版本（行内版本，与 `.stratix` 契约面版本分开 —— 同 project-archive.ts 的纪律）。
 */
export const SESSION_EVENT_ARCHIVE_LINE_VERSION = 1;

/** 归档事件种类（读方据此分辨「会话事件被归档了」这件事）。 */
export const SESSION_EVENT_ARCHIVE_KIND = 'session-event/archived';

/** 归档载荷（一条会话事件的完整快照）。 */
export interface SessionEventArchivePayload {
  readonly sessionId: string;
  /** 会话内序号（搬走后热表里会缺号 —— 归档保住了真相，热表只保「最近」）。 */
  readonly seq: number;
  readonly type: string;
  readonly payload: unknown;
  readonly createdAt: number;
  /** 所属副本（null = 未归属；默认沙盒有真实 id）。 */
  readonly instanceId: ProjectInstanceId | null;
}

/** 一行归档（JSONL 的一行）。 */
export interface SessionEventArchiveLine {
  readonly v: number;
  readonly ts: number;
  readonly kind: string;
  readonly ignorable: boolean;
  readonly payload: SessionEventArchivePayload;
}

/**
 * 归档分片文件名（按月分片 —— 同 M1-06 的 `missions-YYYYMM.jsonl` 纪律：
 * 单文件无限增长 = 另一种无界；按月切 ⇒ 每片有界、可人工检查）。
 */
export function sessionEventArchiveFileName(at: number): string {
  const date = new Date(at);
  const year = String(date.getFullYear()).padStart(4, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  return `session-events-${year}${month}.jsonl`;
}

/** 归档文件的相对路径（`.stratix/history/session-events-YYYYMM.jsonl`）。 */
export function sessionEventArchiveRelativePath(fileName: string): string {
  return `.stratix/history/${fileName}`;
}

/** 事件行 → 归档载荷（**原样搬走**：不加工、不截断）。 */
export function toSessionEventArchivePayload(
  row: SessionEventRow,
  instanceId: ProjectInstanceId
): SessionEventArchivePayload {
  return {
    sessionId: row.sessionId,
    seq: row.seq,
    type: row.type,
    payload: row.payload,
    createdAt: row.createdAt,
    instanceId,
  };
}

/** 造一行归档（未序列化的对象形态）。 */
export function buildSessionEventArchiveLine(
  row: SessionEventRow,
  instanceId: ProjectInstanceId,
  at: number
): SessionEventArchiveLine {
  return {
    v: SESSION_EVENT_ARCHIVE_LINE_VERSION,
    ts: at,
    kind: SESSION_EVENT_ARCHIVE_KIND,
    // 显式 false：读方必须认识这个 kind 才敢重建（DESIGN-workspace §1.3「默认必须显式标注」）。
    ignorable: false,
    payload: toSessionEventArchivePayload(row, instanceId),
  };
}

/**
 * 把一批事件序列化成**一段**待追加的文本（每行一条 JSON，行尾带 `\n`）。
 *
 * why 一次序列化整批：先全算好再落盘 —— 序列化失败时磁盘一个字节都没动，
 *   不会留下「写了一半才发现 JSON 不合法」的半份文件。
 */
export function serializeSessionEventArchiveBatch(
  rows: readonly SessionEventRow[],
  instanceId: ProjectInstanceId,
  at: number
): string {
  return rows
    .map((row) => `${JSON.stringify(buildSessionEventArchiveLine(row, instanceId, at))}\n`)
    .join('');
}

// ============================================================================
// 容量守门端口
// ============================================================================

/** 一次守门的 outcome（可观测：宿主能如实知道搬走了几行、为什么没搬）。 */
export interface SessionEventCapacityOutcome {
  /** 实际搬走（并从热表删掉）的事件条数。 */
  readonly archived: number;
  /** 归档文件相对路径（搬走过才有）。 */
  readonly archivePath?: string;
  /** 没搬成的原因（`archived` 为 0 且有值时）。 */
  readonly reason?: 'no-instance-root' | 'archive-failed';
}

/** 容量守门端口（写入路径追加一条事件后调一次）。 */
export interface SessionEventCapacityGuard {
  /**
   * 按副本口径判定容量，超限则**滚动归档最老**的事件。
   *
   * @param input.sessionId 刚追加的事件所属会话（每会话上限按它判）。
   * @param input.instanceId 副本归属；缺省 = **随会话走**（查会话的 instance_id，
   *   与事件落库同一条口径）；会话也查不到 ⇒ 默认沙盒（COALESCE 口径的落点）。
   */
  enforce(input: {
    readonly sessionId: string;
    readonly instanceId?: ProjectInstanceId | null;
  }): SessionEventCapacityOutcome;
}

/** 守门件的创建参数。 */
export interface SessionEventArchiverOptions {
  /** 库连接（与写入路径同一份 —— 守门看到的就是刚写完的那张表）。 */
  readonly db: SqliteDatabaseLike;
  /** 实例根目录解析（副本 id → 项目根；查不到 = undefined ⇒ 没法归档）。 */
  readonly resolveInstanceRoot: (instanceId: ProjectInstanceId) => string | undefined;
  /** 落盘口（append-only；node 实现见 project-archive-node.ts 的 createNodeArchiveAppender）。 */
  readonly appender: ArchiveAppender;
  /** 当前时刻（ms epoch；可注入以便测试）。 */
  readonly now?: () => number;
  /** 上限覆盖（测试用；缺省 = core/capacity.ts 的契约值）。 */
  readonly limits?: {
    readonly perSession?: number;
    readonly perInstance?: number;
  };
}

/**
 * 造容量守门件。
 *
 * 判定顺序（why 先会话后副本）：
 *   ① **每会话**上限 —— 一个会话自己涨爆了，先把它自己的老段搬走；
 *   ② **每副本**总量上限 —— 搬完会话级的还超（会话多），再跨会话搬最老的。
 *   why 这个顺序：会话级是「更具体」的原因（搬它不伤别的会话）；
 *   副本级是兜底（会话数多时的乘积效应）。
 */
export function createSessionEventArchiver(
  options: SessionEventArchiverOptions
): SessionEventCapacityGuard {
  const now = options.now ?? ((): number => Date.now());
  const perSession = options.limits?.perSession ?? MAX_SESSION_EVENTS_PER_SESSION;
  const perInstance = options.limits?.perInstance ?? MAX_SESSION_EVENTS_PER_INSTANCE;

  /** 搬走一批行：先落盘、后删行。落盘失败 ⇒ 一行都不删。 */
  const archiveRows = (
    rows: readonly SessionEventRow[],
    instanceId: ProjectInstanceId
  ): SessionEventCapacityOutcome => {
    if (rows.length === 0) return { archived: 0 };
    const root = options.resolveInstanceRoot(instanceId);
    // 根目录查不到 ⇒ 这个副本没法定位归档位置 ⇒ **不删行**（热表里还留着，下次再搬）。
    // why 不猜路径：写错地方比不写更糟（归档是审计真相）。
    if (!root) return { archived: 0, reason: 'no-instance-root' };

    const at = now();
    const fileName = sessionEventArchiveFileName(at);
    const filePath = join(root, '.stratix', 'history', fileName);
    try {
      options.appender.append(filePath, serializeSessionEventArchiveBatch(rows, instanceId, at));
    } catch {
      // 落盘失败 ⇒ 一行都不删（先搬走后删的次序不能反 —— 反了就等于丢数据）。
      return { archived: 0, reason: 'archive-failed' };
    }
    deleteSessionEventRows(options.db, rows);
    return { archived: rows.length, archivePath: sessionEventArchiveRelativePath(fileName) };
  };

  return {
    enforce(input): SessionEventCapacityOutcome {
      // 归属口径与落库**完全一致**（session-event-dao 的 appendSessionEvent）：
      //   「来件归属 ?? 会话归属」⇒ 查不到才落默认沙盒（COALESCE 口径的落点）。
      // why 不省这一步：守门算账必须记**同一个池** ——
      //   事件行落在哪个副本名下（appendSessionEvent 决定的），账就得记在哪个副本头上；
      //   记错池 = 别的副本吃紧、这个副本无感（上限形同虚设）。
      const instanceId =
        input.instanceId ??
        lookupSessionInstanceId(options.db, input.sessionId) ??
        DEFAULT_INSTANCE_ID;

      // ① 每会话上限：超了就搬这个会话自己最老的那几行。
      const sessionCount = countSessionEventsForSession(options.db, input.sessionId, instanceId);
      let outcome: SessionEventCapacityOutcome = { archived: 0 };
      if (sessionCount > perSession) {
        const rows = selectOldestSessionEvents(options.db, {
          instanceId,
          sessionId: input.sessionId,
          limit: sessionCount - perSession,
        });
        outcome = archiveRows(rows, instanceId);
      }

      // ② 每副本总量上限：会话级搬完还超 ⇒ 跨会话搬最老的。
      const instanceCount = countInstanceSessionEvents(options.db, instanceId);
      if (instanceCount > perInstance) {
        const rows = selectOldestSessionEvents(options.db, {
          instanceId,
          limit: instanceCount - perInstance,
        });
        const second = archiveRows(rows, instanceId);
        outcome = {
          archived: outcome.archived + second.archived,
          ...(second.archivePath ?? outcome.archivePath
            ? { archivePath: second.archivePath ?? outcome.archivePath }
            : {}),
          ...(second.reason ? { reason: second.reason } : {}),
        };
      }

      return outcome;
    },
  };
}
