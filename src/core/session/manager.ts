/**
 * 文件职责：**会话域的写入面** —— 把建会话 / 追加事件 / 中断 / 恢复 / 收尾翻译成状态机动作，
 *   并把结果**投影进 store**（WorldState.sessions）。
 *   状态裁决全在 machine.ts（纯函数），本文件只做四件事：找对象 → 跑动作 → 写库 + 上报。
 *   方案来源：docs/SESSION-PLAN.md §2「SessionManager / 各 kind 的接线策略」。
 * 输入：core/store 的 CoreStore；程序化调用（createSession / appendEvent / interrupt…）。
 * 输出：WorldState.sessions 的写入；失败时的 Notice。
 * 禁止事项：
 *   1. 自己订阅总线 / 自己 emitState —— 状态广播的唯一出口是 core/runtime.ts 的 store 订阅
 *      （与 agent-link / mission 同一铁律，否则一次变更广播两遍，两侧白重渲染一次）；
 *   2. 在这里判定状态合法性 —— 那是 machine.ts 的职责，两处判定必然漂移；
 *   3. 在命令里抛异常 —— 命令总线是同步的，抛异常会打断整轮广播；一切失败都转成 Notice；
 *   4. 让 sessions 无限增长 —— 超过 MAX_SESSIONS 先丢**已关闭的最旧**会话（见 dropClosedSessions），
 *      全是在办会话时拒绝新建（绝不静默挤掉谁）；
 *   5. 碰存储 / SQLite / REST —— 落库是 S2（sessions / session_events 表 + DAO）的事，
 *      本模块只交付纯逻辑（core 零 IO 铁律）；唯一的例外是**持久化口**（见下）——
 *      那是一个纯回调契约（SessionPersistPort），core 只负责"写什么"（事件信封在这里生成），
 *      "往哪写"由 app 层的注入件负责（core 从不 import DAO / SQLite）。
 *
 * 广播次数（perf）：一次命令只写一次 store（状态迁移 + 事件追加合并成同一次 setState），
 *   另加 store.pushNotice 自带的一次广播（通知队列本身受 MAX_NOTICES 约束）。
 *
 * @since v3.40（task_091）v3.2a S1。会话域的**组合根接线**（runtime 收到 session.interrupt
 *   时调本模块）是 S3 的事，本单只交付纯逻辑模块 + 单测。
 *   v3.43（task_093 / v3.2a S3）追加**持久化口**（SessionPersistPort，缺省 = 不落库）：
 *   组合根把它注入进来，会话摘要与事件便随写随落库（事件本体只进库，不进广播）。
 *   v3.46（task_100 / v3.2b-B1）追加 **resume（回灌上下文）/ fork（分叉）** 与**事件读口**
 *   （SessionEventReadPort，缺省 = 没有事件源）：
 *   - resume = interrupted → active **并**读事件流构建上下文快照（只认 peer_chat，第一期口径）；
 *   - fork = 新会话 + 复制源会话事件到 atSeq（换 sessionId + seq 重排）+ 'forked' 来源标记；
 *   - 两者都要读事件流 → 故需要一个**读口**（与持久化口同一纪律：core 只认回调契约，不认存储）。
 *   本单是 **core 层**改动：service / hud / mcp 一律不碰（接线在 B2 / B3）。
 */

import { worldStore, type CoreStore } from '../store';
import { MAX_SESSIONS, NOTICE_TTL_MS, type NoticeLevel } from '../types';

import {
  buildContextSnapshot,
  copyEventsForFork,
  resolveForkCutoff,
  type SessionContextSnapshot,
} from './context-replay';
import {
  appendSessionEvent,
  applySessionAction,
  canApplySessionAction,
  canResumeSession,
  capSessionTitle,
  deriveSessionTitle,
  dropClosedSessions,
  forkSessionTitle,
  normalizeSessionParticipants,
  type SessionAction,
} from './machine';
import type {
  CreateSessionInput,
  SessionEvent,
  SessionEventInput,
  SessionEventReadPort,
  SessionEventView,
  SessionPersistPort,
  SessionRecord,
} from './types';

/**
 * 读事件流时的**单页条数**（翻页用）。
 * why 200：与存储层 DAO 的 limit 上限（[1,200]）同值 —— 一次要满，省得反复翻页；
 *   同时它也是"一次最多读这么多条"的内存护栏（core 不做无界读）。
 */
