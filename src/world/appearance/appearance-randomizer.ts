/**
 * 文件职责：**规则化随机形象生成器** —— 按三档规则（minimal / normal / full）产出一份
 *   带 itemId 精确指定的角色外观（CharacterAppearance）。
 *   来源：git 历史 a9498ae~1:src/components/character-creator/v3/composables/usePartSelection.ts
 *         （三档随机逻辑见该文件 185-330 行，规则常量见 1-50 行）。
 *   任务：.long-run-agent/tasks/task_030.md「恢复规则化随机形象生成器」。
 * 输入：**注入式**的 PartRegistry（素材元数据的唯一来源）+ 随机源 + 档位 + 体型。
 * 输出：CharacterAppearance —— parts 每项 = `{ variant, itemId }`（精确到素材条目）。
 * 禁止事项：
 *   1. 自己 fetch / 读文件取素材元数据 —— 元数据只从注入的 PartRegistry 取
 *      （加载与接线是组合根的事，见 app/main/main-entry.ts）；
 *   2. import hud / app / core 的状态模块 —— 本模块属 world 层，只认 core 的**类型**
 *      与 world/appearance 的注册表；
 *   3. 写"角色设定"规则（职业搭配 / 谁能穿什么）—— 这里是"随机长相"，不是人设；
 *   4. 依赖 Math.random 的全局状态而不可注入 —— 随机源必须可替换（单测打桩要靠它）；
 *   5. 造出素材里不存在的 itemId / variant —— 抽中的条目必然来自注册表（不编造）。
 *
 * ★ 为什么"随机形象会变丑"的根因在这里：
 *   旧随机是**类别级**的：抽到一个类别就抽该类别里的某个素材，白名单也只挡到类别层
 *   （"盾只准这两款"在旧实现里其实是"盾这一类里挑这两款"，但类别内的其它款式照样混进来）。
 *   于是同一类别里那些怪素材（骷髅身体 / 独眼 / 铠甲腿）会被抽中。
 *   本模块把随机粒度下沉到**素材条目级**（itemId），白名单也下沉到条目级，
 *   才谈得上"平民脸 / 冒险者 / 全随机"三档各自的质感。
 *
 * ★ 迁移说明（旧 → 新，三处口径差异都记在这里，别再漂移）：
 *   1. **头部白名单**：旧常量 `MINIMAL_HEAD_PREFIX = 'Human'`；新素材里的人类头部
 *      itemId 形如 `heads_human_male` / `heads_human_female`（旧素材没有 'heads_' 前缀）。
 *      故改为前缀清单 MINIMAL_HEAD_PREFIXES = ['Human', 'heads_human']（旧写法一并保留）。
 *   2. **跳过清单的粒度**：旧清单里的名字大多是**素材类别名**（typeName），
 *      而旧代码是拿它跟**代码类别名**比 —— 两套名字只有少部分重合（cape / hat / shield…），
 *      清单里绝大多数条目（旧素材的 'jacket' / 'armour' / 'gloves'…）其实**从未生效**。
 *      新实现按**素材类别名（typeName）**逐条目过滤，清单才真正起作用（"平民"不再穿甲）。
 *      为此还按 itemId 的 '_' 分段补了一次核对：新素材的 itemId 内嵌类别名
 *      （`legs_armour` / `feet_armour` 的 typeName 却是 'legs' / 'shoes'），
 *      只看 typeName 会漏掉这一类。
 *   3. **盾牌留空概率**：旧码 normal 档是 `Math.random() < 0.3` 即**留空**
 *      （= 70% 的概率带盾），本模块照抄该口径（SHIELD_EMPTY_CHANCE = 0.3）。
 */

import type {
  AppearancePartSelection,
  CharacterAppearance,
} from '../../core/types';

import { DEFAULT_BODY_TYPE, PART_CATEGORIES, type BodyType } from './constants';
import type { PartRegistry } from './part-registry';
import type { PartMetadata } from './types';

// ============================================================================
// 档位与规则常量
// ============================================================================

/** 随机档位。 */
export type RandomizationMode = 'minimal' | 'normal' | 'full';

