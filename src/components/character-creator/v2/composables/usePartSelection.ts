/**
 * usePartSelection - 部件选择逻辑
 * 管理可用部件数据（按分类）、当前选中部件
 * 调用 partRegistry API 进行查询和随机选择
 */

import { ref, computed, onMounted } from 'vue';
import { partRegistry } from '@/stratix-character-creator/core/PartRegistry';
import {
  PART_CATEGORIES,
  DEFAULT_BODY_TYPE,
  type PartCategory,
  type BodyType,
} from '@/stratix-character-creator/constants';
import type { PartSelection, PartMetadata, PartCategoryInfo } from '@/stratix-character-creator/types';

export interface UsePartSelectionOptions {
  bodyType?: BodyType;
}

export function usePartSelection(options: UsePartSelectionOptions = {}) {
  const bodyType = ref<BodyType>(options.bodyType ?? DEFAULT_BODY_TYPE);

  // 部件元数据缓存
  const partsMetadata = ref<Map<string, PartMetadata>>(new Map());

  // 按分类组织的部件列表
  const availableParts = ref<Map<PartCategory, PartMetadata[]>>(new Map());

  // 当前选中部件
  const selectedParts = ref<Record<string, PartSelection>>({});

  // 是否已加载
  const isLoaded = ref<boolean>(false);

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

  // 随机选择所有部件
  function randomize(): void {
    const newSelections: Record<string, PartSelection> = {};

    for (const category of PART_CATEGORIES) {
      const parts = availableParts.value.get(category);
      if (!parts || parts.length === 0) continue;

      // 随机选择一个部件
      const randomPart = parts[Math.floor(Math.random() * parts.length)];
      if (randomPart) {
        // 随机选择变体
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
    setBodyType,
    loadFromCharacter,
    getVariantsForPart,
    getPartName,
  };
}
