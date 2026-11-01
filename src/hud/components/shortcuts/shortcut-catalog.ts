/**
 * 文件职责：快捷键系统（task_058）的**单一事实源** —— 键位目录（集中常量）+ 键击解析
 *   （纯函数）+ 可编辑元素豁免判定。口径移植自 v2 的 ui/ShortcutManager.ts（考古版）：
 *   v2 是「注册表 + 上下文 + 优先级」的重系统，v3 只取它的**键位表与判定口径**
 *   （keydown 事件、修饰键 Ctrl/⌘ 等价、? 帮助、Ctrl+N/裸数字编组对、Space 居中、Esc 取消），
 *   砍掉 context 切换 / 冲突检测 / 搜索 / 单例生命周期（当前没有第二个键盘入口要仲裁）。
 * 输入：KeyboardEventLike（浏览器 KeyboardEvent 的形状子集 —— 测试可直接造对象）。
 * 输出：ShortcutAction（由 shortcut-manager 翻译成 HudCommand）或 null（未命中）。
 * 禁止事项：
 *   1. 触碰 DOM / 订阅事件 —— 本文件必须能在 node 环境单测，监听是 manager 的事；
 *   2. import world/、app/ —— 铁律；core 只 import types 常量（槽位上下限）；
 *   3. 在这里发命令 —— 解析与派发分离，才能分别测「映射表」与「命令分发」两段；
 *   4. 各自抄一份键位 —— 帮助浮层（shortcut-help）的清单必须从本文件导出的目录渲染。
 *
 * @since v3.34（task_058）。
 */

import {
  MAX_CONTROL_GROUP_SLOT,
  MIN_CONTROL_GROUP_SLOT,
} from '../../../core/types';

// ============================================================================
// 键击形状（KeyboardEvent 的判定子集）
// ============================================================================

/** 判定所需的键盘事件形状（浏览器 KeyboardEvent 满足它；测试可注入普通对象）。 */
export interface KeyboardEventLike {
  readonly key: string;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly shiftKey: boolean;
  readonly altKey: boolean;
}

// ============================================================================
// 动作模型（解析结果 → manager 翻译成 HudCommand / 帮助浮层开关）
// ============================================================================

/**
 * 一次键击解析出的动作。槽位用 number（1..9，契约常量冻结），
 * 命令构造在 manager —— 本文件只回答「按了什么」，不回答「发什么」。
 */
export type ShortcutAction =
  | { type: 'selectAll' }
  | { type: 'deselect' }
  | { type: 'groupAssign'; slot: number }
  | { type: 'groupRecall'; slot: number }
  | { type: 'centerSelection' }
  | { type: 'toggleHelp' }
  | { type: 'closeHelp' };

// ============================================================================
// 键位目录（帮助浮层的数据源；血缘注记 v2 ShortcutManager 的注册项）
// ============================================================================

/** 帮助浮层的分组。顺序即渲染顺序（mouse 组是 045 既有交互的展示面，纯文档无键处理器）。 */
export type ShortcutCategoryId = 'selection' | 'groups' | 'camera' | 'help' | 'mouse';

export const SHORTCUT_CATEGORY_LABELS: Readonly<Record<ShortcutCategoryId, string>> = {
  selection: '选择',
  groups: '编组',
  camera: '镜头',
  help: '帮助',
  mouse: '鼠标',
};

/** 一条键位的文档项（展示用；keys 是人读的显示串，判定逻辑在 resolveShortcutAction）。 */
export interface ShortcutDoc {
  readonly id: string;
  readonly keys: readonly string[];
  readonly description: string;
  readonly category: ShortcutCategoryId;
}

/**
 * 键位表（集中常量 —— 后续做「设置面板改键」时只动这里）。
 * 血缘：v2 ShortcutManager.initializeDefaultShortcuts 的 select-all / deselect /
 *   create-group-N / select-group-N / center-view / help 六族；显示串沿用 v2 词表。
 * mouse 组的三条是 045 已落地交互（框选 / Shift 加选 / 右击移动）+ 057 小地图，
 *   只进帮助浮层展示，不参与键击解析。
 */
export const SHORTCUT_CATALOG: readonly ShortcutDoc[] = [
  {
    id: 'select-all',
    keys: ['Ctrl/⌘ + A'],
    description: '全选：选中战场上全部单位',
    category: 'selection',
  },
  {
    id: 'deselect',
    keys: ['Esc'],
    description: '取消选择（帮助浮层打开时优先关闭浮层）',
    category: 'selection',
  },
  {
    id: 'box-select',
    keys: ['左键拖拽'],
    description: '框选单位（task_045）',
    category: 'mouse',
  },
  {
    id: 'add-to-selection',
    keys: ['Shift + 点击'],
    description: '加选 / 减选单位（task_045）',
    category: 'mouse',
  },
  {
    id: 'move-command',
    keys: ['右键'],
    description: '把选中编队移动到目标点（task_045）',
    category: 'mouse',
  },
  {
    id: 'create-group',
    keys: [`Ctrl/⌘ + ${MIN_CONTROL_GROUP_SLOT}…${MAX_CONTROL_GROUP_SLOT}`],
    description: '编组：把当前选择存入对应槽位',
    category: 'groups',
  },
  {
    id: 'select-group',
    keys: [`${MIN_CONTROL_GROUP_SLOT}…${MAX_CONTROL_GROUP_SLOT}`],
    description: '召回编组：选中对应槽位的成员',
    category: 'groups',
  },
  {
    id: 'center-view',
    keys: ['Space'],
    description: '居中选中单位（无选中回世界中心）',
    category: 'camera',
  },
  {
    id: 'help',
    keys: ['?'],
    description: '开关快捷键帮助浮层',
    category: 'help',
  },
];

