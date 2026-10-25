/**
 * 单测：派发智能推荐纯函数（hud/panels/task-assign-catalog.ts，task_050，纯逻辑，node 环境）。
 * 覆盖：评分排序（权重三角：空闲 > 专属度 > 成功率）、同分平局（在办少者先 + 原序稳定）、
 *   理由短语三段式、无历史中性值（0.5：不奖励不惩罚）、awaiting_approval 算在办、
 *   未绑定角色不进候选、排队预计（队列长度 × 历史均值；无历史「未知」；空闲不提示）、
 *   全忙判定、自动目标解析、带 targetCharacterId 的命令构造。
 * 断言全打在「同输入 → 同输出」上：不碰 DOM（DOM 在 agent-panel.test.ts）。
 *
 * @jest-environment node
 */

import type { AgentKind, CharacterTask, CharacterView, TaskStatus, UnitView, WorldState } from '../../core/types';
import { buildTaskAssignCommand } from '../panels/agent-catalog';
import {
  buildAssigneeReason,
  buildQueueEstimateHint,
  isAllBusy,
  NEUTRAL_SUCCESS_RATE,
  recommendAssignees,
  RECOMMEND_WEIGHTS,
  resolveAutoTarget,
  successRateOf,
  type CharacterTaskStatInput,
} from '../panels/task-assign-catalog';
import { dedicatedPresetCount } from '../screens/persona-presets';

function character(id: string, patch: Partial<CharacterView> = {}): CharacterView {
  return { id, name: id, persona: '', level: 1, experience: 0, ...patch };
}

function task(characterId: string, status: TaskStatus): CharacterTask {
  return { id: `t-${characterId}-${status}`, characterId, prompt: 'p', status, createdAt: 1, startedAt: null, endedAt: null, output: '' };
}

function makeState(patch: Partial<WorldState> = {}): WorldState {
  return {
    units: [],
    missions: [],
    selection: { unitIds: [], previewUnitIds: [], revision: 0 },
    characters: [],
    notices: [],
    links: [],
    messages: [],
    ...patch,
  };
}

/** 带绑定 kind 的角色（推荐候选的准入条件）。 */
const bound = (id: string, kind: AgentKind, patch: Partial<CharacterView> = {}): CharacterView =>
  character(id, { agentKind: kind, ...patch });

const STATS: readonly CharacterTaskStatInput[] = [
  { characterId: 'c-a', completed: 86, failed: 14, avgDurationMs: 10 * 60_000 },
  { characterId: 'c-b', completed: 0, failed: 2, avgDurationMs: 5 * 60_000 },
];

// ============================================================================
// 前置口径：专属预设（预设库 043 的反向利用）
// ============================================================================

describe('dedicatedPresetCount（预设库反向读数）', () => {
  test('openclaw 有专属预设（点名）；claude-code 只被 any 预设覆盖 → 0', () => {
    expect(dedicatedPresetCount('openclaw')).toBeGreaterThanOrEqual(1);
    expect(dedicatedPresetCount('claude-code')).toBe(0);
  });
});

// ============================================================================
// 评分与排序
// ============================================================================

