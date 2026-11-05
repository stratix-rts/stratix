/**
 * 单测：皮肤 token 的 DOM 热读（hud/theme/fx-palette-reader.ts）。
 * 覆盖：token → 色值表、读不到的 token 不出现、DOM 不可用时返回空表。
 * 依赖：注入一个**假的 document**（只实现本模块用到的两个口子）——
 *   why 不用 jsdom：jsdom 的 getComputedStyle 对「样式表里声明的自定义属性」解析不可靠，
 *   这里的重点是本模块的映射与兜底口径，不是浏览器 CSS 引擎（那条路由 e2e 覆盖）。
 *
 * @since v3.3（task_162）
 */

import { FX_PALETTE_ROLES } from '../../../core/theme/fx-palette';
import { readFxPaletteTokens } from '../fx-palette-reader';

/** 造一个只有本模块用到的两个口子的假 document。 */
function fakeDoc(values: Record<string, string>): Document {
  return {
    documentElement: {} as HTMLElement,
    defaultView: {
      getComputedStyle: () => ({
        getPropertyValue: (name: string): string => values[name] ?? '',
      }),
    },
  } as unknown as Document;
}

describe('皮肤 token 热读', () => {
  test('读到的表只含本仓关心的七个 token', () => {
    const table = readFxPaletteTokens(
      fakeDoc({
        '--srf-accent': '#6ea8ff',
        '--srf-badge-accent': '#7fb3ff',
        '--srf-danger': '#e06c75',
        '--srf-success': '#6fcf97',
        '--srf-warn': '#f0c674',
        '--srf-text': '#e6e9ef',
        '--srf-text-muted': '#9aa3b2',
        '--srf-something-else': '#000000',
      }),
    );
    expect(Object.keys(table).sort()).toEqual(Object.values(FX_PALETTE_ROLES).sort());
    expect(table['--srf-accent']).toBe('#6ea8ff');
  });

  test('读不到的 token 直接不出现（下游按缺项走兜底色）', () => {
    const table = readFxPaletteTokens(fakeDoc({ '--srf-accent': '#6ea8ff' }));
    expect(table['--srf-accent']).toBe('#6ea8ff');
    expect('--srf-success' in table).toBe(false);
  });

  test('值会去掉首尾空白（CSS 变量常带换行）', () => {
    const table = readFxPaletteTokens(fakeDoc({ '--srf-accent': '  #6ea8ff\n' }));
    expect(table['--srf-accent']).toBe('#6ea8ff');
  });

  test('DOM 不可用时返回空表（不抛错 —— 特效照样能播，只是用兜底色）', () => {
    const noView = { documentElement: {} as HTMLElement } as unknown as Document;
    expect(readFxPaletteTokens(noView)).toEqual({});
    const noRoot = { defaultView: {} } as unknown as Document;
    expect(readFxPaletteTokens(noRoot)).toEqual({});
  });

  test('返回的是冻结表（调用方改不动读口给的东西）', () => {
    const table = readFxPaletteTokens(fakeDoc({ '--srf-accent': '#6ea8ff' }));
    expect(Object.isFrozen(table)).toBe(true);
  });
});
