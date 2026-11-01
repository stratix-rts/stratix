/**
 * 单测：单会话状态机（core/agent-link/session.ts）—— 创建 / 恢复 / 关闭 / 重连 + 事件回传。
 *
 * 对端用 helpers/gateway-double.ts：**真协议收发**，不是"让 mock 返回我期望的值"。
 * 超时与退避全部压到毫秒级（FAST_TIMING），因此用例跑的是真实异步流程，
 * 不用手工推进 fake timers —— 定时器行为本身就是被测对象之一。
 */

import { createGatewayDouble, type GatewayDouble } from './helpers/gateway-double';
import { createAgentLinkSession, MAX_PENDING_REQUESTS, type AgentLinkSession } from '../session';
import type { AgentLinkSessionEvent } from '../types';

const ENDPOINT = 'http://127.0.0.1:18080';

const FAST_TIMING = {
  requestTimeoutMs: 50,
  connectTimeoutMs: 50,
  maxReconnectAttempts: 3,
  baseReconnectDelayMs: 1,
  maxReconnectDelayMs: 4,
};

type PhaseEvent = Extract<AgentLinkSessionEvent, { type: 'phase' }>;

interface Harness {
  readonly gateway: GatewayDouble;
  readonly session: AgentLinkSession;
  readonly events: AgentLinkSessionEvent[];
}

const live: Harness[] = [];

function setup(options: Parameters<typeof createGatewayDouble>[0] = {}): Harness {
  const gateway = createGatewayDouble(options);
  const session = createAgentLinkSession({
    linkId: 'link_1',
    params: { kind: 'openclaw', endpoint: ENDPOINT },
    transport: gateway.transport,
    ...FAST_TIMING,
  });
  const events: AgentLinkSessionEvent[] = [];
  session.subscribe((event) => events.push(event));
  const harness: Harness = { gateway, session, events };
  live.push(harness);
  return harness;
}

/** 额外订阅一段（用于只关心某个事件子集的用例）。 */
function collect(session: AgentLinkSession): AgentLinkSessionEvent[] {
  const events: AgentLinkSessionEvent[] = [];
  session.subscribe((event) => events.push(event));
  return events;
}

function phasesOf(events: readonly AgentLinkSessionEvent[]): string[] {
  return events.filter((e): e is PhaseEvent => e.type === 'phase').map((e) => e.phase);
}

/** 等异步流程落定（退避 / 自动应答都靠宏任务推进）。 */
function settle(ms = 30): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

afterEach(async () => {
  // 逐个 dispose：漏掉会让退避定时器跨用例存活（后一个用例莫名重连）
  await Promise.all(live.map((h) => h.session.dispose()));
  live.length = 0;
});

describe('创建', () => {
  test('open() 走控制面开户 + 数据通道，成功后相位为 connected 且身份已就位', async () => {
    const { session, gateway, events } = setup();

    await session.open();

    expect(session.phase).toBe('connected');
    expect(session.connectedAt).not.toBeNull();
    // deviceId 来自 /ws-connect 的真实握手，作为 agent 身份锚点
    expect(session.agentId).toBe('device_abc123');
    expect(gateway.connectCalls).toEqual([{ endpoint: ENDPOINT, accountId: undefined, apiKey: undefined }]);
    expect(gateway.channels).toHaveLength(1);
    expect(phasesOf(events)).toEqual(['connecting', 'connected']);
    expect(events.some((e) => e.type === 'identity' && e.agentId === 'device_abc123')).toBe(true);
  });

  test('重复 open() 不重复开户（已连接时是 no-op）', async () => {
    const { session, gateway } = setup();
    await session.open();
    await session.open();

    expect(gateway.connectCalls).toHaveLength(1);
    expect(gateway.channels).toHaveLength(1);
  });

  test('并发 open() 共享同一次建链（不产生两条通道）', async () => {
    const { session, gateway } = setup();
    await Promise.all([session.open(), session.open(), session.open()]);

    expect(gateway.connectCalls).toHaveLength(1);
    expect(gateway.channels).toHaveLength(1);
  });

  test('开户被网关拒绝时相位落到 error，错误同时进 lastError 与 error 事件', async () => {
    const { session, events } = setup({ acceptConnect: false });

    await expect(session.open()).rejects.toThrow(/connection pool full/);

    expect(session.phase).toBe('error');
    expect(session.lastError).toMatch(/connection pool full/);
    expect(events.find((e) => e.type === 'error')).toMatchObject({ type: 'error', retryable: true });
    expect(phasesOf(events)).toEqual(['connecting', 'error']);
  });

  test('数据通道建不起来时相位同样是 error（开户成功 ≠ 会话可用）', async () => {
    const { session } = setup({ acceptChannel: false });

    await expect(session.open()).rejects.toThrow(/cannot reach/);
    expect(session.phase).toBe('error');
  });
});

