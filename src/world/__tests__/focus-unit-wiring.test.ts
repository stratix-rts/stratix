/**
 * 单测：**单位联动的总线闭环（世界侧）**（@since v3.4，task_092）。
 *
 * 链路：HUD 命令 `focus.unit` → core（只转发，不写状态）→ world 通道同名事件
 *   → 桥接层（world/bridge/bus-adapter）→ 场景端口 syncFocusUnit → 描边高亮 + 引导弧线。
 *
 * 打的是**真实的 core/bus 单例 + 真实 core runtime**（不是 mock 总线）：本任务要证明的
 * 恰恰是「HUD 发的事件真的能到世界侧」，mock 掉总线等于把要证明的东西一起 mock 掉了。
 * 隔离靠 resetBus()（core 自带的测试专用 API）。
 *
 * 顺带覆盖导演模式开关的同款两段式（camera.director → syncDirectorMode → 取景框）。
 */

import { emitCommand, resetBus, type Unsubscribe } from '../../core/bus';
import { createCoreRuntime, type CoreRuntime } from '../../core/runtime';
import { createStore } from '../../core/store';
import { createWorldBridge, type WorldScenePort } from '../bridge/bus-adapter';

interface Recorder {
  port: WorldScenePort;
  focusedUnitIds: string[];
  directorModes: boolean[];
}

function createRecorder(): Recorder {
  const focusedUnitIds: string[] = [];
  const directorModes: boolean[] = [];
  const port: WorldScenePort = {
    syncUnits: () => { /* 本测试不关心单位对账 */ },
    syncSelection: () => { /* 同上 */ },
    syncFocusUnit: (unitId) => void focusedUnitIds.push(unitId),
    syncDirectorMode: (enabled) => void directorModes.push(enabled),
  };
  return { port, focusedUnitIds, directorModes };
}

let runtime: CoreRuntime | null = null;
let stopRuntime: (() => void) | null = null;
let stops: Unsubscribe[] = [];

beforeEach(() => {
  resetBus();
  stops = [];
});

afterEach(() => {
  stops.forEach((stop) => stop());
  stops = [];
  if (stopRuntime) {
    stopRuntime();
    stopRuntime = null;
  }
  runtime = null;
  resetBus();
});

describe('focus.unit：HUD 命令 → core 转发 → 世界侧收到', () => {
  test('world 侧能收到 focus.unit（描边 + 弧线的触发点）', () => {
    const recorder = createRecorder();
    const bridge = createWorldBridge(recorder.port);
    stops.push(() => bridge.destroy());
    runtime = createCoreRuntime({ store: createStore() });
    stopRuntime = runtime.start();

    emitCommand({ type: 'focus.unit', unitId: 'u-42' });

    expect(recorder.focusedUnitIds).toEqual(['u-42']);
  });

  test('core 只转发、不写 WorldState（联动是瞬态表现）', () => {
    const recorder = createRecorder();
    const bridge = createWorldBridge(recorder.port);
    stops.push(() => bridge.destroy());
    const store = createStore();
    runtime = createCoreRuntime({ store });
    stopRuntime = runtime.start();

    emitCommand({ type: 'focus.unit', unitId: 'u-42' });

    // 状态里没有「被聚焦的单位」这一项 —— 焦点裁决在 world 侧（focus-link.ts 的板子）。
    expect(JSON.stringify(store.getState())).not.toContain('u-42');
  });

  test('再次点选同一个单位也照样送达（取消由世界侧裁决）', () => {
    const recorder = createRecorder();
    const bridge = createWorldBridge(recorder.port);
    stops.push(() => bridge.destroy());
    runtime = createCoreRuntime({ store: createStore() });
    stopRuntime = runtime.start();

    emitCommand({ type: 'focus.unit', unitId: 'u-1' });
    emitCommand({ type: 'focus.unit', unitId: 'u-1' });

    expect(recorder.focusedUnitIds).toEqual(['u-1', 'u-1']);
  });
});

describe('camera.director：导演模式开关送达世界侧', () => {
  test('开启与关闭都送达（取景框的开合由它驱动）', () => {
    const recorder = createRecorder();
    const bridge = createWorldBridge(recorder.port);
    stops.push(() => bridge.destroy());
    runtime = createCoreRuntime({ store: createStore() });
    stopRuntime = runtime.start();

    emitCommand({ type: 'camera.director', enabled: true });
    emitCommand({ type: 'camera.director', enabled: false });

    expect(recorder.directorModes).toEqual([true, false]);
  });
});
