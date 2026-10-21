/**
 * 单测：单位选择状态机全路径（core/unit/selection.ts）。
 * 覆盖：set / add / remove / toggle / clear / all / invert / reconcile / preview
 *      + 去重、上限截断、revision 单调性、无变化时不广播。
 */

import { MAX_SELECTION_SIZE } from '../types';
import { applySelectionAction, createSelectionState, type SelectionAction } from '../unit/selection';
import type { SelectionState } from '../types';

const run = (
  state: SelectionState,
  ...actions: SelectionAction[]
): SelectionState => actions.reduce((s, a) => applySelectionAction(s, a).next, state);

describe('applySelectionAction', () => {
  describe('set', () => {
    test('替换整个选择集', () => {
      const next = run(createSelectionState(), { type: 'set', unitIds: ['a', 'b'] });
      expect(next.unitIds).toEqual(['a', 'b']);
      expect(next.revision).toBe(1);
    });

    test('保留传入顺序', () => {
      const next = run(createSelectionState(), { type: 'set', unitIds: ['b', 'a'] });
      expect(next.unitIds).toEqual(['b', 'a']);
    });

    test('去重', () => {
      const next = run(createSelectionState(), { type: 'set', unitIds: ['a', 'a', 'b'] });
      expect(next.unitIds).toEqual(['a', 'b']);
    });

    test('覆盖既有选择', () => {
      const next = run(
        createSelectionState(),
        { type: 'set', unitIds: ['a'] },
        { type: 'set', unitIds: ['b'] }
      );
      expect(next.unitIds).toEqual(['b']);
    });

    test('截断到 MAX_SELECTION_SIZE', () => {
      const many = Array.from({ length: MAX_SELECTION_SIZE + 10 }, (_, i) => `u${i}`);
      const next = run(createSelectionState(), { type: 'set', unitIds: many });
      expect(next.unitIds).toHaveLength(MAX_SELECTION_SIZE);
      expect(next.unitIds[0]).toBe('u0');
    });
  });

  describe('add / remove', () => {
    test('add 追加且不动已有顺序', () => {
      const next = run(
        createSelectionState(),
        { type: 'set', unitIds: ['a'] },
        { type: 'add', unitIds: ['b'] }
      );
      expect(next.unitIds).toEqual(['a', 'b']);
    });

    test('add 幂等', () => {
      const next = run(
        createSelectionState(),
        { type: 'set', unitIds: ['a'] },
        { type: 'add', unitIds: ['a'] }
      );
      expect(next.unitIds).toEqual(['a']);
    });

    test('remove 移除指定单位', () => {
      const next = run(
        createSelectionState(),
        { type: 'set', unitIds: ['a', 'b'] },
        { type: 'remove', unitIds: ['a'] }
      );
      expect(next.unitIds).toEqual(['b']);
    });

    test('remove 未选中单位不报错', () => {
      const next = run(
        createSelectionState(),
        { type: 'set', unitIds: ['a'] },
        { type: 'remove', unitIds: ['zzz'] }
      );
      expect(next.unitIds).toEqual(['a']);
    });
  });

  describe('toggle', () => {
    test('未选中 → 选中', () => {
      const next = run(createSelectionState(), { type: 'toggle', unitIds: ['a'] });
      expect(next.unitIds).toEqual(['a']);
    });

    test('已选中 → 移出', () => {
      const next = run(
        createSelectionState(),
        { type: 'set', unitIds: ['a', 'b'] },
        { type: 'toggle', unitIds: ['b'] }
      );
      expect(next.unitIds).toEqual(['a']);
    });

    test('批量 toggle 逐个生效', () => {
      const next = run(
        createSelectionState(),
        { type: 'set', unitIds: ['a'] },
        { type: 'toggle', unitIds: ['a', 'b'] }
      );
      expect(next.unitIds).toEqual(['b']);
    });
  });

  describe('clear', () => {
    test('清空选择集', () => {
      const next = run(
        createSelectionState(),
        { type: 'set', unitIds: ['a', 'b'] },
        { type: 'clear' }
      );
      expect(next.unitIds).toEqual([]);
    });

    test('空集合上 clear 是无变化', () => {
      const change = applySelectionAction(createSelectionState(), { type: 'clear' });
      expect(change.changed).toBe(false);
      expect(change.next.revision).toBe(0);
    });
  });

  describe('all / invert', () => {
    const known = ['a', 'b', 'c'];

    test('all 选中全部已知单位', () => {
      const next = run(createSelectionState(), { type: 'all', knownUnitIds: known });
      expect(next.unitIds).toEqual(known);
    });

    test('all 丢弃悬空 id', () => {
      const next = run(
        createSelectionState(),
        { type: 'set', unitIds: ['gone'] },
        { type: 'all', knownUnitIds: known }
      );
      expect(next.unitIds).toEqual(known);
    });

    test('invert 取补集', () => {
      const next = run(
        createSelectionState(),
        { type: 'set', unitIds: ['a'] },
        { type: 'invert', knownUnitIds: known }
      );
      expect(next.unitIds).toEqual(['b', 'c']);
    });

    test('invert 丢弃选择集里的悬空 id', () => {
      const next = run(
        createSelectionState(),
        { type: 'set', unitIds: ['gone'] },
        { type: 'invert', knownUnitIds: known }
      );
      expect(next.unitIds).toEqual(known);
    });

    test('invert 两次回到原状', () => {
      const start = run(createSelectionState(), { type: 'set', unitIds: ['a'] });
      const once = run(start, { type: 'invert', knownUnitIds: known });
      const twice = run(once, { type: 'invert', knownUnitIds: known });
      expect(twice.unitIds).toEqual(['a']);
    });
  });

  describe('reconcile', () => {
    test('单位销毁后清掉悬空 id', () => {
      const next = run(
        createSelectionState(),
        { type: 'set', unitIds: ['a', 'b'] },
        { type: 'reconcile', knownUnitIds: ['a'] }
      );
      expect(next.unitIds).toEqual(['a']);
    });

    test('单位全部销毁 → 空选择', () => {
      const next = run(
        createSelectionState(),
        { type: 'set', unitIds: ['a'] },
        { type: 'reconcile', knownUnitIds: [] }
      );
      expect(next.unitIds).toEqual([]);
    });

    test('reconcile 不引入新单位', () => {
      const next = run(
        createSelectionState(),
        { type: 'set', unitIds: ['a'] },
        { type: 'reconcile', knownUnitIds: ['a', 'new'] }
      );
      expect(next.unitIds).toEqual(['a']);
    });
  });

  describe('preview', () => {
    test('写入预览集合', () => {
      const next = run(createSelectionState(), { type: 'preview', unitIds: ['a', 'b'] });
      expect(next.previewUnitIds).toEqual(['a', 'b']);
    });

    test('预览不影响已选集合', () => {
      const next = run(
        createSelectionState(),
        { type: 'set', unitIds: ['a'] },
        { type: 'preview', unitIds: ['a', 'b'] }
      );
      expect(next.unitIds).toEqual(['a']);
    });

    test('空预览 = 取消预览', () => {
      const next = run(
        createSelectionState(),
        { type: 'preview', unitIds: ['a'] },
        { type: 'preview', unitIds: [] }
      );
      expect(next.previewUnitIds).toEqual([]);
    });

    test('set 完成后清空预览', () => {
      const next = run(
        createSelectionState(),
        { type: 'preview', unitIds: ['a', 'b'] },
        { type: 'set', unitIds: ['a', 'b'] }
      );
      expect(next.previewUnitIds).toEqual([]);
      expect(next.unitIds).toEqual(['a', 'b']);
    });

    test('相同预览不重复通知', () => {
      const start = run(createSelectionState(), { type: 'preview', unitIds: ['a'] });
      const change = applySelectionAction(start, { type: 'preview', unitIds: ['a'] });
      expect(change.changed).toBe(false);
      expect(change.next).toBe(start);
    });
  });

  describe('增量与 revision', () => {
    test('报告 added / removed', () => {
      const start = run(createSelectionState(), { type: 'set', unitIds: ['a', 'b'] });
      const change = applySelectionAction(start, { type: 'toggle', unitIds: ['a', 'c'] });
      expect(change.added).toEqual(['c']);
      expect(change.removed).toEqual(['a']);
    });

    test('revision 随每次实质变化 +1', () => {
      const next = run(
        createSelectionState(),
        { type: 'set', unitIds: ['a'] },
        { type: 'add', unitIds: ['b'] },
        { type: 'remove', unitIds: ['a'] }
      );
      expect(next.revision).toBe(3);
    });

    test('无实质变化时 revision 不动、可跳过广播', () => {
      const start = run(createSelectionState(), { type: 'set', unitIds: ['a'] });
      const change = applySelectionAction(start, { type: 'set', unitIds: ['a'] });
      expect(change.changed).toBe(false);
      expect(change.next.revision).toBe(start.revision);
    });

    test('不修改传入的 state（immutable）', () => {
      const start = createSelectionState();
      const snapshot = JSON.stringify(start);
      applySelectionAction(start, { type: 'set', unitIds: ['a'] });
      expect(JSON.stringify(start)).toBe(snapshot);
    });
  });
});