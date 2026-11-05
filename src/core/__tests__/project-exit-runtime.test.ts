/**
 * 单测：project.exit 的 core 裁决（core/runtime.ts，task_178 / M1-04）。
 *
 * 覆盖 §7.1 M1-04 行的三条验收要点：
 *   ① 归档失败时 activeInstanceId **不变**且**无** project.changed；
 *   ② 成功后 project.changed.instanceId === null；
 *   ③ 顺序可断言（archive 在 unload 之前）。
 *
 * 测的是**真实的 core/bus 单例 + 真实 store**（同 project-enter-runtime.test.ts 口径）：
 * 裁决的全部职责就是「接在总线上」，mock 掉总线等于把被测行为一起 mock 掉了。
 * 假端口是 app 层 IO 的注入替身（契约上端口由 app 层实现）—— 不含任何真实 IO。
 */

import { emitCommand, onState, onWorldEvent, resetBus, type Unsubscribe } from '../bus';
import { createCoreRuntime, type CoreRuntime, type UnhandledChannel } from '../runtime';
import { createStore, type CoreStore } from '../store';
import type {
  ArchiveResult,
  InstanceInspection,
  InstanceLoaderPort,
  PortResult,
  ProjectArchivePort,
  WorldEvent,
  WorldState,
} from '../types';

const INSTANCE_ID = 'wsp_demo';

/** 让出事件循环 —— 裁决是异步的（archive / unload 是 Promise），断言前要等它跑完。 */
const flush = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

interface Harness {
  runtime: CoreRuntime;
  store: CoreStore;
  states: WorldState[];
  events: WorldEvent[];
  unhandled: { channel: UnhandledChannel; type: string }[];
  stop: () => void;
}

/** 端口调用顺序记录（验收③：archive 必须在 unload 之前）。 */
type CallLog = string[];

interface LoaderScript {
  inspection?: InstanceInspection;
  unload?: PortResult;
  unloadThrows?: boolean;
}

interface ArchiveScript {
  archive?: ArchiveResult;
  archiveThrows?: boolean;
}

/** 假端口：按脚本回答调用，并把调用记进 callLog（顺序可断言）。 */
function makeLoader(script: LoaderScript, callLog: CallLog): InstanceLoaderPort {
  return {
    inspect: (): InstanceInspection =>
      script.inspection ?? { exists: true, archived: false, pathOk: true },
    load: async (): Promise<PortResult> => ({ ok: true }),
    unload: async (): Promise<PortResult> => {
      callLog.push('unload');
      if (script.unloadThrows) throw new Error('unload boom');
      return script.unload ?? { ok: true };
    },
  };
}

function makeArchive(script: ArchiveScript, callLog: CallLog): ProjectArchivePort {
  return {
    archive: async (): Promise<ArchiveResult> => {
      callLog.push('archive');
      if (script.archiveThrows) throw new Error('archive boom');
      return script.archive ?? { ok: true };
    },
  };
}

