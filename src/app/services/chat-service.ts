/**
 * 文件职责：**角色对话回路服务**（task_035）—— 把聊天抽屉（hud 组件 `<strat-character-chat-drawer>`）
 *   的一次「发送」编排成完整回合：守门（角色在档 / 已绑 agent / agent 已检出）→ persona 前置拼装
 *   → transport 一轮对话 → 流式 chunk 逐条转发回抽屉（appendStream）→ done 收束（finalizeStream）
 *   → session id 回写。错误 → 错误气泡 + 重试路径；用户中断 → AbortSignal 杀进程树。
 * 输入：characterId + 用户文本（抽屉 onSend 回调给出）；WorldState 快照（characters + detectedAgents）；
 *   注入的 transport 工厂（生产：渲染层经 IPC 到主进程，见 chat-transport-bridge.ts；单测：打桩）。
 * 输出：对抽屉视图口（ChatDrawerView —— 结构上就是 034 组件的公开方法面）的调用序列；
 *   persistSessionId 回调（组合根接 worldStore，存档协调器的档案 diff 会自动落 SQLite）。
 * 禁止事项：
 *   1. import child_process / node-process / cli-transport 的**实现**文件 —— 本服务跑在渲染层 bundle 里，
 *      子进程一律在 Electron 主进程（经 IPC 桥），这里只 import transport.ts 的**纯类型**；
 *   2. 在这里认识任何一家 CLI 的字段 —— 事件翻译在 adapters，这里只认公共 TransportEvent 词表；
 *   3. 引入新依赖 —— Node 内置 + core 契约 + 注入端口，仅此而已；
 *   4. 把消息存成本地第二份真相 —— 消息真相在抽屉的会话存储（036 落库后换 SQLite 回填），本服务只转发。
 *
 * ============ 各家 adapter 的会话（sessionRef）语义差异表 ============
 * （spawn 时透传 options.sessionId；「首发」指该角色还没有 sessionId 的那一轮）
 *
 * | kind        | 首发怎么拿到会话 id                | 续发怎么接                          | 差异要点 |
 * |-------------|-----------------------------------|-------------------------------------|----------|
 * | claude-code | stream-json 的 system/init 事件带 session_id（uuid） | `--resume <id>`（真续会话，上下文完整保留） | 五家里最可靠的一条链 |
 * | codex       | thread.started 事件带 thread_id   | `exec resume <id>`                   | 线程续接 |
 * | opencode    | 每条事件顶层都可能带 sessionID     | `--session <id>`（serve 模式由 server 持久化会话库；降级 run 是一次性会话，id 续接可能不生效） | 依赖有没有本地 serve 在跑 |
 * | kimi        | **纯文本输出不带回会话 id**（只有吐 JSON 时才有） | 拿到过 id 才 `--session <id>`；拿不到 → 每次都是新会话 | 无会话 id 时每轮重拼 persona（对无状态 CLI 恰好正确） |
 * | openclaw    | 输出信封的 meta / delivery 可能带 sessionId / sessionKey | `--session-id <id>`；没 id 且 adapter 未配 agentId 时 CLI 可能直接报错（错误会走错误气泡路径） | 依赖 gateway 侧会话 |
 *
 * 统一策略（本服务不区分 adapter）：session 事件 / done.sessionId 里拿到 id 就记进会话状态并回写档案
 * （externalSessionId），下一轮原样透传 —— 「有没有续会话能力」由各家 CLI 自己兑现，本层不猜。
 *
 * ============ persona（system 语义）怎么传 ============
 * 五家 adapter（task_023 冻结的 buildArgs）都**没有**独立的 system prompt 参数
 * （claude CLI 实际有 --append-system-prompt，但 adapter 契约未暴露，不为一家破坏统一面）。
 * 故统一走「**首发内嵌**」：角色的第一条指令 = 角色设定引导语 + AgentProfile.persona + 用户消息；
 * 有了 sessionId 之后的续发**只发原文**（会话上下文里已经有 persona，重复拼接只会稀释指令）。
 *
 * ============ 单飞约束（全局忙碌锁） ============
 * 抽屉的会话存储只有**一条**活跃流缓冲（chat-catalog.appendStream 的语义：已有流就追加，不区分归属），
 * 两路并发会把两个角色的回复串进同一条流。故本服务在 per-character 会话状态（busy）之外再持一把
 * 全局 in-flight 锁：一回合没结束，任何新 send / retry 都直接忽略（抽屉侧 setSending(true) 已禁输入，
 * 这把锁防的是「切角色后旧错误气泡的重试按钮」这类边路）。
 *
 * ============ 消息落库（task_036）============
 * 写入时机（persistMessage 注入件，fire-and-forget，失败不阻断对话）：
 *   ① user 消息：send 过了守门与忙碌锁后**即时写**（sessionRef 可空 —— 首发时还没有会话）；
 *   ② assistant 消息：done 收束时**整段写**（流式 chunk 在内存拼接，不逐条落库）；
 *   ③ error：transport 失败/超时/异常时以 role=error 写（回填历史时渲染成错误样式）；
 *   ④ 中断标注（已中断）/空回复占位：随气泡落 assistant（UI 平价：刷新后看到的就是当时看到的）；
 *   ⑤ 守门拦截文案（未检出/未绑定/无档案）**不落库**：它们是瞬时引导，不是对话内容，重启后无意义；
 *   ⑥ retry 不重复写 user（原文已在库/会话里，重试是服务侧动作 —— 与不新增 user 气泡同一口径）。
 * 消息真相仍在抽屉会话存储 + SQLite（本服务只转发，不存第二份）。
 *
 * @since v3.14（task_035）；v3.15（task_036）追加消息落库时机。
 */

