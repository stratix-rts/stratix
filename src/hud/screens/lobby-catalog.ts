/**
 * 文件职责：**大厅卡片网格的视图模型派生**（纯逻辑，零 DOM、零 IO）—— 把一份 WorldState 派生成
 *   「副本卡片列表 + 空态 + 派单入口的可用性」，UI 呈现全在 lobby-panel.ts。
 *   方案来源：docs/DESIGN-project-map.md §7.1「M1-14」行（验收三点）+ §2.4（默认沙盒口径）。
 * 输入：WorldState 快照（只读）+ 观测量（当前时刻，用于「最近进入」的相对时间）。
 * 输出：LobbyPanelModel（渲染用模型）与 lobbyPanelSignature（渲染判重签名）。
 * 禁止事项：
 *   1. 触碰 DOM —— 本文件必须能在 node 环境单测，渲染是 lobby-panel.ts 的事；
 *   2. import world / app / core-bus —— 铁律：HUD 一律经注入的 adapter 收发，core 只碰契约与纯函数；
 *   3. 编造事实 —— 契约里没有的量一律显示「未知 / 从未进入」，不猜不填
 *      （分支未知 ≠ 「main」；没进过 ≠ 「刚刚」）；
 *   4. 修改 WorldState —— 本文件对 state 只读。
 *
 * ★ 六条口径（每个字段凭什么这么算，写在这里免得后来者重新猜一套）：
 *   - **名字** = 注册表的展示标题 → 路径尾段 → 实例 id（core/project/instance-display.ts 单一出处）。
 *   - **路径尾段** = 绝对路径的最后一段（兼容 windows 分隔符）—— 整条路径放不下，也没信息量。
 *   - **分支** = 实例的运行态 VCS 事实（`vcs.branch`）；**缺省 = 未知**，不猜（读方缺省时按未知处理）。
 *   - **实例级状态** = active（它正是 `activeInstanceId`）/ idle / missing（路径没了）。
 *     why 实例级不读项目级：同一个逻辑项目的主仓与 worktree 可以停在**不同分支**、
 *     一份在跑一份没跑 —— 状态是**物理副本**的事（design §1.1 不变量 2、§2.4）。
 *   - **最近进入** = 实例的 `lastOpenedAt`（epoch ms）；0 = 从未进入 ⇒ 如实说「从未进入」。
 *   - **在办任务数** = 归属该实例且**未终结**（queued / running / awaiting_approval）的任务条数；
 *     默认沙盒额外认领「没有实例归属」的历史行（COALESCE 口径，design §2.4 R1-04）。
 */

import {
  countActiveTasks,
  instanceDisplayName,
  isSandboxInstance,
  pathTailOf,
  tasksOfInstance,
} from '../../core/project/instance-display';
import {
  DEFAULT_INSTANCE_ID,
  type HudCommand,
  type ProjectInstanceId,
  type ProjectInstanceView,
  type WorldState,
} from '../../core/types';

// ============================================================================
// 文案常量（组件与单测共用同一份，不各抄一套）
// ============================================================================

/** 大厅标题。 */
export const LOBBY_TITLE = '副本大厅';

/** 空态标题（design §7.1 M1-14 行：明确空态，不是白卡）。 */
export const LOBBY_EMPTY_TITLE = '没有可用副本';

/** 空态副标题：说清「为什么现在派不了单」。 */
export const LOBBY_EMPTY_HINT = '添加一个副本，才能进入战场并派单';

/** 空态出口按钮（design §7.1 M1-14 行：「没有可用副本 · 添加副本」按钮**可点**）。 */
export const LOBBY_ADD_LABEL = '添加副本';

/** 派单入口（大厅态下的降级入口，见下方「派单入口」的说明）。 */
export const LOBBY_DISPATCH_LABEL = '派单';

/** 卡片上的进入按钮。 */
export const LOBBY_ENTER_LABEL = '进入';

/** 默认沙盒卡的标牌（design §7.1 M1-14 行验收②：默认沙盒卡存在**且**标「默认沙盒」）。 */
export const LOBBY_SANDBOX_BADGE = '默认沙盒';

/** 分支未知时的如实说法（不猜）。 */
export const LOBBY_BRANCH_UNKNOWN = '未知';

/** 路径尾段取不到时的如实说法。 */
export const LOBBY_PATH_UNKNOWN = '路径未知';

/** 从未进入时的如实说法。 */
export const LOBBY_NEVER_ENTERED = '从未进入';

// ============================================================================
// 渲染用模型
// ============================================================================

/**
 * 副本的**实例级**状态（design §7.1 M1-14 行：active / idle / missing）。
 *
 * ★ 与 core 契约 `ProjectStatus` **同义**（@since v3.3，task_225 / QA-05 —— N2 口径统一）：
 *   `'active'` = **它正是 `activeInstanceId`**（= design §2.4 的「status = idle，除非它正是
 *   activeInstanceId ⇒ active」）；不是「有没有在办的事」。
 *   本类型比 `ProjectStatus` 少两个值（archived / missing 之外）：卡片层只展示
 *   「当前副本 / 闲置 / 路径丢失」三态 —— 归档的副本压根不进卡片列表。
 */
