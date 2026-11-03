/**
 * 集成测试：**v3.4 HUD 功能对照表 —— HUD 侧 32 项逐项断言**（task_095）。
 *
 * 依据：docs/hud-redesign-proposal.html §4「功能对照表（40/40，零删减）」。
 * 本文件覆盖 HUD 侧 32 项：
 *   A1-A13 顶栏 13 项 · B1-B3 事件轨与里程碑 3 项 · C1-C2 小地图 2 项 ·
 *   D1-D6 当日回放与角标 6 项 · E1-E5 命令与面板 5 项 · F2 toast / F3 声音引擎 2 项 ·
 *   G2 报错红色 vignette 1 项。
 * 另 8 项在别处（40 项一张表能逐条数清）：
 *   世界侧 7 项（F1 / G1 / G3 / G4 / G5 / G6 / G7）→ src/world/__tests__/v34-feature-matrix.test.ts
 *   组合根 1 项（G8 主入口按钮组）→ src/app/__tests__/v34-main-entry-buttons.test.ts
 *
 * ============ 为什么是「集成断言」而不是浏览器 e2e ============
 *   §4 的每一项要证的是「**这一项功能还在、还可达**」（零删减是本轮重构的硬承诺）。
 *   本文件把**真实组件**（不是替身）挂在 jsdom 上，走真实事件 / 真实命令出口断言：
 *     - 顶栏 7 个元素位（TOPBAR_ITEM_ROLES）与 ⋯ 收纳 5 项，都由主屏真实渲染出来；
 *     - 事件轨 / 小地图 / 回放条 / 命令面板都是真组件，真 push、真点击、真派命令；
 *     - 每条断言都指名 §4 的编号 —— 40 项能逐条数，不靠「总数 40」这种自证。
 *   版面（碰撞 / 间距）不在这里断言 —— jsdom 没有排版引擎，bounding box 全是 0；
 *   真排版断言在 scripts/check-hud-island-layout.mjs（浏览器里量）。
 *
 * @jest-environment jsdom
 */

import {
  CONTROL_ISLAND_METRICS,
  MARQUEE_METRICS,
  MINIMAP_METRICS,
  REPLAY_METRICS,
  SCREEN_FX_METRICS,
  TOPBAR_METRICS,
} from '../../core/theme/visual-spec';
import type {
  CharacterTask,
  HudCommand,
  Notice,
  UnitView,
  WorldEvent,
  WorldState,
} from '../../core/types';
import { mountMarquee } from '../components/marquee/marquee';
import { MARQUEE_ICONS, formatRelativeTime } from '../components/marquee/marquee-catalog';
import { mountMilestone } from '../components/marquee/milestone';
import { mountMinimap, minimapToWorld } from '../components/minimap/minimap';
import { mountDayReplay } from '../components/replay/day-replay';
import { REPLAY_EMPTY_TEXT } from '../components/replay/replay-catalog';
import { createReplayController } from '../components/replay/replay-controller';
import { mountReplayClock } from '../components/replay/replay-clock';
import { MODE_STRIP_CSS_VAR } from '../components/mode-strip/mode-strip';
import { mountErrorGlow } from '../components/screen-fx/error-glow';
import { errorGlowTrigger } from '../components/screen-fx/screen-fx-catalog';
import { mountToastHost } from '../components/toast/toast-host';
import { COMMAND_PANEL_TAG, mountCommandPanel } from '../panels/command-panel';
import { AGENT_PANEL_TAG } from '../panels/agent-panel';
import { LOG_DRAWER_TAG } from '../panels/log-drawer';
import { SESSION_PANEL_TAG } from '../panels/session-panel';
import { STATUS_SCREEN_TAG } from '../screens/status-screen';
import { createMainScreen, TOPBAR_ITEM_ROLES } from '../screens/main-screen';
import {
  SFX_FILES,
  readSoundEnabled,
  readSoundVolume,
  soundIdForCue,
  writeSoundEnabled,
  writeSoundVolume,
} from '../sound-engine';
import { demoMode } from '../theme/demo-mode';

// ============================================================================
// 夹具
// ============================================================================

