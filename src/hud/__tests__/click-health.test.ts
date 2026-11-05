/**
 * 单测：**HUD 全量点击体检**（@since v3.4，task_097）—— 真机验收反馈「不少按钮没反应」的
 *   系统性排查与回归防线。
 *
 * ============ 为什么要有这个文件 ============
 *   task_095 的 40 项功能对照只验「**可达**」（DOM 存在、元素位对得上），
 *   验不出「**点了有反应**」—— 可达但没接线的按钮正是用户看到的那批。
 *   本文件把验收口径从「元素在不在」升级为「**点下去有没有可见状态变化**」：
 *   每一个可点元素都走**真实点击路径**（不是手工 dispatch 事件）：
 *     · Web Component → 进 shadow DOM 点那颗真的 <button>（jsdom 里 shadow 点击会带
 *       composed 语义冒泡到宿主，与浏览器一致）；
 *     · 普通元素 → 元素.click()；
 *     · 指针交互 → 派发带坐标的 pointerdown / pointermove。
 *   然后断言**看得见的状态变了**（属性 / 文案 / 隐藏位 / 真实派发出的命令）。
 *
 * ============ 闭环是真的 ============
 *   本文件不 mock 总线：hud/bridge/bus-adapter 接**真实 core/bus**，
 *   core/runtime 接**真实 store** —— 点一下走的是
 *   「点击 → adapter.dispatch → core/bus → core/runtime → store → state 广播 → HUD 重绘」
 *   的完整链路。所以「按钮亮了」是真的因为 core 写了状态，不是因为测试自己改了属性。
 *
 * ============ 装配口径照抄生产 ============
 *   页面骨架照抄 app/main/index.html：#hud-side（pointer-events:none）> #hud-root。
 *   小地图 / 事件轨挂在 #hud-root（与 app/main/main-entry.ts 同口径），
 *   层级三档开关挂在 #hud-side（同口径）—— 这样「谁被谁盖住 / 谁被谁抹掉」才会如实暴露。
 *
 * @jest-environment jsdom
 */

import { emitCommand, onWorldEvent, resetBus } from '../../core/bus';
import { createCoreRuntime } from '../../core/runtime';
import { createStore, type CoreStore } from '../../core/store';
import type { HudCommand, WorldEvent, WorldState } from '../../core/types';
import { createInfoLayerController, type InfoLayerController } from '../layers/info-layer';
import { mountLayerSwitch, LAYER_SWITCH_BUTTON_ROLE } from '../layers/layer-switch';
import { mountMarquee, MARQUEE_TAG, type StratMarqueeElement } from '../components/marquee/marquee';
import {
  MINIMAP_HEIGHT_PX,
  MINIMAP_TAG,
  MINIMAP_WIDTH_PX,
  mountMinimap,
  worldToMinimap,
  type StratMinimapElement,
} from '../components/minimap/minimap';
import { mountDayReplay, DAY_REPLAY_TAG, type StratDayReplayElement } from '../components/replay/day-replay';
import { createReplayController, type ReplayController } from '../components/replay/replay-controller';
import { createHudBusAdapter } from '../bridge/bus-adapter';
import {
  mountNewTaskDialog,
  NEW_TASK_OPEN_EVENT,
  type StratNewTaskDialogElement,
} from '../components/new-task-dialog/new-task-dialog';
import { createMainScreen } from '../screens/main-screen';
import { demoMode } from '../theme/demo-mode';
import type { ThemeController, ThemeId } from '../theme/theme-controller';

// ============================================================================
// 夹具
// ============================================================================

function makeState(partial: Partial<WorldState> = {}): WorldState {
  return {
    units: [{ id: 'u1', name: 'Neo', status: 'idle', missionId: null, power: 3 }],
    missions: [],
    selection: { unitIds: [], previewUnitIds: [], revision: 0 },
    characters: [],
    notices: [],
    links: [],
    messages: [],
    ...partial,
  };
}

/** 主题控制器桩：只落皮肤不发命令（换皮肤与本体检无关）。 */
function stubThemeController(): ThemeController {
  return {
    apply: (_id: ThemeId) => undefined,
    get current(): ThemeId | null { return null; },
    // 皮肤订阅（@since v3.6，task_115）：桩不通知任何人，但接口必须齐 —— 否则类型不过。
    subscribe: () => () => undefined,
  };
}

interface Hud {
  /** #hud-side（覆盖层容器，pointer-events:none）。 */
  readonly hudSide: HTMLElement;
  /** #hud-root（主屏宿主）。 */
  readonly hudRoot: HTMLElement;
  /** 真实派发出的 HudCommand 追踪（命令不经过 core 时也能看见）。 */
  readonly commands: HudCommand[];
  /** world 通道事件（camera.center / focus.unit 等两段式的落点）。 */
  readonly worldEvents: WorldEvent[];
  readonly store: CoreStore;
  readonly layerController: InfoLayerController;
  readonly minimap: StratMinimapElement;
  readonly marquee: StratMarqueeElement;
  readonly replay: StratDayReplayElement;
  readonly replayController: ReplayController;
  /** 新建任务对话框（@since v3.6 task_112；与组合根同口径挂在 #hud-root）。 */
  readonly newTaskDialog: StratNewTaskDialogElement;
  /** 对话框发出的 toast 文案。 */
  readonly toasts: string[];
  /** 主屏里当前的命令面板元素（重渲后节点会换 —— 每次都现查，别缓存）。 */
  commandPanel(): HTMLElement;
  unmount(): void;
}

