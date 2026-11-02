/**
 * 文件职责：**会话事件流的派生读面**（core/session/context-replay.ts）—— 两件同源的事：
 *   ① **上下文快照构建器**：session_events（读面事件流）→ **回灌消息列表**
 *      （resume 续跑时喂给互聊引擎的"上文"）；
 *   ② **分叉复制器**：源会话事件流 → **新会话的可落库事件**（换 sessionId + seq 重排）。
 *   方案来源：docs/SESSION-PLAN.md §8「v3.2b 关键决策」（resume 回灌上下文 / fork = 新会话 + 事件复制到 atSeq）。
 * 输入：读面事件（SessionEventView —— payload 是 unknown）+ 会话摘要（SessionRecord）。
 * 输出：SessionContextSnapshot（回灌消息列表）/ SessionEvent[]（写面事件，可直接落库）。
 * 禁止事项：
 *   1. 碰 store / bus / 存储 / 时钟 —— 本文件是**纯函数**（时刻一律取自事件自带的 createdAt）；
 *   2. 把读面事件（payload: unknown）原样塞进写面 —— 载荷必须**按 type 收窄**后才算写面事件
 *      （读面不校验形状：库里可能有旧版本写下的脏行，脏行不能污染写面）；
 *   3. 猜词表外的事件含义 —— 不认识的事件类型一律**跳过**
 *      （回灌里塞一句编出来的消息，比少一条更伤：引擎会拿它当上下文）；
 *   4. 无界增长 —— 回灌消息条数有上限（MAX_SESSION_REPLAY_MESSAGES），只保留最近若干条。
 *
 * why 把"读面 → 写面"的收窄也放在本文件：回灌与复制**共用同一份载荷知识**
 *   （哪种 type 的 payload 长什么样、哪些字段是字符串、哪些是会话生命周期事实），
 *   两处各写一份必然漂移 —— 漂移的后果是"回灌出来的消息与落库的消息对不上"。
 *
 * 分层：types（契约）→ machine（纯逻辑：状态机 / 起名）→ **context-replay（事件流派生：纯函数）**
 *   → manager（写 store + 上报 Notice）。
 */

import type {
  SessionEvent,
  SessionEventPayloadMap,
  SessionEventView,
  SessionRecord,
} from './types';

/**
 * 回灌消息条数上限（默认）。
 * why 要有上限：回灌列表要整体塞进模型的上下文，无界 = 无界 token 账单 + 无界延迟。
 * why 默认 200：与长会话压缩的触发阈值（eventCount>200）同量级 —— 一屏对话的密度。
 */
export const MAX_SESSION_REPLAY_MESSAGES = 200;

/** 回灌消息的角色（喂给模型的标准三角色）。 */
export type SessionReplayRole = 'user' | 'assistant' | 'system';

/** 回灌消息的来源事件类型（只有内容型事件会进回灌）。 */
export type SessionReplayKind = 'message' | 'round' | 'interrupt';

/**
 * 一条回灌消息（= 一条内容型会话事件翻译成的模型输入）。
 *
 * why 带 seq：回灌是"从事件流重建上文"，出问题时能回指到具体那条事件
 *   （"第 7 条回灌消息对应事件 seq=9"），排查不用猜。
 */
export interface SessionReplayMessage {
  /** 来源事件的 seq（会话内单调序号）。 */
  readonly seq: number;
  /** 模型角色：自己说的话 = assistant，对方的话 = user，轮次 / 中断标记 = system。 */
  readonly role: SessionReplayRole;
  /** 发言者原文（系统标记事件用固定署名）。 */
  readonly author: string;
  /** 正文（模型直接吃的文本）。 */
  readonly content: string;
  /** 事件时刻（毫秒）。 */
  readonly at: number;
  /** 来源事件类型。 */
  readonly kind: SessionReplayKind;
}

/**
 * 上下文快照（resume 的产物）—— 互聊引擎据此续跑。
 */
export interface SessionContextSnapshot {
  /** 会话 id。 */
  readonly sessionId: string;
  /** 参与者（继承自会话摘要）。 */
  readonly participants: readonly string[];
  /** 回灌消息列表（按事件正序 = 时间正序）。 */
  readonly messages: readonly SessionReplayMessage[];
  /** 参与构建的事件条数（映射**前**的条数 —— 便于对照事件流排查）。 */
  readonly eventCount: number;
  /** 是否因上限被截断（只保留了最近若干条）。 */
  readonly truncated: boolean;
  /** 被丢弃的消息条数（truncated 时 > 0）。 */
  readonly droppedCount: number;
}

/** 角色裁决器：由发言者名 → 模型角色。 */
export type SessionReplayRoleResolver = (author: string) => SessionReplayRole;

