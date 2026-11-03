/**
 * 单测：任务状态机（core/mission/machine.ts）+ store 投影（core/mission/manager.ts）+ 命令闭环。
 *
 * 分三段：
 *   1. machine —— 纯函数，把**全路径**穷举一遍（含每条非法迁移与"实质未变"）；
 *   2. manager —— 真 store，验证投影、上限、对账、Notice 与非法操作不改状态；
 *   3. 闭环 —— 真 core/bus + 真 createCoreRuntime：HudCommand → 状态机 → WorldState 广播。
 *
 * 隔离靠 resetBus() 与每个用例新建的 createStore()；不 mock 总线 —— runtime 的职责就是接在总线上。
 */

import { emitCommand, onState, resetBus, type Unsubscribe } from '../bus';
import { createMissionManager, reconcileAssignedUnits, syncUnitMissions } from '../mission';
import { applyMissionAction, createMission, dropSettledMissions, isTerminalPhase, type MissionAction } from '../mission/machine';
import { createCoreRuntime } from '../runtime';
import { createStore, type CoreStore } from '../store';
import type { MissionPhase, MissionView, UnitView, WorldState } from '../types';

// ============================================================================
// 1. 状态机（纯函数）
// ============================================================================

const MISSION: MissionView = {
  id: 'm-1',
  title: '侦察北门',
  unitIds: ['u1', 'u2'],
  createdAt: 1000,
  phase: 'pending',
};

/** 在给定相位上造一条任务。 */
function missionAt(phase: MissionPhase, patch: Partial<MissionView> = {}): MissionView {
  return { ...MISSION, phase, ...patch };
}

function apply(current: MissionView, action: MissionAction) {
  return applyMissionAction(current, action);
}

describe('createMission：新建即定相位', () => {
  test('指派名单非空 → pending（待确认）', () => {
    expect(createMission({ id: 'm', title: '侦察北门', unitIds: ['u1', 'u2'], createdAt: 1 })).toEqual({
      id: 'm',
      title: '侦察北门',
      unitIds: ['u1', 'u2'],
      createdAt: 1,
      phase: 'pending',
    });
  });

  test('指派名单为空 → draft（待指派）', () => {
    expect(createMission({ id: 'm', title: '待办', unitIds: [], createdAt: 1 }).phase).toBe('draft');
  });

  test('名单去重并截断到 MAX_SELECTION_SIZE（超大编组不许进状态）', () => {
    const huge = Array.from({ length: 400 }, (_, i) => `u${i}`);
    const withDupes = ['u1', 'u1', 'u2', ...huge];
    const view = createMission({ id: 'm', title: '全员出动', unitIds: withDupes, createdAt: 1 });
    expect(view.unitIds[0]).toBe('u1');
    expect(new Set(view.unitIds).size).toBe(view.unitIds.length);
    expect(view.unitIds.length).toBe(256);
  });
});

describe('状态机主路径：draft → pending → confirmed → running → done', () => {
  test('draft + assign(非空) → pending', () => {
    const next = apply(missionAt('draft'), { type: 'assign', unitIds: ['u7'] });
    expect(next.changed).toBe(true);
    expect(next.next).toEqual(missionAt('pending', { unitIds: ['u7'] }));
  });

  test('pending + decide(accept) → confirmed', () => {
    expect(apply(MISSION, { type: 'decide', decision: 'accept' }).next.phase).toBe('confirmed');
  });

  test('confirmed + start → running', () => {
    expect(apply(missionAt('confirmed'), { type: 'start' }).next.phase).toBe('running');
  });

  test('running + complete → done（终态）', () => {
    const done = apply(missionAt('running'), { type: 'complete' }).next;
    expect(done.phase).toBe('done');
    expect(isTerminalPhase(done.phase)).toBe(true);
  });

  test('一条 happy path 串起来：draft → pending → confirmed → running → done', () => {
    const actions: MissionAction[] = [
      { type: 'assign', unitIds: ['u1', 'u2'] },
      { type: 'decide', decision: 'accept' },
      { type: 'start' },
      { type: 'complete' },
    ];
    const phases: MissionPhase[] = [];
    let current = missionAt('draft');
    for (const action of actions) {
      const step = applyMissionAction(current, action);
      expect(step.error).toBeUndefined();
      current = step.next;
      phases.push(current.phase);
    }
    expect(phases).toEqual(['pending', 'confirmed', 'running', 'done']);
  });
});