const EVENT_PAGE_LIMIT = 200;

/** 命令/调用被拒的机器可读原因。 */
export type SessionRejectionCode =
  | 'not-found'
  | 'limit-exceeded'
  | 'illegal-transition'
  | 'session-closed'
  /** 该 kind 第一期不支持 resume（目前只有 peer_chat 支持 —— 方案 §8）。 */
  | 'unsupported-kind'
  /** 事件读口未附着：读不到事件流就不做（**不编造**上下文）。 */
  | 'no-event-source';

type CommitResult =
  | {
      readonly ok: true;
      readonly session: SessionRecord;
      readonly event: SessionEvent | null;
    }
  | {
      readonly ok: false;
      readonly code: SessionRejectionCode;
    };

export interface SessionManagerOptions {
  /** 状态持有者；默认 worldStore 单例。单测用 createStore() 隔离。 */
  readonly store?: CoreStore;
  readonly now?: () => number;
  readonly createId?: (prefix: string) => string;
  /** 会话条数上限；默认契约常量 MAX_SESSIONS。 */
  readonly maxSessions?: number;
  /**
   * 持久化口（可选，@since v3.43 / task_093）—— 缺省 = 不落库。
   * why 在 core 留这个口：事件信封由本模块产生（seq / payload / 时间戳都在这里定），
   *   让上层"猜"事件长什么样必然漂移；core 只认**回调契约**，不认存储实现（零 IO 铁律：
   *   本模块从不 import DAO / SQLite，只把已经裁好的信封交出去）。
   * 落库失败只吞掉（不打断会话回路）—— 可用性优先于历史完整性，与注入件同一纪律。
   */
  readonly persist?: SessionPersistPort;
  /**
   * 事件流读取口（可选，@since v3.46 / task_100 / v3.2b-B1）—— 缺省 = 没有事件源。
   *
   * why 需要它：resume（回灌上下文）与 fork（复制时间线）都要**读事件流**，
   *   而事件本体在 session_events 表里（不在 WorldState —— 广播体积必须有界的性能铁律）。
   *   core 零 IO，不认存储实现，故只认这个纯回调契约（与 SessionPersistPort 同一纪律）。
   * 缺省 = resume / fork 直接被拒（**不编造**上下文：没有事件源就恢复不出上文，
   *   与其拿一个空上下文把模型骗了，不如明说"事件源未附着"）。
   */
  readonly read?: SessionEventReadPort;
}

/**
 * resume 的可选参数（@since v3.46 / task_100）。
 */
export interface SessionResumeOptions {
  /**
   * 续跑方（self）的参与者 id —— 决定回灌消息里谁的话算 'assistant'（自己说的）、
   * 谁的话算 'user'（对方说的）。peer_chat 是两个角色互聊，角色必须**相对续跑方**来定。
   * 缺省 = 按参与者顺序（第一个算 user，其余算 assistant）。
   */
  readonly selfParticipantId?: string;
}

/**
 * resume 的产物（@since v3.46 / task_100）—— 互聊引擎据此续跑。
 */
export interface SessionResumeOutcome {
  /** 恢复后的会话（status='active'）。 */
  readonly session: SessionRecord;
  /** 上下文快照（回灌消息列表）。 */
  readonly snapshot: SessionContextSnapshot;
  /** 'resumed' 事件（已落库）；理论上非 null（commit 成功必有事件）。 */
  readonly event: SessionEvent | null;
}

/**
 * fork 的产物（@since v3.46 / task_100）。
 */
export interface SessionForkOutcome {
  /** 新建的会话（status='active'）。 */
  readonly session: SessionRecord;
  /** 来源会话 id。 */
  readonly sourceSessionId: string;
  /** 实际生效的复制截止 seq（缺省 = 源会话最大 seq；越界会夹紧）。 */
  readonly atSeq: number;
  /** 复制的**对话事件**条数（不含新会话自己的 created / forked）。 */
  readonly copiedCount: number;
}

