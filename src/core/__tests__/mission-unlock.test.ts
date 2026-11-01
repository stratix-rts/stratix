/**
 * 单测：mission 域**依赖解锁调度 + confirm 守门**（@since v3.39 / task_078）。
 *
 * 四段：
 *   1. 纯函数：findMissingDependencies / resolveMissionDependencies / collectNewlyUnlocked / shortMissionId；
 *   2. 口径一致性：isMissionUnlocked ⟺ findMissingDependencies 为空（两侧不许各说一套）；
 *   3. manager：终态迁移触发依赖广播（解锁）+ 依赖未满足时 confirm 被拒（Notice 列出还差哪几个）；
 *   4. 边界：cancelled 依赖也算解锁 / 拒绝与叫停不受守门限制 / 解锁不自动确认。
 *
 * 隔离：每个用例新建 createStore()（不共用状态），不 mock 总线。
 */

import {
  collectNewlyUnlocked,
  createMissionManager,
  findMissingDependencies,
  isMissionUnlocked,
  resolveMissionDependencies,
  shortMissionId,
} from '../mission';
import { createStore, type CoreStore } from '../store';
import type { MissionPhase, MissionView, UnitView, WorldState } from '../types';

// ============================================================================
// 1. 纯函数
// ============================================================================

const UNITS: UnitView[] = [
  { id: 'u1', name: 'Neo', status: 'idle', missionId: null, power: 3 },
  { id: 'u2', name: 'Trinity', status: 'idle', missionId: null, power: 5 },
];

function missionAt(
  id: string,
  phase: MissionPhase,
  patch: Partial<MissionView> = {}
): MissionView {
  return { id, title: `任务 ${id}`, unitIds: [], createdAt: 1000, phase, ...patch };
}

describe('findMissingDependencies：还差哪几个依赖', () => {
  test('无依赖 → 不缺任何东西', () => {
    expect(findMissingDependencies(missionAt('m1', 'draft'), [])).toEqual([]);
  });

  test('前置在办 → 缺它；前置 done → 不缺', () => {
    const target = missionAt('m1', 'pending', { dependsOn: ['dep'] });
    expect(findMissingDependencies(target, [missionAt('dep', 'running')])).toEqual(['dep']);
    expect(findMissingDependencies(target, [missionAt('dep', 'done')])).toEqual([]);
  });

  test('前置被 cancelled → 不缺（前置作废不该把整条链锁死）', () => {
    const target = missionAt('m1', 'pending', { dependsOn: ['dep'] });
    expect(findMissingDependencies(target, [missionAt('dep', 'cancelled')])).toEqual([]);
  });

  test('依赖查不到 → 不缺（历史被裁掉后不至于永久死锁）', () => {
    const target = missionAt('m1', 'pending', { dependsOn: ['gone'] });
    expect(findMissingDependencies(target, [])).toEqual([]);
  });

  test('自依赖 → 缺自己（死结）', () => {
    const target = missionAt('m1', 'pending', { dependsOn: ['m1'] });
    expect(findMissingDependencies(target, [target])).toEqual(['m1']);
  });

  test('多条依赖：只报没满足的那些', () => {
    const target = missionAt('m1', 'pending', { dependsOn: ['a', 'b', 'c'] });
    const missing = findMissingDependencies(target, [
      missionAt('a', 'done'),
      missionAt('b', 'running'),
      missionAt('c', 'running'),
    ]);
    expect(missing).toEqual(['b', 'c']);
  });
});

describe('口径一致性：isMissionUnlocked ⟺ findMissingDependencies 为空', () => {
  const cases: Array<[MissionView, MissionView[]]> = [
    [missionAt('m1', 'draft'), []],
    [missionAt('m1', 'pending', { dependsOn: ['a'] }), [missionAt('a', 'running')]],
    [missionAt('m1', 'pending', { dependsOn: ['a'] }), [missionAt('a', 'done')]],
    [missionAt('m1', 'pending', { dependsOn: ['a'] }), [missionAt('a', 'cancelled')]],
    [missionAt('m1', 'pending', { dependsOn: ['gone'] }), []],
    [missionAt('m1', 'pending', { dependsOn: ['m1'] }), [missionAt('m1', 'draft')]],
  ];
  test.each(cases)('两者恒等', (target, all) => {
    expect(isMissionUnlocked(target, all)).toBe(findMissingDependencies(target, all).length === 0);
  });
});