import type {
  AgentKind,
  CharacterView,
  DetectedAgent,
  WorldState,
} from '../../core/types';
import type { SpawnOptions, TransportErrorCode, TransportEvent } from './cli-transport/transport';

// ============================================================================
// 端口（结构类型 —— 不 import hud，与 034 组件公开方法保持形状一致）
// ============================================================================

/**
 * 抽屉视图口：034 组件 `<strat-character-chat-drawer>` 公开方法的子集。
 * - addMessage 的入参与 chat-catalog 的 CharacterChatMessageInput 同构
 *   （error 标记让错误气泡带出「重试」按钮，渲染细节归组件）；
 * - appendStream / finalizeStream / setSending 语义见组件 JSDoc。
 * why 本地声明而不 import hud 类型：app/services 不认识渲染层（依赖方向），形状一致性由
 *   组合根的接线 + jsdom 集成测试共同保证。
 */
export interface ChatDrawerView {
  addMessage(message: {
    readonly characterId?: string;
    readonly role: 'user' | 'assistant';
    readonly text: string;
    readonly error?: boolean;
  }): unknown;
  appendStream(chunk: string): void;
  finalizeStream(): void;
  setSending(sending: boolean): void;
}

/** transport 端口：能跑一轮对话即可（cli-transport 的 CliTransport 结构上满足它）。 */
export interface ChatTransportPort {
  spawn(prompt: string, options?: SpawnOptions): AsyncIterable<TransportEvent>;
}

/** transport 工厂：agent 种类 → transport（生产由 IPC 桥实现；单测注入打桩工厂）。 */
export type ChatTransportFactory = (kind: AgentKind) => ChatTransportPort;

/**
 * 落库消息形状（role 词表与 SQLite character_chat_messages.role 对齐）。
 * sessionRef 是写入时已知的会话 id（首发前为 null）；它是落库回执，不参与恢复决策（见文件头）。
 * @since v3.15，task_036。
 */
export interface ChatPersistedMessage {
  readonly characterId: string;
  readonly role: 'user' | 'assistant' | 'error';
  readonly text: string;
  readonly sessionRef: string | null;
}

// ============================================================================
// 常量与文案（导出供单测断言，别在测试里抄一遍字符串）
// ============================================================================

/** 单轮对话缺省超时（ms）。CLI coding agent 一轮可能要跑很久，给足 3 分钟。 */
export const DEFAULT_CHAT_ROUND_TIMEOUT_MS = 180_000;

/** agent 未检出 / 未安装时的拦截文案（task_035 规格原文）。 */
export const CHAT_MSG_NOT_INSTALLED = '该 CLI 未安装，对话不可用';

/** 角色档案不在状态里（刚被删 / 快照未到）。 */
export const CHAT_MSG_NO_PROFILE = '未找到该角色的档案，无法发起对话';

/** 角色没绑 agent 种类（老档案 / 引导没走完）。 */
export const CHAT_MSG_UNBOUND = '该角色未绑定 CLI agent，无法对话';

