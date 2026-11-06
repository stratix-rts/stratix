/**
 * 单测：**managers 按副本（instance）过滤**（@since v3.3，task_204 / M2-07）。
 *
 * 权威依据：docs/DESIGN-project-map.md §1.4（B4a：内存池裁剪吃**已按 instance 过滤的数组**）
 *   + §4.2 表第 3 行（依赖判定**不跨副本**建索引）。
 *
 * 覆盖三件事：
 *   1. **配额不互相挤**：A 副本的位子不会被 B 副本的任务占掉（上限是**每副本**的）。
 *   2. **裁剪不跨副本**：腾位子时只丢**本副本**的终态历史，别副本的一条都不动。
 *   3. **依赖判定隔离**：跨副本的依赖 id 查不到 ⇒ 不阻塞本副本的任务（不跨 instance 建依赖）。
 *
 * 附带两条回归：① 未标注归属的实体归**默认沙盒**（COALESCE 口径）⇒ 沙盒路径行为不变；
 *   ② 新建实体盖上副本归属（与加载侧 instance-loader 同口径）。
 *
 * 用真 store（createStore()）隔离：不 mock —— manager 的职责就是写 store。
 */

import { createMissionManager } from '../mission';
import { resolveMissionDependencies } from '../mission/machine';
import { createSessionManager, type SessionRecord } from '../session';
import { createStore, type CoreStore } from '../store';
import { createTaskManager } from '../task';
import type { CharacterTask, MissionView } from '../types';

// ============================================================================
// 夹具
// ============================================================================

/** 两个副本 id（沙盒之外的普通副本）。 */
const INSTANCE_A = 'wsp_a';
const INSTANCE_B = 'wsp_b';

/** 造一条任务（mission）。phase 用终态 / 在办两档。 */
function mission(patch: Partial<MissionView> = {}): MissionView {
  return {
    id: 'm-1',
    title: '侦察北门',
    unitIds: [],
    createdAt: 1000,
    phase: 'running',
    ...patch,
  };
}

/** 造一条角色任务（task）。 */
function task(patch: Partial<CharacterTask> = {}): CharacterTask {
  return {
    id: 't-1',
    characterId: 'ch-1',
    prompt: '干活',
    status: 'queued',
    createdAt: 1000,
    startedAt: null,
    endedAt: null,
    output: '',
    ...patch,
  };
}

/** 造一条会话（session）。 */
function session(patch: Partial<SessionRecord> = {}): SessionRecord {
  return {
    id: 's-1',
    kind: 'peer_chat',
    title: '对一下分工',
    participants: ['alice', 'bob'],
    status: 'active',
    createdAt: 1000,
    lastEventAt: 1000,
    closedAt: null,
    eventCount: 1,
    ...patch,
  };
}

/** 建一个带角色与单位的 store（角色任务派发需要角色在档）。 */
function storeWithCharacter(initial: Partial<Parameters<typeof createStore>[0]> = {}): CoreStore {
  return createStore({
    characters: [
      { id: 'ch-1', name: '阿尔法', persona: '冷静', level: 1, experience: 0, agentKind: 'claude-code', skinId: null, externalSessionId: null },
    ],
    units: [
      { id: 'unit_ch-1', name: '阿尔法', status: 'idle', missionId: null, power: 0, characterId: 'ch-1', skinId: null, appearance: null },
    ],
    ...initial,
  });
}

// ============================================================================
// 1. mission manager：配额不互相挤 + 裁剪不跨副本
// ============================================================================

