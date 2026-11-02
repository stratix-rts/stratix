/**
 * 单测：HUD 调色板注入器（hud/theme/visual-tokens.ts）—— 七色语义色注入成 CSS 变量。
 * 环境：jsdom（要 document.head）。
 *
 * @since v3.3（task_110）
 * @jest-environment jsdom
 */

import { PALETTE_CSS_VARS, VISUAL_PALETTE, type PaletteKey } from '../../../core/theme/visual-spec';

import { VISUAL_TOKEN_STYLE_ID, buildVisualTokenCss, installVisualTokens } from '../visual-tokens';

afterEach(() => {
  document.getElementById(VISUAL_TOKEN_STYLE_ID)?.remove();
});

describe('调色板 CSS 生成', () => {
  test('七个语义色各出一个 CSS 变量，值与唯一事实源同值', () => {
    const css = buildVisualTokenCss();
    for (const key of Object.keys(VISUAL_PALETTE) as PaletteKey[]) {
      expect(css).toContain(`${PALETTE_CSS_VARS[key]}: ${VISUAL_PALETTE[key]};`);
    }
  });

  test('变量名互不重复（不打架）', () => {
    const names = Object.values(PALETTE_CSS_VARS);
    expect(new Set(names).size).toBe(names.length);
  });
});

describe('注入器', () => {
  test('注入到 document.head 且带稳定 id', () => {
    installVisualTokens(document);
    const style = document.getElementById(VISUAL_TOKEN_STYLE_ID);
    expect(style).not.toBeNull();
    expect(style?.parentElement).toBe(document.head);
    expect(style?.textContent).toContain(PALETTE_CSS_VARS.unit);
  });

  test('重复注入幂等（不叠多张样式表）', () => {
    installVisualTokens(document);
    installVisualTokens(document);
    expect(document.querySelectorAll(`#${VISUAL_TOKEN_STYLE_ID}`)).toHaveLength(1);
  });

  test('卸载闭包拔掉样式表', () => {
    const uninstall = installVisualTokens(document);
    uninstall();
    expect(document.getElementById(VISUAL_TOKEN_STYLE_ID)).toBeNull();
  });
});
