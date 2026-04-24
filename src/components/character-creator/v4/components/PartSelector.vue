<script setup lang="ts">
/**
 * PartSelector.vue — 部件选择器 (V4)
 *
 * 分类标签浏览部件，每个分类展示可用部件列表。
 * 体型切换内嵌于顶部，三档随机化按钮在底部。
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
 *
 * 美学约束: A1-A8，全部使用 var(--ds-*) tokens
 */

import { ref, computed } from 'vue';
import { partRegistry } from '@/stratix-character-creator/core/PartRegistry';
import {
  PART_CATEGORIES,
  type PartCategory,
  type BodyType,
} from '@/stratix-character-creator/constants';
import type { PartSelection, PartMetadata } from '@/stratix-character-creator/types';

// ============================================================================
// Props & Emits
// ============================================================================

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
// 常量
// ============================================================================

const BODY_TYPE_OPTIONS: { value: BodyType; label: string }[] = [
  { value: 'male', label: '♂ 男' },
  { value: 'female', label: '♀ 女' },
];

const CATEGORY_LABELS: Record<string, string> = {
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

const RANDOMIZE_MODES = [
  { mode: 'minimal' as const, label: '最小', title: '只选核心部件' },
  { mode: 'normal' as const, label: '标准', title: '部分可选配件' },
  { mode: 'full' as const, label: '全随机', title: '包含所有配件' },
];

// ============================================================================
// 状态
// ============================================================================

const activeCategory = ref<PartCategory>('body');

// ============================================================================
// 计算属性
// ============================================================================

/** 按分类整理的可用部件（过滤当前体型） */
const availableParts = computed<Map<PartCategory, PartMetadata[]>>(() => {
  const map = new Map<PartCategory, PartMetadata[]>();
  if (!partRegistry.isLoaded()) return map;

  for (const category of PART_CATEGORIES) {
    const parts = partRegistry
      .getPartsByCategory(category)
      .filter(p => p.required.includes(props.bodyType));
    if (parts.length > 0) {
      map.set(category, parts);
    }
  }
  return map;
});

/** 有内容的分类列表（用于标签栏） */
const categories = computed<PartCategory[]>(() => {
  return Array.from(availableParts.value.keys()) as PartCategory[];
});

/** 当前分类下的部件 */
const currentParts = computed<PartMetadata[]>(() => {
  return availableParts.value.get(activeCategory.value) ?? [];
});

/** 是否已加载 */
const isLoaded = computed(() => partRegistry.isLoaded());

// ============================================================================
// 方法
// ============================================================================

function switchCategory(category: PartCategory): void {
  activeCategory.value = category;
}

function isSelected(itemId: string): boolean {
  return props.selectedParts[activeCategory.value]?.itemId === itemId;
}

function hasSelection(category: PartCategory): boolean {
  return !!props.selectedParts[category];
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

function getCurrentVariant(part: PartMetadata): string {
  return props.selectedParts[activeCategory.value]?.variant ?? part.variants?.[0] ?? 'default';
}
</script>

<template>
  <div class="part-selector">
    <!-- ================================================================
         头部 — 标题 + 体型切换（内嵌）
    ================================================================ -->
    <div class="ps-header">
      <div class="ps-header__title-group">
        <span class="ps-header__title">外观配置</span>
        <span class="ps-header__subtitle">APPEARANCE</span>
      </div>

      <!-- 体型切换 -->
      <div class="ps-body-switch">
        <button
          v-for="bt in BODY_TYPE_OPTIONS"
          :key="bt.value"
          :class="[
            'ps-body-switch__btn',
            { 'ps-body-switch__btn--active': bodyType === bt.value },
          ]"
          @click="emit('update:bodyType', bt.value)"
        >
          {{ bt.label }}
        </button>
      </div>
    </div>

    <!-- ================================================================
         分类标签栏
    ================================================================ -->
    <div class="ps-categories">
      <button
        v-for="category in categories"
        :key="category"
        :class="[
          'ps-cat-btn',
          {
            'ps-cat-btn--active': activeCategory === category,
            'ps-cat-btn--selected': hasSelection(category),
          },
        ]"
        @click="switchCategory(category)"
      >
        <span class="ps-cat-btn__label">{{ CATEGORY_LABELS[category] || category }}</span>
        <span v-if="hasSelection(category)" class="ps-cat-btn__dot" />
      </button>
    </div>

    <!-- ================================================================
         部件列表
    ================================================================ -->
    <div class="ps-list">
      <div v-if="!isLoaded" class="ps-list__empty">加载中…</div>
      <div v-else-if="currentParts.length === 0" class="ps-list__empty">暂无可用部件</div>

      <template v-else>
        <!-- 无选项 -->
        <button
          :class="['ps-part', { 'ps-part--selected': !selectedParts[activeCategory] }]"
          @click="deselectCurrentCategory"
        >
          <span class="ps-part__name">无</span>
          <span class="ps-part__meta">None</span>
        </button>

        <!-- 部件项 -->
        <div
          v-for="part in currentParts"
          :key="part.itemId"
          :class="['ps-part', { 'ps-part--selected': isSelected(part.itemId) }]"
        >
          <div class="ps-part__info" @click="selectPart(part)">
            <span class="ps-part__name">{{ part.name }}</span>
            <span class="ps-part__meta">{{ part.animations?.length ?? 0 }} anim</span>
          </div>

          <!-- 变体下拉 -->
          <select
            v-if="part.variants && part.variants.length > 1"
            class="ps-part__variant"
            :value="getCurrentVariant(part)"
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

    <!-- ================================================================
         底部 — 三档随机化按钮
    ================================================================ -->
    <div class="ps-footer">
      <button
        v-for="rm in RANDOMIZE_MODES"
        :key="rm.mode"
        class="ps-randomize-btn"
        :title="rm.title"
        @click="emit('randomize')"
      >
        {{ rm.label }}
      </button>
    </div>
  </div>
