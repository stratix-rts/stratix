/**
 * 文件职责：**全应用命令注册表**（@since v3.9，task_150）—— ⌘K 命令面板与底栏 composer
 *   **共用的一份事实源**：命令的 id / 标题 / 别名 / 分组 / 动作 / 可用性 / 快捷提示，全在这里。
 *   纯逻辑：零 DOM、零 IO、零总线依赖（node 环境可直测）。
 *
 * ============ 为什么要有这一份（此前是三份真相）============
 *   改造前：① 底栏命令行的五条 CLI 词表在 panels/command-registry.ts；
 *           ② 命令面板的九条按钮目录在 panels/command-catalog.ts；
 *           ③ 各面板把动作藏在按钮里（顶栏 ⋯ 菜单 / 会话面板示例会话 / 日志抽屉…）。
 *   三份真相的后果是「同一个动作两处入口、别名对不上、可用性判据各写一份」。
 *   ⌘K 面板要求**一个动作一处定义**：面板与 composer 都从这里读。
 *
 * ============ 分层（各层职责不重叠）============
 *   · command-registry.ts（本文件）：**命令是什么** —— 定义 + 匹配 + 分组。纯数据 + 纯函数。
 *   · command-catalog.ts（既有）：**按钮目录** —— WorldState → 可用性 + HudCommand 构造。
 *     本文件里「确认任务 / 停止任务」两条直接复用它的构造器（不重写一遍判定）。
 *   · app-actions.ts（既有）：**宿主动作** —— 不落总线契约的组件能力（抽屉 / 向导 / 回放）。
 *
 * 输入：WorldState（决定可用性）+ 面板瞬时态（任务标题草稿）。
 * 输出：AppCommandSpec 清单 / 模糊匹配结果 / 分组结果。
 * 禁止事项：
 *   1. 触碰 DOM —— 渲染归 command-palette.ts；
 *   2. import world/、app/、任何 UI 库 —— 铁律；
 *   3. 直接调 core/bus —— 派发一律由调用方经 bus-adapter 完成；
 *   4. 在本地维护选择集 / 任务 / 角色 —— 可用性判定只读 WorldState，判断权在 core；
 *   5. 造数据 —— 角色名、任务相位、通知全部来自 WorldState。
 */

import type { HudCommand, WorldState } from '../../core/types';
import { buildTaskAssignCommand } from '../panels/agent-catalog';
import { buildCommand, findCommandSpec, type CommandContext } from '../panels/command-catalog';
import { recommendAssignees } from '../panels/task-assign-catalog';

import { appActionUnavailableReason, isAppActionAvailable, type AppActionId } from './app-actions';

// ============================================================================
// 形状
// ============================================================================

/**
 * 命令分组（面板按它渲染分组标题）。
 * 'recent' = 最近使用（面板**动态**生成的一组，命令表里没有命令属于它）。
 */
export type AppCommandGroupId = 'recent' | 'task' | 'character' | 'view' | 'appearance' | 'help';

/** 分组显示名（中文；分组标题就是给人读的）。 */
export const APP_COMMAND_GROUP_LABELS: Readonly<Record<AppCommandGroupId, string>> = Object.freeze({
  recent: '最近',
  task: '任务',
  character: '角色',
  view: '视图',
  appearance: '外观',
  help: '帮助',
});

/**
 * 分组顺序（面板按此顺序渲染 —— 不另设 order 字段，少一个能与列表脱节的真相源）。
 * 'recent' 排在最前：最近使用由面板动态成组（命令表里没有命令属于它，
 *   这里登记是为了让「组的顺序」这一件事仍然只有一处真相）。
 */
export const APP_COMMAND_GROUP_ORDER: readonly AppCommandGroupId[] = Object.freeze([
  'recent',
  'task',
  'character',
  'view',
  'appearance',
  'help',
]);

/**
 * 命令的**动作**（数据，不是闭包 —— 面板据此执行，注册表不碰副作用）。
 * 之所以做成数据而不是函数：注册表要能在 node 环境纯测、还要能被 composer 与面板**共用**
 * （一份定义两处执行），数据化的动作让「执行」留在各自的宿主里。
 */
