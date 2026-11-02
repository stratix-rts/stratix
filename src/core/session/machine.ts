/**
 * 文件职责：**会话域（core/session）的纯逻辑层** —— 会话状态机（什么动作能走到哪个状态）、
 *   事件信封封装（seq 会话内单调）、以及历史淘汰（只丢已关闭的最旧会话）。
 *   方案来源：docs/SESSION-PLAN.md §2「域模型 / 状态机」。
 * 输入：当前 SessionRecord + 一个 SessionAction（或事件草稿）。
 * 输出：新的 SessionRecord、事件信封、淘汰后的会话列表。
 * 禁止事项：
 *   1. 碰 store / bus / DOM / 时钟 —— 本文件只算状态，不持有也不写入任何东西（写库在 manager.ts）；
 *   2. 直接修改传入的 record —— 会话态是 immutable，返回新对象；
 *   3. 静默接受非法迁移 —— 非法动作原样返回并带 error，让上层据此上报 Notice（用户点了没反应最伤）；
 *   4. 引入 LLM / 随机数 —— 起名是**规则版**（2a），必须确定性可单测
 *      （LLM 起名是 2b 的可选实现，见 title-provider.ts / app/services/llm-title-provider.ts）；
 *   5. 在这里做**业务**入参守门（标题是否为空、kind 是否被允许）—— 那是 manager 的职责，
 *      两处判定必然漂移；纯归一（参与者去重/截断、文本截断）与状态裁决同在本文件，
 *      免得同一份截断逻辑在两个文件里各写一遍。
 *
 * ★ 自动起名（deriveSessionTitle）**不在本文件**（@since v3.47，task_104）：
 *   它已迁进 title-provider.ts（标题端口的默认实现）—— 规则一字未改，只是住址变了。
 *
 * 相位机（契约词表见 core/types.ts 的 SessionStatus）：
 *   active ──idle────▶ idle ──activate──▶ active
 *     │  ▲              │
 *     │  └──────resume──┴──▶ interrupted ──resume──▶ active
 *     └──interrupt───▶ interrupted
 *   * ──close──▶ closed（终态）
 *   - close 对任何**非终态**都合法；closed 是终态：任何动作都判非法（重复收尾不改写历史）。
 *   - interrupt 只认 active / idle：已经中断的会话再中断是重复标记（拒绝，不改写历史）；
 *   - idle 只认 active：已是 idle 的会话再置 idle 同理（重复标记）；
 *   - activate 只认 idle、resume 只认 interrupted —— 两个动作落点都是 active，但来源不同：
 *     resume 语义是"恢复续聊"（2b 起由 manager.resume 接上下文回灌，机器层只管状态迁移），
 *     activate 语义是"静默期结束又开始说话"。
 *     混成一个动作会让"恢复"与"静默后继续"在审计上分不开（事件流里两种语义长得一样）。
 *
 * @since v3.40（task_091）v3.2a S1：会话域地基（types + 状态机 + manager 纯逻辑）。
 *   组合根接线（S3）不属本文件：core/runtime.ts 何时把 session.interrupt 命令
 *   转交给 manager，是接线任务的事，本模块只保证纯逻辑可单测。
 */

import {
  MAX_SESSION_AUTHOR_LEN,
  MAX_SESSION_OUTPUT_TAIL_LEN,
  MAX_SESSION_PARTICIPANTS,
  MAX_SESSION_STEP_LABEL_LEN,
  MAX_SESSION_TASK_ID_LEN,
  MAX_SESSION_TASK_SUMMARY_LEN,
  MAX_SESSION_TEXT_LEN,
  MAX_SESSION_TITLE_LEN,
  type SessionEvent,
  type SessionEventDraft,
  type SessionKind,
  type SessionRecord,
} from './types';

