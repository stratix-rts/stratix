/**
 * 集成测试：HUD 信息三层级状态机（hud/layers/info-layer.ts，@since v3.4，task_096）。
 * @jest-environment jsdom
 *
 * 覆盖：CSS 变量驱动的对比度切换（L1 降到 18% / L2 收起 / 退出全恢复）、
 *   分区 → 层级的映射表、层级标记属性、订阅与卸载清理，
 *   以及**实测对比度**：用 WCAG 公式算 L1 分区降不透明度前后的真实对比度（不拿理论值糊弄）。
 */

import {
  DEFAULT_INFO_LAYER,
  INFO_LAYERS,
  isInfoLayer,
  layerL1Opacity,
  layerL2Collapsed,
  layerL2Opacity,
  normalizeInfoLayer,
} from '../../../core/info-layer';
import { HUD_LAYER_METRICS, blendOver, contrastRatio } from '../../../core/theme/visual-spec';
import {
  HUD_LAYER_REGIONS,
  INFO_LAYER_CSS_VARS,
  INFO_LAYER_ROOT_ATTRIBUTE,
  INFO_LAYER_STYLE_ID,
  buildInfoLayerCss,
  createInfoLayerController,
  infoLayerVars,
  type InfoLayerController,
} from '../info-layer';

/** 顶栏的典型配色（页面骨架的默认前景 / 底色）—— 实测对比度用这一对。 */
const L1_FOREGROUND = '#e6e9ef';
const L1_BACKGROUND = '#0f1116';

function readVar(name: string): string {
  return document.documentElement.style.getPropertyValue(name);
}

describe('core/info-layer：层级纯语义', () => {
  test('词表有序且三档齐全', () => {
    expect(INFO_LAYERS).toEqual(['L1', 'L2', 'L3']);
    expect(DEFAULT_INFO_LAYER).toBe('L1');
  });

  test('合法性判定与归一化（非法值回落 L1 —— 显示密度不该让命令失败）', () => {
    expect(isInfoLayer('L2')).toBe(true);
    expect(isInfoLayer('L4')).toBe(false);
    expect(isInfoLayer(undefined)).toBe(false);
    expect(normalizeInfoLayer('L3')).toBe('L3');
    expect(normalizeInfoLayer('nope')).toBe('L1');
    expect(normalizeInfoLayer(undefined)).toBe('L1');
  });

  test('对比口径：只有 L3 降 L1 对比、收 L2', () => {
    expect(layerL1Opacity('L1')).toBe(1);
    expect(layerL1Opacity('L2')).toBe(1);
    expect(layerL1Opacity('L3')).toBe(HUD_LAYER_METRICS.l1DimOpacity);
    expect(layerL2Opacity('L3')).toBe(0);
    expect(layerL2Collapsed('L3')).toBe(true);
    expect(layerL2Collapsed('L1')).toBe(false);
    expect(layerL2Collapsed('L2')).toBe(false);
  });
});