describe('resolveMissionDependencies：逐条依赖的展示形状', () => {
  test('每条依赖带出标题与相位，标出满足与否', () => {
    const target = missionAt('m1', 'pending', { dependsOn: ['a', 'b'] });
    const deps = resolveMissionDependencies(target, [
      missionAt('a', 'done', { title: '侦察北门' }),
      missionAt('b', 'running', { title: '加固城墙' }),
    ]);
    expect(deps).toEqual([
      { id: 'a', shortId: 'a', title: '侦察北门', phase: 'done', satisfied: true },
      { id: 'b', shortId: 'b', title: '加固城墙', phase: 'running', satisfied: false },
    ]);
  });

  test('查不到的依赖：标题与相位为 null，但算已满足', () => {
    const target = missionAt('m1', 'pending', { dependsOn: ['gone'] });
    const deps = resolveMissionDependencies(target, []);
    expect(deps[0]).toMatchObject({ title: null, phase: null, satisfied: true });
  });
});

describe('collectNewlyUnlocked：终态迁移后谁刚解锁', () => {
  test('前置收尾 → 下游任务被算作"刚解锁"', () => {
    const before = [missionAt('dep', 'running'), missionAt('m1', 'pending', { dependsOn: ['dep'] })];
    const after = [missionAt('dep', 'done'), missionAt('m1', 'pending', { dependsOn: ['dep'] })];
    expect(collectNewlyUnlocked(before, after, 'dep').map((m) => m.id)).toEqual(['m1']);
  });

  test('早就解锁的下游不重复报（差分口径，不是"当前已解锁"）', () => {
    const before = [missionAt('dep', 'done'), missionAt('m1', 'pending', { dependsOn: ['dep'] })];
    const after = [missionAt('dep', 'done'), missionAt('m1', 'pending', { dependsOn: ['dep'] })];
    expect(collectNewlyUnlocked(before, after, 'dep')).toEqual([]);
  });

  test('不依赖它的任务不算数', () => {
    const before = [missionAt('dep', 'running'), missionAt('m1', 'pending')];
    const after = [missionAt('dep', 'done'), missionAt('m1', 'pending')];
    expect(collectNewlyUnlocked(before, after, 'dep')).toEqual([]);
  });
});

describe('shortMissionId：id 短码', () => {
  test('长 id 取「前缀_末段」，短 id 原样返回', () => {
    expect(shortMissionId('mission_1762300000000_3')).toBe('mission_3');
    expect(shortMissionId('m-1')).toBe('m-1');
    expect(shortMissionId('')).toBe('');
  });
});

// ============================================================================
// 2. manager：终态触发依赖广播 + confirm 守门
// ============================================================================

function setup(): { store: CoreStore; manager: ReturnType<typeof createMissionManager> } {
  const store = createStore({ units: UNITS });
  return { store, manager: createMissionManager({ store }) };
}

function findMission(store: CoreStore, id: string): MissionView {
  const found = store.getState().missions.find((m) => m.id === id);
  if (!found) throw new Error(`任务不存在: ${id}`);
  return found;
}

