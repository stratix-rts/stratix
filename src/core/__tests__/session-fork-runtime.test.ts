/**
 * 单测：**session.fork 命令的总线往返落点**（@since v3.48，task_102 / v3.2b-B3）——
 *   HUD 命令 → core/bus → core runtime **直调 session manager** → 新会话落进 WorldState。
 *
 * why 单开一单而不并进 session-resume-fork.test.ts：那份是**直调** manager（不经总线），
 *   这里验的是**命令通道** —— runtime 是不是真的接住了这条命令、有没有转给 manager.fork。
 *   打的是真总线 + 真 store：runtime 的全部职责就是"接在总线上"，mock 掉总线等于把被测行为一起 mock 掉。
 *
 * 与 session.resume 的差别（口径写在 runtime 的 case 上）：resume 要把上文喂回模型、
 *   重启轮转 —— 那件事在 app 层（互聊引擎），故 core 只**转发**给注入的端口；
 *   fork 是**纯 core 逻辑**（读事件流 → 复制到 atSeq → 建新会话），故 core 直调 manager
 *   （与 session.interrupt 同一纪律），不需要注入端口。
 *
 * atSeq 边界四档（0 / 中间 / 末尾 / 缺省全量）在这里再走一遍**命令通道** ——
 *   manager 层的边界用例在 session-resume-fork.test.ts，两层各验一半，合起来才是全貌。
 */

import { emitCommand, resetBus } from '../bus';
import { createCoreRuntime, type CoreRuntime } from '../runtime';
import {
  createSessionManager,
  type SessionEvent,
  type SessionEventView,
  type SessionManager,
  type SessionRecord,
} from '../session';
import { createStore, type CoreStore } from '../store';

interface Harness {
  readonly store: CoreStore;
  readonly session: SessionManager;
  readonly runtime: CoreRuntime;
  /** 落库的事件（写面口径）。 */
  readonly events: SessionEvent[];
  readonly stop: () => void;
}

/**
 * 起一套真链路：真 store + 真 session manager（内存持久化口 + 内存事件读口）+ 真 runtime（接总线）。
 *
 * 内存读口复刻存储层 DAO 的分页口径（无 beforeSeq = 最新 limit 条；给了 = 该游标之前的 limit 条）——
 *   这样 manager「翻页读全量」的逻辑也被覆盖到（不是把全量一次性塞给 manager 的假端口）。
 */
