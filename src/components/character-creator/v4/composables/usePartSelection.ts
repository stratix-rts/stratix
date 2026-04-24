/**
 * usePartSelection - 部件选择逻辑 (V4)
 * 管理可用部件数据（按分类）、当前选中部件
 * 调用 partRegistry API 进行查询和随机选择
 * 纯状态 composable，三档随机化：精简/普通/完全
 */

import { ref, computed, watch, onMounted } from 'vue';
import type { Ref } from 'vue';
import { partRegistry } from '@/stratix-character-creator/core/PartRegistry';
import {
  PART_CATEGORIES,
  DEFAULT_BODY_TYPE,
  type PartCategory,
  type BodyType,
} from '@/stratix-character-creator/constants';
import type { PartSelection, PartMetadata, SavedCharacter } from '@/stratix-character-creator/types';

// ============================================================================
// 三档随机化常量 (from V1 CharacterCreatorScene.ts, V2/V3 usePartSelection)
// ============================================================================

/** 概率性跳过的分类 (optional empty) */
const OPTIONAL_CATEGORIES = ['quiver', 'shoulders', 'neck', 'backpack', 'cape', 'hat'];

/** normal 模式限制的盾牌 */
const ALLOWED_SHIELDS = ['shield_heater_revised_wood', 'shield_heater_wood'];

/** minimal 模式跳过的分类 */
const RANDOMIZATION_SKIP_CATEGORIES = [
  'wings', 'wings_dots', 'wings_edge', 'tail',
  'weapon', 'weapon_magic_crystal', 'shield', 'shield_paint', 'shield_pattern', 'shield_trim',
  'backpack', 'backpack_straps', 'cargo', 'cape', 'cape_trim', 'quiver',
  'hat', 'hat_accessory', 'hat_buckle', 'hat_overlay', 'hat_trim',
  'bandana', 'bandana_overlay', 'headcover', 'headcover_rune', 'visor',
  'shoulders', 'neck', 'necklace', 'earrings', 'earring_left', 'earring_right',
  'charm', 'ring', 'sash', 'sash_tie', 'belt', 'buckles',
  'horns', 'fins', 'furry_ears', 'furry_ears_skin',
  'beard', 'mustache', 'sideburn',
  'expression', 'expression_crying', 'facial_left', 'facial_left_trim',
  'facial_mask', 'facial_right', 'facial_right_trim', 'facial_eyes',
  'wound_arm', 'wound_brain', 'wound_eye_left', 'wound_eye_right', 'wound_mouth', 'wound_ribs',
  'wheelchair', 'prosthesis_hand', 'prosthesis_leg', 'bandages', 'wrinkes',
  'hairextl', 'hairextr', 'hairtie', 'hairtie_rune', 'updo', 'ponytail',
  'jacket', 'jacket_collar', 'jacket_pockets', 'jacket_trim',
  'vest', 'apron', 'overalls',
  'armour', 'chainmail', 'bracers', 'bauldron',
  'gloves', 'sleeves', 'socks', 'dress', 'dress_sleeves', 'dress_trim', 'dress_sleeves_trim',
  'accessory', 'ammo', 'facial', 'eyebrows',
];

/** minimal 模式头部前缀 (只用 Human 开头的头) */
const MINIMAL_HEAD_PREFIX = 'Human';

/** 随机化配置类型 */
type RandomizationMode = 'minimal' | 'normal' | 'full';

interface RandomizationConfig {
  skipCategories: string[];
  shieldMode: 'empty' | 'limited' | 'all';
  optionalEmptyChance: number;
}

// ============================================================================
// Composable
// ============================================================================

/**
 * @param character 可选的角色引用，用于从 SavedCharacter 初始化 bodyType 和 parts
 */