describe('状态机旁路：拒单 / 改人 / 收回指派 / 叫停', () => {
  test('pending + decide(reject) → cancelled（契约里没有 rejected，拒绝即作废）', () => {
    const rejected = apply(MISSION, { type: 'decide', decision: 'reject' }).next;
    expect(rejected.phase).toBe('cancelled');
    expect(isTerminalPhase(rejected.phase)).toBe(true);
  });

  test('pending + assign(另一批人) → 仍是 pending（改指派对象，改完重新待确认）', () => {
    const next = apply(MISSION, { type: 'assign', unitIds: ['u3'] });
    expect(next.next).toEqual(missionAt('pending', { unitIds: ['u3'] }));
  });

  test('pending + assign(空) → 退回 draft（收回指派）', () => {
    expect(apply(MISSION, { type: 'assign', unitIds: [] }).next.phase).toBe('draft');
  });

  test('任何非终态都能 cancel：draft / pending / confirmed / running', () => {
    for (const phase of ['draft', 'pending', 'confirmed', 'running'] as const) {
      const step = apply(missionAt(phase), { type: 'cancel' });
      expect(step.changed).toBe(true);
      expect(step.next.phase).toBe('cancelled');
    }
  });
});

describe('状态机非法迁移：原样返回 + 机器可读原因', () => {
  test('decide 只能从 pending 出发', () => {
    for (const phase of ['draft', 'confirmed', 'running', 'done', 'cancelled'] as const) {
      const step = apply(missionAt(phase), { type: 'decide', decision: 'accept' });
      expect(step).toEqual({ next: missionAt(phase), changed: false, error: 'illegal-transition' });
    }
  });

  test('start 只能从 confirmed 出发（重复开工是最容易出的错，必须挡住）', () => {
    for (const phase of ['draft', 'pending', 'running', 'done', 'cancelled'] as const) {
      expect(apply(missionAt(phase), { type: 'start' }).error).toBe('illegal-transition');
    }
  });

  test('complete 只能从 running 出发', () => {
    for (const phase of ['draft', 'pending', 'confirmed', 'done', 'cancelled'] as const) {
      expect(apply(missionAt(phase), { type: 'complete' }).error).toBe('illegal-transition');
    }
  });

  test('assign 只能在 draft / pending（已开工后换人等于把活悄悄转走）', () => {
    for (const phase of ['confirmed', 'running', 'done', 'cancelled'] as const) {
      expect(apply(missionAt(phase), { type: 'assign', unitIds: ['u9'] }).error).toBe('illegal-transition');
    }
  });

  test('终态不可再动：重复 complete / cancel 都不改写历史', () => {
    for (const phase of ['done', 'cancelled'] as const) {
      for (const action of [
        { type: 'complete' } as const,
        { type: 'cancel' } as const,
        { type: 'start' } as const,
      ]) {
        const step = apply(missionAt(phase), action);
        expect(step.changed).toBe(false);
        expect(step.error).toBe('illegal-transition');
      }
    }
  });

  test('非法迁移不抛异常（命令总线是同步的，抛异常会打断整轮广播）', () => {
    expect(() => apply(MISSION, { type: 'start' })).not.toThrow();
  });
});

describe('状态机"实质未变"：不制造无谓广播', () => {
  test('pending 指派同一批人（顺序不同也算同一批）→ changed=false 且返回原引用', () => {
    const step = apply(MISSION, { type: 'assign', unitIds: ['u2', 'u1', 'u1'] });
    expect(step).toEqual({ next: MISSION, changed: false });
    expect(step.next).toBe(MISSION);
  });

  test('draft 上反复指派空名单 → changed=false', () => {
    const draft = missionAt('draft', { unitIds: [] });
    expect(apply(draft, { type: 'assign', unitIds: [] }).changed).toBe(false);
  });
});

