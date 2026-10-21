/**
 * 文件职责：聊天抽屉的**视图模型派生与命令构造**（纯逻辑，零 DOM、零依赖）——
 *   把 core/agent-link 投影进 WorldState 的 links / messages（会话 + 消息流 + 连接相位）
 *   派生成抽屉要画的「会话列表 / 消息气泡 / 连接状态」，UI 呈现全部在 chat-drawer.ts。
 *   来源：docs/REFACTOR_PLAN_V3.md §2 panels/ 层级 + §5 总线契约（links / messages / chat.send）；
 *   语义提取自 src/components/AgentChatModal.vue 与 src/composables/useChat.ts（只提取语义，未复制任何实现）。
 * 输入：WorldState 快照 + 面板当前查看的会话 id（**纯展示态**：用户正在看哪段对话，不是业务状态）。
 * 输出：ChatDrawerModel（渲染用）与 HudCommand（派发用）。
 * 禁止事项：
 *   1. 触碰 DOM —— 本文件必须能在 node 环境单测，渲染是 chat-drawer.ts 的事；
 *   2. import world/、phaser、vue、@/stratix-rts —— 铁律；
 *   3. 直接调 core/bus —— 本文件只**构造**命令，派发一律由调用方经 adapter 完成；
 *   4. 本地维护消息 / 相位 —— 连接状态与消息流的唯一真相是 core 写进 WorldState 的投影。
 *      **面板绝不做本地乐观回显**：气泡何时出现、发送是否成功全等 core 回广播，
 *      本地先塞一条会让"到底发出去了没"变得不可排查（core 拒投时面板里那条会变成假消息）；
 *   5. 造数据 —— 会话名、相位、消息全部来自 WorldState；没有会话就显示空态，不填假会话。
 *
 * 关于 chat.send 的 linkId：**每次都显式带上当前会话 id**。core/agent-link 在同时有多个
 *   已连接会话且命令未带 linkId 时会拒绝投递（ambiguous-target，宁可不投也不投错 agent），
 *   抽屉既然已经知道自己看的是哪个会话，就没有理由让 core 去猜。
 */

import type {
  AgentLinkKind,
  AgentLinkPhase,
  AgentLinkView,
  AgentMessageView,
  HudCommand,
  WorldState,
} from '../../core/types';

/** 连接状态的三档色调。渲染层只认这三个值（+ error），不直接读相位。 */
export type ChatTone = 'online' | 'pending' | 'offline' | 'error';

/**
 * 相位的中文标签。词表与 types.ts 的 AgentLinkPhase 一一对应（core 判相位，HUD 只负责念出来）。
 * @since v3.5 —— chat-drawer 落地时新增；AgentLinkPhase 词表本身是 v3.1 冻结的，未改动。
 */
export const PHASE_LABELS: Readonly<Record<AgentLinkPhase, string>> = {
  idle: '未连接',
  connecting: '连接中',
  connected: '在线',
  reconnecting: '重连中',
  closing: '关闭中',
  closed: '已断开',
  error: '连接异常',
};

const PHASE_TONES: Readonly<Record<AgentLinkPhase, ChatTone>> = {
  idle: 'offline',
  connecting: 'pending',
  connected: 'online',
  reconnecting: 'pending',
  closing: 'pending',
  closed: 'offline',
  error: 'error',
};

/**
 * 单会话单次渲染的气泡上限（perf 硬约束：WorldState 每次变更都全量广播，面板不能无脑重建 DOM）。
 * why 取 60 < MAX_AGENT_MESSAGES_PER_LINK(100)：core 已按契约上限裁剪过消息，
 * 面板再截一段是为了让"聊了一整天"的长会话不至于每次广播都重建上百个节点。
 * 超出部分只报条数（"更早的 N 条未显示"），历史回放不在本任务范围内。
 */
export const MAX_VISIBLE_MESSAGES = 60;

/** 会话行。phase 是 core 的裁决，本文件只把它翻译成标签与色调。 */
export interface ChatSessionRow {
  readonly id: string;
  readonly displayName: string;
  readonly kind: AgentLinkKind;
  readonly phase: AgentLinkPhase;
  readonly phaseLabel: string;
  readonly tone: ChatTone;
  /** 是否为当前查看的会话（面板纯展示态）。 */
  readonly active: boolean;
  /** 能否发送：只有 connected 相位发得出去（session 侧对非 connected 直接 reject）。 */
  readonly sendable: boolean;
  /** 相位原因（重连退避提示 / 错误原因）；没有就不显示，不编造。 */
  readonly reason: string | null;
}

/** 一条消息气泡。direction 决定左右与配色，at 决定时间戳（面板不重排、不重写）。 */
export interface ChatMessageRow {
  readonly id: string;
  readonly direction: 'inbound' | 'outbound';
  readonly author: string;
  readonly text: string;
  readonly at: number;
}

