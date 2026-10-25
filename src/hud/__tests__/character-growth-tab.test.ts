/**
 * 集成测试：角色屏「成长」tab 与全场总览排行（character-screen.ts 的 task_061 增量）。
 * 覆盖：第四 tab 渲染与切换、四区块空态引导语（空数据准则）、数据注入后曲线 / 分布条 /
 *   热力 / 时间线就位、排行键切换（等级 / 完成率 / 活跃度）、统计行三档降级
 *   （未接端口 / 读取中 / 不可用）、tab 重进重拉明细。
 * @jest-environment jsdom
 *
 * 闭环口径：store / bus-adapter / screen 全是真件（同 character-editor-tabs.test.ts 夹具）；
 * 成长数据口是注入面 —— 用可控桩（deferred 手动放行），驱动「数据到达 → forceRerender」的
 * 异步链路（成长数据不在 WorldState 签名里，必须显式触发重画）。
 */

import { createStore } from '../../core/store';
import type { CharacterView, HudCommand, UnitView, WorldState } from '../../core/types';
import { createHudBusAdapter } from '../bridge/bus-adapter';
import { createThemeController } from '../theme/theme-controller';
import {
  CHARACTER_SCREEN_TAG,
  mountCharacterScreen,
  type StratCharacterScreenElement,
} from '../screens/character-screen';
import type {
  GrowthExpEvent,
  GrowthOverviewRow,
  GrowthStatsPort,
  GrowthTaskInput,
} from '../screens/growth-catalog';

// canvas 2d 上下文 stub（057 minimap 同模式）：屏内曲线画布会 setData 直绘，
// jsdom 无 canvas 实现 —— stub 只吞调用不炸（绘制面在 growth-chart.test 已细断）。
beforeAll(() => {
  const noop = (): void => undefined;
  jest.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    setTransform: noop,
    clearRect: noop,
    beginPath: noop,
    moveTo: noop,
    lineTo: noop,
    stroke: noop,
    arc: noop,
    fill: noop,
    fillText: noop,
  } as unknown as CanvasRenderingContext2D);
});

afterAll(() => {
  jest.restoreAllMocks();
});

/* ------------------------------------------------------------------ 夹具 —— */

const CHARACTERS: CharacterView[] = [
  { id: 'c-neo', name: 'Neo', persona: 'p1', level: 2, experience: 130, agentKind: 'codex' },
  { id: 'c-morph', name: '墨菲斯', persona: 'p2', level: 1, experience: 40, agentKind: 'codex' },
];

const UNITS: UnitView[] = [
  { id: 'unit_c-neo', name: 'Neo', status: 'idle', missionId: null, power: 3, characterId: 'c-neo' },
  { id: 'unit_c-morph', name: '墨菲斯', status: 'idle', missionId: null, power: 2, characterId: 'c-morph' },
];

function makeState(): WorldState {
  return {
    units: UNITS,
    missions: [],
    selection: { unitIds: ['unit_c-neo'], previewUnitIds: [], revision: 0 }, // 单选 → c-neo 是编辑对象
    characters: CHARACTERS,
    notices: [],
    links: [],
    messages: [],
  };
}