/** 造一个 WorldState —— 只填本文件断言真正读到的字段，其余留空（不造假数据语义）。 */
function state(partial: Partial<WorldState> = {}): WorldState {
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

function unit(id: string, extra: Partial<UnitView> = {}): UnitView {
  return {
    id,
    name: `角色${id}`,
    status: 'idle',
    missionId: null,
    power: 50,
    characterId: null,
    ...extra,
  };
}

function notice(id: string): Notice {
  return { id, level: 'info', text: `通知 ${id}`, createdAt: 1, expiresAt: Date.now() + 60_000 };
}

function task(id: string): CharacterTask {
  return {
    id,
    characterId: 'c-1',
    prompt: '干活',
    status: 'failed',
    createdAt: 1,
    startedAt: 2,
    endedAt: 3,
    output: '炸了',
  };
}

/**
 * 主屏夹具：挂真主屏，带一个可推状态的假 adapter。
 * why 不用真 bus：命令出口与状态回灌两条路都要看得见（断言「派了什么命令」+「状态回显」）。
 */
interface ScreenHarness {
  readonly host: HTMLElement;
  readonly commands: HudCommand[];
  push(next: WorldState): void;
  unmount(): void;
}

function mountScreen(): ScreenHarness {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const commands: HudCommand[] = [];
  const subscribers = new Set<(next: WorldState) => void>();
  const adapter = {
    dispatch: (command: HudCommand) => {
      commands.push(command);
    },
    subscribe: (handler: (next: WorldState) => void) => {
      subscribers.add(handler);
      return () => {
        subscribers.delete(handler);
      };
    },
    mount: () => () => undefined,
    latest: null as WorldState | null,
  };
  const unmount = createMainScreen(adapter).mount(host);
  return {
    host,
    commands,
    push: (next) => {
      adapter.latest = next;
      subscribers.forEach((handler) => handler(next));
    },
    unmount,
  };
}

/** 点一个 strat-button —— 它派的是 'strat-button-click' 自定义事件（不是 click）。 */
function pressButton(element: Element | null): void {
  if (!element) throw new Error('按钮不存在');
  element.dispatchEvent(new CustomEvent('strat-button-click', { bubbles: true, composed: true }));
}

/** 内存版 localStorage（避免跨用例串味）。 */
function memoryStorage(initial: Record<string, string> = {}): {
  readonly storage: {
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
    removeItem(key: string): void;
  };
  readonly data: Record<string, string>;
} {
  const data = { ...initial };
  return {
    data,
    storage: {
      getItem: (key) => (key in data ? data[key] : null),
      setItem: (key, value) => {
        data[key] = value;
      },
      removeItem: (key) => {
        delete data[key];
      },
    },
  };
}

let clockNow = 1_000_000_000;

beforeEach(() => {
  jest.useFakeTimers();
  clockNow = 1_000_000_000;
  document.body.innerHTML = '';
  try {
    localStorage.clear();
  } catch {
    /* jsdom 没 localStorage 时忽略 */
  }
  demoMode.set(false);
});

afterEach(() => {
  jest.runOnlyPendingTimers();
  jest.useRealTimers();
  demoMode.set(false);
  document.body.innerHTML = '';
});

// ============================================================================
// A 组：顶栏（Z1）—— §4 A1-A13
// ============================================================================

describe('§4 A 组 · 顶栏 7 元素位（v3.4 task_089）', () => {
  test('A1 品牌标识：顶栏左仍在（Stratix 品牌字样）', () => {
    const h = mountScreen();
    const brand = h.host.querySelector('[data-topbar-item="brand"]');
    expect(brand).not.toBeNull();
    expect(brand?.textContent).toBe('Stratix');
    h.unmount();
  });

  test('A2 态势胶囊：单位 / 任务 / 会话三值合一，且数值随 WorldState 更新', () => {
    const h = mountScreen();
    const capsule = h.host.querySelector('[data-role="status-capsule"]');
    expect(capsule).not.toBeNull();
    expect(capsule?.querySelectorAll('.hud-capsule-value')).toHaveLength(3);

    h.push(state({ units: [unit('u1'), unit('u2')], missions: [] }));
    expect(h.host.querySelector('[data-role="unit-count"]')?.textContent).toBe('2');
    expect(h.host.querySelector('[data-role="mission-count"]')?.textContent).toBe('0');
    expect(h.host.querySelector('[data-role="link-count"]')?.textContent).toBe('0');
    h.unmount();
  });

  test('A3 通知徽标：无通知时隐藏，有通知时点亮并显示条数', () => {
    const h = mountScreen();
    const badge = h.host.querySelector<HTMLElement>('[data-role="notice-badge"]');
    expect(badge).not.toBeNull();
    expect(badge?.hidden).toBe(true);

    h.push(state({ notices: [notice('n1')] }));
    expect(badge?.hidden).toBe(false);
    expect(badge?.textContent).toBe('1');
    h.unmount();
  });

  test('A4 切换像素风：收进 ⋯ 溢出菜单，点击仍发 theme.set 并回显当前皮肤名', () => {
    const h = mountScreen();
    const themeItem = h.host.querySelector('[data-role="theme"]');
    expect(themeItem).not.toBeNull();
    expect(themeItem?.getAttribute('label')).toContain('像素风');

    pressButton(themeItem);
    expect(h.commands).toContainEqual({ type: 'theme.set', themeId: 'pixel' });
    expect(h.host.querySelector('[data-role="theme"]')?.getAttribute('label')).toBe('像素风 · 像素');
    h.unmount();
  });

  test('A5 演示模式开关：顶栏 ▶ 图标开关，切换后工程件（日志抽屉）不再挂载', () => {
    const h = mountScreen();
    const demoButton = h.host.querySelector('[data-topbar-item="demo"]');
    expect(demoButton).not.toBeNull();
    expect(h.host.querySelector(LOG_DRAWER_TAG)).not.toBeNull();

    pressButton(demoButton);
    expect(demoMode.enabled).toBe(true);
    // 演示模式下重渲主屏：工程件不挂载（既不占画面也不订阅总线）。
    expect(h.host.querySelector(LOG_DRAWER_TAG)).toBeNull();
    expect(h.host.querySelector('[data-topbar-item="demo"]')?.getAttribute('aria-pressed')).toBe('true');
    h.unmount();
  });

  test('A6 🎬 导演开关：顶栏图标开关，点击发 camera.director，状态回显靠 core 广播', () => {
    const h = mountScreen();
    const directorButton = h.host.querySelector('[data-topbar-item="director"]');
    expect(directorButton).not.toBeNull();

    pressButton(directorButton);
    expect(h.commands).toContainEqual({ type: 'camera.director', enabled: true });

    // 真相在 core：广播 directorEnabled=true 后按钮才点亮。
    h.push(state({ directorEnabled: true }));
    expect(h.host.querySelector('[data-topbar-item="director"]')?.getAttribute('aria-pressed')).toBe('true');
    h.unmount();
  });

  test('A7 🔊 声音总开关：点击 = 静音 / 取消静音（写 localStorage，点亮即状态）', () => {
    const h = mountScreen();
    const soundButton = h.host.querySelector('[data-role="sound"]');
    expect(soundButton).not.toBeNull();
    expect(readSoundEnabled()).toBe(true);
    expect(soundButton?.getAttribute('aria-pressed')).toBe('true');

    pressButton(soundButton);
    expect(readSoundEnabled()).toBe(false);
    expect(h.host.querySelector('[data-role="sound"]')?.getAttribute('aria-pressed')).toBe('false');

    pressButton(h.host.querySelector('[data-role="sound"]'));
    expect(readSoundEnabled()).toBe(true);
    h.unmount();
  });

  test('A8 音量 0–100：滑条收进 🔊 弹出层，拖动即写 localStorage 并回显音量计', () => {
    const h = mountScreen();
    const input = h.host.querySelector<HTMLInputElement>('[data-role="sound-volume"]');
    expect(input).not.toBeNull();
    expect(input?.getAttribute('min')).toBe('0');
    expect(input?.getAttribute('max')).toBe('100');

    // 弹出层默认收起（不占顶栏宽度）。
    const popover = h.host.querySelector<HTMLElement>('[data-role="sound-popover"]');
    expect(popover?.hidden).toBe(true);
    h.host.querySelector<HTMLElement>('[data-role="sound-volume-open"]')?.click();
    expect(h.host.querySelector<HTMLElement>('[data-role="sound-popover"]')?.hidden).toBe(false);

    const slider = h.host.querySelector<HTMLInputElement>('[data-role="sound-volume"]');
    if (!slider) throw new Error('音量滑条没挂上');
    slider.value = '40';
    slider.dispatchEvent(new Event('input', { bubbles: true }));
    expect(readSoundVolume()).toBe(40);
    expect(h.host.querySelector<HTMLElement>('[data-role="sound-level-fill"]')?.style.width).toBe('40%');
    h.unmount();
  });

  test('A9 打开聊天：⋯ 菜单项仍在，点击发 ui.navigate chat 并抛 stratix:chat-open', () => {
    const h = mountScreen();
    const chatItem = h.host.querySelector('[data-role="chat"]');
    expect(chatItem).not.toBeNull();

    const opened: unknown[] = [];
    h.host.addEventListener('stratix:chat-open', (event) => opened.push((event as CustomEvent).detail));
    pressButton(chatItem);
    expect(h.commands).toContainEqual({ type: 'ui.navigate', screen: 'chat' });
    expect(opened).toHaveLength(1);
    h.unmount();
  });

  test('A10 会话面板：⋯ 菜单入口 + 右列面板本体（点入口能展开/收起）', () => {
    const h = mountScreen();
    const sessionsItem = h.host.querySelector('[data-role="sessions"]');
    expect(sessionsItem).not.toBeNull();
    const panel = h.host.querySelector(SESSION_PANEL_TAG) as (HTMLElement & { collapsed: boolean }) | null;
    expect(panel).not.toBeNull();
    expect(panel?.closest('.hud-rail-right')).not.toBeNull();
    expect(panel?.collapsed).toBe(true);

    pressButton(sessionsItem);
    expect(panel?.collapsed).toBe(false);
    h.unmount();
  });

  test('A11 看角色：⋯ 菜单项发 ui.navigate character，core 回写屏位后渲染角色屏', () => {
    const h = mountScreen();
    pressButton(h.host.querySelector('[data-role="character"]'));
    expect(h.commands).toContainEqual({ type: 'ui.navigate', screen: 'character' });

    h.push(state({ currentScreen: 'character' }));
    expect(h.host.querySelector('.hud-sub-screen')).not.toBeNull();
    h.unmount();
  });

  test('A12 去设置：⋯ 菜单项发 ui.navigate settings，core 回写屏位后渲染设置屏', () => {
    const h = mountScreen();
    pressButton(h.host.querySelector('[data-role="settings"]'));
    expect(h.commands).toContainEqual({ type: 'ui.navigate', screen: 'settings' });

    h.push(state({ currentScreen: 'settings' }));
    expect(h.host.querySelector('.hud-sub-screen')).not.toBeNull();
    h.unmount();
  });

  test('A13 状态文本标签已删除：三个开关点亮即状态（无第二份文本 + aria-pressed 可读）', () => {
    const h = mountScreen();
    const topbar = h.host.querySelector('.hud-topbar');
    expect(topbar).not.toBeNull();
    // 三个 on/off 文本标签（theme-tag / demo-tag / director-tag）不再存在。
    for (const tag of ['theme-tag', 'demo-tag', 'director-tag']) {
      expect(topbar?.querySelector(`.${tag}`)).toBeNull();
    }
    // 状态改由开关承担：三个开关都带 aria-pressed（读屏能听出开/关）。
    expect(h.host.querySelector('[data-role="sound"]')?.getAttribute('aria-pressed')).toBe('true');
    expect(h.host.querySelector('[data-role="director"]')?.getAttribute('aria-pressed')).toBe('false');
    expect(h.host.querySelector('[data-role="demo"]')?.getAttribute('aria-pressed')).toBe('false');
    // 顶栏可见元素位仍是 7 个封顶（TOPBAR_ITEM_ROLES 是计数口径，不是数 DOM 节点）。
    expect(TOPBAR_ITEM_ROLES).toHaveLength(TOPBAR_METRICS.maxVisibleItems);
    expect(topbar?.querySelectorAll('[data-topbar-item]')).toHaveLength(TOPBAR_ITEM_ROLES.length);
    h.unmount();
  });
});

// ============================================================================
// B 组：事件轨（Z2）+ 里程碑 —— §4 B1-B3
// ============================================================================

describe('§4 B 组 · 事件轨（v3.4 task_091 / task_094）', () => {
  test('B1 事件轨：5 条上限不变，默认露 2 条 + 「展开 N 条」，宽度 ≤260px', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const { storage } = memoryStorage();
    const { element, unmount } = mountMarquee(host, {
      now: () => clockNow,
      storage: () => storage,
    });

    for (let i = 0; i < 6; i += 1) {
      element.push({ kind: 'complete', icon: MARQUEE_ICONS.complete, text: `第 ${i + 1} 条`, at: clockNow });
    }
    expect(element.entries).toHaveLength(MARQUEE_METRICS.maxEntries);

    const stack = element.shadowRoot?.querySelector('[data-role="stack"]');
    const nodes = Array.from(stack?.querySelectorAll('.entry') ?? []);
    const visible = nodes.filter((node) => !node.classList.contains('is-hidden'));
    expect(visible).toHaveLength(MARQUEE_METRICS.collapsedVisible);

    const toggle = element.shadowRoot?.querySelector<HTMLElement>('[data-role="toggle"]');
    expect(toggle?.hidden).toBe(false);
    expect(toggle?.textContent).toBe(
      `展开 ${MARQUEE_METRICS.maxEntries - MARQUEE_METRICS.collapsedVisible} 条`
    );
    expect(element.style.getPropertyValue('--marquee-width')).toBe(`${MARQUEE_METRICS.maxWidthPx}px`);

    unmount();
    host.remove();
  });

  test('B2 相对时间刷新：条目内 5s 一跳（「刚刚」→「N 分钟前」）', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const { storage } = memoryStorage();
    const { element, unmount } = mountMarquee(host, {
      now: () => clockNow,
      storage: () => storage,
    });
    element.push({
      kind: 'complete',
      icon: MARQUEE_ICONS.complete,
      text: '小王 完成了任务',
      at: clockNow - 30_000,
    });
    const time = () =>
      element.shadowRoot?.querySelector('[data-role="stack"] .entry .time')?.textContent ?? '';
    expect(time()).toBe('刚刚');

    // 5s 一跳的定时器把相对时间刷新到「1 分钟前」（条目落在 30s 前，再过 40s = 70s = 1 分钟档）。
    clockNow += 40_000;
    jest.advanceTimersByTime(5000);
    expect(time()).toBe('1 分钟前');
    expect(formatRelativeTime(clockNow - 3 * 60_000, clockNow)).toBe('3 分钟前');

    unmount();
    host.remove();
  });

  test('B3 里程碑大字：每 10 个任务触发，中央大字 + L3 占用（收尾自动释放）', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const commands: HudCommand[] = [];
    const { storage } = memoryStorage();
    const { element, unmount } = mountMilestone(host, {
      dispatch: (command) => {
        commands.push(command);
      },
      storage: () => storage,
    });

    for (let i = 0; i < 9; i += 1) expect(element.noteCompleted()).toBeNull();
    expect(element.noteCompleted()).toBe(MARQUEE_METRICS.milestoneEvery);
    expect(element.showing).toBe(true);
    expect(element.text).toBe('第 10 个任务完成！');
    // 里程碑宿主标 L3（沉浸层元素）。
    expect(element.getAttribute('data-srf-layer')).toBe('L3');
    // 演出期间占用 L3；大字收起后释放。
    expect(commands).toContainEqual({ type: 'hud.layer.hold', trigger: 'milestone', active: true });
    jest.advanceTimersByTime(MARQUEE_METRICS.milestoneDurationMs);
    expect(element.showing).toBe(false);
    expect(commands).toContainEqual({ type: 'hud.layer.hold', trigger: 'milestone', active: false });

    unmount();
    host.remove();
  });
});

