/**
 * 单测：world ↔ core 双向总线桥（world/bridge/bus-adapter.ts）。
 * 覆盖验收标准中的"bus-adapter 双向联通可测（state→场景同步、场景事件→WorldEvent）"。
 *
 * 测试打的是**真实的 core/bus 单例**，而不是 mock 出来的总线：桥接层唯一的职责就是接在总线上，
 * mock 掉总线等于把被测行为一起 mock 掉了。隔离靠 resetBus()（core 自带的测试专用 API）。
 */

import {
  emitState,
  emitWorldEvent,
  onWorldEvent,
  resetBus,
  type Unsubscribe,
} from '../../core/bus';
import {
  DEFAULT_INSTANCE_ID,
  type CharacterTask,
  type ClickMods,
  type MissionView,
  type UnitView,
  type WorldEvent,
  type WorldState,
} from '../../core/types';
import {
  CAMERA_EVENT_INTERVAL_MS,
  createWorldBridge,
  type WorldScenePort,
} from '../bridge/bus-adapter';
import { createInitialState, createStore } from '../../core/store';

const NO_MODS: ClickMods = { shift: false, ctrl: false, meta: false, alt: false };

/** 记录端口收到的同步调用，用来断言 state → 场景这一半。 */
function createFakePort() {
  const unitSyncs: UnitView[][] = [];
  const selectionSyncs: string[] = [];
  const port: WorldScenePort = {
    syncUnits: (units) => void unitSyncs.push([...units]),
    syncSelection: (selection) => void selectionSyncs.push(selection.unitIds.join(',')),
  };
  return { port, unitSyncs, selectionSyncs };
}

/** 收集总线 world 通道上的事件，用来断言场景 → core 那一半。 */
function collectWorldEvents(): { events: WorldEvent[]; stop: Unsubscribe } {
  const events: WorldEvent[] = [];
  const stop = onWorldEvent((event) => events.push(event));
  return { events, stop };
}

function stateWith(patch: Partial<WorldState>): WorldState {
  return { ...createInitialState(), ...patch };
}

let clockNow = 0;
/** 可控时钟：让相机合并窗口的断言不依赖真实时间。 */
const clock = (): number => clockNow;

let stops: Unsubscribe[] = [];

beforeEach(() => {
  resetBus();
  clockNow = 0;
  stops = [];
});

afterEach(() => {
  stops.forEach((stop) => stop());
  stops = [];
  resetBus();
});

