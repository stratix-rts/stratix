/**
 * 单测：**IX-02 下行事件通道的端到端闭环**（@since v3.3，task_216）。
 *
 * 场景（就是用户实测的那个洞）：远程模式下右击移动 ⇒ 单位不动（无 tween / 无小地图 / 无落库）。
 * 根因：上行全通（event.forward），但 service 侧 core 的**裁决产物**（unit.position）无回程通道。
 * 本单补的就是那条回程：service → client 的 `event.push`。
 *
 * 覆盖（对齐任务验收①）：
 *   右击移动（world 桥接层 → core 总线的 unit.move）
 *     → 上行 event.forward
 *     → service 侧 core runtime 裁决（编队落位）
 *     → 编队终值经 unit.position 广播（service 总线）
 *     → **下行** event.push
 *     → 客户端喂回本地 core 总线
 *     ⇒ ① tween：world 桥接层收到 unit.position（场景据此起 tween —— unit-layer.applyUnitPosition）
 *     ⇒ ② 小地图：位置累积表更新（main-entry.ts:1365 那一路）
 *     ⇒ ③ 落库：unit.position 订阅者把站位写进 unit_positions（game-save-coordinator.ts:214 那一路）
 *   ＋ 防回环：下行推来的 unit.position 不会又上行回 service（否则 service→client→service 绕圈）。
 *
 * ★ 为什么要「两条总线」：生产里 service 与客户端是**两个进程、两条独立总线**。
 *   单进程里若共用一条总线，客户端喂回本地的 unit.position 会被 service 端点的下行订阅
 *   再看到 ⇒ **假回环**（生产里不存在）。故 service 侧用 `jest.isolateModules` 取一份
 *   **独立的** core/bus 单例 —— 那就是「另一个进程」的心智模型。
 *
 * 禁止事项：
 *   1. 起真端口 / 连真 TCP —— 传输层用注入式内存 duplex socket（helpers/memory-socket.ts）；
 *   2. 用 mock 数据充当实现 —— service 侧跑**真的** core runtime（裁决方）与**真的** world
 *      桥接层 / 落库协调器（消费方），只有最末端的 SQLite 那一层是内存实现（无 Node 能力
 *      的渲染侧本来就只能经 IPC 落库 —— 内存实现即那条 IPC 的对端）。
 */

import {
  createGameSaveCoordinator,
  type GameSaveApi,
} from '@/app/services/persistence/game-save-coordinator';
import type { PersistedUnitPosition } from '@/app/services/persistence/game-save-dao';
import { createRemoteStore, type RemoteSocket } from '@/app/services/remote-store';
import { emitState, onWorldEvent } from '@/core/bus';
import { createStore, type CoreStore } from '@/core/store';
import type { CharacterView, UnitView, WorldEvent } from '@/core/types';
import { createWorldBridge, type WorldScenePort } from '@/world/bridge/bus-adapter';

import { createDuplexPair, type MemorySocket } from './helpers/memory-socket';

// ---------------------------------------------------------------------------
// 夹具
// ---------------------------------------------------------------------------

/** 一个战场单位（位置真相不在 UnitView 里 —— 它在 world 层）。 */
function makeUnit(id: string): UnitView {
  return { id, name: id, status: 'idle', missionId: null, power: 10 };
}

/** 一个角色档案（站位落库的键 = character_id；单位 id = `unit_` + character id）。 */
const CHARACTER: CharacterView = {
  id: 'c1',
  name: '测试角色',
  persona: '一个用于端到端验证的角色',
  level: 1,
  experience: 0,
};

/** 客户端侧 store（落库协调器看的那份真相投影）。 */
function makeClientStore(): CoreStore {
  return createStore({ characters: [CHARACTER] });
}

/**
 * 把内存 duplex socket 的「客户端那一端」包成浏览器式 RemoteSocket（remote-store 的连接面）。
 * why 自己包一层：remote-store 面向浏览器原生 WebSocket（onopen/onmessage 属性式），
 *   而传输层的测试替身是 EventEmitter 式（on(...)）—— 这里做**形状**翻译，不改语义。
 */
