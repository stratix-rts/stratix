/**
 * 单测：mission 域数据模型扩展（@since v3.38 / task_077）—— 结构化正文 + checkpoint 历史 + 依赖链。
 *
 * 分四段：
 *   1. 契约：新增字段全部**可选**（旧构造点零破坏）与 brief / dependsOn 的归一口径；
 *   2. machine：appendMissionCheckpoint（append / 终态拒绝 / 上限）与 isMissionUnlocked（边界）；
 *   3. manager：brief 透传、checkpoint 写库形状、**静默**（不发 Notice）；
 *   4. 闭环：HudCommand mission.create（带 brief/dependsOn）与 mission.checkpoint → WorldState。
 *
 * 隔离：每个用例新建 createStore() + resetBus()，不 mock 总线（runtime 的职责就是接在总线上）。
 */

import { emitCommand, onState, resetBus, type Unsubscribe } from '../bus';
import {
  appendMissionCheckpoint,
  createMission,
  createMissionManager,
  isMissionUnlocked,
  normalizeBrief,
  normalizeDependsOn,
} from '../mission';
import { createCoreRuntime } from '../runtime';
import { createStore, type CoreStore } from '../store';
import {
  MAX_MISSION_CHECKPOINTS,
  MAX_MISSION_DEPENDENCIES,
  type MissionView,
  type UnitView,
  type WorldState,
} from '../types';

// ============================================================================
// 1. 契约：新增字段全部可选（"编译即证"的那一半，这里补运行时形状）
// ============================================================================

describe('契约：新增字段都是可选的，旧构造点零破坏', () => {
  test('不带 brief / checkpoints / dependsOn 的 MissionView 字面量照旧成立', () => {
    // 这一行能编译，就证明"旧构造点零破坏"（新字段全是 ?，不是必填）。
    const legacy: MissionView = {
      id: 'm-legacy',
      title: '老任务',
      unitIds: ['u1'],
      createdAt: 1,
      phase: 'pending',
    };
    expect(legacy.brief).toBeUndefined();
    expect(legacy.checkpoints).toBeUndefined();
    expect(legacy.dependsOn).toBeUndefined();
  });

  test('createMission 不带新字段：产物里连这两个键都不出现（裸任务形状与过去一致）', () => {
    const mission = createMission({ id: 'm', title: '裸任务', unitIds: [], createdAt: 1 });
    expect(Object.keys(mission).sort()).toEqual(['createdAt', 'id', 'phase', 'title', 'unitIds']);
    expect('brief' in mission).toBe(false);
    expect('dependsOn' in mission).toBe(false);
  });

  test('normalizeBrief：逐段 trim，空段丢掉；全空 → undefined（不给状态塞空壳）', () => {
    expect(normalizeBrief({ requirements: '  侦察北门  ', acceptance: '   ' })).toEqual({
      requirements: '侦察北门',
    });
    expect(normalizeBrief({ acceptance: '  ' })).toBeUndefined();
    expect(normalizeBrief(undefined)).toBeUndefined();
    expect(normalizeBrief({ deliverables: '报告', constraints: '别动存档' })).toEqual({
      deliverables: '报告',
      constraints: '别动存档',
    });
  });

  test('normalizeDependsOn：去重 + 丢空 id + 丢自依赖 + 上限截断', () => {
    expect(normalizeDependsOn(['a', 'a', '', 'b'], 'self')).toEqual(['a', 'b']);
    // 自依赖是死结：创建时就丢掉，不留一条永远解不了锁的任务
    expect(normalizeDependsOn(['self', 'a'], 'self')).toEqual(['a']);
    expect(normalizeDependsOn([], 'self')).toBeUndefined();
    expect(normalizeDependsOn(undefined, 'self')).toBeUndefined();
    const huge = Array.from({ length: 100 }, (_, i) => `m${i}`);
    expect(normalizeDependsOn(huge, 'self')?.length).toBe(MAX_MISSION_DEPENDENCIES);
  });
});

// ============================================================================
// 2. machine：checkpoint 与依赖判定（纯函数）
// ============================================================================

const BASE: MissionView = {
  id: 'm-1',
  title: '侦察北门',
  unitIds: ['u1'],
  createdAt: 1000,
  phase: 'running',
};

function missionAt(phase: MissionView['phase'], patch: Partial<MissionView> = {}): MissionView {
  return { ...BASE, phase, ...patch };
}