// ============================================================================
// 键击解析（纯函数）
// ============================================================================

/** Ctrl 或 ⌘（macOS）：两键等价（v2 同口径 —— 修饰判定只认 ctrlKey || metaKey）。 */
function hasCmd(mods: Pick<KeyboardEventLike, 'ctrlKey' | 'metaKey'>): boolean {
  return mods.ctrlKey || mods.metaKey;
}

/** 键是不是 1..9 槽位数字；是则返回槽位号，否则 null（'0' 不是槽位，排除）。 */
function digitSlot(key: string): number | null {
  if (!/^[1-9]$/.test(key)) return null;
  return Number.parseInt(key, 10);
}

/**
 * 键击 → 动作（纯函数）。返回 null = 未命中（manager 不拦截、不 preventDefault）。
 *
 * 判定口径（与 v2 的注册表等价的精简版）：
 *   - Ctrl/⌘（不含 Shift/Alt）+ A = 全选；+ 数字 = 编组存入；
 *   - 裸键（无任何修饰）数字 = 召回编组；Space = 居中选中；
 *   - Esc（无 Ctrl/⌘/Alt）= 帮助浮层开着先关浮层，否则取消选择；
 *   - ?（Shift+/ 的产物键，无 Ctrl/⌘/Alt）= 开关帮助浮层；
 *   - 其余（含 Shift/Alt 组合、'0'、其它字母）一律不命中 —— 宁可少拦，不抢输入法的键。
 */
export function resolveShortcutAction(
  keyboard: KeyboardEventLike,
  helpOpen: boolean
): ShortcutAction | null {
  const { key } = keyboard;

  // Esc：帮助浮层打开时优先关闭（浮层自身是临时态，先于业务取消）。
  if (key === 'Escape' || key === 'Esc') {
    if (hasCmd(keyboard) || keyboard.altKey) return null;
    return helpOpen ? { type: 'closeHelp' } : { type: 'deselect' };
  }

  if (hasCmd(keyboard) && !keyboard.shiftKey && !keyboard.altKey) {
    if (key.toLowerCase() === 'a') return { type: 'selectAll' };
    const slot = digitSlot(key);
    if (slot !== null) return { type: 'groupAssign', slot };
    return null;
  }

  // ?：Shift+/ 的产物键（其它键盘布局可能不同 —— 按产物键判定，不重组修饰）。
  // 放在裸键分支之前：裸 '?'（无 Shift）也是合法形态，不能被裸键分支的 return null 吃掉。
  if (!hasCmd(keyboard) && !keyboard.altKey && key === '?') {
    return { type: 'toggleHelp' };
  }

  // 裸键（无任何修饰）：数字召回 / Space 居中。
  if (!hasCmd(keyboard) && !keyboard.shiftKey && !keyboard.altKey) {
    const slot = digitSlot(key);
    if (slot !== null) return { type: 'groupRecall', slot };
    if (key === ' ' || key === 'Spacebar') return { type: 'centerSelection' };
    return null;
  }

  return null;
}

// ============================================================================
// 可编辑元素豁免（输入框聚焦时全局快捷键不劫持 —— task_058 规格②）
// ============================================================================

/**
 * 事件目标是不是「用户正在打字的地方」：input / textarea / select 或 contenteditable。
 * 命中则全部快捷键让路（否则在任务标题框里按 1 会突然召回编组、按 Ctrl+A 会全选战场）。
 * v2 的 ShortcutManager 没做这层（它只管注册表）；这是 v3 补的口径 —— 常见实现即此三查。
 * typeof 守卫：非 DOM 环境（node 单测）没有 HTMLElement，非元素目标一律不算可编辑。
 */
export function isEditableTarget(target: EventTarget | null): boolean {
  if (typeof HTMLElement === 'undefined' || !(target instanceof HTMLElement)) return false;
  // contenteditable 两查：isContentEditable（浏览器实时计算）+ 属性字面量（jsdom 不算样式，
  // isContentEditable 恒 undefined —— 测试环境也得能豁免，两查在两边都准）。
  const attr = target.getAttribute('contenteditable');
  if (target.isContentEditable || attr === 'true' || attr === '' || attr === 'plaintext-only') {
    return true;
  }
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

/**
 * 事件目标是不是「空格键有原生语义的控件」（button / a / summary：空格 = 激活）。
 * 只对 Space 居中让路：点了 HUD 按钮后焦点留在按钮上，此时按空格应再次点它，
 * 而不是把相机拉走（其余快捷键与按钮无冲突，照常生效）。
 * typeof 守卫与 isEditableTarget 同口径。
 */
export function isActivatableTarget(target: EventTarget | null): boolean {
  if (typeof HTMLElement === 'undefined' || !(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === 'BUTTON' || tag === 'A' || tag === 'SUMMARY';
}

// ============================================================================
// 显示格式化（v2 ShortcutManager.formatKeyDisplay 的口径移植）
// ============================================================================

/**
 * 修饰键记号化（Ctrl→⌃ Shift→⇧ Alt→⌥ Meta→⌘）并把 + 两侧归一成「 + 」
 *（输入可能自带空格也可能不带 —— 归一化后才不会出现双空格）。帮助浮层渲染用。
 */
export function formatShortcutDisplay(key: string): string {
  return key
    .replace(/Ctrl/g, '⌃')
    .replace(/Shift/g, '⇧')
    .replace(/Alt/g, '⌥')
    .replace(/Meta/g, '⌘')
    .replace(/\s*\+\s*/g, ' + ');
}