/** 本轮没有任何文本输出（agent 只调了工具 / 空回复）—— 静默比说清更让人困惑。 */
export const CHAT_MSG_EMPTY_REPLY = '（本轮没有文本回复）';

/** 用户主动中断后的标注气泡。 */
export const CHAT_MSG_INTERRUPTED = '（已中断）';

/** 错误码 → 气泡文案前缀。 */
const ERROR_LABELS: Readonly<Record<TransportErrorCode, string>> = {
  spawn_failed: 'CLI 拉起失败',
  aborted: '已中断',
  timeout: '调用超时',
  nonzero_exit: 'CLI 异常退出',
  cli_error: 'CLI 报错',
};

// ============================================================================
// 纯函数（可独立单测）
// ============================================================================

/**
 * 守门：agent 种类是否**确认已安装**。
 * 规则：检测结果里存在该 kind 且 installed === true（installed 是检测器的「二进制客观存在」结论，
 * status=timeout 但 which 已确认的情况也算可用）；没有检测快照（非 Electron 环境）视为不可用 ——
 * 宁可拦住也不放行一个注定拉不起来的子进程。
 */
export function isAgentKindInstalled(
  detected: readonly DetectedAgent[] | undefined,
  kind: AgentKind
): boolean {
  if (!detected) return false;
  return detected.some((agent) => agent.kind === kind && agent.installed);
}

/**
 * 首发指令拼装：角色设定引导语 + persona + 用户消息。
 * persona 为空（理论上不会 —— 建档时空 persona 会套默认模板，这里只是防御）→ 只发原文。
 * 导出供单测直接断言拼装格式。
 */
export function buildFirstPrompt(character: CharacterView, message: string): string {
  const persona = character.persona.trim();
  if (persona.length === 0) return message;
  return [
    `你将扮演「${character.name}」这个角色与用户对话，请全程保持角色设定一致。`,
    `【角色设定】\n${persona}`,
    `【用户消息】\n${message}`,
  ].join('\n\n');
}

