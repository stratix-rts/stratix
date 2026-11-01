/**
 * 单测：world-sync 的**传输端**（task_082 / 前后端分离 B2）。
 * 覆盖（对齐任务验收）：
 *   ① hello 后必收 snapshot（含真实 store 数据）；
 *   ② 命令往返 ack：forward → 状态变更 → ack ok；
 *   ③ 无人接管命令超时 → internal_error ack；
 *   ④ seq 单调递增；
 *   ⑤ 两客户端并存各自收广播（且 ack 只回发起方）；
 *   ＋ 协议错误（坏帧 / 版本不兼容 / 未注册就发命令）与心跳踢死链。
 *
 * 传输层用**注入式内存 duplex socket**（不起真端口、不连真 TCP）——
 *   见 __tests__/helpers/memory-socket.ts。
 */

import { emitCommand, resetBus } from '@/core/bus';
import { createCoreRuntime } from '@/core/runtime';
import { createStore, type CoreStore } from '@/core/store';
import type { Notice, UnitView } from '@/core/types';

import { WorldSyncEndpoint } from '../endpoint';
import {
  WORLD_SYNC_PROTOCOL_VERSION,
  WORLD_SYNC_SEQ_START,
  type CommandAckMessage,
  type ErrorMessage,
  type SnapshotMessage,
} from '../protocol';

import { createDuplexPair, flush, wait } from './helpers/memory-socket';

// ---------------------------------------------------------------------------
// 夹具
// ---------------------------------------------------------------------------

function makeUnit(id: string): UnitView {
  return { id, name: id, status: 'idle', missionId: null, power: 10 };
}

function makeNotice(id: string, level: Notice['level'] = 'info'): Notice {
  const at = Date.now();
  return { id, level, text: `通知 ${id}`, createdAt: at, expiresAt: at + 60_000, source: 'test' };
}

/** hello 报文。 */
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

/** 起一个 runtime（命令的裁决方）；返回收尾闭包（runtime.start() 的返回值）。 */
function startRuntime(store: CoreStore): () => void {
  const runtime = createCoreRuntime({ store });
  return runtime.start();
}

// ---------------------------------------------------------------------------
// 用例
// ---------------------------------------------------------------------------

