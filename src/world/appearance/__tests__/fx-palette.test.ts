/**
 * 单测：特效调色板的 world 侧读口（world/appearance/fx-palette.ts）。
 * 覆盖：从 registry 读表、缺表走兜底、非法表走兜底、读口不缓存（皮肤随时能切）。
 * 依赖：纯逻辑（Phaser registry 只需满足 { get(key) } 这个最小面）。
 *
 * @since v3.3（task_162）
 */

import { FX_PALETTE_FALLBACK } from '../../../core/theme/fx-palette';
import { FX_PALETTE_KEY, readFxPalette, type PaletteStore } from '../fx-palette';

/** 造一个只认一个键的假 registry。 */
function storeWith(value: unknown): PaletteStore {
  return {
    get: (key: string): unknown => (key === FX_PALETTE_KEY ? value : undefined),
  };
}

describe('world 侧调色板读口', () => {
  test('从 registry 读到 token 表 → 解析成角色色值', () => {
    const palette = readFxPalette(
      storeWith({
        '--srf-accent': '#ffd45e',
        '--srf-success': '#6ef0a0',
      }),
    );
    expect(palette.accent).toBe('#ffd45e');
    expect(palette.success).toBe('#6ef0a0');
    // 没给的走兜底。
    expect(palette.danger).toBe(FX_PALETTE_FALLBACK.danger);
  });

  test('registry 里没有这张表 → 全部兜底色', () => {
    const palette = readFxPalette(storeWith(undefined));
    expect(palette.accent).toBe(FX_PALETTE_FALLBACK.accent);
  });

  test('registry 里是脏数据 → 走兜底色，不炸', () => {
    for (const raw of [null, 'nope', 7, [1, 2]]) {
      expect(readFxPalette(storeWith(raw)).accent).toBe(FX_PALETTE_FALLBACK.accent);
    }
  });

  test('没有 store（场景还没建好）→ 兜底色', () => {
    expect(readFxPalette(null).accent).toBe(FX_PALETTE_FALLBACK.accent);
    expect(readFxPalette(undefined).accent).toBe(FX_PALETTE_FALLBACK.accent);
  });

  test('每次都现取（皮肤随时能切 —— 缓存 = 读到旧色）', () => {
    let current: unknown = { '--srf-accent': '#111111' };
    const store: PaletteStore = { get: () => current };
    expect(readFxPalette(store).accent).toBe('#111111');
    current = { '--srf-accent': '#222222' };
    expect(readFxPalette(store).accent).toBe('#222222');
  });

  test('键名带命名空间（避免与别的 registry 键撞车）', () => {
    expect(FX_PALETTE_KEY).toBe('stratix:fx-palette');
  });
});
