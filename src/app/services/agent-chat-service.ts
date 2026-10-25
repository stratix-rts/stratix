/**
 * 文件职责：**agent 互聊编排服务**（task_052）—— 选两个角色开对谈：A（发起者）就议题先发言，
 *   B（应答者）以 A 的观点为输入回应，之后互相以对方上一轮输出为输入循环，直到轮数上限 /
 *   某轮出错中断 / 用户停止。用户全程旁听，随时可插话（注入双方下一轮 prompt）。
 *   回合链（默认 3 轮，每轮 = A、B 各一个回合，共 2×N 次 transport 调用）：
 *     A 首发 prompt = 「与 {B名} 讨论：{议题}。请直接给出你的观点。」
 *     B 收到        = 「{A名} 说：{A 的观点}。请回应，与 {A名} 讨论议题：{议题}」
 *     A 再发        = 「{B名} 说：{B 的观点}。请回应，与 {B名} 讨论议题：{议题}」→ 循环。
 * 输入：start(initiatorId, peerId, topic, rounds)（抽屉「让它们聊聊」表单触发）；
 *   interject(text)（旁听插话）；stop()（停止按钮）。
 *   WorldState 快照（characters + detectedAgents，守门与取名字）；注入的 transport 工厂与
 *   035 同款（生产：渲染层经 IPC 到主进程，复用 chat:run / chat:abort 通道 —— runId 路由
 *   保证互聊与普通聊天 / 任务执行互不串台）。
 * 输出：对抽屉视图口（AgentChatDrawerView —— 结构上就是 034 组件互聊扩展面的形状）的调用序列：
 *   联合会话气泡（user 议题 / assistant=A 的话 / peer=B 的话）、流式增量（appendPeerStream）、
 *   轮次进度（setPeerRound）、收束（endPeerChat）；persistSessionId / persistMessage 回调
 *   （组合根接 worldStore 与 chat-history 落库，与 035 同一对接面）。
 *
 * ============ 会话语义（035 原样继承）============
 * 双方各自维护**自己的** transport 会话（sessionRef）：首发（该角色还没有 sessionId）内嵌
 *   persona（复用 035 的 buildFirstPrompt），续发只发原文（persona 已在会话上下文里）。
 *   A、B 的会话完全隔离 —— A 拿到的 sessionId 绝不透传给 B 的 spawn（单测钉死）。
 *   会话 id 回写走 persistSessionId（档案 externalSessionId 只是落库回执；
 *   与普通聊天共用同一回执字段，后写覆盖先写，审计语义不变）。
 *
 * ============ 重启恢复口径（task_055 统一策略的互聊分支）============
 * 互聊不把档案 externalSessionId 种入内存会话（与 chat-service 的聊天分支不同，单测钉死）：
 *   ①回执字段与聊天**共用**且后写覆盖，无法区分它指向的是聊天会话还是互聊会话 ——
 *     盲目续接可能把新的互聊接进聊天会话（上下文串台）；
 *   ②互聊是短生命周期编排（一场讨论几轮即止，且服务重启时编排状态本身已丢），
 *     重启后首发重建（persona + 053 context 重注入）语义自洽；
 *   这正是统一策略的「无效/空→首发重建」分支：对互聊而言回执**不构成有效线索**。
 * 任务（task-service）口径见其文件头：审批门挂单表存 sessionId，有效→续发短指令，丢失→首发重讲。
 *
 * ============ 落库约定（role 三词表不动 + content 前缀标 peer）============
 * 互聊消息进 character_chat_messages（与普通聊天同表同 DAO）：
 *   ① 开题：双方各落一条 user（「与 {对方名} 讨论：{议题}。」）—— 两边历史都自带议题上下文；
 *   ② 每轮产出落**两份**：发言者自己一行 role=assistant 原文；对方一行 role=assistant 但
 *      content 加前缀 `[peer:{发言者id}] ` —— 库表 CHECK 词表（user/assistant/error）不动、
 *      零迁移；回填时 chat-history 的翻译层解析该前缀 → HUD 的 role='peer' + peerId →
 *      渲染成对方名字的气泡（「贝塔：……」）。前缀只进库不进气泡、不进 CLI prompt；
 *   ③ 插话：双方各落一条 user（原文）；
 *   ④ 中断标注（超时/错误/停止）：同 ② 双份（对方份带前缀）。
 *   why 不扩 role 四词表：SQLite 的 CHECK 约束改不了，重建表要写数据迁移；content 前缀是
 *   纯增量约定（036 的 DAO / IPC 校验零改动），解析失败也只是退化成普通 assistant 气泡。
 *
 * ============ 中断与超时 ============
 * 每个回合一次 transport 调用，超时缺省 120s（DEFAULT_PEER_TURN_TIMEOUT_MS，可注入覆盖）。
 *   回合出错（timeout / cli_error / spawn_failed / nonzero_exit / aborted）→ 该轮标记
 *   「（互聊中断：原因）」/「（已中断）」气泡 + 整场讨论收束 —— 链式对谈里下一位没有
 *   上一位的输出可回应，链条在此断掉是唯一诚实的选择。停止按钮复用 035 的 abort 语义
 *   （AbortSignal → IPC abort → 主进程杀进程树 → error{aborted} 收尾）；「复用 abort 两个
 *   session」在回合串行的现实下等价于中断**当前回合**（同一时刻只有一路 spawn 在飞）。
 *
 * ============ 插话 ============
 * interject(text)：立即在联合会话落 user 气泡 + 双方历史各落一条 user；文本进入双方的
 *   「待注入」队列，下一位发言者的 prompt 以「用户补充：{msg}」行前缀注入（每方各见一次，
 *   不重复）。若插话发生在最后一个回合之后（没有下一轮了），注入自然落空 —— 气泡与历史
 *   仍在，只是没人回应（诚实于时序）。
 *
 * ============ 经验口径（与 039/040 对齐，不双计）============
 * 每个回合成功收束（done）→ 该发言者发一条 exp.gained（source=chat_round，经注入的
 *   expWeight 换算，缺省 exp-config 转发层 → core/progression）。A 发 A 的、B 发 B 的，
 *   **各计各的**：一次互聊回合只产一条事件，绝不给对方也补一条（不双计）。error / 中断 /
 *   守门拦截轮不计发 —— 与 chat-service 的口径逐字对齐。
 *
 * ============ 与普通聊天 / 任务的关系 ============
 * 互聊不占任务队列（045 的 busy 派生自 running 任务，纯对话不碰）；与 035 chat-service 是
 *   两个独立服务实例（各自的会话表与在飞锁互不可见）—— 抽屉在互聊模式下把发送框路由到
 *   插话（组合根接线），普通 send 在互聊进行中不可达，边路并发由 UI 态兜住。守门三条
 *   （在档 / 已绑 / 已检出）对**双方**生效，任何一方不满足 → 联合会话提示 + 不进 transport。
 *
 * 禁止事项：
 *   1. import child_process / node-process / cli-transport 的实现文件 —— 只 import transport.ts
 *      的纯类型（渲染层 bundle 铁律，与 035 同款）；
 *   2. 在这里认识任何一家 CLI 的字段 —— 只认公共 TransportEvent 词表；
 *   3. 引入新依赖 —— core 契约 + 035 的既有导出 + 注入端口；
 *   4. 把联合会话存成第二份真相 —— 消息真相在抽屉会话存储 + SQLite，本服务只转发；
 *   5. 碰 world 层（战场说话气泡归 task_062 统一做，本任务刻意不动 world/）。
 *
 * @since v3.28（task_052）；v3.31（task_055）补记重启恢复口径（互聊不种回执，首发重建）。
 */

