/**
 * 文件职责：**进程内会话事件日志**（app 层）—— 给 core/session 的 manager 当「事件源」用。
 *
 * why 需要它：会话事件的本体按设计**不进广播**（性能铁律：WorldState 只带摘要，
 *   广播体积必须有界），事件的唯一去处是持久化口。渲染侧（Electron 前端）目前
 *   没有会话落库通道（会话两张表由 service 进程独占写，铁律 6）——
 *   于是渲染侧写出来的事件**当场就丢了**：resume 的回灌
 *   （core/session/context-replay.ts）没有事件源，core 会如实拒绝（「事件源未附着」）。
 *   本模块给渲染侧补一个**进程内**事件源：写口与读口是同一份内存。
 *
 * ============ 边界（如实说明，不假装自己是数据库）============
 *   1. **进程内**：页面重载即失 —— 渲染侧的会话摘要本就在内存里（core store），
 *      事件与摘要同命，这是渲染侧会话域的现状，不是本模块能单独解决的；
 *   2. **有界**：每会话条数上限 + 会话数上限（性能铁律：数据不许无限增长；
 *      丢的是**最旧**的 —— 续跑关心"刚才聊到哪"）；
 *   3. **只留事件**：摘要快照不存 —— 摘要的真相在 WorldState（会话域自己管），
 *      这里再存一份就是第二份真相。
 *
 * 禁止事项：
 *   1. import DAO / SQLite —— 落库是 service 侧的事（铁律 6），本模块只管内存；
 *   2. 在这里做业务判断（kind 准入 / 相位裁决）—— 那些真相在 core/session；
 *   3. 在这里改事件 —— append-only 是会话事件流的立表理由，改写即毁证。
 */

import type {
  SessionEvent,
  SessionEventReadPort,
  SessionEventView,
  SessionPersistPort,
} from '../../core/session';

/** 每会话保留的事件条数上限（缺省）。 */
export const DEFAULT_SESSION_LOG_EVENTS_PER_SESSION = 500;

/** 保留的会话数上限（缺省）。 */
export const DEFAULT_SESSION_LOG_SESSIONS = 50;

/** 造一个进程内会话事件日志的参数。 */
export interface SessionEventLogOptions {
  /** 每会话保留的事件条数上限（超出丢最旧的）。 */
  readonly maxEventsPerSession?: number;
  /** 保留的会话数上限（超出丢最旧会话的整段事件）。 */
  readonly maxSessions?: number;
}

/** 进程内会话事件日志（写口 + 读口 + 观察口）。 */
export interface SessionEventLog {
  /** 写口（注入 core/session 的 manager 当 persist 口）。 */
  readonly persist: SessionPersistPort;
  /** 读口（manager.resume / manager.fork 的事件源）。 */
  readonly read: SessionEventReadPort;
  /** 某会话当前存着几条事件（观察口，测试用）。 */
  readonly count: (sessionId: string) => number;
}

/**
 * 造一个进程内会话事件日志。
 *
 * why 读口按 DAO 同一口径（窗口 = 命中集里**最后** limit 条，beforeSeq 是游标）：
 *   core/session 的 manager.readAllEvents 按这条口径向前翻页取全量 ——
 *   两端口径必须一致，否则 resume 会**静默少读**一段历史（模型拿到不完整的上文）。
 */
export function createSessionEventLog(options: SessionEventLogOptions = {}): SessionEventLog {
  const maxEvents = Math.max(
    1,
    Math.floor(options.maxEventsPerSession ?? DEFAULT_SESSION_LOG_EVENTS_PER_SESSION)
  );
  const maxSessions = Math.max(1, Math.floor(options.maxSessions ?? DEFAULT_SESSION_LOG_SESSIONS));
  /** sessionId → 事件（seq 正序；写入序 = seq 序）。 */
  const bySession = new Map<string, SessionEvent[]>();

  const persist: SessionPersistPort = {
    // 摘要不存：摘要的真相在 WorldState（core/session 的 manager 写的那一份）。
    persistSession: () => undefined,
    persistEvent: (event) => {
      if (!event) return;
      const list = bySession.get(event.sessionId) ?? [];
      list.push(event);
      // 超上限丢最旧的（留最近的：续跑关心"刚才聊到哪"）。
      while (list.length > maxEvents) list.shift();
      bySession.set(event.sessionId, list);
      // 会话数超上限：丢最旧会话的整段事件（Map 的插入序 = 首次写入序）。
      while (bySession.size > maxSessions) {
        const oldest = bySession.keys().next();
        if (oldest.done) break;
        bySession.delete(oldest.value);
      }
    },
  };

  const read: SessionEventReadPort = {
    readSessionEvents: (sessionId, query) => {
      const list = bySession.get(sessionId) ?? [];
      const beforeSeq = query.beforeSeq;
      const filtered =
        beforeSeq === undefined ? list : list.filter((event) => event.seq < beforeSeq);
      return filtered.slice(Math.max(0, filtered.length - query.limit)).map(toView);
    },
    // 向前读（@since v3.48 / task_106）：取 seq 大于 afterSeq 的**最早** limit 条。
    //   长会话压缩取"要折的那一段"用 —— 窗口口径得从最新往回翻页穿过整段历史（读放大）。
    readSessionEventsAfter: (sessionId, afterSeq, limit) => {
      const list = bySession.get(sessionId) ?? [];
      const out: SessionEventView[] = [];
      // list 按写入序 = seq 序（seq 会话内单调）→ 顺序扫到 afterSeq 之后即可停。
      for (const event of list) {
        if (event.seq <= afterSeq) continue;
        out.push(toView(event));
        if (out.length >= limit) break;
      }
      return out;
    },
  };

  return {
    persist,
    read,
    count: (sessionId: string): number => (bySession.get(sessionId) ?? []).length,
  };
}

/** 写面事件 → 读面视图（payload 是 unknown —— 读面不校验形状）。 */
function toView(event: SessionEvent): SessionEventView {
  return {
    sessionId: event.sessionId,
    seq: event.seq,
    type: event.type,
    payload: event.payload,
    createdAt: event.createdAt,
  };
}
