/**
 * 单测：Agent 侧栏视图模型派生与命令构造（hud/panels/agent-catalog.ts，纯逻辑，node 环境）。
 * 覆盖：空/单选/编组三形态、详情读数（状态/任务/能力/成长）、编组渲染上限、
 *   三条动作 → HudCommand 的映射、渲染签名的判重口径。
 *
 * 断言全部打在"从 WorldState 派生出什么"上 —— 不碰 DOM（DOM 在 agent-panel.test.ts 里测）。
 */

/**
 * @jest-environment node
 */

import type { CharacterTask, CharacterView, MissionView, UnitCapabilitiesView, UnitView, WorldState } from '../../core/types';
import {
  agentPanelSignature,
  buildAgentCommand,
  buildTaskAssignCommand,
  buildTaskCancelCommand,
  MAX_VISIBLE_GROUP_ROWS,
  resolveAgentPanel,
  resolveCharacterTaskQueue,
  truncateTaskSummary,
} from '../panels/agent-catalog';

const CAPS: UnitCapabilitiesView = {
  overall: 72,
  level: '优秀',
  dimensions: { offense: 80, defense: 60, mobility: 55, magic: 90, survivability: 65, utility: 40 },
};

const CHARACTER: CharacterView = {
  id: 'c-neo',
  name: 'Neo 档案',
  persona: '严谨的实现者',
  level: 3,
  experience: 120,
};

