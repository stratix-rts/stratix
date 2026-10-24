/**
 * 单测：**规则化随机形象生成器**（src/world/appearance/appearance-randomizer.ts）。
 *
 * 覆盖三档（minimal / normal / full）的规则行为：
 *   - minimal：跳过清单命中的类别 / 条目一律不出现、头部只留人类头部、
 *     平民不穿甲（armour / chainmail / jacket / dress …）、身体不是骷髅僵尸、独眼不出现；
 *   - normal：盾牌按概率留空 + 不留空时只从 ALLOWED_SHIELDS 里抽、可选部位按概率留空；
 *   - full：无空概率（有素材的类别一律出现）。
 *
 * 隔离方式：
 *   - 素材元数据用一份**手写的小夹具**（id / typeName / required 照抄真实
 *     dist/frontend/spritesheets/item-metadata.json 的对应条目），不读 1.4MB 真文件 ——
 *     单测要锁的是**规则**，不是素材内容（素材一改就红不算回归）。
 *   - 随机源**打桩**：常量随机源把概率行为变成确定行为（0.05 / 0.4 / 0.5 三档取值）；
 *     需要"抽遍整个候选池"时用扫值法（0.0 → 0.9 逐个喂进去）。
 */

import {
  appearancePartItemId,
  appearancePartVariant,
  type CharacterAppearance,
} from '../../../core/types';
import {
  ALLOWED_SHIELDS,
  MINIMAL_ALIGNED_SKIP_ITEMS,
  MINIMAL_HEAD_PREFIXES,
  MINIMAL_SKIP_VARIANTS,
  OPTIONAL_CATEGORIES,
  RANDOMIZATION_MODES,
  SHIELD_EMPTY_CHANCE,
  randomizeAppearance,
} from '../appearance-randomizer';
import { PartRegistry } from '../part-registry';
import { createJsonFetch } from './helpers/fakes';

/** 一条素材的最小形状（其余字段注册表用不到）。 */
function part(
  name: string,
  typeName: string,
  variants: string[],
  required: string[] = ['male']
): Record<string, unknown> {
  return {
    name,
    typeName,
    required,
    variants,
    animations: ['walk'],
    layers: { layer_1: { zPos: 10, male: `${typeName}/${name}/male/` } },
    credits: [],
  };
}

/**
 * 夹具：覆盖 22 个代码类别，且每类都放了"该被规则拦住的条目"
 * （甲 / 裙 / 独眼 / 骷髅身 / 非人类头 / 非白名单盾 …）。
 */
const METADATA: Record<string, Record<string, unknown>> = {
  shadow: part('Shadow', 'shadow', ['shadow']),
  // 照抄真实素材的形态：人形 body 的变体清单里混着怪物肤色（zombie / fur_*）
  body: part('Body', 'body', ['light', 'dark', 'zombie', 'fur_tan']),
  body_skeleton: part('Body Skeleton', 'body', ['skeleton']),
  body_zombie: part('Body Zombie', 'body', ['zombie']),

  heads_human_male: part('Human Male Head', 'head', ['light', 'tan']),
  heads_human_female: part('Human Female Head', 'head', ['light', 'tan'], ['female']),
  heads_goblin: part('Goblin Head', 'head', ['green']),

  hair_afro: part('Afro Hair', 'hair', ['black', 'blonde']),
  hair_curly: part('Curly Hair', 'hair', ['black', 'blonde']),

  eye_color: part('Eye Color', 'eye_color', ['blue', 'brown']),
  eyes_cyclops: part('Cyclops Eyes', 'eyes', ['cyclops']),

  head_ears_big: part('Big Ears', 'ears', ['light']),
  // 照抄真实素材的形态：耳朵变体里混着怪物肤色；这条的全部变体都是怪物色
  head_ears_dragon: part('Dragon Ears', 'ears', ['zombie', 'fur_black']),
  head_nose_button: part('Button Nose', 'nose', ['light']),

  beards_beard: part('Beard', 'beard', ['black']),
  mustaches_handlebar: part('Handlebar Mustache', 'mustache', ['black']),
  eyebrows_thick: part('Thick Eyebrows', 'eyebrows', ['black']),

  torso_clothes_blouse: part('Blouse', 'clothes', ['white', 'blue']),
  torso_clothes_robe: part('Robe', 'clothes', ['red']),
  dress_slit: part('Slit Dress', 'dress', ['black']),
  torso_armour_plate: part('Plate Armour', 'armour', ['steel']),
  torso_jacket_frock: part('Frock Jacket', 'jacket', ['black']),
  torso_clothes_vest: part('Vest', 'vest', ['black']),
  torso_chainmail: part('Chainmail', 'chainmail', ['gray']),
  torso_aprons_apron: part('Apron', 'apron', ['black']),
  torso_aprons_overalls: part('Overalls', 'overalls', ['blue']),

  arms_armour: part('Armour Arms', 'arms', ['steel']),
  arms_gloves: part('Gloves', 'gloves', ['black']),
  arms_bracers: part('Bracers', 'bracers', ['steel']),

  legs_hose: part('Hose Legs', 'legs', ['black']),
  legs_armour: part('Armour Legs', 'legs', ['steel']),

  feet_sandals: part('Sandals', 'shoes', ['black']),
  feet_armour: part('Armour Feet', 'shoes', ['steel']),
  feet_socks_ankle: part('Ankle Socks', 'socks', ['black']),

  cape_solid: part('Solid Cape', 'cape', ['blue']),
  backpack: part('Backpack', 'backpack', ['black']),
  neck_bowtie: part('Bow Tie', 'neck', ['black']),
  necklace_gem: part('Gem Necklace', 'necklace', ['gold']),
  shoulders_leather: part('Leather Shoulders', 'shoulders', ['black']),
  wrists_cuffs: part('Cuffs', 'wrists', ['black']),

  shield: part('Basic Shield', 'shield', ['basic']),
  shield_kite: part('Kite Shield', 'shield', ['kite blue']),
  shield_scutum: part('Scutum', 'shield', ['scutum']),
  shield_heater_wood: part('Heater Shield Base', 'shield', ['brown', 'oak']),
  shield_heater_revised_wood: part('Heater Shield Revised', 'shield', ['brown', 'oak']),

  tool_rod: part('Rod', 'weapon', ['rod']),
  weapon_magic_crystal: part('Magic Crystal', 'weapon_magic_crystal', ['blue']),

  hat_hood_cloth: part('Cloth Hood', 'hat', ['black']),
  hat_accessory_feather: part('Feather', 'hat_accessory', ['red']),
  quiver: part('Quiver', 'quiver', ['quiver']),
};

