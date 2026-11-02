/**
 * 单测：会话状态机（core/session/machine.ts）—— 转移表穷举 + 事件信封 + 历史淘汰。
 *
 * 覆盖口径（验收要求）：
 *   1. **全合法转移**逐条列出（9 条）—— 状态机只有一张表，表外即非法；
 *   2. **全非法转移**逐条列出（12 条，含终态再动与重复标记）；
 *   3. 事件信封：seq 会话内单调、closed 拒收事件、interrupted 允许继续记事件；
 *   4. 历史淘汰：只丢**已关闭的最旧**会话，在办会话绝不丢。
 *
 * 全部是纯函数 —— 不碰 store / bus / 时钟（at 由用例给）。
 */

import {
  appendSessionEvent,
  applySessionAction,
  dropClosedSessions,
  isOpenSessionStatus,
  isTerminalSessionStatus,
  type SessionAction,
} from '../session/machine';
import type { SessionRecord, SessionStatus } from '../session/types';

// ============================================================================
// 夹具
// ============================================================================

/** 一条基准会话（status 由用例给）。 */
function sessionAt(status: SessionStatus, patch: Partial<SessionRecord> = {}): SessionRecord {
  return {
    id: 's-1',
    kind: 'peer_chat',
    title: '互聊：与未命名对象的会话',
    participants: ['alice', 'bob'],
    status,
    createdAt: 1000,
    lastEventAt: 1000,
    closedAt: null,
    eventCount: 0,
    ...patch,
  };
}

const CLOSE: SessionAction = { type: 'close', at: 5000 };

// ============================================================================
// 1. 全合法转移（9 条）
// ============================================================================

describe('applySessionAction：合法转移', () => {
  test('active ──idle──▶ idle', () => {
    const step = applySessionAction(sessionAt('active'), { type: 'idle' });
    expect(step.error).toBeUndefined();
    expect(step.changed).toBe(true);
    expect(step.next.status).toBe('idle');
  });

  test('active ──interrupt──▶ interrupted', () => {
    const step = applySessionAction(sessionAt('active'), { type: 'interrupt' });
    expect(step.next.status).toBe('interrupted');
    expect(step.error).toBeUndefined();
  });

  test('active ──close──▶ closed（盖 closedAt）', () => {
    const step = applySessionAction(sessionAt('active'), CLOSE);
    expect(step.next.status).toBe('closed');
    expect(step.next.closedAt).toBe(5000);
  });

  test('idle ──activate──▶ active', () => {
    const step = applySessionAction(sessionAt('idle'), { type: 'activate' });
    expect(step.next.status).toBe('active');
    expect(step.error).toBeUndefined();
  });

  test('idle ──interrupt──▶ interrupted', () => {
    const step = applySessionAction(sessionAt('idle'), { type: 'interrupt' });
    expect(step.next.status).toBe('interrupted');
    expect(step.error).toBeUndefined();
  });

  test('idle ──close──▶ closed', () => {
    const step = applySessionAction(sessionAt('idle'), CLOSE);
    expect(step.next.status).toBe('closed');
    expect(step.next.closedAt).toBe(5000);
  });

  test('interrupted ──resume──▶ active', () => {
    const step = applySessionAction(sessionAt('interrupted'), { type: 'resume' });
    expect(step.next.status).toBe('active');
    expect(step.error).toBeUndefined();
  });

  test('interrupted ──close──▶ closed（中断也能收尾）', () => {
    const step = applySessionAction(sessionAt('interrupted'), CLOSE);
    expect(step.next.status).toBe('closed');
    expect(step.next.closedAt).toBe(5000);
  });

  test('迁移不改原对象（immutable）', () => {
    const current = sessionAt('active');
    const step = applySessionAction(current, { type: 'idle' });
    expect(current.status).toBe('active');
    expect(step.next).not.toBe(current);
  });
});

// ============================================================================
// 2. 全非法转移（12 条）
// ============================================================================

describe('applySessionAction：非法转移一律拒绝', () => {
  const illegal: ReadonlyArray<{ readonly from: SessionStatus; readonly action: SessionAction; readonly why: string }> = [
    { from: 'active', action: { type: 'activate' }, why: 'active 不是 idle，activate 无来源' },
    { from: 'active', action: { type: 'resume' }, why: '只有 interrupted 能 resume' },
    { from: 'idle', action: { type: 'resume' }, why: 'idle 不是被中断的会话' },
    { from: 'idle', action: { type: 'idle' }, why: '重复标记 idle 不改写历史' },
    { from: 'interrupted', action: { type: 'activate' }, why: '恢复走 resume，不走 activate' },
    { from: 'interrupted', action: { type: 'idle' }, why: 'interrupted 不能直接转 idle' },
    { from: 'interrupted', action: { type: 'interrupt' }, why: '重复标记中断不改写历史' },
    { from: 'closed', action: { type: 'activate' }, why: '终态不可复活' },
    { from: 'closed', action: { type: 'resume' }, why: '终态不可复活' },
    { from: 'closed', action: { type: 'idle' }, why: '终态不可复活' },
    { from: 'closed', action: { type: 'interrupt' }, why: '终态不可复活' },
    { from: 'closed', action: CLOSE, why: '重复收尾不改写历史' },
  ];

  test.each(illegal)('$from + $action.type → 拒绝（$why）', ({ from, action }) => {
    const current = sessionAt(from);
    const step = applySessionAction(current, action);
    expect(step.error).toBe('illegal-transition');
    expect(step.changed).toBe(false);
    expect(step.next).toBe(current); // 原引用返回：调用方据此判定"没变"
  });

  test('非法转移表覆盖 12 条（表外即非法）', () => {
    expect(illegal).toHaveLength(12);
  });
});