/**
 * 造角色裁决器。
 *
 * 口径：
 *   - 给了 selfParticipantId（谁在续跑）：**自己**的话 = 'assistant'，别人的话 = 'user'
 *     （peer_chat 是两个角色互聊，续跑方只可能是一方，角色必须相对续跑方来定）；
 *   - 没给：按参与者顺序 —— 第一个算 'user'，其余算 'assistant'；
 *   - 非参与者发言（外部插话）：按 'user'（输入侧）。
 */
export function createReplayRoleResolver(
  participants: readonly string[],
  selfParticipantId?: string
): SessionReplayRoleResolver {
  if (selfParticipantId) {
    return (author: string): SessionReplayRole =>
      author === selfParticipantId ? 'assistant' : 'user';
  }
  return (author: string): SessionReplayRole => {
    const index = participants.indexOf(author);
    if (index === 0) return 'user';
    if (index > 0) return 'assistant';
    return 'user';
  };
}

/** 载荷 → 记录（读面 payload 是 unknown，先收成记录再按字段取）。 */
function asRecord(payload: unknown): Record<string, unknown> {
  return payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {};
}

/** 取字符串字段（非字符串 → 空串）。 */
function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/**
 * 单条事件 → 回灌消息（null = 这条事件不是回灌内容）。
 *
 * 映射口径（消息 / 轮次 / 中断标记三类内容型事件）：
 *   - message   → 正文即内容，角色由发言者决定；
 *   - round     → 轮次收束摘要，作为系统标记（"（一轮对话收束：…）"）；
 *   - interrupt → 中断标记，作为系统标记（"（互聊中断：原因）"，与历史抽屉同一措辞口径）。
 * **会话生命周期事件（created / resumed / closed / forked）不回灌**：
 *   它们描述的是"会话本身"，不是"聊了什么" —— 回灌上下文只该有对话内容。
 */
function toReplayMessage(
  event: SessionEventView,
  roleOf: SessionReplayRoleResolver
): SessionReplayMessage | null {
  const payload = asRecord(event.payload);
  switch (event.type) {
    case 'message': {
      const text = asString(payload.text);
      // 空正文不回灌：模型拿到一条空消息只会占位置不产出内容。
      if (text.length === 0) return null;
      const author = asString(payload.author);
      return {
        seq: event.seq,
        role: roleOf(author),
        author,
        content: text,
        at: event.createdAt,
        kind: 'message',
      };
    }
    case 'round': {
      const summary = asString(payload.summary);
      return {
        seq: event.seq,
        role: 'system',
        author: '轮次',
        content: summary.length > 0 ? `（一轮对话收束：${summary}）` : '（一轮对话收束）',
        at: event.createdAt,
        kind: 'round',
      };
    }
    case 'interrupt': {
      const reason = asString(payload.reason);
      return {
        seq: event.seq,
        role: 'system',
        author: '中断',
        content: `（互聊中断：${reason.length > 0 ? reason : '会话被中断'}）`,
        at: event.createdAt,
        kind: 'interrupt',
      };
    }
    default:
      // 生命周期事件 / 词表外事件：不是回灌内容（不猜它的含义）。
      return null;
  }
}

/**
 * 构建上下文快照（session_events → 回灌消息列表）。
 *
 * @param input.session 会话摘要（参与者决定角色归属）。
 * @param input.events 读面事件流（正序）。
 * @param input.selfParticipantId 续跑方（谁在续跑）—— 决定谁的话算 'assistant'。
 * @param input.maxMessages 回灌条数上限（缺省 MAX_SESSION_REPLAY_MESSAGES）。
 *
 * why 只保留**最近**若干条：续跑关心的是"刚才聊到哪"，最老的对话对当下几乎没有约束力；
 *   留头丢尾（保留最早 N 条）会让模型接不上最近的话题。
 *   被丢掉多少条记在 droppedCount 里 —— 截断是**显式的**，不装作"这就是全部"。
 */
export function buildContextSnapshot(input: {
  readonly session: SessionRecord;
  readonly events: readonly SessionEventView[];
  readonly selfParticipantId?: string;
  readonly maxMessages?: number;
}): SessionContextSnapshot {
  const limit = Math.max(1, Math.floor(input.maxMessages ?? MAX_SESSION_REPLAY_MESSAGES));
  const roleOf = createReplayRoleResolver(
    input.session.participants,
    input.selfParticipantId
  );
  const all: SessionReplayMessage[] = [];
  for (const event of input.events) {
    const mapped = toReplayMessage(event, roleOf);
    if (mapped) all.push(mapped);
  }
  const kept = all.length > limit ? all.slice(all.length - limit) : all;
  return {
    sessionId: input.session.id,
    participants: [...input.session.participants],
    messages: kept,
    eventCount: input.events.length,
    truncated: kept.length < all.length,
    droppedCount: all.length - kept.length,
  };
}