class BridgedRemoteSocket implements RemoteSocket {
  onopen: ((event: unknown) => void) | null = null;
  onmessage: ((event: { readonly data: unknown }) => void) | null = null;
  onclose: ((event: unknown) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;

  constructor(private readonly peer: MemorySocket) {
    peer.on('message', (data: unknown) => this.onmessage?.({ data }));
    peer.on('close', () => this.onclose?.({}));
    // 真 WebSocket 的 open 是异步的 —— 这里也异步触发（remote-store 装完 onopen 才连得上）。
    queueMicrotask(() => this.onopen?.({}));
  }

  send(data: string): void {
    this.peer.send(data);
  }

  close(code?: number, reason?: string): void {
    this.peer.close(code, reason);
  }
}

/** service 侧（独立总线 = 另一个进程的心智模型）。 */
interface ServiceSide {
  readonly endpoint: { accept: (socket: MemorySocket) => unknown; close: () => void };
  readonly stop: () => void;
}

/**
 * 起一个 service 侧实例：**独立的** core/bus + 真的 core runtime（裁决方）+ 真的 world-sync 端点。
 * why 用 isolateModules：见文件头「为什么要两条总线」。
 */
function startServiceSide(): ServiceSide {
  let side!: ServiceSide;
  jest.isolateModules(() => {
    const bus = require('@/core/bus') as typeof import('@/core/bus');
    const runtimeModule = require('@/core/runtime') as typeof import('@/core/runtime');
    const storeModule = require('@/core/store') as typeof import('@/core/store');
    const endpointModule = require('../endpoint') as typeof import('../endpoint');

    const store = storeModule.createStore({ units: [makeUnit('unit_c1')] });
    const stopRuntime = runtimeModule.createCoreRuntime({ store }).start();
    const endpoint = new endpointModule.WorldSyncEndpoint({
      store,
      dispatch: bus.emitCommand,
      dispatchEvent: bus.emitWorldEvent,
      // 下行事件流：service 侧 core 总线 → 端点广播（生产同源同实例）。
      subscribeWorldEvents: bus.onWorldEvent,
      snapshotThrottleMs: 20,
      ackTimeoutMs: 80,
      heartbeatIntervalMs: 0,
      logger: () => {},
    });
    side = { endpoint, stop: stopRuntime };
  });
  return side;
}

// ---------------------------------------------------------------------------
// 用例
// ---------------------------------------------------------------------------

/** 等条件成立（轮询 + 超时）—— 连接建立与快照到达都是**异步**的。 */
async function waitFor(predicate: () => boolean, timeoutMs = 2_000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error('等待条件超时（连接未就绪）');
    await new Promise<void>((resolve) => setTimeout(resolve, 5));
  }
}