/** 全部档位（UI / 兜底逻辑按这个顺序展示）。 */
export const RANDOMIZATION_MODES: readonly RandomizationMode[] = ['minimal', 'normal', 'full'];

/**
 * minimal 档**跳过的素材类别**（照抄旧清单，见文件头「迁移说明」2）。
 *
 * why 是素材类别名（typeName）而不是代码类别名：清单里 'jacket' / 'armour' / 'gloves'
 *   这些都是素材侧的名字；按 typeName 过滤才拦得住"平民脸穿甲"。
 *   清单里没出现于新素材的名字（如 'sideburn'）保留在清单中 —— 留着无害（没有素材命中它），
 *   且旧清单原样可追溯。
 */
export const MINIMAL_SKIP_TYPES: readonly string[] = [
  'wings',
  'wings_dots',
  'wings_edge',
  'tail',
  'weapon',
  'weapon_magic_crystal',
  'shield',
  'shield_paint',
  'shield_pattern',
  'shield_trim',
  'backpack',
  'backpack_straps',
  'cargo',
  'cape',
  'cape_trim',
  'quiver',
  'hat',
  'hat_accessory',
  'hat_buckle',
  'hat_overlay',
  'hat_trim',
  'bandana',
  'bandana_overlay',
  'headcover',
  'headcover_rune',
  'visor',
  'shoulders',
  'neck',
  'necklace',
  'earrings',
  'earring_left',
  'earring_right',
  'charm',
  'ring',
  'sash',
  'sash_tie',
  'belt',
  'buckles',
  'horns',
  'fins',
  'furry_ears',
  'furry_ears_skin',
  'beard',
  'mustache',
  'sideburn',
  'expression',
  'expression_crying',
  'facial_left',
  'facial_left_trim',
  'facial_mask',
  'facial_right',
  'facial_right_trim',
  'facial_eyes',
  'wound_arm',
  'wound_brain',
  'wound_eye_left',
  'wound_eye_right',
  'wound_mouth',
  'wound_ribs',
  'wheelchair',
  'prosthesis_hand',
  'prosthesis_leg',
  'bandages',
  'wrinkes',
  'hairextl',
  'hairextr',
  'hairtie',
  'hairtie_rune',
  'updo',
  'ponytail',
  'jacket',
  'jacket_collar',
  'jacket_pockets',
  'jacket_trim',
  'vest',
  'apron',
  'overalls',
  'armour',
  'chainmail',
  'bracers',
  'bauldron',
  'gloves',
  'sleeves',
  'socks',
  'dress',
  'dress_sleeves',
  'dress_trim',
  'dress_sleeves_trim',
  'accessory',
  'ammo',
  'facial',
  'eyebrows',
];

/**
 * minimal 档**追加跳过的素材条目**（对齐新素材时补的，旧清单里没有）。
 *
 * why 要补：新素材里有几个"长得不是人 / 不是平民脸"的条目，它们跟同类别的好条目
 *   共用 typeName，清单按类别拦不住：
 *   - body_skeleton / body_zombie：typeName 都是 'body'（裸身层）—— 骷髅身 + 人头 = 恐怖谷；
 *   - eyes_cyclops：typeName 是 'eyes' —— 独眼。
 *   这里是**条目级**清单（比类别级更精确），也是"随机形象不丑"的最后一道闸。
 */
export const MINIMAL_ALIGNED_SKIP_ITEMS: readonly string[] = [
  'body_skeleton',
  'body_zombie',
  'eyes_cyclops',
];

/**
 * minimal 档**整类跳过**的代码类别。
 *
 * why 要单独一份：旧码拿跳过清单跟**代码类别名**比 —— 清单 92 项里恰好有 9 项
 *   （cape / backpack / neck / shoulders / hat / quiver / shield / weapon / facial）
 *   既是清单项、又是代码类别名，所以旧码里这 9 个类别整类不出现；其余 83 项是素材
 *   类别名（typeName），在旧码的逐类别循环里**从未生效**。新实现改成按素材类别名
 *   过滤后那 83 项终于生效；这份交集与 typeName 过滤互为**双保险** —— 按当前别名表
 *   两者恰好覆盖同一批素材，但别名表将来扩了新映射时，这一层还兜得住。
 *   故这一份 = 清单 ∩ 代码类别词表（见 PART_CATEGORIES）。
 */