function harness(): Harness {
  const store = createStore();
  const events: SessionEvent[] = [];
  const session = createSessionManager({
    store,
    persist: {
      persistSession: () => { /* 摘要快照不参与本单的断言（落库口径在 MCP 那层验）。 */ },
      persistEvent: (event) => { events.push(event); },
    },
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
  });
  const runtime = createCoreRuntime({ store, session });
  const stop = runtime.start();
  return { store, session, runtime, events, stop };
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

/**
 * 造一条"聊过一轮"的互聊会话：
 *   seq1 created / seq2 message(alice) / seq3 message(bob) / seq4 round。
 */
function seedPeerChat(session: SessionManager): SessionRecord {
  const record = session.createSession({
    kind: 'peer_chat',
    participants: ['alice', 'bob'],
  })!;
  session.appendEvent(record.id, {
    type: 'message',
    payload: { author: 'alice', text: '今晚先对一下分工' },
  });
  session.appendEvent(record.id, {
    type: 'message',
    payload: { author: 'bob', text: '我守北门' },
  });
  session.appendEvent(record.id, { type: 'round', payload: { summary: '分工已定' } });
  return record;
}

/** 某会话的事件（正序）。 */
function eventsOf(events: readonly SessionEvent[], sessionId: string): SessionEvent[] {
  return events.filter((event) => event.sessionId === sessionId).sort((a, b) => a.seq - b.seq);
}

/** 分叉产物（WorldState.sessions 里比源会话多出来的那条）。 */
function forkedSession(store: CoreStore, sourceId: string): SessionRecord | undefined {
  return (store.getState().sessions ?? []).find((item) => item.id !== sourceId);
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

describe('session.fork：HUD 命令 → runtime → session manager', () => {
  test('命令经总线落到 manager：状态里多出一条新会话（路由通了）', () => {
    const { store, session, stop } = harness();
    cleanups.push(stop);

    const source = seedPeerChat(session);
    expect((store.getState().sessions ?? []).length).toBe(1);

    emitCommand({ type: 'session.fork', sessionId: source.id });

    const sessions = store.getState().sessions ?? [];
    expect(sessions.length).toBe(2);
    const created = sessions.find((item) => item.id !== source.id)!;
    // 新会话继承 kind / participants / refId，标题带分叉标记（口径归 core/session 的 manager.fork）。
    expect(created.kind).toBe('peer_chat');
    expect(created.participants).toEqual(['alice', 'bob']);
    expect(created.title).not.toBe(source.title);
    expect(created.title).toContain('分叉');
    expect(created.status).toBe('active');
  });

  test('atSeq=0：复制 0 条对话事件（分叉在起点之前）', () => {
    const { store, session, stop } = harness();
    cleanups.push(stop);

    const source = seedPeerChat(session);
    emitCommand({ type: 'session.fork', sessionId: source.id, atSeq: 0 });

    const created = forkedSession(store, source.id)!;
    // 新会话自己的 created + forked = 2 条（没有任何对话事件被复制）。
    expect(created.eventCount).toBe(2);
  });

  test('atSeq=中间：只复制到该 seq（含）', () => {
    const { store, session, events, stop } = harness();
    cleanups.push(stop);

    const source = seedPeerChat(session);
    emitCommand({ type: 'session.fork', sessionId: source.id, atSeq: 3 });

    const created = forkedSession(store, source.id)!;
    const copied = eventsOf(events, created.id).filter((event) => event.type === 'message');
    expect(copied).toHaveLength(2); // seq2 / seq3 两条消息
    expect(copied[0]?.payload).toMatchObject({ author: 'alice' });
    expect(copied[1]?.payload).toMatchObject({ author: 'bob' });
    // 摘要计数 = 复制条数 + 自己的 created + forked。
    expect(created.eventCount).toBe(4);
  });

  test('atSeq=末尾：复制全部对话事件', () => {
    const { store, session, events, stop } = harness();
    cleanups.push(stop);

    const source = seedPeerChat(session);
    emitCommand({ type: 'session.fork', sessionId: source.id, atSeq: 4 });

    const created = forkedSession(store, source.id)!;
    expect(eventsOf(events, created.id).filter((event) => event.type !== 'forked').length).toBe(4);
    expect(created.eventCount).toBe(5); // 3 条对话 + created + forked
  });

  test('atSeq 缺省 = 全量（与末尾同效）', () => {
    const { store, session, events, stop } = harness();
    cleanups.push(stop);

    const source = seedPeerChat(session);
    emitCommand({ type: 'session.fork', sessionId: source.id });

    const created = forkedSession(store, source.id)!;
    expect(created.eventCount).toBe(5);
    expect(eventsOf(events, created.id).map((event) => event.type)).toEqual([
      'created',
      'message',
      'message',
      'round',
      'forked',
    ]);
  });

  test('atSeq 越界（大于末尾）夹到末尾 —— 不是错误', () => {
    const { store, session, stop } = harness();
    cleanups.push(stop);

    const source = seedPeerChat(session);
    emitCommand({ type: 'session.fork', sessionId: source.id, atSeq: 999 });

    const created = forkedSession(store, source.id)!;
    expect(created.eventCount).toBe(5);
  });

  test('源会话只读：分叉不改写源会话的状态与事件流', () => {
    const { store, session, events, stop } = harness();
    cleanups.push(stop);

    const source = seedPeerChat(session);
    emitCommand({ type: 'session.fork', sessionId: source.id, atSeq: 3 });

    const after = (store.getState().sessions ?? []).find((item) => item.id === source.id)!;
    expect(after.status).toBe('active');
    expect(after.eventCount).toBe(4); // 原样：created + 2 message + round
    expect(eventsOf(events, source.id).map((event) => event.type)).toEqual([
      'created',
      'message',
      'message',
      'round',
    ]);
  });

  test('会话不存在 → 不新建会话（core 如实拒绝并回 Notice）', () => {
    const { store, stop } = harness();
    cleanups.push(stop);

    emitCommand({ type: 'session.fork', sessionId: 'session_不存在' });

    expect(store.getState().sessions ?? []).toHaveLength(0);
    const notices = store.getState().notices ?? [];
    expect(notices.some((notice) => notice.text.includes('会话不存在'))).toBe(true);
  });
});
