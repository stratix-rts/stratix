/**
 * 单测：角色成长数值状态机（core/character/growth.ts）+ store 投影（core/character/manager.ts）+ 总线闭环。
 *
 * 分三段：
 *   1. growth —— 纯函数，把**全路径**穷举一遍（含阈值边界、封顶、脏数据、非法增量）；
 *   2. manager —— 真 store，验证投影、失败 Notice、"被拒不改状态不广播"；
 *   3. 闭环 —— 真 core/bus + 真 createCoreRuntime：manager 写库 → state 通道广播 → HUD 侧订阅者拿到成长数值。
 *
 * 边界重点（验收要求的"恰好升级 / 连升"）：
 *   exp 99 → Lv.1；exp 100 → **恰好** Lv.2；exp 199 → Lv.2；一次加 250 → **连升**到 Lv.3；
 *   封顶后经验继续累计但等级停在 MAX_LEVEL；等级是派生量（入参自相矛盾即被对账）。
 *
 * 隔离靠 resetBus() 与每个用例新建的 createStore()；不打桩总线 —— 闭环那一段的职责就是接在总线上。
 */

import { emitCommand, onState, resetBus } from '../bus';
import {
  EXP_PER_LEVEL,
  MAX_LEVEL,
  experienceIntoLevel,
  experienceToNextLevel,
  grantExperience,
  isMaxLevel,
  levelForExperience,
} from '../character';
import { createCharacterManager } from '../character/manager';
import { createCoreRuntime } from '../runtime';
import { createStore } from '../store';
import type { CharacterView, WorldState } from '../types';

/** 造一个角色（默认 0 级 0 经验）。 */
function characterAt(patch: Partial<CharacterView> = {}): CharacterView {
  return {
    id: 'c-neo',
    name: 'Neo',
    persona: '谨慎的数据分析师',
    level: 1,
    experience: 0,
    ...patch,
  };
}

// ============================================================================
// 1. 成长数值（纯函数）
// ============================================================================

describe('levelForExperience：经验 → 等级（全路径）', () => {
  test('0 经验是 1 级（新角色不是 0 级）', () => {
    expect(levelForExperience(0)).toBe(1);
  });

  test('恰好卡在阈值下方不升级：99 经验仍是 1 级', () => {
    expect(levelForExperience(EXP_PER_LEVEL - 1)).toBe(1);
  });

  test('恰好卡在阈值上立刻升级：100 经验 = 2 级', () => {
    expect(levelForExperience(EXP_PER_LEVEL)).toBe(2);
  });

  test('一个阈值区间内等级恒定（199 经验还是 2 级）', () => {
    expect(levelForExperience(EXP_PER_LEVEL * 2 - 1)).toBe(2);
  });

  test('等级封顶：远超阈值也停在 MAX_LEVEL（经验继续累计是另一件事）', () => {
    expect(levelForExperience(EXP_PER_LEVEL * 50)).toBe(MAX_LEVEL);
    expect(levelForExperience(Number.MAX_SAFE_INTEGER)).toBe(MAX_LEVEL);
  });

  test('脏数据兜底：NaN / 负数 / Infinity 都落在 1 级，不产出 NaN 级', () => {
    expect(levelForExperience(Number.NaN)).toBe(1);
    expect(levelForExperience(-50)).toBe(1);
    expect(levelForExperience(Number.POSITIVE_INFINITY)).toBe(1);
  });
});

describe('本级进度 / 距下一级', () => {
  test('本级内已积累 = exp 对每级经验取余', () => {
    expect(experienceIntoLevel(0)).toBe(0);
    expect(experienceIntoLevel(EXP_PER_LEVEL)).toBe(0);
    expect(experienceIntoLevel(EXP_PER_LEVEL + 40)).toBe(40);
  });

  test('距下一级：恰好差 0 时报 0（尚未升级），差 1 时报 1', () => {
    expect(experienceToNextLevel(EXP_PER_LEVEL * 2 - 1)).toBe(1);
    expect(experienceToNextLevel(EXP_PER_LEVEL * 3)).toBe(EXP_PER_LEVEL);
  });

  test('满级：距下一级为 null（"已满级"，而不是"还差 0"）', () => {
    expect(experienceToNextLevel(EXP_PER_LEVEL * (MAX_LEVEL - 1))).toBeNull();
    expect(isMaxLevel(levelForExperience(EXP_PER_LEVEL * (MAX_LEVEL - 1)))).toBe(true);
  });

  test('满级后本级进度记 0：没有"下一级"可言，让它满格比假性回零诚实', () => {
    expect(experienceIntoLevel(EXP_PER_LEVEL * MAX_LEVEL)).toBe(0);
  });
});

