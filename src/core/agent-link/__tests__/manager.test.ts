/**
 * 单测：会话管理器（core/agent-link/manager.ts）—— 多会话编排 + WorldState 投影 + 命令响应。
 *
 * 隔离方式：每个用例一份 createStore() + resetBus()，与 core/__tests__/runtime.test.ts 同款纪律。
 * 对端仍是 helpers/gateway-double.ts（真协议收发）。
 */

import { emitCommand, resetBus } from '../../bus';
import { createStore, type CoreStore } from '../../store';
import { MAX_AGENT_LINKS, MAX_AGENT_MESSAGES, MAX_AGENT_MESSAGES_PER_LINK, type UnitView, type WorldState } from '../../types';
import { createGatewayDouble, type GatewayDouble } from './helpers/gateway-double';
import { AgentLinkError, createAgentLinkManager, pruneMessages, type AgentLinkManager } from '../manager';

const ENDPOINT = 'http://127.0.0.1:18080';
const ENDPOINT_2 = 'http://127.0.0.1:18081';

const TIMING = { requestTimeoutMs: 50, connectTimeoutMs: 50, baseReconnectDelayMs: 1, maxReconnectDelayMs: 4 };

const UNITS: UnitView[] = [
  { id: 'device_abc123', name: 'Writer', status: 'idle', missionId: null, power: 2 },
  { id: 'u2', name: 'Planner', status: 'idle', missionId: null, power: 1 },
];

interface Harness {
  readonly manager: AgentLinkManager;
  readonly store: CoreStore;
  readonly gateway: GatewayDouble;
  state(): WorldState;
}

const live: AgentLinkManager[] = [];

function setup(options: Parameters<typeof createGatewayDouble>[0] = {}, overrides: { units?: UnitView[] } = {}): Harness {
  const gateway = createGatewayDouble(options);
  const store = createStore(overrides.units ? { units: overrides.units } : undefined);
  const manager = createAgentLinkManager({ transport: gateway.transport, store, timing: TIMING });
  live.push(manager);
  return { manager, store, gateway, state: (): WorldState => store.getState() };
}

beforeEach(() => {
  resetBus();
});

afterEach(async () => {
  await Promise.all(live.map((manager) => manager.dispose()));
  live.length = 0;
  resetBus();
});

/** 打开一个会话并等它 connected。 */
async function connected(manager: AgentLinkManager, linkId = 'link_1', endpoint = ENDPOINT): Promise<void> {
  await manager.open({ linkId, kind: 'openclaw', endpoint });
}

describe('状态投影', () => {
  test('open() 后 WorldState.links 有该会话，端点已脱敏', async () => {
    const { manager, state } = setup();

    await manager.open({ kind: 'openclaw', endpoint: `${ENDPOINT}?token=secret` });

    const links = state().links;
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({
      kind: 'openclaw',
      phase: 'connected',
      endpoint: `${ENDPOINT}?***`,
      agentId: 'device_abc123',
      connectedAt: expect.any(Number),
      lastError: null,
    });
    expect(manager.list().map((l) => l.phase)).toEqual(['connected']);
  });

  test('相位变化推 Notice：连接成功与关闭都有提示', async () => {
    const { manager, state } = setup();

    await connected(manager);
    await manager.close('link_1');

    const texts = state().notices.map((n) => n.text);
    expect(texts.some((t) => t.includes('已连接'))).toBe(true);
    expect(texts.some((t) => t.includes('已断开'))).toBe(true);
    expect(state().notices.every((n) => n.level !== 'error')).toBe(true);
  });

  test('远端状态回写到同 id 的 UnitView（单位不存在时不凭空造单位）', async () => {
    const { manager, state, gateway } = setup({}, { units: UNITS });

    await connected(manager);
    gateway.currentChannel()?.emitEvent('agent.status', { status: 'busy' });

    expect(state().units.map((u) => u.status)).toEqual(['busy', 'idle']);

    gateway.currentChannel()?.emitEvent('agent.status', { status: 'nonsense' }); // 认不出 → 不改
    expect(state().units[0].status).toBe('busy');
  });

  test('消息进 WorldState.messages，按时间正序且带上会话 id', async () => {
    const { manager, state } = setup();
    await connected(manager);

    await manager.sendMessage('link_1', 'hello');

    expect(state().messages.map((m) => [m.direction, m.text, m.linkId])).toEqual([
      ['outbound', 'hello', 'link_1'],
      ['inbound', 'ack:hello', 'link_1'],
    ]);
    expect(manager.messages('link_1')).toHaveLength(2);
    expect(manager.messages('link_2')).toHaveLength(0);
  });

  test('单会话消息有上限，长跑会话不会无限撑大状态', async () => {
    const { manager, state } = setup();
    await connected(manager);

    const total = MAX_AGENT_MESSAGES_PER_LINK + 10;
    for (let i = 0; i < total / 2; i += 1) {
      await manager.sendMessage('link_1', `m${i}`);
    }

    expect(state().messages.length).toBeLessThanOrEqual(MAX_AGENT_MESSAGES_PER_LINK);
    expect(state().messages[state().messages.length - 1].text).toBe(`ack:m${total / 2 - 1}`);
  });

  test('全局消息上限兜底：两个会话合计不超过 MAX_AGENT_MESSAGES', async () => {
    const { manager, state } = setup();
    await connected(manager, 'link_1');
    await connected(manager, 'link_2', ENDPOINT_2);

    const perLink = Math.ceil((MAX_AGENT_MESSAGES + 20) / 2 / 2);
    for (let i = 0; i < perLink; i += 1) {
      await manager.sendMessage('link_1', `a${i}`);
      await manager.sendMessage('link_2', `b${i}`);
    }

    expect(state().messages.length).toBeLessThanOrEqual(MAX_AGENT_MESSAGES);
  });

  test('pruneMessages：每个会话各保最近 N 条，再全局保最近 M 条', () => {
    const messages = [
      { id: '1', linkId: 'a', direction: 'inbound', author: 'x', text: '1', at: 1 },
      { id: '2', linkId: 'b', direction: 'inbound', author: 'x', text: '2', at: 2 },
      { id: '3', linkId: 'a', direction: 'inbound', author: 'x', text: '3', at: 3 },
    ] as const;

    // a 有 2 条（未超上限）→ 全留
    expect(pruneMessages(messages, 2, 10).map((m) => m.id)).toEqual(['1', '2', '3']);
    // 上限收到 1：a 只留最新的 3，b 的 2 不受牵连
    expect(pruneMessages(messages, 1, 10).map((m) => m.id)).toEqual(['2', '3']);
    // 全局上限 2：保最新的两条
    expect(pruneMessages(messages, 5, 2).map((m) => m.id)).toEqual(['2', '3']);
  });
});

