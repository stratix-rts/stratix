/**
 * 回归测试：M1-15「world-sync 不动 + 回归验证」（task_189 / demo/v3.3）—— **缺字段路径**。
 *
 * 权威定义：docs/DESIGN-project-map.md §7.1 表格「M1-15」行验收③：
 *   「remote-store 收到的快照缺 projectInstances 时**不报错**、**不退化为默认沙盒卡**」。
 *
 * why 这条要有测试：WorldState.projectInstances 是 M1-01 才加进 core 契约的**可选**字段，
 *   缺省时读方**必须**渲染「明确空态」（core/types.ts 该字段的注释原话：否则老客户端 /
 *   单测夹具 / remote-store 收到别的进程的快照时会把用户锁死）。
 *   本文件钉住这条：缺字段 ⇒ 不抛错、不注入默认沙盒、大厅模型是**空态**（零卡片）。
 *
 * ★ 本文件**只加断言、不改协议**：被测的 remote-store 与大厅模型派生都是生产实现，
 *   连接用内存 socket 替身（不起真端口、不连真 TCP）。
 */

import { createInitialState } from '../../../../core/store';
import {
  DEFAULT_INSTANCE_ID,
  type ProjectInstanceView,
  type UnitView,
  type WorldState,
} from '../../../../core/types';
import { resolveLobbyPanel } from '../../../../hud/screens/lobby-catalog';
import {
  createSnapshotMessage,
  type SnapshotMessage,
} from '../../../../stratix-gateway/api/websocket/world-sync/protocol';

import { createRemoteStore, type RemoteSocket } from '../remote-store';

// ---------------------------------------------------------------------------
// 夹具
// ---------------------------------------------------------------------------

/** 内存 socket 替身（只覆盖 remote-store 用到的那几条通道）。 */
class MockSocket implements RemoteSocket {
  onopen: ((event: unknown) => void) | null = null;
  onmessage: ((event: { readonly data: unknown }) => void) | null = null;
  onclose: ((event: unknown) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  readonly sent: string[] = [];
  closed = false;

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.closed = true;
  }

  /** 连接建立（触发 hello）。 */
  open(): void {
    this.onopen?.({});
  }

  /** service 推来一帧。 */
  deliver(message: unknown): void {
    const text = typeof message === 'string' ? message : JSON.stringify(message);
    this.onmessage?.({ data: text });
  }
}

function makeUnit(id: string): UnitView {
  return { id, name: id, status: 'idle', missionId: null, power: 10 };
}

/** 默认沙盒卡（注册表里的那条真实记录，M1-07 物化）。 */
function sandboxView(): ProjectInstanceView {
  return {
    instanceId: DEFAULT_INSTANCE_ID,
    projectId: 'spx_sandbox',
    path: '/tmp/wsp_sandbox',
    title: '默认沙盒',
    lastOpenedAt: 0,
    pinned: false,
    archived: false,
    status: 'idle',
    sandbox: true,
  };
}

// ---------------------------------------------------------------------------
// 用例
// ---------------------------------------------------------------------------

describe('M1-15 remote-store：快照缺 projectInstances（§7.1 验收③）', () => {
  const stores: Array<{ dispose(): void }> = [];
  const logs: string[] = [];

  afterEach(() => {
    for (const store of stores.splice(0)) store.dispose();
    logs.length = 0;
  });

  /** 起一个连着的 remote-store（内存 socket）。 */
  function setup(): { socket: MockSocket; store: ReturnType<typeof createRemoteStore> } {
    const socket = new MockSocket();
    const store = createRemoteStore('ws://127.0.0.1:0/ws/world-sync', {
      clientId: 'electron-m1-15',
      createSocket: () => socket,
      reconnectDelayMs: 500,
      logger: (line) => { logs.push(line); },
    });
    stores.push(store);
    socket.open();
    return { socket, store };
  }

  it('缺 projectInstances 的快照：不报错、不注入默认沙盒、大厅模型是明确空态（零卡片）', () => {
    const { socket, store } = setup();

    // 老 service / 别的进程发来的快照：**没有 projectInstances**（M1-01 之前的世界态形状）。
    const legacyState: WorldState = {
      ...createInitialState(),
      units: [makeUnit('u-x')],
    };
    const snapshot: SnapshotMessage = createSnapshotMessage(1, legacyState);
    expect('projectInstances' in snapshot.state).toBe(false);

    // 不抛错（解码失败会被吞掉并记日志 —— 这里断言日志里没有解码失败）。
    expect(() => socket.deliver(snapshot)).not.toThrow();
    expect(logs.some((line) => line.includes('解码失败'))).toBe(false);

    // 快照**真的落地**了（不是被丢弃的空态）。
    const state = store.getState();
    expect(state.units.map((unit) => unit.id)).toEqual(['u-x']);
    expect(store.isStale()).toBe(false);

    // ★ 不退化为默认沙盒：本地状态里**没有** projectInstances，也没有被塞一个默认沙盒进来。
    expect(state.projectInstances).toBeUndefined();
    expect(state.activeInstanceId).toBeUndefined();

    // ★ 大厅模型是**明确空态**（零卡片、派单入口禁用）—— 不是一张默认沙盒卡。
    const panel = resolveLobbyPanel(state);
    expect(panel.empty).toBe(true);
    expect(panel.cards).toHaveLength(0);
    expect(panel.dispatchEnabled).toBe(false);
    expect(panel.dispatchTargetId).toBeNull();
    expect(panel.cards.some((card) => card.sandbox)).toBe(false);
    expect(panel.cards.some((card) => card.instanceId === DEFAULT_INSTANCE_ID)).toBe(false);
  });

  it('带 projectInstances 的快照：照常渲染卡片（空态来自「缺字段」，不是管道坏了）', () => {
    const { socket, store } = setup();

    const state: WorldState = {
      ...createInitialState(),
      activeInstanceId: 'inst_b',
      projectInstances: [sandboxView()],
    };
    socket.deliver(createSnapshotMessage(1, state));

    const panel = resolveLobbyPanel(store.getState());
    expect(panel.empty).toBe(false);
    expect(panel.cards).toHaveLength(1);
    expect(panel.cards[0].instanceId).toBe(DEFAULT_INSTANCE_ID);
    expect(panel.cards[0].sandbox).toBe(true);
    expect(panel.dispatchEnabled).toBe(true);
    expect(panel.dispatchTargetId).toBe(DEFAULT_INSTANCE_ID);
  });
});
