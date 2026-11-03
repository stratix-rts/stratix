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
 * @since v3.34（task_058）编组槽位下限（含）。槽位即 Ctrl/⌘+数字 建组、数字键召回的那个 N。
 * why 冻结在契约层：core 校验（runtime 拒绝越界槽位）、HUD 快捷键表、帮助浮层文案
 *   三处共用同一份数值 —— 谁都不许自抄一份字面量，否则键位表放行 0 而 core 拒收，两侧行为漂移。
 */
export const MIN_CONTROL_GROUP_SLOT = 1;

/**
 * @since v3.34（task_058）编组槽位上限（含）。9 与 RTS 惯例（Ctrl+1..9）对齐，
 *   血缘：v2 ShortcutManager 的 select-group-N / create-group-N 循环同样以 1..9 为界。
 */
export const MAX_CONTROL_GROUP_SLOT = 9;

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
 * @since v3.38（task_077）单条任务的**检查点**条数上限（core/mission 强制）。
 * why 需要它：checkpoints 随 WorldState.missions 全量广播，而检查点是 append-only 的 ——
 * 不设上限，一条被反复记账的任务会把广播体积顶起来（perf 硬约束：广播体积必须有界）。
 * 超限时丢**最旧**的：最近发生的事才有排查价值。
 */
export const MAX_MISSION_CHECKPOINTS = 64;

/**
 * @since v3.38（task_077）单条任务的**依赖**条数上限（core/mission 强制）。
 * why 需要它：dependsOn 同样是随状态全量广播的数组，且依赖越多，isMissionUnlocked 的判定越贵
 * （逐条查表）。32 条对"一条任务等几件前置事"足够宽松。
 */
export const MAX_MISSION_DEPENDENCIES = 32;

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

/**
 * @since v3.40（task_091）会话记录条数上限（core/session 强制）。
 * 与 MAX_MISSIONS / MAX_TASKS 同一理由：sessions 随 WorldState 全量广播，必须有界。
 * 超限时先丢**已关闭（closed）**的最旧会话（FIFO）；全是活会话时腾不出位置就拒绝新建
 * —— 绝不静默挤掉在办会话（让一条正在进行的会话消失，比"拒绝新建"更糟）。
 */
export const MAX_SESSIONS = 200;

/**
 * @since v3.33（task_057）战场世界边界（世界坐标，左上角 + 宽高）。
 * why 冻结在契约层：三处消费方 —— world 相机钳制（camera/camera-math 的 DEFAULT_WORLD_BOUNDS
 * 以它为唯一来源）、core 的 camera.center 命令钳制（core/camera.ts）、hud 小地图的世界↔画布
 * 映射（hud/components/minimap）—— 谁都不许自抄一份字面量，否则三层边界各长各样、
 * 跳转与钳制互相打架。数值即此前 camera-math 的 DEFAULT_WORLD_BOUNDS（3200×2400），
 * v3 暂无地形系统，后续如需可变边界再走契约增补。
 */
export const WORLD_BOUNDS: Bounds = Object.freeze({ x: 0, y: 0, width: 3200, height: 2400 });

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

/**
 * 相机状态（@since v3.4，task_092）—— 世界坐标的视口中心 + 缩放。
 *
 * why 冻结在契约层：世界 → 屏幕的换算是**两侧都要用**的公式（world 侧画屏幕空间的
 *   引导弧线要它，hud 侧将来要把世界坐标落到 DOM 上也要它）。真相是相机的位姿，
 *   换算公式归 core/camera.ts 的 worldToScreen（纯函数）—— 谁都不许在自己那份里
 *   重写一遍「乘 zoom 再减半视口」，抄一份必然漂移。
 * 口径与 world/camera/camera-math 的 CameraPose 同源：center 是**屏幕中心所对应的
 *   世界坐标**（Phaser 的 midPoint 口径，不随 zoom 变），zoom 是缩放倍率。
 */
export interface CameraState {
  readonly center: Point;
  readonly zoom: number;
}

