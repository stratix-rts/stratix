/**
 * 单元测试：外观解锁的 HUD 消费面（hud/screens/appearance-unlock-catalog.ts，task_041）。
 * 覆盖：等级过滤 / 角标文案（含词表外类别的防御口径）、受限重随机的合并范围（哪些类别被
 *   roll 覆盖、哪些保留现值、体型跟不跟 roll）、升级 toast 文案的条件（跨没跨过解锁门槛）。
 * 纯函数测试：不打桩、不碰 DOM —— 门槛数据本身（UNLOCKS 表穷举 / 无重复 / 词表对拍）
 *   归 src/core/__tests__/progression.test.ts（task_040 已有），本文件不重复穷举全表。
 */

import type { CharacterAppearance } from '../../core/types';

import {
  isAppearanceCategoryUnlocked,
  levelUpToastText,
  lockedCategoryBadge,
  mergeUnlockedRoll,
} from '../screens/appearance-unlock-catalog';

function appearanceOf(parts: CharacterAppearance['parts'], bodyType: CharacterAppearance['bodyType'] = 'male'): CharacterAppearance {
  return { bodyType, parts };
}

// ============================================================================
// 1. 等级过滤与角标（需求①的裁决层）
// ============================================================================

describe('lockedCategoryBadge：等级 → 角标文案', () => {
  test('L1：服装 / 饰品 / 武装 / 补全各自按门槛灰显', () => {
    expect(lockedCategoryBadge('torso', 1)).toBe('Lv.3 解锁');
    expect(lockedCategoryBadge('legs', 1)).toBe('Lv.3 解锁');
    expect(lockedCategoryBadge('hat', 1)).toBe('Lv.5 解锁');
    expect(lockedCategoryBadge('backpack', 1)).toBe('Lv.5 解锁');
    expect(lockedCategoryBadge('weapon', 1)).toBe('Lv.8 解锁');
    expect(lockedCategoryBadge('shield', 1)).toBe('Lv.8 解锁');
    expect(lockedCategoryBadge('cape', 1)).toBe('Lv.8 解锁');
    expect(lockedCategoryBadge('nose', 1)).toBe('Lv.12 解锁');
    expect(lockedCategoryBadge('shadow', 1)).toBe('Lv.12 解锁');
  });

  test('L1 基础类别（建档即有的长相底子）没有角标', () => {
    for (const category of ['body', 'head', 'hair', 'eyes', 'ears', 'facial']) {
      expect(lockedCategoryBadge(category, 1)).toBeNull();
    }
  });

  test('恰好达标（含该级当档）：L3 服装 / L5 饰品 / L8 武装 / L12 补全全部放开', () => {
    expect(lockedCategoryBadge('torso', 3)).toBeNull();
    expect(lockedCategoryBadge('feet', 3)).toBeNull();
    expect(lockedCategoryBadge('hat', 5)).toBeNull();
    expect(lockedCategoryBadge('backpack', 5)).toBeNull();
    expect(lockedCategoryBadge('cape', 8)).toBeNull();
    expect(lockedCategoryBadge('weapon', 8)).toBeNull();
    expect(lockedCategoryBadge('nose', 12)).toBeNull();
    expect(lockedCategoryBadge('quiver', 12)).toBeNull();
    expect(lockedCategoryBadge('shadow', 12)).toBeNull();
  });

  test('词表外类别（防御词表漂移）：不设门槛 —— 不角标、视为可编辑', () => {
    // world 加了新类别而 UNLOCKS 表没跟上时（对拍单测会红，但运行面不炸）。
    expect(lockedCategoryBadge('tail', 1)).toBeNull();
    expect(isAppearanceCategoryUnlocked('tail', 1)).toBe(true);
  });

  test('isAppearanceCategoryUnlocked 与角标一一对应（角标存在 = 锁定）', () => {
    expect(isAppearanceCategoryUnlocked('torso', 2)).toBe(false);
    expect(isAppearanceCategoryUnlocked('torso', 3)).toBe(true);
    expect(isAppearanceCategoryUnlocked('hat', 4)).toBe(false);
  });
});

// ============================================================================
// 2. 受限重随机（需求②：只从未解锁清单外的类别随机）
// ============================================================================

