/**
 * 单测：app/services/progression-service（task_040）—— 养成回路的事件编排全路径：
 *   exp.gained → character manager 累加落库（WorldState.characters 的 level/exp 更新，
 *   033 的档案 diff 落库自动跟在本链路之后）→ 升级则广播 level.up。
 *
 * 测的是**真件**（真 core/bus 单例 + 真 store + 真 CharacterManager），不是 mock：
 *   服务职责就是「接在总线上编排」，mock 掉总线等于把被测行为一起 mock 掉。
 *   隔离靠 resetBus() 与每个用例新建的 store/manager。
 *
 * 覆盖：
 *   1. 累加落库：exp.gained 后 characters 里该角色经验/等级变化（档案更新验收点）；
 *   2. 升级广播时机：恰好跨阈值才发 level.up；未升级不发；跨多级只发**一条**（级差在载荷里）；
 *   3. 广播与落库的时序：level.up 到达时 state 里已能看到新等级（事件契约）；
 *   4. 边角：角色不存在不崩不发；非 exp.gained 事件不处理；stop 后退订；
 *   5. 权重迁移等价：exp-config 转发层与 core/progression 恒等（迁移不改变量）。
 */

import { emitWorldEvent, onState, onWorldEvent, resetBus } from '../../core/bus';
import { createCharacterManager } from '../../core/character';
import { EXP_WEIGHTS, expWeightFor, totalExpForLevel } from '../../core/progression';
import { createCoreRuntime } from '../../core/runtime';
import { createStore, type CoreStore } from '../../core/store';
import type { WorldEvent } from '../../core/types';

import { createProgressionService } from '../services/progression-service';
import { DEFAULT_EXP_WEIGHTS, defaultExpWeight } from '../services/exp-config';

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

/** 装配一个带建档角色的测试环境（真 manager + 真 store + 真 runtime，同生产链路）。 */
function setup(): { store: CoreStore; characterId: string } {
  const store = createStore();
  const manager = createCharacterManager({ store });
  // runtime 接通 store → 总线 state 广播（033 的落库链路挂在这条链上，不接就测不到广播）。
  const stopRuntime = createCoreRuntime({ store, character: manager }).start();
  cleanups.push(stopRuntime);
  const created = manager.createCharacter({
    name: 'Neo',
    agentKind: 'claude-code',
    skinId: 'skin-default',
  });
  if (!created.ok) throw new Error(`建档失败: ${created.code}`);
  createProgressionService({ characterManager: manager }).start();
  return { store, characterId: created.character.id };
}

/** 收集 world 通道事件（观察面，不影响被测链路）。 */
function collectEvents(): WorldEvent[] {
  const events: WorldEvent[] = [];
  const off = onWorldEvent((event) => {
    // 只记 level.up：exp.gained 是我们测试自己发的，记下来会淹没断言。
    if (event.type === 'level.up') events.push(event);
  });
  cleanups.push(off);
  return events;
}

describe('exp.gained → 累加落库（档案更新）', () => {
  test('一次 chat_round（+5）：经验落进 WorldState.characters，未到阈值等级不变、不发 level.up', () => {
    const { store, characterId } = setup();
    const events = collectEvents();

    emitWorldEvent({ type: 'exp.gained', characterId, source: 'chat_round', amount: 5 });

    expect(store.getState().characters[0]).toMatchObject({ level: 1, experience: 5 });
    expect(events).toEqual([]);
  });

  test('事件按到达顺序累加（多次 exp.gained 逐次累计，落库是复利不是覆盖；第四笔跨过阈值）', () => {
    const { store, characterId } = setup();

    emitWorldEvent({ type: 'exp.gained', characterId, source: 'chat_round', amount: 5 });
    emitWorldEvent({ type: 'exp.gained', characterId, source: 'task_failed', amount: 10 });
    emitWorldEvent({ type: 'exp.gained', characterId, source: 'task_completed', amount: 50 }); // 65：未到阈值
    expect(store.getState().characters[0]).toMatchObject({ level: 1, experience: 65 });

    emitWorldEvent({ type: 'exp.gained', characterId, source: 'task_completed', amount: 50 }); // 115：升 2 级
    expect(store.getState().characters[0]).toMatchObject({ level: 2, experience: 115 });
  });

  test('恰好跨过首档阈值（100）→ 升 2 级刻度（等级与经验在同一份 CharacterView 里原子更新）', () => {
    const { store, characterId } = setup();

    emitWorldEvent({ type: 'exp.gained', characterId, source: 'task_completed', amount: 100 });

    expect(store.getState().characters[0]).toMatchObject({ level: 2, experience: 100 });
  });
});

