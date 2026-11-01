/**
 * 单测：角色任务域（core/task，task_037）—— 状态机 + store 投影 + 命令闭环 + 事件接地。
 *
 * 分四段：
 *   1. machine —— 纯函数，穷举全路径（含每条非法迁移、摘要截断、腾位规则）；
 *   2. manager —— 真 store，验证投影、单位忙闲派生、Notice、上限与非法操作不改状态；
 *   3. 闭环 —— 真 core/bus + 真 createCoreRuntime：task.assign 命令 → 状态机 → WorldState 广播；
 *   4. 事件 —— task.* 生命周期事件的发射时序与 runtime 接地（不进 onUnhandled）。
 *
 * 隔离靠 resetBus() 与每个用例新建的 createStore()；不 mock 总线 —— runtime 的职责就是接在总线上。
 */

import { emitCommand, emitWorldEvent, onState, onWorldEvent, resetBus, type Unsubscribe } from '../bus';
import { createCharacterManager } from '../character';
import { createTaskManager, syncUnitWorkingStatus } from '../task';
import {
  applyTaskAction,
  capTaskPlan,
  createQueuedTask,
  dropSettledTasks,
  isActiveTaskStatus,
  isTerminalTaskStatus,
  summarizeTaskOutput,
  type TaskAction,
} from '../task/machine';
import { createCoreRuntime } from '../runtime';
import { createStore, type CoreStore } from '../store';
import {
  MAX_TASK_PLAN_LEN,
  MAX_TASK_PROMPT_LEN,
  MAX_TASK_SUMMARY_LEN,
  type CharacterTask,
  type TaskStatus,
  type UnitView,
  type WorldState,
} from '../types';

// ============================================================================
// 1. 状态机（纯函数）
// ============================================================================

const TASK: CharacterTask = {
  id: 'task_1',
  characterId: 'ch-1',
  prompt: '侦察北门，报告敌情',
  status: 'queued',
  createdAt: 1000,
  startedAt: null,
  endedAt: null,
  output: '',
};

/** 在给定相位上造一条任务。 */
function taskAt(status: TaskStatus, patch: Partial<CharacterTask> = {}): CharacterTask {
  return { ...TASK, status, ...patch };
}

function apply(current: CharacterTask, action: TaskAction) {
  return applyTaskAction(current, action);
}

describe('createQueuedTask：新建即 queued', () => {
  test('全字段齐整：时间戳 null、输出空串', () => {
    expect(
      createQueuedTask({ id: 'task_x', characterId: 'ch-1', prompt: '干活', createdAt: 5 })
    ).toEqual({
      id: 'task_x',
      characterId: 'ch-1',
      prompt: '干活',
      status: 'queued',
      createdAt: 5,
      startedAt: null,
      endedAt: null,
      output: '',
    });
  });
});

describe('状态机主路径：queued → running → completed', () => {
  test('queued + start → running（盖 startedAt）', () => {
    const step = apply(TASK, { type: 'start', at: 2000 });
    expect(step.changed).toBe(true);
    expect(step.next).toEqual(taskAt('running', { startedAt: 2000 }));
  });

  test('running + complete → completed（盖 endedAt，output 是摘要）', () => {
    const step = apply(taskAt('running', { startedAt: 2000 }), {
      type: 'complete',
      at: 3000,
      output: '北门无敌情，一切正常。',
    });
    expect(step.next).toEqual(taskAt('completed', { startedAt: 2000, endedAt: 3000, output: '北门无敌情，一切正常。' }));
    expect(isTerminalTaskStatus(step.next.status)).toBe(true);
  });

  test('一条 happy path 串起来', () => {
    let current = TASK;
    for (const action of [
      { type: 'start', at: 1 } as TaskAction,
      { type: 'complete', at: 2, output: '完成' } as TaskAction,
    ]) {
      const step = applyTaskAction(current, action);
      expect(step.error).toBeUndefined();
      current = step.next;
    }
    expect(current.status).toBe('completed');
  });
});

// ============================================================================
// 取消：排队取消专用动作（@since v3.23，task_047）
// ============================================================================

