<script setup lang="ts">
/**
 * BodyTypeSelector.vue - 体型选择器
 *
 * 提供体型选择（male, female, teen, muscular, pregnant）
 * 当前选中高亮显示
 *
 * emit: change(bodyType)
 */

import { computed } from 'vue';
import { BODY_TYPES, type BodyType } from '@/stratix-character-creator/constants';

const props = defineProps<{
  modelValue: BodyType;
}>();

const emit = defineEmits<{
  'update:modelValue': [value: BodyType];
  change: [value: BodyType];
}>();

// 体型配置
const bodyTypeConfig: Record<BodyType, { label: string; icon: string }> = {
  male: { label: '男', icon: '♂' },
  female: { label: '女', icon: '♀' },
  teen: { label: '少年', icon: '?' },
  muscular: { label: '肌肉', icon: '💪' },
  pregnant: { label: '孕妇', icon: '🤰' },
};

// 当前选中的体型
const selectedType = computed({
  get: () => props.modelValue,
  set: (value: BodyType) => {
    emit('update:modelValue', value);
    emit('change', value);
  },
});
</script>

<template>
  <div class="body-type-selector">
    <div class="body-type-selector__label">体型</div>
    <div class="body-type-selector__options">
      <button
        v-for="bodyType in BODY_TYPES"
        :key="bodyType"
        class="body-type-btn"
        :class="{ 'body-type-btn--active': selectedType === bodyType }"
        @click="selectedType = bodyType"
      >
        <span class="body-type-btn__icon">{{ bodyTypeConfig[bodyType].icon }}</span>
        <span class="body-type-btn__label">{{ bodyTypeConfig[bodyType].label }}</span>
      </button>
    </div>
  </div>
</template>

<style scoped>
.body-type-selector {
  display: flex;
  align-items: center;
  gap: 12px;
}

.body-type-selector__label {
  font-size: var(--ds-font-size-sm);
  color: var(--ds-text-muted);
  font-family: var(--ds-font-mono);
  flex-shrink: 0;
}

.body-type-selector__options {
  display: flex;
  gap: var(--ds-spacing-sm);
  flex-wrap: wrap;
}

.body-type-btn {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--ds-spacing-xs);
  padding: var(--ds-spacing-sm) var(--ds-spacing-md);
  background: var(--ds-bg-secondary);
  border: 1px solid var(--ds-border);
  border-radius: var(--ds-radius-md);
  cursor: pointer;
  transition: all var(--ds-animation-duration-fast) ease;
  font-family: var(--ds-font-mono);
  min-width: 56px;
}

.body-type-btn:hover {
  border-color: var(--ds-color-primary);
  background: var(--ds-bg-tertiary);
}

.body-type-btn--active {
  background: var(--ds-color-primary);
  border-color: var(--ds-color-primary);
}

.body-type-btn__icon {
  font-size: var(--ds-font-size-xl);
  line-height: 1;
}

.body-type-btn--active .body-type-btn__icon {
  color: var(--ds-text-on-accent);
}

.body-type-btn__label {
  font-size: var(--ds-font-size-xs);
  color: var(--ds-text-secondary);
  font-weight: 500;
}

.body-type-btn--active .body-type-btn__label {
  color: var(--ds-text-on-accent);
}
</style>
