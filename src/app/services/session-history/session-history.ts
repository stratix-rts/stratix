/**
 * 文件职责：**会话历史的读面**（v3.2a S5 / task_095）—— HUD 会话面板「历史抽屉」的两路真 IO：
 *   ① character_chat → 角色对话历史（chat_messages 表；经 preload 的 gameSave 通道读）；
 *   ② peer_chat / task_run → 会话事件流（session_events 表；经 service 的只读 REST 读）。
 *   另两路（mission_run → 任务单详情引用 / shell_link → 命令行消息投影）**不走 IO** ——
 *   它们的真相就在 WorldState 里，由 hud 面板直接投影（见 hud/panels/session-catalog.ts）。
 * 输入：preload 的 gameSave 原始面（经 chatHistoryApi() 适配）+ service 的 HTTP 只读 API。
 * 输出：与 hud 侧契约**结构同形**的读取口（SessionHistoryPort）。
 * 禁止事项：
 *   1. 在这里写库 —— 存储件独占写是铁律 6；本文件只读；
 *   2. 编造历史 —— 读不到就报错/不提供该路，绝不返回占位条目；
 *   3. import hud —— 依赖方向不倒挂（与 core/session 的 SessionPersistPort ↔ 本层同款做法：
 *      两边各写各的形状，结构同形，组合根接线时由类型系统对齐）；
 *   4. 在这里跑轮询 / 定时器 —— 读历史只在用户点开抽屉时发生一次（分页另算）。
 *
 * why 角色对话与会话事件走两条不同的路：它们**本来就在两张不同的表里**
 *   （渐进迁移铁律：旧表不搬）。会话域只为互聊（peer_chat）补了全量事件流，
 *   角色对话的事件本体仍在 chat_messages 表 —— 面板按 kind 路由到各自那张表。
 *
 * @since v3.43（task_095 / v3.2a S5）。
 */

import { chatHistoryApi, chatHistoryEntryToDrawerInput, type ChatHistoryApi } from '../persistence/chat-history';
import type { PersistedChatMessage } from '../persistence/chat-history-dao';

/**
 * 历史条目（与 hud/panels/session-catalog.ts 的 SessionHistoryEntry **结构同形**）。
 * why 各写各的：app 层不 import hud（依赖方向不倒挂）；两边形状一致 → 组合根直接接线，
 *   类型系统会替我们守住不兼容。
 */
export interface SessionHistoryEntry {
  /** 行 id（同一抽屉内唯一）。 */
  readonly id: string;
  /** 翻页游标（不透明字符串：原样回传给下一次「加载更早」）。 */
  readonly cursor: string;
  /** 事件时刻（毫秒）。 */
  readonly at: number;
  /** 发言人 / 来源。 */
  readonly author: string;
  /** 正文。 */
  readonly text: string;
  /** 语气（普通 / 警示 / 错误）。 */
  readonly tone: 'normal' | 'warn' | 'error';
}

/**
 * 历史读取口（与 hud/panels/session-catalog.ts 的 SessionHistoryPort **结构同形**）。
 * 两个方法都是可选的：**读取器缺席时面板说"未附着"**（不显示假数据）。
 */
export interface SessionHistoryPort {
  /** 角色对话历史（character_chat）。 */
  readonly loadCharacterChat?: (
    characterId: string,
    limit: number,
    before?: string
  ) => Promise<readonly SessionHistoryEntry[]>;
  /** 会话事件流（peer_chat / task_run）。 */
  readonly loadSessionEvents?: (
    sessionId: string,
    limit: number,
    before?: string
  ) => Promise<readonly SessionHistoryEntry[]>;
}

/** service 的 HTTP 基址缺省值（本机 gateway 的 HTTP server，dev 下 PORT=7524）。 */
export const DEFAULT_SESSION_HISTORY_BASE_URL = 'http://127.0.0.1:7524';

/**
 * world-sync 端点 → service 的 HTTP 基址（ws://127.0.0.1:7524/ws/world-sync → http://127.0.0.1:7524）。
 * why 需要这层换算：远程模式下渲染层只知道 world-sync 的 ws 地址，
 *   而会话历史读的是同一台 service 上的 HTTP 只读 API —— 两者同源，换协议即可。
 */
export function httpBaseFromWorldSyncUrl(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.protocol = parsed.protocol === 'wss:' ? 'https:' : 'http:';
    parsed.pathname = '';
    parsed.search = '';
    parsed.hash = '';
    return parsed.toString().replace(/\/+$/, '');
  } catch {
    return DEFAULT_SESSION_HISTORY_BASE_URL;
  }
}

/** 造读取口时的可选项。 */
export interface SessionHistoryPortOptions {
  /** service 的 HTTP 基址（读 API 挂在这里）；缺省 = 本机 gateway。 */
  readonly baseUrl?: string;
  /** 角色对话历史通道；缺省 = 自动探测 preload 面（探测不到 = 该路未附着）。 */
  readonly chatHistory?: ChatHistoryApi | null;
  /** fetch 实现（单测注入假 fetch；缺省 = 全局 fetch）。 */
  readonly fetchImpl?: typeof fetch;
}

/** 角色名（角色对话的行署名）。 */
const CHAT_ROLE_LABELS: Record<string, string> = {
  user: '我',
  assistant: '角色',
  peer: '对方',
  system: '系统',
};

/**
 * 会话事件 → 历史条目（事件信封 → 展示行）。
 * why 在这层翻译而不是让面板认事件形状：事件是**存储层**的形状（type + payload），
 *   面板要的是"谁说了什么" —— 翻译是数据面的事。
 */
