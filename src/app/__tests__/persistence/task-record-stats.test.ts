/**
 * 单测：任务统计聚合的渲染侧归约（app/services/persistence/task-record.ts，task_050）。
 * 覆盖：SQL 行 → 每角色归约（成功率样本只看 completed/failed；耗时均值按组条数加权还原）、
 *   统计提供口（取得到 → 归约结果；非 Electron null → 中性降级；IPC 失败 → null 不抛）。
 * IPC 面（TaskRecordApi）用**打桩**—— DAO 的 GROUP BY 已在 task-record-dao.test.ts 用真库验过，
 * 这里的职责边界是「行归约 + 取数兜底」，桩即边界。
 */

import {
  makeTaskStatsProvider,
  reduceTaskStatRows,
  type TaskRecordApi,
  type TaskStatSummary,
} from '../../services/persistence/task-record';
import type { PersistedTaskStatRow } from '../../services/persistence/task-record-dao';

const row = (patch: Partial<PersistedTaskStatRow>): PersistedTaskStatRow => ({
  characterId: 'ch-1',
  status: 'completed',
  count: 1,
  avgDurationMs: null,
  ...patch,
});

describe('reduceTaskStatRows：SQL 行 → 每角色统计', () => {
  test('同角色多状态行合成一行；耗时均值按组条数加权（不是两组均值的算术平均）', () => {
    // completed 组：2 条 × 10min；failed 组：6 条 × 20min。
    // 加权正确：全样本均值 = (2×10 + 6×20) / 8 = 17.5min；错误口径（均值再平均）= 15min。
    const rows = [
      row({ status: 'completed', count: 2, avgDurationMs: 600_000 }),
      row({ status: 'failed', count: 6, avgDurationMs: 1_200_000 }),
      row({ status: 'cancelled', count: 3, avgDurationMs: 60_000 }), // 非终态：不入耗时样本
      row({ status: 'queued', count: 1, avgDurationMs: null }),
    ];

    expect(reduceTaskStatRows(rows)).toEqual<TaskStatSummary[]>([
      { characterId: 'ch-1', completed: 2, failed: 6, avgDurationMs: 1_050_000 },
    ]);
  });

  test('无终态耗时样本 → avgDurationMs null（无历史显示「未知」，不退 0）', () => {
    expect(
      reduceTaskStatRows([row({ status: 'queued', count: 2 })])
    ).toEqual([{ characterId: 'ch-1', completed: 0, failed: 0, avgDurationMs: null }]);
  });

  test('多角色分流 + 空输入 → 空数组', () => {
    const rows = [
      row({ characterId: 'a', status: 'completed', count: 1, avgDurationMs: 1000 }),
      row({ characterId: 'b', status: 'failed', count: 1, avgDurationMs: 3000 }),
    ];
    expect(reduceTaskStatRows(rows)).toEqual([
      { characterId: 'a', completed: 1, failed: 0, avgDurationMs: 1000 },
      { characterId: 'b', completed: 0, failed: 1, avgDurationMs: 3000 },
    ]);
    expect(reduceTaskStatRows([])).toEqual([]);
  });
});

describe('makeTaskStatsProvider：取数兜底', () => {
  const apiOk = (rows: PersistedTaskStatRow[]): TaskRecordApi =>
    ({ loadTaskStats: async () => ({ ok: true, rows }) }) as unknown as TaskRecordApi;

  test('取得到 → 归约结果（hud 侧同构注入）', async () => {
    const provider = makeTaskStatsProvider(apiOk([row({ status: 'completed', count: 3, avgDurationMs: 60_000 })]));
    await expect(provider()).resolves.toEqual([
      { characterId: 'ch-1', completed: 3, failed: 0, avgDurationMs: 60_000 },
    ]);
  });

  test('非 Electron（api=null）→ null（hud 无历史中性降级，不拆表单）', async () => {
    await expect(makeTaskStatsProvider(null)()).resolves.toBeNull();
  });

  test('IPC 拒绝 / 抛错 → null 不抛（统计可用性让位于派发表单）', async () => {
    const rejected = { loadTaskStats: async () => ({ ok: false, error: 'data store not initialized' }) } as unknown as TaskRecordApi;
    await expect(makeTaskStatsProvider(rejected)()).resolves.toBeNull();

    const throwing = { loadTaskStats: async () => { throw new Error('ipc down'); } } as unknown as TaskRecordApi;
    await expect(makeTaskStatsProvider(throwing)()).resolves.toBeNull();
  });
});
