/**
 * 回归测试：HUD 控制岛（Z4，@since v3.4，task_090）。
 *
 * 覆盖三条线（浏览器端的真排版断言在 scripts/check-hud-island-layout.mjs —— jsdom 没有排版，
 *   碰撞 / 间距只能在那儿量；这里守的是**结构与契约**）：
 *   1. 度量口径（core/theme/visual-spec.ts）—— 高度封顶 100px、宽 56%、间距 ≥40px；
 *   2. 主屏结构 —— 底栏已换成「贴底居中的控制岛」，回放条与命令条同岛分层，
 *      旧的写死底栏变量 --hud-bottom-h 消失；
 *   3. 组件契约 —— 命令面板 strip 变体、day-replay 不再强写 --replay-strip-h（宿主可覆盖）。
 *
 * @jest-environment jsdom
 */

import {
  CONTROL_ISLAND_METRICS,
  CONTROL_ISLAND_SIDE_INSET_PX,
  MARQUEE_METRICS,
  REPLAY_METRICS,
} from '../../core/theme/visual-spec';
import type { HudCommand, WorldState } from '../../core/types';
import type { ReplayBeat } from '../../core/types';
import { COMMAND_PANEL_TAG, mountCommandPanel } from '../panels/command-panel';
import { mountDayReplay } from '../components/replay/day-replay';
import { createReplayController } from '../components/replay/replay-controller';
import { createMainScreen } from '../screens/main-screen';

const EMPTY_STATE: WorldState = {
  units: [],
  missions: [],
  selection: { unitIds: [], previewUnitIds: [], revision: 0 },
  characters: [],
  notices: [],
  links: [],
  messages: [],
};

/** 只够主屏装配用的假 adapter。 */
function fakeAdapter(commands: HudCommand[] = []): {
  dispatch: (command: HudCommand) => void;
  subscribe: (handler: (state: WorldState) => void) => () => void;
  mount: () => () => void;
  latest: null;
} {
  return {
    dispatch: (command) => { commands.push(command); },
    subscribe: () => () => undefined,
    mount: () => () => undefined,
    latest: null,
  };
}

describe('控制岛度量（唯一事实源）', () => {
  test('高度封顶 ≤100px，目标高度是设计参照而不是写死的实现值', () => {
    expect(CONTROL_ISLAND_METRICS.maxHeightPx).toBeLessThanOrEqual(100);
    expect(CONTROL_ISLAND_METRICS.targetHeightPx).toBeLessThanOrEqual(
      CONTROL_ISLAND_METRICS.maxHeightPx
    );
  });

  test('宽度占屏宽 56%，一行 6 条命令', () => {
    expect(CONTROL_ISLAND_METRICS.widthRatio).toBeCloseTo(0.56);
    expect(CONTROL_ISLAND_METRICS.visibleCommandCount).toBe(6);
  });

  test('与角件的最小间距 ≥40px', () => {
    expect(CONTROL_ISLAND_METRICS.cornerClearancePx).toBeGreaterThanOrEqual(40);
  });

  test('单侧留边 = 角件留边 + 更宽的角件（事件轨 260）+ 最小间距', () => {
    // 控制岛居中 → 两侧留边必须同时成立 → 约束方永远是更宽的那一侧。
    expect(CONTROL_ISLAND_SIDE_INSET_PX).toBe(
      CONTROL_ISLAND_METRICS.cornerMarginPx +
        MARQUEE_METRICS.maxWidthPx +
        CONTROL_ISLAND_METRICS.cornerClearancePx
    );
  });

  test('1280 宽下 56% 会被留边钳住（这是与「零重叠」硬验收的取舍，不是 bug）', () => {
    const viewport = 1280;
    const islandWidth = Math.min(
      viewport * CONTROL_ISLAND_METRICS.widthRatio,
      viewport - 2 * CONTROL_ISLAND_SIDE_INSET_PX
    );
    expect(islandWidth).toBeLessThan(viewport * CONTROL_ISLAND_METRICS.widthRatio);
    // 钳完之后左缘仍在事件轨右缘 + 40px 之外。
    const marqueeRight = CONTROL_ISLAND_METRICS.cornerMarginPx + MARQUEE_METRICS.maxWidthPx;
    expect(viewport / 2 - islandWidth / 2 - marqueeRight).toBeGreaterThanOrEqual(
      CONTROL_ISLAND_METRICS.cornerClearancePx
    );
  });
});