describe('hud/layers/info-layer：CSS 变量驱动的层级切换', () => {
  let controller: InfoLayerController;

  beforeEach(() => {
    document.head.innerHTML = '';
    document.documentElement.removeAttribute(INFO_LAYER_ROOT_ATTRIBUTE);
    document.documentElement.removeAttribute('style');
    controller = createInfoLayerController();
  });

  afterEach(() => {
    controller.destroy();
  });

  test('注入一张层级样式表（分区选择器映射到 CSS 变量）', () => {
    const style = document.getElementById(INFO_LAYER_STYLE_ID);
    expect(style).not.toBeNull();
    const css = style?.textContent ?? '';
    // 分区 → 层级：顶栏 / 控制岛 / 小地图 = L1；事件轨 / toast = L2；回放角标 = L3。
    for (const selector of HUD_LAYER_REGIONS.L1) expect(css).toContain(selector);
    for (const selector of HUD_LAYER_REGIONS.L2) expect(css).toContain(selector);
    for (const selector of HUD_LAYER_REGIONS.L3) expect(css).toContain(selector);
    // L3 元素满对比（L3 期间 L1 降对比、L2 收起，沉浸的那几件必须最清楚）。
    expect(css).toContain('[data-srf-layer="L3"]');
    // 规则只读变量 —— 切档 = 改变量，不逐元素改样式。
    expect(css).toContain(`var(${INFO_LAYER_CSS_VARS.l1Opacity}`);
    expect(css).toContain(`var(${INFO_LAYER_CSS_VARS.l2Visibility}`);
    // 通用属性口径：后续任务给新元素标一个 data-srf-layer 即可入层。
    expect(css).toContain('[data-srf-layer="L1"]');
    expect(css).toContain('[data-srf-layer="L2"]');
  });

  test('小地图（L1）在 L3 期间只降对比、不收起（展开态不被禁 —— v3.5 / task_098）', () => {
    const css = document.getElementById(INFO_LAYER_STYLE_ID)?.textContent ?? '';
    // 小地图是 L1 件：L3 激活时走「L1 降对比」这条路，**不是** L2 的「收起」那条路。
    expect(HUD_LAYER_REGIONS.L1).toContain('strat-minimap');
    expect(HUD_LAYER_REGIONS.L2).not.toContain('strat-minimap');
    // L1 规则块里只有 opacity / transition —— 没有 display:none、没有 visibility:hidden。
    const l1Block = css.slice(css.indexOf('strat-minimap')).match(/^[\s\S]*?\}/)?.[0] ?? '';
    expect(l1Block).toContain('opacity');
    expect(l1Block).not.toContain('display');
    expect(l1Block).not.toContain('visibility');
  });

  test('初始态是 L1（对比不降、L2 不收起）', () => {
    expect(controller.current).toBe('L1');
    expect(readVar(INFO_LAYER_CSS_VARS.l1Opacity)).toBe('1');
    expect(readVar(INFO_LAYER_CSS_VARS.l2Visibility)).toBe('visible');
    expect(document.documentElement.getAttribute(INFO_LAYER_ROOT_ATTRIBUTE)).toBe('L1');
  });

  test('切到 L3：L1 降到 18% 对比、L2 收起、标记属性同步', () => {
    controller.apply('L3');
    expect(controller.current).toBe('L3');
    expect(readVar(INFO_LAYER_CSS_VARS.l1Opacity)).toBe(String(HUD_LAYER_METRICS.l1DimOpacity));
    expect(Number(readVar(INFO_LAYER_CSS_VARS.l1Opacity))).toBeCloseTo(0.18, 5);
    expect(readVar(INFO_LAYER_CSS_VARS.l2Opacity)).toBe('0');
    expect(readVar(INFO_LAYER_CSS_VARS.l2Visibility)).toBe('hidden');
    expect(document.documentElement.getAttribute(INFO_LAYER_ROOT_ATTRIBUTE)).toBe('L3');
  });

  test('退出 L3：全部恢复（L1 对比回 1、L2 回来）', () => {
    controller.apply('L3');
    controller.apply('L1');
    expect(controller.current).toBe('L1');
    expect(readVar(INFO_LAYER_CSS_VARS.l1Opacity)).toBe('1');
    expect(readVar(INFO_LAYER_CSS_VARS.l2Opacity)).toBe('1');
    expect(readVar(INFO_LAYER_CSS_VARS.l2Visibility)).toBe('visible');
    expect(document.documentElement.getAttribute(INFO_LAYER_ROOT_ATTRIBUTE)).toBe('L1');
  });

  test('实测对比度：L3 时 L1 分区的真实对比度显著下降（WCAG 公式实测）', () => {
    const base = contrastRatio(L1_FOREGROUND, L1_BACKGROUND);
    const dimmed = contrastRatio(
      blendOver(L1_FOREGROUND, L1_BACKGROUND, layerL1Opacity('L3')),
      L1_BACKGROUND,
    );
    // 严格下降 —— 「降到 18% 对比」不是口号，是可复算的数字。
    expect(dimmed).toBeLessThan(base);
    expect(dimmed).toBeLessThan(base * 0.3);
    // 且档位口径写死：L3 的对比因子就是规格里的 0.18。
    expect(layerL1Opacity('L3')).toBe(0.18);
    // 退出后回到原对比度（全恢复）。
    const restored = contrastRatio(
      blendOver(L1_FOREGROUND, L1_BACKGROUND, layerL1Opacity('L1')),
      L1_BACKGROUND,
    );
    expect(restored).toBeCloseTo(base, 6);
  });

  test('订阅者收到层级变化；同档重复调用不重复通知', () => {
    const seen: string[] = [];
    const off = controller.subscribe((layer) => seen.push(layer));
    controller.apply('L3');
    controller.apply('L3');
    controller.apply('L1');
    expect(seen).toEqual(['L3', 'L1']);
    off();
    controller.apply('L2');
    expect(seen).toEqual(['L3', 'L1']);
  });

  test('卸载：撤样式表、撤变量、撤标记、清订阅者（资源必须可清理）', () => {
    const seen: string[] = [];
    controller.subscribe((layer) => seen.push(layer));
    controller.apply('L3');
    controller.destroy();
    expect(document.getElementById(INFO_LAYER_STYLE_ID)).toBeNull();
    expect(readVar(INFO_LAYER_CSS_VARS.l1Opacity)).toBe('');
    expect(document.documentElement.getAttribute(INFO_LAYER_ROOT_ATTRIBUTE)).toBeNull();
    controller.apply('L1');
    expect(seen).toEqual(['L3']);
  });

  test('infoLayerVars / buildInfoLayerCss 是纯函数（单测直接断言文本）', () => {
    expect(infoLayerVars('L3')[INFO_LAYER_CSS_VARS.l2Visibility]).toBe('hidden');
    expect(infoLayerVars('L1')[INFO_LAYER_CSS_VARS.l2Visibility]).toBe('visible');
    expect(buildInfoLayerCss()).toContain('--srf-layer-l1-opacity');
  });
});