describe('grantExperience：加一次经验（全路径）', () => {
  test('未到阈值：经验增加、等级不变', () => {
    const t = grantExperience(characterAt({ level: 1, experience: 50 }), 30);
    expect(t.changed).toBe(true);
    expect(t.gained).toBe(30);
    expect(t.levelUps).toBe(0);
    expect(t.next).toEqual(characterAt({ level: 1, experience: 80 }));
  });

  test('恰好升级：加满到 100 的那一刻升 1 级', () => {
    const t = grantExperience(characterAt({ level: 1, experience: 60 }), 40);
    expect(t.next.level).toBe(2);
    expect(t.levelUps).toBe(1);
    expect(t.next.experience).toBe(100);
  });

  test('差 1 点不升级（边界另一侧）：99 → 99 仍是 1 级', () => {
    const t = grantExperience(characterAt({ level: 1, experience: 98 }), 1);
    expect(t.next.level).toBe(1);
    expect(t.levelUps).toBe(0);
  });

  test('连升：一次加 250 从 1 级跨到 3 级（levelUps = 2）', () => {
    const t = grantExperience(characterAt({ level: 1, experience: 0 }), 250);
    expect(t.next.level).toBe(3);
    expect(t.levelUps).toBe(2);
    expect(t.next.experience).toBe(250);
  });

  test('封顶后经验照常累计、等级停在上限', () => {
    const t = grantExperience(characterAt({ level: MAX_LEVEL, experience: 400 }), 500);
    expect(t.next.level).toBe(MAX_LEVEL);
    expect(t.levelUps).toBe(0);
    expect(t.next.experience).toBe(900);
    expect(t.changed).toBe(true);
  });

  test('不修改入参（immutable）：原对象原封不动', () => {
    const before = characterAt({ level: 1, experience: 10 });
    const snapshot = { ...before };
    grantExperience(before, 500);
    expect(before).toEqual(snapshot);
  });

  test('等级是派生量：入参 level 与 experience 自相矛盾时被对账（levelUps 为负）', () => {
    const t = grantExperience(characterAt({ level: 5, experience: 10 }), 10);
    expect(t.next.level).toBe(1);
    expect(t.next.experience).toBe(20);
    expect(t.levelUps).toBe(-4);
  });

  test('脏基数不传播 NaN：experience 为 NaN 时按 0 起算', () => {
    const t = grantExperience(characterAt({ level: 1, experience: Number.NaN }), 30);
    expect(t.next.experience).toBe(30);
    expect(t.next.level).toBe(1);
  });

  test('非法增量：0 / 负数 / NaN / Infinity 一律被拒，且原样返回入参引用', () => {
    const current = characterAt({ level: 1, experience: 30 });
    for (const amount of [0, -10, Number.NaN, Number.POSITIVE_INFINITY]) {
      const t = grantExperience(current, amount);
      expect(t.error).toBe('invalid-amount');
      expect(t.changed).toBe(false);
      expect(t.gained).toBe(0);
      expect(t.levelUps).toBe(0);
      expect(t.next).toBe(current);
    }
  });
});

// ============================================================================
// 2. manager：store 投影 + Notice
// ============================================================================

function stateWith(characters: CharacterView[]): Partial<WorldState> {
  return { characters };
}