export type AppCommandAction =
  /** 派一条固定命令。 */
  | { readonly kind: 'dispatch'; readonly command: HudCommand }
  /** 按当前上下文构造命令（构造不出来 = 不派，调用方据此不假装成功）。 */
  | { readonly kind: 'dispatch-built'; readonly build: (ctx: AppCommandContext) => HudCommand | null }
  /** 切皮肤到指定皮肤。 */
  | { readonly kind: 'theme'; readonly themeId: 'default' | 'pixel' }
  /** 在两套皮肤之间切换（不带参数的 theme 命令）。 */
  | { readonly kind: 'theme-toggle' }
  /** 打开新建任务对话框（可指定发起方式）。 */
  | { readonly kind: 'new-task'; readonly mode?: 'single' | 'pipeline' | 'dispatch' }
  /** 在面板里展开命令清单（help —— 列出来的必须就是能敲的全部形态）。 */
  | { readonly kind: 'help' }
  /** 调用宿主动作（抽屉 / 向导 / 回放 / 清草稿…；见 app-actions.ts）。 */
  | { readonly kind: 'app-action'; readonly id: AppActionId };

/** 命令的可用性上下文。 */
export interface AppCommandContext {
  /** 最近一次收到的 WorldState；null = 还没收到广播。 */
  readonly state: WorldState | null;
  /** 任务标题草稿（面板瞬时态 —— 用户正在敲的字，不是业务状态）。 */
  readonly draftTitle: string;
}

/**
 * 命令行绑定（@since v3.6，task_113 的词表**原样收编**到这里）。
 * 底栏 composer 的「命令名 → 命令」解析读这份绑定；⌘K 面板读同一份命令的标题与别名。
 * why 收编：此前 CLI 词表与按钮目录各写一份「设置」这件事 —— 迟早对不上。
 */
export interface CliBinding {
  /** 命令 id（稳定标识；与 HudCommand.type 不同名是刻意的）。 */
  readonly id: string;
  /** 规范写法（大小写不敏感）。 */
  readonly name: string;
  /** 别名（中文别名是底栏那行提示词的老承诺，兑现它）。 */
  readonly aliases?: readonly string[];
  /** 用法串（help 列表与用法提示共用；`<>` 必填、`[]` 可选）。 */
  readonly usage: string;
  /** 一句话说明。 */
  readonly summary: string;
  /** 参数必填（缺了只给用法提示，不执行）。 */
  readonly argRequired?: boolean;
  /** 参数白名单（给了就只认这几个）。 */
  readonly allowedArgs?: readonly string[];
  /**
   * 词表展示顺序（help 列表按它排）。
   * why 要显式序：全应用命令表按**分组**排（任务 / 角色 / 视图 / 外观 / 帮助），
   *   而 CLI 词表的展示顺序是**先来后到**的老顺序（mission · theme · settings · replay · help）——
   *   两者不是一回事，不给显式序，help 清单就会因为分组重排而变样（用户可见的回归）。
   */
  readonly order?: number;
}

/** 一条命令的定义。 */
export interface AppCommandSpec {
  /** 稳定标识。 */
  readonly id: string;
  /** 显示标题（面板与 composer 共用）。 */
  readonly title: string;
  /** 别名（匹配用；中文别名都在这里）。 */
  readonly aliases: readonly string[];
  /** 所属分组。 */
  readonly group: AppCommandGroupId;
  /** 额外匹配词（不在标题与别名里、但用户可能敲的字，如「派单」）。 */
  readonly keywords?: readonly string[];
  /** 快捷提示（面板右侧角标；例：⌘K / ? / Space）。 */
  readonly shortcut?: string;
  /** 命令行绑定（给了就能从底栏 composer 敲）。 */
  readonly cli?: CliBinding;
  /**
   * 可用性判定：返回 null = 可用；返回字符串 = **不可用原因**（灰态上显示这句话）。
   * why 是「原因」而不是布尔：灰按钮不解释 = 死按钮（@since v3.9，task_148 的死按钮治理）。
   */
  readonly unavailable?: (ctx: AppCommandContext) => string | null;
  /** 动作。 */
  readonly action: AppCommandAction;
}

// ============================================================================
// 判定辅助（纯函数）
// ============================================================================

/** 选中集（WorldState 的真相；null 状态 = 没选中）。 */
function selectedIds(state: WorldState | null): readonly string[] {
  return state?.selection.unitIds ?? [];
}

/** 构造器：把命令面板目录项转成本注册表用的上下文（同一份判定口径，不重写）。 */
function panelContext(ctx: AppCommandContext): CommandContext {
  return { state: ctx.state, draftTitle: ctx.draftTitle };
}

/**
 * 复用 command-catalog 的构造器（确认 / 停止任务）。
 * why 复用：可用性判定与命令构造**必须同源**（面板里能点、点下去却构造不出来 = 漂移）。
 */
