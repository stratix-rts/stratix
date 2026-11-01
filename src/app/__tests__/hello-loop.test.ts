/**
 * 集成测试：**HelloLoop 全闭环** —— HUD 按钮 → HudCommand → core 选择状态机 → WorldState
 *   → world 桥接层 → 战场场景；反向：战场点击 → WorldEvent → core → HUD 显示。
 *   对应 docs/REFACTOR_PLAN_V3.md §6 Phase 1「联调验收（hello loop）」。
 *
 * 全部零件都是真的：真实 core/bus 单例、真实 createStore()、真实 core/runtime、
 *   真实 hud bus-adapter、真实 main-screen + strat-button（jsdom 里真点 shadow DOM 里的 <button>）、
 *   真实 world 桥接层 createWorldBridge + 真实 UnitRegistry。
 *   唯一的替身是 battlefield 场景本体（Phaser 需要 WebGL/canvas，jest 里跑不起来），
 *   替身只实现 WorldScenePort 这一个接口 —— 也就是"场景"在总线意义上的全部边界；
 *   断言打在桥接层交付给场景的数据上（哪些单位该高亮），不断言像素（任务允许）。
 *
 * @jest-environment jsdom
 */

import * as fs from 'fs';
import * as path from 'path';

import { emitCommand, onState, resetBus } from '../../core/bus';
import { createCoreRuntime, type UnhandledChannel } from '../../core/runtime';
import { createStore, type CoreStore } from '../../core/store';
import type { UnitView, WorldState } from '../../core/types';
import { createHudBusAdapter } from '../../hud/bridge/bus-adapter';
import { createMainScreen, MAIN_SCREEN_TAG } from '../../hud/screens/main-screen';
import { createThemeController } from '../../hud/theme/theme-controller';
import { STRAT_BUTTON_TAG } from '../../hud/widgets/strat-button';
import { createWorldBridge, type WorldBridge, type WorldScenePort } from '../../world/bridge/bus-adapter';
import { UnitRegistry } from '../../world/objects/unit-registry';

import { createHelloLoopPanel, type HelloLoopPanelHandle } from '../dev/hello-loop-panel';

const readTokenCss = (name: string): string =>
  fs.readFileSync(path.join(__dirname, '..', '..', 'hud', 'theme', name), 'utf-8');

const UNITS: UnitView[] = [
  { id: 'u-neo', name: 'Neo', status: 'idle', missionId: null, power: 3 },
  { id: 'u-trinity', name: 'Trinity', status: 'busy', missionId: null, power: 5 },
  { id: 'u-morpheus', name: 'Morpheus', status: 'idle', missionId: null, power: 4 },
];

const NO_MODS = { shift: false, ctrl: false, meta: false, alt: false };

// ============================================================================
// 场景替身：真实 UnitRegistry 做对账，"高亮" = 选择集 ∩ 场内单位
// ============================================================================

class RecordingBattlefield implements WorldScenePort {
  readonly registry = new UnitRegistry();
  /** 桥接层每次交付给场景的选择集（场景据此决定哪些环亮起）。 */
  readonly selectionSyncs: string[][] = [];
  private selection: readonly string[] = [];

  syncUnits(units: readonly UnitView[]): void {
    this.registry.sync(units);
  }

  syncSelection(selection: WorldState['selection']): void {
    this.selection = selection.unitIds;
    this.selectionSyncs.push([...selection.unitIds]);
  }

  /** 当前真正会被画上选中环的单位：选中的 id 必须确实在场内，否则高亮无从谈起。 */
  get highlighted(): string[] {
    return this.selection.filter((id) => this.registry.get(id) !== undefined);
  }
}

// ============================================================================
// 应用装配：与 src/app/dev/hello-loop-entry.ts 同一套接线，只把 Phaser.Game 换成场景替身
// ============================================================================

interface App {
  store: CoreStore;
  screen: ReturnType<typeof createMainScreen>;
  panel: HelloLoopPanelHandle;
  screenHost: HTMLElement;
  panelHost: HTMLElement;
  battlefield: RecordingBattlefield;
  bridge: WorldBridge;
  states: WorldState[];
  unhandled: { channel: UnhandledChannel; type: string }[];
  unmount: () => void;
}

function mountHost(id: string): HTMLElement {
  const host = document.createElement('div');
  host.id = id;
  document.body.appendChild(host);
  return host;
}

