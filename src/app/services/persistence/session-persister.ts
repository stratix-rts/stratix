/**
 * 文件职责：**会话域的持久化端口**（task_092）—— 把 core 的会话摘要 / 事件信封翻译成
 *   持久化行并交给 DAO 落库。**注入件缺省 = 不落库**（模式同 exp_events 注入件：
 *   端口不在就不落，绝不假装成功）。
 * 输入：core/session 的 SessionRecord / SessionEvent（type-only）+ 一个 DAO 端口。
 * 输出：sessions 表的快照 upsert + session_events 表的 append。
 * 禁止事项：
 *   1. 在这里定业务时机（何时落库）—— 时机归 S3 的组合根接线（本模块只负责「怎么落」）；
 *   2. 抛异常打断会话回路 —— 落库失败只记一行警告（会话域的可用性优先于历史完整性，
 *      与 makeExpEventPersister 同一口径：养成回路不能因一次落库失败而中断）；
 *   3. 自己开库 —— 连接由调用方给（生产 = service 侧单例，测试 = 临时文件库）；
 *   4. 往 core 反写 —— 本模块只读 core 的类型，不改 core 的逻辑（S1 是冻结的纯逻辑模块）。
 *
 * ============ 与 S1（task_091）的接口现状（记录在此，供 S3 接线时取用）============
 *   core/session/manager.ts **没有**持久化注入点 —— S1 规格明写「组合根不接线（S3 的事），
 *   本单只交付纯模块 + 单测」。因此本端口按 core 的**信封形状**（SessionRecord / SessionEvent）
 *   定义，S3 接线有两条路（都不需要 S2 追加改动）：
 *     ① 在 core/session/manager.ts 的选项里加一个可选的 persister（core 侧改动，S3 决定）；
 *     ② 在组合根用包装器包住 SessionManager，在 create / append / close 后调本端口
 *        （core 零改动 —— S2 选这条作为默认路径，因为 core 是纯逻辑层，不该认存储）。
 *   S2 不擅自改 core（改 core = 改冻结的 S1 契约）。
 *
 * @since v3.43，task_092。
 */

import type { SessionEvent, SessionRecord } from '../../../core/session/types';

import type { SqliteDatabaseLike } from './game-save-dao';
import { upsertSessionRecord, type PersistedSessionRecord } from './session-dao';
import { appendSessionEvent, type SessionEventInsert } from './session-event-dao';

/**
 * 持久化 DAO 端口（两表各一个动作）。
 * why 收成端口而不是把 db 直接传给 persister：persister 只该知道「能写摘要 / 能写事件」，
 * 不知道表结构（DAO 才知道）—— 也让单测能换一个内存实现验证「不落库」口径。
 */
export interface SessionPersistenceDao {
  /** upsert 一条会话摘要快照。 */
  readonly upsertSession: (record: PersistedSessionRecord) => void;
  /** 追加一条事件（append-only）。 */
  readonly appendSessionEvent: (event: SessionEventInsert) => void;
}

/**
 * 会话域的持久化端口（S3 注入给 SessionManager 的那张脸）。
 *
 * 方法名用 persist* 而不是 save*：与既有的 makeExpEventPersister / makeTaskRecordPersister
 * 同一命名口径（都是「写面注入件」）。
 */
export interface SessionPersister {
  /** 落一条会话摘要快照（upsert）。 */
  readonly persistSession: (record: SessionRecord) => void;
  /** 落一条会话事件（append）。 */
  readonly persistEvent: (event: SessionEvent) => void;
}

/** DAO 工厂：把一个数据库连接包成两张表的写端口（DAO 自带建表兜底，幂等）。 */
export function createSessionPersistenceDao(db: SqliteDatabaseLike): SessionPersistenceDao {
  return {
    upsertSession: (record) => upsertSessionRecord(db, record),
    appendSessionEvent: (event) => appendSessionEvent(db, event),
  };
}

/**
 * 造一个会话持久化注入件。
 *
 * @param dao 写端口；**null = 端口未附着 = 不落库**（缺省口径：非 service 进程 / 单测
 *   / 未接存储的场景下，会话域照常跑，只是不进历史）。
 * @param logger 落库被拒 / 失败各记一行；缺省 console.warn。
 *
 * why 失败只警告不抛：会话域挂在聊天回路与任务回路上，落库失败不该让对话中断
 *   （会话摘要在 WorldState 里还有一份，历史缺一段不致命）。
 */
export function createSessionPersister(
  dao: SessionPersistenceDao | null,
  logger: (line: string) => void = (line) => console.warn(line)
): SessionPersister {
  if (!dao) {
    // 端口未附着：两个动作都变成空操作（**不警告** —— 没接存储是正常配置，不是故障）。
    return {
      persistSession: () => undefined,
      persistEvent: () => undefined,
    };
  }
  return {
    persistSession: (record) => {
      try {
        dao.upsertSession(toPersistedSession(record));
      } catch (error: unknown) {
        logger(
          `[SessionPersister] 会话摘要落库失败（${record?.id ?? 'unknown'}）：${
            error instanceof Error ? error.message : String(error)
          }`
        );
      }
    },
    persistEvent: (event) => {
      try {
        dao.appendSessionEvent(toPersistedEvent(event));
      } catch (error: unknown) {
        logger(
          `[SessionPersister] 会话事件落库失败（${event?.sessionId ?? 'unknown'}/${event?.seq ?? '?'}）：${
            error instanceof Error ? error.message : String(error)
          }`
        );
      }
    },
  };
}

/** core 的会话摘要 → 持久化行（participants 转 JSON 串，refId 缺省 null）。 */
export function toPersistedSession(record: SessionRecord): PersistedSessionRecord {
  return {
    id: record.id,
    kind: record.kind,
    title: record.title,
    participants: [...(record.participants ?? [])],
    status: record.status,
    refId: record.refId ?? null,
    createdAt: record.createdAt,
    lastEventAt: record.lastEventAt,
    closedAt: record.closedAt ?? null,
    eventCount: record.eventCount,
  };
}

/** core 的事件信封 → 持久化行（payload 原样交给 DAO 序列化）。 */
export function toPersistedEvent(event: SessionEvent): SessionEventInsert {
  return {
    sessionId: event.sessionId,
    seq: event.seq,
    type: event.type,
    payload: event.payload,
    createdAt: event.createdAt,
  };
}