// ============================================================================
// C 组：小地图（Z3）—— §4 C1-C2
// ============================================================================

describe('§4 C 组 · 小地图（v3.4 task_093）', () => {
  /** jsdom 没有 2d 上下文 —— 用一个记录型替身顶住，并把调用录下来供断言。 */
  let ctxCalls: { method: string; args: unknown[] }[] = [];

  beforeEach(() => {
    ctxCalls = [];
    const stub = new Proxy(
      {},
      {
        get: (_target, prop) => {
          if (prop === 'canvas') return null;
          if (prop === 'measureText') return () => ({ width: 0 });
          return (...args: unknown[]) => {
            ctxCalls.push({ method: String(prop), args });
          };
        },
      }
    );
    jest
      .spyOn(HTMLCanvasElement.prototype, 'getContext')
      .mockReturnValue(stub as unknown as CanvasRenderingContext2D);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('C1 小地图：200×120 规格不变 + MAP 角标 + hover 提亮有过滤渡', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const { element, unmount } = mountMinimap(host, { dispatch: () => undefined });

    const canvas = element.shadowRoot?.querySelector('canvas');
    expect(canvas?.getAttribute('width')).toBe(String(MINIMAP_METRICS.widthPx));
    expect(canvas?.getAttribute('height')).toBe(String(MINIMAP_METRICS.heightPx));
    expect(MINIMAP_METRICS.widthPx).toBe(200);
    expect(MINIMAP_METRICS.heightPx).toBe(120);

    // 「MAP」角标画在画布上（不是 DOM 节点）—— 记录 2d 调用来证。
    expect(
      ctxCalls.some((call) => call.method === 'fillText' && call.args[0] === MINIMAP_METRICS.badgeText)
    ).toBe(true);

    const css = element.shadowRoot?.querySelector('style')?.textContent ?? '';
    expect(css).toContain(`brightness(${MINIMAP_METRICS.hoverBrightness})`);
    expect(css).toMatch(/\.frame\s*\{[^}]*transition:\s*filter/);

    unmount();
    host.remove();
  });

  test('C2 小地图点击跳转：点画布发 camera.center；命中单位时先发 unit.select', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const commands: unknown[] = [];
    const { element, unmount } = mountMinimap(host, {
      dispatch: (command) => {
        commands.push(command);
      },
    });
    const canvas = element.shadowRoot?.querySelector('canvas');
    if (!canvas) throw new Error('小地图画布没挂上');
    // jsdom 没有排版 —— 造一个 200×120 的矩形，坐标换算才有意义。
    const rect = {
      left: 0,
      top: 0,
      width: 200,
      height: 120,
      right: 200,
      bottom: 120,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect;
    canvas.getBoundingClientRect = () => rect;
    // jsdom 无 setPointerCapture —— 静默降级（组件本身有 ?. 保护）。
    (canvas as unknown as { setPointerCapture?: unknown }).setPointerCapture = () => undefined;

    // 空白处点击 = 相机对中该世界点。
    canvas.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, clientX: 50, clientY: 50, button: 0 }));
    const centerWorld = minimapToWorld({ x: 50, y: 50 }, { width: 200, height: 120 });
    expect(commands).toContainEqual({ type: 'camera.center', x: centerWorld.x, y: centerWorld.y });

    // 光点命中（8px 半径内）时先发 unit.select，再发 camera.center。
    commands.length = 0;
    element.setUnits([{ id: 'u-1', x: 1000, y: 1000, status: 'idle' }]);
    // 世界 (1000, 1000) 在画布上落在 (70, 50) —— 点它就是命中那个光点。
    canvas.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, clientX: 70, clientY: 50, button: 0 }));
    expect(commands[0]).toEqual({ type: 'unit.select', unitIds: ['u-1'], mode: 'set' });
    expect(commands[1]).toEqual({ type: 'camera.center', x: 1000, y: 1000 });

    unmount();
    host.remove();
  });
});