export type LobbyCardStatus = 'active' | 'idle' | 'missing';

/** 状态 → 中文标签。 */
export const LOBBY_STATUS_LABEL: Readonly<Record<LobbyCardStatus, string>> = Object.freeze({
  active: '当前副本',
  idle: '闲置',
  missing: '路径丢失',
});

/** 一张副本卡片（design §7.1 M1-14 行验收①：六项字段齐）。 */
export interface LobbyCardModel {
  /** 实例 id（派发 project.enter 用）。 */
  readonly instanceId: ProjectInstanceId;
  /** 名字。 */
  readonly name: string;
  /** 路径尾段。 */
  readonly pathTail: string;
  /** 分支（未知 = 「未知」，不猜）。 */
  readonly branch: string;
  /** 实例级状态。 */
  readonly status: LobbyCardStatus;
  /** 状态标签（渲染用；语义在 status）。 */
  readonly statusLabel: string;
  /** 最近进入时间（相对说法；从未进入 = 「从未进入」）。 */
  readonly lastEnteredText: string;
  /** 最近进入时刻（epoch ms；0 = 从未进入）—— 渲染 tooltip 用。 */
  readonly lastEnteredAt: number;
  /** 在办任务数（未终结）。 */
  readonly activeTaskCount: number;
  /** 是否默认沙盒（渲染「默认沙盒」标牌）。 */
  readonly sandbox: boolean;
  /** 是否置顶（置顶的排在最前）。 */
  readonly pinned: boolean;
  /** 能否进入（missing 的副本进不去 —— 按钮置灰并给出原因）。 */
  readonly enterable: boolean;
  /** 进入按钮的禁用原因（可进时为空串）。 */
  readonly enterHint: string;
}

/** 大厅面板的整体模型。 */
export interface LobbyPanelModel {
  /** 卡片列表（已按「置顶 → 默认沙盒 → 最近进入」排序；已归档的副本收起，不在列表里）。 */
  readonly cards: readonly LobbyCardModel[];
  /** 空态（`projectInstances` 缺失 / 为空 / 全被归档）—— **必须**渲染明确空态，不是白卡。 */
  readonly empty: boolean;
  /** 派单入口是否可用（没有任何可进入的副本时禁用）。 */
  readonly dispatchEnabled: boolean;
  /** 派单入口的副标题（说清此刻点了会发生什么）。 */
  readonly dispatchHint: string;
  /** 派单入口的目标副本 id（null = 无目标 = 入口禁用）。 */
  readonly dispatchTargetId: ProjectInstanceId | null;
}

// ============================================================================
// 派生
// ============================================================================

/**
 * 「最近进入」的相对说法。
 *
 * why 相对而不是绝对时间戳：大厅是**总览**，用户问的是「我刚是不是在这儿干过活」，
 *   绝对时间戳要心算；「2 小时前」一眼可读。超过一周才落绝对日期（再相对就没信息量了）。
 */
export function formatLastEntered(at: number, now: number): string {
  if (!Number.isFinite(at) || at <= 0) return LOBBY_NEVER_ENTERED;
  const delta = now - at;
  if (delta < 0) return LOBBY_NEVER_ENTERED;
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (delta < minute) return '刚刚';
  if (delta < hour) return `${Math.floor(delta / minute)} 分钟前`;
  if (delta < day) return `${Math.floor(delta / hour)} 小时前`;
  if (delta < 7 * day) return `${Math.floor(delta / day)} 天前`;
  const date = new Date(at);
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const dayOfMonth = `${date.getDate()}`.padStart(2, '0');
  return `${date.getFullYear()}-${month}-${dayOfMonth}`;
}

/**
 * 一张卡片：把一条实例视图投影成卡片模型。
 *
 * @param view 实例视图（注册表条目 = core 契约的投影）。
 * @param state 当前世界态（取活跃实例与任务表）。
 * @param now 观测时刻（相对时间用）。
 */
function buildCard(
  view: ProjectInstanceView,
  state: WorldState | null,
  now: number,
): LobbyCardModel {
  const isActive = state?.activeInstanceId === view.instanceId;
  // missing 有两个来源：枚举真值（status）与布尔快取（missing）—— 契约要求两者同时由同一处产出，
  // 读侧两个都认 ⇒ 少一个字段也不会把「路径没了」的副本说成可进。
  const missing = view.status === 'missing' || view.missing === true;
  const status: LobbyCardStatus = missing ? 'missing' : isActive ? 'active' : 'idle';
  const tasks = state?.tasks ?? [];
  const owned = tasksOfInstance(tasks, view.instanceId);
  return {
    instanceId: view.instanceId,
    name: instanceDisplayName(view, view.instanceId),
    pathTail: pathTailOf(view.path) ?? LOBBY_PATH_UNKNOWN,
    branch: view.vcs?.branch ?? LOBBY_BRANCH_UNKNOWN,
    status,
    statusLabel: LOBBY_STATUS_LABEL[status],
    lastEnteredText: formatLastEntered(view.lastOpenedAt, now),
    lastEnteredAt: view.lastOpenedAt,
    activeTaskCount: countActiveTasks(owned),
    sandbox: isSandboxInstance(view),
    pinned: view.pinned === true,
    enterable: !missing,
    enterHint: missing ? '路径不可达，进不去' : '',
  };
}