import { emitWorldEvent } from '../../core/bus';
import type {
  AgentKind,
  CharacterView,
  ExpSource,
  WorldState,
} from '../../core/types';
import {
  buildFirstPrompt,
  isAgentKindInstalled,
  type ChatPersistedMessage,
  type ChatTransportFactory,
  type ChatTransportPort,
} from './chat-service';
import type { TransportEvent, TransportErrorCode } from './cli-transport/transport';
import { defaultExpWeight } from './exp-config';
import { resolveStratixContextBlock, type StratixContextSource } from './stratix-context';

// ============================================================================
// 端口（结构类型 —— 不 import hud，与 034 组件的互聊扩展面保持形状一致）
// ============================================================================

/**
 * 抽屉视图口：互聊服务只认识「往联合会话里放东西」的动作面。
 * addMessage 的 role 是 HUD 词表（user=插话/开题 / assistant=A 的话 / peer=B 的话）；
 * appendPeerStream 的 role 只会是 'assistant'（A 侧流）或 'peer'（B 侧流）——
 * 组件把它翻译成 catalog.appendStreamAs(联合会话, role, chunk)。
 */
export interface AgentChatDrawerView {
  addMessage(message: {
    readonly role: 'user' | 'assistant' | 'peer';
    readonly text: string;
  }): unknown;
  appendPeerStream(role: 'assistant' | 'peer', chunk: string): void;
  finalizePeerStream(): void;
  /** 轮次进度（进行中的回合组：「第 2/3 轮」）。 */
  setPeerRound(current: number, total: number): void;
  /** 整场收束（进度清空、输入态复位；组件自己在互聊模式才响应）。 */
  endPeerChat(): void;
}

