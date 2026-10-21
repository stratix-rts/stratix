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
  PERSONA_MAX_LEN,
  experienceIntoLevel,
  experienceToNextLevel,
  grantExperience,
  isMaxLevel,
  levelForExperience,
  updatePersona,
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
// 1.b persona：角色提示词改写（纯函数，零 store）
// ============================================================================

describe('updatePersona：角色提示词改写（纯函数）', () => {
  const base = characterAt({ persona: '稳' });

  test('与原值一致（含 trim 后相等）→ 原样返回入参引用、不广播', () => {
    const t = updatePersona(base, '  稳  ');
    expect(t.changed).toBe(false);
    expect(t.next).toBe(base); // 原引用
    expect(t.prompt).toBe('稳');
  });

  test('trim 后的新值合法 → 返回新对象（immutable），其它字段不被动', () => {
    const t = updatePersona(base, '\n  新提示词\n');
    expect(t.changed).toBe(true);
    expect(t.next).not.toBe(base);
    expect(t.prompt).toBe('新提示词');
    expect(t.next.id).toBe(base.id);
    expect(t.next.name).toBe(base.name);
    expect(t.next.level).toBe(base.level);
    expect(t.next.experience).toBe(base.experience);
  });

  test('trim 保留中间换行/缩进（persona 多行文本，不该被压成单行）', () => {
    const t = updatePersona(base, 'a\n  b\nc');
    expect(t.changed).toBe(true);
    expect(t.prompt).toBe('a\n  b\nc');
  });

  test('空串 / 纯空白 → 拒发（empty），原引用', () => {
    for (const raw of ['', '   ', '\n\t  \n']) {
      const t = updatePersona(base, raw);
      expect(t.error).toBe('empty');
      expect(t.next).toBe(base);
      expect(t.changed).toBe(false);
    }
  });

  test('非字符串（null / undefined / 数字）→ 拒发（not-a-string）', () => {
    for (const raw of [null, undefined, 42, {}, []]) {
      const t = updatePersona(base, raw);
      expect(t.error).toBe('not-a-string');
      expect(t.next).toBe(base);
      expect(t.changed).toBe(false);
    }
  });

  test('长度超限 → 拒发（too-long），原引用', () => {
    const tooLong = 'x'.repeat(PERSONA_MAX_LEN + 1);
    const t = updatePersona(base, tooLong);
    expect(t.error).toBe('too-long');
    expect(t.next).toBe(base);
    expect(t.changed).toBe(false);
  });

  test('等于上限（含两侧空白后）→ 合法', () => {
    const atLimit = '  ' + 'x'.repeat(PERSONA_MAX_LEN) + '  ';
    const t = updatePersona(base, atLimit);
    expect(t.changed).toBe(true);
    expect(t.prompt.length).toBe(PERSONA_MAX_LEN);
    expect(t.error).toBeUndefined();
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

describe('CharacterManager.updatePersona：persona 写库投影（@since v3.6）', () => {
  test('合法 prompt：投影进 WorldState.characters 并广播一次', () => {
    const store = createStore(stateWith([characterAt({ persona: '稳' })]));
    const manager = createCharacterManager({ store });
    let broadcasts = 0;
    store.subscribe(() => { broadcasts += 1; });

    const result = manager.updatePersona('c-neo', '  激进一些\n');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.character.persona).toBe('激进一些');
    }
    expect(store.getState().characters[0]?.persona).toBe('激进一些');
    expect(broadcasts).toBe(1);
  });

  test('与原值相等（trim 后）：不写库、不广播（store 引用未变即不广播约定）', () => {
    const store = createStore(stateWith([characterAt({ persona: '稳' })]));
    const manager = createCharacterManager({ store });
    let broadcasts = 0;
    store.subscribe(() => { broadcasts += 1; });

    const result = manager.updatePersona('c-neo', '  稳  ');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.character.persona).toBe('稳');
    }
    expect(store.getState().characters[0]?.persona).toBe('稳');
    expect(broadcasts).toBe(0);
  });

  test('只改目标角色，其余角色不受影响（逐条投影，不整表替换）', () => {
    const store = createStore(
      stateWith([
        characterAt({ id: 'c-a', persona: 'a' }),
        characterAt({ id: 'c-b', persona: 'b' }),
      ])
    );
    const manager = createCharacterManager({ store });

    manager.updatePersona('c-a', 'A2');

    const [a, b] = store.getState().characters;
    expect(a?.persona).toBe('A2');
    expect(b?.persona).toBe('b');
  });

  test('角色不存在：拒发 + warn Notice（source = core/character），characters 不变', () => {
    const store = createStore(stateWith([characterAt()]));
    const manager = createCharacterManager({ store });

    const result = manager.updatePersona('c-ghost', 'new');

    expect(result).toEqual({ ok: false, code: 'not-found', characterId: 'c-ghost' });
    expect(store.getState().characters[0]?.persona).toBe(characterAt().persona);
    expect(store.getState().notices).toHaveLength(1);
    expect(store.getState().notices[0]).toMatchObject({ level: 'warn', source: 'core/character' });
  });

  test('非法 prompt（空）：拒发 + Notice + characters 不变', () => {
    const store = createStore(stateWith([characterAt({ persona: '原' })]));
    const manager = createCharacterManager({ store });

    const result = manager.updatePersona('c-neo', '   ');

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('empty');
    expect(store.getState().characters[0]?.persona).toBe('原');
    expect(store.getState().notices[0]?.text).toContain('empty');
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

  test('character.persona.update 走 manager 写库并广播新 persona（@since v3.6 接线）', () => {
    resetBus();
    const store = createStore(stateWith([characterAt({ persona: '旧提示词' })]));
    const runtime = createCoreRuntime({ store });
    const seen: CharacterView[] = [];
    const off = onState((state) => { seen.push(state.characters[0] as CharacterView); });
    const stop = runtime.start();

    emitCommand({ type: 'character.persona.update', characterId: 'c-neo', prompt: '  更激进一些\n' });
    stop();
    off();

    // trim 后写入；广播一次（无变化不广播的约定自动生效：原值不同 → 必广播）。
    expect(seen).toHaveLength(1);
    expect(seen[0]?.persona).toBe('更激进一些');
    expect(store.getState().characters[0]?.persona).toBe('更激进一些');
  });

  test('character.persona.update：与原值一致则不写入、不广播（store 「引用未变即不广播」约定）', () => {
    resetBus();
    const store = createStore(stateWith([characterAt({ persona: '稳' })]));
    const runtime = createCoreRuntime({ store });
    let broadcasts = 0;
    const off = onState(() => { broadcasts += 1; });
    const stop = runtime.start();

    emitCommand({ type: 'character.persona.update', characterId: 'c-neo', prompt: '  稳  ' });
    stop();
    off();

    expect(broadcasts).toBe(0);
    expect(store.getState().characters[0]?.persona).toBe('稳');
  });

  test('character.persona.update：被拒（角色不在 / 非法 prompt）走 Notice 通道，不改 characters', () => {
    resetBus();
    const store = createStore(stateWith([characterAt()]));
    const runtime = createCoreRuntime({ store });
    const stop = runtime.start();

    // 角色不存在 → not-found + 推一条 warn Notice；characters 不变。
    emitCommand({ type: 'character.persona.update', characterId: 'c-ghost', prompt: 'x' });
    expect(store.getState().characters[0]).toEqual(characterAt());
    expect(store.getState().notices[0]).toMatchObject({ level: 'warn', source: 'core/character' });

    // 空 prompt → empty + 再一条 Notice；characters 不变。
    emitCommand({ type: 'character.persona.update', characterId: 'c-neo', prompt: '   ' });
    expect(store.getState().characters[0]).toEqual(characterAt());
    expect(store.getState().notices).toHaveLength(2);

    stop();
  });
});