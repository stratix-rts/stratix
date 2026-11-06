/**
 * 回归测试：**交互矩阵 §2.2「交互原语 × 命中对象」—— core 侧**（@since v3.3，task_220 / IX-07）。
 *
 * 依据：docs/DESIGN-canvas-interactions.md §2 事件矩阵（IX-07：矩阵即测试清单）。
 * 本文件是矩阵的**core 侧**那一半 —— world 的手势经桥接层变成事件后，core 怎么裁决：
 *   - 选择语义（set / toggle / add / clear）＝ 矩阵 P1 / P10 行的落地；
 *   - 双击裁决（unit.chat.open → chatTarget）＝ 矩阵 P3×O1 行的落地；
 *   - 右击移动的编队落位（unit.move → unit.position）＝ 矩阵 P4 行的落地。
 * 同一张矩阵的另外两半：世界侧 → src/world/__tests__/interaction-matrix.test.ts，
 *   HUD 侧 → src/hud/__tests__/interaction-matrix.test.ts。
 *
 * 打的是**真实的 core/bus 单例 + 真实 store**（不是 mock 总线）：runtime 的全部职责就是
 *   「接在总线上裁决」，mock 掉总线等于把要证明的东西一起 mock 掉了。
 *
 * @jest-environment node
 */

import { emitCommand, emitWorldEvent, onState, onWorldEvent, resetBus, type Unsubscribe } from '../bus';
import { createCoreRuntime, type CoreRuntime, type UnhandledChannel } from '../runtime';
import { createStore, type CoreStore } from '../store';
import { computeFormationSlots, FORMATION_SPACING } from '../unit/formation';
import type { UnitView, WorldEvent, WorldState } from '../types';

const NO_MODS = { shift: false, ctrl: false, meta: false, alt: false };

/** 场上的单位（u1 / u2 关联角色，u3 没有角色 —— 用来试「不猜角色」）。 */
const UNITS: UnitView[] = [
  { id: 'u1', name: 'Neo', status: 'idle', missionId: null, power: 3, characterId: 'c1' },
  { id: 'u2', name: 'Trinity', status: 'idle', missionId: null, power: 5, characterId: 'c2' },
  { id: 'u3', name: 'Morpheus', status: 'idle', missionId: null, power: 4, characterId: null },
];

interface Harness {
  store: CoreStore;
  states: WorldState[];
  worldEvents: WorldEvent[];
  unhandled: { channel: UnhandledChannel; type: string }[];
  stop: () => void;
}

