<script setup lang="ts">
/**
 * PartSelectorV2 - 新版部位选择组件
 * 纯Vue实现，用于CharacterCreatorModalV2
 */
import { ref, computed, watch } from 'vue';
import { StratixButton } from '@/components/ui';
import type { BodyType, PartCategory, PartSelection, PartMetadata } from '../stratix-character-creator/types';
import { partRegistry } from '../stratix-character-creator';
import { PART_CATEGORY_CONFIGS, getCategoryConfig } from '../stratix-character-creator/config/partConfig';

// ==================== Types ====================
const CATEGORY_ICONS: Record<string, string> = {
  shadow: '[S]', body: '[B]', head: '[H]', eyes: '[E]', hair: '[H]',
  ears: '[E]', nose: '[N]', facial: '[F]', torso: '[T]', arms: '[A]',
  hands: '[H]', legs: '[L]', feet: '[F]', cape: '[C]', backpack: '[B]',
  neck: '[N]', shoulders: '[S]', wrists: '[W]', shield: '[S]', weapon: '[W]',
  hat: '[H]', quiver: '[Q]'
};

const categories = Object.keys(PART_CATEGORY_CONFIGS) as PartCategory[];

// ==================== Props & Emits ====================
const props = defineProps<{
  bodyType: BodyType;
  selections?: Record<string, PartSelection>;
}>();

const emit = defineEmits<{
  (e: 'partSelected', category: PartCategory, itemId: string, variant: string): void;
  (e: 'randomize'): void;
  (e: 'next'): void;
}>();

// ==================== State ====================
const currentCategory = ref<PartCategory | null>(null);
const selections = ref<Record<string, PartSelection>>(props.selections || {});

watch(() => props.selections, (newVal) => {
  if (newVal) {
    selections.value = { ...newVal };
  }
}, { immediate: true });

// Watch bodyType changes - filter out invalid selections
watch(() => props.bodyType, (newBodyType) => {
  // Filter selections to only keep parts valid for the new bodyType
  const filteredSelections: Record<string, PartSelection> = {};
  for (const [category, selection] of Object.entries(selections.value)) {
    const parts = partRegistry.getPartsByCategory(category as PartCategory)
      .filter(p => p.required.includes(newBodyType));
    const isValid = parts.some(p => p.itemId === selection.itemId);
    if (isValid) {
      filteredSelections[category] = selection;
    }
  }
  selections.value = filteredSelections;

  // Reset current category if it has no valid parts for new bodyType
  if (currentCategory.value) {
    const categoryParts = partRegistry.getPartsByCategory(currentCategory.value)
      .filter(p => p.required.includes(newBodyType));
    if (categoryParts.length === 0) {
      currentCategory.value = null;
    }
  }
});

// ==================== Computed ====================
const currentParts = computed(() => {
  if (!currentCategory.value) return [];
  return partRegistry.getPartsByCategory(currentCategory.value)
    .filter(p => p.required.includes(props.bodyType));
});

// ==================== Methods ====================
const selectCategory = (category: PartCategory) => {
  currentCategory.value = category;
};

const selectPart = (part: PartMetadata, variant?: string) => {
  if (!currentCategory.value) return;
  const selectedVariant = variant || part.variants?.[0] || 'default';
  selections.value = {
    ...selections.value,
    [currentCategory.value]: { itemId: part.itemId, variant: selectedVariant }
  };
  emit('partSelected', currentCategory.value, part.itemId, selectedVariant);
};

const selectVariant = (part: PartMetadata, variant: string) => {
  if (!currentCategory.value) return;
  selections.value = {
    ...selections.value,
    [currentCategory.value]: { itemId: part.itemId, variant }
  };
  emit('partSelected', currentCategory.value, part.itemId, variant);
};

const handleRandomize = () => {
  emit('randomize');
};

const handleNext = () => {
  emit('next');
};

const isPartSelected = (part: PartMetadata) => {
  if (!currentCategory.value) return false;
  const sel = selections.value[currentCategory.value];
  return sel?.itemId === part.itemId;
};

const getSelectedVariant = (part: PartMetadata) => {
  if (!currentCategory.value) return part.variants?.[0] || 'default';
  const sel = selections.value[currentCategory.value];
  return sel?.itemId === part.itemId ? sel.variant : (part.variants?.[0] || 'default');
};
</script>