describe('world-sync 端点（task_082）', () => {
  const endpoints: WorldSyncEndpoint[] = [];
  const runtimeStops: Array<() => void> = [];

  const makeEndpoint = (options: Partial<ConstructorParameters<typeof WorldSyncEndpoint>[0]> = {}) => {
    const store = options.store ?? createStore();
    const endpoint = new WorldSyncEndpoint({
      store,
      dispatch: emitCommand,
      snapshotThrottleMs: 20,
      ackTimeoutMs: 80,
      heartbeatIntervalMs: 0,
      logger: () => {}, // 单测不刷日志
      ...options,
    });
    endpoints.push(endpoint);
    return { endpoint, store };
  };

  afterEach(() => {
    for (const stop of runtimeStops.splice(0)) stop();
    for (const endpoint of endpoints.splice(0)) endpoint.close();
    resetBus();
  });

  it('① hello 后立即收到全量 snapshot（真实 store 数据）', () => {
    const store = createStore({ units: [makeUnit('u-alpha'), makeUnit('u-beta')] });
    const { endpoint } = makeEndpoint({ store });
    const { client, server } = createDuplexPair();
    endpoint.accept(server);

    client.send(hello('electron-1'));

    const snapshots = client.messagesOfType<SnapshotMessage>('snapshot');
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0].seq).toBe(WORLD_SYNC_SEQ_START);
    expect(snapshots[0].delta).toBeNull();
    // 快照内容 = store 的真实状态（不是空壳、不是 mock）
    expect(snapshots[0].state.units.map((unit) => unit.id)).toEqual(['u-alpha', 'u-beta']);
    expect(snapshots[0].state.units[0].name).toBe('u-alpha');
  });

  it('② 命令往返：forward → 状态变更 → ack ok', async () => {
    const store = createStore();
    runtimeStops.push(startRuntime(store));
    const { endpoint } = makeEndpoint({ store });
    const { client, server } = createDuplexPair();
    endpoint.accept(server);
    client.send(hello('electron-1'));

    client.send(forward('cmd-1', { type: 'ui.navigate', screen: 'settings' }));
    await flush();

    const acks = client.messagesOfType<CommandAckMessage>('command.ack');
    expect(acks).toHaveLength(1);
    expect(acks[0].commandId).toBe('cmd-1');
    expect(acks[0].ok).toBe(true);
    expect(acks[0].error).toBeUndefined();
    expect(acks[0].seq).toBeGreaterThan(0);
    // 落点是真的落进了 core store（回读核对不是空转）
    expect(store.getState().currentScreen).toBe('settings');
  });

  it('③ 无人接管命令超时 → internal_error ack（绝不假装成功）', async () => {
    const store = createStore();
    runtimeStops.push(startRuntime(store)); // runtime 不接 unit.focus → 命令没人接管
    const { endpoint } = makeEndpoint({ store, ackTimeoutMs: 60 });
    const { client, server } = createDuplexPair();
    endpoint.accept(server);
    client.send(hello('electron-1'));

    client.send(forward('cmd-lost', { type: 'unit.focus', unitId: 'u-1' }));
    await wait(160);

    const acks = client.messagesOfType<CommandAckMessage>('command.ack');
    expect(acks).toHaveLength(1);
    expect(acks[0].commandId).toBe('cmd-lost');
    expect(acks[0].ok).toBe(false);
    expect(acks[0].error?.code).toBe('internal_error');
    expect(acks[0].seq).toBeNull();
  });

  it('③′ 投递口抛错 → internal_error 回执（不假装成功，也不炸传输层）', async () => {
    const store = createStore();
    const { endpoint } = makeEndpoint({
      store,
      ackTimeoutMs: 60,
      dispatch: () => {
        throw new Error('总线炸了');
      },
    });
    const { client, server } = createDuplexPair();
    endpoint.accept(server);
    client.send(hello('electron-1'));

    client.send(forward('cmd-boom', { type: 'ui.navigate', screen: 'settings' }));
    await flush();

    const acks = client.messagesOfType<CommandAckMessage>('command.ack');
    expect(acks).toHaveLength(1);
    expect(acks[0].ok).toBe(false);
    expect(acks[0].error?.code).toBe('internal_error');
  });

  it('④ seq 单调递增（节流合并后仍逐份递增）', async () => {
    const store = createStore();
    const { endpoint } = makeEndpoint({ store, snapshotThrottleMs: 20 });
    const { client, server } = createDuplexPair();
    endpoint.accept(server);
    client.send(hello('electron-1'));

    for (let i = 0; i < 3; i += 1) {
      store.setState((state) => ({ ...state, notices: [...state.notices, makeNotice(`n-${i}`)] }));
      await wait(45); // > 节流窗口：每次变更各自推一份
    }

    const seqs = client.messagesOfType<SnapshotMessage>('snapshot').map((message) => message.seq);
    expect(seqs).toEqual([WORLD_SYNC_SEQ_START, 2, 3, 4]);
    for (let i = 1; i < seqs.length; i += 1) {
      expect(seqs[i]).toBeGreaterThan(seqs[i - 1]);
    }
  });

  it('⑤ 两客户端并存：各自收到同一份广播，ack 只回发起方', async () => {
    const store = createStore();
    runtimeStops.push(startRuntime(store));
    const { endpoint } = makeEndpoint({ store, snapshotThrottleMs: 20 });
    const pairA = createDuplexPair();
    const pairB = createDuplexPair();
    endpoint.accept(pairA.server);
    endpoint.accept(pairB.server);
    pairA.client.send(hello('electron-a'));
    pairB.client.send(hello('electron-b'));

    // 状态变更 → 广播给两个客户端（同一份真相、同一个 seq）
    store.setState((state) => ({ ...state, notices: [...state.notices, makeNotice('n-broadcast')] }));
    await wait(50);

    const snapsA = pairA.client.messagesOfType<SnapshotMessage>('snapshot');
    const snapsB = pairB.client.messagesOfType<SnapshotMessage>('snapshot');
    expect(snapsA.length).toBeGreaterThanOrEqual(2);
    expect(snapsB.length).toBeGreaterThanOrEqual(2);
    expect(snapsA[snapsA.length - 1].seq).toBe(snapsB[snapsB.length - 1].seq);
    expect(snapsA[snapsA.length - 1].state.notices.map((n) => n.id)).toContain('n-broadcast');

    // ack 是点对点：只有发起方收到
    pairA.client.send(forward('cmd-a', { type: 'ui.navigate', screen: 'settings' }));
    await flush();
    expect(pairA.client.messagesOfType<CommandAckMessage>('command.ack')).toHaveLength(1);
    expect(pairB.client.messagesOfType<CommandAckMessage>('command.ack')).toHaveLength(0);
  });

  it('坏帧 → error 信封（信封级错误，不是命令失败）', () => {
    const { endpoint } = makeEndpoint();
    const { client, server } = createDuplexPair();
    endpoint.accept(server);

    client.send('{ 这不是 JSON');

    const errors = client.messagesOfType<ErrorMessage>('error');
    expect(errors).toHaveLength(1);
    expect(errors[0].code).toBe('malformed_message');
  });

  it('协议版本不兼容 → error + 断开连接（不降级）', () => {
    const { endpoint } = makeEndpoint();
    const { client, server } = createDuplexPair();
    endpoint.accept(server);

    client.send(JSON.stringify({ type: 'hello', protocolVersion: 999, clientId: 'electron-x' }));

    const errors = client.messagesOfType<ErrorMessage>('error');
    expect(errors).toHaveLength(1);
    expect(errors[0].code).toBe('unsupported_version');
    expect(server.readyState).toBe(3);
    expect(server.closeCode).toBe(1002);
  });

  it('没发 hello 就发命令 → 拒（不认这条连接的写）', async () => {
    const store = createStore();
    const { endpoint } = makeEndpoint({ store });
    const { client, server } = createDuplexPair();
    endpoint.accept(server);

    client.send(forward('cmd-early', { type: 'ui.navigate', screen: 'settings' }));
    await flush();

    expect(client.messagesOfType<CommandAckMessage>('command.ack')).toHaveLength(0);
    const errors = client.messagesOfType<ErrorMessage>('error');
    expect(errors).toHaveLength(1);
    expect(errors[0].commandId).toBe('cmd-early');
    expect(store.getState().currentScreen).toBeUndefined();
  });

  it('心跳：没回 pong 的连接被踢掉（死链清理）', async () => {
    const { endpoint } = makeEndpoint({ heartbeatIntervalMs: 20 });
    const { client, server } = createDuplexPair();
    server.autoPong = false; // 模拟死链
    endpoint.accept(server);
    client.send(hello('electron-dead'));

    await wait(120);

    expect(server.terminateCount).toBeGreaterThanOrEqual(1);
    expect(endpoint.clientCount).toBe(0);
  });

  it('断连后不再收到广播（会话已清理）', async () => {
    const store = createStore();
    const { endpoint } = makeEndpoint({ store, snapshotThrottleMs: 20 });
    const { client, server } = createDuplexPair();
    endpoint.accept(server);
    client.send(hello('electron-1'));
    const before = client.messagesOfType<SnapshotMessage>('snapshot').length;

    client.close(); // 客户端断开 → 服务端收到 close
    await wait(10);
    expect(endpoint.clientCount).toBe(0);

    store.setState((state) => ({ ...state, notices: [...state.notices, makeNotice('n-after')] }));
    await wait(50);
    expect(client.messagesOfType<SnapshotMessage>('snapshot').length).toBe(before);
  });
});