describe('manager：终态迁移触发依赖解锁广播', () => {
  test('前置 done → 下游解锁、状态被广播、并收到"可确认"通知', () => {
    const { store, manager } = setup();
    const states: WorldState[] = [];
    const off = store.subscribe((state) => states.push(state));

    const upstream = manager.createMission({ title: '侦察北门', unitIds: ['u1'] });
    const downstream = manager.createMission({
      title: '加固城墙',
      unitIds: ['u1'],
      dependsOn: [upstream!.id],
    });
    expect(upstream).not.toBeNull();
    expect(downstream).not.toBeNull();

    // 前置还在办 → 下游未解锁
    expect(isMissionUnlocked(findMission(store, downstream!.id), store.getState().missions)).toBe(
      false,
    );

    manager.decideMission(upstream!.id, 'accept'); // pending → running
    const before = states.length;
    manager.completeMission(upstream!.id); // running → done

    // 1. 有广播（解锁状态随这次广播送到两侧）
    expect(states.length).toBeGreaterThan(before);
    const latest = states[states.length - 1];
    // 2. 广播出去的状态里下游已解锁
    expect(isMissionUnlocked(findMission(store, downstream!.id), latest.missions)).toBe(true);
    // 3. 解锁只是"允许"：不自动确认，人/agent 仍要显式推进
    expect(findMission(store, downstream!.id).phase).toBe('pending');
    // 4. 有通知告诉用户这条现在可以确认了
    expect(
      latest.notices.some(
        (n) => n.text.includes('加固城墙') && n.text.includes('前置已满足'),
      ),
    ).toBe(true);
    off();
  });

  test('前置 cancelled → 下游同样解锁（作废不等于阻塞）', () => {
    const { store, manager } = setup();
    const upstream = manager.createMission({ title: '侦察北门', unitIds: ['u1'] })!;
    const downstream = manager.createMission({
      title: '加固城墙',
      unitIds: ['u1'],
      dependsOn: [upstream.id],
    })!;

    manager.cancelMission(upstream.id);

    expect(isMissionUnlocked(findMission(store, downstream.id), store.getState().missions)).toBe(
      true,
    );
    // 解锁之后确认就能过
    expect(manager.decideMission(downstream.id, 'accept')).not.toBeNull();
    expect(findMission(store, downstream.id).phase).toBe('running');
  });
});

describe('manager：依赖未满足时拒绝确认', () => {
  test('confirm 被拒：相位不变，Notice 列出还差哪几个', () => {
    const { store, manager } = setup();
    const upstream = manager.createMission({ title: '侦察北门', unitIds: ['u1'] })!;
    const downstream = manager.createMission({
      title: '加固城墙',
      unitIds: ['u1'],
      dependsOn: [upstream.id],
    })!;

    const result = manager.decideMission(downstream.id, 'accept');

    expect(result).toBeNull();
    expect(findMission(store, downstream.id).phase).toBe('pending'); // 没被推进
    const notice = store.getState().notices.find((n) => n.text.includes('依赖未满足'));
    expect(notice).toBeDefined();
    expect(notice!.text).toContain('侦察北门'); // 标题
    expect(notice!.text).toContain(shortMissionId(upstream.id)); // 短码
  });

  test('多个缺失依赖：Notice 一次列全', () => {
    const { store, manager } = setup();
    const a = manager.createMission({ title: '前置甲', unitIds: ['u1'] })!;
    const b = manager.createMission({ title: '前置乙', unitIds: ['u2'] })!;
    const target = manager.createMission({
      title: '加固城墙',
      unitIds: ['u1'],
      dependsOn: [a.id, b.id],
    })!;

    manager.decideMission(target.id, 'accept');

    const notice = store.getState().notices.find((n) => n.text.includes('依赖未满足'));
    expect(notice!.text).toContain('前置甲');
    expect(notice!.text).toContain('前置乙');
  });

  test('拒绝与叫停不受依赖守门限制（前置没满足时用户最需要的是能撤掉）', () => {
    const { store, manager } = setup();
    const upstream = manager.createMission({ title: '侦察北门', unitIds: ['u1'] })!;
    const downstream = manager.createMission({
      title: '加固城墙',
      unitIds: ['u1'],
      dependsOn: [upstream.id],
    })!;

    expect(manager.decideMission(downstream.id, 'reject')).not.toBeNull();
    expect(findMission(store, downstream.id).phase).toBe('cancelled');
  });
});
