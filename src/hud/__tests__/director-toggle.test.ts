/**
 * 单测：HUD 顶栏「🎬 导演」开关（@since v3.3，task_081）。
 * 覆盖验收标准中的「hud 顶栏开关」「手动介入自动退出（按钮熄灭）」「关闭后完全恢复手动」：
 *   - 点击开关 → 派发 `camera.director` 命令（HUD 只发命令，绝不直接操控 world —— 铁律）；
 *   - 开关态读 core 广播的 WorldState.directorEnabled（core 是唯一真相）；
 *   - world 侧手动介入 → core 把状态写回 false → 按钮熄灭 / 标签回 off。
 *
 * @jest-environment jsdom
 */

import { createStore } from '../../core/store';
import type { HudCommand, WorldState } from '../../core/types';
import { createHudBusAdapter, type HudBusAdapter } from '../bridge/bus-adapter';
import type { ThemeController, ThemeId } from '../theme/theme-controller';

import { createMainScreen } from '../screens/main-screen';

function stubThemeController(): ThemeController {
  return {
    apply: (_id: ThemeId) => undefined,
    get current(): ThemeId | null { return null; },
  };
}

function makeState(partial: Partial<WorldState> = {}): WorldState {
  return {
    units: [],
    missions: [],
    selection: { unitIds: [], previewUnitIds: [], revision: 0 },
    characters: [],
    notices: [],
    links: [],
    messages: [],
    ...partial,
  };
}

interface Harness {
  readonly commands: HudCommand[];
  readonly store: ReturnType<typeof createStore>;
  /** 模拟 core 广播一份新状态。 */
  emit(state: WorldState): void;
  /** 导演开关按钮。 */
  button(): HTMLElement | null;
  /** 导演开关的状态标签（on / off）。 */
  tag(): HTMLElement | null;
  unmount(): void;
  host: HTMLElement;
}

function mountHarness(initial?: WorldState): Harness {
  const commands: HudCommand[] = [];
  const store = createStore(makeState());
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

  // 首帧同步（与 main-screen.test.ts 同一口径：subscribe 不会自动回放首帧）。
  store.patch(initial ?? makeState());

  return {
    commands,
    store,
    emit: (state) => { store.patch(state); },
    button: () => host.querySelector<HTMLElement>('[data-role="director"]'),
    tag: () => host.querySelector<HTMLElement>('[data-role="director-tag"]'),
    unmount: () => {
      unmountScreen();
      host.remove();
    },
    host,
  };
}

describe('顶栏「🎬 导演」开关', () => {
  test('顶栏有导演开关按钮与状态标签', () => {
    const h = mountHarness();
    expect(h.button()).not.toBeNull();
    expect(h.tag()?.textContent).toBe('off');
    h.unmount();
  });

  test('点击开关派发 camera.director 命令（HUD 只发命令，不直接操控 world）', () => {
    const h = mountHarness();
    h.button()?.dispatchEvent(new CustomEvent('strat-button-click', { bubbles: true }));
    expect(h.commands).toContainEqual({ type: 'camera.director', enabled: true });
    h.unmount();
  });

  test('导演已开启时再点 → 派发关闭命令（切换语义）', () => {
    const h = mountHarness(makeState({ directorEnabled: true }));
    h.button()?.dispatchEvent(new CustomEvent('strat-button-click', { bubbles: true }));
    expect(h.commands).toContainEqual({ type: 'camera.director', enabled: false });
    h.unmount();
  });

  test('core 广播开启 → 标签 on、按钮点亮', () => {
    const h = mountHarness();
    h.emit(makeState({ directorEnabled: true }));
    expect(h.tag()?.textContent).toBe('on');
    expect(h.button()?.getAttribute('variant')).toBe('primary');
    h.unmount();
  });

  test('手动介入后 core 把状态写回 false → 按钮熄灭（手动优先）', () => {
    const h = mountHarness(makeState({ directorEnabled: true }));
    expect(h.tag()?.textContent).toBe('on');

    // world 侧手动介入 → 发 camera.director=false → core 写回状态 → 广播。
    h.emit(makeState({ directorEnabled: false }));
    expect(h.tag()?.textContent).toBe('off');
    expect(h.button()?.getAttribute('variant')).toBe('default');
    h.unmount();
  });

  test('HUD 不自己存一份导演态：状态没变时按钮态不漂', () => {
    const h = mountHarness();
    // 连点两次 → 两次都是「开」（第一次没收到 core 回报前，态仍是关）。
    h.button()?.dispatchEvent(new CustomEvent('strat-button-click', { bubbles: true }));
    h.button()?.dispatchEvent(new CustomEvent('strat-button-click', { bubbles: true }));
    expect(h.commands.filter((c) => c.type === 'camera.director')).toHaveLength(2);
    expect(h.tag()?.textContent).toBe('off');
    h.unmount();
  });
});
