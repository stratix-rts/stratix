/**
 * 单测：**演出占用（Z6 沉浸层接线）的裁决口径**（@since v3.4，task_094）。
 *
 * 打的是真实的 core/bus 单例 + 真实 store + 真实 runtime —— runtime 的全部职责就是
 * 「接在总线上」，mock 掉总线等于把被测行为一起 mock 掉了。
 *
 * 覆盖：
 *   - 纯函数 applyLayerHold（占用列表的增删与「值没变即同一引用」口径）；
 *   - 纯函数 resolveInfoLayer（有效档 = 手动档 + 占用裁决）；
 *   - HudCommand `hud.layer.hold` → store → state 广播；
 *   - 导演模式开关自动同步占用（两条入口：HUD 命令 / world 手动介入回写）；
 *   - 多演出叠加时「谁先结束谁先放手，但另一个还在演就仍是 L3」。
 */

import { emitCommand, emitWorldEvent, onState, resetBus, type Unsubscribe } from '../bus';
import { LAYER_TRIGGERS, isLayerTrigger, resolveInfoLayer } from '../info-layer';
import { createCoreRuntime, type CoreRuntime } from '../runtime';
import { applyLayerHold, createStore, type CoreStore } from '../store';
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
  const stopRuntime = runtime.start();
  return { runtime, store, states, stop: () => { stopRuntime(); offState(); } };
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

describe('纯函数：占用词表与有效档裁决', () => {
  test('占用源词表有界（三个词 —— 广播数据不许无限增长）', () => {
    expect(LAYER_TRIGGERS).toEqual(['milestone', 'replay', 'director']);
    expect(isLayerTrigger('milestone')).toBe(true);
    expect(isLayerTrigger('nope')).toBe(false);
  });

  test('applyLayerHold：占上 / 释放 / 值没变即同一引用', () => {
    // 占上：追加到列表。
    expect(applyLayerHold(undefined, 'milestone', true)).toEqual(['milestone']);
    // 释放：摘掉；空列表回落 undefined（缺省 = 无占用）。
    expect(applyLayerHold(['milestone'], 'milestone', false)).toBeUndefined();
    // 值没变 → 原样返回当前引用（store 的「引用未变即不广播」靠它生效）。
    expect(applyLayerHold(undefined, 'milestone', false)).toBeUndefined();
    const list = ['replay'] as const;
    expect(applyLayerHold(list, 'replay', true)).toBe(list);
  });

  test('resolveInfoLayer：有占用 → L3；没占用 → 手动档', () => {
    expect(resolveInfoLayer('L1', ['milestone'])).toBe('L3');
    expect(resolveInfoLayer('L2', ['milestone', 'replay'])).toBe('L3');
    expect(resolveInfoLayer('L2', [])).toBe('L2');
    expect(resolveInfoLayer(undefined, [])).toBe('L1');
  });
});

describe('HudCommand hud.layer.hold → store → state 广播', () => {
  test('占用 → 有效档锁 L3；释放 → 回到手动档（L1）', () => {
    const { store, states, stop } = harness();
    cleanups.push(stop);

    emitCommand({ type: 'hud.layer.hold', trigger: 'milestone', active: true });

    expect(store.getState().infoLayer).toBe('L3');
    expect(store.getState().layerHolds).toEqual(['milestone']);
    expect(states.at(-1)?.infoLayer).toBe('L3');

    emitCommand({ type: 'hud.layer.hold', trigger: 'milestone', active: false });

    expect(store.getState().infoLayer).toBeUndefined();
    expect(store.getState().layerHolds).toBeUndefined();
    expect(states.at(-1)?.infoLayer).toBeUndefined();
  });

  test('重复占用同源不重复广播（引用未变即不广播）', () => {
    const { store, states, stop } = harness();
    cleanups.push(stop);

    emitCommand({ type: 'hud.layer.hold', trigger: 'replay', active: true });
    emitCommand({ type: 'hud.layer.hold', trigger: 'replay', active: true });

    expect(states).toHaveLength(1);
    expect(store.getState().infoLayer).toBe('L3');
  });

  test('非法占用源被忽略（显示密度不该让命令失败）', () => {
    const { store, states, stop } = harness();
    cleanups.push(stop);

    emitCommand({ type: 'hud.layer.hold', trigger: 'nope' as never, active: true });

    expect(store.getState().infoLayer).toBeUndefined();
    expect(store.getState().layerHolds).toBeUndefined();
    expect(states).toHaveLength(0);
  });

  test('多演出叠加：先结束的那个放手，另一个还在演 → 仍是 L3', () => {
    const { store, stop } = harness();
    cleanups.push(stop);

    emitCommand({ type: 'hud.layer.hold', trigger: 'milestone', active: true });
    emitCommand({ type: 'hud.layer.hold', trigger: 'replay', active: true });
    expect(store.getState().infoLayer).toBe('L3');

    emitCommand({ type: 'hud.layer.hold', trigger: 'milestone', active: false });
    expect(store.getState().infoLayer).toBe('L3');
    expect(store.getState().layerHolds).toEqual(['replay']);

    emitCommand({ type: 'hud.layer.hold', trigger: 'replay', active: false });
    expect(store.getState().infoLayer).toBeUndefined();
  });

  test('手动档被记住：演出结束后回到手动档而不是 L1', () => {
    const { store, stop } = harness();
    cleanups.push(stop);

    emitCommand({ type: 'hud.layer.set', layer: 'L2' });
    expect(store.getState().infoLayer).toBe('L2');

    emitCommand({ type: 'hud.layer.hold', trigger: 'milestone', active: true });
    expect(store.getState().infoLayer).toBe('L3');

    emitCommand({ type: 'hud.layer.hold', trigger: 'milestone', active: false });
    expect(store.getState().infoLayer).toBe('L2');
  });
});

describe('导演模式开关 ↔ 沉浸占用（同一落点）', () => {
  test('HUD 的 camera.director 命令 → 占用同步 → 有效档 L3', () => {
    const { store, stop } = harness();
    cleanups.push(stop);

    emitCommand({ type: 'camera.director', enabled: true });

    expect(store.getState().directorEnabled).toBe(true);
    expect(store.getState().layerHolds).toEqual(['director']);
    expect(store.getState().infoLayer).toBe('L3');

    emitCommand({ type: 'camera.director', enabled: false });

    expect(store.getState().directorEnabled).toBe(false);
    expect(store.getState().layerHolds).toBeUndefined();
    expect(store.getState().infoLayer).toBeUndefined();
  });

  test('world 侧手动介入（同名事件回写 false）→ 占用一并释放', () => {
    const { store, stop } = harness();
    cleanups.push(stop);

    emitCommand({ type: 'camera.director', enabled: true });
    expect(store.getState().infoLayer).toBe('L3');

    // world 检测到主播碰了镜头 → 发 camera.director=false → core 写回（手动优先是硬规则）。
    emitWorldEvent({ type: 'camera.director', enabled: false });

    expect(store.getState().directorEnabled).toBe(false);
    expect(store.getState().layerHolds).toBeUndefined();
    expect(store.getState().infoLayer).toBeUndefined();
  });
});