export interface SessionManager {
  readonly store: CoreStore;
  /**
   * 建一条会话（初始 status='active'）。
   * 标题：显式 title 优先，缺省走自动起名（deriveSessionTitle，规则版无 LLM）。
   * 会同时记一条 'created' 事件（seq=1）。
   * 失败返回 null 并上报 Notice（会话数达上限 / store 写入失败）。
   */
  createSession(input: CreateSessionInput): SessionRecord | null;
  /**
   * 追加一条事件（append-only 记账，**不改状态**）。
   * 语义：**静默**——成功与失败都不发 Notice。why：每条消息记一次是高频后台动作，
   * 逐条通知会把通知队列冲垮、盖掉真正该让人看见的消息。代价是"记上了吗"没有即时回执 ——
   * 读方看 session.eventCount / lastEventAt 即可。
   * 返回 null = 没记上（会话不存在 / 已收尾）。
   */
  appendEvent(sessionId: string, input: SessionEventInput): SessionEvent | null;
  /** 中断一条在办会话（active / idle → interrupted），并记一条 'interrupt' 事件。 */
  interruptSession(sessionId: string, reason?: string): SessionRecord | null;
  /** 收尾一条会话（任意非终态 → closed），并记一条 'closed' 事件。 */
  closeSession(sessionId: string, reason?: string): SessionRecord | null;
  /** 恢复一条被中断的会话（interrupted → active），并记一条 'resumed' 事件。 */
  resumeSession(sessionId: string): SessionRecord | null;
  /**
   * **恢复并回灌上下文**（@since v3.46 / task_100 / v3.2b-B1）—— 2b 的 resume。
   *
   * 与 resumeSession（2a）的差别：
   *   - resumeSession 只翻状态位（任何 kind 都行 —— 它是"这一步可不可执行"）；
   *   - resume 是"能不能续跑"：**只认 peer_chat**（方案 §8 第一期口径），
   *     且会**读事件流构建上下文快照**一并返回 —— 引擎据此把上文喂回模型。
   *
   * 前置条件：kind=peer_chat + status=interrupted + 事件读口已附着。
   * 失败返回 null 并上报 Notice（读不到事件流就**不编造**上下文）。
   */
  resume(sessionId: string, options?: SessionResumeOptions): SessionResumeOutcome | null;
  /**
   * **分叉**（@since v3.46 / task_100 / v3.2b-B1）—— 新会话 + 复制源会话事件到 atSeq。
   *
   * 口径（方案 §8「fork = 新会话 + 事件复制到 atSeq」）：
   *   - 新会话：id 新起、participants 继承、title = 源标题 + 分叉标记、status='active'；
   *   - 复制：源会话 seq ≤ atSeq 的**对话事件**换新 sessionId + seq 重排后落库
   *     （不复制 SQLite 原行 —— append-only 自然分叉）；
   *   - 追加一条 'forked' 事件记录来源（payload 含 sourceSessionId / atSeq）。
   *
   * atSeq 缺省 = 全量；越界会被夹到合法区间（见 resolveForkCutoff）。
   * 失败返回 null 并上报 Notice。
   */
  fork(sessionId: string, atSeq?: number): SessionForkOutcome | null;
  /** 静默期结束又开口（idle → active）。不记事件（只是状态位变化）。 */
  activateSession(sessionId: string): SessionRecord | null;
  /** 转入空闲（active → idle）。不记事件（静默阈值命中，不是一件事）。 */
  idleSession(sessionId: string): SessionRecord | null;
}

class Manager implements SessionManager {
  readonly store: CoreStore;

  private readonly now: () => number;
  private readonly createId: (prefix: string) => string;
  private readonly maxSessions: number;
  /** 持久化口（缺省 = null = 不落库）。见 SessionManagerOptions.persist。 */
  private readonly persist: SessionPersistPort | null;
  /** 事件流读取口（缺省 = null = 没有事件源）。见 SessionManagerOptions.read。 */
  private readonly read: SessionEventReadPort | null;
  private seq = 0;

  constructor(options: SessionManagerOptions = {}) {
    this.store = options.store ?? worldStore;
    this.now = options.now ?? ((): number => Date.now());
    this.createId =
      options.createId ?? ((prefix: string): string => `${prefix}_${this.now()}_${++this.seq}`);
    this.maxSessions = options.maxSessions ?? MAX_SESSIONS;
    this.persist = options.persist ?? null;
    this.read = options.read ?? null;
  }

