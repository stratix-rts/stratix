/**
 * 单测：图标系统 + DOM 微交互基线（@since v3.6，task_121）。
 * @jest-environment jsdom
 *
 * 覆盖验收口径：
 *   ① 图标组（hud/widgets/icon-set.ts）是唯一来源：每个图标名都有路径、
 *      统一 1.5px 描边 / 圆角端点 / currentColor 取色；
 *   ② 顶栏**没有 emoji**（原来 🔊 / 🎬 / ▶ / ⋯ 四个字形），四件按钮与溢出菜单
 *      全部是 inline SVG；
 *   ③ strat-button 的 icon 属性：纯图标钮（无文字）与图标 + 文字两种形态；
 *   ④ 信息层级三档按钮的激活态（点亮即当前档）与 hover 过渡。
 *
 * 为什么 emoji 检查要递归进 shadow DOM：按钮的文字在 shadow 里，
 *   只扫 light DOM 会漏。
 */

import { createStore } from '../../core/store';
import type { HudCommand, WorldState } from '../../core/types';
import { createHudBusAdapter, type HudBusAdapter } from '../bridge/bus-adapter';
import { createInfoLayerController, type InfoLayerController } from '../layers/info-layer';
import { LAYER_SWITCH_BUTTON_ROLE, mountLayerSwitch } from '../layers/layer-switch';
import { createMainScreen } from '../screens/main-screen';
import type { ThemeController, ThemeId } from '../theme/theme-controller';
import { ICON_NAMES, iconSvg, isIconName, resolveIconSet } from '../widgets/icon-set';
import { defineStratButton, STRAT_BUTTON_TAG } from '../widgets/strat-button';

/**
 * emoji 判定：覆盖常见 emoji 区段（表情 / 符号 / 杂项 / 装饰 / 带选变体）。
 * why 要这么宽：emoji 的码位散在十几个区段里，只查 U+1F300 那一段会漏掉 ⚠️ / ▶ 这类。
 */
const EMOJI_PATTERN = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{25A0}-\u{25FF}\u{2300}-\u{23FF}\u{2B50}\u{203C}\u{2049}\u{2122}\u{2139}\u{3030}\u{303D}\u{3297}\u{3299}]/u;

