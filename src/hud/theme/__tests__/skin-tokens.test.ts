/**
 * 单测：HUD 皮肤库的 token 齐全性（hud/theme/tokens-*.css）。
 * 覆盖：每套皮肤的 CSS 变量键集合完全一致、每个 token 有值、徽标色存在、像素风保留像素变体位。
 * 依赖：fs 直读样式表（jest 不配 css transform）。
 */

import { SKINS } from '../skin-registry';
import { parseTokenCss, readTokenCss, tokenCssExists } from './css-token-parser';

/**
 * 规范 token 清单：所有皮肤必须提供**这 30 个**变量，不多不少。
 * why 写死清单而不是「跟 default 比」：default 也是被检对象之一，写死才能发现「大家一起少一个」。
 */
const CANONICAL_TOKENS: readonly string[] = [
  // 表面
  '--srf-bg',
  '--srf-panel',
  '--srf-panel-elevated',
  '--srf-border',
  '--srf-border-strong',
  // 文本
  '--srf-text',
  '--srf-text-muted',
  '--srf-text-disabled',
  // 语义 / 强调
  '--srf-accent',
  '--srf-accent-hover',
  '--srf-success',
  '--srf-warn',
  '--srf-danger',
  '--srf-badge-accent',
  // 字体
  '--srf-font-ui',
  '--srf-font-size-sm',
  '--srf-font-size-md',
  '--srf-font-size-lg',
  '--srf-line-height',
  // 形状
  '--srf-radius',
  '--srf-border-width',
  '--srf-spacing-xs',
  '--srf-spacing-sm',
  '--srf-spacing-md',
  '--srf-spacing-lg',
  // 渲染 / 装饰
  '--srf-image-rendering',
  '--srf-scanline-opacity',
  '--srf-shadow',
  // 悬浮层
  '--srf-panel-overlay',
  '--srf-panel-elevated-overlay',
];

const SORTED_CANONICAL = [...CANONICAL_TOKENS].sort();

/** 每套皮肤一行用例：id + token 文件名。 */
const SKIN_CASES: ReadonlyArray<readonly [string, string]> = SKINS.map((s) => [s.id, s.file] as const);

describe('皮肤 token 集：键集合一致性', () => {
  test.each(SKIN_CASES)('皮肤 %s 的 token 文件存在', (_id, file) => {
    expect(tokenCssExists(file)).toBe(true);
  });

  test.each(SKIN_CASES)('皮肤 %s 的键集合与规范清单完全一致（不多不少）', (_id, file) => {
    const actual = [...parseTokenCss(readTokenCss(file)).keys()].sort();
    expect(actual).toEqual(SORTED_CANONICAL);
  });

  test.each(SKIN_CASES)('皮肤 %s 的每个 token 都有非空值', (_id, file) => {
    const tokens = parseTokenCss(readTokenCss(file));
    const empty = [...tokens.entries()].filter(([, value]) => value.length === 0).map(([name]) => name);
    expect(empty).toEqual([]);
  });

  test.each(SKIN_CASES)('皮肤 %s 有徽标色 token', (_id, file) => {
    expect(parseTokenCss(readTokenCss(file)).has('--srf-badge-accent')).toBe(true);
  });
});

describe('皮肤之间的键集合一致', () => {
  test('所有皮肤的键集合两两相同', () => {
    const keySets = SKINS.map((skin) => [...parseTokenCss(readTokenCss(skin.file)).keys()].sort().join(','));
    expect(new Set(keySets).size).toBe(1);
  });
});

describe('像素皮肤保留既有像素变体位', () => {
  test('pixel 仍是直角 + 硬边框 + 像素化渲染 + 扫描线', () => {
    const tokens = parseTokenCss(readTokenCss('tokens-pixel.css'));
    expect(tokens.get('--srf-radius')).toBe('0');
    expect(tokens.get('--srf-border-width')).toBe('2px');
    expect(tokens.get('--srf-image-rendering')).toBe('pixelated');
    expect(Number(tokens.get('--srf-scanline-opacity'))).toBeGreaterThan(0);
    expect(tokens.get('--srf-font-ui')).toContain('Courier New');
  });

  test('其余皮肤保持现代渲染（auto / 无扫描线）', () => {
    for (const skin of SKINS) {
      if (skin.id === 'pixel') continue;
      const tokens = parseTokenCss(readTokenCss(skin.file));
      expect({ skin: skin.id, rendering: tokens.get('--srf-image-rendering') }).toEqual({
        skin: skin.id,
        rendering: 'auto',
      });
      expect(Number(tokens.get('--srf-scanline-opacity'))).toBe(0);
    }
  });
});
