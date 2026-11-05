/**
 * 单测：project.enter 的 core 裁决（core/runtime.ts，task_177 / M1-03）。
 *
 * 覆盖 §7.1 M1-03 行的三条验收要点：
 *   ① core 零 IO（迁移测试另立，见 tests/migration/core-zero-io.test.ts —— 本文件用注入的假端口）；
 *   ② 端口失败时 activeInstanceId **不变**且有 project.enter.failed；
 *   ③ 单次切换只产生**一条** project.changed。
 *
 * 测的是**真实的 core/bus 单例 + 真实 store**（同 runtime.test.ts 口径）：
 * 裁决的全部职责就是「接在总线上」，mock 掉总线等于把被测行为一起 mock 掉了。
 * 假端口是 app 层 IO 的注入替身（契约上端口由 app 层实现）—— 不含任何真实 IO。
 */

import { emitCommand, onState, onWorldEvent, resetBus, type Unsubscribe } from '../bus';
import { createCoreRuntime, type CoreRuntime, type UnhandledChannel } from '../runtime';
import { createStore, type CoreStore } from '../store';
import type {
  InstanceInspection,
  InstanceLoaderPort,
  PortResult,
  WorldEvent,
  WorldState,
} from '../types';

const INSTANCE_ID = 'wsp_demo';

/** 让出事件循环 —— 裁决是异步的（load 是 Promise），断言前要等它跑完。 */
const flush = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

interface Harness {
  runtime: CoreRuntime;
  store: CoreStore;
  states: WorldState[];
  events: WorldEvent[];
  unhandled: { channel: UnhandledChannel; type: string }[];
  stop: () => void;
}

/** 假端口：按脚本回答 inspect / load；不含任何 IO。 */
function makeLoader(script: {
  inspection?: InstanceInspection;
  inspectThrows?: boolean;
  load?: PortResult;
  loadThrows?: boolean;
}): InstanceLoaderPort {
  return {
    inspect: (): InstanceInspection => {
      if (script.inspectThrows) throw new Error('inspect boom');
      return script.inspection ?? { exists: true, archived: false, pathOk: true };
    },
    load: async (): Promise<PortResult> => {
      if (script.loadThrows) throw new Error('load boom');
      return script.load ?? { ok: true };
    },
    unload: async (): Promise<PortResult> => ({ ok: true }),
  };
}

function harness(loader?: InstanceLoaderPort): Harness {
  const store = createStore();
  const states: WorldState[] = [];
  const events: WorldEvent[] = [];
  const unhandled: { channel: UnhandledChannel; type: string }[] = [];
  const offState: Unsubscribe = onState((state) => states.push(state));
  const offWorld: Unsubscribe = onWorldEvent((event) => events.push(event));
  const runtime = createCoreRuntime({
    store,
    ...(loader ? { instanceLoader: loader } : {}),
    onUnhandled: (channel, payload) => unhandled.push({ channel, type: payload.type }),
  });
  const stop = runtime.start();
  return {
    runtime,
    store,
    states,
    events,
    unhandled,
    stop: () => {
      stop();
      offState();
      offWorld();
    },
  };
}

const changed = (events: readonly WorldEvent[]): WorldEvent[] =>
  events.filter((event) => event.type === 'project.changed');
const failed = (events: readonly WorldEvent[]): WorldEvent[] =>
  events.filter((event) => event.type === 'project.enter.failed');

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

describe('project.enter —— 成功路径', () => {
  test('写 activeInstanceId + 广播一条 project.changed', async () => {
    const { store, events, stop } = harness(makeLoader({}));
    cleanups.push(stop);

    emitCommand({ type: 'project.enter', instanceId: INSTANCE_ID });
    await flush();

    expect(store.getState().activeInstanceId).toBe(INSTANCE_ID);
    expect(changed(events)).toHaveLength(1);
    expect(changed(events)[0]).toEqual({ type: 'project.changed', instanceId: INSTANCE_ID });
    expect(failed(events)).toHaveLength(0);
  });

  test('单次切换只产生一条 project.changed（不重复发）', async () => {
    const { events, stop } = harness(makeLoader({}));
    cleanups.push(stop);

    emitCommand({ type: 'project.enter', instanceId: INSTANCE_ID });
    await flush();

    expect(changed(events)).toHaveLength(1);
  });

  test('state 通道同步广播结果（activeInstanceId 落进快照）', async () => {
    const { states, stop } = harness(makeLoader({}));
    cleanups.push(stop);

    emitCommand({ type: 'project.enter', instanceId: INSTANCE_ID });
    await flush();

    expect(states).toHaveLength(1);
    expect(states[0].activeInstanceId).toBe(INSTANCE_ID);
  });
});

