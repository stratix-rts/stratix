/**
 * 文件职责：**远程 store 的单测**（前后端分离 B3 / task_083）—— 四条路径全覆盖：
 *   ① 快照覆盖（全量替换，不做增量合并；编组 Map 无损还原）；
 *   ② 断线重连（指数退避 → 重连 → 重新 hello → 新快照覆盖，stale 解除）；
 *   ③ 命令发送（emitCommand → command.forward 信封；回执按 commandId 结算；未连接时不发出）；
 *   ④ stale 标志（未连上 / 收到快照 / 再断开三态）；
 *   ⑤ 屏位归属（@since v3.10，task_153：屏位是客户端自己的视图状态，不被 service 的共享值串台）。
 * 输入：内存 WebSocket 替身（**不起真端口**、不连真 service）+ 协议层构造助手（B1 产物）。
 * 输出：逐条断言（任一失败即红）。
 * 禁止事项：
 *   1. 起真端口 / 连真 service —— 单测只验客户端侧语义（服务端语义由 B2 的端点单测覆盖）；
 *   2. 用真实计时器等退避 —— 退避用 jest 假计时器推进（确定性、不拖时间）。
 */

import { createInitialState } from '../../../../core/store';
import type { WorldState } from '../../../../core/types';
import { createSnapshotMessage } from '../../../../stratix-gateway/api/websocket/world-sync/protocol';
import {
  createRemoteStore,
  type RemoteCommandResult,
  type RemoteSocket,
  type RemoteStore,
} from '../remote-store';

// ---------------------------------------------------------------------------
// 内存 WebSocket 替身
// ---------------------------------------------------------------------------

class MockSocket implements RemoteSocket {
  onopen: ((event: unknown) => void) | null = null;
  onmessage: ((event: { readonly data: unknown }) => void) | null = null;
  onclose: ((event: unknown) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  /** 已发出的原始帧。 */
  readonly sent: string[] = [];
  /** 是否已被关闭。 */
  closed = false;

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.closed = true;
  }

  /** 模拟连接建立。 */
  open(): void {
    this.onopen?.({});
  }

  /** 模拟收到一帧（协议消息对象）。 */
  deliver(message: unknown): void {
    this.onmessage?.({ data: JSON.stringify(message) });
  }

  /** 模拟断连。 */
  drop(): void {
    this.onclose?.({});
  }

  /** 已发出的消息（解析后）。 */
  sentMessages(): Array<Record<string, unknown>> {
    return this.sent.map((raw) => JSON.parse(raw) as Record<string, unknown>);
  }
}

/** 造一份带单位的 WorldState（编组走 Map —— wire 层会摊平成数组）。 */
function stateWithUnits(unitIds: readonly string[]): WorldState {
  return {
    ...createInitialState(),
    units: unitIds.map((id) => ({
      id,
      name: id.toUpperCase(),
      status: 'idle' as const,
      missionId: null,
      power: 0,
    })),
    selectionGroups: new Map([[1, [...unitIds]]]),
  };
}

/** 建一个带内存 socket 的远程 store。 */
function setup(options: {
  readonly onCommandResult?: (result: RemoteCommandResult) => void;
}): { readonly store: RemoteStore; readonly sockets: MockSocket[] } {
  const sockets: MockSocket[] = [];
  const store = createRemoteStore('ws://127.0.0.1:0/ws/world-sync', {
    createSocket: () => {
      const socket = new MockSocket();
      sockets.push(socket);
      return socket;
    },
    reconnectDelayMs: 500,
    ...(options.onCommandResult ? { onCommandResult: options.onCommandResult } : {}),
  });
  return { store, sockets };
}

