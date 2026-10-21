/**
 * 单测：core 运行时（core/runtime.ts）—— 把 HudCommand / WorldEvent 翻译成选择集变更，
 * 并把 store 变更广播到 state 通道。
 *
 * 测试打的是**真实的 core/bus 单例 + 真实 store**，不是 mock：runtime 的全部职责就是"接在总线上"，
 * mock 掉总线等于把被测行为一起 mock 掉了。隔离靠 resetBus() 与每个用例新建的 createStore()。
 */

import { emitCommand, emitWorldEvent, onState, resetBus, type Unsubscribe } from '../bus';
import { createCoreRuntime, type CoreRuntime, type UnhandledChannel } from '../runtime';
import { createStore, type CoreStore } from '../store';
import type { UnitView, WorldState } from '../types';

const NO_MODS = { shift: false, ctrl: false, meta: false, alt: false };

const UNITS: UnitView[] = [
  { id: 'u1', name: 'Neo', status: 'idle', missionId: null, power: 3 },
  { id: 'u2', name: 'Trinity', status: 'busy', missionId: null, power: 5 },
  { id: 'u3', name: 'Morpheus', status: 'idle', missionId: null, power: 4 },
];

interface Harness {
  runtime: CoreRuntime;
  store: CoreStore;
  states: WorldState[];
  unhandled: { channel: UnhandledChannel; type: string }[];
  stop: () => void;
}

function harness(): Harness {
  const store = createStore({ units: UNITS });
  const states: WorldState[] = [];
  const unhandled: { channel: UnhandledChannel; type: string }[] = [];
  const offState: Unsubscribe = onState((state) => states.push(state));
  const runtime = createCoreRuntime({
    store,
    onUnhandled: (channel, payload) => unhandled.push({ channel, type: payload.type }),
  });
  const stop = runtime.start();
  return { runtime, store, states, unhandled, stop: () => { stop(); offState(); } };
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

describe('HudCommand → 选择状态机 → store → state 广播', () => {
  test('unit.select(set) 写入选择集并广播新快照', () => {
    const { store, states, stop } = harness();
    cleanups.push(stop);

    emitCommand({ type: 'unit.select', unitIds: ['u2'], mode: 'set' });

    expect(store.getState().selection.unitIds).toEqual(['u2']);
    expect(states).toHaveLength(1);
    expect(states[0].selection.unitIds).toEqual(['u2']);
    expect(states[0].selection.revision).toBe(1);
  });

  test('unit.select(toggle) 在集合内取消、在集合外加入', () => {
    const { store, stop } = harness();
    cleanups.push(stop);

    emitCommand({ type: 'unit.select', unitIds: ['u1'], mode: 'set' });
    emitCommand({ type: 'unit.select', unitIds: ['u1'], mode: 'toggle' });
    expect(store.getState().selection.unitIds).toEqual([]);

    emitCommand({ type: 'unit.select', unitIds: ['u3'], mode: 'toggle' });
    expect(store.getState().selection.unitIds).toEqual(['u3']);
  });

  test('选择集不含已知单位之外的对象：悬空 id 被对账丢弃', () => {
    const { store, states, stop } = harness();
    cleanups.push(stop);

    emitCommand({ type: 'unit.select', unitIds: ['u2', 'ghost'], mode: 'set' });

    expect(store.getState().selection.unitIds).toEqual(['u2']);
    // 一次用户操作只广播一次（动作 + 对账合并在同一次 setState，perf：广播有成本）
    expect(states).toHaveLength(1);
  });

  test('选择集实质未变时既不改状态也不广播', () => {
    const { states, stop } = harness();
    cleanups.push(stop);

    emitCommand({ type: 'unit.select', unitIds: ['u1'], mode: 'set' });
    emitCommand({ type: 'unit.select', unitIds: ['u1'], mode: 'set' });

    expect(states).toHaveLength(1);
  });
});

describe('WorldEvent → 选择状态机（world → core 那一半）', () => {
  test('unit.click 无修饰键 = 覆盖选择', () => {
    const { store, stop } = harness();
    cleanups.push(stop);

    emitCommand({ type: 'unit.select', unitIds: ['u1'], mode: 'set' });
    emitWorldEvent({ type: 'unit.click', unitId: 'u2', mods: NO_MODS });

    expect(store.getState().selection.unitIds).toEqual(['u2']);
  });

  test('Shift / Ctrl / ⌘ 点击 = 切换该单位是否在选择集内', () => {
    for (const key of ['shift', 'ctrl', 'meta'] as const) {
      const { store, stop } = harness();
      cleanups.push(stop);

      emitCommand({ type: 'unit.select', unitIds: ['u1'], mode: 'set' });
      emitWorldEvent({ type: 'unit.click', unitId: 'u3', mods: { ...NO_MODS, [key]: true } });
      expect(store.getState().selection.unitIds).toEqual(['u1', 'u3']);

      emitWorldEvent({ type: 'unit.click', unitId: 'u3', mods: { ...NO_MODS, [key]: true } });
      expect(store.getState().selection.unitIds).toEqual(['u1']);
    }
  });

  test('点击已消失的单位不会让悬空 id 进入选择集', () => {
    const { store, stop } = harness();
    cleanups.push(stop);

    emitWorldEvent({ type: 'unit.click', unitId: 'ghost', mods: NO_MODS });

    expect(store.getState().selection.unitIds).toEqual([]);
  });
});

describe('未落地的消息走 onUnhandled（不静默吞掉）', () => {
  test('Phase 2 才接的命令被上报，不改动状态', () => {
    const { unhandled, store, states, stop } = harness();
    cleanups.push(stop);

    emitCommand({ type: 'ui.navigate', screen: 'settings' });
    emitCommand({ type: 'chat.send', text: 'hi' });

    expect(unhandled).toEqual([
      { channel: 'command', type: 'ui.navigate' },
      { channel: 'command', type: 'chat.send' },
    ]);
    expect(states).toHaveLength(0);
    expect(store.getState().selection.unitIds).toEqual([]);
  });

  test('core 算不出坐标的 world 事件被上报而不是硬算', () => {
    const { unhandled, stop } = harness();
    cleanups.push(stop);

    emitWorldEvent({ type: 'selection.box', bounds: { x: 0, y: 0, width: 100, height: 100 } });
    emitWorldEvent({ type: 'camera.moved', center: { x: 1, y: 2 }, zoom: 1.5 });

    expect(unhandled).toEqual([
      { channel: 'world', type: 'selection.box' },
      { channel: 'world', type: 'camera.moved' },
    ]);
  });
});

describe('生命周期', () => {
  test('stop 之后不再响应命令，也不再广播（监听器必须可清理）', () => {
    const { runtime, states, stop } = harness();
    cleanups.push(stop);

    emitCommand({ type: 'unit.select', unitIds: ['u1'], mode: 'set' });
    expect(states).toHaveLength(1);

    runtime.start()(); // 再次 start 拿到的是同一个 stop
    expect(runtime.running).toBe(false);

    emitCommand({ type: 'unit.select', unitIds: ['u3'], mode: 'set' });
    expect(states).toHaveLength(1);
    expect(runtime.store.getState().selection.unitIds).toEqual(['u1']);
  });

  test('重复 start 不会叠加订阅', () => {
    const { runtime, states, stop } = harness();
    cleanups.push(stop);

    runtime.start();
    runtime.start();

    emitCommand({ type: 'unit.select', unitIds: ['u1'], mode: 'set' });

    // 叠加订阅会让这一次点击广播出两份 state；这里断言只有一份
    expect(states).toHaveLength(1);
  });
});