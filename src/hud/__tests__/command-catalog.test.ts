/**
 * 单测：命令面板的命令目录与命令构造（hud/panels/command-catalog.ts）。
 * 覆盖：WorldState 驱动的可用性判定、命令 → HudCommand 的构造、禁用即不构造、
 *   搜索过滤、渲染签名（perf 判重）。
 * 依赖：纯函数，零 DOM、零总线 —— 在 node 环境直接跑，不碰 core/bus 单例。
 */

import type { MissionView, UnitView, WorldState } from '../../core/types';
import type { CommandContext, CommandScope } from '../panels/command-catalog';
import {
  buildCommand,
  COMMAND_CATALOG,
  describeSelection,
  filterCommands,
  findCommandSpec,
  groupByScope,
  renderSignature,
  resolveCommands,
} from '../panels/command-catalog';

const UNITS: UnitView[] = [
  { id: 'u-neo', name: 'Neo', status: 'idle', missionId: null, power: 3 },
  { id: 'u-trinity', name: 'Trinity', status: 'busy', missionId: 'm-1', power: 5 },
];

function mission(partial: Partial<MissionView> & Pick<MissionView, 'id'>): MissionView {
  return {
    title: partial.id,
    phase: 'pending',
    unitIds: [],
    createdAt: 0,
    ...partial,
  };
}

function makeState(partial: Partial<WorldState> = {}): WorldState {
  return {
    units: UNITS,
    missions: [],
    selection: { unitIds: [], previewUnitIds: [], revision: 0 },
    characters: [],
    notices: [],
    links: [],
    messages: [],
    ...partial,
  };
}

const ctx = (state: WorldState | null, draftTitle = ''): CommandContext => ({ state, draftTitle });

const selected = (...ids: string[]): WorldState =>
  makeState({ selection: { unitIds: ids, previewUnitIds: [], revision: ids.length } });

/** 找一条命令，断言其存在（拿不到直接失败，比 optional chaining 静默返回 undefined 更容易定位）。 */
function commandOf(id: string, commands: ReturnType<typeof resolveCommands>) {
  const found = commands.find((c) => c.spec.id === id);
  if (!found) throw new Error(`目录里没有 ${id}`);
  return found;
}

describe('目录结构', () => {
  test('每个命令 id 都落在确定的 scope 上，没有孤儿项', () => {
    expect(COMMAND_CATALOG.length).toBeGreaterThan(0);
    COMMAND_CATALOG.forEach((spec) => {
      expect(spec.label.length).toBeGreaterThan(0);
      expect(['selection', 'global']).toContain(spec.scope);
    });
  });

  test('findCommandSpec 能按 id + scope 精确定位', () => {
    expect(findCommandSpec('mission.create', 'selection')?.label).toBe('发起任务');
    expect(findCommandSpec('mission.create', 'global')?.label).toBe('新建任务');
    expect(findCommandSpec('settings.open', 'selection')).toBeUndefined();
  });
});

describe('WorldState 驱动的可用性', () => {
  test('未选中单位：只有全局命令，选中组整体缺席', () => {
    const { selection, global } = groupByScope(resolveCommands(ctx(makeState())));
    expect(selection).toHaveLength(0);
    expect(global.length).toBeGreaterThan(0);
    expect(global.map((c) => c.spec.id)).toContain('settings.open');
  });

  test('选中单位：选中组出现，且带上真实单位名做副标题', () => {
    const commands = resolveCommands(ctx(selected('u-neo'), '写周报'));
    const { selection } = groupByScope(commands);
    expect(selection.length).toBeGreaterThan(0);

    const create = commandOf('mission.create', selection);
    expect(create.spec.scope).toBe('selection');
    expect(create.enabled).toBe(true);
    expect(create.hint).toContain('写周报');
    expect(create.hint).toContain('指派给 1 个单位');
  });

  test('发起任务没有标题时禁用 —— 空标题的任务 core 侧也无从拒绝', () => {
    const commands = resolveCommands(ctx(selected('u-neo'), '   '));
    expect(commandOf('mission.create', commands).enabled).toBe(false);
    expect(commandOf('mission.create', commands).reason).toBe('请先填写任务标题');
  });

  test('没有待确认 / 在办任务时，对应命令禁用', () => {
    const commands = resolveCommands(ctx(selected('u-neo')));
    expect(commandOf('mission.confirm', commands).enabled).toBe(false);
    expect(commandOf('mission.cancel', commands).enabled).toBe(false);
  });

  test('有 pending 任务指向选择集时，确认可用', () => {
    const state = selected('u-neo');
    state.missions.push(mission({ id: 'm-9', title: '重构总线', phase: 'pending', unitIds: ['u-neo'] }));
    const confirm = commandOf('mission.confirm', resolveCommands(ctx(state)));
    expect(confirm.enabled).toBe(true);
    expect(confirm.hint).toBe('重构总线');
  });

  test('正在 running 的任务让「停止任务」可用并显示相位', () => {
    const state = selected('u-neo');
    state.missions.push(mission({ id: 'm-1', title: '联调', phase: 'running', unitIds: ['u-neo'] }));
    const cancel = commandOf('mission.cancel', resolveCommands(ctx(state)));
    expect(cancel.enabled).toBe(true);
    expect(cancel.hint).toBe('联调 · running');
  });

  test('任务指向别的单位时不作用于当前选择集（不误伤）', () => {
    const state = selected('u-neo');
    state.missions.push(mission({ id: 'm-x', title: '别人的活', phase: 'pending', unitIds: ['u-trinity'] }));
    const commands = resolveCommands(ctx(state));
    expect(commandOf('mission.confirm', commands).enabled).toBe(false);
    expect(commandOf('mission.cancel', commands).enabled).toBe(false);
  });
});

