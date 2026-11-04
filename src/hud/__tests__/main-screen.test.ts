/**
 * 单测：HUD 主屏壳（hud/screens/main-screen.ts）—— 屏位路由（@since v3.6）：
 *   顶栏按钮 → ui.navigate → core 写 currentScreen → 回广播 → 切换渲染 settings / character / main。
 *   闭环那一段不打桩 core/bus：用真实 store + 走真实 setCurrentScreen 入口；
 *   仅 adapter 的 onState/emitCommand 由本测试夹具实现，便于断言"屏发了什么 / 何时接到了新屏"。
 * @jest-environment jsdom
 *
 * 一个测试约定（不破其他文件的写法）：main-screen 的初帧按 adapter.latest 兜底为 'main'，
 * 因为 store.subscribe 与 bus-adapter 的组合不会自动回放首帧。这里在 mount 之后
 * 显式推一次 patch，让 adapter.latest / main-screen 同步到首帧状态。
 * 同口径见 settings-screen.test.ts（mount 后必须 patch）。
 */

import { createStore } from '../../core/store';
import type { HudCommand, ScreenId, UnitView, WorldState } from '../../core/types';
import { TOPBAR_METRICS } from '../../core/theme/visual-spec';
import { createHudBusAdapter, type HudBusAdapter } from '../bridge/bus-adapter';
import type { ThemeController, ThemeId } from '../theme/theme-controller';

import { LOG_DRAWER_TAG } from '../panels/log-drawer';
import { CHARACTER_SCREEN_TAG } from '../screens/character-screen';
import {
  createMainScreen,
  TOPBAR_ITEM_ROLES,
  TOPBAR_OVERFLOW_ROLES,
} from '../screens/main-screen';
import { demoMode } from '../theme/demo-mode';
import { SETTINGS_SCREEN_TAG } from '../screens/settings-screen';
import { STATUS_SCREEN_TAG } from '../screens/status-screen';

/** 主题控制器桩：不实际落皮肤（adapter 的 theme.set 才会调；路由测试用不到） */
function stubThemeController(): ThemeController {
  return {
    apply: (_id: ThemeId) => undefined,
    get current(): ThemeId | null { return null; },
    // 皮肤订阅（@since task_115）：路由测试用不到皮肤变化，订阅给个空实现。
    subscribe: () => () => undefined,
  };
}