  createSession(input: CreateSessionInput): SessionRecord | null {
    const participants = normalizeSessionParticipants(input.participants);
    const explicit = input.title?.trim() ?? '';
    // 显式标题优先；缺省走规则版自动起名（确定性，无 LLM）。
    const title =
      explicit.length > 0
        ? capSessionTitle(explicit)
        : deriveSessionTitle({ kind: input.kind, participants, firstMessage: input.firstMessage });
    const at = this.now();

    const outcome: { session?: SessionRecord; event?: SessionEvent | null; code?: SessionRejectionCode } = {};
    this.store.setState((state) => {
      const sessions = state.sessions ?? [];
      // 先腾位子：新会话要占 1 格，所以裁到 max-1，且**只丢已关闭的最旧会话**；
      // 全是在办会话时腾不出位置 → 拒绝新建并回 Notice，绝不静默挤掉谁。
      const kept = dropClosedSessions(sessions, this.maxSessions - 1);
      if (kept.length >= this.maxSessions) {
        outcome.code = 'limit-exceeded';
        return state;
      }
      const record: SessionRecord = {
        id: this.createId(`session_${input.kind}`),
        kind: input.kind,
        title,
        participants,
        status: 'active',
        ...(input.refId && input.refId.trim().length > 0 ? { refId: input.refId.trim() } : {}),
        createdAt: at,
        lastEventAt: at,
        closedAt: null,
        eventCount: 0,
      };
      // 建会话事件（seq=1）：事件本体是"发生了什么"，摘要里的 eventCount 从 1 起算。
      const created = appendSessionEvent(record, {
        type: 'created',
        payload: { title, participants },
        createdAt: at,
      });
      const session = created.next;
      outcome.session = session;
      outcome.event = created.event;
      return { ...state, sessions: [...kept, session] };
    });

    const session = outcome.session;
    if (!session) {
      this.notify('warn', rejectionText(outcome.code ?? 'limit-exceeded', this.maxSessions));
      return null;
    }
    // 落库（可选口）：摘要快照 + 建会话事件 —— 事件本体只在库里有，广播里没有（性能铁律）。
    this.persistRecord(session);
    this.persistEvent(outcome.event ?? null);
    this.notify('info', `已开启会话「${session.title}」`);
    return session;
  }

  appendEvent(sessionId: string, input: SessionEventInput): SessionEvent | null {
    const outcome: { event?: SessionEvent; record?: SessionRecord; code?: SessionRejectionCode } = {};
    this.store.setState((state) => {
      const sessions = state.sessions ?? [];
      const index = sessions.findIndex((session) => session.id === sessionId);
      if (index < 0) {
        outcome.code = 'not-found';
        return state;
      }
      const appended = appendSessionEvent(sessions[index], { ...input, createdAt: this.now() });
      if (appended.error || !appended.event) {
        outcome.code = appended.error ?? 'illegal-transition';
        return state;
      }
      const next = sessions.slice();
      next[index] = appended.next;
      outcome.event = appended.event;
      outcome.record = appended.next;
      return { ...state, sessions: next };
    });
    // 落库（可选口）：事件本体 + 摘要快照（计数 / lastEventAt 变了）。
    this.persistEvent(outcome.event ?? null);
    this.persistRecord(outcome.record ?? null);
    // 静默记账：不发 Notice（成功与失败都不发）—— 见接口注释。
    return outcome.event ?? null;
  }

  interruptSession(sessionId: string, reason?: string): SessionRecord | null {
    const at = this.now();
    const result = this.commit(
      sessionId,
      { type: 'interrupt' },
      at,
      { type: 'interrupt', payload: { reason: reason?.trim() || '会话被中断' } }
    );
    return this.finish(result, '已中断会话');
  }

  closeSession(sessionId: string, reason?: string): SessionRecord | null {
    const at = this.now();
    const result = this.commit(
      sessionId,
      { type: 'close', at },
      at,
      { type: 'closed', payload: reason?.trim() ? { reason: reason.trim() } : {} }
    );
    return this.finish(result, '已关闭会话');
  }

  resumeSession(sessionId: string): SessionRecord | null {
    const at = this.now();
    const result = this.commit(sessionId, { type: 'resume' }, at, { type: 'resumed', payload: {} });
    return this.finish(result, '已恢复会话');
  }

