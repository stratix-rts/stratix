/**
 * 单测：单位形象精灵表的几何与命名（world/objects/unit-sprite-sheet.ts）。
 * why 单独测：这一层是**纯函数**（零 Phaser、零 DOM）—— 帧名与列数算错，
 *   战场上就是"贴错帧 / 画面糊成一团"，而这种错在肉眼手测里很难定位。
 */

import {
  MAX_UNIT_SHEET_TEXTURES,
  UNIT_FRAME_SIZE,
  UNIT_SHEET_COLUMNS,
  UNIT_SHEET_ROWS,
  UNIT_SPRITE_SCALE,
  UNIT_WALK_CYCLE,
  UNIT_WALK_DIRECTION,
  UNIT_WALK_FPS,
  resolveUnitSheetKey,
  unitFrameName,
  unitSheetTextureKey,
} from '../objects/unit-sprite-sheet';

describe('单位形象精灵表（几何与命名）', () => {
  test('纹理 key 按角色 id 走（同一角色的多个单位共用一张精灵表）', () => {
    expect(unitSheetTextureKey('character_1')).toBe('strat-unit-sheet:character_1');
    expect(unitSheetTextureKey('character_1')).not.toBe(unitSheetTextureKey('character_2'));
  });

  test('帧名 = 方向-列号', () => {
    expect(unitFrameName(2, 3)).toBe('2-3');
  });

  test('走路帧序沿用 LPC 的 cycle 表（帧序只有一份真相）', () => {
    expect(UNIT_WALK_CYCLE).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    // 列数 = 最大列号 + 1（0..8 共 9 列，其余列用不到 —— 省显存）。
    expect(UNIT_SHEET_COLUMNS).toBe(9);
  });

  test('方向行 4 行、单帧 64px、朝下', () => {
    expect(UNIT_SHEET_ROWS).toBe(4);
    expect(UNIT_FRAME_SIZE).toBe(64);
    expect(UNIT_WALK_DIRECTION).toBe(2);
  });

  test('动画参数有界（缩放 / 帧率 / 缓存上限）', () => {
    expect(UNIT_SPRITE_SCALE).toBeGreaterThan(0);
    expect(UNIT_SPRITE_SCALE).toBeLessThanOrEqual(1);
    expect(UNIT_WALK_FPS).toBeGreaterThan(0);
    // perf 硬约束：纹理缓存必须封顶（不许无限增长）。
    expect(MAX_UNIT_SHEET_TEXTURES).toBeGreaterThan(0);
    expect(Number.isFinite(MAX_UNIT_SHEET_TEXTURES)).toBe(true);
  });

  test('要不要形象精灵：外观与角色 id 都在才有（否则走占位形体）', () => {
    const appearance = { bodyType: 'male', parts: { hair: 'black' } };
    expect(resolveUnitSheetKey(appearance, 'character_1')).toBe('strat-unit-sheet:character_1');
    // 没有外观 → 没有形象可画。
    expect(resolveUnitSheetKey(null, 'character_1')).toBeNull();
    // 没有角色 id → 纹理 key 没处放。
    expect(resolveUnitSheetKey(appearance, null)).toBeNull();
    expect(resolveUnitSheetKey(undefined, undefined)).toBeNull();
  });
});