function buildPanelCommand(
  id: 'mission.confirm' | 'mission.cancel',
  ctx: AppCommandContext
): HudCommand | null {
  const spec = findCommandSpec(id, 'selection');
  if (!spec) return null;
  return buildCommand(spec, panelContext(ctx));
}

/**
 * 派发任务（task.assign）：承接人 = 推荐排序第一位（与新建任务对话框的「派发」同一算法）。
 * 构造不出来（没角色 / 没指令）→ 返回 null，**不发半截命令**。
 */
function buildDispatchCommand(ctx: AppCommandContext): HudCommand | null {
  const state = ctx.state;
  if (!state) return null;
  const candidates = recommendAssignees(state);
  const first = candidates[0];
  if (!first) return null;
  return buildTaskAssignCommand(first.characterId, ctx.draftTitle);
}

/** 派发不可用原因（0 角色 → 说清为什么 + 给出路）。 */
function dispatchUnavailable(ctx: AppCommandContext): string | null {
  const state = ctx.state;
  if (!state) return '尚未收到应用状态';
  const candidates = recommendAssignees(state);
  if (candidates.length === 0) return '当前没有可派发的角色 · 先新建一个角色';
  if (ctx.draftTitle.trim().length === 0) return '先写一句任务指令再派发';
  return null;
}

/** 确认任务不可用原因。 */
function confirmUnavailable(ctx: AppCommandContext): string | null {
  if (selectedIds(ctx.state).length === 0) return '未选中单位';
  const command = buildPanelCommand('mission.confirm', ctx);
  return command ? null : '没有待确认的任务';
}

/** 停止任务不可用原因。 */
function cancelUnavailable(ctx: AppCommandContext): string | null {
  if (selectedIds(ctx.state).length === 0) return '未选中单位';
  const command = buildPanelCommand('mission.cancel', ctx);
  return command ? null : '没有在办的任务';
}

/** 宿主动作不可用原因（没人接 = 一句人话；有登记但自带原因 = 登记的原因）。 */
function appActionUnavailable(id: AppActionId): string | null {
  if (!isAppActionAvailable(id)) return appActionUnavailableReason(id);
  return null;
}

// ============================================================================
// 命令表本体
// ============================================================================

/**
 * 全应用命令清单（≥15 条；面板与 composer 共用这一份）。
 * 顺序即分组渲染顺序（同组内按此序）。
 */