function bootApp(): App {
  const store = createStore();
  const states: WorldState[] = [];
  const unhandled: { channel: UnhandledChannel; type: string }[] = [];

  // core 侧：状态机 ↔ 总线（闭环的接线）
  const runtime = createCoreRuntime({
    store,
    onUnhandled: (channel, payload) => unhandled.push({ channel, type: payload.type }),
  });
  const stopRuntime = runtime.start();
  const offState = onState((state) => states.push(state));

  // world 侧：真实桥接层 → 场景端口
  const battlefield = new RecordingBattlefield();
  const bridge = createWorldBridge(battlefield);

  // hud 侧：真实适配器 + 真实组件（皮肤 token 走真实 <style> 注入，切换可验）
  const themeController = createThemeController({
    sources: {
      default: readTokenCss('tokens-default.css'),
      pixel: readTokenCss('tokens-pixel.css'),
    },
    initial: 'default',
  });
  const adapter = createHudBusAdapter({
    onState,
    emitCommand,
    themeController,
  });

  const screenHost = mountHost('hud-root');
  const panelHost = mountHost('loop-panel');

  const screen = createMainScreen(adapter);
  const unmountScreen = screen.mount(screenHost);
  const panel = createHelloLoopPanel(adapter, { units: UNITS });
  const unmountPanel = panel.mount(panelHost);
  adapter.mount();

  return {
    store,
    screen,
    panel,
    screenHost,
    panelHost,
    battlefield,
    bridge,
    states,
    unhandled,
    unmount: () => {
      unmountPanel();
      unmountScreen();
      adapter.mount(); // 退订 state
      bridge.destroy();
      stopRuntime();
      offState();
      screenHost.remove();
      panelHost.remove();
    },
  };
}

/** 点真实的 strat-button：进 shadow DOM 点它自己的 <button>，走组件真实的事件链。 */
function clickPanelButton(host: HTMLElement, unitId: string, mode: 'set' | 'toggle'): void {
  const btn = host.querySelector<HTMLElement>(
    `${STRAT_BUTTON_TAG}[data-unit="${unitId}"][data-mode="${mode}"]`
  );
  if (!btn) throw new Error(`按钮未渲染: ${unitId}/${mode}`);
  const inner = btn.shadowRoot?.querySelector('button');
  if (!inner) throw new Error(`strat-button 未 upgrade（shadowRoot 为空）: ${unitId}`);
  (inner as HTMLButtonElement).click();
}

/** 点 main-screen 顶栏的第 index 个 strat-button（0=切皮肤，1=去设置）。 */
function clickScreenButton(host: HTMLElement, index: number): void {
  const btn = host.querySelectorAll<HTMLElement>(STRAT_BUTTON_TAG).item(index);
  if (!btn) throw new Error(`main-screen 第 ${index} 个按钮不存在`);
  const inner = btn.shadowRoot?.querySelector('button');
  if (!inner) throw new Error(`main-screen 第 ${index} 个 strat-button 未 upgrade`);
  (inner as HTMLButtonElement).click();
}

let apps: App[] = [];

beforeEach(() => {
  resetBus();
  apps = [];
  document.body.innerHTML = '';
});

afterEach(() => {
  apps.forEach((app) => app.unmount());
  apps = [];
  document.body.innerHTML = '';
  resetBus();
});

// ============================================================================
// 用例
// ============================================================================

describe('HUD → core → world：Phase 1 选定的闭环链路', () => {
  test('HUD 按钮 unit.select → core 状态机 → WorldState → world 场景高亮', () => {
    const app = bootApp();
    apps.push(app);

    // 真实 store 广播单位快照：战场据此对账出 3 个在场单位
    app.store.patch({ units: UNITS });
    expect(app.battlefield.registry.size).toBe(3);
    expect(app.battlefield.highlighted).toEqual([]);

    clickPanelButton(app.panelHost, 'u-trinity', 'set');

    // 1. 命令确实进了 core 状态机
    expect(app.store.getState().selection.unitIds).toEqual(['u-trinity']);
    // 2. 状态确实以快照形式广播了出去（core → 两层唯一出口）
    const lastState = app.states[app.states.length - 1];
    expect(lastState.selection.unitIds).toEqual(['u-trinity']);
    // 3. world 桥接层确实把选择集交给了场景，且高亮落在真实存在的单位上
    expect(app.battlefield.selectionSyncs[app.battlefield.selectionSyncs.length - 1]).toEqual(['u-trinity']);
    expect(app.battlefield.highlighted).toEqual(['u-trinity']);
    // 4. HUD 自己读回的也是同一份状态
    expect(app.panel.lastSelection).toEqual(['u-trinity']);
  });

  test('HUD 侧 main-screen 的单元计数来自真实广播', () => {
    const app = bootApp();
    apps.push(app);

    expect(app.screenHost.querySelector('[data-role="unit-count"]')?.textContent).toBe('0');
    app.store.patch({ units: UNITS });
    expect(app.screenHost.querySelector('[data-role="unit-count"]')?.textContent).toBe('3');
    expect(app.screenHost.querySelector(MAIN_SCREEN_TAG.toLowerCase())).toBeNull(); // main-screen 是壳，不占自定义标签位
  });
});

