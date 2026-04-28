<script setup lang="ts">
import { computed, toRef } from 'vue';
import { getToken } from '@/design-system/config';
import { provideSizeContext } from '@/design-system/composables/useSizeContext';

interface Props {
  modelValue?: boolean;
  indeterminate?: boolean;
  disabled?: boolean;
  size?: 'sm' | 'md';
  label?: string;
}

const props = withDefaults(defineProps<Props>(), {
  modelValue: false,
  indeterminate: false,
  disabled: false,
  size: 'md',
  label: '',
});

provideSizeContext(toRef(props, 'size'));

const emit = defineEmits<{
  'update:modelValue': [value: boolean];
  change: [value: boolean];
}>();

const sizeConfig = {
  sm: { width: '16px', height: '16px' },
  md: { width: '18px', height: '18px' },
};

const handleChange = (event: Event) => {
  if (props.disabled) return;
  const target = event.target as HTMLInputElement;
  const newValue = target.checked;
  emit('update:modelValue', newValue);
  emit('change', newValue);
};

const isChecked = computed(() => props.modelValue && !props.indeterminate);
const isIndeterminate = computed(() => props.indeterminate);
</script>

<template>
  <label 
    class="stratix-checkbox"
    :class="{
      'stratix-checkbox--disabled': disabled,
      'stratix-checkbox--checked': isChecked,
      'stratix-checkbox--indeterminate': isIndeterminate,
    }"
  >
    <input
      type="checkbox"
      :checked="modelValue"
      :disabled="disabled"
      @change="handleChange"
      class="stratix-checkbox__input"
    />
    <span 
      class="stratix-checkbox__box"
      :class="[`stratix-checkbox__box--${size}`]"
    >
      <svg
        v-if="isChecked"
        class="stratix-checkbox__check-icon"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="3"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        <path class="stratix-checkbox__check-path" d="M5 13l4 4L19 7" />
      </svg>
      <svg
        v-else-if="isIndeterminate"
        class="stratix-checkbox__indeterminate-icon"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="3"
        stroke-linecap="round"
      >
        <line x1="5" y1="12" x2="19" y2="12" />
      </svg>
    </span>
    <span v-if="label" class="stratix-checkbox__label">
      {{ label }}
    </span>
  </label>
</template>

<style scoped>
.stratix-checkbox {
  display: inline-flex;
  align-items: center;
  gap: var(--ds-spacing-sm);
  cursor: pointer;
  user-select: none;
}

.stratix-checkbox--disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.stratix-checkbox__input {
  position: absolute;
  opacity: 0;
  pointer-events: none;
}

.stratix-checkbox__box {
  display: flex;
  align-items: center;
  justify-content: center;
  background: v-bind('getToken("colors.background.overlay")');
  border: 1px solid v-bind('getToken("colors.border.default")');
  border-radius: v-bind('getToken("radii.sm")');
  transition: all var(--ds-animation-duration-fast) ease;
  flex-shrink: 0;
  position: relative;
  overflow: hidden;
}

.stratix-checkbox__box--sm {
  width: v-bind('sizeConfig.sm.width');
  height: v-bind('sizeConfig.sm.height');
}

.stratix-checkbox__box--md {
  width: v-bind('sizeConfig.md.width');
  height: v-bind('sizeConfig.md.height');
}

.stratix-checkbox:hover:not(.stratix-checkbox--disabled) .stratix-checkbox__box {
  border-color: v-bind('getToken("colors.status.info")');
  box-shadow: 0 0 0 2px color-mix(in srgb, v-bind('getToken("colors.status.info")') 15%, transparent);
}

.stratix-checkbox--checked .stratix-checkbox__box,
.stratix-checkbox--indeterminate .stratix-checkbox__box {
  background: v-bind('getToken("colors.status.info")');
  border-color: v-bind('getToken("colors.status.info")');
}

.stratix-checkbox__check-icon {
  width: 70%;
  height: 70%;
  color: v-bind('getToken("colors.background.base")');
}

.stratix-checkbox__check-path {
  stroke-dasharray: 24;
  stroke-dashoffset: 24;
  animation: ds-check-draw var(--ds-animation-duration-fast) ease forwards;
}

.stratix-checkbox__indeterminate-icon {
  width: 70%;
  height: 70%;
  color: v-bind('getToken("colors.background.base")');
  animation: ds-scale-in var(--ds-animation-duration-fast) ease;
}

.stratix-checkbox__label {
  font-size: var(--ds-font-size-md);
  color: v-bind('getToken("colors.text.primary")');
}

.stratix-checkbox--disabled .stratix-checkbox__label {
  color: v-bind('getToken("colors.text.muted")');
}

@keyframes ds-check-draw {
  to {
    stroke-dashoffset: 0;
  }
}

@media (prefers-reduced-motion: reduce) {
  .stratix-checkbox__box,
  .stratix-checkbox__check-path {
    transition: none;
    animation: none;
  }
  .stratix-checkbox__check-path {
    stroke-dashoffset: 0;
  }
}
</style>
