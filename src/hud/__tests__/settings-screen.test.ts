/**
 * 集成测试：设置屏（hud/screens/settings-screen.ts）。
 * 覆盖：三组设置项渲染、皮肤切换（真 theme-controller + 真 token 文件 → 断言 DOM 上 token 换掉）、
 *   偏好开关走 HudCommand → core store → WorldState 广播 → 本屏重渲染的闭环、危险区两步确认、
 *   卸载退订、渲染判重，以及纯派生函数。
 * @jest-environment jsdom
 *
 * 闭环那一段不打桩总线：store / bus-adapter / theme-controller 都是真件。
 * 唯一接缝是 emitCommand：settings.set 的落库动作由 core/store.ts 的 setPreference 承担
 * （任务分工规定本任务不动 core/runtime.ts，命令分发接线见 core/runtime.ts 的 TODO）。
 */

import * as fs from 'fs';
import * as path from 'path';

import { resetBus } from '../../core/bus';
import { createStore } from '../../core/store';
import type { HudCommand, UnitView, WorldState } from '../../core/types';
import { createHudBusAdapter } from '../bridge/bus-adapter';
import { createThemeController, STYLE_ID_PREFIX } from '../theme/theme-controller';

import {
  DANGER_ACTIONS,
  LANGUAGE_LABEL,
  PREFERENCE_ROWS,
  SETTINGS_SCREEN_TAG,
  mountSettingsScreen,
  resolvePreferences,
  settingsSignature,
  type SettingsScreenDeps,
  type StratSettingsScreenElement,
} from '../screens/settings-screen';

const UNITS: UnitView[] = [
  { id: 'u-neo', name: 'Neo', status: 'idle', missionId: null, power: 3 },
];

function makeState(partial: Partial<WorldState> = {}): WorldState {
  return {
    units: UNITS,
    missions: [],
    selection: { unitIds: [], previewUnitIds: [], revision: 0 },
    characters: [],
    notices: [],
    links: [],
    messages: [],
    ...partial,
  };
}

const readCss = (name: string): string =>
  fs.readFileSync(path.join(__dirname, '..', 'theme', name), 'utf-8');

/**
 * 测试夹具：真 store + 真 adapter；emitCommand 里把 settings.set 交给 store.setPreference
 * （就是 core/runtime.ts 待接线的那一段），其余命令只记账，便于断言"屏发了什么"。
 * 屏拿到的是包了一层的 deps：只多包一个订阅计数器，用来断言卸载确实退订。
 */
interface Harness {
  readonly screen: StratSettingsScreenElement;
  readonly host: HTMLElement;
  readonly commands: HudCommand[];
  readonly store: ReturnType<typeof createStore>;
  /** core 广播一份新状态（走 adapter.subscribe 的真实订阅链）。 */
  emit(state: WorldState): void;
  /** 本屏在 adapter 上的订阅数（用来验证退订）。 */
  screenSubscriberCount(): number;
  unmount(): void;
}

function mountScreen(partialState: Partial<WorldState> = {}): Harness {
  const commands: HudCommand[] = [];
  const store = createStore(partialState);
  const themeController = createThemeController({
    sources: { default: readCss('tokens-default.css'), pixel: readCss('tokens-pixel.css') },
    initial: 'default',
  });
  let screenSubscribers = 0;

  const adapter = createHudBusAdapter({
    themeController,
    onState: (handler) => store.subscribe(handler),
    emitCommand: (command) => {
      commands.push(command);
      if (command.type === 'settings.set') store.setPreference(command.key, command.value);
    },
  });
  const unmountAdapter = adapter.mount();

  const screenDeps: SettingsScreenDeps = {
    dispatch: (command) => adapter.dispatch(command),
    subscribe: (handler) => {
      screenSubscribers += 1;
      const off = adapter.subscribe(handler);
      return () => { screenSubscribers -= 1; off(); };
    },
  };

  const host = document.createElement('div');
  document.body.appendChild(host);
  const unmountScreen = mountSettingsScreen(screenDeps, host);
  const screen = host.querySelector(SETTINGS_SCREEN_TAG) as StratSettingsScreenElement;
  if (!screen?.shadowRoot) throw new Error('设置屏未 upgrade（shadowRoot 为空）');

  return {
    screen,
    host,
    commands,
    store,
    // patch 而非 setState：同值也强制广播一次（模拟"core 每次状态变更都全量广播"）
    emit: (state) => { store.patch(state); },
    screenSubscriberCount: () => screenSubscribers,
    unmount: () => {
      unmountScreen();
      unmountAdapter();
      host.remove();
      document.head.querySelectorAll(`style[id^="${STYLE_ID_PREFIX}"]`).forEach((n) => n.remove());
    },
  };
}

/** 进 shadow DOM 点真实控件：走组件自己的事件链，不直接调方法。 */
function clickInScreen(screen: StratSettingsScreenElement, selector: string): void {
  const node = screen.shadowRoot?.querySelector<HTMLElement>(selector);
  if (!node) throw new Error(`控件未渲染: ${selector}`);
  node.click();
}

