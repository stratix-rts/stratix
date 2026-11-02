/**
 * 文件职责：**角色对话回路服务**（task_035）—— 把聊天抽屉（hud 组件 `<strat-character-chat-drawer>`）
 *   的一次「发送」编排成完整回合：守门（角色在档 / 已绑 agent / agent 已检出）→ persona 前置拼装
 *   → transport 一轮对话 → 流式 chunk 逐条转发回抽屉（appendStream）→ done 收束（finalizeStream）
 *   → session id 回写。错误 → 错误气泡 + 重试路径；用户中断 → AbortSignal 杀进程树。
 * 输入：characterId + 用户文本（抽屉 onSend 回调给出）；WorldState 快照（characters + detectedAgents）；
 *   注入的 transport 工厂（生产：渲染层经 IPC 到主进程，见 chat-transport-bridge.ts；单测：打桩）。
 * 输出：对抽屉视图口（ChatDrawerView —— 结构上就是 034 组件的公开方法面）的调用序列；
 *   persistSessionId 回调（组合根接 worldStore，存档协调器的档案 diff 会自动落 SQLite）。
 *   @since v3.37（task_062）：每轮起止还向 world 通道发 unit.speaking（纯标志位，战场头顶
 *   「···」说话气泡）—— hud 不直接驱动 world（铁律），流式状态只能在这里翻译成世界事件。
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
 * | claude-code | stream-json 的 system/init 事件带 session_id（uuid） | `--resume <id>`（真续会话，上下文完整保留） | 五家里最可靠的一条链（task_055 真机两轮复验：同 id 命中 + 暗号记忆保留） |
 * | codex       | thread.started 事件带 thread_id   | `exec resume <id>`                   | 线程续接（本机未装 codex，task_055 无再复验；拼写与文档一致） |
 * | opencode    | 每条事件顶层都可能带 sessionID     | `--session <id>`（serve 模式由 server 持久化会话库；降级 run 是一次性会话，id 续接可能不生效） | 依赖有没有本地 serve 在跑 |
 * | kimi        | **stdout 纯文本不带会话 id**；stderr 收尾提示行 `To resume this session: kimi -r <uuid>` 才有（task_055 真机调研） | 拿到过 id 就 `--session <id>`（实测回显同 id = 命中） | id 走 stderr 收割（runtime 的 parseStderrLine 钩子）；失败轮也打提示行，属常态 |
 * | openclaw    | 首发由 adapter 自生成 uuid 传 `--session-id`（task_055 真机验证：自选 id 即建立同名 session）；信封 result.meta.agentMeta.sessionId 回执 | `--session-id <id>`（真续会话，实测上下文保留） | 自选 id 避免裸命令落到 gateway 主会话 |
 *
 * 统一策略（本服务不区分 adapter）：session 事件 / done.sessionId 里拿到 id 就记进会话状态并回写档案
 * （externalSessionId），下一轮原样透传 —— 「有没有续会话能力」由各家 CLI 自己兑现，本层不猜。
 *
 * ============ 重启恢复（task_055 统一口径）============
 * 内存会话表（sessions）重启即空；角色的 externalSessionId（存档回执，SQLite 档案 diff 自动落盘）
 * 是唯一能跨重启的会话线索。策略（三服务口径一致，chat 在此兑现）：
 *   ①externalSessionId **有效**（非空字符串）→ 种入内存会话状态，首发即透传 resume
 *     （续发语义：只发原文，persona 在会话上下文里，不重拼）；
 *   ②无效 / 空 → 首发重建（buildFirstPrompt：persona + 053 context 重注入，一次性讲齐）。
 * 互聊（agent-chat-service）与任务（task-service）的口径见各自文件头：任务审批门挂单表存
 * sessionId（有效→同 session 续发短指令；丢失→首发重讲，已有单测固化）；互聊短生命周期编排，
 * 重启后首发重建（externalSessionId 与聊天共用同一档案字段、后写覆盖，无法区分归属，不共享续接）。
 * 风险注记：回执指向的会话若已被 CLI 侧清理（kimi session 过期等），resume 可能落到空会话 ——
 * 兑底是下一轮的 session 事件会回新 id 并回写，自动自愈。
 *
 * ============ 会话状态系统行（task_075）============
 * 上面两种边沿事件对用户是**不可见**的：重启后第一句话接的是旧会话，还是新开的会话？
 * 用户看不出来。于是插一条 role='system' 的抽屉行（渲染复用 073 的居中弱化样式）把状态说出来：
 *   ①「已恢复会话（session xxxxxxxx）」—— runRound 起手**种子命中**时（内存无该角色会话 +
 *     档案 externalSessionId 非空 + 本轮按续发处理）：本轮接的是重启前的旧会话；
 *   ②「会话已重建（session xxxxxxxx）」—— 运行中 session 事件 / done 回的 id 与原值**不同**时
 *     （CLI 侧旧会话已被清理，resume 落到了空会话 / 换了新会话 —— task_055 风险注记里的自愈）：
 *     旧会话接不上了，本轮起是新会话。
 *   正常续聊（内存会话在、id 没变）**不插行** —— 那是常态，无需打扰。
 *
 * ⚠ **本条不入库**（与 073 的落库 system 行有口径差异，勿混）：
 *   073 的 system 行是**对话内容**（失败事件 / 中断标注）—— 它属于历史，重启回读时应当重现；
 *   本条是**会话状态的时序提示**（"刚才发生了什么"），落库会在重启回读历史时凭空多出一行，
 *   而且那一行描述的是**当时**的会话状态、跟今天的历史对不上号（甚至会盖在别天的消息上面）。
 *   故只走 view.addMessage（内存会话行），**不走 persist** —— 重启即消失，符合"瞬时提示"语义。
 *   渲染面复用同一条 system 样式（chat-drawer 的 .system-message），不新增样式、不新增依赖。
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
 *   ③ error/abort：已有流式文本先加截断标记落 assistant，错误/中断事件再落 role=system；
 *      空文本只落 system；回填时 system 渲染为居中弱化历史行（旧 role=error 行仍兼容错误气泡）；
 *   ④ 空回复占位：随气泡落 assistant（UI 平价：刷新后看到的就是当时看到的）；
 *   ⑤ 守门拦截文案（未检出/未绑定/无档案/离线）**不落库**：它们是瞬时引导，不是对话内容，重启后无意义；
 *   ⑥ retry 不重复写 user（原文已在库/会话里，重试是服务侧动作 —— 与不新增 user 气泡同一口径）。
 * 消息真相仍在抽屉会话存储 + SQLite（本服务只转发，不存第二份）。
 * ⚠ 与「消息落库」③的边界（task_055 口径）：error 轮里已收到的 session 事件照常记入内存
 *   （kimi 失败轮也建立会话，stderr 提示行照打；openclaw uuid 首发同理）—— 失败重试时若
 *   persona 已随首发指令进入会话上下文，续发原文即正确；若 CLI 侧根本没落上下文，
 *   下一轮 session 事件回新 id 自动自愈（见「重启恢复」风险注记）。
 *
 * ============ 会话域接线（@since v3.43，task_093 / v3.2a S3）============
 * 角色对话接入会话域（kind=character_chat），口径见 docs/SESSION-PLAN.md §2 接线表：
 *   ① **每角色一条长生命周期会话** —— 首轮发起时建，之后复用同一条；
 *   ② 每轮**收尾**记一条空的 'round' 事件 —— 只推进 lastEventAt / 事件计数；
 *   ③ **消息本体不双写** —— 消息真相仍在 chat_messages 表（抄一份进 session_events
 *      就是两份真相；会话域只回答"这段对话什么时候发生过"，不回答"聊了什么"）。
 * 会话记录是**旁路**：会话口缺席（端口未注入）或建会话失败都不阻断对话（可用性优先）。
 * 互聊（peer_chat）是另一回事 —— 它的会话要**全量事件**落库（修"超时即丢"），归 S4，不在本单。
 *
 * ============ 每轮经验事件（task_039）============
 * done 收束（一轮**成功**对话）后发 exp.gained（source=chat_round，amount 经注入的 expWeight
 * 换算，缺省 app/services/exp-config.ts 的临时常量）。不计发的轮次：error 事件（含用户中断
 * aborted）、守门拦截（没进 runRound）、防御性流尾（没收到 done —— 回合未成立）；空回复占位轮
 * 照发（done 到了就是完整回合，agent 只调了工具不算失败）。
 * **数值表归 task_040 的 progression 模块**（交接注记见 exp-config.ts 文件头，两侧已注明）；
 * 与 task-service（任务侧发射点）是同一注入形状，040 接管时组合根换注入件即可、两侧零改动。
 *
 * @since v3.14（task_035）；v3.15（task_036）追加消息落库时机；v3.18（task_039）追加每轮经验事件；
 *   v3.30（task_054）追加离线守门（在线位拦截 + 轻提示去重）与 transport 异常上报口；
 *   v3.31（task_055）重启恢复（externalSessionId 种入内存会话）+ 差异表校准（kimi stderr / openclaw uuid）；
 *   v3.43（task_093 / v3.2a S3）追加会话域接线（character_chat：首轮建会话 + 每轮收尾推进 lastEventAt）。
 */