/** 造一个装好夹具的注册表。 */
async function registryWithFixture(): Promise<PartRegistry> {
  const { fetch } = createJsonFetch(METADATA);
  const registry = new PartRegistry({ fetchImpl: fetch });
  await registry.loadMetadata();
  return registry;
}

/** 常量随机源（把概率行为变成确定行为）。 */
function constantRandom(value: number): () => number {
  return () => value;
}

/** 扫值法：把 0.0 → 0.9 逐个喂进随机源，收集每次抽中的条目 id。 */
function sweepItemIds(
  registry: PartRegistry,
  mode: 'minimal' | 'normal' | 'full',
  category: string
): string[] {
  const ids = new Set<string>();
  for (let i = 0; i < 10; i++) {
    const value = i / 10;
    const appearance = randomizeAppearance(registry, { mode, random: constantRandom(value) });
    const itemId = appearancePartItemId(appearance.parts[category]);
    if (itemId) ids.add(itemId);
  }
  return Array.from(ids);
}

/** 取某个部位选中的素材条目 id。 */
function itemIdOf(appearance: CharacterAppearance, category: string): string | undefined {
  const value = appearance.parts[category];
  return value === undefined ? undefined : appearancePartItemId(value);
}

describe('规则化随机器：minimal 档（平民脸）', () => {
  test('跳过清单里的类别整类不出现', async () => {
    const registry = await registryWithFixture();
    const appearance = randomizeAppearance(registry, { mode: 'minimal' });

    // 清单命中的类别：武器 / 盾牌 / 披风 / 背包 / 颈饰 / 肩甲 / 箭袋 / 帽子
    for (const category of [
      'weapon',
      'shield',
      'cape',
      'backpack',
      'neck',
      'shoulders',
      'quiver',
      'hat',
    ]) {
      expect(appearance.parts[category]).toBeUndefined();
    }
  });

  test('头部只留人类头部（其它种族的头一律不抽）', async () => {
    const registry = await registryWithFixture();
    const headIds = sweepItemIds(registry, 'minimal', 'head');

    expect(headIds.length).toBeGreaterThan(0);
    for (const headId of headIds) {
      expect(MINIMAL_HEAD_PREFIXES.some((prefix) => headId.startsWith(prefix))).toBe(true);
    }
    expect(headIds).not.toContain('heads_goblin');
  });

  test('平民不穿甲：躯干只可能是普通衣服', async () => {
    const registry = await registryWithFixture();
    const torsoIds = sweepItemIds(registry, 'minimal', 'torso');

    expect(torsoIds.length).toBeGreaterThan(0);
    for (const torsoId of torsoIds) {
      expect(['torso_clothes_blouse', 'torso_clothes_robe']).toContain(torsoId);
    }
  });

  test('身体不是骷髅 / 僵尸，独眼也不出现', async () => {
    const registry = await registryWithFixture();

    expect(sweepItemIds(registry, 'minimal', 'body')).toEqual(['body']);
    expect(sweepItemIds(registry, 'minimal', 'eyes')).not.toContain('eyes_cyclops');
  });

  test('对齐补充清单里的条目一律不抽', async () => {
    const registry = await registryWithFixture();
    const appearance = randomizeAppearance(registry, { mode: 'minimal' });

    const picked = Object.values(appearance.parts).map((value) => appearancePartItemId(value));
    for (const skipped of MINIMAL_ALIGNED_SKIP_ITEMS) {
      expect(picked).not.toContain(skipped);
    }
  });

  test('铠甲腿 / 袜 / 手套这类"清单里靠 id 才能拦住的"条目也不出现', async () => {
    const registry = await registryWithFixture();

    expect(sweepItemIds(registry, 'minimal', 'legs')).not.toContain('legs_armour');
    expect(sweepItemIds(registry, 'minimal', 'feet')).not.toContain('feet_socks_ankle');
    // 手部只有手套 → 整类空
    expect(itemIdOf(randomizeAppearance(registry, { mode: 'minimal' }), 'hands')).toBeUndefined();
  });

  test('每个部位都带 itemId（精确到素材条目）', async () => {
    const registry = await registryWithFixture();
    const appearance = randomizeAppearance(registry, { mode: 'minimal' });

    for (const value of Object.values(appearance.parts)) {
      expect(appearancePartItemId(value)).toBeDefined();
      expect(appearancePartVariant(value).length).toBeGreaterThan(0);
    }
  });

  test('不抽怪物肤色变体（人形 body 混着 zombie / fur 变体也不中）', async () => {
    const registry = await registryWithFixture();
    const skins = new Set<string>();

    for (let i = 0; i < 10; i++) {
      const appearance = randomizeAppearance(registry, {
        mode: 'minimal',
        random: constantRandom(i / 10),
      });
      skins.add(appearancePartVariant(appearance.parts.body ?? ''));
    }

    for (const skin of skins) {
      expect(MINIMAL_SKIP_VARIANTS).not.toContain(skin);
    }
    // 正常肤色抽得到（过滤后池子非空，不是把整个部位干掉了）
    expect(skins.size).toBeGreaterThan(0);
  });

  test('全部变体都是怪物肤色的素材 → 整条弃（不硬选）', async () => {
    const registry = await registryWithFixture();
    const earIds = sweepItemIds(registry, 'minimal', 'ears');

    // head_ears_dragon 只有怪物变体 → 抽中它也画不出"人样"，弃之
    expect(earIds).not.toContain('head_ears_dragon');
    expect(earIds).toContain('head_ears_big');
  });

  test('normal / full 档不过滤变体（怪物肤色照抽，口径照抄旧码）', async () => {
    const registry = await registryWithFixture();
    const fullSkins = new Set<string>();

    for (let i = 0; i < 10; i++) {
      const appearance = randomizeAppearance(registry, {
        mode: 'full',
        random: constantRandom(i / 10),
      });
      fullSkins.add(appearancePartVariant(appearance.parts.body ?? ''));
    }

    // 扫值必然扫到 body / body_skeleton / body_zombie 三条素材 ——
    // 'skeleton' / 'zombie' 这类 minimal 档绝不会出现的变体在 full 档照抽
    expect([...fullSkins]).toContain('skeleton');
    expect([...fullSkins]).toContain('zombie');
  });
});

