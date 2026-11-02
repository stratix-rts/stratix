/**
 * 单测：**shell_link 会话的 LITE 接线**（@since v3.43，task_093 / v3.2a S3）——
 *   外部 agent 连接建链成功 → 建会话（kind=shell_link）；断开 → 收尾会话。
 *
 * 口径（方案 docs/SESSION-PLAN.md §2 接线表「shell_link」行）：**LITE 两事件** ——
 *   建链成功记一条、断开记一条；消息流仍在 WorldState.messages 投影（不搬进会话事件流）。
 *
 * 对端仍是 helpers/gateway-double.ts（真协议收发）—— 与 agent-link 其它单测同款纪律。
 */

import { resetBus } from '../../bus';
import { createSessionManager, type SessionManager } from '../../session';
import { createStore, type CoreStore } from '../../store';
import type { SessionRecord } from '../../session/types';
import { createGatewayDouble, type GatewayDouble } from './helpers/gateway-double';
import { createAgentLinkManager, type AgentLinkManager } from '../manager';

const ENDPOINT = 'http://127.0.0.1:18080';
const TIMING = { requestTimeoutMs: 50, connectTimeoutMs: 50, baseReconnectDelayMs: 1, maxReconnectDelayMs: 4 };

interface Harness {
  readonly manager: AgentLinkManager;
  readonly session: SessionManager;
  readonly store: CoreStore;
  readonly gateway: GatewayDouble;
  sessions(): SessionRecord[];
}

const live: AgentLinkManager[] = [];

function setup(): Harness {
  const gateway = createGatewayDouble();
  const store = createStore();
  const session = createSessionManager({ store });
  const manager = createAgentLinkManager({ transport: gateway.transport, store, timing: TIMING, sessions: session });
  live.push(manager);
  return {
    manager,
    session,
    store,
    gateway,
    sessions: (): SessionRecord[] => store.getState().sessions ?? [],
  };
}

beforeEach(() => {
  resetBus();
});

afterEach(async () => {
  await Promise.all(live.map((manager) => manager.dispose()));
  live.length = 0;
  resetBus();
});

describe('shell_link 会话（LITE 两事件）', () => {
  test('建链成功 → 建一条 shell_link 会话（active）', async () => {
    const { manager, sessions } = setup();

    const view = await manager.open({ kind: 'openclaw', endpoint: ENDPOINT });

    const list = sessions();
    expect(list).toHaveLength(1);
    expect(list[0]?.kind).toBe('shell_link');
    expect(list[0]?.status).toBe('active');
    expect(list[0]?.refId).toBe(view.id);
    expect(list[0]?.participants).toEqual([view.id]);
    expect(list[0]?.eventCount).toBe(1); // created
  });

  test('断开 → 收尾会话（closed，两事件）', async () => {
    const { manager, sessions } = setup();

    const view = await manager.open({ kind: 'openclaw', endpoint: ENDPOINT });
    await manager.close(view.id);

    const list = sessions();
    expect(list).toHaveLength(1);
    expect(list[0]?.status).toBe('closed');
    expect(list[0]?.eventCount).toBe(2); // created + closed
    expect(list[0]?.closedAt).not.toBeNull();
  });

  test('建链失败 → 不建会话（失败不产垃圾）', async () => {
    const gateway = createGatewayDouble({ acceptChannel: false });
    const store = createStore();
    const session = createSessionManager({ store });
    const manager = createAgentLinkManager({ transport: gateway.transport, store, timing: TIMING, sessions: session });
    live.push(manager);

    await expect(manager.open({ kind: 'openclaw', endpoint: ENDPOINT })).rejects.toThrow();
    expect(store.getState().sessions ?? []).toHaveLength(0);
  });

  test('dispose() → 未收尾的会话一并收尾（不留半截会话）', async () => {
    const { manager, sessions } = setup();

    await manager.open({ kind: 'openclaw', endpoint: ENDPOINT });
    await manager.dispose();

    const list = sessions();
    expect(list).toHaveLength(1);
    expect(list[0]?.status).toBe('closed');
  });
});