export const APP_COMMANDS: readonly AppCommandSpec[] = Object.freeze([
  // —— 任务组 ——
  {
    id: 'mission.new',
    title: '新建任务',
    aliases: ['任务', '新建任务', 'mission'],
    keywords: ['派单', '发起'],
    group: 'task',
    cli: {
      id: 'mission',
      name: 'mission',
      aliases: ['任务', '新建任务'],
      usage: 'mission <标题>',
      summary: '新建任务（打开对话框并预填标题）',
      argRequired: true,
      order: 10,
    },
    action: { kind: 'new-task', mode: 'single' },
  },
  {
    id: 'mission.confirm',
    title: '确认任务',
    aliases: ['确认', 'confirm'],
    group: 'task',
    unavailable: confirmUnavailable,
    action: { kind: 'dispatch-built', build: (ctx) => buildPanelCommand('mission.confirm', ctx) },
  },
  {
    id: 'mission.cancel',
    title: '停止任务',
    aliases: ['停止', '取消任务'],
    group: 'task',
    unavailable: cancelUnavailable,
    action: { kind: 'dispatch-built', build: (ctx) => buildPanelCommand('mission.cancel', ctx) },
  },
  {
    id: 'task.dispatch',
    title: '派发任务',
    aliases: ['派发', '派单', 'dispatch'],
    group: 'task',
    unavailable: dispatchUnavailable,
    action: { kind: 'dispatch-built', build: buildDispatchCommand },
  },
  {
    id: 'task.clear-draft',
    title: '清空任务草稿',
    aliases: ['清空草稿', '清空'],
    group: 'task',
    unavailable: (ctx) => (ctx.draftTitle.trim().length === 0 ? '草稿已经是空的' : null),
    action: { kind: 'app-action', id: 'clear-draft' },
  },

  // —— 角色组 ——
  {
    id: 'character.open',
    title: '打开角色',
    aliases: ['角色', '配置', 'character'],
    group: 'character',
    action: { kind: 'dispatch', command: { type: 'ui.navigate', screen: 'character' } },
  },
  {
    id: 'character.new',
    title: '新建角色',
    aliases: ['新建角色', '建档', '建角色'],
    group: 'character',
    unavailable: () => appActionUnavailable('open-character-wizard'),
    action: { kind: 'app-action', id: 'open-character-wizard' },
  },
  {
    id: 'chat.open',
    title: '打开聊天',
    aliases: ['聊天', 'chat'],
    group: 'character',
    action: { kind: 'dispatch', command: { type: 'ui.navigate', screen: 'chat' } },
  },
  {
    id: 'session.demo',
    title: '示例会话',
    aliases: ['示例', '演示会话', 'demo'],
    group: 'character',
    unavailable: () => appActionUnavailable('toggle-demo-session'),
    action: { kind: 'app-action', id: 'toggle-demo-session' },
  },

  // —— 视图组 ——
  {
    id: 'settings.open',
    title: '打开设置',
    aliases: ['设置', '设置页', 'settings'],
    group: 'view',
    cli: {
      id: 'settings',
      name: 'settings',
      aliases: ['设置'],
      usage: 'settings',
      summary: '打开设置页',
      order: 30,
    },
    action: { kind: 'dispatch', command: { type: 'ui.navigate', screen: 'settings' } },
  },
  {
    id: 'status.open',
    title: '打开态势屏',
    aliases: ['态势', '态势屏', '状态', 'status'],
    group: 'view',
    unavailable: () => appActionUnavailable('focus-status-screen'),
    action: { kind: 'app-action', id: 'focus-status-screen' },
  },
  {
    id: 'log.open',
    title: '打开日志抽屉',
    aliases: ['日志', '日志抽屉', 'log'],
    group: 'view',
    unavailable: () => appActionUnavailable('toggle-log-drawer'),
    action: { kind: 'app-action', id: 'toggle-log-drawer' },
  },
  {
    id: 'replay.today',
    title: '回放今天',
    aliases: ['回放', 'replay'],
    group: 'view',
    cli: {
      id: 'replay',
      name: 'replay',
      aliases: ['回放'],
      usage: 'replay',
      summary: '回放今天（服务没连上会给出重试指引）',
      order: 40,
    },
    unavailable: () => appActionUnavailable('replay-today'),
    action: { kind: 'app-action', id: 'replay-today' },
  },
  {
    id: 'selection.clear',
    title: '取消选择',
    aliases: ['取消选择', 'clear'],
    group: 'view',
    shortcut: 'Esc',
    unavailable: (ctx) => (selectedIds(ctx.state).length === 0 ? '未选中单位' : null),
    action: { kind: 'dispatch', command: { type: 'unit.select', unitIds: [], mode: 'set' } },
  },

  // —— 外观组 ——
  {
    id: 'theme.default',
    title: '切换到现代风',
    aliases: ['现代', '现代风', 'default'],
    group: 'appearance',
    action: { kind: 'theme', themeId: 'default' },
  },
  {
    id: 'theme.pixel',
    title: '切换到像素风',
    aliases: ['像素', '像素风', 'pixel'],
    group: 'appearance',
    action: { kind: 'theme', themeId: 'pixel' },
  },
  {
    id: 'theme.toggle',
    title: '切换皮肤',
    aliases: ['主题', '皮肤', 'theme'],
    group: 'appearance',
    cli: {
      id: 'theme',
      name: 'theme',
      aliases: ['主题', '皮肤'],
      usage: 'theme [default|pixel]',
      summary: '切换皮肤（不带参数就在两套之间切）',
      allowedArgs: ['default', 'pixel'],
      order: 20,
    },
    action: { kind: 'theme-toggle' },
  },

  // —— 帮助组 ——
  {
    id: 'help.commands',
    title: '命令帮助',
    aliases: ['帮助', '?', 'help'],
    group: 'help',
    shortcut: '?',
    cli: {
      id: 'help',
      name: 'help',
      aliases: ['帮助', '?'],
      usage: 'help',
      summary: '列出全部可用命令',
      order: 50,
    },
    action: { kind: 'help' },
  },
  {
    id: 'help.shortcuts',
    title: '快捷键帮助',
    aliases: ['快捷键', '快捷键表', 'shortcuts'],
    group: 'help',
    unavailable: () => appActionUnavailable('toggle-shortcut-help'),
    action: { kind: 'app-action', id: 'toggle-shortcut-help' },
  },
]);

/** 命令 id → 目录项（查不到返回 undefined）。 */
export function findAppCommand(id: string): AppCommandSpec | undefined {
  return APP_COMMANDS.find((c) => c.id === id);
}

