/**
 * 集成测试：当日回放（task_082）—— 纯逻辑层（replay-catalog）+ 控制器（replay-controller）
 *   + 底部时间轴组件（day-replay）。
 * 覆盖：单位密度热力条分桶 / 60 秒压缩节奏 / 条目封顶 / 拖动定位重演 / 60 秒模式推进 /
 *   空态与按钮禁用 / 组件交互（拖动 seek、按钮 play-stop）。
 * @jest-environment jsdom
 */

import { REPLAY_METRICS } from '../../core/theme/visual-spec';
import type { ReplayBeat } from '../../core/types';
import {
  capReplayEntries,
  formatReplayClock,
  formatReplayDate,
  replayEntryText,
  replayGapMs,
  replayHeatBuckets,
  replayRatio,
  replaySpan,
  replayTimeAt,
  REPLAY_EMPTY_TEXT,
  REPLAY_ERROR_TEXT,
  type DayReplayEntry,
} from '../components/replay/replay-catalog';
import { createReplayController, type ReplayTimers } from '../components/replay/replay-controller';
import { mountDayReplay, type StratDayReplayElement } from '../components/replay/day-replay';
import { mountReplayClock } from '../components/replay/replay-clock';

/** 造一条回放条目。 */
function entry(partial: Partial<DayReplayEntry> & { at?: number }): DayReplayEntry {
  return {
    at: 0,
    kind: 'work',
    characterId: 'char-1',
    taskId: 'task-1',
    label: '干活中',
    sessionId: 's-1',
    ...partial,
  };
}

// ============================================================================
// 纯逻辑层
// ============================================================================

describe('时间轴活跃时段与比例', () => {
  test('没有条目 → 没有时段（空态不画条）', () => {
    expect(replaySpan([])).toBeNull();
  });

  test('首末事件之间 + 两端各留一分钟余量', () => {
    const span = replaySpan([entry({ at: 1_000_000 }), entry({ at: 3_000_000 })]);
    expect(span).toEqual({ from: 940_000, to: 3_060_000 });
  });

  test('比例与时刻互为反函数（拖动定位的数学底座）', () => {
    const span = { from: 0, to: 1000 };
    expect(replayRatio(250, span)).toBeCloseTo(0.25);
    expect(replayTimeAt(0.25, span)).toBe(250);
  });

  test('比例越界夹住（拖到最右端就是最后一刻）', () => {
    const span = { from: 0, to: 1000 };
    expect(replayRatio(-50, span)).toBe(0);
    expect(replayRatio(5000, span)).toBe(1);
    expect(replayTimeAt(3, span)).toBe(1000);
  });
});

describe('单位密度热力条', () => {
  test('每桶统计的是「在场过的角色数」，不是事件条数', () => {
    const span = { from: 0, to: 100 };
    const buckets = replayHeatBuckets(
      [
        entry({ at: 10, characterId: 'a' }),
        entry({ at: 12, characterId: 'a' }),
        entry({ at: 14, characterId: 'b' }),
      ],
      span,
      10
    );
    // 第 1 桶（10% 处）有 a / b 两个人 → 2；同一角色的多条事件只算一次。
    expect(buckets[1]).toBe(2);
    expect(buckets.reduce((sum, value) => sum + value, 0)).toBe(2);
  });

  test('桶数固定（规格钦定 96 桶）', () => {
    const buckets = replayHeatBuckets([entry({ at: 0 })], { from: 0, to: 1000 }, REPLAY_METRICS.heatBuckets);
    expect(buckets).toHaveLength(REPLAY_METRICS.heatBuckets);
  });
});

describe('60 秒模式的压缩节奏', () => {
  test('事件少 → 间隔顶到上限 2s', () => {
    expect(replayGapMs(1)).toBe(REPLAY_METRICS.maxEventGapMs);
    expect(replayGapMs(10)).toBe(REPLAY_METRICS.maxEventGapMs);
  });

  test('事件多 → 间隔压到下限 0.5s', () => {
    expect(replayGapMs(1000)).toBe(REPLAY_METRICS.minEventGapMs);
  });

  test('中间档按 60 秒目标摊分', () => {
    expect(replayGapMs(60)).toBe(1000);
  });

  test('没有事件 → 不给间隔（不演）', () => {
    expect(replayGapMs(0)).toBe(REPLAY_METRICS.maxEventGapMs);
  });
});

describe('条目封顶与文案', () => {
  test('超过上限只留最新的那些', () => {
    const entries = Array.from({ length: 10 }, (_, index) => entry({ at: index }));
    const capped = capReplayEntries(entries, 3);
    expect(capped).toHaveLength(3);
    expect(capped[2]?.at).toBe(9);
  });

  test('时间戳按本地时区格式化', () => {
    const at = new Date(2026, 0, 2, 3, 4, 5).getTime();
    expect(formatReplayClock(at)).toBe('03:04:05');
    expect(formatReplayDate(at)).toBe('1月2日');
  });

  test('短句带上角色名与任务名', () => {
    const text = replayEntryText(entry({ kind: 'done', label: '侦察北门' }), '阿青');
    expect(text).toContain('阿青');
    expect(text).toContain('侦察北门');
  });
});