/** 递归收集一棵 DOM 子树的全部文本（含 shadow DOM —— 按钮的文字在里面）。 */
function collectText(node: Node, out: string[] = []): string[] {
  if (node.nodeType === Node.TEXT_NODE) {
    out.push(node.textContent ?? '');
    return out;
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return out;
  const el = node as Element;
  out.push(el.getAttribute('title') ?? '');
  out.push(el.getAttribute('aria-label') ?? '');
  out.push(el.textContent ?? '');
  const shadow = (el as HTMLElement).shadowRoot;
  if (shadow) collectText(shadow, out);
  for (const child of Array.from(el.children)) collectText(child, out);
  return out;
}

/** 找出文本里所有 emoji（返回码位，便于报告）。 */
function findEmoji(text: string): string[] {
  return Array.from(text).filter((ch) => EMOJI_PATTERN.test(ch));
}

// ============================================================================
// 1. 图标组本体
// ============================================================================

describe('图标组（hud/widgets/icon-set.ts）', () => {
  test('每个图标名都有路径数据（无空槽）', () => {
    expect(ICON_NAMES.length).toBeGreaterThanOrEqual(20);
    for (const name of ICON_NAMES) {
      const path = resolveIconSet('modern').paths[name];
      expect(typeof path).toBe('string');
      expect(path.length).toBeGreaterThan(0);
    }
  });

  test('风格口径统一：1.5px 描边 + 圆角端点/拐角 + fill:none + currentColor', () => {
    const svg = iconSvg('sound');
    expect(svg).toContain('viewBox="0 0 24 24"');
    expect(svg).toContain('stroke-width="1.5"');
    expect(svg).toContain('stroke-linecap="round"');
    expect(svg).toContain('stroke-linejoin="round"');
    expect(svg).toContain('fill="none"');
    expect(svg).toContain('stroke="currentColor"');
    expect(svg).toContain('aria-hidden="true"');
  });

  test('图标内容里没有 fill / 颜色字面量（纯线条，颜色由 currentColor 决定）', () => {
    for (const name of ICON_NAMES) {
      const body = resolveIconSet('modern').paths[name];
      expect(body).not.toMatch(/fill=/);
      expect(body).not.toMatch(/#[0-9a-fA-F]{3,8}/);
      expect(body).not.toMatch(/rgb\(/);
    }
  });

  test('图标名守卫：认不出的名字不算图标名（外部字符串不能直接当图标用）', () => {
    expect(isIconName('sound')).toBe(true);
    expect(isIconName('not-an-icon')).toBe(false);
    expect(isIconName('__proto__')).toBe(false);
  });

  test('图标集回落：认不出的皮肤 id 回落缺省集（图标永不画不出来）', () => {
    // @since v3.8（task_135）：pixel 位不再是空槽 —— 像素皮有自己的图标集。
    expect(resolveIconSet('pixel').id).toBe('pixel');
    expect(resolveIconSet(null).id).toBe('modern');
    expect(resolveIconSet('no-such-set').id).toBe('modern');
  });
});

// ============================================================================
// 2. strat-button：icon 属性
// ============================================================================

describe('strat-button：icon 属性（@since v3.6，task_121）', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    defineStratButton();
  });

  test('挂 icon → shadow 内渲染 inline SVG（无文字）', () => {
    const btn = document.createElement(STRAT_BUTTON_TAG);
    btn.setAttribute('icon', 'demo');
    btn.setAttribute('aria-label', '演示模式');
    document.body.appendChild(btn);
    const svg = btn.shadowRoot?.querySelector('svg.srf-icon');
    expect(svg).not.toBeNull();
    expect(svg?.getAttribute('stroke')).toBe('currentColor');
    expect(btn.shadowRoot?.querySelector('button')?.textContent ?? '').toBe('');
  });

  test('icon + label → 图标与文字都在（菜单项形态）', () => {
    const btn = document.createElement(STRAT_BUTTON_TAG);
    btn.setAttribute('icon', 'settings');
    btn.setAttribute('label', '去设置');
    document.body.appendChild(btn);
    expect(btn.shadowRoot?.querySelector('svg.srf-icon')).not.toBeNull();
    expect(btn.shadowRoot?.querySelector('.text')?.textContent).toBe('去设置');
  });

  test('认不出的图标名 = 无图标（不画半截图形，也不抛错）', () => {
    const btn = document.createElement(STRAT_BUTTON_TAG);
    btn.setAttribute('icon', 'not-an-icon');
    btn.setAttribute('label', 'X');
    document.body.appendChild(btn);
    expect(btn.shadowRoot?.querySelector('svg')).toBeNull();
    expect(btn.shadowRoot?.querySelector('button')?.textContent).toBe('X');
  });

  test('微交互基线：hover / active / disabled 三态都有样式（CSS 驱动，不写 JS）', () => {
    const btn = document.createElement(STRAT_BUTTON_TAG);
    btn.setAttribute('icon', 'more');
    document.body.appendChild(btn);
    const css = btn.shadowRoot?.querySelector('style')?.textContent ?? '';
    expect(css).toContain(':host(:hover:not([disabled]))');
    expect(css).toMatch(/button:hover:not\(:disabled\)/);
    expect(css).toMatch(/button:active:not\(:disabled\)/);
    expect(css).toMatch(/button:disabled/);
  });
});

// ============================================================================
// 3. 顶栏：emoji 全清 + 四件按钮都是 SVG
// ============================================================================

/** 主题控制器桩：不实际落皮肤。 */
function stubThemeController(): ThemeController {
  return {
    apply: (_id: ThemeId) => undefined,
    get current(): ThemeId | null { return null; },
    subscribe: () => () => undefined,
  };
}

function makeState(): WorldState {
  return {
    units: [],
    missions: [],
    selection: { unitIds: [], previewUnitIds: [], revision: 0 },
    characters: [],
    notices: [],
    links: [],
    messages: [],
  };
}

