/**
 * 单测：单位联动事件的**两段式总线闭环**（core/runtime.ts，@since v3.4，task_091）。
 * 覆盖：
 *   - hud → core：`focus.unit` 命令（HUD 事件轨条目点击）→ core **只转发**，
 *     以同名 WorldEvent 发到 world 通道（消费者是世界层 task_092：描边高亮 + 引导弧线）；
 *   - core 不写 WorldState（联动是瞬态表现，同 camera.shake 口径）；
 *   - world 通道回环的 focus.unit 被显式接地（不进 onUnhandled —— 否则每次点击报一次噪音）。
 *
 * 打的是真实 core/bus 单例 + 真实 store（隔离靠 resetBus），不 mock 总线。
 */

import { emitCommand, onState, onWorldEvent, resetBus, type Unsubscribe } from '../bus';
import { createCoreRuntime, type CoreRuntime, type UnhandledChannel } from '../runtime';
import { createStore, type CoreStore } from '../store';
import type { WorldEvent, WorldState } from '../types';

interface Harness {
  runtime: CoreRuntime;
  store: CoreStore;
  states: WorldState[];
  events: WorldEvent[];
  unhandled: { channel: UnhandledChannel; type: string }[];
  stop: () => void;
}

function harness(): Harness {
  const store = createStore();
  const states: WorldState[] = [];
  const events: WorldEvent[] = [];
  const unhandled: { channel: UnhandledChannel; type: string }[] = [];
  const offState: Unsubscribe = onState((state) => states.push(state));
  const offEvent: Unsubscribe = onWorldEvent((event) => events.push(event));
  const runtime = createCoreRuntime({
    store,
    onUnhandled: (channel, payload) => unhandled.push({ channel, type: payload.type }),
  });
  const stop = runtime.start();
  return {
    runtime,
    store,
    states,
    events,
    unhandled,
    stop: () => { stop(); offState(); offEvent(); },
  };
}

let cleanups: (() => void)[] = [];

beforeEach(() => {
  resetBus();
  cleanups = [];
});

afterEach(() => {
  cleanups.forEach((fn) => fn());
  cleanups = [];
  resetBus();
});

describe('focus.unit：hud → core → world', () => {
  test('命令以同名 WorldEvent 转发到 world 通道（带单位 id）', () => {
    const { events, stop } = harness();
    cleanups.push(stop);

    emitCommand({ type: 'focus.unit', unitId: 'u-neo' });

    const focusEvents = events.filter((event) => event.type === 'focus.unit');
    expect(focusEvents).toHaveLength(1);
    expect(focusEvents[0]).toEqual({ type: 'focus.unit', unitId: 'u-neo' });
  });

  test('不写 WorldState（联动是瞬态表现，同 camera.shake 口径）', () => {
    const { store, states, stop } = harness();
    cleanups.push(stop);

    emitCommand({ type: 'focus.unit', unitId: 'u-neo' });

    expect(states).toHaveLength(0);
    expect(JSON.stringify(store.getState())).not.toContain('u-neo');
  });

  test('world 通道回环的 focus.unit 被显式接地（不进 onUnhandled）', () => {
    const { unhandled, stop } = harness();
    cleanups.push(stop);

    emitCommand({ type: 'focus.unit', unitId: 'u-neo' });

    expect(unhandled).toHaveLength(0);
  });
});