// ============================================================================
// D 组：当日回放（控制岛内）+ 时间戳角标 —— §4 D1-D6
// ============================================================================

describe('§4 D 组 · 当日回放与角标（v3.4 task_090 / 093 / 094）', () => {
  /** 造一条回放条目。 */
  const entry = (at: number) => ({
    at,
    kind: 'work' as const,
    characterId: 'c-1',
    taskId: 't-1',
    label: '干活中',
    sessionId: 's-1',
  });

  test('D1 今日回放热力条：96 桶不变，且已迁进控制岛（与命令条同岛）', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const controller = createReplayController({
      port: { loadDay: async () => [entry(1000), entry(2000), entry(3000)] },
      emitBeat: () => undefined,
      setClock: () => undefined,
    });
    const mounted = mountDayReplay(host, { controller });
    await controller.load();

    const bars = mounted.element.shadowRoot?.querySelectorAll('.bar') ?? [];
    expect(bars).toHaveLength(REPLAY_METRICS.heatBuckets);
    expect(REPLAY_METRICS.heatBuckets).toBe(96);

    // 迁岛：主屏里的回放条挂在控制岛内（不再是通栏底栏）。
    const screen = mountScreen();
    const island = screen.host.querySelector('.hud-bottom-bar');
    expect(island?.querySelector('strat-day-replay')).not.toBeNull();

    screen.unmount();
    mounted.unmount();
    host.remove();
  });

  test('D2 回放 scrubber：拖动 = seek（先发 reset 拍，再按时间重放）', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const beats: { kind: string }[] = [];
    const clocks: (number | null)[] = [];
    const controller = createReplayController({
      port: { loadDay: async () => [entry(1000), entry(2000), entry(3000)] },
      emitBeat: (beat) => {
        beats.push(beat);
      },
      setClock: (at) => {
        clocks.push(at);
      },
    });
    const mounted = mountDayReplay(host, { controller });
    await controller.load();

    const strip = mounted.element.shadowRoot?.querySelector('[data-role="strip"]');
    if (!strip) throw new Error('回放条没挂上');
    const rect = {
      left: 0,
      top: 0,
      width: 100,
      height: 30,
      right: 100,
      bottom: 30,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect;
    strip.getBoundingClientRect = () => rect;
    (strip as unknown as { setPointerCapture?: unknown }).setPointerCapture = () => undefined;

    strip.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, clientX: 80 }));

    expect(beats[0]?.kind).toBe('reset');
    expect(clocks.length).toBeGreaterThan(0);

    mounted.unmount();
    host.remove();
  });

  test('D3 回放时钟 / 条数：时钟显示当前时刻，条数显示当天事件数', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const controller = createReplayController({
      port: { loadDay: async () => [entry(1000), entry(2000), entry(3000)] },
      emitBeat: () => undefined,
      setClock: () => undefined,
    });
    const mounted = mountDayReplay(host, { controller });
    await controller.load();
    const shadow = mounted.element.shadowRoot;
    expect(shadow?.querySelector('[data-role="count"]')?.textContent).toBe('3 条');

    controller.seek(2000);
    expect(shadow?.querySelector('[data-role="clock"]')?.textContent).not.toBe('--:--:--');

    mounted.unmount();
    host.remove();
  });

  test('D4 ▶ 60 秒看完今天：按钮可点 → 播放态 → 占用 L3 沉浸层', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const immersive: boolean[] = [];
    const controller = createReplayController({
      port: { loadDay: async () => [entry(1000), entry(2000), entry(3000)] },
      emitBeat: () => undefined,
      setClock: () => undefined,
      setImmersive: (active) => {
        immersive.push(active);
      },
    });
    const mounted = mountDayReplay(host, { controller });
    await controller.load();

    const button = mounted.element.shadowRoot?.querySelector('[data-role="play"]') as HTMLButtonElement;
    expect(button.disabled).toBe(false);
    expect(button.textContent).toContain('60 秒看完今天');

    button.click();
    expect(controller.state.playing).toBe(true);
    expect(immersive).toContain(true);
    expect(button.textContent).toContain('停下');

    controller.stop();
    expect(controller.state.playing).toBe(false);
    expect(immersive).toContain(false);

    mounted.unmount();
    host.remove();
  });

  test('D5 回放空态：今天没有记录就如实呈现空态，不装成有数据', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const controller = createReplayController({
      port: { loadDay: async () => [] },
      emitBeat: () => undefined,
      setClock: () => undefined,
    });
    const mounted = mountDayReplay(host, { controller });
    await controller.load();

    const empty = mounted.element.shadowRoot?.querySelector<HTMLElement>('[data-role="empty"]');
    const button = mounted.element.shadowRoot?.querySelector('[data-role="play"]') as HTMLButtonElement;
    expect(empty?.hidden).toBe(false);
    expect(empty?.textContent).toBe(REPLAY_EMPTY_TEXT);
    expect(button.disabled).toBe(true);

    mounted.unmount();
    host.remove();
  });

  test('D6 回放时间戳角标：44px 大字 + 左上 inset top 56px（避让顶栏），仅回放态出现', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const { element, unmount } = mountReplayClock(host);
    const badge = element.shadowRoot?.querySelector<HTMLElement>('[data-role="badge"]');

    // 非回放态隐藏（不占左上角，也不误导观众）。
    expect(element.visible).toBe(false);
    expect(badge?.dataset.on).toBe('0');

    element.setTime(new Date(2026, 0, 2, 3, 4, 5).getTime());
    expect(element.visible).toBe(true);
    expect(badge?.dataset.on).toBe('1');
    expect(element.shadowRoot?.querySelector('.tag')?.textContent).toContain('回放中');

    // 落点：顶部 inset 56px（> 顶栏 40px）+ 字号 44px。
    // 模式状态条（@since v3.6，task_117）亮出时角标整体下移一条（不压住状态条）。
    expect(element.style.getPropertyValue('--replay-clock-inset-top')).toBe(
      `calc(var(${MODE_STRIP_CSS_VAR}, 0px) + 56px)`
    );
    expect(element.style.getPropertyValue('--replay-clock-font')).toBe(
      `${REPLAY_METRICS.clockFontPx}px`
    );
    expect(REPLAY_METRICS.clockFontPx).toBe(44);

    unmount();
    host.remove();
  });
});