describe('会话数量上限', () => {
  test('超过 MAX_AGENT_LINKS 时拒绝开户并抛 limit-exceeded', async () => {
    const { manager, state } = setup({ deviceId: 'device_abc123' });
    for (let i = 0; i < MAX_AGENT_LINKS; i += 1) {
      await manager.open({ linkId: `link_${i}`, kind: 'openclaw', endpoint: `${ENDPOINT}?i=${i}` });
    }

    await expect(manager.open({ linkId: 'overflow', kind: 'openclaw', endpoint: ENDPOINT })).rejects.toMatchObject({
      code: 'limit-exceeded',
    });
    expect(state().links).toHaveLength(MAX_AGENT_LINKS);
  });

  test('同 id 重复开户被拒（不会把已有会话顶掉）', async () => {
    const { manager, gateway } = setup();
    await connected(manager);

    await expect(manager.open({ linkId: 'link_1', kind: 'openclaw', endpoint: ENDPOINT_2 })).rejects.toMatchObject({
      code: 'limit-exceeded',
    });
    expect(gateway.connectCalls).toHaveLength(1);
  });

  test('list() 支持按相位与种类过滤', async () => {
    const { manager } = setup();
    await connected(manager, 'link_1');
    await connected(manager, 'link_2', ENDPOINT_2);
    await manager.close('link_2');

    expect(manager.list({ phase: 'connected' }).map((l) => l.id)).toEqual(['link_1']);
    expect(manager.list({ phase: 'closed' }).map((l) => l.id)).toEqual(['link_2']);
    expect(manager.list({ kind: 'openclaw' })).toHaveLength(2);
    expect(manager.list({ kind: 'claude-code' })).toHaveLength(0);
  });
});

describe('恢复', () => {
  test('snapshots + restore 重建会话并保住会话键（应用重启后接上下文）', async () => {
    const { manager, gateway } = setup();
    await connected(manager, 'link_1');
    gateway.currentChannel()?.emitEvent('agent.message', { text: 'x', sessionKey: 'sess_42' });

    const snapshots = manager.snapshots();
    expect(snapshots[0]).toMatchObject({ linkId: 'link_1', sessionId: 'sess_42', accountId: 'stratix' });
    expect(JSON.stringify(snapshots)).not.toContain('apiKey');

    await manager.dispose();
    const restored = await manager.restore(snapshots);

    expect(restored.failed).toEqual([]);
    expect(restored.restored[0]).toMatchObject({ id: 'link_1', phase: 'connected' });
    expect(manager.get('link_1')?.sessionId).toBe('sess_42');
  });

  test('restore 逐个串行：单个失败不影响其余会话', async () => {
    // 第一阶段：两个会话都正常，取快照
    const first = setup();
    await connected(first.manager, 'link_1');
    await connected(first.manager, 'link_2', ENDPOINT_2);
    const snapshots = first.manager.snapshots();
    await first.manager.dispose();

    // 第二阶段（模拟应用重启）：link_1 的端点不可达，link_2 正常
    const broken = createGatewayDouble({ failEndpoints: [ENDPOINT] });
    const revived = createAgentLinkManager({ transport: broken.transport, store: createStore(), timing: TIMING });
    live.push(revived);

    const result = await revived.restore(snapshots);

    expect(result.failed.map((f) => f.linkId)).toEqual(['link_1']);
    expect(result.restored.map((v) => v.id)).toEqual(['link_2']);
    expect(result.restored[0].phase).toBe('connected');
  });

  test('restore 注入凭据（快照不含 apiKey，由上层密钥库补）', async () => {
    const { manager, gateway } = setup();
    await connected(manager, 'link_1');
    const snapshots = manager.snapshots();
    await manager.dispose();

    const withCred = createAgentLinkManager({
      transport: gateway.transport,
      store: manager.store,
      timing: TIMING,
      credentialFor: (snapshot) => (snapshot.linkId === 'link_1' ? 'sk-secret' : undefined),
    });
    live.push(withCred);
    await withCred.restore(snapshots);

    expect(gateway.connectCalls[gateway.connectCalls.length - 1].apiKey).toBe('sk-secret');
  });
});

