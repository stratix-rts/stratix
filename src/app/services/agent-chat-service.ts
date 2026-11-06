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
 * ============ 续聊恢复（@since v3.47，task_101 / v3.2b-B2）============
 * resume 的口径（方案 docs/SESSION-PLAN.md §8「resume 第一期只做 peer_chat」）：
 *   ① **回灌**：会话被中断后，core/session 的 manager.resume 读事件流、构建上下文快照
 *      （core/session/context-replay.ts 的回灌消息列表），本服务把它拼成**系统注入历史**
 *      喂进续跑的第一条指令（参与者由此"记得"刚才聊到哪）；
 *   ② **重启轮转**：从"上一位发言者的对方"起手继续转（不是从头开题 —— 议题已在上文里）；
 *   ③ **不降级**：参与者不在场（角色被删）/ 未绑 CLI / 离线 / 会话不是互聊 / 不是被中断的
 *      —— 一律**如实报错**并停下，绝不"另起一场新讨论"冒充续跑；
 *   ④ 恢复后 status=active（manager.resume 的原子提交），并追加一条「（续聊恢复）」事件 ——
 *      续跑的发言继续记在**同一条会话**下面（历史不断线）。
 *
 * ============ @会话引用（@since v3.49，task_107 / v3.2b-B8）============
 * 议题里可以写 `@session_<会话 id>` —— 把**另一场会话**的近期内容接进这场讨论：
 *   ① 解析（core/session/reference.ts 的语法口径）：议题里有几个引用就取几个（0 个 = 老路径）；
 *   ② 校验存在性 → 读被引用会话的近期事件 → 拼成注入块（【引用会话 <title>(<id>) 摘要/时间线】…）；
 *   ③ 注入**首轮**指令的头部（每个 agent 只在第一次发言时拿到一次 —— 它自己的 CLI 会话里
 *      已经有了，之后每轮再塞一遍就是白烧 token）；
 *   ④ **留痕**：本场会话追加一条 type=reference 事件（payload = 被引用的会话 id）——
 *      事后能解释"agent 为什么知道那件事"。
 *
 * 引用不存在 / 写法不合法 → **如实报错并中止开场**（不进 transport）：讨论的前提就是那份上下文，
 *   缺了它还照跑 = 答非所问（与守门拦截同一处置：提示 + 收束）。
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
import type {
  SessionEventInput,
  SessionManager,
  SessionReplayMessage,
  SessionTitleService,
} from '../../core/session';
import type {
  AgentKind,
  CharacterView,
  ExpSource,
  SessionRecord,
  WorldState,
} from '../../core/types';

import {
  buildFirstPrompt,
  isAgentKindInstalled,
  type ChatPersistedMessage,
  type ChatTransportFactory,
  type ChatTransportPort,
} from './chat-service';
import type { TransportErrorCode } from './cli-transport/transport';
import { defaultExpWeight } from './exp-config';
import {
  resolveSessionReferences,
  type SessionReferenceService,
} from './session-reference';
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

/**
 * 会话事件里「系统」这一方的署名（@since v3.47，task_101）。
 * why 单独一个署名：恢复标记是**系统**记的（不是谁说的话），回灌时它不该被当成
 *   某一方的话塞进上下文（引擎侧按这个署名跳过 —— 见 buildResumeContextBlock）。
 */
export const PEER_SESSION_SYSTEM_AUTHOR = '系统';

/**
 * 续聊恢复的标记（@since v3.47，task_101）—— 与「（互聊中断：原因）」同一措辞口径。
 * 它同时是：抽屉里给用户看的一句话 + 会话事件流里的一条留痕（事件文本即本串）。
 */
export const PEER_MSG_RESUMED = '（续聊恢复）';

/**
 * 注入模型的上文条数上限（@since v3.47，task_101）。
 * why 要有上限：回灌块整体进 prompt，无界 = 无界 token 账单 + 无界延迟。
 * why 默认 40：够接上最近几轮的话题；core 的回灌快照本身已经封顶 200 条（那层管"读多少"，
 *   这层管"喂多少"—— 两层各管一段，缺一层就会有一处无界）。
 */
export const PEER_RESUME_CONTEXT_MAX_MESSAGES = 40;

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

