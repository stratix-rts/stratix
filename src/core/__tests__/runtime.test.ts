/**
 * 单测：core 运行时（core/runtime.ts）—— 把 HudCommand / WorldEvent 翻译成选择集变更，
 * 并把 store 变更广播到 state 通道。
 *
 * 测试打的是**真实的 core/bus 单例 + 真实 store**，不是 mock：runtime 的全部职责就是"接在总线上"，
 * mock 掉总线等于把被测行为一起 mock 掉了。隔离靠 resetBus() 与每个用例新建的 createStore()。
 */

import { emitCommand, emitWorldEvent, onState, onWorldEvent, resetBus, type Unsubscribe } from '../bus';
import { createCoreRuntime, type CoreRuntime, type UnhandledChannel } from '../runtime';
import { createStore, type CoreStore } from '../store';
import type { UnitView, WorldEvent, WorldState } from '../types';

const NO_MODS = { shift: false, ctrl: false, meta: false, alt: false };

const UNITS: UnitView[] = [
  { id: 'u1', name: 'Neo', status: 'idle', missionId: null, power: 3 },
  { id: 'u2', name: 'Trinity', status: 'busy', missionId: null, power: 5 },
  { id: 'u3', name: 'Morpheus', status: 'idle', missionId: null, power: 4 },
];

interface Harness {
  runtime: CoreRuntime;
  store: CoreStore;
  states: WorldState[];
  unhandled: { channel: UnhandledChannel; type: string }[];
  stop: () => void;
}

