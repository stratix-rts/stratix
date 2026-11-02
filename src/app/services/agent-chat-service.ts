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
 * ============ 落库约定（peer 不进库表 role + content 前缀标 peer）============
 * 互聊消息进 character_chat_messages（与普通聊天同表同 DAO）：
 *   ① 开题：双方各落一条 user（「与 {对方名} 讨论：{议题}。」）—— 两边历史都自带议题上下文；
 *   ② 每轮产出落**两份**：发言者自己一行 role=assistant 原文；对方一行 role=assistant 但
 *      content 加前缀 `[peer:{发言者id}] `；回填时 chat-history 的翻译层解析该前缀 →
 *      HUD 的 role='peer' + peerId → 渲染成对方名字的气泡（「贝塔：……」）。
 *      前缀只进库不进气泡、不进 CLI prompt；
 *   ③ 插话：双方各落一条 user（原文）；
 *   ④ 中断标注（超时/错误/停止）：同 ② 双份（对方份带前缀）。
 *   why peer 不进库表 role 词表：content 前缀是纯增量约定，解析失败也只是退化成普通
 *   assistant 气泡；task_073 的 system 是失败事件角色，与 peer 身份无关。
 *
 * ============ 中断与超时 ============
 * 每个回合一次 transport 调用，超时缺省 120s（DEFAULT_PEER_TURN_TIMEOUT_MS，可注入覆盖）。
 *   覆盖链：环境变量 STRATIX_PEER_TURN_TIMEOUT_MS（组合根接线，见 dev-flags.ts）
 *     → resolvePeerTurnTimeoutMs（解析 + 钳位 [10s, 10min]）→ deps.timeoutMs → spawn 选项。
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
 * ============ 网络兜底指引（@since v3.44，task_090）============
 * 开场指令与转述指令的尾部都带一条「网络不可用就凭已知作答 + 注明知识截止」的指引
 *   （PEER_NETWORK_FALLBACK_HINT）。why：互聊常聊检索型议题，而 CLI 子进程有时拿不到
 *   代理 env（注入口径见 cli-transport/spawn-env.ts）→ 外网黑洞 → agent 空转重试零输出
 *   → 回合耗到 120s 被看门狗杀。有了这条指引，网络不可用时它直接给已知答案，讨论能走完。
 *   why 转述指令也要带：B 的首轮拿到的是转述指令、拿不到开场指令，没有它 B 会撞同一个黑洞。
 *
 * ============ 会话域接线（@since v3.45，task_094 / v3.2a S4）============
 * 互聊接入会话域（kind=peer_chat），口径见 docs/SESSION-PLAN.md §2 接线表「peer_chat」行与 §5：
 *   ① **每场互聊一条会话** —— 开场建（participants=双方，标题走域内规则版自动起名：议题为主体）；
 *   ② **全量事件落库**（互聊没有别的历史去处，session_events 就是它的历史）：
 *      议题（用户的话）/ 每轮发言（发言者 + 原文）/ 插话（用户的话）各记一条 'message'；
 *   ③ **中断不再静默**：超时 / 取消 / 异常 → 会话状态显式转 'interrupted' + 落一条 'interrupt'
 *      事件（带原因）—— 修的就是「超时即丢」：以前中断只留一枚气泡，进程一退就没了；
 *   ④ 正常走完轮数 → 收尾 'closed'（终态，可被 FIFO 淘汰）。
 * 会话写入面是**旁路**（deps.sessions，缺省 = 不记会话）：端口缺席或建会话失败都不阻断互聊
 *   （可用性优先 —— 讨论是主角，会话记录是史官）。
 *
 * why 中断只调 interruptSession 不再单独 appendEvent('interrupt')：manager 的 interruptSession
 *   已经**原子地**做「记一条 interrupt 事件 + 迁移到 interrupted」（core/session/manager.ts 的
 *   commit：先判合法性 → 再记事件 → 最后迁移）。再补一次 appendEvent 就是同一件事记两遍
 *   （事件流里出现两条一模一样的中断标记），而且顺序反了还会撞「已中断的会话不能再中断」的
 *   非法迁移（凭空多一条警告）。
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
 * @since v3.28（task_052）；v3.31（task_055）补记重启恢复口径（互聊不种回执，首发重建）；
 *   v3.44（task_090）补网络兜底指引（prompt 尾部一条）与回合超时的可配链（环境变量覆盖）；
 *   v3.45（task_094 / v3.2a S4）追加会话域接线（peer_chat：开场建会话 + 全量事件 + 中断显式化）。
 */

