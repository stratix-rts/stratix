/**
 * 单测：会话域的 resume / fork（core/session —— v3.2b-B1 / task_100）。
 *
 * 覆盖 5 件事：
 *   1. 迁移合法性（interrupted → active 合法；其它状态非法；kind 准入）；
 *   2. resume 的回灌快照内容（消息 / 轮次 / 中断标记的映射 + 角色归属）；
 *   3. fork 的事件复制正确性与 seq 重排（新 sessionId + 连续 seq + 载荷原样）；
 *   4. atSeq 边界（0 / 中间 / 末尾 / 越界）；
 *   5. 上下文快照构建器（context-replay）本身的映射与截断口径。
 *
 * 用真 store（createStore()）隔离；持久化口 / 读取口用**内存实现**——
 *   读取口复刻存储层 DAO 的分页口径（无 beforeSeq = 最新 limit 条；给了 = 该游标之前的 limit 条），
 *   这样"翻页读全量"的逻辑也被覆盖到（不是把全量一次性塞给 manager 的假端口）。
 */

import {
  applySessionAction,
  buildContextSnapshot,
  canApplySessionAction,
  canResumeSession,
  copyEventsForFork,
  createSessionManager,
  forkSessionTitle,
  RESUMABLE_SESSION_KINDS,
  type SessionEvent,
  type SessionEventView,
  type SessionManager,
  type SessionRecord,
} from '../session';
import { createStore, type CoreStore } from '../store';

/** 内存"库"：会话摘要 + 事件流（落库口的落点）。 */
interface FakeDb {
  readonly sessions: Map<string, SessionRecord>;
  readonly events: SessionEvent[];
}

interface Harness {
  readonly store: CoreStore;
  readonly manager: SessionManager;
  readonly db: FakeDb;
  advance(ms: number): void;
}

function harness(options: { maxSessions?: number; withRead?: boolean } = {}): Harness {
  const store = createStore();
  // 起点取真实时间：store.pushNotice 用自己的 Date.now() 剔除过期通知。
  const base = Date.now();
  let clock = base;
  let ids = 0;
  const sessions = new Map<string, SessionRecord>();
  const events: SessionEvent[] = [];

  const manager = createSessionManager({
    store,
    now: () => clock,
    createId: (prefix: string) => `${prefix}_${++ids}`,
    persist: {
      persistSession: (record) => {
        sessions.set(record.id, record);
      },
      persistEvent: (event) => {
        events.push(event);
      },
    },
    // 读取口复刻 DAO 口径：窗口 = 命中集里**最后** limit 条（seq 正序返回）。
    ...(options.withRead === false
      ? {}
      : {
          read: {
            readSessionEvents: (
              sessionId: string,
              query: { readonly beforeSeq?: number; readonly limit: number }
            ): readonly SessionEventView[] => {
              const hit = events
                .filter(
                  (event) =>
                    event.sessionId === sessionId &&
                    (query.beforeSeq === undefined || event.seq < query.beforeSeq)
                )
                .sort((a, b) => a.seq - b.seq);
              return hit.slice(Math.max(0, hit.length - query.limit)).map(toView);
            },
          },
        }),
    ...(options.maxSessions === undefined ? {} : { maxSessions: options.maxSessions }),
  });

  return {
    store,
    manager,
    db: { sessions, events },
    advance: (ms: number) => {
      clock += ms;
    },
  };
}

/** 写面事件 → 读面视图（payload 是 unknown —— 读面不校验形状）。 */
function toView(event: SessionEvent): SessionEventView {
  return {
    sessionId: event.sessionId,
    seq: event.seq,
    type: event.type,
    payload: event.payload,
    createdAt: event.createdAt,
  };
}

/** 某会话的事件（正序）。 */
function eventsOf(db: FakeDb, sessionId: string): SessionEvent[] {
  return db.events.filter((event) => event.sessionId === sessionId).sort((a, b) => a.seq - b.seq);
}

/**
 * 造一条"聊过一轮然后被中断"的互聊会话：
 *   seq1 created / seq2 message(alice) / seq3 message(bob) / seq4 round / seq5 interrupt。
 */
function seedInterruptedPeerChat(manager: SessionManager): SessionRecord {
  const session = manager.createSession({
    kind: 'peer_chat',
    participants: ['alice', 'bob'],
  })!;
  manager.appendEvent(session.id, {
    type: 'message',
    payload: { author: 'alice', text: '今晚先对一下分工' },
  });
  manager.appendEvent(session.id, {
    type: 'message',
    payload: { author: 'bob', text: '我守北门' },
  });
  manager.appendEvent(session.id, { type: 'round', payload: { summary: '分工已定' } });
  manager.interruptSession(session.id, '互聊超时');
  return session;
}