export function sessionEventToEntry(
  event: { readonly sessionId: string; readonly seq: number; readonly type: string; readonly payload: unknown; readonly createdAt: number }
): SessionHistoryEntry {
  const payload = (event.payload ?? {}) as Record<string, unknown>;
  const text = (key: string): string => {
    const value = payload[key];
    return typeof value === 'string' ? value : '';
  };
  const base = { id: `${event.sessionId}#${event.seq}`, cursor: String(event.seq), at: event.createdAt };
  switch (event.type) {
    case 'created':
      return { ...base, author: '建立', text: `会话「${text('title')}」建立`, tone: 'normal' };
    case 'message':
      return { ...base, author: text('author') || '发言', text: text('text'), tone: 'normal' };
    case 'round':
      return { ...base, author: '轮次', text: text('summary') || '一轮对话结束', tone: 'normal' };
    case 'interrupt':
      return { ...base, author: '中断', text: text('reason') || '会话被中断', tone: 'warn' };
    case 'resumed':
      return { ...base, author: '恢复', text: text('note') || '会话已恢复', tone: 'normal' };
    case 'closed':
      return { ...base, author: '收尾', text: text('reason') || '会话已结束', tone: 'normal' };
    default:
      // 词表外的事件类型：如实显示类型名 + 原始载荷（不猜它的含义）。
      return {
        ...base,
        author: event.type,
        text: safeStringify(payload),
        tone: 'normal',
      };
  }
}

/** 载荷转字符串（词表外事件类型的兜底展示）。 */
function safeStringify(payload: unknown): string {
  try {
    return JSON.stringify(payload) ?? '';
  } catch {
    return '[无法展示的载荷]';
  }
}

/**
 * 角色对话库行 → 历史条目。
 * peer 前缀（`[peer:{id}] `）与旧 error 行的翻译**复用** chat-history.ts 的既有口径
 *   （chatHistoryEntryToDrawerInput）—— 同一个前缀在抽屉里怎么剥，这里就怎么剥，
 *   不搞第二套翻译（两份翻译 = 两份真相）。
 */
export function chatMessageToEntry(row: {
  readonly id: number;
  readonly characterId: string;
  readonly role: string;
  readonly content: string;
  readonly createdAt: number;
}): SessionHistoryEntry {
  const input = chatHistoryEntryToDrawerInput(row as PersistedChatMessage);
  return {
    id: `chat#${input.id}`,
    cursor: String(input.id),
    at: input.at,
    author: CHAT_ROLE_LABELS[input.role] ?? input.role,
    text: input.text,
    tone: input.error === true ? 'error' : 'normal',
  };
}

/**
 * 造历史读取口。
 *
 * 角色对话那路：**preload 面在才接**（探测不到 = 该路未附着，面板会如实说"未附着"，
 * 而不是显示一条空历史让人以为"这段对话没内容"）。
 * 会话事件那路：始终接（读的是 service 的只读 REST）；service 没起时读失败并如实报错。
 */
export function createSessionHistoryPort(options: SessionHistoryPortOptions = {}): SessionHistoryPort {
  const baseUrl = (options.baseUrl ?? DEFAULT_SESSION_HISTORY_BASE_URL).replace(/\/+$/, '');
  const fetchImpl = options.fetchImpl ?? ((input: string, init?: RequestInit) => fetch(input, init));
  const chatHistory = options.chatHistory === undefined ? chatHistoryApi() : options.chatHistory;

  const port: {
    loadCharacterChat?: SessionHistoryPort['loadCharacterChat'];
    loadSessionEvents?: SessionHistoryPort['loadSessionEvents'];
  } = {};

  if (chatHistory) {
    port.loadCharacterChat = async (characterId, limit, before) => {
      let beforeId: number | null = null;
      if (before !== undefined) {
        const parsed = Number.parseInt(before, 10);
        if (!Number.isFinite(parsed) || parsed <= 0) {
          throw new Error('角色对话历史的翻页游标不合法');
        }
        beforeId = parsed;
      }
      const result =
        beforeId !== null && chatHistory.loadEarlierMessages
          ? await chatHistory.loadEarlierMessages(characterId, beforeId, limit)
          : await chatHistory.loadMessages(characterId, limit);
      if (!result.ok) throw new Error(result.error || '读取角色对话历史失败');
      return (result.messages ?? []).map((row) =>
        chatMessageToEntry({
          id: Number(row.id),
          characterId: row.characterId,
          role: row.role,
          content: row.content,
          createdAt: row.createdAt,
        })
      );
    };
  }

  port.loadSessionEvents = async (sessionId, limit, before) => {
    const url = new URL(
      `${baseUrl}/api/storage/sessions/${encodeURIComponent(sessionId)}/events`
    );
    url.searchParams.set('limit', String(limit));
    if (before !== undefined) url.searchParams.set('beforeSeq', before);
    const response = await fetchImpl(url.toString(), { method: 'GET' });
    if (!response.ok) throw new Error(`读取会话事件失败（HTTP ${response.status}）`);
    const body = (await response.json()) as {
      readonly success?: boolean;
      readonly error?: string;
      readonly data?: { readonly events?: readonly EventRow[] };
    };
    if (body.success === false) throw new Error(body.error || '读取会话事件失败');
    const events = body.data?.events ?? [];
    return events.map((event) =>
      sessionEventToEntry({
        sessionId: event.sessionId,
        seq: event.seq,
        type: event.type,
        payload: event.payload,
        createdAt: event.createdAt,
      })
    );
  };

  return port;
}

/** REST 事件行的形状（与 session-event-dao 的 PersistedSessionEvent 同构）。 */
interface EventRow {
  readonly sessionId: string;
  readonly seq: number;
  readonly type: string;
  readonly payload: unknown;
  readonly createdAt: number;
}