/**
 * 装一套完整 HUD（与 app/main/main-entry.ts 同口径）。
 * 每个用例装一套 —— 挂载/卸载有全局副作用（总线 / localStorage / document 样式），混用会串味。
 */
function mountHud(): Hud {
  resetBus();
  window.localStorage.clear();
  demoMode.set(false);

  const commands: HudCommand[] = [];
  const worldEvents: WorldEvent[] = [];
  const store = createStore(makeState());

  const stopWorld = onWorldEvent((event) => { worldEvents.push(event); });
  const runtime = createCoreRuntime({ store });
  const stopRuntime = runtime.start();

  const adapter = createHudBusAdapter({
    themeController: stubThemeController(),
    // 命令追踪 + 真实总线：两条都留（core 接得住的会改状态，接不住的留在追踪里可断言）。
    emitCommand: (command) => {
      commands.push(command);
      // 走真实总线 → core/runtime → store → state 广播。
      emitCommand(command);
    },
  });
  const unmountAdapter = adapter.mount();

  // —— 页面骨架（照抄 app/main/index.html）——
  const hudSide = document.createElement('div');
  hudSide.id = 'hud-side';
  const hudRoot = document.createElement('div');
  hudRoot.id = 'hud-root';
  hudSide.appendChild(hudRoot);
  document.body.appendChild(hudSide);

  // —— 回放控制器（有数据 → 热力条出栏、▶ 可点）——
  const replayController = createReplayController({
    port: {
      loadDay: async () => [
        { at: 1000, kind: 'spawn', characterId: 'a', taskId: 't-1', label: '干活中', sessionId: 's-1' },
        { at: 4000, kind: 'work', characterId: 'a', taskId: 't-1', label: '干活中', sessionId: 's-1' },
      ],
    },
    emitBeat: () => undefined,
    setClock: () => undefined,
  });

  // —— 主屏（挂 #hud-root）——
  const screen = createMainScreen(adapter, { replay: { controller: replayController } });
  const unmountScreen = screen.mount(hudRoot);

  // —— 小地图 / 事件轨（也挂 #hud-root，与组合根同口径）——
  const { element: minimap, unmount: unmountMinimap } = mountMinimap(hudRoot, {
    dispatch: (command) => adapter.dispatch(command),
  });
  const { element: marquee, unmount: unmountMarquee } = mountMarquee(hudRoot, {
    dispatch: (command) => adapter.dispatch(command),
  });

  // —— 信息三层级（控制器 + 三档开关；控制器接 state 广播，同组合根口径）——
  const layerController = createInfoLayerController();
  const stopLayerState = adapter.subscribe((state) => {
    layerController.apply(state.infoLayer ?? 'L1');
  });
  const { unmount: unmountLayerSwitch } = mountLayerSwitch(
    { controller: layerController, dispatch: (command) => adapter.dispatch(command) },
    hudSide,
  );

  // —— 新建任务对话框（@since v3.6 task_112；与 app/main/main-entry.ts 同口径）——
  // 挂 #hud-root；命令面板的 NEW_TASK_OPEN_EVENT 由「组合根」收口转成 open()。
  const toasts: string[] = [];
  const { element: newTaskDialog, unmount: unmountNewTaskDialog } = mountNewTaskDialog(
    {
      dispatch: (command) => adapter.dispatch(command),
      subscribe: (handler) => adapter.subscribe(handler),
      notify: (text) => { toasts.push(text); },
      occlusion: null,
    },
    hudRoot,
  );
  const onNewTaskOpen = (event: Event): void => {
    const title = (event as CustomEvent<{ title?: string }>).detail?.title ?? '';
    newTaskDialog.open({ title });
  };
  hudRoot.addEventListener(NEW_TASK_OPEN_EVENT, onNewTaskOpen);

  return {
    hudSide,
    hudRoot,
    commands,
    worldEvents,
    store,
    layerController,
    minimap,
    marquee,
    replay: hudRoot.querySelector(DAY_REPLAY_TAG) as StratDayReplayElement,
    replayController,
    newTaskDialog,
    toasts,
    commandPanel: () => hudRoot.querySelector('strat-command-panel') as HTMLElement,
    unmount: () => {
      hudRoot.removeEventListener(NEW_TASK_OPEN_EVENT, onNewTaskOpen);
      unmountNewTaskDialog();
      unmountLayerSwitch();
      stopLayerState();
      unmountMarquee();
      unmountMinimap();
      unmountScreen();
      unmountAdapter();
      stopRuntime();
      stopWorld();
      layerController.destroy();
      hudSide.remove();
      resetBus();
      demoMode.set(false);
      window.localStorage.clear();
    },
  };
}

/** 点一个 `<strat-button>` 里的**真按钮**（shadow DOM 内）—— 走真实点击路径。 */
function clickStratButton(el: Element | null): void {
  if (!el) throw new Error('目标元素不存在');
  const btn = (el as HTMLElement).shadowRoot?.querySelector('button');
  if (!btn) throw new Error('shadow 内没有 <button>（组件未 upgrade？）');
  (btn as HTMLButtonElement).click();
}

