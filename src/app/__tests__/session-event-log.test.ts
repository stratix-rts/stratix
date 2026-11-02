/**
 * 单测：**进程内会话事件日志**（app/services/session-event-log.ts）——
 *   给 core/session 的 manager 当「事件源」用（渲染侧没有会话落库通道，
 *   而 resume 的回灌要读得到事件流 —— 没有事件源 core 会如实拒绝）。
 *
 * 覆盖：写读往返 / 读口口径（窗口 = 命中集里最后 limit 条、beforeSeq 游标）/
 *   两条上限（每会话条数、会话数 —— 无界增长必须封顶）。
 */

import type { SessionEvent } from '../../core/session/types';
import { createSessionEventLog } from '../services/session-event-log';

function event(sessionId: string, seq: number, text = `第${seq}条`): SessionEvent {
  return {
    sessionId,
    seq,
    type: 'message',
    payload: { author: '用户', text },
    createdAt: 1_700_000_000_000 + seq,
  };
}

describe('进程内会话事件日志', () => {
  test('写进去的事件读得回来（seq 正序）', () => {
    const log = createSessionEventLog();
    log.persist.persistEvent(event('s1', 1, '一'));
    log.persist.persistEvent(event('s1', 2, '二'));

    expect(log.count('s1')).toBe(2);
    const read = log.read.readSessionEvents('s1', { limit: 10 });
    expect(read.map((item) => item.seq)).toEqual([1, 2]);
    expect(read[1]?.payload).toEqual({ author: '用户', text: '二' });
  });

  test('会话之间互不串（按 sessionId 分开）', () => {
    const log = createSessionEventLog();
    log.persist.persistEvent(event('s1', 1));
    log.persist.persistEvent(event('s2', 1));

    expect(log.read.readSessionEvents('s1', { limit: 10 })).toHaveLength(1);
    expect(log.read.readSessionEvents('s2', { limit: 10 })).toHaveLength(1);
    expect(log.read.readSessionEvents('s3', { limit: 10 })).toHaveLength(0);
  });

  test('读口口径：窗口 = 命中集里最后 limit 条；beforeSeq 是游标', () => {
    const log = createSessionEventLog();
    for (let seq = 1; seq <= 5; seq += 1) log.persist.persistEvent(event('s1', seq));

    // 只要最近两条。
    expect(log.read.readSessionEvents('s1', { limit: 2 }).map((item) => item.seq)).toEqual([4, 5]);
    // 游标：取 seq 之前的那些（再取最后两条）。
    expect(
      log.read.readSessionEvents('s1', { beforeSeq: 4, limit: 2 }).map((item) => item.seq)
    ).toEqual([2, 3]);
  });

  test('每会话条数封顶：超限丢最旧的（留最近的）', () => {
    const log = createSessionEventLog({ maxEventsPerSession: 3 });
    for (let seq = 1; seq <= 6; seq += 1) log.persist.persistEvent(event('s1', seq));

    expect(log.count('s1')).toBe(3);
    expect(log.read.readSessionEvents('s1', { limit: 10 }).map((item) => item.seq)).toEqual([
      4, 5, 6,
    ]);
  });

  test('会话数封顶：超限丢最旧会话的整段事件', () => {
    const log = createSessionEventLog({ maxSessions: 2 });
    log.persist.persistEvent(event('s1', 1));
    log.persist.persistEvent(event('s2', 1));
    log.persist.persistEvent(event('s3', 1));

    expect(log.count('s1')).toBe(0); // 最旧的整段被丢
    expect(log.count('s2')).toBe(1);
    expect(log.count('s3')).toBe(1);
  });
});