describe('state → 场景同步', () => {
  test('core 广播 state 时，单位与选择集都被推到场景', () => {
    const { port, unitSyncs, selectionSyncs } = createFakePort();
    const bridge = createWorldBridge(port, { now: clock });
    stops.push(() => bridge.destroy());

    emitState(
      stateWith({
        units: [
          { id: 'u1', name: 'A', status: 'idle', missionId: null, power: 1 },
          { id: 'u2', name: 'B', status: 'busy', missionId: 'm1', power: 2 },
        ],
        selection: { unitIds: ['u2'], previewUnitIds: [], revision: 1 },
      })
    );

    expect(unitSyncs).toHaveLength(1);
    expect(unitSyncs[0].map((u) => u.id)).toEqual(['u1', 'u2']);
    expect(selectionSyncs).toEqual(['u2']);
  });

  test('连续多次广播按顺序逐次同步（不合并、不丢最后一次）', () => {
    const { port, unitSyncs, selectionSyncs } = createFakePort();
    const bridge = createWorldBridge(port, { now: clock });
    stops.push(() => bridge.destroy());

    emitState(stateWith({ selection: { unitIds: ['a'], previewUnitIds: [], revision: 1 } }));
    emitState(stateWith({ selection: { unitIds: ['a', 'b'], previewUnitIds: [], revision: 2 } }));

    expect(unitSyncs).toHaveLength(2);
    expect(selectionSyncs).toEqual(['a', 'a,b']);
  });

  test('桥接层只做转发：units 与 selection 各自独立下发', () => {
    const { port, unitSyncs, selectionSyncs } = createFakePort();
    const bridge = createWorldBridge(port, { now: clock });
    stops.push(() => bridge.destroy());

    // 只变选择集，单位快照为空
    emitState(stateWith({ selection: { unitIds: ['x'], previewUnitIds: ['x', 'y'], revision: 3 } }));
    expect(unitSyncs[0]).toEqual([]);
    expect(selectionSyncs).toEqual(['x']);
  });

  test('destroy 之后不再同步（退订生效，场景重启不会累积监听器）', () => {
    const { port, unitSyncs } = createFakePort();
    const bridge = createWorldBridge(port, { now: clock });

    emitState(stateWith({ units: [{ id: 'u1', name: 'A', status: 'idle', missionId: null, power: 0 }] }));
    expect(unitSyncs).toHaveLength(1);

    bridge.destroy();
    emitState(stateWith({ units: [] }));
    expect(unitSyncs).toHaveLength(1); // 没有新增
  });

  test('真实 store 的状态可以经总线原样送达场景（core → bus → 场景 全链路）', () => {
    const { port, unitSyncs, selectionSyncs } = createFakePort();
    const bridge = createWorldBridge(port, { now: clock });
    stops.push(() => bridge.destroy());

    const store = createStore();
    store.subscribe(emitState);
    store.patch({ selection: { unitIds: ['u9'], previewUnitIds: [], revision: 7 } });

    expect(selectionSyncs).toEqual(['u9']);
    expect(unitSyncs).toHaveLength(1);
  });

  test('missions + tasks 一并转发（task_078：任务建筑三态与区域点亮的数据源）', () => {
    const taskSyncs: { missions: string[]; tasks: string[] }[] = [];
    const port: WorldScenePort = {
      syncUnits: () => {},
      syncSelection: () => {},
      syncTasks: (missions, tasks) =>
        void taskSyncs.push({
          missions: missions.map((mission) => mission.id),
          tasks: tasks.map((task) => `${task.id}:${task.status}`),
        }),
    };
    const bridge = createWorldBridge(port, { now: clock });
    stops.push(() => bridge.destroy());

    emitState(
      stateWith({
        missions: [
          { id: 'm1', title: '做地图', phase: 'running', unitIds: [], createdAt: 1 },
        ],
        tasks: [
          {
            id: 't1',
            characterId: 'c1',
            prompt: '铺路',
            status: 'completed',
            createdAt: 1,
            startedAt: null,
            endedAt: null,
            output: '',
            missionId: 'm1',
          },
        ],
      })
    );

    expect(taskSyncs).toHaveLength(1);
    expect(taskSyncs[0].missions).toEqual(['m1']);
    expect(taskSyncs[0].tasks).toEqual(['t1:completed']);
  });

  test('没有 missions / tasks 的旧快照也能同步（缺省按空数组转发）', () => {
    const taskSyncs: number[] = [];
    const port: WorldScenePort = {
      syncUnits: () => {},
      syncSelection: () => {},
      syncTasks: (missions, tasks) => void taskSyncs.push(missions.length + tasks.length),
    };
    const bridge = createWorldBridge(port, { now: clock });
    stops.push(() => bridge.destroy());

    const state = stateWith({});
    emitState({ ...state, missions: undefined as never, tasks: undefined as never });

    expect(taskSyncs).toEqual([0]);
  });
});

describe('场景交互 → WorldEvent', () => {
  test('unit.click 原样带上单位 id 与修饰键', () => {
    const { port } = createFakePort();
    const bridge = createWorldBridge(port, { now: clock });
    stops.push(() => bridge.destroy());
    const { events, stop } = collectWorldEvents();
    stops.push(stop);

    bridge.unitClick('u1', { shift: true, ctrl: false, meta: false, alt: false });

    expect(events).toEqual([
      { type: 'unit.click', unitId: 'u1', mods: { shift: true, ctrl: false, meta: false, alt: false } },
    ]);
  });

  test('selection.box 原样带上世界坐标矩形', () => {
    const { port } = createFakePort();
    const bridge = createWorldBridge(port, { now: clock });
    stops.push(() => bridge.destroy());
    const { events, stop } = collectWorldEvents();
    stops.push(stop);

    const bounds = { x: 10, y: 20, width: 300, height: 400 };
    bridge.selectionBox(bounds);

    expect(events).toEqual([{ type: 'selection.box', bounds }]);
  });

  test('默认修饰键也能正常上报', () => {
    const { port } = createFakePort();
    const bridge = createWorldBridge(port, { now: clock });
    stops.push(() => bridge.destroy());
    const { events, stop } = collectWorldEvents();
    stops.push(stop);

    bridge.unitClick('u2', NO_MODS);
    expect(events[0]).toMatchObject({ type: 'unit.click', unitId: 'u2' });
  });

  test('destroy 之后不再上报事件（迟到的输入不会污染 core）', () => {
    const { port } = createFakePort();
    const bridge = createWorldBridge(port, { now: clock });
    const { events, stop } = collectWorldEvents();
    stops.push(stop);

    bridge.destroy();
    bridge.unitClick('u1', NO_MODS);
    bridge.selectionBox({ x: 0, y: 0, width: 1, height: 1 });

    expect(events).toEqual([]);
  });

  test('destroy 幂等，重复调用不炸', () => {
    const { port } = createFakePort();
    const bridge = createWorldBridge(port, { now: clock });
    bridge.destroy();
    expect(() => bridge.destroy()).not.toThrow();
  });
});

