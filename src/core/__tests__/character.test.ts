/**
 * 单测：角色成长数值状态机（core/character/growth.ts）+ 建档（core/character/profile.ts）
 *   + store 投影（core/character/manager.ts）+ 总线闭环。
 *
 * 分四段：
 *   1. growth —— 纯函数，把**全路径**穷举一遍（含阈值边界、封顶、脏数据、非法增量）；
 *   1.b persona —— 纯函数，提示词改写合法性；
 *   1.c profile —— 纯函数，建档合法性（合法名 / 非法名 / 空 persona 默认模板 / agent 种类 / 皮肤）；
 *   2. manager —— 真 store，验证投影、失败 Notice、"被拒不改状态不广播"、同名冲突、条数上限；
 *   3. 闭环 —— 真 core/bus + 真 createCoreRuntime：manager 写库 → state 通道广播 → HUD 侧订阅者拿到成长数值。
 *
 * 边界重点（验收要求的"恰好升级 / 连升"）：
 *   exp 99 → Lv.1；exp 100 → **恰好** Lv.2；exp 249 → Lv.2；一次加 250 → **连升**到 Lv.3；
 *   封顶后经验继续累计但等级停在 MAX_LEVEL；等级是派生量（入参自相矛盾即被对账）。
 *   曲线阈值（×1.5 递增、L1→L20）的完整对拍在 progression.test.ts —— 本文件只从
 *   progression 常量取阈值引用（EXP_TABLE / totalExpForLevel），不复制魔法数。
 *
 * 隔离靠 resetBus() 与每个用例新建的 createStore()；不打桩总线 —— 闭环那一段的职责就是接在总线上。
 */

import { emitCommand, onState, resetBus } from '../bus';
import {
  DEFAULT_PERSONA_TEMPLATE,
  PERSONA_MAX_LEN,
  grantExperience,
  toAgentProfile,
  updatePersona,
} from '../character';
import { createAgentProfile } from '../character/profile';
import { createCharacterManager } from '../character/manager';
import { toCharacterUnit } from '../character/unit-projection';
import {
  EXP_TABLE,
  MAX_LEVEL,
  experienceIntoLevel,
  experienceToNextLevel,
  isMaxLevel,
  levelForExperience,
  totalExpForLevel,
} from '../progression';
import { createCoreRuntime } from '../runtime';
import { createStore } from '../store';
import {
  MAX_CHARACTERS,
  MAX_CHARACTER_NAME_LEN,
  type CharacterAppearance,
  type CharacterView,
  type UnitView,
  type WorldState,
} from '../types';

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
    expect(levelForExperience(EXP_TABLE[1]! - 1)).toBe(1);
  });

  test('恰好卡在阈值上立刻升级：100 经验 = 2 级', () => {
    expect(levelForExperience(EXP_TABLE[1]!)).toBe(2);
  });

  test('一个阈值区间内等级恒定（L2 区间上端 249 还是 2 级 —— 第二档起每级所需不同）', () => {
    expect(levelForExperience(totalExpForLevel(3) - 1)).toBe(2);
  });

  test('等级封顶：远超阈值也停在 MAX_LEVEL（经验继续累计是另一件事）', () => {
    expect(levelForExperience(totalExpForLevel(MAX_LEVEL) + 500)).toBe(MAX_LEVEL);
    expect(levelForExperience(Number.MAX_SAFE_INTEGER)).toBe(MAX_LEVEL);
  });

  test('脏数据兜底：NaN / 负数 / Infinity 都落在 1 级，不产出 NaN 级', () => {
    expect(levelForExperience(Number.NaN)).toBe(1);
    expect(levelForExperience(-50)).toBe(1);
    expect(levelForExperience(Number.POSITIVE_INFINITY)).toBe(1);
  });
});