function screenText(screen: StratSettingsScreenElement, selector: string): string {
  return screen.shadowRoot?.querySelector(selector)?.textContent ?? '';
}

describe('纯派生函数', () => {
  test('settings 缺省时回落到契约默认值（两侧共用同一个 DEFAULT_SETTINGS）', () => {
    expect(resolvePreferences(null).soundEnabled).toBe(true);
    expect(resolvePreferences(makeState()).notificationsEnabled).toBe(true);
  });

  test('settings 存在时以 core 广播为准', () => {
    const state = makeState({ settings: { soundEnabled: false, notificationsEnabled: true } });
    expect(resolvePreferences(state).soundEnabled).toBe(false);
  });

  test('渲染签名只跟偏好走：单位/任务变动不触发本屏重绘', () => {
    const base = makeState({ settings: { soundEnabled: true, notificationsEnabled: true } });
    expect(settingsSignature(base)).toBe(
      settingsSignature(makeState({
        units: [],
        missions: [{ id: 'm1', title: '侦察', phase: 'running', unitIds: [], createdAt: 1 }],
        settings: { soundEnabled: true, notificationsEnabled: true },
      }))
    );
    expect(settingsSignature(base)).not.toBe(
      settingsSignature(makeState({
        settings: { soundEnabled: false, notificationsEnabled: true },
      }))
    );
  });

  test('偏好词表与危险动作词表不是空的（防止渲染层漏渲染整组）', () => {
    expect(PREFERENCE_ROWS.map((r) => r.key)).toEqual(['soundEnabled', 'notificationsEnabled']);
    expect(DANGER_ACTIONS.map((a) => a.id)).toEqual(['selection.reset', 'cache.clear']);
  });
});

describe('设置屏：挂载与渲染', () => {
  let h: Harness | undefined;
  afterEach(() => { h?.unmount(); h = undefined; });

  test('挂载后展示三组设置项（外观 / 偏好 / 危险区）', () => {
    h = mountScreen();
    h.emit(h.store.getState());
    const root = h.screen.shadowRoot;
    expect(root?.querySelector('[data-group="appearance"]')).not.toBeNull();
    expect(root?.querySelector('[data-group="preferences"]')).not.toBeNull();
    expect(root?.querySelector('[data-group="danger"]')).not.toBeNull();
    expect(root?.querySelector('button[data-skin="default"]')).not.toBeNull();
    expect(root?.querySelector('button[data-skin="pixel"]')).not.toBeNull();
  });

  test('语言只读展示（当前契约无 locale 字段，不给假的下拉）', () => {
    h = mountScreen();
    h.emit(h.store.getState());
    expect(screenText(h.screen, '[data-role="language"]')).toBe(LANGUAGE_LABEL);
    // 只读：没有可点的语言控件
    expect(h.screen.shadowRoot?.querySelector('button[data-lang]')).toBeNull();
  });

  test('偏好开关按 core 广播的值渲染（开/关）', () => {
    h = mountScreen({ settings: { soundEnabled: false, notificationsEnabled: true } });
    h.emit(h.store.getState());
    const sound = h.screen.shadowRoot?.querySelector('button[data-pref="soundEnabled"]');
    expect(sound?.getAttribute('aria-checked')).toBe('false');
    expect(sound?.textContent).toBe('关');
    const notice = h.screen.shadowRoot?.querySelector('button[data-pref="notificationsEnabled"]');
    expect(notice?.getAttribute('aria-checked')).toBe('true');
  });

  test('返回主屏 → ui.navigate(main)（点 strat-button 的真按钮，走完整事件链）', () => {
    h = mountScreen();
    h.emit(h.store.getState());
    const back = h.screen.shadowRoot?.querySelector('[data-role="back"]') as
      | (HTMLElement & { shadowRoot: ShadowRoot | null })
      | null;
    const inner = back?.shadowRoot?.querySelector('button');
    if (!inner) throw new Error('返回按钮未渲染');
    inner.click();
    expect(h.commands).toContainEqual({ type: 'ui.navigate', screen: 'main' });
  });
});

