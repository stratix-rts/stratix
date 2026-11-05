/**
 * 回归测试：M1-15「world-sync 不动 + 回归验证」（task_189 / demo/v3.3）。
 *
 * 权威定义：docs/DESIGN-project-map.md §7.1 表格「M1-15」行 —— 确认 M1 的 world-sync 语义
 *   **完全不变**（单实例下全量广播正确）；**不升协议版本**、**不加 instanceId 字段**。
 *
 * 覆盖验收三条里的前两条（第三条在 remote-store 侧，见姊妹文件
 *   src/app/services/remote-store/__tests__/m1-15-missing-project-instances.test.ts）：
 *   ① WORLD_SYNC_PROTOCOL_VERSION 仍为 2，且载荷里没有新增 instanceId 字段；
 *   ② 远端客户端连上后拿到的就是**当前活跃 instance 的世界态**。
 *
 * ★ 本文件**只加断言、不改协议**：被测的端点 / 会话 / core 裁决 / app 侧装载端口全是生产实现，
 *   传输层用内存 duplex socket（不起真端口，见 helpers/memory-socket.ts）。
 */

import { emitCommand, emitWorldEvent, resetBus } from '@/core/bus';
import { createCoreRuntime } from '@/core/runtime';
import { createStore, type CoreStore, type EntitySnapshot } from '@/core/store';
import type { ProjectInstanceView, UnitView } from '@/core/types';

import {
  createInMemoryInstanceRegistry,
  createInstanceLoader,
  type InstanceDataSource,
} from '../../../../../app/services/persistence/instance-loader';

import { WorldSyncEndpoint } from '../endpoint';
import {
  WORLD_SYNC_PROTOCOL_VERSION,
  type CommandAckMessage,
  type SnapshotMessage,
} from '../protocol';

import { createDuplexPair, flush, wait } from './helpers/memory-socket';

// ---------------------------------------------------------------------------
// 夹具
// ---------------------------------------------------------------------------

function makeUnit(id: string): UnitView {
  return { id, name: id, status: 'idle', missionId: null, power: 10 };
}

/** 空实体集（切副本时的「另一份内容」对照）。 */
function emptyEntities(): EntitySnapshot {
  return { missions: [], tasks: [], sessions: [], characters: [], units: [] };
}

/** hello 报文（老客户端零改动：只有协议版本 + clientId）。 */
function hello(clientId: string): string {
  return JSON.stringify({
    type: 'hello',
    protocolVersion: WORLD_SYNC_PROTOCOL_VERSION,
    clientId,
  });
}

/** command.forward 报文。 */
function forward(commandId: string, command: unknown): string {
  return JSON.stringify({ type: 'command.forward', commandId, command });
}

/** 注册表条目（一个物理副本 = 一个目录 = 一条记录）。 */
function instanceView(patch: Partial<ProjectInstanceView> & { instanceId: string }): ProjectInstanceView {
  return {
    projectId: 'spx_demo',
    path: `/tmp/${patch.instanceId}`,
    title: '副本 B',
    lastOpenedAt: 0,
    pinned: false,
    archived: false,
    status: 'idle',
    ...patch,
  };
}

// ---------------------------------------------------------------------------
// 用例
// ---------------------------------------------------------------------------

