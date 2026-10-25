/**
 * 单测：经验事件渲染侧端口（app/services/persistence/exp-record.ts，task_061）。
 *
 * 覆盖：
 *   1. makeExpEventPersister：成功路径零噪音；ok=false / 异常路径只警告不抛（养成回路不打断）；
 *   2. makeGrowthStatsPort：overview 两路 IPC 合流（六态计数归并 + 建档行对位）、
 *      任一路失败整体 null（缺一半比引导语更误导）、expEvents / recentTasks 的窗口与终态过滤；
 *   3. 非口环境（null api）各方法 null 降级。
 *
 * 驱动说明：IPC 面是 preload 注入的**薄通道**，这里用可控桩替换（同 task-record.test 的口径：
 * 端口文件测的是「翻译 / 降级 / fire-and-forget」逻辑，真落库在 DAO 测试已覆盖）。
 */

import {
  EXP_CURVE_WINDOW_MS,
  makeExpEventPersister,
  makeGrowthStatsPort,
  type ExpEventApi,
} from '../../services/persistence/exp-record';
import type { TaskRecordApi } from '../../services/persistence/task-record';
import type { PersistedTaskRecord, PersistedTaskStatRow } from '../../services/persistence/task-record-dao';

function expApiStub(overrides: Partial<ExpEventApi> = {}): ExpEventApi {
  return {
    saveExpEvent: jest.fn().mockResolvedValue({ ok: true }),
    loadExpEvents: jest.fn().mockResolvedValue({ ok: true, events: [] }),
    growthOverview: jest.fn().mockResolvedValue({ ok: true, rows: [] }),
    ...overrides,
  };
}

function taskApiStub(overrides: Partial<TaskRecordApi> = {}): TaskRecordApi {
  return {
    saveTask: jest.fn().mockResolvedValue({ ok: true }),
    loadTasks: jest.fn().mockResolvedValue({ ok: true, tasks: [] }),
    loadTaskStats: jest.fn().mockResolvedValue({ ok: true, rows: [] }),
    ...overrides,
  };
}

function statRow(characterId: string, status: PersistedTaskStatRow['status'], count: number): PersistedTaskStatRow {
  return { characterId, status, count, avgDurationMs: null };
}

describe('makeExpEventPersister（fire-and-forget 注入件）', () => {
  test('成功路径：透传插入形状，不警告', async () => {
    const api = expApiStub();
    const logger = jest.fn();
    const persist = makeExpEventPersister(api, logger);
    const insert = { characterId: 'ch-1', delta: 50, reason: 'task_completed' as const, level: null, createdAt: 123 };

    persist(insert); // 同步签名：不 await 也不抛
    await Promise.resolve();

    expect(api.saveExpEvent).toHaveBeenCalledWith(insert);
    expect(logger).not.toHaveBeenCalled();
  });

  test('主进程拒收（ok=false）：只警告不抛（曲线少一个点不是错误）', async () => {
    const api = expApiStub({ saveExpEvent: jest.fn().mockResolvedValue({ ok: false, error: 'bad delta' }) });
    const logger = jest.fn();
    const persist = makeExpEventPersister(api, logger);

    persist({ characterId: 'ch-1', delta: 50, reason: 'task_completed', level: null, createdAt: 1 });
    await Promise.resolve();

    expect(logger).toHaveBeenCalledTimes(1);
    expect(logger.mock.calls[0]![0]).toContain('bad delta');
  });

  test('IPC 异常（reject）：吞掉只留一行日志，绝不向调用方抛', async () => {
    const api = expApiStub({ saveExpEvent: jest.fn().mockRejectedValue(new Error('ipc down')) });
    const logger = jest.fn();
    const persist = makeExpEventPersister(api, logger);

    expect(() =>
      persist({ characterId: 'ch-1', delta: 5, reason: 'chat_round', level: null, createdAt: 1 })
    ).not.toThrow();
    await Promise.resolve();
    await Promise.resolve();
    expect(logger).toHaveBeenCalledTimes(1);
  });
});