/** 在 shadow DOM 里按角色取元素。 */
function inShadow<T extends Element>(host: Element, selector: string): T | null {
  return (host as HTMLElement).shadowRoot?.querySelector<T>(selector) ?? null;
}

/** 造一个带坐标的 pointer 事件（jsdom 无 PointerEvent 构造器，用 MouseEvent 顶）。 */
function pointer(type: string, clientX: number, clientY: number): MouseEvent {
  return new MouseEvent(type, { bubbles: true, cancelable: true, clientX, clientY, button: 0 });
}

// ============================================================================
// 体检表 · 顶栏 7 元素位（task_089）
// ============================================================================

describe('体检 · 顶栏 7 元素位', () => {
  test('1. 品牌：纯展示文本 —— 点它不发命令、不改任何状态（非可点元素，设计如此）', () => {
    const h = mountHud();
    const brand = h.hudRoot.querySelector<HTMLElement>('[data-topbar-item="brand"]');
    expect(brand).not.toBeNull();
    expect(brand?.textContent).toBe('Stratix');
    brand?.click();
    expect(h.commands).toHaveLength(0);
    h.unmount();
  });

  test('2. 态势胶囊：纯展示 —— 点它不发命令；数值随 state 广播更新', () => {
    const h = mountHud();
    const capsule = h.hudRoot.querySelector<HTMLElement>('[data-topbar-item="capsule"]');
    expect(capsule).not.toBeNull();
    capsule?.click();
    expect(h.commands).toHaveLength(0);

    h.store.setState((s) => ({ ...s, units: [...s.units, { id: 'u2', name: 'Trinity', status: 'busy', missionId: null, power: 5 }] }));
    expect(h.hudRoot.querySelector('[data-role="unit-count"]')?.textContent).toBe('2');
    h.unmount();
  });

  test('3. 通知徽标：纯展示 —— 无通知时隐藏；有通知时点它不发命令（当前无点击语义）', () => {
    const h = mountHud();
    const badge = h.hudRoot.querySelector<HTMLElement>('[data-role="notice-badge"]');
    expect(badge?.hidden).toBe(true);

    h.store.setState((s) => ({
      ...s,
      notices: [{ id: 'n1', level: 'info', text: '新事件', createdAt: 0, expiresAt: 10_000 }],
    }));
    expect(badge?.hidden).toBe(false);
    expect(badge?.textContent).toBe('1');
    badge?.click();
    expect(h.commands).toHaveLength(0);
    h.unmount();
  });

  test('4. 🔊 声音：点 shadow 内真按钮 → 开关态翻转 + localStorage 落盘 + 音量滑条随之禁用', () => {
    const h = mountHud();
    const button = h.hudRoot.querySelector('[data-role="sound"]');
    expect(button?.getAttribute('aria-pressed')).toBe('true');
    expect(h.hudRoot.querySelector<HTMLInputElement>('[data-role="sound-volume"]')?.disabled).toBe(false);

    clickStratButton(button);

    expect(window.localStorage.getItem('stratix.sound.enabled')).toBe('0');
    expect(button?.getAttribute('aria-pressed')).toBe('false');
    expect(button?.getAttribute('variant')).toBe('default');
    expect(h.hudRoot.querySelector<HTMLInputElement>('[data-role="sound-volume"]')?.disabled).toBe(true);
    h.unmount();
  });

  test('5. 🔊 音量层：点音量计 → 弹层展开（可见状态变化 = hidden 翻转）', () => {
    const h = mountHud();
    const popover = h.hudRoot.querySelector<HTMLElement>('[data-role="sound-popover"]');
    expect(popover?.hidden).toBe(true);

    h.hudRoot.querySelector<HTMLElement>('[data-role="sound-volume-open"]')?.click();

    expect(popover?.hidden).toBe(false);
    h.unmount();
  });

  test('6. 音量滑条：拖动 → localStorage + 音量计宽度 + 数值文本三处同步', () => {
    const h = mountHud();
    h.hudRoot.querySelector<HTMLElement>('[data-role="sound-volume-open"]')?.click();
    const slider = h.hudRoot.querySelector<HTMLInputElement>('[data-role="sound-volume"]');
    expect(slider).not.toBeNull();
    if (!slider) return;

    slider.value = '35';
    slider.dispatchEvent(new Event('input', { bubbles: true }));

    expect(window.localStorage.getItem('stratix.sound.volume')).toBe('35');
    expect(h.hudRoot.querySelector<HTMLElement>('[data-role="sound-volume-value"]')?.textContent).toBe('35%');
    expect(h.hudRoot.querySelector<HTMLElement>('[data-role="sound-level-fill"]')?.style.width).toBe('35%');
    h.unmount();
  });

  test('7. 🎬 导演：点 shadow 内真按钮 → 命令进 core → core 写状态 → 按钮点亮', () => {
    const h = mountHud();
    const button = h.hudRoot.querySelector('[data-role="director"]');
    expect(button?.getAttribute('aria-pressed')).toBe('false');

    clickStratButton(button);

    expect(h.commands).toContainEqual({ type: 'camera.director', enabled: true });
    // 闭环证据：core 真的写了 WorldState.directorEnabled，广播回来按钮才亮。
    expect(h.store.getState().directorEnabled).toBe(true);
    expect(button?.getAttribute('aria-pressed')).toBe('true');
    expect(button?.getAttribute('variant')).toBe('primary');
    h.unmount();
  });

  test('8. ▶ 演示：点 shadow 内真按钮 → 演示态开 → 日志抽屉（工程件）下线 + 按钮点亮', () => {
    const h = mountHud();
    const button = h.hudRoot.querySelector('[data-role="demo"]');
    expect(button?.getAttribute('aria-pressed')).toBe('false');

    clickStratButton(button);

    expect(demoMode.enabled).toBe(true);
    expect(window.localStorage.getItem('stratix.demo-mode')).toBe('on');
    // 主屏重渲 → 日志抽屉（工程件）下线：槽位被 hidden + 组件不再挂载。
    const drawerSlot = h.hudRoot.querySelector<HTMLElement>('[data-role="log-drawer"]');
    expect(drawerSlot?.hidden).toBe(true);
    expect(h.hudRoot.querySelector('strat-log-drawer')).toBeNull();
    // 新节点上的开关回显。
    expect(h.hudRoot.querySelector('[data-role="demo"]')?.getAttribute('aria-pressed')).toBe('true');
    h.unmount();
  });

  test('9. ⋯ 溢出：点 shadow 内真按钮 → 菜单展开（hidden 翻转）', () => {
    const h = mountHud();
    const menu = h.hudRoot.querySelector<HTMLElement>('[data-role="overflow-menu"]');
    expect(menu?.hidden).toBe(true);

    clickStratButton(h.hudRoot.querySelector('[data-role="overflow"]'));

    expect(menu?.hidden).toBe(false);
    h.unmount();
  });

  test('10. ⋯ 菜单 · 打开聊天 → ui.navigate chat + 冒泡 stratix:chat-open（抽屉入口）', () => {
    const h = mountHud();
    const onChatOpen = jest.fn();
    h.hudRoot.addEventListener('stratix:chat-open', onChatOpen);
    clickStratButton(h.hudRoot.querySelector('[data-role="overflow"]'));

    clickStratButton(h.hudRoot.querySelector('[data-role="chat"]'));

    expect(h.commands).toContainEqual({ type: 'ui.navigate', screen: 'chat' });
    expect(onChatOpen).toHaveBeenCalledTimes(1);
    // 点完菜单项，弹层自动收起（可见状态变化）。
    expect(h.hudRoot.querySelector<HTMLElement>('[data-role="overflow-menu"]')?.hidden).toBe(true);
    h.unmount();
  });

  test('11. ⋯ 菜单 · 会话面板 → 会话面板折叠态翻转（可见状态变化）', () => {
    const h = mountHud();
    const panel = h.hudRoot.querySelector('strat-session-panel');
    expect(panel).not.toBeNull();
    expect(panel?.hasAttribute('collapsed')).toBe(true);

    clickStratButton(h.hudRoot.querySelector('[data-role="overflow"]'));
    clickStratButton(h.hudRoot.querySelector('[data-role="sessions"]'));

    expect(h.hudRoot.querySelector('strat-session-panel')?.hasAttribute('collapsed')).toBe(false);
    h.unmount();
  });

  test('12. ⋯ 菜单 · 看角色 → ui.navigate character → core 写屏位 → 主屏真的换屏', () => {
    const h = mountHud();
    clickStratButton(h.hudRoot.querySelector('[data-role="overflow"]'));

    clickStratButton(h.hudRoot.querySelector('[data-role="character"]'));

    expect(h.commands).toContainEqual({ type: 'ui.navigate', screen: 'character' });
    expect(h.store.getState().currentScreen).toBe('character');
    expect(h.hudRoot.querySelector('strat-character-screen')).not.toBeNull();
    h.unmount();
  });

  test('13. ⋯ 菜单 · 去设置 → ui.navigate settings → 主屏真的换屏', () => {
    const h = mountHud();
    clickStratButton(h.hudRoot.querySelector('[data-role="overflow"]'));

    clickStratButton(h.hudRoot.querySelector('[data-role="settings"]'));

    expect(h.commands).toContainEqual({ type: 'ui.navigate', screen: 'settings' });
    expect(h.store.getState().currentScreen).toBe('settings');
    expect(h.hudRoot.querySelector('strat-settings-screen')).not.toBeNull();
    h.unmount();
  });

  test('14. ⋯ 菜单 · 像素风 → theme.set pixel + 菜单项文案换名', () => {
    const h = mountHud();
    const themeBtn = h.hudRoot.querySelector('[data-role="theme"]');
    expect(themeBtn?.getAttribute('label')).toContain('默认');

    clickStratButton(h.hudRoot.querySelector('[data-role="overflow"]'));
    clickStratButton(themeBtn);

    expect(h.commands).toContainEqual({ type: 'theme.set', themeId: 'pixel' });
    expect(h.hudRoot.querySelector('[data-role="theme"]')?.getAttribute('label')).toContain('像素');
    h.unmount();
  });

  test('15. 点顶栏以外 → 两个弹层都收起（点外面关）', () => {
    const h = mountHud();
    clickStratButton(h.hudRoot.querySelector('[data-role="overflow"]'));
    expect(h.hudRoot.querySelector<HTMLElement>('[data-role="overflow-menu"]')?.hidden).toBe(false);

    document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(h.hudRoot.querySelector<HTMLElement>('[data-role="overflow-menu"]')?.hidden).toBe(true);
    h.unmount();
  });
});