// ============================================================================
// E 组：命令面板 + 三栏面板 + 日志抽屉 —— §4 E1-E5
// ============================================================================

describe('§4 E 组 · 命令与面板（v3.4 task_089 / 090）', () => {
  test('E1 命令面板：12 条命令一条不减（无选中 6 条 + 有选中 12 条），岛内 1 行 6 条', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const commands: HudCommand[] = [];
    const subscribers = new Set<(next: WorldState) => void>();
    const deps = {
      dispatch: (command: HudCommand) => {
        commands.push(command);
      },
      subscribe: (handler: (next: WorldState) => void) => {
        subscribers.add(handler);
        return () => {
          subscribers.delete(handler);
        };
      },
    };
    const unmount = mountCommandPanel(deps, host, { variant: 'strip' });
    const panel = host.querySelector(COMMAND_PANEL_TAG);
    if (!panel?.shadowRoot) throw new Error('命令面板未 upgrade');

    // 无选中：只有全局 6 条。
    subscribers.forEach((handler) => handler(state()));
    expect(panel.shadowRoot.querySelectorAll('button.command')).toHaveLength(6);

    // 有选中：6 条全局 + 6 条选中组 = 12 条。
    subscribers.forEach((handler) =>
      handler(state({ selection: { unitIds: ['u-1'], previewUnitIds: [], revision: 1 } }))
    );
    expect(panel.shadowRoot.querySelectorAll('button.command')).toHaveLength(12);
    expect(CONTROL_ISLAND_METRICS.visibleCommandCount).toBe(6);
    expect(panel.getAttribute('variant')).toBe('strip');

    unmount();
    host.remove();
  });

  test('E2 Agent 侧栏：仍在左列，选中单位时渲染单选形态', () => {
    const h = mountScreen();
    const slot = h.host.querySelector('.hud-rail-left[data-role="agent-panel"]');
    expect(slot).not.toBeNull();
    const panel = h.host.querySelector(AGENT_PANEL_TAG) as (HTMLElement & { mode: string }) | null;
    expect(panel).not.toBeNull();

    h.push(state({ selection: { unitIds: ['u-1'], previewUnitIds: [], revision: 1 }, units: [unit('u-1')] }));
    expect(panel?.mode).toBe('single');
    h.unmount();
  });

  test('E3 态势总览：仍在右列，指标卡由 WorldState 派生', () => {
    const h = mountScreen();
    const slot = h.host.querySelector('.hud-rail-right [data-role="status-screen"]');
    expect(slot).not.toBeNull();
    const screen = h.host.querySelector(STATUS_SCREEN_TAG) as HTMLElement | null;
    expect(screen).not.toBeNull();

    h.push(state({ units: [unit('u1'), unit('u2'), unit('u3'), unit('u4')] }));
    const metric = screen?.shadowRoot?.querySelector('[data-metric="units"]');
    expect(metric?.getAttribute('data-value')).toBe('4');
    expect(metric?.querySelector('[data-role="metric-value"]')?.textContent).toBe('4');
    h.unmount();
  });

  test('E4 会话面板：右列面板本体仍在（会话列表 / kind 筛选 / 中断 / 历史抽屉）', () => {
    const h = mountScreen();
    const slot = h.host.querySelector('.hud-rail-right [data-role="session-panel"]');
    expect(slot).not.toBeNull();
    const panel = h.host.querySelector(SESSION_PANEL_TAG) as
      | (HTMLElement & { collapsed: boolean; toggleCollapsed(): void })
      | null;
    expect(panel).not.toBeNull();
    if (!panel) throw new Error('会话面板没挂上');
    if (panel.collapsed) panel.toggleCollapsed();

    // kind 筛选（全部 / 聊天 / 互聊 / 任务 / 编队 / 连接）
    const chips = panel.shadowRoot?.querySelectorAll('button.chip[data-action="filter"]') ?? [];
    expect(chips.length).toBeGreaterThanOrEqual(4);
    // 列表区（无会话时如实显示空态，不编假会话）。
    expect(panel.shadowRoot?.querySelector('[data-role="rows"], [data-role="empty"]')).not.toBeNull();
    h.unmount();
  });

  test('E5 日志抽屉：唯一工程件（data-engineering），演示模式下不挂载', () => {
    const h = mountScreen();
    const slot = h.host.querySelector('[data-role="log-drawer"]');
    expect(slot?.getAttribute('data-engineering')).toBe('true');
    expect(h.host.querySelector(LOG_DRAWER_TAG)).not.toBeNull();

    // 演示模式：工程件隐藏（既不占画面也不订阅总线）。
    pressButton(h.host.querySelector('[data-topbar-item="demo"]'));
    expect(demoMode.enabled).toBe(true);
    expect(h.host.querySelector(LOG_DRAWER_TAG)).toBeNull();
    h.unmount();
  });
});