describe('camera.moved 合并（perf：拖拽/滚轮不能逐帧打爆总线）', () => {
  test('合并窗口内的连续移动只广播一次', () => {
    const { port } = createFakePort();
    const bridge = createWorldBridge(port, { now: clock });
    stops.push(() => bridge.destroy());
    const { events, stop } = collectWorldEvents();
    stops.push(stop);

    bridge.cameraMoved({ x: 10, y: 10 }, 1);
    clockNow += 10;
    bridge.cameraMoved({ x: 20, y: 20 }, 1);
    clockNow += 10;
    bridge.cameraMoved({ x: 30, y: 30 }, 1);

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: 'camera.moved' });
  });

  test('flush 补发窗口内最后一次位姿（拖拽结束时位置准确）', () => {
    const { port } = createFakePort();
    const bridge = createWorldBridge(port, { now: clock });
    stops.push(() => bridge.destroy());
    const { events, stop } = collectWorldEvents();
    stops.push(stop);

    bridge.cameraMoved({ x: 10, y: 10 }, 1);
    clockNow += 10;
    bridge.cameraMoved({ x: 99, y: 99 }, 2.5);
    expect(events).toHaveLength(1);

    bridge.flushCamera();
    expect(events).toHaveLength(2);
    expect(events[1]).toEqual({ type: 'camera.moved', center: { x: 99, y: 99 }, zoom: 2.5 });
  });

  test('没有待补发内容时 flush 是空操作', () => {
    const { port } = createFakePort();
    const bridge = createWorldBridge(port, { now: clock });
    stops.push(() => bridge.destroy());
    const { events, stop } = collectWorldEvents();
    stops.push(stop);

    bridge.cameraMoved({ x: 1, y: 1 }, 1);
    bridge.flushCamera();
    expect(events).toHaveLength(1); // 首发已经发出，flush 不重复发
  });

  test('窗口走完后新事件立即放行（节流而不是丢事件）', () => {
    const { port } = createFakePort();
    const bridge = createWorldBridge(port, { now: clock });
    stops.push(() => bridge.destroy());
    const { events, stop } = collectWorldEvents();
    stops.push(stop);

    bridge.cameraMoved({ x: 1, y: 1 }, 1);
    clockNow += CAMERA_EVENT_INTERVAL_MS;
    bridge.cameraMoved({ x: 2, y: 2 }, 1);

    expect(events).toHaveLength(2);
  });

  test('destroy 丢弃待补发的相机事件（不为已死场景再发一次）', () => {
    const { port } = createFakePort();
    const bridge = createWorldBridge(port, { now: clock });
    const { events, stop } = collectWorldEvents();
    stops.push(stop);

    bridge.cameraMoved({ x: 1, y: 1 }, 1);
    clockNow += 5;
    bridge.cameraMoved({ x: 2, y: 2 }, 1);
    bridge.destroy();
    bridge.flushCamera();

    expect(events).toHaveLength(1);
  });
});

// ============================================================================
// unit.position 出口（@since v3.12，task_033）：场景落位 → WorldEvent
// ============================================================================

describe('场景 → core：unit.position', () => {
  test('unitPosition 转成 unit.position 事件发回 core', () => {
    const { port } = createFakePort();
    const bridge = createWorldBridge(port, { now: clock });
    stops.push(() => bridge.destroy());
    const { events, stop } = collectWorldEvents();
    stops.push(stop);

    bridge.unitPosition('unit_character_1', 100, -40);

    expect(events).toEqual([{ type: 'unit.position', unitId: 'unit_character_1', x: 100, y: -40 }]);
  });

  test('destroy 后的迟到上报被丢弃（不为已死场景再发一次）', () => {
    const { port } = createFakePort();
    const bridge = createWorldBridge(port, { now: clock });
    const { events, stop } = collectWorldEvents();
    stops.push(stop);

    bridge.destroy();
    bridge.unitPosition('unit_character_1', 1, 2);

    expect(events).toHaveLength(0);
  });
});

