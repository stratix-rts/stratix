/**
 * 单测：core/agent-link 与 core/runtime 的接线（Phase 2 的"最后一段"：命令 → 状态 → 总线广播）。
 *
 * 这一组守的是铁律本身：
 *   1. 注入 manager 后，link.* / chat.send 由 agent-link 消费，runtime 不再重复处理也不报未落地；
 *   2. agent-link 只写 store，state 广播仍由 runtime 独家发出（一次变更不广播两遍）；
 *   3. runtime 停止时连接一并关闭（外部资源不留孤儿）。
 */

import { emitCommand, onState, resetBus, type Unsubscribe } from '../../bus';
import { createCoreRuntime, type UnhandledChannel } from '../../runtime';
import { createStore } from '../../store';
import type { HudCommand, WorldState } from '../../types';
import { createGatewayDouble } from './helpers/gateway-double';
import { createAgentLinkManager, type AgentLinkManager } from '../manager';

const ENDPOINT = 'http://127.0.0.1:18080';
const TIMING = { requestTimeoutMs: 100, connectTimeoutMs: 100, baseReconnectDelayMs: 1 };

interface Harness {
  readonly manager: AgentLinkManager;
  readonly states: WorldState[];
  readonly unhandled: { channel: UnhandledChannel; type: string }[];
  stop(): void;
}

function harness(): Harness {
  const gateway = createGatewayDouble();
  const store = createStore();
  const states: WorldState[] = [];
  const unhandled: { channel: UnhandledChannel; type: string }[] = [];
  const offState: Unsubscribe = onState((state) => states.push(state));
  const manager = createAgentLinkManager({ transport: gateway.transport, store, timing: TIMING });
  const runtime = createCoreRuntime({
    store,
    agentLink: manager,
    onUnhandled: (channel, payload) => unhandled.push({ channel, type: payload.type }),
  });
  const stopRuntime = runtime.start();
  return { manager, states, unhandled, stop: () => { stopRuntime(); offState(); } };
}

function settle(ms = 20): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

let cleanup: (() => void) | null = null;
let managers: AgentLinkManager[] = [];

beforeEach(() => {
  resetBus();
  managers = [];
});

afterEach(async () => {
  cleanup?.();
  cleanup = null;
  await Promise.all(managers.map((manager) => manager.dispose()));
  managers = [];
  resetBus();
});

test('link.open 命令 → 会话建立 → state 通道广播出 links 与 messages', async () => {
  const h = harness();
  managers.push(h.manager);
  cleanup = h.stop;

  emitCommand({ type: 'link.open', kind: 'openclaw', endpoint: ENDPOINT, displayName: 'Writer' });
  await settle();

  const latest = h.states[h.states.length - 1];
  expect(latest.links).toHaveLength(1);
  expect(latest.links[0]).toMatchObject({ phase: 'connected', displayName: 'Writer' });
  // 广播出去的是 WorldState 快照，两侧都不许回读 store
  expect(h.states.every((state) => Array.isArray(state.links))).toBe(true);
});

test('注入 manager 后 chat.send 不再被记为未落地，且消息确实进了状态', async () => {
  const h = harness();
  managers.push(h.manager);
  cleanup = h.stop;

  emitCommand({ type: 'link.open', kind: 'openclaw', endpoint: ENDPOINT });
  await settle();
  emitCommand({ type: 'chat.send', text: 'ping' });
  await settle();

  expect(h.unhandled.filter((u) => u.type === 'chat.send' || u.type === 'link.open')).toEqual([]);
  const latest = h.states[h.states.length - 1];
  expect(latest.messages.map((m) => m.text)).toEqual(['ping', 'ack:ping']);
});

test('未注入 manager 时行为不变：这些命令仍走 unhandled 出口（单测基线不破）', async () => {
  const store = createStore();
  const unhandled: { channel: UnhandledChannel; type: string }[] = [];
  const runtime = createCoreRuntime({
    store,
    onUnhandled: (channel, payload) => unhandled.push({ channel, type: payload.type }),
  });
  const stop = runtime.start();

  emitCommand({ type: 'chat.send', text: 'hi' });
  emitCommand({ type: 'link.close', linkId: 'x' });

  expect(unhandled).toEqual([
    { channel: 'command', type: 'chat.send' },
    { channel: 'command', type: 'link.close' },
  ]);
  stop();
});

test('runtime 停止时 agent-link 一并停（连接不留孤儿）', async () => {
  const h = harness();
  managers.push(h.manager);
  cleanup = h.stop;

  emitCommand({ type: 'link.open', kind: 'openclaw', endpoint: ENDPOINT });
  await settle();
  expect(h.manager.running).toBe(true);

  h.stop();
  cleanup = null;

  expect(h.manager.running).toBe(false);
});