describe('事件回传', () => {
  test('对话往返：本端气泡与远端回复都进消息流，方向/作者各自正确', async () => {
    const { session, events } = setup();
    await session.open();

    const reply = await session.sendMessage('ping');

    expect(reply).toBe('ack:ping');
    const messages = events.filter((e): e is Extract<AgentLinkSessionEvent, { type: 'message' }> => e.type === 'message');
    expect(messages.map((m) => m.message)).toMatchObject([
      { direction: 'outbound', author: 'you', text: 'ping', linkId: 'link_1' },
      { direction: 'inbound', author: 'device_abc123', text: 'ack:ping', linkId: 'link_1' },
    ]);
    expect(messages[1].message.id).not.toBe(messages[0].message.id);
  });

  test('远端消息事件回传为 inbound 消息，并收下其中的会话键', async () => {
    const { session, gateway, events } = setup();
    await session.open();

    gateway.currentChannel()?.emitEvent('agent.message', { content: '任务已完成', author: 'writer', sessionKey: 'sess_42' });

    const message = events.find((e): e is Extract<AgentLinkSessionEvent, { type: 'message' }> => e.type === 'message');
    expect(message?.message).toMatchObject({ direction: 'inbound', author: 'writer', text: '任务已完成', linkId: 'link_1' });
    expect(session.sessionId).toBe('sess_42');
  });

  test('远端状态事件归一到 UnitStatus 词表；认不出的状态走 raw 透传', async () => {
    const { session, gateway, events } = setup();
    await session.open();

    gateway.currentChannel()?.emitEvent('agent.status', { status: 'busy' });
    gateway.currentChannel()?.emitEvent('agent.status', { progress: 0.3 });

    expect(events.find((e) => e.type === 'status')).toMatchObject({ status: 'busy', agentId: 'device_abc123' });
    expect(events.some((e) => e.type === 'raw' && e.event === 'agent.status')).toBe(true);
  });

  test('未归一事件原样透传（协议演进时数据不丢）', async () => {
    const { session, gateway, events } = setup();
    await session.open();

    gateway.currentChannel()?.emitEvent('tool.progress', { percent: 42 });
    gateway.currentChannel()?.emitEvent('agent.message', { noText: true }); // 认不出正文 → raw 而不是丢

    const raws = events.filter((e): e is Extract<AgentLinkSessionEvent, { type: 'raw' }> => e.type === 'raw');
    expect(raws).toHaveLength(2);
    expect(raws[0]).toMatchObject({ event: 'tool.progress', data: { percent: 42 } });
  });

  test('非法帧不掀会话：降级为 raw 事件，相位不变', async () => {
    const { session, gateway, events } = setup();
    await session.open();

    gateway.currentChannel()?.emitRaw('<<<not json>>>');

    expect(session.phase).toBe('connected');
    expect(events.find((e) => e.type === 'raw')).toMatchObject({
      event: 'link.frame.ignored',
      data: 'invalid-json',
    });
  });

  test('网关级 error 帧标记为不可重试', async () => {
    const { session, gateway, events } = setup();
    await session.open();

    gateway.currentChannel()?.emitRaw(JSON.stringify({ type: 'error', error: 'proxy not found' }));

    expect(events.find((e) => e.type === 'error')).toMatchObject({ retryable: false });
    // 通道级错误不改变相位：相位由关闭事件驱动（否则一次 404 就会把好端点判死）
    expect(session.phase).toBe('connected');
  });

  test('事件订阅者抛错不影响会话与其他订阅者', async () => {
    const { session } = setup();
    const seen: AgentLinkSessionEvent[] = [];
    session.subscribe(() => {
      throw new Error('subscriber exploded');
    });
    session.subscribe((event) => seen.push(event));

    await session.open();

    expect(seen.some((e) => e.type === 'phase' && e.phase === 'connected')).toBe(true);
    expect(session.phase).toBe('connected');
  });
});