describe('规则化随机器：normal 档（冒险者）', () => {
  test('盾牌：随机源低于阈值 → 不带盾', async () => {
    const registry = await registryWithFixture();
    const appearance = randomizeAppearance(registry, {
      mode: 'normal',
      random: constantRandom(0.05),
    });

    expect(appearance.parts.shield).toBeUndefined();
  });

  test('盾牌：随机源达到阈值 → 带，但只从白名单里抽', async () => {
    const registry = await registryWithFixture();
    const shieldIds = sweepItemIds(registry, 'normal', 'shield');

    expect(shieldIds.length).toBeGreaterThan(0);
    for (const shieldId of shieldIds) {
      expect(ALLOWED_SHIELDS).toContain(shieldId);
    }
  });

  test('可选部位：概率命中 → 留空；概率没命中 → 带上', async () => {
    const registry = await registryWithFixture();

    const empty = randomizeAppearance(registry, { mode: 'normal', random: constantRandom(0.4) });
    for (const category of OPTIONAL_CATEGORIES) {
      expect(empty.parts[category]).toBeUndefined();
    }

    const kept = randomizeAppearance(registry, { mode: 'normal', random: constantRandom(0.5) });
    for (const category of OPTIONAL_CATEGORIES) {
      expect(kept.parts[category]).toBeDefined();
    }
  });

  test('非可选部位不受空概率影响', async () => {
    const registry = await registryWithFixture();
    const appearance = randomizeAppearance(registry, {
      mode: 'normal',
      random: constantRandom(0.05),
    });

    expect(appearance.parts.hair).toBeDefined();
    expect(appearance.parts.torso).toBeDefined();
  });

  test('normal 档不跳任何素材（甲 / 裙照抽，只挡身体类素材）', async () => {
    const registry = await registryWithFixture();
    const torsoIds = sweepItemIds(registry, 'normal', 'torso');

    // 候选池里含甲 / 裙 / 外套 / 背心 —— 扫值必然能抽到其中之一
    expect(torsoIds).toContain('torso_armour_plate');
    expect(torsoIds).toContain('dress_slit');
    // 但身体类素材不当地占躯干位（否则等于"光着身子"）
    for (const torsoId of torsoIds) {
      expect(['body', 'body_skeleton', 'body_zombie']).not.toContain(torsoId);
    }
  });

  test('缺省档位就是 normal（旧码 randomize() 的默认档）', async () => {
    const registry = await registryWithFixture();
    const withDefault = randomizeAppearance(registry, { random: constantRandom(0.5) });
    const explicitNormal = randomizeAppearance(registry, {
      mode: 'normal',
      random: constantRandom(0.5),
    });

    expect(withDefault).toEqual(explicitNormal);
  });
});