describe('mission manager：裁剪按 instance 口径', () => {
  test('A 副本的位子不会被 B 副本的任务占掉（上限是每副本的）', () => {
    // A 副本 3 条在办（占满 maxMissions=3）+ B 副本 3 条终态（老实现会被裁掉腾位子）。
    const store = storeWithCharacter({
      activeInstanceId: INSTANCE_A,
      missions: [
        mission({ id: 'a1', instanceId: INSTANCE_A }),
        mission({ id: 'a2', instanceId: INSTANCE_A }),
        mission({ id: 'a3', instanceId: INSTANCE_A }),
        mission({ id: 'b1', phase: 'done', instanceId: INSTANCE_B }),
        mission({ id: 'b2', phase: 'done', instanceId: INSTANCE_B }),
        mission({ id: 'b3', phase: 'done', instanceId: INSTANCE_B }),
      ],
    });
    let seq = 0;
    const manager = createMissionManager({
      store,
      maxMissions: 3,
      createId: (prefix) => `${prefix}-${++seq}`,
    });

    // A 副本自己满了 ⇒ 拒绝新建（不静默挤掉谁）。
    expect(manager.createMission({ title: '新任务', unitIds: [] })).toBeNull();
    // B 副本的终态任务**一条都没被裁掉**（裁剪只吃本副本）。
    expect(store.getState().missions.map((m) => m.id)).toEqual(['a1', 'a2', 'a3', 'b1', 'b2', 'b3']);
  });

  test('腾位子只丢本副本的终态任务，别副本的终态原样留着', () => {
    const store = storeWithCharacter({
      activeInstanceId: INSTANCE_A,
      missions: [
        mission({ id: 'a1', phase: 'done', instanceId: INSTANCE_A }),
        mission({ id: 'a2', phase: 'done', instanceId: INSTANCE_A }),
        mission({ id: 'b1', phase: 'done', instanceId: INSTANCE_B }),
        mission({ id: 'b2', phase: 'done', instanceId: INSTANCE_B }),
      ],
    });
    let seq = 0;
    const manager = createMissionManager({
      store,
      maxMissions: 2,
      createId: (prefix) => `${prefix}-${++seq}`,
    });

    const created = manager.createMission({ title: '新任务', unitIds: [] });
    expect(created).not.toBeNull();
    // A 副本要腾位子 ⇒ 只丢**自己**的终态（最旧那条 a1）；B 副本的终态一条都不动。
    expect(store.getState().missions.map((m) => m.id)).toEqual(['a2', 'b1', 'b2', 'mission-1']);
  });

  test('新建任务盖上副本归属（与加载侧同口径）', () => {
    const store = storeWithCharacter({ activeInstanceId: INSTANCE_A });
    let seq = 0;
    const manager = createMissionManager({ store, createId: (prefix) => `${prefix}-${++seq}` });

    const created = manager.createMission({ title: '新任务', unitIds: [] });
    expect(created?.instanceId).toBe(INSTANCE_A);
  });

  test('沙盒路径行为不变：未标注归属的任务归默认沙盒，终态照旧被裁掉腾位子', () => {
    // 没设 activeInstanceId ⇒ 大厅 / 默认沙盒（COALESCE 口径：缺省 ⇒ wsp_sandbox）。
    const store = storeWithCharacter({
      missions: [
        mission({ id: 's1', phase: 'done' }),
        mission({ id: 's2', phase: 'done' }),
      ],
    });
    let seq = 0;
    const manager = createMissionManager({
      store,
      maxMissions: 2,
      createId: (prefix) => `${prefix}-${++seq}`,
    });

    expect(manager.createMission({ title: '新任务', unitIds: [] })).not.toBeNull();
    // 腾位子只丢最旧的那条终态（keep = max-1 = 1）—— 沙盒路径与 M2-07 之前一致。
    expect(store.getState().missions.map((m) => m.id)).toEqual(['s2', 'mission-1']);
  });
});

// ============================================================================
// 2. task manager：配额不互相挤 + 裁剪不跨副本
// ============================================================================

describe('task manager：裁剪按 instance 口径', () => {
  test('A 副本满位时拒绝新派，别副本的任务一条都不动', () => {
    const store = storeWithCharacter({
      activeInstanceId: INSTANCE_A,
      tasks: [
        task({ id: 'a1', status: 'running', instanceId: INSTANCE_A }),
        task({ id: 'a2', status: 'running', instanceId: INSTANCE_A }),
        task({ id: 'b1', status: 'completed', instanceId: INSTANCE_B }),
      ],
    });
    let seq = 0;
    const manager = createTaskManager({
      store,
      maxTasks: 2,
      createId: (prefix) => `${prefix}-${++seq}`,
    });

    expect(manager.assignTask({ characterId: 'ch-1', prompt: '干活' })).toBeNull();
    expect(store.getState().tasks?.map((t) => t.id)).toEqual(['a1', 'a2', 'b1']);
  });

  test('腾位子只丢本副本的终态任务，别副本的终态原样留着', () => {
    const store = storeWithCharacter({
      activeInstanceId: INSTANCE_A,
      tasks: [
        task({ id: 'a1', status: 'completed', instanceId: INSTANCE_A }),
        task({ id: 'a2', status: 'completed', instanceId: INSTANCE_A }),
        task({ id: 'b1', status: 'completed', instanceId: INSTANCE_B }),
      ],
    });
    let seq = 0;
    const manager = createTaskManager({
      store,
      maxTasks: 2,
      createId: (prefix) => `${prefix}-${++seq}`,
    });

    expect(manager.assignTask({ characterId: 'ch-1', prompt: '干活' })).not.toBeNull();
    // A 副本腾位子只丢自己的终态（最旧那条 a1）；B 副本的终态一条都不动。
    expect(store.getState().tasks?.map((t) => t.id)).toEqual(['a2', 'b1', 'task-1']);
  });

  test('新建任务盖上副本归属', () => {
    const store = storeWithCharacter({ activeInstanceId: INSTANCE_A });
    let seq = 0;
    const manager = createTaskManager({ store, createId: (prefix) => `${prefix}-${++seq}` });

    expect(manager.assignTask({ characterId: 'ch-1', prompt: '干活' })?.instanceId).toBe(INSTANCE_A);
  });
});

