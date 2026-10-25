/**
 * 文件职责：编组语义 —— 两种「编组」概念的最小事实集（纯函数，零依赖）：
 *   ① 派生编组（D5）：「编组 = 当前多选集合」的只读视图，mission.assign 等命令的指派对象；
 *   ② 编组槽位（@since v3.34，task_058）：Ctrl/⌘+1..9 存入 / 数字键召回的**持久化控制组**，
 *      真相在 WorldState.selectionGroups（槽位 → 单位 id 数组副本），血缘：v2 ControlGroupSystem
 *      的 create/select（旧 ControlGroupSystem 不整体迁移，只取槽位语义）。
 * 输入：SelectionState / WorldState.selectionGroups。
 * 输出：Group（去重后的单位 id 列表）与新的槽位表（不可变，同内容同引用）。
 * 禁止事项：
 *   1. 在这里做 IO / 订阅 —— 槽位写入由 core/runtime 的命令处理接线，本文件只算纯状态；
 *   2. 保存 Group 的历史副本 —— ①随选择变化而生灭，持久化会退化成第二份真相；
 *      ②例外：槽位表本身**就是**持久化语义（用户显式存入），存的是 id 副本不是引用；
 *   3. 关心单位是否存在 —— 存在性由 world 层保证（召回时 runtime 对账），core 只做集合运算；
 *   4. 引入 1..9 之外的槽位 —— 键域由契约常量 MIN/MAX_CONTROL_GROUP_SLOT 冻结，越界一律拒。
 *
 * ①仍是主路径（极薄）：旧 ControlGroupSystem 的建组/加组/删组/清组四个动作在 v3 里
 * 退化为「读一次选择集」。需要对比两次编组是否相同时用 isSameGroup，不要直接 === 比较对象。
 */

import {
  MAX_CONTROL_GROUP_SLOT,
  MIN_CONTROL_GROUP_SLOT,
  type SelectionState,
} from '../types';

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

// ============================================================================
// 编组槽位（@since v3.34，task_058）—— Ctrl/⌘+数字 存、数字键召回的持久化控制组
// ============================================================================

/** 槽位是否合法：整数且在 [MIN_CONTROL_GROUP_SLOT, MAX_CONTROL_GROUP_SLOT]（1..9）。 */
export function isControlGroupSlot(slot: number): boolean {
  return (
    Number.isInteger(slot) && slot >= MIN_CONTROL_GROUP_SLOT && slot <= MAX_CONTROL_GROUP_SLOT
  );
}

/** 读槽位成员；未存过 / groups 缺省返回空数组（不返回 null，调用方不必判空）。 */
export function readControlGroupUnitIds(
  groups: ReadonlyMap<number, readonly string[]> | undefined,
  slot: number
): readonly string[] {
  return groups?.get(slot) ?? [];
}

function sameIds(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id, i) => id === b[i]);
}

/**
 * 槽位写入（纯函数）：返回新的槽位表；同槽位同成员（含顺序）→ 原样返回同一引用，
 * 让 store 的「引用未变即不广播」约定自动生效（与 applyPreference 同口径）。
 * 值存 **副本**：存入后选择集再变不影响已存编组（快照语义，见 types.ts 字段注）。
 */
export function assignControlGroup(
  groups: ReadonlyMap<number, readonly string[]> | undefined,
  slot: number,
  unitIds: readonly string[]
): ReadonlyMap<number, readonly string[]> {
  const source = groups ?? new Map<number, readonly string[]>();
  const existing = source.get(slot);
  // 同槽位同成员幂等：早退返回同一引用（source === groups，不广播）。
  if (existing && sameIds(existing, unitIds)) return source;
  const next = new Map(source);
  next.set(slot, [...unitIds]);
  return next;
}