describe('world → core → HUD：反向那一半', () => {
  test('战场点击单位 → WorldEvent → core 选择状态机 → HUD 显示选中', () => {
    const app = bootApp();
    apps.push(app);
    app.store.patch({ units: UNITS });

    // 场景侧命中测试后由桥接层上报（BattlefieldScene.onPointerUp 的真实出口）
    app.bridge.unitClick('u-morpheus', NO_MODS);

    expect(app.store.getState().selection.unitIds).toEqual(['u-morpheus']);
    expect(app.panel.lastSelection).toEqual(['u-morpheus']);
    expect(app.battlefield.highlighted).toEqual(['u-morpheus']);
  });

  test('带 Shift 的战场点击是加选，与 HUD 的 toggle 语义一致', () => {
    const app = bootApp();
    apps.push(app);
    app.store.patch({ units: UNITS });

    clickPanelButton(app.panelHost, 'u-neo', 'set');
    app.bridge.unitClick('u-trinity', { ...NO_MODS, shift: true });

    expect(app.store.getState().selection.unitIds).toEqual(['u-neo', 'u-trinity']);
    expect(app.battlefield.highlighted).toEqual(['u-neo', 'u-trinity']);
  });

  test('点不存在的单位不会在战场上留下悬空高亮', () => {
    const app = bootApp();
    apps.push(app);
    app.store.patch({ units: UNITS });

    app.bridge.unitClick('u-ghost', NO_MODS);

    expect(app.store.getState().selection.unitIds).toEqual([]);
    expect(app.battlefield.highlighted).toEqual([]);
  });
});

describe('往返与清理', () => {
  test('HUD 选中 → 战场点击 → HUD 再选中，三段交替仍保持单一真相', () => {
    const app = bootApp();
    apps.push(app);
    app.store.patch({ units: UNITS });

    clickPanelButton(app.panelHost, 'u-neo', 'set');
    const statesAfterPatch = app.states.length;
    app.bridge.unitClick('u-morpheus', { ...NO_MODS, shift: true });
    clickPanelButton(app.panelHost, 'u-morpheus', 'toggle'); // 取消其中一个

    expect(app.store.getState().selection.unitIds).toEqual(['u-neo']);
    expect(app.panel.lastSelection).toEqual(['u-neo']);
    expect(app.battlefield.highlighted).toEqual(['u-neo']);
    // 一次用户操作一次广播：2 次点击 → 2 份新快照（不合并、不重复）
    expect(app.states.length - statesAfterPatch).toBe(2);
  });

  test('清空按钮把选择集与场景高亮一起清掉', () => {
    const app = bootApp();
    apps.push(app);
    app.store.patch({ units: UNITS });

    clickPanelButton(app.panelHost, 'u-neo', 'set');
    const clearBtn = app.panelHost.querySelector<HTMLElement>(`${STRAT_BUTTON_TAG}[data-role="clear"]`);
    (clearBtn?.shadowRoot?.querySelector('button') as HTMLButtonElement).click();

    expect(app.store.getState().selection.unitIds).toEqual([]);
    expect(app.battlefield.highlighted).toEqual([]);
  });

  test('unmount 后命令与状态都不再流动（监听器全部退订）', () => {
    const app = bootApp();
    app.store.patch({ units: UNITS });
    const statesBefore = app.states.length;

    app.unmount();

    emitCommand({ type: 'unit.select', unitIds: ['u-neo'], mode: 'set' });

    expect(app.states).toHaveLength(statesBefore);
    expect(app.store.getState().selection.unitIds).toEqual([]);
  });
});

describe('尚未落地的命令：走对上总线，不静默吞掉', () => {
  test('main-screen 的切皮肤按钮：本地落皮肤 + 命令进总线等 Phase 2 接手', () => {
    const app = bootApp();
    apps.push(app);

    clickScreenButton(app.screenHost, 0); // 顶栏「切换像素风」

    expect(app.screen.currentThemeId).toBe('pixel');
    expect(app.screenHost.querySelector('[data-role="theme-tag"]')?.textContent).toBe('pixel');
    expect(document.getElementById('srf-theme-pixel')?.hasAttribute('disabled')).toBe(false);
    expect(app.unhandled).toContainEqual({ channel: 'command', type: 'theme.set' });
  });
});