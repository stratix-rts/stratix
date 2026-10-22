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
   * @since v3.7 新建角色档案（首启引导的落地动作：起名 → 选 agent → 选皮肤 → 写人设）。
   * 载荷口径：
   *   - name：trim 后非空、≤ MAX_CHARACTER_NAME_LEN（24 码点）；
   *   - agentKind：必须是词表内的种类（AGENT_KINDS），不认识的一律拒发；
   *   - skinId：皮肤资源键，**由调用方传入**（引导屏负责随机 / 换肤；core 不猜）；
   *   - persona：缺省或空串 → 套默认模板（**不拒发**：引导流程允许"先起名、回头再调人设"）。
   * 重复同名 → 拒发 + 错误 Notice（状态不变）；core 侧落库后由 WorldState.characters 全量广播。
   */
  | { type: 'character.create'; name: string; agentKind: AgentKind; skinId: string; persona?: string }
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
  | { type: 'cache.clear' };

// ============================================================================
// ★ 总线契约：world → core 的交互事件（单向，world 不直接改 HUD）
// ============================================================================

export type WorldEvent =
  | { type: 'unit.click'; unitId: string; mods: ClickMods }
  | { type: 'selection.box'; bounds: Bounds }
  | { type: 'camera.moved'; center: Point; zoom: number };