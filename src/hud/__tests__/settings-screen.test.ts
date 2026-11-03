/**
 * 集成测试：设置屏（hud/screens/settings-screen.ts）。
 * 覆盖：三组设置项渲染、皮肤切换（真 theme-controller + 真 token 文件 → 断言 DOM 上 token 换掉）、
 *   四个偏好开关走 localStorage 直写（点击文字翻转 + 键落盘 + 刷新保持）、
 *   危险区的弹窗二次确认（确认/取消/ESC/点遮罩，且不莫名退屏）、未落地命令不给可点按钮、
 *   卸载退订、渲染判重，以及纯派生函数。
 * @jest-environment jsdom
 *
 * @since v3.6（task_116）偏好改为 localStorage 直写：core 从未接线 settings.set
 *   （WorldState 是进程内状态，刷新即回默认值），故本屏不再派发 settings.set，
 *   也不再等 core 广播 —— 断言口径改为"键值 + DOM 文字"。
 *
 * 闭环那一段不打桩总线：store / bus-adapter / theme-controller 都是真件。
 * 唯一接缝是 emitCommand：只记账，便于断言"屏发了什么命令"。
 */

import * as fs from 'fs';
import * as path from 'path';

import { resetBus } from '../../core/bus';
import { createStore } from '../../core/store';
import type { HudCommand, UnitView, WorldState } from '../../core/types';
import { createHudBusAdapter } from '../bridge/bus-adapter';
import { createOcclusionController } from '../layers/occlusion';
import { readSoundVolume } from '../sound-engine';
import { createThemeController, STYLE_ID_PREFIX } from '../theme/theme-controller';
import type { CustomAgentsPort } from '../screens/custom-agents-port';