/**
 * 回灌消息 → 注入模型的**系统历史块**（@since v3.47，task_101）。
 *
 * why 是"系统注入历史"而不是把上文当成新一轮对话：上文是**已经发生过的**内容，
 *   混进"这一轮该说什么"里会让模型把它当成新输入重复回应。
 * why 按作者署名逐行写：回灌消息的 role 是相对续跑方定的（自己=assistant / 对方=user），
 *   但**两个人都在场**，写成"我说/你说"会有一半是反的 —— 按署名（阿尔法：…）最不容易出错。
 * why 跳过「系统」署名的行：那是恢复标记（系统记的，不是谁说的话），
 *   塞进上下文只会让模型以为用户说了句「（续聊恢复）」。
 * why 截断只留最近的：续跑关心的是"刚才聊到哪"；被丢掉多少明写在块尾（截断是显式的）。
 *
 * @returns 注入块；无可注入内容时返回空串（调用方据此不拼前缀）。
 */
export function buildResumeContextBlock(
  messages: readonly SessionReplayMessage[],
  maxMessages: number = PEER_RESUME_CONTEXT_MAX_MESSAGES
): string {
  const limit = Math.max(1, Math.floor(maxMessages));
  const kept = messages.filter((message) => message.author !== PEER_SESSION_SYSTEM_AUTHOR);
  if (kept.length === 0) return '';
  const recent = kept.slice(Math.max(0, kept.length - limit));
  const dropped = kept.length - recent.length;
  const lines = recent.map((message) => `${message.author}：${message.content}`);
  const header = `【本次续聊的上文（回灌 ${kept.length} 条）】`;
  const tail = dropped > 0 ? `（更早的 ${dropped} 条上文未注入）` : '';
  return [header, ...lines, tail].filter((line) => line.length > 0).join('\n');
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
  /**
   * 续跑上下文（@since v3.47，task_101）—— null = 这是一场**新**讨论（走开题流程）。
   * 非 null = 从被中断的会话续跑：注入上文 + 从指定的一方起手。
   */
  readonly resume: ResumeContext | null;
  /**
   * @会话引用的**注入块**（@since v3.49，task_107）—— 空串 = 议题里没有引用。
   * 只在**首轮**注入（每个 agent 的第一次发言）：此后它自己的 CLI 会话里已经有了。
   */
  readonly referenceBlock: string;
}

/**
 * 续跑上下文（@since v3.47，task_101）。
 *
 * why 要记"先说话的一方"：链式对谈里下一位是**上一位的对方**（否则角色会自问自答）。
 *   上文由回灌消息还原（最后一条发言是谁说的 → 下一位就是另一位）。
 */
interface ResumeContext {
  /** 注入模型的上文块（buildResumeContextBlock 的产物；空串 = 没有可注入的内容）。 */
  readonly contextBlock: string;
  /** 先说话的一方（上一位发言者的对方）。 */
  readonly nextSide: 'a' | 'b';
  /** 上一位的发言原文（转述指令的输入）。 */
  readonly lastText: string;
  /** 是否已有对话内容（false = 中断前一句没说，等于重新开题）。 */
  readonly hasHistory: boolean;
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
  /**
   * 自动起名服务（可选，@since v3.47，task_104 / v3.2b-B5）—— 开场后**异步**起名。
   * 缺省 = 不起名（标题就是建会话时那条规则版标题）。
   *
   * 口径：起名是**旁路** —— 不阻塞互聊开场（调用方 `void` 掉即可），
   *   起完由会话域的 manager.updateTitle 写回并投影到 WorldState。
   */
  readonly titles?: SessionTitleService;
  /**
   * @会话引用解析服务（可选，@since v3.49，task_107 / v3.2b-B8）—— 解析议题里的
   * `@session_<id>`，把被引用会话的近期内容拼成上下文块注入首轮指令。
   * 缺省 = 议题里的 `@session_…` **无法解析**（此时会如实报错中止开场 —— 见文件头「@会话引用」）。
   */
  readonly references?: SessionReferenceService;
}

/**
 * 续聊恢复的回执（@since v3.47，task_101）。
 *
 * why 要有 code：调用方（HUD / 命令路由 / MCP）需要**机器可判**的失败原因，
 *   人话文案（reason）给人看，code 给程序看 —— 两份都要，不能只有一份。
 */
