/**
 * 文件职责：**会话域（core/session）的类型契约** —— 事件信封（落 session_events 表的本体）、
 *   会话域的入参/载荷类型；并把**总线契约层**的会话类型原样转出。
 *   方案来源：docs/SESSION-PLAN.md §2「域模型（core/session）」。
 * 输入/输出：本文件只有类型声明与本域的条数/长度上限常量，无运行时逻辑。
 * 禁止事项：
 *   1. 写逻辑（起名规则 / 状态裁决 / 事件封装）—— 逻辑在 machine.ts（纯函数）；
 *   2. 把事件本体塞进 WorldState —— 入态的只有摘要（SessionRecord），事件走 session_events 表
 *      （否则 WorldState 会随消息数无限膨胀，违反"广播体积必须有界"的性能铁律）；
 *   3. 依赖 core 之外的层（app / hud / gateway）—— core 只认自己的契约。
 *
 * 为什么 SessionKind / SessionStatus / SessionRecord **定义在 core/types.ts 而不是这里**：
 *   core/types.ts 是总线契约的**叶子文件**（其文件头铁律「禁止事项 1：引入任何 import」——
 *   契约文件必须是依赖图的叶子，任何依赖都会让 world/hud 两层间接耦合）。
 *   而 WorldState.sessions 要引用 SessionRecord —— 契约文件不能 import 子目录，
 *   所以"入态形状"只能住在 core/types.ts；本文件负责**转出**它们，
 *   让 core/session 内部只 import 本文件就能拿到全套会话类型（模块对外只认一个出口）。
 *
 * 分层：types（契约）→ machine（纯逻辑：判相位 / 起名 / 封事件）→ manager（写 store + 上报 Notice）。
 */

import type { SessionKind, SessionRecord, SessionStatus } from '../types';

export type { SessionKind, SessionRecord, SessionStatus };

/**
 * 会话参与者上限。participants 随 WorldState.sessions 全量广播，必须有界；
 * 8 个对「一场互聊 / 一个角色 / 一条 agent 连接」这类会话粒度足够宽松。
 */
export const MAX_SESSION_PARTICIPANTS = 8;

/**
 * 自动标题长度上限（码点）。标题随广播全量下发，必须有界。
 * why 20：够放下「角色对话：未命名任务的执行记录」这种带 kind 前缀的完整短语。
 */
export const MAX_SESSION_TITLE_LEN = 20;

/**
 * 自动标题长度下限（码点）。短于此长度说明标题信息量不足（首条消息只有两个字），
 * 起名时补一段 kind 默认短语 —— 界面上"互聊：hi"这种标题用户看不出是什么。
 */
export const MIN_SESSION_TITLE_LEN = 12;

/** 事件里单条消息的文本上限（码点）。事件本体落库不进广播，但表行仍要有界。 */
export const MAX_SESSION_TEXT_LEN = 4_000;

/** 事件里发言者名字的长度上限（码点）。 */
export const MAX_SESSION_AUTHOR_LEN = 64;

/**
 * task_run 事件里 taskId 的长度上限（码点）。
 * why 单独一份：taskId 是标识不是正文，64 足够（core 的 id 形如 `task_12_1700000000000`），
 * 给它正文级的上限是浪费；给它 64 就够，超长即异常数据。
 */
export const MAX_SESSION_TASK_ID_LEN = 64;

/**
 * task_run 事件里**描述摘要 / 步骤明细 / 收尾摘要**的长度上限（码点）。
 * why 200：够放下「侦察北门并回报敌情」这类一句摘要 + 少量上下文；
 * 再长就是正文了 —— 正文归 character_tasks 表，会话事件只留"发生了什么"的骨架。
 */
export const MAX_SESSION_TASK_SUMMARY_LEN = 200;

/** task_run 事件里**步骤名**的长度上限（码点）。步骤名是短语（"计划待批准"），64 绰绰有余。 */
export const MAX_SESSION_STEP_LABEL_LEN = 64;

/**
 * task_run 事件里**输出尾部**的长度上限（码点）—— 尾 500 字。
 * why 尾截而不是头截：任务产出里结论通常在末尾（报告的最后一段），
 * 截头会把结论切掉，留下的全是铺垫 —— 那才是无用信息。
 */
