/**
 * 文件职责：Agent 侧栏的**视图模型派生与命令构造**（纯逻辑，零 DOM、零依赖）——
 *   把旧 AgentPanel（英雄列表：状态分组 / 单选详情）+ AgentPowerPanel（能力评估：战力分档 + 六维）
 *   合并成一份 WorldState → AgentPanelModel 的派生，UI 呈现全部在 agent-panel.ts。
 *   来源：docs/REFACTOR_PLAN_V3.md §2 panels/ 层级；语义提取自 src/components/AgentPanel.vue
 *   与 src/components/AgentPowerPanel.vue（只提取语义，未复制任何实现）。
 * 输入：WorldState（units / selection / characters / missions）。
 * 输出：AgentPanelModel（渲染用）与 HudCommand（派发用）。
 * 禁止事项：
 *   1. 触碰 DOM —— 本文件必须能在 node 环境单测，渲染是 agent-panel.ts 的事；
 *   2. import world/、vue、@/stratix-rts —— 铁律。**尤其不复刻 CombatPowerCalculator**：
 *      旧 AgentPowerPanel 的维度阈值/分档若在 hud 再写一份，core 与 hud 必然漂移，
 *      所以能力数据只从 UnitView.capabilities 读（core 计算，@since v3.2）；
 *   3. 直接调 core/bus —— 本文件只**构造**命令，派发一律由调用方经 adapter 完成；
 *   4. 在本地维护选择集 —— 侧栏形态（空/单选/编组）完全由 WorldState.selection 决定，
 *      面板自己一个"当前选中 id"都不存；判断权与真相都在 core；
 *   5. 造数据 —— 单位名、能力、成长数值全部来自 WorldState，没有就显示"未评估/未关联"，不填假值。
 *
 * 旧能力未迁移的部分（与 command-catalog 同一取舍口径）：
 *   - 新建/删除 Agent、刷新列表、搜索过滤：契约里没有对应 HudCommand，且 v3 的真相由 core
 *     单向广播、面板没有"主动拉取"这个动作，硬做就得在 hud 里私藏一份名单，故不迁移；
 *   - 摄像头详情/雷达图/榜单排序：旧 AgentPowerPanel 本来就是 mock 数据驱动，
 *     契约里没有 ranking 概念（编组列表的顺序是 core 的选择顺序，不在 hud 侧重排）。
 *
 * @since v3.17（task_038）追加：角色任务队列可见性 —— WorldState.tasks → 当前任务摘要（40 字截断）
 *   + 排队数，以及派发表单的命令构造 buildTaskAssignCommand（表单 UI 在 agent-panel.ts）。
 * @since v3.23（task_047）队列读数升级**完整列表**：每条任务（在办全显 + 最近终态）带
 *   状态徽标 / 摘要 / 取消按钮（仅 queued）/ 重派按钮（仅 failed），以及 task.cancel 的
 *   命令构造 buildTaskCancelCommand。重派 = buildTaskAssignCommand(同 prompt) 派一条新任务，
 *   不复用旧任务 id（037 起的纪律：失败不自动重试，重派是用户显式动作的新任务）。
 */

import {
  CAPABILITY_DIMENSIONS,
  type CapabilityDimension,
  type CharacterTask,
  type HudCommand,
  type MissionPhase,
  type MissionView,
  type TaskStatus,
  type UnitCapabilitiesView,
  type UnitStatus,
  type UnitView,
  type WorldState,
} from '../../core/types';

/** 侧栏的三种形态。判定输入只有 WorldState.selection.unitIds.length，面板本地不留副本。 */
export type AgentPanelMode = 'empty' | 'single' | 'group';

/** 侧栏用户动作。三条动作各自映射到一条 HudCommand（映射表见 buildAgentCommand）。 */
export type AgentPanelAction = 'inspect' | 'focus' | 'remove';

