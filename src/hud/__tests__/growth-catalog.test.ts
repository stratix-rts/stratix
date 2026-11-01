/**
 * 单测：成长看板纯函数目录（hud/screens/growth-catalog.ts，task_061）。
 * 覆盖：exp 曲线逐日聚合（buildExpSeries）、升级里程碑提取、近 7 天热力聚合（buildHeatmap）、
 *   完成率口径、四键排行（含无数据降级 / 稳定破平）、履历时间线合并截断、相对时刻文案。
 * 全部纯函数：固定 now 打点断言（桶起点用本地时区零点，测试同跑本地时区可复算）。
 */

import type { CharacterView } from '../../core/types';
import {
  buildExpSeries,
  buildGrowthTimeline,
  buildHeatmap,
  DAY_MS,
  dayStartOf,
  EXP_SERIES_DAYS,
  extractMilestones,
  formatRelative,
  GROWTH_TIMELINE_CAP,
  HEATMAP_DAYS,
  rankCharacters,
  successRate,
  type GrowthExpEvent,
  type GrowthOverviewRow,
  type GrowthTaskInput,
} from '../screens/growth-catalog';

/** 固定「今天」：2026-10-26 12:00 本地时 —— 桶边界全部可复算。 */
const NOW = new Date(2026, 9, 26, 12, 0, 0).getTime();
const TODAY = dayStartOf(NOW);

function ev(patch: Partial<GrowthExpEvent> = {}): GrowthExpEvent {
  return { delta: 5, reason: 'chat_round', level: null, createdAt: NOW, ...patch };
}

function character(patch: Partial<CharacterView> = {}): CharacterView {
  return { id: 'c1', name: '甲', persona: 'p', level: 1, experience: 0, agentKind: 'codex', ...patch };
}

function row(patch: Partial<GrowthOverviewRow> = {}): GrowthOverviewRow {
  return {
    characterId: 'c1',
    chatCount: 0,
    taskCount: 0,
    expEventCount: 0,
    lastActiveAt: null,
    createdAt: null,
    taskCounts: { queued: 0, running: 0, awaiting: 0, completed: 0, failed: 0, cancelled: 0 },
    ...patch,
  };
}

describe('dayStartOf / buildExpSeries（近 30 天逐日曲线）', () => {
  test('dayStartOf：本地时区零点（往返同一天）', () => {
    expect(dayStartOf(NOW)).toBe(new Date(2026, 9, 26, 0, 0, 0).getTime());
    expect(dayStartOf(NOW) + DAY_MS - 1).toBe(TODAY + DAY_MS - 1); // 语义锚：今天的最后一毫秒仍属今天
  });

  test('恒为 30 个点；无活动的天补零（横轴天数固定，缺天不缩短）', () => {
    const points = buildExpSeries([], NOW);
    expect(points).toHaveLength(EXP_SERIES_DAYS);
    expect(points.every((p) => p.gained === 0 && p.cumulative === 0)).toBe(true);
    expect(points[0]!.dayStart).toBe(TODAY - 29 * DAY_MS);
    expect(points[29]!.dayStart).toBe(TODAY);
  });

  test('当日聚合 + 窗口内累计：level_up 行 delta=0 不计增量但占位', () => {
    const points = buildExpSeries(
      [
        ev({ delta: 50, reason: 'task_completed', createdAt: TODAY - 2 * DAY_MS + 3_600_000 }),
        ev({ delta: 0, reason: 'level_up', level: 2, createdAt: TODAY - 2 * DAY_MS + 3_700_000 }),
        ev({ delta: 5, reason: 'chat_round', createdAt: TODAY + 100 }),
        ev({ delta: 10, reason: 'task_failed', createdAt: TODAY + 200 }),
      ],
      NOW
    );
    const d27 = points[27]!; // 两天前
    expect(d27.gained).toBe(50); // 里程碑行 delta=0：gained 不涨
    expect(d27.cumulative).toBe(50);
    expect(points[28]!.cumulative).toBe(50); // 中间零日累计保持
    expect(points[29]!.gained).toBe(15);
    expect(points[29]!.cumulative).toBe(65);
  });

  test('窗口外事件防御性丢弃（端口已截 30 天，这里是第二道闸）', () => {
    const points = buildExpSeries([ev({ delta: 999, createdAt: TODAY - 30 * DAY_MS })], NOW);
    expect(points.every((p) => p.gained === 0)).toBe(true);
  });
});

describe('extractMilestones / buildHeatmap', () => {
  test('只挑 level 非 null 的 level_up 行，按时刻升序', () => {
    const milestones = extractMilestones([
      ev({ reason: 'level_up', level: 3, createdAt: 300 }),
      ev({ delta: 5, createdAt: 100 }),
      ev({ reason: 'level_up', level: 2, createdAt: 200 }),
      ev({ reason: 'level_up', level: null, createdAt: 400 }), // 脏行：跳过不猜
    ]);
    expect(milestones).toEqual([
      { at: 200, level: 2 },
      { at: 300, level: 3 },
    ]);
  });

  test('热力恒 7 格；计数 = 当日全部事件条数（任务与对话都算一次活动）；窗口外不计', () => {
    const cells = buildHeatmap(
      [
        ev({ createdAt: TODAY + 10 }),
        ev({ createdAt: TODAY + 20 }),
        ev({ delta: 50, reason: 'task_completed', createdAt: TODAY - DAY_MS + 5 }),
        ev({ createdAt: TODAY - 7 * DAY_MS }), // 恰好出窗：丢弃
      ],
      NOW
    );
    expect(cells).toHaveLength(HEATMAP_DAYS);
    expect(cells[5]!.count).toBe(1); // 昨天
    expect(cells[6]!.count).toBe(2); // 今天
    expect(cells.slice(0, 5).every((c) => c.count === 0)).toBe(true);
  });
});