/** 命令行绑定表（composer 的词表来源 —— 收编自 task_113 的五条 CLI 命令）。 */
export const CLI_BINDINGS: readonly CliBinding[] = Object.freeze(
  APP_COMMANDS
    .filter((c) => c.cli !== undefined)
    .map((c) => c.cli as CliBinding)
    // 按显式序排（老词表顺序：mission · theme · settings · replay · help）——
    //   分组序 ≠ 词表序（见 CliBinding.order 的注释）。
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
);

// ============================================================================
// 匹配（模糊 · 子序列）
// ============================================================================

/**
 * 子序列模糊匹配：按顺序在 haystack 里找 needle 的每个字符（大小写无关）。
 * why 不用拼音库：命令标题与别名里中文占多数，拼音库既重又不准；
 *   子序列匹配对「两个汉字」（如「像素」「日志」）与英文缩写（"thm" → "theme"）都够用。
 */
export function fuzzyMatch(haystack: string, needle: string): boolean {
  const text = haystack.toLowerCase();
  const pattern = needle.toLowerCase();
  let p = 0;
  for (let i = 0; i < text.length && p < pattern.length; i += 1) {
    if (text[i] === pattern[p]) p += 1;
  }
  return p === pattern.length;
}

/** 命令的匹配面（标题 + 别名 + 关键词 + id —— 命中任意一处即算命中）。 */
function matchText(spec: AppCommandSpec): string {
  return [spec.title, spec.id, ...spec.aliases, ...(spec.keywords ?? [])].join(' ');
}

/**
 * 按查询词过滤命令（空查询 = 原样返回）。
 * 匹配面：标题 / 别名 / 关键词 / id（子序列，容忍缩写）。
 */
export function filterAppCommands(
  commands: readonly AppCommandSpec[],
  query: string
): AppCommandSpec[] {
  const q = query.trim();
  if (!q) return [...commands];
  return commands.filter((spec) => fuzzyMatch(matchText(spec), q));
}

/** 一条命令在当前上下文下的判定结果。 */
export interface ResolvedAppCommand {
  readonly spec: AppCommandSpec;
  readonly enabled: boolean;
  /** 不可用原因（仅 !enabled 时有值 —— 灰态上显示它）。 */
  readonly reason?: string;
}

/** 判定一条命令此刻可用与否，并算出灰态原因。 */
export function resolveAppCommand(
  spec: AppCommandSpec,
  ctx: AppCommandContext
): ResolvedAppCommand {
  const reason = spec.unavailable?.(ctx) ?? null;
  return reason === null
    ? { spec, enabled: true }
    : { spec, enabled: false, reason };
}

/** 判定一批命令（面板一次性算完 —— 避免渲染时反复调判定）。 */
export function resolveAppCommands(
  commands: readonly AppCommandSpec[],
  ctx: AppCommandContext
): ResolvedAppCommand[] {
  return commands.map((spec) => resolveAppCommand(spec, ctx));
}

/** 一个分组（面板渲染的分组块）。 */
export interface AppCommandGroup {
  readonly id: AppCommandGroupId;
  readonly label: string;
  readonly items: ResolvedAppCommand[];
}

/**
 * 按分组切分（面板渲染分组标题用）。
 * 组内保持命令表原序；组间按 APP_COMMAND_GROUP_ORDER。
 */
export function groupAppCommands(
  commands: readonly ResolvedAppCommand[]
): AppCommandGroup[] {
  const groups: AppCommandGroup[] = [];
  for (const id of APP_COMMAND_GROUP_ORDER) {
    const items = commands.filter((c) => c.spec.group === id);
    if (items.length === 0) continue;
    groups.push({ id, label: APP_COMMAND_GROUP_LABELS[id], items });
  }
  return groups;
}

/**
 * 最近使用排序（置顶）。
 * why 置顶：⌘K 面板是「每天用 8 小时」的操作面 —— 高频动作应该在第一屏第一行，
 *   而不是让人每次都重新找（Raycast / Linear 的同一口径）。
 * @param order 最近使用顺序（最新在前）。
 */
export function sortByRecentUsage(
  commands: readonly AppCommandSpec[],
  order: readonly string[]
): AppCommandSpec[] {
  if (order.length === 0) return [...commands];
  const rank = new Map(order.map((id, index) => [id, index] as const));
  return [...commands].sort((a, b) => {
    const ra = rank.get(a.id) ?? Number.MAX_SAFE_INTEGER;
    const rb = rank.get(b.id) ?? Number.MAX_SAFE_INTEGER;
    if (ra !== rb) return ra - rb;
    return 0;
  });
}