/**
 * 编组形态下最多渲染多少行（perf 硬约束：选择集契约上限 MAX_SELECTION_SIZE=256，
 *   200+ 行的侧栏既挤爆视口也让每次重绘变贵）。超出的只计数不渲染，并明确告诉用户还剩多少。
 */
export const MAX_VISIBLE_GROUP_ROWS = 50;

/**
 * 任务队列摘要的展示截断长度（task_038 规格：40 字）。
 * 与 core 的 MAX_TASK_SUMMARY_LEN（广播摘要 2000 字）不是一回事：这是卡片上的一行读数，
 * 不是数据上限 —— 全文与完整摘要都在状态/库里，截断只发生在渲染前。
 */
export const TASK_SUMMARY_DISPLAY_LEN = 40;

// ============================================================================
// 词表（契约取值 → 中文标签；改这里即可改文案，不牵连组件）
// ============================================================================

/** UnitStatus 的中文标签。取契约的四态，不引入旧面板的 'online'（契约没有这个值，见 types.ts）。 */
const STATUS_LABELS: Record<UnitStatus, string> = {
  idle: '空闲',
  busy: '忙碌',
  offline: '离线',
  error: '异常',
};

/** 状态 → 渲染用的语义色槽。组件据此挑 --srf-* 变量，色值本身不落在这里。 */
const STATUS_TONES: Record<UnitStatus, 'idle' | 'busy' | 'offline' | 'error'> = {
  idle: 'idle',
  busy: 'busy',
  offline: 'offline',
  error: 'error',
};

const MISSION_PHASE_LABELS: Record<MissionPhase, string> = {
  draft: '草稿',
  pending: '待确认',
  confirmed: '已接收',
  running: '进行中',
  done: '已完成',
  cancelled: '已取消',
};

/** 能力维度键 → 中文标签。键集合冻结在契约 CAPABILITY_DIMENSIONS，顺序即渲染顺序。 */
const CAPABILITY_LABELS: Record<CapabilityDimension, string> = {
  offense: '攻击',
  defense: '防御',
  mobility: '机动',
  magic: '魔法',
  survivability: '生存',
  utility: '辅助',
};

// ============================================================================
// 视图模型
// ============================================================================

/** 一条能力维度（渲染成一条进度条：标签 + 0–100 数值）。 */
export interface CapabilityBar {
  readonly key: CapabilityDimension;
  readonly label: string;
  readonly value: number;
}

export interface CapabilityModel {
  readonly overall: number;
  /** 分档名由 core 按阈值给出（旧面板的「优秀/精英/传说」语义），hud 不自算。 */
  readonly level: string;
  readonly bars: readonly CapabilityBar[];
}

export interface MissionRef {
  readonly id: string;
  readonly title: string;
  readonly phase: MissionPhase;
  readonly phaseLabel: string;
}

export interface GrowthModel {
  readonly characterId: string;
  readonly name: string;
  readonly level: number;
  readonly experience: number;
}

/**
 * 队列列表里最多显示多少条终态历史（@since v3.23，task_047）。
 * why 限三条：在办任务全量显示（排队纪律可见性是本任务的意义），但终态是历史 ——
 * 全画会把卡片撑成长列表（上限 MAX_TASKS=100）；三条足够覆盖「看一眼最近结果 /
 * 找到失败任务点重派」，更早的在 SQLite 审计里。
 */
export const MAX_VISIBLE_SETTLED_TASKS = 3;

/** 任务相位 → 列表徽标文案（词表即契约，与 task-output-catalog 的徽标口径同源不同表）。 */
export const TASK_STATUS_LABELS: Readonly<Record<TaskStatus, string>> = {
  queued: '排队中',
  running: '执行中',
  awaiting_approval: '待审批', // @since v3.25（task_049）：计划挂起，等用户裁决
  completed: '已完成',
  failed: '已失败',
  cancelled: '已取消',
};