export const MAX_SESSION_OUTPUT_TAIL_LEN = 500;

/**
 * 会话事件载荷表：事件类型 → 载荷形状。
 * why 用映射而不是一个大 union：调用方写 `appendEvent(id, { type: 'message', payload: … })` 时，
 * 载荷类型随事件类型自动收窄，漏字段/多字段在编译期就被挡住。
 */
export interface SessionEventPayloadMap {
  /** 会话建立（createSession 时写入，seq=1）。 */
  created: { readonly title: string; readonly participants: readonly string[] };
  /** 一条消息（互聊轮次 / 角色聊天）。 */
  message: { readonly author: string; readonly text: string };
  /** 一轮收束（一轮对话结束时的摘要）。 */
  round: { readonly summary?: string };
  /** 中断标记（超时 / 取消 / 进程死）。 */
  interrupt: { readonly reason: string };
  /** 恢复标记（interrupted → active；note 可记回灌了多少条上下文）。 */
  resumed: { readonly note?: string };
  /** 收尾（closed）。 */
  closed: { readonly reason?: string };
  /**
   * 分叉标记（@since v3.46，task_100 / v3.2b-B1）—— 新会话由源会话分叉而来。
   * payload 记录**来源**：源会话 id + 实际生效的复制截止 seq + 复制的对话事件条数。
   */
  forked: {
    readonly sourceSessionId: string;
    readonly atSeq: number;
    readonly copiedCount: number;
  };
  /**
   * task_run：任务开工（@since v3.46，task_105 / v3.2b-B6）。
   * payload 含 taskId 与**描述摘要**（任务指令的前若干字）—— 面板上一眼认得出是哪单。
   */
  task_started: { readonly taskId: string; readonly summary: string };
  /** task_run：执行中的一个**关键节点**（一步一条；detail 可缺省）。 */
  step: { readonly label: string; readonly detail?: string };
  /**
   * task_run：输出**尾部**（@since v3.46，task_105）。
   * 只留尾部（结论通常在末尾）；超出上限截断并标 truncated。
   */
  output_tail: { readonly text: string; readonly truncated?: boolean };
  /** task_run：任务成功收尾（summary 可缺省）。 */
  completed: { readonly summary?: string };
  /** task_run：任务失败收尾（含**错误摘要**）。 */
  failed: { readonly reason: string };
}

/** 会话事件类型（载荷表的键）。 */
export type SessionEventType = keyof SessionEventPayloadMap;

/**
 * 会话事件信封：{ sessionId, seq, type, payload, createdAt }（方案 §2）。
 * seq **会话内单调递增**（从 1 开始）—— 事件重放 / 分页读取都靠它定序。
 */
export type SessionEvent = {
  [K in SessionEventType]: {
    readonly sessionId: string;
    readonly seq: number;
    readonly type: K;
    readonly payload: SessionEventPayloadMap[K];
    readonly createdAt: number;
  };
}[SessionEventType];

/**
 * 事件草稿（含 createdAt）：machine 层用它封装信封。
 * 判别联合（type 是判别位）—— 收窄后 payload 类型自动跟随。
 */
export type SessionEventDraft = {
  [K in SessionEventType]: {
    readonly type: K;
    readonly payload: SessionEventPayloadMap[K];
    readonly createdAt: number;
  };
}[SessionEventType];

/**
 * 事件入参（**不含** createdAt）：manager 自己取时钟（core 是时间的唯一持有者，
 * 调用方各填各的时间戳会让事件序列和状态里的 lastEventAt 对不上）。
 */
export type SessionEventInput = {
  [K in SessionEventType]: {
    readonly type: K;
    readonly payload: SessionEventPayloadMap[K];
  };
}[SessionEventType];

/**
 * 会话域的**持久化口**（@since v3.43，task_093 / v3.2a S3）——
 *   core 只认这个**纯回调契约**，不认存储实现（core 零 IO 铁律：core 不 import DAO / SQLite）。
 *
 * why 这个口住在 core（而不是 app）：**事件信封由 core/session 的 manager 产生**
 *   （seq 会话内单调、payload 形状、createdAt 都在那里定）。让上层"猜"事件长什么样必然漂移 ——
 *   两份真相的经典形态。上层只负责"往哪写"（DAO / 表结构），core 只负责"写什么"。
 *
 * 实现方在 app 层（app/services/persistence/session-persister.ts 的 SessionPersister
 *   与本口**结构同形**）—— 组合根直接把它注入 manager，无需适配器（接口即契约）。
 * 缺省 = 不落库（端口缺席 → 会话只活在 WorldState 里，历史不进库；缺省即缺省范式）。
 */