// ============================================================================
// 1. 迁移合法性
// ============================================================================

describe('迁移合法性：interrupted → active', () => {
  test('interrupted 的 resume 合法（查表 + 迁移落点都是 active）', () => {
    expect(canApplySessionAction('interrupted', 'resume')).toBe(true);
    const current: SessionRecord = {
      id: 's1',
      kind: 'peer_chat',
      title: '互聊：alice、bob',
      participants: ['alice', 'bob'],
      status: 'interrupted',
      createdAt: 1,
      lastEventAt: 2,
      closedAt: null,
      eventCount: 2,
    };
    const step = applySessionAction(current, { type: 'resume' });
    expect(step.changed).toBe(true);
    expect(step.error).toBeUndefined();
    expect(step.next.status).toBe('active');
  });

  test('非 interrupted 的 resume 一律非法（不改写历史）', () => {
    for (const status of ['active', 'idle', 'closed'] as const) {
      expect(canApplySessionAction(status, 'resume')).toBe(false);
    }
  });

  test('resume 的 kind 准入：第一期只认 peer_chat', () => {
    expect(RESUMABLE_SESSION_KINDS).toEqual(['peer_chat']);
    expect(canResumeSession('peer_chat', 'interrupted')).toBe(true);
    expect(canResumeSession('peer_chat', 'active')).toBe(false);
    expect(canResumeSession('character_chat', 'interrupted')).toBe(false);
    expect(canResumeSession('task_run', 'interrupted')).toBe(false);
  });
});

// ============================================================================
// 2. resume：回灌快照内容
// ============================================================================