/** 分叉复制的选项。 */
export interface ForkCopyOptions {
  /** 新会话 id（复制出来的事件挂在这个会话下）。 */
  readonly sessionId: string;
  /** 复制到该 seq（含）；缺省 = 全量。 */
  readonly atSeq?: number;
  /** 起始 seq（缺省 1）—— 新会话若已有自己的 created 事件，从 2 起排。 */
  readonly startSeq?: number;
}

/**
 * 哪些事件**不随分叉继承**：会话生命周期事实。
 *
 * why 不继承：分叉出来的是**一条新会话**，它有自己的生命周期
 *   （created 由分叉产生、closed 由将来产生）—— 继承源的 created 会让同一会话出现两条 created，
 *   且其中一条描述的是**源会话的标题**（历史抽屉按 created 的 title 渲染，会把源标题显示成分叉标题）；
 *   继承源的 closed 则会让"仍在进行中"的分叉会话带着一条收尾记录。
 *   **对话事实**（message / round / interrupt）才是分叉要继承的东西。
 */
const NON_INHERITED_EVENT_TYPES: readonly string[] = ['created', 'resumed', 'closed', 'forked'];

/**
 * 单条读面事件 → 写面事件（载荷按 type 收窄；null = 不复制这条）。
 *
 * why 要收窄：读面 payload 是 unknown（读路径不替库做判断），写面是判别联合
 *   —— 落库前必须把形状校正到 core 的契约里，脏行（缺字段 / 类型不对）不能污染新会话的时间线。
 */
function toWritableEvent(
  event: SessionEventView,
  sessionId: string,
  seq: number
): SessionEvent | null {
  if (NON_INHERITED_EVENT_TYPES.includes(event.type)) return null;
  const payload = asRecord(event.payload);
  switch (event.type) {
    case 'message': {
      const text = asString(payload.text);
      if (text.length === 0) return null;
      const author = asString(payload.author);
      return {
        sessionId,
        seq,
        type: 'message',
        payload: { author, text },
        createdAt: event.createdAt,
      };
    }
    case 'round': {
      const summary = asString(payload.summary);
      const roundPayload: SessionEventPayloadMap['round'] =
        summary.length > 0 ? { summary } : {};
      return { sessionId, seq, type: 'round', payload: roundPayload, createdAt: event.createdAt };
    }
    case 'interrupt': {
      const reason = asString(payload.reason);
      return {
        sessionId,
        seq,
        type: 'interrupt',
        payload: { reason: reason.length > 0 ? reason : '会话被中断' },
        createdAt: event.createdAt,
      };
    }
    default:
      // 词表外的事件类型：写面联合里没有它 → 不复制（不编造形状）。
      // 新增内容型事件时，这里要同步加一条（否则分叉会静默丢掉它）。
      return null;
  }
}

/**
 * 分叉复制：源会话事件流 → 新会话的可落库事件（换 sessionId + seq 重排）。
 *
 * 口径：
 *   - 只复制 seq ≤ atSeq 的事件（缺省 atSeq = 全量）；
 *   - **重排**：复制出来的事件按新会话从 startSeq 起连续编号（seq 会话内单调 —— 写面契约）；
 *   - 不继承会话生命周期事件（见 NON_INHERITED_EVENT_TYPES）；
 *   - 载荷按 type 收窄（读面 unknown → 写面判别联合），收窄不通过的那条**跳过**。
 *
 * @returns 写面事件列表（已按 seq 排好）；空数组 = 没有可继承的对话事实。
 */
export function copyEventsForFork(
  events: readonly SessionEventView[],
  options: ForkCopyOptions
): SessionEvent[] {
  const cutoff =
    options.atSeq === undefined || !Number.isFinite(options.atSeq)
      ? Number.POSITIVE_INFINITY
      : options.atSeq;
  let seq = Math.max(1, Math.floor(options.startSeq ?? 1));
  const out: SessionEvent[] = [];
  // 正序（读面约定是正序，但复制要按 seq 语义处理，自己排一次更稳）。
  const ordered = [...events].sort((a, b) => a.seq - b.seq);
  for (const event of ordered) {
    if (event.seq > cutoff) continue;
    const copied = toWritableEvent(event, options.sessionId, seq);
    if (!copied) continue;
    out.push(copied);
    seq += 1;
  }
  return out;
}

/**
 * 分叉截止 seq 的实际取值（把调用方给的值夹到合法区间）。
 *
 * 口径：缺省 = 源会话的最大 seq（全量）；小于 0 夹到 0（分叉在起点之前 = 不继承任何对话）；
 *   超过最大 seq 夹到最大（"分叉到末尾"= 全量）。
 */
export function resolveForkCutoff(
  atSeq: number | undefined,
  events: readonly SessionEventView[]
): number {
  const maxSeq = events.reduce((max, event) => (event.seq > max ? event.seq : max), 0);
  if (atSeq === undefined || !Number.isFinite(atSeq)) return maxSeq;
  const floored = Math.floor(atSeq);
  if (floored < 0) return 0;
  return floored > maxSeq ? maxSeq : floored;
}
