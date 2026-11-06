/**
 * 单测：world-sync 协议契约层（task_081；@since v3.3 task_156：event.forward 事件面；
 *   @since v3.3 task_216 / IX-02：event.push **下行**事件面）。
 * 覆盖：消息型的类型守卫（合法 / 非法样例各 ≥2）、编解码纯函数、编组槽位 wire 互转、协议常量、
 *   上下行白名单的**互斥**不变式（防回环）。
 */

import type { WorldEvent, WorldState } from '@/core/types';

import {
  FORWARDABLE_WORLD_EVENT_TYPES,
  PUSHABLE_WORLD_EVENT_TYPES,
  WORLD_SYNC_ACK_TIMEOUT_MS,
  WORLD_SYNC_ERROR_CODES,
  WORLD_SYNC_MESSAGE_TYPES,
  WORLD_SYNC_MIN_PROTOCOL_VERSION,
  WORLD_SYNC_PATH,
  WORLD_SYNC_PROTOCOL_VERSION,
  WORLD_SYNC_SEQ_START,
  createErrorMessage,
  createEventForwardMessage,
  createEventPushMessage,
  createFailedAck,
  createNotAttachedAck,
  createOkAck,
  createSnapshotMessage,
  decodeMessage,
  decodeMessageBytes,
  encodeMessage,
  fromWireState,
  isCommandAckMessage,
  isCommandForwardMessage,
  isErrorMessage,
  isEventForwardMessage,
  isEventPushMessage,
  isForwardableWorldEvent,
  isHelloMessage,
  isHudCommand,
  isPushableWorldEvent,
  isSnapshotMessage,
  isSupportedProtocolVersion,
  isWorldStateWire,
  isWorldSyncErrorCode,
  isWorldSyncMessage,
  toWireState,
} from '../protocol';

// ---------------------------------------------------------------------------
// 夹具
// ---------------------------------------------------------------------------

function makeState(overrides: Partial<WorldState> = {}): WorldState {
  return {
    units: [],
    missions: [],
    selection: { unitIds: [], previewUnitIds: [], revision: 0 },
    characters: [],
    notices: [],
    links: [],
    messages: [],
    ...overrides,
  };
}

const WIRE_STATE = {
  units: [],
  missions: [],
  selection: { unitIds: [], previewUnitIds: [], revision: 0 },
  characters: [],
  notices: [],
  links: [],
  messages: [],
};

// ---------------------------------------------------------------------------
// 常量
// ---------------------------------------------------------------------------

