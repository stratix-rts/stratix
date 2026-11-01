/**
 * 单测：皮肤库注册表（core/theme/skin-registry.ts）。
 * 覆盖：清单完整性、id 唯一、徽标色取值、随机抽签不重复（种子注入）、同种子可复现。
 *
 * 边界说明（@since v3.9，task_026）：注册表随任务从 hud/theme 迁到 core/theme ——
 *   皮肤的徽标色两侧都要用（HUD 徽标 / 战场单位染色），按铁律 hud ↔ world 不能互相 import，
 *   故这份登记表必须落在共用底座 core。**与 CSS 的一致性断言留在 hud 侧**
 *   （hud/theme/__tests__/skin-tokens.test.ts）—— core 不读 hud 的样式表。
 */

import {
  SKINS,
  SKIN_IDS,
  createSkinRandomizer,
  getSkin,
  isSkinId,
  listSkins,
  randomSkin,
  resetSkinRandomizer,
  resolveAccent,
  type SkinId,
} from '../skin-registry';

/** task_024 要求新增的六套皮肤。 */
const NEW_SKIN_IDS: readonly SkinId[] = ['crimson', 'forest', 'ocean', 'sunset', 'mono', 'aurora'];

describe('皮肤库清单', () => {
  test('至少 8 套皮肤（原有 2 套 + 新增 6 套）', () => {
    expect(listSkins().length).toBeGreaterThanOrEqual(8);
  });

  test('六套新皮肤都在库里', () => {
    for (const id of NEW_SKIN_IDS) {
      expect(isSkinId(id)).toBe(true);
      expect(getSkin(id)).toBeDefined();
    }
  });

  test('原有 default / pixel 仍在库里（不被新皮肤顶掉）', () => {
    expect(isSkinId('default')).toBe(true);
    expect(isSkinId('pixel')).toBe(true);
  });

  test('皮肤 id 唯一', () => {
    expect(new Set(SKIN_IDS).size).toBe(SKIN_IDS.length);
  });

  test('清单是只读的（调用方拿到的数组无法就地改写）', () => {
    expect(Object.isFrozen(listSkins())).toBe(true);
  });

  test('未知 id：getSkin 返回 undefined，isSkinId 返回 false', () => {
    expect(getSkin('no-such-skin')).toBeUndefined();
    expect(isSkinId('no-such-skin')).toBe(false);
  });
});

describe('徽标色', () => {
  test('resolveAccent 按 id 取徽标色', () => {
    for (const skin of SKINS) {
      expect(resolveAccent(skin.id)).toBe(skin.accent);
    }
  });

  test('resolveAccent 遇到未知 id 回落 default 徽标色（不抛错）', () => {
    expect(resolveAccent('no-such-skin')).toBe(resolveAccent('default'));
  });

  test('皮肤 id 是合法资源键（非空字符串，可直接当 AgentProfile.skinId）', () => {
    for (const skin of SKINS) {
      expect(typeof skin.id).toBe('string');
      expect(skin.id.trim().length).toBeGreaterThan(0);
    }
  });
});

describe('随机抽签：不重复', () => {
  beforeEach(() => {
    // 每次用例从同一个已知种子起步，避免用例之间互相影响。
    resetSkinRandomizer(20240601);
  });

  test('randomSkin(seed) 连抽一整轮 → 皮肤互不重复', () => {
    const picks = Array.from({ length: SKINS.length }, () => randomSkin(20240601).id);
    expect(new Set(picks).size).toBe(SKINS.length);
  });

  test('randomSkin(seed) 连续两次不会抽到同一套', () => {
    const first = randomSkin(20240601);
    const second = randomSkin(20240601);
    expect(first.id).not.toBe(second.id);
  });

  test('createSkinRandomizer：一轮之内不重复', () => {
    const randomizer = createSkinRandomizer(7);
    const picks = Array.from({ length: SKINS.length }, () => randomizer.next().id);
    expect(new Set(picks).size).toBe(SKINS.length);
  });

  test('createSkinRandomizer：抽完整轮后重新洗牌（drawn 归零重来）', () => {
    const randomizer = createSkinRandomizer(7);
    for (let i = 0; i < SKINS.length; i += 1) randomizer.next();
    expect(randomizer.drawn).toHaveLength(SKINS.length);
    randomizer.next();
    expect(randomizer.drawn).toHaveLength(1);
  });

  test('同种子 → 同序列（可复现）', () => {
    const a = createSkinRandomizer(42);
    const b = createSkinRandomizer(42);
    const seqA = Array.from({ length: 5 }, () => a.next().id);
    const seqB = Array.from({ length: 5 }, () => b.next().id);
    expect(seqA).toEqual(seqB);
  });

  test('换种子即重置抽签池（不同种子 → 不同序列）', () => {
    const a = createSkinRandomizer(42);
    const b = createSkinRandomizer(43);
    const seqA = Array.from({ length: 5 }, () => a.next().id);
    const seqB = Array.from({ length: 5 }, () => b.next().id);
    expect(seqA).not.toEqual(seqB);
  });

  test('reset 后同种子序列可复现（模块级抽签器）', () => {
    resetSkinRandomizer(31);
    const first = randomSkin(31).id;
    resetSkinRandomizer(99);
    randomSkin(99);
    resetSkinRandomizer(31);
    expect(randomSkin(31).id).toBe(first);
  });

  test('抽签器记录的种子与 drawn 顺序可查', () => {
    const randomizer = createSkinRandomizer(11);
    const first = randomizer.next().id;
    expect(randomizer.seed).toBe(11);
    expect(randomizer.drawn).toEqual([first]);
  });
});
