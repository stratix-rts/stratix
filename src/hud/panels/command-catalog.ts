/**
 * 文件职责：命令面板的**命令清单与命令构造**（纯逻辑，零 DOM、零依赖）——
 *   把旧 CommandPanel（选中单位后的操作）+ CommandPalette（全局命令）合并成唯一一份命令目录，
 *   并把每条命令映射成 core 契约里的 HudCommand。UI 呈现全部在 command-panel.ts。
 *   来源：docs/REFACTOR_PLAN_V3.md §2 panels/ 层级；命令语义提取自 src/components/CommandPanel.vue
 *   与 src/composables/useCommandPalette.ts（只提取语义，不复制实现）。
 * 输入：WorldState（决定命令**是否可用**）+ 面板瞬时输入态（任务标题草稿）。
 * 输出：ResolvedCommand 列表（渲染用）与 HudCommand（派发用）。
 * 禁止事项：
 *   1. 触碰 DOM —— 本文件必须能在 node 环境单测，渲染是 command-panel.ts 的事；
 *   2. import world/、vue、任何 UI 库 —— 铁律；
 *   3. 直接调 core/bus —— 本文件只**构造**命令，派发一律由调用方经 bus-adapter 完成；
 *   4. 在本地维护选择集 / 任务 —— 一切可用性判定只读 WorldState，判断权在 core；
 *   5. 造数据 —— 单位名、任务相位、通知全部来自 WorldState，不许写死假数据。
 *
 * 命令目录的取舍（为什么旧面板里有些命令没进来）：
 *   - Zone 相关（zone-create / zone-panel / nav-zones）**整体不迁移**：D5 已砍 Zone，
 *     契约里没有 Zone 实体，硬搬只会造出无法兑现的按钮。
 *   - 相机相关（zoom in/out/reset、3D 视图）**不进总线**：相机由 world 层自治，
 *     WorldState 里没有相机字段，HudCommand 表达了它 core 也接不住（见 types.ts 顶部铁律）。
 *   - 刷新类（refresh agents/tasks/data）与音效（toggle sound）：契约里没有对应命令，
 *     v3 的真相由 core 单向广播，HUD 没有"主动拉取"这个动作。
 *   - 保留的每一条都 1:1 落到既有或 @since v3.1 增补的 HudCommand 变体上。
 */

import type { HudCommand, MissionPhase, MissionView, WorldState } from '../../core/types';

/** 面板命令的稳定标识。与 HudCommand.type 不完全同名是刻意的：theme 有两条绝对命令，
 *  而 mission.create 一条命令在不同选择态下单位入参不同，靠 scope + WorldState 区分。 */
export type PanelCommandId =
  | 'mission.create'
  | 'mission.confirm'
  | 'mission.cancel'
  | 'chat.open'
  | 'character.open'
  | 'settings.open'
  | 'theme.default'
  | 'theme.pixel'
  | 'selection.clear';

/** 命令分组。selection 组只在有选中单位时出现（对应旧 CommandPanel），global 组恒在
 *  （对应旧 CommandPalette）。这是"唯一命令入口"对两种旧面板的合并方式。 */
export type CommandScope = 'selection' | 'global';

export interface CommandSpec {
  readonly id: PanelCommandId;
  readonly label: string;
  readonly scope: CommandScope;
  /** 灰字副标题：说清这条命令**此刻**会作用于谁，避免用户误点。 */
  readonly hint?: string;
  /** 主操作（视觉强调用；组件据此选 accent 变量，命令本身不关心样式）。 */
  readonly primary?: boolean;
}

/** 构造命令所需的上下文。都是纯数据，无副作用。 */
export interface CommandContext {
  /** 最近一次收到的 WorldState；null = 还没收到广播（面板刚挂上）。 */
  readonly state: WorldState | null;
  /** 「发起任务」的标题草稿。面板的瞬时输入态（用户正在敲的字），**不是业务状态**。 */
  readonly draftTitle: string;
}

/** 一条命令在当前 WorldState 下的可执行性判定结果。 */
export interface ResolvedCommand {
  readonly spec: CommandSpec;
  readonly enabled: boolean;
  /** 可用时的副标题：说清这条命令**此刻**会作用于谁（避免用户误点）。 */
  readonly hint?: string;
  /** 禁用原因；仅在 !enabled 时有值，渲染成灰字提示。 */
  readonly reason?: string;
}

