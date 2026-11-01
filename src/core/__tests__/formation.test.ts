/**
 * 单测：编队落位纯函数（core/unit/formation.ts，task_045）。
 * 血缘校验口径：master 分支 stratix-rts/systems/FormationSystem.ts 的 box 编队 ——
 * cols=ceil(√n)、网格以目标点为中心、间距 50。这里把网格几何算穷举。
 */

import { FORMATION_SPACING, computeFormationSlots } from '../unit/formation';

describe('computeFormationSlots', () => {
  test('空编队 → 空数组（runtime 据此零广播）', () => {
    expect(computeFormationSlots([], { x: 100, y: 100 })).toEqual([]);
  });

  test('单个单位 → 目标点本点（无偏移；v2 moveGroup 单人分支口径）', () => {
    expect(computeFormationSlots(['u1'], { x: 120, y: -80 })).toEqual([
      { unitId: 'u1', x: 120, y: -80 },
    ]);
  });

  test('4 人 → 2×2 网格，以目标点为中心、间距 50', () => {
    const slots = computeFormationSlots(['a', 'b', 'c', 'd'], { x: 1000, y: 0 });
    expect(slots).toEqual([
      { unitId: 'a', x: 975, y: -25 },
      { unitId: 'b', x: 1025, y: -25 },
      { unitId: 'c', x: 975, y: 25 },
      { unitId: 'd', x: 1025, y: 25 },
    ]);
    // 中心校验：四格质心 = 目标点（v2 box 编队口径）
    const cx = slots.reduce((sum, s) => sum + s.x, 0) / slots.length;
    const cy = slots.reduce((sum, s) => sum + s.y, 0) / slots.length;
    expect(cx).toBe(1000);
    expect(cy).toBe(0);
  });

  test('2-3 人（core 无坐标，v2 平移保形分支不可用）→ 紧凑小方阵', () => {
    expect(computeFormationSlots(['a', 'b'], { x: 0, y: 0 })).toEqual([
      { unitId: 'a', x: -25, y: 0 },
      { unitId: 'b', x: 25, y: 0 },
    ]);
    // ceil(√3)=2 列：2×2 网格填 3 格，首格在左上、末格补到次行首列
    expect(computeFormationSlots(['a', 'b', 'c'], { x: 0, y: 0 })).toEqual([
      { unitId: 'a', x: -25, y: -25 },
      { unitId: 'b', x: 25, y: -25 },
      { unitId: 'c', x: -25, y: 25 },
    ]);
  });

  test('5 人 → 3 列 2 行（ceil(√5)=3），末行不满自动靠左', () => {
    const slots = computeFormationSlots(['a', 'b', 'c', 'd', 'e'], { x: 0, y: 0 });
    expect(slots.map((s) => s.unitId)).toEqual(['a', 'b', 'c', 'd', 'e']);
    // 3 列：相邻列间距 50，网格宽 (3-1)*50=100 → 列心 x ∈ {-50, 0, 50}；第 4 格起换行（y=25）
    expect(slots.map((s) => s.x)).toEqual([-50, 0, 50, -50, 0]);
    expect(slots.map((s) => s.y)).toEqual([-25, -25, -25, 25, 25]);
  });

  test('7 人 → ceil(√7)=3 列 3 行，间距常量与 v2 血缘一致（50）', () => {
    expect(FORMATION_SPACING).toBe(50);
    const slots = computeFormationSlots(['u1', 'u2', 'u3', 'u4', 'u5', 'u6', 'u7'], { x: 0, y: 0 });
    expect(slots).toHaveLength(7);
    // 相邻同行间距 = 50；相邻同列间距 = 50
    expect(slots[1].x - slots[0].x).toBe(FORMATION_SPACING);
    expect(slots[3].y - slots[0].y).toBe(FORMATION_SPACING);
  });

  test('重复 id 去重保序（同一单位只占一格，不会叠出幽灵槽位）', () => {
    const slots = computeFormationSlots(['a', 'b', 'a'], { x: 0, y: 0 });
    expect(slots.map((s) => s.unitId)).toEqual(['a', 'b']);
  });

  test('槽位顺序 = 传入顺序（选择顺序即编队顺序，首格左上）', () => {
    const slots = computeFormationSlots(['z', 'y', 'x', 'w'], { x: 0, y: 0 });
    expect(slots.map((s) => s.unitId)).toEqual(['z', 'y', 'x', 'w']);
    expect(slots[0]).toMatchObject({ x: -25, y: -25 });
  });
});