describe('recommendAssignees：评分排序', () => {
  test('权重三角：空闲 > 专属度 > 成功率 —— idle+专属+86% 压过 busy+满分历史', () => {
    const state = makeState({
      characters: [
        bound('c-a', 'openclaw'), // 空闲 + 专属 + 86% → 0.5 + 0.3 + 0.172
        bound('c-b', 'claude-code'), // 忙 + 无专属 + 100%
      ],
      tasks: [task('c-b', 'running')],
    });
    // b 给满分历史：忙角色哪怕 100% 成功率，也压不过空闲 + 专属 + 86% 的组合。
    const stats = [STATS[0], { characterId: 'c-b', completed: 2, failed: 0, avgDurationMs: null }];

    const [first, second] = recommendAssignees(state, stats);
    expect(first?.characterId).toBe('c-a');
    expect(first?.recommended).toBe(true);
    expect(second?.recommended).toBe(false);
    expect(first?.score).toBeCloseTo(0.5 + 0.3 + 0.86 * RECOMMEND_WEIGHTS.successRate, 10);
    expect(second?.score).toBeCloseTo(0 + 0 + 1.0 * RECOMMEND_WEIGHTS.successRate, 10);
    expect(first.score).toBeGreaterThan(second.score);
  });

  test('同分平局：在办少的排前；再平 → 原序稳定（两次调用顺序一致）', () => {
    const state = makeState({
      characters: [bound('c-x', 'codex'), bound('c-y', 'kimi'), bound('c-z', 'codex')],
      tasks: [task('c-x', 'queued'), task('c-z', 'queued'), task('c-z', 'running')],
    });
    // 三人同 kind（无专属）、同无历史（都中性 0.5）：忙者靠后，在办多者更后，空闲者原序在前。
    const order = recommendAssignees(state).map((a) => a.characterId);
    expect(order).toEqual(['c-y', 'c-x', 'c-z']);
    expect(recommendAssignees(state).map((a) => a.characterId)).toEqual(order);
  });

  test('awaiting_approval 也算在办（六态真相：审批挂起 ≠ 空闲可接单）', () => {
    const state = makeState({
      characters: [bound('c-hang', 'codex'), bound('c-free', 'codex')],
      tasks: [task('c-hang', 'awaiting_approval')],
    });
    const [first, second] = recommendAssignees(state);
    expect(first?.characterId).toBe('c-free');
    expect(first?.idle).toBe(true);
    expect(second?.idle).toBe(false);
    expect(second?.activeCount).toBe(1);
  });

  test('未绑定 agentKind 的角色不进候选（接了也只能被守门拦成 failed）', () => {
    const state = makeState({ characters: [character('c-raw'), bound('c-bound', 'codex')] });
    const list = recommendAssignees(state);
    expect(list.map((a) => a.characterId)).toEqual(['c-bound']);
  });

  test('没收到状态 / 没有候选 → 空数组（表单兜底路径，不在这里编目标）', () => {
    expect(recommendAssignees(null)).toEqual([]);
    expect(recommendAssignees(makeState())).toEqual([]);
  });

  test('kind 徽标与单位态：kindLabel 用词表单一真相源；无单位投影 → null', () => {
    const units: UnitView[] = [
      { id: 'u-1', name: 'U', status: 'busy', missionId: null, power: 1, characterId: 'c-a' },
    ];
    const [a] = recommendAssignees(makeState({ characters: [bound('c-a', 'openclaw')], units }));
    expect(a?.kindLabel).toBe('OpenClaw');
    expect(a?.unitStatus).toBe('busy');
  });
});

// ============================================================================
// 历史成功率与中性值
// ============================================================================

describe('successRateOf：无历史中性值', () => {
  test('completed/(completed+failed)；无行 / 无终态 → null（调用方按中性值计分）', () => {
    expect(successRateOf(STATS[0])).toBeCloseTo(0.86, 10);
    expect(successRateOf(STATS[1])).toBe(0);
    expect(successRateOf(undefined)).toBeNull();
    expect(successRateOf({ characterId: 'c-new', completed: 0, failed: 0, avgDurationMs: null })).toBeNull();
  });

  test('无历史按 NEUTRAL_SUCCESS_RATE 计分：压过全败历史、被满分历史压过', () => {
    const state = makeState({
      characters: [bound('c-new', 'codex'), bound('c-lose', 'codex'), bound('c-win', 'codex')],
      tasks: [],
    });
    const list = recommendAssignees(state, [
      { characterId: 'c-lose', completed: 0, failed: 3, avgDurationMs: null },
      { characterId: 'c-win', completed: 3, failed: 0, avgDurationMs: null },
    ]);
    const byId = new Map(list.map((a) => [a.characterId, a]));
    const neutral = byId.get('c-new');
    expect(neutral?.successRate).toBeNull();
    // 三人都空闲（idle 加分同基线）+ codex 无专属预设 → 分差只来自成功率段：
    // 中性 = idle + 0.5×权重，介于全败（idle + 0）与满分（idle + 权重）之间，差距恰是半档。
    const idleBase = RECOMMEND_WEIGHTS.idle;
    expect(neutral?.score).toBeCloseTo(idleBase + NEUTRAL_SUCCESS_RATE * RECOMMEND_WEIGHTS.successRate, 10);
    expect(byId.get('c-lose')!.score).toBeCloseTo(idleBase, 10);
    expect(byId.get('c-win')!.score).toBeCloseTo(idleBase + RECOMMEND_WEIGHTS.successRate, 10);
    expect(byId.get('c-lose')!.score).toBeLessThan(neutral!.score);
    expect(neutral!.score).toBeLessThan(byId.get('c-win')!.score);
  });
});

// ============================================================================
// 理由短语
// ============================================================================

