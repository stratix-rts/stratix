/**
 * 单测：像素风图标集 + 皮肤 → 图标集联动（@since v3.8，task_135）。
 * @jest-environment jsdom
 *
 * 用户验收退回的原话：「图标还是现代 SVG 换描边，不是真像素艺术」。
 * 本组断言把「真像素」钉死成三条可测口径：
 *   ① 像素图标位**非空**（task_121 预留的空槽已填上，23 个图标一一对应）；
 *   ② 像素图标的路径数据里**没有任何曲线指令**（C/Q/A/S/T）——
 *      曲线 = 矢量 = 不是像素艺术；坐标全是整数 = 严丝合缝的方块；
 *   ③ 切皮肤 → 图标**就地**换成对应那一套（不重建 DOM → 布局骨架零变化），
 *      且 shadow DOM 里的图标（按钮）也跟着换。
 */

import { ICON_NAMES, PIXEL_ICON_SET, iconSvg, resolveIconSet } from '../widgets/icon-set';
import { setActiveIconSet } from '../widgets/icon-set';
import { createThemeController } from '../theme/theme-controller';
import { defineStratButton, STRAT_BUTTON_TAG } from '../widgets/strat-button';

/** 曲线指令 = 矢量味 = 不是像素艺术。 */
const CURVE_COMMAND = /[CQASTcqast]/;

describe('像素风图标集（hud/widgets/icon-set.ts 的 pixel 位）', () => {
  afterEach(() => {
    setActiveIconSet('modern');
  });

  test('像素位非空：23 个图标名一一对应，路径数据都不空', () => {
    expect(Object.keys(PIXEL_ICON_SET.paths)).toHaveLength(ICON_NAMES.length);
    for (const name of ICON_NAMES) {
      const body = PIXEL_ICON_SET.paths[name];
      expect(typeof body).toBe('string');
      expect(body.length).toBeGreaterThan(0);
    }
  });

  test('像素图标 = 方块坐标组合：没有曲线指令，坐标全是整数', () => {
    for (const name of ICON_NAMES) {
      const body = PIXEL_ICON_SET.paths[name];
      // 只查路径数据（d="..." 里的内容）——标签名里的字母不算。
      const dataList = (body.match(/d="([^"]*)"/g) ?? []).map((m) => m.slice(3, -1));
      expect(dataList.length).toBeGreaterThanOrEqual(2);
      for (const d of dataList) {
        // 曲线指令（C/Q/A/S/T）= 矢量味 = 不是像素艺术。
        expect(d).not.toMatch(CURVE_COMMAND);
        // 只允许 M / h / v / z（直线段 + 闭合）。
        for (const cmd of d.match(/[A-Za-z]/g) ?? []) {
          expect(['M', 'h', 'v', 'z']).toContain(cmd);
        }
        // 坐标整数：块与块严丝合缝，不出现半像素。
        for (const num of d.match(/-?\d+(?:\.\d+)?/g) ?? []) {
          expect(num).not.toContain('.');
        }
      }
    }
  });

  test('像素图标用实心方块渲染（fill=currentColor / stroke=none / crispEdges）', () => {
    const svg = iconSvg('demo', { setId: 'pixel' });
    expect(svg).toContain('viewBox="0 0 16 16"');
    expect(svg).toContain('fill="currentColor"');
    expect(svg).toContain('stroke="none"');
    expect(svg).toContain('shape-rendering="crispEdges"');
    // 路径数据里没有曲线指令（"stroke" 之类的属性名不算 —— 只查 d=）。
    for (const d of svg.match(/d="([^"]*)"/g) ?? []) {
      expect(d).not.toMatch(CURVE_COMMAND);
    }
  });

  test('现代图标集一个字节不动（仍是线条描边 + 24×24 + 1.5px）', () => {
    const svg = iconSvg('demo', { setId: 'modern' });
    expect(svg).toContain('viewBox="0 0 24 24"');
    expect(svg).toContain('fill="none"');
    expect(svg).toContain('stroke="currentColor"');
    expect(svg).toContain('stroke-width="1.5"');
    expect(svg).toContain('stroke-linecap="round"');
    // 现代图标仍是矢量线条（含曲线）—— 与像素集泾渭分明。
    expect(resolveIconSet('modern').paths.demo).toContain('Z');
  });
});

describe('皮肤 → 图标集联动（切皮 = 就地换图标图形）', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    defineStratButton();
    setActiveIconSet('modern');
  });

  afterEach(() => {
    setActiveIconSet('modern');
  });

  test('切到像素皮：顶栏按钮（shadow DOM 内）的图标换成方块路径；切回现代皮换回来', () => {
    const controller = createThemeController<string>({
      sources: { default: '', pixel: '' },
      initial: 'default',
    });

    const btn = document.createElement(STRAT_BUTTON_TAG);
    btn.setAttribute('icon', 'demo');
    document.body.appendChild(btn);
    const svg = btn.shadowRoot?.querySelector('svg.srf-icon') as SVGSVGElement | null;
    expect(svg).not.toBeNull();
    // 初始 = 现代线条版。
    expect(svg?.getAttribute('viewBox')).toBe('0 0 24 24');
    expect(svg?.querySelectorAll('path').length).toBe(1);

    controller.apply('pixel');
    // 就地换图形（元素还是同一个 —— 不重建 DOM → 布局不动）。
    expect(svg?.getAttribute('viewBox')).toBe('0 0 16 16');
    expect(svg?.getAttribute('fill')).toBe('currentColor');
    expect(svg?.getAttribute('stroke')).toBe('none');
    const paths = Array.from(svg?.querySelectorAll('path') ?? []);
    expect(paths.length).toBeGreaterThanOrEqual(2);
    for (const p of paths) {
      expect(p.getAttribute('d') ?? '').not.toMatch(CURVE_COMMAND);
    }

    controller.apply('default');
    expect(svg?.getAttribute('viewBox')).toBe('0 0 24 24');
    expect(svg?.getAttribute('fill')).toBe('none');
    expect(svg?.getAttribute('stroke')).toBe('currentColor');
  });

  test('构造控制器时按初始皮肤定好图标集（HUD 首次渲染就用对的那套）', () => {
    createThemeController({ sources: { default: '', pixel: '' }, initial: 'pixel' });
    const svg = iconSvg('sound');
    expect(svg).toContain('viewBox="0 0 16 16"');
    expect(svg).toContain('fill="currentColor"');
  });
});