export const MINIMAL_SKIP_CATEGORIES: readonly string[] = MINIMAL_SKIP_TYPES.filter((name) =>
  (PART_CATEGORIES as readonly string[]).includes(name)
);

/**
 * minimal 档**跳过的变体名**（对齐新素材时补的）。
 *
 * why 要补：新素材把**肤色**也做成变体，而人形素材的变体清单里混着怪物肤色
 *   （'zombie' / 'zombie_green'）与兽皮色（'fur_*'）—— 普通的 'body' 素材就同时带
 *   light/amber/olive… 与 zombie_green / fur 系，随机抽到就是"绿毛人"。
 *   条目级清单拦不住它（body 本身是人形素材），只有抽变体时过滤才行。
 */
export const MINIMAL_SKIP_VARIANTS: readonly string[] = [
  'zombie',
  'zombie_green',
  'fur_black',
  'fur_brown',
  'fur_tan',
  'fur_copper',
  'fur_gold',
  'fur_grey',
  'fur_white',
];

/**
 * minimal 档允许的头部 itemId 前缀。
 * why 是清单而不是单个前缀：新旧素材的命名不一致（旧 'Human*' / 新 'heads_human*'），见文件头「迁移说明」1。
 */
export const MINIMAL_HEAD_PREFIXES: readonly string[] = ['Human', 'heads_human'];

/** 可选部位（normal 档按 OPTIONAL_EMPTY_CHANCE 概率留空）。 */
export const OPTIONAL_CATEGORIES: readonly string[] = [
  'quiver',
  'shoulders',
  'neck',
  'backpack',
  'cape',
  'hat',
];

/** normal 档允许的盾牌条目（其余盾牌一律不抽 —— 冒险者不该拿着巨盾）。 */
export const ALLOWED_SHIELDS: readonly string[] = [
  'shield_heater_revised_wood',
  'shield_heater_wood',
];

/**
 * normal 档**盾牌留空的概率**（旧码口径：`Math.random() < 0.3` 即留空）。
 * 即 70% 的概率带盾、30% 的概率空手。改这个值 = 改旧行为，故单独成名不散落在代码里。
 */
export const SHIELD_EMPTY_CHANCE = 0.3;

/** normal 档**可选部位留空的概率**（旧码口径 0.5）。 */
export const OPTIONAL_EMPTY_CHANCE = 0.5;

/** 一档随机规则（照抄旧码的 RandomizationConfig 形状）。 */
export interface RandomizationConfig {
  /** minimal 档才非空：跳过的素材类别（其余档位不跳过任何类别）。 */
  readonly skipTypes: readonly string[];
  /** minimal 档才非空：抽变体时跳过的变体名（怪物肤色）。 */
  readonly skipVariants: readonly string[];
  /** 盾牌策略：empty = 永远不带 / limited = 只带白名单款 / all = 随便带。 */
  readonly shieldMode: 'empty' | 'limited' | 'all';
  /** 可选部位留空概率（0 = 从不留空，1 = 总是留空）。 */
  readonly optionalEmptyChance: number;
  /** 头部是否限制为人类头部（minimal 档开，其余档关）。 */
  readonly headRestricted: boolean;
}

/** 三档规则表（与旧码 getRandomizationConfig 一一对应）。 */
export const RANDOMIZATION_CONFIGS: Readonly<Record<RandomizationMode, RandomizationConfig>> = {
  minimal: {
    skipTypes: MINIMAL_SKIP_TYPES,
    skipVariants: MINIMAL_SKIP_VARIANTS,
    shieldMode: 'empty',
    optionalEmptyChance: 1,
    headRestricted: true,
  },
  normal: {
    skipTypes: [],
    skipVariants: [],
    shieldMode: 'limited',
    optionalEmptyChance: OPTIONAL_EMPTY_CHANCE,
    headRestricted: false,
  },
  full: {
    skipTypes: [],
    skipVariants: [],
    shieldMode: 'all',
    optionalEmptyChance: 0,
    headRestricted: false,
  },
};