// ============================================================================
// task.* 生命周期转发（@since v3.17，task_038）：world 通道 → 场景表现钩子
// ============================================================================

describe('任务生命周期 → syncTaskEvent 转发', () => {
  interface TaskPortCall {
    readonly taskId: string;
    readonly characterId: string;
    readonly phase: string;
  }

  function createTaskPort() {
    const calls: TaskPortCall[] = [];
    const port: WorldScenePort = {
      syncUnits: () => {},
      syncSelection: () => {},
      syncTaskEvent: (task, phase) => {
        calls.push({ taskId: task.id, characterId: task.characterId, phase });
      },
    };
    return { port, calls };
  }

  const task = (id: string, status: 'queued' | 'running' | 'completed' | 'failed') => ({
    id,
    characterId: 'ch-a',
    prompt: '干活',
    status,
    createdAt: 1,
    startedAt: null,
    endedAt: null,
    output: '',
  });

  test('started / completed / failed 三条转发给 syncTaskEvent，任务快照原样带走', () => {
    const { port, calls } = createTaskPort();
    const bridge = createWorldBridge(port, { now: clock });
    stops.push(() => bridge.destroy());

    emitWorldEvent({ type: 'task.started', task: task('t1', 'running') });
    emitWorldEvent({ type: 'task.completed', task: task('t1', 'completed') });
    emitWorldEvent({ type: 'task.failed', task: task('t2', 'failed') });

    expect(calls).toEqual([
      { taskId: 't1', characterId: 'ch-a', phase: 'started' },
      { taskId: 't1', characterId: 'ch-a', phase: 'completed' },
      { taskId: 't2', characterId: 'ch-a', phase: 'failed' },
    ]);
  });

  test('task.queued 不转发（还没轮到它动）；场景事件照旧直通不受影响', () => {
    const { port, calls } = createTaskPort();
    const bridge = createWorldBridge(port, { now: clock });
    stops.push(() => bridge.destroy());
    const { events, stop } = collectWorldEvents();
    stops.push(stop);

    emitWorldEvent({ type: 'task.queued', task: task('t0', 'queued') });
    expect(calls).toHaveLength(0);

    bridge.unitClick('u1', NO_MODS);
    // 收集器同在 world 通道上（task.queued 也会被它收到），只断言场景上报的那条原样直通。
    expect(events.filter((event) => event.type === 'unit.click')).toEqual([
      { type: 'unit.click', unitId: 'u1', mods: NO_MODS },
    ]);
  });

  test('port 不实现 syncTaskEvent（可选钩子）：任务事件安静跳过，不炸不报', () => {
    const { port } = createFakePort(); // 老桩：没有 syncTaskEvent
    const bridge = createWorldBridge(port, { now: clock });
    stops.push(() => bridge.destroy());

    expect(() => {
      emitWorldEvent({ type: 'task.started', task: task('t1', 'running') });
    }).not.toThrow();
  });

  test('destroy 之后任务事件不再进场景（退订生效）', () => {
    const { port, calls } = createTaskPort();
    const bridge = createWorldBridge(port, { now: clock });

    bridge.destroy();
    emitWorldEvent({ type: 'task.started', task: task('t1', 'running') });

    expect(calls).toHaveLength(0);
  });
});

// ============================================================================
// unit.move 出口 & unit.position 转发（@since v3.21，task_045）
// ============================================================================

