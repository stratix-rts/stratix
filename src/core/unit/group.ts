/**
 * 文件职责：编组语义 —— 编组就是"当前多选集合"的派生视图（D5：v3 不做持久化编队）。
 * 输入：SelectionState。
 * 输出：Group（去重后的单位 id 列表），供 mission.assign 等命令作为指派对象。
 * 禁止事项：
 *   1. 引入编队槽位 / Ctrl+数字键 1~9 那种持久编队 —— 已明确 v3 不做，旧 ControlGroupSystem 不迁移；
 *   2. 保存 Group 的历史副本 —— 编组随选择变化而生灭，持久化会退化成第二份真相；
 *   3. 关心单位是否存在 —— 存在性由 world 层保证，core 只做集合运算。
 *
 * 因此本模块极薄：旧 ControlGroupSystem 的建组/加组/删组/清组四个动作在 v3 里全部退化为
 * 「读一次选择集」。需要对比两次编组是否相同时用 isSameGroup，不要直接 === 比较对象。
 */

import type { SelectionState } from '../types';

export interface Group {
  readonly unitIds: readonly string[];
}

/** 当前选择集即编组。空选择返回空编组（不返回 null，调用方不必判空）。 */
export function toGroup(selection: SelectionState): Group {
  return { unitIds: Array.from(new Set(selection.unitIds)) };
}

/** 编组是否等价（与顺序无关）：用于"指派对象有没有变"这类判断，避免多余广播。 */
export function isSameGroup(a: Group, b: Group): boolean {
  if (a.unitIds.length !== b.unitIds.length) return false;
  const setB = new Set(b.unitIds);
  return a.unitIds.every((id) => setB.has(id));
}

/** 编组是否为空。任务确认流（hud/panels/mission-confirm）用它决定要不要弹确认。 */
export function isEmptyGroup(group: Group): boolean {
  return group.unitIds.length === 0;
}