// ============================================================================
// 控制器
// ============================================================================

/** 假定时器（手动推进；单测里不靠真实等待）。 */
function fakeTimers(): ReplayTimers & { advance: (ms: number) => void; pending: () => number } {
  const handlers = new Map<number, { readonly fn: () => void; readonly due: number }>();
  let nextHandle = 1;
  let now = 0;
  return {
    setTimeout(handler: () => void, delayMs: number): number {
      const handle = nextHandle;
      nextHandle += 1;
      handlers.set(handle, { fn: handler, due: now + delayMs });
      return handle;
    },
    clearTimeout(handle: number): void {
      handlers.delete(handle);
    },
    advance(ms: number): void {
      const target = now + ms;
      // 反复取「最早到期且不晚于 target」的定时器 —— 链式定时器也能被一次推进走完。
      for (;;) {
        let bestHandle = -1;
        let bestDue = Number.POSITIVE_INFINITY;
        for (const [handle, timer] of handlers) {
          if (timer.due <= target && timer.due < bestDue) {
            bestHandle = handle;
            bestDue = timer.due;
          }
        }
        if (bestHandle < 0) break;
        const timer = handlers.get(bestHandle);
        handlers.delete(bestHandle);
        if (!timer) break;
        now = timer.due;
        timer.fn();
      }
      now = target;
    },
    pending: () => handlers.size,
  };
}

describe('回放控制器', () => {
  const entries = [
    entry({ at: 1000, kind: 'spawn', characterId: 'a' }),
    entry({ at: 2000, kind: 'work', characterId: 'a' }),
    entry({ at: 3000, kind: 'done', characterId: 'a' }),
  ];

  const makeController = (overrides: Partial<Parameters<typeof createReplayController>[0]> = {}) => {
    const beats: ReplayBeat[] = [];
    const clock: (number | null)[] = [];
    const timers = fakeTimers();
    const controller = createReplayController({
      port: { loadDay: async () => entries },
      emitBeat: (beat) => beats.push(beat),
      setClock: (at) => clock.push(at),
      timers,
      ...overrides,
    });
    return { controller, beats, clock, timers };
  };

  test('读不到数据就是空数组（不编数据）', async () => {
    const { controller } = makeController({ port: { loadDay: async () => { throw new Error('boom'); } } });
    await expect(controller.load()).resolves.toBe(0);
    expect(controller.state.entries).toHaveLength(0);
    // 读不到 ≠ 今天没活儿 —— 状态里要能分辨（UI 据此换文案）。
    expect(controller.state.failed).toBe(true);
    expect(controller.state.loaded).toBe(false);
  });

  test('读成功 → failed 复位（失败过一次不代表永远失败）', async () => {
    const { controller } = makeController();
    await controller.load();
    expect(controller.state.failed).toBe(false);
    expect(controller.state.loaded).toBe(true);
  });

  test('load 之后条目按时刻升序', async () => {
    const { controller } = makeController();
    await controller.load();
    expect(controller.state.entries.map((item) => item.at)).toEqual([1000, 2000, 3000]);
    expect(controller.state.loaded).toBe(true);
  });

  test('拖动定位：先发一拍 reset，再重演那一刻之前的节拍', async () => {
    const { controller, beats, clock } = makeController();
    await controller.load();
    controller.seek(2500);
    expect(beats[0]).toMatchObject({ kind: 'reset' });
    expect(beats.slice(1).map((beat) => beat.kind)).toEqual(['spawn', 'work']);
    expect(clock[clock.length - 1]).toBe(2500);
  });

  test('60 秒模式：逐拍推进 + 角标跳时刻（镜头由 world 侧随节拍自己跟）', async () => {
    const { controller, beats, clock, timers } = makeController();
    await controller.load();
    controller.play();
    expect(controller.state.playing).toBe(true);
    expect(beats[0]).toMatchObject({ kind: 'reset' });
    // 3 条事件 → 间隔夹到上限 2s；推进 10s 足够把三条都演完并收尾。
    timers.advance(10_000);
    expect(beats.filter((beat) => beat.kind !== 'reset')).toHaveLength(3);
    // 每拍都带着「谁 / 做了什么 / 什么时候」——战场据此重演（化身 + 镜头 + 半频气泡）。
    expect(beats[1]).toMatchObject({ kind: 'spawn', characterId: 'a', at: 1000 });
    expect(beats[3]).toMatchObject({ kind: 'done', characterId: 'a', at: 3000 });
    // 角标跳到那一刻。
    expect(clock).toContain(3000);
    expect(controller.state.playing).toBe(false);
  });

  test('停播会清掉未触发的定时器（资源必须可清理）', async () => {
    const { controller, timers } = makeController();
    await controller.load();
    controller.play();
    expect(timers.pending()).toBe(1);
    controller.stop();
    expect(timers.pending()).toBe(0);
    expect(controller.state.playing).toBe(false);
  });

  test('dispose 收角标并退订', async () => {
    const { controller, clock } = makeController();
    await controller.load();
    const handler = jest.fn();
    controller.subscribe(handler);
    controller.dispose();
    expect(clock[clock.length - 1]).toBeNull();
    controller.seek(1000);
    // 退订后不再有回调（handler 在订阅时已被调用过一次）。
    expect(handler).toHaveBeenCalledTimes(1);
  });
});

