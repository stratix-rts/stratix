/**
 * 文件职责：角色对话历史的**渲染侧持久化端口**（task_036）—— 三件事：
 *   ① 声明 IPC 面（ChatHistoryApi，与 preload 的 gameSave 扩展段同构）+ window 探测器；
 *   ② 翻译：库行（PersistedChatMessage）→ 抽屉消息输入（role=error → error 标记的错误气泡）；
 *   ③ 落库回调工厂（makeChatMessagePersister）：chat-service 的 persistMessage 注入件，
 *      fire-and-forget（落库失败只警告，绝不打断对话回路）。
 * 输入：window.electronAPI.gameSave 的扩展面（saveChatMessage / loadChatMessages）。
 * 输出：chat-service / 组合根可直接注入的回调与映射函数。
 * 禁止事项：
 *   1. import electron / 主进程模块 —— 本文件进渲染 bundle，IPC 只经 preload 暴露的面；
 *   2. 在这里定写入时机 —— 时机归 chat-service（user 即时 / assistant 收束 / error）；
 *   3. 认识 hud 类型 —— 翻译产物用本地结构形状（与 CharacterChatMessageInput 结构同构，
 *      结构类型保证可赋值，依赖方向不倒挂：services 不 import hud）。
 *
 * sessionRef 恢复口径（task_035 已固化，本任务不改）：重启后首发重建会话（persona 内嵌），
 *   external_session_id / session_ref 都只是**落库回执**，不透传给 CLI。历史消息与新会话
 *   在 UI 层拼接连续展示即可（抽屉回填 + 本轮追加天然同一段消息流）。
 *
 * ============ peer 前缀翻译（task_052）============
 * 互聊消息落库时（agent-chat-service）对方副本的 content 带 `[peer:{对方id}] ` 前缀
 *   （库表 role 三词表不动，见那边文件头「落库约定」）。本层翻译时解析它 →
 *   HUD 的 role='peer' + peerId + 原文 —— 抽屉把它渲染成对方名字的气泡（「贝塔：……」）。
 *   解析不到前缀的行原样翻译（普通 assistant 气泡）——前缀是互聊专用约定，
 *   普通聊天 / 035 遗留行的 content 不受影响；正文恰好以「[peer:」开头的极端碰撞也只会
 *   退化成一条带前缀展示的 assistant 气泡（无结构风险）。
 *
 * @since v3.15（task_036）；v3.28（task_052）追加 peer 前缀解析。
 */

import type {
  ChatMessageInsert,
  PersistedChatMessage,
} from './chat-history-dao';

/**
 * 抽屉历史加载窗口：每次打开/切角色读最近 N 条（正序回填）。
 * why 50：单屏可视量级 + 一次 IPC 载荷可控；「滚动到顶再向前翻页」的后置增强
 *   （loadChatMessages 已按 LIMIT 窗口语义就位，UI 侧分页触发器后置）。
 */
export const CHAT_HISTORY_LOAD_LIMIT = 50;

/** IPC 写入载荷（与 chat-history-dao 的 ChatMessageInsert 同构；createdAt 由本层统一盖章）。 */
export interface ChatHistorySaveMessage {
  readonly characterId: string;
  readonly role: PersistedChatMessage['role'];
  readonly content: string;
  readonly sessionRef?: string | null;
}

/** IPC 读取结果。ok=false 时 messages 缺省。 */
export interface ChatHistoryLoadResult {
  readonly ok: boolean;
  readonly messages?: PersistedChatMessage[];
  readonly error?: string;
}

/**
 * preload 的 gameSave 扩展面（@since task_036 在 033 的三条通道上追加两条：
 * game:saveChatMessage / game:loadChatMessages）。
 */
export interface ChatHistoryApi {
  /** 写一条消息（chat-service 回调触发；失败返回 ok=false，不抛）。 */
  saveMessage(message: ChatHistoryInsert): Promise<{ readonly ok: boolean; readonly error?: string }>;
  /** 读某角色最近 limit 条（缺省 CHAT_HISTORY_LOAD_LIMIT）。 */
  loadMessages(characterId: string, limit?: number): Promise<ChatHistoryLoadResult>;
}