describe('取消：仅 queued 可取消', () => {
  test('queued + cancel → cancelled（盖 endedAt，output 占位文案非空）', () => {
    const step = apply(TASK, { type: 'cancel', at: 1200 });
    expect(step.changed).toBe(true);
    expect(step.next).toEqual(taskAt('cancelled', { endedAt: 1200, output: '任务在排队时被取消' }));
    expect(isTerminalTaskStatus(step.next.status)).toBe(true);
    expect(isActiveTaskStatus(step.next.status)).toBe(false);
  });

  test('running + cancel → 拒（不强杀：中止在跑任务归「先停止」另一条路）', () => {
    const running = taskAt('running', { startedAt: 1000 });
    const step = apply(running, { type: 'cancel', at: 1200 });
    expect(step.changed).toBe(false);
    expect(step.error).toBe('illegal-transition');
    expect(step.next).toBe(running); // 原引用：任务继续跑，谁也没碰
  });

  test('终态 + cancel → 幂等拒绝（重复点取消不改写历史）', () => {
    for (const status of ['completed', 'failed', 'cancelled'] as const) {
      const current = taskAt(status, { endedAt: 1, output: 'x' });
      const step = apply(current, { type: 'cancel', at: 2 });
      expect(step.changed).toBe(false);
      expect(step.error).toBe('illegal-transition');
      expect(step.next).toBe(current);
    }
  });

  test('cancelled 是终态：任何动作都拒（含 start / complete / fail）', () => {
    const cancelled = taskAt('cancelled', { endedAt: 1, output: '任务在排队时被取消' });
    for (const action of [
      { type: 'start', at: 2 } as TaskAction,
      { type: 'complete', at: 2, output: 'y' } as TaskAction,
      { type: 'fail', at: 2, reason: 'z' } as TaskAction,
      { type: 'cancel', at: 2 } as TaskAction,
    ]) {
      expect(apply(cancelled, action).changed).toBe(false);
    }
  });

  test('dropSettledTasks 把 cancelled 当终态历史淘汰（取消的排队不占位置）', () => {
    const tasks: CharacterTask[] = [
      taskAt('cancelled', { id: 't1' }),
      taskAt('queued', { id: 't2' }),
    ];
    expect(dropSettledTasks(tasks, 1).map((t) => t.id)).toEqual(['t2']);
  });
});

describe('旁路：fail 从 queued / running 都可直达终态', () => {
  test('queued + fail → failed（守门拦截的落点：还没开工就注定跑不起来）', () => {
    const step = apply(TASK, { type: 'fail', at: 1500, reason: '该 CLI 未安装，任务无法执行' });
    expect(step.next).toEqual(
      taskAt('failed', { endedAt: 1500, output: '该 CLI 未安装，任务无法执行', startedAt: null })
    );
  });

  test('running + fail → failed（保留 startedAt，output=原因）', () => {
    const step = apply(taskAt('running', { startedAt: 2000 }), {
      type: 'fail',
      at: 2500,
      reason: '执行超时：等了 600 秒',
    });
    expect(step.next).toEqual(taskAt('failed', { startedAt: 2000, endedAt: 2500, output: '执行超时：等了 600 秒' }));
  });

  test('fail 空原因 → 占位文案（failed.output 永不为空串，读的人不猜）', () => {
    expect(apply(TASK, { type: 'fail', at: 1, reason: '' }).next.output).toBe('任务失败（未提供原因）');
  });
});

describe('非法迁移：原样返回 + error', () => {
  test('终态不可再动（completed/failed 对任何动作都拒）', () => {
    for (const status of ['completed', 'failed'] as const) {
      const current = taskAt(status, { endedAt: 1, output: 'x' });
      for (const action of [
        { type: 'start', at: 2 } as TaskAction,
        { type: 'complete', at: 2, output: 'y' } as TaskAction,
        { type: 'fail', at: 2, reason: 'z' } as TaskAction,
      ]) {
        const step = applyTaskAction(current, action);
        expect(step.changed).toBe(false);
        expect(step.error).toBe('illegal-transition');
        expect(step.next).toBe(current); // 原引用
      }
    }
  });

  test('start 只认 queued；complete 只认 running', () => {
    expect(apply(taskAt('running'), { type: 'start', at: 1 }).error).toBe('illegal-transition');
    expect(apply(TASK, { type: 'complete', at: 1, output: 'x' }).error).toBe('illegal-transition');
  });

  test('isActiveTaskStatus 与 isTerminalTaskStatus 互补', () => {
    for (const status of ['queued', 'running'] as const) {
      expect(isActiveTaskStatus(status)).toBe(true);
      expect(isTerminalTaskStatus(status)).toBe(false);
    }
    for (const status of ['completed', 'failed'] as const) {
      expect(isActiveTaskStatus(status)).toBe(false);
      expect(isTerminalTaskStatus(status)).toBe(true);
    }
  });
});

describe('summarizeTaskOutput：摘要裁决', () => {
  test('空/纯空白 → 占位；短文原样；超长截断带省略号', () => {
    expect(summarizeTaskOutput('   ')).toBe('（任务完成，无文本输出）');
    expect(summarizeTaskOutput('正常输出')).toBe('正常输出');
    const long = 'a'.repeat(MAX_TASK_SUMMARY_LEN + 10);
    const summary = summarizeTaskOutput(long);
    expect(summary.length).toBe(MAX_TASK_SUMMARY_LEN + 1); // 截断 + '…'
    expect(summary.endsWith('…')).toBe(true);
  });
});

