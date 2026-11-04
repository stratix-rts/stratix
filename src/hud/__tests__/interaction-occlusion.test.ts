/**
 * 集成测试：v3.5 交互减法·遮挡规则 R1/R2/R4（@since v3.5，task_099）。
 * @jest-environment jsdom
 *
 * 站在「屏」这一层验收方案 docs/interaction-reduction-v3.5.md §二：
 *   ① R1：全屏弹窗（设置屏 ui.navigate settings）开着 → 四角常驻件**统一降对比 + 禁点**；
 *           弹窗关 → **全恢复**（逐项断言，不是「看起来没问题」）。
 *   ② R4：全屏弹窗 **ESC 可关** + **点遮罩可关** —— 双途径各自断言。
 *   ③ R2：侧滑抽屉（chat-drawer）开着 → **只压暗对侧**，四角**仍可点**（不锁、不接管全屏）。
 *
 * 与 hud/layers/__tests__/occlusion.test.ts 的分工：那一份测机制层（纯控制器），
 * 这一份测**接线**（屏真的登记进去了、真的发 ui.navigate、真的恢复）。
 */

import { createStore } from '../../core/store';
import type { HudCommand, ScreenId, WorldState } from '../../core/types';
import { HUD_LAYER_METRICS } from '../../core/theme/visual-spec';
import { createHudBusAdapter, type HudBusAdapter } from '../bridge/bus-adapter';
import {
  CHARACTER_CHAT_DRAWER_TAG,
  mountCharacterChatDrawer,
  type StratCharacterChatDrawerElement,
} from '../components/chat-drawer/chat-drawer';
import { INFO_LAYER_CSS_VARS, createInfoLayerController, type InfoLayerController } from '../layers/info-layer';
import {
  OCCLUSION_DRAWER_ATTRIBUTE,
  OCCLUSION_MODAL_ATTRIBUTE,
  createOcclusionController,
  type OcclusionController,
} from '../layers/occlusion';
import { createMainScreen } from '../screens/main-screen';
import {
  SHORTCUT_HELP_OCCLUSION_ID,
  type StratShortcutHelpElement,
} from '../components/shortcuts/shortcut-help';
import { mountShortcuts } from '../components/shortcuts/shortcut-manager';
import type { ThemeController, ThemeId } from '../theme/theme-controller';

/** 主题控制器桩：路由测试用不到皮肤。 */
function stubThemeController(): ThemeController {
  return {
    apply: (_id: ThemeId) => undefined,
    get current(): ThemeId | null { return null; },
    // 皮肤订阅（@since task_115）：路由测试用不到皮肤变化，订阅给个空实现。
    subscribe: () => () => undefined,
  };
}

function makeState(partial: Partial<WorldState> = {}, currentScreen?: ScreenId): WorldState {
  return {
    units: [],
    missions: [],
    selection: { unitIds: [], previewUnitIds: [], revision: 0 },
    characters: [],
    notices: [],
    links: [],
    messages: [],
    ...partial,
    ...(currentScreen !== undefined ? { currentScreen } : {}),
  };
}

interface Harness {
  readonly commands: HudCommand[];
  readonly store: ReturnType<typeof createStore>;
  readonly host: HTMLElement;
  /** 常驻角件（顶栏 / 控制岛 / 小地图 / 事件轨）—— 组合根挂的那几件，弹窗期间仍在 DOM 里。 */
  readonly corners: HTMLElement[];
  unmount(): void;
}

function mountHarness(): Harness {
  const commands: HudCommand[] = [];
  const store = createStore(makeState());
  const themeController = stubThemeController();
  const adapter: HudBusAdapter = createHudBusAdapter({
    themeController,
    onState: (handler) => store.subscribe(handler),
    emitCommand: (cmd) => { commands.push(cmd); },
  });
  adapter.mount();

  const layer: InfoLayerController = createInfoLayerController();
  const occlusion: OcclusionController = createOcclusionController({ l1Dim: layer });

  const host = document.createElement('div');
  document.body.appendChild(host);

  const screen = createMainScreen(adapter, { occlusion });
  const unmountScreen = screen.mount(host);

  // 首帧同步（同 main-screen.test.ts 的口径：store 订阅不会自动回放首帧）。
  store.patch(makeState());

  // 常驻角件：模拟组合根挂在宿主下的那几件（弹窗期间它们仍在 DOM 里 ——
  // 主屏布局被换掉，但覆盖层不撤，这正是 R1 要管的对象）。
  const corners: HTMLElement[] = [
    ['div', 'hud-topbar', 'corner-topbar'],
    ['div', 'hud-bottom-bar', 'corner-island'],
    ['strat-minimap', '', 'corner-minimap'],
    ['strat-marquee', '', 'corner-marquee'],
  ].map(([tag, cls, role]) => {
    const el = document.createElement(tag);
    if (cls) el.className = cls;
    el.setAttribute('data-role', role);
    host.appendChild(el);
    return el;
  });

  return {
    commands,
    store,
    host,
    corners,
    unmount: () => {
      unmountScreen();
      occlusion.destroy();
      layer.destroy();
      host.remove();
    },
  };
}