/** 目录本体。顺序即渲染顺序，不另设 order 字段（少一个可以与列表脱节的真相源）。 */
const SELECTION_COMMANDS: readonly CommandSpec[] = [
  { id: 'mission.create', label: '发起任务', scope: 'selection', primary: true },
  { id: 'mission.confirm', label: '确认任务', scope: 'selection', primary: true },
  { id: 'mission.cancel', label: '停止任务', scope: 'selection' },
  { id: 'chat.open', label: '聊天', scope: 'selection', primary: true },
  { id: 'character.open', label: '配置', scope: 'selection' },
  { id: 'selection.clear', label: '取消选择', scope: 'selection' },
];

const GLOBAL_COMMANDS: readonly CommandSpec[] = [
  { id: 'mission.create', label: '新建任务', scope: 'global', primary: true },
  { id: 'chat.open', label: '打开聊天', scope: 'global' },
  { id: 'character.open', label: '打开角色', scope: 'global' },
  { id: 'settings.open', label: '打开设置', scope: 'global' },
  { id: 'theme.default', label: '切换到现代风', scope: 'global' },
  { id: 'theme.pixel', label: '切换到像素风', scope: 'global' },
];

export const COMMAND_CATALOG: readonly CommandSpec[] = [...SELECTION_COMMANDS, ...GLOBAL_COMMANDS];

// ============================================================================
// WorldState → 命令可用性
// ============================================================================

/** 与选择集相交的、处于指定相位的任务（取最近创建的一条）。找不到返回 null。 */
function findMissionFor(
  state: WorldState | null,
  unitIds: readonly string[],
  phases: readonly MissionPhase[]
): MissionView | null {
  if (!state || unitIds.length === 0) return null;
  const targets = new Set(unitIds);
  // 倒序遍历：后创建的更可能是用户刚点的那个（同相位多任务时的确定性选择）。
  for (let i = state.missions.length - 1; i >= 0; i--) {
    const mission = state.missions[i];
    if (!phases.includes(mission.phase)) continue;
    if (mission.unitIds.some((id) => targets.has(id))) return mission;
  }
  return null;
}

/** 可被"确认"的任务：已指派但还没被接收（phase=pending）。 */
function pendingMission(state: WorldState | null, unitIds: readonly string[]): MissionView | null {
  return findMissionFor(state, unitIds, ['pending']);
}

/** 可被"停止"的任务：还没收尾的在办任务（pending / confirmed / running）。 */
function activeMission(state: WorldState | null, unitIds: readonly string[]): MissionView | null {
  return findMissionFor(state, unitIds, ['pending', 'confirmed', 'running']);
}

/** 标题草稿是否够用。空标题发出去就是一条没有语义的任务，core 侧也无从拒绝。 */
function isUsableTitle(raw: string): boolean {
  return raw.trim().length > 0;
}

/**
 * 判定一条命令在当前上下文下是否可用，并算出此刻的副标题。
 * 单独抽出是为了让 resolveCommands / buildCommand 共用同一份判定，
 * 避免"列表里能点、点下去却构造不出命令"这种两处逻辑漂移。
 */
