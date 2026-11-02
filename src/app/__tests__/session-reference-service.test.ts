/**
 * 集成测试：**@会话引用解析服务**（app/services/session-reference.ts —— task_107 / v3.2b-B8）。
 *
 * 覆盖验收口径：
 *   1. 无引用 → 正常通过（空块，绝大多数输入走这条）；
 *   2. 引用存在 → 注入块（标题 + id + 近期事件）；
 *   3. **引用不存在 → 如实报错、不注入**（ok=false + block 空串）；
 *   4. 写法不合法 → 报错、不注入；引用个数超限 → 报错、不注入；
 *   5. 会话存在但读不到事件 → 报错（不编造内容）；
 *   6. 没有解析器（会话域不可用）→ **明说**（不静默当作"没有引用"）；
 *   7. 读取有界：向前翻页最多 3 页（性能铁律：读也要有上限）。
 *
 * 用真读口桩（数组 + 游标切片），不 mock 解析逻辑 —— 解析口径在 core/session/reference.ts，
 * 那里另有单测；本文件测的是**服务层**的存在性校验 / 读取路由 / 失败语义。
 */

import {
  createSessionReferenceService,
  resolveSessionReferences,
  SESSION_REFERENCE_MAX_PAGES,
  SESSION_REFERENCE_PAGE_SIZE,
} from '../services/session-reference';
import type { SessionEventView, SessionRecord } from '../../core/session/types';

// ============================================================================
// 夹具
// ============================================================================

function makeSession(id: string, title: string): SessionRecord {
  return {
    id,
    kind: 'peer_chat',
    title,
    participants: ['ch-a', 'ch-b'],
    status: 'closed',
    createdAt: 1_700_000_000_000,
    lastEventAt: 1_700_000_600_000,
    closedAt: 1_700_000_600_000,
    eventCount: 2,
  };
}

function makeEvent(seq: number, type: string, payload: unknown): SessionEventView {
  return { sessionId: 'sess-1', seq, type, payload, createdAt: 1_700_000_000_000 + seq * 60_000 };
}

/** 读口桩：按 seq 正序存一串事件，按 DAO 口径切片（beforeSeq 游标 + limit 封顶）。 */
function makeReadPort(events: readonly SessionEventView[]): {
  readSessionEvents: (sessionId: string, options: { beforeSeq?: number; limit: number }) => readonly SessionEventView[];
  calls: Array<{ beforeSeq?: number; limit: number }>;
} {
  const calls: Array<{ beforeSeq?: number; limit: number }> = [];
  return {
    calls,
    readSessionEvents: (_sessionId, options) => {
      calls.push({ ...(options.beforeSeq === undefined ? {} : { beforeSeq: options.beforeSeq }), limit: options.limit });
      const limit = Math.min(Math.max(options.limit, 1), 200);
      const before = options.beforeSeq ?? Number.POSITIVE_INFINITY;
      const sliced = events.filter((event) => event.seq < before).slice(-limit);
      return sliced;
    },
  };
}

// ============================================================================
// 解析
// ============================================================================

describe('resolveSessionReferences：无引用', () => {
  test('普通文本 → ok、空块、零目标', () => {
    const service = createSessionReferenceService({
      readSession: () => null,
      readSessionEvents: () => [],
    });
    const result = service.resolve('先侦察还是先扩张');
    expect(result.ok).toBe(true);
    expect(result.block).toBe('');
    expect(result.targetIds).toEqual([]);
  });
});

describe('resolveSessionReferences：引用存在', () => {
  test('1 个引用 → 注入块含标题与 id，带近期事件', () => {
    const session = makeSession('sess-1', '先侦察还是先扩张');
    const port = makeReadPort([
      makeEvent(1, 'created', {}),
      makeEvent(2, 'message', { author: '阿尔法', text: '我主张先侦察。' }),
    ]);
    const service = createSessionReferenceService({
      readSession: (id) => (id === 'sess-1' ? session : null),
      readSessionEvents: port.readSessionEvents,
    });
    const result = service.resolve('接着 @session_sess-1 聊的那条线继续');
    expect(result.ok).toBe(true);
    expect(result.targetIds).toEqual(['sess-1']);
    expect(result.block).toContain('【引用会话 先侦察还是先扩张(sess-1)】');
    expect(result.block).toContain('阿尔法：我主张先侦察。');
  });

  test('多个引用 → 逐个解析，块里每条一段', () => {
    const port = makeReadPort([makeEvent(1, 'message', { author: '阿尔法', text: '在。' })]);
    const service = createSessionReferenceService({
      readSession: (id) => makeSession(id, `会话-${id}`),
      readSessionEvents: port.readSessionEvents,
    });
    const result = service.resolve('@session_a 与 @session_b 一起看');
    expect(result.ok).toBe(true);
    expect(result.targetIds).toEqual(['a', 'b']);
    expect(result.block).toContain('【引用会话 会话-a(a)】');
    expect(result.block).toContain('【引用会话 会话-b(b)】');
  });
});