interface Deferred<T> {
  readonly promise: Promise<T>;
  resolve(value: T): void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

/** 可控的成长数据口桩：三次调用各挂一个 deferred，测试里手动放行。 */
interface GrowthStub {
  readonly port: GrowthStatsPort;
  readonly overview: Deferred<readonly GrowthOverviewRow[] | null>;
  readonly expEvents: Deferred<readonly GrowthExpEvent[] | null>;
  readonly recentTasks: Deferred<readonly GrowthTaskInput[] | null>;
  readonly expEventsCalls: string[];
  readonly overviewCalls: number;
}

function growthStub(): GrowthStub {
  const overview = deferred<readonly GrowthOverviewRow[] | null>();
  const expEvents = deferred<readonly GrowthExpEvent[] | null>();
  const recentTasks = deferred<readonly GrowthTaskInput[] | null>();
  const expEventsCalls: string[] = [];
  let overviewCalls = 0;
  const port: GrowthStatsPort = {
    overview: () => { overviewCalls += 1; return overview.promise; },
    expEvents: (characterId) => { expEventsCalls.push(characterId); return expEvents.promise; },
    recentTasks: () => recentTasks.promise,
  };
  return { port, overview, expEvents, recentTasks, expEventsCalls, get overviewCalls() { return overviewCalls; } } as GrowthStub;
}

function overviewRow(patch: Partial<GrowthOverviewRow> = {}): GrowthOverviewRow {
  return {
    characterId: 'c-neo',
    chatCount: 0,
    taskCount: 0,
    expEventCount: 0,
    lastActiveAt: null,
    createdAt: null,
    taskCounts: { queued: 0, running: 0, awaiting: 0, completed: 0, failed: 0, cancelled: 0 },
    ...patch,
  };
}

/** 微任务冲刷：deferred 放行 → then 链（forceRerender）→ 下一帧断言。 */
async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

interface Harness {
  readonly screen: StratCharacterScreenElement;
  unmount(): void;
}

function mountScreen(stub?: GrowthStub): Harness {
  const store = createStore(makeState());
  const themeController = createThemeController({ sources: { default: '', pixel: '' }, initial: 'default' });
  const commands: HudCommand[] = [];
  const adapter = createHudBusAdapter({
    themeController,
    onState: (handler) => store.subscribe(handler),
    emitCommand: (command) => { commands.push(command); },
  });
  const unmountAdapter = adapter.mount();
  const host = document.createElement('div');
  document.body.appendChild(host);
  const unmountScreen = mountCharacterScreen(
    { dispatch: (c) => adapter.dispatch(c), subscribe: (h) => adapter.subscribe(h) },
    host,
    stub ? { growth: stub.port } : {}
  );
  const screen = host.querySelector(CHARACTER_SCREEN_TAG) as StratCharacterScreenElement;
  if (!screen?.shadowRoot) throw new Error('角色屏未 upgrade');
  store.patch({}); // 首帧走真实广播链
  return { screen, unmount: () => { unmountScreen(); unmountAdapter(); host.remove(); } };
}

/* ------------------------------------------------------ 测试用 DOM 助手 —— */

function shadow(screen: StratCharacterScreenElement): ShadowRoot {
  if (!screen.shadowRoot) throw new Error('角色屏 shadowRoot 为空');
  return screen.shadowRoot;
}

function clickTab(screen: StratCharacterScreenElement, tab: string): void {
  shadow(screen)
    .querySelector(`[data-role="editor-tab"][data-tab="${tab}"]`)
    ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
}

function clickRank(screen: StratCharacterScreenElement, mode: string): void {
  shadow(screen)
    .querySelector(`[data-action="growth-rank"][data-mode="${mode}"]`)
    ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
}

function cardOrder(screen: StratCharacterScreenElement): string[] {
  return Array.from(shadow(screen).querySelectorAll('[data-group="cards"] [data-role="card"]')).map(
    (el) => el.getAttribute('data-character-id') ?? ''
  );
}

function queryAll(screen: StratCharacterScreenElement, selector: string): Element[] {
  return Array.from(shadow(screen).querySelectorAll(selector));
}

const NOW = Date.now();

/* ---------------------------------------------------------------- 测试 —— */

describe('成长 tab：渲染 / 空态 / 数据注入', () => {
  test('第四 tab「成长」在列；激活后四区块各给引导语（空数据准则，不空白）', () => {
    const { screen, unmount } = mountScreen();
    const tabs = queryAll(screen, '[data-role="editor-tab"]');
    expect(tabs.map((t) => t.getAttribute('data-tab'))).toEqual(['profile', 'persona', 'appearance', 'growth']);
    expect(tabs[3]!.textContent).toContain('成长');

    clickTab(screen, 'growth');
    expect(shadow(screen).querySelector('[data-tab-body="growth"]')).not.toBeNull();
    expect(shadow(screen).querySelector('[data-role="growth-curve-empty"]')?.textContent).toContain('还没有成长记录');
    expect(shadow(screen).querySelector('[data-role="growth-tasks-empty"]')?.textContent).toContain('还没有任务记录，派一个试试');
    expect(shadow(screen).querySelector('[data-role="growth-heat-empty"]')?.textContent).toContain('近 7 天暂无活动');
    expect(shadow(screen).querySelector('[data-role="growth-timeline-empty"]')?.textContent).toContain('暂无履历');
    unmount();
  });

  test('数据到达 → 曲线画布 / 六态分布条（零态不占位）/ 热力格 / 时间线就位', async () => {
    const stub = growthStub();
    const { screen, unmount } = mountScreen(stub);
    clickTab(screen, 'growth');

    // 数据放行：overview（含 c-neo 的六态 + 建档时刻）+ 事件（含升级里程碑）+ 终态任务。
    stub.overview.resolve([
      overviewRow({
        characterId: 'c-neo',
        chatCount: 3,
        taskCount: 5,
        expEventCount: 6,
        lastActiveAt: NOW - 5 * 60_000,
        createdAt: NOW - 3 * 86_400_000,
        taskCounts: { queued: 0, running: 1, awaiting: 0, completed: 2, failed: 1, cancelled: 0 },
      }),
      overviewRow({ characterId: 'c-morph' }),
    ]);
    stub.expEvents.resolve([
      { delta: 50, reason: 'task_completed', level: null, createdAt: NOW },
      { delta: 0, reason: 'level_up', level: 2, createdAt: NOW },
    ]);
    stub.recentTasks.resolve([{ prompt: '侦察北门', status: 'completed', endedAt: NOW - 3_600_000 }]);
    await flush();
    await flush();

    // 曲线：exp_events 非空 → 画布元素在（数据喂给 canvas 组件）。
    expect(shadow(screen).querySelector('[data-role="growth-chart"]')).not.toBeNull();
    expect(screen.growthDetailOf('c-neo')?.events).toHaveLength(2);
    expect(screen.growthDetailOf('c-neo')?.tasks).toHaveLength(1);

    // 分布条：非零态才占位（执行 1 / 完成 2 / 失败 1）。
    const segs = queryAll(screen, '[data-role="growth-task-dist"] [data-seg]');
    expect(segs.map((s) => s.getAttribute('data-seg'))).toEqual(['running', 'completed', 'failed']);
    expect(segs.find((s) => s.getAttribute('data-seg') === 'completed')?.textContent).toContain('完成 2');

    // 热力：今天两条事件 → 7 格、今天那格 data-count=2。
    const cells = queryAll(screen, '[data-role="growth-heat"] .heat-cell');
    expect(cells).toHaveLength(7);
    expect(cells[6]!.getAttribute('data-count')).toBe('2');

    // 时间线：建档 + 升级 + 任务三类合并（最新在前）。
    const kinds = queryAll(screen, '[data-role="growth-timeline"] .tl-entry').map(
      (e) => e.getAttribute('data-kind')
    );
    expect(kinds).toEqual(['levelUp', 'task', 'created']); // 升级在 NOW、任务在 NOW-1h、建档 3 天前
    expect(shadow(screen).querySelector('[data-role="growth-timeline"]')?.textContent).toContain('建档入列');
    expect(shadow(screen).querySelector('[data-role="growth-timeline"]')?.textContent).toContain('升到 Lv.2');
    expect(shadow(screen).querySelector('[data-role="growth-timeline"]')?.textContent).toContain('完成任务：侦察北门');

    // 快照观察口。
    expect(screen.growthOverviewRows).toHaveLength(2);
    unmount();
  });

  test('tab 重进重拉明细（打开看板 = 现取；停留期间复用缓存）', async () => {
    const stub = growthStub();
    const { screen, unmount } = mountScreen(stub);
    clickTab(screen, 'growth');
    stub.overview.resolve([]);
    stub.expEvents.resolve([]);
    stub.recentTasks.resolve([]);
    await flush();
    expect(stub.expEventsCalls).toEqual(['c-neo']);

    // 切走再切回：明细缓存清 → 重拉。
    clickTab(screen, 'profile');
    clickTab(screen, 'growth');
    await flush();
    expect(stub.expEventsCalls).toEqual(['c-neo', 'c-neo']);
    unmount();
  });
});

describe('全场总览排行', () => {
  test('缺省按等级降序；切「完成率」按终态比率重排；chip 的 data-active 跟随', async () => {
    const stub = growthStub();
    const { screen, unmount } = mountScreen(stub);
    expect(cardOrder(screen)).toEqual(['c-neo', 'c-morph']); // Lv.2 > Lv.1

    stub.overview.resolve([
      overviewRow({ characterId: 'c-neo', taskCounts: { queued: 0, running: 0, awaiting: 0, completed: 1, failed: 1, cancelled: 0 } }),
      overviewRow({ characterId: 'c-morph', taskCounts: { queued: 0, running: 0, awaiting: 0, completed: 2, failed: 0, cancelled: 0 }, lastActiveAt: NOW }),
    ]);
    await flush();
    await flush();

    clickRank(screen, 'successRate');
    expect(cardOrder(screen)).toEqual(['c-morph', 'c-neo']); // 100% > 50%
    expect(
      shadow(screen).querySelector('[data-action="growth-rank"][data-mode="successRate"]')?.getAttribute('data-active')
    ).toBe('true');

    clickRank(screen, 'activity');
    expect(cardOrder(screen)).toEqual(['c-morph', 'c-neo']); // c-neo lastActiveAt=null 垫底
    expect(screen.growthRankMode).toBe('activity');
    unmount();
  });

  test('卡面统计行：有行 → 计数 + 完成率 + 活跃文案（完成率 — 与未见活动可区分）', async () => {
    const stub = growthStub();
    const { screen, unmount } = mountScreen(stub);
    stub.overview.resolve([
      overviewRow({ characterId: 'c-neo', chatCount: 3, taskCount: 5, lastActiveAt: NOW - 5 * 60_000, taskCounts: { queued: 0, running: 0, awaiting: 0, completed: 3, failed: 1, cancelled: 1 } }),
      overviewRow({ characterId: 'c-morph' }),
    ]);
    await flush();
    await flush();

    const stats = queryAll(screen, '[data-role="card-stats"]').map((el) => el.textContent ?? '');
    expect(stats.find((s) => s.includes('对话 3'))).toContain('完成率 75%');
    expect(stats.find((s) => s.includes('对话 3'))).toContain('5 分钟前');
    // 无终态 / 无活动：不给 0% ——「完成率 —」「未见活动」可区分。
    expect(stats.find((s) => s.includes('c-morph') ? false : s.includes('完成率 —'))).toContain('完成率 —');
    expect(stats.some((s) => s.includes('未见活动'))).toBe(true);
    unmount();
  });
});

describe('统计行降级三档', () => {
  test('未接端口：「成长统计未接上」（tab 引导语照常）', () => {
    const { screen, unmount } = mountScreen();
    expect(shadow(screen).querySelector('[data-role="card-stats"]')?.textContent).toContain('成长统计未接上');
    unmount();
  });

  test('在途（未放行 overview）：「统计读取中…」', () => {
    const stub = growthStub();
    const { screen, unmount } = mountScreen(stub);
    expect(shadow(screen).querySelector('[data-role="card-stats"]')?.textContent).toContain('统计读取中');
    unmount();
  });

  test('端口持续返回 null（非 Electron / IPC 故障）：降级「成长统计未接上」，不拆屏', async () => {
    const stub = growthStub();
    const { screen, unmount } = mountScreen(stub);
    stub.overview.resolve(null);
    await flush();
    await flush();
    expect(shadow(screen).querySelector('[data-role="card-stats"]')?.textContent).toContain('成长统计未接上');
    // 屏的其余行为不受影响：tab 仍可切换。
    clickTab(screen, 'growth');
    expect(shadow(screen).querySelector('[data-tab-body="growth"]')).not.toBeNull();
    unmount();
  });
});
