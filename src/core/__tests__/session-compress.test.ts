/**
 * 单测：**长会话压缩**（core/session —— v3.2b-B7 / task_106）。
 *
 * 覆盖 5 件事（验收口径）：
 *   1. **阈值触发**：eventCount 超阈值才折叠；不超阈值一条摘要都不出；
 *   2. **保留窗**：折叠后最近 N 条原文仍在（未被盖住），更早的被摘要盖住；
 *   3. **摘要内容**：fromSeq/toSeq/轮次/参与者/首末摘要/中断结论行都对；
 *   4. **读取路由**：默认「摘要 + 近期原文」；includeRaw 展开原段；分页（beforeSeq + limit）正确；
 *   5. **重复压缩幂等**：压缩后再 append 不会把同一段再折一次；折叠失败不改原事件。
 *
 * 用真 store（createStore()）隔离；持久化口 / 读取口用**内存实现**——
 *   读取口复刻存储层 DAO 的分页口径（无 beforeSeq = 最新 limit 条；给了 = 该游标之前的 limit 条），
 *   这样"翻页读"的逻辑也被覆盖到（不是把全量一次性塞给 manager 的假端口）。
 */

import {
  createSessionManager,
  readRoutedSessionEvents,
  routeSessionEvents,
  SESSION_COMPRESS_KEEP_RECENT,
  DEFAULT_SESSION_COMPRESS_THRESHOLD,
  type SessionCompressPayload,
  type SessionEvent,
  type SessionEventView,
  type SessionManager,
  type SessionRecord,
} from '../session';
import { createStore, type CoreStore } from '../store';

interface Harness {
  readonly store: CoreStore;
  readonly manager: SessionManager;
  readonly events: SessionEvent[];
  readonly sessions: Map<string, SessionRecord>;
  /** 读口统计：读了几次 / 一共取回了几行（读放大的度量尺）。 */
  readonly stats: { readonly readCalls: number; readonly rowsRead: number };
}

function harness(
  options: {
    readonly compressThreshold?: number;
    readonly compressKeepRecent?: number;
    /** 不实现向前读（逼 core 走「窗口 + 向前翻页」的慢路径）。 */
    readonly noForwardRead?: boolean;
  } = {}
): Harness {
  const store = createStore();
  // 起点取真实时间：store.pushNotice 用自己的 Date.now() 剔除过期通知。
  const base = Date.now();
  let clock = base;
  let ids = 0;
  const sessions = new Map<string, SessionRecord>();
  const events: SessionEvent[] = [];
  const stats = { readCalls: 0, rowsRead: 0 };

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
        const window = hit.slice(Math.max(0, hit.length - query.limit));
        stats.readCalls += 1;
        stats.rowsRead += window.length;
        return window.map(toView);
      },
      // 向前读（@since v3.48 / task_106）：取 seq 大于 afterSeq 的**最早** limit 条。
      ...(options.noForwardRead
        ? {}
        : {
            readSessionEventsAfter: (
              sessionId: string,
              afterSeq: number,
              limit: number
            ): readonly SessionEventView[] => {
              const hit = events
                .filter((event) => event.sessionId === sessionId && event.seq > afterSeq)
                .sort((a, b) => a.seq - b.seq);
              const page = hit.slice(0, limit);
              stats.readCalls += 1;
              stats.rowsRead += page.length;
              return page.map(toView);
            },
          }),
    },
    ...(options.compressThreshold === undefined
      ? {}
      : { compressThreshold: options.compressThreshold }),
    ...(options.compressKeepRecent === undefined
      ? {}
      : { compressKeepRecent: options.compressKeepRecent }),
  });

  return { store, manager, events, sessions, stats };
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
function eventsOf(db: Harness, sessionId: string): SessionEvent[] {
  return db.events.filter((event) => event.sessionId === sessionId).sort((a, b) => a.seq - b.seq);
}

/** 压缩摘要事件（正序）。 */
function summariesOf(db: Harness, sessionId: string): SessionEvent[] {
  return eventsOf(db, sessionId).filter((event) => event.type === 'compressed');
}

