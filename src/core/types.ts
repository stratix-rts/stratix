/**
 * 文件职责：世界层(world) 与 HUD 层(hud) 之间全部通信类型的唯一事实源（总线契约）。
 *   来源：docs/REFACTOR_PLAN_V3.md §5「总线契约草案」（V3.1 冻结版）。
 * 输入：无（纯类型 + 冻结常量，本文件无任何 import）。
 * 输出：WorldState（core → 两层广播）、HudCommand（hud → core）、WorldEvent（world → core）。
 * 禁止事项：
 *   1. 引入任何 import —— 契约文件必须是依赖图的叶子，任何依赖都会让两层间接耦合；
 *   2. 出现 any —— 契约类型必须可静态穷尽，any 会让调用方绕过总线铁律（编译期即失效）；
 *   3. 引用 Phaser / DOM / Vue 类型 —— 形状类型（Point/Bounds）在本文件自定义；
 *   4. 写业务逻辑或状态机 —— 状态机实现属于 core/unit、core/mission，本文件只描述"长什么样"。
 *
 * 通信铁律（P3）：
 *   hud → core  只允许 HudCommand；world → core 只允许 WorldEvent；core → 两层 只广播 WorldState。
 *   任何 hud ↔ world 的直接调用都是架构违规。
 *
 * 版本约定：新增字段走 `@since v3.x` 注释，不改已有字段语义，保证 world/hud 两层可并行开发。
 */

// ============================================================================
// 冻结常量（契约级上限：两层共用同一份数值，避免各自硬编码出不同上限）
// ============================================================================

/** 通知默认存活时长（ms）。超过 expiresAt 的通知由 core 自动剔除，HUD 只渲染未过期部分。 */
export const NOTICE_TTL_MS = 6000;

/** 通知队列上限。防止世界层高频事件把 notices 无限撑大（性能硬约束：数据不许无限增长）。 */
export const MAX_NOTICES = 50;

/** 选择集上限。全选/框选时按数组顺序保留前 N 个，避免超大编组拖垮状态广播与渲染。 */
export const MAX_SELECTION_SIZE = 256;

/**
 * @since v3.1 外部 agent 会话数上限。core/agent-link 建立会话时硬性拒绝超额请求
 * （对齐 stratix-gateway 的 MAX_PROXIES=100 收紧到本地工作台量级）。
 */
export const MAX_AGENT_LINKS = 16;

/** @since v3.1 会话消息保留上限（全局）。聊天抽屉只渲染最近的这些，历史不回放。 */
export const MAX_AGENT_MESSAGES = 200;

/** @since v3.1 单个会话的消息保留上限。多会话并行时防止一个 agent 挤掉其他 agent 的上下文。 */
export const MAX_AGENT_MESSAGES_PER_LINK = 100;

/**
 * @since v3.3 任务条数上限（core/mission 强制）。missions 只保留最近的 MAX_MISSIONS 条：
 * 超限时先丢终态（done / cancelled）的旧任务，仍超限才丢最旧的一条。
 * why 需要它：mission.create 由 HUD 反复触发，不设上限 missions 会无限增长，
 * 而 WorldState 每次变更都**全量**广播（perf 硬约束：广播体积必须有界）。
 */
export const MAX_MISSIONS = 100;

/**
 * @since v3.16 角色任务（task.assign 派发）条数上限（core/task 强制）。
 * 与 MAX_MISSIONS 同一理由：tasks 随 WorldState 全量广播，超限时先丢终态
 * （completed / failed）的旧任务，腾不出位置就拒绝新派（绝不静默挤掉在办任务）。
 */
export const MAX_TASKS = 100;

/**
 * @since v3.16 任务指令长度上限。prompt 会随 WorldState.tasks 全量广播，必须有界；
 * 20k 码点对一条自由文本任务指令绰绰有余（对齐 chat 侧 IPC 的 prompt 上限档）。
 */
export const MAX_TASK_PROMPT_LEN = 20_000;

/**
 * @since v3.16 任务输出**摘要**长度上限。WorldState 里的 task.output 只存摘要
 * （全文落 SQLite 的 tasks 表，见 app/services/task-service）；广播体积必须有界。
 */
export const MAX_TASK_SUMMARY_LEN = 2_000;

// ============================================================================
// 基础形状（core 自定义，与渲染引擎解耦）
// ============================================================================

/** 世界坐标点。世界层负责世界坐标 ↔ 屏幕坐标换算，HUD 拿到的永远是世界坐标。 */
export interface Point {
  readonly x: number;
  readonly y: number;
}

