/**
 * 单测：战场单位的皮肤染色（world/theme.ts）。
 * 覆盖：hex 解析（#rgb / #rrggbb / 非法值）、有皮肤按徽标色上色、无皮肤回落到业务态颜色。
 *
 * 边界说明：本文件只测纯函数（颜色换算不依赖 Phaser）——
 *   真正的绘制在 unit-layer.ts（要 canvas，单测跑不了），颜色口径在这里钉住。
 */

import { DEFAULT_UNIT_COLOR, parseHexColor, resolveUnitColor } from '../theme';

describe('parseHexColor', () => {
  test('#rrggbb → 数字颜色', () => {
    expect(parseHexColor('#7fb3ff')).toBe(0x7fb3ff);
    expect(parseHexColor('7fb3ff')).toBe(0x7fb3ff);
  });

  test('#rgb（缩写）→ 展开成同色', () => {
    expect(parseHexColor('#f00')).toBe(0xff0000);
  });

  test('非法值 → null（不静默吞掉，由调用方回落）', () => {
    expect(parseHexColor('')).toBeNull();
    expect(parseHexColor('   ')).toBeNull();
    expect(parseHexColor('#12345')).toBeNull();
    expect(parseHexColor('#gggggg')).toBeNull();
    expect(parseHexColor(null)).toBeNull();
    expect(parseHexColor(undefined)).toBeNull();
  });
});

describe('resolveUnitColor', () => {
  test('带皮肤的 agent 单位按皮肤徽标色上色（身份标识）', () => {
    // crimson 皮肤的徽标色见 core/theme/skin-registry.ts 的清单。
    expect(resolveUnitColor('crimson', DEFAULT_UNIT_COLOR)).toBe(0xff4d6d);
    expect(resolveUnitColor('ocean', DEFAULT_UNIT_COLOR)).toBe(0x38bdf8);
  });

  test('没有皮肤 → 用业务态兜底色', () => {
    expect(resolveUnitColor(null, 0x4f9cf9)).toBe(0x4f9cf9);
    expect(resolveUnitColor(undefined, 0x4f9cf9)).toBe(0x4f9cf9);
    expect(resolveUnitColor('', 0x4f9cf9)).toBe(0x4f9cf9);
  });

  test('未知皮肤 id → 回落 default 皮肤色（渲染侧拿不到颜色就等于没身份）', () => {
    // resolveAccent 对未知 id 回落 default 的徽标色（core/theme/skin-registry.ts 的约定）。
    expect(resolveUnitColor('no-such-skin', DEFAULT_UNIT_COLOR)).toBe(0x7fb3ff);
  });
});
