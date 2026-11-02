/**
 * 单测：导演模式的总线闭环（core/runtime.ts + core/store.ts，@since v3.3，task_081）。
 * 覆盖两段式契约：
 *   - hud → core：`camera.director` 命令 → core 写 WorldState.directorEnabled（按钮回显的真相）
 *     并以同名 WorldEvent 转发到 world 通道；
 *   - world → core：手动介入时 world 发 `camera.director{false}` → core 把状态写回 false
 *     （手动优先，导演让位）。
 *
 * 打的是真实 core/bus 单例 + 真实 store（隔离靠 resetBus），不 mock 总线。
 */

import { emitCommand, emitWorldEvent, onState, onWorldEvent, resetBus, type Unsubscribe } from '../bus';
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

describe('导演模式开关：hud → core → world', () => {
  test('命令写入状态并广播（HUD 按钮据此回显）', () => {
    const { store, states, stop } = harness();
    cleanups.push(stop);

    emitCommand({ type: 'camera.director', enabled: true });

    expect(store.getState().directorEnabled).toBe(true);
    expect(states).toHaveLength(1);
    expect(states[0].directorEnabled).toBe(true);
  });

  test('命令以同名 WorldEvent 转发到 world 通道（world 侧导演控制器接管镜头）', () => {
    const { events, stop } = harness();
    cleanups.push(stop);

    emitCommand({ type: 'camera.director', enabled: true });

    const directorEvents = events.filter((event) => event.type === 'camera.director');
    expect(directorEvents).toHaveLength(1);
    expect(directorEvents[0]).toEqual({ type: 'camera.director', enabled: true });
  });

  test('重复同值命令不重复广播（引用未变即不广播）', () => {
    const { states, stop } = harness();
    cleanups.push(stop);

    emitCommand({ type: 'camera.director', enabled: true });
    emitCommand({ type: 'camera.director', enabled: true });

    expect(states).toHaveLength(1);
  });

  test('关闭命令同样写状态并转发', () => {
    const { store, events, stop } = harness();
    cleanups.push(stop);

    emitCommand({ type: 'camera.director', enabled: true });
    emitCommand({ type: 'camera.director', enabled: false });

    expect(store.getState().directorEnabled).toBe(false);
    const directorEvents = events.filter((event) => event.type === 'camera.director');
    expect(directorEvents).toHaveLength(2);
    expect(directorEvents[1]).toEqual({ type: 'camera.director', enabled: false });
  });
});

describe('导演模式开关：world → core（手动介入让位）', () => {
  test('world 发 camera.director(false) → core 写回状态并广播（按钮熄灭）', () => {
    const { store, states, stop } = harness();
    cleanups.push(stop);

    emitCommand({ type: 'camera.director', enabled: true });
    states.length = 0;

    emitWorldEvent({ type: 'camera.director', enabled: false });

    expect(store.getState().directorEnabled).toBe(false);
    expect(states).toHaveLength(1);
    expect(states[0].directorEnabled).toBe(false);
  });

  test('world 的让位事件不被当作「未处理」噪音', () => {
    const { unhandled, stop } = harness();
    cleanups.push(stop);

    emitWorldEvent({ type: 'camera.director', enabled: false });

    expect(unhandled).toHaveLength(0);
  });
});
