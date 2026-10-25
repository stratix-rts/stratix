/**
 * 单测：任务生命周期 → 战场单位表现的纯映射层（world/objects/task-fx.ts，task_038）。
 * 覆盖：
 *   - TaskFxBoard：三类落点（started→working / completed→done / failed→failed）、
 *     done 的 1.5s 淡出窗口（注入时钟确定性推进）、failed 驻留、换相顶替、clear/clearAll；
 *   - visibleMarker 表现裁决：busy 派生永远画环（读档恢复成立）、无 busy 支撑的 working 不画；
 *   - applyTaskFxEvent：characterId → 单位集合的落地映射（0/1/N 命中）；
 *   - 桩场景全链路：真总线 + 真桥接层 + 真 registry + 真 board —— 模拟场景的接线方式
 *     （BattlefieldScene import phaser 无法进 node 测试，但它的接线逻辑恰好就是
 *     syncUnits / syncTaskEvent 两个纯转发，桩在此按同一口径复刻）。
 *
 * @jest-environment node
 */

import { emitState, emitWorldEvent, resetBus } from '../../core/bus';
import type { CharacterTask, UnitView, WorldState } from '../../core/types';
import { createInitialState } from '../../core/store';
import { createWorldBridge, type WorldScenePort } from '../bridge/bus-adapter';
import { UnitRegistry } from '../objects/unit-registry';
import {
  TASK_FX_STYLE,
  TaskFxBoard,
  applyTaskFxEvent,
  type TaskFxUnitRef,
} from '../objects/task-fx';

function makeTask(characterId: string, status: CharacterTask['status'] = 'running'): CharacterTask {
  return {
    id: `task-${characterId}`,
    characterId,
    prompt: '干活',
    status,
    createdAt: 1,
    startedAt: null,
    endedAt: null,
    output: '',
  };
}

describe('TaskFxBoard：三类落点与生命周期', () => {
  test('started → working；completed → done；failed → failed', () => {
    const board = new TaskFxBoard({ now: () => 0 });
    board.setWorking('u1');
    expect(board.markerFor('u1')?.kind).toBe('working');
    board.setDone('u1');
    expect(board.markerFor('u1')?.kind).toBe('done');
    board.setFailed('u1');
    expect(board.markerFor('u1')?.kind).toBe('failed');
  });

  test('done 在 ttl 内可见，过期即惰性剔除（注入时钟确定性推进）', () => {
    let clockNow = 1_000;
    const board = new TaskFxBoard({ now: () => clockNow });
    board.setDone('u1');
    expect(board.markerFor('u1')?.kind).toBe('done');

    clockNow += TASK_FX_STYLE.done.ttlMs - 1;
    expect(board.markerFor('u1')).not.toBeNull(); // 差 1ms 还在

    clockNow += 1;
    expect(board.markerFor('u1')).toBeNull(); // 到点剔除
  });

  test('failed 不自动过期（驻留到下一次状态变化）', () => {
    let clockNow = 0;
    const board = new TaskFxBoard({ now: () => clockNow });
    board.setFailed('u1');
    clockNow += 60_000;
    expect(board.markerFor('u1')?.kind).toBe('failed'); // 一分钟后还在
  });

  test('换相返回 changed=true；同相位重复事件刷新时刻但不报变化', () => {
    let clockNow = 0;
    const board = new TaskFxBoard({ now: () => clockNow });
    expect(board.setWorking('u1')).toBe(true);
    expect(board.setWorking('u1')).toBe(false);
    expect(board.setFailed('u1')).toBe(true);

    clockNow = 100;
    board.setDone('u1');
    expect(board.markerFor('u1')?.sinceMs).toBe(100);
    clockNow = 500;
    board.setDone('u1'); // 重复完成事件：重计淡出窗
    expect(board.markerFor('u1')?.sinceMs).toBe(500);
  });

  test('clear / clearAll（单位离场，浮标不许悬空）', () => {
    const board = new TaskFxBoard({ now: () => 0 });
    board.setFailed('u1');
    board.setFailed('u2');
    expect(board.clear('u1')).toBe(true);
    expect(board.clear('u1')).toBe(false); // 幂等
    expect(board.markerFor('u1')).toBeNull();
    expect(board.markerFor('u2')?.kind).toBe('failed');
    board.clearAll();
    expect(board.markerFor('u2')).toBeNull();
  });
});