// ============================================================================
// 随机形象生成
// ============================================================================

/** 随机形象的生成选项。 */
export interface RandomizeAppearanceOptions {
  /** 档位（缺省 normal —— 旧码 randomize() 的默认档）。 */
  readonly mode?: RandomizationMode;
  /** 体型（缺省 DEFAULT_BODY_TYPE = 'male'）。 */
  readonly bodyType?: BodyType;
  /** 随机源（缺省 Math.random；单测注入打桩源）。 */
  readonly random?: () => number;
}

/**
 * 按规则随机出一份角色外观（带 itemId 精确指定）。
 *
 * 流程（逐类别）：
 *   1. 取该类别的候选素材 —— 过滤掉体型不支持的、minimal 档跳过的、body 类素材占别的类别的；
 *   2. minimal 档：头部只留人类头部；
 *   3. normal 档：盾牌按 SHIELD_EMPTY_CHANCE 留空，留空则只从 ALLOWED_SHIELDS 里抽；
 *      可选部位按 OPTIONAL_EMPTY_CHANCE 留空；
 *   4. 抽中素材后，再从该素材的变体清单里抽一个变体 → `{ variant, itemId }`。
 *
 * why 逐类别而不是逐素材：外观模型以**类别**为键（渲染侧按类别分层画），
 *   同一类别只出一个条目（画两层身体会穿模）。
 *
 * @param registry 已加载元数据的素材注册表（注入式 —— 本模块不碰网络 / 文件）。
 * @param options 档位 / 体型 / 随机源。
 * @returns 角色外观。素材没加载出来时 parts 为空对象（**不编造**长相，由调用方决定怎么提示）。
 */
export function randomizeAppearance(
  registry: PartRegistry,
  options: RandomizeAppearanceOptions = {}
): CharacterAppearance {
  const mode = options.mode ?? 'normal';
  const bodyType = options.bodyType ?? DEFAULT_BODY_TYPE;
  const random = options.random ?? Math.random;
  const config = RANDOMIZATION_CONFIGS[mode];
  const parts: Record<string, AppearancePartSelection> = {};

  for (const category of PART_CATEGORIES) {
    // minimal 档：清单里那些"既是清单项、又是代码类别名"的类别整类跳过（见 MINIMAL_SKIP_CATEGORIES）。
    if (config.skipTypes.length > 0 && MINIMAL_SKIP_CATEGORIES.includes(category)) continue;

    const candidates = candidatesFor(registry, category, bodyType, config);
    if (candidates.length === 0) continue;

    // —— 盾牌：normal 档按概率留空 + 只用白名单款 ——
    if (category === 'shield' && config.shieldMode === 'limited') {
      if (random() < SHIELD_EMPTY_CHANCE) continue;
      const allowed = candidates.filter((part) => ALLOWED_SHIELDS.includes(part.itemId));
      const source = allowed.length > 0 ? allowed : candidates;
      const picked = pickOne(source, random);
      const selection = picked ? toSelection(picked, random, config) : null;
      if (selection) parts[category] = selection;
      continue;
    }

    // —— 可选部位：normal 档按概率留空（minimal 档已在跳过清单里整体跳过）——
    if (config.optionalEmptyChance > 0 && OPTIONAL_CATEGORIES.includes(category)) {
      if (random() < config.optionalEmptyChance) continue;
    }

    const picked = pickOne(candidates, random);
    const selection = picked ? toSelection(picked, random, config) : null;
    if (selection) parts[category] = selection;
  }

  return { bodyType, parts };
}

/**
 * 素材类别 → **专属**代码类别（别名表把一个素材类别映射到多个代码类别时的"正主"）。
 *
 * why 需要它：别名表里 'body' 同时映射到 torso、'armour' 同时映射到 arms ——
 *   于是"躯干"里能抽到裸身层（抽中就是光身子）、"手臂"里能抽到胸甲（抽中就是甲穿在胳膊上）。
 *   正主规则把这些素材钉回它该待的类别（渲染侧的别名表是 027 的既有事实，本模块不改它，
 *   只在自己挑素材时避开"张冠李戴"）。
 */