<template>
  <div class="part-selector">
    <!-- Header -->
    <div class="header">
      <span class="header-title">外观配置 Appearance</span>
    </div>

    <!-- Category Tabs -->
    <div class="categories">
      <button
        v-for="cat in categories"
        :key="cat"
        class="cat-btn"
        :class="{ active: currentCategory === cat }"
        :title="getCategoryConfig(cat)?.name || cat"
        @click="selectCategory(cat)"
      >
        {{ CATEGORY_ICONS[cat] || '[?]' }}
      </button>
    </div>

    <!-- Parts List -->
    <div class="parts-list">
      <template v-if="currentCategory">
        <div v-if="currentParts.length === 0" class="empty-state">
          此类别暂无部件<br />No parts available
        </div>
        <div
          v-for="part in currentParts"
          :key="part.itemId"
          class="part-item"
          :class="{ selected: isPartSelected(part) }"
          @click="selectPart(part)"
        >
          <span class="part-name">{{ part.name }}</span>
          <span class="part-meta">{{ part.animations?.length || 0 }} anim</span>
          <select
            v-if="(part.variants?.length || 0) > 1"
            class="variant-select"
            :value="getSelectedVariant(part)"
            @change="selectVariant(part, ($event.target as HTMLSelectElement).value)"
            @click.stop
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
      <div v-else class="empty-state">
        选择类别查看可用部件<br />Select a category
      </div>
    </div>

    <!-- Footer -->
    <div class="footer">
      <StratixButton variant="secondary" size="sm" @click="handleRandomize">
        随机 RANDOM
      </StratixButton>
      <StratixButton variant="primary" size="sm" @click="handleNext">
        下一步 NEXT
      </StratixButton>
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
  font-family: 'SF Mono', 'Monaco', 'Inconsolata', 'Fira Mono', monospace;
}

.header {
  padding: 12px 16px;
  border-bottom: 1px solid var(--ds-border);
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.header-title {
  font-size: 14px;
  color: var(--ds-brand-primary);
}

.categories {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  padding: 12px 16px;
  background: var(--ds-bg-secondary);
  border-bottom: 1px solid var(--ds-border);
}

.cat-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 36px;
  height: 32px;
  padding: 0 8px;
  background: var(--ds-bg-tertiary);
  border: 1px solid var(--ds-border);
  border-radius: 4px;
  color: var(--ds-text-secondary);
  font-size: 11px;
  font-family: inherit;
  cursor: pointer;
  transition: all 0.15s ease;
}

.cat-btn:hover {
  background: var(--ds-bg-hover);
  border-color: var(--ds-brand-primary);
  color: var(--ds-brand-primary);
}

.cat-btn.active {
  background: var(--ds-brand-primary);
  border-color: var(--ds-brand-primary);
  color: var(--ds-text-inverse);
}

.parts-list {
  flex: 1;
  padding: 8px;
  overflow-y: auto;
  background: var(--ds-bg-secondary);
}

.empty-state {
  color: var(--ds-text-muted);
  text-align: center;
  padding: 40px 20px;
  font-size: 12px;
  line-height: 1.6;
}

.part-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  background: var(--ds-bg-tertiary);
  border: 1px solid var(--ds-border);
  border-radius: 6px;
  margin-bottom: 6px;
  cursor: pointer;
  transition: all 0.15s ease;
}

.part-item:hover {
  border-color: var(--ds-brand-primary);
  background: var(--ds-bg-hover);
}

.part-item.selected {
  border-color: var(--ds-brand-primary);
  background: var(--ds-brand-secondary);
  color: var(--ds-text-inverse);
}

.part-name {
  flex: 1;
  font-size: 12px;
  color: inherit;
}

.part-meta {
  font-size: 10px;
  color: var(--ds-text-muted);
}

.part-item.selected .part-meta {
  color: var(--ds-text-inverse);
  opacity: 0.8;
}

.variant-select {
  padding: 4px 8px;
  background: var(--ds-bg-secondary);
  border: 1px solid var(--ds-border);
  border-radius: 4px;
  color: var(--ds-text-primary);
  font-size: 11px;
  font-family: inherit;
  cursor: pointer;
}

.variant-select:focus {
  outline: none;
  border-color: var(--ds-brand-primary);
}

.footer {
  padding: 16px;
  border-top: 1px solid var(--ds-border);
  display: flex;
  justify-content: space-between;
  gap: 12px;
}

/* Scrollbar styling */
.parts-list::-webkit-scrollbar {
  width: 6px;
}

.parts-list::-webkit-scrollbar-track {
  background: var(--ds-bg-tertiary);
}

.parts-list::-webkit-scrollbar-thumb {
  background: var(--ds-border);
  border-radius: 3px;
}

.parts-list::-webkit-scrollbar-thumb:hover {
  background: var(--ds-text-muted);
}
</style>