describe('mergeUnlockedRoll：编辑路径的受限合并', () => {
  const current = appearanceOf({
    body: 'light',
    hair: 'black',
    eyes: 'blue',
    // L1 角色也可能持有高等级部位（向导创建前不受限，032 口径）—— 重随机不许把它们抹掉。
    torso: { variant: 'brown_surcoat', itemId: 'torso/long/brown_surcoat' },
    hat: 'hood',
  });

  test('L1：roll 的基础类别并入，未解锁类别保留现值', () => {
    const roll = appearanceOf(
      {
        body: 'dark',
        hair: 'blonde',
        eyes: 'green',
        torso: 'white_shirt',
        hat: 'cap',
        shield: 'round',
      },
      'female'
    );

    const merged = mergeUnlockedRoll(current, roll, 1);

    // 已解锁类别 → 跟 roll。
    expect(merged.bodyType).toBe('female'); // 体型跟 roll（body 是 L1 类别）
    expect(merged.parts.body).toBe('dark');
    expect(merged.parts.hair).toBe('blonde');
    expect(merged.parts.eyes).toBe('green');
    // 未解锁类别 → 保留草稿现值（精确选择形态原样保留，不降级成纯变体串）。
    expect(merged.parts.torso).toEqual({ variant: 'brown_surcoat', itemId: 'torso/long/brown_surcoat' });
    expect(merged.parts.hat).toBe('hood');
    expect(merged.parts.shield).toBeUndefined();
  });

  test('L12：全类别已解锁 → roll 全量并入', () => {
    const roll = appearanceOf({ torso: 'white_shirt', hat: 'cap', nose: 'big' });

    const merged = mergeUnlockedRoll(current, roll, 12);

    expect(merged.parts.torso).toBe('white_shirt');
    expect(merged.parts.hat).toBe('cap');
    expect(merged.parts.nose).toBe('big');
  });

  test('roll 没提供的已解锁类别不被删除（随机没抽到 ≠ 用户不想要）', () => {
    // roll 只给了 hair：eyes / torso / hat 都保持现值。
    const roll = appearanceOf({ hair: 'red' });

    const merged = mergeUnlockedRoll(current, roll, 12);

    expect(merged.parts.eyes).toBe('blue');
    expect(merged.parts.torso).toEqual({ variant: 'brown_surcoat', itemId: 'torso/long/brown_surcoat' });
    expect(merged.parts.hat).toBe('hood');
  });

  test('不可变：current 与 roll 都不被原地修改', () => {
    const before = JSON.parse(JSON.stringify(current)) as CharacterAppearance;
    const roll = appearanceOf({ hair: 'red', hat: 'cap' });

    mergeUnlockedRoll(current, roll, 12);

    expect(current).toEqual(before);
    expect(roll.parts.hat).toBe('cap');
  });
});

// ============================================================================
// 3. 升级 toast 文案（需求③：跨过解锁门槛才带「解锁新外观部件」）
// ============================================================================

describe('levelUpToastText：文案条件', () => {
  test('跨过门槛（L2→L3 服装档）→ 带解锁后半句', () => {
    expect(levelUpToastText('Neo', 2, 3)).toBe('Neo 升到 Lv.3！解锁新外观部件');
  });

  test('门槛之间（L3→L4）→ 只报升级，不带解锁', () => {
    expect(levelUpToastText('Neo', 3, 4)).toBe('Neo 升到 Lv.4！');
  });

  test('L1→L2（无新类别）→ 只报升级', () => {
    expect(levelUpToastText('Trinity', 1, 2)).toBe('Trinity 升到 Lv.2！');
  });

  test('连升跨多档（L4→L8）→ 带解锁后半句', () => {
    expect(levelUpToastText('Neo', 4, 8)).toBe('Neo 升到 Lv.8！解锁新外观部件');
  });

  test('L11→L12（补全档 + rare_variants 标记位）→ 带解锁后半句', () => {
    expect(levelUpToastText('Neo', 11, 12)).toBe('Neo 升到 Lv.12！解锁新外观部件');
  });

  test('非升级（to ≤ from 的脏输入）→ 只报升级不越权追加', () => {
    expect(levelUpToastText('Neo', 5, 5)).toBe('Neo 升到 Lv.5！');
    expect(levelUpToastText('Neo', 6, 5)).toBe('Neo 升到 Lv.5！');
  });
});
