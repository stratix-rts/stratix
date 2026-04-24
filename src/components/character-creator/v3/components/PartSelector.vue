<script setup lang="ts">
/**
 * PartSelector.vue - 部件选择器 (V3)
 *
 * 分类标签页浏览部件，每个分类展示可用部件列表
 * 点击部件选中/取消，支持"无"选项清除选择
 * 体型切换内嵌（male/female），三档随机化
 *
 * Props:
 *   bodyType: BodyType
 *   selectedParts: Record<string, PartSelection>
 *
 * Emits:
 *   select: [category: PartCategory, selection: PartSelection]
 *   deselect: [category: PartCategory]
 *   randomize: []
 *   update:bodyType: [value: BodyType]
 */

import { ref, computed, watch, onMounted } from 'vue';
import { partRegistry } from '@/stratix-character-creator/core/PartRegistry';
import {
  PART_CATEGORIES,
  type PartCategory,
  type BodyType,
} from '@/stratix-character-creator/constants';
import type { PartSelection, PartMetadata } from '@/stratix-character-creator/types';

const props = defineProps<{
  bodyType: BodyType;
  selectedParts: Record<string, PartSelection>;
}>();

const emit = defineEmits<{
  select: [category: PartCategory, selection: PartSelection];
  deselect: [category: PartCategory];
  randomize: [];
  'update:bodyType': [value: BodyType];
}>();

// ============================================================================
// 体型定义
// ============================================================================

const BODY_TYPE_LABELS: Record<BodyType, string> = {
  male: '男 Male',
  female: '女 Female',
  teen: '少年 Teen',
  muscular: '肌肉 Muscular',
  pregnant: '孕妇 Pregnant',
};

const BODY_TYPE_OPTIONS: BodyType[] = ['male', 'female'];

// ============================================================================
// 分类标签配置
// ============================================================================

const categoryLabels: Record<string, string> = {
  shadow: '影子',
  body: '身体',
  head: '头部',
  eyes: '眼睛',
  hair: '头发',
  ears: '耳朵',
  nose: '鼻子',
  facial: '面部',
  torso: '躯干',
  arms: '手臂',
  hands: '手',
  legs: '腿部',
  feet: '脚部',
  cape: '披风',
  backpack: '背包',
  neck: '颈部',
  shoulders: '肩部',
  wrists: '手腕',
  shield: '盾牌',
  weapon: '武器',
  hat: '帽子',
  quiver: '箭袋',
};

// ============================================================================
// 状态
// ============================================================================

const activeCategory = ref<PartCategory>('body');
const availableParts = ref<Map<PartCategory, PartMetadata[]>>(new Map());
const metadataMap = ref<Map<string, PartMetadata>>(new Map());
const isLoading = ref<boolean>(true);

// ============================================================================
// 计算属性
// ============================================================================

const currentCategoryParts = computed(() => {
  return availableParts.value.get(activeCategory.value) ?? [];
});

const categories = computed(() => {
  return Array.from(availableParts.value.keys()) as PartCategory[];
});

function isSelected(itemId: string): boolean {
  const selection = props.selectedParts[activeCategory.value];
  return selection?.itemId === itemId;
}

function hasSelection(category: PartCategory): boolean {
  return !!props.selectedParts[category];
}

// ============================================================================
// 方法
// ============================================================================

async function loadParts(): Promise<void> {
  isLoading.value = true;
  try {
    await partRegistry.loadMetadata();
    refreshAvailableParts();
  } catch (error) {
    console.error('[PartSelector] Failed to load parts:', error);
  } finally {
    isLoading.value = false;
  }
}

function refreshAvailableParts(): void {
  availableParts.value.clear();
  metadataMap.value.clear();

  for (const category of PART_CATEGORIES) {
    const parts = partRegistry.getPartsByCategory(category)
      .filter(p => p.required.includes(props.bodyType));

    if (parts.length > 0) {
      availableParts.value.set(category, parts);
      for (const part of parts) {
        metadataMap.value.set(part.itemId, part);
      }
    }
  }
}

function switchCategory(category: PartCategory): void {
  activeCategory.value = category;
}

function selectPart(part: PartMetadata): void {
  const variant = part.variants?.[0] ?? 'default';
  emit('select', activeCategory.value, { itemId: part.itemId, variant });
}

function deselectCurrentCategory(): void {
  emit('deselect', activeCategory.value);
}

function onVariantChange(part: PartMetadata, event: Event): void {
  const select = event.target as HTMLSelectElement;
  emit('select', activeCategory.value, { itemId: part.itemId, variant: select.value });
}

function handleBodyTypeChange(event: Event): void {
  const select = event.target as HTMLSelectElement;
  emit('update:bodyType', select.value as BodyType);
}