describe('buildAssigneeReason：三段式短语', () => {
  test('满配：「空闲 · 擅长此类 · 成功率 86%」', () => {
    expect(
      buildAssigneeReason({ idle: true, activeCount: 0, specialtyPresets: 1, successRate: 0.86 })
    ).toBe('空闲 · 擅长此类 · 成功率 86%');
  });

  test('忙：排队 N 在前；无专属不吹「擅长」；无历史不编成功率', () => {
    expect(buildAssigneeReason({ idle: false, activeCount: 2, specialtyPresets: 0, successRate: null })).toBe(
      '排队 2'
    );
    expect(buildAssigneeReason({ idle: false, activeCount: 1, specialtyPresets: 0, successRate: 0.5 })).toBe(
      '排队 1 · 成功率 50%'
    );
    expect(buildAssigneeReason({ idle: true, activeCount: 0, specialtyPresets: 0, successRate: null })).toBe(
      '空闲'
    );
  });
});

// ============================================================================
// 排队预计（全忙提示）
// ============================================================================

describe('buildQueueEstimateHint：排队预计', () => {
  const [busy] = recommendAssignees(
    makeState({ characters: [bound('c-a', 'openclaw')], tasks: [task('c-a', 'running'), task('c-a', 'queued')] })
  );

  test('队列长度 × 历史均值（FIFO 并发 1）', () => {
    expect(busy?.activeCount).toBe(2);
    expect(buildQueueEstimateHint(busy!, STATS)).toBe('c-a 队列 2 条 · 预计 ~20 分钟');
  });

  test('无历史 → 「未知」，不编一个数', () => {
    expect(buildQueueEstimateHint(busy!, [])).toBe('c-a 队列 2 条 · 预计未知');
    expect(buildQueueEstimateHint(busy!)).toBe('c-a 队列 2 条 · 预计未知');
  });

  test('空闲目标 → null（没什么可估，不占表单空间）；不足一分钟如实「<1 分钟」', () => {
    const [idleOne] = recommendAssignees(makeState({ characters: [bound('c-idle', 'codex')] }));
    expect(buildQueueEstimateHint(idleOne!, STATS)).toBeNull();

    const [quick] = recommendAssignees(
      makeState({ characters: [bound('c-q', 'codex')], tasks: [task('c-q', 'running')] })
    );
    expect(buildQueueEstimateHint(quick!, [{ characterId: 'c-q', completed: 1, failed: 0, avgDurationMs: 20_000 }])).toBe(
      'c-q 队列 1 条 · 预计 <1 分钟'
    );
  });
});

describe('isAllBusy / resolveAutoTarget', () => {
  test('有人且全忙 → true；有空闲 / 没有人 → false', () => {
    const busyOnly = recommendAssignees(
      makeState({ characters: [bound('c-a', 'codex')], tasks: [task('c-a', 'running')] })
    );
    expect(isAllBusy(busyOnly)).toBe(true);

    const withIdle = recommendAssignees(
      makeState({ characters: [bound('c-a', 'codex'), bound('c-b', 'kimi')], tasks: [task('c-a', 'running')] })
    );
    expect(isAllBusy(withIdle)).toBe(false);
    expect(isAllBusy([])).toBe(false);
  });

  test('自动 = 排序第一位；无候选退 fallback；再无则 null（表单退 038 行为）', () => {
    const list = recommendAssignees(
      makeState({ characters: [bound('c-best', 'openclaw'), bound('c-rest', 'codex')] })
    );
    expect(resolveAutoTarget(list, 'c-form')).toBe('c-best');
    expect(resolveAutoTarget([], 'c-form')).toBe('c-form');
    expect(resolveAutoTarget([], null)).toBeNull();
  });
});

// ============================================================================
// 命令构造：指定承接人
// ============================================================================

describe('buildTaskAssignCommand：targetCharacterId（task_050）', () => {
  test('指定他人 → 载荷带 targetCharacterId；指定本人 / 未指定 → 缺省（038 行为）', () => {
    expect(buildTaskAssignCommand('c-form', '干活', 'c-other')).toEqual({
      type: 'task.assign',
      characterId: 'c-form',
      prompt: '干活',
      targetCharacterId: 'c-other',
    });
    expect(buildTaskAssignCommand('c-form', '干活', 'c-form')).toEqual({
      type: 'task.assign',
      characterId: 'c-form',
      prompt: '干活',
    });
    expect(buildTaskAssignCommand('c-form', '干活', null)).toEqual({
      type: 'task.assign',
      characterId: 'c-form',
      prompt: '干活',
    });
  });
});