describe('主屏结构：底栏 → 贴底居中的控制岛', () => {
  const mountScreen = () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const unmount = createMainScreen(fakeAdapter()).mount(host);
    return { host, unmount };
  };

  test('控制岛绝对定位、贴底、水平居中', () => {
    const { host, unmount } = mountScreen();
    const island = host.querySelector<HTMLElement>('.hud-bottom-bar');
    expect(island).not.toBeNull();
    const style = getComputedStyle(island as HTMLElement);
    expect(style.position).toBe('absolute');
    expect(style.bottom).toBe('0px');
    expect(style.left).toBe('50%');
    expect(style.transform).toContain('translateX(-50%)');
    unmount();
    host.remove();
  });

  test('旧的写死底栏变量消失，改成控制岛度量变量', () => {
    const { host, unmount } = mountScreen();
    const css = Array.from(host.querySelectorAll('style'))
      .map((el) => el.textContent ?? '')
      .join('\n')
      // 注释里会提到旧变量名（解释「为什么换掉」），断言只看**声明**。
      .replace(/\/\*[\s\S]*?\*\//g, '');
    expect(css).not.toContain('--hud-bottom-h');
    expect(css).not.toContain('min(34cqh');
    expect(css).toContain('--hud-island-max-h');
    expect(css).toContain('--hud-island-w');
    // 高度封顶值直接来自唯一事实源。
    expect(css).toContain(`--hud-island-max-h: ${CONTROL_ISLAND_METRICS.maxHeightPx}px`);
    unmount();
    host.remove();
  });

  test('回放条与命令条同岛、上下分层（回放在上、命令在下）', () => {
    const { host, unmount } = mountScreen();
    const island = host.querySelector<HTMLElement>('.hud-bottom-bar') as HTMLElement;
    const replaySlot = island.querySelector<HTMLElement>('.hud-replay-slot');
    const panelSlot = island.querySelector<HTMLElement>('[data-role="command-panel"]');
    expect(replaySlot).not.toBeNull();
    expect(panelSlot).not.toBeNull();
    // 同岛 = 两个槽位都在控制岛这一个盒子里。
    expect(island.contains(replaySlot as Node)).toBe(true);
    expect(island.contains(panelSlot as Node)).toBe(true);
    // 上→下顺序：回放条先于命令条。
    const children = Array.from(island.children);
    const replayIndex = children.findIndex((c) => c.classList.contains('hud-replay-slot'));
    const panelIndex = children.findIndex((c) => c.getAttribute('data-role') === 'command-panel');
    expect(replayIndex).toBeGreaterThanOrEqual(0);
    expect(panelIndex).toBeGreaterThan(replayIndex);
    unmount();
    host.remove();
  });

  test('主屏挂的命令面板用 strip 变体（1 行命令条形态）', () => {
    const { host, unmount } = mountScreen();
    const panel = host.querySelector(COMMAND_PANEL_TAG) as HTMLElement;
    expect(panel).not.toBeNull();
    expect(panel.getAttribute('variant')).toBe('strip');
    unmount();
    host.remove();
  });
});

describe('组件契约', () => {
  test('命令面板：strip 变体落到宿主属性上，默认仍是 default', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const unmountStrip = mountCommandPanel(fakeAdapter(), host, { variant: 'strip' });
    expect(host.querySelector(COMMAND_PANEL_TAG)?.getAttribute('variant')).toBe('strip');
    unmountStrip();

    const host2 = document.createElement('div');
    document.body.appendChild(host2);
    const unmountDefault = mountCommandPanel(fakeAdapter(), host2);
    expect(host2.querySelector(COMMAND_PANEL_TAG)?.getAttribute('variant')).toBe('default');
    unmountDefault();

    host.remove();
    host2.remove();
  });

  test('命令按钮带 title（strip 形态藏掉提示行后，详情仍在 tooltip 里）', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const unmount = mountCommandPanel(fakeAdapter(), host, { variant: 'strip' });
    const button = host.querySelector(COMMAND_PANEL_TAG)?.shadowRoot?.querySelector('button.command');
    expect(button?.getAttribute('title')).toBeTruthy();
    unmount();
    host.remove();
  });

  test('day-replay 不再强写 --replay-strip-h（宿主可覆盖，岛内才能压薄）', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const mounted = mountDayReplay(host, { controller: null });
    const element = mounted.element as HTMLElement;
    // 组件自己不再写死高度 → 宿主（控制岛）说了算。
    expect(element.style.getPropertyValue('--replay-strip-h')).toBe('');
    mounted.unmount();
    host.remove();
  });
});

describe('回放功能不回归（岛内那层回放条）', () => {
  test('有数据 → 热力条出栏、▶ 按钮可点、点下去进入 60 秒模式', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const beats: ReplayBeat[] = [];
    const controller = createReplayController({
      port: {
        loadDay: async () => [
          { at: 1000, kind: 'spawn', characterId: 'a', taskId: 't-1', label: '干活中', sessionId: 's-1' },
          { at: 2000, kind: 'work', characterId: 'a', taskId: 't-1', label: '干活中', sessionId: 's-1' },
        ],
      },
      emitBeat: (beat) => { beats.push(beat); },
      setClock: () => undefined,
    });
    const mounted = mountDayReplay(host, { controller });
    await controller.load();

    const shadow = mounted.element.shadowRoot;
    expect(shadow?.querySelectorAll('.bar').length).toBe(REPLAY_METRICS.heatBuckets);
    const button = shadow?.querySelector('[data-role="play"]') as HTMLButtonElement;
    expect(button.disabled).toBe(false);

    button.click();
    expect(controller.state.playing).toBe(true);
    expect(button.textContent).toContain('停下');
    expect(beats[0]?.kind).toBe('reset');

    mounted.unmount();
    host.remove();
  });

  test('空数据 → 空态可见、按钮禁用（岛里也一样，不装作今天没活儿）', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const controller = createReplayController({
      port: { loadDay: async () => [] },
      emitBeat: () => undefined,
      setClock: () => undefined,
    });
    const mounted = mountDayReplay(host, { controller });
    const shadow = mounted.element.shadowRoot;
    const button = shadow?.querySelector('[data-role="play"]') as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect((shadow?.querySelector('[data-role="empty"]') as HTMLElement | null)?.hidden).toBe(false);
    mounted.unmount();
    host.remove();
  });
});