function harness(): Harness {
  const store = createStore({ units: UNITS });
  const states: WorldState[] = [];
  const unhandled: { channel: UnhandledChannel; type: string }[] = [];
  const offState: Unsubscribe = onState((state) => states.push(state));
  const runtime = createCoreRuntime({
    store,
    onUnhandled: (channel, payload) => unhandled.push({ channel, type: payload.type }),
  });
  const stop = runtime.start();
  return { runtime, store, states, unhandled, stop: () => { stop(); offState(); } };
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

describe('HudCommand → 选择状态机 → store → state 广播', () => {
  test('unit.select(set) 写入选择集并广播新快照', () => {
    const { store, states, stop } = harness();
    cleanups.push(stop);

    emitCommand({ type: 'unit.select', unitIds: ['u2'], mode: 'set' });

    expect(store.getState().selection.unitIds).toEqual(['u2']);
    expect(states).toHaveLength(1);
    expect(states[0].selection.unitIds).toEqual(['u2']);
    expect(states[0].selection.revision).toBe(1);
  });

  test('unit.select(toggle) 在集合内取消、在集合外加入', () => {
    const { store, stop } = harness();
    cleanups.push(stop);

    emitCommand({ type: 'unit.select', unitIds: ['u1'], mode: 'set' });
    emitCommand({ type: 'unit.select', unitIds: ['u1'], mode: 'toggle' });
    expect(store.getState().selection.unitIds).toEqual([]);

    emitCommand({ type: 'unit.select', unitIds: ['u3'], mode: 'toggle' });
    expect(store.getState().selection.unitIds).toEqual(['u3']);
  });

  test('选择集不含已知单位之外的对象：悬空 id 被对账丢弃', () => {
    const { store, states, stop } = harness();
    cleanups.push(stop);

    emitCommand({ type: 'unit.select', unitIds: ['u2', 'ghost'], mode: 'set' });

    expect(store.getState().selection.unitIds).toEqual(['u2']);
    // 一次用户操作只广播一次（动作 + 对账合并在同一次 setState，perf：广播有成本）
    expect(states).toHaveLength(1);
  });

  test('选择集实质未变时既不改状态也不广播', () => {
    const { states, stop } = harness();
    cleanups.push(stop);

    emitCommand({ type: 'unit.select', unitIds: ['u1'], mode: 'set' });
    emitCommand({ type: 'unit.select', unitIds: ['u1'], mode: 'set' });

    expect(states).toHaveLength(1);
  });
});

describe('WorldEvent → 选择状态机（world → core 那一半）', () => {
  test('unit.click 无修饰键 = 覆盖选择', () => {
    const { store, stop } = harness();
    cleanups.push(stop);

    emitCommand({ type: 'unit.select', unitIds: ['u1'], mode: 'set' });
    emitWorldEvent({ type: 'unit.click', unitId: 'u2', mods: NO_MODS });

    expect(store.getState().selection.unitIds).toEqual(['u2']);
  });

  test('Shift / Ctrl / ⌘ 点击 = 切换该单位是否在选择集内', () => {
    for (const key of ['shift', 'ctrl', 'meta'] as const) {
      const { store, stop } = harness();
      cleanups.push(stop);

      emitCommand({ type: 'unit.select', unitIds: ['u1'], mode: 'set' });
      emitWorldEvent({ type: 'unit.click', unitId: 'u3', mods: { ...NO_MODS, [key]: true } });
      expect(store.getState().selection.unitIds).toEqual(['u1', 'u3']);

      emitWorldEvent({ type: 'unit.click', unitId: 'u3', mods: { ...NO_MODS, [key]: true } });
      expect(store.getState().selection.unitIds).toEqual(['u1']);
    }
  });

  test('点击已消失的单位不会让悬空 id 进入选择集', () => {
    const { store, stop } = harness();
    cleanups.push(stop);

    emitWorldEvent({ type: 'unit.click', unitId: 'ghost', mods: NO_MODS });

    expect(store.getState().selection.unitIds).toEqual([]);
  });
});

describe('未落地的消息走 onUnhandled（不静默吞掉）', () => {
  test('Phase 2 才接的命令被上报，不改动状态；已接线的 ui.navigate 不再上报', () => {
    const { unhandled, store, states, stop } = harness();
    cleanups.push(stop);

    // @since v3.6 ui.navigate 已落库（写 currentScreen）；不再是"未落地"。
    emitCommand({ type: 'ui.navigate', screen: 'settings' });
    emitCommand({ type: 'chat.send', text: 'hi' });

    expect(unhandled).toEqual([
      { channel: 'command', type: 'chat.send' },
    ]);
    // ui.navigate → setCurrentScreen('settings') 会触发一次 state 广播。
    expect(states).toHaveLength(1);
    expect(states[0].currentScreen).toBe('settings');
    expect(store.getState().selection.unitIds).toEqual([]);
  });
});

describe('ui.navigate → currentScreen（@since v3.6）', () => {
  test('导航到 settings/character：写入 store.currentScreen 并广播', () => {
    const { store, states, stop } = harness();
    cleanups.push(stop);

    emitCommand({ type: 'ui.navigate', screen: 'character' });
    expect(store.getState().currentScreen).toBe('character');
    expect(states.at(-1)?.currentScreen).toBe('character');

    emitCommand({ type: 'ui.navigate', screen: 'settings' });
    expect(store.getState().currentScreen).toBe('settings');

    stop();
  });

  test('导航到 main：清空 currentScreen（缺省回落读取方自管），仍广播一次', () => {
    const { store, states, stop } = harness();
    cleanups.push(stop);

    // 先切到 character
    emitCommand({ type: 'ui.navigate', screen: 'character' });
    expect(store.getState().currentScreen).toBe('character');
    // 再回 main
    emitCommand({ type: 'ui.navigate', screen: 'main' });
    expect(store.getState().currentScreen).toBeUndefined();
    expect(states).toHaveLength(2);
  });

  test('导航到 chat：不写 currentScreen（chat 由抽屈自治）；也不广播', () => {
    const { store, states, stop } = harness();
    cleanups.push(stop);

    emitCommand({ type: 'ui.navigate', screen: 'chat' });
    // 'chat' 由 core 解释为打开抽屈 —— 不入 currentScreen。
    expect(store.getState().currentScreen).toBeUndefined();
    expect(states).toHaveLength(0);
  });

  test('同一屏位重复导航不广播（store 引用未变即不广播约定）', () => {
    const { states, stop } = harness();
    cleanups.push(stop);

    emitCommand({ type: 'ui.navigate', screen: 'settings' });
    emitCommand({ type: 'ui.navigate', screen: 'settings' });

    expect(states).toHaveLength(1);
  });

  test('core 算不出坐标的 world 事件被上报而不是硬算', () => {
    const { unhandled, stop } = harness();
    cleanups.push(stop);

    emitWorldEvent({ type: 'selection.box', bounds: { x: 0, y: 0, width: 100, height: 100 } });
    emitWorldEvent({ type: 'camera.moved', center: { x: 1, y: 2 }, zoom: 1.5 });

    expect(unhandled).toEqual([
      { channel: 'world', type: 'selection.box' },
      { channel: 'world', type: 'camera.moved' },
    ]);
  });
});

describe('生命周期', () => {
  test('stop 之后不再响应命令，也不再广播（监听器必须可清理）', () => {
    const { runtime, states, stop } = harness();
    cleanups.push(stop);

    emitCommand({ type: 'unit.select', unitIds: ['u1'], mode: 'set' });
    expect(states).toHaveLength(1);

    runtime.start()(); // 再次 start 拿到的是同一个 stop
    expect(runtime.running).toBe(false);

    emitCommand({ type: 'unit.select', unitIds: ['u3'], mode: 'set' });
    expect(states).toHaveLength(1);
    expect(runtime.store.getState().selection.unitIds).toEqual(['u1']);
  });

  test('重复 start 不会叠加订阅', () => {
    const { runtime, states, stop } = harness();
    cleanups.push(stop);

    runtime.start();
    runtime.start();

    emitCommand({ type: 'unit.select', unitIds: ['u1'], mode: 'set' });

    // 叠加订阅会让这一次点击广播出两份 state；这里断言只有一份
    expect(states).toHaveLength(1);
  });
});
// ============================================================================
// unit.position 接地（@since v3.12，task_033）：core 状态机不消费坐标，
// 但显式接地不进 onUnhandled —— 消费者是 app 层持久化订阅者。
// ============================================================================

describe('world 事件：unit.position', () => {
  test('不被当作未处理事件上报', () => {
    const { unhandled, stop } = harness();
    cleanups.push(stop);

    emitWorldEvent({ type: 'unit.position', unitId: 'unit_u1', x: 10, y: 20 });

    expect(unhandled).toHaveLength(0);
  });
});

// ============================================================================
// exp.gained 接地（@since v3.18，task_039）：app 层发射的经验事件，task_040 起
// 由 app 层 progression-service 消费（经 character manager 累加进 store，core 状态机
// 不碰）—— 同 unit.position 惯例显式接地，不进 onUnhandled（否则每次任务收尾/对话轮都是一条噪音）。
// ============================================================================

describe('world 事件：exp.gained（task_039）', () => {
  test('不进 onUnhandled，也不改任何状态（消费归 app 层 progression-service，task_040）', () => {
    const { unhandled, states, stop } = harness();
    cleanups.push(stop);

    emitWorldEvent({ type: 'exp.gained', characterId: 'ch-1', source: 'chat_round', amount: 5 });

    expect(unhandled).toHaveLength(0);
    expect(states).toHaveLength(0); // core 只接地：累加/结算在 app 层 progression-service 里做
  });
});

// ============================================================================
// level.up 接地（@since v3.19，task_040）：progression-service 发出的升级广播，
// 消费者是 UI 反馈（041）—— 等级真相在 characters 且已先行落库，core 状态机不消费，
// 同惯例显式接地，不进 onUnhandled（否则每次升级都是一条噪音）。
// ============================================================================

describe('world 事件：level.up（task_040）', () => {
  test('不进 onUnhandled，也不改任何状态（观察面事件，真相在 characters）', () => {
    const { unhandled, states, stop } = harness();
    cleanups.push(stop);

    emitWorldEvent({ type: 'level.up', characterId: 'ch-1', fromLevel: 2, toLevel: 4 });

    expect(unhandled).toHaveLength(0);
    expect(states).toHaveLength(0);
  });
});

// ============================================================================
// unit.move（@since v3.21，task_045）：编队落位 → unit.position 终值广播。
// 集成链路断言：move 命令 → 过滤已知单位 → core/unit/formation 网格终值 →
// 逐单位 unit.position 广播（世界层 tween 与 app 层 task_033 防抖落库消费同一条事件，
// 落库跟随自动成立 —— 位置立即生效于状态，动画只是渲染过渡）。
// ============================================================================

describe('HudCommand unit.move：命令 → 编队终值 → unit.position 广播', () => {
  interface PositionEvent {
    readonly type: string;
    readonly unitId: string;
    readonly x: number;
    readonly y: number;
  }

  function collectPositions(): { events: PositionEvent[]; stop: Unsubscribe } {
    const events: PositionEvent[] = [];
    const stop = onWorldEvent((event: WorldEvent) => {
      if (event.type === 'unit.position') events.push(event);
    });
    return { events, stop };
  }

  test('集成：命令 → 逐单位广播终值（网格以目标点为中心）；WorldState 不变', () => {
    const { store, states, stop } = harness();
    cleanups.push(stop);
    const { events, stop: off } = collectPositions();
    cleanups.push(off);

    emitCommand({ type: 'unit.move', unitIds: ['u1', 'u2', 'u3'], x: 1000, y: 0 });

    // 3 人一行（cols=ceil(√3)=2 → 实际 2 列 2 行，首行 2 格次行 1 格，中心对齐目标点）：
    // 网格几何的穷举在 formation.test.ts；这里断言「命令 → 事件」链路与终值口径。
    expect(events).toEqual([
      { type: 'unit.position', unitId: 'u1', x: 975, y: -25 },
      { type: 'unit.position', unitId: 'u2', x: 1025, y: -25 },
      { type: 'unit.position', unitId: 'u3', x: 975, y: 25 },
    ]);
    // 位置不进 WorldState（UnitView 无坐标 —— 契约铁律），也不触发 state 广播
    expect(store.getState().units).toEqual(UNITS);
    expect(states).toHaveLength(0);
  });

  test('单个单位 → 目标点本点；空编队 → 零广播零变化', () => {
    const { states, stop } = harness();
    cleanups.push(stop);
    const { events, stop: off } = collectPositions();
    cleanups.push(off);

    emitCommand({ type: 'unit.move', unitIds: ['u2'], x: -300, y: 400 });
    expect(events).toEqual([{ type: 'unit.position', unitId: 'u2', x: -300, y: 400 }]);

    events.length = 0;
    emitCommand({ type: 'unit.move', unitIds: [], x: 0, y: 0 });
    expect(events).toHaveLength(0);
    expect(states).toHaveLength(0);
  });

  test('未知单位静默丢弃（快照与输入有时间差，对账口径同 unit.select）', () => {
    const { stop } = harness();
    cleanups.push(stop);
    const { events, stop: off } = collectPositions();
    cleanups.push(off);

    emitCommand({ type: 'unit.move', unitIds: ['u1', 'ghost'], x: 0, y: 0 });

    expect(events).toEqual([{ type: 'unit.position', unitId: 'u1', x: 0, y: 0 }]);
  });

  test('选择集不因移动而变（RTS 惯例：选中跟着队伍走）', () => {
    const { store, stop } = harness();
    cleanups.push(stop);
    emitCommand({ type: 'unit.select', unitIds: ['u1', 'u2'], mode: 'set' });
    const { stop: off } = collectPositions();
    cleanups.push(off);

    emitCommand({ type: 'unit.move', unitIds: ['u1', 'u2'], x: 500, y: 500 });

    expect(store.getState().selection.unitIds).toEqual(['u1', 'u2']);
  });
});

describe('WorldEvent unit.move：战场右击入口，与 HudCommand 同一套落位', () => {
  test('同名事件（方向不同）→ 同样的编队终值广播', () => {
    const { stop } = harness();
    cleanups.push(stop);
    const events: WorldEvent[] = [];
    const off = onWorldEvent((event) => {
      if (event.type === 'unit.position') events.push(event);
    });
    cleanups.push(off);

    emitWorldEvent({ type: 'unit.move', unitIds: ['u1', 'u2', 'u3'], x: 100, y: 100 });

    // 3 人：2 列 2 行，中心对齐目标点，间距 50
    expect(events).toEqual([
      { type: 'unit.position', unitId: 'u1', x: 75, y: 75 },
      { type: 'unit.position', unitId: 'u2', x: 125, y: 75 },
      { type: 'unit.position', unitId: 'u3', x: 75, y: 125 },
    ]);
  });
});

// ============================================================================
// selection.box 带命中 id（@since v3.21，task_045）：框选闭环 —— 命中判定在世界侧
// （core 无坐标），上报方把结果补在事件上，core 才落选择集。
// ============================================================================

describe('world 事件：selection.box（带命中 id 的框选闭环）', () => {
  test('带 unitIds → 覆盖选择集并广播一次', () => {
    const { store, states, stop } = harness();
    cleanups.push(stop);

    emitWorldEvent({
      type: 'selection.box',
      bounds: { x: 0, y: 0, width: 100, height: 100 },
      unitIds: ['u2', 'u3'],
    });

    expect(store.getState().selection.unitIds).toEqual(['u2', 'u3']);
    expect(states).toHaveLength(1);
  });

  test('additive=true → 并入当前选择集（Shift 加选）', () => {
    const { store, stop } = harness();
    cleanups.push(stop);

    emitCommand({ type: 'unit.select', unitIds: ['u1'], mode: 'set' });
    emitWorldEvent({
      type: 'selection.box',
      bounds: { x: 0, y: 0, width: 100, height: 100 },
      unitIds: ['u3'],
      additive: true,
    });

    expect(store.getState().selection.unitIds).toEqual(['u1', 'u3']);
  });

  test('零命中 → 清空选择（拖空框/点空地 = 明确的取消选择）', () => {
    const { store, states, stop } = harness();
    cleanups.push(stop);
    emitCommand({ type: 'unit.select', unitIds: ['u2'], mode: 'set' });

    emitWorldEvent({ type: 'selection.box', bounds: { x: 0, y: 0, width: 10, height: 10 }, unitIds: [] });

    expect(store.getState().selection.unitIds).toEqual([]);
    expect(states).toHaveLength(2);
  });

  test('带悬空 id → 对账丢弃（框选命中来自注册表，与快照可能有时间差）', () => {
    const { store, stop } = harness();
    cleanups.push(stop);

    emitWorldEvent({
      type: 'selection.box',
      bounds: { x: 0, y: 0, width: 100, height: 100 },
      unitIds: ['u2', 'ghost'],
    });

    expect(store.getState().selection.unitIds).toEqual(['u2']);
  });

  test('Shift 拖空框 → 加空集 = 无操作（不广播）', () => {
    const { store, states, stop } = harness();
    cleanups.push(stop);
    emitCommand({ type: 'unit.select', unitIds: ['u2'], mode: 'set' });

    emitWorldEvent({
      type: 'selection.box',
      bounds: { x: 0, y: 0, width: 10, height: 10 },
      unitIds: [],
      additive: true,
    });

    expect(store.getState().selection.unitIds).toEqual(['u2']);
    expect(states).toHaveLength(1); // 只有 set 那次
  });

  test('不带 unitIds 的老事件 → 维持「未处理」观测口径（不硬猜）', () => {
    const { unhandled, stop } = harness();
    cleanups.push(stop);

    emitWorldEvent({ type: 'selection.box', bounds: { x: 0, y: 0, width: 100, height: 100 } });

    expect(unhandled).toEqual([{ channel: 'world', type: 'selection.box' }]);
  });
});