// ============================================================================
// 组件（底栏 scrubber + 左上角角标）
// ============================================================================

describe('底部时间轴组件', () => {
  const mountWith = (entries: readonly DayReplayEntry[]) => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const beats: ReplayBeat[] = [];
    const controller = createReplayController({
      port: { loadDay: async () => entries },
      emitBeat: (beat) => beats.push(beat),
      setClock: () => undefined,
    });
    const mounted = mountDayReplay(host, { controller });
    return { host, mounted, controller, beats };
  };

  test('没有数据 → 显示空态，按钮禁用', () => {
    const { host, mounted } = mountWith([]);
    const element = mounted.element as StratDayReplayElement;
    const shadow = element.shadowRoot;
    const empty = shadow?.querySelector('[data-role="empty"]') as HTMLElement;
    const button = shadow?.querySelector('[data-role="play"]') as HTMLButtonElement;
    expect(empty.hidden).toBe(false);
    expect(empty.textContent).toBe(REPLAY_EMPTY_TEXT);
    expect(button.disabled).toBe(true);
    host.remove();
  });

  test('读失败 → 显示「读不到」的文案（不装作今天没活儿）', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const controller = createReplayController({
      port: { loadDay: async () => { throw new Error('读取当日回放失败'); } },
      emitBeat: () => undefined,
      setClock: () => undefined,
    });
    const mounted = mountDayReplay(host, { controller });
    await controller.load();
    const empty = mounted.element.shadowRoot?.querySelector('[data-role="empty"]') as HTMLElement;
    expect(empty.textContent).toBe(REPLAY_ERROR_TEXT);
    host.remove();
  });

  test('有数据 → 画热力条，按钮可点', async () => {
    const { host, mounted, controller } = mountWith([
      entry({ at: 1000, characterId: 'a' }),
      entry({ at: 2000, characterId: 'b' }),
    ]);
    await controller.load();
    const shadow = mounted.element.shadowRoot;
    const bars = shadow?.querySelectorAll('.bar') ?? [];
    expect(bars.length).toBe(REPLAY_METRICS.heatBuckets);
    const button = shadow?.querySelector('[data-role="play"]') as HTMLButtonElement;
    expect(button.disabled).toBe(false);
    expect(button.textContent).toContain('60 秒看完今天');
    host.remove();
  });

  test('拖动 scrubber → 定位到对应时刻', async () => {
    const { host, mounted, controller, beats } = mountWith([
      entry({ at: 1000, characterId: 'a' }),
      entry({ at: 2000, characterId: 'b' }),
    ]);
    await controller.load();
    const shadow = mounted.element.shadowRoot;
    const strip = shadow?.querySelector('[data-role="strip"]') as HTMLElement;
    // jsdom 没有布局：手工给一条 0..100 的宽度。
    strip.getBoundingClientRect = () =>
      ({ left: 0, width: 100, right: 100, top: 0, bottom: 30, height: 30, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
    strip.dispatchEvent(new MouseEvent('pointerdown', { clientX: 80, bubbles: true }));
    expect(beats[0]?.kind).toBe('reset');
    // 80% 的位置 → 那一刻之前的节拍都要重演。
    const replayed = beats.filter((beat) => beat.kind !== 'reset').length;
    expect(replayed).toBeGreaterThan(0);
    host.remove();
  });
});

describe('左上角时间戳角标', () => {
  test('给时刻就显示，给 null 就隐藏', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const { element } = mountReplayClock(host);
    const at = new Date(2026, 0, 2, 3, 4, 5).getTime();
    element.setTime(at);
    expect(element.currentAt).toBe(at);
    expect(element.visible).toBe(true);
    const badge = element.shadowRoot?.querySelector('[data-role="badge"]') as HTMLElement;
    expect(badge.dataset.on).toBe('1');
    element.setTime(null);
    expect(element.visible).toBe(false);
    expect(badge.dataset.on).toBe('0');
    host.remove();
  });
});