describe('本级进度 / 距下一级', () => {
  test('本级内已积累 = 总经验 − 到达本级所需累计（曲线化后不再是取余）', () => {
    expect(experienceIntoLevel(0)).toBe(0);
    expect(experienceIntoLevel(EXP_TABLE[1]!)).toBe(0); // 100 = L2 起点
    expect(experienceIntoLevel(EXP_TABLE[1]! + 40)).toBe(40); // 140 在 L2 区间内
    expect(experienceIntoLevel(totalExpForLevel(3))).toBe(0); // 250 = L3 起点
  });

  test('距下一级：恰好差 0 时报 0（尚未升级），差 1 时报 1', () => {
    expect(experienceToNextLevel(totalExpForLevel(3) - 1)).toBe(1);
    expect(experienceToNextLevel(totalExpForLevel(3))).toBe(EXP_TABLE[3]!); // 到 L3 后距 L4 = 第三档跨度
  });

  test('满级：距下一级为 null（"已满级"，而不是"还差 0"）；恰好差 1 点不算满', () => {
    expect(experienceToNextLevel(totalExpForLevel(MAX_LEVEL))).toBeNull();
    expect(experienceToNextLevel(totalExpForLevel(MAX_LEVEL) - 1)).toBe(1);
    expect(isMaxLevel(levelForExperience(totalExpForLevel(MAX_LEVEL)))).toBe(true);
    expect(isMaxLevel(levelForExperience(totalExpForLevel(MAX_LEVEL) - 1))).toBe(false);
  });

  test('满级后本级进度记 0：没有"下一级"可言，让它满格比假性回零诚实', () => {
    expect(experienceIntoLevel(totalExpForLevel(MAX_LEVEL) + 9999)).toBe(0);
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

  test('连升：一次加 250 从 1 级跨到 3 级（levelUps = 2，恰好等于新曲线 L3 累计阈值）', () => {
    const t = grantExperience(characterAt({ level: 1, experience: 0 }), totalExpForLevel(3));
    expect(t.next.level).toBe(3);
    expect(t.levelUps).toBe(2);
    expect(t.next.experience).toBe(250);
  });

  test('封顶后经验照常累计、等级停在上限', () => {
    const t = grantExperience(
      characterAt({ level: MAX_LEVEL, experience: totalExpForLevel(MAX_LEVEL) }),
      500
    );
    expect(t.next.level).toBe(MAX_LEVEL);
    expect(t.levelUps).toBe(0);
    expect(t.next.experience).toBe(totalExpForLevel(MAX_LEVEL) + 500);
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
// 1.c profile：角色建档（纯函数，零 store）
// ============================================================================

describe('createAgentProfile：建档合法性（纯函数）', () => {
  const valid = {
    id: 'c-1',
    name: 'Neo',
    agentKind: 'claude-code',
    skinId: 'skin-default',
  } as const;

  test('合法输入：档案字段齐整，初始等级 1 / 经验 0', () => {
    const r = createAgentProfile({ ...valid });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.profile).toEqual({
      id: 'c-1',
      agentKind: 'claude-code',
      displayName: 'Neo',
      skinId: 'skin-default',
      persona: DEFAULT_PERSONA_TEMPLATE,
      level: 1,
      exp: 0,
      externalSessionId: null,
    });
  });

  test('名字 trim 后入库（首尾空白不算名字的一部分）', () => {
    const r = createAgentProfile({ ...valid, name: '  Neo  ' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.profile.displayName).toBe('Neo');
  });

  test('空名 / 纯空白名 → 拒发（empty-name）', () => {
    for (const name of ['', '   ', '\n\t']) {
      const r = createAgentProfile({ ...valid, name });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.code).toBe('empty-name');
    }
  });

  test('名字非字符串 → 拒发（empty-name）', () => {
    for (const name of [null, undefined, 42, {}]) {
      const r = createAgentProfile({ ...valid, name: name as unknown });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.code).toBe('empty-name');
    }
  });

  test('名字超长 → 拒发（name-too-long）；恰好 24 码点合法', () => {
    const atLimit = '名'.repeat(MAX_CHARACTER_NAME_LEN);
    const ok = createAgentProfile({ ...valid, name: atLimit });
    expect(ok.ok).toBe(true);

    const tooLong = createAgentProfile({ ...valid, name: '名'.repeat(MAX_CHARACTER_NAME_LEN + 1) });
    expect(tooLong.ok).toBe(false);
    if (!tooLong.ok) expect(tooLong.code).toBe('name-too-long');
  });

  test('未知的 agent 种类 → 拒发（unknown-agent-kind），不擅自归一到某个 agent', () => {
    for (const agentKind of ['gpt', 'Claude-Code', '', 42]) {
      const r = createAgentProfile({ ...valid, agentKind });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.code).toBe('unknown-agent-kind');
    }
  });

  test('皮肤 id：空 / 纯空白 → 拒发（invalid-skin-id）', () => {
    for (const skinId of ['', '   ', 42]) {
      const r = createAgentProfile({ ...valid, skinId: skinId as unknown });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.code).toBe('invalid-skin-id');
    }
  });

  test('空 persona（缺省 / 空串 / 纯空白）→ 套默认模板，不拒发', () => {
    for (const persona of [undefined, null, '', '   ']) {
      const r = createAgentProfile({ ...valid, persona });
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.profile.persona).toBe(DEFAULT_PERSONA_TEMPLATE);
    }
  });

  test('合法 persona：trim 后写入', () => {
    const r = createAgentProfile({ ...valid, persona: '  谨慎的数据分析师\n' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.profile.persona).toBe('谨慎的数据分析师');
  });

  test('persona 超长 → 拒发（too-long），口径与 persona.ts 一致', () => {
    const r = createAgentProfile({ ...valid, persona: 'x'.repeat(PERSONA_MAX_LEN + 1) });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('too-long');
  });

  test('persona 非字符串 → 拒发（not-a-string）', () => {
    const r = createAgentProfile({ ...valid, persona: 42 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('not-a-string');
  });

  test('externalSessionId：缺省 → null；给了就原样（trim 后）透传', () => {
    const none = createAgentProfile({ ...valid });
    expect(none.ok).toBe(true);
    if (none.ok) expect(none.profile.externalSessionId).toBeNull();

    const withSession = createAgentProfile({ ...valid, externalSessionId: '  sess-abc-123 ' });
    expect(withSession.ok).toBe(true);
    if (withSession.ok) expect(withSession.profile.externalSessionId).toBe('sess-abc-123');
  });
});

describe('toAgentProfile：agent 视角投影（同一份真相，不另存一份）', () => {
  test('已绑定 agent 的角色 → 投影字段与 CharacterView 一致', () => {
    const character = characterAt({
      id: 'c-neo',
      name: 'Neo',
      persona: '稳',
      level: 2,
      experience: 100,
      agentKind: 'codex',
      skinId: 'skin-blue',
      externalSessionId: 'sess-1',
    });
    expect(toAgentProfile(character)).toEqual({
      id: 'c-neo',
      agentKind: 'codex',
      displayName: 'Neo',
      skinId: 'skin-blue',
      persona: '稳',
      level: 2,
      exp: 100,
      externalSessionId: 'sess-1',
    });
  });

  test('未绑定 agent 的角色 → null（不编造 agentKind）', () => {
    expect(toAgentProfile(characterAt())).toBeNull();
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
    // 300 落在 L3 区间（新曲线：250 到 L3、475 才到 L4）。
    expect(store.getState().characters[0]?.level).toBe(3);
  });
});

// ============================================================================
// 升级 → 战场单位 level 同步（@since v3.37，task_062 名字标签）：升级时同一次 setState
// 刷新 units[].level（与 updateName/updateAppearance 的「两侧不漂移」纪律同一条）；
// 纯经验变动不动 units 引用。
// ============================================================================

describe('CharacterManager.grantExperience：升级 → 战场单位 level 同步（task_062）', () => {
  /** 夹具：一个带战场单位的角色（units 与 characters 同源，建档投影口径）。 */
  function unitHarness(experience: number) {
    const character = characterAt({ experience });
    const units: UnitView[] = [
      { id: 'unit_c-neo', name: 'Neo', status: 'idle', missionId: null, power: 1, characterId: 'c-neo', level: character.level },
      { id: 'unit_c-other', name: '贝塔', status: 'idle', missionId: null, power: 1, characterId: 'c-other', level: 5 },
    ];
    const store = createStore({ characters: [character], units });
    const manager = createCharacterManager({ store });
    return { store, manager };
  }

  test('升级：同一次 setState 刷新 units[].level（同广播，两侧不漂移）', () => {
    const { store, manager } = unitHarness(90); // L1 差 10 exp 升 L2（新曲线到 L2 要 100）
    const unitsRef = store.getState().units;
    let broadcasts = 0;
    let unitBroadcasts = 0;
    store.subscribe((state) => {
      broadcasts += 1;
      if (state.units !== unitsRef) unitBroadcasts += 1;
    });

    const result = manager.grantExperience('c-neo', 20);

    expect(result.ok).toBe(true);
    expect(store.getState().units[0]).toMatchObject({ id: 'unit_c-neo', level: 2 });
    expect(store.getState().units[1]).toMatchObject({ id: 'unit_c-other', level: 5 }); // 只动它自己的单位
    expect(store.getState().characters[0]?.level).toBe(2);
    expect(broadcasts).toBe(1); // 一次加经验 = 一次广播（升级投影不额外广播）
    expect(unitBroadcasts).toBe(1);
  });

  test('纯经验变动（没升级）：units 引用不变（广播面最小，不碰战场）', () => {
    const { store, manager } = unitHarness(0);
    const unitsRef = store.getState().units;

    const result = manager.grantExperience('c-neo', 10);

    expect(result.ok).toBe(true);
    expect(store.getState().units).toBe(unitsRef); // 同一引用：没动战场单位
    expect(store.getState().units[0]?.level).toBe(1);
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
// 2.b CharacterManager.createCharacter：建档落库 + 同名冲突 + 上限（@since v3.7）
// ============================================================================

describe('CharacterManager.updateAppearance：形象写库投影（@since v3.20，task_041）', () => {
  /** 带外观 + 战场单位的最小状态（改形象的两侧同步刷新是本写入面的关键契约）。 */
  function stateWithUnit(appearance: CharacterView['appearance']): Partial<WorldState> {
    return {
      characters: [characterAt({ appearance })],
      units: [toCharacterUnit({ ...characterAt(), appearance: appearance ?? null })],
    };
  }

  test('合法写入：characters 与战场单位的 appearance 同一次广播刷新（两侧不漂移）', () => {
    const store = createStore(stateWithUnit({ bodyType: 'male', parts: { body: 'light' } }));
    let broadcasts = 0;
    store.subscribe(() => { broadcasts += 1; });
    const manager = createCharacterManager({ store });

    const result = manager.updateAppearance('c-neo', {
      bodyType: 'female',
      parts: { body: 'dark', hair: { variant: 'blonde', itemId: 'hair/blonde' } },
    });

    expect(result.ok).toBe(true);
    const character = store.getState().characters[0];
    const unit = store.getState().units[0];
    expect(character?.appearance).toEqual({
      bodyType: 'female',
      parts: { body: 'dark', hair: { variant: 'blonde', itemId: 'hair/blonde' } },
    });
    // 同一份引用：单位投影直接指向新外观（不是各拷一份 —— 那是漂移源头）。
    expect(unit?.appearance).toBe(character?.appearance);
    expect(broadcasts).toBe(1); // 只广播一次（原子化，不先 characters 后 units 两段拆开）
  });

  test('只刷新它自己的单位：其余单位（含未关联角色的）不动', () => {
    const appearance = { bodyType: 'male' as const, parts: { body: 'light' } };
    const other = { id: 'u-ghost', name: '路人', status: 'idle' as const, missionId: null, power: 1, characterId: null };
    const store = createStore({
      characters: [characterAt({ appearance })],
      units: [toCharacterUnit({ ...characterAt(), appearance }), other],
    });
    const manager = createCharacterManager({ store });

    manager.updateAppearance('c-neo', { bodyType: 'male', parts: { body: 'dark' } });

    expect(store.getState().units.find((u) => u.id === other.id)).toEqual(other);
  });

  test('与原值语义相等（纯串 / 精确选择两形态逐项比内容）→ 不写库不广播', () => {
    const store = createStore(stateWithUnit({
      bodyType: 'male',
      parts: { body: 'light', torso: { variant: 'white_shirt', itemId: 'torso/long/white_shirt' } },
    }));
    let broadcasts = 0;
    store.subscribe(() => { broadcasts += 1; });
    const manager = createCharacterManager({ store });

    // 内容相等但对象全新：面板每次保存都构造新对象，只比引用会把「没改动」也当成写入。
    const unchanged = manager.updateAppearance('c-neo', {
      bodyType: 'male',
      parts: { torso: { itemId: 'torso/long/white_shirt', variant: 'white_shirt' }, body: 'light' },
    });

    expect(unchanged.ok).toBe(true);
    expect(broadcasts).toBe(0);
    expect(store.getState().notices).toHaveLength(0);
    // 部位条数不同即不相等：多一个类别也算改动。
    const grew = manager.updateAppearance('c-neo', {
      bodyType: 'male',
      parts: { body: 'light' },
    });
    expect(grew.ok).toBe(true);
    expect(broadcasts).toBe(1);
  });

  test('角色不存在：拒发 + warn Notice，状态不变', () => {
    const store = createStore(stateWithUnit(null));
    const manager = createCharacterManager({ store });

    const result = manager.updateAppearance('c-ghost', { bodyType: 'male', parts: {} });

    expect(result).toEqual({ ok: false, code: 'not-found', characterId: 'c-ghost' });
    expect(store.getState().notices[0]).toMatchObject({ level: 'warn', source: 'core/character' });
  });

  test('非法外观（体型词表外 / parts 非对象 / 载荷缺失）：拒发 + Notice，一分不改', () => {
    const store = createStore(stateWithUnit({ bodyType: 'male', parts: { body: 'light' } }));
    const manager = createCharacterManager({ store });

    const badBodyType = manager.updateAppearance('c-neo', { bodyType: 'giant', parts: {} });
    const badParts = manager.updateAppearance('c-neo', { bodyType: 'male', parts: ['light'] as never });
    const missing = manager.updateAppearance('c-neo', undefined);

    expect(badBodyType).toEqual({ ok: false, code: 'invalid-appearance', characterId: 'c-neo' });
    expect(badParts).toMatchObject({ ok: false, code: 'invalid-appearance' });
    expect(missing).toMatchObject({ ok: false, code: 'invalid-appearance' });
    expect(store.getState().notices).toHaveLength(3);
    expect(store.getState().characters[0]?.appearance).toEqual({ bodyType: 'male', parts: { body: 'light' } });
  });
});

describe('CharacterManager.createCharacter：建档落库', () => {
  const input = {
    name: 'Neo',
    agentKind: 'claude-code',
    skinId: 'skin-default',
    persona: '谨慎的数据分析师',
  } as const;

  test('合法建档：落进 WorldState.characters，初始 1 级 0 经验，广播一次', () => {
    const store = createStore();
    const manager = createCharacterManager({ store });
    let broadcasts = 0;
    store.subscribe(() => { broadcasts += 1; });

    const result = manager.createCharacter(input);

    expect(result.ok).toBe(true);
    const characters = store.getState().characters;
    expect(characters).toHaveLength(1);
    expect(characters[0]).toMatchObject({
      name: 'Neo',
      persona: '谨慎的数据分析师',
      level: 1,
      experience: 0,
      agentKind: 'claude-code',
      skinId: 'skin-default',
      externalSessionId: null,
    });
    expect(characters[0]?.id).toBeTruthy();
    expect(broadcasts).toBe(1);
  });

  test('成功建档不打扰用户（不推成功 Notice）——状态广播本身就是反馈', () => {
    const store = createStore();
    const manager = createCharacterManager({ store });

    manager.createCharacter(input);

    expect(store.getState().notices).toHaveLength(0);
  });

  test('非法名（空 / 纯空白）：拒发 + Notice，characters 不变', () => {
    const store = createStore();
    const manager = createCharacterManager({ store });

    const result = manager.createCharacter({ ...input, name: '   ' });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('empty-name');
    expect(store.getState().characters).toHaveLength(0);
    expect(store.getState().notices).toHaveLength(1);
    expect(store.getState().notices[0]).toMatchObject({ level: 'warn', source: 'core/character' });
  });

  test('名字超长：拒发 + Notice，characters 不变', () => {
    const store = createStore();
    const manager = createCharacterManager({ store });

    const result = manager.createCharacter({
      ...input,
      name: '名'.repeat(MAX_CHARACTER_NAME_LEN + 1),
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('name-too-long');
    expect(store.getState().characters).toHaveLength(0);
    expect(store.getState().notices).toHaveLength(1);
  });

  test('空 persona：套默认模板落库（不拒发）', () => {
    const store = createStore();
    const manager = createCharacterManager({ store });

    const result = manager.createCharacter({ ...input, persona: '  ' });

    expect(result.ok).toBe(true);
    expect(store.getState().characters[0]?.persona).toBe(DEFAULT_PERSONA_TEMPLATE);
  });

  test('persona 缺省：同样套默认模板', () => {
    const store = createStore();
    const manager = createCharacterManager({ store });

    const result = manager.createCharacter({
      name: 'Trinity',
      agentKind: 'codex',
      skinId: 'skin-default',
    });

    expect(result.ok).toBe(true);
    expect(store.getState().characters[0]?.persona).toBe(DEFAULT_PERSONA_TEMPLATE);
  });

  test('重复同名：拒发 + **error 级** Notice，characters 不变（不建第二份）', () => {
    const store = createStore();
    const manager = createCharacterManager({ store });

    const first = manager.createCharacter(input);
    expect(first.ok).toBe(true);

    const second = manager.createCharacter(input);

    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.code).toBe('duplicate-name');
    expect(store.getState().characters).toHaveLength(1);
    expect(store.getState().notices).toHaveLength(1);
    expect(store.getState().notices[0]).toMatchObject({ level: 'error', source: 'core/character' });
  });

  test('重复同名大小写不敏感（Neo / neo 视为同一个）', () => {
    const store = createStore();
    const manager = createCharacterManager({ store });

    manager.createCharacter(input);
    const second = manager.createCharacter({ ...input, name: ' neo ' });

    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.code).toBe('duplicate-name');
    expect(store.getState().characters).toHaveLength(1);
  });

  test('未知 agent 种类：拒发 + Notice', () => {
    const store = createStore();
    const manager = createCharacterManager({ store });

    const result = manager.createCharacter({
      ...input,
      agentKind: 'gpt' as unknown as 'codex',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('unknown-agent-kind');
    expect(store.getState().characters).toHaveLength(0);
    expect(store.getState().notices).toHaveLength(1);
  });

  test('条数达上限：拒发 + Notice，绝不静默挤掉已有角色', () => {
    const existing = Array.from({ length: MAX_CHARACTERS }, (_, i) =>
      characterAt({ id: `c-${i}`, name: `Agent${i}` })
    );
    const store = createStore(stateWith(existing));
    const manager = createCharacterManager({ store });

    const result = manager.createCharacter(input);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('limit-exceeded');
    expect(store.getState().characters).toHaveLength(MAX_CHARACTERS);
    expect(store.getState().notices[0]?.text).toContain(String(MAX_CHARACTERS));
  });

  test('建档后原有角色不受影响（追加而非整表替换）', () => {
    const store = createStore(stateWith([characterAt({ id: 'c-a', name: 'A' })]));
    const manager = createCharacterManager({ store });

    manager.createCharacter(input);

    const [a, b] = store.getState().characters;
    expect(a).toEqual(characterAt({ id: 'c-a', name: 'A' }));
    expect(b?.name).toBe('Neo');
  });
});

// ============================================================================
// 2.c 角色 → 战场单位的投影（@since v3.9，task_026）
// ============================================================================

describe('角色 → 战场单位（建档即入战场）', () => {
  const input = {
    name: 'Neo',
    agentKind: 'claude-code',
    skinId: 'crimson',
    persona: '谨慎的数据分析师',
  } as const;

  test('toCharacterUnit：字段按角色档案投影（id 加前缀，回指角色与皮肤）', () => {
    const unit = toCharacterUnit({
      id: 'character_1_1',
      name: 'Neo',
      persona: 'x',
      level: 1,
      experience: 0,
      agentKind: 'claude-code',
      skinId: 'crimson',
    });

    expect(unit).toEqual({
      id: 'unit_character_1_1',
      name: 'Neo',
      status: 'idle',
      missionId: null,
      power: 0,
      characterId: 'character_1_1',
      skinId: 'crimson',
      // @since v3.10：没有外观 → null（渲染侧回落到占位形体，不编造长相）。
      appearance: null,
      // @since v3.37（task_062）：等级投影（战场头顶 Lv 小字的数据面）。
      level: 1,
    });
  });

  test('toCharacterUnit：带 appearance 的角色把外观投影给单位（渲染侧据此合成精灵表）', () => {
    const appearance = { bodyType: 'female' as const, parts: { hair: 'black' } };
    const unit = toCharacterUnit({
      id: 'c-2',
      name: 'B',
      persona: '',
      level: 1,
      experience: 0,
      agentKind: 'claude-code',
      appearance,
    });

    expect(unit.appearance).toEqual(appearance);
  });

  test('toCharacterUnit：没有皮肤时 skinId 为 null（渲染侧回落到业务态颜色）', () => {
    const unit = toCharacterUnit({
      id: 'c-1',
      name: 'A',
      persona: '',
      level: 1,
      experience: 0,
      agentKind: 'claude-code',
    });

    expect(unit.skinId).toBeNull();
  });

  test('建档成功 → 同一次写入里多出该角色的战场单位', () => {
    const store = createStore();
    const manager = createCharacterManager({ store });

    const result = manager.createCharacter(input);
    expect(result.ok).toBe(true);

    const units = store.getState().units;
    expect(units).toHaveLength(1);
    expect(units[0]).toMatchObject({
      name: 'Neo',
      status: 'idle',
      missionId: null,
      characterId: result.ok ? result.character.id : '',
      skinId: 'crimson',
    });
    // 单位 id 带上角色 id：既唯一，又能一眼回溯到角色。
    expect(units[0]?.id).toBe(`unit_${result.ok ? result.character.id : ''}`);
  });

  test('角色与单位在同一次广播里下发（一次建档 = 一次广播）', () => {
    const store = createStore();
    const manager = createCharacterManager({ store });
    let broadcasts = 0;
    store.subscribe(() => { broadcasts += 1; });

    manager.createCharacter(input);

    expect(broadcasts).toBe(1);
    const state = store.getState();
    expect(state.characters).toHaveLength(1);
    expect(state.units).toHaveLength(1);
  });

  test('建档被拒 → 不产生单位（units 不变）', () => {
    const store = createStore();
    const manager = createCharacterManager({ store });

    manager.createCharacter({ ...input, name: '   ' });

    expect(store.getState().characters).toHaveLength(0);
    expect(store.getState().units).toHaveLength(0);
  });

  test('同名冲突 → 不产生第二个单位', () => {
    const store = createStore();
    const manager = createCharacterManager({ store });

    manager.createCharacter(input);
    manager.createCharacter(input);

    expect(store.getState().characters).toHaveLength(1);
    expect(store.getState().units).toHaveLength(1);
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

  test('character.create 走 manager 落库并广播新角色（@since v3.7 接线）', () => {
    resetBus();
    const store = createStore();
    const runtime = createCoreRuntime({ store });
    const seen: WorldState[] = [];
    const off = onState((state) => { seen.push(state); });
    const stop = runtime.start();

    emitCommand({
      type: 'character.create',
      name: '  Neo  ',
      agentKind: 'claude-code',
      skinId: 'skin-default',
      persona: '谨慎的数据分析师',
    });
    stop();
    off();

    expect(seen).toHaveLength(1);
    expect(seen[0]?.characters).toHaveLength(1);
    expect(seen[0]?.characters[0]).toMatchObject({
      name: 'Neo',
      persona: '谨慎的数据分析师',
      level: 1,
      experience: 0,
      agentKind: 'claude-code',
      skinId: 'skin-default',
    });
  });

  test('character.create：空 persona 经总线也套默认模板', () => {
    resetBus();
    const store = createStore();
    const runtime = createCoreRuntime({ store });
    const stop = runtime.start();

    emitCommand({ type: 'character.create', name: 'Trinity', agentKind: 'codex', skinId: 'skin-default' });
    stop();

    expect(store.getState().characters[0]?.persona).toBe(DEFAULT_PERSONA_TEMPLATE);
  });

  test('character.create：带 appearance 的角色把外观落库（@since v3.10，task_028）', () => {
    resetBus();
    const store = createStore();
    const runtime = createCoreRuntime({ store });
    const stop = runtime.start();

    emitCommand({
      type: 'character.create',
      name: 'Trinity',
      agentKind: 'codex',
      skinId: 'skin-default',
      appearance: { bodyType: 'female', parts: { body: 'light', hair: 'blonde' } },
    });
    stop();

    expect(store.getState().characters[0]?.appearance).toEqual({
      bodyType: 'female',
      parts: { body: 'light', hair: 'blonde' },
    });
  });

  test('character.create：不带 appearance 的角色**没有**这个键（老档案形状不变）', () => {
    resetBus();
    const store = createStore();
    const runtime = createCoreRuntime({ store });
    const stop = runtime.start();

    emitCommand({ type: 'character.create', name: 'Trinity', agentKind: 'codex', skinId: 'skin-default' });
    stop();

    expect(store.getState().characters[0]).not.toHaveProperty('appearance');
  });

  test('character.create：非法 appearance 被拒（不落库）', () => {
    resetBus();
    const store = createStore();
    const runtime = createCoreRuntime({ store });
    const stop = runtime.start();

    emitCommand({
      type: 'character.create',
      name: 'Trinity',
      agentKind: 'codex',
      skinId: 'skin-default',
      // 体型不在词表内 → core 拒发（宁可不建档，也不建个画不出来的角色）
      appearance: { bodyType: 'giant', parts: {} },
    } as never);
    stop();

    expect(store.getState().characters).toHaveLength(0);
    expect(store.getState().notices[0]).toMatchObject({ level: 'warn', source: 'core/character' });
  });

  test('character.create：重复同名经总线走 error Notice，characters 只有一份', () => {
    resetBus();
    const store = createStore();
    const runtime = createCoreRuntime({ store });
    const stop = runtime.start();

    emitCommand({ type: 'character.create', name: 'Neo', agentKind: 'claude-code', skinId: 'skin-default' });
    emitCommand({ type: 'character.create', name: 'Neo', agentKind: 'codex', skinId: 'skin-default' });
    stop();

    expect(store.getState().characters).toHaveLength(1);
    expect(store.getState().notices).toHaveLength(1);
    expect(store.getState().notices[0]).toMatchObject({ level: 'error', source: 'core/character' });
  });

  test('character.create：非法名经总线走 warn Notice，不落库', () => {
    resetBus();
    const store = createStore();
    const runtime = createCoreRuntime({ store });
    const stop = runtime.start();

    emitCommand({ type: 'character.create', name: '  ', agentKind: 'claude-code', skinId: 'skin-default' });
    stop();

    expect(store.getState().characters).toHaveLength(0);
    expect(store.getState().notices).toHaveLength(1);
    expect(store.getState().notices[0]).toMatchObject({ level: 'warn', source: 'core/character' });
  });

  test('character.appearance.update：形象写入面经总线闭环（task_041）—— characters 与 units 同步刷新', () => {
    resetBus();
    const appearance: CharacterAppearance = { bodyType: 'male', parts: { body: 'light' } };
    const store = createStore({
      characters: [characterAt({ appearance })],
      units: [toCharacterUnit({ ...characterAt(), appearance })],
    });
    const runtime = createCoreRuntime({ store });
    const stop = runtime.start();

    emitCommand({
      type: 'character.appearance.update',
      characterId: 'c-neo',
      appearance: { bodyType: 'female', parts: { body: 'dark' } },
    });
    stop();

    const character = store.getState().characters[0];
    const unit = store.getState().units[0];
    expect(character?.appearance).toEqual({ bodyType: 'female', parts: { body: 'dark' } });
    expect(unit?.appearance).toEqual({ bodyType: 'female', parts: { body: 'dark' } });
  });

  test('character.appearance.update：非解锁门槛所拦（core 不判解锁，写入面只管形状合法）—— 高等级部位照常落库', () => {
    resetBus();
    const store = createStore({
      characters: [characterAt({ appearance: { bodyType: 'male', parts: { body: 'light' } } })],
      units: [toCharacterUnit({ ...characterAt(), appearance: { bodyType: 'male', parts: { body: 'light' } } })],
    });
    const runtime = createCoreRuntime({ store });
    const stop = runtime.start();

    // L1 角色写 L8 才解锁的 shield：解锁是编辑 UI 的引导约束，不是数据完整性约束
    //（老档案 / 向导产出的形象本就可能含高等级部位，core 若按等级拦截会自相矛盾）。
    emitCommand({
      type: 'character.appearance.update',
      characterId: 'c-neo',
      appearance: { bodyType: 'male', parts: { body: 'light', shield: 'round' } },
    });
    stop();

    expect(store.getState().characters[0]?.appearance).toEqual({
      bodyType: 'male',
      parts: { body: 'light', shield: 'round' },
    });
    expect(store.getState().notices).toHaveLength(0);
  });
});
// ============================================================================
// 2.d CharacterManager.updateContextEnabled：上下文注入开关写库（@since v3.29，task_053）
// ============================================================================

describe('CharacterManager.updateContextEnabled：角色级上下文开关（task_053）', () => {
  test('写入 false：characters.contextEnabled 落库 + 恰好广播一次', () => {
    const store = createStore({ characters: [characterAt()] });
    let broadcasts = 0;
    store.subscribe(() => { broadcasts += 1; });
    const manager = createCharacterManager({ store });

    const result = manager.updateContextEnabled('c-neo', false);

    expect(result).toEqual({ ok: true, enabled: false });
    expect(store.getState().characters[0]?.contextEnabled).toBe(false);
    expect(broadcasts).toBe(1);
  });

  test('同值幂等（含缺省归一）：不写库不广播（undefined ≡ true）', () => {
    const store = createStore({ characters: [characterAt()] }); // 缺省 = 开
    let broadcasts = 0;
    store.subscribe(() => { broadcasts += 1; });
    const manager = createCharacterManager({ store });

    expect(manager.updateContextEnabled('c-neo', true)).toEqual({ ok: true, enabled: true });
    expect(broadcasts).toBe(0);

    // 关掉再关：第二次同值仍幂等
    manager.updateContextEnabled('c-neo', false);
    const broadcastsAfterOff = broadcasts;
    expect(manager.updateContextEnabled('c-neo', false)).toEqual({ ok: true, enabled: false });
    expect(broadcasts).toBe(broadcastsAfterOff);
    expect(store.getState().characters[0]?.contextEnabled).toBe(false);
  });

  test('角色不在档：拒发 + warn Notice，状态不变', () => {
    const store = createStore({ characters: [characterAt()] });
    const manager = createCharacterManager({ store });

    const result = manager.updateContextEnabled('c-ghost', false);

    expect(result).toEqual({ ok: false, code: 'not-found', characterId: 'c-ghost' });
    expect(store.getState().notices[0]?.text).toContain('c-ghost');
    expect(store.getState().characters[0]?.contextEnabled).toBeUndefined();
  });

  test('闭环：emitCommand character.contextEnabled.update → 落库广播（runtime 接线）', () => {
    resetBus();
    const store = createStore({ characters: [characterAt()] });
    const manager = createCharacterManager({ store });
    const runtime = createCoreRuntime({ store, character: manager });
    const stopRuntime = runtime.start();
    const seen: Array<boolean | null | undefined> = [];
    const off = onState((state) => {
      seen.push(state.characters[0]?.contextEnabled);
    });

    emitCommand({ type: 'character.contextEnabled.update', characterId: 'c-neo', enabled: false });
    emitCommand({ type: 'character.contextEnabled.update', characterId: 'c-neo', enabled: true });

    expect(store.getState().characters[0]?.contextEnabled).toBe(true);
    expect(seen.some((value) => value === false)).toBe(true); // 关的那次也广播过（HUD 开关钮实时反映）
    stopRuntime();
    off();
    resetBus();
  });
});

// ============================================================================
// 2.f CharacterManager.updateName：改名写库投影（@since v3.35，task_059 编辑中心）
// ============================================================================

describe('CharacterManager.updateName：改名写库投影（@since v3.35，task_059）', () => {
  /** 带战场单位的改名夹具：units 与 characters 同源（建档投影口径）。 */
  function renameHarness(characters: CharacterView[], units: UnitView[]) {
    const store = createStore({ characters, units });
    const manager = createCharacterManager({ store });
    let broadcasts = 0;
    store.subscribe(() => { broadcasts += 1; });
    return { store, manager, broadcasts: () => broadcasts };
  }

  test('合法改名：characters 与战场单位的 name 同一次广播刷新（两侧不漂移）', () => {
    const a = characterAt({ id: 'c-a', name: 'Neo' });
    const b = characterAt({ id: 'c-b', name: '贝塔' });
    const units: UnitView[] = [
      { id: 'unit_c-a', name: 'Neo', status: 'idle', missionId: null, power: 1, characterId: 'c-a' },
      { id: 'unit_c-b', name: '贝塔', status: 'idle', missionId: null, power: 1, characterId: 'c-b' },
    ];
    const { store, manager, broadcasts } = renameHarness([a, b], units);

    const result = manager.updateName('c-a', '  崔尼蒂 ');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.name).toBe('崔尼蒂'); // trim 后生效
      expect(result.character.name).toBe('崔尼蒂');
    }
    expect(store.getState().characters[0]?.name).toBe('崔尼蒂');
    // 战场单位名同一次刷新（需求③：改名 → 战场单位名实时刷新）。
    expect(store.getState().units[0]?.name).toBe('崔尼蒂');
    expect(store.getState().units[1]?.name).toBe('贝塔'); // 只动它自己的单位
    expect(broadcasts()).toBe(1); // 一次 setState = 一次广播
  });

  test('与自己当前名字相同（trim 后完全一致）→ 幂等成功，不写库不广播', () => {
    const a = characterAt({ id: 'c-a', name: 'Neo' });
    const units: UnitView[] = [
      { id: 'unit_c-a', name: 'Neo', status: 'idle', missionId: null, power: 1, characterId: 'c-a' },
    ];
    const { store, manager, broadcasts } = renameHarness([a], units);

    const result = manager.updateName('c-a', '  Neo ');

    expect(result.ok).toBe(true);
    expect(store.getState().characters[0]?.name).toBe('Neo');
    expect(broadcasts()).toBe(0);
  });

  test('与其它角色重名（大小写不敏感）→ 拒发 + error 级 Notice，状态不变', () => {
    const a = characterAt({ id: 'c-a', name: 'Neo' });
    const b = characterAt({ id: 'c-b', name: '贝塔' });
    const { store, manager } = renameHarness([a, b], []);

    const result = manager.updateName('c-a', '  贝塔 ');

    expect(result).toEqual({ ok: false, code: 'duplicate-name', characterId: 'c-a' });
    expect(store.getState().characters[0]?.name).toBe('Neo');
    expect(store.getState().notices[0]).toMatchObject({ level: 'error', source: 'core/character' });
    expect(store.getState().notices[0]?.text).toContain('同名');
  });

  test('改名豁免自己：Neo → NEO 是合法改名（不是重名）', () => {
    const a = characterAt({ id: 'c-a', name: 'Neo' });
    const { store, manager } = renameHarness([a], []);

    const result = manager.updateName('c-a', 'NEO');

    expect(result.ok).toBe(true);
    expect(store.getState().characters[0]?.name).toBe('NEO');
  });

  test('空名 / 纯空白 → 拒发 + warn Notice，状态不变', () => {
    const a = characterAt({ id: 'c-a', name: 'Neo' });
    const { store, manager } = renameHarness([a], []);

    const result = manager.updateName('c-a', '   ');

    expect(result).toEqual({ ok: false, code: 'empty-name', characterId: 'c-a' });
    expect(store.getState().characters[0]?.name).toBe('Neo');
    expect(store.getState().notices[0]).toMatchObject({ level: 'warn', source: 'core/character' });
  });

  test('名字超长（> 24 码点）→ 拒发 + warn Notice', () => {
    const a = characterAt({ id: 'c-a', name: 'Neo' });
    const { store, manager } = renameHarness([a], []);

    const result = manager.updateName('c-a', 'a'.repeat(25));

    expect(result).toEqual({ ok: false, code: 'name-too-long', characterId: 'c-a' });
    expect(store.getState().characters[0]?.name).toBe('Neo');
    expect(store.getState().notices[0]?.text).toContain('角色名过长');
  });

  test('角色不在档 → 拒发 + warn Notice，characters 不变', () => {
    const { store, manager } = renameHarness([characterAt()], []);

    const result = manager.updateName('c-ghost', '新名字');

    expect(result).toEqual({ ok: false, code: 'not-found', characterId: 'c-ghost' });
    expect(store.getState().notices[0]?.text).toContain('c-ghost');
  });

  test('闭环：emitCommand character.name.update → 落库广播（runtime 接线）', () => {
    resetBus();
    const a = characterAt({ id: 'c-a', name: 'Neo' });
    const units: UnitView[] = [
      { id: 'unit_c-a', name: 'Neo', status: 'idle', missionId: null, power: 1, characterId: 'c-a' },
    ];
    const store = createStore({ characters: [a], units });
    const manager = createCharacterManager({ store });
    const runtime = createCoreRuntime({ store, character: manager });
    const stopRuntime = runtime.start();
    const seen: string[] = [];
    const off = onState((state) => { seen.push(state.units[0]?.name ?? ''); });

    emitCommand({ type: 'character.name.update', characterId: 'c-a', name: '崔尼蒂' });

    expect(store.getState().characters[0]?.name).toBe('崔尼蒂');
    expect(store.getState().units[0]?.name).toBe('崔尼蒂');
    expect(seen.some((name) => name === '崔尼蒂')).toBe(true); // HUD 单位名实时刷新的广播证据
    stopRuntime();
    off();
    resetBus();
  });
});