function unit(partial: Partial<UnitView> & { id: string }): UnitView {
  return { name: partial.id, status: 'idle', missionId: null, power: 0, ...partial };
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

const selected = (...ids: string[]): WorldState =>
  makeState({ selection: { unitIds: ids, previewUnitIds: [], revision: ids.length } });

const MISSION: MissionView = {
  id: 'm-1',
  title: '联调 hello loop',
  phase: 'running',
  unitIds: ['u-neo'],
  createdAt: 1,
};

describe('形态判定：只认 WorldState.selection，面板本地不留副本', () => {
  test('还没收到 state → empty 形态', () => {
    const model = resolveAgentPanel(null);
    expect(model.mode).toBe('empty');
    expect(model.detail).toBeNull();
    expect(model.rows).toHaveLength(0);
  });

  test('没选中单位 → empty 形态并给出引导文案', () => {
    const model = resolveAgentPanel(makeState({ units: [unit({ id: 'u-neo' })] }));
    expect(model.mode).toBe('empty');
    expect(model.summary).toBe('未选中单位');
  });

  test('选中 1 个 → single 形态，summary 是单位名', () => {
    const model = resolveAgentPanel(makeState({ units: [unit({ id: 'u-neo', name: 'Neo' })], selection: { unitIds: ['u-neo'], previewUnitIds: [], revision: 1 } }));
    expect(model.mode).toBe('single');
    expect(model.summary).toBe('Neo');
    expect(model.detail?.id).toBe('u-neo');
  });

  test('选中 ≥2 个 → group 形态，行数与选择数一致', () => {
    const model = resolveAgentPanel(
      makeState({
        units: [unit({ id: 'u-neo' }), unit({ id: 'u-trinity' }), unit({ id: 'u-morpheus' })],
        selection: { unitIds: ['u-trinity', 'u-neo'], previewUnitIds: [], revision: 2 },
      })
    );
    expect(model.mode).toBe('group');
    expect(model.summary).toBe('已选中 2 个单位');
    // 顺序 = core 的选择顺序，hud 不重排
    expect(model.rows.map((r) => r.id)).toEqual(['u-trinity', 'u-neo']);
  });
});

describe('单选详情：业务态读数全部来自 WorldState', () => {
  test('状态 / 战力 / 任务 / 成长 / 能力都映射到可渲染读数', () => {
    const model = resolveAgentPanel(
      makeState({
        units: [
          unit({
            id: 'u-neo',
            name: 'Neo',
            status: 'busy',
            power: 5,
            missionId: 'm-1',
            characterId: 'c-neo',
            capabilities: CAPS,
          }),
        ],
        missions: [MISSION],
        characters: [CHARACTER],
        selection: { unitIds: ['u-neo'], previewUnitIds: [], revision: 1 },
      })
    );

    expect(model.detail).toMatchObject({
      id: 'u-neo',
      name: 'Neo',
      statusLabel: '忙碌',
      statusTone: 'busy',
      power: 5,
      mission: { id: 'm-1', title: '联调 hello loop', phaseLabel: '进行中' },
      growth: { characterId: 'c-neo', name: 'Neo 档案', level: 3, experience: 120 },
    });
    // 能力维度按契约词表顺序展开，且标签来自 hud 侧词表、数值来自 core
    expect(model.detail?.capabilities?.bars).toEqual([
      { key: 'offense', label: '攻击', value: 80 },
      { key: 'defense', label: '防御', value: 60 },
      { key: 'mobility', label: '机动', value: 55 },
      { key: 'magic', label: '魔法', value: 90 },
      { key: 'survivability', label: '生存', value: 65 },
      { key: 'utility', label: '辅助', value: 40 },
    ]);
    expect(model.detail?.capabilities?.level).toBe('优秀');
  });

  test('空闲单位：任务为 null，未关联角色 → 成长 null', () => {
    const model = resolveAgentPanel(
      makeState({ units: [unit({ id: 'u-neo', name: 'Neo' })], selection: { unitIds: ['u-neo'], previewUnitIds: [], revision: 1 } })
    );
    expect(model.detail?.mission).toBeNull();
    expect(model.detail?.growth).toBeNull();
    expect(model.detail?.capabilities).toBeNull(); // 没数据就说没数据，不用 power 冒充六维
  });

  test('characterId 指向不存在的角色 → 成长 null（不编造档案）', () => {
    const model = resolveAgentPanel(
      makeState({
        units: [unit({ id: 'u-neo', characterId: 'c-ghost' })],
        selection: { unitIds: ['u-neo'], previewUnitIds: [], revision: 1 },
      })
    );
    expect(model.detail?.growth).toBeNull();
  });

  test('能力数值被夹到 0–100（core 算错也不撑破布局）', () => {
    const model = resolveAgentPanel(
      makeState({
        units: [
          unit({
            id: 'u-neo',
            capabilities: { overall: 120, level: '传说', dimensions: { offense: -5, defense: 300, mobility: 0, magic: 0, survivability: 0, utility: 0 } },
          }),
        ],
        selection: { unitIds: ['u-neo'], previewUnitIds: [], revision: 1 },
      })
    );
    expect(model.detail?.capabilities?.overall).toBe(100);
    expect(model.detail?.capabilities?.bars.find((b) => b.key === 'offense')?.value).toBe(0);
    expect(model.detail?.capabilities?.bars.find((b) => b.key === 'defense')?.value).toBe(100);
  });

  test('选择集里有、units 里已没有的悬空 id → 名字退化成 id，不崩', () => {
    const model = resolveAgentPanel(selected('u-ghost'));
    expect(model.mode).toBe('single');
    expect(model.detail?.id).toBe('u-ghost');
    expect(model.detail?.name).toBe('u-ghost');
  });
});

describe('编组列表：行字段与渲染上限', () => {
  test('行只带能一眼扫完的读数：状态 / 战力 / 任务标题', () => {
    const model = resolveAgentPanel(
      makeState({
        units: [unit({ id: 'u-neo', name: 'Neo', status: 'busy', power: 5, missionId: 'm-1' })],
        missions: [MISSION],
        selection: { unitIds: ['u-neo', 'u-morpheus'], previewUnitIds: [], revision: 2 },
      })
    );
    expect(model.rows[0]).toEqual({
      id: 'u-neo',
      name: 'Neo',
      statusLabel: '忙碌',
      statusTone: 'busy',
      power: 5,
      missionTitle: '联调 hello loop',
    });
    // 悬空 id 仍出行，保证选中数与行数语义一致
    expect(model.rows[1]).toMatchObject({ id: 'u-morpheus', statusLabel: '离线' });
  });

  test('超大编组只渲染前 N 行并如实报出剩余数（不假装列全了）', () => {
    const units = Array.from({ length: MAX_VISIBLE_GROUP_ROWS + 7 }, (_, i) =>
      unit({ id: `u-${i}`, name: `Agent ${i}` })
    );
    const ids = units.map((u) => u.id);
    const model = resolveAgentPanel(
      makeState({ units, selection: { unitIds: ids, previewUnitIds: [], revision: 1 } })
    );

    expect(model.rows).toHaveLength(MAX_VISIBLE_GROUP_ROWS);
    expect(model.overflow).toBe(7);
    expect(model.summary).toBe(`已选中 ${ids.length} 个单位`);
  });
});

describe('命令构造：三条动作各自落到契约变体', () => {
  test('查看详情 → unit.select(set)：不新造"详情"命令，面板不持有第二份选中真相', () => {
    expect(buildAgentCommand('inspect', 'u-neo')).toEqual({
      type: 'unit.select',
      unitIds: ['u-neo'],
      mode: 'set',
    });
  });

  test('聚焦 → unit.focus（@since v3.2 相机命令，与选择无关）', () => {
    expect(buildAgentCommand('focus', 'u-neo')).toEqual({ type: 'unit.focus', unitId: 'u-neo' });
  });

  test('移出编组 → unit.select(toggle)：与 core 选择状态机同名同义', () => {
    expect(buildAgentCommand('remove', 'u-neo')).toEqual({
      type: 'unit.select',
      unitIds: ['u-neo'],
      mode: 'toggle',
    });
  });

  test('空 unitId 一律构造不出命令（不发半截命令给 core）', () => {
    expect(buildAgentCommand('focus', '')).toBeNull();
    expect(buildAgentCommand('inspect', '')).toBeNull();
    expect(buildAgentCommand('remove', '')).toBeNull();
  });
});

describe('渲染签名：只对"选中单位的可见读数"敏感', () => {
  const base = (): WorldState =>
    makeState({
      units: [unit({ id: 'u-neo', name: 'Neo', power: 5 }), unit({ id: 'u-other', name: 'Morpheus', power: 9 })],
      selection: { unitIds: ['u-neo'], previewUnitIds: [], revision: 1 },
    });

  test('选中单位的读数变了 → 签名变', () => {
    const before = agentPanelSignature(base());
    const after = agentPanelSignature(
      makeState({
        units: [unit({ id: 'u-neo', name: 'Neo', power: 6 }), unit({ id: 'u-other', name: 'Morpheus', power: 9 })],
        selection: { unitIds: ['u-neo'], previewUnitIds: [], revision: 1 },
      })
    );
    expect(after).not.toBe(before);
  });

  test('没被选中的单位变了 → 签名不变（高频广播不必重绘侧栏）', () => {
    const before = agentPanelSignature(base());
    const after = agentPanelSignature(
      makeState({
        units: [unit({ id: 'u-neo', name: 'Neo', power: 5 }), unit({ id: 'u-other', name: 'Neo2', power: 1, status: 'error' })],
        selection: { unitIds: ['u-neo'], previewUnitIds: [], revision: 1 },
      })
    );
    expect(after).toBe(before);
  });

  test('能力 / 成长 / 任务变化都会改签名（否则"输入变了却不重画"）', () => {
    const withUnit = (extra: Partial<UnitView>, extraState: Partial<WorldState> = {}): string =>
      agentPanelSignature(
        makeState({
          units: [unit({ id: 'u-neo', name: 'Neo', ...extra })],
          selection: { unitIds: ['u-neo'], previewUnitIds: [], revision: 1 },
          ...extraState,
        })
      );

    const plain = withUnit({});
    expect(withUnit({ capabilities: CAPS })).not.toBe(plain);
    expect(withUnit({ characterId: 'c-neo' }, { characters: [CHARACTER] })).not.toBe(plain);
    expect(withUnit({ missionId: 'm-1' }, { missions: [MISSION] })).not.toBe(plain);
    // 同一个 id、任务换相位也算变化
    expect(
      withUnit({ missionId: 'm-1' }, { missions: [{ ...MISSION, phase: 'done' }] })
    ).not.toBe(withUnit({ missionId: 'm-1' }, { missions: [MISSION] }));
  });

  test('null state 有稳定签名', () => {
    expect(agentPanelSignature(null)).toBe('none');
  });
});
// ============================================================================
// 角色任务队列 + 派发命令（@since v3.17，task_038）
// ============================================================================

describe('角色任务队列读数：WorldState.tasks → 当前摘要 + 排队数', () => {
  const task = (id: string, status: CharacterTask['status'], prompt: string, createdAt = 1): CharacterTask => ({
    id,
    characterId: 'c-neo',
    prompt,
    status,
    createdAt,
    startedAt: null,
    endedAt: null,
    output: '',
  });

  test('tasks 缺省 / 没有在办任务 → 空读数（不编造）', () => {
    expect(resolveCharacterTaskQueue(undefined, 'c-neo')).toEqual({ summary: null, waiting: 0, items: [] });
    expect(
      resolveCharacterTaskQueue([task('t1', 'completed', '已收尾')], 'c-neo')
    ).toEqual({ summary: null, waiting: 0, items: [expect.objectContaining({ id: 't1', status: 'completed' })] });
  });

  test('running 优先于 queued：当前任务是正在跑的那条', () => {
    const queue = resolveCharacterTaskQueue(
      [task('t1', 'queued', '第一条排队', 1), task('t2', 'running', '正在跑', 2)],
      'c-neo'
    );
    expect(queue.summary).toBe('正在跑');
    expect(queue.waiting).toBe(1);
  });

  test('没有 running 时取 FIFO 队首的 queued', () => {
    const queue = resolveCharacterTaskQueue(
      [task('t1', 'queued', '第一条', 1), task('t2', 'queued', '第二条', 2)],
      'c-neo'
    );
    expect(queue.summary).toBe('第一条');
    expect(queue.waiting).toBe(1);
  });

  test('只统计该角色的任务（别人的队列不算进来）', () => {
    const queue = resolveCharacterTaskQueue(
      [task('t1', 'running', '我的'), { ...task('t9', 'running', '别人的', 3), characterId: 'c-trinity' }],
      'c-neo'
    );
    expect(queue.summary).toBe('我的');
    expect(queue.waiting).toBe(0);
  });

  test('摘要 40 字截断加省略号；未超长原样（trim 后计）', () => {
    expect(truncateTaskSummary('  短任务  ')).toBe('短任务');
    const long = '长'.repeat(50);
    expect(truncateTaskSummary(long)).toBe(`${'长'.repeat(40)}…`);
    expect(truncateTaskSummary(long).length).toBe(41);
    expect(truncateTaskSummary('整'.repeat(40))).toBe('整'.repeat(40));
  });
});

describe('派发命令构造：buildTaskAssignCommand', () => {
  test('有角色 + 非空指令 → task.assign（prompt 已 trim）', () => {
    expect(buildTaskAssignCommand('c-neo', '  写周报  ')).toEqual({
      type: 'task.assign',
      characterId: 'c-neo',
      prompt: '写周报',
    });
  });

  test('没角色 / 空白指令 → null（不发空命令）', () => {
    expect(buildTaskAssignCommand(null, '写周报')).toBeNull();
    expect(buildTaskAssignCommand(undefined, '写周报')).toBeNull();
    expect(buildTaskAssignCommand('c-neo', '   ')).toBeNull();
  });
});

describe('单选详情的队列字段（task_038）', () => {
  test('关联角色的单位带 characterId 与队列读数；未关联的角色字段为 null + 空读数', () => {
    const state = makeState({
      units: [unit({ id: 'u-neo', name: 'Neo', characterId: 'c-neo' })],
      characters: [CHARACTER],
      selection: { unitIds: ['u-neo'], previewUnitIds: [], revision: 1 },
      tasks: [
        {
          id: 't1', characterId: 'c-neo', prompt: '正在跑的任务', status: 'running',
          createdAt: 1, startedAt: 1, endedAt: null, output: '',
        },
        {
          id: 't2', characterId: 'c-neo', prompt: '排队的任务', status: 'queued',
          createdAt: 2, startedAt: null, endedAt: null, output: '',
        },
      ],
    });
    const model = resolveAgentPanel(state);
    expect(model.detail?.characterId).toBe('c-neo');
    expect(model.detail?.taskQueue.summary).toBe('正在跑的任务');
    expect(model.detail?.taskQueue.waiting).toBe(1);

    const stateNoCharacter = makeState({
      units: [unit({ id: 'u-plain', name: '无角色单位' })],
      selection: { unitIds: ['u-plain'], previewUnitIds: [], revision: 1 },
    });
    const plain = resolveAgentPanel(stateNoCharacter);
    expect(plain.detail?.characterId).toBeNull();
    expect(plain.detail?.taskQueue).toEqual({ summary: null, waiting: 0, items: [] });
  });
});

// ============================================================================
// 队列完整列表 + 取消/重派命令（@since v3.23，task_047）
// ============================================================================

describe('队列完整列表：items 投影（在办在前，终态最近三条倒序）', () => {
  const task = (id: string, status: CharacterTask['status'], prompt: string, createdAt = 1): CharacterTask => ({
    id,
    characterId: 'c-neo',
    prompt,
    status,
    createdAt,
    startedAt: null,
    endedAt: null,
    output: '',
  });

  test('在办全显（FIFO 序）+ 终态最近三条倒序；徽标与按钮条件挂在条目上', () => {
    const queue = resolveCharacterTaskQueue(
      [
        task('t0', 'completed', '被挤出的最老历史', 0),
        task('t1', 'completed', '很老的完成', 1),
        task('t2', 'failed', '要重派的失败', 2),
        task('t3', 'cancelled', '刚取消的', 3),
        task('t4', 'queued', '排队的任务', 4),
        task('t5', 'running', '正在跑的', 5),
      ],
      'c-neo'
    );

    expect(queue.items.map((i) => i.id)).toEqual(['t4', 't5', 't3', 't2', 't1']);
    // 在办在前保持 FIFO（数组序），终态取最近三条（t0 被挤出）、新的在前
    const byId = Object.fromEntries(queue.items.map((i) => [i.id, i]));
    expect(byId.t4).toMatchObject({ canCancel: true, canReassign: false, statusLabel: '排队中' });
    expect(byId.t5).toMatchObject({ canCancel: false, canReassign: false, statusLabel: '执行中' }); // running 不可取消
    expect(byId.t3).toMatchObject({ canCancel: false, canReassign: false, statusLabel: '已取消' });
    expect(byId.t2).toMatchObject({ canCancel: false, canReassign: true, statusLabel: '已失败' }); // failed 有重派
    expect(byId.t0).toBeUndefined(); // 超出三条窗口的老历史不进列表
  });

  test('重派载荷是 prompt 全文不是摘要（截断后的文字不该成为新任务的指令）', () => {
    const long = '长'.repeat(60);
    const queue = resolveCharacterTaskQueue([task('t1', 'failed', long)], 'c-neo');
    const item = queue.items.find((i) => i.id === 't1');
    expect(item?.summary.length).toBe(41); // 渲染用截断
    expect(item?.prompt).toBe(long); // 载荷用全文
  });
});

describe('buildTaskCancelCommand（task_047）', () => {
  test('有 taskId → task.cancel 命令；空值 → null（渲染兑底不发空命令）', () => {
    expect(buildTaskCancelCommand('task_1')).toEqual({ type: 'task.cancel', taskId: 'task_1' });
    expect(buildTaskCancelCommand('')).toBeNull();
    expect(buildTaskCancelCommand(null)).toBeNull();
    expect(buildTaskCancelCommand(undefined)).toBeNull();
  });
});

describe('渲染签名：任务队列变化也算变化（否则队列读了旧数）', () => {
  test('选中单位的任务离队 / 排队数变化 → 签名变；别人任务变化 → 签名不变', () => {
    const makeTaskState = (
      tasks: readonly { id: string; status: CharacterTask['status']; characterId?: string }[]
    ): WorldState =>
      makeState({
        units: [unit({ id: 'u-neo', name: 'Neo', characterId: 'c-neo' })],
        selection: { unitIds: ['u-neo'], previewUnitIds: [], revision: 1 },
        tasks: tasks.map(({ id, status, characterId }, i) => ({
          id,
          characterId: characterId ?? 'c-neo',
          prompt: `任务${id}`,
          status,
          createdAt: i,
          startedAt: null,
          endedAt: null,
          output: '',
        })),
      });

    // 收尾离队：队列从有读数变空闲
    expect(agentPanelSignature(makeTaskState([{ id: 't1', status: 'queued' }]))).not.toBe(
      agentPanelSignature(makeTaskState([{ id: 't1', status: 'completed' }]))
    );
    // 排队数变化：+1 条 queued → waiting 0→1
    expect(
      agentPanelSignature(makeTaskState([{ id: 't1', status: 'queued' }]))
    ).not.toBe(
      agentPanelSignature(makeTaskState([{ id: 't1', status: 'queued' }, { id: 't2', status: 'queued' }]))
    );
    // 别人的任务（同状态同指令）不进签名
    expect(agentPanelSignature(makeTaskState([{ id: 't1', status: 'queued' }]))).toBe(
      agentPanelSignature(
        makeTaskState([
          { id: 't1', status: 'queued' },
          { id: 't9', status: 'queued', characterId: 'c-trinity' },
        ])
      )
    );
  });
});
