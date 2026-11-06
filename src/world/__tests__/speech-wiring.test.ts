/**
 * 测试职责：**总线事件 → 气泡说话系统的接线**（task_076 / DEMO-PLAN.md §3；
 *   @since v3.3，task_219 / IX-06 改口径）——
 *   core 在 world 通道上发的任务生命周期事件（派活 / 开工 / 完成 / 报错），
 *   桥接层要转成对应的话语类别：**状态键**（thinking / working）与**事件键**（complete / error）；
 *   world 层当场指挥的 unit.bubble 事件按原话转发。
 * 输入：被测模块 src/world/bridge/bus-adapter.ts（真实 core/bus 单例，不 mock 总线）。
 * 输出：断言（无返回值）。
 * 禁止事项：
 *   1. mock 总线 —— 桥接层唯一的职责就是接在总线上，mock 掉等于把被测行为一起 mock 掉；
 *   2. 在本文件实现气泡逻辑 —— 这里只断言「事件 → 话语类别」的映射，
 *      频率与动画另有专测（speech-bubble.test.ts）；
 *   3. import phaser —— 本层是纯接线（node 单测直接跑）。
 */

import { emitWorldEvent, resetBus, type Unsubscribe } from '../../core/bus';
import type { CharacterTask } from '../../core/types';
import type { SpeechKey } from '../../core/theme/bubble-copy';
import { createWorldBridge, type WorldScenePort } from '../bridge/bus-adapter';

/** 一条够用的角色任务夹具（只用到气泡接线关心的字段）。 */
function makeTask(id = 't1'): CharacterTask {
  return {
    id,
    characterId: 'c1',
    prompt: '把演示跑通',
    status: 'running',
    createdAt: 0,
    startedAt: 0,
    endedAt: null,
    output: '',
  };
}

/** 记录端口收到的气泡请求。 */
function createFakePort() {
  const speeches: { task: CharacterTask; kind: SpeechKey }[] = [];
  const bubbles: { unitId: string; text: string }[] = [];
  const taskEvents: { task: CharacterTask; phase: string }[] = [];
  const port: WorldScenePort = {
    syncUnits: () => {},
    syncSelection: () => {},
    syncTaskEvent: (task, phase) => void taskEvents.push({ task, phase: String(phase) }),
    syncTaskSpeech: (task, kind) => void speeches.push({ task, kind }),
    syncUnitBubble: (unitId, text) => void bubbles.push({ unitId, text }),
  };
  return { port, speeches, bubbles, taskEvents };
}

let stops: Unsubscribe[] = [];

beforeEach(() => {
  resetBus();
  stops = [];
});

afterEach(() => {
  stops.forEach((stop) => stop());
  stops = [];
  resetBus();
});

describe('任务生命周期事件 → 气泡话语类别', () => {
  test('task.queued → 思考中（thinking，状态键）', () => {
    const { port, speeches } = createFakePort();
    const bridge = createWorldBridge(port);
    stops.push(() => bridge.destroy());

    const task = makeTask();
    emitWorldEvent({ type: 'task.queued', task });

    expect(speeches).toHaveLength(1);
    expect(speeches[0]?.kind).toBe('thinking');
    expect(speeches[0]?.task.id).toBe('t1');
  });

  test('task.started → 工作中（working，状态键）', () => {
    const { port, speeches } = createFakePort();
    const bridge = createWorldBridge(port);
    stops.push(() => bridge.destroy());

    emitWorldEvent({ type: 'task.started', task: makeTask() });

    expect(speeches).toHaveLength(1);
    expect(speeches[0]?.kind).toBe('working');
  });

  test('task.completed → 完成（complete）', () => {
    const { port, speeches } = createFakePort();
    const bridge = createWorldBridge(port);
    stops.push(() => bridge.destroy());

    emitWorldEvent({ type: 'task.completed', task: makeTask() });

    expect(speeches).toHaveLength(1);
    expect(speeches[0]?.kind).toBe('complete');
  });

  test('task.failed → 报错（error）', () => {
    const { port, speeches } = createFakePort();
    const bridge = createWorldBridge(port);
    stops.push(() => bridge.destroy());

    emitWorldEvent({ type: 'task.failed', task: makeTask() });

    expect(speeches).toHaveLength(1);
    expect(speeches[0]?.kind).toBe('error');
  });

  test('既有工作表现钩子不受影响（started / completed / failed 仍转 syncTaskEvent）', () => {
    const { port, taskEvents } = createFakePort();
    const bridge = createWorldBridge(port);
    stops.push(() => bridge.destroy());

    emitWorldEvent({ type: 'task.started', task: makeTask() });
    emitWorldEvent({ type: 'task.completed', task: makeTask() });
    emitWorldEvent({ type: 'task.failed', task: makeTask() });

    expect(taskEvents.map((e) => e.phase)).toEqual(['started', 'completed', 'failed']);
  });

  test('task.queued 不进 syncTaskEvent（派活还不是「在干活」，不该挂工作环）', () => {
    const { port, taskEvents } = createFakePort();
    const bridge = createWorldBridge(port);
    stops.push(() => bridge.destroy());

    emitWorldEvent({ type: 'task.queued', task: makeTask() });

    expect(taskEvents).toHaveLength(0);
  });
});

describe('unit.bubble → 原话气泡', () => {
  test('原话原样转发（不抽句库）', () => {
    const { port, bubbles } = createFakePort();
    const bridge = createWorldBridge(port);
    stops.push(() => bridge.destroy());

    emitWorldEvent({ type: 'unit.bubble', unitId: 'u1', text: '收到' });

    expect(bubbles).toHaveLength(1);
    expect(bubbles[0]).toEqual({ unitId: 'u1', text: '收到' });
  });
});