describe('dropSettledTasks：只丢终态腾位置', () => {
  test('超限时丢终态（旧→新），在办一条不丢', () => {
    const tasks: CharacterTask[] = [
      taskAt('completed', { id: 't1' }),
      taskAt('queued', { id: 't2' }),
      taskAt('failed', { id: 't3' }),
      taskAt('running', { id: 't4' }),
      taskAt('queued', { id: 't5' }),
    ];
    const kept = dropSettledTasks(tasks, 3);
    expect(kept.map((t) => t.id)).toEqual(['t2', 't4', 't5']);
  });

  test('不超限原样拷贝；全在办时一条也丢不掉（上限纪律交给调用方拒绝新派）', () => {
    const active = [taskAt('queued', { id: 't1' }), taskAt('running', { id: 't2' })];
    expect(dropSettledTasks(active, 5).map((t) => t.id)).toEqual(['t1', 't2']);
    expect(dropSettledTasks(active, 1).map((t) => t.id)).toEqual(['t1', 't2']);
  });
});

// ============================================================================
// 2. manager（真 store）
// ============================================================================

/** 带 ch-1 角色与对应单位的初始状态。 */
function seedStore(store: CoreStore): void {
  store.setState((state) => ({
    ...state,
    characters: [
      { id: 'ch-1', name: '阿尔法', persona: '冷静', level: 1, experience: 0, agentKind: 'claude-code', skinId: null, externalSessionId: null },
    ],
    units: [
      { id: 'unit_ch-1', name: '阿尔法', status: 'idle', missionId: null, power: 0, characterId: 'ch-1', skinId: null, appearance: null },
    ],
  }));
}

function makeManager(options: { readonly maxTasks?: number } = {}): { manager: ReturnType<typeof createTaskManager>; store: CoreStore } {
  const store = createStore();
  seedStore(store);
  // now 用真实时钟：通知的过期剔除走 store 自己的 Date.now()，注入假时钟会让通知一落地就被剔掉
  //（mission.test.ts 同一教训）；时间戳断言一律 expect.any(Number)。
  const manager = createTaskManager({ store, createId: (p) => `${p}_${++seq}`, maxTasks: options.maxTasks });
  return { manager, store };
}

let seq = 0;
beforeEach(() => {
  seq = 0;
});

describe('assignTask：守门 + 投影 + 事件', () => {
  test('合法入参 → WorldState.tasks 多一条 queued，发 task.queued 事件', () => {
    resetBus();
    const { manager, store } = makeManager();
    const events: string[] = [];
    const off = onWorldEvent((event) => {
      if (event.type.startsWith('task.')) events.push(event.type);
    });

    const task = manager.assignTask({ characterId: 'ch-1', prompt: '  侦察北门  ' });

    expect(task?.status).toBe('queued');
    expect(task?.prompt).toBe('侦察北门'); // trim
    expect(store.getState().tasks).toEqual([task]);
    expect(events).toEqual(['task.queued']);
    off();
  });

  test('角色不在档 → null + warn Notice，状态不动', () => {
    resetBus();
    const { manager, store } = makeManager();

    expect(manager.assignTask({ characterId: 'ghost', prompt: '干活' })).toBeNull();
    expect(store.getState().tasks ?? []).toHaveLength(0);
    expect(store.getState().notices[0]).toMatchObject({ level: 'warn', source: 'core/task' }); // notices 新的在前
  });

  test('空 prompt / 超长 prompt → null + warn Notice', () => {
    resetBus();
    const { manager, store } = makeManager();

    expect(manager.assignTask({ characterId: 'ch-1', prompt: '   ' })).toBeNull();
    expect(manager.assignTask({ characterId: 'ch-1', prompt: 'a'.repeat(MAX_TASK_PROMPT_LEN + 1) })).toBeNull();
    expect(store.getState().tasks ?? []).toHaveLength(0);
  });

  test('上限纪律：满了先丢终态历史；全在办 → 拒绝新派（任务数不破上限）', () => {
    resetBus();
    const { manager, store } = makeManager({ maxTasks: 3 });
    const a = manager.assignTask({ characterId: 'ch-1', prompt: 'A' });
    const b = manager.assignTask({ characterId: 'ch-1', prompt: 'B' });
    const c = manager.assignTask({ characterId: 'ch-1', prompt: 'C' });
    // a 收尾腾位
    manager.startTask(a!.id);
    manager.completeTask(a!.id, 'A done');
    expect(store.getState().tasks).toHaveLength(3);

    // 满员 + 一条终态 → 新派成功，终态被挤掉
    const d = manager.assignTask({ characterId: 'ch-1', prompt: 'D' });
    expect(d?.status).toBe('queued');
    expect(store.getState().tasks!.map((t) => t.id)).toEqual([b!.id, c!.id, d!.id]);

    // 全在办 → 拒绝，状态不动
    expect(manager.assignTask({ characterId: 'ch-1', prompt: 'E' })).toBeNull();
    expect(store.getState().tasks).toHaveLength(3);
  });

  // —— task_050：指定承接人（targetCharacterId）——

  test('指定承接人 → 任务直达目标角色队列（characterId = 目标），Notice 说「转派」', () => {
    resetBus();
    const store = createStore();
    store.setState((state) => ({
      ...state,
      characters: [
        { id: 'ch-1', name: '阿尔法', persona: '', level: 1, experience: 0, agentKind: 'claude-code' },
        { id: 'ch-2', name: '贝塔', persona: '', level: 1, experience: 0, agentKind: 'kimi' },
      ],
    }));
    const manager = createTaskManager({ store, createId: (p) => `${p}_${++seq}` });

    const task = manager.assignTask({ characterId: 'ch-1', prompt: '写周报', targetCharacterId: 'ch-2' });

    expect(task?.characterId).toBe('ch-2'); // 直达目标队列：不是表单角色 ch-1
    expect(store.getState().tasks?.[0]?.characterId).toBe('ch-2');
    const notice = store.getState().notices[0];
    expect(notice.level).toBe('info');
    expect(notice.text).toContain('贝塔');
    expect(notice.text).toContain('转派');
  });

  test('指定承接人不存在 → null + error Notice，状态不动（指定≠静默回落）', () => {
    resetBus();
    const { manager, store } = makeManager();

    expect(
      manager.assignTask({ characterId: 'ch-1', prompt: '干活', targetCharacterId: 'ghost' })
    ).toBeNull();
    expect(store.getState().tasks ?? []).toHaveLength(0);
    expect(store.getState().notices[0]).toMatchObject({ level: 'error', source: 'core/task' });
    expect(store.getState().notices[0].text).toContain('ghost');
  });

  test('targetCharacterId = 同一人 → 载荷最小化路径也不被拒绝（等价缺省行为）', () => {
    resetBus();
    const { manager, store } = makeManager();

    const task = manager.assignTask({ characterId: 'ch-1', prompt: '自己接', targetCharacterId: 'ch-1' });

    expect(task?.characterId).toBe('ch-1');
    expect(store.getState().tasks).toHaveLength(1);
  });
});