describe('关闭', () => {
  test('close() 关通道 + 销户，相位经 closing 到 closed', async () => {
    const { session, gateway, events } = setup();
    await session.open();

    await session.close('user closed');

    expect(session.phase).toBe('closed');
    expect(session.connectedAt).toBeNull();
    expect(gateway.disconnectCalls).toEqual([ENDPOINT]);
    expect(gateway.channels[0].closedWith).toEqual({ code: 1000, reason: 'user closed' });
    expect(phasesOf(events)).toEqual(['connecting', 'connected', 'closing', 'closed']);
  });

  test('close() 主动关闭不触发自动重连（否则关了又自己连回来）', async () => {
    const { session, gateway } = setup();
    await session.open();

    await session.close();
    await settle();

    expect(session.phase).toBe('closed');
    expect(gateway.channels).toHaveLength(1); // 没有第二条通道 = 没有重连
  });

  test('在途请求在关闭时被拒（不留悬挂 Promise）', async () => {
    const { session } = setup({ autoReplyChat: false });
    await session.open();

    const inflight = session.sendMessage('no answer');
    const closing = session.close();

    await expect(inflight).rejects.toThrow(/session closed/);
    await closing;
    expect(session.phase).toBe('closed');
  });

  test('销户失败不影响关闭流程（尽力而为）', async () => {
    const { session, gateway, events } = setup();
    await session.open();
    gateway.breakDisconnect();

    await session.close();

    expect(session.phase).toBe('closed');
    expect(events.some((e) => e.type === 'error' && /gateway unreachable/.test(e.message))).toBe(true);
  });

  test('dispose() 后所有资源释放，再次操作直接报错', async () => {
    const { session } = setup();
    await session.open();

    await session.dispose();

    expect(session.phase).toBe('closed');
    await expect(session.sendMessage('x')).rejects.toThrow(/disposed/);
    await expect(session.open()).rejects.toThrow(/disposed/);
  });

  test('建链途中 close()：建链结果被丢弃，不会把已关闭的会话复活成 connected', async () => {
    const { session, gateway, events } = setup();
    // 控制面延迟：模拟"点了连接又立刻点断开"
    // definite assignment：赋值发生在 Promise executor 回调里，TS 的控制流分析看不到，只能外部断言
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const originalConnect = gateway.transport.controlPlane.connect;
    gateway.transport.controlPlane.connect = async (params) => {
      await gate;
      return originalConnect(params);
    };

    const opening = session.open();
    await session.close('user gave up');
    release();
    await opening;
    await settle(20);

    expect(session.phase).toBe('closed');
    expect(events.some((e) => e.type === 'phase' && e.phase === 'connected')).toBe(false);
  });
});

describe('恢复', () => {
  test('resume() 带上原会话键重连（接上下文而不是新建会话）', async () => {
    const { session, gateway, events } = setup();
    await session.open();
    gateway.currentChannel()?.emitEvent('agent.message', { text: 'hi', sessionKey: 'sess_42' });
    await session.close();

    await session.resume();

    expect(session.phase).toBe('connected');
    expect(session.sessionId).toBe('sess_42'); // 上下文没丢
    expect(phasesOf(events)).toEqual(['connecting', 'connected', 'closing', 'closed', 'reconnecting', 'connected']);
  });

  test('resume() 在已连接时是 no-op（不重建通道）', async () => {
    const { session, gateway } = setup();
    await session.open();

    await session.resume();

    expect(gateway.channels).toHaveLength(1);
  });

  test('reconnect() 丢弃旧通道重建并清零退避预算', async () => {
    const { session, gateway } = setup();
    await session.open();
    gateway.currentChannel()?.emitEvent('agent.message', { text: 'x', sessionKey: 'sess_42' });

    await session.reconnect();

    expect(session.phase).toBe('connected');
    expect(session.sessionId).toBe('sess_42');
    expect(gateway.channels).toHaveLength(2);
    expect(gateway.channels[0].closedWith).not.toBeNull(); // 旧通道已释放（资源必须可清理）
  });
});

describe('重连', () => {
  test('通道异常掉线后自动重连（指数退避），成功后回到 connected', async () => {
    const { session, gateway, events } = setup();
    await session.open();

    gateway.currentChannel()?.drop(1011, 'proxy lost');
    await settle();

    expect(session.phase).toBe('connected');
    expect(gateway.channels).toHaveLength(2);
    expect(phasesOf(events)).toEqual(['connecting', 'connected', 'reconnecting', 'connected']);
    const retry = events.find((e): e is PhaseEvent => e.type === 'phase' && e.phase === 'reconnecting');
    expect(retry?.reason).toMatch(/retry in \d+ms/);
  });

  test('连续掉线的重连次数有上限，耗尽后停在 error 而不是无限重试', async () => {
    const { session, gateway, events } = setup();
    await session.open();
    // 通道建不起来 → 每次自动重连都失败，退避耗尽后必须收手
    gateway.breakChannelOpen();

    gateway.currentChannel()?.drop(1011, 'proxy lost');
    await settle(120);

    expect(session.phase).toBe('error');
    expect(events.some((e) => e.type === 'phase' && /reconnect budget exhausted/.test(e.reason ?? ''))).toBe(true);
    expect(gateway.channels).toHaveLength(1); // 没有再开新通道
  });

  test('用户在退避窗口内 close() 会取消待执行的重连（不留孤儿定时器）', async () => {
    const { session, gateway } = setup();
    await session.open();

    gateway.currentChannel()?.drop(1011, 'proxy lost');
    await session.close('user closed');
    await settle(60);

    expect(session.phase).toBe('closed');
    expect(gateway.channels).toHaveLength(1); // 退避没被触发
  });
});