  /**
   * 恢复并回灌上下文（2b 的 resume）。
   *
   * 顺序（**先读后写**）：
   *   1. 找会话（不存在 → 拒）；
   *   2. 判准入：kind=peer_chat（第一期口径）+ status=interrupted（canResumeSession 纯查表）；
   *   3. 读事件流全量 → 构建上下文快照（回灌消息列表）；
   *   4. 原子提交：记 'resumed' 事件 + 迁移 interrupted → active；
   *   5. 返回 { session, snapshot, event } —— 引擎拿 snapshot 续跑。
   *
   * why 第 3 步在第 4 步**之前**：快照必须是"恢复前"的上下文（含中断标记），
   *   恢复事件本身是"恢复之后"发生的事，不属于上文。
   * why 读不到事件流就拒（'no-event-source'）：拿空上下文续跑 = 骗模型
   *   （它会以为自己从没聊过）——宁可明说"没有历史可回灌"。
   */
  resume(sessionId: string, options: SessionResumeOptions = {}): SessionResumeOutcome | null {
    const current = this.findSession(sessionId);
    if (!current) {
      this.notify('warn', rejectionText('not-found', this.maxSessions));
      return null;
    }
    if (!canResumeSession(current.kind, current.status)) {
      // 两种拒因要分开说：kind 不支持 vs 状态不对（用户要的处置完全不同）。
      const code: SessionRejectionCode =
        current.kind === 'peer_chat' ? 'illegal-transition' : 'unsupported-kind';
      this.notify('warn', rejectionText(code, this.maxSessions));
      return null;
    }
    const events = this.readAllEvents(sessionId);
    if (!events) {
      this.notify('warn', rejectionText('no-event-source', this.maxSessions));
      return null;
    }
    const snapshot = buildContextSnapshot({
      session: current,
      events,
      ...(options.selfParticipantId === undefined
        ? {}
        : { selfParticipantId: options.selfParticipantId }),
    });
    const at = this.now();
    const result = this.commit(
      sessionId,
      { type: 'resume' },
      at,
      { type: 'resumed', payload: { note: `上下文回灌 ${snapshot.messages.length} 条` } }
    );
    if (!result.ok) {
      this.notify('warn', rejectionText(result.code, this.maxSessions));
      return null;
    }
    this.notify('info', '已恢复会话');
    return { session: result.session, snapshot, event: result.event };
  }

  /**
   * 分叉（2b 的 fork）：新会话 + 复制源会话事件到 atSeq。
   *
   * 顺序：**先读源事件 → 再建新会话 → 最后落库**（源会话全程只读，一个字都不改）。
   * 事件落库口径：新会话自己的 'created'（seq=1，描述**它自己**）+ 复制来的对话事件（seq 重排）
   *   + 'forked'（seq 最后，记录来源）。
   *
   * why 复制时**不继承**源会话的 'created'：分叉出来的是一条**新会话**，
   *   它的历史抽屉要显示自己的标题（历史抽屉按 created 事件的 title 渲染）——
   *   继承源的 created 会让分叉会话显示成源会话的标题。详见 context-replay.ts 的口径注释。
   */
  fork(sessionId: string, atSeq?: number): SessionForkOutcome | null {
    const source = this.findSession(sessionId);
    if (!source) {
      this.notify('warn', rejectionText('not-found', this.maxSessions));
      return null;
    }
    const events = this.readAllEvents(sessionId);
    if (!events) {
      this.notify('warn', rejectionText('no-event-source', this.maxSessions));
      return null;
    }
    const cutoff = resolveForkCutoff(atSeq, events);
    const at = this.now();
    const newId = this.createId(`session_${source.kind}`);
    const title = forkSessionTitle(source.title);
    const participants = [...source.participants];
    // 复制来的对话事件：换新 sessionId + seq 重排（新会话的 created 占 seq=1，故从 2 起）。
    const copied = copyEventsForFork(events, { sessionId: newId, atSeq: cutoff, startSeq: 2 });
    const createdEvent: SessionEvent = {
      sessionId: newId,
      seq: 1,
      type: 'created',
      payload: { title, participants },
      createdAt: at,
    };
    const forkedEvent: SessionEvent = {
      sessionId: newId,
      seq: copied.length + 2,
      type: 'forked',
      payload: { sourceSessionId: source.id, atSeq: cutoff, copiedCount: copied.length },
      createdAt: at,
    };
    const record: SessionRecord = {
      id: newId,
      kind: source.kind,
      title,
      participants,
      status: 'active',
      // refId 继承：分叉出去的仍是同一件事（task_run → 同一个 taskId）。
      ...(source.refId ? { refId: source.refId } : {}),
      createdAt: at,
      lastEventAt: at,
      closedAt: null,
      eventCount: copied.length + 2,
    };

    // 入 store（**一次写入 = 一次广播**；满了就拒，绝不静默挤掉别人）。
    const outcome: { ok: boolean; code?: SessionRejectionCode } = { ok: true };
    this.store.setState((state) => {
      const sessions = state.sessions ?? [];
      const kept = dropClosedSessions(sessions, this.maxSessions - 1);
      if (kept.length >= this.maxSessions) {
        outcome.ok = false;
        outcome.code = 'limit-exceeded';
        return state;
      }
      return { ...state, sessions: [...kept, record] };
    });
    if (!outcome.ok) {
      this.notify('warn', rejectionText(outcome.code ?? 'limit-exceeded', this.maxSessions));
      return null;
    }

    // 落库：摘要快照 + 新会话自己的 created + 复制来的事件 + forked（顺序即 seq 顺序）。
    this.persistRecord(record);
    this.persistEvent(createdEvent);
    for (const event of copied) this.persistEvent(event);
    this.persistEvent(forkedEvent);
    this.notify('info', `已分叉会话「${title}」`);
    return {
      session: record,
      sourceSessionId: source.id,
      atSeq: cutoff,
      copiedCount: copied.length,
    };
  }