describe('协议常量', () => {
  it('版本与端点路径是冻结值', () => {
    // @since v3.3（task_156）：协议升到 2（新增 event.forward 消息型 —— 升版本是响亮地失败，
    //   好过老 service 悄悄拒收 event.forward 造成「画布全哑」）。
    // @since v3.3（task_216 / IX-02）：协议升到 3（新增 event.push 下行消息型 —— 同一纪律）。
    expect(WORLD_SYNC_PROTOCOL_VERSION).toBe(3);
    expect(WORLD_SYNC_MIN_PROTOCOL_VERSION).toBe(1);
    expect(WORLD_SYNC_PATH).toBe('/ws/world-sync');
    expect(WORLD_SYNC_SEQ_START).toBe(1);
    expect(WORLD_SYNC_ACK_TIMEOUT_MS).toBeGreaterThan(0);
  });

  it('消息类型词表封闭（含 event.forward / event.push），错误码词表封闭', () => {
    expect(WORLD_SYNC_MESSAGE_TYPES).toEqual([
      'hello',
      'snapshot',
      'command.forward',
      'command.ack',
      'event.forward',
      'event.push',
      'error',
    ]);
    expect(WORLD_SYNC_ERROR_CODES).toContain('not_attached');
    expect(WORLD_SYNC_ERROR_CODES).toContain('internal_error');
  });

  it('版本支持判定：区间内通过、越界拒绝', () => {
    expect(isSupportedProtocolVersion(WORLD_SYNC_PROTOCOL_VERSION)).toBe(true);
    expect(isSupportedProtocolVersion(WORLD_SYNC_MIN_PROTOCOL_VERSION)).toBe(true);
    expect(isSupportedProtocolVersion(0)).toBe(false);
    expect(isSupportedProtocolVersion(4)).toBe(false);
    expect(isSupportedProtocolVersion('1')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// hello
// ---------------------------------------------------------------------------

describe('isHelloMessage', () => {
  const valid = { type: 'hello', protocolVersion: 1, clientId: 'client-a' };

  it('合法样例 1/2：最小 hello', () => {
    expect(isHelloMessage(valid)).toBe(true);
  });

  it('合法样例 2：带额外字段（协议允许向前兼容的附加字段）', () => {
    expect(isHelloMessage({ ...valid, role: 'electron' })).toBe(true);
  });

  it('非法样例 1：缺 clientId', () => {
    expect(isHelloMessage({ type: 'hello', protocolVersion: 1 })).toBe(false);
  });

  it('非法样例 2：protocolVersion 不是整数', () => {
    expect(isHelloMessage({ type: 'hello', protocolVersion: '1', clientId: 'c' })).toBe(false);
  });

  it('非法样例 3：类型不是 hello', () => {
    expect(isHelloMessage({ ...valid, type: 'snapshot' })).toBe(false);
  });

  it('非法样例 4：非对象', () => {
    expect(isHelloMessage(null)).toBe(false);
    expect(isHelloMessage('hello')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// snapshot
// ---------------------------------------------------------------------------

describe('isSnapshotMessage', () => {
  const valid = { type: 'snapshot', seq: 1, state: WIRE_STATE };

  it('合法样例 1：最小 snapshot', () => {
    expect(isSnapshotMessage(valid)).toBe(true);
  });

  it('合法样例 2：带预留的 delta=null 字段位', () => {
    expect(isSnapshotMessage({ ...valid, delta: null })).toBe(true);
  });

  it('非法样例 1：seq 不是正整数', () => {
    expect(isSnapshotMessage({ ...valid, seq: 0 })).toBe(false);
    expect(isSnapshotMessage({ ...valid, seq: 1.5 })).toBe(false);
  });

  it('非法样例 2：state 骨架不对（缺数组字段）', () => {
    expect(isSnapshotMessage({ type: 'snapshot', seq: 1, state: { units: [] } })).toBe(false);
  });

  it('非法样例 3：delta 预留位被塞了非 null 值', () => {
    expect(isSnapshotMessage({ ...valid, delta: { units: [] } })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// command.forward
// ---------------------------------------------------------------------------

describe('isCommandForwardMessage', () => {
  const valid = {
    type: 'command.forward',
    commandId: 'cmd-1',
    command: { type: 'unit.select', unitIds: ['u1'], mode: 'set' },
  };

  it('合法样例 1：unit.select', () => {
    expect(isCommandForwardMessage(valid)).toBe(true);
  });

  it('合法样例 2：另一条命令类型', () => {
    expect(
      isCommandForwardMessage({
        type: 'command.forward',
        commandId: 'cmd-2',
        command: { type: 'mission.cancel', missionId: 'm1' },
      }),
    ).toBe(true);
  });

  it('非法样例 1：commandId 为空串', () => {
    expect(isCommandForwardMessage({ ...valid, commandId: '' })).toBe(false);
  });

  it('非法样例 2：命令类型不在册', () => {
    expect(
      isCommandForwardMessage({ ...valid, command: { type: 'unit.teleport', unitId: 'u1' } }),
    ).toBe(false);
  });

  it('非法样例 3：缺 command 字段', () => {
    expect(isCommandForwardMessage({ type: 'command.forward', commandId: 'cmd-3' })).toBe(false);
  });

  it('isHudCommand：只认在册的命令类型名', () => {
    expect(isHudCommand({ type: 'ui.navigate', screen: 'settings' })).toBe(true);
    // @since v3.7(task_130)：'settings.set' 已随契约里的死偏好字段一并移除 —— 偏好走本机持久层。
    expect(isHudCommand({ type: 'settings.set', key: 'soundEnabled', value: true })).toBe(false);
    expect(isHudCommand({ type: 'nope' })).toBe(false);
    expect(isHudCommand('unit.select')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// event.forward（@since v3.3，task_156）
// ---------------------------------------------------------------------------

describe('isEventForwardMessage / isForwardableWorldEvent', () => {
  const click = {
    type: 'unit.click' as const,
    unitId: 'u1',
    mods: { shift: false, ctrl: false, meta: false, alt: false },
  };

  it('合法样例 1：unit.click（点选）', () => {
    expect(isEventForwardMessage({ type: 'event.forward', event: click })).toBe(true);
    expect(isForwardableWorldEvent(click)).toBe(true);
  });

  it('合法样例 2：selection.box（框选，带命中 id）', () => {
    const event = {
      type: 'selection.box',
      bounds: { x: 10, y: 20, width: 100, height: 50 },
      unitIds: ['u1', 'u2'],
      additive: true,
    };
    expect(isForwardableWorldEvent(event)).toBe(true);
    expect(isEventForwardMessage({ type: 'event.forward', event })).toBe(true);
  });

  it('合法样例 3：unit.move（右键移动）与 camera.director（导演开关）', () => {
    expect(
      isForwardableWorldEvent({ type: 'unit.move', unitIds: ['u1'], x: 100, y: 200 }),
    ).toBe(true);
    expect(isForwardableWorldEvent({ type: 'camera.director', enabled: false })).toBe(true);
  });

  it('合法样例 4：unit.chat.open（双击开聊天框 · task_214 / IX-03）', () => {
    const event = { type: 'unit.chat.open', unitId: 'u1' };
    expect(isForwardableWorldEvent(event)).toBe(true);
    expect(isEventForwardMessage({ type: 'event.forward', event })).toBe(true);
    // 形状不对（缺 id / id 非串）⇒ 拒：事件要原样喂进 core 总线，坏形状会炸在它手里。
    expect(isForwardableWorldEvent({ type: 'unit.chat.open' })).toBe(false);
    expect(isForwardableWorldEvent({ type: 'unit.chat.open', unitId: '' })).toBe(false);
  });

  it('非法样例 1：纯视图事件不上行（camera.moved / replay.beat 不在白名单）', () => {
    expect(isForwardableWorldEvent({ type: 'camera.moved', center: { x: 1, y: 2 }, zoom: 1 })).toBe(
      false,
    );
    expect(isForwardableWorldEvent({ type: 'replay.beat', beat: { at: 0, kind: 'reset' } })).toBe(
      false,
    );
    expect(isForwardableWorldEvent({ type: 'fx.sound', cue: { kind: 'click' } })).toBe(false);
    expect(
      isEventForwardMessage({
        type: 'event.forward',
        event: { type: 'camera.moved', center: { x: 1, y: 2 }, zoom: 1 },
      }),
    ).toBe(false);
  });

  it('非法样例 2：形状不对（缺 mods / 坐标非数 / id 非串）', () => {
    expect(isForwardableWorldEvent({ type: 'unit.click', unitId: 'u1' })).toBe(false);
    expect(isForwardableWorldEvent({ type: 'unit.move', unitIds: ['u1'], x: 'NaN', y: 2 })).toBe(
      false,
    );
    expect(isForwardableWorldEvent({ type: 'unit.move', unitIds: [1], x: 1, y: 2 })).toBe(false);
    expect(isForwardableWorldEvent({ type: 'camera.director', enabled: 'yes' })).toBe(false);
  });

  it('非法样例 3：缺 event 字段 / 类型不是 event.forward', () => {
    expect(isEventForwardMessage({ type: 'event.forward' })).toBe(false);
    expect(isEventForwardMessage({ type: 'command.forward', event: click })).toBe(false);
  });

  it('白名单词表：恰好五条状态语义事件（task_214 追加 unit.chat.open）', () => {
    expect(FORWARDABLE_WORLD_EVENT_TYPES).toEqual([
      'unit.click',
      'selection.box',
      'unit.move',
      'camera.director',
      'unit.chat.open',
    ]);
  });

  it('createEventForwardMessage：白名单内造得出、白名单外造不出', () => {
    const message = createEventForwardMessage(click);
    expect(message?.type).toBe('event.forward');
    expect(message?.event).toEqual(click);
    expect(createEventForwardMessage({ type: 'camera.moved', center: { x: 1, y: 2 }, zoom: 1 })).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// event.push（@since v3.3，task_216 / IX-02：service → 客户端的下行事件通道）
// ---------------------------------------------------------------------------

describe('event.push（下行事件面）', () => {
  const position: WorldEvent = { type: 'unit.position', unitId: 'unit_c1', x: 120, y: -40 };

  it('合法样例 1/2：unit.position 判真', () => {
    expect(isPushableWorldEvent(position)).toBe(true);
    expect(isEventPushMessage({ type: 'event.push', event: position })).toBe(true);
  });

  it('合法样例 2：坐标是 0（不是缺失）也判真', () => {
    expect(isPushableWorldEvent({ type: 'unit.position', unitId: 'unit_c1', x: 0, y: 0 })).toBe(
      true,
    );
  });

  it('非法样例 1：形状不对（缺 unitId / 坐标非数 / id 非串）', () => {
    expect(isPushableWorldEvent({ type: 'unit.position', x: 1, y: 2 })).toBe(false);
    expect(isPushableWorldEvent({ type: 'unit.position', unitId: 'u1', x: 'NaN', y: 2 })).toBe(false);
    expect(isPushableWorldEvent({ type: 'unit.position', unitId: 1, x: 1, y: 2 })).toBe(false);
  });

  it('非法样例 2：上行语义的事件不在下行白名单（unit.move / unit.click / camera.moved）', () => {
    expect(isPushableWorldEvent({ type: 'unit.move', unitIds: ['u1'], x: 1, y: 2 })).toBe(false);
    expect(
      isPushableWorldEvent({
        type: 'unit.click',
        unitId: 'u1',
        mods: { shift: false, ctrl: false, meta: false, alt: false },
      }),
    ).toBe(false);
    expect(isPushableWorldEvent({ type: 'camera.moved', center: { x: 1, y: 2 }, zoom: 1 })).toBe(false);
  });

  it('非法样例 3：event.push 信封缺 event / 类型不是 event.push', () => {
    expect(isEventPushMessage({ type: 'event.push' })).toBe(false);
    expect(isEventPushMessage({ type: 'event.forward', event: position })).toBe(false);
  });

  it('白名单词表：下行首批只放 unit.position', () => {
    expect(PUSHABLE_WORLD_EVENT_TYPES).toEqual(['unit.position']);
  });

  it('★ 防回环不变式：上行白名单与下行白名单**互斥**', () => {
    // why：同一事件类型若同时在两边 ⇒ service 推 → 客户端喂回本地总线 → 本地转发器再上行
    //   → service 再推 …… 无限回环。协议层另有编译期断言（UpstreamDownstreamEventOverlap）。
    const upstream = new Set<string>(FORWARDABLE_WORLD_EVENT_TYPES);
    for (const type of PUSHABLE_WORLD_EVENT_TYPES) {
      expect(upstream.has(type)).toBe(false);
    }
    // 反向：上行白名单里的那几条**也不在**下行白名单（首批下行只放 unit.position）
    const downstream = new Set<string>(PUSHABLE_WORLD_EVENT_TYPES);
    for (const type of FORWARDABLE_WORLD_EVENT_TYPES) {
      expect(downstream.has(type)).toBe(false);
    }
    // 关键一条：unit.position **不得**进上行白名单（它是下行的）
    expect(FORWARDABLE_WORLD_EVENT_TYPES).not.toContain('unit.position');
  });

  it('createEventPushMessage：白名单内造得出、白名单外造不出', () => {
    const message = createEventPushMessage(position);
    expect(message?.type).toBe('event.push');
    expect(message?.event).toEqual(position);
    // 上行语义的事件造不出下行信封（防回环的第一道闸）
    expect(createEventPushMessage({ type: 'unit.move', unitIds: ['u1'], x: 1, y: 2 })).toBeNull();
    expect(createEventPushMessage({ type: 'camera.moved', center: { x: 1, y: 2 }, zoom: 1 })).toBeNull();
  });

  it('编解码往返：event.push 能编码也能解回同一条消息', () => {
    const message = createEventPushMessage(position);
    expect(message).not.toBeNull();
    const raw = encodeMessage(message!);
    expect(raw).not.toBeNull();
    const decoded = decodeMessage(raw!);
    expect(decoded.ok).toBe(true);
    if (decoded.ok) {
      expect(decoded.message.type).toBe('event.push');
      expect(decoded.message).toEqual(message);
    }
  });

  it('isWorldSyncMessage 认得 event.push（分派守卫已入册）', () => {
    expect(isWorldSyncMessage({ type: 'event.push', event: position })).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// command.ack
// ---------------------------------------------------------------------------

describe('isCommandAckMessage', () => {
  const ok = { type: 'command.ack', commandId: 'cmd-1', ok: true, seq: 12 };

  it('合法样例 1：成功回执', () => {
    expect(isCommandAckMessage(ok)).toBe(true);
  });

  it('合法样例 2：失败回执（带 error）', () => {
    expect(
      isCommandAckMessage({
        type: 'command.ack',
        commandId: 'cmd-2',
        ok: false,
        seq: null,
        error: { code: 'not_attached', message: '状态面未附着', stale: true },
      }),
    ).toBe(true);
  });

  it('非法样例 1：失败却没有 error（不许假装成功）', () => {
    expect(isCommandAckMessage({ ...ok, ok: false })).toBe(false);
  });

  it('非法样例 2：成功却带 error', () => {
    expect(isCommandAckMessage({ ...ok, error: { code: 'internal_error', message: 'x' } })).toBe(
      false,
    );
  });

  it('非法样例 3：seq 不是正整数也不是 null', () => {
    expect(isCommandAckMessage({ ...ok, seq: 0 })).toBe(false);
    expect(isCommandAckMessage({ ...ok, seq: '12' })).toBe(false);
  });

  it('非法样例 4：error.code 不在词表内', () => {
    expect(
      isCommandAckMessage({
        ...ok,
        ok: false,
        error: { code: 'kaboom', message: 'x' },
      }),
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// error
// ---------------------------------------------------------------------------

describe('isErrorMessage', () => {
  const valid = { type: 'error', code: 'unsupported_version', message: '版本不支持' };

  it('合法样例 1：最小 error', () => {
    expect(isErrorMessage(valid)).toBe(true);
  });

  it('合法样例 2：带 commandId', () => {
    expect(isErrorMessage({ ...valid, commandId: 'cmd-9' })).toBe(true);
  });

  it('非法样例 1：code 不在词表内', () => {
    expect(isErrorMessage({ ...valid, code: 'whatever' })).toBe(false);
  });

  it('非法样例 2：message 为空串', () => {
    expect(isErrorMessage({ ...valid, message: '' })).toBe(false);
  });

  it('非法样例 3：类型不是 error', () => {
    expect(isErrorMessage({ ...valid, type: 'nope' })).toBe(false);
  });

  it('isWorldSyncErrorCode：词表封闭', () => {
    expect(isWorldSyncErrorCode('malformed_message')).toBe(true);
    expect(isWorldSyncErrorCode('MALFORMED_MESSAGE')).toBe(false);
    expect(isWorldSyncErrorCode(42)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 分派守卫
// ---------------------------------------------------------------------------

describe('isWorldSyncMessage', () => {
  it('各消息型都认', () => {
    expect(isWorldSyncMessage({ type: 'hello', protocolVersion: 1, clientId: 'c' })).toBe(true);
    expect(isWorldSyncMessage({ type: 'snapshot', seq: 1, state: WIRE_STATE })).toBe(true);
    expect(
      isWorldSyncMessage({
        type: 'command.forward',
        commandId: 'c1',
        command: { type: 'cache.clear' },
      }),
    ).toBe(true);
    expect(isWorldSyncMessage({ type: 'command.ack', commandId: 'c1', ok: true, seq: 1 })).toBe(
      true,
    );
    expect(
      isWorldSyncMessage({
        type: 'event.forward',
        event: { type: 'unit.click', unitId: 'u1', mods: { shift: false, ctrl: false, meta: false, alt: false } },
      }),
    ).toBe(true);
    expect(isWorldSyncMessage({ type: 'error', code: 'internal_error', message: 'x' })).toBe(true);
  });

  it('词表之外的一律不认', () => {
    expect(isWorldSyncMessage({ type: 'register' })).toBe(false);
    expect(isWorldSyncMessage({})).toBe(false);
    expect(isWorldSyncMessage([])).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 编解码
// ---------------------------------------------------------------------------

describe('encodeMessage / decodeMessage', () => {
  it('往返：各消息型 encode → decode 后字段不变', () => {
    const messages = [
      { type: 'hello', protocolVersion: 1, clientId: 'client-a' },
      { type: 'snapshot', seq: 7, state: WIRE_STATE, delta: null },
      {
        type: 'command.forward',
        commandId: 'cmd-1',
        command: { type: 'unit.select', unitIds: ['u1'], mode: 'toggle' },
      },
      { type: 'command.ack', commandId: 'cmd-1', ok: true, seq: 8 },
      {
        type: 'event.forward',
        event: { type: 'unit.click', unitId: 'u1', mods: { shift: false, ctrl: false, meta: false, alt: false } },
      },
      { type: 'error', code: 'not_attached', message: '状态面未附着' },
    ];
    for (const message of messages) {
      const encoded = encodeMessage(message as never);
      expect(encoded).not.toBeNull();
      const decoded = decodeMessage(encoded as string);
      expect(decoded.ok).toBe(true);
      if (decoded.ok) expect(decoded.message).toEqual(message);
    }
  });

  it('encode：非法消息返回 null 而不是抛', () => {
    expect(encodeMessage({ type: 'snapshot', seq: 0, state: WIRE_STATE } as never)).toBeNull();
    expect(encodeMessage({ type: 'hello' } as never)).toBeNull();
  });

  it('encode：循环引用返回 null（不抛）', () => {
    const cyclic: Record<string, unknown> = { type: 'error', code: 'internal_error', message: 'x' };
    cyclic.self = cyclic;
    expect(encodeMessage(cyclic as never)).toBeNull();
  });

  it('decode：非法 JSON → malformed_message，不抛', () => {
    const result = decodeMessage('{ not json');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('malformed_message');
      expect(result.message.length).toBeGreaterThan(0);
    }
  });

  it('decode：未知消息类型 → unknown_message_type', () => {
    const result = decodeMessage(JSON.stringify({ type: 'register', clientType: 'frontend' }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('unknown_message_type');
  });

  it('decode：类型已知但字段不合法 → malformed_message', () => {
    const result = decodeMessage(JSON.stringify({ type: 'command.ack', commandId: 'c' }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('malformed_message');
  });

  it('decodeMessageBytes：字节流往返；非法字节流不抛', () => {
    const bytes = new TextEncoder().encode(
      JSON.stringify({ type: 'hello', protocolVersion: 1, clientId: 'c' }),
    );
    const decoded = decodeMessageBytes(bytes);
    expect(decoded.ok).toBe(true);

    const bad = decodeMessageBytes(new Uint8Array([0xff, 0xfe, 0xfd]));
    expect(bad.ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 编组槽位 wire 互转
// ---------------------------------------------------------------------------

describe('toWireState / fromWireState', () => {
  it('Map 编组被摊平成数组（JSON 不丢编组）', () => {
    const state = makeState({
      selectionGroups: new Map<number, readonly string[]>([
        [2, ['u1', 'u2']],
        [1, ['u3']],
      ]),
    });
    const wire = toWireState(state);
    expect(Array.isArray(wire.selectionGroups)).toBe(true);
    expect(wire.selectionGroups).toEqual([
      { slot: 1, unitIds: ['u3'] },
      { slot: 2, unitIds: ['u1', 'u2'] },
    ]);
    // 摊平后必须能原样 JSON 化（Map 化会得 {}）
    expect(JSON.parse(JSON.stringify(wire)).selectionGroups).toHaveLength(2);
    expect(isWorldStateWire(wire)).toBe(true);
  });

  it('无编组时摊平成 undefined', () => {
    const wire = toWireState(makeState());
    expect(wire.selectionGroups).toBeUndefined();
    expect(isWorldStateWire(wire)).toBe(true);
  });

  it('往返无损：fromWireState(toWireState(s)) 的编组与原 Map 相等', () => {
    const state = makeState({
      selectionGroups: new Map<number, readonly string[]>([[3, ['a', 'b']]]),
    });
    const back = fromWireState(toWireState(state));
    expect(back.selectionGroups?.get(3)).toEqual(['a', 'b']);
  });

  it('fromWireState：缺省编组 → 空 Map（与 core 初始态一致）', () => {
    const back = fromWireState(WIRE_STATE as never);
    expect(back.selectionGroups?.size).toBe(0);
  });

  it('isWorldStateWire：骨架不对的一律不认', () => {
    expect(isWorldStateWire({ ...WIRE_STATE, units: 'nope' })).toBe(false);
    expect(isWorldStateWire({ ...WIRE_STATE, selectionGroups: [{ slot: 'x', unitIds: [] }] })).toBe(
      false,
    );
    expect(isWorldStateWire(null)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 构造助手
// ---------------------------------------------------------------------------

describe('构造助手', () => {
  it('createSnapshotMessage：自动摊平编组并置 delta=null', () => {
    const state = makeState({ selectionGroups: new Map([[1, ['u1']]]) });
    const message = createSnapshotMessage(3, state);
    expect(message.type).toBe('snapshot');
    expect(message.seq).toBe(3);
    expect(message.delta).toBeNull();
    expect(message.state.selectionGroups).toEqual([{ slot: 1, unitIds: ['u1'] }]);
    expect(isSnapshotMessage(message)).toBe(true);
  });

  it('createNotAttachedAck：seq=null、stale=true、code=not_attached', () => {
    const ack = createNotAttachedAck('cmd-1');
    expect(ack.ok).toBe(false);
    expect(ack.seq).toBeNull();
    expect(ack.error?.code).toBe('not_attached');
    expect(ack.error?.stale).toBe(true);
    expect(isCommandAckMessage(ack)).toBe(true);
  });

  it('createOkAck / createFailedAck：自洽且守卫通过', () => {
    expect(isCommandAckMessage(createOkAck('cmd-1', 5))).toBe(true);
    const failed = createFailedAck('cmd-1', 'internal_error', '命令裁决超时', null, '稍后重试');
    expect(isCommandAckMessage(failed)).toBe(true);
    expect(failed.error?.hint).toBe('稍后重试');
  });

  it('createErrorMessage：带/不带 commandId 两种形态', () => {
    expect(createErrorMessage('malformed_message', '解不开').commandId).toBeUndefined();
    expect(createErrorMessage('malformed_message', '解不开', 'cmd-1').commandId).toBe('cmd-1');
    expect(isErrorMessage(createErrorMessage('malformed_message', '解不开'))).toBe(true);
  });
});