function harness(): Harness {
  const store = createStore({ units: UNITS });
  const states: WorldState[] = [];
  const worldEvents: WorldEvent[] = [];
  const unhandled: { channel: UnhandledChannel; type: string }[] = [];
  const offState: Unsubscribe = onState((state) => states.push(state));
  const offWorld: Unsubscribe = onWorldEvent((event) => worldEvents.push(event));
  const runtime: CoreRuntime = createCoreRuntime({
    store,
    onUnhandled: (channel, payload) => unhandled.push({ channel, type: payload.type }),
  });
  const stop = runtime.start();
  return {
    store,
    states,
    worldEvents,
    unhandled,
    stop: () => { stop(); offState(); offWorld(); },
  };
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

// ============================================================================
// P1 × O1 / O2 · 单击的两种落点
// ============================================================================

describe('矩阵 P1 × O1 · 单击单位 ⇒ 选择集 = 该单位（set）', () => {
  test('P1×O1：unit.click（无修饰）⇒ 覆盖选择', () => {
    const { store, stop } = harness();
    cleanups.push(stop);

    emitWorldEvent({ type: 'unit.click', unitId: 'u1', mods: NO_MODS });

    expect(store.getState().selection.unitIds).toEqual(['u1']);
  });

  test('P1×O1：点到不存在的单位 ⇒ 选择集为空（悬空 id 不入选择集）', () => {
    const { store, stop } = harness();
    cleanups.push(stop);

    emitWorldEvent({ type: 'unit.click', unitId: 'ghost', mods: NO_MODS });

    expect(store.getState().selection.unitIds).toEqual([]);
  });
});

describe('矩阵 P1 × O2 · 单击空白 ⇒ 清空选择', () => {
  test('P1×O2：selection.box（空命中集）⇒ 选择集清空', () => {
    const { store, stop } = harness();
    cleanups.push(stop);

    emitCommand({ type: 'unit.select', unitIds: ['u1'], mode: 'set' });
    emitWorldEvent({
      type: 'selection.box',
      bounds: { x: 0, y: 0, width: 100, height: 100 },
      unitIds: [],
      additive: false,
    });

    expect(store.getState().selection.unitIds).toEqual([]);
  });
});

// ============================================================================
// P10 × O1 / O2 · 修饰键
// ============================================================================

describe('矩阵 P10 × O1 · 修饰键点击单位 ⇒ 加选 / 减选（toggle）', () => {
  test('P10×O1：Shift / Ctrl / ⌘ 点击 ⇒ 在集合外加入、在集合内移出', () => {
    for (const key of ['shift', 'ctrl', 'meta'] as const) {
      const { store, stop } = harness();
      cleanups.push(stop);

      emitCommand({ type: 'unit.select', unitIds: ['u1'], mode: 'set' });
      emitWorldEvent({ type: 'unit.click', unitId: 'u2', mods: { ...NO_MODS, [key]: true } });
      expect(store.getState().selection.unitIds).toEqual(['u1', 'u2']);

      emitWorldEvent({ type: 'unit.click', unitId: 'u2', mods: { ...NO_MODS, [key]: true } });
      expect(store.getState().selection.unitIds).toEqual(['u1']);
    }
  });

  test('P10×O1：修饰键只影响选择语义，不影响「点了哪个单位」', () => {
    const { store, stop } = harness();
    cleanups.push(stop);

    emitWorldEvent({ type: 'unit.click', unitId: 'u3', mods: { ...NO_MODS, shift: true } });

    expect(store.getState().selection.unitIds).toEqual(['u3']);
  });
});

describe('矩阵 P10 × O2 · 修饰键 + 空白（框选 additive / 点空地清空）', () => {
  test('P10×O2：Shift 拖框（additive）⇒ 并入既有选择集', () => {
    const { store, stop } = harness();
    cleanups.push(stop);

    emitCommand({ type: 'unit.select', unitIds: ['u1'], mode: 'set' });
    emitWorldEvent({
      type: 'selection.box',
      bounds: { x: 0, y: 0, width: 100, height: 100 },
      unitIds: ['u2'],
      additive: true,
    });

    expect(store.getState().selection.unitIds).toEqual(['u1', 'u2']);
  });

  test('P10×O2：非 Shift 拖框 ⇒ 覆盖选择集', () => {
    const { store, stop } = harness();
    cleanups.push(stop);

    emitCommand({ type: 'unit.select', unitIds: ['u1'], mode: 'set' });
    emitWorldEvent({
      type: 'selection.box',
      bounds: { x: 0, y: 0, width: 100, height: 100 },
      unitIds: ['u2'],
      additive: false,
    });

    expect(store.getState().selection.unitIds).toEqual(['u2']);
  });

  test('漂移④（core 侧）：Shift+点空地（additive + 空命中集）⇒ 选择集**不变**（矩阵 §2.2 现状列写的是「也清空」）', () => {
    const { store, stop } = harness();
    cleanups.push(stop);

    emitCommand({ type: 'unit.select', unitIds: ['u1'], mode: 'set' });
    emitWorldEvent({
      type: 'selection.box',
      bounds: { x: 0, y: 0, width: 100, height: 100 },
      unitIds: [],
      additive: true,
    });

    // 现状：add + 空集 = 选择集原样不动（不是「清空」）
    expect(store.getState().selection.unitIds).toEqual(['u1']);
  });
});

// ============================================================================
// P3 × O1 · 双击的 core 侧裁决
// ============================================================================

describe('矩阵 P3 × O1 · 双击单位 ⇒ core 裁决出「打开谁的聊天框」', () => {
  test('P3×O1：unit.chat.open ⇒ 写 WorldState.chatTarget（characterId + nonce）', () => {
    const { store, states, stop } = harness();
    cleanups.push(stop);

    emitWorldEvent({ type: 'unit.chat.open', unitId: 'u1' });

    expect(store.getState().chatTarget).toEqual({ characterId: 'c1', nonce: 1 });
    expect(states[0].chatTarget).toEqual({ characterId: 'c1', nonce: 1 });
  });

  test('P3×O1：同一角色连点两次 ⇒ nonce 递增（HUD 据此再次开框）', () => {
    const { store, stop } = harness();
    cleanups.push(stop);

    emitWorldEvent({ type: 'unit.chat.open', unitId: 'u1' });
    emitWorldEvent({ type: 'unit.chat.open', unitId: 'u1' });

    expect(store.getState().chatTarget).toEqual({ characterId: 'c1', nonce: 2 });
  });

  test('P3×O1：未关联角色的单位 ⇒ 不写目标（不按单位名硬凑角色）', () => {
    const { store, states, stop } = harness();
    cleanups.push(stop);

    emitWorldEvent({ type: 'unit.chat.open', unitId: 'u3' });

    expect(store.getState().chatTarget).toBeUndefined();
    expect(states).toHaveLength(0);
  });

  test('P1+P10×O1：双击不改写选择集（第一击的 toggle 结果保留）', () => {
    const { store, stop } = harness();
    cleanups.push(stop);

    emitWorldEvent({ type: 'unit.click', unitId: 'u1', mods: { ...NO_MODS, shift: true } });
    emitWorldEvent({ type: 'unit.chat.open', unitId: 'u1' });

    expect(store.getState().selection.unitIds).toEqual(['u1']);
    expect(store.getState().chatTarget).toEqual({ characterId: 'c1', nonce: 1 });
  });
});

// ============================================================================
// P4 · 右击移动的编队落位
// ============================================================================

describe('矩阵 P4 · 右击移动 ⇒ core 按编队落位逐单位广播位置', () => {
  test('P4：unit.move ⇒ 每个单位一条 unit.position（终值坐标 = 编队网格）', () => {
    const { worldEvents, stop } = harness();
    cleanups.push(stop);

    emitWorldEvent({ type: 'unit.move', unitIds: ['u1', 'u2', 'u3'], x: 1000, y: 2000 });

    const positions = worldEvents.filter((event) => event.type === 'unit.position');
    expect(positions).toHaveLength(3);
    // 网格以目标点为中心（3 人 = 2 列 2 行，间距 50）
    const expected = computeFormationSlots(['u1', 'u2', 'u3'], { x: 1000, y: 2000 });
    expect(positions.map((event) => (event as { unitId: string; x: number; y: number }))).toEqual(
      expected.map((slot) => ({ type: 'unit.position', unitId: slot.unitId, x: slot.x, y: slot.y }))
    );
    // 落位口径取自唯一事实源（core/unit/formation.ts）
    expect(FORMATION_SPACING).toBe(50);
  });

  test('P4：未知单位静默丢弃（快照与输入有时间差）', () => {
    const { worldEvents, stop } = harness();
    cleanups.push(stop);

    emitWorldEvent({ type: 'unit.move', unitIds: ['u1', 'ghost'], x: 1000, y: 2000 });

    const positions = worldEvents.filter((event) => event.type === 'unit.position');
    expect(positions).toHaveLength(1);
    expect((positions[0] as { unitId: string }).unitId).toBe('u1');
  });

  test('P4：空编队 ⇒ 零广播、零状态变化（没有可动的人就不广播）', () => {
    const { worldEvents, states, stop } = harness();
    cleanups.push(stop);

    emitWorldEvent({ type: 'unit.move', unitIds: [], x: 1000, y: 2000 });

    expect(worldEvents.filter((event) => event.type === 'unit.position')).toHaveLength(0);
    expect(states).toHaveLength(0);
  });

  test('P4：移动不改选择集（RTS 惯例：选中跟着队伍走）', () => {
    const { store, stop } = harness();
    cleanups.push(stop);

    emitCommand({ type: 'unit.select', unitIds: ['u1'], mode: 'set' });
    emitWorldEvent({ type: 'unit.move', unitIds: ['u1'], x: 1000, y: 2000 });

    expect(store.getState().selection.unitIds).toEqual(['u1']);
  });
});