export interface AgentChatResumeOutcome {
  /** 是否恢复成功（成功 = 已重启轮转；失败 = 如实报错，没恢复）。 */
  readonly ok: boolean;
  /** 失败原因码（成功时缺省）。 */
  readonly code?:
    | 'no-session-port'
    | 'busy'
    | 'not-found'
    | 'unsupported-kind'
    | 'illegal-transition'
    | 'character-missing'
    | 'guard-rejected'
    | 'resume-rejected';
  /** 人话说明（失败时必有；成功时也有一句摘要）。 */
  readonly reason: string;
  /** 恢复的会话 id（成功时）。 */
  readonly sessionId?: string;
  /** 回灌了多少条上文（成功时；用于回执与观测）。 */
  readonly replayedMessages?: number;
}

/** 对外形状（组合根与单测按它操作）。 */
export interface AgentChatService {
  /**
   * 发起一场讨论：A 就议题首发，B 应答，循环 rounds 轮（每轮双方各一回）。
   * resolve 于整场收束（轮数走完 / 中断 / 停止 / 守门拦截）。已在跑时静默忽略。
   */
  start(initiatorId: string, peerId: string, topic: string, rounds?: number): Promise<void>;
  /**
   * 续跑一条被中断的互聊会话（@since v3.47，task_101）：回灌上文 + 重启轮转。
   * resolve 于整场续聊收束（轮数走完 / 中断 / 停止）。
   * 失败一律**如实报错**（见 AgentChatResumeOutcome 的 code 词表），绝不降级成"另起一场"。
   */
  resume(sessionId: string): Promise<AgentChatResumeOutcome>;
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

