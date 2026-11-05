/**
 * 文件职责：world-sync **单连接会话**（WorldSyncSession）的单测 ——
 *   会话只做「解帧 → 按消息型分派 → 回消息」，不含广播与发号（那属端点）。
 *   本文件用**端点端口的假实现**驱动会话，不起真端口（替身见 helpers/memory-socket.ts）。
 *
 * 覆盖重点（@since v3.3，task_156 新增 event.forward 事件面）：
 *   ① hello → 注册 → 端点发一份全量 snapshot；
 *   ② event.forward（白名单内）→ 转交端点 → 投到 service 的 core 总线（载荷原样）；
 *   ③ 未注册的连接发事件 → 拒（不认这条连接的写）+ 不投递；
 *   ④ 白名单外的事件（camera.moved）→ 解不开 → error（malformed_message）+ 不投递；
 *   ⑤ 方向反了的消息型（客户端发 snapshot）→ 拒；
 *   ⑥ command.forward 既有路径不受影响（转交端点 + 回执原样发回）。
 *
 * 禁止事项：
 *   1. 在本文件里真裁决业务 —— 会话层只转交（裁决在 core 状态机，铁律 2）；
 *   2. 起真端口 —— 传输层由 endpoint.test.ts 覆盖，本文件只管分派口径。
 */

import type { HudCommand, WorldEvent } from '@/core/types';
import {
  createSnapshotMessage,
  createOkAck,
  type CommandAckMessage,
  type ForwardableWorldEvent,
  type SnapshotMessage,
  type WorldSyncMessage,
} from '../protocol';
import {
  WorldSyncSession,
  type WorldSyncEndpointPort,
  type WorldSyncSocket,
} from '../session';
import { createDuplexPair, MemorySocket } from './helpers/memory-socket';

// ============================================================================
// 端点端口的假实现（只记调用，不裁决）
// ============================================================================

/** 端点端口的假实现：记录会话交给它的一切。 */
class FakeEndpoint implements WorldSyncEndpointPort {
  attached = true;

  /** 会话请求过的快照数。 */
  snapshotCount = 0;

  /** 会话投递过的命令。 */
  readonly commands: Array<{ commandId: string; command: HudCommand }> = [];

  /** 会话投递过的事件（task_156 事件面）。 */
  readonly events: ForwardableWorldEvent[] = [];

  /** 被释放的会话数。 */
  released = 0;

  issueSnapshot(): SnapshotMessage | null {
    this.snapshotCount += 1;
    return createSnapshotMessage(this.snapshotCount, {
      units: [],
      missions: [],
      characters: [],
      notices: [],
      links: [],
      messages: [],
      selection: { unitIds: [], previewUnitIds: [], revision: 0 },
      selectionGroups: new Map(),
    });
  }

  async dispatchCommand(commandId: string, command: HudCommand): Promise<CommandAckMessage> {
    this.commands.push({ commandId, command });
    return createOkAck(commandId, this.snapshotCount);
  }

  dispatchWorldEvent(event: ForwardableWorldEvent): void {
    this.events.push(event);
  }

  releaseSession(): void {
    this.released += 1;
  }
}

/** 会话 + 假端点 + 内存 socket。 */
function createSession(): {
  readonly session: WorldSyncSession;
  readonly endpoint: FakeEndpoint;
  /** 客户端侧（会话回给它的帧落在这里）。 */
  readonly socket: MemorySocket;
  /** 喂一帧给会话（客户端 → service 方向）。 */
  readonly receive: (raw: string) => Promise<void>;
  /** 会话回给客户端的帧（已解析）。 */
  readonly outbound: () => WorldSyncMessage[];
} {
  // 内存 duplex 对：会话拿服务端那一头，测试读客户端那一头（会话发出去的东西才会到客户端）。
  const pair = createDuplexPair();
  const endpoint = new FakeEndpoint();
  const session = new WorldSyncSession({ socket: pair.server, endpoint });
  return {
    session,
    endpoint,
    socket: pair.client,
    receive: async (raw: string) => {
      await session.handleMessage(raw);
    },
    outbound: () => pair.client.messages<WorldSyncMessage>(),
  };
}

// ============================================================================
// 用例
// ============================================================================