describe('CharacterManager.grantExperience：写库投影', () => {
  test('写入即投影到 WorldState.characters', () => {
    const store = createStore(stateWith([characterAt({ experience: 0, level: 1 })]));
    const manager = createCharacterManager({ store });

    const result = manager.grantExperience('c-neo', 120);

    expect(result.ok).toBe(true);
    expect(store.getState().characters[0]).toMatchObject({ level: 2, experience: 120 });
  });

  test('只改目标角色，其余角色不受影响（逐条投影，不整表替换）', () => {
    const store = createStore(
      stateWith([characterAt({ id: 'c-a' }), characterAt({ id: 'c-b', level: 2, experience: 100 })])
    );
    const manager = createCharacterManager({ store });

    manager.grantExperience('c-a', 30);

    const [a, b] = store.getState().characters;
    expect(a?.experience).toBe(30);
    expect(b).toEqual(characterAt({ id: 'c-b', level: 2, experience: 100 }));
  });

  test('角色不存在：拒发 + warn 级 Notice（source = core/character），状态不变', () => {
    const store = createStore(stateWith([characterAt()]));
    const manager = createCharacterManager({ store });

    const result = manager.grantExperience('c-ghost', 50);

    expect(result).toEqual({ ok: false, code: 'not-found', characterId: 'c-ghost' });
    expect(store.getState().characters[0]).toEqual(characterAt());
    expect(store.getState().notices).toHaveLength(1);
    expect(store.getState().notices[0]).toMatchObject({ level: 'warn', source: 'core/character' });
  });

  test('非法增量：拒发 + Notice，经验一分不加', () => {
    const store = createStore(stateWith([characterAt({ experience: 30 })]));
    const manager = createCharacterManager({ store });

    const result = manager.grantExperience('c-neo', -5);

    expect(result.ok).toBe(false);
    expect(store.getState().characters[0]?.experience).toBe(30);
    expect(store.getState().notices[0]?.text).toContain('invalid-amount');
  });

  test('非法增量不广播状态变更（只多一条通知的广播）', () => {
    const store = createStore(stateWith([characterAt({ experience: 30 })]));
    const manager = createCharacterManager({ store });
    let characterBroadcasts = 0;
    store.subscribe((state) => {
      if (state.characters[0]?.experience !== 30) characterBroadcasts += 1;
    });

    manager.grantExperience('c-neo', 0);

    expect(characterBroadcasts).toBe(0);
  });

  test('广播次数：一次成功加经验 = 一次状态广播（不为"升级提示"再广播一次）', () => {
    const store = createStore(stateWith([characterAt({ experience: 0 })]));
    const manager = createCharacterManager({ store });
    let broadcasts = 0;
    store.subscribe(() => { broadcasts += 1; });

    manager.grantExperience('c-neo', 300);

    expect(broadcasts).toBe(1);
    expect(store.getState().characters[0]?.level).toBe(4);
  });
});

// ============================================================================
// 3. 总线闭环：manager 写库 → runtime 广播 → 订阅者（= HUD 侧）拿到成长数值
// ============================================================================

describe('经总线集成：core 写库 → state 通道 → HUD 订阅侧', () => {
  test('订阅者收到的是更新后的角色成长数值', () => {
    resetBus();
    const store = createStore(stateWith([characterAt({ experience: 90, level: 1 })]));
    const runtime = createCoreRuntime({ store });
    const manager = createCharacterManager({ store });
    const seen: CharacterView[] = [];
    const off = onState((state) => { seen.push(state.characters[0] as CharacterView); });
    const stop = runtime.start();

    manager.grantExperience('c-neo', 30);
    stop();
    off();

    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ level: 2, experience: 120 });
  });

  test('未接线的角色命令走 onUnhandled 而不是被吞（character.persona.update 仍待 runtime 接线）', () => {
    resetBus();
    const store = createStore(stateWith([characterAt()]));
    const unhandled: unknown[] = [];
    const runtime = createCoreRuntime({
      store,
      onUnhandled: (channel, payload) => { unhandled.push({ channel, type: payload.type }); },
    });
    const stop = runtime.start();

    // 契约里目前**没有**"加经验"的 HudCommand（见 core/character/manager.ts 文件头 TODO）：
    // 角色数值只由 core 侧写入面驱动。这里断言尚未接线的角色命令**没有**被悄悄处理掉。
    emitCommand({ type: 'character.persona.update', characterId: 'c-neo', prompt: '更激进一些' });
    stop();

    expect(unhandled).toEqual([{ channel: 'command', type: 'character.persona.update' }]);
    expect(store.getState().characters[0]).toEqual(characterAt());
  });
});