/**
 * 队列列表的一条（@since v3.23，task_047）。prompt 保留**全文**（重派载荷 —— 截断后的
 * 摘要不该成为新任务的指令）；summary 是渲染用截断。
 */
export interface TaskQueueItemModel {
  readonly id: string;
  /** 渲染用摘要（40 字截断）。 */
  readonly summary: string;
  /** 完整指令原文（重派时作为 task.assign 的 payload）。 */
  readonly prompt: string;
  readonly status: TaskStatus;
  readonly statusLabel: string;
  /** 仅 queued：排队取消（running 不强杀，取消按钮不渲染）。 */
  readonly canCancel: boolean;
  /** 仅 failed：重派入口（同 prompt 派新任务）。 */
  readonly canReassign: boolean;
}

/**
 * 角色任务队列的卡片读数（@since v3.17，task_038）。
 * summary = 当前任务（running 优先，否则 FIFO 队首的 queued）的指令摘要（40 字截断）；
 * waiting = 除当前任务外在排队的条数（如「+2」）。两者都是**读数**，不是任务真相。
 * @since v3.23（task_047）追加 items：完整列表（在办在前按 FIFO 序，终态在后按时间倒序
 * 取最近 MAX_VISIBLE_SETTLED_TASKS 条）—— 取消 / 重派按钮的条件渲染挂在条目上。
 */
export interface CharacterTaskQueueModel {
  readonly summary: string | null;
  readonly waiting: number;
  readonly items: readonly TaskQueueItemModel[];
}

/** 单选形态的详情模型。 */
export interface UnitDetailModel {
  readonly id: string;
  readonly name: string;
  readonly statusLabel: string;
  readonly statusTone: 'idle' | 'busy' | 'offline' | 'error';
  readonly power: number;
  readonly mission: MissionRef | null;
  readonly capabilities: CapabilityModel | null;
  readonly growth: GrowthModel | null;
  /** 关联角色 id（@since v3.17，task_038）：没有角色的单位没有任务队列，也不给派任务入口。 */
  readonly characterId: string | null;
  /** 角色任务队列读数（@since v3.17，task_038）；未关联角色 = 空读数。 */
  readonly taskQueue: CharacterTaskQueueModel;
  /**
   * 计划审批卡读数（@since v3.25，task_049）：该角色有 awaiting_approval 任务时非空 ——
   * 计划全文 + 批准 / 驳回两个动作的载荷。纯读数：按钮的可用性由相位唯一决定
   *（只有 awaiting 才渲染这张卡），不做本地可点 / 禁用态 —— 裁决在 core 状态机。
   */
  readonly approval: TaskApprovalModel | null;
}

/**
 * 计划审批卡读数（@since v3.25，task_049）：plan-first 任务的审批入口。
 * plan = 计划全文（core 已截断到 MAX_TASK_PLAN_LEN；标记行已在 app 层剥离）；
 * summary = 40 字截断（卡片头的「这条任务要干什么」）。全文展示（白空间换可读性）——
 * 计划就是要逐条核对的，折叠它就失去了审批的意义。
 */
export interface TaskApprovalModel {
  readonly taskId: string;
  readonly characterId: string;
  /** 计划全文（渲染层 pre-wrap，不二次截断）。 */
  readonly plan: string;
  /** 任务指令摘要（卡片头：这份计划对应哪条任务）。 */
  readonly summary: string;
}

/** 编组形态的一行。字段是详情的子集 —— 行内空间小，只放能一眼扫完的读数。 */
export interface UnitRowModel {
  readonly id: string;
  readonly name: string;
  readonly statusLabel: string;
  readonly statusTone: 'idle' | 'busy' | 'offline' | 'error';
  readonly power: number;
  readonly missionTitle: string | null;
}

