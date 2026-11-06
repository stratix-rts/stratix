/**
 * 文件职责：**远程 store 的单测**（前后端分离 B3 / task_083）—— 四条路径全覆盖：
 *   ① 快照覆盖（全量替换，不做增量合并；编组 Map 无损还原）；
 *   ② 断线重连（指数退避 → 重连 → 重新 hello → 新快照覆盖，stale 解除）；
 *   ③ 命令发送（emitCommand → command.forward 信封；回执按 commandId 结算；未连接时不发出）；
 *   ④ stale 标志（未连上 / 收到快照 / 再断开三态）；
 *   ⑤ 屏位归属（@since v3.10，task_153：屏位是客户端自己的视图状态，不被 service 的共享值串台）。
 *   ⑥ 事件面（@since v3.3，task_156：emitWorldEvent → event.forward；白名单外的事件不上行）。
 *   ⑦ 下行事件面（@since v3.3，task_216 / IX-02：event.push → 喂回本地 core 总线；
 *      且 unit.position **不上行** ⇒ 不回环）。
 * 输入：内存 WebSocket 替身（**不起真端口**、不连真 service）+ 协议层构造助手（B1 产物）。
 * 输出：逐条断言（任一失败即红）。
 * 禁止事项：
 *   1. 起真端口 / 连真 service —— 单测只验客户端侧语义（服务端语义由 B2 的端点单测覆盖）；
 *   2. 用真实计时器等退避 —— 退避用 jest 假计时器推进（确定性、不拖时间）。
 */

import { onWorldEvent } from '../../../../core/bus';
import { createInitialState } from '../../../../core/store';
import type { WorldEvent, WorldState } from '../../../../core/types';
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
    // @since v3.3（task_156）：协议升到 2（新增 event.forward 消息型）。
    // @since v3.3（task_216 / IX-02）：协议升到 3（新增 event.push 下行消息型）。
    expect(hello.protocolVersion).toBe(3);
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

  it('⑥ 事件面（@since v3.3，task_156）：白名单内的世界事件转 event.forward 上行', () => {
    const { store, sockets } = setup({});
    const socket = sockets[0];
    socket.open();

    // 状态语义事件 → 上行
    const sent = store.emitWorldEvent({
      type: 'unit.click',
      unitId: 'u1',
      mods: { shift: false, ctrl: false, meta: false, alt: false },
    });
    expect(sent).toBe(true);
    const forwarded = socket.sentMessages().find((m) => m.type === 'event.forward');
    expect(forwarded).toBeDefined();
    expect(forwarded?.event).toEqual({
      type: 'unit.click',
      unitId: 'u1',
      mods: { shift: false, ctrl: false, meta: false, alt: false },
    });

    // 纯视图事件 → 不上行（service 不需要相机姿态，别拿视图态污染真相）
    const before = socket.sentMessages().length;
    const viewSent = store.emitWorldEvent({
      type: 'camera.moved',
      center: { x: 1, y: 2 },
      zoom: 1,
    });
    expect(viewSent).toBe(false);
    expect(socket.sentMessages()).toHaveLength(before);

    store.dispose();
  });

  it('⑥′ 未连接时事件不上行（不排队、不补发 —— 如实失败）', () => {
    const { store, sockets } = setup({});
    const socket = sockets[0];
    socket.open();
    socket.drop(); // 断连

    const sent = store.emitWorldEvent({
      type: 'unit.click',
      unitId: 'u1',
      mods: { shift: false, ctrl: false, meta: false, alt: false },
    });
    expect(sent).toBe(false);
    // 断连前发出的那一条还在（不补发第二条）
    const forwards = socket.sentMessages().filter((m) => m.type === 'event.forward');
    expect(forwards).toHaveLength(0);

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

  // ---------------------------------------------------------------------------
  // ⑦ 下行事件面（@since v3.3，task_216 / IX-02）：event.push → 喂回本地 core 总线
  // ---------------------------------------------------------------------------

  it('⑦ event.push → 喂回本地 core 总线（tween / 小地图 / 落库三处自动恢复的源头）', () => {
    const pushed: WorldEvent[] = [];
    const sockets: MockSocket[] = [];
    const store = createRemoteStore('ws://127.0.0.1:0/ws/world-sync', {
      createSocket: () => {
        const socket = new MockSocket();
        sockets.push(socket);
        return socket;
      },
      onPushedEvent: (event) => pushed.push(event),
    });
    sockets[0].open();

    sockets[0].deliver({
      type: 'event.push',
      event: { type: 'unit.position', unitId: 'unit_c1', x: 300, y: 400 },
    });

    // 载荷**原样**喂回本地总线（不加工、不丢字段 —— 位置真相一个字节都不能改）
    expect(pushed).toEqual([{ type: 'unit.position', unitId: 'unit_c1', x: 300, y: 400 }]);

    store.dispose();
  });

  it('⑦′ 缺省落地口是**本地 core 总线**（不注入时也喂回总线）', () => {
    const seen: WorldEvent[] = [];
    const unsubscribe = onWorldEvent((event) => seen.push(event));
    const { store, sockets } = setup({});
    sockets[0].open();

    sockets[0].deliver({
      type: 'event.push',
      event: { type: 'unit.position', unitId: 'unit_c1', x: 10, y: 20 },
    });

    expect(seen).toEqual([{ type: 'unit.position', unitId: 'unit_c1', x: 10, y: 20 }]);

    unsubscribe();
    store.dispose();
  });

  it('⑦″ ★ 防回环：下行推来的 unit.position **不会**被上行转发（不回灌给 service）', () => {
    const { store, sockets } = setup({});
    const socket = sockets[0];
    socket.open();

    // service 推来一条 unit.position → 喂回本地总线
    socket.deliver({
      type: 'event.push',
      event: { type: 'unit.position', unitId: 'unit_c1', x: 300, y: 400 },
    });

    // 本地转发器（组合根那侧）把总线上的事件再走一遍上行面 —— unit.position 不在上行白名单
    //   ⇒ 直接拒（返回 false、不上行）⇒ 不会 service→client→service 绕圈。
    const forwarded = store.emitWorldEvent({
      type: 'unit.position',
      unitId: 'unit_c1',
      x: 300,
      y: 400,
    });
    expect(forwarded).toBe(false);

    const eventForwards = socket.sentMessages().filter((m) => m.type === 'event.forward');
    expect(eventForwards).toHaveLength(0);

    store.dispose();
  });
});