/** 轴对齐矩形（世界坐标）。框选区域用左上角 + 宽高表达，避免依赖 Phaser.Geom.Rectangle。 */
export interface Bounds {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** 点击修饰键。world → core 上报点击时携带，core 据此决定 set/toggle 语义。 */
export interface ClickMods {
  readonly shift: boolean;
  readonly ctrl: boolean;
  readonly meta: boolean;
  readonly alt: boolean;
}

// ============================================================================
// 单位（Agent 单位即战场上的组织单位，Zone 已砍，见 D5）
// ============================================================================

export type UnitStatus = 'idle' | 'busy' | 'offline' | 'error';

/**
 * 能力维度键。@since v3.2 —— 合并旧 AgentPowerPanel（Agent 战斗力评估）所需。
 * 键与旧 CombatPowerCalculator.COMBAT_DIMENSIONS 一一对应（攻击/防御/机动/魔法/生存/辅助）。
 * 词表是契约的一部分：core 计算、HUD 按此顺序渲染，改词表必须同步两侧。
 */
export const CAPABILITY_DIMENSIONS = [
  'offense',
  'defense',
  'mobility',
  'magic',
  'survivability',
  'utility',
] as const;

export type CapabilityDimension = (typeof CAPABILITY_DIMENSIONS)[number];

/**
 * 单位能力面板（AgentPowerPanel 的 v3 契约形态）@since v3.2。
 * **由 core 计算、HUD 只渲染**：维度得分与分档词表只在 core 一处存在，
 * HUD 侧若再写一份阈值，两处必然漂移（本任务刻意不在 hud 里复刻旧 CombatPowerCalculator）。
 */
export interface UnitCapabilitiesView {
  /** 综合战力 0–100。 */
  readonly overall: number;
  /** 分档名（如「优秀」）。core 按阈值给出，HUD 不自算。 */
  readonly level: string;
  /** 各维度得分 0–100，键集合固定为 CAPABILITY_DIMENSIONS。 */
  readonly dimensions: Readonly<Record<CapabilityDimension, number>>;
}

/**
 * 单位业务态视图。注意：**不含位置**——位置由世界层自治，core 与 HUD 都不持有坐标真相。
 */
export interface UnitView {
  readonly id: string;
  readonly name: string;
  readonly status: UnitStatus;
  /** 当前承担的任务；空闲为 null。任务状态机的相位见 MissionView.phase。 */
  readonly missionId: string | null;
  readonly power: number;
  /**
   * @since v3.2 关联角色 id：命中 WorldState.characters 即可展示成长数值（等级/经验），
   * 合并旧 AgentPanel 的角色档案区。为空表示未关联 —— HUD 显示「未关联角色」，不编造档案。
   */
  readonly characterId?: string | null;
  /**
   * @since v3.9 皮肤资源键（渲染侧染色用）：角色单位带上自己的皮肤 id，
   * world 侧据此取徽标色给单位上色（见 world/theme.ts 的 resolveUnitColor）。
   * 缺省 / null = 没有皮肤的普通单位 —— 渲染侧回落到业务态颜色。
   * 可选而非必填：与 characterId 同理走契约增补，不破既有 UnitView 构造点。
   */
  readonly skinId?: string | null;
  /**
   * @since v3.10 角色外观（LPC 合成栈的数据面）：单位带出角色的形象，
   * 渲染侧据此合成精灵表并播走路动画（见 world/objects/unit-layer.ts）。
   * 缺省 / null = 没有外观 —— 渲染侧回落到占位形体（老单位照旧合法）。
   * 与 skinId 同理走契约增补：可选字段，不破既有 UnitView 构造点。
   */
  readonly appearance?: CharacterAppearance | null;
  /**
   * @since v3.2 能力面板数据（合并 AgentPowerPanel）。未评估时缺省/null，HUD 显示「未评估」。
   * 可选而非必填：契约增补不许打破已有 UnitView 构造点（world 侧适配器、单测夹具）的编译。
   */
  readonly capabilities?: UnitCapabilitiesView | null;
}

// ============================================================================
// 任务
// ============================================================================

/**
 * 任务相位。状态机迁移规则实现在 core/mission，本文件只冻结相位取值。
 *
 * @since v3.3 语义澄清（**词表未变**，只是把隐含约定写明，免得两侧各猜一套）：
 *   - 'draft'     = 已立任务、还没指派任何人（mission.create 的 unitIds 为空即落在这里）；
 *   - 'pending'   = 已指派编组、**待确认**（mission-confirm 面板要确认的就是这一相）；
 *   - 'confirmed' = 已被接收（ConfirmDecision='accept' 的落点），紧接即进入 'running'；
 *   - 'done' / 'cancelled' 为终态。
 *   **拒绝 = 'cancelled'**：契约里没有 'rejected' —— ConfirmDecision='reject' 落到 cancelled，
 *   "被拒绝作废"与"被叫停"在业务上同源，分成两个相位只会让 HUD 多一套词表。
 */
export type MissionPhase = 'draft' | 'pending' | 'confirmed' | 'running' | 'done' | 'cancelled';

export interface MissionView {
  readonly id: string;
  readonly title: string;
  readonly phase: MissionPhase;
  /** 指派对象：多选集合（编组）展开的单位 id 列表。 */
  readonly unitIds: readonly string[];
  readonly createdAt: number;
}

export type ConfirmDecision = 'accept' | 'reject';

// ============================================================================
// 角色任务（@since v3.16 —— core/task 的状态投影，状态机实现在 core/task/）
// ============================================================================

/**
 * @since v3.16 角色任务相位。状态机迁移规则实现在 core/task/machine.ts，本文件只冻结取值：
 *   queued（已排队待执行）→ running（正在经 transport 执行）→ completed / failed（终态）。
 *   failed 允许从 queued 直达（守门拦截：agent 未检出等 —— 派了但注定跑不起来）。
 *   @since v3.23（task_047）增 cancelled：**仅 queued 可取消**（排队取消；running 不强杀 ——
 *   中止在跑任务是另一个动作的事，取消按钮对 running 不渲染，core 侧拒绝并回码）。
 *   cancelled 与 completed / failed 同为终态：任何动作都判非法（不改写历史）。
 *   @since v3.25（task_049）增 awaiting_approval（任务审批门）：plan-first 人设的任务在
 *   running 中产出计划后挂起等待用户裁决，**仅 running 可挂起、仅 awaiting_approval 可
 *   approve（回 running 续执行）/ reject（直达 failed，reason=rejected）**。awaiting
 *   不是终态、不限时（挂多久都行，驱动在 app 层 task-service 的内存挂单表）；它也不可
 *   被 cancel（驳回才是它的出口）。
 * **失败不自动重试**：重新派发是用户的显式动作（038 起的派发表单 / 047 的失败重派按钮）。
 */
export type TaskStatus =
  | 'queued'
  | 'running'
  | 'awaiting_approval'
  | 'completed'
  | 'failed'
  | 'cancelled';

/**
 * @since v3.25（task_049）计划草稿长度上限。task.plan 随 WorldState.tasks 全量广播
 * （审批卡要显示计划全文，不能只存摘要），必须有界；8k 码点对一份执行计划绰绰有余
 * （超限截断存档，全文仍在任务输出流缓冲与 SQLite 的 output 快照里）。
 */
export const MAX_TASK_PLAN_LEN = 8_000;

/**
 * @since v3.25（task_049）计划挂起标记。plan-first 人设的任务 prompt 尾部指示 agent
 * 「先输出执行计划并以单独一行 PLAN_WAIT 结束」；app 层 task-service 在流结束后检测
 * 输出中**独占一行的**该标记（trim 相等）判定挂起，hud 任务输出面板显示时剥离该协议行。
 * 定义在 core 是刻意的：它是 prompt 指令（app 拼）、挂起检测（app）与展示剥离（hud）
 * 三方共用的契约词，放任何一侧都会逼着另一侧跨层 import。
 */
export const TASK_PLAN_WAIT_MARKER = 'PLAN_WAIT';

// ============================================================================
// 多 agent 流水线契约（@since v3.27，task_051）—— 形状与冻结常量
// ============================================================================
// 架构定位（task_051）：pipeline 是**编排模式**，不是新实体 —— PipelineSpec 只是 HudCommand
// 的载荷形状（hud → core 单向过路），WorldState 不常驻任何流水线状态；执行期的编排态
// （站序游标 / 各站相位 / 前序全文）在 app 层 pipeline-service（内存 + SQLite pipelines 表），
// core 只管单任务（task.* 既有六态）与这里的纯契约。why：core 的状态面已经有 tasks 相位
// 真相，再进一份流水线状态就是双份真相 —— 编排态是 service 的运行期私产，core 膨胀没有收益。

/**
 * @since v3.27（task_051）流水线一站的规格：承接人 = 显式 characterId（在档校验在编排器）
 *   或按 kind 解析（编排器取档案里第一个绑定该 kind 的角色，无则跳站记 skipped）；
 *   两者至少给一个（validatePipelineSpec 裁决，纯逻辑在 core/task/pipeline.ts ——
 *   契约文件零 import 铁律，形状与常量在这里，逻辑在那边）。promptTemplate 里可用
 *   模板变量 {{task}}（原始议题）与 {{prev_output}}（上一站的全文输出，见渲染契约）。
 */
export interface PipelineStepSpec {
  /** 按角色种类解析承接人（与 characterId 二选一；给出则 characterId 缺省被忽略）。 */
  readonly kind?: AgentKind;
  /** 显式指定承接人角色 id（与 kind 二选一）。 */
  readonly characterId?: string;
  /** 本站指令模板（trim 后非空，长度 ≤ MAX_PIPELINE_TEMPLATE_LEN）。 */
  readonly promptTemplate: string;
}

/**
 * @since v3.27（task_051）一条流水线的规格（HudCommand pipeline.start 的载荷）。
 *   编排语义：站与站**串行** —— 上一站 completed 才渲染并派发下一站；任一站
 *   failed / cancelled → 后续全部 skipped、整线终态 failed；全线走完终态 completed。
 *   模板变量渲染契约（纯函数在 core/task/pipeline.ts）：{{task}} → 原始议题原文；
 *   {{prev_output}} → 上一 completed 站的输出全文（跳过站不更新它），超 PREV_OUTPUT_MAX
 *   截尾保头并附注明（防上游超长输出把下一站 prompt 撑爆 MAX_TASK_PROMPT_LEN）。
 */
export interface PipelineSpec {
  /** 流水线名（trim 后非空，长度 ≤ MAX_PIPELINE_NAME_LEN；事件与卡片显示用）。 */
  readonly name: string;
  /** 站序列（1..MAX_PIPELINE_STEPS 站，串行执行）。 */
  readonly steps: readonly PipelineStepSpec[];
}

/**
 * @since v3.27（task_051）{{prev_output}} 的截断上限（码点）。截断规则：**保头截尾** ——
 *   保留前 PREV_OUTPUT_MAX 码点，尾部替换为一行注明（文本在 pipeline.ts，属实现而非契约）。
 *   why 4000：MAX_TASK_PROMPT_LEN 是 20k，模板 + 议题 + 4k 前序输出后仍有充足裕量。
 */
export const PREV_OUTPUT_MAX = 4_000;

/** @since v3.27（task_051）流水线站数上限（广播/落库体积必须有界；预设 2-3 站，自定义两站）。 */
export const MAX_PIPELINE_STEPS = 6;

/** @since v3.27（task_051）流水线名长度上限（码点）。 */
export const MAX_PIPELINE_NAME_LEN = 64;

/**
 * @since v3.27（task_051）单站模板长度上限（码点）。渲染产物 = 模板 + 议题 + 截断后的
 *   前序输出（≤ PREV_OUTPUT_MAX + 注明行），三段和必须稳在 MAX_TASK_PROMPT_LEN 之内 ——
 *   8k 模板是留了双倍裕量的硬闸（超限在 validatePipelineSpec 被拒，不静默截断模板）。
 */
export const MAX_PIPELINE_TEMPLATE_LEN = 8_000;

/** @since v3.27（task_051）原始议题（{{task}} 的源文本）长度上限（码点）。 */
export const MAX_PIPELINE_ISSUE_LEN = 2_000;

/**
 * @since v3.16 一条派发给角色的任务（CharacterTask）。
 *
 * 与 MissionView 的分工（别当成两套任务）：Mission 是「战场编组任务」（指派给单位集合、
 * 走确认流）；CharacterTask 是「角色 agent 任务」（一段自由文本指令、经 CLI transport
 * 执行、产出文本结果）。两者各自独立，互不引用。
 *
 * output 语义：completed = 执行结果**摘要**（全文在 SQLite tasks 表）；failed = 失败原因；
 * @since v3.23 cancelled = 占位文案「任务在排队时被取消」（状态机写死 —— 取消没有外部原因可传，
 * 且与 failed 同一口径：终态 output 永不为空串，读的人不猜）；queued / running = 空串。
 * @since v3.25 awaiting_approval = 空串（计划全文在 plan 字段，见下）。
 * 单位忙闲由任务派生：有 running 任务 → 单位 status='busy'（awaiting 不算忙 ——
 * 它在等用户，不在干活，头顶?浮标是它的表现，见 world/objects/task-fx）。
 */
export interface CharacterTask {
  readonly id: string;
  readonly characterId: string;
  /** 任务指令原文（trim 后非空，长度 ≤ MAX_TASK_PROMPT_LEN）。 */
  readonly prompt: string;
  readonly status: TaskStatus;
  readonly createdAt: number;
  /** 开工时间（queued→running 时盖）；未开工为 null。 */
  readonly startedAt: number | null;
  /** 收尾时间（终态时盖）；未收尾为 null。 */
  readonly endedAt: number | null;
  /** 输出摘要 / 失败原因（见上文字段语义）；长度 ≤ MAX_TASK_SUMMARY_LEN。 */
  readonly output: string;
  /**
   * @since v3.25（task_049）计划草稿：plan-first 任务在 awaiting_approval 时由状态机
   * 写入（已剥离标记行、≤ MAX_TASK_PLAN_LEN）；approve 后继续随任务携带（存档语义，
   * completed 任务里的 plan = 「这单是按这份计划做完的」溯源），reject 的 failed 任务里
   * 它就是被驳回的计划存档。非 plan-first 任务恒缺省（不占字段）。
   */
  readonly plan?: string;
}

// ============================================================================
// 选择 / 编组
// ============================================================================

/**
 * 选择态。**编组 = 当前多选集合**（D5：v3 不做持久化编队），因此这里不保留编队槽位。
 * revision 单调递增，供桥接层跳过无变化的渲染（perf：高频 preview 更新不打全量重渲染）。
 */
export interface SelectionState {
  readonly unitIds: readonly string[];
  /** 框选拖拽过程中的实时预览集合，松开后归零。 */
  readonly previewUnitIds: readonly string[];
  readonly revision: number;
}

// ============================================================================
// 用户偏好（@since v3.5 —— hud/screens/settings-screen 的持久化落点）
// ============================================================================

/** 布尔型偏好键。词表即契约：core 按键落库、HUD 按键渲染，两侧不许各写一份。 */
export type BooleanPreferenceKey = 'soundEnabled' | 'notificationsEnabled';

/**
 * 用户偏好视图（@since v3.5）。
 * why 只收布尔开关：偏好没有领域语义（不进任何状态机），因此它归 core 存一份、
 * 随 WorldState 全量广播，HUD 只渲染 + 发 `settings.set` 改 —— HUD 侧不留第二份真相。
 * **皮肤不在这里**：theme.set 由 hud bridge 本地消费 token 完成切换（core 侧只记账，
 * 见 core/runtime.ts 的 TODO），契约里没有回读通道，另立一个字段只会造出第二个真相源。
 */
export interface SettingsView {
  readonly soundEnabled: boolean;
  readonly notificationsEnabled: boolean;
}

/**
 * 偏好默认值（契约级冻结常量）。
 * why 要这一份：WorldState.settings 是可选字段（见下），读取方必须回落到**同一个**默认值，
 * 否则 core / HUD 各编一套默认，用户会看到"没设过的偏好"两边不一样。
 */
export const DEFAULT_SETTINGS: SettingsView = {
  soundEnabled: true,
  notificationsEnabled: true,
};

/**
 * 上下文注入全局开关的 localStorage 键（@since v3.29，task_053）。
 * 值 '0' = 关；无键 / 其它值 = 开。why 冻结在 core：写入方（hud/settings-screen 的
 * 「上下文注入」行）与读取方（app/services/stratix-context 的全局开关裁决）都在
 * core 之上，公共底座冻结一份键名，两侧不各抄字面量。why 走 localStorage 而不走
 * SettingsView/BooleanPreferenceKey：偏好词表每加一键都要动 core 存取与广播两端，
 * 而这个开关只在本机渲染进程内生效（不进 WorldState、不随广播），localStorage
 * 的轻量落地是刻意的取舍（task_053 规格③）。
 */
export const STRATIX_CONTEXT_TOGGLE_KEY = 'stratix.context.enabled';

// ============================================================================
// 角色
// ============================================================================

/**
 * @since v3.7 本地 agent 种类词表。**词表即契约**：core 按它校验 agentKind（不认识的一律拒发），
 *   HUD / 首启引导屏按同一份词表渲染"绑的是哪个 CLI agent"；新增一种 CLI agent 两侧同步改。
 *   取值来源：docs/AGENT-MATRIX.md 的 T1/T2 名单（claude / codex / opencode / kimi / openclaw）。
 */
export type AgentKind = 'claude-code' | 'codex' | 'opencode' | 'kimi' | 'openclaw';

/** @since v3.7 agent 种类词表的运行时可枚举一份（core 校验用；HUD 也可 import 同一份渲染标签）。 */
export const AGENT_KINDS: readonly AgentKind[] = ['claude-code', 'codex', 'opencode', 'kimi', 'openclaw'];

/**
 * @since v3.7 角色名长度上限（按 Unicode 码点计，不是 UTF-16 code unit ——
 *   "24 字"对用户是 24 个汉字/字母，不是 24 个存储单元）。
 *   why 要上限：名字随 WorldState 全量广播，且要画在像素头像旁边；无上限的名字既撑爆广播也画不下。
 */
export const MAX_CHARACTER_NAME_LEN = 24;

/**
 * @since v3.7 皮肤 id 长度上限。skinId 是**资源键**（core 不解析、不校验资源是否存在），
 *   但它会随每次状态广播外发，故必须有界。
 */
export const MAX_SKIN_ID_LEN = 64;

/**
 * @since v3.7 外部会话 id 长度上限。各家 CLI 的 session id 原样透传（见 docs/AGENT-MATRIX.md），
 *   长度差异很大（codex rollup / claude uuid），但仍要给个上限兜住异常输入。
 */
export const MAX_EXTERNAL_SESSION_ID_LEN = 200;

/**
 * @since v3.7 角色档案条数上限。
 * why 必须有界：characters 随 WorldState **全量**广播，每次广播都带着整份档案；
 * 不设上限则角色数无界增长、广播体积无界增长（perf 硬约束：数据不许无限增长）。
 * 超限时**拒绝新建并回 Notice**，绝不静默挤掉已有角色（角色是用户亲手建的，丢掉即数据丢失）。
 */
export const MAX_CHARACTERS = 64;

/**
 * @since v3.10 外观体型词表（LPC body 类型）。
 *
 * why 是"素材事实"而不是随意取值：LPC 素材按体型分目录存放
 * （body/bodies/{male,female,teen,muscular,pregnant,child}/…），
 * 体型写错 → 合成器找不到对应的图目录 → 角色画不出来。
 * 故 core 认这 6 种（与素材目录一一对应），不认识的一律拒发。
 */
export const APPEARANCE_BODY_TYPES = [
  'male',
  'female',
  'teen',
  'muscular',
  'pregnant',
  'child',
] as const;

/** @since v3.10 角色体型（= APPEARANCE_BODY_TYPES 的元素类型）。 */
export type AppearanceBodyType = (typeof APPEARANCE_BODY_TYPES)[number];

/**
 * @since v3.11 单个部位的**精确选择**（部件选择的第二种形态）。
 *
 * why 需要它：旧的「category → variant」定位不到唯一素材 —— LPC 里同一类别的多个条目
 *   常共用同一套变体名（91 个发型共用一套发色），渲染侧只能取"第一个命中项"。
 *   于是"随机抽一个发型"抽不出具体款式，规则化随机（见 world/appearance/appearance-randomizer.ts）
 *   也没法做条目级白名单。带上 itemId 才谈得上"精确指定某一款素材"。
 *
 * 字段：
 *   - variant：变体名（必填）—— 素材文件名的一部分，如 'light' / 'black'；
 *   - itemId：素材条目 id（可选）—— item-metadata.json 的键，如 'heads_human_male'。
 *     缺省 = 不指定条目，渲染侧按「类别 + 变体」反查（= 旧行为）。
 */
export interface AppearancePartSelection {
  /** 变体名（素材文件名的一部分，如 'light' / 'black'）。 */
  readonly variant: string;
  /** 素材条目 id（item-metadata.json 的键）。缺省 = 不指定具体条目。 */
  readonly itemId?: string;
}

/**
 * @since v3.11 部位选择的**并集形态**：旧的纯变体串 / 新的精确选择。
 *
 * why 是并集而不是直接把 string 换成对象：存档里已有的外观是**纯变体**形态，
 *   直接换类型等于让所有老数据失效（违反"契约增补不许破既有构造点"）。
 *   并集形态让读方按「是串就用 variant，是对象就用 variant(+itemId)」处理，两种数据都能读。
 */
export type AppearancePartValue = string | AppearancePartSelection;

/**
 * @since v3.10 角色外观模型 —— 「体型 + 各部位选的变体」。
 *
 * 形状刻意做得很薄：**category → 部位选择**（不是完整的 LPC 元数据）。
 * why：core 只存"这个角色长什么样"的最小事实集 —— 部位 id、图层 z 序、动画偏移、
 *   版权署名这些全是**渲染侧的事**（src/world/appearance/ 的合成器与注册表），core 不该知道。
 *   core 存了等于把渲染细节搬进状态，广播体积也白涨。
 *   渲染侧靠这个字典反查部位（world/appearance 的 PartRegistry.resolveSelections）。
 *
 * ⚠️ 这个模型的边界：字典里存的是**变体**（如发色 black、肤色 light），不是"素材条目"（如某款发型）。
 *   LPC 素材里同一类别的多个条目常共用同一套变体名（91 个发型共用一套发色），
 *   故"类别 + 变体"未必定位到唯一素材 —— 渲染侧取第一个命中项（见 resolveSelections 的说明）。
 *   @since v3.11：**部位值可以额外带 itemId**（见 AppearancePartSelection），
 *   带了才谈得上精确指定款式；不带就是旧行为（不变）。
 *
 * 兼容性：新增字段一律可选 —— 本字段是 @since v3.10 追加的，
 *   老档案（无 appearance）依然合法，core 不为它编造默认外观。
 */
export interface CharacterAppearance {
  /** 体型（词表见 APPEARANCE_BODY_TYPES）。 */
  readonly bodyType: AppearanceBodyType;
  /**
   * 部位 → 部位选择。键是部位类别（body / hair / torso / hat …），
   * 值是「纯变体串」（旧形态）或「{ variant, itemId? }」（@since v3.11 精确形态）。
   */
  readonly parts: Readonly<Record<string, AppearancePartValue>>;
}

/**
 * @since v3.11 判断一个部位值是不是「精确选择」形态（对象）。
 * why 需要它：并集形态在 TypeScript 里必须先判形再取值（直接取 .variant 会报错）。
 */
export function isAppearancePartSelection(value: unknown): value is AppearancePartSelection {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * @since v3.11 取部位值的变体名（两种形态都归一化成字符串）。
 * why 需要它：读方（渲染侧 / HUD 摘要 / 比较键）要的是一个稳定的字符串视图，
 *   不该在每个读点都写一遍判形分支（判形散落 = 早晚漏一处）。
 */
export function appearancePartVariant(value: AppearancePartValue): string {
  return isAppearancePartSelection(value) ? value.variant : value;
}

/**
 * @since v3.11 取部位值的素材条目 id（没有精确指定 → undefined）。
 */
export function appearancePartItemId(value: AppearancePartValue): string | undefined {
  return isAppearancePartSelection(value) ? value.itemId : undefined;
}

/**
 * @since v3.10 外观部位条数上限。appearance 随状态广播，必须有界（perf 硬约束）。
 * LPC 常见部位类别 22 个，留一倍余量；超限一律拒发，不静默截断（截断会造出"半个人"的角色）。
 */
export const MAX_APPEARANCE_PARTS = 48;

/**
 * @since v3.10 单个部位变体名的长度上限。变体名是素材文件名（小写下划线形式），64 绰绰有余。
 */
export const MAX_APPEARANCE_VARIANT_LEN = 64;

/**
 * @since v3.11 单个部位素材条目 id（itemId）的长度上限。
 * itemId 是素材元数据的键（形如 'shield_heater_revised_wood'），随状态广播，必须有界。
 */
export const MAX_APPEARANCE_ITEM_ID_LEN = 64;

/**
 * @since v3.7 Agent 档案 —— agent 视角的完整角色模型。
 *
 * 与 CharacterView 的关系（重要，别当成两份真相）：
 *   - **CharacterView 是状态里的真相**：随 WorldState.characters 广播，是 HUD 读的那一份；
 *   - **AgentProfile 是同一份数据的 agent 视角投影**：由 core/character/profile.ts 的 toAgentProfile
 *     现算，状态里**不存第二份** persona / 等级，故不存在两份真相漂移。
 *   字段名不同（displayName ↔ name、exp ↔ experience）是刻意的：CharacterView 已被 hud 多处消费，
 *   不能为了新词表改字段名（改了会破既有构造点）；AgentProfile 是给 agent 侧（cli transport /
 *   首启引导）用的新词表。两者的对应关系由 toAgentProfile 一处固定。
 */
export interface AgentProfile {
  /** 角色 id（与 CharacterView.id 同值）。 */
  readonly id: string;
  /** 绑定的本地 agent 种类。 */
  readonly agentKind: AgentKind;
  /** 展示名（= CharacterView.name）。 */
  readonly displayName: string;
  /** 皮肤 id（渲染侧资源键；core 不解析内容）。 */
  readonly skinId: string;
  /** 人设提示词（= CharacterView.persona）。 */
  readonly persona: string;
  /** 等级（= CharacterView.level）。 */
  readonly level: number;
  /** 经验（= CharacterView.experience）。 */
  readonly exp: number;
  /** 外部会话 id（各家 CLI 原样透传）；未建立会话时为 null。 */
  readonly externalSessionId?: string | null;
  /**
   * @since v3.10 角色外观（LPC 合成栈的数据面）。
   * 可选：老档案没有外观 → 字段缺省（core 不替它编一个默认长相）。
   * 渲染侧（world/appearance）据此合成精灵；core 不解析素材、不校验资源是否存在。
   */
  readonly appearance?: CharacterAppearance | null;
}

/** 角色档案 + 成长数值（技能树不迁移，见 D3）。 */
export interface CharacterView {
  readonly id: string;
  readonly name: string;
  readonly persona: string;
  readonly level: number;
  readonly experience: number;
  /**
   * @since v3.7 绑定的本地 agent 种类（首启引导建档时写入）。
   * 缺省 / null 表示**未绑定** —— HUD 显示「未绑定 agent」，core 不替它猜一个。
   */
  readonly agentKind?: AgentKind | null;
  /** @since v3.7 皮肤 id（渲染侧资源键；core 不解析内容、不校验资源是否存在）。 */
  readonly skinId?: string | null;
  /**
   * @since v3.7 外部会话 id（各家 CLI 的 session id 原样透传，见 docs/AGENT-MATRIX.md）。
   * 未建立会话时为 null；由 core/agent-link / cli transport 侧回填（TODO(v3.x) 接链路）。
   */
  readonly externalSessionId?: string | null;
  /**
   * @since v3.10 角色外观（= CharacterView 与 AgentProfile 之间的同名字段，见 AgentProfile 的说明）。
   * 可选：老档案无外观 → 缺省。core 不解析素材、不校验部位资源是否存在（那是渲染侧的事）。
   */
  readonly appearance?: CharacterAppearance | null;
  /**
   * @since v3.29 上下文注入开关（task_053）：false = 该角色的对话 / 任务首发不附带
   * <stratix-context> 战场现状块。缺省 / null / true = 开（characters 表 context_enabled
   * 列的镜像，存档协调器双向映射）。开关是「增强项」而非数据完整性约束 —— 读写都在
   * core/character/manager.updateContextEnabled（对应 HudCommand character.contextEnabled.update）。
   */
  readonly contextEnabled?: boolean | null;
}

// ============================================================================
// 本地 CLI agent 检测（@since v3.8 —— app/services/agent-detector 的契约面）
// ============================================================================

/**
 * @since v3.8 本地 CLI agent 的**探测分层**。取值来源：docs/AGENT-MATRIX.md。
 *   - T1：深度适配（流式 + 会话恢复 + 结构化输出）；
 *   - T2：基础适配（headless 可用，会话 / 结构化能力有限）；
 *   - T3：仅探测注册（首启引导展示「即将支持」）。
 * 词表即契约：检测器按此分层产出，首启引导按此排序展示 —— 两边不许各写一份分层。
 */
export type AgentDetectionTier = 'T1' | 'T2' | 'T3';

/**
 * @since v3.8 **可检测**的本地 CLI agent 词表（T1-T3 全量 11 种）。
 * why 与 AgentKind 分开成两份词表：AgentKind 是「角色**已绑定**的 agent 种类」
 *   （目前只有 T1 的 5 种，见 core/character/profile.ts 的建档校验），
 *   而检测词表覆盖 T1-T3 全量 —— 「探测到但还不能绑定」的 agent（T2/T3）得有地方安放，
 *   硬塞进 AgentKind 会让建档校验放行一批尚无适配实现的种类。
 * 两份词表是**包含关系**（AgentKind ⊂ DetectableAgentKind），不是同一份清单。
 */
export const DETECTABLE_AGENT_KINDS = [
  // T1 —— 深度适配
  'claude-code',
  'codex',
  'opencode',
  'kimi',
  'openclaw',
  // T2 —— 基础适配
  'gemini',
  'qwen',
  'crush',
  'goose',
  // T3 —— 仅探测注册
  'aider',
  'copilot',
] as const;

/** @since v3.8 可检测 agent 种类的类型（DETECTABLE_AGENT_KINDS 的元素类型）。 */
export type DetectableAgentKind = (typeof DETECTABLE_AGENT_KINDS)[number];

/**
 * @since v3.8 单项探测的结论。
 *   - 'installed'     ：which 找到了二进制（版本命令可能仍失败 —— 此时 version 允许为 null）；
 *   - 'not-installed' ：which **确定**没找到二进制（这是「确定没装」，不是「没探测出来」）；
 *   - 'timeout'       ：探测超时，安装状态**未确认**；
 *   - 'failed'        ：执行出错（命令抛异常等），同样未确认。
 */
export type AgentDetectionStatus = 'installed' | 'not-installed' | 'timeout' | 'failed';

/**
 * @since v3.8 单个本地 CLI agent 的检测结果。
 * 由 app/services/agent-detector 产出，随 WorldState.detectedAgents 全量广播。
 */
export interface DetectedAgent {
  /** agent 种类（DETECTABLE_AGENT_KINDS 内）。 */
  readonly kind: DetectableAgentKind;
  /** 探测分层（T1 / T2 / T3）。 */
  readonly tier: AgentDetectionTier;
  /**
   * 是否**确认**已安装。
   * why 与 status 分开两个字段：status 说的是「这次探测的结论」，installed 说的是「二进制的客观存在」。
   * 二者只在 timeout / failed 时会不同 —— 例如 which 成功但 `--version` 卡住：
   * 此时 status='timeout'（版本未知）而 installed=true（which 已确认路径）；
   * 反过来 which 自己卡住时 installed=false，因为**未知不等于没装**。
   */
  readonly installed: boolean;
  /** 本次探测的结论（见 AgentDetectionStatus）。 */
  readonly status: AgentDetectionStatus;
  /** 版本号（首个 semver 片段；取不到时为 null）。 */
  readonly version: string | null;
  /** 二进制路径（which 的输出；未确认时为 null）。 */
  readonly path: string | null;
}

// ============================================================================
// 通知
// ============================================================================

export type NoticeLevel = 'info' | 'warn' | 'error';

/** 待 HUD 提示的事件，自动过期（expiresAt 之前有效，过期由 core 剔除）。 */
export interface Notice {
  readonly id: string;
  readonly level: NoticeLevel;
  readonly text: string;
  readonly createdAt: number;
  readonly expiresAt: number;
  /**
   * @since v3.4 产生方标识（如 'core/mission'、'core/agent-link'），供 hud/panels/log-drawer
   * 渲染"来源"列。缺省表示 core 未标注来源，HUD 显示通用来源 —— **不编造来源**。
   * 可选而非必填：契约增补不许打破既有 pushNotice 构造点（core/runtime.ts、单测夹具）的编译。
   */
  readonly source?: string;
  /**
   * @since v3.4 关联任务 id。命中 WorldState.missions 才能按任务过滤日志；
   * 缺省 / null 表示与任务无关的全局通知（仍会出现在"全部任务"视图里）。
   * 与 source 同理走可选增补，纯类型不动运行时。
   */
  readonly missionId?: string | null;
}

// ============================================================================
// 外部 agent 连接（@since v3.1 —— core/agent-link 的状态投影，状态机实现在 core/agent-link/）
// ============================================================================

/**
 * 会话相位。与 gateway 侧词表对齐但更细一档：handshake 期间（已开通道、尚未 hello-ok）
 * 对 HUD 显式可见，避免"卡在 connecting 不知道卡在哪"。
 * 状态迁移规则见 core/agent-link/session.ts，本文件只冻结相位取值。
 */
export type AgentLinkPhase =
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'closing'
  | 'closed'
  | 'error';

/**
 * 外部 agent 种类。'custom' 是前两者都不适用时的兜底：协议仍是同一条网关协议，
 * 只是不再对上游 agent 的语义做归一（事件原样透传为 raw 事件）。
 */
export type AgentLinkKind = 'openclaw' | 'claude-code' | 'custom';

/** 会话在 HUD 侧可见的投影。**刻意不含传输细节**（URL、token、socket 实例一律不进状态）。 */
export interface AgentLinkView {
  readonly id: string;
  readonly kind: AgentLinkKind;
  readonly displayName: string;
  readonly phase: AgentLinkPhase;
  readonly phaseReason: string | null;
  /** 远端 agent 标识；握手中拿到才有。用于把远端状态回写到同 id 的 UnitView。 */
  readonly agentId: string | null;
  /** 会话键（sessionKey）。**恢复会话靠它**：重连后带上同一个 key 即接上原来的上下文。 */
  readonly sessionId: string | null;
  /** 已脱敏的端点（query 串替换为 ***）。仅供人辨认连接目标，不回显凭据。 */
  readonly endpoint: string;
  readonly connectedAt: number | null;
  readonly lastError: string | null;
}

/** 会话内的一条消息。inbound = 远端 agent 说的，outbound = 本端发出的。 */
export interface AgentMessageView {
  readonly id: string;
  readonly linkId: string;
  readonly direction: 'inbound' | 'outbound';
  readonly author: string;
  readonly text: string;
  readonly at: number;
}

// ============================================================================
// ★ 总线契约：core → 两层广播的完整世界快照
// ============================================================================

export interface WorldState {
  units: UnitView[]; // Agent 单位（位置由世界层自治，此处仅业务态）
  missions: MissionView[]; // 任务及状态机相位
  selection: SelectionState; // 当前选择集（编组 = 多选集合）
  characters: CharacterView[]; // 角色档案 + 成长数值（level/exp）
  notices: Notice[]; // 待 HUD 提示的事件（自动过期）
  /** @since v3.1 外部 agent 会话投影（core/agent-link 写入），上限 MAX_AGENT_LINKS。 */
  links: AgentLinkView[];
  /** @since v3.1 会话消息流（供 hud/panels/chat-drawer），上限 MAX_AGENT_MESSAGES。 */
  messages: AgentMessageView[];
  /**
   * @since v3.5 用户偏好（供 hud/screens/settings-screen）。
   * **刻意可选**：与 Notice.source / Notice.missionId 同理走可选增补 ——
   * 契约增补不许打破既有 WorldState 构造点（core 单测夹具、hud 测试夹具）的编译。
   * 读取方缺省时回落到 DEFAULT_SETTINGS。
   */
  settings?: SettingsView;
  /**
   * @since v3.6 当前激活屏（ScreenId 的当前投影，由 ui.navigate 写入）。
   * why 走可选：与 settings 同理 ——
   * 契约增补不许打破既有 WorldState 构造点（core 单测夹具、hud 测试夹具）的编译。
   * 读取方缺省时回落到 'main'（即主屏主导视图）。
   * 路由约定：core/runtime.ts 在收到 `ui.navigate` 时调 CoreStore.setCurrentScreen，
   * HUD 侧 main-screen 据此切换 settings / character / main 三屏之一的渲染。
   * 'chat' 由 core 解释为"打开聊天抽屉"，不是跳屏 —— 故 'chat' 不写入 currentScreen
   * （HUD 抽屉仍由原 chat-drawer 自治；落到 currentScreen 会让 main-screen 多一个分支，
   * 与现有抽屉协议不符）。
   */
  currentScreen?: ScreenId;
  /**
   * @since v3.8 本地 CLI agent 检测结果（app/services/agent-detector 写入）。
   * 刻意可选：与 settings / currentScreen 同理走可选增补 —— 契约增补不许打破既有
   * WorldState 构造点（core / hud 单测夹具）的编译；读取方缺省时按「尚未检测」处理。
   * 体积天然有界：名单是固定 11 项（DETECTABLE_AGENT_KINDS），逐条到达也只是覆盖同名项，
   * 不存在无限增长（perf：全量广播的数据必须有界）。
   */
  detectedAgents?: DetectedAgent[];
  /**
   * @since v3.16 角色任务队列（core/task 写入，上限 MAX_TASKS）。
   * 刻意可选：与 settings / detectedAgents 同理走可选增补 —— 契约增补不许打破既有
   * WorldState 构造点的编译；读取方缺省时按空队列处理。
   * 单位忙闲可由它派生：某角色有 running 任务 → 对应单位 status='busy'（core/task 同步写入）。
   */
  tasks?: CharacterTask[];
}

// ============================================================================
// ★ 总线契约：hud → core 的命令（单向，HUD 不发任何"事件"）
// ============================================================================

export type ScreenId =
  | 'main'
  | 'settings'
  | 'character'
  /**
   * @since v3.1 聊天屏位。聊天以抽屉形态挂在主屏上、不占独立屏位，但 HUD 侧仍需要一条
   *   可派发命令来表达「打开聊天」（旧 CommandPanel 的首要动作），故纳入 ScreenId：
   *   core 侧把它解释为"打开聊天抽屉"，而不是跳转到另一个屏。
   */
  | 'chat';

export type HudCommand =
  | { type: 'unit.select'; unitIds: string[]; mode: 'set' | 'toggle' }
  /**
   * @since v3.2 相机聚焦到某个单位（合并旧 AgentPanel 侧栏的「定位/聚焦」语义）。
   *   为什么单开一条而不是复用 ui.navigate：相机由世界层自治、契约里没有相机字段，
   *   但「聚焦某个单位」是 HUD 侧对世界的合法表达 —— core 只做转发与审计（phase 2 落地），
   *   最终由 world 层消费；HUD 绝不直接调 world（铁律）。
   */
  | { type: 'unit.focus'; unitId: string }
  /**
   * @since v3.21 右击移动（task_045）：把选中编队移动到目标点（世界坐标）。
   *   编队落位由 core/unit/formation 的纯函数计算（网格以目标点为中心，间距 FORMATION_SPACING），
   *   终值经 world 通道的 unit.position 逐单位广播 —— ★ 位置立即生效于状态（世界层 UnitObject
   *   即刻更新），动画只是渲染过渡（unit-layer 的 tween）。
   *   unitIds 里不在 WorldState.units 的 id 静默丢弃（对账口径同 unit.select：快照与输入有
   *   时间差，悬空 id 不产生广播）。
   *   战场右击走 WorldEvent 的**同名事件**（世界层不发命令，铁律）；本命令是 HUD 侧入口
   *   （面板「移动」按钮 / 小地图指令留给后续任务），runtime 两个入口共用同一套落位逻辑。
   */
  | { type: 'unit.move'; unitIds: string[]; x: number; y: number }
  | { type: 'mission.assign'; missionId: string; unitIds: string[] }
  | { type: 'mission.confirm'; missionId: string; decision: ConfirmDecision }
  /**
   * @since v3.1 任务创建。why 补这条：mission.assign 只认**已存在**的 missionId，
   *   而「发起任务」是 HUD 的首要动作，必须能从 HUD 直接开出一条新任务。
   *   unitIds 为空表示"待指派"的草稿任务（先立任务、后选人），非空表示直接指派给这些单位。
   */
  | { type: 'mission.create'; title: string; unitIds: string[] }
  /**
   * @since v3.1 任务取消。契约里 MissionPhase 早已冻结了 'cancelled' 相位，
   *   却没有任何命令能到达它（旧 UI 的「停止」语义落在这条上），这里把缺口补齐。
   */
  | { type: 'mission.cancel'; missionId: string }
  /**
   * @since v3.6 已接线：core/runtime.ts 在收到本命令时调 core/character/manager.updatePersona，
   *   落库 + 失败转 Notice（source = 'core/character'）。合法性与 trim 由 persona.ts 校验。
   *   之前 Phase 2 留 TODO（handler 未接），HUD 端能派发但走 onUnhandled。
   */
  | { type: 'character.persona.update'; characterId: string; prompt: string }
  /**
   * @since v3.20 改角色形象（task_041 形象编辑面板的落地动作）。
   * 载荷口径：characterId 命中 WorldState.characters；appearance 按 profile.ts 的
   *   resolveAppearance 同一口径校验（体型在词表内 / 部位字典合法 / 条数与长度上限），非法 → 拒发。
   * ★ core **不在这里判解锁**：等级门槛（几级解锁哪些部位类别）是编辑 UI 的引导约束，
   *   不是数据完整性约束 —— 老档案 / 向导（创建前无等级）产出的形象本就可能包含高等级部位，
   *   core 若按等级拦截会造成「建档时合法、改一次就非法」的自相矛盾。门槛过滤在 HUD 编辑面板做
   *   （hud/screens/appearance-unlock-catalog.ts，按角色 level 灰显未解锁类别）。
   * 接线：core/runtime.ts → character/manager.updateAppearance（写 characters + 同步投影单位外观）。
   */
  | { type: 'character.appearance.update'; characterId: string; appearance: CharacterAppearance }
  /**
   * @since v3.29 角色级上下文注入开关（task_053：agent-panel 角色卡的「上下文」钮）。
   * 载荷口径：characterId 命中 WorldState.characters；enabled 为目标值（不是翻转量 ——
   *   HUD 按当前广播值取反，core 幂等落库，同值写入不广播）。
   * 接线：core/runtime.ts → character/manager.updateContextEnabled（写 characters →
   * 存档协调器 diff 落库 context_enabled 列）。与全局开关（localStorage，见
   * STRATIX_CONTEXT_TOGGLE_KEY）是**与**关系，注入裁决在 app 层 provider 内完成。
   */
  | { type: 'character.contextEnabled.update'; characterId: string; enabled: boolean }
  /**
   * @since v3.7 新建角色档案（首启引导的落地动作：起名 → 选 agent → 选皮肤 → 写人设）。
   * 载荷口径：
   *   - name：trim 后非空、≤ MAX_CHARACTER_NAME_LEN（24 码点）；
   *   - agentKind：必须是词表内的种类（AGENT_KINDS），不认识的一律拒发；
   *   - skinId：皮肤资源键，**由调用方传入**（引导屏负责随机 / 换肤；core 不猜）；
   *   - persona：缺省或空串 → 套默认模板（**不拒发**：引导流程允许"先起名、回头再调人设"）。
   * 重复同名 → 拒发 + 错误 Notice（状态不变）；core 侧落库后由 WorldState.characters 全量广播。
   * @since v3.10 追加 appearance：首启向导第②步选定的 LPC 形象（体型 + 部位变体）。
   *   缺省 = 不带外观（老档案照旧合法）；给了就按 profile.ts 的外观校验逐项判，非法 → 拒发。
   */
  | {
      type: 'character.create';
      name: string;
      agentKind: AgentKind;
      skinId: string;
      persona?: string;
      appearance?: CharacterAppearance;
    }
  /**
   * @since v3.1 新增可选 linkId：缺省表示"投给当前唯一的已连接会话"；
   * 会话不唯一时不猜，走 onUnhandled 上报（宁可让调用方显式指定，也不投错 agent）。
   */
  | { type: 'chat.send'; text: string; linkId?: string }
  /**
   * @since v3.6 已接线：core/runtime.ts 在收到本命令时调 CoreStore.setCurrentScreen
   *   （纯函数 applyCurrentScreen）落库 + 广播；HUD 侧 main-screen 据此切换 settings /
   *   character / main 三屏之一渲染。'chat' 由 core 解释为"打开聊天抽屉"，不进 currentScreen
   *   （抽屉仍由 chat-drawer 自治，HUD 仍可派发但无屏位切换效果）。
   *   之前 Phase 2 留 TODO（handler 未接），HUD 端能派发但走 onUnhandled。
   */
  | { type: 'ui.navigate'; screen: ScreenId }
  | { type: 'theme.set'; themeId: 'default' | 'pixel' }
  // @since v3.1 外部 agent 会话生命周期（core/agent-link 消费，见 §2 目录职责）
  | { type: 'link.open'; kind: AgentLinkKind; endpoint: string; displayName?: string; apiKey?: string }
  | { type: 'link.resume'; linkId: string }
  | { type: 'link.reconnect'; linkId: string }
  | { type: 'link.close'; linkId: string }
  /**
   * @since v3.5 偏好开关写入。why 单开一条：偏好既不是领域动作（mission.*）也不是导航
   *   （ui.navigate），塞进现有任何一条都会逼 core 侧多一个"这一支其实是偏好"的判断分支。
   *   落到 core/store.ts 的 setPreference（纯函数 applyPreference），HUD 一律经 adapter.dispatch。
   *   TODO(v3.Phase2): core/runtime.ts 接线 —— 本任务按分工不动 runtime.ts，命令暂走
   *   onUnhandled（未落地）通道；接线后 core 侧即成为偏好的唯一写入方。
   */
  | { type: 'settings.set'; key: BooleanPreferenceKey; value: boolean }
  /**
   * @since v3.5 危险区：重置编组（清空当前选择集）。
   *   为什么不复用 unit.select 配空数组：重置编组是一次显式的破坏性动作，
   *   让调用方去拼一个空数组会把"清空"这个意图摊平成普通选择，审计日志里也认不出。
   *   TODO(v3.Phase2): core/runtime.ts 接线到 core/unit/selection（当前按未落地处理）。
   */
  | { type: 'selection.reset' }
  /**
   * @since v3.5 危险区：清理缓存。
   *   TODO(v3.Phase2): core/runtime.ts 接线到持久化层 —— 本仓库当前还没有缓存层，
   *   先把命令位占住，避免将来 HUD 与 core 各发明一套"清缓存"语义。
   */
  | { type: 'cache.clear' }
  /**
   * @since v3.16 角色任务派发（task_037）：把一段自由文本指令派给某个角色，
   *   由 app 层 task-service 经 CLI transport 执行（每角色 FIFO、并发 1）。
   * 载荷口径：characterId 必须命中 WorldState.characters；prompt trim 后非空、
   *   ≤ MAX_TASK_PROMPT_LEN。守门（agent 绑定 / 已检出）在 app 层出队时裁决 ——
   *   不满足时任务直接落 failed（状态里看得见原因），不是拒绝入队。
   * UI 入口（派发表单）归 038；本命令在 core 落地后，任何总线调用方都能派任务。
   * @since v3.26（task_050）可选 targetCharacterId：**指定承接人**（派发智能推荐的手动指定
   *   路径）。给出时任务直达该角色队列（必须命中 WorldState.characters，否则 manager 拒绝
   *   并回 error Notice）；缺省 = characterId（037 起的现行为）。「自动（推荐）」的择人决策在
   *   HUD 推荐纯函数（hud/panels/task-assign-catalog），core 只认结果 —— core 不做推荐
   *   （它不知道历史成功率与预设库，那是 hud/app 的数据面）。
   */
  | { type: 'task.assign'; characterId: string; prompt: string; targetCharacterId?: string }
  /**
   * @since v3.23 排队任务取消（task_047）：把一条 **queued** 任务收尾成 cancelled。
   * 只对 queued 生效：running 不强杀（取消在跑任务是「先停止」另一件事，core 侧拒绝并回
   * Notice 提示）；completed / failed / cancelled 是终态，重复取消幂等拒绝（不改写历史）。
   * 载荷口径：taskId 必须命中 WorldState.tasks。UI 的取消按钮只对 queued 条目渲染（047）。
   */
  | { type: 'task.cancel'; taskId: string }
  /**
   * @since v3.25（task_049）计划批准（任务审批门）：把一条 **awaiting_approval** 任务放回
   * running 并续执行。仅 awaiting_approval 生效；其余相位由状态机拒绝并回 Notice。
   * 续执行的驱动（同 session 续发「计划已批准，按计划执行」）在 app 层 task-service
   * （core 零 IO），它听 task.approved 事件接手。UI 的批准按钮只对 awaiting 任务渲染（049）。
   * 载荷口径：taskId 必须命中 WorldState.tasks。
   */
  | { type: 'task.approve'; taskId: string }
  /**
   * @since v3.25（task_049）计划驳回：把一条 **awaiting_approval** 任务直达 failed
   * （reason=rejected，状态机写死 output=「计划被驳回」，计划留在 task.plan 存档）。
   * 仅 awaiting_approval 生效。与 cancel 分开两条命令：驳回是「看过计划后说不行」的显式
   * 裁决，不是「排错了队」的取消；语义、终态与 UI 入口都不同。
   */
  | { type: 'task.reject'; taskId: string }
  /**
   * @since v3.27（task_051）多 agent 流水线发起：携一份流水线规格（PipelineSpec）与
   *   原始议题（模板变量 {{task}} 的源文本）。执行期编排不在 core（零 IO 铁律 +
   *   编排态不进 WorldState，见 PipelineSpec 的架构定位注）：runtime 把本命令转交给
   *   注入的编排器端口（PipelineRunnerPort，实现在 app 层 pipeline-service），未注入时按
   *   未落地处理（onUnhandled —— 与 agent-link 命令同一口径）。规格合法性在编排器侧用
   *   validatePipelineSpec 裁决（坏形状落一条 failed 流水线，看得见，不静默丢）。
   * UI 入口：agent-panel 派发表单的「流水线」模式（预设模板 + 自定义两站）。
   */
  | { type: 'pipeline.start'; spec: PipelineSpec; issue: string };

/**
 * @since v3.18 经验来源词表（`exp.gained` 事件的 source 字段，task_039）。
 *   - task_completed / task_failed：任务终态（task-service 在任务收尾时发射 —— 失败亦有经验，
 *     「做过就有收获」是养成口径）；
 *   - chat_round：一轮**成功**对话（chat-service 在 done 收束后发射；error / 守门拒绝 / 中断轮不发）。
 * 数值表：@since v3.19（task_040）起由 **core/progression 的 weights 表**接管（单一数值真相源），
 *   发射点仍经注入的权重函数换算（组合根注入 expWeightFor）；app/services/exp-config.ts 降级为
 *   转发层（见其文件头）。本类型只声明「经验从哪来」—— 事件契约本身（source 词表 / amount > 0）不变。
 */
export type ExpSource = 'task_completed' | 'task_failed' | 'chat_round';

// ============================================================================
// ★ 总线契约：world → core 的交互事件（单向，world 不直接改 HUD）
// ============================================================================

export type WorldEvent =
  | { type: 'unit.click'; unitId: string; mods: ClickMods }
  /**
   * @since v3.21 框选补全（task_045）：core 不持有坐标，算不出命中集合 —— 命中判定在世界层完成
   *   （UnitRegistry.queryBounds），上报方把结果 id 补在事件上（runtime 对带 id 的框选落选择集）。
   *   缺省 = 上报方没算命中（老调用方 / 合成事件），core 维持「未处理」观测口径不硬猜。
   */
  | {
      type: 'selection.box';
      bounds: Bounds;
      /** 框选命中（或空数组 = 拖了空框 / 点了空地：明确清空选择）。 */
      unitIds?: readonly string[];
      /** true = 并入当前选择集（Shift 加选）；缺省/false = 覆盖。 */
      additive?: boolean;
    }
  | { type: 'camera.moved'; center: Point; zoom: number }
  /**
   * @since v3.12 单位落位 / 移动上报（task_033）：世界层是位置的唯一真相（UnitView 不含坐标），
   *   位置变化（新单位落位、未来的拖拽移动）由此事件发回 core 方向 —— core 状态机不消费它
   *   （core 仍不持有坐标），由 app 层持久化订阅者落 SQLite（unit_positions 表，防抖写）。
   * why 走总线而不是 world 直接落库：world 零 IO 是分层铁律，事件是它唯一能发出的东西。
   */
  | { type: 'unit.position'; unitId: string; x: number; y: number }
  /**
   * @since v3.21 战场右击移动（task_045）：世界层发出的移动指令（右键短按，选中编队 + 目标点）。
   *   与 HudCommand 的 unit.move **同名同载荷** —— 方向不同（这条是世界层上报的指令意向），
   *   runtime 两个入口共用同一套编队落位与 unit.position 终值广播（见 applyUnitMove）。
   *   短按/拖拽的阈值判定在世界层（右键拖远仍归 pan，不发本事件）。
   */
  | { type: 'unit.move'; unitIds: string[]; x: number; y: number }
  /**
   * @since v3.16 角色任务生命周期事件（task_037，task_037 规格指定走 WorldEvent 通道）。
   *   发出方是 core/task（状态迁移的真相源），携带迁移后的任务快照（不可变），
   *   消费者是 app 层订阅者：task-service（出队执行）与任务落库（tasks 表）。
   *   runtime 的 handleWorldEvent 对它们显式接地（同 unit.position 惯例，不进 onUnhandled）。
   * why 复用 world 通道而不是新开第四条通道：通道即铁律，新增通道要先改 REFACTOR_PLAN §5；
   *   事件通道是总线里现成的"域事件广播面"，任务事件挂上去与 unit.position（消费者也在
   *   app 层）同一先例。方向语义上它们是 core 发出的，与"world → core"字面相反 ——
   *   这是一个有意的、已在两侧文件头注明的取舍，不是疏忽。
   */
  | { type: 'task.queued'; task: CharacterTask }
  | { type: 'task.started'; task: CharacterTask }
  | { type: 'task.completed'; task: CharacterTask }
  | { type: 'task.failed'; task: CharacterTask }
  /**
   * @since v3.23（task_047）排队任务取消事件 —— 与上面四条生命周期事件同一形状（携带迁移后
   * 快照）。消费者仍是 app 层：task-service（把它从待执行队列剔除，防「取消与出队同帧」竞态）
   * 与任务落库（cancelled 快照随事件落）。不发 exp.gained：取消的任务没跑过，「做过就有收获」
   * 的口径覆盖不到它，也不触发 onTaskSettled 回流（没有可回的结果）。
   */
  | { type: 'task.cancelled'; task: CharacterTask }
  /**
   * @since v3.25（task_049）计划挂起事件（任务审批门）：plan-first 任务在 running 中产出
   * 计划并检测到标记行后，由 task-service 调 manager.requestApproval 触发。快照里 plan
   * 字段携带计划全文（已剥离标记行）。消费者：任务落库（awaiting 快照 + 全文 output）；
   * toast（组合根）+ 战场?浮标（world 桥转发）+ 审批卡（hud 从状态读）。不发 exp、
   * 不触发 onTaskSettled —— 挂起不是终态，还没到「可回结果」的时点。
   */
  | { type: 'task.awaiting_approval'; task: CharacterTask }
  /**
   * @since v3.25（task_049）计划批准事件：awaiting → running 迁移后的快照（同任务回 running）。
   * 消费者：task-service（接手续执行 —— 同 session 续发批准指令）与任务落库（running 快照）。
   * 世界桥把它按 started 相位转发（单位重新画工作环）。
   */
  | { type: 'task.approved'; task: CharacterTask }
  /**
   * @since v3.18 经验获得事件（task_039，规格指定走 WorldEvent 通道 —— 与 task.* 同一先例：
   *   发出方是 app 层服务（task-service / chat-service），消费者是养成模块）。
   * 载荷口径：characterId 命中 WorldState.characters（发射点用派发时的角色，档案被删的
   *   边角由消费者自行容错）；source ∈ ExpSource；amount > 0（权重为 0 → 发射点直接不发）。
   * @since v3.19（task_040）：消费者落地 —— app 层 progression-service 订阅本事件，经
   *   character manager 累加进 WorldState.characters（等级结算走 core/progression 的曲线），
   *   升级则广播 level.up。core 状态机仍不消费（经验累计不写进 core 的命令面），
   *   runtime 的 handleWorldEvent 显式接地（同 task.* 惯例，不进 onUnhandled）。
   */
  | { type: 'exp.gained'; characterId: string; source: ExpSource; amount: number }
  /**
   * @since v3.19 角色升级事件（task_040，与 exp.gained 同一先例：发出方是 app 层
   *   progression-service，走 world 通道广播；消费者是 UI 反馈（041 的解锁提示 / toast）等）。
   * 载荷口径：characterId 命中 WorldState.characters；fromLevel/toLevel 为升级前后等级，
   *   **恒有 toLevel > fromLevel**；跨多级也只发一条（级差由 toLevel - fromLevel 表达 ——
   *   「一次结算一条事件」，与 progression.levelUpCheck 的结算口径一致）。
   * 时序约定：等级与经验的真相已在本事件**之前**写入 WorldState.characters（progression-service
   *   经 character manager 落库后才广播本事件）—— 订阅者拿最新 state 即可对齐，无需载荷携带数值。
   * core 状态机不消费（等级是 characters 里的既有字段，不另立第二份真相），
   *   runtime 的 handleWorldEvent 显式接地（同 exp.gained 惯例，不进 onUnhandled）。
   */
  | { type: 'level.up'; characterId: string; fromLevel: number; toLevel: number }
  /**
   * @since v3.27（task_051）流水线整线完成事件 —— 发出方是 app 层编排器（pipeline-service，
   *   与 exp.gained / level.up 同一先例：app 发、走 world 通道广播），消费者是 UI 反馈
   *   （组合根接 toast：见 main-entry）。载荷只携标识与名称（卡片与库里的全量站态在
   *   pipelines 表与面板注入的实时 feed，事件不雪球）。core 状态机不消费（编排态不进
   *   WorldState —— PipelineSpec 架构定位注），runtime 的 handleWorldEvent 对 pipeline.*
   *   显式接地（同 task.* 惯例，不进 onUnhandled）。
   */
  | { type: 'pipeline.completed'; pipelineId: string; pipelineName: string }
  /**
   * @since v3.27（task_051）流水线整线失败事件：任一站 failed / cancelled（含派发被拒）
   *   即整线终态 failed，后续未到站全部 skipped。reason 是面向用户的一句话（失败原因 /
   *   取消提示），不承诺结构化 —— 详细原因在失败站的 character_tasks 行里。
   */
  | { type: 'pipeline.failed'; pipelineId: string; pipelineName: string; reason: string };