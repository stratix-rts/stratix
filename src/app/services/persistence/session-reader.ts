/**
 * 文件职责：**会话域的读取口**（task_096 / v3.2a S6）—— 把 sessions / session_events 两张表的
 *   **行**翻译成 core 的会话形状，并包成 core 契约的 SessionReadPort（纯回调，core 不认存储）。
 * 输入：一个 better-sqlite3 兼容的数据库连接（SqliteDatabaseLike）。
 * 输出：会话摘要（core 的 SessionRecord）/ 会话事件（core 的 SessionEventView）。
 * 禁止事项：
 *   1. import fs / path / electron —— 连接从哪来不归本文件管（生产 = stratix-database 单例，
 *      测试 = 临时文件库），与 session-dao / session-event-dao 同纪律；
 *   2. 改事件 / 删事件 —— 本文件**只读**（session_events 是 append-only 的历史流，读路径不改写）；
 *   3. 在这里定业务规则（分页缺省值 / 过滤口径）—— 缺省与收紧在 DAO 里，
 *      业务口径（哪些 kind / status）归 core 的会话域；
 *   4. 认 MCP —— 本文件只认 core 的会话契约，MCP 是它的一个消费者（不是它的主人）。
 *
 * why 需要一个"行 → core 形状"的翻译层：DAO 的行是**持久化形状**（ref_id 可空、payload 是
 *   JSON 串），core 的会话摘要是**域形状**（refId 缺省即不出现该键、payload 已是解析后的值）。
 *   两份形状各有一份翻译（本文件的读向 + session-persister.ts 的写向），中间不再有第三份 ——
 *   翻译散在两处必然漂移，而漂移的代价是"MCP 看到的会话状态与库里不一致"。
 *
 * @since v3.43，task_096。
 */

import type {
  SessionEventView,
  SessionListQuery,
  SessionPage,
  SessionReadPort,
  SessionRecord,
} from '../../../core/session/types';

import type { SqliteDatabaseLike } from './game-save-dao';
import {
  countSessionRecords,
  getSessionRecord,
  listSessionRecords,
  type PersistedSessionRecord,
} from './session-dao';
import {
  listSessionEvents,
  listSessionEventsFrom,
  type PersistedSessionEvent,
} from './session-event-dao';

/**
 * 造一个会话读口（包两张表的读动作）。
 *
 * @param db 数据库连接（生产 = service 侧单例；测试 = 临时文件库）。
 */
export function createSessionReader(db: SqliteDatabaseLike): SessionReadPort {
  return {
    readSessions: (query: SessionListQuery): SessionPage => {
      const rows = listSessionRecords(db, {
        ...(query.kind ? { kind: query.kind } : {}),
        ...(query.status ? { status: query.status } : {}),
        limit: query.limit,
        offset: query.offset,
      });
      return {
        items: rows.map(toSessionRecord),
        total: countSessionRecords(db, {
          ...(query.kind ? { kind: query.kind } : {}),
          ...(query.status ? { status: query.status } : {}),
        }),
      };
    },
    readSession: (sessionId: string): SessionRecord | null => {
      const row = getSessionRecord(db, sessionId);
      return row ? toSessionRecord(row) : null;
    },
    readSessionEvents: (
      sessionId: string,
      options: { readonly beforeSeq?: number; readonly limit: number }
    ): readonly SessionEventView[] =>
      listSessionEvents(db, sessionId, {
        ...(options.beforeSeq === undefined ? {} : { beforeSeq: options.beforeSeq }),
        limit: options.limit,
      }).map(toSessionEventView),
    // 向前读（@since v3.48 / task_106）：长会话压缩取"要折的那一段"用 ——
    //   窗口口径得从最新往回翻页穿过整段历史（读量随会话长度增长），向前读是 O(条数)。
    readSessionEventsAfter: (
      sessionId: string,
      afterSeq: number,
      limit: number
    ): readonly SessionEventView[] =>
      listSessionEventsFrom(db, sessionId, afterSeq, limit).map(toSessionEventView),
  };
}

/**
 * 持久化行 → core 会话摘要。
 *
 * refId：库里是 null（无关联），core 的形状是"缺省即不出现该键" —— 两边语义一致，
 * 翻译时保持"键缺席"而不是塞一个 null 进去（core 的 SessionRecord.refId 是可选字符串，
 * null 不是它的合法取值）。
 */
export function toSessionRecord(row: PersistedSessionRecord): SessionRecord {
  return {
    id: row.id,
    kind: row.kind,
    title: row.title,
    participants: [...row.participants],
    status: row.status,
    ...(row.refId ? { refId: row.refId } : {}),
    createdAt: row.createdAt,
    lastEventAt: row.lastEventAt,
    closedAt: row.closedAt,
    eventCount: row.eventCount,
  };
}

/** 持久化行 → core 事件读面视图（payload 已是解析后的值；解析失败为 null —— 不编造）。 */
export function toSessionEventView(row: PersistedSessionEvent): SessionEventView {
  return {
    sessionId: row.sessionId,
    seq: row.seq,
    type: row.type,
    payload: row.payload,
    createdAt: row.createdAt,
  };
}
