/**
 * 单测：当日回放读面（app/services/day-replay.ts）——
 *   会话事件 → 回放条目（分级映射）/ 本地日历日区间 / 读取口的真实调用形状
 *   （会话列表分页 + 逐会话事件流 + 当天过滤 + 无数据空态）。
 *
 * 只测**读面**：不写库、不改状态。IO 替身是注入的 fetch。
 * @jest-environment node
 */

import {
  createDayReplayPort,
  localDayRange,
  sessionEventToReplayEntry,
} from '../services/day-replay';

const session = { characterId: 'char-1', taskId: 'task-1' };

describe('会话事件 → 回放条目', () => {
  test('task_started → 开工', () => {
    const entry = sessionEventToReplayEntry(
      {
        sessionId: 's-1',
        seq: 1,
        type: 'task_started',
        payload: { taskId: 'task-1', summary: '侦察北门' },
        createdAt: 1000,
      },
      session
    );
    expect(entry).toMatchObject({
      at: 1000,
      kind: 'spawn',
      characterId: 'char-1',
      taskId: 'task-1',
      label: '侦察北门',
      sessionId: 's-1',
    });
  });

  test('step → 干活（标签 + 细节）', () => {
    const entry = sessionEventToReplayEntry(
      {
        sessionId: 's-1',
        seq: 2,
        type: 'step',
        payload: { label: '读代码', detail: 'core/task' },
        createdAt: 2000,
      },
      session
    );
    expect(entry?.kind).toBe('work');
    expect(entry?.label).toBe('读代码：core/task');
  });

  test('output_tail → 干活（输出尾部）', () => {
    const entry = sessionEventToReplayEntry(
      { sessionId: 's-1', seq: 3, type: 'output_tail', payload: { text: 'done' }, createdAt: 3000 },
      session
    );
    expect(entry?.kind).toBe('work');
    expect(entry?.label).toBe('done');
  });

  test('completed → 完成 / failed → 出错', () => {
    const done = sessionEventToReplayEntry(
      { sessionId: 's-1', seq: 4, type: 'completed', payload: { summary: '搞定' }, createdAt: 4000 },
      session
    );
    const failed = sessionEventToReplayEntry(
      { sessionId: 's-1', seq: 5, type: 'failed', payload: { reason: '超时' }, createdAt: 5000 },
      session
    );
    expect(done?.kind).toBe('done');
    expect(failed?.kind).toBe('error');
    expect(failed?.label).toBe('超时');
  });

  test('词表外的事件类型不进回放（不制造噪声）', () => {
    const entry = sessionEventToReplayEntry(
      { sessionId: 's-1', seq: 6, type: 'reference', payload: {}, createdAt: 6000 },
      session
    );
    expect(entry).toBeNull();
  });

  test('超长短句被截断（时间轴与气泡都放不下原文）', () => {
    const entry = sessionEventToReplayEntry(
      {
        sessionId: 's-1',
        seq: 7,
        type: 'step',
        payload: { label: 'x'.repeat(200) },
        createdAt: 7000,
      },
      session
    );
    expect(entry?.label.length).toBeLessThanOrEqual(40);
  });
});

describe('本地日历日区间', () => {
  test('起止是当天 00:00 与次日 00:00', () => {
    const { from, to } = localDayRange(new Date(2026, 0, 2, 13, 30));
    expect(new Date(from).getHours()).toBe(0);
    expect(new Date(from).getDate()).toBe(2);
    expect(to - from).toBe(24 * 3600 * 1000);
  });
});