describe('dropSettledMissions：腾位置时只丢终态历史', () => {
  const rows = (phase: MissionPhase, i: number): MissionView => ({
    id: `m${i}`,
    title: `t${i}`,
    unitIds: [],
    createdAt: i,
    phase,
  });

  test('位置够用时原样返回', () => {
    const list = [rows('running', 0)];
    expect(dropSettledMissions(list, 3)).toEqual(list);
  });

  test('优先丢终态（done / cancelled），保留在办任务', () => {
    const list = [rows('done', 0), rows('running', 1), rows('cancelled', 2), rows('running', 3)];
    expect(dropSettledMissions(list, 2).map((m) => m.id)).toEqual(['m1', 'm3']);
  });

  test('全是在办任务时一条都不丢（调用方据此拒绝新建，而不是静默挤掉某条）', () => {
    const list = [rows('running', 0), rows('pending', 1), rows('running', 2)];
    expect(dropSettledMissions(list, 2).map((m) => m.id)).toEqual(['m0', 'm1', 'm2']);
  });
});

// ============================================================================
// 2. manager：store 投影
// ============================================================================

const UNITS: UnitView[] = [
  { id: 'u1', name: 'Neo', status: 'idle', missionId: null, power: 3 },
  { id: 'u2', name: 'Trinity', status: 'idle', missionId: null, power: 5 },
  { id: 'u3', name: 'Morpheus', status: 'idle', missionId: null, power: 4 },
];

function setup(options: { maxMissions?: number; units?: UnitView[] } = {}) {
  const store = createStore({ units: options.units ?? UNITS });
  // id 按前缀各自计数：通知与任务各走一条序列，断言里的 mission-1 才是稳定的。
  // now 用真实时钟：通知的过期剔除走 store 自己的 Date.now()，注入假时钟会让通知一落地就被剔掉。
  const seq = { mission: 0, notice: 0 };
  const manager = createMissionManager({
    store,
    maxMissions: options.maxMissions,
    createId: (prefix) => `${prefix}-${++seq[prefix as 'mission' | 'notice']}`,
  });
  return { store, manager };
}