export interface SessionPersistPort {
  /** 落一条会话摘要快照（状态一动就 upsert 一次）。 */
  readonly persistSession: (record: SessionRecord) => void;
  /** 落一条会话事件（append-only；事件本体不广播，只进库）。 */
  readonly persistEvent: (event: SessionEvent) => void;
}

/**
 * 会话事件的**读面视图**（@since v3.43，task_096 / v3.2a S6）—— 读路径拿到的通用形状。
 *
 * why 与写面的 SessionEvent 分开：写面（SessionEvent）是**判别联合**（载荷按 type 收窄，
 *   落库前形状被 core 校验过）；读面是"库里存什么就回什么"—— 历史表里可能有旧版本写下的行，
 *   读路径**不替库做判断**（不因一条脏行炸掉整页读取）。故 payload 是 unknown。
 */
export interface SessionEventView {
  readonly sessionId: string;
  /** 会话内单调序号（从 1 起）。 */
  readonly seq: number;
  /** 事件类型（created / message / round / interrupt / resumed / closed…）。 */
  readonly type: string;
  /** 事件载荷（按 type 变化；读面不校验形状）。 */
  readonly payload: unknown;
  readonly createdAt: number;
}

/** 会话列表的查询条件（kind / status 可选 = 不过滤；limit / offset 分页）。 */
export interface SessionListQuery {
  readonly kind?: SessionKind;
  readonly status?: SessionStatus;
  /** 条数上限（调用方给，已收紧）。 */
  readonly limit: number;
  /** 偏移（调用方给，已收紧）。 */
  readonly offset: number;
}

/** 会话列表的一页（items = 本页条目；total = 命中过滤条件的总条数）。 */
export interface SessionPage {
  readonly items: readonly SessionRecord[];
  readonly total: number;
}

/** 会话事件的分页参数（beforeSeq 是游标：取该序号**之前**的一段）。 */
export interface SessionEventQuery {
  readonly beforeSeq?: number;
  readonly limit: number;
}

/**
 * 会话**事件流**的读取口（@since v3.46，task_100 / v3.2b-B1）——
 *   resume / fork 要读事件流（回灌上下文 / 复制时间线），core 只认这个**纯回调契约**。
 *
 * why 从 SessionReadPort 里拆出这个窄口：resume / fork 只需要"读事件流"这一件事，
 *   逼它们认整份 SessionReadPort（读列表 / 读单条）会逼实现方多实现两个用不上的动作；
 *   而 SessionReadPort 继承它（MCP 那侧仍要读列表 / 读单条），两边各取所需、**一份契约**。
 *
 * 口径与 SessionReadPort.readSessionEvents 完全一致（seq 正序；beforeSeq 游标切片）。
 */
export interface SessionEventReadPort {
  /** 读某会话的事件流（seq 正序；beforeSeq 游标切片）。 */
  readonly readSessionEvents: (
    sessionId: string,
    options: SessionEventQuery
  ) => readonly SessionEventView[];
}

/**
 * 会话域的**读取口**（@since v3.43，task_096 / v3.2a S6）——
 *   core 只认这个**纯回调契约**，不认存储实现（与 SessionPersistPort 同一纪律：
 *   core 零 IO，从不 import DAO / SQLite）。
 *
 * why 与 SessionPersistPort 成对出现：会话域的**写**面由 core 生成信封（seq / payload / 时间戳
 *   都在 core 定），**读**面则由存储侧翻译成 core 的形状（行 ↔ 会话摘要的映射在 app 层，
 *   见 app/services/persistence/session-reader.ts）。两端各有一份真相是最经典的漂移源，
 *   故端口两头都用 core 的类型。
 *
 * 实现方在 app 层（service 侧 SQLite 的 sessions / session_events 两张表）——
 *   组合根直接把它注入 MCP 的数据面端口（McpHost.readSessions），无需适配器（接口即契约）。
 */