describe('场景 → core：unit.move（右击移动指令）', () => {
  test('unitMove 转成 unit.move 事件（world → core 铁律：世界层不发 HudCommand）', () => {
    const { port } = createFakePort();
    const bridge = createWorldBridge(port, { now: clock });
    stops.push(() => bridge.destroy());
    const { events, stop } = collectWorldEvents();
    stops.push(stop);

    bridge.unitMove(['u1', 'u2'], 320, -60);

    expect(events).toEqual([{ type: 'unit.move', unitIds: ['u1', 'u2'], x: 320, y: -60 }]);
  });

  test('destroy 后的迟到指令被丢弃（不为已死场景再发一次）', () => {
    const { port } = createFakePort();
    const bridge = createWorldBridge(port, { now: clock });
    const { events, stop } = collectWorldEvents();
    stops.push(stop);

    bridge.destroy();
    bridge.unitMove(['u1'], 0, 0);

    expect(events).toHaveLength(0);
  });

  test('selectionBox 携带命中 id 与加选标志（框选闭环：判定在 world，id 补在事件上）', () => {
    const { port } = createFakePort();
    const bridge = createWorldBridge(port, { now: clock });
    stops.push(() => bridge.destroy());
    const { events, stop } = collectWorldEvents();
    stops.push(stop);

    const bounds = { x: 10, y: 20, width: 300, height: 400 };
    bridge.selectionBox(bounds, ['u2', 'u3'], true);

    expect(events).toEqual([
      { type: 'selection.box', bounds, unitIds: ['u2', 'u3'], additive: true },
    ]);
  });

  test('selectionBox 不带命中 id → 保持老事件形状（兼容 dev 观测 / 老调用方）', () => {
    const { port } = createFakePort();
    const bridge = createWorldBridge(port, { now: clock });
    stops.push(() => bridge.destroy());
    const { events, stop } = collectWorldEvents();
    stops.push(stop);

    bridge.selectionBox({ x: 0, y: 0, width: 5, height: 5 });

    expect(events).toEqual([{ type: 'selection.box', bounds: { x: 0, y: 0, width: 5, height: 5 } }]);
  });
});

describe('world 通道 → 场景：unit.position 转发（右击移动的编队终值 → 场景 tween）', () => {
  function createPositionPort() {
    const calls: { unitId: string; x: number; y: number }[] = [];
    const port: WorldScenePort = {
      syncUnits: () => {},
      syncSelection: () => {},
      syncUnitPosition: (unitId, x, y) => calls.push({ unitId, x, y }),
    };
    return { port, calls };
  }

  test('runtime 广播的 unit.position 转发给 syncUnitPosition', () => {
    const { port, calls } = createPositionPort();
    const bridge = createWorldBridge(port, { now: clock });
    stops.push(() => bridge.destroy());

    emitWorldEvent({ type: 'unit.position', unitId: 'unit_ch_1', x: 480, y: -120 });

    expect(calls).toEqual([{ unitId: 'unit_ch_1', x: 480, y: -120 }]);
  });

  test('port 不实现 syncUnitPosition（可选钩子）：安静跳过，不炸不报', () => {
    const { port } = createFakePort(); // 老桩：没有 syncUnitPosition
    const bridge = createWorldBridge(port, { now: clock });
    stops.push(() => bridge.destroy());

    expect(() => {
      emitWorldEvent({ type: 'unit.position', unitId: 'u1', x: 1, y: 2 });
    }).not.toThrow();
  });

  test('destroy 之后不再转发（场景已死，不为它驱动 tween）', () => {
    const { port, calls } = createPositionPort();
    const bridge = createWorldBridge(port, { now: clock });

    bridge.destroy();
    emitWorldEvent({ type: 'unit.position', unitId: 'u1', x: 1, y: 2 });

    expect(calls).toHaveLength(0);
  });
});

// ============================================================================
// world 通道 → 场景：camera.center 转发（@since v3.33，task_057）
// 小地图跳转：HudCommand 同名命令经 core 钳制后转发到 world 通道，桥接层把它递给
// syncCameraCenter（场景把相机对中到目标世界点）。
// ============================================================================

describe('world 通道 → 场景：camera.center 转发（小地图跳转）', () => {
  function createCameraPort() {
    const calls: { x: number; y: number }[] = [];
    const port: WorldScenePort = {
      syncUnits: () => {},
      syncSelection: () => {},
      syncCameraCenter: (x, y) => calls.push({ x, y }),
    };
    return { port, calls };
  }

  test('core 转发的 camera.center 递给 syncCameraCenter', () => {
    const { port, calls } = createCameraPort();
    const bridge = createWorldBridge(port, { now: clock });
    stops.push(() => bridge.destroy());

    emitWorldEvent({ type: 'camera.center', x: 1600, y: 1200 });

    expect(calls).toEqual([{ x: 1600, y: 1200 }]);
  });

  test('port 不实现 syncCameraCenter（可选钩子）：安静跳过，不炸不报', () => {
    const { port } = createFakePort(); // 老桩：没有 syncCameraCenter
    const bridge = createWorldBridge(port, { now: clock });
    stops.push(() => bridge.destroy());

    expect(() => {
      emitWorldEvent({ type: 'camera.center', x: 1, y: 2 });
    }).not.toThrow();
  });

  test('destroy 之后不再转发（场景已死，不为它挪相机）', () => {
    const { port, calls } = createCameraPort();
    const bridge = createWorldBridge(port, { now: clock });

    bridge.destroy();
    emitWorldEvent({ type: 'camera.center', x: 1, y: 2 });

    expect(calls).toHaveLength(0);
  });
});