function handleRandomize(mode: 'minimal' | 'normal' | 'full'): void {
  emit('randomize');
}

function getPartName(itemId: string): string {
  const part = metadataMap.value.get(itemId);
  return part?.name ?? itemId;
}

// ============================================================================
// 监听
// ============================================================================

watch(() => props.bodyType, () => {
  refreshAvailableParts();
});

// ============================================================================
// 生命周期
// ============================================================================

onMounted(() => {
  loadParts();
});
</script>

<template>
  <div class="part-selector">
    <!-- 头部 -->
    <div class="part-selector__header">
      <div class="part-selector__title-group">
        <span class="part-selector__title">外观配置</span>
        <span class="part-selector__subtitle">APPEARANCE</span>
      </div>

      <!-- 体型切换（内嵌） -->
      <div class="body-type-switch">
        <button
          v-for="bt in BODY_TYPE_OPTIONS"
          :key="bt"
          class="body-type-btn"
          :class="{ 'body-type-btn--active': bodyType === bt }"
          @click="emit('update:bodyType', bt)"
        >
          {{ BODY_TYPE_LABELS[bt] }}
        </button>
      </div>
    </div>

    <!-- 分类标签 -->
    <div class="part-selector__categories">
      <button
        v-for="category in categories"
        :key="category"
        class="category-btn"
        :class="{
          'category-btn--active': activeCategory === category,
          'category-btn--has-selection': hasSelection(category),
        }"
        @click="switchCategory(category)"
      >
        <span class="category-btn__label">{{ categoryLabels[category] || category }}</span>
        <span v-if="hasSelection(category)" class="category-btn__dot"></span>
      </button>
    </div>

    <!-- 部件列表 -->
    <div class="part-selector__list">
      <div v-if="isLoading" class="part-selector__loading">
        加载中...
      </div>

      <div v-else-if="currentCategoryParts.length === 0" class="part-selector__empty">
        暂无可用部件
      </div>

      <template v-else>
        <!-- 无选项 -->
        <button
          class="part-item"
          :class="{ 'part-item--selected': !selectedParts[activeCategory] }"
          @click="deselectCurrentCategory"
        >
          <span class="part-item__name">无</span>
          <span class="part-item__meta">None</span>
        </button>

        <!-- 部件列表 -->
        <div
          v-for="part in currentCategoryParts"
          :key="part.itemId"
          class="part-item"
          :class="{ 'part-item--selected': isSelected(part.itemId) }"
        >
          <div class="part-item__info" @click="selectPart(part)">
            <span class="part-item__name">{{ part.name }}</span>
            <span class="part-item__meta">{{ part.animations?.length ?? 0 }} anim</span>
          </div>

          <!-- 变体选择 -->
          <select
            v-if="part.variants && part.variants.length > 1"
            class="part-item__variant"
            :value="selectedParts[activeCategory]?.variant ?? part.variants[0]"
            @change="onVariantChange(part, $event)"
          >
            <option
              v-for="variant in part.variants"
              :key="variant"
              :value="variant"
            >
              {{ variant }}
            </option>
          </select>
        </div>
      </template>
    </div>

    <!-- 底部按钮 — 三档随机化 -->
    <div class="part-selector__footer">
      <button
        class="randomize-btn randomize-btn--minimal"
        @click="handleRandomize('minimal')"
        title="最小随机 — 只选核心部件"
      >
        最小
      </button>
      <button
        class="randomize-btn randomize-btn--normal"
        @click="handleRandomize('normal')"
        title="标准随机 — 部分可选配件"
      >
        标准
      </button>
      <button
        class="randomize-btn randomize-btn--full"
        @click="handleRandomize('full')"
        title="全随机 — 包含所有配件"
      >
        全随机
      </button>
    </div>
  </div>
</template>

<style scoped>
.part-selector {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--ds-bg-secondary);
  border: 1px solid var(--ds-border);
  border-radius: 8px;
  overflow: hidden;
  font-family: 'SF Mono', 'Monaco', monospace;
}

.part-selector__header {
  padding: 12px 16px;
  border-bottom: 1px solid var(--ds-border);
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}

.part-selector__title-group {
  display: flex;
  align-items: baseline;
  gap: 8px;
}

.part-selector__title {
  font-size: 14px;
  color: var(--ds-color-primary);
  font-weight: 500;
}

.part-selector__subtitle {
  font-size: 10px;
  color: var(--ds-text-muted);
  letter-spacing: 1px;
}

/* 体型切换 */
.body-type-switch {
  display: flex;
  gap: 4px;
  background: var(--ds-bg-tertiary);
  border: 1px solid var(--ds-border);
  border-radius: 6px;
  padding: 3px;
}

.body-type-btn {
  padding: 4px 10px;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--ds-text-secondary);
  font-size: 11px;
  font-family: inherit;
  cursor: pointer;
  transition: all 0.15s ease;
  white-space: nowrap;
}

