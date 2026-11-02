/**
 * 单测：**session.interrupt 命令的总线往返落点**（@since v3.43，task_093 / v3.2a S3）——
 *   HUD 命令 → core/bus → core runtime 裁决 → 会话状态机 → WorldState.sessions。
 *
 * why 单开一单而不并进 session-manager.test.ts：manager 的单测是**直调**（不经过总线），
 *   这里验的是**命令通道** —— runtime 是不是真的接住了这条命令、落点是不是同一份状态。
 * 打的是真总线 + 真 store（与 runtime.test.ts 同款纪律）：runtime 的全部职责就是"接在总线上"，
 *   mock 掉总线等于把被测行为一起 mock 掉。
 */

import { emitCommand, resetBus } from '../bus';
import { createCoreRuntime, type CoreRuntime } from '../runtime';
import { createSessionManager, type SessionManager } from '../session';
import { createStore, type CoreStore } from '../store';

interface Harness {
  readonly store: CoreStore;
  /** 会话写入面（业务侧记账用的**同一个**实例）。 */
  readonly session: SessionManager;
  readonly runtime: CoreRuntime;
  readonly stop: () => void;
}

/** 起一个 runtime + 一个与它共享 store 的会话写入面（组合根的接线形状）。 */
function harness(): Harness {
  const store = createStore();
  const session = createSessionManager({ store });
  const runtime = createCoreRuntime({ store, session });
  const stop = runtime.start();
  return { store, session, runtime, stop };
}

let cleanups: Array<() => void> = [];

beforeEach(() => {
  resetBus();
  cleanups = [];
});

afterEach(() => {
  cleanups.forEach((fn) => fn());
  cleanups = [];
  resetBus();
});

describe('session.interrupt：HUD 命令 → runtime 裁决 → 会话状态', () => {
  test('命令经总线落到会话状态机（active → interrupted），并记一条 interrupt 事件', () => {
    const { store, session, stop } = harness();
    cleanups.push(stop);

    const created = session.createSession({ kind: 'peer_chat', participants: ['alice', 'bob'] });
    expect(created).not.toBeNull();

    emitCommand({ type: 'session.interrupt', sessionId: created!.id });

    const after = (store.getState().sessions ?? [])[0];
    expect(after?.status).toBe('interrupted');
    expect(after?.eventCount).toBe(2); // created + interrupt
  });

  test('命令落点与业务侧记账写的是同一份状态（同一 manager 实例 / 同一 store）', () => {
    const { store, session, stop } = harness();
    cleanups.push(stop);

    const created = session.createSession({ kind: 'peer_chat', participants: ['alice', 'bob'] });
    // 业务侧先记一条事件（append-only 记账，不改状态）。
    session.appendEvent(created!.id, { type: 'round', payload: {} });
    expect((store.getState().sessions ?? [])[0]?.eventCount).toBe(2);

    // 命令通道再中断：计数接着涨 —— 证明两处写的是同一份 WorldState.sessions。
    emitCommand({ type: 'session.interrupt', sessionId: created!.id });
    const after = (store.getState().sessions ?? [])[0];
    expect(after?.status).toBe('interrupted');
    expect(after?.eventCount).toBe(3); // created + round + interrupt
  });

  test('会话不存在：命令被拒但不抛（不打断整轮广播），也不凭空造出会话', () => {
    const { store, stop } = harness();
    cleanups.push(stop);

    expect(() => emitCommand({ type: 'session.interrupt', sessionId: 'session_不存在' })).not.toThrow();
    expect(store.getState().sessions ?? []).toHaveLength(0);
  });

  test('已收尾的会话再中断：状态不变（终态拒收，历史不改写）', () => {
    const { store, session, stop } = harness();
    cleanups.push(stop);

    const created = session.createSession({ kind: 'peer_chat', participants: ['alice', 'bob'] });
    session.closeSession(created!.id, '收尾');
    const closed = (store.getState().sessions ?? [])[0];
    expect(closed?.status).toBe('closed');

    emitCommand({ type: 'session.interrupt', sessionId: created!.id });

    const after = (store.getState().sessions ?? [])[0];
    expect(after?.status).toBe('closed');
    expect(after?.eventCount).toBe(closed?.eventCount);
  });
});
