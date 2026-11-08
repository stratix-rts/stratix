/**
 * 单测：world-sync 的**快照节流 + 关键事件旁路**（@since v3.3，task_231 / PERF-02）。
 *
 * 覆盖（对齐任务验收）：
 *   ① 关键结构变化（进副本 / 退副本 / 单位上场 / 单位移除）**不等节流窗**，立即发一帧快照；
 *   ② 高频变化（提示等表现态）照旧按节流窗**合并**（缺省窗 = 25ms ⇒ N 次变更 ⇒ 1 帧）。
 *
 * why ① 的节流窗故意开很大（1000ms）：那一帧只可能来自**旁路**，
 *   不可能是「等窗等到期」—— 两者必须可区分，否则这条用例测不出旁路。
 *
 * 传输层用**注入式内存 duplex socket**（不起真端口、不连真 TCP）——
 *   见 __tests__/helpers/memory-socket.ts。
 */

import { createStore } from '@/core/store';
import type { Notice, UnitView } from '@/core/types';

import { WORLD_SYNC_SNAPSHOT_THROTTLE_MS, WorldSyncEndpoint } from '../endpoint';
import { WORLD_SYNC_PROTOCOL_VERSION, type SnapshotMessage } from '../protocol';

import { createDuplexPair, wait } from './helpers/memory-socket';

// ---------------------------------------------------------------------------
// 夹具
// ---------------------------------------------------------------------------

function makeUnit(id: string): UnitView {
  return { id, name: id, status: 'idle', missionId: null, power: 10 };
}

function makeNotice(id: string): Notice {
  const at = Date.now();
  return { id, level: 'info', text: `通知 ${id}`, createdAt: at, expiresAt: at + 60_000, source: 'test' };
}

/** 空实体集（切副本时 store 被整份替换成的样子）。 */
function emptyEntities() {
  return { missions: [], tasks: [], sessions: [], characters: [], units: [] };
}

/** hello 报文。 */
function hello(clientId: string): string {
  return JSON.stringify({
    type: 'hello',
    protocolVersion: WORLD_SYNC_PROTOCOL_VERSION,
    clientId,
  });
}

// ---------------------------------------------------------------------------
// 用例
// ---------------------------------------------------------------------------

describe('world-sync 快照节流与关键事件旁路（task_231 / PERF-02）', () => {
  const endpoints: WorldSyncEndpoint[] = [];

  const makeEndpoint = (
    options: Partial<ConstructorParameters<typeof WorldSyncEndpoint>[0]> = {},
  ) => {
    const store = options.store ?? createStore();
    const endpoint = new WorldSyncEndpoint({
      store,
      dispatch: () => {}, // 本单不测命令面（端点只发快照）
      heartbeatIntervalMs: 0,
      logger: () => {}, // 单测不刷日志
      ...options,
    });
    endpoints.push(endpoint);
    return { endpoint, store };
  };

  afterEach(() => {
    for (const endpoint of endpoints.splice(0)) endpoint.close();
  });

  it('① 关键结构变化不等节流窗：进副本 / 退副本 / 单位上场 / 单位移除都立即发一帧', () => {
    const store = createStore();
    // 节流窗开成 1000ms ⇒ 这一帧只可能来自旁路（等窗根本等不到）。
    const { endpoint } = makeEndpoint({ store, snapshotThrottleMs: 1000 });
    const { client, server } = createDuplexPair();
    endpoint.accept(server);
    client.send(hello('c-structural'));

    expect(client.messagesOfType<SnapshotMessage>('snapshot')).toHaveLength(1); // hello 那帧

    // 进副本：激活实例变了 ⇒ 立刻一帧（同步到达，不等窗）。
    store.setState((state) => ({ ...state, activeInstanceId: 'wsp_sandbox' }));
    const afterEnter = client.messagesOfType<SnapshotMessage>('snapshot');
    expect(afterEnter).toHaveLength(2);
    expect(afterEnter[1].state.activeInstanceId).toBe('wsp_sandbox');

    // 退副本：激活实例回 null ⇒ 立刻又一帧。
    store.setState((state) => ({ ...state, activeInstanceId: null }));
    expect(client.messagesOfType<SnapshotMessage>('snapshot')).toHaveLength(3);

    // 单位上场：单位集合变了 ⇒ 立刻一帧。
    store.replaceEntities({ ...emptyEntities(), units: [makeUnit('u-1')] });
    const afterDeploy = client.messagesOfType<SnapshotMessage>('snapshot');
    expect(afterDeploy).toHaveLength(4);
    expect(afterDeploy[3].state.units.map((unit) => unit.id)).toEqual(['u-1']);

    // 单位移除：单位集合又变了 ⇒ 立刻一帧。
    store.replaceEntities(emptyEntities());
    const afterRemove = client.messagesOfType<SnapshotMessage>('snapshot');
    expect(afterRemove).toHaveLength(5);
    expect(afterRemove[4].state.units).toEqual([]);
  });

  it('② 高频变化照旧按 25ms 窗合并（5 次变更 ⇒ 1 帧）', async () => {
    // 缺省窗已从 100ms 收到 25ms（点「进入」→ 生效不再白等一窗）。
    expect(WORLD_SYNC_SNAPSHOT_THROTTLE_MS).toBe(25);

    const store = createStore();
    const { endpoint } = makeEndpoint({ store }); // 用缺省窗（25ms）
    const { client, server } = createDuplexPair();
    endpoint.accept(server);
    client.send(hello('c-throttle'));

    expect(client.messagesOfType<SnapshotMessage>('snapshot')).toHaveLength(1);

    // 5 次高频表现态变更（提示）⇒ 窗口内合并成一帧。
    for (let i = 0; i < 5; i += 1) store.pushNotice(makeNotice(`n-${i}`));
    // 同步时刻：还没到窗 ⇒ 一帧都没多发。
    expect(client.messagesOfType<SnapshotMessage>('snapshot')).toHaveLength(1);

    await wait(80); // > 25ms 窗
    const snapshots = client.messagesOfType<SnapshotMessage>('snapshot');
    expect(snapshots).toHaveLength(2); // 5 次变更 ⇒ 合并成 1 帧（不是 5 帧）
    expect(snapshots[1].state.notices).toHaveLength(5);
  });
});