/** 视口尺寸（屏幕像素）。世界 → 屏幕换算的基准，与相机控制器读同一份。 */
export interface ViewportSize {
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
  /**
   * @since v3.30 单位在线位（task_054，agent 健康监测）：false = 它绑定的 CLI 进程级离线
   *   （连续探测失败 / 崩溃掉线），渲染侧灰显 + 「离线」徽标，派任务 / 对话入口拦截。
   * **缺省 / true = 在线**（向后兼容铁律：不写入即在档在线 —— 老存档、未探测过、
   *   还没接健康监测的环境都不会被误伤成离线）。它与 status 词表里的 'offline' 是两个正交
   *   语义：status 描述任务忙闲（idle/busy 由任务状态机派生），online 描述 CLI 健康与否；
   *   掉线时忙闲真相保持原值（任务侧另有 failed 相位），渲染层只叠加灰显。
   * 真相源：app 层 health-monitor 经 agent.offline / agent.online 事件 → runtime 接地写入；
   *   不落库（运行时健康态，重启后按「缺省在线」重新探测）。
   */
  readonly online?: boolean;
  /**
   * @since v3.37 单位名标签（task_062）：角色单位的等级投影（= CharacterView.level），
   *   战场头顶「Lv 小字」的数据面。缺省 / null = 未关联角色或无等级 → 只显名字，不编造数值。
   *   与 name 同为建档快照投影（unit-projection.ts）：升级写入（character manager 的
   *   grantExperience）在**同一次 setState** 里同步刷新 units[].level —— 与 name / appearance
   *   的「两侧不漂移」惯例同一条纪律（见 core/character/manager.ts）。
   */
  readonly level?: number | null;
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

/**
 * @since v3.38（task_077）任务正文契约（结构化 brief）—— 四段自由文本。
 *
 * why 与「派单 prompt」分开：**prompt 是派给执行者的一句话指令**（task.assign 那条链），
 * brief 是**任务本身的契约**（这台工作台自己持有的、关于"这件事要做成什么样"的记录）。
 * 派单 prompt 会随角色任务流走、每次派发可能重写；而 brief 挂在 mission 上，是这条任务的
 * 长期事实 —— 需求、验收标准、交付物、约束。机器可读的**验收标准**是这块的核心诉求：
 * 有了 acceptance，"这条任务算不算做完"才有判据（否则只剩一句人话标题）。
 *
 * 四段都是**可选**的：缺省段 = 该段无内容（不是空串）。全空时 brief 整体不落到状态里
 * （见 core/mission/machine.ts 的 normalizeBrief），免得给裸任务塞一个空壳对象。
 */
export interface MissionBrief {
  /** 需求：要做什么（做什么算满足需求）。 */
  readonly requirements?: string;
  /** 验收标准：怎样算做完（**机器可读的核心诉求**）。 */
  readonly acceptance?: string;
  /** 交付物：交什么出来（文件 / 报告 / 结论）。 */
  readonly deliverables?: string;
  /** 约束：不能碰什么 / 必须怎么做。 */
  readonly constraints?: string;
}

/**
 * @since v3.38（task_077）任务检查点（checkpoint）—— 一条 append-only 的记账行。
 * at = 记账时刻（epoch ms，由写入方给，本层不读时钟）；note = 这一刻发生了什么。
 */
export interface MissionCheckpoint {
  readonly at: number;
  readonly note: string;
}

export interface MissionView {
  readonly id: string;
  readonly title: string;
  readonly phase: MissionPhase;
  /** 指派对象：多选集合（编组）展开的单位 id 列表。 */
  readonly unitIds: readonly string[];
  readonly createdAt: number;
  /**
   * @since v3.38（task_077）结构化正文。**可选**：缺省 = 裸任务（只有标题）。
   * why 可选而不是必填：旧构造点（MCP / HUD / 单测里的字面量）一律零改动即可编译 ——
   * 新字段必须是"加不加都行"，否则每处构造点都得改一遍，收益与风险不成比例。
   */
  readonly brief?: MissionBrief;
  /**
   * @since v3.38（task_077）检查点历史（append-only）。**可选**：缺省 = 还没记过账。
   * 上限 MAX_MISSION_CHECKPOINTS（超限丢最旧）。
   */
  readonly checkpoints?: readonly MissionCheckpoint[];
  /**
   * @since v3.38（task_077）依赖的任务 id 列表（前置任务）。**可选**：缺省 = 无依赖。
   * 判定函数 isMissionUnlocked 见 core/mission/machine.ts。
   */
  readonly dependsOn?: readonly string[];
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
  /**
   * @since v3.36（task_076）关联的战场任务（mission）id：**这条角色任务是为哪条 mission 跑的**。
   * 缺省 / null = 与 mission 无关的普通派发（老行为，零影响）。
   * 它是回报链的钥匙：任务到终态时由 app 层 task-service 据此把终态回报给 mission
   * （completed → mission 收尾；failed → mission 按中止收尾）。
   * 走可选增补（与 Notice.missionId / Notice.source 同款惯例）：契约增补不许破既有构造点
   * （core / hud 单测夹具、老快照都不带它）。
   */
  readonly missionId?: string | null;
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
// 用户偏好（@since v3.7，task_130 —— 契约里的偏好视图已删，偏好全部走 localStorage）
// ============================================================================
//
// ★ 为什么契约里不再有「偏好视图」（@since v3.7，task_130 —— 真删，不是搬家）：
//   v3.5 曾在契约里留过 SettingsView { soundEnabled, notificationsEnabled } +
//   BooleanPreferenceKey + WorldState.settings + `settings.set` 命令，约定是
//   「core 存一份、随 WorldState 广播、HUD 只渲染 + 发命令改」。
//   **grep 实证（task_130 交付时）**：这四个字段**一个消费方都没有** ——
//    ① core/runtime.ts 从未接线 `settings.set`（命令分发那一段一直是 TODO），
//       HUD 派发出去只会换来一条「未处理 command」；
//    ② WorldState 是**进程内**状态 —— 刷新即回默认值，偏好要「刷新后仍保持」，
//       真相必须落在本机持久层（localStorage）；
//    ③ HUD 侧没有任何一处读 WorldState.settings（设置屏直接读 localStorage）。
//   ⇒ 契约里留着它们只会误导后来者「以为偏好走总线」—— 死字段比没有字段更坏。
//   ⇒ 处置：**删**（SettingsView / BooleanPreferenceKey / DEFAULT_SETTINGS /
//     WorldState.settings / `settings.set` 命令一并移除）。
//   偏好的唯一真相源现在在**本机持久层**（localStorage），键名冻结在各处的常量里：
//     通知提示 / 上下文注入 / 单位名字 → 本文件下方的三个 KEY 常量；
//     音效总开关 / 音量 → hud/sound-engine.ts（两个读侧都在 HUD 侧）。
//   ★ 皮肤（theme.set）同样不在契约里：它是每客户端本地的展示偏好，由 hud bridge
//     本地消费 token 完成切换，core 侧没有回读通道 —— 另立字段只会造出第二个真相源。

/**
 * 上下文注入全局开关的 localStorage 键（@since v3.29，task_053）。
 * 值 '0' = 关；无键 / 其它值 = 开。why 冻结在 core：写入方（hud/settings-screen 的
 * 「上下文注入」行）与读取方（app/services/stratix-context 的全局开关裁决）都在
 * core 之上，公共底座冻结一份键名，两侧不各抄字面量。why 走 localStorage 而不进契约的
 * 偏好视图（task_130 已把那个死字段删掉，见上方「用户偏好」段）：偏好要「刷新后仍保持」，
 * 而这个开关只在本机渲染进程内生效（不进 WorldState、不随广播），localStorage
 * 的轻量落地是刻意的取舍（task_053 规格③）。
 */
export const STRATIX_CONTEXT_TOGGLE_KEY = 'stratix.context.enabled';

/**
 * 单位名字标签全局开关的 localStorage 键（@since v3.37，task_062）。
 * 值 '0' = 关；无键 / 其它值 = 开。why 冻结在 core：写入方（hud/settings-screen 的
 * 「单位名字」行）与读取方（world/objects 的 unit-presence 可见性裁决）都在 core 之上，
 * 公共底座冻结一份键名，两侧不各抄字面量。why 走 localStorage 而不进契约的偏好视图
 * （task_130 已删）：与 STRATIX_CONTEXT_TOGGLE_KEY 同一取舍 —— 只在本机渲染进程生效的表现开关，
 * 不进 WorldState / 广播（task_062 规格②）。
 */
export const STRATIX_NAMETAGS_TOGGLE_KEY = 'stratix.unit.nametags';

/**
 * 通知提示（轻提示 toast）全局开关的 localStorage 键（@since v3.6，task_116）。
 * 值 '0' = 关；无键 / 其它值 = 开。why 冻结在 core：写入方（hud/settings-screen 的
 * 「通知提示」行）与读取方（hud/components/toast 的 toast-host）都在 core 之上，
 * 公共底座冻结一份键名，两侧不各抄字面量（与上面两个键同一取舍）。
 *
 * ★ 为什么偏好**不**走契约（task_116 的取舍 / task_130 的收尾，重要）：
 *   ① WorldState 是**进程内**状态 —— 刷新即回默认值。偏好要「刷新后仍保持」，
 *      真相必须落在本机持久层（localStorage），这是四个偏好行统一口径的根本原因；
 *   ② core/runtime.ts 从未接线 settings.set（store.setPreference 是 v3.5 就有的落库入口，
 *      但命令分发那一段一直是 TODO）—— HUD 派发出去只会让 core 报一条「未处理 command」，
 *      界面等不到广播回来，看着就像"点不动"（死功能报告 #4）。
 *   ⇒ 偏好四行（通知 / 音效 / 上下文注入 / 单位名字）统一走 localStorage 直写，
 *     读写口径一致（'0' = 关，其余 = 开；读失败回落开）。
 *   ★ task_130：契约里那两个没人读的字段（soundEnabled / notificationsEnabled）
 *     已**删除**（含 SettingsView / BooleanPreferenceKey / DEFAULT_SETTINGS /
 *     WorldState.settings / `settings.set` 命令）—— 死字段比没有字段更坏。
 *     偏好的唯一真相源在本机持久层；键名见上（音效那一对在 hud/sound-engine.ts）。
 */
export const STRATIX_NOTIFICATIONS_TOGGLE_KEY = 'stratix.notifications.enabled';

// ============================================================================
// 角色
// ============================================================================

/**
 * @since v3.7 本地 agent 种类词表。**词表即契约**：core 按它校验 agentKind（不认识的一律拒发），
 *   HUD / 首启引导屏按同一份词表渲染"绑的是哪个 CLI agent"；新增一种 CLI agent 两侧同步改。
 *   取值来源：docs/AGENT-MATRIX.md 的 T1/T2 名单（claude / codex / opencode / kimi / openclaw / dsh）。
 * @since v3.32（task_056）扩自定义段：`custom:<id>` 形态（注册表 id 拼进 kind 字符串）。
 *   why 把注册身份编进 kind 而不是只存 'custom'：角色档案 / 检测行 / transport 工厂都按 kind
 *   单键路由，一个 kind 必须唯一定位到"哪一家 CLI"；多家自定义注册共享 'custom' 会让
 *   角色与执行器对不上号。内置 = 静态词表（AGENT_KINDS），自定义 = 动态前缀段
 *   （isCustomAgentKind / customAgentIdOf / buildCustomAgentKind，见 custom-agent.ts 的校验口径）。
 * @since v3.33（task_088）并入 dsh（DeepSeek Harness）：第四种 CLI worker 形态，
 *   与 claude/kimi 平级（agent 同为 CLI worker，只是执行器不同 —— dsh 走 `npx -y @deepseek-ai/dsh`）。
 */
export type BuiltinAgentKind =
  | 'claude-code'
  | 'codex'
  | 'opencode'
  | 'kimi'
  | 'openclaw'
  | 'dsh';

/** 自定义 agent 的 kind 前缀（`custom:<注册表id>`）。常量冻结在 core：两侧不许各抄字面量。 */
export const CUSTOM_AGENT_KIND_PREFIX = 'custom:';

/** 自定义 agent 的 kind 形态（模板字面量：前缀 + 注册表 id）。id 的合法性口径见 core/custom-agent.ts。 */
export type CustomAgentKind = `${typeof CUSTOM_AGENT_KIND_PREFIX}${string}`;

/** @since v3.7 内置五家（@since v3.33 task_088 起为六家，含 dsh）；@since v3.32（task_056）并上自定义段（`custom:<id>`）。 */
export type AgentKind = BuiltinAgentKind | CustomAgentKind;

/**
 * @since v3.7 agent 种类词表的运行时可枚举一份（core 校验用；HUD 也可 import 同一份渲染标签）。
 * @since v3.32（task_056）语义收窄为**内置**的枚举 —— 自定义注册是动态集合（在 custom_agents 表里），
 *   静态词表枚举不了它；判"这个 kind 能不能绑角色"一律走 isBindableAgentKind（内置 ∪ 合法 custom 段）。
 * @since v3.33（task_088）并入 dsh。
 */
export const AGENT_KINDS: readonly BuiltinAgentKind[] = [
  'claude-code',
  'codex',
  'opencode',
  'kimi',
  'openclaw',
  'dsh',
];

/**
 * @since v3.32（task_056）kind 是否为自定义注册形态（`custom:` 前缀 + 合法注册 id）。
 * 纯前缀 + id 字符集判定（不查注册表 —— 注册表在主进程 DB，core 零 IO）："形状合法"与"注册仍在"
 * 是两件事，后者由 app 层在使用点查库裁决。
 */
export function isCustomAgentKind(kind: string): kind is CustomAgentKind {
  if (!kind.startsWith(CUSTOM_AGENT_KIND_PREFIX)) return false;
  const id = kind.slice(CUSTOM_AGENT_KIND_PREFIX.length);
  return id.length > 0 && id.length <= 64 && /^[A-Za-z0-9_-]+$/.test(id);
}

/** 从 kind 里拆出自定义注册 id；不是自定义形态返回 null。 */
export function customAgentIdOf(kind: string): string | null {
  return isCustomAgentKind(kind) ? kind.slice(CUSTOM_AGENT_KIND_PREFIX.length) : null;
}

/** 注册 id → kind（拼前缀）。id 的合法性由注册面校验（core/custom-agent.ts），这里只拼串。 */
export function buildCustomAgentKind(id: string): CustomAgentKind {
  return `${CUSTOM_AGENT_KIND_PREFIX}${id}` as CustomAgentKind;
}

/**
 * @since v3.32（task_056）kind 能否绑角色建档：内置六家（AGENT_KINDS）∪ 形状合法的自定义段。
 * 建档校验（character/profile.ts）、恢复翻译（game-save-coordinator）、向导可建档名单共用这一份裁决，
 * 不许三处各写一套（否则一处认自定义另一处不认，档案会被静默降级成"未绑定"）。
 */
export function isBindableAgentKind(kind: string): kind is AgentKind {
  return (AGENT_KINDS as readonly string[]).includes(kind) || isCustomAgentKind(kind);
}

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
 * @since v3.8 **可检测**的本地 CLI agent 词表（T1-T3 全量 12 种）。
 * why 与 AgentKind 分开成两份词表：AgentKind 是「角色**已绑定**的 agent 种类」
 *   （目前只有 T1 的 6 种，见 core/character/profile.ts 的建档校验），
 *   而检测词表覆盖 T1-T3 全量 —— 「探测到但还不能绑定」的 agent（T2/T3）得有地方安放，
 *   硬塞进 AgentKind 会让建档校验放行一批尚无适配实现的种类。
 * 两份词表是**包含关系**（AgentKind ⊂ DetectableAgentKind），不是同一份清单。
 * @since v3.33（task_088）并入 dsh（T1 —— 有 headless one-shot + NDJSON 事件流 + 会话 id）。
 */
export const DETECTABLE_AGENT_KINDS = [
  // T1 —— 深度适配
  'claude-code',
  'codex',
  'opencode',
  'kimi',
  'openclaw',
  'dsh',
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
  /** agent 种类（DETECTABLE_AGENT_KINDS 内；@since v3.32 自定义注册为 `custom:<id>` 形态）。 */
  readonly kind: DetectableAgentKind | CustomAgentKind;
  /** 探测分层（T1 / T2 / T3；自定义注册恒为 T1 —— 它们能绑角色、能跑 transport）。 */
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
  /** 版本号（首个 semver 片段；取不到时为 null；自定义注册恒 null —— probeCmd 不承诺版本语义）。 */
  readonly version: string | null;
  /** 二进制路径（which 的输出；未确认时为 null；自定义注册为 null —— 探测不走 which 定位）。 */
  readonly path: string | null;
  /**
   * @since v3.32（task_056）显示名（仅自定义注册行携带：注册表里的用户命名）。
   * why 加这个字段：内置六家有静态标签表（AGENT_KIND_LABELS），自定义注册的名字只存在
   * 注册表里 —— 检测行是它进入 WorldState 的唯一载体，不带名字 HUD 就只能显示 `custom:xxx`。
   * 内置行不带该键（undefined ≡ 无别名，渲染回落 agentKindLabel）。
   */
  readonly label?: string;
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
// ★ 会话域契约（@since v3.40，task_091；实现见 core/session/）
// ============================================================================

/**
 * @since v3.40（task_091）会话种类。来源：docs/SESSION-PLAN.md §2「各 kind 的接线策略」。
 * 粒度约定（**渐进：新写走新模型，旧表不迁移**）：
 *   - character_chat：每角色一条长生命周期会话（历史读现有 chat-history-dao，不搬）；
 *   - peer_chat：每场互聊一条（事件全量落库 —— 修「超时即丢」）；
 *   - task_run：每条 task 执行一条（@since v3.46 / task_105 起**全量事件化**：
 *     执行路径埋点 task_started / step / output_tail / completed / failed）；
 *   - mission_run：每条 mission 一条（LITE，只记 create / close）；
 *   - shell_link：每条 agent-link 连接一条（LITE，只记 create / close）。
 */
export type SessionKind =
  | 'character_chat'
  | 'peer_chat'
  | 'task_run'
  | 'mission_run'
  | 'shell_link';

/**
 * @since v3.40（task_091）会话状态。状态机见 core/session/machine.ts。
 *   active：有活动 / 在说话；idle：静默期；interrupted：被中断（超时 / 取消 / 进程死）；
 *   closed：终态（不再收事件）。
 */
export type SessionStatus = 'active' | 'idle' | 'interrupted' | 'closed';

/**
 * @since v3.40（task_091）会话**摘要**（入 WorldState）。
 * ★ 只有摘要入态：事件本体（消息 / 轮次 / 中断标记）落 session_events 表，不进广播 ——
 *   否则 WorldState 会随消息数无限膨胀（广播体积必须有界的性能铁律）。
 * 参与者视 kind 分别是 characterId / agentId / clientId。
 */
export interface SessionRecord {
  readonly id: string;
  readonly kind: SessionKind;
  /** 自动起名（规则版截断，2b 才上 LLM）。 */
  readonly title: string;
  readonly participants: readonly string[];
  readonly status: SessionStatus;
  /** 关联实体 id（task_run → taskId、mission_run → missionId…）；无关联时不出现该键。 */
  readonly refId?: string;
  readonly createdAt: number;
  /** 最后一条事件的时刻（与 status 无关）。 */
  readonly lastEventAt: number;
  /** 收尾时刻；未收尾为 null。 */
  readonly closedAt: number | null;
  /** 事件计数（摘要计数；事件本体在 session_events 表）。 */
  readonly eventCount: number;
}

/**
 * HUD 信息层级（@since v3.4，task_096）—— 三档全局显示密度。
 *   L1 常驻：解释画面的基准信息（顶栏态势胶囊 / 小地图 / 控制岛 / 事件轨静默态）。
 *   L2 事件：随总线事件出现的瞬时件（跑马灯条目 / toast / 报错 vignette / 单位气泡）。
 *   L3 沉浸：打断式演出（里程碑大字 / 回放重演 / 时间戳角标）—— 激活时 L1 让位、L2 收起。
 * 来源：docs/hud-redesign-proposal.html §2.3（信息三层级）+ §2.5（分区规格表的「层级」列）。
 * why 进 core 契约：层级状态要**被 world 侧订阅**（导演取景框等 L3 元素据此让位），
 *   而 HUD ↔ world 零直接调用（总线铁律）—— 唯一合法通道就是 core 广播的 WorldState。
 *   故它是「可选增补」字段（与 settings / currentScreen / directorEnabled 同一口径）：
 *   契约增补不许打破既有 WorldState 构造点（core / hud 单测夹具）的编译；
 *   读取方缺省时按 'L1'（常驻档 = 无任何特殊状态）处理。
 */
export type InfoLayer = 'L1' | 'L2' | 'L3';

/**
 * 演出占用源（@since v3.4，task_094）—— Z6 沉浸层的三个触发源。
 *   milestone 里程碑大字：中央金色大字（task_080 交付，本任务只做层级接线）。
 *   replay    ▶60 秒重演：当日回放自动倍速播放中（task_082 交付，本任务只做层级接线）。
 *   director  导演取景框：导演模式开着（task_081/092 交付，本任务把它挂进 L3 状态）。
 * 来源：docs/hud-redesign-proposal.html §2.5 Z6 行（「全屏叠加 / L3 / 里程碑大字 · ▶60 秒重演 ·
 *   导演取景框 / 激活时 L1 → 18% 对比、L2 收起」）。
 * why 是词表而不是布尔字段：三个演出可以**同时**在演（里程碑撞上回放），谁先结束谁先放手，
 *   但只要还有一个在演，L3 就得继续 —— 占用计数用一组词表表达最直接。
 * 体积天然有界：三个词（不是数组里的自由值），不存在增长问题（perf：广播数据必须有界）。
 */
export type LayerTrigger = 'milestone' | 'replay' | 'director';

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
   * 体积天然有界：名单是固定 12 项（DETECTABLE_AGENT_KINDS），逐条到达也只是覆盖同名项，
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
  /**
   * @since v3.34（task_058）编组槽位表（Ctrl/⌘+1..9 存入、数字键召回）。
   * why ReadonlyMap：WorldState 只在进程内广播（bus 是 mitt，不 JSON 序列化），Map 引用安全；
   *   值是存入时刻选择集的 **id 数组副本** —— 之后选择变化不影响已存编组；召回时由 runtime
   *   对账已消失单位（同 unit.select 的悬空 id 口径）。刻意可选：契约增补不破既有构造点，
   *   缺省 = 无编组。不落库（会话内有效，跨会话持久化留待后续任务）。
   * 体积天然有界：槽位键域 1..9（MAX_CONTROL_GROUP_SLOT），值受 MAX_SELECTION_SIZE 截断。
   */
  selectionGroups?: ReadonlyMap<number, readonly string[]>;
  /**
   * @since v3.40（task_091）会话摘要列表（core/session 写入，上限 MAX_SESSIONS）。
   * 刻意可选：与 settings / detectedAgents / tasks / selectionGroups 同理走可选增补 ——
   * 契约增补不许打破既有 WorldState 构造点（core / hud 单测夹具）的编译；
   * 读取方缺省时按空列表处理。
   * ★ 入态的只有**摘要**（SessionRecord）；事件本体落 session_events 表，不进广播。
   */
  sessions?: SessionRecord[];
  /**
   * @since v3.3（task_081）导演模式开关（DEMO-PLAN §7「导演模式」）。
   * 真相在 core：HUD 顶栏「🎬 导演」按钮发 `camera.director` 命令 → core 写这里 →
   *   广播回 HUD（按钮状态）与 world（导演控制器）。world 侧的手动介入会让它自己退回 false
   *   （world 发同名事件 → core 写回）—— 手动优先是硬规则（见 types.ts 的 WorldEvent 注）。
   * 刻意可选：与 settings / currentScreen 同理走可选增补 —— 契约增补不破既有构造点，
   *   缺省 = 导演模式关闭。
   */
  directorEnabled?: boolean;
  /**
   * @since v3.4（task_096）HUD 信息层级（L1 常驻 / L2 事件 / L3 沉浸）。
   * 真相在 core：HUD 的三档开关发 `hud.layer.set` 命令 → core 写这里 → 广播回 HUD
   *   （HUD 侧据此降对比 / 收起 L2）与 world（world 侧的 L3 元素据此让位）。
   * 刻意可选：与 settings / currentScreen / directorEnabled 同理走可选增补 ——
   *   契约增补不破既有 WorldState 构造点；读取方缺省时按 'L1' 处理。
   * 体积天然有界：单词表三值（不是数组），不存在增长问题（perf：广播数据必须有界）。
   *
   * ★ task_094 追加：**这个字段是「有效层级」**（= 手动档 layerBase 与演出占用 layerHolds
   *   裁决后的结果），呈现层与 world 侧都只读它 —— 「现在处在哪一档」只有一个答案。
   */
  infoLayer?: InfoLayer;
  /**
   * @since v3.4（task_094）HUD 信息层级的**手动档**（演示开关选的档）。
   * 真相在 core：`hud.layer.set` 命令写这里。
   * why 与 infoLayer 分开：演出占用（里程碑大字 / 60 秒重演 / 导演取景框）期间有效档被
   *   强推成 L3，演出结束后要**回到手动档** —— 手动档得有人记着，不然一出演出就回不去 L1/L2。
   * 缺省 = L1（常驻档）；读取方缺省时按 'L1' 处理。
   */
  layerBase?: InfoLayer;
  /**
   * @since v3.4（task_094）当前占用的**演出源**（里程碑 / 重演 / 导演）。
   * 真相在 core：`hud.layer.hold` 命令写这里；导演模式开关（camera.director）也写这里。
   * 语义：非空 = 有演出在演 = 有效档锁 L3（L1 让位、L2 收起）；空了 = 回到手动档。
   * 体积天然有界：最多三个词（perf：广播数据必须有界）。
   */
  layerHolds?: readonly LayerTrigger[];
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
   * @since v3.4（task_091）事件轨点选单位（HUD v3.4 · Z2 事件轨）。
   *   发出方是左下事件轨的**条目点击**（点哪条 → 锁定哪个单位，见 proposal §2.5 Z2 的
   *   「hover 展开详情；点击锁定单位 + 中屏高亮 + 引导弧线」）。
   *   与 unit.focus 的分工：unit.focus 是**相机动作**（把镜头对到某单位，v3.2 起）；
   *   本条是**单位联动**的诉求（world 侧给该单位描边高亮 + 画左下→中屏的引导弧线，
   *   消费者是 task_092）。两者语义正交、可并存 —— 所以**另开一条**，不并进 unit.focus：
   *   并进去就得给 unit.focus 加「要不要联动」的开关位，契约会变浑。
   *   core 只做转发（不写 WorldState —— 联动是瞬态表现，同 camera.shake 口径）。
   */
  | { type: 'focus.unit'; unitId: string }
  /**
   * @since v3.33 小地图跳转（task_057）：把相机对中到某个世界点（世界坐标）。
   *   是 unit.focus 的**泛化**命令（点是世界点而不是单位 id —— 小地图点的是坐标，不是单位）：
   *   core 收到后用 core/camera.ts 的纯函数钳进 WORLD_BOUNDS，再以同名 WorldEvent 转发到
   *   world 通道（消费者是场景相机，同 task.* 「core 发出、world 消费」的先例）；
   *   世界层最终落位仍过 camera-math 的钳制（双重钳制无害，口径同源）。
   *   zoom 不变 —— 只跳转不缩放，语义最小。
   */
  | { type: 'camera.center'; x: number; y: number }
  /**
   * @since v3.3 镜头震动（task_080）：里程碑大字落下时的一记小震。
   *   发出方是 HUD 的里程碑 overlay（它判定「每 10 个任务完成」那一刻），core 只做钳制
   *   （core/camera.ts 的 clampShake：时长 ≤ 500ms、强度 ≤ 2% 视口）与转发：以同名
   *   WorldEvent 发到 world 通道，消费者是世界场景（bridge 转发 syncCameraShake →
   *   Phaser 相机的 shake）。HUD 绝不直接调 world（铁律）—— 与 camera.center 同一两段式。
   *   why 值得单开一条：震动是**瞬态表现**，不进 WorldState（没有「相机在震」这种状态）。
   */
  | { type: 'camera.shake'; durationMs: number; intensity: number }
  /**
   * @since v3.3（task_081）导演模式开关（DEMO-PLAN §7「导演模式」）。
   *   发出方是 HUD 顶栏的「🎬 导演」按钮；core 收到后写 WorldState.directorEnabled
   *   （按钮回显的唯一真相）并以**同名 WorldEvent** 转发到 world 通道
   *   （消费者是世界场景的导演控制器 —— 它自动订阅任务事件、编排镜头）。
   *   HUD 绝不直接调 world（铁律）—— 与 camera.center / camera.shake 同一两段式。
   *   反向也用这一条：world 侧检测到**手动介入**时发同名 WorldEvent（enabled=false），
   *   core 据此把开关写回 false 并广播 —— 手动优先，导演让位（DEMO-PLAN §7）。
   */
  | { type: 'camera.director'; enabled: boolean }
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
  /**
   * @since v3.34（task_058）编组存入：把**当前选择集**快照进槽位 N（1..9）。
   * 血缘：v2 ShortcutManager 的 create-group-N（Ctrl+N）。载荷口径：group ∈
   *   [MIN_CONTROL_GROUP_SLOT, MAX_CONTROL_GROUP_SLOT]，越界由 runtime 拒绝（warn Notice）；
   *   空选择被拒（不清空已有编组 —— RTS 惯例：没人可编就别动槽位）；同槽位同成员幂等
   *   （不广播，与 store 的「无实质变化不广播」同一约定）。
   */
  | { type: 'unit.group.assign'; group: number }
  /**
   * @since v3.34（task_058）编组召回：选中槽位 N 的成员（**覆盖**当前选择集）。
   * 血缘：v2 ShortcutManager 的 select-group-N（裸数字键）。召回即 unit.select(set) 语义 +
   *   对账：已消失单位剔除；空槽 / 成员全部离场 → 不动选择集，回 warn Notice（绝不猜）。
   *   反馈（「召回编组 N（x 单位）」）走 Notice，由 HUD 命令面板的 notices 区呈现 ——
   *   单位卡分组徽标本任务不做（取舍见 task_058），Notice 是轻量替身。
   */
  | { type: 'unit.group.recall'; group: number }
  | { type: 'mission.assign'; missionId: string; unitIds: string[] }
  | { type: 'mission.confirm'; missionId: string; decision: ConfirmDecision }
  /**
   * @since v3.1 任务创建。why 补这条：mission.assign 只认**已存在**的 missionId，
   *   而「发起任务」是 HUD 的首要动作，必须能从 HUD 直接开出一条新任务。
   *   unitIds 为空表示"待指派"的草稿任务（先立任务、后选人），非空表示直接指派给这些单位。
   * @since v3.38（task_077）可选 brief（结构化正文）与 dependsOn（前置任务 id 列表）透传：
   *   两者都**可选**，缺省即"裸任务"——既有构造点零改动即可编译。
   */
  | {
      type: 'mission.create';
      title: string;
      unitIds: string[];
      brief?: MissionBrief;
      dependsOn?: string[];
    }
  /**
   * @since v3.1 任务取消。契约里 MissionPhase 早已冻结了 'cancelled' 相位，
   *   却没有任何命令能到达它（旧 UI 的「停止」语义落在这条上），这里把缺口补齐。
   */
  | { type: 'mission.cancel'; missionId: string }
  /**
   * @since v3.6（task_120）**撤掉**一条从未开工的编组任务 —— 从世界态里移除，不留终态墓碑。
   *
   * 与 mission.cancel 的分工（两个动作不是一回事，别混用）：
   *   - mission.cancel = **叫停**：任意非终态 → 'cancelled'，留下终态历史（UI 的「停止任务」走这条）；
   *   - mission.remove = **撤掉**：只认**从未开工**的任务（draft / pending）—— 它还没确认、没开工，
   *     什么都没发生，世界态里不必留一条墓碑（外部 agent 清理自己造的悬空 / 探针任务走这条）。
   *
   * 守卫在 core（core/mission/machine.ts 的 canRemoveMission）：已确认 / 在跑 / 终态一律拒绝 ——
   * 前两者背后有活儿在跑（撤任务不等于撤活儿），终态则是历史不改写。
   */
  | { type: 'mission.remove'; missionId: string }
  /**
   * @since v3.38（task_077）任务检查点记账：往任务上追加一条 { at, note }。
   * 语义：
   *   - 任意**非终态**相位都可记（draft / pending / confirmed / running）；
   *   - 终态（done / cancelled）拒绝 —— 收尾后的任务不再改写历史（同 machine.ts 的终态铁律）；
   *   - **静默记账**：这条命令不发 Notice（成功与否都不发）。why：记账是高频后台动作，
   *     每记一次就弹一条通知会把通知队列冲垮、也会盖掉真正该让人看见的消息。
   *     代价是"记上了吗"没有即时回执 —— 读方看 mission.checkpoints 即可（状态里有）。
   */
  | { type: 'mission.checkpoint'; missionId: string; note: string }
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
   * @since v3.35 角色改名（task_059 角色编辑中心 · 档案 tab 的落地动作）。
   * 载荷口径：name trim 后非空、≤ MAX_CHARACTER_NAME_LEN（24 码点），裁决与建档同一份
   *   （profile.ts 的 resolveCharacterName）；与**其它**角色重名（大小写不敏感）→ 拒发 +
   *   **error 级** Notice（与 character.create 的 duplicate-name 同一口径）；
   *   与自己当前名字相同（trim / 大小写不敏感）→ 幂等成功、不广播。
   * 接线：core/runtime.ts → character/manager.updateName（写 characters + **同一次 setState** 内
   *   同步刷新该角色战场单位的 name 投影 —— 单位名是建档时的快照，不同步战场就还叫旧名）。
   */
  | { type: 'character.name.update'; characterId: string; name: string }
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
   * @since v3.7（task_129）删除角色档案（名册清理 —— `character.create` 的逆向命令）。
   * 载荷口径：characterId 必须命中 WorldState.characters。
   * 拒绝口径（裁决在 core/character/manager.ts 的 deleteCharacter，占用判定在 delete-guard.ts）：
   *   - 在任务中（还有未收尾的 queued / running / awaiting_approval 任务，或战场单位仍在执行
   *     编组任务）→ 拒发 + Notice（删了会留下"任务在跑、承人没了"的孤儿单）；
   *   - 在线（该角色有在办会话 —— 对话正在跑）→ 拒发 + Notice。
   * 成功 → 角色从名册移除，同一次 setState 里一并撤下它的战场单位（不留幽灵单位）；
   * core 侧落库后由 WorldState.characters 全量广播。
   */
  | { type: 'character.delete'; characterId: string }
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
  /**
   * @since v3.6（task_115）**已接线**：HUD 侧三处皮肤入口（设置页皮肤区 / ⋯ 菜单「像素风」/
   *   底栏命令「切换到像素风」）都发这条命令。
   *   效果**由 HUD 本地消费**：hud/bridge/bus-adapter 在 dispatch 入口先落 token
   *   （hud/theme/theme-controller：切样式表 + localStorage 记忆，见 core/theme/skin-registry
   *   的 SKIN_STORAGE_KEY），再把命令发给 core；core 侧**只接地不落地**（core/runtime.ts
   *   的 case 'theme.set'）—— 皮肤是每客户端本地的展示偏好，不进 WorldState、不广播。
   */
  | { type: 'theme.set'; themeId: 'default' | 'pixel' }
  /**
   * @since v3.4（task_096）切 HUD 信息层级（三档：L1 常驻 / L2 事件 / L3 沉浸）。
   * 发出方：HUD 侧的三档开关（本任务交付的演示开关；后续任务接真实触发源 ——
   *   回放播放中 / 里程碑触发 / 导演取景 —— 同一口径）。
   * 接线：core/runtime.ts 收到本命令 → 写 WorldState.infoLayer → 广播回两侧。
   *   HUD 侧据此降 L1 对比 / 收起 L2；world 侧据此让位（导演取景框等 L3 元素）。
   * why 是命令而不是 HUD 本地态：层级要被 **world 侧订阅**，而 HUD ↔ world 零直接调用
   *   （总线铁律）—— 唯一合法通道是 core 的 state 广播。
   */
  | { type: 'hud.layer.set'; layer: InfoLayer }
  /**
   * @since v3.4（task_094）**占用 / 释放**一个演出（Z6 沉浸层的触发源）。
   * 发出方：HUD 侧的演出本体（里程碑大字组件 / 回放控制器；组合根注入命令出口）。
   * 接线：core/runtime.ts 收到本命令 → 写 WorldState.layerHolds → 重算有效档
   *   （有占用 = L3）→ 广播回两侧。HUD 侧据此降 L1 对比 / 收起 L2；world 侧据此让位。
   * why 不是直接 set 层级：三个演出可能同时在演，**谁先结束谁先放手**，但只要还有一个在演，
   *   L3 就得继续 —— 所以是「占用 / 释放」语义（core 侧计数裁决），不是「切到某档」语义。
   * 与 hud.layer.set 的分工：set 改**手动档**（演出结束后回到的那一档），hold 管**占用**。
   */
  | { type: 'hud.layer.hold'; trigger: LayerTrigger; active: boolean }
  // @since v3.1 外部 agent 会话生命周期（core/agent-link 消费，见 §2 目录职责）
  | { type: 'link.open'; kind: AgentLinkKind; endpoint: string; displayName?: string; apiKey?: string }
  | { type: 'link.resume'; linkId: string }
  | { type: 'link.reconnect'; linkId: string }
  | { type: 'link.close'; linkId: string }
  /**
   * @since v3.5 危险区：重置编组（清空当前选择集）。
   *   为什么不复用 unit.select 配空数组：重置编组是一次显式的破坏性动作，
   *   让调用方去拼一个空数组会把"清空"这个意图摊平成普通选择，审计日志里也认不出。
   *   @since v3.6（task_116）core/runtime.ts 已接线：清空选择集 + 编组槽位（同一次广播）。
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
   * @since v3.36（task_076）可选 missionId：**这条任务替哪条战场任务（mission）跑**。
   *   给出时随任务一路带到终态，app 层 task-service 据此把终态回报给那条 mission
   *   （回报链的钥匙）；缺省 = 与 mission 无关的普通派发（老行为，零影响）。
   */
  | {
      type: 'task.assign';
      characterId: string;
      prompt: string;
      targetCharacterId?: string;
      missionId?: string | null;
    }
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
  | { type: 'pipeline.start'; spec: PipelineSpec; issue: string }
  /**
   * @since v3.40（task_091）中断会话：把一条**在办**会话（active / idle）置为 interrupted。
   * 载荷口径：sessionId 命中 WorldState.sessions。
   * why 需要它：互聊超时此前是"静默丢弃"（会话没了、历史也没了）—— 中断标记让会话可见、可查，
   *   这是 S4「互聊接入会话域」要修的根因；本单（v3.2a S1）只交付纯逻辑，接线在 S3。
   * 状态机裁决：终态（closed）拒绝并回 Notice（重复收尾不改写历史）；
   *   已中断的会话再中断同样拒绝（重复标记不改写历史）。
   * session.resume（恢复续聊、上下文回灌）属 2b，见下一条。
   */
  | { type: 'session.interrupt'; sessionId: string }
  /**
   * @since v3.47（task_101 / v3.2b-B2）恢复会话：把一条**被中断**的互聊会话接回进行中，
   *   并把回灌的上文重新喂给参与者（续跑）。
   * 载荷口径：sessionId 命中 WorldState.sessions。
   * 准入（core/session 的状态机裁决）：kind=peer_chat（第一期口径，方案 §8）+ status=interrupted。
   * 落点：runtime 把命令交给注入的**恢复端口**（续跑方在 app 层 —— 互聊引擎负责把回灌的
   *   上文喂回参与者并重启轮转；core 自己不跑互聊，只做转发，与 pipeline.start 同一纪律）。
   *   端口缺席 = 命令按未落地处理（不假装恢复成功）。
   */
  | { type: 'session.resume'; sessionId: string }
  /**
   * @since v3.48（task_102 / v3.2b-B3）分叉会话：从一条会话的某个时间点**派生出一条新会话**
   *   （方案 docs/SESSION-PLAN.md §8「fork = 新会话 + 事件复制到 atSeq」）。
   * 载荷口径：sessionId 命中 WorldState.sessions；atSeq = 复制截止的事件序号（**含**该序号）。
   * why 需要它：一条会话聊岔了想"从头再来一次"时，**接着聊**（resume）不对 ——
   *   resume 只能续上被中断的那场；分叉才是"把聊到这儿为止的那段历史另起一条会话接着走"。
   * 落点：runtime 直调 core/session 的 manager.fork（纯逻辑 —— 读事件流、复制、重排、落库，
   *   与 session.interrupt 同一纪律；core 不需要 app 层引擎参与）。
   * atSeq 缺省 = 全量复制；越界由 core 夹到合法区间（越界不是错误 —— "分叉到末尾"就是全量）。
   */
  | { type: 'session.fork'; sessionId: string; atSeq?: number };

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

/**
 * 战场音效 cue 词表（@since v3.3，task_077 预留 / 声音包 v3.3-10 消费）。
 *
 * 闭集：战场在关键动作上发 cue，声音包按词表实现播放器 —— 加新词要同时改两侧。
 * 选这几个词的理由：对应 DEMO-PLAN §10 的四音（选中 ack / 派活 / 完成 / 报错），
 * 外加两个演示专用（认领翻卡、集火支援）。
 */
export type SoundCue = 'select' | 'command' | 'claim' | 'complete' | 'focus';

// ============================================================================
// ★ 总线契约：world → core 的交互事件（单向，world 不直接改 HUD）
// ============================================================================

/**
 * @since v3.3（task_082）当日回放的**节拍种类**（DEMO-PLAN §9「当日回放」）。
 *   回放器把「当天的 task_run 事件」翻译成战场可消费的一拍一拍：
 *     spawn —— 单位出现（任务开工那一刻）；
 *     work  —— 干活中（任务推进的关键节点）；
 *     done  —— 完成（插旗）；
 *     error —— 报错（卡住）；
 *     reset —— 清场（拖动时间轴时先归零再重演 —— 回放不叠在上一帧的残留上）。
 * why 独立成词表而不是复用 task.* 生命周期事件：回放是**历史重演**，
 *   它绝不能走 task.* 那条真链路（那边有 task-service 出队执行、有落库订阅者 ——
 *   重放一遍等于把当天的活又跑一遍）。所以另立一条 replay.* 通道，形状自洽、互不串味。
 */
export type ReplayBeatKind = 'reset' | 'spawn' | 'work' | 'done' | 'error';

/**
 * @since v3.3（task_082）当日回放的一拍（契约层形状）。
 *   发出方是 HUD 侧的回放控制器（它读当天的 task_run 事件流，按时间轴重演）；
 *   消费者是世界场景（bridge 转发 syncReplayBeat → objects/replay-layer 画回放化身）。
 *   载荷只携「谁 / 做了什么 / 什么时候」—— 不雪球整条任务全文（回放要的是节奏，不是档案）。
 */
export interface ReplayBeat {
  /** 这一拍对应的**真实时刻**（ms）—— 时间轴角标与热力条都按它定位。 */
  readonly at: number;
  /** 这一拍是什么（见 ReplayBeatKind）。 */
  readonly kind: ReplayBeatKind;
  /** 执行角色 id（reset 之外都有）。 */
  readonly characterId?: string;
  /** 关联任务 id（reset 之外都有）。 */
  readonly taskId?: string;
  /** 短句（步骤标签 / 任务摘要截断）—— 供跑马灯与气泡取用。 */
  readonly label?: string;
}

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
   * @since v3.33 小地图跳转（task_057）：HudCommand camera.center 经 core 钳制后的**转发形态**
   *   （同名不同向，与 unit.move 同一先例 —— 命令是 hud → core 的意向，这条是 core → world
   *   的落位指令）。消费者是世界场景（bridge 转发到 syncCameraCenter，把相机对中到该点）；
   *   core 状态机不消费 —— 坐标真相在世界层，core 只做钳制与转交（runtime 接地）。
   */
  | { type: 'camera.center'; x: number; y: number }
  /**
   * @since v3.3 镜头震动（task_080）：HudCommand camera.shake 经 core 钳制后的**转发形态**
   *   （同名不同向，与 camera.center 同一先例 —— 命令是 hud → core 的意向，这条是 core → world
   *   的落位指令）。消费者是世界场景（bridge 转发 syncCameraShake → Phaser 相机 shake）。
   *   core 状态机不消费 —— 震动是瞬态表现，不写 WorldState；runtime 的 handleWorldEvent
   *   显式接地（同 camera.center 惯例，不进 onUnhandled）。
   */
  | { type: 'camera.shake'; durationMs: number; intensity: number }
  /**
   * @since v3.3（task_081）导演模式开关（DEMO-PLAN §7）。
   *   发出方是 HUD 顶栏的「🎬 导演」按钮；core 收到后写 WorldState.directorEnabled
   *   （HUD 按钮据此回显）并以**同名 WorldEvent** 转发到 world 通道
   *   （消费者是世界场景的导演控制器 —— 它自动订阅任务事件、编排镜头）。
   *   HUD 绝不直接调 world（铁律）—— 与 camera.center / camera.shake 同一两段式。
   *   反向也用这一条：world 侧检测到**手动介入**时发本事件（enabled=false），
   *   core 据此把开关写回 false 并广播 —— 手动优先，导演让位（DEMO-PLAN §7「手动优先」）。
   */
  | { type: 'camera.director'; enabled: boolean }
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
  | { type: 'pipeline.failed'; pipelineId: string; pipelineName: string; reason: string }
  /**
   * @since v3.30（task_054）agent 恢复在线事件 —— 发出方是 app 层 health-monitor（探测防抖
   *   判定恢复：连续失败计数被一次成功清零），与 exp.gained / level.up 同一先例：app 发、
   *   走 world 通道广播。载荷只携 kind（AgentKind 词表）；哪些角色 / 单位受影响由订阅方按
   *   characters.agentKind / units.characterId 自行对账 —— 事件不雪球 id 列表（同 kind 多角色
   *   是常态，事件面不随角色数膨胀）。
   * 消费者：runtime 的 handleWorldEvent 显式接地（把该 kind 名下单位的 online 位写回 true，
   *   见 applyAgentConnectivity）；组合根接 toast（恢复提示，成功 tone）。core 状态机在
   *   接地之外不另消费 —— 与 unit.position / task.* 同一「显式接地、不进 onUnhandled」惯例。
   */
  | { type: 'agent.online'; kind: AgentKind }
  /**
   * @since v3.30（task_054）agent 掉线事件 —— 发出方同上（连续 2 轮探测失败才发，防抖
   *   口径见 health-monitor 的 HEALTH_OFFLINE_FAILURE_THRESHOLD；单次失败是噪音，不广播）。
   *   runtime 接地后该 kind 名下单位 online=false → 灰显 + 「离线」徽标 + 入口拦截；
   *   派任务 / 对话的守门在 app 层 service 入口按 WorldState.units 的 online 位裁决（035
   *   守门只看「在档」，这里升级为「在档且在线」）。掉线不落任务失败 —— 在跑的任务由
   *   transport 的 exit 异常路径自行收尾（error 事件），健康事件只是旁路审计。
   */
  | { type: 'agent.offline'; kind: AgentKind }
  /**
   * @since v3.37 单位说话状态（task_062，战场生命感·说话气泡）：chat 流式期间该单位
   *   「正在说话」的纯标志位广播。发出方是 app 层 chat-service（035 的流式回路起点/收尾
   *   各发一次：runRound 起手 speaking=true，finally speaking=false —— 角色没上战场则不发），
   *   与 exp.gained / task.* 同一先例：app 发、走 world 通道。消费者是世界场景
   *   （bridge 转发 syncUnitSpeaking → unit-layer 头顶「…」脉动气泡）；core 状态机不消费
   *   （说话是瞬态表现，不写 WorldState）—— runtime 的 handleWorldEvent 显式接地
   *   （同 unit.position 惯例，不进 onUnhandled）。
   * why 不让 hud 直接驱动 world：铁律 hud 不认识 world（两侧只在 core/bus 汇合），
   *   抽屉的流式状态只能经 app 层翻译成世界事件落地 —— 本事件就是那条翻译通道。
   * payload 只携单位 id 与布尔位（不雪球文本 —— 气泡只表达「正在说话」语义，task_062
   *   规格明确选最简：三点脉动，不截流式文本）。
   */
  | { type: 'unit.speaking'; unitId: string; speaking: boolean }
  /**
   * @since v3.3（task_077）单位气泡事件：战场侧要求某个单位冒一句话。
   *   发出方是 world 层（下达指令 / 集火支援时，DEMO-PLAN §4「单位统一冒『收到』类气泡」）。
   *   消费者是**气泡系统**（task_076，world/speech-templates.ts 的句库 + 渲染层）——
   *   气泡系统尚未合入，故本任务只发事件不自己画（接线位见 world/objects/task-fx-layer.ts）。
   *   core 状态机不消费（气泡是瞬态表现，不写 WorldState）—— runtime 的 handleWorldEvent
   *   显式接地（同 unit.speaking 惯例，不进 onUnhandled）。
   *   payload 只携单位 id 与一句短文本（不雪球句库 id —— 句库归气泡系统所有）。
   */
  | { type: 'unit.bubble'; unitId: string; text: string }
  /**
   * @since v3.4（task_091）单位联动事件 —— HudCommand `focus.unit` 经 core 转发的**同名事件**
   *   （与 camera.center / camera.shake / camera.director 的两段式同一口径：命令是 hud → core
   *   的意向，事件是 core → world 的落位指令；同名不同向）。
   *   消费者是**世界层**（task_092：被点单位描边高亮 + 左下条目到中屏单位的引导弧线）。
   *   core 状态机不消费（不写 WorldState —— 联动是瞬态表现，与 camera.shake 同口径）——
   *   runtime 的 handleWorldEvent 显式接地（同 unit.bubble 惯例，不进 onUnhandled）。
   *   payload 只携单位 id（不雪球坐标 —— 弧线由 world 侧按自己的相机状态换算，
   *   core / hud 都不知道屏幕坐标）。
   */
  | { type: 'focus.unit'; unitId: string }
  /**
   * @since v3.3（task_077）音效钩子事件（**预留**）：战场在关键动作上发一声 cue，
   *   声音包（v3.3-10 / DEMO-PLAN §10「Web Audio 代码合成」）据此发声。
   *   本任务**只发事件、不做音频**（零音频资产是 DEMO-PLAN §0 的硬约束）。
   *   core 状态机不消费（音效不进 WorldState）—— runtime 的 handleWorldEvent 显式接地。
   *   cue 词表是**闭集**：声音包按词表实现播放器，加新词要同时改两侧。
   */
  | { type: 'fx.sound'; cue: SoundCue }
  /**
   * @since v3.3（task_082）当日回放节拍（DEMO-PLAN §9）。
   *   发出方是 HUD 侧的回放控制器（读当天的 task_run 事件流 → 按时间轴重演）；
   *   消费者是世界场景（bridge 转发 syncReplayBeat → objects/replay-layer 画回放化身：
   *   单位出现 / 干活 / 插旗）。
   *   core 状态机不消费（回放是**历史重演**，既不写 WorldState 也不触发任何业务 ——
   *   绝不能走 task.* 那条真链路：那边有 task-service 出队执行与落库订阅者）——
   *   runtime 的 handleWorldEvent 显式接地（同 unit.bubble 惯例，不进 onUnhandled）。
   *   why 走 world 通道而不是新开第四条通道：通道即铁律，事件通道是现成的域事件广播面，
   *   与 unit.bubble（同样是纯表现事件）同一先例。
   */
  | { type: 'replay.beat'; beat: ReplayBeat };