describe('manager：命令 → 状态机 → store', () => {
  test('createMission 写入 missions，并给被指派单位挂上 missionId', () => {
    const { store, manager } = setup();
    const mission = manager.createMission({ title: '  侦察北门 ', unitIds: ['u1', 'u2'] });

    expect(mission?.phase).toBe('pending');
    expect(mission?.title).toBe('侦察北门');
    expect(store.getState().missions).toEqual([mission]);
    expect(store.getState().units.map((u) => u.missionId)).toEqual(['mission-1', 'mission-1', null]);
  });

  test('空标题被拒：不写库，回一条 warn 通知', () => {
    const { store, manager } = setup();
    expect(manager.createMission({ title: '   ', unitIds: ['u1'] })).toBeNull();
    expect(store.getState().missions).toHaveLength(0);
    expect(store.getState().notices[0]).toMatchObject({ level: 'warn', text: '任务标题不能为空' });
  });

  test('decideMission(accept) 接单即开工：pending → running 一次写入', () => {
    const { store, manager } = setup();
    manager.createMission({ title: '侦察北门', unitIds: ['u1'] });
    const mission = manager.decideMission('mission-1', 'accept');

    expect(mission?.phase).toBe('running');
    expect(store.getState().missions[0].phase).toBe('running');
    // 终端相位之外，单位的占用仍然挂着（活儿还在干）
    expect(store.getState().units[0].missionId).toBe('mission-1');
  });

  test('decideMission(reject) 作废任务并释放单位占用', () => {
    const { store, manager } = setup();
    manager.createMission({ title: '侦察北门', unitIds: ['u1', 'u2'] });
    expect(manager.decideMission('mission-1', 'reject')?.phase).toBe('cancelled');
    expect(store.getState().units.map((u) => u.missionId)).toEqual([null, null, null]);
  });

  test('重复确认被判非法：不改任务状态，回 warn 通知', () => {
    const { store, manager } = setup();
    manager.createMission({ title: '侦察北门', unitIds: ['u1'] });
    manager.decideMission('mission-1', 'accept');

    const before = store.getState().missions;
    const refs: (readonly MissionView[])[] = [];
    const off = store.subscribe((state) => refs.push(state.missions));
    expect(manager.decideMission('mission-1', 'accept')).toBeNull();
    off();

    expect(store.getState().missions[0].phase).toBe('running');
    // 任务数组一次都没换引用 → 面板不会因这次无效操作重渲染（只有那条 warn 通知广播了一次）
    expect(refs.every((ref) => ref === before)).toBe(true);
    expect(store.getState().notices.some((n) => n.text.includes('不可执行'))).toBe(true);
  });

  test('assignMission 改指派对象；空名单 = 收回指派退回 draft', () => {
    const { store, manager } = setup();
    manager.createMission({ title: '侦察北门', unitIds: ['u1'] });
    manager.assignMission('mission-1', ['u3']);
    expect(store.getState().missions[0]).toMatchObject({ phase: 'pending', unitIds: ['u3'] });
    expect(store.getState().units.map((u) => u.missionId)).toEqual([null, null, 'mission-1']);

    manager.assignMission('mission-1', []);
    expect(store.getState().missions[0].phase).toBe('draft');
    expect(store.getState().units.map((u) => u.missionId)).toEqual([null, null, null]);
  });

  test('已开工的任务不能改指派（非法迁移不写库）', () => {
    const { store, manager } = setup();
    manager.createMission({ title: '侦察北门', unitIds: ['u1'] });
    manager.decideMission('mission-1', 'accept');

    expect(manager.assignMission('mission-1', ['u2'])).toBeNull();
    expect(store.getState().missions[0].unitIds).toEqual(['u1']);
  });

  test('未知单位被对账丢弃，并给出提示（悬空 id 不许留在任务上）', () => {
    const { store, manager } = setup();
    const mission = manager.createMission({ title: '侦察北门', unitIds: ['u1', 'ghost'] });
    expect(mission?.unitIds).toEqual(['u1']);
    expect(store.getState().notices.some((n) => n.text.includes('1 个不存在的单位'))).toBe(true);
  });

  test('completeMission 走回报路径：running → done 并释放单位占用', () => {
    const { store, manager } = setup();
    manager.createMission({ title: '侦察北门', unitIds: ['u1'] });
    manager.decideMission('mission-1', 'accept');
    expect(store.getState().missions[0].phase).toBe('running');

    expect(manager.completeMission('mission-1')?.phase).toBe('done');
    expect(store.getState().units[0].missionId).toBeNull();
    // 收尾后不能再操作：重复完成被判非法
    expect(manager.completeMission('mission-1')).toBeNull();
  });

  test('cancelMission 释放占用；终态不能再取消', () => {
    const { store, manager } = setup();
    manager.createMission({ title: '侦察北门', unitIds: ['u1'] });
    expect(manager.cancelMission('mission-1')?.phase).toBe('cancelled');
    expect(store.getState().units[0].missionId).toBeNull();
    expect(manager.cancelMission('mission-1')).toBeNull();
  });

  test('removeMission 撤掉一条没开工的任务：任务消失，单位占用释放（@since v3.6 task_120）', () => {
    const { store, manager } = setup();
    manager.createMission({ title: '探针任务', unitIds: ['u1'] });
    expect(store.getState().missions[0].phase).toBe('pending');
    expect(store.getState().units[0].missionId).toBe('mission-1');

    const removed = manager.removeMission('mission-1');

    expect(removed?.id).toBe('mission-1');
    // 撤掉 = 从状态里消失（不留终态墓碑）
    expect(store.getState().missions).toHaveLength(0);
    // 占用的单位一并释放（否则 WorldState 内部自相矛盾）
    expect(store.getState().units.map((u) => u.missionId)).toEqual([null, null, null]);
  });

  test('removeMission 只认没开工的任务：在跑的撤不掉（撤任务不等于撤活儿）', () => {
    const { store, manager } = setup();
    manager.createMission({ title: '侦察北门', unitIds: ['u1'] });
    manager.decideMission('mission-1', 'accept');

    expect(manager.removeMission('mission-1')).toBeNull();
    expect(store.getState().missions[0].phase).toBe('running');
    expect(store.getState().units[0].missionId).toBe('mission-1');
    expect(store.getState().notices.some((n) => n.text.includes('不能撤掉'))).toBe(true);
  });

  test('removeMission 对终态任务拒绝（历史不改写）', () => {
    const { store, manager } = setup();
    manager.createMission({ title: '侦察北门', unitIds: ['u1'] });
    manager.cancelMission('mission-1');

    expect(manager.removeMission('mission-1')).toBeNull();
    expect(store.getState().missions[0].phase).toBe('cancelled');
  });

  test('未知 missionId → not-found：不写库，回 warn 通知', () => {
    const { store, manager } = setup();
    expect(manager.assignMission('nope', ['u1'])).toBeNull();
    expect(store.getState().missions).toHaveLength(0);
    expect(store.getState().notices[0]).toMatchObject({ level: 'warn', text: '任务不存在' });
  });

  test('达到上限后拒绝新建（不静默挤掉在办任务），并回 warn 通知', () => {
    const { store, manager } = setup({ maxMissions: 2 });
    manager.createMission({ title: 'a', unitIds: ['u1'] });
    manager.createMission({ title: 'b', unitIds: ['u2'] });

    expect(manager.createMission({ title: 'c', unitIds: ['u3'] })).toBeNull();
    expect(store.getState().missions).toHaveLength(2);
    expect(store.getState().notices.some((n) => n.text.includes('上限'))).toBe(true);
  });

  test('超上限新建时先丢终态历史腾位置（在办任务一条都不能少）', () => {
    const { store, manager } = setup({ maxMissions: 2 });
    manager.createMission({ title: 'a', unitIds: ['u1'] });
    manager.createMission({ title: 'b', unitIds: ['u2'] });
    manager.cancelMission('mission-1'); // 'a' 进终态

    expect(manager.createMission({ title: 'c', unitIds: ['u3'] })?.id).toBe('mission-3');
    expect(store.getState().missions.map((m) => m.title)).toEqual(['b', 'c']);
  });

  test('一次命令只写一次 missions（广播有成本：状态变更不能刷两遍）', () => {
    const { store, manager } = setup();
    manager.createMission({ title: '侦察北门', unitIds: ['u1'] });

    const before = store.getState().missions;
    const refs: (readonly MissionView[])[] = [];
    const off = store.subscribe((state) => refs.push(state.missions));
    manager.decideMission('mission-1', 'accept');
    off();

    // 任务数组只换过一次引用；随后 pushNotice 那次广播带的是同一个引用，不算第二次写入
    expect(Array.from(new Set(refs)).filter((ref) => ref !== before)).toHaveLength(1);
  });
});

