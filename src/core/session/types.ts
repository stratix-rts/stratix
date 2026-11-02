/**
 * 文件职责：**会话域（core/session）的类型契约** —— 事件信封（落 session_events 表的本体）、
 *   会话域的入参/载荷类型；并把**总线契约层**的会话类型原样转出。
 *   方案来源：docs/SESSION-PLAN.md §2「域模型（core/session）」。
 * 输入/输出：本文件只有类型声明与本域的条数/长度上限常量，无运行时逻辑。
 * 禁止事项：
 *   1. 写逻辑（起名规则 / 状态裁决 / 事件封装）—— 逻辑在 machine.ts（纯函数）；
 *   2. 把事件本体塞进 WorldState —— 入态的只有摘要（SessionRecord），事件走 session_events 表
 *      （否则 WorldState 会随消息数无限膨胀，违反"广播体积必须有界"的性能铁律）；
 *   3. 依赖 core 之外的层（app / hud / gateway）—— core 只认自己的契约。
 *
 * 为什么 SessionKind / SessionStatus / SessionRecord **定义在 core/types.ts 而不是这里**：
 *   core/types.ts 是总线契约的**叶子文件**（其文件头铁律「禁止事项 1：引入任何 import」——
 *   契约文件必须是依赖图的叶子，任何依赖都会让 world/hud 两层间接耦合）。
 *   而 WorldState.sessions 要引用 SessionRecord —— 契约文件不能 import 子目录，
 *   所以"入态形状"只能住在 core/types.ts；本文件负责**转出**它们，
 *   让 core/session 内部只 import 本文件就能拿到全套会话类型（模块对外只认一个出口）。
 *
 * 分层：types（契约）→ machine（纯逻辑：判相位 / 起名 / 封事件）→ manager（写 store + 上报 Notice）。
 */

import type { SessionKind, SessionRecord, SessionStatus } from '../types';

export type { SessionKind, SessionRecord, SessionStatus };

/**
 * 会话参与者上限。participants 随 WorldState.sessions 全量广播，必须有界；
 * 8 个对「一场互聊 / 一个角色 / 一条 agent 连接」这类会话粒度足够宽松。
 */
export const MAX_SESSION_PARTICIPANTS = 8;

/**
 * 自动标题长度上限（码点）。标题随广播全量下发，必须有界。
 * why 20：够放下「角色对话：未命名任务的执行记录」这种带 kind 前缀的完整短语。
 */
export const MAX_SESSION_TITLE_LEN = 20;

/**
 * 自动标题长度下限（码点）。短于此长度说明标题信息量不足（首条消息只有两个字），
 * 起名时补一段 kind 默认短语 —— 界面上"互聊：hi"这种标题用户看不出是什么。
 */
export const MIN_SESSION_TITLE_LEN = 12;

/** 事件里单条消息的文本上限（码点）。事件本体落库不进广播，但表行仍要有界。 */
export const MAX_SESSION_TEXT_LEN = 4_000;

/** 事件里发言者名字的长度上限（码点）。 */
export const MAX_SESSION_AUTHOR_LEN = 64;

/**
 * 会话事件载荷表：事件类型 → 载荷形状。
 * why 用映射而不是一个大 union：调用方写 `appendEvent(id, { type: 'message', payload: … })` 时，
 * 载荷类型随事件类型自动收窄，漏字段/多字段在编译期就被挡住。
 */
export interface SessionEventPayloadMap {
  /** 会话建立（createSession 时写入，seq=1）。 */
  created: { readonly title: string; readonly participants: readonly string[] };
  /** 一条消息（互聊轮次 / 角色聊天）。 */
  message: { readonly author: string; readonly text: string };
  /** 一轮收束（一轮对话结束时的摘要）。 */
  round: { readonly summary?: string };
  /** 中断标记（超时 / 取消 / 进程死）。 */
  interrupt: { readonly reason: string };
  /** 恢复标记（interrupted → active；上下文续接属 2b，本单只记标记不接上下文）。 */
  resumed: { readonly note?: string };
  /** 收尾（closed）。 */
  closed: { readonly reason?: string };
}

/** 会话事件类型（载荷表的键）。 */
export type SessionEventType = keyof SessionEventPayloadMap;

/**
 * 会话事件信封：{ sessionId, seq, type, payload, createdAt }（方案 §2）。
 * seq **会话内单调递增**（从 1 开始）—— 事件重放 / 分页读取都靠它定序。
 */
export type SessionEvent = {
  [K in SessionEventType]: {
    readonly sessionId: string;
    readonly seq: number;
    readonly type: K;
    readonly payload: SessionEventPayloadMap[K];
    readonly createdAt: number;
  };
}[SessionEventType];

/**
 * 事件草稿（含 createdAt）：machine 层用它封装信封。
 * 判别联合（type 是判别位）—— 收窄后 payload 类型自动跟随。
 */
export type SessionEventDraft = {
  [K in SessionEventType]: {
    readonly type: K;
    readonly payload: SessionEventPayloadMap[K];
    readonly createdAt: number;
  };
}[SessionEventType];

/**
 * 事件入参（**不含** createdAt）：manager 自己取时钟（core 是时间的唯一持有者，
 * 调用方各填各的时间戳会让事件序列和状态里的 lastEventAt 对不上）。
 */
export type SessionEventInput = {
  [K in SessionEventType]: {
    readonly type: K;
    readonly payload: SessionEventPayloadMap[K];
  };
}[SessionEventType];

/**
 * 会话域的**持久化口**（@since v3.43，task_093 / v3.2a S3）——
 *   core 只认这个**纯回调契约**，不认存储实现（core 零 IO 铁律：core 不 import DAO / SQLite）。
 *
 * why 这个口住在 core（而不是 app）：**事件信封由 core/session 的 manager 产生**
 *   （seq 会话内单调、payload 形状、createdAt 都在那里定）。让上层"猜"事件长什么样必然漂移 ——
 *   两份真相的经典形态。上层只负责"往哪写"（DAO / 表结构），core 只负责"写什么"。
 *
 * 实现方在 app 层（app/services/persistence/session-persister.ts 的 SessionPersister
 *   与本口**结构同形**）—— 组合根直接把它注入 manager，无需适配器（接口即契约）。
 * 缺省 = 不落库（端口缺席 → 会话只活在 WorldState 里，历史不进库；缺省即缺省范式）。
 */
export interface SessionPersistPort {
  /** 落一条会话摘要快照（状态一动就 upsert 一次）。 */
  readonly persistSession: (record: SessionRecord) => void;
  /** 落一条会话事件（append-only；事件本体不广播，只进库）。 */
  readonly persistEvent: (event: SessionEvent) => void;
}

/**
 * 建会话入参。
 * kind 决定粒度与接线方式（方案 §2 的接线策略表）；participants 视 kind 分别是
 * characterId / agentId / clientId。
 */
export interface CreateSessionInput {
  readonly kind: SessionKind;
  readonly participants?: readonly string[];
  /** 关联实体 id（task_run → taskId、mission_run → missionId…）；无关联时不出现该键。 */
  readonly refId?: string;
  /** 显式标题；缺省走自动起名（deriveSessionTitle，规则版无 LLM）。 */
  readonly title?: string;
  /**
   * 首条消息原文：**只用于自动起名**，不进事件流。
   * why 不顺手记成 message 事件：同一条消息由调用方 appendEvent 记一次，
   * 这里再记一次就是双写（事件流里会出现两条一模一样的消息）。
   */
  readonly firstMessage?: string;
}