describe('命令通道', () => {
  test('link.open / link.reconnect / link.close 命令驱动会话', async () => {
    const { manager, gateway, state } = setup();
    const stop = manager.start();
    expect(manager.running).toBe(true);

    emitCommand({ type: 'link.open', kind: 'openclaw', endpoint: ENDPOINT, displayName: 'Writer' });
    await settleMs();
    expect(state().links[0]).toMatchObject({ phase: 'connected', displayName: 'Writer' });

    emitCommand({ type: 'link.reconnect', linkId: state().links[0].id });
    await settleMs();
    expect(gateway.channels).toHaveLength(2);

    emitCommand({ type: 'link.close', linkId: state().links[0].id });
    await settleMs();
    expect(state().links[0].phase).toBe('closed');

    stop();
    expect(manager.running).toBe(false);
  });

  test('chat.send 缺省投给唯一的已连接会话', async () => {
    const { manager, state } = setup();
    manager.start();
    await connected(manager);

    emitCommand({ type: 'chat.send', text: 'ping' });
    await settleMs();

    expect(state().messages.map((m) => m.direction)).toEqual(['outbound', 'inbound']);
  });

  test('chat.send 在多会话时不猜：报错而不是投错 agent', async () => {
    const { manager, state } = setup();
    manager.start();
    await connected(manager, 'link_1');
    await connected(manager, 'link_2', ENDPOINT_2);

    emitCommand({ type: 'chat.send', text: 'ping' });
    await settleMs();

    // 两个会话都已连接 → 拒绝投递，消息不落到任何一个会话
    expect(state().messages).toHaveLength(0);
    expect(state().notices.some((n) => n.level === 'error' && /linkId required/.test(n.text))).toBe(true);
  });

  test('chat.send 显式指定 linkId 时精确投递', async () => {
    const { manager, state } = setup();
    manager.start();
    await connected(manager, 'link_1');
    await connected(manager, 'link_2', ENDPOINT_2);

    emitCommand({ type: 'chat.send', text: 'only to 2', linkId: 'link_2' });
    await settleMs();

    expect(state().messages.map((m) => m.linkId)).toEqual(['link_2', 'link_2']);
  });

  test('chat.send 在无连接时报错并给出可读原因', async () => {
    const { manager, state } = setup();
    manager.start();

    emitCommand({ type: 'chat.send', text: 'nobody home' });
    await settleMs();

    expect(state().notices.some((n) => n.level === 'error' && /no connected agent link/.test(n.text))).toBe(true);
  });

  test('未知 linkId 的命令以 notice 形式报错，不抛进总线', async () => {
    const { manager, state } = setup();
    manager.start();

    emitCommand({ type: 'link.resume', linkId: 'ghost' });
    await settleMs();

    expect(state().notices.some((n) => n.level === 'error' && /link ghost not found/.test(n.text))).toBe(true);
  });

  test('非本模块的命令不被 agent-link 吞掉（留给 runtime 的 unhandled 出口）', async () => {
    const { manager } = setup();
    manager.start();

    expect(() => emitCommand({ type: 'unit.select', unitIds: ['u1'], mode: 'set' })).not.toThrow();
    expect(() => emitCommand({ type: 'ui.navigate', screen: 'main' })).not.toThrow();
  });
});

describe('清理', () => {
  test('dispose() 关掉全部会话并清空状态投影', async () => {
    const { manager, state, gateway } = setup();
    await connected(manager, 'link_1');
    await connected(manager, 'link_2', ENDPOINT_2);
    const stop = manager.start();

    await manager.dispose();

    expect(gateway.disconnectCalls).toEqual([ENDPOINT, ENDPOINT_2]);
    expect(gateway.channels.every((c) => c.closedWith !== null)).toBe(true);
    expect(state().links).toEqual([]);
    expect(state().messages).toEqual([]);
    expect(manager.running).toBe(false);
    stop(); // 已停，重复 stop 不应抛
  });

  test('重复 start 返回同一个 stop（不叠加订阅）', () => {
    const { manager } = setup();
    const first = manager.start();
    const second = manager.start();
    expect(second).toBe(first);
    first();
    expect(manager.running).toBe(false);
  });
});

function settleMs(ms = 20): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}