/**
 * 单测：统一日志抽屉的视图模型派生（hud/panels/log-catalog.ts，纯逻辑，node 环境）。
 * 覆盖：增量消费（首次播种 / 判重幂等 / 相位迁移出多行）、累积语义（notice 过期后条目仍在）、
 *   环缓冲上限与溢出计数、按任务与级别过滤、清空不回放、渲染签名的判重口径。
 *
 * 断言全部打在"从 WorldState 派生出什么"上 —— 不碰 DOM（DOM 在 log-drawer.test.ts 里测）。
 */

/**
 * @jest-environment node
 */

import type { MissionView, Notice, WorldState } from '../../core/types';
import {
  EMPTY_LOG_FILTER,
  LOG_LEVELS,
  MAX_LOG_ENTRIES,
  buildLogModel,
  collectMissionOptions,
  createLogStream,
  createSeenTracker,
  filterLogEntries,
  formatLogTime,
  levelLabel,
  logSignature,
  mergeLogEntries,
  missionEntryId,
  noticeEntryId,
  sourceLabel,
  type LogEntryView,
} from '../panels/log-catalog';

/** 固定观测时刻：任务事件没有自带时间戳（契约只有 MissionView.createdAt），
 *  单测必须能断言行时间，就走显式传入的 observedAt，不依赖 Date.now()。 */
const T0 = 1_700_000_000_000;

function notice(partial: Partial<Notice> & { id: string }): Notice {
  return {
    level: 'info',
    text: partial.id,
    createdAt: T0,
    expiresAt: T0 + 6000,
    ...partial,
  };
}

function mission(partial: Partial<MissionView> & { id: string }): MissionView {
  return { title: `任务 ${partial.id}`, phase: 'running', unitIds: [], createdAt: T0, ...partial };
}

function makeState(partial: Partial<WorldState> = {}): WorldState {
  return {
    units: [],
    missions: [],
    selection: { unitIds: [], previewUnitIds: [], revision: 0 },
    characters: [],
    notices: [],
    links: [],
    messages: [],
    ...partial,
  };
}