describe('cancelTask：排队取消（manager）', () => {
  test('queued → cancelled：状态入档 + task.cancelled 事件 + info Notice', () => {
    resetBus();
    const { manager, store } = makeManager();
    const task = manager.assignTask({ characterId: 'ch-1', prompt: '干活' });
    const events: string[] = [];
    const off = onWorldEvent((event) => {
      if (event.type.startsWith('task.')) events.push(event.type);
    });

    const outcome = manager.cancelTask(task!.id);

    expect(outcome).toMatchObject({ ok: true, task: { status: 'cancelled', output: '任务在排队时被取消' } });
    expect(store.getState().tasks![0]).toMatchObject({ status: 'cancelled' });
    expect(store.getState().tasks![0].endedAt).toEqual(expect.any(Number));
    expect(events).toEqual(['task.cancelled']); // 订阅在 assign 之后，queued 不在此窗内（同款口径）
    expect(store.getState().notices[0]).toMatchObject({ level: 'info', source: 'core/task' });
    off();
  });

  test('running → not-queued + status=running + warn Notice（提示「先停止」）', () => {
    resetBus();
    const { manager, store } = makeManager();
    const task = manager.assignTask({ characterId: 'ch-1', prompt: '干活' });
    manager.startTask(task!.id);

    const outcome = manager.cancelTask(task!.id);

    expect(outcome).toEqual({ ok: false, code: 'not-queued', status: 'running' });
    expect(store.getState().tasks![0].status).toBe('running'); // 任务继续跑，谁也没碰
    expect(store.getState().notices[0]).toMatchObject({ level: 'warn', source: 'core/task' });
    expect(store.getState().notices[0].text).toContain('先停止');
  });

  test('终态 → not-queued 幂等拒绝（重复取消不改写历史）；not-found 稳定回码', () => {
    resetBus();
    const { manager, store } = makeManager();
    const task = manager.assignTask({ characterId: 'ch-1', prompt: '干活' });
    manager.cancelTask(task!.id);

    const again = manager.cancelTask(task!.id); // 已 cancelled
    expect(again).toEqual({ ok: false, code: 'not-queued', status: 'cancelled' });

    manager.startTask(task!.id); // 终态不能再开工（取消不可逆）
    expect(manager.startTask(task!.id)).toBeNull();

    const ghost = manager.cancelTask('task_ghost');
    expect(ghost).toEqual({ ok: false, code: 'not-found', status: null });
    expect(store.getState().tasks![0].status).toBe('cancelled'); // 全程没被动过
  });
});