</template>

<style scoped>
/* ==========================================================================
   根容器
   A4: flex column, height 100%
   A1: spacing tokens only
========================================================================== */
.part-selector {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--ds-bg-secondary, #1a1a2e);
  border: 1px solid var(--ds-border, #333);
  border-radius: var(--ds-radius-lg, 8px);
  overflow: hidden;
}

/* ==========================================================================
   头部 — 标题 + 体型切换
========================================================================== */
.ps-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--ds-spacing-xs, 8px) var(--ds-spacing-md, 12px);
  border-bottom: 1px solid var(--ds-border, #333);
  gap: var(--ds-spacing-xs, 8px);
  flex-shrink: 0;
}

.ps-header__title-group {
  display: flex;
  align-items: baseline;
  gap: var(--ds-spacing-xs, 4px);
}

.ps-header__title {
  font-size: var(--ds-typography-fontSize-md, 14px);
  font-weight: var(--ds-typography-fontWeight-medium, 500);
  color: var(--ds-color-primary, #00d4ff);
}

.ps-header__subtitle {
  font-size: var(--ds-typography-fontSize-xs, 10px);
  color: var(--ds-text-muted, #666);
  letter-spacing: 0.1em;
}

/* 体型切换 — 内嵌 */
.ps-body-switch {
  display: flex;
  gap: var(--ds-spacing-xs, 4px);
  background: var(--ds-bg-tertiary, #252540);
  border: 1px solid var(--ds-border, #333);
  border-radius: var(--ds-radius-md, 4px);
  padding: 3px;
}

.ps-body-switch__btn {
  padding: var(--ds-spacing-xs, 4px) var(--ds-spacing-sm, 8px);
  border: none;
  border-radius: var(--ds-radius-sm, 2px);
  background: transparent;
  color: var(--ds-text-secondary, #aaa);
  font-size: var(--ds-typography-fontSize-sm, 12px);
  font-family: inherit;
  cursor: pointer;
  transition: background 0.15s ease, color 0.15s ease;
  white-space: nowrap;
}

.ps-body-switch__btn:hover {
  color: var(--ds-text-primary, #eee);
  background: var(--ds-bg-secondary, #1a1a2e);
}

.ps-body-switch__btn--active {
  background: var(--ds-color-primary, #00d4ff);
  color: var(--ds-text-on-accent, #000);
}

.ps-body-switch__btn--active:hover {
  background: var(--ds-color-primary, #00d4ff);
  color: var(--ds-text-on-accent, #000);
}

/* ==========================================================================
   分类标签栏
========================================================================== */
.ps-categories {
  display: flex;
  flex-wrap: wrap;
  gap: var(--ds-spacing-xs, 4px);
  padding: var(--ds-spacing-xs, 8px) var(--ds-spacing-md, 12px);
  background: var(--ds-bg-base, #111);
  border-bottom: 1px solid var(--ds-border, #333);
  flex-shrink: 0;
}

.ps-cat-btn {
  position: relative;
  padding: var(--ds-spacing-xs, 4px) var(--ds-spacing-sm, 8px);
  background: transparent;
  border: 1px solid var(--ds-border, #333);
  border-radius: var(--ds-radius-sm, 2px);
  color: var(--ds-text-secondary, #aaa);
  font-size: var(--ds-typography-fontSize-xs, 10px);
  font-family: inherit;
  cursor: pointer;
  transition: border-color 0.15s ease, color 0.15s ease, background 0.15s ease;
}

.ps-cat-btn:hover {
  border-color: var(--ds-color-primary, #00d4ff);
  color: var(--ds-color-primary, #00d4ff);
}

.ps-cat-btn--active {
  background: var(--ds-color-primary, #00d4ff);
  border-color: var(--ds-color-primary, #00d4ff);
  color: var(--ds-text-on-accent, #000);
}

.ps-cat-btn--selected:not(.ps-cat-btn--active) {
  border-color: var(--ds-color-secondary, #7b61ff);
  color: var(--ds-color-secondary, #7b61ff);
}

.ps-cat-btn__label {
  line-height: 1;
}

.ps-cat-btn__dot {
  position: absolute;
  top: 2px;
  right: 2px;
  width: 6px;
  height: 6px;
  background: var(--ds-color-secondary, #7b61ff);
  border-radius: 50%;
}

.ps-cat-btn--active .ps-cat-btn__dot {
  background: var(--ds-text-inverse, #fff);
}

/* ==========================================================================
   部件列表
========================================================================== */
.ps-list {
  flex: 1;
  padding: var(--ds-spacing-xs, 8px);
  overflow-y: auto;
  background: var(--ds-bg-base, #111);
  min-height: 0;
}

.ps-list__empty {
  text-align: center;
  padding: var(--ds-spacing-xl, 32px) var(--ds-spacing-md, 12px);
  color: var(--ds-text-muted, #666);
  font-size: var(--ds-typography-fontSize-sm, 12px);
}

.ps-part {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--ds-spacing-xs, 8px) var(--ds-spacing-sm, 8px);
  margin-bottom: var(--ds-spacing-xs, 4px);
  background: var(--ds-bg-secondary, #1a1a2e);
  border: 1px solid transparent;
  border-radius: var(--ds-radius-sm, 2px);
  cursor: pointer;
  transition: background 0.15s ease, border-color 0.15s ease;
  font-family: inherit;
  width: 100%;
  text-align: left;
}

.ps-part:hover {
  background: var(--ds-bg-tertiary, #252540);
  border-color: var(--ds-border, #333);
}

.ps-part--selected {
  background: var(--ds-color-secondary, #7b61ff);
  border-color: var(--ds-color-secondary, #7b61ff);
}

.ps-part--selected:hover {
  background: var(--ds-color-secondary, #7b61ff);
}

.ps-part__info {
  display: flex;
  flex-direction: column;
  gap: 2px;
  flex: 1;
  min-width: 0;
}

.ps-part__name {
  font-size: var(--ds-typography-fontSize-sm, 12px);
  font-weight: var(--ds-typography-fontWeight-medium, 500);
  color: var(--ds-text-primary, #eee);
}

.ps-part--selected .ps-part__name {
  color: var(--ds-text-on-color, #fff);
}

.ps-part__meta {
  font-size: var(--ds-typography-fontSize-xs, 10px);
  color: var(--ds-text-muted, #666);
}

.ps-part--selected .ps-part__meta {
  color: rgba(255, 255, 255, 0.7);
}

.ps-part__variant {
  padding: var(--ds-spacing-xs, 4px) var(--ds-spacing-sm, 8px);
  background: var(--ds-bg-base, #111);
  border: 1px solid var(--ds-border, #333);
  border-radius: var(--ds-radius-sm, 2px);
  color: var(--ds-text-primary, #eee);
  font-size: var(--ds-typography-fontSize-xs, 10px);
  font-family: inherit;
  cursor: pointer;
  margin-left: var(--ds-spacing-xs, 8px);
}

.ps-part__variant:focus {
  outline: none;
  border-color: var(--ds-color-primary, #00d4ff);
}

/* ==========================================================================
   底部 — 三档随机化按钮
========================================================================== */
.ps-footer {
  display: flex;
  justify-content: flex-end;
  gap: var(--ds-spacing-xs, 8px);
  padding: var(--ds-spacing-xs, 8px) var(--ds-spacing-md, 12px);
  border-top: 1px solid var(--ds-border, #333);
  flex-shrink: 0;
}

.ps-randomize-btn {
  padding: var(--ds-spacing-xs, 4px) var(--ds-spacing-sm, 8px);
  background: var(--ds-bg-tertiary, #252540);
  border: 1px solid var(--ds-border, #333);
  border-radius: var(--ds-radius-sm, 2px);
  font-size: var(--ds-typography-fontSize-xs, 10px);
  font-family: inherit;
  color: var(--ds-text-secondary, #aaa);
  cursor: pointer;
  transition: border-color 0.15s ease, color 0.15s ease;
}

.ps-randomize-btn:hover {
  border-color: var(--ds-color-primary, #00d4ff);
  color: var(--ds-color-primary, #00d4ff);
}

/* ==========================================================================
   滚动条
========================================================================== */
.ps-list::-webkit-scrollbar {
  width: 6px;
}

.ps-list::-webkit-scrollbar-track {
  background: var(--ds-bg-base, #111);
}

.ps-list::-webkit-scrollbar-thumb {
  background: var(--ds-border, #333);
  border-radius: 3px;
}

.ps-list::-webkit-scrollbar-thumb:hover {
  background: var(--ds-color-primary, #00d4ff);
}
</style>