// ============================================================================
// world 通道 → 场景：unit.speaking 转发（@since v3.37，task_062）
// chat 流式期间 app 层发出的说话标志位 → syncUnitSpeaking（场景头顶「···」气泡起止）。
// ============================================================================

describe('world 通道 → 场景：unit.speaking 转发（说话气泡，task_062）', () => {
  function createSpeakingPort() {
    const calls: { unitId: string; speaking: boolean }[] = [];
    const port: WorldScenePort = {
      syncUnits: () => {},
      syncSelection: () => {},
      syncUnitSpeaking: (unitId, speaking) => calls.push({ unitId, speaking }),
    };
    return { port, calls };
  }

  test('app 层广播的 unit.speaking 递给 syncUnitSpeaking（起止各一条）', () => {
    const { port, calls } = createSpeakingPort();
    const bridge = createWorldBridge(port, { now: clock });
    stops.push(() => bridge.destroy());

    emitWorldEvent({ type: 'unit.speaking', unitId: 'unit_ch_1', speaking: true });
    emitWorldEvent({ type: 'unit.speaking', unitId: 'unit_ch_1', speaking: false });

    expect(calls).toEqual([
      { unitId: 'unit_ch_1', speaking: true },
      { unitId: 'unit_ch_1', speaking: false },
    ]);
  });

  test('port 不实现 syncUnitSpeaking（可选钩子）：安静跳过，不炸不报', () => {
    const { port } = createFakePort(); // 老桩：没有 syncUnitSpeaking
    const bridge = createWorldBridge(port, { now: clock });
    stops.push(() => bridge.destroy());

    expect(() => {
      emitWorldEvent({ type: 'unit.speaking', unitId: 'u1', speaking: true });
    }).not.toThrow();
  });

  test('destroy 之后不再转发（场景已死，不为它挂气泡）', () => {
    const { port, calls } = createSpeakingPort();
    const bridge = createWorldBridge(port, { now: clock });

    bridge.destroy();
    emitWorldEvent({ type: 'unit.speaking', unitId: 'u1', speaking: true });

    expect(calls).toHaveLength(0);
  });
});

// ============================================================================
// 导演模式接线（@since v3.3，task_081）：任务事件 → 导演镜头；导演开关 → 场景
// ============================================================================

