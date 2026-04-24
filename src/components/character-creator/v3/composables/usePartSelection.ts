/**
 * usePartSelection - 部件选择逻辑 (V3)
 * 管理可用部件数据（按分类）、当前选中部件
 * 调用 partRegistry API 进行查询和随机选择
 * 接口与 V2 完全一致
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
// 三档随机化常量 (from V1 CharacterCreatorScene.ts)
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
 * @param character 可选的字符引用，用于从 SavedCharacter 初始化 bodyType 和 parts
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
  const availableParts = ref<Map<PartCategory, PartMetadata[]>>(new Map());

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
    refreshAvailableParts();
  }

  // 根据体型刷新可用部件
  function refreshAvailableParts(): void {
    availableParts.value.clear();

    for (const category of PART_CATEGORIES) {
      const parts = partRegistry.getPartsByCategory(category);
      // 过滤出支持当前体型的部件
      const supportedParts = parts.filter(p => p.required.includes(bodyType.value));
      if (supportedParts.length > 0) {
        availableParts.value.set(category, supportedParts);
      }
    }

    // 更新元数据缓存
    partsMetadata.value.clear();
    for (const parts of availableParts.value.values()) {
      for (const part of parts) {
        partsMetadata.value.set(part.itemId, part);
      }
    }
  }

  // 获取某个分类的可用部件
  function getPartsByCategory(category: PartCategory): PartMetadata[] {
    return availableParts.value.get(category) ?? [];
  }

  // 获取所有分类列表
  const categories = computed((): PartCategory[] => {
    return Array.from(availableParts.value.keys()) as PartCategory[];
  });

  // 检查某个部件是否被选中
  function isPartSelected(category: PartCategory, itemId: string): boolean {
    return selectedParts.value[category]?.itemId === itemId;
  }

  // 获取某个分类当前选中的部件
  function getSelectedPart(category: PartCategory): PartSelection | null {
    return selectedParts.value[category] ?? null;
  }

  // 选择部件
  function selectPart(category: PartCategory, itemId: string, variant?: string): void {
    const part = partsMetadata.value.get(itemId);
    if (!part) return;

    const selectedVariant = variant ?? part.variants?.[0] ?? 'default';
    selectedParts.value[category] = {
      itemId,
      variant: selectedVariant,
    };
  }

  // 取消选择部件
  function deselectPart(category: PartCategory): void {
    delete selectedParts.value[category];
  }

  // 清除所有选择
  function clearAllSelections(): void {
    selectedParts.value = {};
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

  // 精简随机 (minimal)
  function randomizeMinimal(): void {
    const config = getRandomizationConfig('minimal');
    const newSelections: Record<string, PartSelection> = {};

    for (const category of PART_CATEGORIES) {
      // 跳过配置的分类
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
        const variants = randomPart.variants ?? ['default'];
        const randomVariant = variants[Math.floor(Math.random() * variants.length)];
        newSelections[category] = {
          itemId: randomPart.itemId,
          variant: randomVariant,
        };
      }
    }

    selectedParts.value = newSelections;
  }

  // 普通随机 (normal)
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
            const variants = randomPart.variants ?? ['default'];
            const randomVariant = variants[Math.floor(Math.random() * variants.length)];
            newSelections[category] = {
              itemId: randomPart.itemId,
              variant: randomVariant,
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
        const variants = randomPart.variants ?? ['default'];
        const randomVariant = variants[Math.floor(Math.random() * variants.length)];
        newSelections[category] = {
          itemId: randomPart.itemId,
          variant: randomVariant,
        };
      }
    }

    selectedParts.value = newSelections;
  }

  // 完全随机 (full)
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
            const variants = randomPart.variants ?? ['default'];
            const randomVariant = variants[Math.floor(Math.random() * variants.length)];
            newSelections[category] = {
              itemId: randomPart.itemId,
              variant: randomVariant,
            };
          }
        }
        continue;
      }

      const randomPart = parts[Math.floor(Math.random() * parts.length)];
      if (randomPart) {
        const variants = randomPart.variants ?? ['default'];
        const randomVariant = variants[Math.floor(Math.random() * variants.length)];
        newSelections[category] = {
          itemId: randomPart.itemId,
          variant: randomVariant,
        };
      }
    }

    selectedParts.value = newSelections;
  }

  // 随机选择所有部件 (默认调用 normal)
  function randomize(): void {
    randomizeNormal();
  }

  // 设置当前体型（会刷新可用部件）
  function setBodyType(newBodyType: BodyType): void {
    bodyType.value = newBodyType;
    refreshAvailableParts();

    // 清除当前不支持的选择
    const newSelections: Record<string, PartSelection> = {};
    for (const [category, selection] of Object.entries(selectedParts.value)) {
      const parts = availableParts.value.get(category as PartCategory);
      if (parts?.some(p => p.itemId === selection.itemId)) {
        newSelections[category] = selection;
      }
    }
    selectedParts.value = newSelections;
  }

  // 从角色数据加载部件选择
  function loadFromCharacter(parts: Record<string, PartSelection>): void {
    selectedParts.value = { ...parts };
  }

  // 获取选中部件的变体选项
  function getVariantsForPart(itemId: string): string[] {
    const part = partsMetadata.value.get(itemId);
    return part?.variants ?? ['default'];
  }

  // 获取部件名称
  function getPartName(itemId: string): string {
    const part = partsMetadata.value.get(itemId);
    return part?.name ?? itemId;
  }

  // 挂载时加载部件
  onMounted(() => {
    loadParts();
  });

  return {
    // State
    bodyType,
    randomizeMode,
    availableParts,
    selectedParts,
    isLoaded,
    categories,

    // Actions
    loadParts,
    getPartsByCategory,
    isPartSelected,
    getSelectedPart,
    selectPart,
    deselectPart,
    clearAllSelections,
    randomize,
    randomizeMinimal,
    randomizeNormal,
    randomizeFull,
    setBodyType,
    loadFromCharacter,
    getVariantsForPart,
    getPartName,
  };
}