describe('resume：回灌上下文', () => {
  test('恢复后 status=active，并追加一条 resumed 事件', () => {
    const { manager, db } = harness();
    const session = seedInterruptedPeerChat(manager);
    const outcome = manager.resume(session.id);
    expect(outcome).not.toBeNull();
    expect(outcome?.session.status).toBe('active');
    expect(outcome?.event?.type).toBe('resumed');
    // 事件流：原来 5 条 + resumed = 6 条（seq 连续）
    const events = eventsOf(db, session.id);
    expect(events.map((event) => event.type)).toEqual([
      'created',
      'message',
      'message',
      'round',
      'interrupt',
      'resumed',
    ]);
    expect(events.map((event) => event.seq)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  test('快照内容 = 消息 / 轮次 / 中断标记（会话生命周期事件不回灌）', () => {
    const { manager } = harness();
    const session = seedInterruptedPeerChat(manager);
    const snapshot = manager.resume(session.id)?.snapshot;
    expect(snapshot).toBeDefined();
    expect(snapshot?.messages.map((message) => message.kind)).toEqual([
      'message',
      'message',
      'round',
      'interrupt',
    ]);
    expect(snapshot?.messages[0]?.content).toBe('今晚先对一下分工');
    expect(snapshot?.messages[0]?.author).toBe('alice');
    expect(snapshot?.messages[1]?.content).toBe('我守北门');
    expect(snapshot?.messages[2]?.content).toBe('（一轮对话收束：分工已定）');
    expect(snapshot?.messages[3]?.content).toBe('（互聊中断：互聊超时）');
    // seq 可回指事件流
    expect(snapshot?.messages.map((message) => message.seq)).toEqual([2, 3, 4, 5]);
    expect(snapshot?.sessionId).toBe(session.id);
    expect(snapshot?.truncated).toBe(false);
  });

  test('角色归属：默认按参与者顺序；给了续跑方则相对续跑方定', () => {
    const { manager } = harness();
    const session = seedInterruptedPeerChat(manager);
    const byOrder = manager.resume(session.id)?.snapshot;
    expect(byOrder?.messages[0]?.role).toBe('user'); // alice = participants[0]
    expect(byOrder?.messages[1]?.role).toBe('assistant'); // bob

    // 换个会话重跑：这次是 bob 续跑 → bob 的话算 assistant。
    const other = harness();
    const otherSession = seedInterruptedPeerChat(other.manager);
    const bySelf = other.manager.resume(otherSession.id, { selfParticipantId: 'bob' })?.snapshot;
    expect(bySelf?.messages[0]?.role).toBe('user');
    expect(bySelf?.messages[1]?.role).toBe('assistant');
  });

  test('非 peer_chat 的会话不能恢复（第一期口径）', () => {
    const { manager, store } = harness();
    const session = manager.createSession({ kind: 'character_chat' })!;
    manager.interruptSession(session.id);
    expect(manager.resume(session.id)).toBeNull();
    expect(store.getState().notices[0]?.text).toContain('不支持恢复');
  });

  test('状态不对时拒绝（非 interrupted）', () => {
    const { manager, store } = harness();
    const session = manager.createSession({ kind: 'peer_chat' })!;
    expect(manager.resume(session.id)).toBeNull();
    expect(store.getState().notices[0]?.text).toContain('不可执行');
  });

  test('会话不存在时拒绝', () => {
    const { manager } = harness();
    expect(manager.resume('nope')).toBeNull();
  });

  test('没有事件源时拒绝（不编造上下文）', () => {
    const { manager, store } = harness({ withRead: false });
    const session = seedInterruptedPeerChat(manager);
    expect(manager.resume(session.id)).toBeNull();
    expect(store.getState().notices[0]?.text).toContain('事件源');
    // 会话状态不被改动
    expect(
      manager.store.getState().sessions?.find((item) => item.id === session.id)?.status
    ).toBe('interrupted');
  });
});

// ============================================================================
// 3. fork：事件复制与 seq 重排
// ============================================================================

describe('fork：新会话 + 事件复制', () => {
  test('新会话：id 新起、参与者继承、标题带分叉标记、状态 active', () => {
    const { manager } = harness();
    const session = seedInterruptedPeerChat(manager);
    const forked = manager.fork(session.id);
    expect(forked).not.toBeNull();
    expect(forked?.session.id).not.toBe(session.id);
    expect(forked?.session.id.startsWith('session_peer_chat_')).toBe(true);
    expect(forked?.session.participants).toEqual(['alice', 'bob']);
    expect(forked?.session.title).toContain('分叉');
    expect(forked?.session.status).toBe('active');
    expect(forked?.sourceSessionId).toBe(session.id);
  });

  test('复制的事件：换新 sessionId + seq 重排为连续序号，载荷原样', () => {
    const { manager, db } = harness();
    const session = seedInterruptedPeerChat(manager);
    const forked = manager.fork(session.id)!;
    const events = eventsOf(db, forked.session.id);
    // 事件类型：自己的 created + 复制来的对话事件 + forked
    expect(events.map((event) => event.type)).toEqual([
      'created',
      'message',
      'message',
      'round',
      'interrupt',
      'forked',
    ]);
    // seq 连续（从 1 起）
    expect(events.map((event) => event.seq)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(events.every((event) => event.sessionId === forked.session.id)).toBe(true);
    // 载荷原样（author/text 不变）
    const copied = events[1];
    expect(copied?.payload).toEqual({ author: 'alice', text: '今晚先对一下分工' });
  });

  test('forked 事件记录来源（sourceSessionId / atSeq / copiedCount）', () => {
    const { manager, db } = harness();
    const session = seedInterruptedPeerChat(manager);
    const forked = manager.fork(session.id)!;
    const events = eventsOf(db, forked.session.id);
    const marker = events[events.length - 1];
    expect(marker?.type).toBe('forked');
    expect(marker?.payload).toEqual({
      sourceSessionId: session.id,
      atSeq: 5,
      copiedCount: 4,
    });
    expect(forked.copiedCount).toBe(4);
    expect(forked.atSeq).toBe(5);
  });

  test('源会话只读：状态与事件流一个字都没改', () => {
    const { manager, db } = harness();
    const session = seedInterruptedPeerChat(manager);
    const before = eventsOf(db, session.id);
    manager.fork(session.id);
    expect(eventsOf(db, session.id)).toEqual(before);
    expect(
      manager.store.getState().sessions?.find((item) => item.id === session.id)?.status
    ).toBe('interrupted');
  });

  test('新会话的摘要与事件流一致（eventCount = 事件条数）', () => {
    const { manager, db } = harness();
    const session = seedInterruptedPeerChat(manager);
    const forked = manager.fork(session.id)!;
    expect(forked.session.eventCount).toBe(6);
    expect(eventsOf(db, forked.session.id)).toHaveLength(6);
  });
});

// ============================================================================
// 4. atSeq 边界
// ============================================================================

describe('fork：atSeq 边界', () => {
  test('atSeq=0：不复制任何对话事件（分叉在起点之前）', () => {
    const { manager, db } = harness();
    const session = seedInterruptedPeerChat(manager);
    const forked = manager.fork(session.id, 0)!;
    expect(forked.copiedCount).toBe(0);
    expect(forked.atSeq).toBe(0);
    expect(eventsOf(db, forked.session.id).map((event) => event.type)).toEqual([
      'created',
      'forked',
    ]);
  });

  test('atSeq=中间：只复制到该 seq（含）', () => {
    const { manager, db } = harness();
    const session = seedInterruptedPeerChat(manager);
    // 源会话事件：1 created / 2 message / 3 message / 4 round / 5 interrupt
    const forked = manager.fork(session.id, 3)!;
    expect(forked.atSeq).toBe(3);
    expect(forked.copiedCount).toBe(2); // seq2、seq3 两条 message（created 不继承）
    const events = eventsOf(db, forked.session.id);
    expect(events.map((event) => event.type)).toEqual(['created', 'message', 'message', 'forked']);
    expect(events.map((event) => event.seq)).toEqual([1, 2, 3, 4]);
  });

  test('atSeq 缺省 = 全量', () => {
    const { manager } = harness();
    const session = seedInterruptedPeerChat(manager);
    const forked = manager.fork(session.id)!;
    expect(forked.atSeq).toBe(5);
    expect(forked.copiedCount).toBe(4);
  });

  test('atSeq 越界（大于末尾）夹到末尾；负数夹到 0', () => {
    const { manager } = harness();
    const session = seedInterruptedPeerChat(manager);
    expect(manager.fork(session.id, 999)?.copiedCount).toBe(4);
    expect(manager.fork(session.id, 999)?.atSeq).toBe(5);
    expect(manager.fork(session.id, -3)?.copiedCount).toBe(0);
  });

  test('会话不存在 / 没有事件源时拒绝分叉', () => {
    const { manager } = harness();
    expect(manager.fork('nope')).toBeNull();
    const noRead = harness({ withRead: false });
    const session = seedInterruptedPeerChat(noRead.manager);
    expect(noRead.manager.fork(session.id)).toBeNull();
  });
});

// ============================================================================
// 5. 上下文快照构建器（context-replay）
// ============================================================================

describe('context-replay：快照构建器', () => {
  const session: SessionRecord = {
    id: 's1',
    kind: 'peer_chat',
    title: '互聊：alice、bob',
    participants: ['alice', 'bob'],
    status: 'interrupted',
    createdAt: 1,
    lastEventAt: 5,
    closedAt: null,
    eventCount: 5,
  };

  const events: SessionEventView[] = [
    { sessionId: 's1', seq: 1, type: 'created', payload: { title: 'x', participants: [] }, createdAt: 1 },
    { sessionId: 's1', seq: 2, type: 'message', payload: { author: 'alice', text: '一' }, createdAt: 2 },
    { sessionId: 's1', seq: 3, type: 'message', payload: { author: 'bob', text: '二' }, createdAt: 3 },
    { sessionId: 's1', seq: 4, type: 'message', payload: { author: 'alice', text: '三' }, createdAt: 4 },
  ];

  test('生命周期事件（created）不回灌；空正文消息也不回灌', () => {
    const snapshot = buildContextSnapshot({
      session,
      events: [
        ...events,
        { sessionId: 's1', seq: 5, type: 'message', payload: { author: 'alice', text: '' }, createdAt: 5 },
      ],
    });
    expect(snapshot.messages.map((message) => message.content)).toEqual(['一', '二', '三']);
    expect(snapshot.eventCount).toBe(5);
  });

  test('超过上限时只保留最近若干条，并显式标出丢了多少', () => {
    const snapshot = buildContextSnapshot({ session, events, maxMessages: 2 });
    expect(snapshot.messages.map((message) => message.content)).toEqual(['二', '三']);
    expect(snapshot.truncated).toBe(true);
    expect(snapshot.droppedCount).toBe(1);
  });

  test('分叉复制：跳过生命周期事件，seq 从 startSeq 起连续', () => {
    const copied = copyEventsForFork(
      [
        ...events,
        { sessionId: 's1', seq: 5, type: 'closed', payload: { reason: '收尾' }, createdAt: 5 },
      ],
      { sessionId: 's2', atSeq: 5, startSeq: 2 }
    );
    expect(copied.map((event) => event.type)).toEqual(['message', 'message', 'message']);
    expect(copied.map((event) => event.seq)).toEqual([2, 3, 4]);
    expect(copied.every((event) => event.sessionId === 's2')).toBe(true);
  });

  test('分叉复制：载荷形状收窄（脏行跳过，不编造）', () => {
    const copied = copyEventsForFork(
      [
        { sessionId: 's1', seq: 1, type: 'message', payload: { author: 42, text: 'x' }, createdAt: 1 },
        { sessionId: 's1', seq: 2, type: 'message', payload: { author: 'a' }, createdAt: 2 },
        { sessionId: 's1', seq: 3, type: 'unknown_future', payload: { x: 1 }, createdAt: 3 },
      ],
      { sessionId: 's2' }
    );
    expect(copied).toHaveLength(1);
    expect(copied[0]?.payload).toEqual({ author: '', text: 'x' });
    expect(copied[0]?.seq).toBe(1);
  });

  test('分叉标题：先给标记留位再截原标题（标记不会被上限截掉）', () => {
    const title = forkSessionTitle('互聊：非常非常长的一个会话标题');
    expect(title.endsWith('·分叉')).toBe(true);
    expect(title.length).toBeLessThanOrEqual(20);
  });
});