import { emitWorldEvent } from '../../core/bus';
import type { SessionManager } from '../../core/session';
import type {
  AgentKind,
  CharacterView,
  DetectedAgent,
  ExpSource,
  WorldState,
} from '../../core/types';
import type { SpawnOptions, TransportErrorCode, TransportEvent } from './cli-transport/transport';
import { defaultExpWeight } from './exp-config';
import { resolveStratixContextBlock, type StratixContextSource } from './stratix-context';

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
    readonly role: 'user' | 'assistant' | 'system';
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
 * sessionRef 是写入时已知的会话 id（首发前为 null）；它是落库回执，**重启恢复时也用作种子**
 * （task_055 统一口径，见文件头「重启恢复」—— 档案 externalSessionId 字段存的就是它）。
 * @since v3.15，task_036。
 */
export interface ChatPersistedMessage {
  readonly characterId: string;
  readonly role: 'user' | 'assistant' | 'system' | 'error';
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

/**
 * 角色绑定的 CLI 已被健康监测判离线（@since v3.30，task_054：035 守门只看「在档 + 已检出」
 * —— 二进制在盘上但进程级掉线时照样能过田门；这里补上在线位裁决，拦截文案落错误气泡）。
 * 导出构建器供单测断言。
 */
export function chatOfflineText(name: string): string {
  return `「${name}」当前离线，请稍后再试`;
}

/** 本轮没有任何文本输出（agent 只调了工具 / 空回复）—— 静默比说清更让人困惑。 */
export const CHAT_MSG_EMPTY_REPLY = '（本轮没有文本回复）';

/** 用户主动中断后的标注气泡。 */
export const CHAT_MSG_INTERRUPTED = '（已中断）';

/** 重启后命中档案会话种子的瞬时提示（只上抽屉，不落库）。 */
export function chatSessionRestoredText(sessionId: string): string {
  return `已恢复会话（session ${sessionId.slice(0, 8)}）`;
}

/** 旧会话被 CLI 侧替换为新 id 的瞬时提示（只上抽屉，不落库）。 */
export function chatSessionRebuiltText(sessionId: string): string {
  return `会话已重建（session ${sessionId.slice(0, 8)}）`;
}

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
 * @since v3.29（task_053）可选第三参 contextBlock：<stratix-context> 战场现状块
 * （首发才注入，插入位置在 persona 之后、用户消息之前 —— 续发不拼装，见 runRound）。
 * 传 undefined 走原路径（三参调用方零改动兼容）；persona 空但块存在时也保留引导语与
 * 【用户消息】结构（块需要角色语境，裸文本拼进去会读不出主语）。
 */
export function buildFirstPrompt(
  character: CharacterView,
  message: string,
  contextBlock?: string
): string {
  const persona = character.persona.trim();
  const hasContext = contextBlock !== undefined && contextBlock.length > 0;
  if (persona.length === 0 && !hasContext) return message;
  const parts: string[] = [];
  parts.push(`你将扮演「${character.name}」这个角色与用户对话，请全程保持角色设定一致。`);
  if (persona.length > 0) parts.push(`【角色设定】\n${persona}`);
  if (hasContext) parts.push(contextBlock as string);
  parts.push(`【用户消息】\n${message}`);
  return parts.join('\n\n');
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
  /**
   * 世界快照读取口（组合根传 worldStore.getState；单测传夹具）。
   * @since v3.30（task_054）类型面增 units：离线守门要查在线位（guard 的第四条）。
   * 组合根与测试注入的都是完整 getState，零改动兼容。
   */
  readonly getState: () => Pick<WorldState, 'characters' | 'detectedAgents' | 'units'>;
  /** transport 工厂（生产：IPC 桥；单测：打桩）。 */
  readonly createTransport: ChatTransportFactory;
  /** 会话 id 回写口（组合根接 worldStore —— 存档协调器会顺着档案 diff 自动落库）。 */
  readonly persistSessionId: (characterId: string, sessionId: string) => void;
  /**
   * 消息落库口（@since v3.15，task_036；缺省不落库）。同步签名、实现方内部异步 ——
   * 组合根注入 makeChatMessagePersister(chatHistoryApi())；时机见文件头「消息落库」。
   */
  readonly persistMessage?: (message: ChatPersistedMessage) => void;
  /**
   * 经验权重函数（@since v3.18，task_039；缺省 exp-config 的临时常量表）。
   * **task_040 交接点**：progression 模块接管数值时换掉这个注入件，本服务零改动
   * （与 task-service 的同形注入是刻意的一对，040 换一次注入两侧都接管）。
   */
  readonly expWeight?: (source: ExpSource) => number;
  /**
   * context-source 注入件（@since v3.29，task_053；缺省不注入）。零 IO：组合根用
   * createStratixContextProvider 组装（读 WorldState / 两级开关裁决都在装配方），
   * 本服务只在**首发**取一次快照（resolveStratixContextBlock；异常吞掉不绑架对话）。
   */
  readonly provideContext?: StratixContextSource;
  /** 单轮超时；缺省 DEFAULT_CHAT_ROUND_TIMEOUT_MS。 */
  readonly timeoutMs?: number;
  /** 日志口；缺省静默。 */
  readonly logger?: (line: string) => void;
  /**
   * transport 异常上报口（@since v3.30，task_054；缺省不上报）。执行期 error 事件回调
   * （kind + 错误码；aborted = 用户中断，健康监测那边自己会忽略）。组合根接
   * health-monitor.recordTransportFailure（非 aborted 记一条 unhealthy 审计）。
   * 同步签名、fire-and-forget。
   */
  readonly onTransportError?: (kind: AgentKind, code: TransportErrorCode) => void;
  /**
   * 入口拦截轻提示口（@since v3.30，task_054；缺省不提示）。离线拦截时回调一次文案
   * （按角色去重：掉线期间只提示一次，守门通过即重置）。组合根接 toast-host（warn tone）。
   */
  readonly notify?: (text: string) => void;
  /**
   * 会话域写入面（可选，@since v3.43，task_093 / v3.2a S3）—— 角色对话的会话记录
   * （kind=character_chat）。**缺省 = 不记会话**（对话照常，只少一条会话轨迹）。
   *
   * 口径（方案 docs/SESSION-PLAN.md §2 接线表「character_chat」行）：
   *   - 每角色**一条长生命周期会话**（首轮建，之后复用同一条）；
   *   - 每轮收尾只**推进 lastEventAt / 事件计数**（记一条空的 'round' 事件）；
   *   - **消息本体不双写** —— 消息真相仍在 chat_messages 表（双写即两份真相）。
   */
  readonly sessions?: SessionManager;
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
  const expWeight = deps.expWeight ?? defaultExpWeight;

  /** characterId → 会话状态。懒建：首次对话的角色才进表。 */
  const sessions = new Map<string, ChatSessionState>();
  /**
   * characterId → 会话域的会话 id（character_chat：每角色一条长生命周期会话）。
   * why 单独一张表而不塞进 ChatSessionState：那张表记的是**CLI 侧的外部会话句柄**
   *   （各家 agent 的 session id / busy 锁），这里是**本域的会话记录** —— 两回事，
   *   混在一张表里迟早把"外部会话"和"域会话"当同一个东西。
   */
  const chatSessionIds = new Map<string, string>();
  /** 全局单飞（见文件头「单飞约束」）。 */
  let activeRun: ActiveRun | null = null;
  /** characterId → 最近一次失败的原文（重试路径的弹药；新一轮 send 会清掉）。 */
  const lastFailed = new Map<string, string>();
  /** kind → transport 缓存（IPC 桥的 transport 无状态可缓存；省一次工厂往返）。 */
  const transports = new Map<AgentKind, ChatTransportPort>();

  /** 离线拦截去重表（task_054）：掉线期间每角色只提示一次（防连点轰炸 toast）。 */
  const offlineNotified = new Set<string>();

  /** transport 异常上报（task_054）：回调抛错只记日志 —— 健康审计是旁路，不绑架对话回路。 */
  const reportTransportError = (kind: AgentKind, code: TransportErrorCode): void => {
    if (!deps.onTransportError) return;
    try {
      deps.onTransportError(kind, code);
    } catch (error) {
      logger(`[chat-service] transport 异常上报抛错（${kind}/${code}）：${describe(error)}`);
    }
  };

  const transportFor = (kind: AgentKind): ChatTransportPort => {
    const cached = transports.get(kind);
    if (cached) return cached;
    const created = deps.createTransport(kind);
    transports.set(kind, created);
    return created;
  };

  /** 记 / 回写会话 id：同一个 id 不重复回写（runtime 已对 session 事件去重，这里兜 done.sessionId 的路）。 */
  const applySession = (characterId: string, session: ChatSessionState, sessionId: string): void => {
    const previousSessionId = session.sessionId;
    if (previousSessionId === sessionId) return;
    session.sessionId = sessionId;
    if (previousSessionId !== null) {
      view.addMessage({ characterId, role: 'system', text: chatSessionRebuiltText(sessionId) });
    }
    try {
      deps.persistSessionId(characterId, sessionId);
    } catch (error) {
      // 回写失败不致命：会话在内存里还续得上，只是重启后要重新开局。
      logger(`[chat-service] 会话 id 回写失败（${characterId}）：${describe(error)}`);
    }
  };

  /**
   * 会话首（发起，@since v3.43，task_093）：每角色一条 character_chat 会话 —— 首轮建，之后复用。
   * why 建在「发起」而不是「收尾」：会话要覆盖**整段对话**（从第一句话到最近一轮），
   *   建在收尾就只剩最后一轮的残影。
   * 建会话失败（达上限等）不阻断对话 —— 会话记录是旁路，不是对话的前提。
   */
  const ensureChatSession = (characterId: string, characterName: string): string | null => {
    if (!deps.sessions) return null;
    const existing = chatSessionIds.get(characterId);
    if (existing) return existing;
    const record = deps.sessions.createSession({
      kind: 'character_chat',
      participants: [characterId],
      title: `角色对话：${characterName}`,
    });
    if (!record) return null;
    chatSessionIds.set(characterId, record.id);
    return record.id;
  };

  /**
   * 会话尾（收尾，@since v3.43，task_093）：记一条**空的** 'round' 事件 ——
   * 只推进 lastEventAt / 事件计数，**不落消息本体**（消息真相在 chat_messages 表；
   * 把消息再抄一份进 session_events 就是两份真相，见方案 §2 接线表 character_chat 行）。
   */
  const touchChatSession = (characterId: string): void => {
    if (!deps.sessions) return;
    const sessionId = chatSessionIds.get(characterId);
    if (!sessionId) return;
    try {
      deps.sessions.appendEvent(sessionId, { type: 'round', payload: {} });
    } catch (error) {
      logger(`[chat-service] 会话记账抛错（${characterId}）：${describe(error)}`);
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

  /**
   * 每轮经验事件（task_039）：只在 done 收束后调（时机与不计发口径见文件头）；
   * 权重 ≤ 0 不发；mitt 不该抛，防御性包一层 —— exp 是旁路事件，不绑架对话回路。
   */
  const emitChatRoundExp = (characterId: string): void => {
    const amount = expWeight('chat_round');
    if (amount <= 0) return;
    try {
      emitWorldEvent({ type: 'exp.gained', characterId, source: 'chat_round', amount });
    } catch (error) {
      logger(`[chat-service] exp.gained 发射失败（${characterId}/chat_round）：${describe(error)}`);
    }
  };

  /**
   * 说话气泡事件（task_062）：runRound 起手发 true、finally 发 false —— 战场头顶「···」
   * 气泡的起止信号。角色没上战场（units 里没有它的单位）则不发（消费方找不到节点，
   * 发了也没人接）；mitt 不该抛，防御性包一层 —— 气泡是旁路表现，不绑架对话回路。
   * 纯标志位：不雪球流式文本（规格钦点最简语义「正在说话」，见 core/types 的 unit.speaking）。
   */
  const emitUnitSpeaking = (characterId: string, speaking: boolean): void => {
    try {
      const unit = deps.getState().units.find((u) => u.characterId === characterId);
      if (!unit) return;
      emitWorldEvent({ type: 'unit.speaking', unitId: unit.id, speaking });
    } catch (error) {
      logger(`[chat-service] unit.speaking 发射失败（${characterId}/${speaking}）：${describe(error)}`);
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
    // task_054：在线位拦截（第四条）—— units.online === false 才拦（缺省 / true = 在线；
    // 与 UnitView.online 契约同口径：老档 / 未探测不误伤）。拦截文案落错误气泡（不入库，
    // 与⑤其它守门文案同口径）+ 轻提示（去重，防连点轰炸）。
    if (state.units.some((unit) => unit.characterId === characterId && unit.online === false)) {
      view.addMessage({ characterId, role: 'assistant', text: chatOfflineText(character.name), error: true });
      if (!offlineNotified.has(characterId)) {
        offlineNotified.add(characterId);
        if (deps.notify) {
          try {
            deps.notify(`「${character.name}」当前离线`);
          } catch (error) {
            logger(`[chat-service] 离线拦截提示抛错：${describe(error)}`);
          }
        }
      }
      return null;
    }
    offlineNotified.delete(characterId); // 守门通过 = 在线，去重位重置
    return character;
  };

  /** 一轮对话的完整生命周期（守门已过）。 */
  const runRound = async (character: CharacterView, kind: AgentKind, text: string): Promise<void> => {
    const characterId = character.id;
    // 重启恢复（task_055）：内存会话表没有该角色时，用档案 externalSessionId（存档回执）作种子 ——
    // 有效（非空）→ 本轮按续发处理（透传 resume，只发原文，persona 在会话上下文里）；
    // 无效 / 空 → sessionId=null，首发重建（persona + 053 context 重注入，见下方拼装分支）。
    // 种子只做一次：内存状态建立后，回执不再是真相源（运行中的 session 事件才是）。
    const existing = sessions.get(characterId);
    const session: ChatSessionState = existing ?? {
      sessionId: typeof character.externalSessionId === 'string' && character.externalSessionId.length > 0
        ? character.externalSessionId
        : null,
      busy: false,
    };
    sessions.set(characterId, session);
    if (!existing && session.sessionId !== null) {
      view.addMessage({ characterId, role: 'system', text: chatSessionRestoredText(session.sessionId) });
    }

    const run: ActiveRun = { characterId, controller: new AbortController() };
    activeRun = run;
    session.busy = true;
    lastFailed.delete(characterId);
    view.setSending(true);
    // 说话气泡起（task_062）：流式期间（含工具轮询的等待）头顶「···」常亮脉动 ——
    // 「正在说话」从 spawn 开始算，到 finally 收束（成功 / 失败 / 中断都收）。
    emitUnitSpeaking(characterId, true);

    // 首发（还没有会话 id）才拼 persona（+ 战场现状块，task_053：上下文一次性注入，
    // 续发不重拼 —— 会话上下文里已经有了）；续发只发原文（见文件头「persona 怎么传」）。
    const prompt =
      session.sessionId === null
        ? buildFirstPrompt(
            character,
            text,
            resolveStratixContextBlock(deps.provideContext, characterId, logger) || undefined
          )
        : text;
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
          // 每轮经验（task_039）：done 到了就是完整回合（空回复占位也计）；error 轮在下面分支返回，
          // 根本走不到这里 —— 不计发的口径见文件头「每轮经验事件」。
          emitChatRoundExp(characterId);
          return;
        }
        if (event.type === 'error') {
          // 先收束已流出的部分（诚实保留半截回答），再落错误气泡。
          view.finalizeStream();
          // task_054：exit 异常旁路上报健康监测（aborted 在那边被忽略，统一透传不在此处分支）。
          reportTransportError(kind, event.code);
          const aborted = event.code === 'aborted';
          if (assistantText.length > 0) {
            persist({
              characterId,
              role: 'assistant',
              text: `${assistantText}${aborted ? CHAT_MSG_INTERRUPTED : '（输出中断）'}`,
              sessionRef: session.sessionId,
            });
          }
          if (aborted) {
            view.addMessage({ characterId, role: 'assistant', text: CHAT_MSG_INTERRUPTED });
            persist({ characterId, role: 'system', text: CHAT_MSG_INTERRUPTED, sessionRef: session.sessionId });
          } else {
            lastFailed.set(characterId, text);
            const errorText = chatErrorText(event.code, event.message);
            view.addMessage({ characterId, role: 'assistant', text: errorText, error: true });
            persist({ characterId, role: 'system', text: errorText, sessionRef: session.sessionId });
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
      if (assistantText.length > 0) {
        persist({ characterId, role: 'assistant', text: `${assistantText}（输出中断）`, sessionRef: session.sessionId });
      }
      persist({ characterId, role: 'system', text: thrownText, sessionRef: session.sessionId });
    } finally {
      if (activeRun === run) activeRun = null;
      session.busy = false;
      view.setSending(false);
      // 说话气泡止（task_062）：成功 / 失败 / 中断 / 异常路径统一在这收 —— 不发的话
      // 气泡会永远挂在头上（表现泄漏），所以放 finally 而不是各分支各发一遍。
      emitUnitSpeaking(characterId, false);
      // 会话尾（@since v3.43，task_093）：本轮结束 → 推进会话的 lastEventAt（只记计数，不落消息本体）。
      touchChatSession(characterId);
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
    // 会话首（@since v3.43，task_093）：本轮要跑了 → 先把角色会话建起来（首轮建，之后复用）。
    ensureChatSession(characterId, character.name);
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