const MATERIAL_OWNING_CATEGORY: Readonly<Record<string, string>> = {
  body: 'body',
  armour: 'torso',
};

/**
 * 某类别的候选素材（按档位规则过滤后的结果）。
 *
 * 过滤四条（条目层）：
 *   1. 素材不支持该体型 → 选它也画不出来（该体型的图目录里没有）；
 *   2. 素材类别有"正主"而当前类别不是正主 → 跳过（见 MATERIAL_OWNING_CATEGORY）；
 *   3. minimal 档：跳过清单命中的素材（typeName 或 itemId 分段，见 isMinimalSkipped）；
 *   4. minimal 档：对齐补充清单（条目级）与头部限制。
 * 变体层的过滤（minimal 档的怪物肤色）发生在 toSelection（变体属于素材不属于类别，
 * 抽变体时才过滤）。
 */
function candidatesFor(
  registry: PartRegistry,
  category: string,
  bodyType: BodyType,
  config: RandomizationConfig
): PartMetadata[] {
  const candidates: PartMetadata[] = [];

  for (const part of registry.getPartsByCategory(category)) {
    if (!part.required.includes(bodyType)) continue;

    const owner = MATERIAL_OWNING_CATEGORY[part.typeName];
    if (owner && owner !== category) continue;

    if (config.skipTypes.length > 0) {
      if (isMinimalSkipped(part)) continue;
      if (MINIMAL_ALIGNED_SKIP_ITEMS.includes(part.itemId)) continue;
      if (config.headRestricted && category === 'head' && !isHumanHead(part)) continue;
    }
    candidates.push(part);
  }

  return candidates;
}

/**
 * minimal 档是否跳过这条素材。
 *
 * why 查两遍（typeName + itemId 分段）：新素材的 id 内嵌类别名，
 *   `legs_armour` / `feet_armour` 的 typeName 却是 'legs' / 'shoes' ——
 *   只看 typeName 会让铠甲腿混进"平民"的随机结果里。
 */
function isMinimalSkipped(part: PartMetadata): boolean {
  if (MINIMAL_SKIP_TYPES.includes(part.typeName)) return true;
  return part.itemId.split('_').some((segment) => MINIMAL_SKIP_TYPES.includes(segment));
}

/** 是否人类头部（itemId 前缀命中清单）。 */
function isHumanHead(part: PartMetadata): boolean {
  return MINIMAL_HEAD_PREFIXES.some((prefix) => part.itemId.startsWith(prefix));
}

/** 从候选里抽一个（越界下标兜底 —— 随机源返回 1 时不能越界）。 */
function pickOne(parts: readonly PartMetadata[], random: () => number): PartMetadata | null {
  if (parts.length === 0) return null;
  const index = Math.floor(random() * parts.length);
  const safe = Math.min(Math.max(index, 0), parts.length - 1);
  return parts[safe] ?? null;
}

/**
 * 素材 → 精确选择（变体 + itemId）。
 * why 变体从**该素材自己的**变体清单里抽：不同素材的变体名不一样（发色 / 肤色 / 衣色各一套），
 *   抽到不存在的变体名会拼出一个不存在的图片路径（角色少一层）。
 * minimal 档先滤掉怪物肤色变体（config.skipVariants）—— 滤完后一条都不剩的素材
 *   返回 null（这条素材画不出"人样"，弃之，宁缺毋滥）。
 */
function toSelection(
  part: PartMetadata,
  random: () => number,
  config: RandomizationConfig
): AppearancePartSelection | null {
  const all = part.variants.length > 0 ? [...part.variants] : ['default'];
  const pool =
    config.skipVariants.length > 0
      ? all.filter((variant) => !config.skipVariants.includes(variant))
      : all;
  if (pool.length === 0) return null;
  const index = Math.floor(random() * pool.length);
  const safe = Math.min(Math.max(index, 0), pool.length - 1);
  return { variant: pool[safe] ?? 'default', itemId: part.itemId };
}