function evaluate(spec: CommandSpec, ctx: CommandContext): ResolvedCommand {
  const { state, draftTitle } = ctx;
  const selected = state?.selection.unitIds ?? [];
  const selectionCount = selected.length;
  const hasSelection = selectionCount > 0;

  switch (spec.id) {
    case 'mission.create': {
      const title = draftTitle.trim();
      const target = spec.scope === 'selection' ? selected : [];
      if (spec.scope === 'selection' && !hasSelection) {
        return { spec, enabled: false, reason: '未选中单位' };
      }
      // @since v3.10（task_154）：常驻的「任务标题」输入框已删（底栏双框合一）——
      //   标题从任务条上来，所以这句提示指向**唯一的那块输入面**，别再指向一个不存在的框。
      if (!isUsableTitle(title)) return { spec, enabled: false, reason: '先在下方写任务标题' };
      return { spec, enabled: true, hint: `「${title}」${target.length > 0 ? ` · 指派给 ${target.length} 个单位` : ' · 待指派'}` };
    }

    case 'mission.confirm': {
      const mission = pendingMission(state, selected);
      if (!hasSelection) return { spec, enabled: false, reason: '未选中单位' };
      if (!mission) return { spec, enabled: false, reason: '没有待确认的任务' };
      return { spec, enabled: true, hint: mission.title };
    }

    case 'mission.cancel': {
      const mission = activeMission(state, selected);
      if (!hasSelection) return { spec, enabled: false, reason: '未选中单位' };
      if (!mission) return { spec, enabled: false, reason: '没有在办的任务' };
      return { spec, enabled: true, hint: `${mission.title} · ${mission.phase}` };
    }

    case 'selection.clear':
      if (!hasSelection) return { spec, enabled: false, reason: '未选中单位' };
      return { spec, enabled: true, hint: `清空 ${selectionCount} 个已选单位` };

    case 'chat.open': {
      // 全局与选中两种入口指向同一个抽屉；只有选中态才谈得上"跟谁聊"。
      const hint = spec.scope === 'selection' && hasSelection
        ? `与 ${selectionCount} 个选中单位对话`
        : '打开聊天抽屉';
      return { spec, enabled: true, hint };
    }

    case 'character.open':
      return { spec, enabled: true, hint: spec.scope === 'selection' && hasSelection ? '配置选中的角色' : '打开角色档案' };

    case 'settings.open':
      return { spec, enabled: true, hint: '打开设置' };

    case 'theme.default':
    case 'theme.pixel':
      return { spec, enabled: true, hint: spec.id === 'theme.default' ? '现代风' : '像素风' };
  }
}

/**
 * 解析当前上下文下的完整命令清单。
 * selection 组在无选中时整体返回空数组（面板据此渲染"仅显示全局命令"的空态），
 * global 组恒非空 —— 保证任何时候命令入口都不是空的。
 */
export function resolveCommands(ctx: CommandContext): ResolvedCommand[] {
  const hasSelection = (ctx.state?.selection.unitIds.length ?? 0) > 0;
  const specs = hasSelection ? [...SELECTION_COMMANDS, ...GLOBAL_COMMANDS] : [...GLOBAL_COMMANDS];
  return specs.map((spec) => evaluate(spec, ctx));
}

/** 按 scope 切分，供面板分区渲染。顺序保持目录原序。 */
export function groupByScope(commands: readonly ResolvedCommand[]): {
  selection: ResolvedCommand[];
  global: ResolvedCommand[];
} {
  return {
    selection: commands.filter((c) => c.spec.scope === 'selection'),
    global: commands.filter((c) => c.spec.scope === 'global'),
  };
}

// ============================================================================
// 命令构造（派发前的唯一出口）
// ============================================================================

/**
 * 把一条命令 + 当前上下文构造 HudCommand。
 * 返回 null = 这条命令此刻构造不出来（面板据此不派发，而不是发一条半截命令给 core）。
 *
 * 入参是 **CommandSpec 而不是裸 id**：同一个 id 在两个 scope 下语义不同
 * （mission.create 的「发起任务」带指派对象、「新建任务」是待指派草稿），
 * 传 spec 才能保证"点到的哪一条"与"构造出哪一条"严格一致，不靠当前状态反推。
 */
export function buildCommand(spec: CommandSpec, ctx: CommandContext): HudCommand | null {
  const resolved = evaluate(spec, ctx);
  if (!resolved.enabled) return null;

  const selected = [...(ctx.state?.selection.unitIds ?? [])];

  switch (spec.id) {
    case 'mission.create':
      return {
        type: 'mission.create',
        title: ctx.draftTitle.trim(),
        // selection 组带指派对象，global 组是待指派草稿 —— 同一 id 由 scope 区分入参。
        unitIds: spec.scope === 'selection' ? selected : [],
      };

    case 'mission.confirm': {
      const mission = pendingMission(ctx.state, selected);
      if (!mission) return null;
      return { type: 'mission.confirm', missionId: mission.id, decision: 'accept' };
    }

    case 'mission.cancel': {
      const mission = activeMission(ctx.state, selected);
      if (!mission) return null;
      return { type: 'mission.cancel', missionId: mission.id };
    }

    case 'chat.open':
      return { type: 'ui.navigate', screen: 'chat' };

    case 'character.open':
      return { type: 'ui.navigate', screen: 'character' };

    case 'settings.open':
      return { type: 'ui.navigate', screen: 'settings' };

    case 'theme.default':
      return { type: 'theme.set', themeId: 'default' };

    case 'theme.pixel':
      return { type: 'theme.set', themeId: 'pixel' };

    case 'selection.clear':
      return { type: 'unit.select', unitIds: [], mode: 'set' };
  }
}