// ============================================================================
// 体检表 · 事件轨（Z2，task_091）
// ============================================================================

describe('体检 · 事件轨（Z2）', () => {
  test('16. 展开钮：点 shadow 内真按钮 → 展开态翻转 + 文案换字 + 隐藏条数归零', () => {
    const h = mountHud();
    for (let i = 0; i < 4; i += 1) {
      h.marquee.push({ kind: 'dispatch', icon: '▶', text: `事件 ${i}`, detail: '详情', at: Date.now(), unitId: 'u1' });
    }
    const toggle = inShadow<HTMLButtonElement>(h.marquee, '[data-role="toggle"]');
    expect(toggle).not.toBeNull();
    expect(toggle?.hidden).toBe(false);
    expect(toggle?.textContent).toContain('展开');

    toggle?.click();

    expect(h.marquee.expanded).toBe(true);
    expect(toggle?.textContent).toBe('收起');
    expect(h.marquee.hiddenCount).toBe(0);
    h.unmount();
  });

  test('17. 条目点击 → focus.unit 命令真的派发出去（core 转成同名 world 事件）', () => {
    const h = mountHud();
    h.marquee.push({ kind: 'dispatch', icon: '▶', text: '干活中', detail: '详情', at: Date.now(), unitId: 'u1' });
    const entry = inShadow<HTMLElement>(h.marquee, '.entry');
    expect(entry).not.toBeNull();

    entry?.click();

    expect(h.commands).toContainEqual({ type: 'focus.unit', unitId: 'u1' });
    expect(h.worldEvents.some((e) => e.type === 'focus.unit' && e.unitId === 'u1')).toBe(true);
    h.unmount();
  });

  test('18. 无关联单位的条目（里程碑）不可点 —— 不发命令（设计如此）', () => {
    const h = mountHud();
    h.marquee.push({ kind: 'milestone', icon: '★', text: '里程碑', detail: '详情', at: Date.now() });
    const entry = inShadow<HTMLElement>(h.marquee, '.entry');
    expect(entry?.getAttribute('data-clickable')).toBeNull();

    entry?.click();

    expect(h.commands).toHaveLength(0);
    h.unmount();
  });
});

