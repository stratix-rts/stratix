/**
 * 单测：代码路由特效的调色板词汇（core/theme/fx-palette.ts）。
 * 覆盖：角色 → token 名映射、兜底色、非法值处理、输入形状无关。
 * 依赖：纯函数，不需要浏览器。
 *
 * @since v3.3（task_162）
 */

import {
  FX_PALETTE_FALLBACK,
  FX_PALETTE_ROLES,
  resolveFxPalette,
  type FxPaletteRole,
} from '../fx-palette';

const ROLES = Object.keys(FX_PALETTE_ROLES) as FxPaletteRole[];

describe('特效调色板词汇', () => {
  test('角色恰好七个，且 token 名都是 --srf-* 开头', () => {
    expect(ROLES).toHaveLength(7);
    for (const role of ROLES) {
      expect(FX_PALETTE_ROLES[role]).toMatch(/^--srf-/);
    }
  });

  test('token 名互不重复（两个角色抢同一个 token = 改一个色两个变）', () => {
    const names = ROLES.map((role) => FX_PALETTE_ROLES[role]);
    expect(new Set(names).size).toBe(names.length);
  });

  test('兜底色齐全且都是合法 hex', () => {
    for (const role of ROLES) {
      expect(FX_PALETTE_FALLBACK[role]).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });
});

describe('resolveFxPalette', () => {
  test('token 表齐全时按角色取色', () => {
    const table = {
      '--srf-accent': '#123456',
      '--srf-badge-accent': '#223344',
      '--srf-danger': '#323344',
      '--srf-success': '#423344',
      '--srf-warn': '#523344',
      '--srf-text': '#623344',
      '--srf-text-muted': '#723344',
    };
    const palette = resolveFxPalette(table);
    expect(palette.accent).toBe('#123456');
    expect(palette.badgeAccent).toBe('#223344');
    expect(palette.danger).toBe('#323344');
    expect(palette.success).toBe('#423344');
    expect(palette.warn).toBe('#523344');
    expect(palette.text).toBe('#623344');
    expect(palette.textMuted).toBe('#723344');
  });

  test('缺项走兜底色（皮肤没定义这个 token 时不至于黑屏）', () => {
    const palette = resolveFxPalette({ '--srf-accent': '#123456' });
    expect(palette.accent).toBe('#123456');
    expect(palette.success).toBe(FX_PALETTE_FALLBACK.success);
    expect(palette.textMuted).toBe(FX_PALETTE_FALLBACK.textMuted);
  });

  test('非法色值走兜底色（皮肤表写坏了也不能把特效染成透明）', () => {
    const palette = resolveFxPalette({
      '--srf-accent': 'not-a-color',
      '--srf-danger': 'rgb(1,2,3)',
      '--srf-success': '#12345',
    });
    expect(palette.accent).toBe(FX_PALETTE_FALLBACK.accent);
    expect(palette.danger).toBe(FX_PALETTE_FALLBACK.danger);
    expect(palette.success).toBe(FX_PALETTE_FALLBACK.success);
  });

  test('非对象输入（全兜底）', () => {
    for (const raw of [null, undefined, 42, 'x', [1, 2, 3]]) {
      const palette = resolveFxPalette(raw);
      expect(palette.accent).toBe(FX_PALETTE_FALLBACK.accent);
      expect(Object.keys(palette)).toHaveLength(7);
    }
  });

  test('#rgb 简写与 #rrggbbaa 都认（CSS 合法色就是合法色）', () => {
    const palette = resolveFxPalette({
      '--srf-accent': '#abc',
      '--srf-danger': '#12345678',
    });
    expect(palette.accent).toBe('#abc');
    expect(palette.danger).toBe('#12345678');
  });

  test('返回的是冻结对象（调用方改不动全层共用的那份）', () => {
    const palette = resolveFxPalette(null);
    expect(Object.isFrozen(palette)).toBe(true);
  });
});