/** 键击事件桩（快捷键解析要四个修饰键位）。 */
function keyEvent(key: string): KeyboardEvent {
  return new KeyboardEvent('keydown', { key, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false });
}

function readVar(name: string): string {
  return document.documentElement.style.getPropertyValue(name);
}

describe('R1：全屏弹窗开着 → 四角降对比 + 禁点；关掉 → 全恢复', () => {
  test('设置屏（ui.navigate settings）开着：四角降对比（复用 L1 通道）+ 禁点', () => {
    const h = mountHarness();
    h.store.setCurrentScreen('settings');

    // 弹窗已登记（模态生效）。
    expect(document.documentElement.getAttribute(OCCLUSION_MODAL_ATTRIBUTE)).toBe('true');
    // 降对比走的是 096 的 L1 通道变量（没有另造通道）。
    expect(readVar(INFO_LAYER_CSS_VARS.l1Opacity)).toBe(String(HUD_LAYER_METRICS.l1DimOpacity));
    // 四角常驻件：禁点（防误触）。
    for (const corner of h.corners) {
      expect(getComputedStyle(corner).pointerEvents).toBe('none');
    }
    // 事件轨的可点部件在**影子树内部**（外层样式表穿不进去）→
    //   禁点开关靠自定义属性穿透影子边界（见 hud/layers/occlusion.ts 的 --srf-marquee-pe）。
    const marquee = h.corners.find((el) => el.tagName.toLowerCase() === 'strat-marquee');
    expect(getComputedStyle(marquee as HTMLElement).getPropertyValue('--srf-marquee-pe')).toBe('none');
    h.unmount();
  });

  test('弹窗关掉：四角全恢复（可点 + 对比回满 + 标记复位）', () => {
    const h = mountHarness();
    h.store.setCurrentScreen('settings');
    h.store.setCurrentScreen(null);

    expect(document.documentElement.getAttribute(OCCLUSION_MODAL_ATTRIBUTE)).toBe('false');
    expect(readVar(INFO_LAYER_CSS_VARS.l1Opacity)).toBe('1');
    for (const corner of h.corners) {
      expect(getComputedStyle(corner).pointerEvents).not.toBe('none');
    }
    // 事件轨的禁点开关也复位（影子树内的可点部件恢复可点）。
    const marquee = h.corners.find((el) => el.tagName.toLowerCase() === 'strat-marquee');
    expect(getComputedStyle(marquee as HTMLElement).getPropertyValue('--srf-marquee-pe')).toBe('');
    h.unmount();
  });

  test('弹窗期间 L3 演出照旧（回归：096/094 的层级机制没被破坏）', () => {
    const h = mountHarness();
    h.store.setCurrentScreen('settings');
    // 演出占用期间层级是 L3 —— 通道仍是降对比（两个触发源取最暗）。
    expect(readVar(INFO_LAYER_CSS_VARS.l1Opacity)).toBe(String(HUD_LAYER_METRICS.l1DimOpacity));
    h.unmount();
  });
});

describe('R4：全屏弹窗 ESC 可关 + 点遮罩可关（双途径必齐）', () => {
  test('ESC → 关（发 ui.navigate main，弹窗退场）', () => {
    const h = mountHarness();
    h.store.setCurrentScreen('settings');
    expect(h.host.querySelector('[data-role="modal-mask"]')).not.toBeNull();

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(h.commands).toContainEqual({ type: 'ui.navigate', screen: 'main' });
    // 弹窗退场（core 回广播 main）→ 四角全恢复。
    h.store.setCurrentScreen(null);
    expect(h.host.querySelector('[data-role="modal-mask"]')).toBeNull();
    expect(readVar(INFO_LAYER_CSS_VARS.l1Opacity)).toBe('1');
    h.unmount();
  });

  test('点遮罩 → 关（发 ui.navigate main）', () => {
    const h = mountHarness();
    h.store.setCurrentScreen('settings');
    const mask = h.host.querySelector<HTMLElement>('[data-role="modal-mask"]');
    expect(mask).not.toBeNull();

    mask?.click();
    expect(h.commands).toContainEqual({ type: 'ui.navigate', screen: 'main' });
    h.unmount();
  });

  test('点弹窗内容区**不**关（遮罩与内容是兄弟节点，点了不算点遮罩）', () => {
    const h = mountHarness();
    h.store.setCurrentScreen('settings');
    const panel = h.host.querySelector<HTMLElement>('[data-role="modal-panel"]');
    expect(panel).not.toBeNull();

    panel?.click();
    expect(h.commands).not.toContainEqual({ type: 'ui.navigate', screen: 'main' });
    h.unmount();
  });
});