/** 迁移/追加被拒的机器可读原因。HUD / 单测据此分流，不解析错误字符串。 */
export type SessionErrorCode =
  /** 当前状态不允许这个动作（含重复标记、对终态操作）。 */
  | 'illegal-transition'
  /** 会话已收尾：终态不再收事件（收尾后的历史不再改写）。 */
  | 'session-closed';

export interface SessionTransition {
  /** 迁移成功后的会话；被拒时是**原引用**（调用方据此判定"没变"）。 */
  readonly next: SessionRecord;
  readonly changed: boolean;
  readonly error?: SessionErrorCode;
}

export interface SessionEventTransition {
  /** 追加成功后的会话（含 eventCount / lastEventAt 更新）；被拒时是原引用。 */
  readonly next: SessionRecord;
  /** 封装好的事件信封；被拒时为 null。 */
  readonly event: SessionEvent | null;
  readonly changed: boolean;
  readonly error?: SessionErrorCode;
}

export type SessionAction =
  /** idle → active：静默期结束，又开始说话了。 */
  | { type: 'activate' }
  /** interrupted → active：恢复续聊（上下文回灌由 manager.resume 负责，机器层只管状态迁移）。 */
  | { type: 'resume' }
  /** active → idle：静默阈值命中 / 显式置空闲。 */
  | { type: 'idle' }
  /** active | idle → interrupted：中断（超时 / 取消 / 进程死）。 */
  | { type: 'interrupt' }
  /** 任意非终态 → closed：收尾（盖 closedAt）。 */
  | { type: 'close'; at: number };

/**
 * 状态转移表：**唯一裁决点**。
 * why 用表而不是散在 switch 里：合法/非法转移必须能穷举测试（验收要求"合法+非法各 ≥8 用例"），
 * 表结构让"哪条合法"一眼可查，新增状态时也不会漏掉某条边。
 */
const LEGAL_ACTIONS: Record<SessionRecord['status'], readonly SessionAction['type'][]> = {
  active: ['idle', 'interrupt', 'close'],
  idle: ['activate', 'interrupt', 'close'],
  interrupted: ['resume', 'close'],
  closed: [],
};

/**
 * 这条动作在给定状态下是否合法（查表，不改任何东西）。
 * why 单独一个纯函数：manager 需要**先判合法性、再记事件、最后迁移**的顺序 ——
 * 先记事件的话，终态会话会先撞上"终态拒收事件"，报出来的是"不能记事件"，
 * 而用户真正要知道的是"这一步不可执行"（状态不对）。两者都是拒绝，理由不同。
 */
export function canApplySessionAction(
  status: SessionRecord['status'],
  action: SessionAction['type']
): boolean {
  return LEGAL_ACTIONS[status].includes(action);
}

/** 终态：不再接受任何动作（重复收尾不改写历史）。 */
export function isTerminalSessionStatus(status: SessionRecord['status']): boolean {
  return status === 'closed';
}

/** 在办（未收尾）：会话面板的"进行中"分组与中断按钮的可见性都用它。 */
export function isOpenSessionStatus(status: SessionRecord['status']): boolean {
  return !isTerminalSessionStatus(status);
}

/**
 * **可恢复的会话种类**（@since v3.46，task_100 / v3.2b-B1）—— 第一期只做 peer_chat。
 *
 * why 只做 peer_chat（方案 docs/SESSION-PLAN.md §8「v3.2b 关键决策」）：
 *   互聊是「超时即丢」痛点的本体 —— session_events 就是消息流，回灌即重放；
 *   character_chat 的历史在 chat_messages 表（不搬），恢复 = 打开面板继续聊，本来就有；
 *   task_run / mission_run / shell_link 是 LITE（只记 create/close），没有可回灌的对话内容。
 *   把种类收在这一张表里，新增种类时只改这里（判定散开必然漂移）。
 */
export const RESUMABLE_SESSION_KINDS: readonly SessionKind[] = ['peer_chat'];