describe('visibleMarker：busy 派生与事件板的合并裁决', () => {
  const board = new TaskFxBoard({ now: () => 0 });

  test('busy 永远画环 —— 不依赖事件（读档恢复：有 running 任务、没经历过 started 事件）', () => {
    expect(board.visibleMarker('u-restore', 'busy')).toBe('working');
  });

  test('busy 压过事件板上的 done/failed（开工了就只画环）', () => {
    board.setDone('u1');
    expect(board.visibleMarker('u1', 'busy')).toBe('working');
    board.setFailed('u1');
    expect(board.visibleMarker('u1', 'busy')).toBe('working');
  });

  test('非 busy：done/failed 照画；板上的 working 无 busy 支撑不画（防事件乱序）', () => {
    board.setDone('u2');
    expect(board.visibleMarker('u2', 'idle')).toBe('done');
    board.setFailed('u3');
    expect(board.visibleMarker('u3', 'offline')).toBe('failed');
    board.setWorking('u4');
    expect(board.visibleMarker('u4', 'idle')).toBeNull();
    expect(board.visibleMarker('u5', 'idle')).toBeNull(); // 没有板也没环
  });
});

describe('applyTaskFxEvent：characterId → 单位落地', () => {
  const board = new TaskFxBoard({ now: () => 0 });
  const units: TaskFxUnitRef[] = [
    { id: 'u-a', characterId: 'ch-a' },
    { id: 'u-a2', characterId: 'ch-a' },
    { id: 'u-b', characterId: 'ch-b' },
    { id: 'u-plain', characterId: null },
  ];

  test('命中全部同角色单位，返回命中 id；任务未上战场的角色静默跳过', () => {
    expect(applyTaskFxEvent(board, units, makeTask('ch-a'), 'started')).toEqual(['u-a', 'u-a2']);
    expect(board.markerFor('u-a')?.kind).toBe('working');
    expect(board.markerFor('u-a2')?.kind).toBe('working');
    expect(board.markerFor('u-b')).toBeNull();

    expect(applyTaskFxEvent(board, units, makeTask('ch-ghost'), 'failed')).toEqual([]);
  });

  test('completed / failed 相位落对应浮标', () => {
    applyTaskFxEvent(board, units, makeTask('ch-b'), 'completed');
    expect(board.markerFor('u-b')?.kind).toBe('done');
    applyTaskFxEvent(board, units, makeTask('ch-b'), 'failed');
    expect(board.markerFor('u-b')?.kind).toBe('failed');
  });
});

describe('桩场景全链路：总线 → 桥 → (registry + board) → 表现', () => {
  /**
   * 桩场景：按 BattlefieldScene 的真实接线方式复刻（syncUnits 对账 + removed 清浮标 +
   * syncTaskEvent 落地 + visibleMarker 裁决）。Phaser 绘制层不在链上 —— 它只是把
   * visibleMarker 的结果画出来，映射对错在本层就能断言（规格⑤的"桩场景"口径）。
   */
  function createStubScene() {
    const registry = new UnitRegistry();
    const board = new TaskFxBoard({ now: () => 0 });
    const port: WorldScenePort = {
      syncUnits: (units) => {
        const result = registry.sync(units);
        for (const id of result.removed) board.clear(id);
      },
      syncSelection: () => {},
      syncTaskEvent: (task, phase) => {
        applyTaskFxEvent(board, registry.list(), task, phase);
      },
    };
    return { registry, board, port };
  }

  const unitViews = (status: UnitView['status']): UnitView[] => [
    { id: 'u-a', name: '甲', status, missionId: null, power: 1, characterId: 'ch-a' },
    { id: 'u-b', name: '乙', status: 'idle' as const, missionId: null, power: 1, characterId: 'ch-b' },
  ];

  function stateWith(units: UnitView[]): WorldState {
    return {
      ...createInitialState(),
      units,
      selection: { unitIds: [], previewUnitIds: [], revision: 1 },
    };
  }

  beforeEach(() => resetBus());
  afterEach(() => resetBus());

  test('task.started → busy 状态 + working 环（事件先到/状态先到都成立）', () => {
    const { registry, board, port } = createStubScene();
    const bridge = createWorldBridge(port);

    // core/task 的真实时序：先 setState（busy 派生广播），后发 task.started
    emitState(stateWith(unitViews('busy')));
    emitWorldEvent({ type: 'task.started', task: makeTask('ch-a') });

    expect(registry.get('u-a')?.status).toBe('busy'); // busy 派生链路正确
    expect(board.visibleMarker('u-a', registry.get('u-a')!.status)).toBe('working');
    bridge.destroy();
  });

  test('读档恢复：只有 busy 状态广播、没有事件 → 环照样画（busy 派生正确性）', () => {
    const { registry, board, port } = createStubScene();
    const bridge = createWorldBridge(port);

    emitState(stateWith(unitViews('busy')));
    expect(board.visibleMarker('u-a', registry.get('u-a')!.status)).toBe('working');
    bridge.destroy();
  });

  test('task.completed → 先收 busy（状态广播）再落 ✓；环让位给 ✓', () => {
    const { registry, board, port } = createStubScene();
    const bridge = createWorldBridge(port);

    emitState(stateWith(unitViews('busy')));
    emitWorldEvent({ type: 'task.started', task: makeTask('ch-a') });
    emitState(stateWith(unitViews('idle'))); // 完成收尾：状态先回 idle
    emitWorldEvent({ type: 'task.completed', task: { ...makeTask('ch-a'), status: 'completed' } });

    expect(registry.get('u-a')?.status).toBe('idle');
    expect(board.visibleMarker('u-a', 'idle')).toBe('done');
    bridge.destroy();
  });

  test('task.failed → 红 ! 驻留（之后单位离场才收）', () => {
    const { registry, board, port } = createStubScene();
    const bridge = createWorldBridge(port);

    emitState(stateWith(unitViews('busy')));
    emitWorldEvent({ type: 'task.started', task: makeTask('ch-a') });
    emitState(stateWith(unitViews('idle')));
    emitWorldEvent({ type: 'task.failed', task: { ...makeTask('ch-a'), status: 'failed' } });
    expect(board.visibleMarker('u-a', 'idle')).toBe('failed');

    // 单位离开战场：状态广播里没有它 → 浮标随之清掉，不悬空
    emitState(stateWith([unitViews('idle')[1]]));
    expect(registry.get('u-a')).toBeUndefined();
    expect(board.markerFor('u-a')).toBeNull();
    bridge.destroy();
  });

  test('task.queued 不产生战场表现（还没轮到它动）', () => {
    const { board, port } = createStubScene();
    const bridge = createWorldBridge(port);

    emitState(stateWith(unitViews('idle')));
    emitWorldEvent({ type: 'task.queued', task: makeTask('ch-a', 'queued') });

    expect(board.markerFor('u-a')).toBeNull();
    bridge.destroy();
  });
});