describe('纯投影工具', () => {
  test('reconcileAssignedUnits：去重 + 未知丢弃 + 上限截断', () => {
    expect(reconcileAssignedUnits(['u1', 'u1', 'ghost', '', 'u2'], ['u1', 'u2'])).toEqual(['u1', 'u2']);
    const huge = Array.from({ length: 300 }, (_, i) => `u${i}`);
    expect(reconcileAssignedUnits(huge, huge).length).toBe(256);
  });

  test('syncUnitMissions：非终态占用、终态释放、无变化返回原引用', () => {
    const mission: MissionView = { ...MISSION, phase: 'running' };
    const occupied = syncUnitMissions(UNITS, mission);
    expect(occupied.map((u) => u.missionId)).toEqual(['m-1', 'm-1', null]);
    // 已占用且名单没变 → 原引用（让 store 的引用判重对 units 也生效）
    expect(syncUnitMissions(occupied, mission)).toBe(occupied);
    expect(syncUnitMissions(occupied, { ...mission, phase: 'done' }).map((u) => u.missionId))
      .toEqual([null, null, null]);
  });
});

// ============================================================================
// 3. 闭环：HudCommand → 状态机 → WorldState 广播（真总线 + 真 runtime）
// ============================================================================

interface Loop {
  readonly store: CoreStore;
  readonly states: WorldState[];
  stop(): void;
}

