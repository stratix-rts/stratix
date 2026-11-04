/**
 * 集成测试：HUD 边角件版面计算（hud/layout/hud-layout.ts，@since v3.4，task_093）。
 *
 * 覆盖两条**几何硬验收**（jsdom 里量不到包围盒，所以规则本身必须有一处可断言的落点）：
 *   1. Z3 小地图与 Z4 控制岛：零重叠 + 水平间距 ≥40px（多档视口宽都成立）；
 *   2. Z5 时间戳角标与 Z1 顶栏：包围盒不相交（顶部 inset 56px > 顶栏 40px）。
 *
 * 真排版的同口径断言在 scripts/check-hud-island-layout.mjs（浏览器里量真实盒子）。
 *
 * @jest-environment jsdom
 */

import {
  CONTROL_ISLAND_METRICS,
  CONTROL_ISLAND_SIDE_INSET_PX,
  MINIMAP_METRICS,
  REPLAY_CLOCK_TOP_INSET_PX,
  REPLAY_METRICS,
  TOPBAR_METRICS,
} from '../../core/theme/visual-spec';
import {
  controlIslandRect,
  controlIslandWidthPx,
  minimapIslandClearancePx,
  minimapRect,
  rectsIntersect,
  replayClockIntersectsTopbar,
  replayClockTopbarGapPx,
  replayClockTopPx,
} from '../layout/hud-layout';
import { createMainScreen } from '../screens/main-screen';
import type { HudCommand, WorldState } from '../../core/types';

/** 只够主屏装配用的假 adapter（本模块只借主屏的样式表，不关心业务态）。 */
function fakeAdapter(): {
  dispatch: (command: HudCommand) => void;
  subscribe: (handler: (state: WorldState) => void) => () => void;
  mount: () => () => void;
  latest: null;
  themeId: 'default';
  subscribeTheme: (listener: (themeId: 'default' | 'pixel') => void) => () => void;
} {
  return {
    dispatch: () => undefined,
    subscribe: () => () => undefined,
    mount: () => () => undefined,
    latest: null,
    // 皮肤真相（@since task_115）：主屏要读当前皮肤，假 adapter 也要给一份。
    themeId: 'default',
    subscribeTheme: () => () => undefined,
  };
}

/** 参与测量的视口宽（720p 基准 / 1080p 常见档 / 1024p 窄屏下界）。 */
const VIEWPORT_WIDTHS = [1024, 1280, 1920];

describe('Z3 小地图 × Z4 控制岛：≥40px 间距是规则，不是巧合', () => {
  test('间距下限来自唯一事实源（40px）', () => {
    expect(CONTROL_ISLAND_METRICS.cornerClearancePx).toBeGreaterThanOrEqual(40);
  });

  test.each(VIEWPORT_WIDTHS)('视口宽 %ipx：小地图与控制岛零重叠且间距 ≥40px', (width) => {
    const island = controlIslandRect(width, 720);
    const map = minimapRect(width, 720);
    expect(rectsIntersect(island, map)).toBe(false);
    expect(minimapIslandClearancePx(width)).toBeGreaterThanOrEqual(
      CONTROL_ISLAND_METRICS.cornerClearancePx
    );
  });

  test('小地图与控制岛**都**贴边，留边口径统一（16px）', () => {
    const width = 1280;
    const map = minimapRect(width, 720);
    expect(width - map.right).toBe(MINIMAP_METRICS.cornerMarginPx);
    expect(MINIMAP_METRICS.cornerMarginPx).toBe(CONTROL_ISLAND_METRICS.cornerMarginPx);
  });

  test('控制岛宽度公式与样式表同源（min(56% 屏宽, 屏宽 − 2×单侧留边)）', () => {
    const width = 1280;
    expect(controlIslandWidthPx(width)).toBe(
      Math.min(
        width * CONTROL_ISLAND_METRICS.widthRatio,
        width - 2 * CONTROL_ISLAND_SIDE_INSET_PX
      )
    );
    // 居中：左右留白相等。
    const island = controlIslandRect(width, 720);
    expect(island.left).toBeCloseTo(width - island.right, 5);
  });

  test('样式表里的宽度公式与本模块一致（防漂移：改了 CSS 忘了改这里）', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const unmount = createMainScreen(fakeAdapter()).mount(host);
    const css = Array.from(host.querySelectorAll('style'))
      .map((el) => el.textContent ?? '')
      .join('\n')
      .replace(/\/\*[\s\S]*?\*\//g, '');
    // 公式的字面形状必须与 hud-layout.controlIslandWidthPx 一致。
    expect(css).toContain('width: min(var(--hud-island-w), calc(100% - 2 * var(--hud-island-inset)))');
    // 两个变量又都回到唯一事实源。
    expect(css).toContain(`--hud-island-w: ${Math.round(CONTROL_ISLAND_METRICS.widthRatio * 100)}%`);
    expect(css).toContain(`--hud-island-inset: ${CONTROL_ISLAND_SIDE_INSET_PX}px`);
    unmount();
    host.remove();
  });
});

describe('Z5 时间戳角标 × Z1 顶栏：不相交', () => {
  test('角标顶部 inset = 顶栏高度 + 与顶栏的间距（56px = 40 + 16）', () => {
    expect(replayClockTopPx()).toBe(56);
    expect(replayClockTopPx()).toBe(TOPBAR_METRICS.heightPx + REPLAY_METRICS.clockTopbarClearancePx);
    expect(REPLAY_CLOCK_TOP_INSET_PX).toBe(replayClockTopPx());
  });

  test('角标顶边在顶栏下缘之下 → 包围盒不相交（垂直净距为正）', () => {
    expect(replayClockTopbarGapPx()).toBeGreaterThan(0);
    expect(replayClockIntersectsTopbar()).toBe(false);
  });

  test('旧的 24px inset 会压住顶栏（回归护栏：改回去就红）', () => {
    // 角标顶边 24px < 顶栏 40px → 必然相交 —— 这正是本任务修掉的旧状态。
    expect(24).toBeLessThan(TOPBAR_METRICS.heightPx);
    expect(replayClockTopPx()).toBeGreaterThan(24);
  });
});