// ============================================================================
// 常量与文案（导出供单测断言）
// ============================================================================

/** 缺省轮数（可被 start 的 rounds 覆盖；HUD 表单可选 3/5/8）。 */
export const DEFAULT_PEER_ROUNDS = 3;

/** 轮数上限（HUD 的 3/5/8 都在界内；越界入参被钳到界内）。 */
export const PEER_MAX_ROUNDS = 8;

/** 单回合超时（ms）。互聊回合与聊天同量级，120s。 */
export const DEFAULT_PEER_TURN_TIMEOUT_MS = 120_000;

/** 回合没有任何文本输出时的占位（与 035 的空回复占位同一口径）。 */
export const PEER_MSG_EMPTY_REPLY = '（本轮没有文本回复）';

/** 用户停止后的标注气泡（与 035 同文案）。 */
export const PEER_MSG_INTERRUPTED = '（已中断）';

/** 落库内容加 peer 前缀（约定见文件头「落库约定」②；解析归 chat-history 的翻译层）。 */
export function peerMarkedContent(speakerId: string, text: string): string {
  return `[peer:${speakerId}] ${text}`;
}

// ============================================================================
// 纯函数（prompt 拼装，导出供单测直接断言）
// ============================================================================

/** A 的首发议题指令（035 语义：首发还会被 buildFirstPrompt 再包一层 persona）。 */
export function buildOpeningPrompt(peerName: string, topic: string): string {
  return `与 ${peerName} 讨论：${topic}。请直接给出你的观点。`;
}

/** 回应指令：把对方上一轮的输出转述给本方（插话前缀由服务另行拼接）。 */
export function buildRelayPrompt(speakerName: string, speakerText: string, topic: string): string {
  return `${speakerName} 说：\n${speakerText}\n\n请回应，与 ${speakerName} 讨论议题：${topic}`;
}

/**
 * 插话注入：把待注入的用户补充以「用户补充：」行前缀拼在回合指令前。
 * 空队列 → 原样返回（不产生多余空行）。
 */