// ============================================================================
// 3. session manager：配额不互相挤 + 裁剪不跨副本
// ============================================================================

describe('session manager：裁剪按 instance 口径', () => {
  test('A 副本满位时拒绝新建，别副本的会话一条都不动', () => {
    const store = createStore({
      activeInstanceId: INSTANCE_A,
      sessions: [
        session({ id: 'a1', status: 'active', instanceId: INSTANCE_A }),
        session({ id: 'a2', status: 'active', instanceId: INSTANCE_A }),
        session({ id: 'b1', status: 'closed', closedAt: 2000, instanceId: INSTANCE_B }),
      ],
    });
    let seq = 0;
    const manager = createSessionManager({
      store,
      maxSessions: 2,
      createId: (prefix) => `${prefix}_${++seq}`,
    });

    expect(manager.createSession({ kind: 'peer_chat', participants: ['alice'] })).toBeNull();
    expect(store.getState().sessions?.map((s) => s.id)).toEqual(['a1', 'a2', 'b1']);
  });

  test('腾位子只丢本副本的已关闭会话，别副本的原样留着', () => {
    const store = createStore({
      activeInstanceId: INSTANCE_A,
      sessions: [
        session({ id: 'a1', status: 'closed', closedAt: 2000, instanceId: INSTANCE_A }),
        session({ id: 'a2', status: 'closed', closedAt: 2000, instanceId: INSTANCE_A }),
        session({ id: 'b1', status: 'closed', closedAt: 2000, instanceId: INSTANCE_B }),
      ],
    });
    let seq = 0;
    const manager = createSessionManager({
      store,
      maxSessions: 2,
      createId: (prefix) => `${prefix}_${++seq}`,
    });

    expect(manager.createSession({ kind: 'peer_chat', participants: ['alice'] })).not.toBeNull();
    // A 副本腾位子只丢自己的已关闭会话（最旧那条 a1）；B 副本的一条都不动。
    expect(store.getState().sessions?.map((s) => s.id)).toEqual([
      'a2',
      'b1',
      'session_peer_chat_1',
    ]);
  });

  test('新建会话盖上副本归属', () => {
    const store = createStore({ activeInstanceId: INSTANCE_A });
    let seq = 0;
    const manager = createSessionManager({ store, createId: (prefix) => `${prefix}_${++seq}` });

    expect(manager.createSession({ kind: 'peer_chat', participants: ['alice'] })?.instanceId).toBe(
      INSTANCE_A
    );
  });
});

// ============================================================================
// 4. machine：依赖判定不跨 instance 建依赖
// ============================================================================

describe('mission machine：依赖判定按 instance 隔离', () => {
  test('同副本的依赖照常解析（相位决定满足与否）', () => {
    const target = mission({ id: 'a1', phase: 'running', instanceId: INSTANCE_A });
    const dep = mission({ id: 'a0', phase: 'running', instanceId: INSTANCE_A });
    const statuses = resolveMissionDependencies(
      mission({ id: 'a1', phase: 'running', dependsOn: ['a0'], instanceId: INSTANCE_A }),
      [target, dep]
    );
    expect(statuses).toHaveLength(1);
    expect(statuses[0].satisfied).toBe(false);
    expect(statuses[0].title).toBe('侦察北门');
  });

  test('跨副本的依赖 id 查不到 ⇒ 不阻塞本副本的任务（不跨 instance 建依赖）', () => {
    // B 副本的前置**还在跑** —— 全量索引会让 A 的任务被判「未满足」（跨副本误判）。
    const foreignDep = mission({ id: 'b0', phase: 'running', instanceId: INSTANCE_B });
    const statuses = resolveMissionDependencies(
      mission({ id: 'a1', phase: 'running', dependsOn: ['b0'], instanceId: INSTANCE_A }),
      [foreignDep]
    );
    expect(statuses).toHaveLength(1);
    expect(statuses[0].satisfied).toBe(true);
    expect(statuses[0].title).toBeNull();
  });

  test('终态的跨副本依赖同样查不到（索引只收本副本）', () => {
    const foreignDep = mission({ id: 'b0', phase: 'done', instanceId: INSTANCE_B });
    const statuses = resolveMissionDependencies(
      mission({ id: 'a1', phase: 'running', dependsOn: ['b0'], instanceId: INSTANCE_A }),
      [foreignDep]
    );
    expect(statuses[0].satisfied).toBe(true);
    expect(statuses[0].phase).toBeNull();
  });
});
