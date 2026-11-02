/**
 * 单测：会话域写入面（core/session/manager.ts）—— 建会话 / 追加事件 / 中断 / 恢复 / 收尾 /
 *   上限淘汰 / seq 单调。
 *
 * 用真 store（createStore()）隔离：不 mock 总线 —— manager 的职责就是写 store。
 * 时间与 id 都用可注入的假实现（now / createId），断言不依赖真实时钟。
 */

import { createSessionManager, type SessionManager } from '../session';
import { createStore, type CoreStore } from '../store';
import type { SessionRecord } from '../session/types';

interface Harness {
  readonly store: CoreStore;
  readonly manager: SessionManager;
  /** 假时钟的起点（断言时刻用）。 */
  readonly base: number;
  /** 把假时钟往前拨（毫秒）。 */
  advance(ms: number): void;
}

function harness(options: { maxSessions?: number } = {}): Harness {
  const store = createStore();
  // 起点取真实时间：store.pushNotice 用**自己的** Date.now() 剔除过期通知，
  // 假时钟若停在远古时刻，通知会被当场剔除（Notice 断言就永远拿不到）。
  const base = Date.now();
  let clock = base;
  let ids = 0;
  const manager = createSessionManager({
    store,
    now: () => clock,
    createId: (prefix: string) => `${prefix}_${++ids}`,
    ...(options.maxSessions === undefined ? {} : { maxSessions: options.maxSessions }),
  });
  return {
    store,
    manager,
    base,
    advance: (ms: number) => {
      clock += ms;
    },
  };
}

function sessionsOf(store: CoreStore): SessionRecord[] {
  return store.getState().sessions ?? [];
}

// ============================================================================
// 1. 建会话
// ============================================================================

describe('createSession：建会话', () => {
  test('初始 status=active，落一条 created 事件（seq=1）', () => {
    const { store, manager } = harness();
    const session = manager.createSession({ kind: 'peer_chat', participants: ['alice', 'bob'] });
    expect(session).not.toBeNull();
    expect(session?.status).toBe('active');
    expect(session?.eventCount).toBe(1);
    expect(session?.closedAt).toBeNull();
    expect(sessionsOf(store)).toHaveLength(1);
  });

  test('id 带 kind 前缀（session_<kind>_<ts>_<n>，方案 §2）', () => {
    const { manager } = harness();
    const session = manager.createSession({ kind: 'mission_run' });
    expect(session?.id.startsWith('session_mission_run_')).toBe(true);
  });

  test('参与者去重、丢空串、截到上限', () => {
    const { manager } = harness();
    const session = manager.createSession({
      kind: 'peer_chat',
      participants: ['alice', 'alice', '  ', 'bob', ...Array.from({ length: 20 }, (_, i) => `p${i}`)],
    });
    expect(session?.participants[0]).toBe('alice');
    expect(new Set(session?.participants).size).toBe(session?.participants.length);
    expect(session?.participants.length).toBeLessThanOrEqual(8);
  });

  test('自动起名（有首条消息时用消息）', () => {
    const { manager } = harness();
    const session = manager.createSession({
      kind: 'peer_chat',
      participants: ['alice'],
      firstMessage: '我们先对齐一下今晚的分工',
    });
    expect(session?.title.startsWith('互聊：')).toBe(true);
    expect(session?.title).toContain('今晚的分工');
  });

  test('显式标题优先于自动起名', () => {
    const { manager } = harness();
    const session = manager.createSession({
      kind: 'peer_chat',
      title: '  今晚的站岗安排  ',
      firstMessage: '随便什么消息',
    });
    expect(session?.title).toBe('今晚的站岗安排');
  });

  test('首条消息只用于起名，不进事件流（不双写）', () => {
    const { manager } = harness();
    const session = manager.createSession({
      kind: 'peer_chat',
      firstMessage: '这条消息只是用来起名的',
    });
    expect(session?.eventCount).toBe(1); // 只有 created 一条
  });

  test('refId 透传（无关联实体时不出现该键）', () => {
    const { manager } = harness();
    const withRef = manager.createSession({ kind: 'task_run', refId: 'task_1' });
    expect(withRef?.refId).toBe('task_1');
    const withoutRef = manager.createSession({ kind: 'task_run' });
    expect(withoutRef && 'refId' in withoutRef).toBe(false);
  });
});

// ============================================================================
// 2. 追加事件
// ============================================================================