/**
 * 这条会话现在**能不能恢复**（kind + 状态双重裁决，纯查表）。
 *
 * why 单独一个纯函数：resume 的准入是「能不能续跑」的业务裁决，
 *   与状态机的「这一步可不可执行」是两件事（前者管 kind，后者管 status）——
 *   合成一个判据，两处判定会各写各的（一边说能恢复、一边说不可执行）。
 */
export function canResumeSession(
  kind: SessionKind,
  status: SessionRecord['status']
): boolean {
  return RESUMABLE_SESSION_KINDS.includes(kind) && canApplySessionAction(status, 'resume');
}

/** 非法迁移：原样返回当前引用 + changed=false，调用方不需要判断"是否变了"。 */
function reject(current: SessionRecord): SessionTransition {
  return { next: current, changed: false, error: 'illegal-transition' };
}

function move(current: SessionRecord, status: SessionRecord['status']): SessionTransition {
  return { next: { ...current, status }, changed: true };
}

/**
 * 状态机本体。纯函数、可穷举测试：非法迁移一律 reject，不抛异常
 * （命令总线是同步的，抛异常会打断一次广播；失败语义由上层转成 Notice）。
 */
export function applySessionAction(current: SessionRecord, action: SessionAction): SessionTransition {
  // 表外即非法：包括"重复标记"（idle→idle、interrupt→interrupted）与"终态再动"。
  if (!canApplySessionAction(current.status, action.type)) return reject(current);

  switch (action.type) {
    case 'activate':
    case 'resume':
      return move(current, 'active');
    case 'idle':
      return move(current, 'idle');
    case 'interrupt':
      return move(current, 'interrupted');
    case 'close':
      // 终态铁律的例外只有一处：closedAt 落最后一次收尾时刻（关掉会话的时间要看得见）。
      return { next: { ...current, status: 'closed', closedAt: action.at }, changed: true };
  }
}

/**
 * 文本截断（上限内原样返回，超限截尾加省略号）。
 * why 统一在这里：事件载荷的自由文本散落在五六个事件类型里，各写一份截断就会各截各的，
 * 同一类事件在不同来源下长度不一致，排查时说不清"到底截没截"。
 */