  activateSession(sessionId: string): SessionRecord | null {
    // 不记事件：idle → active 只是"又开始说话了"，不是一件值得落库的事。
    return this.finish(this.commit(sessionId, { type: 'activate' }, this.now()), null);
  }

  idleSession(sessionId: string): SessionRecord | null {
    // 不记事件：静默阈值命中同样不是一件事（否则高频静默会把事件表写满）。
    return this.finish(this.commit(sessionId, { type: 'idle' }, this.now()), null);
  }

  /**
   * 找一条会话（store 里没有就是没有 —— **不编造**）。
   */
  private findSession(sessionId: string): SessionRecord | null {
    const sessions = this.store.getState().sessions ?? [];
    return sessions.find((session) => session.id === sessionId) ?? null;
  }

  /**
   * 读某会话的**全量**事件流（seq 正序）。
   *
   * why 要翻页：读口的契约是"一段"（limit + beforeSeq 游标），
   *   一次读只拿到尾部一段 —— 少于一段时继续向前翻，直到取完（beforeSeq 游标向前走）。
   * why 有"无进展就停"的护栏：读口实现若忽略游标，会永远返回同一段 ——
   *   护栏保证最坏情况是"读到的比全量少"，而不是**死循环**（挂死比少读更糟）。
   *
   * @returns 事件流（正序）；**null = 没有事件源**（读口未附着）—— 调用方据此拒绝，
   *   不拿空列表冒充"这段会话没有历史"。
   */
  private readAllEvents(sessionId: string): SessionEventView[] | null {
    const port = this.read;
    if (!port) return null;
    const out: SessionEventView[] = [];
    let beforeSeq: number | undefined;
    for (;;) {
      const page = port.readSessionEvents(
        sessionId,
        beforeSeq === undefined ? { limit: EVENT_PAGE_LIMIT } : { beforeSeq, limit: EVENT_PAGE_LIMIT }
      );
      if (page.length === 0) break;
      const first = page[0]!.seq;
      // 无进展护栏：这一页的头一条不小于上次的游标 = 读口没往前走（死循环风险），停。
      if (beforeSeq !== undefined && first >= beforeSeq) break;
      out.unshift(...page);
      // 这一页没读满 = 后面没有了。
      if (page.length < EVENT_PAGE_LIMIT) break;
      beforeSeq = first;
    }
    return out;
  }