describe('增量消费：notice 与任务相位各出一条', () => {
  test('还没收到 state → 空缓冲', () => {
    const result = mergeLogEntries([], null, T0, createSeenTracker());
    expect(result.entries).toEqual([]);
    expect(result.added).toBe(0);
  });

  test('首次播种：state 里已有的通知与任务当前相位都立刻成行', () => {
    const seen = createSeenTracker();
    const { entries, added } = mergeLogEntries(
      [],
      makeState({
        notices: [notice({ id: 'n-1', level: 'warn', text: '连接抖动' })],
        missions: [mission({ id: 'm-1', title: '联调 hello loop', phase: 'running' })],
      }),
      T0,
      seen,
    );

    expect(added).toBe(2);
    expect(entries).toHaveLength(2);
    // 同一次广播里两条观测时刻相同 → 按 id 倒序定序，可重现
    expect(entries.map((e) => e.id)).toEqual([noticeEntryId('n-1'), missionEntryId('m-1', 'running')]);
  });

  test('通知行：时间/来源/级别/正文齐全，级别映射到语义色槽', () => {
    const { entries } = mergeLogEntries(
      [],
      makeState({ notices: [notice({ id: 'n-1', level: 'error', text: 'agent 掉线', source: 'core/agent-link' })] }),
      T0,
      createSeenTracker(),
    );

    expect(entries[0]).toMatchObject({
      id: noticeEntryId('n-1'),
      at: T0,
      level: 'error',
      tone: 'error',
      levelLabel: '错误',
      sourceKind: 'notice',
      source: 'core/agent-link',
      text: 'agent 掉线',
      missionId: null,
    });
  });

  test('core 没标注来源 → 退化成通用来源，不编造来源名', () => {
    const { entries } = mergeLogEntries([], makeState({ notices: [notice({ id: 'n-1' })] }), T0, createSeenTracker());
    expect(entries[0].source).toBe(sourceLabel('notice'));
  });

  test('任务行：相位映射到级别，正文带任务名与相位；取消记警告、其余记信息', () => {
    const seen = createSeenTracker();
    const running = mergeLogEntries([], makeState({ missions: [mission({ id: 'm-1', phase: 'running' })] }), T0, seen);
    expect(running.entries[0]).toMatchObject({
      sourceKind: 'mission',
      level: 'info',
      text: '「任务 m-1」进行中',
      missionId: 'm-1',
    });

    const cancelled = mergeLogEntries([], makeState({ missions: [mission({ id: 'm-1', phase: 'cancelled' })] }), T0, seen);
    expect(cancelled.entries[0]).toMatchObject({ level: 'warn', text: '「任务 m-1」已取消' });
  });

  test('任务相位迁移 = 新的一行（同一次合并出多条）', () => {
    const seen = createSeenTracker();
    const first = mergeLogEntries([], makeState({ missions: [mission({ id: 'm-1', phase: 'pending' })] }), T0, seen);
    expect(first.entries).toHaveLength(1);

    // 相位变了 → 追加一行；旧行仍在（累积视图，不是"当前状态"）
    const second = mergeLogEntries(first.entries, makeState({ missions: [mission({ id: 'm-1', phase: 'running' })] }), T0 + 500, seen);
    expect(second.added).toBe(1);
    expect(second.entries.map((e) => e.id)).toEqual([
      missionEntryId('m-1', 'running'),
      missionEntryId('m-1', 'pending'),
    ]);
    // 新行的时刻是观测时刻，不是任务创建时间 —— createdAt 是"建任务"，不是"这次迁移"
    expect(second.entries[0].at).toBe(T0 + 500);
    expect(second.entries[1].at).toBe(T0);
  });

  test('同一份 state 反复合并不出新行（判重靠"已消费"记忆）', () => {
    const seen = createSeenTracker();
    const state = makeState({
      notices: [notice({ id: 'n-1' })],
      missions: [mission({ id: 'm-1' })],
    });
    const first = mergeLogEntries([], state, T0, seen);
    const second = mergeLogEntries(first.entries, state, T0, seen);
    const third = mergeLogEntries(second.entries, state, T0, seen);

    expect(second.added).toBe(0);
    expect(third.entries).toBe(second.entries); // 连数组引用都没换 → 调用方可跳过重绘
    expect(third.entries).toHaveLength(2);
  });

  test('新通知在旧行前面（倒序 = 最新在上，不需要自动滚底）', () => {
    const seen = createSeenTracker();
    const first = mergeLogEntries([], makeState({ notices: [notice({ id: 'n-1', createdAt: T0 })] }), T0, seen);
    const second = mergeLogEntries(
      first.entries,
      makeState({ notices: [notice({ id: 'n-2', createdAt: T0 + 1000 }), notice({ id: 'n-1', createdAt: T0 })] }),
      T0,
      seen,
    );
    expect(second.entries.map((e) => e.id)).toEqual([noticeEntryId('n-2'), noticeEntryId('n-1')]);
  });
});

describe('累积语义：core 清掉的通知不会把日志一起带走', () => {
  test('notice 过期被 core 剔除后，本地已渲染的行仍在', () => {
    const stream = createLogStream();
    stream.consume(makeState({ notices: [notice({ id: 'n-1' })] }), T0);
    expect(stream.entries).toHaveLength(1);

    // core 6s 后 prune 掉它（WorldState.notices 变空）—— 若是"每次从 state 重画"，日志就空了
    stream.consume(makeState({ notices: [] }), T0 + 10_000);
    expect(stream.entries).toHaveLength(1);
    expect(stream.entries[0].text).toBe('n-1');
  });
});

describe('容量上限：累积视图必须有界', () => {
  test('缓冲不超过 MAX_LOG_ENTRIES，溢出条数如实报出', () => {
    const stream = createLogStream();
    // 每轮换一批全新 notice id（core 侧 notices 也有上限，但这里是直接压缓冲上限）
    for (let batch = 0; batch < 4; batch++) {
      const notices = Array.from({ length: 200 }, (_, i) =>
        notice({ id: `n-${batch}-${i}`, createdAt: T0 + batch * 1000 + i }),
      );
      stream.consume(makeState({ notices }), T0);
    }

    expect(stream.entries.length).toBeLessThanOrEqual(MAX_LOG_ENTRIES);
    expect(stream.entries.length).toBe(MAX_LOG_ENTRIES);
    expect(stream.droppedCount).toBe(200 * 4 - MAX_LOG_ENTRIES);
    // 留下的是最新的那批
    expect(stream.entries[0].id).toBe(noticeEntryId('n-3-199'));
  });

  test('已消费跟踪器自身也有界（FIFO 淘汰，不无限涨）', () => {
    const seen = createSeenTracker(4);
    for (let i = 0; i < 10; i++) seen.add(`id-${i}`);
    expect(seen.size).toBe(4);
    expect(seen.has('id-0')).toBe(false); // 最早的已淘汰
    expect(seen.has('id-9')).toBe(true);
  });
});