describe('请求与背压', () => {
  test('未连接时发消息直接拒绝（不排队、不静默丢弃）', async () => {
    const { session } = setup();

    await expect(session.sendMessage('too early')).rejects.toThrow(/is not connected \(phase=idle\)/);
  });

  test('在途请求超过上限时拒绝新请求（对齐现网 pendingRequests 无上限的踩坑点）', async () => {
    const { session } = setup({ autoReplyChat: false });
    await session.open();

    const inflight = Array.from({ length: MAX_PENDING_REQUESTS }, (_, i) => session.sendMessage(`m${i}`));

    await expect(session.sendMessage('overflow')).rejects.toThrow(/too many pending requests/);

    await session.close();
    await expect(Promise.all(inflight)).rejects.toThrow(/session closed/);
  });

  test('请求超时后迟到应答被丢弃，不误结算其他请求', async () => {
    const { session, gateway } = setup({ autoReplyChat: false });
    await session.open();

    await expect(session.sendMessage('slow')).rejects.toThrow(/request timeout after 50ms/);

    // 迟到应答：requestId 已从 pending 移除，必须被安静忽略而不是崩掉
    const stale = gateway.sentFrames()[0];
    expect(stale.requestId).toBeDefined();
    expect(() =>
      gateway.currentChannel()?.emitRaw(JSON.stringify({ type: 'response', requestId: stale.requestId, message: 'late' }))
    ).not.toThrow();
    expect(session.phase).toBe('connected');
  });

  test('远端以 error 应答时调用方收到错误，同时产生 error 事件', async () => {
    const { session, gateway, events } = setup({ autoReplyChat: false });
    await session.open();

    const inflight = session.sendMessage('will fail');
    const requestId = gateway.sentFrames()[0].requestId;
    gateway.currentChannel()?.emitRaw(JSON.stringify({ type: 'response', requestId, error: 'agent busy' }));

    await expect(inflight).rejects.toThrow(/agent busy/);
    expect(events.some((e) => e.type === 'error' && /agent busy/.test(e.message))).toBe(true);
  });

  test('工具调用的应答不进消息流（那是协议应答，不是对话）', async () => {
    const { session, gateway, events } = setup();
    await session.open();

    const pending = session.invokeTool('sessions_list');
    const frame = gateway.sentFrames()[0];
    gateway.currentChannel()?.emitRaw(JSON.stringify({ type: 'response', requestId: frame.requestId, message: '[]' }));

    await expect(pending).resolves.toBe('[]');
    expect(events.some((e) => e.type === 'message')).toBe(false);
  });

  test('工具帧带上会话键与 args（协议字段逐字对齐）', async () => {
    const { session, gateway } = setup();
    await session.open();

    const pending = session.invokeTool('sessions_list', { limit: 1 });
    const frame = gateway.sentFrames()[0];

    expect(frame.type).toBe('tool');
    expect(frame.message).toBe('sessions_list');
    expect(frame.payload).toEqual({ args: { limit: 1 }, sessionKey: 'device_abc123' });
    gateway.currentChannel()?.emitRaw(JSON.stringify({ type: 'response', requestId: frame.requestId, message: '[]' }));
    await expect(pending).resolves.toBe('[]');
  });

  test('订阅函数返回退订函数，退订后不再收到事件（监听器不泄漏）', async () => {
    const { session } = setup();
    const seen = collect(session);
    const off = session.subscribe(() => undefined);
    off();

    await session.open();

    expect(seen.length).toBeGreaterThan(0);
  });
});

describe('快照', () => {
  test('snapshot 保留恢复所需字段，且不含凭据', async () => {
    const { session, gateway } = setup();
    await session.open();
    gateway.currentChannel()?.emitEvent('agent.message', { text: 'x', sessionKey: 'sess_77' });

    const snapshot = session.snapshot();

    expect(snapshot).toEqual({
      linkId: 'link_1',
      kind: 'openclaw',
      endpoint: ENDPOINT,
      displayName: ENDPOINT,
      accountId: 'stratix',
      agentId: 'device_abc123',
      sessionId: 'sess_77',
    });
    expect(JSON.stringify(snapshot)).not.toContain('apiKey');
  });
});