export function applyInterjections(base: string, interjections: readonly string[]): string {
  if (interjections.length === 0) return base;
  return [...interjections.map((text) => `用户补充：${text}`), base].join('\n');
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** 传输层错误 → 中断标注（带码的人话；label 词表与 035 的 ERROR_LABELS 同源，不导出）。 */
function peerInterruptText(code: string, message: string): string {
  return `（互聊中断：${code}：${message}）`;
}

// ============================================================================
// 服务
// ============================================================================

/** 一方在互聊中的会话状态（与 035 的 ChatSessionState 同构：会话 id + 首发判定）。 */
interface PeerSessionState {
  sessionId: string | null;
}

/** 一次在跑讨论的记账（stop / interject 需要触达在飞回合与待注入队列）。 */
interface ActiveDiscussion {
  readonly a: CharacterView;
  readonly b: CharacterView;
  readonly topic: string;
  readonly rounds: number;
  readonly pendingForA: string[];
  readonly pendingForB: string[];
  stopRequested: boolean;
  activeTurn: AbortController | null;
}

export interface AgentChatServiceDeps {
  /** 抽屉视图口（组合根传 034 组件元素）。 */
  readonly view: AgentChatDrawerView;
  /**
   * 世界快照读取口（组合根传 worldStore.getState；单测传夹具）。
   * @since v3.30（task_054）类型面增 units：守门第四条（在线位）裁决用。
   * 组合根与测试注入的都是完整 getState，零改动兼容。
   */
  readonly getState: () => Pick<WorldState, 'characters' | 'detectedAgents' | 'units'>;
  /** transport 工厂（生产：与 035 同一个 IPC 桥工厂；单测：打桩）。 */
  readonly createTransport: ChatTransportFactory;
  /** 会话 id 回写口（与 035 共用：档案 externalSessionId 落库回执）。 */
  readonly persistSessionId: (characterId: string, sessionId: string) => void;
  /** 消息落库口（与 035 共用同一 persister；fire-and-forget，失败不阻断）。 */
  readonly persistMessage?: (message: ChatPersistedMessage) => void;
  /** 经验权重函数（缺省 exp-config 转发层 → core/progression；口径见文件头）。 */
  readonly expWeight?: (source: ExpSource) => number;
  /**
   * context-source 注入件（@since v3.29，task_053；缺省不注入）。零 IO（组合根组装）。
   * 互聊开题 = 发起者的首发 → 同样附 <stratix-context>（各自角色自己的快照；
   * 双方各自的首次回合都算各自 session 的首发，同 chat 口径只在首发注入）。
   */
  readonly provideContext?: StratixContextSource;
  /** 单回合超时；缺省 DEFAULT_PEER_TURN_TIMEOUT_MS。 */
  readonly timeoutMs?: number;
  /** 日志口；缺省静默。 */
  readonly logger?: (line: string) => void;
  /**
   * transport 异常上报口（@since v3.30，task_054；缺省不上报）。回合 error 事件回调
   * （kind + 错误码）；组合根接 health-monitor.recordTransportFailure（非 aborted 记 unhealthy）。
   */
  readonly onTransportError?: (kind: AgentKind, code: TransportErrorCode) => void;
}

/** 对外形状（组合根与单测按它操作）。 */
export interface AgentChatService {
  /**
   * 发起一场讨论：A 就议题首发，B 应答，循环 rounds 轮（每轮双方各一回）。
   * resolve 于整场收束（轮数走完 / 中断 / 停止 / 守门拦截）。已在跑时静默忽略。
   */
  start(initiatorId: string, peerId: string, topic: string, rounds?: number): Promise<void>;
  /** 旁听插话：进双方下一轮 prompt（约定见文件头「插话」）；不在跑时忽略。 */
  interject(text: string): void;
  /** 停止当前讨论：中断在飞回合（abort 语义见文件头「中断与超时」）；不在跑时 no-op。 */
  stop(): void;
  /** 是否有讨论在跑（观察口）。 */
  readonly running: boolean;
}

export function createAgentChatService(deps: AgentChatServiceDeps): AgentChatService {
  const view = deps.view;
  const logger = deps.logger ?? ((): void => { /* 缺省静默 */ });
  const timeoutMs = deps.timeoutMs ?? DEFAULT_PEER_TURN_TIMEOUT_MS;
  const expWeight = deps.expWeight ?? defaultExpWeight;

  /** characterId → 会话状态（A、B 各自一条 —— 会话隔离的载体）。 */
  const sessions = new Map<string, PeerSessionState>();
  /** kind → transport 缓存（与 035 同款）。 */
  const transports = new Map<AgentKind, ChatTransportPort>();
  /** 在跑讨论（单飞：一场没结束，第二场 start 直接忽略）。 */
  let active: ActiveDiscussion | null = null;

  const transportFor = (kind: AgentKind): ChatTransportPort => {
    const cached = transports.get(kind);
    if (cached) return cached;
    const created = deps.createTransport(kind);
    transports.set(kind, created);
    return created;
  };

  /** 记 / 回写会话 id（去重 + 回执语义，与 035 同款）。 */
  const applySession = (characterId: string, session: PeerSessionState, sessionId: string): void => {
    if (session.sessionId === sessionId) return;
    session.sessionId = sessionId;
    try {
      deps.persistSessionId(characterId, sessionId);
    } catch (error) {
      logger(`[agent-chat] 会话 id 回写失败（${characterId}）：${describe(error)}`);
    }
  };

  /** 落库（fire-and-forget）：抛错只记日志 —— 历史完整性不绑架讨论回路。 */
  const persist = (characterId: string, role: ChatPersistedMessage['role'], text: string, sessionRef: string | null): void => {
    if (!deps.persistMessage) return;
    try {
      deps.persistMessage({ characterId, role, text, sessionRef });
    } catch (error) {
      logger(`[agent-chat] 消息落库回调抛错（${characterId}/${role}）：${describe(error)}`);
    }
  };

  /** 每轮产出 / 中断标注的双份落库：发言者原文 + 对方带 peer 前缀（文件头「落库约定」②④）。 */
  const persistTurnBothSides = (
    speakerId: string,
    otherId: string,
    speakerSessionRef: string | null,
    text: string
  ): void => {
    persist(speakerId, 'assistant', text, speakerSessionRef);
    persist(otherId, 'assistant', peerMarkedContent(speakerId, text), null);
  };

  /** exp.gained（口径见文件头「经验口径」：每回合一发，只给发言者）。 */
  const emitChatRoundExp = (characterId: string): void => {
    const amount = expWeight('chat_round');
    if (amount <= 0) return;
    try {
      emitWorldEvent({ type: 'exp.gained', characterId, source: 'chat_round', amount });
    } catch (error) {
      logger(`[agent-chat] exp.gained 发射失败（${characterId}/chat_round）：${describe(error)}`);
    }
  };

  /** 守门：单边三条（在档 / 已绑 / 已检出）+ 在线位（@since v3.30，task_054）；不通过返回带名字的文案。 */
  const guardOne = (
    state: Pick<WorldState, 'characters' | 'detectedAgents' | 'units'>,
    characterId: string
  ): { readonly ok: true; readonly character: CharacterView } | { readonly ok: false; readonly reason: string } => {
    const character = state.characters.find((c) => c.id === characterId);
    if (!character) return { ok: false, reason: `未找到角色 ${characterId} 的档案，无法讨论` };
    const kind = character.agentKind;
    if (!kind) return { ok: false, reason: `「${character.name}」未绑定 CLI agent，无法讨论` };
    if (!isAgentKindInstalled(state.detectedAgents, kind)) {
      return { ok: false, reason: `「${character.name}」的 CLI 未安装，无法讨论` };
    }
    // task_054：在线位拦截 —— 双方任一掉线都不开场（同 chat / task 守门第四条，
    // units.online 缺省即在档在线，老档不误伤）。
    if (state.units.some((unit) => unit.characterId === characterId && unit.online === false)) {
      return { ok: false, reason: `「${character.name}」当前离线，无法讨论` };
    }
    return { ok: true, character };
  };

  /**
   * 一个回合（守门已过）：拼 prompt（插话前缀 + 议题/转述，首发再包 persona）→ 跑 transport →
   * 流式转发进联合会话 → done 收束 / error 中断。产出与中断标注（气泡 + 双份落库）都在这里
   * 完成；ok=false 表示讨论到此为止（调用方跳出循环）。
   */
  const runTurn = async (
    discussion: ActiveDiscussion,
    side: 'a' | 'b',
    basePrompt: string
  ): Promise<{ readonly ok: true; readonly text: string } | { readonly ok: false }> => {
    const character = side === 'a' ? discussion.a : discussion.b;
    const other = side === 'a' ? discussion.b : discussion.a;
    const pending = side === 'a' ? discussion.pendingForA : discussion.pendingForB;
    const role: 'assistant' | 'peer' = side === 'a' ? 'assistant' : 'peer';
    const kind = character.agentKind;
    if (!kind) return { ok: false }; // 守门已挡；类型收窄的防御性兜底

    // 插话注入（每方各消费一次 —— 队列在拼 prompt 时清空，见文件头「插话」）。
    const turnPrompt = applyInterjections(basePrompt, pending);
    pending.length = 0;

    const session: PeerSessionState = sessions.get(character.id) ?? { sessionId: null };
    sessions.set(character.id, session);
    // 035 语义：首发内嵌 persona，续发只发原文。task_053：首发同时附战场现状块
    //（上下文一次性注入 —— 会话里有了就不再重拼；块取件异常吞掉不绑架讨论）。
    const prompt =
      session.sessionId === null
        ? buildFirstPrompt(
            character,
            turnPrompt,
            resolveStratixContextBlock(deps.provideContext, character.id, logger) || undefined
          )
        : turnPrompt;

    const controller = new AbortController();
    discussion.activeTurn = controller;
    let sawText = false;
    let text = '';

    const settleInterrupted = (marker: string): { readonly ok: false } => {
      view.addMessage({ role, text: marker });
      persistTurnBothSides(character.id, other.id, session.sessionId, marker);
      return { ok: false };
    };

    try {
      const transport = transportFor(kind);
      for await (const event of transport.spawn(prompt, {
        sessionId: session.sessionId,
        signal: controller.signal,
        timeoutMs,
      })) {
        if (event.type === 'message') {
          sawText = true;
          text += event.text;
          view.appendPeerStream(role, event.text);
          continue;
        }
        if (event.type === 'session') {
          applySession(character.id, session, event.sessionId);
          continue;
        }
        if (event.type === 'done') {
          if (event.sessionId) applySession(character.id, session, event.sessionId);
          view.finalizePeerStream();
          const finalText = sawText ? text : PEER_MSG_EMPTY_REPLY;
          if (!sawText) view.addMessage({ role, text: PEER_MSG_EMPTY_REPLY });
          persistTurnBothSides(character.id, other.id, session.sessionId, finalText);
          emitChatRoundExp(character.id); // 每回合一发、只给发言者（不双计）
          return { ok: true, text: finalText };
        }
        if (event.type === 'error') {
          view.finalizePeerStream(); // 先收束半截话（诚实保留），再落中断标注
          // task_054：exit 异常旁路上报健康监测（aborted 在那边被忽略）。
          if (deps.onTransportError) {
            try {
              deps.onTransportError(character.agentKind as AgentKind, event.code);
            } catch {
              // 审计是旁路：回调抛错不绑架互聊回路。
            }
          }
          return settleInterrupted(
            event.code === 'aborted'
              ? PEER_MSG_INTERRUPTED
              : peerInterruptText(event.code, event.message)
          );
        }
        // tool_use / tool_result：互聊只关心 agent 说的话（与 035 同口径）。
      }
      // 流自然结束却没有 done / error —— runtime 契约上不该发生，防御性按中断收束。
      view.finalizePeerStream();
      return settleInterrupted('（互聊中断：transport 事件流异常结束）');
    } catch (error) {
      view.finalizePeerStream();
      return settleInterrupted(peerInterruptText('cli_error', describe(error)));
    } finally {
      discussion.activeTurn = null;
    }
  };

  /** 整场讨论的回合编排（守门已过）：每轮 A、B 各一回；任何一回失败即收束。 */
  const runDiscussion = async (discussion: ActiveDiscussion): Promise<void> => {
    const { a, b, topic, rounds } = discussion;
    // 开题气泡 + 双方历史各落一条 user（两边都自带议题上下文，文件头「落库约定」①）。
    const openingForA = buildOpeningPrompt(b.name, topic);
    view.addMessage({ role: 'user', text: openingForA });
    persist(a.id, 'user', openingForA, null);
    persist(b.id, 'user', buildOpeningPrompt(a.name, topic), null);

    let lastText = openingForA; // 上一位发言者的产出（开题轮 A 的输入即议题；后续回合转述它）

    discussionLoop: for (let round = 1; round <= rounds; round += 1) {
      view.setPeerRound(round, rounds);
      for (const side of ['a', 'b'] as const) {
        if (discussion.stopRequested) break discussionLoop;
        const other: 'a' | 'b' = side === 'a' ? 'b' : 'a';
        // A 的第一回合 = 议题首发；其余回合 = 转述对方上一轮输出（交替发言 → 对方恒是上一位）。
        const base =
          side === 'a' && round === 1
            ? buildOpeningPrompt(b.name, topic)
            : buildRelayPrompt((other === 'a' ? a : b).name, lastText, topic);
        const outcome = await runTurn(discussion, side, base);
        if (!outcome.ok) break discussionLoop;
        lastText = outcome.text;
      }
    }

    view.endPeerChat();
  };

  return {
    get running(): boolean {
      return active !== null;
    },

    async start(initiatorId: string, peerId: string, topic: string, rounds = DEFAULT_PEER_ROUNDS): Promise<void> {
      const trimmedTopic = topic.trim();
      if (active) return; // 单飞：一场没结束不接新场
      if (initiatorId === peerId) return; // 自己跟自己聊没有意义
      if (trimmedTopic.length === 0) return; // 空议题不开场

      // 守门对双方生效；不通过 → 联合会话提示 + 立即收束（不进 transport）。
      const state = deps.getState();
      const guardA = guardOne(state, initiatorId);
      if (!guardA.ok) {
        view.addMessage({ role: 'assistant', text: guardA.reason });
        view.endPeerChat();
        return;
      }
      const guardB = guardOne(state, peerId);
      if (!guardB.ok) {
        view.addMessage({ role: 'assistant', text: guardB.reason });
        view.endPeerChat();
        return;
      }

      const clampedRounds = Math.min(Math.max(Math.round(rounds), 1), PEER_MAX_ROUNDS);
      const discussion: ActiveDiscussion = {
        a: guardA.character,
        b: guardB.character,
        topic: trimmedTopic,
        rounds: clampedRounds,
        pendingForA: [],
        pendingForB: [],
        stopRequested: false,
        activeTurn: null,
      };
      active = discussion;
      try {
        await runDiscussion(discussion);
      } finally {
        active = null;
      }
    },

    interject(text: string): void {
      const discussion = active;
      if (!discussion) return; // 不在跑：没有「下一轮」可注入
      const trimmed = text.trim();
      if (trimmed.length === 0) return;
      discussion.pendingForA.push(trimmed);
      discussion.pendingForB.push(trimmed);
      view.addMessage({ role: 'user', text: trimmed });
      persist(discussion.a.id, 'user', trimmed, null);
      persist(discussion.b.id, 'user', trimmed, null);
    },

    stop(): void {
      const discussion = active;
      if (!discussion) return;
      discussion.stopRequested = true;
      // 回合串行：同一时刻只有一路 spawn 在飞 —— 中断它就是中断整场（见文件头「中断与超时」）。
      discussion.activeTurn?.abort();
    },
  };
}