// ============================================================================
// 体检表 · 小地图（Z3，task_057 / task_093）
// ============================================================================

describe('体检 · 小地图（Z3）', () => {
  test('19. 小地图固定展开：没有折叠钮 / 没有折叠态（任何场景都是展开态）', () => {
    const h = mountHud();
    // 折叠路径已整体解除（v3.5 / task_098）：shadow 里没有折叠钮，元素上没有折叠属性。
    expect(inShadow<HTMLButtonElement>(h.minimap, '[data-role="toggle"]')).toBeNull();
    expect(h.minimap.hasAttribute('data-collapsed')).toBe(false);
    // 画布在、尺寸在 —— 展开态的实体。
    const canvas = inShadow<HTMLCanvasElement>(h.minimap, '[data-role="canvas"]');
    expect(canvas).not.toBeNull();
    expect(canvas?.getAttribute('width')).toBe(String(MINIMAP_WIDTH_PX));
    h.unmount();
  });

  test('20. 画布点单位 → unit.select + camera.center 两条命令都派发', () => {
    const h = mountHud();
    const world = { x: 1600, y: 1200 };
    h.minimap.setUnits([{ id: 'u1', x: world.x, y: world.y }]);
    const at = worldToMinimap(world, { width: MINIMAP_WIDTH_PX, height: MINIMAP_HEIGHT_PX });
    const canvas = inShadow<HTMLCanvasElement>(h.minimap, '[data-role="canvas"]');
    expect(canvas).not.toBeNull();

    canvas?.dispatchEvent(pointer('pointerdown', at.x, at.y));

    expect(h.commands).toContainEqual({ type: 'unit.select', unitIds: ['u1'], mode: 'set' });
    expect(h.commands.some((c) => c.type === 'camera.center')).toBe(true);
    h.unmount();
  });

  test('21. 画布点空白 → 只发 camera.center（不误选单位）', () => {
    const h = mountHud();
    h.minimap.setUnits([{ id: 'u1', x: 1600, y: 1200 }]);
    const canvas = inShadow<HTMLCanvasElement>(h.minimap, '[data-role="canvas"]');

    canvas?.dispatchEvent(pointer('pointerdown', 5, 5));

    expect(h.commands.some((c) => c.type === 'unit.select')).toBe(false);
    expect(h.commands.some((c) => c.type === 'camera.center')).toBe(true);
    h.unmount();
  });
});

// ============================================================================
// 体检表 · 控制岛命令面板（Z4，task_090）
// ============================================================================

