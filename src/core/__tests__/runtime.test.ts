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
// unit.speaking 接地（@since v3.37，task_062）：app 层 chat-service 在流式期间发的
// 说话标志位广播，消费者是战场场景（bridge 转发 syncUnitSpeaking → 头顶「···」气泡）。
// 纯瞬态表现不写 WorldState —— 同 unit.position 惯例显式接地，不进 onUnhandled
// （否则每轮对话起止都报一次「未处理」噪音）。
// ============================================================================

describe('world 事件：unit.speaking（task_062）', () => {
  test('不进 onUnhandled，也不改任何状态（气泡起止归渲染层）', () => {
    const { unhandled, states, stop } = harness();
    cleanups.push(stop);

    emitWorldEvent({ type: 'unit.speaking', unitId: 'unit_ch_1', speaking: true });
    emitWorldEvent({ type: 'unit.speaking', unitId: 'unit_ch_1', speaking: false });

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

// ============================================================================
// agent.online / agent.offline 接地（@since v3.30，task_054，agent 健康监测）：
// health-monitor（app 层）防抖判定翻转 → 事件只携 kind → runtime 按角色档案
// （characters.agentKind ↔ units.characterId）批量置在线位。断言面（规格⑤「事件接地」）：
//   1. 掉线事件把该 kind 名下单位 online 置 false（其余单位零变化零广播）；
//   2. 恢复事件置回 true（恢复 1 次即回）；
//   3. 缺省即在线：老档 / 未写入 online 的单位在恢复事件下不广播（幂等不扰动）；
//   4. 没绑角色 / 没单位的 kind：事件照收，零状态变化（不进 onUnhandled 也不崩）；
//   5. 忙闲 status 不被顺手改写（online 与 status 正交，见 UnitView.online 契约注）。
// ============================================================================

describe('world 事件：agent.online / agent.offline（task_054 接地）', () => {
  const characters = [
    { id: 'ch-a', name: '阿尔法', persona: 'x', level: 1, experience: 0, agentKind: 'claude-code' },
    { id: 'ch-b', name: '贝塔', persona: 'y', level: 1, experience: 0, agentKind: 'claude-code' },
    { id: 'ch-c', name: '伽马', persona: 'z', level: 1, experience: 0, agentKind: 'kimi' },
  ] as unknown as import('../types').WorldState['characters'];
  const units: UnitView[] = [
    { id: 'u-a', name: '阿尔法', status: 'busy', missionId: null, power: 3, characterId: 'ch-a' },
    { id: 'u-b', name: '贝塔', status: 'idle', missionId: null, power: 4, characterId: 'ch-b' },
    { id: 'u-c', name: '伽马', status: 'idle', missionId: null, power: 5, characterId: 'ch-c' },
    { id: 'u-free', name: '游侠', status: 'idle', missionId: null, power: 2 }, // 未绑角色：永不受健康位影响
  ];

  function healthHarness() {
    const store = createStore({ units, characters });
    const states: WorldState[] = [];
    const unhandled: { channel: UnhandledChannel; type: string }[] = [];
    const offState: Unsubscribe = onState((state) => states.push(state));
    const runtime = createCoreRuntime({
      store,
      onUnhandled: (channel, payload) => unhandled.push({ channel, type: payload.type }),
    });
    const stop = runtime.start();
    return { store, states, unhandled, stop: () => { stop(); offState(); } };
  }

  test('agent.offline → 该 kind 名下单位 online=false；同 kind 多角色一次批量置位；他 kind / 未绑不动', () => {
    const { store, unhandled, stop } = healthHarness();
    cleanups.push(stop);

    emitWorldEvent({ type: 'agent.offline', kind: 'claude-code' });

    const state = store.getState();
    expect(state.units.find((u) => u.id === 'u-a')?.online).toBe(false);
    expect(state.units.find((u) => u.id === 'u-b')?.online).toBe(false);
    expect(state.units.find((u) => u.id === 'u-c')?.online).toBeUndefined(); // kimi 不受扰
    expect(state.units.find((u) => u.id === 'u-free')?.online).toBeUndefined(); // 未绑不受扰
    expect(unhandled).toHaveLength(0); // 显式接地，不进未处理
  });

  test('agent.online → 离线单位置回 true（恢复 1 次即回）；缺省单位不广播（幂等不扰动老档）', () => {
    const { store, states, stop } = healthHarness();
    cleanups.push(stop);

    emitWorldEvent({ type: 'agent.offline', kind: 'claude-code' });
    states.length = 0;
    emitWorldEvent({ type: 'agent.online', kind: 'claude-code' });
    expect(store.getState().units.find((u) => u.id === 'u-a')?.online).toBe(true);

    // 恢复后再发一次 agent.online：全部单位已在线（缺省即在线）→ 零状态广播。
    states.length = 0;
    emitWorldEvent({ type: 'agent.online', kind: 'claude-code' });
    expect(states).toHaveLength(0);
  });

  test('事件只携 kind：没绑角色 / 没单位的 kind 照收，零状态变化不崩', () => {
    const { states, unhandled, stop } = healthHarness();
    cleanups.push(stop);

    emitWorldEvent({ type: 'agent.offline', kind: 'openclaw' }); // 档案里没有 openclaw 角色
    expect(states).toHaveLength(0);
    expect(unhandled).toHaveLength(0);
  });

  test('忙闲 status 不被顺手改写（online 与 status 正交）', () => {
    const { store, stop } = healthHarness();
    cleanups.push(stop);

    emitWorldEvent({ type: 'agent.offline', kind: 'claude-code' });
    const a = store.getState().units.find((u) => u.id === 'u-a');
    expect(a?.status).toBe('busy'); // 掉线不谎报忙闲：在跑任务的收尾归 task 状态机
    expect(a?.online).toBe(false);
  });
});

// ============================================================================
// camera.center（@since v3.33，task_057）：小地图跳转 —— HudCommand 钳制后转发同名
// WorldEvent 到 world 通道（消费者是场景相机）；world 通道回环的事件显式接地。
// ============================================================================

describe('HudCommand camera.center：命令 → 钳制 → world 通道转发', () => {
  test('命令越界坐标被钳进 WORLD_BOUNDS 后转发（事件名同名，方向不同）', () => {
    const { states, stop } = harness();
    cleanups.push(stop);

    const events: WorldEvent[] = [];
    const off = onWorldEvent((event) => events.push(event));
    cleanups.push(off);

    emitCommand({ type: 'camera.center', x: -100, y: 99999 });

    const center = events.find((event) => event.type === 'camera.center');
    expect(center).toEqual({ type: 'camera.center', x: 0, y: 2400 }); // WORLD_BOUNDS 高 2400
    // 不改任何状态：坐标真相在世界层，core 只做钳制与转交
    expect(states).toHaveLength(0);
  });

  test('命令边界内坐标原样转发；WorldState 不变、不进 onUnhandled', () => {
    const { states, unhandled, stop } = harness();
    cleanups.push(stop);

    const events: WorldEvent[] = [];
    const off = onWorldEvent((event) => events.push(event));
    cleanups.push(off);

    emitCommand({ type: 'camera.center', x: 1600, y: 1200 });

    expect(events.find((event) => event.type === 'camera.center')).toEqual({
      type: 'camera.center',
      x: 1600,
      y: 1200,
    });
    expect(states).toHaveLength(0);
    expect(unhandled).toHaveLength(0);
  });
});

describe('world 事件：camera.center 回环接地（task_057）', () => {
  test('不被当作未处理事件上报（消费者在世界场景，经桥接层转发）', () => {
    const { unhandled, stop } = harness();
    cleanups.push(stop);

    emitWorldEvent({ type: 'camera.center', x: 100, y: 200 });

    expect(unhandled).toHaveLength(0);
  });
});

// ============================================================================
// 编组槽位命令（@since v3.34，task_058）—— unit.group.assign / unit.group.recall
// ============================================================================

describe('HudCommand → 编组槽位（task_058）', () => {
  test('unit.group.assign：把当前选择集存入槽位，广播一次（含 info Notice）', () => {
    const { store, states, stop } = harness();
    cleanups.push(stop);

    emitCommand({ type: 'unit.select', unitIds: ['u1', 'u2'], mode: 'set' });
    emitCommand({ type: 'unit.group.assign', group: 1 });

    expect(store.getState().selectionGroups?.get(1)).toEqual(['u1', 'u2']);
    // 一次命令一次广播：槽位写入 + Notice 附在同一次 state 里
    expect(states).toHaveLength(2);
    const [selectionState, groupState] = states;
    expect(selectionState.selection.unitIds).toEqual(['u1', 'u2']);
    expect(groupState.selectionGroups?.get(1)).toEqual(['u1', 'u2']);
    expect(groupState.notices[0]?.text).toBe('已存入编组 1（2 单位）');
    expect(groupState.notices[0]?.level).toBe('info');
    expect(groupState.notices[0]?.source).toBe('core/unit');
  });

  test('assign 存的是副本：之后选择变化不影响已存编组', () => {
    const { store, stop } = harness();
    cleanups.push(stop);

    emitCommand({ type: 'unit.select', unitIds: ['u1'], mode: 'set' });
    emitCommand({ type: 'unit.group.assign', group: 2 });
    emitCommand({ type: 'unit.select', unitIds: ['u3'], mode: 'set' });

    expect(store.getState().selectionGroups?.get(2)).toEqual(['u1']);
  });

  test('assign 空选择被拒：warn Notice，槽位不被清空', () => {
    const { store, states, stop } = harness();
    cleanups.push(stop);

    emitCommand({ type: 'unit.select', unitIds: ['u1'], mode: 'set' });
    emitCommand({ type: 'unit.group.assign', group: 3 });
    emitCommand({ type: 'unit.select', unitIds: [], mode: 'set' });
    emitCommand({ type: 'unit.group.assign', group: 3 });

    expect(store.getState().selectionGroups?.get(3)).toEqual(['u1']);
    const lastNotice = store.getState().notices[0];
    expect(lastNotice?.text).toBe('未选中单位，编组 3 未变更');
    expect(lastNotice?.level).toBe('warn');
    expect(states.at(-1)?.selectionGroups?.get(3)).toEqual(['u1']);
  });

  test('assign 同槽同成员幂等：零广播（无实质变化）', () => {
    const { store, states, stop } = harness();
    cleanups.push(stop);

    emitCommand({ type: 'unit.select', unitIds: ['u1'], mode: 'set' });
    emitCommand({ type: 'unit.group.assign', group: 1 });
    const broadcastsAfterFirst = states.length;
    emitCommand({ type: 'unit.group.assign', group: 1 });

    expect(store.getState().selectionGroups?.get(1)).toEqual(['u1']);
    expect(states).toHaveLength(broadcastsAfterFirst);
  });

  test('assign 越界槽位被拒：warn Notice，不改槽位表', () => {
    const { store, states, stop } = harness();
    cleanups.push(stop);

    emitCommand({ type: 'unit.select', unitIds: ['u1'], mode: 'set' });
    emitCommand({ type: 'unit.group.assign', group: 0 });
    emitCommand({ type: 'unit.group.assign', group: 10 });

    expect(store.getState().selectionGroups?.size ?? 0).toBe(0);
    expect(store.getState().notices[0]?.text).toBe('编组槽位必须是 1–9');
    expect(store.getState().notices[0]?.level).toBe('warn');
    // unit.select 一次 + 两次越界拒绝各带一次 Notice 广播
    expect(states).toHaveLength(3);
  });

  test('unit.group.recall：选中槽位成员（覆盖当前选择）+ info Notice', () => {
    const { store, stop } = harness();
    cleanups.push(stop);

    emitCommand({ type: 'unit.select', unitIds: ['u1', 'u2'], mode: 'set' });
    emitCommand({ type: 'unit.group.assign', group: 5 });
    emitCommand({ type: 'unit.select', unitIds: ['u3'], mode: 'set' });
    emitCommand({ type: 'unit.group.recall', group: 5 });

    expect(store.getState().selection.unitIds).toEqual(['u1', 'u2']);
    const notice = store.getState().notices[0];
    expect(notice?.text).toBe('召回编组 5（2 单位）');
    expect(notice?.level).toBe('info');
  });

  test('recall 剔除已消失单位（对账口径同 unit.select）', () => {
    const { store, stop } = harness();
    cleanups.push(stop);

    emitCommand({ type: 'unit.select', unitIds: ['u1', 'u2'], mode: 'set' });
    emitCommand({ type: 'unit.group.assign', group: 1 });
    // u2 离场（世界层对账：units 不再有它）—— 用一次会触发 reconcile 的路径移除
    store.setState((state) => ({
      ...state,
      units: state.units.filter((unit) => unit.id !== 'u2'),
    }));
    emitCommand({ type: 'unit.group.recall', group: 1 });

    expect(store.getState().selection.unitIds).toEqual(['u1']);
    expect(store.getState().notices[0]?.text).toBe('召回编组 1（1 单位）');
  });

  test('recall 空槽：不动选择集，warn Notice', () => {
    const { store, states, stop } = harness();
    cleanups.push(stop);

    emitCommand({ type: 'unit.select', unitIds: ['u1'], mode: 'set' });
    emitCommand({ type: 'unit.group.recall', group: 9 });

    expect(store.getState().selection.unitIds).toEqual(['u1']);
    expect(store.getState().notices[0]?.text).toBe('编组 9 为空');
    expect(store.getState().notices[0]?.level).toBe('warn');
  });

  test('recall 成员全部离场：同空槽口径（warn，不动选择集）', () => {
    const { store, stop } = harness();
    cleanups.push(stop);

    emitCommand({ type: 'unit.select', unitIds: ['u1'], mode: 'set' });
    emitCommand({ type: 'unit.group.assign', group: 2 });
    store.setState((state) => ({
      ...state,
      units: state.units.filter((unit) => unit.id !== 'u1'),
    }));
    emitCommand({ type: 'unit.group.recall', group: 2 });

    expect(store.getState().selection.unitIds).toEqual(['u1']); // 选择未被动过
    expect(store.getState().notices[0]?.text).toBe('编组 2 为空');
  });

  test('recall 召回同一选择集：选择零变化，但 Notice 仍随一次广播送达', () => {
    const { store, states, stop } = harness();
    cleanups.push(stop);

    emitCommand({ type: 'unit.select', unitIds: ['u1'], mode: 'set' });
    emitCommand({ type: 'unit.group.assign', group: 1 });
    emitCommand({ type: 'unit.group.recall', group: 1 });

    // 第二次广播只多了 Notice（选择集 revision 未变）
    const last = states.at(-1);
    expect(last?.selection.revision).toBe(1);
    expect(last?.notices[0]?.text).toBe('召回编组 1（1 单位）');
    expect(store.getState().selection.unitIds).toEqual(['u1']);
  });

  test('两条命令都不进 onUnhandled（已是落地命令）', () => {
    const { unhandled, stop } = harness();
    cleanups.push(stop);

    emitCommand({ type: 'unit.group.assign', group: 1 });
    emitCommand({ type: 'unit.group.recall', group: 1 });

    expect(unhandled).toHaveLength(0);
  });
});