describe('皮肤切换：实测 token 换掉（真 theme-controller + 真 token 文件）', () => {
  let h: Harness | undefined;
  afterEach(() => { h?.unmount(); h = undefined; });

  test('点像素 → 发 theme.set，且两张 token 表的启用状态真的翻转', () => {
    h = mountScreen();
    h.emit(h.store.getState());

    const sheet = (id: 'default' | 'pixel'): HTMLStyleElement =>
      document.getElementById(`${STYLE_ID_PREFIX}${id}`) as HTMLStyleElement;
    // jsdom 把 style.disabled 当普通 expando：没被显式赋值读到的是 undefined（= 生效中），
    // 所以统一按「是否为 true」判禁用，不直接断言 === false。
    const isDisabled = (id: 'default' | 'pixel'): boolean => sheet(id).disabled === true;

    // 初始皮肤是 modern：default 表生效、pixel 表禁用
    expect(isDisabled('default')).toBe(false);
    expect(isDisabled('pixel')).toBe(true);
    expect(h.screen.currentThemeId).toBe('default');

    clickInScreen(h.screen, 'button[data-skin="pixel"]');

    expect(h.commands).toContainEqual({ type: 'theme.set', themeId: 'pixel' });
    // 真的换掉了：生效的那张表内容是像素皮肤的 token
    expect(isDisabled('pixel')).toBe(false);
    expect(isDisabled('default')).toBe(true);
    expect(sheet('pixel').textContent).toContain('--srf-border-width: 2px;');
    expect(h.screen.currentThemeId).toBe('pixel');
    expect(
      h.screen.shadowRoot?.querySelector('button[data-skin="pixel"]')?.getAttribute('data-active')
    ).toBe('true');
  });

  test('重复点当前皮肤是 no-op：不再发命令（避免来回切的无谓广播）', () => {
    h = mountScreen();
    h.emit(h.store.getState());
    clickInScreen(h.screen, 'button[data-skin="default"]');
    expect(h.commands).toHaveLength(0);
  });
});

describe('偏好开关：HudCommand → core store → WorldState → 本屏', () => {
  let h: Harness | undefined;
  afterEach(() => { h?.unmount(); h = undefined; });

  test('点音效开关 → settings.set(false) → 落库 → 广播 → 本屏换成「关」', () => {
    h = mountScreen();
    h.emit(h.store.getState());

    clickInScreen(h.screen, 'button[data-pref="soundEnabled"]');

    expect(h.commands).toContainEqual({ type: 'settings.set', key: 'soundEnabled', value: false });
    expect(h.store.getState().settings?.soundEnabled).toBe(false);
    const node = h.screen.shadowRoot?.querySelector('button[data-pref="soundEnabled"]');
    expect(node?.getAttribute('aria-checked')).toBe('false');
    expect(node?.textContent).toBe('关');
  });

  test('再点一次回到开（值取自 core 当前值，不是本地自增）', () => {
    h = mountScreen({ settings: { soundEnabled: false, notificationsEnabled: true } });
    h.emit(h.store.getState());

    clickInScreen(h.screen, 'button[data-pref="soundEnabled"]');

    expect(h.store.getState().settings?.soundEnabled).toBe(true);
  });

  test('无实质变化时不广播（设置屏不因别的状态变动重绘：DOM 节点身份不变）', () => {
    h = mountScreen();
    h.emit(h.store.getState());
    const before = h.screen.shadowRoot?.querySelector('[data-pref-row="soundEnabled"]');

    // 与偏好无关的状态变动（多了一个单位）：签名不变 → 不重绘
    h.emit(makeState({
      units: [...UNITS, { id: 'u-2', name: 'Trinity', status: 'idle', missionId: null, power: 5 }],
      settings: h.store.getState().settings,
    }));

    const after = h.screen.shadowRoot?.querySelector('[data-pref-row="soundEnabled"]');
    expect(after).toBe(before);
  });
});

describe('危险区：两步确认', () => {
  let h: Harness | undefined;
  afterEach(() => { h?.unmount(); h = undefined; });

  test('第一下只进入确认态，不发命令', () => {
    h = mountScreen();
    h.emit(h.store.getState());

    clickInScreen(h.screen, 'button[data-danger="selection.reset"]');

    expect(h.commands).toHaveLength(0);
    expect(h.screen.shadowRoot?.querySelector('[data-role="confirm-selection.reset"]')).not.toBeNull();
  });

  test('确认后才发命令；取消则什么都不发', () => {
    h = mountScreen();
    h.emit(h.store.getState());

    clickInScreen(h.screen, 'button[data-danger="cache.clear"]');
    clickInScreen(h.screen, 'button[data-danger-cancel="cache.clear"]');
    expect(h.commands).toHaveLength(0);
    expect(h.screen.shadowRoot?.querySelector('[data-role="confirm-cache.clear"]')).toBeNull();

    clickInScreen(h.screen, 'button[data-danger="selection.reset"]');
    clickInScreen(h.screen, 'button[data-danger-confirm="selection.reset"]');

    expect(h.commands).toEqual([{ type: 'selection.reset' }]);
    expect(h.screen.shadowRoot?.querySelector('[data-role="confirm-selection.reset"]')).toBeNull();
  });
});

describe('生命周期', () => {
  let h: Harness | undefined;
  afterEach(() => { h?.unmount(); h = undefined; });

  test('卸载后本屏退订（反复挂卸不累积监听器）', () => {
    resetBus();
    h = mountScreen();
    h.emit(h.store.getState());
    expect(h.screenSubscriberCount()).toBe(1);
    h.unmount();
    expect(h.screenSubscriberCount()).toBe(0);
    h = undefined;
    resetBus();
  });
});