// ============================================================================
// 审批门浮标（task_049）：awaiting_approval → 黄色 ?（驻留到裁决）
// ============================================================================

describe('审批门浮标：setAwaiting 与相位落地（task_049）', () => {
  test('awaiting_approval → ? 浮标，不自动过期（驻留到裁决，与 failed 的 ! 同语义）', () => {
    let clockNow = 0;
    const board = new TaskFxBoard({ now: () => clockNow });
    expect(board.setAwaiting('u1')).toBe(true);
    expect(board.markerFor('u1')?.kind).toBe('awaiting');
    clockNow += 3_600_000; // 挂起不限时：一小时后问号还在
    expect(board.markerFor('u1')?.kind).toBe('awaiting');
    expect(board.setAwaiting('u1')).toBe(false); // 同相位重复事件不报变化
  });

  test('visibleMarker：awaiting 浮标在单位不 busy 时可见（挂起不算忙 —— 头顶 ? 就是它的表现）', () => {
    const board = new TaskFxBoard({ now: () => 0 });
    board.setAwaiting('u1');
    expect(board.visibleMarker('u1', 'idle')).toBe('awaiting');
    // 单位恰好 busy（同角色另一条任务在跑）→ 环优先（干活的表象优先于等待的表象）
    expect(board.visibleMarker('u1', 'busy')).toBe('working');
  });

  test('applyTaskFxEvent 落 awaiting 相位；批准（started 相位）盖回工作环', () => {
    const board = new TaskFxBoard({ now: () => 0 });
    const units: TaskFxUnitRef[] = [{ id: 'u-a', characterId: 'ch-a' }];
    expect(applyTaskFxEvent(board, units, makeTask('ch-a'), 'awaiting_approval')).toEqual(['u-a']);
    expect(board.markerFor('u-a')?.kind).toBe('awaiting');
    // 批准 → 桥接层折算 started 相位 → 工作环盖掉问号
    applyTaskFxEvent(board, units, makeTask('ch-a'), 'started');
    expect(board.markerFor('u-a')?.kind).toBe('working');
    // 驳回 → failed 相位 → ! 盖掉问号
    applyTaskFxEvent(board, units, makeTask('ch-a'), 'awaiting_approval');
    applyTaskFxEvent(board, units, makeTask('ch-a'), 'failed');
    expect(board.markerFor('u-a')?.kind).toBe('failed');
  });
});