describe('顶栏：emoji → SVG 图标（@since v3.6，task_121）', () => {
  let host: HTMLElement;
  let unmountScreen: () => void;

  beforeEach(() => {
    document.body.innerHTML = '';
    const store = createStore(makeState());
    const adapter: HudBusAdapter = createHudBusAdapter({
      themeController: stubThemeController(),
      onState: (handler) => store.subscribe(handler),
      emitCommand: (_cmd: HudCommand) => undefined,
    });
    adapter.mount();
    host = document.createElement('div');
    document.body.appendChild(host);
    const screen = createMainScreen(adapter);
    unmountScreen = screen.mount(host);
    // 首帧同步（同 main-screen.test.ts 夹具口径：subscribe 不会自动回放首帧）。
    store.patch(makeState());
  });

  afterEach(() => {
    unmountScreen();
    host.remove();
  });

  test('顶栏整棵子树（含 shadow DOM）里没有任何 emoji 字符', () => {
    const topbar = host.querySelector('.hud-topbar');
    expect(topbar).not.toBeNull();
    const texts = collectText(topbar as Element);
    const found = texts.flatMap((t) => findEmoji(t));
    expect(found).toEqual([]);
  });

  test('顶栏按钮（更多 = 纯图标；声音 / 导演 / 演示已收进 ⋯ 菜单）都是 inline SVG 图标', () => {
    // ⋯ 按钮仍是顶栏上的纯图标钮：没有可见文字（可访问名由 aria-label 给）。
    const overflow = host.querySelector<HTMLElement>('[data-role="overflow"]');
    expect(overflow).not.toBeNull();
    expect(overflow?.shadowRoot?.querySelector('svg.srf-icon')).not.toBeNull();
    expect(overflow?.getAttribute('label')).toBeNull();
    expect(overflow?.getAttribute('aria-label')).toBeTruthy();

    // @since v3.8（task_137）：声音 / 导演 / 演示收进 ⋯ 菜单 → 变成「图标 + 文字」的菜单项。
    for (const role of ['sound', 'director', 'demo']) {
      const btn = host.querySelector<HTMLElement>(`[data-role="${role}"]`);
      expect(btn).not.toBeNull();
      expect(btn?.shadowRoot?.querySelector('svg.srf-icon')).not.toBeNull();
      expect(btn?.getAttribute('label')).toBeTruthy();
    }
  });

  test('溢出菜单八项：图标 + 文字（文字没丢，只是多了图标）', () => {
    const menu = host.querySelector('[data-role="overflow-menu"]');
    expect(menu).not.toBeNull();
    // 只数菜单项位（data-menu-item）—— 声音段里的滑条等子控件不是菜单项。
    const items = Array.from(menu!.querySelectorAll<HTMLElement>('[data-menu-item]'));
    expect(items).toHaveLength(8);
    for (const item of items) {
      expect(item.shadowRoot?.querySelector('svg.srf-icon')).not.toBeNull();
      expect(item.getAttribute('label')).toBeTruthy();
    }
  });
});

// ============================================================================
// 4. 信息层级三档：激活态点亮
// ============================================================================

describe('信息层级三档：点击后当前层点亮（@since v3.6，task_121）', () => {
  let controller: InfoLayerController;
  let host: HTMLElement;

  beforeEach(() => {
    document.head.innerHTML = '';
    document.body.innerHTML = '';
    controller = createInfoLayerController();
    host = document.createElement('div');
    document.body.appendChild(host);
  });

  afterEach(() => {
    controller.destroy();
    host.remove();
  });

  test('点 L2 → 该档成为当前档（aria-pressed=true，其余 false）', () => {
    const { element } = mountLayerSwitch(
      { controller, dispatch: () => undefined },
      host,
    );
    const pressed = (layer: string): string | null =>
      element.querySelector<HTMLElement>(`[data-layer="${layer}"]`)?.getAttribute('aria-pressed') ?? null;
    element.querySelector<HTMLElement>('[data-layer="L2"]')?.click();
    // 真相在 core：这里模拟 core 回广播（控制器.apply）。
    controller.apply('L2');
    expect(pressed('L2')).toBe('true');
    expect(pressed('L1')).toBe('false');
    expect(pressed('L3')).toBe('false');
  });

  test('激活态是"点亮"（主色底），不是只有描边变化 —— 样式表里写死了', () => {
    const { element } = mountLayerSwitch(
      { controller, dispatch: () => undefined },
      host,
    );
    const css = element.querySelector('style')?.textContent ?? '';
    const activeRule = css.match(/\.hud-layer-switch-btn\[aria-pressed="true"\]\s*\{[^}]*\}/)?.[0] ?? '';
    expect(activeRule).not.toBe('');
    expect(activeRule).toContain('background: var(--srf-accent)');
    // hover 也要有反馈（微交互基线）。
    expect(css).toMatch(/\.hud-layer-switch-btn:hover\s*\{[^}]*transform/);
  });

  test('三枚按钮都带稳定角色（测试 / 调试按它定位）', () => {
    const { element } = mountLayerSwitch(
      { controller, dispatch: () => undefined },
      host,
    );
    expect(element.querySelectorAll(`[data-role="${LAYER_SWITCH_BUTTON_ROLE}"]`)).toHaveLength(3);
  });
});