export interface AgentPanelModel {
  readonly mode: AgentPanelMode;
  /** 抬头文案：说清此刻侧栏在看谁（单选=名字，编组="已选中 N 个"，空=提示语）。 */
  readonly summary: string;
  readonly detail: UnitDetailModel | null;
  readonly rows: readonly UnitRowModel[];
  /** 编组形态下未渲染的选中单位数（>0 才渲染"还有 N 个"提示，避免假装列全了）。 */
  readonly overflow: number;
}

// ============================================================================
// 派生小工具
// ============================================================================

/** 按 id 建索引：选择集每变一次就要查每个选中单位，重复遍历 units 是白烧 CPU。 */
function indexUnits(state: WorldState): Map<string, UnitView> {
  return new Map(state.units.map((u) => [u.id, u] as const));
}

/** 单位当前承担的任务（按 id 精确匹配；找不到即 null，不猜）。 */
function findMission(state: WorldState, missionId: string | null): MissionView | null {
  if (!missionId) return null;
  return state.missions.find((m) => m.id === missionId) ?? null;
}

/** 单位关联的角色成长数值（@since v3.2 的 characterId 关联；未关联即 null）。 */
function resolveGrowth(state: WorldState, unit: UnitView): GrowthModel | null {
  const characterId = unit.characterId;
  if (!characterId) return null;
  const character = state.characters.find((c) => c.id === characterId);
  if (!character) return null;
  return {
    characterId: character.id,
    name: character.name,
    level: character.level,
    experience: character.experience,
  };
}

/**
 * 能力面板投影。core 给 overall + 分档 + 六维；hud 只补维度中文标签并把数值夹到 0–100
 * （防止 core 侧一次算错就把进度条撑破布局——渲染层兜底不改变真相）。
 * capabilities 缺省或维度全缺 → null（渲染成「未评估」，不拿 power 冒充六维）。
 */
function resolveCapabilities(capabilities: UnitCapabilitiesView | null | undefined): CapabilityModel | null {
  if (!capabilities) return null;
  const dims = capabilities.dimensions;
  if (!dims) return null;
  const clamp = (n: number): number => Math.min(100, Math.max(0, Math.round(n)));
  return {
    overall: clamp(capabilities.overall),
    level: capabilities.level,
    bars: CAPABILITY_DIMENSIONS.map((key) => ({
      key,
      label: CAPABILITY_LABELS[key],
      value: clamp(dims[key] ?? 0),
    })),
  };
}

/** 单选详情模型。id 在 units 里查不到（已销毁但选择集尚未对账）时仍返回模型，名字退化成 id。 */
function toDetail(state: WorldState, unit: UnitView): UnitDetailModel {
  const mission = findMission(state, unit.missionId);
  const characterId = unit.characterId ?? null;
  return {
    id: unit.id,
    name: unit.name || unit.id,
    statusLabel: STATUS_LABELS[unit.status],
    statusTone: STATUS_TONES[unit.status],
    power: unit.power,
    mission: mission
      ? {
          id: mission.id,
          title: mission.title,
          phase: mission.phase,
          phaseLabel: MISSION_PHASE_LABELS[mission.phase],
        }
      : null,
    capabilities: resolveCapabilities(unit.capabilities),
    growth: resolveGrowth(state, unit),
    characterId,
    taskQueue: characterId ? resolveCharacterTaskQueue(state.tasks, characterId) : EMPTY_TASK_QUEUE,
    approval: characterId ? resolveTaskApproval(state.tasks, characterId) : null,
  };
}

function toRow(state: WorldState, unit: UnitView): UnitRowModel {
  return {
    id: unit.id,
    name: unit.name || unit.id,
    statusLabel: STATUS_LABELS[unit.status],
    statusTone: STATUS_TONES[unit.status],
    power: unit.power,
    missionTitle: findMission(state, unit.missionId)?.title ?? null,
  };
}

// ============================================================================
// 角色任务队列（@since v3.17，task_038）
// ============================================================================