describe('successRate / rankCharacters', () => {
  test('完成率只数终态；无终态返回 null（没跑过 ≠ 0%）', () => {
    expect(successRate(row().taskCounts)).toBeNull();
    expect(successRate(row({ taskCounts: { queued: 1, running: 0, awaiting: 0, completed: 0, failed: 0, cancelled: 5 } }).taskCounts)).toBeNull();
    expect(successRate(row({ taskCounts: { queued: 0, running: 0, awaiting: 0, completed: 3, failed: 1, cancelled: 2 } }).taskCounts)).toBeCloseTo(0.75);
  });

  test('等级 / 经验键按 WorldState 数值降序；同键按建档序稳定破平', () => {
    const chars = [
      character({ id: 'a', level: 2, experience: 100 }),
      character({ id: 'b', level: 5, experience: 10 }),
      character({ id: 'c', level: 5, experience: 999 }),
    ];
    expect(rankCharacters(chars, null, 'level').map((e) => e.character.id)).toEqual(['b', 'c', 'a']);
    expect(rankCharacters(chars, null, 'exp').map((e) => e.character.id)).toEqual(['c', 'a', 'b']);
  });

  test('完成率 / 活跃度键：无聚合行的角色垫底且保持原序（不编 0 ——「没跑过」要能区分）', () => {
    const chars = [character({ id: 'a' }), character({ id: 'b' })];
    const rows = [
      row({ characterId: 'b', taskCounts: { queued: 0, running: 0, awaiting: 0, completed: 1, failed: 0, cancelled: 0 }, lastActiveAt: 500 }),
    ];
    expect(rankCharacters(chars, rows, 'successRate').map((e) => e.character.id)).toEqual(['b', 'a']);
    expect(rankCharacters(chars, rows, 'activity').map((e) => e.character.id)).toEqual(['b', 'a']);
    // 双无数据：原序（稳定排序）。
    expect(rankCharacters(chars, null, 'activity').map((e) => e.character.id)).toEqual(['a', 'b']);
  });

  test('排行条目对位：rows 里的统计行挂到对应角色（缺席 = null）', () => {
    const entries = rankCharacters([character({ id: 'a' }), character({ id: 'b' })], [row({ characterId: 'b', chatCount: 7 })], 'level');
    expect(entries.find((e) => e.character.id === 'b')?.row?.chatCount).toBe(7);
    expect(entries.find((e) => e.character.id === 'a')?.row).toBeNull();
  });
});

describe('buildGrowthTimeline / formatRelative', () => {
  test('建档 + 升级 + 终态任务合并降序；建档锚缺失 / 任务无收尾时刻自然缺席', () => {
    const timeline = buildGrowthTimeline(
      1000,
      [ev({ reason: 'level_up', level: 2, createdAt: 3000 })],
      [
        { prompt: '新任务', status: 'completed', endedAt: 5000 },
        { prompt: '没结束的', status: 'completed', endedAt: null },
        { prompt: '老任务', status: 'failed', endedAt: 2000 },
      ]
    );
    expect(timeline.map((e) => [e.kind, e.atMs])).toEqual([
      ['task', 5000],
      ['levelUp', 3000],
      ['task', 2000],
      ['created', 1000],
    ]);
    expect(timeline[0]!.label).toContain('完成任务：新任务');
    expect(timeline[3]!.label).toBe('建档入列');
  });

  test('超过上限截旧（履历是回顾不是全量流水账）；全空输入 → 空数组', () => {
    const tasks: GrowthTaskInput[] = Array.from({ length: 15 }, (_, i) => ({
      prompt: `t${i}`,
      status: 'completed' as const,
      endedAt: 10_000 + i,
    }));
    const timeline = buildGrowthTimeline(null, [], tasks);
    expect(timeline).toHaveLength(GROWTH_TIMELINE_CAP);
    expect(timeline[0]!.atMs).toBe(10_014); // 最新在前
    expect(buildGrowthTimeline(null, [], [])).toEqual([]);
  });

  test('formatRelative：刚刚 / 分钟 / 小时 / 落日期', () => {
    expect(formatRelative(NOW, NOW)).toBe('刚刚');
    expect(formatRelative(NOW - 5 * 60_000, NOW)).toBe('5 分钟前');
    expect(formatRelative(NOW - 3 * 3_600_000, NOW)).toBe('3 小时前');
    expect(formatRelative(NOW - 3 * DAY_MS, NOW)).toBe('10/23 12:00');
  });
});