describe('resolveSessionReferences：引用不存在 → 报错不注入', () => {
  test('会话不存在 → ok=false、空块、原因点名是哪一场', () => {
    const service = createSessionReferenceService({
      readSession: () => null,
      readSessionEvents: () => [],
    });
    const result = service.resolve('接着 @session_sess-404 聊的那条线继续');
    expect(result.ok).toBe(false);
    expect(result.block).toBe('');
    expect(result.reason).toContain('sess-404');
    expect(result.reason).toContain('不存在');
  });

  test('多个引用里有一个不存在 → 整体报错（不注入半截上下文）', () => {
    const service = createSessionReferenceService({
      readSession: (id) => (id === 'ok-1' ? makeSession(id, '存在') : null),
      readSessionEvents: () => [makeEvent(1, 'message', { author: 'A', text: '在。' })],
    });
    const result = service.resolve('@session_ok-1 和 @session_gone-2');
    expect(result.ok).toBe(false);
    expect(result.block).toBe('');
    expect(result.reason).toContain('gone-2');
  });

  test('写法不合法 → 报错不注入', () => {
    const service = createSessionReferenceService({
      readSession: () => makeSession('sess-1', '存在'),
      readSessionEvents: () => [makeEvent(1, 'message', { author: 'A', text: '在。' })],
    });
    const result = service.resolve('参考 @session_ 的内容');
    expect(result.ok).toBe(false);
    expect(result.block).toBe('');
    expect(result.reason).toContain('不合法');
  });

  test('引用个数超限 → 报错不注入（prompt 必须有界）', () => {
    const service = createSessionReferenceService({
      readSession: (id) => makeSession(id, `会话-${id}`),
      readSessionEvents: () => [makeEvent(1, 'message', { author: 'A', text: '在。' })],
    });
    const result = service.resolve('@session_1 @session_2 @session_3 @session_4 @session_5 @session_6');
    expect(result.ok).toBe(false);
    expect(result.block).toBe('');
    expect(result.reason).toContain('最多');
  });

  test('会话存在但读不到任何事件 → 报错（不编造内容）', () => {
    const service = createSessionReferenceService({
      readSession: (id) => makeSession(id, '空会话'),
      readSessionEvents: () => [],
    });
    const result = service.resolve('@session_sess-1');
    expect(result.ok).toBe(false);
    expect(result.block).toBe('');
    expect(result.reason).toContain('没有可注入的内容');
  });

  test('读事件抛错 → 降级成"没有内容"并报错（不炸掉整条流程）', () => {
    const service = createSessionReferenceService({
      readSession: (id) => makeSession(id, '会话'),
      readSessionEvents: () => {
        throw new Error('读口炸了');
      },
    });
    const result = service.resolve('@session_sess-1');
    expect(result.ok).toBe(false);
    expect(result.block).toBe('');
    expect(result.reason).toContain('没有可注入的内容');
  });

  test('读会话摘要抛错 → 同上（不当成"存在"）', () => {
    const service = createSessionReferenceService({
      readSession: () => {
        throw new Error('读口炸了');
      },
      readSessionEvents: () => [],
    });
    const result = service.resolve('@session_sess-1');
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('不存在');
  });
});

describe('resolveSessionReferences：读取路由（有界）', () => {
  test('向前翻页找压缩摘要：最多翻 SESSION_REFERENCE_MAX_PAGES 页', () => {
    // 一页装不满（SESSION_REFERENCE_PAGE_SIZE = 200）→ 必须翻页才能读到更早的事件。
    const events: SessionEventView[] = [];
    for (let seq = 1; seq <= 450; seq += 1) {
      events.push(makeEvent(seq, 'message', { author: '阿尔法', text: `第${seq}句` }));
    }
    const port = makeReadPort(events);
    const service = createSessionReferenceService({
      readSession: (id) => makeSession(id, '长会话'),
      readSessionEvents: port.readSessionEvents,
    });
    const result = service.resolve('@session_sess-1');
    expect(result.ok).toBe(true);
    // 翻页次数有界：不超过 maxPages 次读。
    expect(port.calls.length).toBeLessThanOrEqual(SESSION_REFERENCE_MAX_PAGES);
    // 事件太多 → 只给最近的一段（注入块有界）。
    expect(result.block).toContain('第450句');
    expect(result.block).not.toContain('第1句');
  });

  test('事件不足一页 → 只读一次（读也有上限）', () => {
    const events: SessionEventView[] = [];
    for (let seq = 1; seq <= SESSION_REFERENCE_PAGE_SIZE - 1; seq += 1) {
      events.push(makeEvent(seq, 'message', { author: '阿尔法', text: `第${seq}句` }));
    }
    const port = makeReadPort(events);
    const service = createSessionReferenceService({
      readSession: (id) => makeSession(id, '长会话'),
      readSessionEvents: port.readSessionEvents,
    });
    service.resolve('@session_sess-1');
    expect(port.calls).toHaveLength(1);
  });

  test('事件装满整页 → 往前翻页仍有硬上限（≤ MAX_PAGES 次）', () => {
    const events: SessionEventView[] = [];
    for (let seq = 1; seq <= SESSION_REFERENCE_PAGE_SIZE * 2; seq += 1) {
      events.push(makeEvent(seq, 'message', { author: '阿尔法', text: `第${seq}句` }));
    }
    const port = makeReadPort(events);
    const service = createSessionReferenceService({
      readSession: (id) => makeSession(id, '长会话'),
      readSessionEvents: port.readSessionEvents,
    });
    service.resolve('@session_sess-1');
    expect(port.calls.length).toBeLessThanOrEqual(SESSION_REFERENCE_MAX_PAGES);
  });
});

describe('resolveSessionReferences：会话域不可用（没有解析器）', () => {
  test('有引用但没有解析器 → 明说不可用（不静默当作没有引用）', () => {
    const result = resolveSessionReferences('@session_sess-1', undefined);
    expect(result.ok).toBe(false);
    expect(result.block).toBe('');
    expect(result.reason).toContain('未接入');
  });

  test('没有引用且没有解析器 → 正常通过（不影响普通输入）', () => {
    const result = resolveSessionReferences('普通议题', undefined);
    expect(result.ok).toBe(true);
    expect(result.block).toBe('');
  });
});