describe('命令构造：点到的哪一条 == 构造出的哪一条', () => {
  test('selection 组的发起任务带上当前选择集作为指派对象', () => {
    const spec = findCommandSpec('mission.create', 'selection')!;
    const command = buildCommand(spec, ctx(selected('u-neo', 'u-trinity'), '  重构总线  '));
    expect(command).toEqual({
      type: 'mission.create',
      title: '重构总线', // 两侧空白被裁掉
      unitIds: ['u-neo', 'u-trinity'],
    });
  });

  test('global 组的同一 id 构造出的是待指派草稿（不带选择集）', () => {
    const spec = findCommandSpec('mission.create', 'global')!;
    // 即使当前有选择集，global 入口也只立草稿 —— 入参由点击的 scope 决定，不由状态反推
    const command = buildCommand(spec, ctx(selected('u-neo'), '重构总线'));
    expect(command).toEqual({ type: 'mission.create', title: '重构总线', unitIds: [] });
  });

  test('禁用态一律构造不出命令（不发半截命令给 core）', () => {
    const create = findCommandSpec('mission.create', 'selection')!;
    expect(buildCommand(create, ctx(selected('u-neo'), ''))).toBeNull();

    const confirm = findCommandSpec('mission.confirm', 'selection')!;
    expect(buildCommand(confirm, ctx(selected('u-neo')))).toBeNull();

    const cancel = findCommandSpec('mission.cancel', 'selection')!;
    expect(buildCommand(cancel, ctx(selected('u-neo')))).toBeNull();
  });

  test('确认任务取到 pending 任务的 id 与 accept 决定', () => {
    const state = selected('u-neo');
    state.missions.push(mission({ id: 'm-7', title: '接线', phase: 'pending', unitIds: ['u-neo'] }));
    const command = buildCommand(findCommandSpec('mission.confirm', 'selection')!, ctx(state));
    expect(command).toEqual({ type: 'mission.confirm', missionId: 'm-7', decision: 'accept' });
  });

  test('多个任务时取最近创建的那条（列表倒序，不靠插入顺序）', () => {
    const state = selected('u-neo');
    state.missions.push(
      mission({ id: 'old', title: '旧的', phase: 'running', unitIds: ['u-neo'], createdAt: 1 }),
      mission({ id: 'new', title: '新的', phase: 'pending', unitIds: ['u-neo'], createdAt: 2 })
    );
    const command = buildCommand(findCommandSpec('mission.confirm', 'selection')!, ctx(state));
    expect(command).toEqual({ type: 'mission.confirm', missionId: 'new', decision: 'accept' });
    const cancel = buildCommand(findCommandSpec('mission.cancel', 'selection')!, ctx(state));
    expect(cancel).toEqual({ type: 'mission.cancel', missionId: 'new' });
  });

  test('停止任务取的是在办任务，不是已结束的任务', () => {
    const state = selected('u-neo');
    state.missions.push(
      mission({ id: 'done', title: '已完', phase: 'done', unitIds: ['u-neo'], createdAt: 9 }),
      mission({ id: 'live', title: '在办', phase: 'running', unitIds: ['u-neo'], createdAt: 1 })
    );
    const command = buildCommand(findCommandSpec('mission.cancel', 'selection')!, ctx(state));
    expect(command).toEqual({ type: 'mission.cancel', missionId: 'live' });
  });

  test('导航 / 取消选择 / 皮肤命令构造出既有契约变体', () => {
    const state = selected('u-neo');
    const specOf = (id: Parameters<typeof findCommandSpec>[0], scope: CommandScope = 'global') =>
      findCommandSpec(id, scope)!;

    expect(buildCommand(specOf('chat.open'), ctx(state))).toEqual({ type: 'ui.navigate', screen: 'chat' });
    expect(buildCommand(specOf('character.open'), ctx(state))).toEqual({ type: 'ui.navigate', screen: 'character' });
    expect(buildCommand(specOf('settings.open'), ctx(state))).toEqual({ type: 'ui.navigate', screen: 'settings' });
    expect(buildCommand(specOf('theme.pixel'), ctx(state))).toEqual({ type: 'theme.set', themeId: 'pixel' });
    expect(buildCommand(specOf('theme.default'), ctx(state))).toEqual({ type: 'theme.set', themeId: 'default' });
    expect(buildCommand(specOf('selection.clear', 'selection'), ctx(state))).toEqual({
      type: 'unit.select',
      unitIds: [],
      mode: 'set',
    });
  });

  test('还没收到任何广播时，全局命令照样构造得出（不发 null 就瘫）', () => {
    const command = buildCommand(findCommandSpec('settings.open', 'global')!, ctx(null));
    expect(command).toEqual({ type: 'ui.navigate', screen: 'settings' });
  });
});

