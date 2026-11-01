/**
 * 单测：编组语义（①编组 = 当前多选集合的派生视图，D5；②编组槽位，@since v3.34 task_058）。
 */

import {
  assignControlGroup,
  isEmptyGroup,
  isControlGroupSlot,
  isSameGroup,
  readControlGroupUnitIds,
  toGroup,
  type Group,
} from '../unit/group';
import { applySelectionAction, createSelectionState } from '../unit/selection';

describe('toGroup', () => {
  test('编组即当前选择集', () => {
    const selection = applySelectionAction(createSelectionState(), {
      type: 'set',
      unitIds: ['a', 'b'],
    }).next;
    expect(toGroup(selection).unitIds).toEqual(['a', 'b']);
  });

  test('空选择得到空编组而非 null', () => {
    const group = toGroup(createSelectionState());
    expect(group.unitIds).toEqual([]);
    expect(isEmptyGroup(group)).toBe(true);
  });

  test('去重（防御外部传入重复 id）', () => {
    const group: Group = { unitIds: ['a', 'a'] };
    expect(toGroup({ ...createSelectionState(), unitIds: group.unitIds }).unitIds).toEqual(['a']);
  });

  test('编组是副本，外部改动不影响选择集', () => {
    const selection = applySelectionAction(createSelectionState(), {
      type: 'set',
      unitIds: ['a'],
    }).next;
    const group = toGroup(selection);
    (group.unitIds as string[]).push('b');
    expect(selection.unitIds).toEqual(['a']);
  });

  test('预览中的单位不算进编组', () => {
    const selection = applySelectionAction(createSelectionState(), {
      type: 'preview',
      unitIds: ['x'],
    }).next;
    expect(isEmptyGroup(toGroup(selection))).toBe(true);
  });
});

describe('isSameGroup', () => {
  test('顺序不同仍判定相同', () => {
    expect(isSameGroup({ unitIds: ['a', 'b'] }, { unitIds: ['b', 'a'] })).toBe(true);
  });

  test('成员不同判定不同', () => {
    expect(isSameGroup({ unitIds: ['a', 'b'] }, { unitIds: ['a'] })).toBe(false);
  });

  test('两个空编组相同', () => {
    expect(isSameGroup({ unitIds: [] }, { unitIds: [] })).toBe(true);
  });
});

describe('isEmptyGroup', () => {
  test('有成员为非空', () => {
    expect(isEmptyGroup({ unitIds: ['a'] })).toBe(false);
  });
});

// ============================================================================
// 编组槽位（@since v3.34，task_058）—— Ctrl/⌘+数字存入 / 数字键召回的持久化控制组
// ============================================================================

describe('isControlGroupSlot', () => {
  test('1..9 合法；0 / 10 / 小数 / 非整数拒', () => {
    for (let slot = 1; slot <= 9; slot += 1) expect(isControlGroupSlot(slot)).toBe(true);
    expect(isControlGroupSlot(0)).toBe(false);
    expect(isControlGroupSlot(10)).toBe(false);
    expect(isControlGroupSlot(1.5)).toBe(false);
    expect(isControlGroupSlot(NaN)).toBe(false);
  });
});

describe('assignControlGroup', () => {
  test('写入新槽位：返回新表，旧表不动（不可变）', () => {
    const base = new Map<number, readonly string[]>([[1, ['a']]]);
    const next = assignControlGroup(base, 2, ['b', 'c']);
    expect(next).not.toBe(base);
    expect(next.get(1)).toEqual(['a']);
    expect(next.get(2)).toEqual(['b', 'c']);
    // 原表未被改动（旧引用上没有槽位 2）
    expect(base.has(2)).toBe(false);
  });

  test('值存副本：存入后改原数组不影响已存编组', () => {
    const ids = ['a', 'b'];
    const next = assignControlGroup(undefined, 1, ids);
    ids.push('c');
    expect(next.get(1)).toEqual(['a', 'b']);
  });

  test('同槽位同成员幂等：返回同一引用（store 「无变化不广播」的开关）', () => {
    const base = assignControlGroup(undefined, 3, ['x', 'y']);
    const again = assignControlGroup(base, 3, ['x', 'y']);
    expect(again).toBe(base);
  });

  test('同槽位不同成员 / 不同顺序都算变化', () => {
    const base = assignControlGroup(undefined, 3, ['x', 'y']);
    expect(assignControlGroup(base, 3, ['x'])).not.toBe(base);
    expect(assignControlGroup(base, 3, ['y', 'x'])).not.toBe(base);
  });

  test('覆盖旧槽位：整组替换而不是追加', () => {
    const base = assignControlGroup(undefined, 2, ['a', 'b']);
    const next = assignControlGroup(base, 2, ['z']);
    expect(next.get(2)).toEqual(['z']);
    expect(next.get(2)).toHaveLength(1);
  });

  test('undefined 起步：新表 + 新槽位（缺省态可直接写入）', () => {
    const next = assignControlGroup(undefined, 1, ['a']);
    expect(next.get(1)).toEqual(['a']);
    expect(next.size).toBe(1);
  });
});

describe('readControlGroupUnitIds', () => {
  test('未存过 / 表缺省 → 空数组（不返回 null）', () => {
    expect(readControlGroupUnitIds(undefined, 1)).toEqual([]);
    expect(readControlGroupUnitIds(new Map(), 5)).toEqual([]);
  });

  test('存过 → 原样读出', () => {
    const groups = assignControlGroup(undefined, 4, ['m', 'n']);
    expect(readControlGroupUnitIds(groups, 4)).toEqual(['m', 'n']);
  });
});