// ============================================================================
// 3. 终态 / 在办判定
// ============================================================================

describe('终态与在办判定', () => {
  test('closed 是终态，其余是在办', () => {
    expect(isTerminalSessionStatus('closed')).toBe(true);
    expect(isTerminalSessionStatus('active')).toBe(false);
    expect(isTerminalSessionStatus('idle')).toBe(false);
    expect(isTerminalSessionStatus('interrupted')).toBe(false);
  });

  test('isOpenSessionStatus 与终态互为补集', () => {
    (['active', 'idle', 'interrupted', 'closed'] as const).forEach((status) => {
      expect(isOpenSessionStatus(status)).toBe(!isTerminalSessionStatus(status));
    });
  });
});

// ============================================================================
// 4. 事件信封
// ============================================================================

describe('appendSessionEvent：事件信封', () => {
  test('seq 会话内单调递增（从 1 起）', () => {
    const first = appendSessionEvent(sessionAt('active', { eventCount: 0 }), {
      type: 'message',
      payload: { author: 'alice', text: '在吗' },
      createdAt: 2000,
    });
    expect(first.event?.seq).toBe(1);
    expect(first.next.eventCount).toBe(1);
    expect(first.next.lastEventAt).toBe(2000);

    const second = appendSessionEvent(first.next, {
      type: 'message',
      payload: { author: 'bob', text: '在' },
      createdAt: 3000,
    });
    expect(second.event?.seq).toBe(2);
    expect(second.next.eventCount).toBe(2);
  });

  test('事件信封带 sessionId / type / payload / createdAt', () => {
    const step = appendSessionEvent(sessionAt('active'), {
      type: 'interrupt',
      payload: { reason: '超时' },
      createdAt: 4000,
    });
    expect(step.event).toEqual({
      sessionId: 's-1',
      seq: 1,
      type: 'interrupt',
      payload: { reason: '超时' },
      createdAt: 4000,
    });
  });

  test('closed 拒收事件（终态不改写历史）', () => {
    const current = sessionAt('closed', { eventCount: 3, closedAt: 5000 });
    const step = appendSessionEvent(current, {
      type: 'message',
      payload: { author: 'alice', text: '还有人在吗' },
      createdAt: 6000,
    });
    expect(step.error).toBe('session-closed');
    expect(step.event).toBeNull();
    expect(step.next).toBe(current);
    expect(step.next.eventCount).toBe(3);
  });

  test('interrupted 允许继续记事件（中断 ≠ 封存）', () => {
    const step = appendSessionEvent(sessionAt('interrupted'), {
      type: 'resumed',
      payload: {},
      createdAt: 7000,
    });
    expect(step.error).toBeUndefined();
    expect(step.event?.seq).toBe(1);
    expect(step.next.eventCount).toBe(1);
    // 状态不变：追加事件不改状态（状态由 applySessionAction 裁决）
    expect(step.next.status).toBe('interrupted');
  });

  test('自由文本按上限截断（事件落库的体积必须有界）', () => {
    const step = appendSessionEvent(sessionAt('active'), {
      type: 'message',
      payload: { author: 'a'.repeat(200), text: 'x'.repeat(9_000) },
      createdAt: 1000,
    });
    const payload = step.event?.payload as { author: string; text: string };
    expect(payload.author.length).toBeLessThanOrEqual(64);
    expect(payload.text.length).toBeLessThanOrEqual(4_000);
  });
});

// ============================================================================
// 5. 历史淘汰（FIFO：只丢已关闭的最旧）
// ============================================================================

describe('dropClosedSessions：只丢已关闭的最旧会话', () => {
  const list: SessionRecord[] = [
    sessionAt('closed', { id: 'a' }),
    sessionAt('active', { id: 'b' }),
    sessionAt('closed', { id: 'c' }),
    sessionAt('interrupted', { id: 'd' }),
  ];

  test('腾位子时先丢最旧的 closed', () => {
    const kept = dropClosedSessions(list, 3);
    expect(kept.map((s) => s.id)).toEqual(['b', 'c', 'd']);
  });

  test('在办会话绝不丢（腾不出位置就留着，由调用方拒绝新建）', () => {
    const kept = dropClosedSessions(list, 3);
    expect(kept.find((s) => s.id === 'b')?.status).toBe('active');
    expect(kept.find((s) => s.id === 'd')?.status).toBe('interrupted');
  });

  test('closed 不够丢时原样保留（不足 keep 的部分不硬凑）', () => {
    const kept = dropClosedSessions(list, 3);
    expect(kept).toHaveLength(3);
    const more = dropClosedSessions(list, 10);
    expect(more.map((s) => s.id)).toEqual(['a', 'b', 'c', 'd']);
  });

  test('无 closed 时不动任何会话', () => {
    const openOnly = [sessionAt('active', { id: 'x' }), sessionAt('idle', { id: 'y' })];
    expect(dropClosedSessions(openOnly, 1).map((s) => s.id)).toEqual(['x', 'y']);
  });
});