  /**
   * 找一条会话摘要（@since v3.47，task_101）。
   * why 从会话域自己的 store 找，而不是从 deps.getState()：会话摘要的真相在
   *   core/session 的 manager 写的那份 WorldState.sessions（会话域自带的 store），
   *   角色档案才从 deps.getState() 取（世界态）。两处真相各归其主，不混。
   */
  const findSessionRecord = (sessionId: string): SessionRecord | null => {
    if (!deps.sessions) return null;
    const sessions = deps.sessions.store.getState().sessions ?? [];
    return sessions.find((item) => item.id === sessionId) ?? null;
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
    const resumeCtx = discussion.resume;

    let lastText: string; // 上一位发言者的产出（开题轮 A 的输入即议题；后续回合转述它）
    /** 先说话的一方（新讨论 = A 首发；续跑 = 上一位发言者的对方）。 */
    let firstSide: 'a' | 'b';

    if (resumeCtx) {
      // 续跑（@since v3.47，task_101）：**不开题**（议题已在上文里，重复开题等于让模型重头再来），
      //   也不重复记议题事件（那一条已经在事件流里）。
      lastText = resumeCtx.lastText;
      firstSide = resumeCtx.nextSide;
      view.addMessage({ role: 'user', text: `${PEER_MSG_RESUMED}继续讨论：${topic}` });
    } else {
      // 开题气泡 + 双方历史各落一条 user（两边都自带议题上下文，文件头「落库约定」①）。
      const openingForA = buildOpeningPrompt(b.name, topic);
      view.addMessage({ role: 'user', text: openingForA });
      persist(a.id, 'user', openingForA, null);
      persist(b.id, 'user', buildOpeningPrompt(a.name, topic), null);
      // 会话事件（@since v3.45，task_094）：议题是用户说的话，落一条 message 事件
      //   （会话标题里也有议题，但那是摘要；这里记的是历史本体）。
      recordMessage(discussion, PEER_SESSION_USER_AUTHOR, topic);
      lastText = openingForA;
      firstSide = 'a';
    }

    /** 中断原因（非空 = 这场是被打断的，不是走完的）。 */
    let interruptReason: string | null = null;

    discussionLoop: for (let round = 1; round <= rounds; round += 1) {
      view.setPeerRound(round, rounds);
      // 发言次序：新一轮 A 先说；续跑时由"上一位的对方"先说（否则角色会自问自答）。
      const sideOrder: readonly ('a' | 'b')[] = firstSide === 'a' ? ['a', 'b'] : ['b', 'a'];
      for (const side of sideOrder) {
        if (discussion.stopRequested) break discussionLoop;
        const other: 'a' | 'b' = side === 'a' ? 'b' : 'a';
        // A 的第一回合 = 议题首发；其余回合 = 转述对方上一轮输出（交替发言 → 对方恒是上一位）。
        // 续跑时（hasHistory）一律转述：上一位是谁就转述谁，谁先说都一样。
        const base =
          resumeCtx && resumeCtx.hasHistory
            ? buildRelayPrompt((other === 'a' ? a : b).name, lastText, topic)
            : side === 'a' && round === 1
              ? buildOpeningPrompt(b.name, topic)
              : buildRelayPrompt((other === 'a' ? a : b).name, lastText, topic);
        // 上文注入（@since v3.47，task_101）：续跑时把回灌块拼在指令前 ——
        //   每一方都带（各自的 CLI 会话可能已经不在了，上文只能靠这段块补回来）。
        // 引用注入（@since v3.49，task_107）：**只在首轮**给（每个 agent 的第一次发言）——
        //   此后它自己的 CLI 会话里已经有了，每轮再塞一遍就是白烧 token。
        const head = [round === 1 ? discussion.referenceBlock : '', resumeCtx?.contextBlock ?? '']
          .filter((part) => part.length > 0)
          .join('\n\n');
        const prompt = head.length > 0 ? `${head}\n\n${base}` : base;
        const outcome = await runTurn(discussion, side, prompt);
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
      // @会话引用（@since v3.49，task_107）：议题里的 `@session_<id>` → 解析 → 注入块。
      //   引用不存在 / 写法不合法 → **如实报错并中止开场**（不进 transport）：
      //   讨论的前提就是那份上下文，缺了它还照跑 = 答非所问（与守门拦截同一处置）。
      const references = resolveSessionReferences(trimmedTopic, deps.references);
      if (!references.ok) {
        view.addMessage({ role: 'assistant', text: references.reason ?? '引用的会话无法解析' });
        view.endPeerChat();
        return;
      }
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
      // 引用留痕（@since v3.49，task_107）：本场会话各记一条 'reference' 事件
      //   （payload = 被引用的会话 id）—— 事后能解释"agent 为什么知道那件事"。
      if (sessionId && deps.sessions) {
        for (const targetSessionId of references.targetIds) {
          try {
            deps.sessions.appendEvent(sessionId, {
              type: 'reference',
              payload: { targetSessionId },
            });
          } catch (error) {
            logger(`[agent-chat] 引用留痕抛错（${sessionId}/${targetSessionId}）：${describe(error)}`);
          }
        }
      }
      // 自动起名（@since v3.47，task_104 / v3.2b-B5）：**异步旁路** —— 不阻塞互聊开场。
      //   无 env 配置时起名实现就是规则版，算出的标题与建会话时那条一字不差 → 写回时同名不改
      //   （既不广播也不落库，行为与 2a 完全一致）。
      if (sessionId && deps.titles) {
        void deps.titles.retitle(sessionId, {
          kind: 'peer_chat',
          participants: [guardA.character.id, guardB.character.id],
          firstUserMessage: trimmedTopic,
        });
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
        resume: null,
        referenceBlock: references.block,
      };
      active = discussion;
      try {
        await runDiscussion(discussion);
      } finally {
        active = null;
      }
    },

    /**
     * 续跑一条被中断的互聊会话（@since v3.47，task_101）。
     *
     * 顺序（**先判后写**，与文件头「续聊恢复」的口径一致）：
     *   1. 端口在不在 / 有没有别的讨论在跑；
     *   2. 会话存在吗、是不是互聊、是不是被中断的（准入）；
     *   3. 参与者**仍在场**吗（角色被删 = 如实报错，不降级）；守门（绑定 / 检出 / 在线）；
     *   4. 交给 core/session 的 manager.resume：翻状态位（interrupted → active）+ 建回灌快照；
     *   5. 追加「（续聊恢复）」事件 → 重启轮转（发言继续记在同一条会话下）。
     *
     * why 第 4 步在第 3 步之后：状态翻了却起不来（角色没了）就是"恢复了个寂寞" ——
     *   先把能不能跑判断清楚，再动状态。
     */
    async resume(sessionId: string): Promise<AgentChatResumeOutcome> {
      const fail = (
        code: NonNullable<AgentChatResumeOutcome['code']>,
        reason: string
      ): AgentChatResumeOutcome => {
        view.addMessage({ role: 'assistant', text: reason });
        view.endPeerChat();
        return { ok: false, code, reason };
      };

      if (!deps.sessions) {
        return fail('no-session-port', '会话域未接入，无法恢复续聊');
      }
      if (active) {
        return fail('busy', '已有一场讨论在进行，先停掉它再恢复');
      }
      const record = findSessionRecord(sessionId);
      if (!record) {
        return fail('not-found', `会话「${sessionId}」不存在`);
      }
      if (record.kind !== 'peer_chat') {
        return fail(
          'unsupported-kind',
          `会话「${record.title}」是 ${record.kind} 类，第一期只支持互聊会话恢复续聊`
        );
      }
      if (record.status !== 'interrupted') {
        return fail(
          'illegal-transition',
          `会话「${record.title}」当前是 ${record.status}，只有被中断的会话可恢复`
        );
      }

      const state = deps.getState();
      const found = record.participants.map((id) => state.characters.find((c) => c.id === id) ?? null);
      const missing = record.participants.filter((_, index) => found[index] === null);
      if (missing.length > 0) {
        // 不降级：角色不在场就**如实报错**，绝不"另起一场新讨论"冒充续跑。
        return fail(
          'character-missing',
          `参与者 ${missing.join('、')} 已不在当前世界状态里，无法续聊`
        );
      }
      if (found.length !== 2) {
        return fail(
          'unsupported-kind',
          `会话「${record.title}」的参与者不是两位角色，无法续跑`
        );
      }
      const characterA = found[0]!;
      const characterB = found[1]!;
      // 守门与开场同口径：没绑 CLI / CLI 没检出 / 离线 → 不能续跑（如实报错）。
      for (const character of [characterA, characterB]) {
        const guard = guardOne(state, character.id);
        if (!guard.ok) {
          return fail('guard-rejected', guard.reason);
        }
      }

      // 状态翻位 + 回灌快照（core/session 的 manager：原子提交，顺带记一条 'resumed' 事件）。
      //   失败 = 状态不允许，或**没有事件源**（回灌不出上文）—— 都不编造，直接如实报错。
      const outcome = deps.sessions.resume(sessionId, { selfParticipantId: characterA.name });
      if (!outcome) {
        return fail(
          'resume-rejected',
          `会话「${record.title}」恢复失败（状态不允许，或会话历史未接入、无法回灌上文）`
        );
      }

      const messages = outcome.snapshot.messages;
      // 「（续聊恢复）」留痕：事件流里一条（抽屉里看得见"这儿续上了"）。
      deps.sessions.appendEvent(sessionId, {
        type: 'message',
        payload: { author: PEER_SESSION_SYSTEM_AUTHOR, text: PEER_MSG_RESUMED },
      });

      // 议题：从上文里取用户说的第一条（取不到就用会话标题 —— 标题本身就是议题的摘要）。
      const topic =
        messages.find((message) => message.author === PEER_SESSION_USER_AUTHOR)?.content.trim() ||
        record.title;
      // 上一位发言者 → 下一位是**对方**（链式对谈不能自问自答）。
      const lastTurn = [...messages]
        .reverse()
        .find(
          (message) =>
            message.kind === 'message' &&
            (message.author === characterA.name || message.author === characterB.name)
        );
      const hasHistory = Boolean(lastTurn);
      const nextSide: 'a' | 'b' = lastTurn && lastTurn.author === characterA.name ? 'b' : 'a';
      const lastText = lastTurn ? lastTurn.content : buildOpeningPrompt(characterB.name, topic);

      const discussion: ActiveDiscussion = {
        a: characterA,
        b: characterB,
        topic,
        // 续跑的轮数用缺省（3）：原场次跑了几轮没有留痕 —— 宁可少跑几轮，也不假装知道。
        rounds: DEFAULT_PEER_ROUNDS,
        pendingForA: [],
        pendingForB: [],
        stopRequested: false,
        activeTurn: null,
        sessionId,
        resume: {
          contextBlock: buildResumeContextBlock(messages),
          nextSide,
          lastText,
          hasHistory,
        },
        // 续跑没有新议题 → 没有新的引用（引用是**发起时**的输入）。
        referenceBlock: '',
      };
      active = discussion;
      try {
        await runDiscussion(discussion);
      } finally {
        active = null;
      }
      return {
        ok: true,
        reason: `已恢复会话「${record.title}」并续聊`,
        sessionId,
        replayedMessages: messages.length,
      };
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