import { emitWorldEvent } from '../../core/bus';
import type { SessionEventInput, SessionManager } from '../../core/session';
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

/**
 * 回合超时的取值区间（ms）。
 * why 与 Electron 主进程 chat:run 的钳位一致（[10s, 10min]）—— 渲染层放行、主进程再钳一次，
 *   两端口径一致才不会出现「配了 30 分钟但主进程按 10 分钟杀」的哑巴亏。
 */
export const PEER_TURN_TIMEOUT_MIN_MS = 10_000;
export const PEER_TURN_TIMEOUT_MAX_MS = 600_000;

/**
 * 网络兜底指引（@since v3.44，task_090）。
 * why 需要它：互聊常聊「哪个模型更强」这类需要检索的题目，而 CLI 子进程有时没有代理 env
 *   → WebFetch / curl 撞外网黑洞 → agent 空转重试零输出 → 120s 看门狗杀进程。
 *   这条指引让 agent 在网络不可用时**凭已知作答**（并注明知识截止），而不是把回合耗死。
 */
export const PEER_NETWORK_FALLBACK_HINT =
  '若网络检索不可用或超时，直接凭你已有的知识作答并注明知识截止时间，不要反复重试网络。';

/** 回合没有任何文本输出时的占位（与 035 的空回复占位同一口径）。 */
export const PEER_MSG_EMPTY_REPLY = '（本轮没有文本回复）';

/** 用户停止后的标注气泡（与 035 同文案）。 */
export const PEER_MSG_INTERRUPTED = '（已中断）';

/**
 * 会话事件里「用户」这一方的署名（@since v3.45，task_094）。
 * why 固定成这个而不是记发起者的角色名：会话事件的 author 是**谁在说**，
 * 议题与插话都是用户说的（发起者只是替用户把议题递给了对方）。
 */
export const PEER_SESSION_USER_AUTHOR = '用户';

/** 落库内容加 peer 前缀（约定见文件头「落库约定」②；解析归 chat-history 的翻译层）。 */
export function peerMarkedContent(speakerId: string, text: string): string {
  return `[peer:${speakerId}] ${text}`;
}

// ============================================================================
// 纯函数（prompt 拼装，导出供单测直接断言）
// ============================================================================

/**
 * A 的首发议题指令（035 语义：首发还会被 buildFirstPrompt 再包一层 persona）。
 * 尾部带网络兜底指引（task_090）：检索型议题遇外网黑洞时，agent 应凭已知作答而不是空转。
 */
export function buildOpeningPrompt(peerName: string, topic: string): string {
  return `与 ${peerName} 讨论：${topic}。请直接给出你的观点。\n${PEER_NETWORK_FALLBACK_HINT}`;
}

/**
 * 回应指令：把对方上一轮的输出转述给本方（插话前缀由服务另行拼接）。
 * 同样带网络兜底指引（task_090）：B 的**首轮**拿到的是转述指令、拿不到开场指令，
 *   没有这条指引，B 会在自己的首轮上撞同一个外网黑洞。
 */
export function buildRelayPrompt(speakerName: string, speakerText: string, topic: string): string {
  return `${speakerName} 说：\n${speakerText}\n\n请回应，与 ${speakerName} 讨论议题：${topic}\n${PEER_NETWORK_FALLBACK_HINT}`;
}

/**
 * 把外部给来的回合超时（环境变量串 / 注入值）解析成一个可用的值。
 * 缺省 120s；非法（空 / 非数字 / ≤0）→ 缺省；超界 → 钳到 [10s, 10min]。
 * why 单独一个纯函数：环境变量的解析口径要能被单测钉死（组合根只接线，不做解析）。
 */