describe('相位推进：start / complete / fail', () => {
  test('start → running + 单位 busy + task.started；complete → 摘要入库 + 单位回收 idle', () => {
    resetBus();
    const { manager, store } = makeManager();
    const task = manager.assignTask({ characterId: 'ch-1', prompt: '干活' });
    const events: string[] = [];
    const off = onWorldEvent((event) => {
      if (event.type.startsWith('task.')) events.push(event.type);
    });

    manager.startTask(task!.id);
    expect(store.getState().tasks![0]).toMatchObject({ status: 'running', startedAt: expect.any(Number) });
    expect(store.getState().units[0].status).toBe('busy');

    manager.completeTask(task!.id, '第一行结论\n后面还有很长的全文……');
    const stored = store.getState().tasks![0];
    expect(stored.status).toBe('completed');
    expect(stored.endedAt).toEqual(expect.any(Number));
    expect(stored.output).toBe('第一行结论\n后面还有很长的全文……'); // 短文摘要=全文
    expect(store.getState().units[0].status).toBe('idle');
    expect(events).toEqual(['task.started', 'task.completed']); // 订阅在 assign 之后，queued 不在此窗内
    off();
  });

  test('fail → failed（原因进 output）+ 单位回收 idle；不再接受任何动作', () => {
    resetBus();
    const { manager, store } = makeManager();
    const task = manager.assignTask({ characterId: 'ch-1', prompt: '干活' });
    manager.startTask(task!.id);
    store.setState((state) => state); // no-op，仅为读

    manager.failTask(task!.id, '该 CLI 未安装，任务无法执行');
    expect(store.getState().tasks![0]).toMatchObject({
      status: 'failed',
      output: '该 CLI 未安装，任务无法执行',
    });
    expect(store.getState().units[0].status).toBe('idle');

    // 终态不动
    expect(manager.completeTask(task!.id, '迟到的输出')).toBeNull();
    expect(manager.startTask(task!.id)).toBeNull();
    expect(store.getState().tasks![0].status).toBe('failed');
  });

  test('不存在的任务 → null + warn Notice，状态不动', () => {
    resetBus();
    const { manager, store } = makeManager();
    const before = store.getState();
    expect(manager.startTask('task_ghost')).toBeNull();
    expect(manager.completeTask('task_ghost', 'x')).toBeNull();
    expect(manager.failTask('task_ghost', 'y')).toBeNull();
    expect(store.getState().tasks).toBe(before.tasks);
  });

  test('多任务同角色：一条收尾时另一条还在 running → 单位保持 busy', () => {
    resetBus();
    const { manager, store } = makeManager();
    const t1 = manager.assignTask({ characterId: 'ch-1', prompt: 'A' });
    const t2 = manager.assignTask({ characterId: 'ch-1', prompt: 'B' });
    manager.startTask(t1!.id);
    manager.startTask(t2!.id); // core 不假设并发 1（那是 app 层执行纪律）
    expect(store.getState().units[0].status).toBe('busy');

    manager.completeTask(t1!.id, 'A done');
    expect(store.getState().units[0].status).toBe('busy'); // t2 还在跑

    manager.completeTask(t2!.id, 'B done');
    expect(store.getState().units[0].status).toBe('idle');
  });
});

describe('syncUnitWorkingStatus（纯函数）', () => {
  const units: UnitView[] = [
    { id: 'unit_a', name: 'A', status: 'idle', missionId: null, power: 0, characterId: 'ch-a', skinId: null, appearance: null },
    { id: 'unit_b', name: 'B', status: 'idle', missionId: null, power: 0, characterId: 'ch-b', skinId: null, appearance: null },
  ];

  test('working=true → 目标单位 busy，别人不动；已在 busy 是原引用', () => {
    const next = syncUnitWorkingStatus(units, 'ch-a', true);
    expect(next[0].status).toBe('busy');
    expect(next[1]).toBe(units[1]);
    expect(syncUnitWorkingStatus(next, 'ch-a', true)).toBe(next); // 幂等不换引用
  });

  test('working=false → 只回收 busy；error/offline 是别人的真相，绝不碰', () => {
    const busy: UnitView[] = [
      { ...units[0], status: 'busy' },
      { ...units[1], status: 'error' },
    ];
    const next = syncUnitWorkingStatus(busy, 'ch-a', false);
    expect(next[0].status).toBe('idle');
    const untouched = syncUnitWorkingStatus(busy, 'ch-b', false);
    expect(untouched[1].status).toBe('error');
  });

  test('没有对应单位 → no-op（原引用）', () => {
    expect(syncUnitWorkingStatus(units, 'ch-ghost', true)).toBe(units);
  });
});

// ============================================================================
// 3. 闭环：HudCommand(task.assign) → runtime → manager → WorldState 广播
// ============================================================================