describe('规则化随机器：full 档（全随机）', () => {
  test('没有空概率：有素材的类别一律出现', async () => {
    const registry = await registryWithFixture();
    const appearance = randomizeAppearance(registry, {
      mode: 'full',
      random: constantRandom(0.01),
    });

    for (const category of [
      'shadow',
      'body',
      'head',
      'hair',
      'torso',
      'legs',
      'feet',
      'cape',
      'backpack',
      'neck',
      'shoulders',
      'shield',
      'weapon',
      'hat',
      'quiver',
    ]) {
      expect(appearance.parts[category]).toBeDefined();
    }
  });

  test('full 档不限制盾牌款式（白名单只在 normal 档生效）', async () => {
    const registry = await registryWithFixture();
    const fullIds = sweepItemIds(registry, 'full', 'shield');
    const normalIds = sweepItemIds(registry, 'normal', 'shield');

    // full 档连白名单之外的盾牌也抽得到；normal 档只抽白名单里的那两款
    expect(fullIds).toContain('shield');
    expect(fullIds.length).toBeGreaterThan(normalIds.length);
    expect(normalIds.every((id) => ALLOWED_SHIELDS.includes(id))).toBe(true);
  });
});

describe('规则化随机器：输出可被渲染侧精确回读', () => {
  test('resolveSelections 按 itemId 精确命中（不落到"第一个命中项"）', async () => {
    const registry = await registryWithFixture();
    const appearance = randomizeAppearance(registry, {
      mode: 'minimal',
      random: constantRandom(0.5),
    });

    const selections = registry.resolveSelections(appearance);
    for (const [category, value] of Object.entries(appearance.parts)) {
      expect(selections[category]?.itemId).toBe(appearancePartItemId(value));
    }
  });

  test('体型不支持的素材不抽（画不出来的层不选）', async () => {
    const registry = await registryWithFixture();
    const appearance = randomizeAppearance(registry, {
      mode: 'normal',
      bodyType: 'female',
      random: constantRandom(0.5),
    });

    // 夹具里只有 heads_human_female 支持 female
    expect(itemIdOf(appearance, 'head')).toBe('heads_human_female');
  });

  test('素材没加载出来 → parts 为空（不编造长相）', async () => {
    const { fetch } = createJsonFetch({});
    const registry = new PartRegistry({ fetchImpl: fetch });
    await registry.loadMetadata();

    const appearance = randomizeAppearance(registry, { mode: 'full' });
    expect(appearance.parts).toEqual({});
  });

  test('档位词表固定为三档；盾牌空概率沿用旧码口径', () => {
    expect(RANDOMIZATION_MODES).toEqual(['minimal', 'normal', 'full']);
    expect(SHIELD_EMPTY_CHANCE).toBe(0.3);
  });
});