describe('过滤：按任务 / 按级别', () => {
  const entries: LogEntryView[] = [
    { id: 'a', at: 3, level: 'error', tone: 'error', levelLabel: '错误', sourceKind: 'notice', source: '通知', text: 'A', missionId: 'm-1', missionTitle: '任务一' },
    { id: 'b', at: 2, level: 'info', tone: 'info', levelLabel: '信息', sourceKind: 'mission', source: '任务', text: 'B', missionId: 'm-1', missionTitle: null },
    { id: 'c', at: 1, level: 'warn', tone: 'warn', levelLabel: '警告', sourceKind: 'notice', source: '通知', text: 'C', missionId: null, missionTitle: null },
  ];

  test('默认空过滤 = 全部', () => {
    expect(filterLogEntries(entries, EMPTY_LOG_FILTER)).toHaveLength(3);
  });

  test('按 missionId 只留该任务的行（与任务无关的通知不出现）', () => {
    expect(filterLogEntries(entries, { missionId: 'm-1', levels: null }).map((e) => e.id)).toEqual(['a', 'b']);
    expect(filterLogEntries(entries, { missionId: 'm-9', levels: null })).toEqual([]);
  });

  test('按级别过滤：空集合 = 一条都不显示（语义不与"未设置"混淆）', () => {
    expect(filterLogEntries(entries, { missionId: null, levels: new Set(['error']) }).map((e) => e.id)).toEqual(['a']);
    expect(filterLogEntries(entries, { missionId: null, levels: new Set(['error', 'warn']) }).map((e) => e.id)).toEqual(['a', 'c']);
    expect(filterLogEntries(entries, { missionId: null, levels: new Set() })).toEqual([]);
  });

  test('两个条件是"与"关系', () => {
    expect(
      filterLogEntries(entries, { missionId: 'm-1', levels: new Set(['info']) }).map((e) => e.id),
    ).toEqual(['b']);
  });

  test('过滤不改变顺序（仍是最新在上）', () => {
    expect(filterLogEntries(entries, { missionId: 'm-1', levels: null }).map((e) => e.at)).toEqual([3, 2]);
  });
});

describe('渲染模型：标题回填、计数、摘要', () => {
  const state = makeState({
    notices: [
      notice({ id: 'n-1', missionId: 'm-1', text: 'A' }),
      notice({ id: 'n-2', level: 'warn', text: 'B' }),
    ],
    missions: [mission({ id: 'm-1', title: '联调 hello loop' })],
  });

  test('命中 missions 的行回填任务标题；悬空 id 保持 null，不编造标题', () => {
    const stream = createLogStream();
    stream.consume(state, T0);
    const model = buildLogModel(stream.entries, EMPTY_LOG_FILTER, state, stream.droppedCount);

    const tagged = model.entries.find((e) => e.id === noticeEntryId('n-1'));
    expect(tagged?.missionTitle).toBe('联调 hello loop');

    // 指向一个 state.missions 里没有的任务 → 不回填，组件据此退回显示 id
    const orphan = buildLogModel(
      [
        {
          id: noticeEntryId('n-3'), at: T0, level: 'info', tone: 'info', levelLabel: '信息',
          sourceKind: 'notice', source: '通知', text: 'C', missionId: 'm-ghost', missionTitle: null,
        },
      ],
      EMPTY_LOG_FILTER,
      state,
      0,
    );
    expect(orphan.entries[0].missionTitle).toBeNull();
  });

  test('摘要区分"全命中"与"过滤后"，溢出条数透传', () => {
    const all = buildLogModel(
      [
        { id: 'a', at: 2, level: 'info', tone: 'info', levelLabel: '信息', sourceKind: 'notice', source: '通知', text: 'A', missionId: null, missionTitle: null },
        { id: 'b', at: 1, level: 'info', tone: 'info', levelLabel: '信息', sourceKind: 'notice', source: '通知', text: 'B', missionId: null, missionTitle: null },
      ],
      EMPTY_LOG_FILTER,
      null,
      7,
    );
    expect(all.summary).toBe('2 条');
    expect(all.droppedCount).toBe(7);

    const filtered = buildLogModel(all.entries, { missionId: 'm-1', levels: null }, null, 0);
    expect(filtered.summary).toBe('0 / 2 条');
    expect(filtered.matchCount).toBe(0);
    expect(filtered.totalCount).toBe(2);
  });

  test('任务候选项按标题排序，空标题退化成 id（不留空选项）', () => {
    const options = collectMissionOptions(
      makeState({
        missions: [mission({ id: 'm-2', title: 'B 任务' }), mission({ id: 'm-1', title: 'A 任务' }), mission({ id: 'm-3', title: '' })],
      }),
    );
    expect(options.map((o) => o.label)).toEqual(['A 任务', 'B 任务', 'm-3']);
  });
});