describe('命令闭环：task.assign 经真 runtime 落地', () => {
  test('emitCommand(task.assign) → tasks 入状态并广播；未接地前的老命令行为不受影响', () => {
    resetBus();
    const store = createStore();
    seedStore(store);
    const runtime = createCoreRuntime({ store });
    const stop = runtime.start();
    const states: WorldState[] = [];
    const off: Unsubscribe = onState((state) => states.push(state));

    emitCommand({ type: 'task.assign', characterId: 'ch-1', prompt: '侦察北门', missionId: 'mission-1' });

    const final = store.getState();
    expect(final.tasks).toHaveLength(1);
    expect(final.tasks![0]).toMatchObject({ characterId: 'ch-1', prompt: '侦察北门', status: 'queued', missionId: 'mission-1' });
    expect(states.length).toBeGreaterThan(0); // store 订阅广播了（runtime 的职责）
    expect(final.units[0].status).toBe('idle'); // queued 不改忙闲，running 才 busy

    // task_047：task.cancel 同口径经 runtime 落地 —— queued → cancelled，无需任何 app 层接线。
    emitCommand({ type: 'task.cancel', taskId: final.tasks![0].id });
    expect(store.getState().tasks![0].status).toBe('cancelled');

    off();
    stop();
  });

  test('task.assign 未接地时（无 runtime）不影响既有命令：ui.navigate 照常', () => {
    resetBus();
    const store = createStore();
    const runtime = createCoreRuntime({ store });
    const stop = runtime.start();

    emitCommand({ type: 'ui.navigate', screen: 'character' });
    expect(store.getState().currentScreen).toBe('character');

    stop();
  });

  // —— task_050：指定承接人经真 runtime 落地（透传链路） ——

  test('emitCommand(task.assign 带 targetCharacterId) → 任务直达目标角色队列', () => {
    resetBus();
    const store = createStore();
    seedStore(store);
    store.setState((state) => ({
      ...state,
      characters: [
        ...state.characters,
        { id: 'ch-2', name: '贝塔', persona: '', level: 1, experience: 0, agentKind: 'kimi' },
      ],
    }));
    const runtime = createCoreRuntime({ store });
    const stop = runtime.start();

    emitCommand({ type: 'task.assign', characterId: 'ch-1', prompt: '转给贝塔', targetCharacterId: 'ch-2' });

    expect(store.getState().tasks).toHaveLength(1);
    expect(store.getState().tasks![0]).toMatchObject({ characterId: 'ch-2', prompt: '转给贝塔' });

    // 不存在 → error Notice 拒绝，状态不动（命令通道 fire-and-forget，反馈靠 Notice）
    emitCommand({ type: 'task.assign', characterId: 'ch-1', prompt: '发给幽灵', targetCharacterId: 'ghost' });
    expect(store.getState().tasks).toHaveLength(1);
    expect(store.getState().notices[0]).toMatchObject({ level: 'error', source: 'core/task' });

    stop();
  });
});

// ============================================================================
// 4. 事件接地：task.* 不进 onUnhandled（消费者是 app 层 task-service / 落库订阅者）
// ============================================================================

describe('runtime 接地：task.* 生命周期事件', () => {
  test('emitWorldEvent(task.*) 不被当作未处理事件上报', () => {
    resetBus();
    const store = createStore();
    const unhandled: string[] = [];
    const runtime = createCoreRuntime({
      store,
      onUnhandled: (channel, payload) => unhandled.push(`${channel}:${payload.type}`),
    });
    const stop = runtime.start();

    const task = createQueuedTask({ id: 'task_x', characterId: 'ch-1', prompt: 'p', createdAt: 1 });
    emitCommand({ type: 'task.assign', characterId: 'ch-1', prompt: 'p' }); // 经 runtime → manager → task.queued
    // 直接注入一条 task.started / completed / failed / cancelled（等价于 app 层回报路径的事件面）
    emitWorldEvent({ type: 'task.started', task });
    emitWorldEvent({ type: 'task.completed', task });
    emitWorldEvent({ type: 'task.failed', task });
    emitWorldEvent({ type: 'task.cancelled', task });

    expect(unhandled).toEqual([]); // 一个都没进未处理
    stop();
  });
});

// ============================================================================
// 5. 与角色域的协作：character.create 建档后任务可直接派给新角色
// ============================================================================

describe('与角色域协作', () => {
  test('character.create 建档 → task.assign 立即可派（同一 runtime 上两域串联）', () => {
    resetBus();
    const store = createStore();
    const character = createCharacterManager({ store });
    const task = createTaskManager({ store, now: () => 9, createId: (p) => `${p}_x` });
    const runtime = createCoreRuntime({ store, character, task });
    const stop = runtime.start();

    emitCommand({
      type: 'character.create',
      name: '测试员',
      agentKind: 'claude-code',
      skinId: 'skin-default',
    });
    const createdId = store.getState().characters[0]?.id;
    expect(createdId).toBeTruthy();

    emitCommand({ type: 'task.assign', characterId: createdId!, prompt: '上任第一件事' });
    expect(store.getState().tasks![0]).toMatchObject({ characterId: createdId!, status: 'queued' });

    stop();
  });
});

// ============================================================================
// 审批门（task_049）：requestApproval / approve / reject 与 awaiting_approval 相位
// ============================================================================