describe('体检 · 控制岛命令面板（6 条）', () => {
  test('22. 面板渲染出 6 条全局命令（1 行 6 条口径）', () => {
    const h = mountHud();
    const buttons = Array.from(
      h.commandPanel().shadowRoot?.querySelectorAll<HTMLButtonElement>('button.command') ?? [],
    );
    expect(buttons).toHaveLength(6);
    expect(buttons.map((b) => b.getAttribute('data-command'))).toEqual([
      'mission.create',
      'chat.open',
      'character.open',
      'settings.open',
      'theme.default',
      'theme.pixel',
    ]);
    h.unmount();
  });

  test('23. 点「打开聊天」→ ui.navigate chat 真的派发', () => {
    const h = mountHud();
    clickCommand(h, 'chat.open');
    expect(h.commands).toContainEqual({ type: 'ui.navigate', screen: 'chat' });
    h.unmount();
  });

  test('24. 点「打开角色」→ ui.navigate character 真的派发', () => {
    const h = mountHud();
    clickCommand(h, 'character.open');
    expect(h.commands).toContainEqual({ type: 'ui.navigate', screen: 'character' });
    h.unmount();
  });

  test('25. 点「打开设置」→ ui.navigate settings 真的派发', () => {
    const h = mountHud();
    clickCommand(h, 'settings.open');
    expect(h.commands).toContainEqual({ type: 'ui.navigate', screen: 'settings' });
    h.unmount();
  });

  test('26. 点「切换到像素风」→ theme.set pixel 真的派发', () => {
    const h = mountHud();
    clickCommand(h, 'theme.pixel');
    expect(h.commands).toContainEqual({ type: 'theme.set', themeId: 'pixel' });
    h.unmount();
  });

  test('27. 点「切换到现代风」→ theme.set default 真的派发', () => {
    const h = mountHud();
    clickCommand(h, 'theme.default');
    expect(h.commands).toContainEqual({ type: 'theme.set', themeId: 'default' });
    h.unmount();
  });

  test('28. 「新建任务」未填标题时是禁用态（点击不派发 —— 正确降级，不是没反应）', () => {
    const h = mountHud();
    const button = commandButton(h, 'mission.create');
    expect(button?.disabled).toBe(true);

    button?.click();

    expect(h.commands.some((c) => c.type === 'mission.create')).toBe(false);
    h.unmount();
  });

  test('29. 填了标题 → 「新建任务」解禁，点击打开对话框；再点「单任务」才派发 mission.create', () => {
    const h = mountHud();
    // @since v3.11（task_155）：任务条上的行内标题 chip 已删（发起流程不再有标题编辑环节）——
    //   标题草稿是 composer 首行的派生值，敲进 composer 即解禁「新建任务」。
    const composer = inShadow<HTMLTextAreaElement>(h.commandPanel(), '[data-role="query"]');
    expect(composer).not.toBeNull();
    if (!composer) return;
    composer.value = '去侦察';
    composer.dispatchEvent(new Event('input', { bubbles: true }));

    const button = commandButton(h, 'mission.create');
    expect(button?.disabled).toBe(false);
    button?.click();

    // ① 点「新建任务」不再直发命令 —— 弹对话框（@since v3.6 task_112）。
    expect(h.newTaskDialog.opened).toBe(true);
    expect(h.commands.some((c) => c.type === 'mission.create')).toBe(false);

    // ② 对话框里四个动作按钮都在。
    const actions = Array.from(
      h.newTaskDialog.shadowRoot?.querySelectorAll('button.option[data-action]') ?? [],
    ).map((b) => b.getAttribute('data-action'));
    expect(actions).toEqual(expect.arrayContaining(['single', 'pipeline', 'dispatch', 'cancel']));

    // ③ 点「单任务」→ 真派发 mission.create。
    const single = h.newTaskDialog.shadowRoot?.querySelector<HTMLButtonElement>(
      'button.option[data-action="single"]',
    );
    single?.click();
    expect(h.commands).toContainEqual({ type: 'mission.create', title: '去侦察', unitIds: [] });

    // ④ 草稿被清掉（再建一条要用新标题）+ composer 也回到空态。
    const panel = h.commandPanel() as unknown as { draftTitle?: string };
    expect(panel.draftTitle).toBe('');
    expect(composer.value).toBe('');
    h.unmount();
  });
});

// ============================================================================
// 体检表 · 当日回放条（task_082）
// ============================================================================

