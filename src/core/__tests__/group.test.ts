/**
 * 单测：编组语义（编组 = 当前多选集合，无持久化编队，D5）。
 */

import { isEmptyGroup, isSameGroup, toGroup, type Group } from '../unit/group';
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