describe('appendMissionCheckpoint：append-only 记账，终态拒绝', () => {
  test('任意非终态相位都能记（draft / pending / confirmed / running）', () => {
    for (const phase of ['draft', 'pending', 'confirmed', 'running'] as const) {
      const step = appendMissionCheckpoint(missionAt(phase), '派两人出门', 1234);
      expect(step.changed).toBe(true);
      expect(step.next.checkpoints).toEqual([{ at: 1234, note: '派两人出门' }]);
      expect(step.next.phase).toBe(phase); // 记账不改相位
    }
  });

  test('追加而非覆盖：历史按写入顺序累积', () => {
    const first = appendMissionCheckpoint(BASE, '一', 1).next;
    const second = appendMissionCheckpoint(first, '二', 2).next;
    const third = appendMissionCheckpoint(second, '三', 3).next;
    expect(third.checkpoints).toEqual([
      { at: 1, note: '一' },
      { at: 2, note: '二' },
      { at: 3, note: '三' },
    ]);
  });

  test('终态拒绝：done / cancelled 不改写历史', () => {
    for (const phase of ['done', 'cancelled'] as const) {
      const current = missionAt(phase);
      const step = appendMissionCheckpoint(current, '事后补记', 1);
      expect(step).toEqual({ next: current, changed: false, error: 'illegal-transition' });
      expect(step.next.checkpoints).toBeUndefined();
    }
  });

  test('超上限时丢最旧的（最近的才有排查价值，广播体积必须有界）', () => {
    let current = BASE;
    for (let i = 0; i < MAX_MISSION_CHECKPOINTS + 5; i += 1) {
      current = appendMissionCheckpoint(current, `n${i}`, i).next;
    }
    expect(current.checkpoints).toHaveLength(MAX_MISSION_CHECKPOINTS);
    expect(current.checkpoints?.[0].note).toBe('n5');
    expect(current.checkpoints?.[current.checkpoints.length - 1].note).toBe(
      `n${MAX_MISSION_CHECKPOINTS + 4}`,
    );
  });
});

describe('isMissionUnlocked：依赖判定（只判定，不调度）', () => {
  const done = missionAt('done', { id: 'dep-done' });
  const cancelled = missionAt('cancelled', { id: 'dep-cancelled' });
  const running = missionAt('running', { id: 'dep-running' });

  test('无依赖 → 已解锁', () => {
    expect(isMissionUnlocked(BASE, [])).toBe(true);
  });

  test('部分依赖已 done → 未解锁（还有在办的前置）', () => {
    const mission = missionAt('draft', { dependsOn: ['dep-done', 'dep-running'] });
    expect(isMissionUnlocked(mission, [done, running])).toBe(false);
  });

  test('依赖全部 done → 已解锁', () => {
    const a = missionAt('done', { id: 'a' });
    const b = missionAt('done', { id: 'b' });
    const mission = missionAt('draft', { dependsOn: ['a', 'b'] });
    expect(isMissionUnlocked(mission, [a, b])).toBe(true);
  });

  test('依赖被 cancelled 也算解锁（前置作废不该把整条链锁死）', () => {
    const mission = missionAt('draft', { dependsOn: ['dep-cancelled'] });
    expect(isMissionUnlocked(mission, [cancelled])).toBe(true);
  });

  test('自依赖 → 恒不解锁（死结）', () => {
    const mission = missionAt('draft', { id: 'self', dependsOn: ['self'] });
    expect(isMissionUnlocked(mission, [mission])).toBe(false);
  });

  test('依赖 id 查不到 → 视为已满足（历史被裁掉后不至于永久死锁）', () => {
    const mission = missionAt('draft', { dependsOn: ['gone'] });
    expect(isMissionUnlocked(mission, [])).toBe(true);
  });
});

// ============================================================================
// 3. manager：写库与静默
// ============================================================================

const UNITS: UnitView[] = [
  { id: 'u1', name: 'Neo', status: 'idle', missionId: null, power: 3 },
  { id: 'u2', name: 'Trinity', status: 'idle', missionId: null, power: 5 },
];

function setup(options: { maxMissions?: number } = {}) {
  const store = createStore({ units: UNITS });
  const seq = { mission: 0, notice: 0 };
  const manager = createMissionManager({
    store,
    maxMissions: options.maxMissions,
    createId: (prefix) => `${prefix}-${++seq[prefix as 'mission' | 'notice']}`,
  });
  return { store, manager };
}

