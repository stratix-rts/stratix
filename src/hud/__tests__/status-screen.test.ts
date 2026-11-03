/**
 * 集成测试：状态屏（hud/screens/status-screen.ts + status-catalog.ts）。
 * 覆盖：WorldState → 指标卡/系统状态/最近事件的派生（纯函数）、Shadow DOM 渲染输出、
 *   导航 → ui.navigate、渲染签名判重（无关广播不重绘）、tick（运行时长/总线活跃度）、
 *   卸载退订与停表、以及装配进 main-screen 的真实订阅链。
 * @jest-environment jsdom
 */

import type {
  AgentLinkView,
  HudCommand,
  MissionPhase,
  MissionView,
  Notice,
  UnitStatus,
  UnitView,
  WorldState,
} from '../../core/types';

import {
  BUS_ACTIVE_THRESHOLD,
  MAX_BUS_SAMPLES,
  MAX_STATUS_EVENTS,
  formatDuration,
  pushBusSample,
  resolveConnection,
  resolveMetrics,
  resolveStatusEvents,
  resolveStatusModel,
  resolveUptime,
  statusSignature,
  summarizeBus,
} from '../screens/status-catalog';
import {
  STATUS_SCREEN_TAG,
  mountStatusScreen,
  type StatusScreenDeps,
  type StratStatusScreenElement,
} from '../screens/status-screen';
import type {
  GatewayConnectionState,
  GatewayLinkPort,
} from '../bridge/gateway-link-port';

import { createMainScreen } from '../screens/main-screen';

// ---------------------------------------------------------------------------
// 夹具
// ---------------------------------------------------------------------------

function unit(id: string, status: UnitStatus = 'idle'): UnitView {
  return { id, name: `单位-${id}`, status, missionId: null, power: 1 };
}

function mission(id: string, phase: MissionPhase): MissionView {
  return { id, title: `任务-${id}`, phase, unitIds: [], createdAt: 1_000 };
}

function link(id: string, phase: AgentLinkView['phase']): AgentLinkView {
  return {
    id,
    kind: 'openclaw',
    displayName: `会话-${id}`,
    phase,
    phaseReason: null,
    agentId: null,
    sessionId: null,
    endpoint: 'http://127.0.0.1:0000',
    connectedAt: null,
    lastError: null,
  };
}

