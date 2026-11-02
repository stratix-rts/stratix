/**
 * 文件职责：**会话域（core/session）的纯逻辑层** —— 会话状态机（什么动作能走到哪个状态）、
 *   事件信封封装（seq 会话内单调）、自动起名（规则版）、以及历史淘汰（只丢已关闭的最旧会话）。
 *   方案来源：docs/SESSION-PLAN.md §2「域模型 / 状态机」。
 * 输入：当前 SessionRecord + 一个 SessionAction（或事件草稿 / 起名入参）。
 * 输出：新的 SessionRecord、事件信封、起好的标题、淘汰后的会话列表。
 * 禁止事项：
 *   1. 碰 store / bus / DOM / 时钟 —— 本文件只算状态，不持有也不写入任何东西（写库在 manager.ts）；
 *   2. 直接修改传入的 record —— 会话态是 immutable，返回新对象；
 *   3. 静默接受非法迁移 —— 非法动作原样返回并带 error，让上层据此上报 Notice（用户点了没反应最伤）；
 *   4. 引入 LLM / 随机数 —— 起名是**规则版**（2a），必须确定性可单测（LLM 起名是 2b 的事）；
 *   5. 在这里做**业务**入参守门（标题是否为空、kind 是否被允许）—— 那是 manager 的职责，
 *      两处判定必然漂移；纯归一（参与者去重/截断、文本截断）与状态裁决同在本文件，
 *      免得同一份截断逻辑在两个文件里各写一遍。
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
 *     resume 语义是"恢复续聊"（2b 才接上下文回灌），activate 语义是"静默期结束又开始说话"。
 *     混成一个动作会让"恢复"与"静默后继续"在审计上分不开（事件流里两种语义长得一样）。
 *
 * @since v3.40（task_091）v3.2a S1：会话域地基（types + 状态机 + manager 纯逻辑）。
 *   组合根接线（S3）不属本文件：core/runtime.ts 何时把 session.interrupt 命令
 *   转交给 manager，是接线任务的事，本模块只保证纯逻辑可单测。
 */

import {
  MAX_SESSION_AUTHOR_LEN,
  MAX_SESSION_PARTICIPANTS,
  MAX_SESSION_TEXT_LEN,
  MAX_SESSION_TITLE_LEN,
  MIN_SESSION_TITLE_LEN,
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
  /** interrupted → active：恢复续聊（2b 才接上下文回灌，本单只翻状态）。 */
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

/** 标题的 kind 前缀（决定会话是"角色对话"还是"互聊"——用户一眼要能分清）。 */
const KIND_LABEL: Record<SessionKind, string> = {
  character_chat: '角色对话',
  peer_chat: '互聊',
  task_run: '任务执行',
  mission_run: '任务单',
  shell_link: '命令行',
};

/**
 * kind 的默认短语：首条消息太短、或压根没有消息时兜底（保证标题落在 [12,20] 区间，
 * 且每种 kind 的兜底文案都自解释）。
 */
const KIND_DEFAULT_BODY: Record<SessionKind, string> = {
  character_chat: '与未命名角色的会话',
  peer_chat: '与未命名对象的会话',
  task_run: '未命名任务的执行记录',
  mission_run: '未命名任务单的运行记录',
  shell_link: '未命名连接的会话记录',
};

/** 压掉换行与连续空白：标题是单行文本，多行会把面板撑开。 */
function collapseWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * 自动起名（2a 规则版）—— **纯函数、确定性、无 LLM**。
 *
 * 规则：`kind 前缀 + '：' + 主体`，整体截到 [12,20] 码点。
 *   主体优先取**首条消息**（首行、压空白）；没有首条消息时取参与者（用 '、' 连接）。
 *   两者都没有（或拼出来太短）→ 补 kind 的默认短语。
 *
 * why 要有下限 12：面板上一行放不下太短的标题，而"互聊：hi"这种标题用户看不出是什么会话；
 * why 要有上限 20：标题随 WorldState 全量广播，必须有界。
 * why 不用 LLM：2a 是规则版 —— 起名要可单测、可复现（同一个会话两次算出同一个标题），
 *   LLM 起名放 2b（那时才谈质量与成本）。
 */
export function deriveSessionTitle(input: {
  readonly kind: SessionKind;
  readonly participants?: readonly string[];
  readonly firstMessage?: string;
}): string {
  const label = KIND_LABEL[input.kind];
  const fallback = KIND_DEFAULT_BODY[input.kind];
  const message = input.firstMessage ? collapseWhitespace(input.firstMessage) : '';
  const participants = (input.participants ?? []).filter((p) => p.length > 0).join('、');
  const body = message.length > 0 ? message : participants;

  let title = body.length > 0 ? `${label}：${body}` : `${label}：${fallback}`;
  // 主体太短 → 补默认短语（信息量不足的标题在界面上没有辨识度）。
  if (title.length < MIN_SESSION_TITLE_LEN) {
    title = `${label}：${body} · ${fallback}`;
  }
  return capSessionTitle(title);
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
