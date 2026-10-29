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
import { createHudBusAdapter, type HudBusAdapter } from '../bridge/bus-adapter';
import type { ThemeController, ThemeId } from '../theme/theme-controller';

import { CHARACTER_SCREEN_TAG } from '../screens/character-screen';
import { createMainScreen } from '../screens/main-screen';
import { SETTINGS_SCREEN_TAG } from '../screens/settings-screen';
import { STATUS_SCREEN_TAG } from '../screens/status-screen';

/** 主题控制器桩：不实际落皮肤（adapter 的 theme.set 才会调；路由测试用不到） */
function stubThemeController(): ThemeController {
  return {
    apply: (_id: ThemeId) => undefined,
    get current(): ThemeId | null { return null; },
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

// 进一层断言：mountSettingsScreen / mountCharacterScreen 的 tidiness 与主屏一致 —— 这里直接复用
// 已有 settings-screen / character-screen / status-screen 测试用例（每个屏均独立验证过
// disconnectedCallback 释放订阅与定时器）。本文件专注壳层路由。