// ============================================================================
// F 组：toast 与声音引擎 —— §4 F2-F3
// ============================================================================

describe('§4 F 组 · toast 与声音引擎', () => {
  test('F2 toast 轻提示：右上瞬时反馈（role=status，3s 自动消失）', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const { element, unmount } = mountToastHost(host);

    element.show('阿尔法 完成任务', 'success');
    expect(element.toastCount).toBe(1);
    const node = element.shadowRoot?.querySelector('.toast');
    expect(node?.getAttribute('role')).toBe('status');
    expect(node?.getAttribute('data-tone')).toBe('success');

    jest.advanceTimersByTime(3000);
    expect(element.toastCount).toBe(0);

    unmount();
    host.remove();
  });

  test('F3 声音引擎：五音齐备（真实音源 + 合成兜底），开关 / 音量口径不变', () => {
    // 五个声音 → 五个文件（缺文件才回落合成器，功能不因缺资源而丢）。
    expect(Object.keys(SFX_FILES).sort()).toEqual(['command', 'complete', 'error', 'milestone', 'select']);
    // 战场 cue → 声音的映射（command / claim / focus 共用「哒」）。
    expect(soundIdForCue('select')).toBe('select');
    expect(soundIdForCue('command')).toBe('command');
    expect(soundIdForCue('claim')).toBe('command');
    expect(soundIdForCue('focus')).toBe('command');
    expect(soundIdForCue('complete')).toBe('complete');

    // 开关与音量：真源是 localStorage（0-100）。
    const { storage, data } = memoryStorage();
    expect(readSoundEnabled(storage)).toBe(true);
    writeSoundEnabled(false, storage);
    expect(data['stratix.sound.enabled']).toBe('0');
    expect(readSoundEnabled(storage)).toBe(false);

    writeSoundVolume(40, storage);
    expect(readSoundVolume(storage)).toBe(40);
    // 越界钳回 [0, 100]。
    writeSoundVolume(999, storage);
    expect(readSoundVolume(storage)).toBe(100);
    writeSoundVolume(-5, storage);
    expect(readSoundVolume(storage)).toBe(0);
  });
});