describe('当日回放读取口', () => {
  const day = new Date(2026, 0, 2, 10, 0);
  const dayStart = new Date(2026, 0, 2, 0, 0).getTime();
  const dayEnd = new Date(2026, 0, 3, 0, 0).getTime();

  /** 造一个 fetch 替身：按 URL 分派两类响应。 */
  function fakeFetch(options: {
    readonly sessions?: unknown[];
    readonly events?: Record<string, unknown[]>;
  }): { fetchImpl: typeof fetch; calls: string[] } {
    const calls: string[] = [];
    const fetchImpl = (async (input: string) => {
      const url = String(input);
      calls.push(url);
      const eventsMatch = url.match(/\/api\/storage\/sessions\/([^/?]+)\/events/);
      if (eventsMatch) {
        const sessionId = decodeURIComponent(eventsMatch[1] as string);
        return {
          ok: true,
          status: 200,
          json: async () => ({
            success: true,
            data: { events: options.events?.[sessionId] ?? [] },
          }),
        };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          data: { sessions: options.sessions ?? [] },
        }),
      };
    }) as unknown as typeof fetch;
    return { fetchImpl, calls };
  }

  test('读到的会话事件按时刻升序摆成时间轴', async () => {
    const { fetchImpl, calls } = fakeFetch({
      sessions: [
        {
          id: 's-1',
          kind: 'task_run',
          participants: ['char-1'],
          refId: 'task-1',
          createdAt: dayStart + 1000,
          lastEventAt: dayStart + 3000,
        },
      ],
      events: {
        's-1': [
          { sessionId: 's-1', seq: 1, type: 'task_started', payload: { summary: '干活' }, createdAt: dayStart + 1000 },
          { sessionId: 's-1', seq: 2, type: 'completed', payload: { summary: '搞定' }, createdAt: dayStart + 3000 },
        ],
      },
    });
    const port = createDayReplayPort({ fetchImpl, baseUrl: 'http://127.0.0.1:7524' });
    const entries = await port.loadDay({ day });
    expect(entries.map((item) => item.kind)).toEqual(['spawn', 'done']);
    expect(entries[0]?.characterId).toBe('char-1');
    // 会话列表与事件流各读一次，且列表按 kind=task_run 过滤。
    expect(calls.some((url) => url.includes('kind=task_run'))).toBe(true);
    expect(calls.some((url) => url.includes('/events'))).toBe(true);
  });

  test('当天之外的事件被过滤掉（昨天开的会话今天没动静就不进今天的回放）', async () => {
    const { fetchImpl } = fakeFetch({
      sessions: [
        {
          id: 's-1',
          kind: 'task_run',
          participants: ['char-1'],
          refId: 'task-1',
          createdAt: dayStart - 86_400_000,
          lastEventAt: dayStart + 1000,
        },
      ],
      events: {
        's-1': [
          { sessionId: 's-1', seq: 1, type: 'step', payload: { label: '昨天' }, createdAt: dayStart - 86_400_000 },
          { sessionId: 's-1', seq: 2, type: 'step', payload: { label: '今天' }, createdAt: dayStart + 1000 },
        ],
      },
    });
    const port = createDayReplayPort({ fetchImpl, baseUrl: 'http://127.0.0.1:7524' });
    const entries = await port.loadDay({ day });
    expect(entries).toHaveLength(1);
    expect(entries[0]?.label).toBe('今天');
  });

  test('库里没有今天的会话 → 空数组（空态分支，不造数据）', async () => {
    const { fetchImpl } = fakeFetch({ sessions: [], events: {} });
    const port = createDayReplayPort({ fetchImpl, baseUrl: 'http://127.0.0.1:7524' });
    await expect(port.loadDay({ day })).resolves.toEqual([]);
  });

  test('会话存在但当天没有事件 → 空数组', async () => {
    const { fetchImpl } = fakeFetch({
      sessions: [
        {
          id: 's-1',
          kind: 'task_run',
          participants: ['char-1'],
          refId: 'task-1',
          createdAt: dayStart - 10_000,
          lastEventAt: dayStart - 10_000,
        },
      ],
      events: { 's-1': [] },
    });
    const port = createDayReplayPort({ fetchImpl, baseUrl: 'http://127.0.0.1:7524' });
    await expect(port.loadDay({ day })).resolves.toEqual([]);
  });

  test('读失败如实报错（不静默返回空数组 —— 空与读不到是两回事）', async () => {
    const fetchImpl = (async () => ({
      ok: false,
      status: 503,
      json: async () => ({ success: false, error: 'storage not attached' }),
    })) as unknown as typeof fetch;
    const port = createDayReplayPort({ fetchImpl, baseUrl: 'http://127.0.0.1:7524' });
    await expect(port.loadDay({ day })).rejects.toThrow('读取当日回放失败');
  });
});