describe('manager：brief 透传 + checkpoint 记账', () => {
  test('createMission 透传 brief：四段原样落库', () => {
    const { store, manager } = setup();
    const brief = {
      requirements: '侦察北门',
      acceptance: '带回敌军布防图',
      deliverables: '一份口头汇报',
      constraints: '不得暴露单位编号',
    };
    const mission = manager.createMission({ title: '侦察北门', unitIds: ['u1'], brief });

    expect(mission?.brief).toEqual(brief);
    expect(store.getState().missions[0].brief).toEqual(brief);
  });

  test('createMission 不带 brief：任务上不出现 brief 键（裸任务不被塞空壳）', () => {
    const { store, manager } = setup();
    manager.createMission({ title: '裸任务', unitIds: ['u1'] });
    expect('brief' in store.getState().missions[0]).toBe(false);
  });

  test('createMission 透传 dependsOn（去重与自依赖清理在 machine 里做）', () => {
    const { store, manager } = setup();
    const mission = manager.createMission({
      title: '加固城墙',
      unitIds: ['u2'],
      dependsOn: ['dep-a', 'dep-a'],
    });
    expect(mission?.dependsOn).toEqual(['dep-a']);
    expect(store.getState().missions[0].dependsOn).toEqual(['dep-a']);
  });

  test('createMission 丢掉自依赖（自己等自己是死结，不该默默收下）', () => {
    const { store, manager } = setup();
    // 第一条任务的 id 是 mission-1 —— 用它当自己的依赖即自依赖
    const mission = manager.createMission({
      title: '加固城墙',
      unitIds: ['u2'],
      dependsOn: ['mission-1'],
    });
    expect(mission?.dependsOn).toBeUndefined();
    expect(store.getState().missions[0].dependsOn).toBeUndefined();
  });

  test('checkpointMission 追加一条：落库形状是 { at, note }，历史累积', () => {
    const { store, manager } = setup();
    manager.createMission({ title: '侦察北门', unitIds: ['u1'] });

    manager.checkpointMission('mission-1', '派两人出门');
    manager.checkpointMission('mission-1', '发现巡逻队');

    expect(store.getState().missions[0].checkpoints).toEqual([
      { at: expect.any(Number), note: '派两人出门' },
      { at: expect.any(Number), note: '发现巡逻队' },
    ]);
  });

  test('checkpointMission 静默：成功也不发 Notice（记账是后台动作）', () => {
    const { store, manager } = setup();
    manager.createMission({ title: '侦察北门', unitIds: ['u1'] });
    const before = store.getState().notices.length;

    manager.checkpointMission('mission-1', '派两人出门');
    expect(store.getState().notices.length).toBe(before);
  });

  test('checkpointMission 在终态上拒绝：不写库、不发通知', () => {
    const { store, manager } = setup();
    manager.createMission({ title: '侦察北门', unitIds: ['u1'] });
    manager.cancelMission('mission-1');
    const before = store.getState().missions;

    expect(manager.checkpointMission('mission-1', '事后补记')).toBeNull();
    expect(store.getState().missions).toBe(before);
    expect(store.getState().missions[0].checkpoints).toBeUndefined();
    expect(store.getState().notices.some((n) => n.text.includes('不可执行'))).toBe(false);
  });

  test('checkpointMission 对未知任务与空 note 都静默丢弃', () => {
    const { store, manager } = setup();
    manager.createMission({ title: '侦察北门', unitIds: ['u1'] });
    const before = store.getState().missions;

    expect(manager.checkpointMission('nope', '查无此任务')).toBeNull();
    expect(manager.checkpointMission('mission-1', '   ')).toBeNull();
    expect(store.getState().missions).toBe(before);
  });
});

// ============================================================================
// 4. 闭环：HudCommand → core → WorldState
// ============================================================================

interface Loop {
  readonly store: CoreStore;
  readonly states: WorldState[];
  stop(): void;
}

function loop(): Loop {
  resetBus();
  const store = createStore({ units: UNITS });
  const states: WorldState[] = [];
  const offState: Unsubscribe = onState((state) => states.push(state));
  const runtime = createCoreRuntime({ store });
  const stop = runtime.start();
  return { store, states, stop: () => { stop(); offState(); resetBus(); } };
}

const cleanups: (() => void)[] = [];

beforeEach(() => {
  resetBus();
  cleanups.length = 0;
});

afterEach(() => {
  cleanups.forEach((fn) => fn());
  cleanups.length = 0;
  resetBus();
});

describe('闭环：mission.create / mission.checkpoint 命令接线', () => {
  test('mission.create 带 brief 与 dependsOn → 落进 WorldState.missions', () => {
    const { store, states, stop } = loop();
    cleanups.push(stop);

    emitCommand({
      type: 'mission.create',
      title: '侦察北门',
      unitIds: ['u1'],
      brief: { acceptance: '带回敌军布防图' },
      dependsOn: [],
    });

    expect(store.getState().missions[0]).toMatchObject({
      brief: { acceptance: '带回敌军布防图' },
    });
    expect(states[states.length - 1].missions[0].brief).toEqual({
      acceptance: '带回敌军布防图',
    });
  });

  test('mission.checkpoint → 状态里多一条记账（静默：无新通知）', () => {
    const { store, states, stop } = loop();
    cleanups.push(stop);

    emitCommand({ type: 'mission.create', title: '侦察北门', unitIds: ['u1'] });
    const missionId = store.getState().missions[0].id;
    const noticesBefore = store.getState().notices.length;

    emitCommand({ type: 'mission.checkpoint', missionId, note: '派两人出门' });

    expect(store.getState().missions[0].checkpoints).toEqual([
      { at: expect.any(Number), note: '派两人出门' },
    ]);
    expect(states[states.length - 1].missions[0].checkpoints).toHaveLength(1);
    expect(store.getState().notices.length).toBe(noticesBefore);
  });

  test('mission.* 不再走 onUnhandled（新增的 checkpoint 也算已接上的命令）', () => {
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
    emitCommand({ type: 'mission.checkpoint', missionId, note: '派两人出门' });
    emitCommand({ type: 'mission.cancel', missionId });

    expect(unhandled).toEqual([]);
  });
});