describe('搜索过滤', () => {
  test('空查询词原样返回全部', () => {
    const commands = resolveCommands(ctx(makeState()));
    expect(filterCommands(commands, '  ')).toHaveLength(commands.length);
  });

  test('子序列模糊匹配容忍缩写', () => {
    const commands = filterCommands(resolveCommands(ctx(makeState())), 'sett');
    expect(commands.map((c) => c.spec.id)).toContain('settings.open');
  });

  test('中文按子串命中', () => {
    const commands = filterCommands(resolveCommands(ctx(selected('u-neo'))), '聊天');
    expect(commands.map((c) => c.spec.id)).toEqual(expect.arrayContaining(['chat.open']));
  });

  test('搜不到时返回空列表（面板据此显示空态）', () => {
    expect(filterCommands(resolveCommands(ctx(makeState())), 'zzzz不存在')).toHaveLength(0);
  });
});

describe('渲染签名（perf：广播频繁时只重画真正变了的那次）', () => {
  const state = selected('u-neo');

  test('同一份 state 签名稳定，可据此跳过重渲染', () => {
    expect(renderSignature(state, '', '')).toBe(renderSignature(makeState({ ...state }), '', ''));
  });

  test('选择集 revision 变化 → 签名变化', () => {
    const a = renderSignature(selected('u-neo'), '', '');
    const b = renderSignature(selected('u-neo', 'u-trinity'), '', '');
    expect(a).not.toBe(b);
  });

  test('任务相位变化 → 签名变化（确认/停止的可用性会跟着变）', () => {
    const base = selected('u-neo');
    const before = renderSignature(base, '', '');
    const after = renderSignature(
      { ...base, missions: [mission({ id: 'm-1', phase: 'running', unitIds: ['u-neo'] })] },
      '',
      ''
    );
    expect(before).not.toBe(after);
  });

  test('通知变化 → 签名变化（面板顶部要跟着换）', () => {
    const base = selected('u-neo');
    const before = renderSignature(base, '', '');
    const after = renderSignature(
      {
        ...base,
        notices: [
          {
            id: 'n-1',
            level: 'warn',
            text: '代理掉线',
            createdAt: 0,
            expiresAt: 9999999999999,
          },
        ],
      },
      '',
      ''
    );
    expect(before).not.toBe(after);
  });

  test('标题草稿与搜索词各自变化 → 签名变化（否则输入框敲字不重画）', () => {
    const a = renderSignature(state, '', '');
    expect(renderSignature(state, '新标题', '')).not.toBe(a);
    expect(renderSignature(state, '', '主题')).not.toBe(a);
  });
});

describe('选择集描述', () => {
  test('无选中 / 有选中分别给出对应文案', () => {
    expect(describeSelection(makeState())).toBe('未选中单位');
    expect(describeSelection(selected('u-neo'))).toBe('已选中 Neo');
  });

  test('未知 id 回落到 id 本身，不渲染空白', () => {
    expect(describeSelection(selected('u-ghost'))).toBe('已选中 u-ghost');
  });

  test('多选超过 4 个时截断展示并给总数（DOM 长度有界）', () => {
    const ids = ['u-a', 'u-b', 'u-c', 'u-d', 'u-e', 'u-f'];
    const described = describeSelection(selected(...ids));
    expect(described).toContain('等 6 个');
  });
});