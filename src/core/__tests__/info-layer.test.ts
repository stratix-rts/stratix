/**
 * 单测：HUD 信息层级写入（core/store.ts 的 applyInfoLayer / setInfoLayer + core/runtime.ts 的
 * `hud.layer.set` 接线）—— @since v3.4，task_096。
 *
 * 打的是真实的 core/bus 单例 + 真实 store：runtime 的全部职责就是「接在总线上」，
 * mock 掉总线等于把被测行为一起 mock 掉了。隔离靠 resetBus() 与每个用例新建的 createStore()。
 */

import { emitCommand, onState, resetBus, type Unsubscribe } from '../bus';
import { createCoreRuntime, type CoreRuntime } from '../runtime';
import { applyInfoLayer, createStore, type CoreStore } from '../store';
import type { WorldState } from '../types';

interface Harness {
  runtime: CoreRuntime;
  store: CoreStore;
  states: WorldState[];
  stop: () => void;
}

function harness(): Harness {
  const store = createStore();
  const states: WorldState[] = [];
  const offState: Unsubscribe = onState((state) => states.push(state));
  const runtime = createCoreRuntime({ store });
  const stop = runtime.start();
  return { runtime, store, states, stop: () => { stop(); offState(); } };
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

describe('applyInfoLayer：写入口径（值没变即同一引用）', () => {
  test('缺省（L1）→ 切到 L3 是实质变化', () => {
    expect(applyInfoLayer(undefined, 'L3')).toBe('L3');
  });

  test('切到 L1（缺省档）视为无变化 —— 返回原引用，不广播', () => {
    expect(applyInfoLayer(undefined, 'L1')).toBeUndefined();
    const current: WorldState['infoLayer'] = 'L3';
    expect(applyInfoLayer(current, 'L3')).toBe(current);
  });
});

describe('HudCommand hud.layer.set → store → state 广播', () => {
  test('切到 L3 写入 WorldState.infoLayer 并广播', () => {
    const { store, states, stop } = harness();
    cleanups.push(stop);

    emitCommand({ type: 'hud.layer.set', layer: 'L3' });

    expect(store.getState().infoLayer).toBe('L3');
    expect(states).toHaveLength(1);
    expect(states[0].infoLayer).toBe('L3');
  });

  test('同一档重复切不重复广播（引用未变即不广播 —— 与其它字段同一口径）', () => {
    const { store, states, stop } = harness();
    cleanups.push(stop);

    emitCommand({ type: 'hud.layer.set', layer: 'L3' });
    emitCommand({ type: 'hud.layer.set', layer: 'L3' });

    expect(states).toHaveLength(1);
    expect(store.getState().infoLayer).toBe('L3');
  });

  test('非法档位归一化为 L1（显示密度不该让命令失败）', () => {
    const { store, states, stop } = harness();
    cleanups.push(stop);

    emitCommand({ type: 'hud.layer.set', layer: 'L9' as never });

    expect(store.getState().infoLayer).toBeUndefined();
    expect(states).toHaveLength(0);
  });
});