describe('审批门状态机：running ↔ awaiting_approval → 终态', () => {
  test('requestApproval：running → awaiting_approval（plan 落档、endedAt 不盖）', () => {
    const step = apply(taskAt('running'), { type: 'requestApproval', at: 2000, plan: '一、先摸底\n二、再动手' });
    expect(step.next).toEqual(
      taskAt('awaiting_approval', { plan: '一、先摸底\n二、再动手' })
    );
    expect(step.changed).toBe(true);
  });

  test('requestApproval 只认 running：queued / awaiting / 终态一律幂等拒绝', () => {
    for (const status of ['queued', 'awaiting_approval', 'completed', 'failed', 'cancelled'] as const) {
      const step = apply(taskAt(status), { type: 'requestApproval', at: 2, plan: 'p' });
      expect(step.changed).toBe(false);
      expect(step.next.status).toBe(status);
    }
  });

  test('approve：awaiting_approval → running（startedAt 保留首开时刻，plan 留档）', () => {
    const awaiting = taskAt('awaiting_approval', { startedAt: 1500, plan: 'p' });
    const step = apply(awaiting, { type: 'approve', at: 3000 });
    expect(step.next).toEqual(taskAt('running', { startedAt: 1500, plan: 'p' }));
    expect(step.changed).toBe(true);
  });

  test('approve 只认 awaiting_approval：running / queued / 终态拒绝', () => {
    for (const status of ['queued', 'running', 'completed', 'failed', 'cancelled'] as const) {
      const step = apply(taskAt(status), { type: 'approve', at: 2 });
      expect(step.changed).toBe(false);
    }
  });

  test('reject：awaiting_approval → failed（output 写死「计划被驳回」，plan 存档）', () => {
    const awaiting = taskAt('awaiting_approval', { startedAt: 1500, plan: '计划全文' });
    const step = apply(awaiting, { type: 'reject', at: 3200 });
    expect(step.next).toEqual(
      taskAt('failed', { startedAt: 1500, endedAt: 3200, output: '计划被驳回', plan: '计划全文' })
    );
  });

  test('reject 只认 awaiting_approval；awaiting 不可 cancel（驳回才是它的出口）', () => {
    for (const status of ['queued', 'running', 'completed', 'failed', 'cancelled'] as const) {
      expect(apply(taskAt(status), { type: 'reject', at: 2 }).changed).toBe(false);
    }
    expect(apply(taskAt('awaiting_approval'), { type: 'cancel', at: 2 }).changed).toBe(false);
  });

  test('全链：running → awaiting → approve → running → completed', () => {
    let task = apply(TASK, { type: 'start', at: 1 }).next;
    task = apply(task, { type: 'requestApproval', at: 2, plan: 'p' }).next;
    expect(task.status).toBe('awaiting_approval');
    task = apply(task, { type: 'approve', at: 3 }).next;
    expect(task.status).toBe('running');
    task = apply(task, { type: 'complete', at: 4, output: 'done' }).next;
    expect(task).toMatchObject({ status: 'completed', output: 'done', plan: 'p' });
  });

  test('全链：running → awaiting → reject → failed(rejected 语义)；终态后 approve/reject 都拒', () => {
    let task = apply(TASK, { type: 'start', at: 1 }).next;
    task = apply(task, { type: 'requestApproval', at: 2, plan: 'p' }).next;
    task = apply(task, { type: 'reject', at: 3 }).next;
    expect(task).toMatchObject({ status: 'failed', output: '计划被驳回' });
    expect(apply(task, { type: 'approve', at: 4 }).changed).toBe(false);
    expect(apply(task, { type: 'reject', at: 4 }).changed).toBe(false);
  });

  test('逃生口：awaiting_approval 可被 fail 直达（挂起期外部收尾走通用失败面）', () => {
    const step = apply(taskAt('awaiting_approval'), { type: 'fail', at: 5, reason: 'r' });
    expect(step.next).toMatchObject({ status: 'failed', output: 'r' });
  });

  test('awaiting_approval 是在办相位（不占终态、不被 dropSettledTasks 淘汰）', () => {
    expect(isActiveTaskStatus('awaiting_approval')).toBe(true);
    expect(isTerminalTaskStatus('awaiting_approval')).toBe(false);
    const kept = dropSettledTasks([taskAt('awaiting_approval', { id: 't1' })], 5);
    expect(kept).toHaveLength(1);
  });

  test('capTaskPlan：超 MAX_TASK_PLAN_LEN 截断加省略号，不超原样', () => {
    const long = '计'.repeat(MAX_TASK_PLAN_LEN + 100);
    expect(capTaskPlan(long)).toBe(`${'计'.repeat(MAX_TASK_PLAN_LEN)}…`);
    expect(capTaskPlan('短计划')).toBe('短计划');
  });
});