/**
 * 指令摘要的展示截断：trim 后 ≤ maxLen 原样返回，超长载 maxLen 字 + 省略号。
 * 导出供单测与渲染层共用（别在两侧各写一份截断）。
 */
export function truncateTaskSummary(prompt: string, maxLen: number = TASK_SUMMARY_DISPLAY_LEN): string {
  const trimmed = prompt.trim();
  return trimmed.length <= maxLen ? trimmed : `${trimmed.slice(0, maxLen)}…`;
}

/**
 * 在办任务（queued / running / @since v3.25 awaiting_approval）。终态（completed / failed /
 * cancelled）不进队列读数 —— 它们是历史，不是排队。awaiting 算在办：门还开着，任务没走完。
 */
function isActiveTask(task: CharacterTask): boolean {
  return task.status === 'queued' || task.status === 'running' || task.status === 'awaiting_approval';
}

/**
 * 审批卡读数（task_049）：该角色第一条 awaiting_approval 任务。同一角色同一时刻至多一条
 *（app 层审批门占位 —— 挂起期间 busy 不释放，不会再出下一条跑到这里），find 首条即是全部。
 * 没有 awaiting 任务 = null（卡片不渲染）。
 */
export function resolveTaskApproval(
  tasks: readonly CharacterTask[] | undefined,
  characterId: string
): TaskApprovalModel | null {
  const awaiting = (tasks ?? []).find(
    (task) => task.characterId === characterId && task.status === 'awaiting_approval'
  );
  if (!awaiting) return null;
  return {
    taskId: awaiting.id,
    characterId,
    plan: awaiting.plan ?? '',
    summary: truncateTaskSummary(awaiting.prompt),
  };
}

/** CharacterTask → 列表条目（纯投影：词表标签 + 按钮条件 + 摘要截断）。 */
function toTaskItem(task: CharacterTask): TaskQueueItemModel {
  return {
    id: task.id,
    summary: truncateTaskSummary(task.prompt),
    prompt: task.prompt,
    status: task.status,
    statusLabel: TASK_STATUS_LABELS[task.status],
    canCancel: task.status === 'queued',
    canReassign: task.status === 'failed',
  };
}

/**
 * WorldState.tasks → 某角色的队列读数 + 完整列表。纯函数。
 * 当前任务取 running（有正在跑的优先），否则取队首 queued（FIFO 语义与 app 层 task-service 一致）；
 * items：在办全显（数组序即 FIFO 序），终态按时间倒序取最近 MAX_VISIBLE_SETTLED_TASKS 条
 *   （新的在前 —— 用户最关心刚收尾的那条：失败要重派、完成看结果）。
 * tasks 缺省 / 没有任何任务 → 空读数（卡片显示空闲，不编造）。
 */
export function resolveCharacterTaskQueue(
  tasks: readonly CharacterTask[] | undefined,
  characterId: string
): CharacterTaskQueueModel {
  const own = (tasks ?? []).filter((task) => task.characterId === characterId);
  const active = own.filter(isActiveTask);
  const current = active.find((task) => task.status === 'running') ?? active[0];
  const settled = own
    .filter((task) => !isActiveTask(task))
    .slice(-MAX_VISIBLE_SETTLED_TASKS)
    .reverse();
  return {
    summary: current ? truncateTaskSummary(current.prompt) : null,
    waiting: current ? active.length - 1 : 0,
    items: [...active, ...settled].map(toTaskItem),
  };
}

const EMPTY_TASK_QUEUE: CharacterTaskQueueModel = { summary: null, waiting: 0, items: [] };

// ============================================================================
// WorldState → 视图模型
// ============================================================================

/**
 * 由 WorldState 派生侧栏模型。纯函数：同样的 state 必然得到同样的 model（便于单测断言与排查）。
 *
 * 形态判定只看 selection.unitIds.length：
 *   0 → empty（引导用户在战场上点选）；1 → single（详情 + 能力 + 成长）；
 *   ≥2 → group（编组列表，行内出 聚焦 / 移出编组）。
 * 面板不持有任何选择态 —— 一切以 core 广播为准（与 command-panel 的纪律一致）。
 */