function loop(units: UnitView[] = UNITS): Loop {
  resetBus();
  const store = createStore({ units });
  const states: WorldState[] = [];
  const offState: Unsubscribe = onState((state) => states.push(state));
  // 默认装配（不注入 mission）：这条路径本身要被验 —— 命令确实落到本运行时持有的状态里
  const runtime = createCoreRuntime({ store });
  const stop = runtime.start();
  return { store, states, stop: () => { stop(); offState(); resetBus(); } };
}

let cleanups: (() => void)[] = [];

beforeEach(() => {
  resetBus();
  cleanups = [];
});

afterEach(() => {
  cleanups.forEach((fn) => fn());
  cleanups = [];
  resetBus();
});

describe('闭环：mission.* 命令 → 状态机 → WorldState 广播', () => {
  test('mission.create → missions 更新并广播', () => {
    const { store, states, stop } = loop();
    cleanups.push(stop);

    emitCommand({ type: 'mission.create', title: '侦察北门', unitIds: ['u1', 'u2'] });

    expect(store.getState().missions[0]).toMatchObject({ title: '侦察北门', phase: 'pending' });
    const last = states[states.length - 1];
    expect(last.missions).toHaveLength(1);
    expect(last.units[0].missionId).toBe(last.missions[0].id);
  });

  test('mission.assign → 状态机 → WorldState.missions（确认前改人）', () => {
    const { store, states, stop } = loop();
    cleanups.push(stop);

    emitCommand({ type: 'mission.create', title: '待指派', unitIds: [] });
    const missionId = store.getState().missions[0].id;
    expect(store.getState().missions[0].phase).toBe('draft');

    emitCommand({ type: 'mission.assign', missionId, unitIds: ['u3'] });

    expect(store.getState().missions[0]).toMatchObject({ phase: 'pending', unitIds: ['u3'] });
    expect(states[states.length - 1].missions[0].unitIds).toEqual(['u3']);
    expect(states[states.length - 1].units[2].missionId).toBe(missionId);
  });

  test('mission.confirm(accept) → 接单开工；mission.confirm(reject) → 作废并释放占用', () => {
    const { store, stop } = loop();
    cleanups.push(stop);

    emitCommand({ type: 'mission.create', title: '侦察北门', unitIds: ['u1'] });
    const first = store.getState().missions[0].id;
    emitCommand({ type: 'mission.confirm', missionId: first, decision: 'accept' });
    expect(store.getState().missions[0].phase).toBe('running');

    emitCommand({ type: 'mission.create', title: '加固城墙', unitIds: ['u2'] });
    const second = store.getState().missions[1].id;
    emitCommand({ type: 'mission.confirm', missionId: second, decision: 'reject' });

    expect(store.getState().missions[1].phase).toBe('cancelled');
    expect(store.getState().units.map((u) => u.missionId)).toEqual([first, null, null]);
  });

  test('mission.cancel 停掉在办任务', () => {
    const { store, stop } = loop();
    cleanups.push(stop);

    emitCommand({ type: 'mission.create', title: '侦察北门', unitIds: ['u1'] });
    const missionId = store.getState().missions[0].id;
    emitCommand({ type: 'mission.cancel', missionId });

    expect(store.getState().missions[0].phase).toBe('cancelled');
    expect(store.getState().units[0].missionId).toBeNull();
  });

  test('mission.* 不再走 onUnhandled（已经落地的命令不许被当成"没接上"）', () => {
    resetBus();
    const store = createStore({ units: UNITS });
    const unhandled: string[] = [];
    const offState: Unsubscribe = onState(() => {});
    const runtime = createCoreRuntime({
      store,
      onUnhandled: (_channel, payload) => unhandled.push(payload.type),
    });
    const stop = runtime.start();
    cleanups.push(() => { stop(); offState(); });

    emitCommand({ type: 'mission.create', title: '侦察北门', unitIds: ['u1'] });
    const missionId = store.getState().missions[0].id;
    emitCommand({ type: 'mission.confirm', missionId, decision: 'accept' });
    emitCommand({ type: 'mission.cancel', missionId });

    expect(unhandled).toEqual([]);
  });
});