describe('appendEvent：追加事件', () => {
  test('seq 会话内单调递增，eventCount / lastEventAt 同步更新', () => {
    const { store, manager, advance, base } = harness();
    const session = manager.createSession({ kind: 'peer_chat' });
    const id = session!.id;

    advance(10);
    const first = manager.appendEvent(id, { type: 'message', payload: { author: 'a', text: '第一句' } });
    advance(10);
    const second = manager.appendEvent(id, { type: 'message', payload: { author: 'b', text: '第二句' } });

    expect(first?.seq).toBe(2); // seq=1 是建会话时的 created
    expect(second?.seq).toBe(3);
    expect(first?.sessionId).toBe(id);
    expect(sessionsOf(store)[0].eventCount).toBe(3);
    expect(sessionsOf(store)[0].lastEventAt).toBe(base + 20);
  });

  test('追加事件不改状态', () => {
    const { manager } = harness();
    const session = manager.createSession({ kind: 'peer_chat' });
    manager.appendEvent(session!.id, { type: 'message', payload: { author: 'a', text: '在吗' } });
    expect(sessionsOf(manager.store)[0].status).toBe('active');
  });

  test('closed 会话拒收事件（返回 null，摘要不变）', () => {
    const { manager } = harness();
    const session = manager.createSession({ kind: 'peer_chat' });
    manager.closeSession(session!.id);
    const before = sessionsOf(manager.store)[0];
    const appended = manager.appendEvent(session!.id, { type: 'message', payload: { author: 'a', text: '还有人在吗' } });
    expect(appended).toBeNull();
    expect(sessionsOf(manager.store)[0]).toEqual(before);
  });

  test('interrupted 会话允许继续记事件', () => {
    const { manager } = harness();
    const session = manager.createSession({ kind: 'peer_chat' });
    manager.interruptSession(session!.id, '超时');
    const appended = manager.appendEvent(session!.id, {
      type: 'resumed',
      payload: { note: '尝试恢复' },
    });
    expect(appended).not.toBeNull();
    expect(sessionsOf(manager.store)[0].status).toBe('interrupted');
    expect(sessionsOf(manager.store)[0].eventCount).toBe(3);
  });

  test('会话不存在时返回 null（不抛异常）', () => {
    const { manager } = harness();
    expect(manager.appendEvent('nope', { type: 'message', payload: { author: 'a', text: 'x' } })).toBeNull();
  });
});

// ============================================================================
// 3. 中断 / 恢复 / 收尾
// ============================================================================

describe('interrupt / resume / close', () => {
  test('中断：status → interrupted，记一条 interrupt 事件', () => {
    const { manager } = harness();
    const session = manager.createSession({ kind: 'peer_chat' });
    const interrupted = manager.interruptSession(session!.id, '互聊超时');
    expect(interrupted?.status).toBe('interrupted');
    expect(interrupted?.closedAt).toBeNull();
    expect(interrupted?.eventCount).toBe(2);
  });

  test('中断已收尾的会话被拒（返回 null + Notice），状态不变', () => {
    const { store, manager } = harness();
    const session = manager.createSession({ kind: 'peer_chat' });
    manager.closeSession(session!.id);
    const before = sessionsOf(store)[0];
    expect(manager.interruptSession(session!.id)).toBeNull();
    expect(sessionsOf(store)[0]).toEqual(before);
    expect(store.getState().notices[0]?.text).toContain('不可执行');
  });

  test('恢复：interrupted → active', () => {
    const { manager } = harness();
    const session = manager.createSession({ kind: 'peer_chat' });
    manager.interruptSession(session!.id);
    const resumed = manager.resumeSession(session!.id);
    expect(resumed?.status).toBe('active');
    expect(resumed?.eventCount).toBe(3); // created + interrupt + resumed
  });

  test('收尾：status → closed 且落 closedAt', () => {
    const { store, manager, advance, base } = harness();
    const session = manager.createSession({ kind: 'peer_chat' });
    advance(500);
    const closed = manager.closeSession(session!.id, '正常收尾');
    expect(closed?.status).toBe('closed');
    expect(closed?.closedAt).toBe(base + 500);
    expect(sessionsOf(store)[0].eventCount).toBe(2);
  });

  test('重复收尾被拒（幂等拒绝，不改写历史）', () => {
    const { store, manager } = harness();
    const session = manager.createSession({ kind: 'peer_chat' });
    manager.closeSession(session!.id);
    const before = sessionsOf(store)[0];
    expect(manager.closeSession(session!.id)).toBeNull();
    expect(sessionsOf(store)[0]).toEqual(before);
  });

  test('idle ↔ active：静默阈值命中后又能开口', () => {
    const { manager } = harness();
    const session = manager.createSession({ kind: 'peer_chat' });
    expect(manager.idleSession(session!.id)?.status).toBe('idle');
    expect(manager.activateSession(session!.id)?.status).toBe('active');
  });
});

// ============================================================================
// 4. 上限与 FIFO 淘汰
// ============================================================================

describe('上限与 FIFO 淘汰', () => {
  test('超上限时先淘汰最旧的 closed 会话', () => {
    const { store, manager } = harness({ maxSessions: 3 });
    const a = manager.createSession({ kind: 'peer_chat' })!;
    const b = manager.createSession({ kind: 'peer_chat' })!;
    const c = manager.createSession({ kind: 'peer_chat' })!;
    manager.closeSession(a.id);

    const d = manager.createSession({ kind: 'peer_chat' })!;
    const ids = sessionsOf(store).map((s) => s.id);
    expect(ids).toEqual([b.id, c.id, d.id]); // a 被淘汰
    expect(ids).toHaveLength(3);
  });

  test('全是活会话时拒绝新建（不静默挤掉在办会话）', () => {
    const { store, manager } = harness({ maxSessions: 2 });
    manager.createSession({ kind: 'peer_chat' });
    manager.createSession({ kind: 'peer_chat' });
    const rejected = manager.createSession({ kind: 'peer_chat' });
    expect(rejected).toBeNull();
    expect(sessionsOf(store)).toHaveLength(2);
    expect(store.getState().notices[0]?.text).toContain('上限');
  });

  test('没有 closed 可淘汰时拒绝新建，在办 / 被中断的会话一个都不丢', () => {
    const { store, manager } = harness({ maxSessions: 2 });
    const a = manager.createSession({ kind: 'peer_chat' })!;
    const b = manager.createSession({ kind: 'peer_chat' })!;
    manager.interruptSession(a.id);
    expect(manager.createSession({ kind: 'peer_chat' })).toBeNull();
    const ids = sessionsOf(store).map((s) => s.id);
    expect(ids).toEqual([a.id, b.id]);
  });
});