export function usePartSelection(character?: Ref<SavedCharacter | null>) {
  // 初始体型：从 character prop 或默认值
  const initialBodyType = character?.value?.bodyType ?? DEFAULT_BODY_TYPE;
  const bodyType = ref<BodyType>(initialBodyType);

  // 当前随机化模式
  const randomizeMode = ref<RandomizationMode>('normal');

  // 部件元数据缓存
  const partsMetadata = ref<Map<string, PartMetadata>>(new Map());

  // 按分类组织的部件列表
  const availableParts = computed<Map<PartCategory, PartMetadata[]>>(() => {
    const map = new Map<PartCategory, PartMetadata[]>();

    for (const category of PART_CATEGORIES) {
      const parts = partRegistry.getPartsByCategory(category);
      const supportedParts = parts.filter(p => p.required.includes(bodyType.value));
      if (supportedParts.length > 0) {
        map.set(category, supportedParts);
      }
    }

    return map;
  });

  // 当前选中部件：从 character prop 或空
  const initialParts = character?.value?.parts ?? {};
  const selectedParts = ref<Record<string, PartSelection>>(initialParts);

  // 是否已加载
  const isLoaded = ref<boolean>(false);

  // 监听 character 变化，同步 bodyType 和 parts
  if (character) {
    watch(
      () => character.value,
      (newChar) => {
        if (newChar) {
          setBodyType(newChar.bodyType);
          loadFromCharacter(newChar.parts);
        }
      },
      { immediate: false }
    );
  }

  // 初始化：加载部件元数据
  async function loadParts(): Promise<void> {
    if (isLoaded.value) return;

    await partRegistry.loadMetadata();
    isLoaded.value = true;

    // 元数据缓存
    refreshPartsMetadata();
  }

  // 刷新元数据缓存
  function refreshPartsMetadata(): void {
    partsMetadata.value.clear();
    for (const parts of availableParts.value.values()) {
      for (const part of parts) {
        partsMetadata.value.set(part.itemId, part);
      }
    }
  }

  // 选择部件
  function selectPart(category: PartCategory, selection: PartSelection): void {
    const part = partsMetadata.value.get(selection.itemId);
    if (!part) return;

    selectedParts.value[category] = {
      itemId: selection.itemId,
      variant: selection.variant,
    };
  }

  // 取消选择部件
  function deselectPart(category: PartCategory): void {
    delete selectedParts.value[category];
  }

  // 设置当前体型（会刷新可用部件，保留兼容选择）
  function setBodyType(newBodyType: BodyType): void {
    bodyType.value = newBodyType;

    // 清除当前不支持的选择
    const newSelections: Record<string, PartSelection> = {};
    const currentAvailable = availableParts.value;
    for (const [category, selection] of Object.entries(selectedParts.value)) {
      const parts = currentAvailable.get(category as PartCategory);
      if (parts?.some(p => p.itemId === selection.itemId)) {
        newSelections[category] = selection;
      }
    }
    selectedParts.value = newSelections;

    // 刷新元数据缓存
    refreshPartsMetadata();
  }

  // 从角色数据加载部件选择
  function loadFromCharacter(parts: Record<string, PartSelection>): void {
    selectedParts.value = { ...parts };
  }

  // ============================================================================
  // 三档随机化逻辑
  // ============================================================================

  function getRandomizationConfig(mode: RandomizationMode): RandomizationConfig {
    switch (mode) {
      case 'minimal':
        return {
          skipCategories: RANDOMIZATION_SKIP_CATEGORIES,
          shieldMode: 'empty',
          optionalEmptyChance: 1
        };
      case 'normal':
        return {
          skipCategories: [],
          shieldMode: 'limited',
          optionalEmptyChance: 0.5
        };
      case 'full':
        return {
          skipCategories: [],
          shieldMode: 'all',
          optionalEmptyChance: 0
        };
    }
  }

  // 获取人类头部 (minimal 模式专用)
  function getHumanHeadPart(): PartMetadata | null {
    const heads = availableParts.value.get('head');
    if (!heads) return null;

    const humanHeads = heads.filter(p => p.itemId.startsWith(MINIMAL_HEAD_PREFIX));
    const source = humanHeads.length > 0 ? humanHeads : heads;
    return source[Math.floor(Math.random() * source.length)] ?? null;
  }

  // 从部件元数据中随机选取一个变体
  function pickRandomVariant(part: PartMetadata): string {
    const variants = part.variants.length > 0 ? part.variants : ['default'];
    return variants[Math.floor(Math.random() * variants.length)];
  }

  // 精简随机 (minimal): 只换头和衣服，保留身体
  function randomizeMinimal(): void {
    const config = getRandomizationConfig('minimal');
    const newSelections: Record<string, PartSelection> = {};

    for (const category of PART_CATEGORIES) {
      if (config.skipCategories.includes(category)) {
        continue;
      }

      const parts = availableParts.value.get(category);
      if (!parts || parts.length === 0) continue;

      let randomPart: PartMetadata | null = null;

      // minimal 模式：head 只选 Human 开头的
      if (category === 'head') {
        randomPart = getHumanHeadPart();
      } else {
        randomPart = parts[Math.floor(Math.random() * parts.length)];
      }

      if (randomPart) {
        newSelections[category] = {
          itemId: randomPart.itemId,
          variant: pickRandomVariant(randomPart),
        };
      }
    }

    selectedParts.value = newSelections;
  }

  // 普通随机 (normal): 所有部件随机，可选部件 50% 留空
  function randomizeNormal(): void {
    const config = getRandomizationConfig('normal');
    const newSelections: Record<string, PartSelection> = {};

    for (const category of PART_CATEGORIES) {
      const parts = availableParts.value.get(category);
      if (!parts || parts.length === 0) continue;

      // 盾牌特殊处理
      if (category === 'shield') {
        if (config.shieldMode === 'empty') {
          continue;
        }
        if (config.shieldMode === 'limited') {
          // 30% 概率为空
          if (Math.random() < 0.3) {
            continue;
          }
          // 从允许列表随机
          const allowedParts = parts.filter(p => ALLOWED_SHIELDS.includes(p.itemId));
          const source = allowedParts.length > 0 ? allowedParts : parts;
          const randomPart = source[Math.floor(Math.random() * source.length)];
          if (randomPart) {
            newSelections[category] = {
              itemId: randomPart.itemId,
              variant: pickRandomVariant(randomPart),
            };
          }
          continue;
        }
      }

      // optional 分类概率跳过
      if (OPTIONAL_CATEGORIES.includes(category)) {
        if (Math.random() < config.optionalEmptyChance) {
          continue;
        }
      }

      const randomPart = parts[Math.floor(Math.random() * parts.length)];
      if (randomPart) {
        newSelections[category] = {
          itemId: randomPart.itemId,
          variant: pickRandomVariant(randomPart),
        };
      }
    }

    selectedParts.value = newSelections;
  }

  // 完全随机 (full): 全随机，不跳过任何类别
  function randomizeFull(): void {
    const config = getRandomizationConfig('full');
    const newSelections: Record<string, PartSelection> = {};

    for (const category of PART_CATEGORIES) {
      const parts = availableParts.value.get(category);
      if (!parts || parts.length === 0) continue;

      // 盾牌特殊处理
      if (category === 'shield') {
        if (config.shieldMode === 'all') {
          const randomPart = parts[Math.floor(Math.random() * parts.length)];
          if (randomPart) {
            newSelections[category] = {
              itemId: randomPart.itemId,
              variant: pickRandomVariant(randomPart),
            };
          }
        }
        continue;
      }

      const randomPart = parts[Math.floor(Math.random() * parts.length)];
      if (randomPart) {
        newSelections[category] = {
          itemId: randomPart.itemId,
          variant: pickRandomVariant(randomPart),
        };
      }
    }

    selectedParts.value = newSelections;
  }

  // 随机选择所有部件
  function randomize(mode: RandomizationMode = 'normal'): void {
    switch (mode) {
      case 'minimal':
        randomizeMinimal();
        break;
      case 'full':
        randomizeFull();
        break;
      case 'normal':
      default:
        randomizeNormal();
        break;
    }
  }

  // 挂载时加载部件
  onMounted(() => {
    loadParts();
  });

  return {
    // State
    bodyType,
    selectedParts,
    availableParts,

    // Actions
    selectPart,
    deselectPart,
    setBodyType,

    // Randomization
    randomize,
  };
}
