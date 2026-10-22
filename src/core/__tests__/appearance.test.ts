/**
 * 单测：角色外观模型（core/types.ts 的 CharacterAppearance）+ 建档时的外观校验
 *   （core/character/profile.ts）+ 投影透传（toAgentProfile）。
 *
 * 验收要点：
 *   1. appearance 是**可选**字段 —— 老档案（无外观）照旧合法，投影形状不变（021 不破）；
 *   2. 给了就必须合法 —— 体型在词表内、部位字典有界且每项是非空字符串；
 *   3. core 不解析素材、不校验部位资源是否存在（那是渲染侧的事）。
 */

import { createAgentProfile, toAgentProfile } from '../character';
import {
  APPEARANCE_BODY_TYPES,
  MAX_APPEARANCE_PARTS,
  type CharacterAppearance,
  type CharacterView,
} from '../types';

/** 一份合法的建档输入。 */
const VALID = {
  id: 'c-1',
  name: 'Neo',
  agentKind: 'claude-code',
  skinId: 'skin-default',
} as const;

/** 造一个角色（默认无外观）。 */
function characterAt(patch: Partial<CharacterView> = {}): CharacterView {
  return {
    id: 'c-neo',
    name: 'Neo',
    persona: '稳',
    level: 1,
    experience: 0,
    agentKind: 'claude-code',
    ...patch,
  };
}

describe('外观模型：可选字段向后兼容', () => {
  test('不建外观 → 档案里没有 appearance 这个键（老档案形状不变）', () => {
    const r = createAgentProfile({ ...VALID });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect('appearance' in r.profile).toBe(false);
  });

  test('外观为 null → 同"没有外观"（不报错、不补默认长相）', () => {
    const r = createAgentProfile({ ...VALID, appearance: null });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect('appearance' in r.profile).toBe(false);
  });

  test('合法的外观 → 原样带进档案（变体名 trim 后入库）', () => {
    const r = createAgentProfile({
      ...VALID,
      appearance: { bodyType: 'female', parts: { body: 'light', hair: ' long ' } },
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.profile.appearance).toEqual({
      bodyType: 'female',
      parts: { body: 'light', hair: 'long' },
    });
  });

  test('投影透传外观：角色有 → 档案有；角色没有 → 档案里没有这个键', () => {
    const appearance: CharacterAppearance = { bodyType: 'male', parts: { body: 'dark' } };
    const withAppearance = toAgentProfile(characterAt({ appearance }));
    expect(withAppearance?.appearance).toEqual(appearance);

    const without = toAgentProfile(characterAt());
    expect(without).not.toBeNull();
    expect('appearance' in (without as object)).toBe(false);
  });
});

describe('外观模型：建档时的合法性', () => {
  test('体型不在词表内 → 拒发（invalid-appearance）', () => {
    const r = createAgentProfile({ ...VALID, appearance: { bodyType: 'giant', parts: {} } });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('invalid-appearance');
  });

  test('词表内的每个体型都合法', () => {
    for (const bodyType of APPEARANCE_BODY_TYPES) {
      const r = createAgentProfile({ ...VALID, appearance: { bodyType, parts: {} } });
      expect(r.ok).toBe(true);
    }
  });

  test('外观不是普通对象（数组 / 字符串 / 数字）→ 拒发', () => {
    for (const appearance of [['body'], 'male', 42]) {
      const r = createAgentProfile({ ...VALID, appearance });
      expect(r.ok).toBe(false);
      if (r.ok) continue;
      expect(r.code).toBe('invalid-appearance');
    }
  });

  test('部位字典非法（缺 parts / parts 非对象 / 数组）→ 拒发', () => {
    for (const appearance of [
      { bodyType: 'male' },
      { bodyType: 'male', parts: null },
      { bodyType: 'male', parts: ['light'] },
      { bodyType: 'male', parts: 'light' },
    ]) {
      const r = createAgentProfile({ ...VALID, appearance });
      expect(r.ok).toBe(false);
      if (r.ok) continue;
      expect(r.code).toBe('invalid-appearance');
    }
  });

  test('部位变体不是非空字符串 → 拒发', () => {
    for (const parts of [{ body: '' }, { body: '   ' }, { body: 42 }, { body: null }]) {
      const r = createAgentProfile({ ...VALID, appearance: { bodyType: 'male', parts } });
      expect(r.ok).toBe(false);
      if (r.ok) continue;
      expect(r.code).toBe('invalid-appearance');
    }
  });

  test('部位条数超上限 → 拒发（外观随状态广播，必须有界）', () => {
    const parts: Record<string, string> = {};
    for (let i = 0; i <= MAX_APPEARANCE_PARTS; i++) {
      parts[`cat_${i}`] = 'v';
    }
    const r = createAgentProfile({ ...VALID, appearance: { bodyType: 'male', parts } });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('invalid-appearance');
  });

  test('变体名超长 → 拒发', () => {
    const r = createAgentProfile({
      ...VALID,
      appearance: { bodyType: 'male', parts: { body: 'x'.repeat(500) } },
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('invalid-appearance');
  });

  test('拒绝时不改状态、也不返回半成品档案（与其它建档错误同口径）', () => {
    const r = createAgentProfile({ ...VALID, appearance: { bodyType: 'nope', parts: {} } });
    expect(r.ok).toBe(false);
    expect('profile' in r).toBe(false);
  });
});