describe('体检 · 当日回放条', () => {
  test('30. 「▶ 60 秒看完今天」：点 shadow 内真按钮 → 进入播放态 + 文案换字', async () => {
    const h = mountHud();
    // 按钮在数据装载完成前是 disabled —— 先 await load（浏览器里由应用启动流程负责）。
    await h.replayController.load();
    const button = inShadow<HTMLButtonElement>(h.replay, '[data-role="play"]');
    expect(button).not.toBeNull();
    expect(button?.disabled).toBe(false);

    button?.click();

    expect(h.replayController.state.playing).toBe(true);
    expect(button?.textContent).toContain('停下');
    h.unmount();
  });

  test('31. 热力条出栏（96 根柱子）+ 时钟显示 --:--:--', () => {
    const h = mountHud();
    void h.replayController.load();
    // load 是异步的 —— 微任务里推状态。
    return Promise.resolve().then(() => {
      expect(h.replay.shadowRoot?.querySelectorAll('.bar').length).toBeGreaterThan(0);
      expect(inShadow(h.replay, '[data-role="clock"]')?.textContent).toBe('--:--:--');
      h.unmount();
    });
  });

  test('32. 拖热力条 → 游标移动 + 时钟文本变化（可见状态变化）', async () => {
    const h = mountHud();
    await h.replayController.load();
    const strip = inShadow<HTMLElement>(h.replay, '[data-role="strip"]');
    expect(strip).not.toBeNull();
    if (!strip) return;
    // jsdom 没有排版 —— getBoundingClientRect 全零，拖动换算会提前返回。
    // 这里补一个确定宽度（浏览器里由真实布局给）。
    strip.getBoundingClientRect = () => ({
      left: 0, top: 0, right: 200, bottom: 14, width: 200, height: 14, x: 0, y: 0,
      toJSON: () => ({}),
    }) as DOMRect;

    strip.dispatchEvent(pointer('pointerdown', 150, 7));

    expect(h.replayController.state.cursorAt).not.toBeNull();
    expect(inShadow(h.replay, '[data-role="clock"]')?.textContent).not.toBe('--:--:--');
    h.unmount();
  });
});

// ============================================================================
// 体检表 · 左下信息层级三档开关（task_096）
// ============================================================================

describe('体检 · 信息层级三档开关', () => {
  test('33. 点 L2 → hud.layer.set 进 core → core 写 infoLayer → 按钮点亮 + CSS 变量切换', () => {
    const h = mountHud();
    const buttons = Array.from(
      h.hudSide.querySelectorAll<HTMLButtonElement>(`[data-role="${LAYER_SWITCH_BUTTON_ROLE}"]`),
    );
    expect(buttons).toHaveLength(3);

    buttons[1]?.click();

    expect(h.commands).toContainEqual({ type: 'hud.layer.set', layer: 'L2' });
    expect(h.store.getState().infoLayer).toBe('L2');
    expect(buttons[1]?.getAttribute('aria-pressed')).toBe('true');
    expect(document.documentElement.getAttribute('data-srf-info-layer')).toBe('L2');
    h.unmount();
  });

  test('34. 点 L3 → L1 降对比 + L2 收起（CSS 变量口径）', () => {
    const h = mountHud();
    const buttons = Array.from(
      h.hudSide.querySelectorAll<HTMLButtonElement>(`[data-role="${LAYER_SWITCH_BUTTON_ROLE}"]`),
    );
    buttons[2]?.click();

    expect(h.store.getState().infoLayer).toBe('L3');
    const style = document.documentElement.style;
    expect(style.getPropertyValue('--srf-layer-l1-opacity')).toBe('0.18');
    expect(style.getPropertyValue('--srf-layer-l2-visibility')).toBe('hidden');
    h.unmount();
  });

  test('35. L3 激活时 L1 按钮仍可点（L1 只是降对比，不是禁用 —— 不误伤可点性）', () => {
    const h = mountHud();
    const buttons = Array.from(
      h.hudSide.querySelectorAll<HTMLButtonElement>(`[data-role="${LAYER_SWITCH_BUTTON_ROLE}"]`),
    );
    buttons[2]?.click();
    expect(h.store.getState().infoLayer).toBe('L3');
    // L3 只是把 L1 降到 18% 对比 —— **不禁用**，L1 元素仍应可点。
    expect(document.documentElement.style.getPropertyValue('--srf-layer-l1-opacity')).toBe('0.18');

    // L3 期间：顶栏 🎬 仍可点（点一下导演开关就该点亮）。
    clickStratButton(h.hudRoot.querySelector('[data-role="director"]'));
    expect(h.store.getState().directorEnabled).toBe(true);

    // 三档开关本身也仍可点 → 命令发出、手动档写进 L1。
    buttons[0]?.click();
    expect(h.commands).toContainEqual({ type: 'hud.layer.set', layer: 'L1' });
    expect(h.store.getState().layerBase).toBe('L1');
    h.unmount();
  });

  test('35b. 演出占用优先于手动档：导演开着时有效档仍 L3，导演关掉才回落 L1', () => {
    const h = mountHud();
    const buttons = Array.from(
      h.hudSide.querySelectorAll<HTMLButtonElement>(`[data-role="${LAYER_SWITCH_BUTTON_ROLE}"]`),
    );
    // 导演模式 = 沉浸演出在演 → 占一个 'director' 位（task_094 设计）。
    clickStratButton(h.hudRoot.querySelector('[data-role="director"]'));
    expect(h.store.getState().layerHolds).toContain('director');
    expect(h.store.getState().infoLayer).toBe('L3');

    // 手动档写 L1 也**压不过占用** —— 有效档仍是 L3（这是 task_094 的「占用优先」规则，
    // 不是 bug：演出期间 L3 说了算，演出结束才回手动档）。
    // 注：手动档 L1 = 缺省值 → core 里 layerBase 留 undefined（口径同其它可选字段）。
    buttons[0]?.click();
    expect(h.commands).toContainEqual({ type: 'hud.layer.set', layer: 'L1' });
    expect(h.store.getState().layerBase ?? 'L1').toBe('L1');
    expect(h.store.getState().infoLayer).toBe('L3');

    // 关掉导演 → 占用释放 → 有效档回落到手动档 L1。
    clickStratButton(h.hudRoot.querySelector('[data-role="director"]'));
    expect(h.store.getState().directorEnabled).toBe(false);
    expect(h.store.getState().infoLayer ?? 'L1').toBe('L1');
    h.unmount();
  });
});