export function resolvePeerTurnTimeoutMs(raw: string | number | null | undefined): number {
  if (raw === null || raw === undefined) return DEFAULT_PEER_TURN_TIMEOUT_MS;
  const trimmed = typeof raw === 'string' ? raw.trim() : raw;
  if (trimmed === '') return DEFAULT_PEER_TURN_TIMEOUT_MS;
  const value = typeof trimmed === 'number' ? trimmed : Number(trimmed);
  if (!Number.isFinite(value) || value <= 0) return DEFAULT_PEER_TURN_TIMEOUT_MS;
  return Math.min(
    Math.max(Math.floor(value), PEER_TURN_TIMEOUT_MIN_MS),
    PEER_TURN_TIMEOUT_MAX_MS
  );
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
  /**
   * 会话域的会话 id（@since v3.45，task_094；peer_chat：每场互聊一条）。
   * null = 未接入会话域（端口缺席）或建会话失败 —— 会话是旁路，不记也一样聊。
   */
  sessionId: string | null;
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
  /**
   * 单回合超时（ms）；缺省 DEFAULT_PEER_TURN_TIMEOUT_MS（120s）。
   * 组合根用环境变量 STRATIX_PEER_TURN_TIMEOUT_MS 覆盖（经 resolvePeerTurnTimeoutMs 解析 + 钳位）。
   */
  readonly timeoutMs?: number;
  /** 日志口；缺省静默。 */
  readonly logger?: (line: string) => void;
  /**
   * transport 异常上报口（@since v3.30，task_054；缺省不上报）。回合 error 事件回调
   * （kind + 错误码）；组合根接 health-monitor.recordTransportFailure（非 aborted 记 unhealthy）。
   */
  readonly onTransportError?: (kind: AgentKind, code: TransportErrorCode) => void;
  /**
   * 会话域写入面（可选，@since v3.45，task_094 / v3.2a S4）—— 互聊的会话记录
   * （kind=peer_chat）。**缺省 = 不记会话**（互聊照常，只少一条历史）。
   *
   * 口径（方案 docs/SESSION-PLAN.md §2 接线表「peer_chat」行 + §5）：
   *   - 每场互聊**一条**会话（开场建，双方为参与者）；
   *   - **全量事件**（互聊没有别的历史去处）：议题 / 每轮发言 / 插话各一条 'message'；
   *   - 超时 / 取消 / 异常 → 状态显式转 'interrupted' + 落一条 'interrupt' 事件（修「超时即丢」）；
   *   - 正常走完 → 收尾 'closed'。
   */
  readonly sessions?: SessionManager;
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

  /**
   * 会话事件记账（@since v3.45，task_094；口径见文件头「会话域接线」）。
   * 旁路纪律：端口缺席 / 抛错都只记日志 —— 会话是史官，讨论才是主角。
   */
  const recordEvent = (discussion: ActiveDiscussion, input: SessionEventInput): void => {
    const sessionId = discussion.sessionId;
    if (!deps.sessions || !sessionId) return;
    try {
      deps.sessions.appendEvent(sessionId, input);
    } catch (error) {
      logger(`[agent-chat] 会话记账抛错（${sessionId}/${input.type}）：${describe(error)}`);
    }
  };

  /** 记一条消息事件（发言者 + 原文）。互聊的历史本体就在这些事件里。 */
  const recordMessage = (discussion: ActiveDiscussion, author: string, text: string): void => {
    recordEvent(discussion, { type: 'message', payload: { author, text } });
  };

  /**
   * 中断落账（@since v3.45，task_094）：状态显式转 'interrupted' + 落一条 'interrupt' 事件。
   * why 只调 interruptSession 不再单独 appendEvent：manager 的 interruptSession 已原子地
   *   「记事件 + 迁移状态」，再补一次就是同一条中断标记记两遍（见文件头同节注记）。
   */
  const recordInterrupt = (discussion: ActiveDiscussion, reason: string): void => {
    const sessionId = discussion.sessionId;
    if (!deps.sessions || !sessionId) return;
    try {
      deps.sessions.interruptSession(sessionId, reason);
    } catch (error) {
      logger(`[agent-chat] 会话中断记账抛错（${sessionId}）：${describe(error)}`);
    }
  };

  /** 正常收场落账：收尾（closed，终态）。 */
  const recordClose = (discussion: ActiveDiscussion, reason: string): void => {
    const sessionId = discussion.sessionId;
    if (!deps.sessions || !sessionId) return;
    try {
      deps.sessions.closeSession(sessionId, reason);
    } catch (error) {
      logger(`[agent-chat] 会话收尾记账抛错（${sessionId}）：${describe(error)}`);
    }
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
   *
   * 中断时**带出原因**（reason）：调用方据此给会话落一条 'interrupt' 事件 + 转 interrupted
   *   状态（@since v3.45，task_094）—— 中断的原因只有这里知道（错误码 / 异常信息）。
   */
  const runTurn = async (
    discussion: ActiveDiscussion,
    side: 'a' | 'b',
    basePrompt: string
  ): Promise<
    { readonly ok: true; readonly text: string } | { readonly ok: false; readonly reason: string }
  > => {
    const character = side === 'a' ? discussion.a : discussion.b;
    const other = side === 'a' ? discussion.b : discussion.a;
    const pending = side === 'a' ? discussion.pendingForA : discussion.pendingForB;
    const role: 'assistant' | 'peer' = side === 'a' ? 'assistant' : 'peer';
    const kind = character.agentKind;
    if (!kind) return { ok: false, reason: '角色未绑定 CLI agent' }; // 守门已挡；类型收窄的防御性兜底

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

    const settleInterrupted = (marker: string, reason: string): { readonly ok: false; readonly reason: string } => {
      view.addMessage({ role, text: marker });
      persistTurnBothSides(character.id, other.id, session.sessionId, marker);
      return { ok: false, reason };
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
          // 会话事件（@since v3.45，task_094）：本轮发言落一条 message 事件（互聊的历史本体）。
          recordMessage(discussion, character.name, finalText);
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
              : peerInterruptText(event.code, event.message),
            // 中断原因（进会话事件）：错误码 + 原文；aborted 是用户叫停，也如实记。
            `${event.code}：${event.message}`
          );
        }
        // tool_use / tool_result：互聊只关心 agent 说的话（与 035 同口径）。
      }
      // 流自然结束却没有 done / error —— runtime 契约上不该发生，防御性按中断收束。
      view.finalizePeerStream();
      return settleInterrupted('（互聊中断：transport 事件流异常结束）', 'transport 事件流异常结束');
    } catch (error) {
      view.finalizePeerStream();
      return settleInterrupted(peerInterruptText('cli_error', describe(error)), `cli_error：${describe(error)}`);
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
    // 会话事件（@since v3.45，task_094）：议题是用户说的话，落一条 message 事件
    //   （会话标题里也有议题，但那是摘要；这里记的是历史本体）。
    recordMessage(discussion, PEER_SESSION_USER_AUTHOR, topic);

    let lastText = openingForA; // 上一位发言者的产出（开题轮 A 的输入即议题；后续回合转述它）
    /** 中断原因（非空 = 这场是被打断的，不是走完的）。 */
    let interruptReason: string | null = null;

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
        if (!outcome.ok) {
          interruptReason = outcome.reason;
          break discussionLoop;
        }
        lastText = outcome.text;
      }
    }

    // 收场落账（@since v3.45，task_094）：
    //   打断的（回合出错 / 用户叫停）→ 显式 interrupted + interrupt 事件（不再是静默丢失）；
    //   走完轮数的 → 收尾 closed。
    if (interruptReason !== null) {
      recordInterrupt(discussion, interruptReason);
    } else if (discussion.stopRequested) {
      // 回合之间叫停（当时没有在飞回合可断）—— 同样是打断，不是正常收场。
      recordInterrupt(discussion, '用户停止互聊');
    } else {
      recordClose(discussion, '讨论完成');
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
      // 会话首（@since v3.45，task_094）：开场建会话（peer_chat：每场互聊一条，双方为参与者）。
      //   标题走域内规则版自动起名（议题为主体）；建会话失败（达上限等）不阻断互聊 ——
      //   会话是旁路，没有它这场讨论照样跑完（只是少一段历史）。
      let sessionId: string | null = null;
      if (deps.sessions) {
        try {
          const record = deps.sessions.createSession({
            kind: 'peer_chat',
            participants: [guardA.character.id, guardB.character.id],
            firstMessage: trimmedTopic,
          });
          sessionId = record?.id ?? null;
        } catch (error) {
          logger(`[agent-chat] 建会话失败：${describe(error)}`);
        }
      }
      const discussion: ActiveDiscussion = {
        a: guardA.character,
        b: guardB.character,
        topic: trimmedTopic,
        rounds: clampedRounds,
        pendingForA: [],
        pendingForB: [],
        stopRequested: false,
        activeTurn: null,
        sessionId,
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
      // 会话事件（@since v3.45，task_094）：插话是用户说的话，落一条 message 事件。
      recordMessage(discussion, PEER_SESSION_USER_AUTHOR, trimmed);
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