export interface SessionReadPort extends SessionEventReadPort {
  /** 读会话摘要列表（kind / status 过滤 + limit / offset 分页；创建时间倒序）。 */
  readonly readSessions: (query: SessionListQuery) => SessionPage;
  /** 读单条会话摘要；库里没有返回 null（**不编造**）。 */
  readonly readSession: (sessionId: string) => SessionRecord | null;
}

/**
 * 建会话入参。
 * kind 决定粒度与接线方式（方案 §2 的接线策略表）；participants 视 kind 分别是
 * characterId / agentId / clientId。
 */
export interface CreateSessionInput {
  readonly kind: SessionKind;
  readonly participants?: readonly string[];
  /** 关联实体 id（task_run → taskId、mission_run → missionId…）；无关联时不出现该键。 */
  readonly refId?: string;
  /** 显式标题；缺省走自动起名（deriveSessionTitle，规则版无 LLM）。 */
  readonly title?: string;
  /**
   * 首条消息原文：**只用于自动起名**，不进事件流。
   * why 不顺手记成 message 事件：同一条消息由调用方 appendEvent 记一次，
   * 这里再记一次就是双写（事件流里会出现两条一模一样的消息）。
   */
  readonly firstMessage?: string;
}

/**
 * 自动起名的**种子**（@since v3.47，task_104 / v3.2b-B5）——
 *   建会话那一刻能拿到的"起名素材"，起名方（规则版 / LLM 版）据此起名。
 *
 * why 是"种子"而不是"完整素材"：起名方只拿到会话**摘要级**的信息
 *   （谁在、聊了什么），拿不到全量事件流 —— 标题是给列表看的，一行放得下就够。
 */
export interface TitleSeed {
  /** 会话种类（前缀与兜底文案的依据）。 */
  readonly kind: SessionKind;
  /** 参与者（characterId / agentId / clientId 视 kind）。 */
  readonly participants?: readonly string[];
  /** 会话里的第一条**用户消息**（互聊议题 / 首句提问）。 */
  readonly firstUserMessage?: string;
  /** 任务标题（task_run 用：任务指令本身就是最好的标题素材）。 */
  readonly taskTitle?: string;
}

/**
 * 自动起名端口（@since v3.47，task_104 / v3.2b-B5）——
 *   core 只认这个**纯契约**，不认起名实现（core 零 IO 铁律：LLM 起名要发网络请求，
 *   那属于 app 层；core 这边只有规则版）。
 *
 * why 返回 `string | Promise<string>`：规则版是**同步纯函数**（无 IO，确定性），
 *   LLM 版必然是异步。写成联合类型而不是强行统一成 Promise，是为了让"规则版"
 *   在建会话那一刻就能同步拿到标题（会话一建出来就有标题，不闪空白）；
 *   调用方一律 `await` —— 两种实现都吃。
 */
export interface TitleProvider {
  /** 实现标识（'rules' / 'llm'）—— 便于日志与诊断（不参与业务判定）。 */
  readonly id: string;
  /** 起一个标题；实现不得抛异常（起名失败由实现自己回退规则版）。 */
  generate(seed: TitleSeed): string | Promise<string>;
}

/**
 * 自动起名的**服务口**（@since v3.47，task_104 / v3.2b-B5）——
 *   互聊 / 任务侧要的其实不是"起名实现"，而是"起完把标题写回去"这件事。
 *
 * why 单独一个口（而不是直接注入 TitleProvider）：
 *   - 写面只有一处（core/session 的 manager.updateTitle）—— 业务侧不碰 store
 *     （service 独占写铁律），所以它们拿到的必须是**已经封装好写回**的口；
 *   - "不阻塞主流程"是这条口的一部分契约（起名是旁路：互聊开场 / 任务开工不等它）。
 *
 * 实现方在 app 层（app/services/session-title.ts）—— 组合根直接注入，无需适配器。
 */
export interface SessionTitleService {
  /**
   * 异步起名并写回标题（fire-and-forget；返回的 promise 只供单测等待）。
   * 起名失败只记日志，**不抛**（起名是旁路，不是主角）。
   */
  retitle(sessionId: string, seed: TitleSeed): Promise<void>;
}