describe('清空当前视图：清条目、不回放', () => {
  test('清空后 state 里还活着的通知不会被下一次广播回放', () => {
    const stream = createLogStream();
    const state = makeState({ notices: [notice({ id: 'n-1' })] });
    stream.consume(state, T0);
    expect(stream.entries).toHaveLength(1);

    stream.clear();
    expect(stream.entries).toHaveLength(0);

    // 同一份 state 再来一次 —— 已消费记忆没被清，所以不会"复活"
    stream.consume(state, T0);
    expect(stream.entries).toHaveLength(0);
  });

  test('清空后新出现的通知仍然记入（清的是视图，不是记忆）', () => {
    const stream = createLogStream();
    stream.consume(makeState({ notices: [notice({ id: 'n-1' })] }), T0);
    stream.clear();

    stream.consume(makeState({ notices: [notice({ id: 'n-2' })] }), T0);
    expect(stream.entries.map((e) => e.id)).toEqual([noticeEntryId('n-2')]);
  });
});

describe('渲染签名：只对"会影响日志视图"的状态敏感', () => {
  const base = (): WorldState =>
    makeState({
      notices: [notice({ id: 'n-1' })],
      missions: [mission({ id: 'm-1', phase: 'running' })],
    });

  test('新通知 → 签名变（新条目会自动出现）', () => {
    const before = logSignature(base());
    const after = logSignature(
      makeState({ notices: [notice({ id: 'n-2' }), notice({ id: 'n-1' })], missions: [mission({ id: 'm-1', phase: 'running' })] }),
    );
    expect(after).not.toBe(before);
  });

  test('任务相位迁移 → 签名变', () => {
    expect(logSignature(makeState({ missions: [mission({ id: 'm-1', phase: 'done' })] }))).not.toBe(
      logSignature(makeState({ missions: [mission({ id: 'm-1', phase: 'running' })] })),
    );
  });

  test('任务改名（相位不变）→ 签名也要变，否则已有行的标题会一直是旧值', () => {
    expect(logSignature(makeState({ missions: [mission({ id: 'm-1', title: '改过的名字' })] }))).not.toBe(
      logSignature(makeState({ missions: [mission({ id: 'm-1', title: '原名' })] })),
    );
  });

  test('与日志无关的广播（选择集、单位读数）→ 签名不变，不触发重绘', () => {
    const before = logSignature(base());
    const after = logSignature({
      ...base(),
      selection: { unitIds: ['u-1'], previewUnitIds: [], revision: 9 },
      units: [{ id: 'u-1', name: 'Neo', status: 'busy', missionId: 'm-1', power: 3 }],
    });
    expect(after).toBe(before);
  });

  test('null state 有稳定签名', () => {
    expect(logSignature(null)).toBe('none');
  });
});

describe('词表与格式化', () => {
  test('级别词表就是契约的三级，顺序固定（筛选条按钮顺序即此）', () => {
    expect(LOG_LEVELS).toEqual(['info', 'warn', 'error']);
    expect(LOG_LEVELS.map(levelLabel)).toEqual(['信息', '警告', '错误']);
  });

  test('时间固定零填充 HH:MM:SS（不随 ICU/时区漂移，单测可断言）', () => {
    const t = new Date(2024, 0, 2, 9, 5, 7).getTime();
    expect(formatLogTime(t)).toBe('09:05:07');
    expect(formatLogTime(Number.NaN)).toBe('--:--:--');
  });
});