export interface ChatDrawerModel {
  /** 会话列表，顺序同 WorldState.links（core 的创建顺序，hud 不擅自重排）。 */
  readonly sessions: readonly ChatSessionRow[];
  /** 当前查看的会话；无会话时 null。 */
  readonly active: ChatSessionRow | null;
  /** 当前会话的消息流（已按 MAX_VISIBLE_MESSAGES 截尾，按时间正序）。 */
  readonly messages: readonly ChatMessageRow[];
  /** 因截尾未渲染的历史条数。 */
  readonly hiddenMessages: number;
  /** 能否发送（= 有会话且该会话已连接）。 */
  readonly canSend: boolean;
  /** 不能发送的原因（人话，直接显示在输入区）；可发送时 null。 */
  readonly sendDisabledReason: string | null;
}

/** 当前该看哪个会话：优先用户选中的；选中的会话已消失时回落到第一个（面板不留在幽灵会话上）。 */
export function resolveActiveLinkId(links: readonly AgentLinkView[], requested: string | null): string | null {
  if (requested !== null && links.some((link) => link.id === requested)) return requested;
  return links.length > 0 ? links[0].id : null;
}

function toSessionRow(link: AgentLinkView, activeId: string | null): ChatSessionRow {
  return {
    id: link.id,
    displayName: link.displayName,
    kind: link.kind,
    phase: link.phase,
    phaseLabel: PHASE_LABELS[link.phase],
    tone: PHASE_TONES[link.phase],
    active: link.id === activeId,
    sendable: link.phase === 'connected',
    reason: link.phaseReason ?? link.lastError,
  };
}

function toMessageRow(message: AgentMessageView): ChatMessageRow {
  return {
    id: message.id,
    direction: message.direction,
    author: message.author,
    text: message.text,
    at: message.at,
  };
}

/** 发送按钮禁用理由：说清楚"为什么发不出去"，而不是只把按钮变灰。 */
function disabledReasonFor(row: ChatSessionRow | null): string | null {
  if (!row) return '还没有外部 agent 会话';
  if (row.sendable) return null;
  const reason = row.reason ? `：${row.reason}` : '';
  return `${row.displayName} ${row.phaseLabel}${reason}`;
}

/**
 * WorldState → 抽屉视图模型（纯函数，可脱离 DOM 单测）。
 * why 消息按会话过滤而不是全量渲染：多会话并行时，用户眼前只有当前那段对话，
 * 别的 agent 的消息进 WorldState 也不该在这块面板上冒出来。
 */
export function resolveChatDrawer(state: WorldState | null, requestedLinkId: string | null): ChatDrawerModel {
  const links = state?.links ?? [];
  const allMessages = state?.messages ?? [];
  const activeId = resolveActiveLinkId(links, requestedLinkId);
  const active = links.find((link) => link.id === activeId) ?? null;
  const row = active === null ? null : toSessionRow(active, activeId);

  const sessionMessages = activeId === null ? [] : allMessages.filter((message) => message.linkId === activeId);
  const hidden = Math.max(0, sessionMessages.length - MAX_VISIBLE_MESSAGES);
  const messages = sessionMessages
    .slice(Math.max(0, sessionMessages.length - MAX_VISIBLE_MESSAGES))
    .map(toMessageRow);

  return {
    sessions: links.map((link) => toSessionRow(link, activeId)),
    active: row,
    messages,
    hiddenMessages: hidden,
    canSend: row?.sendable === true,
    sendDisabledReason: disabledReasonFor(row),
  };
}

/**
 * 渲染判重签名（纯字符串拼接）。
 * 只包含影响本面板显示的东西：会话 id/相位/名字 + **当前会话**的消息 + 当前查看的会话 id。
 * why 不含其它会话的消息：那些消息变了本面板一个像素都不会动，
 * 让它们进签名等于把"别人在聊天"也变成我这边的重渲染（perf）。
 * why 不含消息时间戳之外的字段：at 只影响时间戳显示，不入签名以免噪声。
 */
export function chatDrawerSignature(state: WorldState | null, requestedLinkId: string | null): string {
  if (!state) return '';
  const links = state.links;
  const activeId = resolveActiveLinkId(links, requestedLinkId);
  const head = links.map((link) => `${link.id}:${link.phase}:${link.displayName}`).join('|');
  const tail = activeId === null
    ? ''
    : state.messages
        .filter((message) => message.linkId === activeId)
        .map((message) => `${message.id}:${message.direction}:${message.at}:${message.text}`)
        .join('|');
  return `${activeId ?? '-'}#${head}#${tail}`;
}

/**
 * 组装一条 HudCommand('chat.send')。构造不出来（空消息 / 没有目标会话）就返回 null，
 * 调用方据此什么都不发 —— 不发半截命令给 core。
 */
export function buildChatSendCommand(text: string, linkId: string | null): HudCommand | null {
  const trimmed = text.trim();
  if (trimmed.length === 0) return null;
  if (linkId === null || linkId.length === 0) return null;
  return { type: 'chat.send', text: trimmed, linkId };
}

/** 时间戳格式化：只出 时:分（消息粒度够用，也不让长文本挤掉气泡内容）。 */
export function formatMessageTime(at: number): string {
  const date = new Date(at);
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}