// ============================================================================
// 搜索过滤（承接旧 CommandPalette 的搜索框语义）
// ============================================================================

/**
 * 子序列模糊匹配：按顺序在 haystack 里找 needle 的每个字符（大小写无关）。
 * why 沿用旧实现：命令名多为英文短语，子序列匹配容忍缩写（"mcr" 命中 mission.create）。
 */
function fuzzyMatch(haystack: string, needle: string): boolean {
  const text = haystack.toLowerCase();
  const pattern = needle.toLowerCase();
  let p = 0;
  for (let i = 0; i < text.length && p < pattern.length; i++) {
    if (text[i] === pattern[p]) p++;
  }
  return p === pattern.length;
}

/** 按查询词过滤命令；命中文本取 label + hint + id。空查询词原样返回。 */
export function filterCommands(
  commands: readonly ResolvedCommand[],
  query: string
): ResolvedCommand[] {
  const q = query.trim();
  if (!q) return [...commands];
  return commands.filter((c) => fuzzyMatch(`${c.spec.label} ${c.spec.id} ${c.hint ?? c.reason ?? ''}`, q));
}

// ============================================================================
// 渲染签名（perf：WorldState 高频广播，面板只渲染真正变了的那次）
// ============================================================================

/** 面板最多渲染几条通知。core 已按 MAX_NOTICES 截断，这里再压一层防止 DOM 过长。 */
export const MAX_VISIBLE_NOTICES = 3;

/**
 * 由 WorldState + 面板瞬时态算出渲染签名；签名不变即跳过重渲染。
 * why：SelectionState.revision 的契约语义就是"选择集实质变了才递增"，
 *   任务相位与通知则是本面板另外两处读数，再加上面板自己的两个输入框值 ——
 *   四者合起来就是本面板的**完整**输入，缺一项都会导致"输入变了却没重画"。
 *   签名是 O(units + missions + 3) 的字符串拼接，比一次全量 DOM 重建便宜得多。
 */
export function renderSignature(
  state: WorldState | null,
  draftTitle: string,
  query = ''
): string {
  if (!state) return `none|${draftTitle}|${query}`;
  const missionSig = state.missions.map((m) => `${m.id}:${m.phase}`).join(',');
  const noticeSig = state.notices
    .slice(0, MAX_VISIBLE_NOTICES)
    .map((n) => `${n.id}:${n.level}`)
    .join(',');
  return [
    state.selection.revision,
    state.units.length,
    missionSig,
    noticeSig,
    draftTitle,
    query,
  ].join('|');
}

/** 当前选择集里"还有人名"的单位名拼串，供面板抬头显示（只读 WorldState，不自建名单）。 */
export function describeSelection(state: WorldState | null): string {
  const ids = state?.selection.unitIds ?? [];
  if (ids.length === 0) return '未选中单位';
  const byId = new Map((state?.units ?? []).map((u) => [u.id, u] as const));
  const names = ids.map((id) => byId.get(id)?.name ?? id);
  const shown = names.slice(0, 4).join('、');
  const more = names.length > 4 ? ` 等 ${names.length} 个` : '';
  return `已选中 ${shown}${more}`;
}

// —— 内部小工具：按 id + scope 定位目录项（同一 id 在两个 scope 下各有一项）——

/** 按 id + scope 查目录项；查不到返回 undefined（调用方决定是跳过还是报错）。 */
export function findCommandSpec(
  id: PanelCommandId,
  scope: CommandScope
): CommandSpec | undefined {
  return COMMAND_CATALOG.find((c) => c.id === id && c.scope === scope);
}