describe('M1-15 world-sync 不动（回归）', () => {
  const endpoints: WorldSyncEndpoint[] = [];
  const runtimeStops: Array<() => void> = [];

  const makeEndpoint = (store: CoreStore): WorldSyncEndpoint => {
    const endpoint = new WorldSyncEndpoint({
      store,
      dispatch: emitCommand,
      dispatchEvent: emitWorldEvent,
      snapshotThrottleMs: 20,
      ackTimeoutMs: 80,
      heartbeatIntervalMs: 0,
      logger: () => {}, // 单测不刷日志
    });
    endpoints.push(endpoint);
    return endpoint;
  };

  afterEach(() => {
    for (const stop of runtimeStops.splice(0)) stop();
    for (const endpoint of endpoints.splice(0)) endpoint.close();
    resetBus();
  });

  it('① 协议版本仍为 2；载荷里没有新增 instanceId 字段', () => {
    expect(WORLD_SYNC_PROTOCOL_VERSION).toBe(2);

    const store = createStore({ units: [makeUnit('u-alpha')] });
    const endpoint = makeEndpoint(store);
    const { client, server } = createDuplexPair();
    endpoint.accept(server);
    client.send(hello('electron-1'));

    const snapshots = client.messagesOfType<SnapshotMessage>('snapshot');
    expect(snapshots).toHaveLength(1);
    const snapshot = snapshots[0];

    // 消息外壳：仍是 { type, seq, state, delta } —— 没有 instanceId 这个字段。
    expect(Object.keys(snapshot).sort()).toEqual(['delta', 'seq', 'state', 'type']);
    expect('instanceId' in snapshot).toBe(false);
    // 世界态载荷：同样没有 instanceId 字段（activeInstanceId 是 core 的 WorldState 字段，
    //   M1-01 契约自带，不是 world-sync 新加的协议字段 —— 这里它恰好缺省）。
    expect('instanceId' in snapshot.state).toBe(false);
    expect(snapshot.state.activeInstanceId).toBeUndefined();

    // hello 报文形状不变（老客户端零改动）：只有协议版本 + clientId。
    expect(Object.keys(JSON.parse(hello('electron-1'))).sort()).toEqual([
      'clientId',
      'protocolVersion',
      'type',
    ]);
  });

  it('② 远端客户端连上后拿到的就是当前活跃 instance 的世界态', async () => {
    // 服务端当前装着的实体（= 某个副本的实体；这里记作「副本 A 的残留」）。
    const store = createStore();
    store.replaceEntities({ ...emptyEntities(), units: [makeUnit('u-a')] });

    // 副本 B 的注册表条目 + 数据源（真实 app 侧装载端口，非 mock 数据）。
    const registry = createInMemoryInstanceRegistry([instanceView({ instanceId: 'inst_b' })]);
    const source: InstanceDataSource = {
      read: async (instanceId) =>
        instanceId === 'inst_b'
          ? { ...emptyEntities(), units: [makeUnit('u-b1'), makeUnit('u-b2')] }
          : emptyEntities(),
    };
    const loader = createInstanceLoader({
      store,
      registry,
      source,
      pathExists: () => true,
    });

    const runtime = createCoreRuntime({ store, instanceLoader: loader });
    runtimeStops.push(runtime.start());

    const endpoint = makeEndpoint(store);

    // 客户端 A 连上 → 拿到的是**当前**（进副本前）的世界态。
    const a = createDuplexPair();
    endpoint.accept(a.server);
    a.client.send(hello('electron-a'));
    const before = a.client.messagesOfType<SnapshotMessage>('snapshot');
    expect(before).toHaveLength(1);
    expect(before[0].state.units.map((unit) => unit.id)).toEqual(['u-a']);

    // 客户端 A 通过 world-sync 命令面发起「进入副本 B」→ core 裁决 → 装载 → 写 activeInstanceId。
    a.client.send(forward('cmd-enter', { type: 'project.enter', instanceId: 'inst_b' }));
    await flush();

    const acks = a.client.messagesOfType<CommandAckMessage>('command.ack');
    expect(acks).toHaveLength(1);
    expect(acks[0].ok).toBe(true); // 落点真的落进了 store（回读核对不是空转）

    // 切副本 = 全量重载：副本 A 的实体一个不剩，当前活跃实例 = inst_b。
    expect(store.getState().activeInstanceId).toBe('inst_b');
    expect(store.getState().units.map((unit) => unit.id)).toEqual(['u-b1', 'u-b2']);

    // 单实例下全量广播正确：已连着的客户端 A 也收到「副本 B 的世界态」。
    await wait(60);
    const broadcasts = a.client.messagesOfType<SnapshotMessage>('snapshot');
    const last = broadcasts[broadcasts.length - 1];
    expect(last.state.activeInstanceId).toBe('inst_b');
    expect(last.state.units.map((unit) => unit.id)).toEqual(['u-b1', 'u-b2']);

    // ★ 验收②：新连上来的远端客户端拿到的就是**当前活跃 instance 的世界态**。
    const b = createDuplexPair();
    endpoint.accept(b.server);
    b.client.send(hello('electron-b'));
    const fresh = b.client.messagesOfType<SnapshotMessage>('snapshot');
    expect(fresh).toHaveLength(1);
    expect(fresh[0].state.activeInstanceId).toBe('inst_b');
    expect(fresh[0].state.units.map((unit) => unit.id)).toEqual(['u-b1', 'u-b2']);
    // 载荷里没有 instanceId 字段（协议没动）。
    expect('instanceId' in fresh[0].state).toBe(false);
  });
});