/** 错误码 → 气泡正文。 */
export function chatErrorText(code: TransportErrorCode, message: string): string {
  return `⚠ ${ERROR_LABELS[code]}：${message}`;
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// ============================================================================
// 服务
// ============================================================================

/** 会话状态：per-character 的 transport 会话句柄 + 忙碌锁。 */
export interface ChatSessionState {
  /** 外部会话 id（各家 CLI 原样透传；null = 尚未建立会话，下一轮按首发处理）。 */
  sessionId: string | null;
  /** 该角色是否正处在一轮对话中（per-character 锁；全局锁见文件头「单飞约束」）。 */
  busy: boolean;
}

export interface ChatServiceDeps {
  /** 抽屉视图口（组合根传 034 组件元素）。 */
  readonly view: ChatDrawerView;
  /** 世界快照读取口（组合根传 worldStore.getState；单测传夹具）。 */
  readonly getState: () => Pick<WorldState, 'characters' | 'detectedAgents'>;
  /** transport 工厂（生产：IPC 桥；单测：打桩）。 */
  readonly createTransport: ChatTransportFactory;
  /** 会话 id 回写口（组合根接 worldStore —— 存档协调器会顺着档案 diff 自动落库）。 */
  readonly persistSessionId: (characterId: string, sessionId: string) => void;
  /**
   * 消息落库口（@since v3.15，task_036；缺省不落库）。同步签名、实现方内部异步 ——
   * 组合根注入 makeChatMessagePersister(chatHistoryApi())；时机见文件头「消息落库」。
   */
  readonly persistMessage?: (message: ChatPersistedMessage) => void;
  /** 单轮超时；缺省 DEFAULT_CHAT_ROUND_TIMEOUT_MS。 */
  readonly timeoutMs?: number;
  /** 日志口；缺省静默。 */
  readonly logger?: (line: string) => void;
}

/** 对外形状（组合根与单测按它操作）。 */
export interface ChatService {
  /** 发送一轮（抽屉 onSend 桥接点；被守门 / 忙碌锁拦下时静默忽略）。resolve 于本轮结束。 */
  send(characterId: string, text: string): Promise<void>;
  /** 重试最近一次失败（错误气泡的「重试」按钮；没有可重试的记录时 no-op）。 */
  retry(characterId: string): Promise<void>;
  /** 中断正在跑的一轮（「停止」按钮；不在跑或不是该角色时 no-op）。 */
  stop(characterId: string): void;
  /** 全局是否有一轮在跑（观察口：测试 / 调试）。 */
  readonly inFlight: boolean;
  /** 某角色的会话状态快照（不存在为 null —— 观察口，不用于驱动流程）。 */
  sessionSnapshot(characterId: string): Readonly<ChatSessionState> | null;
}

/** 一次在跑回合的记账。 */
interface ActiveRun {
  readonly characterId: string;
  readonly controller: AbortController;
}

export function createChatService(deps: ChatServiceDeps): ChatService {
  const view = deps.view;
  const logger = deps.logger ?? ((): void => { /* 缺省静默 */ });
  const timeoutMs = deps.timeoutMs ?? DEFAULT_CHAT_ROUND_TIMEOUT_MS;

  /** characterId → 会话状态。懒建：首次对话的角色才进表。 */
  const sessions = new Map<string, ChatSessionState>();
  /** 全局单飞（见文件头「单飞约束」）。 */
  let activeRun: ActiveRun | null = null;
  /** characterId → 最近一次失败的原文（重试路径的弹药；新一轮 send 会清掉）。 */
  const lastFailed = new Map<string, string>();
  /** kind → transport 缓存（IPC 桥的 transport 无状态可缓存；省一次工厂往返）。 */
  const transports = new Map<AgentKind, ChatTransportPort>();

  const transportFor = (kind: AgentKind): ChatTransportPort => {
    const cached = transports.get(kind);
    if (cached) return cached;
    const created = deps.createTransport(kind);
    transports.set(kind, created);
    return created;
  };

  /** 记 / 回写会话 id：同一个 id 不重复回写（runtime 已对 session 事件去重，这里兜 done.sessionId 的路）。 */
  const applySession = (characterId: string, session: ChatSessionState, sessionId: string): void => {
    if (session.sessionId === sessionId) return;
    session.sessionId = sessionId;
    try {
      deps.persistSessionId(characterId, sessionId);
    } catch (error) {
      // 回写失败不致命：会话在内存里还续得上，只是重启后要重新开局。
      logger(`[chat-service] 会话 id 回写失败（${characterId}）：${describe(error)}`);
    }
  };

  /** 消息落库（@since v3.15，task_036）：fire-and-forget，抛错只记日志（历史完整性不绑架对话可用性）。 */
  const persist = (message: ChatPersistedMessage): void => {
    if (!deps.persistMessage) return;
    try {
      deps.persistMessage(message);
    } catch (error) {
      logger(`[chat-service] 消息落库回调抛错（${message.characterId}/${message.role}）：${describe(error)}`);
    }
  };

  const guard = (characterId: string): CharacterView | null => {
    const state = deps.getState();
    const character = state.characters.find((c) => c.id === characterId) ?? null;
    if (!character) {
      view.addMessage({ characterId, role: 'assistant', text: CHAT_MSG_NO_PROFILE });
      return null;
    }
    const kind = character.agentKind;
    if (!kind) {
      view.addMessage({ characterId, role: 'assistant', text: CHAT_MSG_UNBOUND });
      return null;
    }
    if (!isAgentKindInstalled(state.detectedAgents, kind)) {
      view.addMessage({ characterId, role: 'assistant', text: CHAT_MSG_NOT_INSTALLED });
      return null;
    }
    return character;
  };

  /** 一轮对话的完整生命周期（守门已过）。 */
  const runRound = async (character: CharacterView, kind: AgentKind, text: string): Promise<void> => {
    const characterId = character.id;
    const session: ChatSessionState = sessions.get(characterId) ?? { sessionId: null, busy: false };
    sessions.set(characterId, session);

    const run: ActiveRun = { characterId, controller: new AbortController() };
    activeRun = run;
    session.busy = true;
    lastFailed.delete(characterId);
    view.setSending(true);

    // 首发（还没有会话 id）才拼 persona；续发只发原文（见文件头「persona 怎么传」）。
    const prompt = session.sessionId === null ? buildFirstPrompt(character, text) : text;
    let sawText = false;
    // 流式文本在内存拼接（task_036）：finalize 时整段落库，不逐 chunk 写 IPC。
    let assistantText = '';

    try {
      const transport = transportFor(kind);
      for await (const event of transport.spawn(prompt, {
        sessionId: session.sessionId,
        signal: run.controller.signal,
        timeoutMs,
      })) {
        if (event.type === 'message') {
          sawText = true;
          assistantText += event.text;
          view.appendStream(event.text);
          continue;
        }
        if (event.type === 'session') {
          applySession(characterId, session, event.sessionId);
          continue;
        }
        if (event.type === 'done') {
          if (event.sessionId) applySession(characterId, session, event.sessionId);
          view.finalizeStream();
          if (!sawText) view.addMessage({ characterId, role: 'assistant', text: CHAT_MSG_EMPTY_REPLY });
          // 落库与气泡同文同序：有文本写整段，零文本写占位（空串不落库 —— 与气泡丢弃空流同一口径）。
          const finalText = sawText ? assistantText : CHAT_MSG_EMPTY_REPLY;
          if (finalText.length > 0) {
            persist({ characterId, role: 'assistant', text: finalText, sessionRef: session.sessionId });
          }
          return;
        }
        if (event.type === 'error') {
          // 先收束已流出的部分（诚实保留半截回答），再落错误气泡。
          view.finalizeStream();
          if (event.code === 'aborted') {
            view.addMessage({ characterId, role: 'assistant', text: CHAT_MSG_INTERRUPTED });
            persist({ characterId, role: 'assistant', text: CHAT_MSG_INTERRUPTED, sessionRef: session.sessionId });
          } else {
            lastFailed.set(characterId, text);
            const errorText = chatErrorText(event.code, event.message);
            view.addMessage({ characterId, role: 'assistant', text: errorText, error: true });
            persist({ characterId, role: 'error', text: errorText, sessionRef: session.sessionId });
          }
          return;
        }
        // tool_use / tool_result：角色对话只关心 agent 说的话，不进气泡（工具回执刷屏没有信息量）。
      }
      // 流自然结束却没有 done / error —— runtime 契约上不该发生，防御性收束，别把抽屉卡在发送中。
      view.finalizeStream();
    } catch (error) {
      // runtime 不该抛（内部全转 error 事件）；真抛了也要复位状态 + 给用户一个说法。
      view.finalizeStream();
      lastFailed.set(characterId, text);
      const thrownText = chatErrorText('cli_error', describe(error));
      view.addMessage({ characterId, role: 'assistant', text: thrownText, error: true });
      persist({ characterId, role: 'error', text: thrownText, sessionRef: session.sessionId });
    } finally {
      if (activeRun === run) activeRun = null;
      session.busy = false;
      view.setSending(false);
    }
  };

  /**
   * 发送与重试共用的派发骨架（task_036 拆出）：同一守门与两把锁；
   * 差别只在是否落库 user 消息（retry 不重复写，见文件头「消息落库」⑥）。
   */
  const dispatch = async (
    characterId: string,
    text: string,
    options: { readonly persistUser: boolean }
  ): Promise<void> => {
    const character = guard(characterId);
    if (!character || !character.agentKind) return;
    if (activeRun) return; // 全局单飞
    const session = sessions.get(characterId);
    if (session?.busy) return; // per-character 锁（与全局锁冗余成对，见文件头）
    if (options.persistUser) {
      persist({ characterId, role: 'user', text, sessionRef: session?.sessionId ?? null });
    }
    await runRound(character, character.agentKind, text);
  };

  return {
    get inFlight(): boolean {
      return activeRun !== null;
    },

    async send(characterId: string, text: string): Promise<void> {
      const trimmed = text.trim();
      if (trimmed.length === 0) return;
      await dispatch(characterId, trimmed, { persistUser: true });
    },

    async retry(characterId: string): Promise<void> {
      const text = lastFailed.get(characterId);
      if (!text) return;
      // 与新发送同一守门（角色可能已被删 / agent 状态可能变了），但不新增 user 气泡 ——
      // 原文就在会话记录里，重试是服务侧动作；落库同理不重复写 user（文件头「消息落库」⑥）。
      await dispatch(characterId, text, { persistUser: false });
    },

    stop(characterId: string): void {
      const run = activeRun;
      if (!run || run.characterId !== characterId) return;
      // 中断语义由 runtime 兑现：AbortSignal → killTree 杀整棵进程树 → error{code:'aborted'} 收尾
      //（五家 adapter 共用同一 runtime，全部支持真中断；「adapter 不支持」的降级路径在本仓库不存在，
      //  若未来出现，其 adapter 会在 options.signal 上无动作，本服务的超时兜底仍会结束回合）。
      run.controller.abort();
    },

    sessionSnapshot(characterId: string): Readonly<ChatSessionState> | null {
      return sessions.get(characterId) ?? null;
    },
  };
}