describe('导演模式接线（task_081）', () => {
  const task = (id: string, status: 'queued' | 'running' | 'completed' | 'failed') => ({
    id,
    characterId: 'ch-a',
    prompt: '干活',
    status,
    createdAt: 1,
    startedAt: null,
    endedAt: null,
    output: '',
  });

  test('开工 / 完成 / 报错三条转发给 syncDirectorEvent（导演据此编排镜头）', () => {
    const calls: { kind: string; taskId: string }[] = [];
    const port: WorldScenePort = {
      syncUnits: () => {},
      syncSelection: () => {},
      syncDirectorEvent: (t, kind) => calls.push({ kind, taskId: t.id }),
    };
    const bridge = createWorldBridge(port, { now: clock });
    stops.push(() => bridge.destroy());

    emitWorldEvent({ type: 'task.started', task: task('t1', 'running') });
    emitWorldEvent({ type: 'task.completed', task: task('t2', 'completed') });
    emitWorldEvent({ type: 'task.failed', task: task('t3', 'failed') });

    expect(calls).toEqual([
      { kind: 'started', taskId: 't1' },
      { kind: 'completed', taskId: 't2' },
      { kind: 'failed', taskId: 't3' },
    ]);
  });

  test('派活（task.queued）不惊动导演（还没落到人身上，没有镜头可对）', () => {
    const calls: string[] = [];
    const port: WorldScenePort = {
      syncUnits: () => {},
      syncSelection: () => {},
      syncDirectorEvent: (_t, kind) => calls.push(kind),
    };
    const bridge = createWorldBridge(port, { now: clock });
    stops.push(() => bridge.destroy());

    emitWorldEvent({ type: 'task.queued', task: task('t0', 'queued') });

    expect(calls).toHaveLength(0);
  });

  test('camera.director 事件转发给 syncDirectorMode（core → world 的落位指令）', () => {
    const calls: boolean[] = [];
    const port: WorldScenePort = {
      syncUnits: () => {},
      syncSelection: () => {},
      syncDirectorMode: (enabled) => calls.push(enabled),
    };
    const bridge = createWorldBridge(port, { now: clock });
    stops.push(() => bridge.destroy());

    emitWorldEvent({ type: 'camera.director', enabled: true });
    emitWorldEvent({ type: 'camera.director', enabled: false });

    expect(calls).toEqual([true, false]);
  });

  test('场景手动介入时 directorMode(false) 发出 camera.director 事件（world → core）', () => {
    const { port } = createFakePort();
    const bridge = createWorldBridge(port, { now: clock });
    stops.push(() => bridge.destroy());
    const { events, stop } = collectWorldEvents();
    stops.push(stop);

    bridge.directorMode(false);

    expect(events.filter((event) => event.type === 'camera.director')).toEqual([
      { type: 'camera.director', enabled: false },
    ]);
  });

  test('port 不实现导演钩子（可选成员）：安静跳过，不炸不报', () => {
    const { port } = createFakePort(); // 老桩：没有导演钩子
    const bridge = createWorldBridge(port, { now: clock });
    stops.push(() => bridge.destroy());

    expect(() => {
      emitWorldEvent({ type: 'task.started', task: task('t1', 'running') });
      emitWorldEvent({ type: 'camera.director', enabled: true });
    }).not.toThrow();
  });
});

// ============================================================================
// scope 感知转发：bridge 按 instanceId 过滤（@since v3.3，task_184 / M1-10）
//   验收（design §7.1 M1-10 行）：
//     ① 转发给场景的 units / missions / tasks **全部**属于当前 instance；
//     ② WorldScenePort 接口签名**未变**（HUD / world 的测试夹具不破）；
//     ③ 切副本后下一次同步不再带旧 instance 的实体。
// ============================================================================