/**
 * 卡片排序：置顶 → 默认沙盒 → 最近进入 → 实例 id（保证顺序确定，不随广播抖动）。
 *
 * why 默认沙盒排在前面：它是契约保证**恒存**的副本（design §2.4），也是历史数据的落点 ——
 *   大厅第一眼就看到它，用户才知道「我的老数据在这儿」。
 */
function compareCards(a: LobbyCardModel, b: LobbyCardModel): number {
  if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
  if (a.sandbox !== b.sandbox) return a.sandbox ? -1 : 1;
  if (a.lastEnteredAt !== b.lastEnteredAt) return b.lastEnteredAt - a.lastEnteredAt;
  return a.instanceId.localeCompare(b.instanceId);
}

/**
 * 派生大厅模型。
 *
 * @param state 最近一次收到的 WorldState（null = 还没收到广播 ⇒ 视作空态）。
 * @param now 观测时刻（缺省 = 当前时间；单测可注入固定时刻）。
 */
export function resolveLobbyPanel(state: WorldState | null, now: number = Date.now()): LobbyPanelModel {
  const instances = state?.projectInstances ?? [];
  // 已归档的副本「在大厅里收起」（core/types.ts 的 archived 字段注释）⇒ 不进卡片网格。
  const visible = instances.filter((view) => view.archived !== true && view.status !== 'archived');
  const cards = visible
    .map((view) => buildCard(view, state, now))
    .sort(compareCards);
  const empty = cards.length === 0;
  // 派单入口的目标：默认沙盒优先（它恒存），其次最近进入的那个可进入副本。
  const target = cards.find((card) => card.sandbox && card.enterable)
    ?? cards.find((card) => card.enterable)
    ?? null;
  return {
    cards,
    empty,
    dispatchEnabled: target !== null,
    dispatchHint: target
      ? `进入「${target.name}」后派单`
      : '没有可用副本，先添加一个',
    dispatchTargetId: target?.instanceId ?? null,
  };
}

/**
 * 渲染判重签名（perf：core 每次状态变更都全量广播，签名不变就跳过重渲染）。
 *
 * why 只取**影响画面**的字段：任务总数变化不该让整屏卡片重画（在办数变了才画）。
 */
export function lobbyPanelSignature(state: WorldState | null): string {
  const instances = state?.projectInstances ?? [];
  const activeId = state?.activeInstanceId ?? null;
  const parts = instances.map((view) => {
    const owned = tasksOfInstance(state?.tasks ?? [], view.instanceId);
    return [
      view.instanceId,
      view.title,
      view.path,
      view.status,
      view.missing === true ? '1' : '0',
      view.archived === true ? '1' : '0',
      view.sandbox === true ? '1' : '0',
      view.pinned === true ? '1' : '0',
      view.lastOpenedAt,
      view.vcs?.branch ?? '',
      countActiveTasks(owned),
    ].join('~');
  });
  return `${activeId ?? ''}|${parts.join(';')}`;
}

// ============================================================================
// 命令
// ============================================================================

/**
 * 进入某个副本的命令（core 裁决：inspect → load → 写 activeInstanceId → 广播 project.changed）。
 *
 * why 由本层构造而不是组件里手搓对象：命令形状是 core 契约，构造点收在一处，
 *   组件只管「点了哪张卡」⇒ 组件不认识命令内部结构。
 */
export function buildEnterInstanceCommand(instanceId: ProjectInstanceId): HudCommand {
  return { type: 'project.enter', instanceId };
}

/**
 * 空态「添加副本」的命令。
 *
 * ★ 为什么「添加副本」= 进入默认沙盒（M1 的诚实做法）：
 *   设计 B §5.2 的「添加副本」= 副本**发现流程**（marker walk-up + 注册表写入）——
 *   那是多副本期（M2）的活，M1 的 core 契约里**没有**写注册表的命令面（只有 project.enter / project.exit，
 *   见 core/types.ts §1.2.1）。⇒ M1 里唯一**恒存**、随时可进的副本是默认沙盒
 *   （`DEFAULT_INSTANCE_ID`，M1-07 物化：注册表恒含它、路径校验特例豁免）。
 *   所以空态的出口 = 「把默认沙盒接回来并进入它」= `project.enter(DEFAULT_INSTANCE_ID)`：
 *   这是**真命令**、真效果（core 裁决 → 装载 → 进副本），不是点了没反应的死按钮。
 *   发现流程上线后，这一条命令换成注册表写入即可，**按钮位置与语义不变**。
 */
export function buildAddInstanceCommand(): HudCommand {
  return { type: 'project.enter', instanceId: DEFAULT_INSTANCE_ID };
}