describe('world-sync 会话（WorldSyncSession）：消息型分派', () => {
  test('① hello → 注册 → 端点发一份全量 snapshot', async () => {
    const { endpoint, receive, socket } = createSession();
    await receive(JSON.stringify({ type: 'hello', protocolVersion: 2, clientId: 'c1' }));
    expect(endpoint.snapshotCount).toBe(1);
    const snapshots = socket.messagesOfType<SnapshotMessage>('snapshot');
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0].seq).toBe(1);
  });

  test('② event.forward（白名单内）→ 转交端点 → 投到 service 的 core 总线（载荷原样）', async () => {
    const { endpoint, receive } = createSession();
    await receive(JSON.stringify({ type: 'hello', protocolVersion: 2, clientId: 'c1' }));

    const click: WorldEvent = {
      type: 'unit.click',
      unitId: 'u1',
      mods: { shift: false, ctrl: false, meta: false, alt: false },
    };
    await receive(JSON.stringify({ type: 'event.forward', event: click }));

    // 事件原样到达端点（端点再投 service 的 core 总线，由 runtime 裁决）。
    expect(endpoint.events).toHaveLength(1);
    expect(endpoint.events[0]).toEqual(click);

    // 无回执（fire-and-forget）：事件面不回 ack / 也不回 error。
    expect(endpoint.commands).toHaveLength(0);
  });

  test('②′ 四条白名单事件都能上行（unit.click / selection.box / unit.move / camera.director）', async () => {
    const { endpoint, receive } = createSession();
    await receive(JSON.stringify({ type: 'hello', protocolVersion: 2, clientId: 'c1' }));

    const events: WorldEvent[] = [
      { type: 'unit.click', unitId: 'u1', mods: { shift: false, ctrl: false, meta: false, alt: false } },
      { type: 'selection.box', bounds: { x: 0, y: 0, width: 10, height: 10 }, unitIds: ['u1'] },
      { type: 'unit.move', unitIds: ['u1'], x: 12, y: 34 },
      { type: 'camera.director', enabled: false },
    ];
    for (const event of events) {
      await receive(JSON.stringify({ type: 'event.forward', event }));
    }
    expect(endpoint.events.map((event) => event.type)).toEqual([
      'unit.click',
      'selection.box',
      'unit.move',
      'camera.director',
    ]);
  });

  test('③ 未注册的连接发事件 → 拒（不认这条连接的写）+ 不投递', async () => {
    const { endpoint, receive, socket } = createSession();
    await receive(
      JSON.stringify({
        type: 'event.forward',
        event: { type: 'unit.click', unitId: 'u1', mods: { shift: false, ctrl: false, meta: false, alt: false } },
      }),
    );
    expect(endpoint.events).toHaveLength(0);
    const errors = socket.messagesOfType<{ type: string; code: string }>('error');
    expect(errors).toHaveLength(1);
    expect(errors[0].code).toBe('malformed_message');
  });

  test('④ 白名单外的事件（camera.moved）→ 解不开 → error（malformed_message）+ 不投递', async () => {
    const { endpoint, receive, socket } = createSession();
    await receive(JSON.stringify({ type: 'hello', protocolVersion: 2, clientId: 'c1' }));
    await receive(
      JSON.stringify({
        type: 'event.forward',
        event: { type: 'camera.moved', center: { x: 1, y: 2 }, zoom: 1 },
      }),
    );
    expect(endpoint.events).toHaveLength(0);
    const errors = socket.messagesOfType<{ type: string; code: string }>('error');
    expect(errors).toHaveLength(1);
    expect(errors[0].code).toBe('malformed_message');
  });

  test('⑤ 方向反了的消息型（客户端发 snapshot）→ 拒', async () => {
    const { receive, socket } = createSession();
    await receive(JSON.stringify({ type: 'hello', protocolVersion: 2, clientId: 'c1' }));
    await receive(JSON.stringify({ type: 'snapshot', seq: 99, state: { units: [] } }));
    const errors = socket.messagesOfType<{ type: string; code: string }>('error');
    expect(errors.length).toBeGreaterThanOrEqual(1);
    expect(errors[errors.length - 1].code).toBe('malformed_message');
  });

  test('⑥ command.forward 既有路径不受影响：转交端点 + 回执原样发回', async () => {
    const { endpoint, receive, socket } = createSession();
    await receive(JSON.stringify({ type: 'hello', protocolVersion: 2, clientId: 'c1' }));
    await receive(
      JSON.stringify({
        type: 'command.forward',
        commandId: 'cmd-1',
        command: { type: 'selection.reset' },
      }),
    );
    expect(endpoint.commands).toHaveLength(1);
    expect(endpoint.commands[0].commandId).toBe('cmd-1');
    const acks = socket.messagesOfType<CommandAckMessage>('command.ack');
    expect(acks).toHaveLength(1);
    expect(acks[0].ok).toBe(true);
    expect(acks[0].commandId).toBe('cmd-1');
  });

  test('⑦ 会话关闭后不再发消息（资源已收干净，不对着死链喊话）', async () => {
    const { session, receive, socket } = createSession();
    await receive(JSON.stringify({ type: 'hello', protocolVersion: 2, clientId: 'c1' }));
    const sentBefore = socket.sent.length;
    session.close();
    await receive(
      JSON.stringify({
        type: 'event.forward',
        event: { type: 'unit.click', unitId: 'u1', mods: { shift: false, ctrl: false, meta: false, alt: false } },
      }),
    );
    expect(socket.sent.length).toBe(sentBefore);
  });
});