function harness(options?: {
  loader?: InstanceLoaderPort;
  archive?: ProjectArchivePort;
  activeInstanceId?: string | null;
}): Harness {
  const store = createStore(
    options && 'activeInstanceId' in options
      ? { activeInstanceId: options.activeInstanceId }
      : {}
  );
  const states: WorldState[] = [];
  const events: WorldEvent[] = [];
  const unhandled: { channel: UnhandledChannel; type: string }[] = [];
  const offState: Unsubscribe = onState((state) => states.push(state));
  const offWorld: Unsubscribe = onWorldEvent((event) => events.push(event));
  const runtime = createCoreRuntime({
    store,
    ...(options?.loader ? { instanceLoader: options.loader } : {}),
    ...(options?.archive ? { projectArchive: options.archive } : {}),
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
const exitFailed = (events: readonly WorldEvent[]): WorldEvent[] =>
  events.filter((event) => event.type === 'project.exit.failed');

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

describe('project.exit —— 成功路径', () => {
  test('activeInstanceId 落 null + 广播一条 project.changed(null)', async () => {
    const callLog: CallLog = [];
    const { store, events, stop } = harness({
      loader: makeLoader({}, callLog),
      archive: makeArchive({}, callLog),
      activeInstanceId: INSTANCE_ID,
    });
    cleanups.push(stop);

    emitCommand({ type: 'project.exit' });
    await flush();

    expect(store.getState().activeInstanceId).toBeNull();
    expect(changed(events)).toHaveLength(1);
    expect(changed(events)[0]).toEqual({ type: 'project.changed', instanceId: null });
    expect(exitFailed(events)).toHaveLength(0);
  });

  test('顺序可断言：archive 在 unload 之前（先落盘再丢弃）', async () => {
    const callLog: CallLog = [];
    const { stop } = harness({
      loader: makeLoader({}, callLog),
      archive: makeArchive({}, callLog),
      activeInstanceId: INSTANCE_ID,
    });
    cleanups.push(stop);

    emitCommand({ type: 'project.exit' });
    await flush();

    expect(callLog).toEqual(['archive', 'unload']);
  });

  test('state 通道同步广播结果（activeInstanceId 落进快照）', async () => {
    const callLog: CallLog = [];
    const { states, stop } = harness({
      loader: makeLoader({}, callLog),
      archive: makeArchive({}, callLog),
      activeInstanceId: INSTANCE_ID,
    });
    cleanups.push(stop);

    emitCommand({ type: 'project.exit' });
    await flush();

    expect(states).toHaveLength(1);
    expect(states[0].activeInstanceId).toBeNull();
  });
});

describe('project.exit —— 归档失败则拒绝退出（状态不变 + 无 project.changed）', () => {
  test('archive 返回失败 ⇒ activeInstanceId 不变、无 project.changed', async () => {
    const callLog: CallLog = [];
    const { store, events, stop } = harness({
      loader: makeLoader({}, callLog),
      archive: makeArchive({ archive: { ok: false, reason: 'archive-failed' } }, callLog),
      activeInstanceId: INSTANCE_ID,
    });
    cleanups.push(stop);

    emitCommand({ type: 'project.exit' });
    await flush();

    expect(store.getState().activeInstanceId).toBe(INSTANCE_ID);
    expect(changed(events)).toHaveLength(0);
    expect(exitFailed(events)).toEqual([
      { type: 'project.exit.failed', instanceId: INSTANCE_ID, reason: 'archive-failed' },
    ]);
  });

  test('归档失败 ⇒ 不再卸载（不半归档、不丢数据）', async () => {
    const callLog: CallLog = [];
    const { stop } = harness({
      loader: makeLoader({}, callLog),
      archive: makeArchive({ archive: { ok: false, reason: 'archive-failed' } }, callLog),
      activeInstanceId: INSTANCE_ID,
    });
    cleanups.push(stop);

    emitCommand({ type: 'project.exit' });
    await flush();

    expect(callLog).toEqual(['archive']);
  });

  test('archive 抛异常 ⇒ 兜底按拒绝处理（异常不得逃出 core）', async () => {
    const callLog: CallLog = [];
    const { store, events, stop } = harness({
      loader: makeLoader({}, callLog),
      archive: makeArchive({ archiveThrows: true }, callLog),
      activeInstanceId: INSTANCE_ID,
    });
    cleanups.push(stop);

    emitCommand({ type: 'project.exit' });
    await flush();

    expect(store.getState().activeInstanceId).toBe(INSTANCE_ID);
    expect(changed(events)).toHaveLength(0);
    expect(exitFailed(events)).toEqual([
      { type: 'project.exit.failed', instanceId: INSTANCE_ID, reason: 'archive-failed' },
    ]);
  });
});

describe('project.exit —— 卸载失败同样拒绝退出', () => {
  test('unload 返回失败 ⇒ activeInstanceId 不变、无 project.changed', async () => {
    const callLog: CallLog = [];
    const { store, events, stop } = harness({
      loader: makeLoader({ unload: { ok: false, reason: 'unload-failed' } }, callLog),
      archive: makeArchive({}, callLog),
      activeInstanceId: INSTANCE_ID,
    });
    cleanups.push(stop);

    emitCommand({ type: 'project.exit' });
    await flush();

    expect(store.getState().activeInstanceId).toBe(INSTANCE_ID);
    expect(changed(events)).toHaveLength(0);
    expect(exitFailed(events)).toEqual([
      { type: 'project.exit.failed', instanceId: INSTANCE_ID, reason: 'unload-failed' },
    ]);
  });

  test('unload 抛异常 ⇒ 兜底按拒绝处理（异常不得逃出 core）', async () => {
    const callLog: CallLog = [];
    const { store, events, stop } = harness({
      loader: makeLoader({ unloadThrows: true }, callLog),
      archive: makeArchive({}, callLog),
      activeInstanceId: INSTANCE_ID,
    });
    cleanups.push(stop);

    emitCommand({ type: 'project.exit' });
    await flush();

    expect(store.getState().activeInstanceId).toBe(INSTANCE_ID);
    expect(changed(events)).toHaveLength(0);
    expect(exitFailed(events)).toEqual([
      { type: 'project.exit.failed', instanceId: INSTANCE_ID, reason: 'unload-failed' },
    ]);
  });
});

describe('project.exit —— 端口缺席与边界态', () => {
  test('未注入归档端口 ⇒ 按未落地处理（不假装退出成功）', async () => {
    const callLog: CallLog = [];
    const { store, events, unhandled, stop } = harness({
      loader: makeLoader({}, callLog),
      activeInstanceId: INSTANCE_ID,
    });
    cleanups.push(stop);

    emitCommand({ type: 'project.exit' });
    await flush();

    expect(unhandled).toEqual([{ channel: 'command', type: 'project.exit' }]);
    expect(store.getState().activeInstanceId).toBe(INSTANCE_ID);
    expect(changed(events)).toHaveLength(0);
    expect(callLog).toEqual([]);
  });

  test('未注入装载端口 ⇒ 按未落地处理（不假装退出成功）', async () => {
    const callLog: CallLog = [];
    const { store, events, unhandled, stop } = harness({
      archive: makeArchive({}, callLog),
      activeInstanceId: INSTANCE_ID,
    });
    cleanups.push(stop);

    emitCommand({ type: 'project.exit' });
    await flush();

    expect(unhandled).toEqual([{ channel: 'command', type: 'project.exit' }]);
    expect(store.getState().activeInstanceId).toBe(INSTANCE_ID);
    expect(changed(events)).toHaveLength(0);
    expect(callLog).toEqual([]);
  });

  test('在大厅态退出 ⇒ 无事可做（无广播、状态不变）', async () => {
    const callLog: CallLog = [];
    const { store, events, stop } = harness({
      loader: makeLoader({}, callLog),
      archive: makeArchive({}, callLog),
      activeInstanceId: null,
    });
    cleanups.push(stop);

    emitCommand({ type: 'project.exit' });
    await flush();

    expect(store.getState().activeInstanceId).toBeNull();
    expect(changed(events)).toHaveLength(0);
    expect(exitFailed(events)).toHaveLength(0);
    expect(callLog).toEqual([]);
  });
});