/** 写入载荷（含时间戳 —— 调用方只管业务，时钟在这里盖，user/assistant 先后即调用先后）。 */
export interface ChatHistoryInsert extends ChatHistorySaveMessage {
  readonly createdAt: number;
}

/** 从 window.electronAPI 取历史通道；非 Electron 环境（纯 vite dev / node 测试）返回 null。 */
export function chatHistoryApi(): ChatHistoryApi | null {
  // globalThis 探测：node（jest）里 window 未定义，直接读会 ReferenceError（与 cliChatIpcApi 同一手法）。
  const scope: unknown = typeof window !== 'undefined' ? window : globalThis;
  const api = (scope as { electronAPI?: { gameSave?: ChatHistoryApi } }).electronAPI;
  return api?.gameSave ?? null;
}

/**
 * 互聊 peer 副本的 content 前缀：`[peer:{对方id}] `（写入见 agent-chat-service 的
 * peerMarkedContent；词表约定见那边文件头「落库约定」）。导出给单测断言与未来消费者。
 */
export const PEER_CONTENT_PREFIX = /^\[peer:([^\]]+)\] /;

/**
 * 库行 → 抽屉消息输入（结构上即 chat-catalog 的 CharacterChatMessageInput）。
 * role=error → assistant 气泡 + error 标记（警示配色 + 重试钮，渲染细节归组件）；
 * content 带 [peer:id] 前缀（task_052）→ role='peer' + peerId + 剥前缀后的正文
 * （组件渲染成对方名字的气泡）；其余原样。sessionRef 不进 UI（它是审计回执，不是展示内容）。
 */
export function chatHistoryEntryToDrawerInput(
  row: PersistedChatMessage
): {
  readonly characterId: string;
  readonly role: 'user' | 'assistant' | 'peer';
  readonly text: string;
  readonly error?: boolean;
  readonly peerId?: string;
  readonly at: number;
} {
  const isError = row.role === 'error';
  if (!isError && row.role === 'assistant') {
    const matched = PEER_CONTENT_PREFIX.exec(row.content);
    if (matched) {
      return {
        characterId: row.characterId,
        role: 'peer',
        text: row.content.slice(matched[0].length),
        peerId: matched[1],
        at: row.createdAt,
      };
    }
  }
  return {
    characterId: row.characterId,
    role: isError ? 'assistant' : row.role,
    text: row.content,
    ...(isError ? { error: true } : {}),
    at: row.createdAt,
  };
}

/**
 * 落库回调的入参形状（与 chat-service 的 ChatPersistedMessage 结构同构：text 字段，不是 content ——
 * 服务层的消息词汇用 text，库行走 content，翻译在本层完成，不倒灌服务层）。
 */
export interface ChatPersistInput {
  readonly characterId: string;
  readonly role: 'user' | 'assistant' | 'error';
  readonly text: string;
  readonly sessionRef: string | null;
}

/**
 * chat-service 的 persistMessage 注入件：同步签名、内部 fire-and-forget。
 * 落库失败（IPC 不通 / 主进程拒绝）只 logger 一句 —— 对话回路的可用性优先于历史完整性，
 * 消息在抽屉内存里仍然完整（只是重启后少这一条）。
 */
export function makeChatMessagePersister(
  api: ChatHistoryApi,
  logger: (line: string) => void = (line) => console.warn(line)
): (message: ChatPersistInput) => void {
  return (message) => {
    const payload: ChatHistoryInsert = {
      characterId: message.characterId,
      role: message.role,
      content: message.text,
      sessionRef: message.sessionRef,
      createdAt: Date.now(),
    };
    void api
      .saveMessage(payload)
      .then((result) => {
        if (!result.ok) logger(`[ChatHistory] 消息落库被拒：${result.error ?? 'unknown'}`);
      })
      .catch((error: unknown) => {
        logger(`[ChatHistory] 消息落库失败：${error instanceof Error ? error.message : String(error)}`);
      });
  };
}