function capText(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}…`;
}

/**
 * 尾部截断（保留**末** max 个字符，超出则标 truncated）。
 * why 与 capText 分开：输出尾部要的是"最后发生了什么"，从头截会把结论切掉
 * （一份结论在末尾的报告，截头只剩铺垫 —— 留下的恰恰是无用的那部分）。
 */
function capTail(text: string, max: number): { readonly text: string; readonly truncated: boolean } {
  if (text.length <= max) return { text, truncated: false };
  return { text: text.slice(text.length - max), truncated: true };
}

/**
 * 事件草稿归一：自由文本按上限截断、名单按上限截断。
 * why 要归一：事件本体落 session_events 表（不进广播，但仍是**无界增长**的存储），
 * 一条超长消息就能把一行撑爆；载荷是调用方给的，必须在 core 收口。
 */
export function normalizeSessionEventDraft(draft: SessionEventDraft): SessionEventDraft {
  switch (draft.type) {
    case 'created':
      return {
        type: 'created',
        payload: {
          title: capText(draft.payload.title, MAX_SESSION_TITLE_LEN),
          participants: draft.payload.participants.slice(0, MAX_SESSION_PARTICIPANTS),
        },
        createdAt: draft.createdAt,
      };
    case 'message':
      return {
        type: 'message',
        payload: {
          author: capText(draft.payload.author, MAX_SESSION_AUTHOR_LEN),
          text: capText(draft.payload.text, MAX_SESSION_TEXT_LEN),
        },
        createdAt: draft.createdAt,
      };
    case 'round':
      return {
        type: 'round',
        payload:
          draft.payload.summary === undefined
            ? {}
            : { summary: capText(draft.payload.summary, MAX_SESSION_TEXT_LEN) },
        createdAt: draft.createdAt,
      };
    case 'interrupt':
      return {
        type: 'interrupt',
        payload: { reason: capText(draft.payload.reason, MAX_SESSION_TEXT_LEN) },
        createdAt: draft.createdAt,
      };
    case 'resumed':
      return {
        type: 'resumed',
        payload: draft.payload.note === undefined ? {} : { note: capText(draft.payload.note, MAX_SESSION_TEXT_LEN) },
        createdAt: draft.createdAt,
      };
    case 'closed':
      return {
        type: 'closed',
        payload:
          draft.payload.reason === undefined ? {} : { reason: capText(draft.payload.reason, MAX_SESSION_TEXT_LEN) },
        createdAt: draft.createdAt,
      };
    // ---- 分叉标记（@since v3.46，task_100 / v3.2b-B1）----
    // 载荷里的 id / 数字都是**结构化事实**（不是自由文本）：只夹长度，不改内容
    // （sourceSessionId 必须是原样 —— 改了就追不回源会话）。
    case 'forked':
      return {
        type: 'forked',
        payload: {
          sourceSessionId: capText(draft.payload.sourceSessionId, MAX_SESSION_AUTHOR_LEN),
          atSeq: draft.payload.atSeq,
          copiedCount: draft.payload.copiedCount,
        },
        createdAt: draft.createdAt,
      };
    // ---- task_run 全量事件化（@since v3.46，task_105 / v3.2b-B6）----
    // 任务执行路径的埋点事件：开工 / 步骤 / 输出尾部 / 收尾。
    // 归一口径与上面几类一致：**自由文本一律在 core 收口**（载荷是调用方给的，
    // 事件本体落 session_events 表 —— 不收口就是无界行）。
    case 'task_started':
      return {
        type: 'task_started',
        payload: {
          taskId: capText(draft.payload.taskId, MAX_SESSION_TASK_ID_LEN),
          summary: capText(draft.payload.summary, MAX_SESSION_TASK_SUMMARY_LEN),
        },
        createdAt: draft.createdAt,
      };
    case 'step':
      return {
        type: 'step',
        payload: {
          label: capText(draft.payload.label, MAX_SESSION_STEP_LABEL_LEN),
          ...(draft.payload.detail === undefined
            ? {}
            : { detail: capText(draft.payload.detail, MAX_SESSION_TASK_SUMMARY_LEN) }),
        },
        createdAt: draft.createdAt,
      };
    case 'output_tail': {
      // 尾部截断（保留结论）；调用方已标 truncated 时**或**上 —— 两侧任一知道被截过都要留痕。
      const capped = capTail(draft.payload.text, MAX_SESSION_OUTPUT_TAIL_LEN);
      return {
        type: 'output_tail',
        payload: {
          text: capped.text,
          truncated: capped.truncated || draft.payload.truncated === true,
        },
        createdAt: draft.createdAt,
      };
    }
    case 'completed':
      return {
        type: 'completed',
        payload:
          draft.payload.summary === undefined
            ? {}
            : { summary: capText(draft.payload.summary, MAX_SESSION_TASK_SUMMARY_LEN) },
        createdAt: draft.createdAt,
      };
    case 'failed':
      return {
        type: 'failed',
        payload: { reason: capText(draft.payload.reason, MAX_SESSION_TASK_SUMMARY_LEN) },
        createdAt: draft.createdAt,
      };
  }
}

/**
 * 追加一条事件（append-only 记账）—— **不改状态**，只更新摘要计数与时间戳。
 *
 * 规则：
 *   - active / idle / interrupted 都可记：interrupted 之后**允许**继续记事件
 *     （如"恢复尝试"这类中断标记之后的事件）—— 中断不等于封存，会话还要能被查；
 *   - closed 拒绝（error='session-closed'）：收尾后的会话不再改写历史
 *     （同状态机的终态铁律 —— 否则事件重放会造出第二份真相）。
 *   - seq 会话内**单调递增**：从 1 开始，等于追加后的 eventCount（append-only 的必然结果，
 *     两份口径合成一份，不给"计数与序号各算各的"留漂移空间）。
 *
 * 纯函数：at 由调用方给（core 是时间的持有者，本文件不碰时钟）。
 */
export function appendSessionEvent(current: SessionRecord, draft: SessionEventDraft): SessionEventTransition {
  if (isTerminalSessionStatus(current.status)) {
    return { next: current, event: null, changed: false, error: 'session-closed' };
  }
  const normalized = normalizeSessionEventDraft(draft);
  const seq = current.eventCount + 1;
  const event: SessionEvent = { ...normalized, sessionId: current.id, seq };
  return {
    next: { ...current, eventCount: seq, lastEventAt: normalized.createdAt },
    event,
    changed: true,
  };
}

/**
 * 腾位置：只丢**已关闭（closed）**的历史会话，直到能容下 keep 条 —— 与 core/mission 的
 * dropSettledMissions / core/task 的 dropSettledTasks 同一口径（FIFO：最旧的先丢）。
 * **绝不丢在办会话**（active / idle / interrupted）：让一条正在进行的会话静默消失比
 * "拒绝新建"更糟 —— 用户会以为它还在。腾不出位置时由调用方拒绝新建并回 Notice。
 *
 * sessions 按创建顺序排列（新的在后面），所以从头扫第一个 closed 就是**最旧的** closed。
 */
export function dropClosedSessions(
  sessions: readonly SessionRecord[],
  keep: number
): SessionRecord[] {
  const drop = new Set<number>();
  let remaining = sessions.length;
  for (let i = 0; i < sessions.length && remaining > keep; i += 1) {
    if (isTerminalSessionStatus(sessions[i].status)) {
      drop.add(i);
      remaining -= 1;
    }
  }
  return drop.size === 0 ? sessions.slice() : sessions.filter((_, i) => !drop.has(i));
}

/**
 * 标题截断到上限（超限截尾加省略号）。显式标题与自动标题共用一份口径。
 */
export function capSessionTitle(title: string): string {
  if (title.length <= MAX_SESSION_TITLE_LEN) return title;
  return `${title.slice(0, MAX_SESSION_TITLE_LEN - 1)}…`;
}

/**
 * 分叉会话的标题后缀（@since v3.46，task_100 / v3.2b-B1）。
 * why 带标记：分叉出来的会话与源会话**长得一样**的话，面板上分不清哪条是原聊、哪条是分叉。
 */
export const SESSION_FORK_TITLE_SUFFIX = '·分叉';

/**
 * 分叉会话的标题（原标题 + 分叉标记）。
 *
 * why 先给标记**留位**再截原标题：标题有上限（随广播全量下发，必须有界），
 *   若先截原标题再拼标记，标记会被上限截掉 —— 分叉会话就又跟源会话长得一样了
 *   （标记丢失 = 用户看不出这是分叉）。
 */
export function forkSessionTitle(title: string): string {
  const room = Math.max(1, MAX_SESSION_TITLE_LEN - SESSION_FORK_TITLE_SUFFIX.length);
  const base = title.trim();
  const head = base.length <= room ? base : `${base.slice(0, room - 1)}…`;
  return `${head}${SESSION_FORK_TITLE_SUFFIX}`;
}

/**
 * 参与者归一：去重、丢弃空串、截到上限。
 * why 去重：同一参与者重复登记会让"谁在会话里"看着像多了一份；
 * why 截断：participants 随广播全量下发，必须有界。
 */
export function normalizeSessionParticipants(participants: readonly string[] | undefined): string[] {
  if (!participants) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of participants) {
    const id = raw.trim();
    if (id.length === 0 || seen.has(id)) continue;
    if (out.length >= MAX_SESSION_PARTICIPANTS) break;
    seen.add(id);
    out.push(id);
  }
  return out;
}