describe('升级广播（level.up 时机与载荷）', () => {
  test('恰好升级：跨过 100 → 一条 level.up（from 1 / to 2）', () => {
    const { characterId } = setup();
    const events = collectEvents();

    emitWorldEvent({ type: 'exp.gained', characterId, source: 'task_completed', amount: 100 });

    expect(events).toEqual([{ type: 'level.up', characterId, fromLevel: 1, toLevel: 2 }]);
  });

  test('不升级不发：差 1 点（99）跨不过阈值', () => {
    const { characterId } = setup();
    const events = collectEvents();

    emitWorldEvent({ type: 'exp.gained', characterId, source: 'task_completed', amount: 99 });

    expect(events).toEqual([]);
  });

  test('跨多级一次结算：+475（= L4 累计阈值）→ 只发**一条** level.up（1 → 4，级差在载荷里）', () => {
    const { characterId } = setup();
    const events = collectEvents();

    emitWorldEvent({ type: 'exp.gained', characterId, source: 'task_completed', amount: totalExpForLevel(4) });

    expect(events).toEqual([{ type: 'level.up', characterId, fromLevel: 1, toLevel: 4 }]);
  });

  test('时序契约：level.up 广播时，最新 state 里已能读到新等级（先落库后广播）', () => {
    const { store, characterId } = setup();
    let seen: number | null = null;
    const off = onWorldEvent((event) => {
      if (event.type === 'level.up') {
        seen = store.getState().characters[0]?.level ?? null;
      }
    });
    cleanups.push(off);

    emitWorldEvent({ type: 'exp.gained', characterId, source: 'task_completed', amount: 100 });

    expect(seen).toBe(2);
  });

  test('档案更新的广播链路（033 落库挂点）：state 订阅者看到升级后的角色（level/exp 同帧）', () => {
    const { characterId } = setup();
    const states: { level: number; experience: number }[] = [];
    const off = onState((state) => {
      const c = state.characters[0];
      if (c) states.push({ level: c.level, experience: c.experience });
    });
    cleanups.push(off);

    emitWorldEvent({ type: 'exp.gained', characterId, source: 'task_completed', amount: 100 });

    expect(states).toEqual([{ level: 2, experience: 100 }]);
  });
});

describe('边角与生命周期', () => {
  test('角色不存在（档案被删的契约边角）：不崩、不发 level.up，manager 的 warn Notice 走既有通道', () => {
    const store = createStore();
    const manager = createCharacterManager({ store });
    createProgressionService({ characterManager: manager }).start();
    const events = collectEvents();

    expect(() => {
      emitWorldEvent({ type: 'exp.gained', characterId: 'c-gone', source: 'chat_round', amount: 5 });
    }).not.toThrow();

    expect(events).toEqual([]);
    expect(store.getState().notices).toHaveLength(1); // manager 的 not-found Notice（既有语义）
  });

  test('非 exp.gained 事件不处理（world 通道高频事件，过滤器必须窄）', () => {
    const { store, characterId } = setup();

    emitWorldEvent({ type: 'unit.position', unitId: 'u-1', x: 1, y: 2 });
    emitWorldEvent({ type: 'level.up', characterId, fromLevel: 1, toLevel: 2 }); // 自己的广播不回流成写入
    emitWorldEvent({
      type: 'task.queued',
      task: {
        id: 't-1',
        characterId,
        prompt: '不相关事件',
        status: 'queued',
        createdAt: 1,
        startedAt: null,
        endedAt: null,
        output: '',
      },
    });

    expect(store.getState().characters[0]).toMatchObject({ level: 1, experience: 0 });
  });

  test('start 返回退订闭包：stop 后事件不再被处理（资源必须可清理）', () => {
    const store = createStore();
    const manager = createCharacterManager({ store });
    const service = createProgressionService({ characterManager: manager });
    const stop = service.start();

    const created = manager.createCharacter({ name: 'Neo', agentKind: 'codex', skinId: 'skin-default' });
    if (!created.ok) throw new Error('建档失败');
    stop();

    emitWorldEvent({ type: 'exp.gained', characterId: created.character.id, source: 'chat_round', amount: 5 });

    expect(store.getState().characters[0]).toMatchObject({ level: 1, experience: 0 });
  });

  test('logger 注入口：写入被拒时记一行（缺省静默不炸）', () => {
    const store = createStore();
    const manager = createCharacterManager({ store });
    const lines: string[] = [];
    const stop = createProgressionService({ characterManager: manager, logger: (l) => lines.push(l) }).start();
    cleanups.push(stop);

    emitWorldEvent({ type: 'exp.gained', characterId: 'c-gone', source: 'chat_round', amount: 5 });

    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('c-gone');
  });
});

describe('权重表迁移等价（exp-config 转发层 ↔ core/progression 真相源）', () => {
  test('DEFAULT_EXP_WEIGHTS 与 EXP_WEIGHTS 恒等（转发不改变量）', () => {
    expect(DEFAULT_EXP_WEIGHTS).toEqual(EXP_WEIGHTS);
  });

  test('defaultExpWeight 与 expWeightFor 逐来源恒等', () => {
    for (const source of ['task_completed', 'task_failed', 'chat_round'] as const) {
      expect(defaultExpWeight(source)).toBe(expWeightFor(source));
    }
  });
});