describe('bridge 按 instanceId 过滤（task_184 / M1-10）', () => {
  const INSTANCE_A = 'wsp_a';
  const INSTANCE_B = 'wsp_b';

  interface ScopeSync {
    readonly missions: MissionView[];
    readonly tasks: CharacterTask[];
  }

  function createScopePort() {
    const unitSyncs: UnitView[][] = [];
    const taskSyncs: ScopeSync[] = [];
    const taskEventIds: string[] = [];
    const port: WorldScenePort = {
      syncUnits: (units) => void unitSyncs.push([...units]),
      syncSelection: () => {},
      syncTasks: (missions, tasks) => void taskSyncs.push({ missions: [...missions], tasks: [...tasks] }),
      syncTaskEvent: (task) => void taskEventIds.push(task.id),
    };
    return { port, unitSyncs, taskSyncs, taskEventIds };
  }

  const unit = (id: string, instanceId?: string | null): UnitView => ({
    id,
    name: id,
    status: 'idle',
    missionId: null,
    power: 0,
    instanceId,
  });

  const mission = (id: string, instanceId?: string | null): MissionView => ({
    id,
    title: id,
    phase: 'running',
    unitIds: [],
    createdAt: 1,
    instanceId,
  });

  const task = (id: string, instanceId?: string | null): CharacterTask => ({
    id,
    characterId: 'ch-a',
    prompt: '干活',
    status: 'running',
    createdAt: 1,
    startedAt: 1,
    endedAt: null,
    output: '',
    instanceId,
  });

  test('① 转发给场景的单位只含当前 instance 的', () => {
    const { port, unitSyncs } = createScopePort();
    const bridge = createWorldBridge(port, { now: clock });
    stops.push(() => bridge.destroy());

    emitState(
      stateWith({
        activeInstanceId: INSTANCE_B,
        units: [unit('u-a', INSTANCE_A), unit('u-b', INSTANCE_B)],
      })
    );

    expect(unitSyncs).toHaveLength(1);
    expect(unitSyncs[0].map((u) => u.id)).toEqual(['u-b']);
  });

  test('① missions / tasks 同样按当前 instance 过滤', () => {
    const { port, taskSyncs } = createScopePort();
    const bridge = createWorldBridge(port, { now: clock });
    stops.push(() => bridge.destroy());

    emitState(
      stateWith({
        activeInstanceId: INSTANCE_A,
        missions: [mission('m-a', INSTANCE_A), mission('m-b', INSTANCE_B)],
        tasks: [task('t-a', INSTANCE_A), task('t-b', INSTANCE_B)],
      })
    );

    expect(taskSyncs).toHaveLength(1);
    expect(taskSyncs[0].missions.map((m) => m.id)).toEqual(['m-a']);
    expect(taskSyncs[0].tasks.map((t) => t.id)).toEqual(['t-a']);
  });

  test('③ 切副本后下一次同步不再带旧 instance 的实体', () => {
    const { port, unitSyncs, taskSyncs } = createScopePort();
    const bridge = createWorldBridge(port, { now: clock });
    stops.push(() => bridge.destroy());

    emitState(
      stateWith({
        activeInstanceId: INSTANCE_A,
        units: [unit('u-a', INSTANCE_A)],
        missions: [mission('m-a', INSTANCE_A)],
        tasks: [task('t-a', INSTANCE_A)],
      })
    );
    emitState(
      stateWith({
        activeInstanceId: INSTANCE_B,
        units: [unit('u-a', INSTANCE_A), unit('u-b', INSTANCE_B)],
        missions: [mission('m-a', INSTANCE_A), mission('m-b', INSTANCE_B)],
        tasks: [task('t-a', INSTANCE_A), task('t-b', INSTANCE_B)],
      })
    );

    expect(unitSyncs).toHaveLength(2);
    expect(unitSyncs[1].map((u) => u.id)).toEqual(['u-b']);
    expect(taskSyncs[1].missions.map((m) => m.id)).toEqual(['m-b']);
    expect(taskSyncs[1].tasks.map((t) => t.id)).toEqual(['t-b']);
  });

  test('未打标的实体归默认沙盒（COALESCE 口径）：还没进副本时老数据照常可见', () => {
    const { port, unitSyncs } = createScopePort();
    const bridge = createWorldBridge(port, { now: clock });
    stops.push(() => bridge.destroy());

    emitState(stateWith({ units: [unit('u-old')] }));

    expect(unitSyncs[0].map((u) => u.id)).toEqual(['u-old']);
  });

  test('显式属于别的副本的实体在默认沙盒视角下不可见（不会被顺手带进来）', () => {
    const { port, unitSyncs } = createScopePort();
    const bridge = createWorldBridge(port, { now: clock });
    stops.push(() => bridge.destroy());

    emitState(
      stateWith({
        activeInstanceId: DEFAULT_INSTANCE_ID,
        units: [unit('u-old'), unit('u-b', INSTANCE_B)],
      })
    );

    expect(unitSyncs[0].map((u) => u.id)).toEqual(['u-old']);
  });

  test('② 端口签名未变：只实现 syncUnits / syncSelection 的最小夹具照常工作', () => {
    const unitSyncs: UnitView[][] = [];
    const minimalPort: WorldScenePort = {
      syncUnits: (units) => void unitSyncs.push([...units]),
      syncSelection: () => {},
    };
    const bridge = createWorldBridge(minimalPort, { now: clock });
    stops.push(() => bridge.destroy());

    emitState(
      stateWith({
        activeInstanceId: INSTANCE_B,
        units: [unit('u-a', INSTANCE_A), unit('u-b', INSTANCE_B)],
      })
    );

    expect(unitSyncs[0].map((u) => u.id)).toEqual(['u-b']);
  });

  test('任务事件也按 scope 过滤：切副本后旧副本的任务事件不再驱动场景', () => {
    const { port, taskEventIds } = createScopePort();
    const bridge = createWorldBridge(port, { now: clock });
    stops.push(() => bridge.destroy());

    emitState(stateWith({ activeInstanceId: INSTANCE_B }));
    emitWorldEvent({ type: 'task.started', task: task('t-a', INSTANCE_A) });
    emitWorldEvent({ type: 'task.started', task: task('t-b', INSTANCE_B) });

    expect(taskEventIds).toEqual(['t-b']);
  });
});