.body-type-btn:hover {
  color: var(--ds-text-primary);
  background: var(--ds-bg-secondary);
}

.body-type-btn--active {
  background: var(--ds-color-primary);
  color: var(--ds-text-on-accent);
}

.body-type-btn--active:hover {
  background: var(--ds-color-primary);
  color: var(--ds-text-on-accent);
}

/* 分类标签 */
.part-selector__categories {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  padding: 12px 16px;
  background: var(--ds-bg-base);
  border-bottom: 1px solid var(--ds-border);
}

.category-btn {
  position: relative;
  padding: 6px 12px;
  background: transparent;
  border: 1px solid var(--ds-border);
  border-radius: 4px;
  color: var(--ds-text-secondary);
  font-size: 11px;
  font-family: inherit;
  cursor: pointer;
  transition: all 0.15s ease;
}

.category-btn:hover {
  border-color: var(--ds-color-primary);
  color: var(--ds-color-primary);
}

.category-btn--active {
  background: var(--ds-color-primary);
  border-color: var(--ds-color-primary);
  color: var(--ds-text-on-accent);
}

.category-btn--has-selection:not(.category-btn--active) {
  border-color: var(--ds-color-secondary);
  color: var(--ds-color-secondary);
}

.category-btn__dot {
  position: absolute;
  top: 2px;
  right: 2px;
  width: 6px;
  height: 6px;
  background: var(--ds-color-secondary);
  border-radius: 50%;
}

.category-btn--active .category-btn__dot {
  background: var(--ds-text-inverse);
}

/* 部件列表 */
.part-selector__list {
  flex: 1;
  padding: 8px;
  overflow-y: auto;
  background: var(--ds-bg-base);
}

.part-selector__loading,
.part-selector__empty {
  text-align: center;
  padding: 40px 20px;
  color: var(--ds-text-muted);
  font-size: 12px;
}

.part-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 12px;
  margin-bottom: 4px;
  background: var(--ds-bg-secondary);
  border: 1px solid transparent;
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.15s ease;
  font-family: inherit;
  width: 100%;
  text-align: left;
}

.part-item:hover {
  background: var(--ds-bg-tertiary);
  border-color: var(--ds-border);
}

.part-item--selected {
  background: var(--ds-color-secondary);
  border-color: var(--ds-color-secondary);
}

.part-item--selected:hover {
  background: var(--ds-color-secondary);
}

.part-item__info {
  display: flex;
  flex-direction: column;
  gap: 2px;
  flex: 1;
  min-width: 0;
}

.part-item__name {
  font-size: 12px;
  color: var(--ds-text-primary);
  font-weight: 500;
}

.part-item--selected .part-item__name {
  color: var(--ds-text-on-color);
}

.part-item__meta {
  font-size: 10px;
  color: var(--ds-text-muted);
}

.part-item--selected .part-item__meta {
  color: rgba(255, 255, 255, 0.7);
}

.part-item__variant {
  padding: 4px 8px;
  background: var(--ds-bg-base);
  border: 1px solid var(--ds-border);
  border-radius: 4px;
  color: var(--ds-text-primary);
  font-size: 11px;
  font-family: inherit;
  cursor: pointer;
  margin-left: 8px;
}

.part-item__variant:focus {
  outline: none;
  border-color: var(--ds-color-primary);
}

/* 底部随机化按钮 */
.part-selector__footer {
  padding: 12px 16px;
  border-top: 1px solid var(--ds-border);
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

.randomize-btn {
  padding: 6px 14px;
  border: 1px solid var(--ds-border);
  border-radius: 4px;
  font-size: 11px;
  font-family: inherit;
  cursor: pointer;
  transition: all 0.15s ease;
  background: var(--ds-bg-tertiary);
  color: var(--ds-text-secondary);
}

.randomize-btn:hover {
  border-color: var(--ds-color-primary);
  color: var(--ds-color-primary);
}

.randomize-btn--minimal:hover {
  border-color: var(--ds-color-primary);
  color: var(--ds-color-primary);
}

.randomize-btn--normal:hover {
  border-color: var(--ds-color-secondary);
  color: var(--ds-color-secondary);
}

.randomize-btn--full:hover {
  border-color: var(--ds-status-warning);
  color: var(--ds-status-warning);
}

/* 滚动条样式 */
.part-selector__list::-webkit-scrollbar {
  width: 6px;
}

.part-selector__list::-webkit-scrollbar-track {
  background: var(--ds-bg-base);
}

.part-selector__list::-webkit-scrollbar-thumb {
  background: var(--ds-border);
  border-radius: 3px;
}

.part-selector__list::-webkit-scrollbar-thumb:hover {
  background: var(--ds-color-primary);
}
</style>