describe('makeGrowthStatsPort（看板数据口）', () => {
  test('overview：活跃度行 + 六态任务计数合流（SQL 行一态一行 → 每角色一组）', async () => {
    const api = expApiStub({
      growthOverview: jest.fn().mockResolvedValue({
        ok: true,
        rows: [
          { characterId: 'ch-1', chatCount: 3, taskCount: 4, expEventCount: 5, lastActiveAt: 999, createdAt: 100 },
        ],
      }),
    });
    const taskApi = taskApiStub({
      loadTaskStats: jest.fn().mockResolvedValue({
        ok: true,
        rows: [
          statRow('ch-1', 'completed', 2),
          statRow('ch-1', 'failed', 1),
          statRow('ch-1', 'cancelled', 1),
          statRow('ch-1', 'queued', 1),
          statRow('ch-1', 'running', 1),
          statRow('ch-1', 'awaiting_approval', 2),
        ],
      }),
    });
    const port = makeGrowthStatsPort(api, taskApi);

    const rows = await port.overview();
    expect(rows).toEqual([
      {
        characterId: 'ch-1',
        chatCount: 3,
        taskCount: 4,
        expEventCount: 5,
        lastActiveAt: 999,
        createdAt: 100,
        taskCounts: { queued: 1, running: 1, awaiting: 2, completed: 2, failed: 1, cancelled: 1 },
      },
    ]);
  });

  test('overview：无任务计数的角色拿全零组（不是缺席行）', async () => {
    const api = expApiStub({
      growthOverview: jest.fn().mockResolvedValue({
        ok: true,
        rows: [{ characterId: 'ch-quiet', chatCount: 0, taskCount: 0, expEventCount: 0, lastActiveAt: null, createdAt: 5 }],
      }),
    });
    const port = makeGrowthStatsPort(api, taskApiStub());

    const rows = await port.overview();
    expect(rows?.[0]?.taskCounts).toEqual({ queued: 0, running: 0, awaiting: 0, completed: 0, failed: 0, cancelled: 0 });
  });

  test('overview：任一路被拒 → 整体 null（缺一半的排行卡比引导语更误导）', async () => {
    const badActivity = makeGrowthStatsPort(
      expApiStub({ growthOverview: jest.fn().mockResolvedValue({ ok: false, error: 'no db' }) }),
      taskApiStub()
    );
    expect(await badActivity.overview()).toBeNull();

    const badStats = makeGrowthStatsPort(
      expApiStub(),
      taskApiStub({ loadTaskStats: jest.fn().mockResolvedValue({ ok: false, error: 'no db' }) })
    );
    expect(await badStats.overview()).toBeNull();
  });

  test('overview：IPC 异常 → null + 日志（不向看板抛）', async () => {
    const logger = jest.fn();
    const port = makeGrowthStatsPort(
      expApiStub({ growthOverview: jest.fn().mockRejectedValue(new Error('boom')) }),
      taskApiStub(),
      logger
    );
    await expect(port.overview()).resolves.toBeNull();
    expect(logger).toHaveBeenCalled();
  });

  test('expEvents：按近 30 天窗口取（sinceMs = now - EXP_CURVE_WINDOW_MS）', async () => {
    const loadExpEvents = jest.fn().mockResolvedValue({
      ok: true,
      events: [{ id: 1, characterId: 'ch-1', delta: 5, reason: 'chat_round', level: null, createdAt: 7 }],
    });
    const port = makeGrowthStatsPort(expApiStub({ loadExpEvents }), taskApiStub());

    const events = await port.expEvents('ch-1');
    const sinceMs = loadExpEvents.mock.calls[0]![1] as number;
    expect(Math.abs(sinceMs - (Date.now() - EXP_CURVE_WINDOW_MS))).toBeLessThan(5_000); // 窗口对齐（毫秒级抖动）
    expect(events).toEqual([{ id: 1, characterId: 'ch-1', delta: 5, reason: 'chat_round', level: null, createdAt: 7 }]);
  });

  test('recentTasks：只留带 endedAt 的终态任务（在办 / 无收尾时刻剔除）', async () => {
    const base: PersistedTaskRecord = {
      id: 't',
      characterId: 'ch-1',
      prompt: 'p',
      status: 'completed',
      output: '',
      createdAt: 1,
      startedAt: 1,
      endedAt: 2,
    };
    const taskApi = taskApiStub({
      loadTasks: jest.fn().mockResolvedValue({
        ok: true,
        tasks: [
          base,
          { ...base, id: 't2', status: 'running', endedAt: null },
          { ...base, id: 't3', status: 'awaiting_approval', endedAt: null },
          { ...base, id: 't4', status: 'cancelled', endedAt: 9 },
          { ...base, id: 't5', status: 'completed', endedAt: null }, // 防御：终态但没收尾时刻
        ],
      }),
    });
    const port = makeGrowthStatsPort(expApiStub(), taskApi);

    const tasks = await port.recentTasks('ch-1');
    expect(tasks).toEqual([
      { prompt: 'p', status: 'completed', endedAt: 2 },
      { prompt: 'p', status: 'cancelled', endedAt: 9 },
    ]);
  });

  test('非口环境（null api）：三个方法都 null 降级（引导语判定在 hud 侧）', async () => {
    const port = makeGrowthStatsPort(null, null);
    expect(await port.overview()).toBeNull();
    expect(await port.expEvents('ch-1')).toBeNull();
    expect(await port.recentTasks('ch-1')).toBeNull();
  });
});