import {
  DANGER_ACTIONS,
  DANGER_CONFIRM_OCCLUSION_ID,
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
    // 皮肤（@since v3.6，task_115）：本屏的高亮读 adapter.themeId —— 真控制器，token 切换可验。
    // why 用 getter 而不是快照值：皮肤是活的真相，快照会在切完之后停在旧皮肤上。
    get themeId() { return adapter.themeId; },
    subscribeTheme: (listener) => adapter.subscribeTheme(listener),
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
  // 偏好真相源是本机持久层（@since v3.6，task_116）：WorldState 是进程内状态，刷新即回默认值，
  // 且 core 从未接线 settings.set —— 派发出去只会等不到广播（死功能 #4 的根因）。
  beforeEach(() => {
    localStorage.clear();
  });

  test('偏好缺省全开（localStorage 无键 = 开 —— 增强项缺省关会让"没反应"难排查）', () => {
    const values = resolvePreferences();
    expect(values.notificationsEnabled).toBe(true);
    expect(values.sfx).toBe(true);
    expect(values.context).toBe(true);
    expect(values.nametags).toBe(true);
  });

  test('preference 值为 0 → 读作关（键值口径：\'0\' = 关，其余 = 开）', () => {
    localStorage.setItem('stratix.sfx.enabled', '0');
    localStorage.setItem('stratix.context.enabled', '0');
    const values = resolvePreferences();
    expect(values.sfx).toBe(false);
    expect(values.context).toBe(false);
    // 没动的那两行不受影响
    expect(values.notificationsEnabled).toBe(true);
    expect(values.nametags).toBe(true);
  });

  test('渲染签名只跟偏好走：core 状态变动（单位/任务）不改变签名', () => {
    const before = settingsSignature();
    // core 侧的变动（单位、任务）不该影响本屏签名 —— 偏好在 localStorage，不在 WorldState。
    expect(before).toBe(settingsSignature());
    // 偏好翻转 → 签名变（本屏据此重绘）
    localStorage.setItem('stratix.notifications.enabled', '0');
    expect(settingsSignature()).not.toBe(before);
  });

  test('偏好词表与危险动作词表不是空的（防止渲染层漏渲染整组）', () => {
    // 四个偏好行统一走 localStorage（task_116）：通知 / 音效 / 上下文注入 / 单位名字。
    expect(PREFERENCE_ROWS.map((r) => r.id)).toEqual([
      'notificationsEnabled',
      'sfx',
      'context',
      'nametags',
    ]);
    expect(DANGER_ACTIONS.map((a) => a.id)).toEqual(['selection.reset', 'cache.clear']);
    // 危险区：只有落地的命令给可点按钮（未落地 = 不呈现为可用）。
    expect(DANGER_ACTIONS.find((a) => a.id === 'selection.reset')?.implemented).toBe(true);
    expect(DANGER_ACTIONS.find((a) => a.id === 'cache.clear')?.implemented).toBe(false);
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

  test('偏好开关按本机持久层的值渲染（开/关）', () => {
    // @since v3.6（task_116）：偏好真相源是 localStorage（不是 core 广播）——
    //   预置 '0' → 挂载即读作关。
    localStorage.setItem('stratix.notifications.enabled', '0');
    h = mountScreen();
    h.emit(h.store.getState());
    const notice = h.screen.shadowRoot?.querySelector('button[data-pref="notificationsEnabled"]');
    expect(notice?.getAttribute('aria-checked')).toBe('false');
    expect(notice?.textContent).toBe('关');
    // 音效行走自己的键（data-pref="sfx"），没有 soundEnabled 这个契约键的按钮了。
    expect(h.screen.shadowRoot?.querySelector('button[data-pref="soundEnabled"]')).toBeNull();
    expect(h.screen.shadowRoot?.querySelector('button[data-pref="sfx"]')).not.toBeNull();
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

// ============================================================================
// 偏好开关（@since v3.6，task_116）：四个开关统一走 localStorage 直写
//   —— 点击 → 文字在「开 / 关」之间翻转 + 键落盘 + 刷新后仍是上次那个值。
//   why 不发 settings.set：core 从未接线那条命令，派发出去只会等不到广播（死功能 #4）。
// ============================================================================

describe('偏好开关：localStorage 直写 → 文字翻转 → 刷新保持', () => {
  let h: Harness | undefined;
  beforeEach(() => { localStorage.clear(); });
  afterEach(() => { h?.unmount(); h = undefined; localStorage.clear(); });

  /** 四行偏好各自的存储键（与词表一致，写在用例里避免"用实现验证实现"）。 */
  const ROWS: ReadonlyArray<{ id: string; key: string; selector: string }> = [
    { id: 'notificationsEnabled', key: 'stratix.notifications.enabled', selector: 'button[data-pref="notificationsEnabled"]' },
    { id: 'sfx', key: 'stratix.sfx.enabled', selector: 'button[data-pref="sfx"]' },
    { id: 'context', key: 'stratix.context.enabled', selector: 'button[data-pref="context"]' },
    { id: 'nametags', key: 'stratix.unit.nametags', selector: 'button[data-pref="nametags"]' },
  ];

  test.each(ROWS)('点「$id」→ 文字翻转为关 + 键落盘 0 + 零命令派发', (row) => {
    h = mountScreen();
    h.emit(h.store.getState());
    const node = () => h!.screen.shadowRoot?.querySelector(row.selector);

    // 缺省开
    expect(node()?.getAttribute('aria-checked')).toBe('true');
    expect(node()?.textContent).toBe('开');

    clickInScreen(h.screen, row.selector);

    // 文字真的翻了（0 像素变化 → 死功能 #4 的原症状，这里断言文本与 aria 同时变）
    expect(node()?.getAttribute('aria-checked')).toBe('false');
    expect(node()?.textContent).toBe('关');
    // 值落盘（'0' = 关）
    expect(localStorage.getItem(row.key)).toBe('0');
    // 不发 HudCommand（偏好只在本机生效）
    expect(h.commands).toHaveLength(0);
  });

  test.each(ROWS)('再点一次 → 回到开 + 键写 1', (row) => {
    h = mountScreen();
    h.emit(h.store.getState());

    clickInScreen(h.screen, row.selector);
    clickInScreen(h.screen, row.selector);

    const node = h.screen.shadowRoot?.querySelector(row.selector);
    expect(node?.getAttribute('aria-checked')).toBe('true');
    expect(node?.textContent).toBe('开');
    expect(localStorage.getItem(row.key)).toBe('1');
  });

  test('刷新后仍是上次那个值（卸载重挂 = 刷新；值取自持久层，不是内存计数）', () => {
    h = mountScreen();
    h.emit(h.store.getState());
    clickInScreen(h.screen, 'button[data-pref="notificationsEnabled"]');
    expect(localStorage.getItem('stratix.notifications.enabled')).toBe('0');

    // 卸了再挂（等价于刷新页面）
    h.unmount();
    h = mountScreen();
    h.emit(h.store.getState());

    const node = h.screen.shadowRoot?.querySelector('button[data-pref="notificationsEnabled"]');
    expect(node?.getAttribute('aria-checked')).toBe('false');
    expect(node?.textContent).toBe('关');
  });

  test('每行 DOM 上带出存储键（data-storage-key）—— 断言不用猜键名', () => {
    h = mountScreen();
    h.emit(h.store.getState());
    for (const row of ROWS) {
      const node = h.screen.shadowRoot?.querySelector(row.selector);
      expect(node?.getAttribute('data-storage-key')).toBe(row.key);
    }
  });

  test('无实质变化时不重绘（core 侧与偏好无关的变动不改 DOM 节点身份）', () => {
    h = mountScreen();
    h.emit(h.store.getState());
    const before = h.screen.shadowRoot?.querySelector('[data-pref-row="notificationsEnabled"]');

    // 与偏好无关的状态变动（多了一个单位）：签名不变 → 不重绘
    h.emit(makeState({
      units: [...UNITS, { id: 'u-2', name: 'Trinity', status: 'idle', missionId: null, power: 5 }],
    }));

    const after = h.screen.shadowRoot?.querySelector('[data-pref-row="notificationsEnabled"]');
    expect(after).toBe(before);
  });
});

// ============================================================================
// 危险区（@since v3.6，task_116）：弹窗二次确认（复用 task_112 的遮挡模式）
//   —— 先弹框、确认后才发命令、且**不再莫名退屏**；未落地的命令不给可点按钮。
// ============================================================================

describe('危险区：弹窗二次确认', () => {
  let h: Harness | undefined;
  beforeEach(() => { localStorage.clear(); });
  afterEach(() => { h?.unmount(); h = undefined; });

  /** 确认框（遮罩 + 居中面板）是否开着。 */
  const confirmOpen = (): boolean =>
    h!.screen.shadowRoot?.querySelector<HTMLElement>('[data-role="danger-confirm-layer"]')?.hidden === false;

  test('第一下只弹确认框，不发命令（不直接执行破坏性动作）', () => {
    h = mountScreen();
    h.emit(h.store.getState());

    clickInScreen(h.screen, 'button[data-danger="selection.reset"]');

    expect(h.commands).toHaveLength(0);
    expect(confirmOpen()).toBe(true);
    const panel = h.screen.shadowRoot?.querySelector('[data-role="confirm-selection.reset"]');
    expect(panel).not.toBeNull();
    // 模态语义（R1）：role=dialog + aria-modal
    expect(panel?.getAttribute('role')).toBe('dialog');
    expect(panel?.getAttribute('aria-modal')).toBe('true');
  });

  test('确认后才发命令；确认框随之关闭', () => {
    h = mountScreen();
    h.emit(h.store.getState());

    clickInScreen(h.screen, 'button[data-danger="selection.reset"]');
    clickInScreen(h.screen, 'button[data-danger-confirm="selection.reset"]');

    expect(h.commands).toEqual([{ type: 'selection.reset' }]);
    expect(confirmOpen()).toBe(false);
  });

  test('取消 → 什么都不发', () => {
    h = mountScreen();
    h.emit(h.store.getState());

    clickInScreen(h.screen, 'button[data-danger="selection.reset"]');
    clickInScreen(h.screen, 'button[data-danger-cancel="selection.reset"]');

    expect(h.commands).toHaveLength(0);
    expect(confirmOpen()).toBe(false);
  });

  test('ESC 关闭确认框（双关闭途径之一：ESC + 点遮罩）', () => {
    h = mountScreen();
    h.emit(h.store.getState());

    clickInScreen(h.screen, 'button[data-danger="selection.reset"]');
    expect(confirmOpen()).toBe(true);

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

    expect(confirmOpen()).toBe(false);
    expect(h.commands).toHaveLength(0);
  });

  test('点遮罩关闭确认框（双关闭途径之二）', () => {
    h = mountScreen();
    h.emit(h.store.getState());

    clickInScreen(h.screen, 'button[data-danger="selection.reset"]');
    // 点遮罩本身（面板里的点击不算 —— 事件目标必须正是遮罩）
    clickInScreen(h.screen, '[data-role="danger-confirm-layer"]');

    expect(confirmOpen()).toBe(false);
    expect(h.commands).toHaveLength(0);
  });

  test('确认执行后设置屏仍在（不再莫名退回主界面）', () => {
    h = mountScreen();
    h.emit(h.store.getState());

    clickInScreen(h.screen, 'button[data-danger="selection.reset"]');
    clickInScreen(h.screen, 'button[data-danger-confirm="selection.reset"]');

    // 没有 ui.navigate —— 屏不退出
    expect(h.commands.filter((c) => c.type === 'ui.navigate')).toHaveLength(0);
    expect(h.screen.isConnected).toBe(true);
    expect(h.screen.shadowRoot?.querySelector('[data-group="danger"]')).not.toBeNull();
  });

  test('清理缓存是已知 no-op → 按钮禁用且标注「未实现」，点了也不发命令', () => {
    h = mountScreen();
    h.emit(h.store.getState());

    const row = h.screen.shadowRoot?.querySelector('[data-danger-row="cache.clear"]');
    expect(row).not.toBeNull();
    expect(row?.textContent).toContain('未实现');
    // 不呈现为可用的危险按钮：没有 data-danger（点了会进确认流程）
    const button = row?.querySelector('button');
    expect(button?.hasAttribute('data-danger')).toBe(false);
    expect(button?.disabled).toBe(true);
    button?.click();
    expect(h.commands).toHaveLength(0);
    expect(confirmOpen()).toBe(false);
  });
});

// ============================================================================
// 危险区 + 遮挡控制器（@since v3.6，task_116）：确认框登记进遮挡栈 ——
//   ESC 由控制器统一路由到栈顶（只关确认框，不连带把设置屏关掉）。
// ============================================================================

describe('危险区 + 遮挡控制器：确认框进栈、ESC 只关栈顶', () => {
  let unmountScreen: (() => void) | undefined;
  let unmountAdapter: (() => void) | undefined;
  let occlusion: ReturnType<typeof createOcclusionController> | undefined;
  let screen: StratSettingsScreenElement | undefined;
  let commands: HudCommand[] = [];

  afterEach(() => {
    unmountScreen?.();
    unmountAdapter?.();
    occlusion?.destroy();
    unmountScreen = undefined;
    unmountAdapter = undefined;
    occlusion = undefined;
    screen = undefined;
    commands = [];
  });

  function mountWithOcclusion(): StratSettingsScreenElement {
    commands = [];
    const store = createStore();
    const themeController = createThemeController({
      sources: { default: readCss('tokens-default.css'), pixel: readCss('tokens-pixel.css') },
      initial: 'default',
    });
    const adapter = createHudBusAdapter({
      themeController,
      onState: (handler) => store.subscribe(handler),
      emitCommand: (command) => { commands.push(command); },
    });
    unmountAdapter = adapter.mount();
    occlusion = createOcclusionController();
    const host = document.createElement('div');
    document.body.appendChild(host);
    unmountScreen = mountSettingsScreen(
      {
        dispatch: (command) => adapter.dispatch(command),
        subscribe: (handler) => adapter.subscribe(handler),
        get themeId() { return adapter.themeId; },
        subscribeTheme: (listener) => adapter.subscribeTheme(listener),
      },
      host,
      { occlusion }
    );
    const node = host.querySelector(SETTINGS_SCREEN_TAG) as StratSettingsScreenElement;
    screen = node;
    return node;
  }

  test('确认框登记进遮挡栈（栈顶 = 当前模态）', () => {
    const s = mountWithOcclusion();
    clickInScreen(s, 'button[data-danger="selection.reset"]');
    expect(occlusion?.state.activeModal).toBe(DANGER_CONFIRM_OCCLUSION_ID);
    expect(occlusion?.state.modals).toContain(DANGER_CONFIRM_OCCLUSION_ID);
  });

  test('ESC → 控制器关栈顶（确认框），设置屏不退出', () => {
    const s = mountWithOcclusion();
    clickInScreen(s, 'button[data-danger="selection.reset"]');

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

    expect(occlusion?.state.activeModal).not.toBe(DANGER_CONFIRM_OCCLUSION_ID);
    expect(s.isConnected).toBe(true);
    expect(commands).toHaveLength(0);
  });

  test('确认执行 → 确认框出栈', () => {
    const s = mountWithOcclusion();
    clickInScreen(s, 'button[data-danger="selection.reset"]');
    clickInScreen(s, 'button[data-danger-confirm="selection.reset"]');
    expect(occlusion?.state.modals).not.toContain(DANGER_CONFIRM_OCCLUSION_ID);
    expect(commands).toEqual([{ type: 'selection.reset' }]);
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
// ============================================================================
// 上下文注入全局开关（@since v3.29，task_053）：localStorage 落地（不走总线）
// ============================================================================

describe('上下文注入全局开关（task_053）', () => {
  let h: Harness | undefined;
  beforeEach(() => {
    localStorage.removeItem('stratix.context.enabled');
  });
  afterEach(() => {
    h?.unmount();
    h = undefined;
    localStorage.removeItem('stratix.context.enabled');
  });

  test('偏好组渲染「上下文注入」行；缺省读作开', () => {
    h = mountScreen();
    h.emit(h.store.getState());
    const row = h.screen.shadowRoot?.querySelector('[data-pref-row="context"]');
    const btn = h.screen.shadowRoot?.querySelector('button[data-context-toggle]');
    expect(row).not.toBeNull();
    expect(btn?.textContent).toContain('开');
    expect(btn?.getAttribute('aria-checked')).toBe('true');
  });

  test('点击 → 写 localStorage 值 0 并本屏重画为关；再点回 1；全程零命令派发', () => {
    h = mountScreen();
    h.emit(h.store.getState());
    clickInScreen(h.screen, 'button[data-context-toggle]');
    expect(localStorage.getItem('stratix.context.enabled')).toBe('0');
    expect(h.screen.shadowRoot?.querySelector('button[data-context-toggle]')?.textContent).toContain('关');

    clickInScreen(h.screen, 'button[data-context-toggle]');
    expect(localStorage.getItem('stratix.context.enabled')).toBe('1');
    expect(h.screen.shadowRoot?.querySelector('button[data-context-toggle]')?.textContent).toContain('开');

    // 开关只在本机生效：不发 HudCommand（与 settings.set 的偏好键区分 —— 断言零派发）
    expect(h.commands).toHaveLength(0);
  });

  test('预置 0（全局关）→ 挂载即读作关', () => {
    localStorage.setItem('stratix.context.enabled', '0');
    h = mountScreen();
    h.emit(h.store.getState());
    expect(h.screen.shadowRoot?.querySelector('button[data-context-toggle]')?.textContent).toContain('关');
  });
});

// ============================================================================
// 单位名字行（@since v3.37，task_062）：localStorage 直写（战场头顶名字标签全局开关，
// 读取方是 world 侧 unit-presence 的 presence tick 现读 —— 不走总线）
// ============================================================================

describe('单位名字行（task_062）', () => {
  let h: Harness | undefined;
  beforeEach(() => {
    localStorage.removeItem('stratix.unit.nametags');
  });
  afterEach(() => {
    h?.unmount();
    h = undefined;
    localStorage.removeItem('stratix.unit.nametags');
  });

  test('偏好组渲染「单位名字」行；缺省读作开', () => {
    h = mountScreen();
    h.emit(h.store.getState());
    const row = h.screen.shadowRoot?.querySelector('[data-pref-row="nametags"]');
    const btn = h.screen.shadowRoot?.querySelector('button[data-nametag-toggle]');
    expect(row).not.toBeNull();
    expect(btn?.textContent).toContain('开');
    expect(btn?.getAttribute('aria-checked')).toBe('true');
  });

  test('点击 → 写 localStorage 值 0 并本屏重画为关；再点回 1；全程零命令派发', () => {
    h = mountScreen();
    h.emit(h.store.getState());
    clickInScreen(h.screen, 'button[data-nametag-toggle]');
    expect(localStorage.getItem('stratix.unit.nametags')).toBe('0');
    expect(h.screen.shadowRoot?.querySelector('button[data-nametag-toggle]')?.textContent).toContain('关');

    clickInScreen(h.screen, 'button[data-nametag-toggle]');
    expect(localStorage.getItem('stratix.unit.nametags')).toBe('1');
    expect(h.screen.shadowRoot?.querySelector('button[data-nametag-toggle]')?.textContent).toContain('开');

    // 表现开关只在本机生效：不发 HudCommand（断言零派发）
    expect(h.commands).toHaveLength(0);
  });

  test('预置 0（全局关）→ 挂载即读作关', () => {
    localStorage.setItem('stratix.unit.nametags', '0');
    h = mountScreen();
    h.emit(h.store.getState());
    expect(h.screen.shadowRoot?.querySelector('button[data-nametag-toggle]')?.textContent).toContain('关');
  });
});

// ============================================================================
// 音效行（@since v3.36，task_060）：localStorage 直写（总开关 + 音量滑条，不走总线）
// ============================================================================

describe('音效行（task_060）', () => {
  let h: Harness | undefined;
  beforeEach(() => {
    localStorage.removeItem('stratix.sfx.enabled');
    localStorage.removeItem('stratix.sfx.volume');
    localStorage.removeItem('stratix.sound.enabled');
    localStorage.removeItem('stratix.sound.volume');
  });
  afterEach(() => {
    h?.unmount();
    h = undefined;
    localStorage.removeItem('stratix.sfx.enabled');
    localStorage.removeItem('stratix.sfx.volume');
    localStorage.removeItem('stratix.sound.enabled');
    localStorage.removeItem('stratix.sound.volume');
  });

  test('偏好组渲染「音效」行：开关缺省开 + 音量档位按钮缺省 70%（声音引擎缺省音量）', () => {
    h = mountScreen();
    h.emit(h.store.getState());
    const row = h.screen.shadowRoot?.querySelector('[data-pref-row="sfx"]');
    expect(row).not.toBeNull();
    const toggle = h.screen.shadowRoot?.querySelector('button[data-sfx-toggle]');
    expect(toggle?.getAttribute('aria-checked')).toBe('true');
    expect(toggle?.textContent).toContain('开');
    // 音量控件：档位按钮 + 滑条（@since v3.6，task_116）
    const preset = h.screen.shadowRoot?.querySelector('button[data-role="sfx-volume-preset"]');
    expect(preset?.textContent).toBe('70%');
    expect(preset?.getAttribute('title')).toContain('音量 70%');
    const slider = h.screen.shadowRoot?.querySelector<HTMLInputElement>('input[data-role="sfx-volume"]');
    expect(slider).not.toBeNull();
    expect(slider?.value).toBe('70');
    expect(slider?.getAttribute('min')).toBe('0');
    expect(slider?.getAttribute('max')).toBe('100');
  });

  test('点开关 → 写 localStorage 值 0 并本屏重画为关；再点回 1；全程零命令派发', () => {
    h = mountScreen();
    h.emit(h.store.getState());
    clickInScreen(h.screen, 'button[data-sfx-toggle]');
    expect(localStorage.getItem('stratix.sfx.enabled')).toBe('0');
    expect(h.screen.shadowRoot?.querySelector('button[data-sfx-toggle]')?.textContent).toContain('关');

    clickInScreen(h.screen, 'button[data-sfx-toggle]');
    expect(localStorage.getItem('stratix.sfx.enabled')).toBe('1');
    expect(h.screen.shadowRoot?.querySelector('button[data-sfx-toggle]')?.textContent).toContain('开');

    // 开关只在本机生效：不发 HudCommand（与上下文注入行同一口径 —— 断言零派发）
    expect(h.commands).toHaveLength(0);
  });

  test('音效开关同时门控声音引擎总开关（两条声音通路听同一道闸）', () => {
    h = mountScreen();
    h.emit(h.store.getState());
    clickInScreen(h.screen, 'button[data-sfx-toggle]');
    expect(localStorage.getItem('stratix.sound.enabled')).toBe('0');
    clickInScreen(h.screen, 'button[data-sfx-toggle]');
    expect(localStorage.getItem('stratix.sound.enabled')).toBe('1');
  });

  test('预置 0（全局关）→ 挂载即读作关；音量预置 40 → 档位按钮与滑条都按存储值渲染', () => {
    localStorage.setItem('stratix.sfx.enabled', '0');
    localStorage.setItem('stratix.sound.volume', '40');
    h = mountScreen();
    h.emit(h.store.getState());
    expect(h.screen.shadowRoot?.querySelector('button[data-sfx-toggle]')?.getAttribute('aria-checked')).toBe('false');
    const slider = h.screen.shadowRoot?.querySelector<HTMLInputElement>('input[data-role="sfx-volume"]');
    expect(slider?.value).toBe('40');
    expect(h.screen.shadowRoot?.querySelector('button[data-role="sfx-volume-preset"]')?.textContent).toBe('40%');
  });

  test('拖动音量滑条 → input 即写声音引擎的音量键（不等 change）；不发命令', () => {
    h = mountScreen();
    h.emit(h.store.getState());
    const slider = h.screen.shadowRoot?.querySelector<HTMLInputElement>('input[data-role="sfx-volume"]');
    if (!slider) throw new Error('音量滑条未渲染');
    slider.value = '30';
    slider.dispatchEvent(new Event('input', { bubbles: true }));
    // 引擎每次播放现读这个键 → 拖完即生效（死功能 #5 的正解）
    expect(localStorage.getItem('stratix.sound.volume')).toBe('30');
    expect(readSoundVolume()).toBe(30);
    // 音效服务（0-1 口径）同步 —— 两条声音通路音量一致
    expect(localStorage.getItem('stratix.sfx.volume')).toBe('0.3');
    expect(h.commands).toHaveLength(0);
  });

  test('拖动音量 → title 与档位文字实时同步（不重画，拖拽不断）', () => {
    h = mountScreen();
    h.emit(h.store.getState());
    const slider = h.screen.shadowRoot?.querySelector<HTMLInputElement>('input[data-role="sfx-volume"]');
    if (!slider) throw new Error('音量滑条未渲染');
    slider.value = '0';
    slider.dispatchEvent(new Event('input', { bubbles: true }));
    expect(slider.getAttribute('title')).toBe('音量 静音');
    const preset = h.screen.shadowRoot?.querySelector('button[data-role="sfx-volume-preset"]');
    expect(preset?.textContent).toBe('静音');
    expect(preset?.getAttribute('title')).toContain('音量 静音');
  });

  test('点档位按钮 → 循环 静音 → 30 → 70 → 100 → 静音，且实时反映到声音引擎', () => {
    h = mountScreen();
    h.emit(h.store.getState());
    const presetText = (): string | null | undefined =>
      h!.screen.shadowRoot?.querySelector('button[data-role="sfx-volume-preset"]')?.textContent;

    // 缺省 70 → 点一下到 100
    expect(presetText()).toBe('70%');
    clickInScreen(h.screen, 'button[data-role="sfx-volume-preset"]');
    expect(readSoundVolume()).toBe(100);
    expect(presetText()).toBe('100%');

    // 100 → 回到静音
    clickInScreen(h.screen, 'button[data-role="sfx-volume-preset"]');
    expect(readSoundVolume()).toBe(0);
    expect(presetText()).toBe('静音');

    // 静音 → 30 → 70
    clickInScreen(h.screen, 'button[data-role="sfx-volume-preset"]');
    expect(readSoundVolume()).toBe(30);
    clickInScreen(h.screen, 'button[data-role="sfx-volume-preset"]');
    expect(readSoundVolume()).toBe(70);
    expect(h.commands).toHaveLength(0);
  });

  test('音量档位按钮的 title 与 aria-label 都带当前档位', () => {
    h = mountScreen();
    h.emit(h.store.getState());
    const preset = h.screen.shadowRoot?.querySelector('button[data-role="sfx-volume-preset"]');
    expect(preset?.getAttribute('title')).toContain('音量 70%');
    expect(preset?.getAttribute('aria-label')).toBe('音量 70%');
  });
});

// ============================================================================
// task_056：自定义 agent 注册管理组（端口注入才有；移除 = 断检测，角色保留）
// ============================================================================

describe('task_056 设置屏：自定义 agent 注册组', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  function mountWithPort(
    script: { rows?: Array<{ id: string; name: string; probeCmd: string; runCmdTemplate: string; outputParser: 'plain' | 'json'; createdAt: number }>; removeResult?: { ok: boolean; error?: string } } = {}
  ): { screen: StratSettingsScreenElement; calls: string[]; unmount: () => void } {
    const calls: string[] = [];
    const port: CustomAgentsPort = {
      async list() {
        calls.push('list');
        return { ok: true, agents: script.rows ?? [] };
      },
      // 设置屏不消费 create / probe（新增入口在向导）—— 空实现只满足端口形状。
      async create() {
        return { ok: false, error: 'not supported here' };
      },
      async remove(id) {
        calls.push(`remove:${id}`);
        return script.removeResult ?? { ok: true };
      },
      async probe() {
        return { ok: false, error: 'not supported here' };
      },
    };
    const host = document.createElement('div');
    document.body.appendChild(host);
    const commands: HudCommand[] = [];
    const store = createStore();
    const themeController = createThemeController({
      sources: { default: readCss('tokens-default.css'), pixel: readCss('tokens-pixel.css') },
      initial: 'default',
    });
    const adapter = createHudBusAdapter({
      themeController,
      onState: (handler) => store.subscribe(handler),
      emitCommand: (command) => { commands.push(command); },
    });
    const unmountAdapter = adapter.mount();
    const deps: SettingsScreenDeps = {
      dispatch: (command) => adapter.dispatch(command),
      subscribe: (handler) => adapter.subscribe(handler),
      // 皮肤（@since v3.6，task_115）：活读 adapter.themeId（getter），别用快照。
      get themeId() { return adapter.themeId; },
      subscribeTheme: (listener) => adapter.subscribeTheme(listener),
    };
    const unmountScreen = mountSettingsScreen(deps, host, { customAgents: port });
    const screen = host.querySelector(SETTINGS_SCREEN_TAG) as StratSettingsScreenElement;
    return {
      screen,
      calls,
      unmount: () => {
        unmountScreen();
        unmountAdapter();
        host.remove();
      },
    };
  }

  test('端口注入 + 注册行：列表渲染（名字 / 探测命令 / 解析器），移除按钮打端口并重拉', async () => {
    const h = mountWithPort({
      rows: [{ id: 'myagent', name: 'MyAgent', probeCmd: 'myagent --version', runCmdTemplate: 'myagent ask {prompt}', outputParser: 'json', createdAt: 0 }],
    });
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    const row = h.screen.shadowRoot?.querySelector('[data-role="custom-agent-row"][data-id="myagent"]');
    expect(row).not.toBeNull();
    expect(row?.textContent).toContain('MyAgent');
    expect(row?.textContent).toContain('myagent --version');
    expect(row?.textContent).toContain('json');

    const button = row?.querySelector<HTMLButtonElement>('[data-custom-remove]');
    button?.click();
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(h.calls).toContain('remove:myagent');
    expect(h.calls.filter((call) => call === 'list').length).toBeGreaterThanOrEqual(2); // 移除后重拉
    h.unmount();
  });

  test('端口注入但注册表为空：空态提示（指向向导的新增入口）', async () => {
    const h = mountWithPort({ rows: [] });
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    const group = h.screen.shadowRoot?.querySelector('[data-group="custom-agents"]');
    expect(group).not.toBeNull();
    expect(group?.textContent).toContain('还没有自定义 agent 注册');
    expect(group?.textContent).toContain('角色档案保留'); // 删除语义的文案契约：断检测不删角色
    h.unmount();
  });

  test('端口未注入：整组不渲染（非 Electron 降级）', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const store = createStore();
    const themeController = createThemeController({
      sources: { default: readCss('tokens-default.css'), pixel: readCss('tokens-pixel.css') },
      initial: 'default',
    });
    const adapter = createHudBusAdapter({
      themeController,
      onState: (handler) => store.subscribe(handler),
      emitCommand: () => undefined,
    });
    const unmountAdapter = adapter.mount();
    const unmountScreen = mountSettingsScreen(
      {
        dispatch: (command) => adapter.dispatch(command),
        subscribe: (handler) => adapter.subscribe(handler),
        get themeId() { return adapter.themeId; },
        subscribeTheme: (listener) => adapter.subscribeTheme(listener),
      },
      host
    );
    const screen = host.querySelector(SETTINGS_SCREEN_TAG) as StratSettingsScreenElement;
    expect(screen.shadowRoot?.querySelector('[data-group="custom-agents"]')).toBeNull();
    unmountScreen();
    unmountAdapter();
    host.remove();
  });
});