describe('审批门 manager：requestApproval / approveTask / rejectTask', () => {
  /** 便捷：一步铺到 running。 */
  function runningTask() {
    const { manager, store } = makeManager();
    const task = manager.assignTask({ characterId: 'ch-1', prompt: '干活' });
    manager.startTask(task!.id);
    return { manager, store, task: task! };
  }

  test('requestApproval：awaiting 入状态（plan 全文）+ 单位回收 idle + task.awaiting_approval 事件 + info Notice', () => {
    resetBus();
    const { manager, store, task } = runningTask();
    const events: string[] = [];
    const off = onWorldEvent((event) => {
      if (event.type.startsWith('task.')) events.push(event.type);
    });

    const awaiting = manager.requestApproval(task.id, '一、摸底\n二、动手');
    expect(awaiting).toMatchObject({ status: 'awaiting_approval', plan: '一、摸底\n二、动手' });
    expect(store.getState().tasks![0]).toMatchObject({ status: 'awaiting_approval', plan: '一、摸底\n二、动手' });
    expect(store.getState().units[0].status).toBe('idle'); // 挂起不算忙 —— 头顶 ? 浮标是它的表现
    expect(events).toEqual(['task.awaiting_approval']);
    expect(store.getState().notices.length).toBeGreaterThan(0); // info Notice 已落（挂起不是异常）
    off();
  });

  test('requestApproval 只认 running；approveTask / rejectTask 只认 awaiting（其余 null）', () => {
    resetBus();
    const { manager } = makeManager();
    const task = manager.assignTask({ characterId: 'ch-1', prompt: '干活' });
    expect(manager.requestApproval(task!.id, 'p')).toBeNull(); // queued 不可挂起
    manager.startTask(task!.id);
    expect(manager.approveTask(task!.id)).toBeNull(); // running 不可批准
    expect(manager.rejectTask(task!.id)).toBeNull(); // running 不可驳回
  });

  test('approveTask：回 running + 单位 busy + task.approved 事件；startedAt 保留首开时刻', () => {
    resetBus();
    const { manager, store, task } = runningTask();
    const startedAt = store.getState().tasks![0].startedAt;
    manager.requestApproval(task.id, 'p');
    const events: string[] = [];
    const off = onWorldEvent((event) => {
      if (event.type.startsWith('task.')) events.push(event.type);
    });

    const resumed = manager.approveTask(task.id);
    expect(resumed).toMatchObject({ status: 'running', startedAt });
    expect(store.getState().units[0].status).toBe('busy');
    expect(events).toEqual(['task.approved']);
    expect(manager.approveTask(task.id)).toBeNull(); // 已回 running，二次批准拒绝
    off();
  });

  test('rejectTask：failed(rejected) + 单位回收 idle + task.failed 事件；plan 存档可回看', () => {
    resetBus();
    const { manager, store, task } = runningTask();
    manager.requestApproval(task.id, '被驳回的计划全文');
    const events: string[] = [];
    const off = onWorldEvent((event) => {
      if (event.type.startsWith('task.')) events.push(event.type);
    });

    const rejected = manager.rejectTask(task.id);
    expect(rejected).toMatchObject({ status: 'failed', output: '计划被驳回', plan: '被驳回的计划全文' });
    expect(store.getState().units[0].status).toBe('idle');
    expect(events).toEqual(['task.failed']);
    off();
  });

  test('awaiting 不是终态：不被腾位淘汰；挂起期间任务列表保留', () => {
    resetBus();
    const { manager, store, task } = runningTask();
    manager.requestApproval(task.id, 'p');
    expect(store.getState().tasks![0].status).toBe('awaiting_approval');
    // 再派一条新任务（守门允许 —— 腾位只在终态发生），挂起的那条还在
    const other = manager.assignTask({ characterId: 'ch-1', prompt: '另一件事' });
    expect(other).not.toBeNull();
    expect(store.getState().tasks!.some((t) => t.id === task.id && t.status === 'awaiting_approval')).toBe(true);
  });
});

describe('审批门命令闭环：task.approve / task.reject 经真 runtime 落地', () => {
  test('emitCommand(task.approve) → awaiting → running；emitCommand(task.reject) → failed', () => {
    resetBus();
    const store = createStore();
    seedStore(store);
    const runtime = createCoreRuntime({ store });
    const stop = runtime.start();

    // 经 runtime 派任务 + 手工推进到 awaiting（core 不含 IO，挂起检测在 app 层 ——
    // 这里直接调 manager 的相位口，等价于 task-service 检出标记行后的调用）；
    // manager 注入 runtime —— 命令与手工推进必须打在同一份状态上。
    const task = createTaskManager({ store, createId: (p) => `${p}_loop`, maxTasks: 10 });
    const runtime2 = createCoreRuntime({ store, task });
    const stop2 = runtime2.start();
    const assigned = task.assignTask({ characterId: 'ch-1', prompt: '干活' });
    task.startTask(assigned!.id);
    task.requestApproval(assigned!.id, '计划');
    expect(store.getState().tasks![0].status).toBe('awaiting_approval');

    emitCommand({ type: 'task.approve', taskId: assigned!.id });
    expect(store.getState().tasks![0].status).toBe('running');
    expect(store.getState().units[0].status).toBe('busy');

    // 再挂起一次走驳回分支
    task.requestApproval(assigned!.id, '计划二');
    emitCommand({ type: 'task.reject', taskId: assigned!.id });
    expect(store.getState().tasks![0]).toMatchObject({ status: 'failed', output: '计划被驳回' });

    // 相位不符的命令：状态不动（拒绝走 Notice，不改历史）
    emitCommand({ type: 'task.approve', taskId: assigned!.id });
    expect(store.getState().tasks![0].status).toBe('failed');

    stop2();
    stop();
  });
});