describe('R2：侧滑抽屉只压暗对侧 —— 四角仍可点（不锁、不接管全屏）', () => {
  test('抽屉开着：四角照常可点、对比不降、也没有全屏弹窗', () => {
    const layer = createInfoLayerController();
    const occlusion = createOcclusionController({ l1Dim: layer });
    const host = document.createElement('div');
    document.body.appendChild(host);

    const corners: HTMLElement[] = [
      ['div', 'hud-topbar'],
      ['div', 'hud-bottom-bar'],
      ['strat-minimap', ''],
      ['strat-marquee', ''],
    ].map(([tag, cls]) => {
      const el = document.createElement(tag);
      if (cls) el.className = cls;
      host.appendChild(el);
      return el;
    });

    const unmountDrawer = mountCharacterChatDrawer(
      {
        subscribe: () => () => undefined,
        occlusion,
      },
      host
    );
    const drawer = host.querySelector(CHARACTER_CHAT_DRAWER_TAG) as StratCharacterChatDrawerElement;
    drawer.open('c1');

    // 半模态：抽屉开着，但**没有**全屏弹窗。
    expect(occlusion.state.drawer).toBe('chat-drawer');
    expect(occlusion.state.activeModal).toBeNull();
    expect(document.documentElement.getAttribute(OCCLUSION_MODAL_ATTRIBUTE)).toBe('false');
    // 对比不降（四角不暗）。
    expect(readVar(INFO_LAYER_CSS_VARS.l1Opacity)).toBe('1');
    // 四角仍可点（没被锁）。
    for (const corner of corners) {
      expect(getComputedStyle(corner).pointerEvents).not.toBe('none');
    }
    // 压暗层只压**对侧**，且不吃点击（pointer-events:none —— 压暗不是挡住）。
    // why 断言影子树里的样式表文本而不是 getComputedStyle：jsdom 不把影子树样式算进
    //   getComputedStyle（探针已验证），样式表文本才是这份断言能站住脚的证据。
    const dim = drawer.shadowRoot?.querySelector<HTMLElement>('[data-role="rail-dim"]');
    expect(dim?.getAttribute('data-active')).toBe('true');
    const shadowCss = drawer.shadowRoot?.querySelector('style')?.textContent ?? '';
    expect(shadowCss).toMatch(/\.rail-dim\s*\{[^}]*pointer-events:\s*none/);
    expect(shadowCss).toMatch(/\.rail-dim\[data-active="true"\]\s*\{\s*opacity:\s*1/);

    // 抽屉关掉：状态复位。
    drawer.close();
    expect(occlusion.state.drawer).toBeNull();
    expect(dim?.getAttribute('data-active')).toBe('false');

    unmountDrawer();
    occlusion.destroy();
    layer.destroy();
    host.remove();
  });
});

describe('R1：快捷键帮助浮层（另一个全屏弹窗）守同一条规则', () => {
  test('浮层开着：四角降对比 + 禁点；关上：全恢复', () => {
    const layer = createInfoLayerController();
    const occlusion = createOcclusionController({ l1Dim: layer });
    const host = document.createElement('div');
    document.body.appendChild(host);
    const topbar = document.createElement('div');
    topbar.className = 'hud-topbar';
    document.body.appendChild(topbar);

    const { manager, unmount } = mountShortcuts(host, {
      dispatch: () => undefined,
      getState: () => null,
      getUnitPosition: () => null,
      occlusion,
    });

    // 开浮层（? 键）。
    manager.handleKeydown(keyEvent('?'));
    const help = host.querySelector('strat-shortcut-help') as StratShortcutHelpElement;
    expect(help.opened).toBe(true);
    // 全屏弹窗 → 登记进遮挡栈 → 四角降对比（复用 L1 通道）+ 禁点。
    expect(occlusion.state.activeModal).toBe(SHORTCUT_HELP_OCCLUSION_ID);
    expect(readVar(INFO_LAYER_CSS_VARS.l1Opacity)).toBe(String(HUD_LAYER_METRICS.l1DimOpacity));
    expect(getComputedStyle(topbar).pointerEvents).toBe('none');

    // 关浮层（ESC）→ 四角全恢复。
    manager.handleKeydown(keyEvent('Escape'));
    expect(help.opened).toBe(false);
    expect(occlusion.state.activeModal).toBeNull();
    expect(readVar(INFO_LAYER_CSS_VARS.l1Opacity)).toBe('1');
    expect(getComputedStyle(topbar).pointerEvents).not.toBe('none');

    unmount();
    occlusion.destroy();
    layer.destroy();
    host.remove();
    topbar.remove();
  });
});