export function resolveAgentPanel(state: WorldState | null): AgentPanelModel {
  if (!state) {
    return { mode: 'empty', summary: '等待世界状态…', detail: null, rows: [], overflow: 0 };
  }
  const selectedIds = state.selection.unitIds;
  if (selectedIds.length === 0) {
    return { mode: 'empty', summary: '未选中单位', detail: null, rows: [], overflow: 0 };
  }

  const byId = indexUnits(state);

  if (selectedIds.length === 1) {
    const id = selectedIds[0];
    const unit = byId.get(id);
    const detail = unit ? toDetail(state, unit) : toDetail(state, missingUnit(id));
    return { mode: 'single', summary: detail.name, detail, rows: [], overflow: 0 };
  }

  // 编组：按 core 给出的选择顺序渲染（框选的视觉顺序），不重排 —— 排序权不在 hud。
  const all = selectedIds.map((id) => toRow(state, byId.get(id) ?? missingUnit(id)));
  const rows = all.slice(0, MAX_VISIBLE_GROUP_ROWS);
  return {
    mode: 'group',
    summary: `已选中 ${selectedIds.length} 个单位`,
    detail: null,
    rows,
    overflow: all.length - rows.length,
  };
}

/** 选择集里有、units 里已经没有的悬空 id（core 尚未对账时的瞬态）。 */
function missingUnit(id: string): UnitView {
  return { id, name: '', status: 'offline', missionId: null, power: 0 };
}

// ============================================================================
// 命令构造（派发前的唯一出口）
// ============================================================================

/**
 * 三条侧栏动作 → HudCommand 的唯一映射表。
 *
 *  - inspect（查看详情）→ `unit.select` mode='set'：**不新造命令**。点某一行就是把它设为唯一选中，
 *    core 广播回来后侧栏自然切成单选详情形态。刻意不在面板里存一个"正在看的 id"——
 *    那会让侧栏拥有一份与 core 不同步的选择真相（双真相必然漂移）。
 *  - focus（聚焦）→ `unit.focus`：相机动作，与选择无关（聚焦一个单位不该顺手改编组），
 *    契约里没有相机命令，@since v3.2 单开一条，core 转发给 world 层。
 *  - remove（移出编组）→ `unit.select` mode='toggle'：命中则移出，与 core 选择状态机同名同义。
 *
 * 返回 null 只在 unitId 为空时发生（渲染层不该产生空 id，兜底不发比发一条空命令安全）。
 */
export function buildAgentCommand(action: AgentPanelAction, unitId: string): HudCommand | null {
  if (!unitId) return null;
  switch (action) {
    case 'inspect':
      return { type: 'unit.select', unitIds: [unitId], mode: 'set' };
    case 'focus':
      return { type: 'unit.focus', unitId };
    case 'remove':
      return { type: 'unit.select', unitIds: [unitId], mode: 'toggle' };
  }
}

/**
 * 派发表单提交 → task.assign 命令（@since v3.17，task_038）。
 * 返回 null = 不发：没关联角色 / 指令 trim 后为空（core 侧也会拒，但空命令不值得一次广播）。
 * 长度上限由 core 守门（MAX_TASK_PROMPT_LEN）—— 表单的 maxlength 已挡住越界输入，
 * 这里不重复判，免得两侧阈值漂移。
 */
export function buildTaskAssignCommand(
  characterId: string | null | undefined,
  prompt: string
): HudCommand | null {
  if (!characterId) return null;
  const trimmed = prompt.trim();
  if (trimmed.length === 0) return null;
  return { type: 'task.assign', characterId, prompt: trimmed };
}

