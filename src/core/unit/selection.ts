/**
 * 文件职责：单位选择状态机（纯函数）—— 从 stratix-rts/managers/SelectionManager 抽取的纯逻辑。
 * 输入：当前 SelectionState + 一个 SelectionAction。
 * 输出：新的 SelectionState 与本次变化的 added / removed 增量（供 HUD 做局部渲染）。
 * 禁止事项：
 *   1. 引入 Phaser / rxjs / 事件总线 —— 本文件只算状态，不发事件（发事件由 store/bus 层负责）；
 *   2. 直接修改传入的 state —— 必须返回新对象，选择态是 immutable；
 *   3. 出现 Zone 相关分支 —— Zone 已整体砍掉（D5），这里只处理 Agent 单位；
 *   4. 持有单位位置 —— 位置由世界层自治，框选命中判定在 world 侧完成，core 只收结果 id。
 *
 * 语义沿用旧 SelectionManager 的 SelectionMode（Replace/Add/Remove/Toggle），
 * 另补三条世界侧需要的动作：all / invert / reconcile（单位消失后清理选择）与 preview。
 */

import { MAX_SELECTION_SIZE, type SelectionState } from '../types';

export type SelectionAction =
  /** 替换为给定集合（框选完成、单击单位）。 */
  | { type: 'set'; unitIds: readonly string[] }
  | { type: 'add'; unitIds: readonly string[] }
  | { type: 'remove'; unitIds: readonly string[] }
  /** 命中则在集合内、命中则移出（HUD 命令 mode:'toggle' 与 Ctrl/⌘ 点击都走这里）。 */
  | { type: 'toggle'; unitIds: readonly string[] }
  | { type: 'clear' }
  /** 全选：并入已知单位全集（Set），让选择集只含仍然存在的单位。 */
  | { type: 'all'; knownUnitIds: readonly string[] }
  /** 反选：取已知单位全集的补集。 */
  | { type: 'invert'; knownUnitIds: readonly string[] }
  /** 对账：单位销毁后清掉悬空 id，不引入任何新单位。 */
  | { type: 'reconcile'; knownUnitIds: readonly string[] }
  /** 框选拖拽中的实时预览；unitIds 为空表示取消预览。 */
  | { type: 'preview'; unitIds: readonly string[] };

export interface SelectionChange {
  readonly next: SelectionState;
  readonly added: readonly string[];
  readonly removed: readonly string[];
  /** false 表示选择集实质未变，调用方可跳过广播（perf：高频 preview 不触发全量重渲染）。 */
  readonly changed: boolean;
}

/** 去重 + 截断到 MAX_SELECTION_SIZE。保序：框选按世界层给出的顺序（一般即视觉顺序）保留前 N 个。 */
function normalize(unitIds: readonly string[]): string[] {
  return Array.from(new Set(unitIds)).slice(0, MAX_SELECTION_SIZE);
}

function sameOrder(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id, i) => id === b[i]);
}

function diff(
  prev: readonly string[],
  next: readonly string[]
): { added: string[]; removed: string[] } {
  const prevSet = new Set(prev);
  const nextSet = new Set(next);
  return {
    added: next.filter((id) => !prevSet.has(id)),
    removed: prev.filter((id) => !nextSet.has(id)),
  };
}

function resolveUnitIds(
  current: readonly string[],
  unitIds: readonly string[],
  mode: 'add' | 'remove' | 'toggle' | 'set'
): string[] {
  const incoming = normalize(unitIds);
  // set 保持传入顺序；其余模式在当前顺序上追加，保证 UI 选择顺序稳定
  if (mode === 'set') return incoming;

  const next = new Set(current);
  incoming.forEach((id) => {
    const selected = next.has(id);
    if (mode === 'add') next.add(id);
    else if (mode === 'remove') next.delete(id);
    else if (selected) next.delete(id);
    else next.add(id);
  });
  return Array.from(next).slice(0, MAX_SELECTION_SIZE);
}

function resolveKnown(
  current: readonly string[],
  knownUnitIds: readonly string[],
  mode: 'all' | 'invert'
): string[] {
  const known = new Set(normalize(knownUnitIds));
  if (mode === 'all') return Array.from(known);
  // 反选 = 已知单位全集减去当前选择；选择集里的悬空 id 顺势被丢弃
  const selected = new Set(current);
  return Array.from(known).filter((id) => !selected.has(id));
}

/** 选择集实质未变：原样返回 current（引用不变），调用方可据此跳过广播。 */
function unchanged(current: SelectionState): SelectionChange {
  return { next: current, added: [], removed: [], changed: false };
}

export function applySelectionAction(
  current: SelectionState,
  action: SelectionAction
): SelectionChange {
  if (action.type === 'preview') {
    const previewUnitIds = normalize(action.unitIds);
    if (sameOrder(current.previewUnitIds, previewUnitIds)) return unchanged(current);
    return {
      next: { ...current, previewUnitIds },
      added: [],
      removed: [],
      changed: true,
    };
  }

  let unitIds: string[];
  switch (action.type) {
    case 'set':
    case 'add':
    case 'remove':
    case 'toggle':
      unitIds = resolveUnitIds(current.unitIds, action.unitIds, action.type);
      break;
    case 'all':
    case 'invert':
      unitIds = resolveKnown(current.unitIds, action.knownUnitIds, action.type);
      break;
    case 'reconcile':
      unitIds = current.unitIds.filter((id) => action.knownUnitIds.includes(id));
      break;
    case 'clear':
      unitIds = [];
      break;
  }

  if (sameOrder(current.unitIds, unitIds)) return unchanged(current);

  const { added, removed } = diff(current.unitIds, unitIds);
  return {
    next: {
      unitIds,
      previewUnitIds: action.type === 'set' ? [] : current.previewUnitIds,
      revision: current.revision + 1,
    },
    added,
    removed,
    changed: true,
  };
}

export const createSelectionState = (): SelectionState => ({
  unitIds: [],
  previewUnitIds: [],
  revision: 0,
});