// ============================================================================
// G 组：报错红色 vignette —— §4 G2（屏幕空间层，HUD 侧）
// ============================================================================

describe('§4 G2 · 报错红色 vignette（呼吸 ×2）', () => {
  test('G2 报错红色 vignette：呼吸参数取自唯一事实源（×2 / 650ms / 0.28），导演态下报错才触发', () => {
    const failed: WorldEvent = { type: 'task.failed', task: task('t-1') };
    const completed: WorldEvent = { type: 'task.completed', task: task('t-2') };

    // 触发口径：导演态 + task.failed 才亮（普通任务不亮）。
    expect(errorGlowTrigger(failed, true)).toBe(true);
    expect(errorGlowTrigger(failed, false)).toBe(false);
    expect(errorGlowTrigger(completed, true)).toBe(false);

    const host = document.createElement('div');
    document.body.appendChild(host);
    const { element, unmount } = mountErrorGlow(host);

    // 呼吸参数落在 CSS 变量上（动画由样式表执行，不是脚本逐帧改样式）。
    expect(element.style.getPropertyValue('--glow-pulses')).toBe(
      String(SCREEN_FX_METRICS.errorGlowPulses)
    );
    expect(element.style.getPropertyValue('--glow-pulse-ms')).toBe(
      `${SCREEN_FX_METRICS.errorGlowPulseMs}ms`
    );
    expect(element.style.getPropertyValue('--glow-peak')).toBe(
      String(SCREEN_FX_METRICS.errorGlowAlpha)
    );
    expect(SCREEN_FX_METRICS.errorGlowPulses).toBe(2);

    // pulse() 挂上动画（连打两次会重播），计数累加。
    element.pulse();
    expect(element.showing).toBe(true);
    expect(element.pulseCount).toBe(1);
    element.pulse();
    expect(element.pulseCount).toBe(2);

    unmount();
    host.remove();
  });
});