describe('IX-02 下行事件通道（task_216）：右击移动的端到端闭环', () => {
  it('右击移动 → service 裁决 → 下行 event.push → 客户端 tween / 小地图 / 落库三处恢复', async () => {
    const service = startServiceSide();
    const pair = createDuplexPair();
    service.endpoint.accept(pair.server);

    // ===== 客户端侧（= 本地 core 总线那一侧）=====
    const clientStore = makeClientStore();

    // 远端 store（连 service 的那一条）：真实现，只是把 socket 换成内存替身。
    const remote = createRemoteStore('ws://127.0.0.1:0/ws/world-sync', {
      clientId: 'electron-e2e',
      createSocket: () => new BridgedRemoteSocket(pair.client),
      reconnectDelayMs: 10_000,
      logger: () => {},
    });
    // 快照即状态源（main-entry.ts 的那一路）：投影进本地 store + 广播到本地总线。
    const offState = remote.subscribe((state) => {
      clientStore.setState(() => state);
      emitState(state);
    });

    // 上行转发器（main-entry.ts:441 的那一路）：本地总线的事件 → event.forward → service。
    const offForward = onWorldEvent((event) => {
      remote.emitWorldEvent(event);
    });

    // 小地图位置累积表（main-entry.ts:1365 的那一路）。
    const minimapPositions = new Map<string, { x: number; y: number }>();
    const offMinimap = onWorldEvent((event) => {
      if (event.type !== 'unit.position') return;
      minimapPositions.set(event.unitId, { x: event.x, y: event.y });
    });

    // 落库订阅者（game-save-coordinator.ts:214 的那一路）：站位 → unit_positions。
    // ★ 内存 service 实例：最末端那一层（SQLite）用内存实现（渲染侧经 IPC 落库，
    //   这里就是那条 IPC 的对端）—— 其余各层都是**真实现**。
    const savedPositions: PersistedUnitPosition[][] = [];
    const api: GameSaveApi = {
      loadSnapshot: async () => ({ ok: true, characters: [], unitPositions: [] }),
      saveCharacters: async () => ({ ok: true }),
      saveUnitPositions: async (entries) => {
        savedPositions.push([...entries]);
        return { ok: true };
      },
    };
    const coordinator = createGameSaveCoordinator({
      api,
      store: clientStore,
      debounceMs: 10,
    });
    coordinator.start();

    // world 桥接层（真实现）：右击移动 = bridge.unitMove → 本地总线上的 unit.move。
    const syncedPositions: Array<{ unitId: string; x: number; y: number }> = [];
    const port: WorldScenePort = {
      syncUnits: () => {},
      syncSelection: () => {},
      // 场景的 syncUnitPosition → unit-layer.applyUnitPosition（tween 的落点）。
      syncUnitPosition: (unitId, x, y) => {
        syncedPositions.push({ unitId, x, y });
      },
    };
    const bridge = createWorldBridge(port);

    // ===== 触发：用户在战场上右击移动 =====
    // 连接建立是**异步**的（真 WebSocket 的 open → hello → snapshot）—— 等它就绪再交互，
    //   否则上行面会如实拒（未连接不排队），测的就不是这条通道了。
    await waitFor(() => remote.isConnected() && remote.getSeq() !== null);

    bridge.unitMove(['unit_c1'], 300, 400);
    await new Promise<void>((resolve) => setTimeout(resolve, 120));

    // ===== 断言 ⓿：下行通道真的走通了 =====
    const pushes = pair.client.messagesOfType<{ event?: { type?: string } }>('event.push');
    expect(pushes).toHaveLength(1);
    expect(pushes[0].event?.type).toBe('unit.position');

    // ===== 断言 ①：tween（场景收到落位 → 起 tween）=====
    expect(syncedPositions).toEqual([{ unitId: 'unit_c1', x: 300, y: 400 }]);

    // ===== 断言 ②：小地图光点同步移动 =====
    expect(minimapPositions.get('unit_c1')).toEqual({ x: 300, y: 400 });

    // ===== 断言 ③：unit_positions 落库（防抖窗口过后写出去）=====
    expect(savedPositions.flat()).toEqual([
      { characterId: 'c1', x: 300, y: 400 },
    ]);

    // ===== 断言 ④：★ 防回环 —— 下行推来的 unit.position 没有又上行回 service =====
    const forwarded = pair.client
      .sent.map((raw) => JSON.parse(raw) as { type?: string; event?: { type?: string } })
      .filter((message) => message.type === 'event.forward');
    // 只有右击移动那一条上行（unit.move）；unit.position 一条都没有。
    expect(forwarded.map((message) => message.event?.type)).toEqual(['unit.move']);

    // ===== 收尾（资源必须可清理）=====
    bridge.destroy();
    coordinator.stop();
    offForward();
    offMinimap();
    offState();
    remote.dispose();
    service.endpoint.close();
    service.stop();
  });

  it('防回环（协议层）：unit.position **不在**上行白名单 ⇒ 上行面直接拒', () => {
    const remote = createRemoteStore('ws://127.0.0.1:0/ws/world-sync', {
      createSocket: () => new BridgedRemoteSocket(createDuplexPair().client),
      logger: () => {},
    });
    const forwarded = remote.emitWorldEvent({
      type: 'unit.position',
      unitId: 'unit_c1',
      x: 300,
      y: 400,
    });
    expect(forwarded).toBe(false);
    remote.dispose();
  });
});