// ============================================================================
// 体检表 · 主屏重渲**不得**抹掉组合根挂在同一宿主下的覆盖层（task_097 修复回归）
// ============================================================================

describe('体检 · 覆盖层在主屏重渲后存活（task_097 修复回归）', () => {
  test('36. 演示开关触发主屏重渲 → 小地图 / 事件轨仍在宿主里（不是被 host.innerHTML 抹掉）', () => {
    const h = mountHud();
    const minimapBefore = h.hudRoot.querySelector(MINIMAP_TAG);
    const marqueeBefore = h.hudRoot.querySelector(MARQUEE_TAG);
    expect(minimapBefore).not.toBeNull();
    expect(marqueeBefore).not.toBeNull();

    clickStratButton(h.hudRoot.querySelector('[data-role="demo"]')); // → renderMain()

    // ★ 修复前：host.innerHTML 重写 → 这两个覆盖层当场从 DOM 里消失（且永不重挂）。
    expect(h.hudRoot.querySelector(MINIMAP_TAG)).not.toBeNull();
    expect(h.hudRoot.querySelector(MARQUEE_TAG)).not.toBeNull();
    // 节点身份都没变（不是重建出来的）。
    expect(h.hudRoot.querySelector(MINIMAP_TAG)).toBe(minimapBefore);
    expect(h.hudRoot.querySelector(MARQUEE_TAG)).toBe(marqueeBefore);
    h.unmount();
  });

  test('37. 重渲后小地图**仍然点得动**（点单位 → unit.select + camera.center 照发）', () => {
    const h = mountHud();
    const world = { x: 1600, y: 1200 };
    h.minimap.setUnits([{ id: 'u1', x: world.x, y: world.y }]);

    // 先点一次演示开关触发重渲（真机上的「点一下就失效」路径）。
    clickStratButton(h.hudRoot.querySelector('[data-role="demo"]'));

    const canvas = inShadow<HTMLCanvasElement>(h.minimap, '[data-role="canvas"]');
    expect(canvas).not.toBeNull();
    const at = worldToMinimap(world, { width: MINIMAP_WIDTH_PX, height: MINIMAP_HEIGHT_PX });
    canvas?.dispatchEvent(pointer('pointerdown', at.x, at.y));

    expect(h.commands).toContainEqual({ type: 'unit.select', unitIds: ['u1'], mode: 'set' });
    expect(h.commands.some((c) => c.type === 'camera.center')).toBe(true);
    h.unmount();
  });

  test('38. 重渲后事件轨条目**仍然点得动**（点条目 → focus.unit 照发）', () => {
    const h = mountHud();
    h.marquee.push({ kind: 'dispatch', icon: '▶', text: '干活中', detail: '详情', at: Date.now(), unitId: 'u1' });

    clickStratButton(h.hudRoot.querySelector('[data-role="demo"]'));

    const entry = inShadow<HTMLElement>(h.marquee, '.entry');
    expect(entry).not.toBeNull();
    entry?.click();
    expect(h.commands).toContainEqual({ type: 'focus.unit', unitId: 'u1' });
    h.unmount();
  });

  test('39. 切屏往返（main → settings → main）同样不抹覆盖层', () => {
    const h = mountHud();
    expect(h.hudRoot.querySelector(MINIMAP_TAG)).not.toBeNull();

    // 去设置屏 → 主屏布局整个换掉。
    h.store.setCurrentScreen('settings');
    expect(h.hudRoot.querySelector('.hud-sub-screen')).not.toBeNull();
    expect(h.hudRoot.querySelector(MINIMAP_TAG)).not.toBeNull();

    // 回主屏。
    h.store.setCurrentScreen(null);
    expect(h.hudRoot.querySelector(MINIMAP_TAG)).not.toBeNull();
    expect(h.hudRoot.querySelector(MARQUEE_TAG)).not.toBeNull();

    // 回主屏后小地图仍然点得动。
    h.minimap.setUnits([{ id: 'u1', x: 1600, y: 1200 }]);
    const canvas = inShadow<HTMLCanvasElement>(h.minimap, '[data-role="canvas"]');
    const at = worldToMinimap({ x: 1600, y: 1200 }, { width: MINIMAP_WIDTH_PX, height: MINIMAP_HEIGHT_PX });
    canvas?.dispatchEvent(pointer('pointerdown', at.x, at.y));
    expect(h.commands).toContainEqual({ type: 'unit.select', unitIds: ['u1'], mode: 'set' });
    h.unmount();
  });
});

// —— 命令面板小工具 ——

function commandButton(h: Hud, id: string): HTMLButtonElement | null {
  return Array.from(
    h.commandPanel().shadowRoot?.querySelectorAll<HTMLButtonElement>('button.command') ?? [],
  ).find((b) => b.getAttribute('data-command') === id) ?? null;
}

function clickCommand(h: Hud, id: string): void {
  const button = commandButton(h, id);
  expect(button).not.toBeNull();
  button?.click();
}