function notice(patch: Partial<Notice> & { id: string }): Notice {
  return {
    level: 'info',
    text: `通知-${patch.id}`,
    createdAt: 10_000,
    expiresAt: 20_000,
    ...patch,
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

/** 构造态：一次覆盖四张卡与系统状态区的每个分支。 */
function busyState(): WorldState {
  return makeState({
    units: [unit('u1', 'idle'), unit('u2', 'busy'), unit('u3', 'error'), unit('u4', 'offline')],
    missions: [
      mission('m1', 'draft'),
      mission('m2', 'pending'),
      mission('m3', 'running'),
      mission('m4', 'done'),
      mission('m5', 'cancelled'),
    ],
    links: [link('l1', 'connected'), link('l2', 'connecting'), link('l3', 'closed')],
    notices: [notice({ id: 'n1', level: 'warn' }), notice({ id: 'n2', level: 'error' })],
  });
}

interface Harness {
  readonly screen: StratStatusScreenElement;
  readonly host: HTMLElement;
  readonly commands: HudCommand[];
  emit(state: WorldState): void;
  subscriberCount(): number;
  unmount(): void;
}

/** 造一个可手动翻转的网关连通性端口替身（@since v3.7，task_127）。 */
function fakeGateway(initial: GatewayConnectionState): {
  port: GatewayLinkPort;
  set: (next: GatewayConnectionState) => void;
} {
  let handler: ((state: GatewayConnectionState) => void) | null = null;
  let state = initial;
  const port: GatewayLinkPort = {
    get state() {
      return state;
    },
    subscribe(next) {
      handler = next;
      next(state);
      return () => {
        if (handler === next) handler = null;
      };
    },
    refresh: async () => state,
  };
  return {
    port,
    set: (next: GatewayConnectionState) => {
      state = next;
      handler?.(next);
    },
  };
}

function mountScreen(gateway: GatewayLinkPort | null = null): Harness {
  const commands: HudCommand[] = [];
  const subs = new Set<(state: WorldState) => void>();
  const deps: StatusScreenDeps = {
    dispatch: (command) => { commands.push(command); },
    subscribe: (handler) => {
      subs.add(handler);
      return () => { subs.delete(handler); };
    },
  };

  const host = document.createElement('div');
  document.body.appendChild(host);
  const unmountScreen = mountStatusScreen(deps, host, gateway);
  const screen = host.querySelector(STATUS_SCREEN_TAG) as StratStatusScreenElement;
  if (!screen?.shadowRoot) throw new Error('状态屏未 upgrade（shadowRoot 为空）');

  return {
    screen,
    host,
    commands,
    emit: (state) => { subs.forEach((handler) => handler(state)); },
    subscriberCount: () => subs.size,
    unmount: () => { unmountScreen(); host.remove(); },
  };
}

function metricEl(screen: StratStatusScreenElement, id: string): HTMLElement | null {
  return screen.shadowRoot?.querySelector<HTMLElement>(`[data-metric="${id}"]`) ?? null;
}

function metricValue(screen: StratStatusScreenElement, id: string): string | null {
  return metricEl(screen, id)?.querySelector('[data-role="metric-value"]')?.textContent ?? null;
}

function sysRow(screen: StratStatusScreenElement, id: string): HTMLElement | null {
  return screen.shadowRoot?.querySelector<HTMLElement>(`[data-sys="${id}"]`) ?? null;
}

function sysValue(screen: StratStatusScreenElement, id: string): string | null {
  return sysRow(screen, id)?.querySelector('[data-role="sys-value"]')?.textContent ?? null;
}

// ===========================================================================
// 派生（纯函数）
// ===========================================================================

describe('指标卡：与 WorldState 派生一致', () => {
  test('构造态下四张卡的数值与构成', () => {
    const metrics = resolveMetrics(busyState());

    // 单位总数 4：忙碌 1 / 异常 1 / 离线 1
    expect(metrics.units.value).toBe(4);
    expect(metrics.units.hint).toBe('忙碌 1 · 异常 1 · 离线 1');

    // 活跃任务 = 未收尾（draft/pending/running/done/cancelled 里只有 done+cancelled 排除）
    expect(metrics.missions.value).toBe(3);
    expect(metrics.missions.hint).toBe('在办 1 · 待确认 1 · 已完成 1');

    // 进行中会话 = connecting/connected/reconnecting（closed 不算）
    expect(metrics.sessions.value).toBe(2);
    expect(metrics.sessions.hint).toBe('已连接 1 · 连接中 1');

    // 未读通知 = core 仍持有的 notices
    expect(metrics.notices.value).toBe(2);
    expect(metrics.notices.hint).toBe('警告 1 · 错误 1');
  });

  test('全部单位空闲时不编造细分，直接说全部空闲', () => {
    const metrics = resolveMetrics(makeState({ units: [unit('a'), unit('b')] }));
    expect(metrics.units).toEqual({ id: 'units', label: '单位总数', value: 2, hint: '全部空闲' });
  });

  test('还没收到状态时全 0 且说明在等（不拿上一份数据冒充当前值）', () => {
    const metrics = resolveMetrics(null);
    expect([metrics.units, metrics.missions, metrics.sessions, metrics.notices].map((m) => m.value))
      .toEqual([0, 0, 0, 0]);
    expect(metrics.units.hint).toBe('等待世界状态');
    expect(metrics.notices.hint).toBe('等待世界状态');
  });

  test('无会话 / 无通知时如实说没有', () => {
    const metrics = resolveMetrics(makeState());
    expect(metrics.sessions.hint).toBe('暂无会话');
    expect(metrics.notices.hint).toBe('暂无通知');
  });
});

describe('系统状态：gateway 连接态三级（@since v3.7，task_127）', () => {
  test('在线 → 已连接（ok），说明「数据与实时通道均可用」', () => {
    const conn = resolveConnection('online');
    expect(conn.tone).toBe('ok');
    expect(conn.label).toBe('已连接');
    expect(conn.detail).toBe('数据与实时通道均可用');
    expect(conn.state).toBe('online');
  });

  test('降级 → 连接降级（warn），说明「数据可用，实时通道断开」—— 不出现「未连接」', () => {
    const conn = resolveConnection('degraded');
    expect(conn.tone).toBe('warn');
    expect(conn.label).toBe('连接降级');
    expect(conn.detail).toBe('数据可用，实时通道断开');
    expect(conn.label).not.toContain('未连接');
  });

  test('离线 → 未连接（error），说明「多数功能暂时没有数据」', () => {
    const conn = resolveConnection('offline');
    expect(conn.tone).toBe('error');
    expect(conn.label).toBe('未连接');
    expect(conn.detail).toBe('多数功能暂时没有数据');
  });

  test('没有会话 ≠ 网关没连（回归 task_127 的病根）：会话为空但网关在线 → 已连接', () => {
    // 会话相位已从这一行移出（它说的是网关连通性，不是会话数）。
    expect(resolveConnection('online').label).toBe('已连接');
  });

  test('未接入连通性探测 → 如实说「未探测」，不谎报在线', () => {
    expect(resolveConnection(null)).toMatchObject({ tone: 'idle', label: '未探测', state: null });
  });
});

describe('系统状态：总线活跃度与运行时长', () => {
  test('窗口内投递越多越活跃；窗口外的不算', () => {
    const now = 100 * 60_000;
    expect(summarizeBus([now - 5_000, now - 4_000], now)).toMatchObject({
      tone: 'ok',
      label: '正常',
      recentCount: 2,
    });
    expect(summarizeBus([now - 90_000], now).recentCount).toBe(0);
    expect(summarizeBus([], now)).toMatchObject({ tone: 'idle', label: '静默', recentCount: 0 });
  });

  test('达到阈值判活跃', () => {
    const now = 100 * 60_000;
    const samples = Array.from({ length: BUS_ACTIVE_THRESHOLD }, (_, i) => now - i);
    expect(summarizeBus(samples, now)).toMatchObject({ tone: 'busy', label: '活跃' });
  });

  test('样本环形封顶：记忆本身不许随运行时长无限涨', () => {
    let samples: readonly number[] = [];
    for (let i = 0; i < MAX_BUS_SAMPLES + 50; i += 1) samples = pushBusSample(samples, i);
    expect(samples).toHaveLength(MAX_BUS_SAMPLES);
    expect(samples[samples.length - 1]).toBe(MAX_BUS_SAMPLES + 49);
    expect(samples[0]).toBe(50); // 最旧的被丢掉
  });

  test('时长格式化：小时/分/秒三档；非法输入回落 --', () => {
    expect(formatDuration(0)).toBe('0 秒');
    expect(formatDuration(5_000)).toBe('5 秒');
    expect(formatDuration(65_000)).toBe('1 分 05 秒');
    expect(formatDuration(3 * 3_600_000 + 2 * 60_000)).toBe('3 小时 02 分');
    expect(formatDuration(-1)).toBe('--');
    expect(formatDuration(Number.NaN)).toBe('--');
  });

  test('运行时长 = 首次观测起算；还没收到状态时如实 --', () => {
    expect(resolveUptime(null, 1000)).toMatchObject({ value: '--', ms: 0 });
    expect(resolveUptime(1_000, 66_000).value).toBe('1 分 05 秒');
    expect(resolveUptime(1_000, 66_000).ms).toBe(65_000);
  });
});

describe('最近事件：与 log-drawer 同源的 notices（紧凑形态）', () => {
  test('倒序（最新在前）+ 截断到 MAX_STATUS_EVENTS，total 如实报未截断数', () => {
    const notices = Array.from({ length: MAX_STATUS_EVENTS + 3 }, (_, i) =>
      notice({ id: `n${i}`, createdAt: 1_000 + i }),
    );
    const events = resolveStatusEvents(makeState({ notices }));

    expect(events.total).toBe(MAX_STATUS_EVENTS + 3);
    expect(events.rows).toHaveLength(MAX_STATUS_EVENTS);
    expect(events.rows[0].id).toBe(`n${MAX_STATUS_EVENTS + 2}`);
    expect(events.rows[MAX_STATUS_EVENTS - 1].id).toBe('n3');
  });

  test('source 未标注时回落通用来源文案（不编造来源）；标注了就念标注的', () => {
    const events = resolveStatusEvents(makeState({
      notices: [notice({ id: 'a' }), notice({ id: 'b', source: 'core/mission' })],
    }));
    expect(events.rows.find((r) => r.id === 'a')?.source).toBe('通知');
    expect(events.rows.find((r) => r.id === 'b')?.source).toBe('core/mission');
  });

  test('级别沿用 log-catalog 的中文词表（两侧同一份，不各写一套）', () => {
    const events = resolveStatusEvents(makeState({
      notices: [notice({ id: 'a', level: 'warn' }), notice({ id: 'b', level: 'error' })],
    }));
    expect(events.rows.find((r) => r.id === 'a')?.levelLabel).toBe('警告');
    expect(events.rows.find((r) => r.id === 'b')?.levelLabel).toBe('错误');
  });

  test('没有通知就是空数组（不造占位事件）', () => {
    expect(resolveStatusEvents(makeState())).toEqual({ rows: [], total: 0 });
  });
});

describe('渲染签名：与显示无关的广播不重绘', () => {
  test('选择集 / 角色 / 消息 / 偏好变化不改签名', () => {
    const base = busyState();
    const noise = makeState({
      ...base,
      selection: { unitIds: ['u1'], previewUnitIds: [], revision: 9 },
      characters: [{ id: 'c1', name: 'A', persona: 'p', level: 2, experience: 10 }],
      messages: [{ id: 'm', linkId: 'l1', direction: 'inbound', author: 'a', text: 't', at: 1 }],
      settings: { soundEnabled: false, notificationsEnabled: true },
    });
    expect(statusSignature(base)).toBe(statusSignature(noise));
  });

  test('单位状态 / 任务相位 / 会话相位 / 通知任一变化都改签名', () => {
    const base = busyState();
    expect(statusSignature(base)).not.toBe(
      statusSignature(makeState({ ...base, units: [unit('u1', 'busy'), unit('u2', 'busy'), unit('u3', 'error'), unit('u4', 'offline')] })),
    );
    expect(statusSignature(base)).not.toBe(
      statusSignature(makeState({ ...base, missions: [mission('m1', 'done')] })),
    );
    expect(statusSignature(base)).not.toBe(
      statusSignature(makeState({ ...base, links: [link('l1', 'error'), link('l2', 'connecting'), link('l3', 'closed')] })),
    );
    expect(statusSignature(base)).not.toBe(
      statusSignature(makeState({ ...base, notices: [notice({ id: 'n1', level: 'warn' })] })),
    );
    expect(statusSignature(null)).toBe('none');
  });
});

describe('resolveStatusModel：组装', () => {
  test('把 state + 观测量拼成一份模型', () => {
    const now = 10_000_000;
    const model = resolveStatusModel(busyState(), now, [now - 1_000], now - 65_000, 'online');

    expect(model.metrics.missions.value).toBe(3);
    expect(model.connection.label).toBe('已连接');
    expect(model.connection.state).toBe('online');
    expect(model.bus.detail).toBe('最近 60 秒更新 1 次');
    expect(model.uptime.value).toBe('1 分 05 秒');
    expect(model.events.total).toBe(2);
  });
});

// ===========================================================================
// 组件：渲染与派发
// ===========================================================================

describe('状态屏：Shadow DOM 渲染', () => {
  let h: Harness;
  afterEach(() => h?.unmount());

  test('四张指标卡的渲染输出与构造态 WorldState 一致', () => {
    h = mountScreen();
    h.emit(busyState());

    expect(metricValue(h.screen, 'units')).toBe('4');
    expect(metricValue(h.screen, 'missions')).toBe('3');
    expect(metricValue(h.screen, 'sessions')).toBe('2');
    expect(metricValue(h.screen, 'notices')).toBe('2');

    // 标签 + 细分构成也一并渲染（不是只有数字）
    expect(metricEl(h.screen, 'missions')?.querySelector('[data-role="metric-label"]')?.textContent)
      .toBe('活跃任务');
    expect(metricEl(h.screen, 'missions')?.querySelector('[data-role="metric-hint"]')?.textContent)
      .toBe('在办 1 · 待确认 1 · 已完成 1');
    // DOM 上的 data-value 与模型一致（单测按属性断言，避免只看文案）
    expect(metricEl(h.screen, 'units')?.getAttribute('data-value')).toBe('4');
    expect(h.screen.model.metrics.units.value).toBe(4);
  });

  test('核心状态变化后卡片自己跟着换（不本地改数，等 core 回广播）', () => {
    h = mountScreen();
    h.emit(makeState({ units: [unit('u1')] }));
    expect(metricValue(h.screen, 'units')).toBe('1');

    h.emit(makeState({ units: [unit('u1'), unit('u2', 'busy')] }));
    expect(metricValue(h.screen, 'units')).toBe('2');
    expect(metricEl(h.screen, 'units')?.querySelector('[data-role="metric-hint"]')?.textContent)
      .toBe('忙碌 1');
  });

  test('系统状态区渲染网关连接态：三级态的标签 + 说明（@since v3.7，task_127）', () => {
    const gateway = fakeGateway('online');
    h = mountScreen(gateway.port);
    h.emit(makeState());

    expect(sysValue(h.screen, 'connection')).toBe('已连接');
    expect(sysRow(h.screen, 'connection')?.getAttribute('data-tone')).toBe('ok');
    expect(sysRow(h.screen, 'connection')?.querySelector('[data-role="sys-detail"]')?.textContent)
      .toBe('数据与实时通道均可用');
  });

  test('连通性变降级 → 只重画连接行（横幅与这一行同一真相源）', () => {
    const gateway = fakeGateway('online');
    h = mountScreen(gateway.port);
    h.emit(makeState());
    gateway.set('degraded');

    expect(sysValue(h.screen, 'connection')).toBe('连接降级');
    expect(sysRow(h.screen, 'connection')?.getAttribute('data-tone')).toBe('warn');
    expect(sysRow(h.screen, 'connection')?.querySelector('[data-role="sys-detail"]')?.textContent)
      .toBe('数据可用，实时通道断开');
  });

  test('没有会话但网关在线 → 不再显示「未连接」（task_127 的病根）', () => {
    const gateway = fakeGateway('online');
    h = mountScreen(gateway.port);
    h.emit(makeState({ links: [] }));

    expect(sysValue(h.screen, 'connection')).toBe('已连接');
  });

  test('系统状态区有系统心跳与运行时长两项（task_122：文案不出现架构词）', () => {
    h = mountScreen();
    h.emit(makeState());

    expect(sysValue(h.screen, 'bus')).toBe('正常');
    expect(sysRow(h.screen, 'bus')?.querySelector('[data-role="sys-detail"]')?.textContent)
      .toContain('更新');
    expect(sysRow(h.screen, 'bus')?.querySelector('[data-role="sys-detail"]')?.textContent)
      .not.toContain('投递');
    expect(sysValue(h.screen, 'uptime')).toBe('0 秒');
  });

  test('最近事件渲染成行（时间/级别/来源/正文），并报出被截断的更早条数', () => {
    h = mountScreen();
    const notices = Array.from({ length: MAX_STATUS_EVENTS + 2 }, (_, i) =>
      notice({ id: `n${i}`, createdAt: 1_000 + i, text: `事件-${i}`, level: 'warn', source: 'core/mission' }),
    );
    h.emit(makeState({ notices }));

    const rows = h.screen.shadowRoot?.querySelectorAll('[data-event]') ?? [];
    expect(rows).toHaveLength(MAX_STATUS_EVENTS);
    expect(rows[0].getAttribute('data-level')).toBe('warn');
    expect(rows[0].querySelector('[data-role="event-text"]')?.textContent).toBe(`事件-${MAX_STATUS_EVENTS + 1}`);
    expect(rows[0].querySelector('[data-role="event-source"]')?.textContent).toBe('core/mission');
    expect(rows[0].querySelector('[data-role="event-level"]')?.textContent).toBe('警告');
    expect(h.screen.shadowRoot?.querySelector('[data-role="truncated"]')?.textContent).toContain('另有 2 条');
  });

  test('没有事件时给引导文案，不是一块白板', () => {
    h = mountScreen();
    h.emit(makeState());
    expect(h.screen.shadowRoot?.querySelector('[data-role="empty"]')?.textContent).toBe('暂无事件');
  });

  test('通知正文含标签时被转义（外部输入不进 innerHTML）', () => {
    h = mountScreen();
    h.emit(makeState({ notices: [notice({ id: 'x', text: '<img src=x onerror=alert(1)>' })] }));

    const row = h.screen.shadowRoot?.querySelector('[data-event="x"]');
    expect(row?.querySelector('img')).toBeNull();
    expect(row?.querySelector('[data-role="event-text"]')?.textContent).toBe('<img src=x onerror=alert(1)>');
  });

  test('导航点击 → ui.navigate(settings) / ui.navigate(chat)，且不发任何其他命令', () => {
    h = mountScreen();
    h.emit(makeState());

    // 点 strat-button 内部那枚 <button>（按钮把自己的 click 包成 strat-button-click 抛给宿主）
    const navBtn = (target: string): HTMLButtonElement => {
      const host = h.screen.shadowRoot?.querySelector<HTMLElement>(`strat-button[data-nav="${target}"]`);
      const btn = host?.shadowRoot?.querySelector<HTMLButtonElement>('button');
      if (!btn) throw new Error(`导航按钮未渲染: ${target}`);
      return btn;
    };
    navBtn('chat').click();
    navBtn('settings').click();

    expect(h.commands).toEqual([
      { type: 'ui.navigate', screen: 'chat' },
      { type: 'ui.navigate', screen: 'settings' },
    ]);
  });

  test('同状态重复广播不重绘卡片（签名判重），但总线活跃度照常更新', () => {
    h = mountScreen();
    const state = makeState({ units: [unit('u1')] });
    h.emit(state);
    const metricsBefore = h.screen.shadowRoot?.querySelector('[data-role="metrics"]')?.firstElementChild;

    for (let i = 0; i < BUS_ACTIVE_THRESHOLD; i += 1) h.emit(state);

    const metricsAfter = h.screen.shadowRoot?.querySelector('[data-role="metrics"]')?.firstElementChild;
    expect(metricsAfter).toBe(metricsBefore); // 同一节点 = 没重画
    expect(sysValue(h.screen, 'bus')).toBe('活跃');
  });

  test('卸载后退订（反复挂卸不累积监听器）', () => {
    h = mountScreen();
    expect(h.subscriberCount()).toBe(1);
    h.unmount();
    expect(h.subscriberCount()).toBe(0);
    h = undefined as unknown as Harness;
  });
});

describe('tick：运行时长与总线活跃度按秒自走', () => {
  let h: Harness;
  beforeEach(() => { jest.useFakeTimers(); });
  afterEach(() => {
    h?.unmount();
    jest.useRealTimers();
  });

  test('运行时长随时间推进（两次投递之间世界不动，这一项照样走）', () => {
    h = mountScreen();
    h.emit(makeState());
    expect(sysValue(h.screen, 'uptime')).toBe('0 秒');

    jest.advanceTimersByTime(5_000);
    expect(sysValue(h.screen, 'uptime')).toBe('5 秒');

    jest.advanceTimersByTime(65_000);
    expect(sysValue(h.screen, 'uptime')).toBe('1 分 10 秒');
  });

  test('卸载后定时器清零（不留后台 tick）', () => {
    h = mountScreen();
    h.emit(makeState());
    expect(jest.getTimerCount()).toBeGreaterThan(0);

    h.unmount();
    expect(jest.getTimerCount()).toBe(0);
    h = undefined as unknown as Harness;
  });
});

// ===========================================================================
// 装配进 main-screen
// ===========================================================================

describe('装配进 main-screen', () => {
  test('主屏挂上状态屏，走真实订阅链渲染，并在卸载时随之退订', () => {
    const commands: HudCommand[] = [];
    const subs = new Set<(state: WorldState) => void>();
    const adapter = {
      dispatch: (command: HudCommand) => { commands.push(command); },
      subscribe: (handler: (state: WorldState) => void) => {
        subs.add(handler);
        return () => { subs.delete(handler); };
      },
      mount: () => () => { /* 本用例不关心 core 订阅 */ },
      latest: null,
      // 皮肤真相（@since task_115）：主屏要读当前皮肤，装配用的假 adapter 也要给一份。
      themeId: 'default' as const,
      subscribeTheme: () => () => undefined,
    };

    const host = document.createElement('div');
    document.body.appendChild(host);
    // 连通性端口经主屏注入（与全局横幅同一份真相源 —— task_127）。
    const gateway = fakeGateway('online');
    const unmount = createMainScreen(adapter, { gateway: gateway.port }).mount(host);

    const screen = host.querySelector(STATUS_SCREEN_TAG) as StratStatusScreenElement;
    if (!screen?.shadowRoot) throw new Error('主屏未挂上状态屏');

    subs.forEach((handler) => handler(busyState()));
    expect(metricValue(screen, 'units')).toBe('4');
    expect(sysValue(screen, 'connection')).toBe('已连接');
    gateway.set('offline');
    expect(sysValue(screen, 'connection')).toBe('未连接');

    unmount();
    host.remove();
    expect(subs.size).toBe(0); // 主屏卸载 → 状态屏随之退订
    expect(commands).toHaveLength(0); // 纯展示：不发业务命令
  });
});