/**
 * 排队取消 → task.cancel 命令（@since v3.23，task_047）。
 * 返回 null = 不发：空 taskId（渲染层不该产生，兑底不发比发一条空命令安全）。
 * 相位裁决在 core 状态机（仅 queued 生效）；取消按钮只对 queued 条目渲染，正常路径
 * 不需要处理拒绝 —— 真被拒（状态恰好刚变）时 core 发 Notice 提示，UI 无需额外分支。
 */
export function buildTaskCancelCommand(taskId: string | null | undefined): HudCommand | null {
  if (!taskId) return null;
  return { type: 'task.cancel', taskId };
}

/**
 * 计划批准 / 驳回 → task.approve / task.reject 命令（@since v3.25，task_049）。
 * 返回 null = 不发：空 taskId（渲染层不该产生，兑底不发比发一条空命令安全）。
 * 相位裁决在 core 状态机（仅 awaiting_approval 生效）；按钮只在审批卡上渲染
 *（卡本身只对 awaiting 任务出现），真被拒（时序竞争）时 core 发 Notice，UI 无需额外分支。
 */
export function buildTaskApproveCommand(taskId: string | null | undefined): HudCommand | null {
  if (!taskId) return null;
  return { type: 'task.approve', taskId };
}

export function buildTaskRejectCommand(taskId: string | null | undefined): HudCommand | null {
  if (!taskId) return null;
  return { type: 'task.reject', taskId };
}

// ============================================================================
// 渲染签名（perf：WorldState 高频广播，侧栏只渲染真正变了的那次）
// ============================================================================

/**
 * 由 WorldState 算出渲染签名；签名不变即跳过重渲染。
 * why：core 每次状态变更都全量广播（框选拖拽时的高频 preview 也在其中），侧栏不能跟着无脑重建 DOM。
 *   侧栏的全部输入就是**选中那几个单位**的可见读数（名字/状态/战力/任务/能力/成长）+ 选择集 revision，
 *   没被选中的单位怎么变都与侧栏无关，故不进签名 —— 这让签名代价 O(min(选中数, 256)) 而不是 O(units)。
 */
export function agentPanelSignature(state: WorldState | null): string {
  if (!state) return 'none';
  const byId = indexUnits(state);
  const parts: string[] = [String(state.selection.revision)];

  for (const id of state.selection.unitIds) {
    const unit = byId.get(id);
    if (!unit) {
      parts.push(`${id}:-`);
      continue;
    }
    const mission = findMission(state, unit.missionId);
    const growth = resolveGrowth(state, unit);
    const caps = unit.capabilities;
    const capSig = caps ? `${caps.overall}/${caps.level}/${CAPABILITY_DIMENSIONS.map((k) => caps.dimensions[k] ?? 0).join('.')}` : '-';
    // @since v3.17（task_038）：队列读数进签名 —— 任务相位变了（排队/开工/收尾）卡片必须重画，
    // 没被选中的单位任务怎么变都与侧栏无关，不进签名（与下方读数同一取舍）。
    // @since v3.23（task_047）：列表条目（id:status）进签名 —— 取消/重派后的相位变化必须重画
    // 列表（summary+waiting 可能不变：如队首取消后 waiting-1 但新队首摘要不同；条目才是全集）。
    const queue = unit.characterId ? resolveCharacterTaskQueue(state.tasks, unit.characterId) : null;
    const queueSig = queue
      ? `${queue.summary ?? '-'}+${queue.waiting}#${queue.items.map((item) => `${item.id}:${item.status}`).join('.')}`
      : '-';
    parts.push(
      [
        id,
        unit.name,
        unit.status,
        unit.power,
        mission ? `${mission.id}:${mission.phase}:${mission.title}` : '-',
        capSig,
        growth ? `${growth.characterId}:${growth.name}:${growth.level}:${growth.experience}` : '-',
        queueSig,
      ].join(':')
    );
  }
  return parts.join('|');
}