/** 摘要载荷（读面解析）。 */
function summaryPayload(event: SessionEvent): SessionCompressPayload {
  return event.payload as SessionCompressPayload;
}

/** 造一条互聊会话并灌 n 条消息（每条消息 = 一条 'message' 事件）。 */
function seedMessages(
  manager: SessionManager,
  sessionId: string,
  count: number,
  prefix = 'm'
): void {
  for (let i = 0; i < count; i += 1) {
    manager.appendEvent(sessionId, {
      type: 'message',
      payload: { author: i % 2 === 0 ? 'alice' : 'bob', text: `${prefix}${i}` },
    });
  }
}

describe('长会话压缩（core/session —— v3.2b-B7 / task_106）', () => {
  it('阈值触发：eventCount 未超阈值不折叠，超阈值才折出一段', () => {
    const db = harness({ compressThreshold: 10, compressKeepRecent: 3 });
    const session = db.manager.createSession({
      kind: 'peer_chat',
      participants: ['alice', 'bob'],
    })!;
    // created 事件已记（seq=1）→ 再灌 9 条消息 = eventCount 10（不超阈值 10）。
    seedMessages(db.manager, session.id, 9);
    expect(db.manager.store.getState().sessions?.[0]?.eventCount).toBe(10);
    expect(summariesOf(db, session.id)).toHaveLength(0);

    // 第 11 条 → eventCount 11 > 10 → 触发折叠。
    seedMessages(db.manager, session.id, 1);
    const summaries = summariesOf(db, session.id);
    expect(summaries).toHaveLength(1);
    // 摘要事件本身也是一条事件（落库、留痕）。
    expect(summaries[0]!.seq).toBe(12);
  });

  it('保留窗：最近 3 条原文留着，更早的原文被摘要盖住（默认视图看不见）', () => {
    const db = harness({ compressThreshold: 10, compressKeepRecent: 3 });
    const session = db.manager.createSession({ kind: 'peer_chat', participants: ['alice'] })!;
    seedMessages(db.manager, session.id, 10);

    const views = eventsOf(db, session.id).map(toView);
    const route = routeSessionEvents(views, { limit: 100 });
    const seqs = route.items.map((item) => item.seq);

    // 可见 = 保留窗的 3 条原文（seq 9,10,11）+ 一条摘要（seq 12）。
    expect(seqs).toEqual([9, 10, 11, 12]);
    // 被折掉的原文（seq 1..8）一个都不露。
    expect(seqs.some((seq) => seq <= 8)).toBe(false);
    expect(route.compressed).toBe(true);
    expect(route.ranges).toEqual([{ fromSeq: 1, toSeq: 8 }]);
  });

  it('摘要内容：区间 / 轮次 / 参与者 / 首末摘要 / 中断结论行', () => {
    const db = harness({ compressThreshold: 6, compressKeepRecent: 2 });
    const session = db.manager.createSession({ kind: 'peer_chat', participants: ['alice'] })!;
    // seq2 message(alice) / seq3 message(bob) / seq4 round / seq5 interrupt / seq6 message
    db.manager.appendEvent(session.id, {
      type: 'message',
      payload: { author: 'alice', text: '先说说北门' },
    });
    db.manager.appendEvent(session.id, {
      type: 'message',
      payload: { author: 'bob', text: '我去东墙' },
    });
    db.manager.appendEvent(session.id, { type: 'round', payload: { summary: '一轮结束' } });
    db.manager.appendEvent(session.id, {
      type: 'interrupt',
      payload: { reason: '回合超时' },
    });
    db.manager.appendEvent(session.id, {
      type: 'message',
      payload: { author: 'alice', text: '继续' },
    });
    // eventCount = 6（created + 5）→ 阈值 6 未超；再来一条 → 7 > 6 触发。
    db.manager.appendEvent(session.id, {
      type: 'message',
      payload: { author: 'bob', text: '接着' },
    });

    const summaries = summariesOf(db, session.id);
    expect(summaries).toHaveLength(1);
    const payload = summaryPayload(summaries[0]!);
    // 折掉的是最老的一段（保留窗 2 条：最后两条消息）。
    expect(payload.fromSeq).toBe(1);
    expect(payload.toSeq).toBe(5);
    expect(payload.foldedCount).toBe(5);
    expect(payload.rounds).toBe(1);
    expect(payload.participants).toEqual(['alice', 'bob']);
    expect(payload.firstSummary).toBe('先说说北门');
    // 末条摘要是**被折那一段**的末条消息（'继续' 在保留窗里，没被折）。
    expect(payload.lastSummary).toBe('我去东墙');
    expect(payload.keyEvents).toEqual(['中断：回合超时']);
  });

  it('读取路由：includeRaw 展开原段；分页（beforeSeq + limit）按可见事件切', () => {
    const db = harness({ compressThreshold: 10, compressKeepRecent: 3 });
    const session = db.manager.createSession({ kind: 'peer_chat', participants: ['alice'] })!;
    seedMessages(db.manager, session.id, 10);
    const views = eventsOf(db, session.id).map(toView);

    // 默认视图：摘要 + 近期原文（4 条）。
    const plain = routeSessionEvents(views, { limit: 100 });
    expect(plain.items.map((item) => item.seq)).toEqual([9, 10, 11, 12]);

    // 展开原段：被折掉的原文也回来（摘要仍在 —— 摘要与原文并存）。
    const expanded = routeSessionEvents(views, { includeRaw: true, limit: 100 });
    expect(expanded.items.map((item) => item.seq)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(expanded.total).toBe(12);

    // 分页：取**最后** limit 条（与 DAO 窗口同一口径）。
    const page1 = routeSessionEvents(views, { limit: 2 });
    expect(page1.items.map((item) => item.seq)).toEqual([11, 12]);
    expect(page1.hasMore).toBe(true);
    expect(page1.total).toBe(4);

    // 翻页：beforeSeq 游标（取 seq 小于它的那些）。
    const page2 = routeSessionEvents(views, { limit: 2, beforeSeq: 11 });
    expect(page2.items.map((item) => item.seq)).toEqual([9, 10]);
    // 更早的原文都被摘要盖住了 → 可见事件没有更多（要老原文得 includeRaw 展开）。
    expect(page2.hasMore).toBe(false);

    const page3 = routeSessionEvents(views, { limit: 2, beforeSeq: 9 });
    expect(page3.items.map((item) => item.seq)).toEqual([]);
    expect(page3.hasMore).toBe(false);
  });

  it('重复压缩幂等：压缩后再 append 折的是**新的一段**，同一段不会被折两次', () => {
    const db = harness({ compressThreshold: 10, compressKeepRecent: 3 });
    const session = db.manager.createSession({ kind: 'peer_chat', participants: ['alice'] })!;
    seedMessages(db.manager, session.id, 10);
    const first = summaryPayload(summariesOf(db, session.id)[0]!);
    expect(first.fromSeq).toBe(1);
    expect(first.toSeq).toBe(8);

    // 再灌 4 条：保留窗（3 条）之外又有可折叠的原文 → 折**新的一段**。
    seedMessages(db.manager, session.id, 4);
    const summaries = summariesOf(db, session.id);
    expect(summaries.length).toBeGreaterThan(1);
    // 每一段都折在**更靠后**的位置（toSeq 递增 → 没重叠 → 没重折同一段）。
    for (let i = 1; i < summaries.length; i += 1) {
      const prev = summaryPayload(summaries[i - 1]!);
      const cur = summaryPayload(summaries[i]!);
      expect(cur.toSeq).toBeGreaterThan(prev.toSeq);
    }
    // 累积摘要：最后一条覆盖到最新边界，条数是累加的。
    const last = summaryPayload(summaries[summaries.length - 1]!);
    expect(last.fromSeq).toBe(1);
    expect(last.foldedCount).toBe(first.foldedCount + 4);

    // 全部折叠区间合起来 = 一条连续前缀（不重不漏）。
    const route = routeSessionEvents(eventsOf(db, session.id).map(toView), { limit: 100 });
    expect(route.ranges).toHaveLength(1);
    expect(route.ranges[0]!.fromSeq).toBe(1);
    // 默认视图只露**最后一条**摘要（前面的已被它吸收）+ 保留窗里的原文。
    const shown = route.items.filter((item) => item.type === 'compressed');
    expect(shown).toHaveLength(1);
    expect(shown[0]!.seq).toBe(summaries[summaries.length - 1]!.seq);
  });

  it('折叠失败不改原事件：摘要实现抛错时，事件流一个字节都不变', () => {
    const store = createStore();
    const base = Date.now();
    let ids = 0;
    const events: SessionEvent[] = [];
    const manager = createSessionManager({
      store,
      now: () => base,
      createId: (prefix: string) => `${prefix}_${++ids}`,
      compressThreshold: 5,
      compressKeepRecent: 2,
      compressSummarizer: {
        id: 'boom',
        summarize: () => {
          throw new Error('摘要炸了');
        },
      },
      persist: {
        persistSession: () => undefined,
        persistEvent: (event) => {
          events.push(event);
        },
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
    const session = manager.createSession({ kind: 'peer_chat', participants: ['alice'] })!;
    seedMessages(manager, session.id, 6);

    // 摘要实现炸了 → 没有摘要事件，原文一条不少。
    expect(events.filter((event) => event.type === 'compressed')).toHaveLength(0);
    expect(events.filter((event) => event.type === 'message')).toHaveLength(6);
    // 事件计数照常（append 不受影响）。
    expect(store.getState().sessions?.[0]?.eventCount).toBe(7);
  });

  it('缺省口径：阈值 200 / 保留窗 50（契约常量）', () => {
    expect(DEFAULT_SESSION_COMPRESS_THRESHOLD).toBe(200);
    expect(SESSION_COMPRESS_KEEP_RECENT).toBe(50);

    const db = harness(); // 缺省 = 200 / 50
    const session = db.manager.createSession({ kind: 'peer_chat', participants: ['alice'] })!;
    // eventCount 到 200（created + 199 条消息）仍不折叠。
    seedMessages(db.manager, session.id, 199);
    expect(summariesOf(db, session.id)).toHaveLength(0);
    // 第 200 条消息 → eventCount 201 > 200 → 折叠（保留最近 50 条原文）。
    seedMessages(db.manager, session.id, 1);
    const summaries = summariesOf(db, session.id);
    expect(summaries).toHaveLength(1);
    const payload = summaryPayload(summaries[0]!);
    expect(payload.fromSeq).toBe(1);
    expect(payload.toSeq).toBe(151);
    expect(payload.foldedCount).toBe(151);

    const route = routeSessionEvents(eventsOf(db, session.id).map(toView), { limit: 100 });
    const rawSeqs = route.items.filter((item) => item.type === 'message').map((item) => item.seq);
    expect(rawSeqs).toHaveLength(50);
    expect(rawSeqs[0]).toBe(152);
    expect(rawSeqs[rawSeqs.length - 1]).toBe(201);
  });

  it('读取路由（带 IO）：默认「摘要 + 近期原文」；includeRaw 展开原段；分页按可见事件切', () => {
    const db = harness({ compressThreshold: 10, compressKeepRecent: 3 });
    const session = db.manager.createSession({ kind: 'peer_chat', participants: ['alice'] })!;
    seedMessages(db.manager, session.id, 10);
    // 读口复刻 DAO 的窗口口径（最后 limit 条 / beforeSeq 之前的那一段）。
    const read = {
      readSessionEvents: (
        sessionId: string,
        query: { readonly beforeSeq?: number; readonly limit: number }
      ): readonly SessionEventView[] => {
        const hit = db.events
          .filter(
            (event) =>
              event.sessionId === sessionId &&
              (query.beforeSeq === undefined || event.seq < query.beforeSeq)
          )
          .sort((a, b) => a.seq - b.seq);
        return hit.slice(Math.max(0, hit.length - query.limit)).map(toView);
      },
    };

    // 默认视图：保留窗里的 3 条原文 + 一条摘要（被折掉的 1..8 一个都不露）。
    const plain = readRoutedSessionEvents(read, session.id, { limit: 100 });
    expect(plain.items.map((item) => item.seq)).toEqual([9, 10, 11, 12]);
    expect(plain.compressed).toBe(true);
    expect(plain.ranges).toEqual([{ fromSeq: 1, toSeq: 8 }]);
    expect(plain.total).toBe(4);

    // 展开原段：原文一条不少（摘要与原文并存）。
    const expanded = readRoutedSessionEvents(read, session.id, { limit: 100, includeRaw: true });
    expect(expanded.items.map((item) => item.seq)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12,
    ]);
    expect(expanded.ranges).toEqual([{ fromSeq: 1, toSeq: 8 }]);

    // 分页：按**可见**事件切（最后 limit 条）。
    const page = readRoutedSessionEvents(read, session.id, { limit: 2 });
    expect(page.items.map((item) => item.seq)).toEqual([11, 12]);
    expect(page.hasMore).toBe(true);

    // 翻页游标：beforeSeq 之前的一段（可见事件里更早的那些）。
    const older = readRoutedSessionEvents(read, session.id, { limit: 2, beforeSeq: 11 });
    expect(older.items.map((item) => item.seq)).toEqual([9, 10]);
    expect(older.hasMore).toBe(false);

    // 展开原段时翻页：能翻到**被折叠**的老原文（默认视图翻不到 —— 它们已被摘要盖住）。
    const rawOlder = readRoutedSessionEvents(read, session.id, {
      limit: 3,
      beforeSeq: 5,
      includeRaw: true,
    });
    expect(rawOlder.items.map((item) => item.seq)).toEqual([2, 3, 4]);
  });

  it('快慢路径一致：读口没实现向前读时，折出来的段与快路径**完全相同**', () => {
    // 慢路（窗口 + 向前翻页读整段）与快路（向前读）必须折出同一段 ——
    //   折叠口径只有一份，两条路径选出不同的段 = 折叠区间错乱（更糟：同一段被折两次）。
    const fast = harness({ compressThreshold: 10, compressKeepRecent: 3 });
    const slow = harness({ compressThreshold: 10, compressKeepRecent: 3, noForwardRead: true });
    for (const db of [fast, slow]) {
      const session = db.manager.createSession({ kind: 'peer_chat', participants: ['alice'] })!;
      seedMessages(db.manager, session.id, 20);
    }
    const fastSummaries = summariesOf(fast, fast.events[0]!.sessionId).map(summaryPayload);
    const slowSummaries = summariesOf(slow, slow.events[0]!.sessionId).map(summaryPayload);
    expect(fastSummaries.length).toBeGreaterThan(1);
    expect(slowSummaries).toEqual(fastSummaries);
  });

  it('读放大有界：会话越长，折叠取料的读量**不随之增长**（长会话性能回归）', () => {
    // why 这条：折叠取料曾用"窗口 + 向前翻页"读整段 → 每次 append 都把历史重读一遍
    //   （600 次 append 读回 10 万行 = O(n) per append）。向前读修掉之后，
    //   每折一次只读"要折的那几条" → 读量随会话长度**线性**，不随历史累积。
    const db = harness({ compressThreshold: 10, compressKeepRecent: 3 });
    const session = db.manager.createSession({ kind: 'peer_chat', participants: ['alice'] })!;
    const appends = 300;
    seedMessages(db.manager, session.id, appends);

    // 折叠确实发生了（否则这条断言是空的）。
    expect(summariesOf(db, session.id).length).toBeGreaterThan(100);
    // 每折一次只读"要折的那几条"（首屏 = 要折条数 + 1）→ 读量是 appends 的常数倍。
    expect(db.stats.rowsRead).toBeLessThan(appends * 10);
    // 读次数也是常数倍（一次 append 最多一次取料读）。
    expect(db.stats.readCalls).toBeLessThan(appends * 2);
  });
});