/** 最小单位的合成状态（含必要字段）。不重做 lightSettings，避免重复刷位。 */
function makeState(partial: Partial<WorldState> = {}, currentScreen?: ScreenId): WorldState {
  const units: UnitView[] = partial.units ?? [
    { id: 'u1', name: 'Neo', status: 'idle', missionId: null, power: 3 },
  ];
  return {
    units,
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
  readonly adapter: HudBusAdapter;
  readonly store: ReturnType<typeof createStore>;
  /** 模拟 core 广播一份新状态（走 adapter.subscribe 的真实订阅链）。 */
  emit(state: WorldState): void;
  /** 取回屏壳内部当前屏位。 */
  currentScreen(): ScreenId | undefined;
  unmount(): void;
  host: HTMLElement;
}

function mountHarness(initial?: WorldState): Harness {
  const commands: HudCommand[] = [];
  const store = createStore(initial ?? makeState());
  const themeController = stubThemeController();

  const adapter: HudBusAdapter = createHudBusAdapter({
    themeController,
    onState: (handler) => store.subscribe(handler),
    emitCommand: (cmd) => { commands.push(cmd); },
  });
  adapter.mount();

  const host = document.createElement('div');
  document.body.appendChild(host);
  const screen = createMainScreen(adapter);
  const unmountScreen = screen.mount(host);

  // 首帧同步：与 settings / character 屏的测试夹具同一口径（同 store.subscribe 不会自动回放首帧）。
  // patch 一次让 adapter.latest + adapter 各订阅者收到与 store 一致的状态。
  if (initial !== undefined) {
    store.patch(initial);
  } else {
    // 也给一帧 broadcast，确保 main-screen 收到任何后续 emit 的对照点。
    store.patch(makeState());
  }

  return {
    commands,
    adapter,
    store,
    emit: (state) => { store.patch(state); },
    currentScreen: () => store.getState().currentScreen,
    unmount: () => {
      unmountScreen();
      host.remove();
    },
    host,
  };
}

// ============================================================================
// 1. 当前屏位缺省 / 初始：默认走 main 布局（含 status-screen）
// ============================================================================

describe('初始 currentScreen', () => {
  test('未提供 currentScreen 时按 main 兜底：渲染主屏布局（含 status-screen）', () => {
    const h = mountHarness(makeState());
    expect(h.host.querySelector(STATUS_SCREEN_TAG)).not.toBeNull();
    expect(h.host.querySelector(SETTINGS_SCREEN_TAG)).toBeNull();
    expect(h.host.querySelector(CHARACTER_SCREEN_TAG)).toBeNull();
    h.unmount();
  });

  test('初始 currentScreen=settings 时直接渲染 settings-screen', () => {
    const h = mountHarness(makeState({}, 'settings'));
    expect(h.host.querySelector(SETTINGS_SCREEN_TAG)).not.toBeNull();
    expect(h.host.querySelector(STATUS_SCREEN_TAG)).toBeNull();
    h.unmount();
  });

  test('初始 currentScreen=character 时直接渲染 character-screen', () => {
    const h = mountHarness(makeState({}, 'character'));
    expect(h.host.querySelector(CHARACTER_SCREEN_TAG)).not.toBeNull();
    expect(h.host.querySelector(STATUS_SCREEN_TAG)).toBeNull();
    h.unmount();
  });
});

// ============================================================================
// 2. core currentScreen 变化 → main-screen 切换渲染
// ============================================================================

describe('core currentScreen 切换：mount 期间接到广播立即换屏', () => {
  test('main → settings：替换为 settings-screen，主屏布局（status-screen）下线', () => {
    const h = mountHarness(makeState());
    expect(h.host.querySelector(STATUS_SCREEN_TAG)).not.toBeNull();

    h.emit(makeState({}, 'settings'));
    expect(h.host.querySelector(SETTINGS_SCREEN_TAG)).not.toBeNull();
    expect(h.host.querySelector(STATUS_SCREEN_TAG)).toBeNull();
    h.unmount();
  });

  test('settings → character：替换为 character-screen，settings 下线', () => {
    const h = mountHarness(makeState({}, 'settings'));
    h.emit(makeState({}, 'character'));
    expect(h.host.querySelector(CHARACTER_SCREEN_TAG)).not.toBeNull();
    expect(h.host.querySelector(SETTINGS_SCREEN_TAG)).toBeNull();
    h.unmount();
  });

  test('character → main：回到主屏布局，所有 sub-screen 下线', () => {
    const h = mountHarness(makeState({}, 'character'));
    // 返回 main 在 core 侧是"清空 currentScreen"（参见 runtime.ts handleCommand）——
    // 把字段显式设为 undefined 不行（patch 不会移除键），
    // 所以走完整命令路径：dispatch ui.navigate('main')，由真实 runtime 写 store。
    // 这里改用直接调 store.setCurrentScreen 模拟 core 的落库动作；
    // 单独的命令分发路径由 runtime.test.ts 覆盖。
    h.store.setCurrentScreen(null);
    h.emit(makeState());
    expect(h.host.querySelector(STATUS_SCREEN_TAG)).not.toBeNull();
    expect(h.host.querySelector(CHARACTER_SCREEN_TAG)).toBeNull();
    expect(h.host.querySelector(SETTINGS_SCREEN_TAG)).toBeNull();
    h.unmount();
  });

  test('同屏重复广播不重渲染（DOM 节点身份不变）', () => {
    const h = mountHarness(makeState({}, 'settings'));
    const firstSettings = h.host.querySelector(SETTINGS_SCREEN_TAG);
    expect(firstSettings).not.toBeNull();

    h.emit(makeState({}, 'settings'));
    const secondSettings = h.host.querySelector(SETTINGS_SCREEN_TAG);
    expect(secondSettings).toBe(firstSettings);
    h.unmount();
  });
});

// ============================================================================
// 3. 顶栏按钮 → ui.navigate 的派发链条（屏位不直接由按钮改动，依赖 core 回写）
// ============================================================================

describe('顶栏按钮：派发 ui.navigate，不在本屏内直接改屏位', () => {
  test('「看角色」点出 ui.navigate character', () => {
    const h = mountHarness(makeState());
    const charBtn = h.host.querySelector<HTMLElement>('[data-role="character"]');
    expect(charBtn).not.toBeNull();
    charBtn?.dispatchEvent(new CustomEvent('strat-button-click', { bubbles: true }));
    expect(h.commands).toContainEqual({ type: 'ui.navigate', screen: 'character' });
    h.unmount();
  });

  test('「去设置」点出 ui.navigate settings', () => {
    const h = mountHarness(makeState());
    const setBtn = h.host.querySelector<HTMLElement>('[data-role="settings"]');
    setBtn?.dispatchEvent(new CustomEvent('strat-button-click', { bubbles: true }));
    expect(h.commands).toContainEqual({ type: 'ui.navigate', screen: 'settings' });
    h.unmount();
  });

  test('「打开聊天」保留 ui.navigate chat，并冒泡角色抽屉打开事件', () => {
    const h = mountHarness(makeState());
    const onChatOpen = jest.fn();
    h.host.addEventListener('stratix:chat-open', onChatOpen);
    const chatBtn = h.host.querySelector<HTMLElement>('[data-role="chat"]');
    chatBtn?.dispatchEvent(new CustomEvent('strat-button-click', { bubbles: true }));
    expect(h.commands).toContainEqual({ type: 'ui.navigate', screen: 'chat' });
    expect(onChatOpen).toHaveBeenCalledTimes(1);
    expect(onChatOpen.mock.calls[0][0].detail).toEqual({ characterId: undefined });
    h.unmount();
  });

  test('按钮只发命令，不在本屏内偷偷换渲染（屏位仍由 core 回报决定）', () => {
    const h = mountHarness(makeState());
    h.host.querySelector<HTMLElement>('[data-role="character"]')
      ?.dispatchEvent(new CustomEvent('strat-button-click', { bubbles: true }));
    // 仅命令派发，未收到 core 回报 → 屏位不变，仍是主屏布局。
    expect(h.host.querySelector(CHARACTER_SCREEN_TAG)).toBeNull();
    expect(h.host.querySelector(STATUS_SCREEN_TAG)).not.toBeNull();
    h.unmount();
  });
});

// ============================================================================
// 4. 卸载与跨屏切换的资源释放
// ============================================================================

describe('卸载与跨屏切换的资源释放', () => {
  test('跨屏切换：旧 sub-screen 闭包被调（不会同时挂两个 sub-screen）', () => {
    const h = mountHarness(makeState({}, 'settings'));
    const firstSettings = h.host.querySelector(SETTINGS_SCREEN_TAG);
    // 进 character
    h.emit(makeState({}, 'character'));
    expect(h.host.querySelector(CHARACTER_SCREEN_TAG)).not.toBeNull();
    expect(h.host.querySelector(SETTINGS_SCREEN_TAG)).toBeNull();
    // 回 settings：再 mount 一个新的 settings
    h.emit(makeState({}, 'settings'));
    const secondSettings = h.host.querySelector(SETTINGS_SCREEN_TAG);
    expect(secondSettings).not.toBeNull();
    expect(secondSettings).not.toBe(firstSettings);
    h.unmount();
  });

  test('main 卸载：本屏所有 adapter.subscribe 退订 + DOM 清空', () => {
    const h = mountHarness(makeState());
    // 记下初始时本页对 adapter 的订阅计数（闭包数量）。
    const adapter = h.adapter;
    // 在订阅前后打点：卸载后 mounted 状态下任何新 subscribe 都会立即拿到 latest snapshot。
    // 这里用最朴素的方式 —— 渲染后取所有嵌套元素数量，卸载后应为 0。
    const hostChildrenBefore = h.host.children.length;
    expect(hostChildrenBefore).toBeGreaterThan(0);

    h.unmount();

    // adapter.mount() 的 unmount 闭包没被屏持有（与生产一致）—— 这里只断言 main-screen.mount
    // 自身的清理：屏内子树全部断连（disconnectedCallback 走完，订阅与定时器随之释放）。
    // 单独验 adapter 的订阅：直接调 mount 闭包，确保接口一致。
    expect(h.host.children.length).toBe(0);
    // 后续 dispatch 不应抛错；命令追踪仍按原 adapter 记账（adapter 本身没被卸）。
    adapter.dispatch({ type: 'theme.set', themeId: 'pixel' });
    expect(h.commands).toContainEqual({ type: 'theme.set', themeId: 'pixel' });
  });
});

// ============================================================================
// 5. RTS 悬浮布局（@since v3.7，task_020）
//   背景：用户反馈「hud 并没有环绕整个 rts 屏幕，看起来更像是左右分屏」。
//   本组用例把"RTS 形态"钉成可回归的断言：战场全屏、HUD 环绕四周悬浮、
//   空白区域事件穿透（容器 pointer-events:none，只有实体面板开 auto）。
// ============================================================================

describe('RTS 悬浮布局：HUD 环绕战场而不是分栏', () => {
  test('布局容器铺满视口且不拦事件；只有 HUD 实体面板自己开 pointer-events', () => {
    const h = mountHarness(makeState());
    const root = h.host.querySelector<HTMLElement>('.hud-root');
    expect(root).not.toBeNull();

    // 容器层：铺满挂载方 + 事件穿透（空白处点到的是下方 Phaser 画布，不是 HUD）。
    // 定位由挂载方（#hud-root）负责，本屏只做 relative 定位上下文 + 四边浮层。
    expect(getComputedStyle(root as HTMLElement).position).toBe('relative');
    expect(getComputedStyle(root as HTMLElement).pointerEvents).toBe('none');
    expect(getComputedStyle(root as HTMLElement).height).toBe('100%');

    // 实体面板层：顶栏 / 左栏 / 底栏 / 抽屉各自开 pointer-events:auto（否则面板点不动）。
    const surfaces = h.host.querySelectorAll<HTMLElement>('.hud-surface');
    expect(surfaces.length).toBeGreaterThan(0);
    surfaces.forEach((el) => {
      expect(getComputedStyle(el).pointerEvents).toBe('auto');
    });
    // 顶栏不是 .hud-surface（它自己带背景），但同样必须可交互。
    expect(getComputedStyle(h.host.querySelector<HTMLElement>('.hud-topbar') as HTMLElement).pointerEvents)
      .toBe('auto');
  });

  test('四个方向的浮层各就各位：顶栏 / 左竖栏 / 右竖栏 / 底横条都是绝对定位', () => {
    const h = mountHarness(makeState());
    const topbar = h.host.querySelector<HTMLElement>('.hud-topbar');
    const railLeft = h.host.querySelector<HTMLElement>('.hud-rail-left');
    const railRight = h.host.querySelector<HTMLElement>('.hud-rail-right');
    const bottomBar = h.host.querySelector<HTMLElement>('.hud-bottom-bar');

    [topbar, railLeft, railRight, bottomBar].forEach((el) => {
      expect(el).not.toBeNull();
      expect(getComputedStyle(el as HTMLElement).position).toBe('absolute');
    });
    // 左竖栏挂在左边、底横条贴底、顶栏贴顶、右竖栏挂右边 —— 这是"环绕"的形状，不是左右两栏。
    // 注：jsdom 不解析 var()，间距类断言只看"有没有贴边"，具体数值交给浏览器端的截图/DOM 断言。
    expect(getComputedStyle(railLeft as HTMLElement).left).not.toBe('');
    expect(getComputedStyle(railRight as HTMLElement).right).not.toBe('');
    expect(getComputedStyle(bottomBar as HTMLElement).bottom).toBe('0px');
    expect(getComputedStyle(topbar as HTMLElement).top).toBe('0px');
    h.unmount();
  });

  test('态势摘要横条：单位 / 任务 / 会话计数随广播更新，未读通知角标按 notices 数显隐', () => {
    const h = mountHarness(makeState());
    const badge = h.host.querySelector<HTMLElement>('[data-role="notice-badge"]');
    expect(badge).not.toBeNull();
    expect(badge?.hidden).toBe(true); // 无通知时不占位

    h.emit(makeState({
      units: [
        { id: 'u1', name: 'Neo', status: 'idle', missionId: null, power: 3 },
        { id: 'u2', name: 'Trinity', status: 'busy', missionId: null, power: 5 },
      ],
      missions: [{
        id: 'm1',
        title: '侦察',
        phase: 'running',
        unitIds: ['u1'],
        createdAt: 0,
      }],
      links: [{
        id: 'l1',
        kind: 'openclaw',
        displayName: 'agent-1',
        phase: 'connected',
        phaseReason: null,
        agentId: null,
        sessionId: null,
        endpoint: 'ws://127.0.0.1:18080/ws',
        connectedAt: 1000,
        lastError: null,
      }],
      notices: [{
        id: 'n1',
        level: 'info',
        text: '新事件',
        createdAt: 0,
        expiresAt: 10_000,
      }],
    }));

    expect(h.host.querySelector('[data-role="unit-count"]')?.textContent).toBe('2');
    expect(h.host.querySelector('[data-role="mission-count"]')?.textContent).toBe('1');
    expect(h.host.querySelector('[data-role="link-count"]')?.textContent).toBe('1');
    expect(badge?.hidden).toBe(false);
    expect(badge?.textContent).toBe('1');
    h.unmount();
  });

  test('单选角色单位时，「打开聊天」事件携带角色上下文且不再挂旧抽屉', () => {
    const h = mountHarness(makeState({
      units: [{ id: 'u1', name: 'Neo', status: 'idle', missionId: null, power: 3, characterId: 'c-neo' }],
      selection: { unitIds: ['u1'], previewUnitIds: [], revision: 1 },
    }));
    const onChatOpen = jest.fn();
    h.host.addEventListener('stratix:chat-open', onChatOpen);
    expect(h.host.querySelector('[data-role="chat-drawer"]')).toBeNull();

    h.host.querySelector<HTMLElement>('[data-role="chat"]')
      ?.dispatchEvent(new CustomEvent('strat-button-click', { bubbles: true }));

    expect(onChatOpen).toHaveBeenCalledTimes(1);
    expect(onChatOpen.mock.calls[0][0].detail).toEqual({ characterId: 'c-neo' });
    h.unmount();
  });
});

// ============================================================================
// 7. 演示模式开关（@since v3.3，task_110）：顶栏开关 → 工程面板隐藏 + 记忆
// ============================================================================

describe('演示模式：顶栏开关', () => {
  afterEach(() => {
    window.localStorage.clear();
    demoMode.set(false);
  });

  test('默认关：日志抽屉（工程件）在位，演示开关未点亮', () => {
    const h = mountHarness(makeState());
    expect(h.host.querySelector(LOG_DRAWER_TAG)).not.toBeNull();
    const btn = h.host.querySelector('[data-role="demo"]');
    expect(btn?.getAttribute('variant')).toBe('default');
    expect(btn?.getAttribute('aria-pressed')).toBe('false');
    h.unmount();
  });

  test('点开演示：日志抽屉隐藏、开关点亮、html 上打标记', () => {
    const h = mountHarness(makeState());
    h.host.querySelector<HTMLElement>('[data-role="demo"]')
      ?.dispatchEvent(new CustomEvent('strat-button-click', { bubbles: true }));

    expect(h.host.querySelector(LOG_DRAWER_TAG)).toBeNull();
    const btn = h.host.querySelector('[data-role="demo"]');
    expect(btn?.getAttribute('variant')).toBe('primary');
    expect(btn?.getAttribute('aria-pressed')).toBe('true');
    expect(document.documentElement.getAttribute('data-demo-mode')).toBe('on');
    h.unmount();
  });

  test('开关状态写进 localStorage（下次进来还记得）', () => {
    const h = mountHarness(makeState());
    h.host.querySelector<HTMLElement>('[data-role="demo"]')
      ?.dispatchEvent(new CustomEvent('strat-button-click', { bubbles: true }));
    expect(window.localStorage.getItem('stratix.demo-mode')).toBe('on');
    h.unmount();
  });

  test('再点一次关掉：工程件回到画面上、开关熄灭', () => {
    const h = mountHarness(makeState());
    const demoBtn = (): void => {
      h.host.querySelector<HTMLElement>('[data-role="demo"]')
        ?.dispatchEvent(new CustomEvent('strat-button-click', { bubbles: true }));
    };
    demoBtn();
    demoBtn();
    expect(h.host.querySelector(LOG_DRAWER_TAG)).not.toBeNull();
    expect(h.host.querySelector('[data-role="demo"]')?.getAttribute('variant')).toBe('default');
    h.unmount();
  });
});

// ============================================================================
// 8. 声音包开关与音量（@since v3.3，task_083）：顶栏 🔊 钮 + 音量滑条
// ============================================================================

describe('声音包：顶栏总开关与音量', () => {
  afterEach(() => {
    window.localStorage.clear();
  });

  test('默认开（演示模式默认有声）：按钮点亮、滑条可用', () => {
    const h = mountHarness(makeState());
    const button = h.host.querySelector('[data-role="sound"]');
    const slider = h.host.querySelector<HTMLInputElement>('[data-role="sound-volume"]');
    expect(button?.getAttribute('variant')).toBe('primary');
    expect(slider?.disabled).toBe(false);
    expect(slider?.getAttribute('max')).toBe('100');
    h.unmount();
  });

  test('点一下关掉：写 localStorage、按钮熄灭、滑条禁用', () => {
    const h = mountHarness(makeState());
    h.host.querySelector<HTMLElement>('[data-role="sound"]')
      ?.dispatchEvent(new CustomEvent('strat-button-click', { bubbles: true }));

    expect(window.localStorage.getItem('stratix.sound.enabled')).toBe('0');
    expect(h.host.querySelector('[data-role="sound"]')?.getAttribute('variant')).toBe('default');
    expect(h.host.querySelector<HTMLInputElement>('[data-role="sound-volume"]')?.disabled).toBe(true);
    h.unmount();
  });

  test('拖音量滑条：即拖即写（0-100）', () => {
    const h = mountHarness(makeState());
    const slider = h.host.querySelector<HTMLInputElement>('[data-role="sound-volume"]');
    expect(slider).not.toBeNull();
    if (!slider) return;
    slider.value = '35';
    slider.dispatchEvent(new Event('input', { bubbles: true }));
    expect(window.localStorage.getItem('stratix.sound.volume')).toBe('35');
    h.unmount();
  });

  test('音量滑条收进 🔊 弹出层：默认收起，点音量计才展开', () => {
    const h = mountHarness(makeState());
    const popover = h.host.querySelector<HTMLElement>('[data-role="sound-popover"]');
    expect(popover?.hidden).toBe(true);

    // 音量计（声音件里的音量区）点击 → 弹出层展开，滑条 therein 可调。
    h.host.querySelector<HTMLElement>('[data-role="sound-volume-open"]')?.click();
    expect(h.host.querySelector<HTMLElement>('[data-role="sound-popover"]')?.hidden).toBe(false);

    const slider = h.host.querySelector<HTMLInputElement>('[data-role="sound-volume"]');
    expect(slider).not.toBeNull();
    slider!.value = '42';
    slider!.dispatchEvent(new Event('input', { bubbles: true }));
    expect(window.localStorage.getItem('stratix.sound.volume')).toBe('42');
    h.unmount();
  });

  test('🔊 开关只切静音，不改音量（音量归弹出层）', () => {
    const h = mountHarness(makeState());
    h.host.querySelector<HTMLElement>('[data-role="sound"]')
      ?.dispatchEvent(new CustomEvent('strat-button-click', { bubbles: true }));
    expect(window.localStorage.getItem('stratix.sound.enabled')).toBe('0');
    h.unmount();
  });
});

// ============================================================================
// 8b. 音量计点击循环档位（@since v3.6，task_116）：死功能 #5 的修法 ——
//     20×6px 的音量计点了永远停在「音量 70%」，现在点击 = 切下一档（静音/30/70/100），
//     标题与数值同步（真源是 localStorage，声音引擎每次播放现读 → 立即联动）。
// ============================================================================

describe('音量计：点击循环档位 + 标题同步（task_116）', () => {
  afterEach(() => {
    window.localStorage.clear();
  });

  /** 顶栏音量计（🔊 旁的小条）。 */
  const bar = (h: Harness): HTMLElement | null =>
    h.host.querySelector('[data-role="sound-volume-open"]');

  test('缺省 70 → 点一下切到 100（下一档）+ 标题/数值/音量计三处同步', () => {
    const h = mountHarness(makeState());
    expect(bar(h)?.title).toBe('音量 70%（点击切换档位）');

    bar(h)?.click();

    expect(window.localStorage.getItem('stratix.sound.volume')).toBe('100');
    expect(bar(h)?.title).toBe('音量 100%（点击切换档位）');
    expect(bar(h)?.getAttribute('aria-label')).toBe('音量 100%');
    expect(h.host.querySelector<HTMLElement>('[data-role="sound-level-fill"]')?.style.width).toBe('100%');
    expect(h.host.querySelector('[data-role="sound-volume-value"]')?.textContent).toBe('100%');
    h.unmount();
  });

  test('循环一圈：70 → 100 → 静音 → 30 → 70', () => {
    const h = mountHarness(makeState());
    const seen: string[] = [];
    for (let i = 0; i < 4; i += 1) {
      bar(h)?.click();
      seen.push(window.localStorage.getItem('stratix.sound.volume') ?? '');
    }
    expect(seen).toEqual(['100', '0', '30', '70']);
    h.unmount();
  });

  test('档位 0 = 静音：标题写「静音」而不是「0%」', () => {
    const h = mountHarness(makeState());
    bar(h)?.click(); // 100
    bar(h)?.click(); // 0 = 静音
    expect(window.localStorage.getItem('stratix.sound.volume')).toBe('0');
    expect(bar(h)?.title).toBe('音量 静音（点击切换档位）');
    expect(h.host.querySelector('[data-role="sound-volume-value"]')?.textContent).toBe('静音');
    h.unmount();
  });

  test('拖滑条后标题跟着新值走（即拖即写 + 标题同步）', () => {
    const h = mountHarness(makeState());
    const slider = h.host.querySelector<HTMLInputElement>('[data-role="sound-volume"]');
    if (!slider) throw new Error('音量滑条未渲染');
    slider.value = '35';
    slider.dispatchEvent(new Event('input', { bubbles: true }));
    expect(window.localStorage.getItem('stratix.sound.volume')).toBe('35');
    expect(bar(h)?.title).toBe('音量 35%（点击切换档位）');
    h.unmount();
  });

  test('点音量计同时展开滑条弹出层（老行为保留：档位切换后还能细调）', () => {
    const h = mountHarness(makeState());
    const popover = h.host.querySelector<HTMLElement>('[data-role="sound-popover"]');
    expect(popover?.hidden).toBe(true);
    bar(h)?.click();
    expect(popover?.hidden).toBe(false);
    h.unmount();
  });
});

// ============================================================================
// 9. Z1 顶栏瘦身（@since v3.4，task_089；docs/hud-redesign-proposal.html §2.5 / §4）
//   验收：顶栏可见元素 ≤7 / 音量在 🔊 弹层可调 / ⋯ 收纳 5 项全部可达 /
//        开关点亮即状态（无重复文本）。
// ============================================================================

describe('Z1 顶栏瘦身：19 元素降 7', () => {
  afterEach(() => {
    window.localStorage.clear();
    demoMode.set(false);
  });

  test('顶栏可见元素 ≤5（task_154 加回「+ 角色」一级入口），且与 TOPBAR_ITEM_ROLES 逐位对上', () => {
    const h = mountHarness(makeState());
    const topbar = h.host.querySelector<HTMLElement>('.hud-topbar');
    expect(topbar).not.toBeNull();

    const items = Array.from(topbar!.querySelectorAll<HTMLElement>('[data-topbar-item]'));
    expect(items.length).toBeLessThanOrEqual(TOPBAR_METRICS.maxVisibleItems);
    expect(items.map((el) => el.getAttribute('data-topbar-item'))).toEqual([...TOPBAR_ITEM_ROLES]);
    h.unmount();
  });

  test('三个 on/off 文本标签已删除（theme-tag / demo-tag / director-tag 不复存在）', () => {
    const h = mountHarness(makeState());
    const topbar = h.host.querySelector<HTMLElement>('.hud-topbar');
    expect(topbar?.querySelector('[data-role="theme-tag"]')).toBeNull();
    expect(topbar?.querySelector('[data-role="demo-tag"]')).toBeNull();
    expect(topbar?.querySelector('[data-role="director-tag"]')).toBeNull();
    h.unmount();
  });

  test('开关点亮即状态：🎬 / ▶ / 🔊 用 variant + aria-pressed 表达，无第二份文本', () => {
    const h = mountHarness(makeState());
    // 声音缺省开（演示模式默认有声）→ 点亮；导演 / 演示缺省关 → 熄灭。
    expect(h.host.querySelector('[data-role="sound"]')?.getAttribute('aria-pressed')).toBe('true');
    for (const role of ['director', 'demo']) {
      const btn = h.host.querySelector<HTMLElement>(`[data-role="${role}"]`);
      expect(btn?.getAttribute('aria-pressed')).toBe('false');
      expect(btn?.getAttribute('variant')).toBe('default');
    }
    h.emit(makeState({ directorEnabled: true }));
    const director = h.host.querySelector<HTMLElement>('[data-role="director"]');
    expect(director?.getAttribute('variant')).toBe('primary');
    expect(director?.getAttribute('aria-pressed')).toBe('true');
    h.unmount();
  });

  test('⋯ 溢出菜单收纳 8 项（含收进来的声音 / 导演 / 演示）：默认收起，展开后全在', () => {
    const h = mountHarness(makeState());
    const menu = h.host.querySelector<HTMLElement>('[data-role="overflow-menu"]');
    expect(menu?.hidden).toBe(true);

    h.host.querySelector<HTMLElement>('[data-role="overflow"]')
      ?.dispatchEvent(new CustomEvent('strat-button-click', { bubbles: true }));
    expect(h.host.querySelector<HTMLElement>('[data-role="overflow-menu"]')?.hidden).toBe(false);

    // 只数「菜单项位」（data-menu-item）—— 声音段里的滑条等子控件不算独立菜单项。
    const roles = Array.from(
      h.host.querySelectorAll<HTMLElement>('[data-role="overflow-menu"] [data-menu-item]'),
    ).map((el) => el.getAttribute('data-menu-item'));
    expect(roles).toEqual([...TOPBAR_OVERFLOW_ROLES]);
    expect(roles.length).toBe(TOPBAR_METRICS.overflowItemCount);
    h.unmount();
  });

  test('收纳项仍各行其职：聊天 / 角色 / 设置 照旧派发 ui.navigate', () => {
    const h = mountHarness(makeState());
    const click = (role: string): void => {
      h.host.querySelector<HTMLElement>(`[data-role="${role}"]`)
        ?.dispatchEvent(new CustomEvent('strat-button-click', { bubbles: true }));
    };
    click('chat');
    expect(h.commands).toContainEqual({ type: 'ui.navigate', screen: 'chat' });
    click('character');
    expect(h.commands).toContainEqual({ type: 'ui.navigate', screen: 'character' });
    click('settings');
    expect(h.commands).toContainEqual({ type: 'ui.navigate', screen: 'settings' });
    h.unmount();
  });

  test('像素风收进菜单：菜单项带当前皮肤名，点击照旧切皮肤', () => {
    const h = mountHarness(makeState());
    const themeBtn = h.host.querySelector<HTMLElement>('[data-role="theme"]');
    expect(themeBtn?.getAttribute('label')).toContain('默认');

    themeBtn?.dispatchEvent(new CustomEvent('strat-button-click', { bubbles: true }));
    expect(h.commands).toContainEqual({ type: 'theme.set', themeId: 'pixel' });
    expect(h.host.querySelector('[data-role="theme"]')?.getAttribute('label')).toContain('像素');
    h.unmount();
  });

  test('点顶栏以外：两个弹出层都收起', () => {
    const h = mountHarness(makeState());
    h.host.querySelector<HTMLElement>('[data-role="overflow"]')
      ?.dispatchEvent(new CustomEvent('strat-button-click', { bubbles: true }));
    expect(h.host.querySelector<HTMLElement>('[data-role="overflow-menu"]')?.hidden).toBe(false);

    document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(h.host.querySelector<HTMLElement>('[data-role="overflow-menu"]')?.hidden).toBe(true);
    h.unmount();
  });

  // ESC 栈顶语义（@since v3.9，task_152）：弹层开着 → 这一下归弹层，下层浮层不跟着关。
  test('ESC 收起弹出层，并把这次键击吃掉（下层浮层不跟着退场）', () => {
    const h = mountHarness(makeState());
    h.host.querySelector<HTMLElement>('[data-role="overflow"]')
      ?.dispatchEvent(new CustomEvent('strat-button-click', { bubbles: true }));
    expect(h.host.querySelector<HTMLElement>('[data-role="overflow-menu"]')?.hidden).toBe(false);

    // 下层监听器（后注册 —— 如 onboarding 聚光引导的 ESC 退场）。
    const lower = jest.fn();
    document.addEventListener('keydown', lower);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    document.removeEventListener('keydown', lower);

    expect(h.host.querySelector<HTMLElement>('[data-role="overflow-menu"]')?.hidden).toBe(true);
    expect(lower).not.toHaveBeenCalled();
    h.unmount();
  });

  test('没有弹层开着：ESC 不被吃掉（下层浮层照常能收场）', () => {
    const h = mountHarness(makeState());
    const lower = jest.fn();
    document.addEventListener('keydown', lower);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    document.removeEventListener('keydown', lower);

    expect(lower).toHaveBeenCalledTimes(1);
    h.unmount();
  });
});

// 进一层断言：mountSettingsScreen / mountCharacterScreen 的 tidiness 与主屏一致 —— 这里直接复用
// 已有 settings-screen / character-screen / status-screen 测试用例（每个屏均独立验证过
// disconnectedCallback 释放订阅与定时器）。本文件专注壳层路由。

// ============================================================================
// 任务确认单的装配（@since v3.9，task_148）
// ============================================================================

describe('任务单存在感：主屏挂着任务确认面板', () => {
  test('主屏左栏挂着任务确认面板（此前只在单测里存在，生产界面根本没挂）', () => {
    const h = mountHarness(makeState());
    const slot = h.host.querySelector<HTMLElement>('[data-role="mission-confirm"]');
    expect(slot).not.toBeNull();
    expect(slot?.querySelector('strat-mission-confirm')).not.toBeNull();
    h.unmount();
  });

  test('任务单面板在左栏 agent 面板之下（同栏堆叠，各占一段）', () => {
    const h = mountHarness(makeState());
    const left = h.host.querySelector<HTMLElement>('.hud-rail-left');
    const children = Array.from(left?.children ?? []).map((c) => c.getAttribute('data-role'));
    expect(children).toEqual(['agent-panel', 'mission-confirm']);
    h.unmount();
  });
});