  /**
   * 一次写入跑完「记事件 + 改状态」——**原子**：事件记不上或状态迁移非法，整条作废，
   * 不留半截状态被广播出去（事件与状态必须对得上：记了 'closed' 事件却没收尾是最坏的一种不一致）。
   *
   * 顺序：**先判合法性 → 再记事件 → 最后迁移**。
   *   - 先判合法性：状态不对时要说"这一步不可执行"，而不是被"终态拒收事件"顶掉
   *     （两者都是拒绝，理由不同 —— 见 canApplySessionAction 的注释）；
   *   - 再记事件：事件要在会话**还是非终态**时记（closed 是终态，终态拒收事件），
   *     所以必须排在状态迁移之前 —— 否则 close 永远记不上 'closed' 事件；
   *   - 记事件不改状态（append-only 记账只更摘要），所以最后迁移时合法性依然成立。
   */
  private commit(
    sessionId: string,
    action: SessionAction,
    at: number,
    eventInput?: SessionEventInput
  ): CommitResult {
    const outcome: {
      session?: SessionRecord;
      event?: SessionEvent | null;
      code?: SessionRejectionCode;
    } = {};

    this.store.setState((state) => {
      const sessions = state.sessions ?? [];
      const index = sessions.findIndex((session) => session.id === sessionId);
      if (index < 0) {
        outcome.code = 'not-found';
        return state;
      }

      let current = sessions[index];
      let event: SessionEvent | null = null;

      // 1) 状态合法性先判（纯查表，不改任何东西）。
      if (!canApplySessionAction(current.status, action.type)) {
        outcome.code = 'illegal-transition';
        return state;
      }

      // 2) 记事件（会话此刻仍是非终态）。
      if (eventInput) {
        const appended = appendSessionEvent(current, { ...eventInput, createdAt: at });
        if (appended.error || !appended.event) {
          outcome.code = appended.error ?? 'illegal-transition';
          return state;
        }
        current = appended.next;
        event = appended.event;
      }

      // 3) 状态迁移（此时必然合法）。
      const step = applySessionAction(current, action);
      if (step.error) {
        outcome.code = step.error;
        return state;
      }

      const next = sessions.slice();
      next[index] = step.next;
      outcome.session = step.next;
      outcome.event = event;
      return { ...state, sessions: next };
    });

    if (!outcome.session) {
      return { ok: false, code: outcome.code ?? 'illegal-transition' };
    }
    // 落库（可选口）：状态迁移后写快照；本步记的事件（interrupt / closed / resumed）一并落库。
    this.persistRecord(outcome.session);
    this.persistEvent(outcome.event ?? null);
    return { ok: true, session: outcome.session, event: outcome.event ?? null };
  }

  /**
   * 统一出口：把 commit 的结果变成"返回值 + Notice"。
   * 用户点了没反应是最伤的一种体验 —— 每种被拒都给出人话原因，绝不静默丢弃。
   * successText 为 null 时**成功也不发通知**（静默阈值命中这类后台动作）。
   */
  private finish(result: CommitResult, successText: string | null): SessionRecord | null {
    if (!result.ok) {
      this.notify('warn', rejectionText(result.code, this.maxSessions));
      return null;
    }
    if (successText) this.notify('info', successText);
    return result.session;
  }

  private notify(level: NoticeLevel, text: string): void {
    const at = this.now();
    this.store.pushNotice({
      id: this.createId('notice'),
      level,
      text,
      createdAt: at,
      expiresAt: at + NOTICE_TTL_MS,
    });
  }

  /**
   * 落一条会话摘要快照（可选口；端口缺席 = 不落库）。
   * why 吞掉异常：命令总线是同步的，落库抛错会打断整轮广播 —— 会话域的可用性
   * 优先于历史完整性（WorldState 里还有一份摘要，缺一段历史不致命）。
   */
  private persistRecord(record: SessionRecord | null): void {
    if (!this.persist || !record) return;
    try {
      this.persist.persistSession(record);
    } catch {
      /* 落库失败不打断会话回路（注入件自己记日志）。 */
    }
  }

  /** 落一条会话事件（可选口；端口缺席 = 不落库）。异常处理同 persistRecord。 */
  private persistEvent(event: SessionEvent | null): void {
    if (!this.persist || !event) return;
    try {
      this.persist.persistEvent(event);
    } catch {
      /* 同上：落库失败不打断会话回路。 */
    }
  }
}

/** 被拒原因的人话表述。用户点了没反应是最伤的一种体验 —— 每种被拒都必须有说法。 */
function rejectionText(code: SessionRejectionCode, maxSessions: number): string {
  switch (code) {
    case 'not-found':
      return '会话不存在';
    case 'limit-exceeded':
      return `会话数已达上限（${maxSessions}），请先关闭一些会话`;
    case 'illegal-transition':
      return '当前状态下这一步不可执行（可能已中断、已恢复过或已经收尾）';
    case 'session-closed':
      return '会话已收尾，不能再记录事件';
    case 'unsupported-kind':
      return '这类会话暂不支持恢复续聊（目前只有互聊支持）';
    case 'no-event-source':
      return '会话历史未接入，无法回灌上下文（事件源未附着）';
  }
}

export function createSessionManager(options: SessionManagerOptions = {}): SessionManager {
  return new Manager(options);
}