describe('project.enter —— 拒绝路径（状态不变 + project.enter.failed）', () => {
  test('实例不存在 ⇒ instance-missing', async () => {
    const { store, events, stop } = harness(
      makeLoader({ inspection: { exists: false, archived: false, pathOk: false } })
    );
    cleanups.push(stop);

    emitCommand({ type: 'project.enter', instanceId: INSTANCE_ID });
    await flush();

    expect(store.getState().activeInstanceId).toBeUndefined();
    expect(failed(events)).toEqual([
      { type: 'project.enter.failed', instanceId: INSTANCE_ID, reason: 'instance-missing' },
    ]);
    expect(changed(events)).toHaveLength(0);
  });

  test('实例已归档 ⇒ instance-archived', async () => {
    const { store, events, stop } = harness(
      makeLoader({ inspection: { exists: true, archived: true, pathOk: true } })
    );
    cleanups.push(stop);

    emitCommand({ type: 'project.enter', instanceId: INSTANCE_ID });
    await flush();

    expect(store.getState().activeInstanceId).toBeUndefined();
    expect(failed(events)).toEqual([
      { type: 'project.enter.failed', instanceId: INSTANCE_ID, reason: 'instance-archived' },
    ]);
    expect(changed(events)).toHaveLength(0);
  });

  test('路径不可达 ⇒ path-unreachable', async () => {
    const { store, events, stop } = harness(
      makeLoader({ inspection: { exists: true, archived: false, pathOk: false } })
    );
    cleanups.push(stop);

    emitCommand({ type: 'project.enter', instanceId: INSTANCE_ID });
    await flush();

    expect(store.getState().activeInstanceId).toBeUndefined();
    expect(failed(events)).toEqual([
      { type: 'project.enter.failed', instanceId: INSTANCE_ID, reason: 'path-unreachable' },
    ]);
    expect(changed(events)).toHaveLength(0);
  });

  test('load 返回失败 ⇒ 沿用端口给的分类，且状态不变', async () => {
    const { store, events, stop } = harness(makeLoader({ load: { ok: false, reason: 'load-failed' } }));
    cleanups.push(stop);

    emitCommand({ type: 'project.enter', instanceId: INSTANCE_ID });
    await flush();

    expect(store.getState().activeInstanceId).toBeUndefined();
    expect(failed(events)).toEqual([
      { type: 'project.enter.failed', instanceId: INSTANCE_ID, reason: 'load-failed' },
    ]);
    expect(changed(events)).toHaveLength(0);
  });

  test('load 抛异常 ⇒ 兜底按拒绝处理（异常不得逃出 core）', async () => {
    const { store, events, stop } = harness(makeLoader({ loadThrows: true }));
    cleanups.push(stop);

    emitCommand({ type: 'project.enter', instanceId: INSTANCE_ID });
    await flush();

    expect(store.getState().activeInstanceId).toBeUndefined();
    expect(failed(events)).toEqual([
      { type: 'project.enter.failed', instanceId: INSTANCE_ID, reason: 'load-failed' },
    ]);
    expect(changed(events)).toHaveLength(0);
  });

  test('inspect 抛异常 ⇒ 兜底按拒绝处理（异常不得逃出 core）', async () => {
    const { store, events, stop } = harness(makeLoader({ inspectThrows: true }));
    cleanups.push(stop);

    emitCommand({ type: 'project.enter', instanceId: INSTANCE_ID });
    await flush();

    expect(store.getState().activeInstanceId).toBeUndefined();
    expect(failed(events)).toEqual([
      { type: 'project.enter.failed', instanceId: INSTANCE_ID, reason: 'load-failed' },
    ]);
    expect(changed(events)).toHaveLength(0);
  });

  test('已在某副本内时进入失败 ⇒ activeInstanceId 保持原值', async () => {
    const store = createStore({ activeInstanceId: 'wsp_other' });
    const events: WorldEvent[] = [];
    const offWorld: Unsubscribe = onWorldEvent((event) => events.push(event));
    const runtime = createCoreRuntime({
      store,
      instanceLoader: makeLoader({ load: { ok: false, reason: 'load-failed' } }),
    });
    const stop = runtime.start();
    cleanups.push(() => {
      stop();
      offWorld();
    });

    emitCommand({ type: 'project.enter', instanceId: INSTANCE_ID });
    await flush();

    expect(store.getState().activeInstanceId).toBe('wsp_other');
    expect(changed(events)).toHaveLength(0);
    expect(failed(events)).toHaveLength(1);
  });
});

describe('project.enter —— 端口缺席与串行性', () => {
  test('未注入端口 ⇒ 按未落地处理（不假装进入成功）', async () => {
    const { store, events, unhandled, stop } = harness();
    cleanups.push(stop);

    emitCommand({ type: 'project.enter', instanceId: INSTANCE_ID });
    await flush();

    expect(unhandled).toEqual([{ channel: 'command', type: 'project.enter' }]);
    expect(store.getState().activeInstanceId).toBeUndefined();
    expect(changed(events)).toHaveLength(0);
    expect(failed(events)).toHaveLength(0);
  });

  test('连点两次 ⇒ 两次切换各一条 project.changed（串行、不交错）', async () => {
    const { store, events, stop } = harness(makeLoader({}));
    cleanups.push(stop);

    emitCommand({ type: 'project.enter', instanceId: INSTANCE_ID });
    emitCommand({ type: 'project.enter', instanceId: 'wsp_second' });
    await flush();

    expect(changed(events)).toHaveLength(2);
    expect(changed(events).map((event) => (event as { instanceId: string }).instanceId)).toEqual([
      INSTANCE_ID,
      'wsp_second',
    ]);
    expect(store.getState().activeInstanceId).toBe('wsp_second');
  });
});