describe('createRemoteStore（前后端分离 B3：Electron 远程 store）', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('① 快照覆盖：收到 snapshot 就整体替换本地视图（不做增量合并）并广播给订阅者', () => {
    const { store, sockets } = setup({});
    const seen: WorldState[] = [];
    const unsubscribe = store.subscribe((state) => seen.push(state));

    expect(sockets).toHaveLength(1);
    const socket = sockets[0];
    socket.open();

    // 连接建立后第一件事就是 hello（协议 §4.1：注册）
    const hello = socket.sentMessages()[0];
    expect(hello.type).toBe('hello');
    expect(hello.protocolVersion).toBe(1);
    expect(typeof hello.clientId).toBe('string');

    // 第一份快照
    socket.deliver(createSnapshotMessage(7, stateWithUnits(['u1', 'u2'])));
    expect(store.getState().units.map((u) => u.id)).toEqual(['u1', 'u2']);
    expect(store.getSeq()).toBe(7);
    // 编组经 wire 层摊平再还原回 Map（无损）
    expect(store.getState().selectionGroups?.get(1)).toEqual(['u1', 'u2']);

    // 第二份快照：全量覆盖 —— 旧单位不残留（合并语义会被这里抓住）
    socket.deliver(createSnapshotMessage(9, stateWithUnits(['u3'])));
    expect(store.getState().units.map((u) => u.id)).toEqual(['u3']);
    expect(store.getSeq()).toBe(9);

    expect(seen).toHaveLength(2);
    expect(seen[1].units.map((u) => u.id)).toEqual(['u3']);

    unsubscribe();
    socket.deliver(createSnapshotMessage(10, stateWithUnits(['u4'])));
    expect(seen).toHaveLength(2); // 退订后不再收到
    store.dispose();
  });

  it('② 断线重连：断开后保留最后快照并标记 stale，退避后重连并重新 hello', () => {
    const { store, sockets } = setup({});
    sockets[0].open();
    sockets[0].deliver(createSnapshotMessage(1, stateWithUnits(['u1'])));
    expect(store.isStale()).toBe(false);

    // 断连
    sockets[0].drop();
    expect(store.isStale()).toBe(true);
    // 铁律 4：断连时返回**最后一份快照**，不返回空态、不抛错
    expect(store.getState().units.map((u) => u.id)).toEqual(['u1']);

    // 未到退避时间不重连
    jest.advanceTimersByTime(400);
    expect(sockets).toHaveLength(1);

    // 退避到点 → 重连
    jest.advanceTimersByTime(100);
    expect(sockets).toHaveLength(2);
    sockets[1].open();
    const hello = sockets[1].sentMessages()[0];
    expect(hello.type).toBe('hello');

    // 重连后收到新快照 → 全量覆盖 + stale 解除
    sockets[1].deliver(createSnapshotMessage(2, stateWithUnits(['u2'])));
    expect(store.isStale()).toBe(false);
    expect(store.getState().units.map((u) => u.id)).toEqual(['u2']);

    store.dispose();
  });

  it('③ 命令发送：emitCommand 转 command.forward，回执按 commandId 结算', () => {
    const results: RemoteCommandResult[] = [];
    const { store, sockets } = setup({ onCommandResult: (result) => results.push(result) });
    const socket = sockets[0];
    socket.open();

    const commandId = store.emitCommand({ type: 'ui.navigate', screen: 'settings' });
    const forwarded = socket.sentMessages().find((m) => m.type === 'command.forward');
    expect(forwarded).toBeDefined();
    expect(forwarded?.commandId).toBe(commandId);
    expect(forwarded?.command).toEqual({ type: 'ui.navigate', screen: 'settings' });

    // 回执结算（点对点，按 commandId 对账）
    socket.deliver({ type: 'command.ack', commandId, ok: true, seq: 42 });
    expect(results).toHaveLength(1);
    expect(results[0]).toEqual({ commandId, ok: true, seq: 42 });

    // 未连接时：不发出、不排队，如实报失败（绝不假装成功）
    socket.drop();
    const beforeCount = socket.sentMessages().length;
    const offlineId = store.emitCommand({ type: 'ui.navigate', screen: 'main' });
    expect(socket.sentMessages()).toHaveLength(beforeCount);
    expect(results).toHaveLength(2);
    expect(results[1].ok).toBe(false);
    expect(results[1].commandId).toBe(offlineId);
    expect(results[1].error?.code).toBe('internal_error');
    expect(results[1].error?.stale).toBe(true);

    store.dispose();
  });

  it('⑤ 屏位是**客户端自己的**：快照里的共享屏位不串台；本端跳屏立即本地生效', () => {
    const { store, sockets } = setup({});
    const socket = sockets[0];
    socket.open();

    // 快照里带着 service **共享** store 的屏位（别的客户端切到了设置屏）
    socket.deliver(
      createSnapshotMessage(1, { ...stateWithUnits(['u1']), currentScreen: 'settings' }),
    );
    // 本端没跳过屏 → 留在主屏（不被串台拽走）
    expect(store.getState().currentScreen).toBeUndefined();

    // 本端跳到设置屏 → 立即本地生效（不等回执往返）
    store.emitCommand({ type: 'ui.navigate', screen: 'settings' });
    expect(store.getState().currentScreen).toBe('settings');

    // 之后来的快照（共享值是别的屏）也不改本端屏位
    socket.deliver(
      createSnapshotMessage(2, { ...stateWithUnits(['u1']), currentScreen: 'character' }),
    );
    expect(store.getState().currentScreen).toBe('settings');

    // 回主屏（'main' 与 core 同口径 = 不写屏位字段）
    store.emitCommand({ type: 'ui.navigate', screen: 'main' });
    expect(store.getState().currentScreen).toBeUndefined();

    store.dispose();
  });

  it('④ stale 标志：未连上 / 收到快照 / 再断开 三态如实切换', () => {
    const { store, sockets } = setup({});
    const socket = sockets[0];

    // 还没连上 → 视图不可信（绝不假装正常）
    expect(store.isStale()).toBe(true);
    expect(store.isConnected()).toBe(false);

    // 连上了但还没收到快照 → 仍然不可信（没有真相）
    socket.open();
    expect(store.isConnected()).toBe(true);
    expect(store.isStale()).toBe(true);

    // 收到快照 → 可信
    socket.deliver(createSnapshotMessage(1, stateWithUnits(['u1'])));
    expect(store.isStale()).toBe(false);

    // 再断开 → 不可信，但快照还在
    socket.drop();
    expect(store.isStale()).toBe(true);
    expect(store.getState().units.map((u) => u.id)).toEqual(['u1']);

    store.dispose();
  });
});
