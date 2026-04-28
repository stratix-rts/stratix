<script setup lang="ts">
import { ref, computed } from 'vue';
import { getToken } from '@/design-system/config';

interface Props {
  modelValue?: number;
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
  size?: 'sm' | 'md';
  showTooltip?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  modelValue: 0,
  min: 0,
  max: 100,
  step: 1,
  disabled: false,
  size: 'md',
  showTooltip: true,
});

const emit = defineEmits<{
  'update:modelValue': [value: number];
  change: [value: number];
}>();

const isDragging = ref(false);
const showTooltipLocal = ref(false);

const percentage = computed(() => {
  const range = props.max - props.min;
  if (range === 0) return 0;
  return ((props.modelValue - props.min) / range) * 100;
});

const handleInput = (event: Event) => {
  const target = event.target as HTMLInputElement;
  const val = Number(target.value);
  emit('update:modelValue', val);
  emit('change', val);
};

const trackStyles = computed(() => ({
  background: `linear-gradient(to right, ${getToken('colors.status.info')} ${percentage.value}%, ${getToken('colors.background.overlay')} ${percentage.value}%)`,
}));
</script>

<template>
  <div
    class="stratix-slider"
    :class="{
      'stratix-slider--disabled': disabled,
      [`stratix-slider--${size}`]: true,
    }"
    @mouseenter="showTooltipLocal = true"
    @mouseleave="showTooltipLocal = false"
  >
    <div class="stratix-slider__track" :style="trackStyles">
      <input
        type="range"
        :min="min"
        :max="max"
        :step="step"
        :value="modelValue"
        :disabled="disabled"
        class="stratix-slider__input"
        @input="handleInput"
        @mousedown="isDragging = true"
        @mouseup="isDragging = false"
      />
    </div>
    <div
      v-if="showTooltip && (showTooltipLocal || isDragging)"
      class="stratix-slider__tooltip"
      :style="{ left: `${percentage}%` }"
    >
      {{ modelValue }}
    </div>
  </div>
</template>

<style scoped>
.stratix-slider {
  position: relative;
  width: 100%;
  padding: 12px 0;
}

.stratix-slider__track {
  position: relative;
  height: 6px;
  border-radius: var(--ds-radius-full);
  overflow: visible;
}

.stratix-slider--sm .stratix-slider__track {
  height: 4px;
}

.stratix-slider__input {
  position: absolute;
  top: 50%;
  left: 0;
  width: 100%;
  transform: translateY(-50%);
  -webkit-appearance: none;
  appearance: none;
  background: transparent;
  cursor: pointer;
  margin: 0;
  height: 100%;
  outline: none;
}

.stratix-slider__input::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 16px;
  height: 16px;
  border-radius: var(--ds-radius-full);
  background: v-bind('getToken("colors.background.base")');
  border: 2px solid v-bind('getToken("colors.status.info")');
  box-shadow: 0 0 0 0 color-mix(in srgb, v-bind('getToken("colors.status.info")') 30%, transparent);
  transition: box-shadow var(--ds-animation-duration-fast) ease, transform var(--ds-animation-duration-fast) ease;
  cursor: grab;
}

.stratix-slider--sm .stratix-slider__input::-webkit-slider-thumb {
  width: 12px;
  height: 12px;
}

.stratix-slider__input:hover::-webkit-slider-thumb {
  box-shadow: 0 0 0 6px color-mix(in srgb, v-bind('getToken("colors.status.info")') 20%, transparent);
  transform: scale(1.1);
}

.stratix-slider__input:active::-webkit-slider-thumb {
  cursor: grabbing;
  transform: scale(1.15);
}

.stratix-slider__input::-moz-range-thumb {
  width: 16px;
  height: 16px;
  border-radius: var(--ds-radius-full);
  background: v-bind('getToken("colors.background.base")');
  border: 2px solid v-bind('getToken("colors.status.info")');
  cursor: pointer;
}

.stratix-slider--disabled .stratix-slider__input {
  cursor: not-allowed;
  opacity: 0.5;
}

.stratix-slider--disabled .stratix-slider__input::-webkit-slider-thumb {
  cursor: not-allowed;
  border-color: v-bind('getToken("colors.border.default")');
}

.stratix-slider__tooltip {
  position: absolute;
  top: -4px;
  transform: translateX(-50%);
  background: v-bind('getToken("colors.background.elevated")');
  color: v-bind('getToken("colors.text.primary")');
  font-size: var(--ds-font-size-xs);
  font-weight: 600;
  padding: 2px 8px;
  border-radius: var(--ds-radius-sm);
  border: 1px solid v-bind('getToken("colors.border.default")');
  box-shadow: var(--ds-shadow-sm);
  white-space: nowrap;
  pointer-events: none;
  animation: ds-tooltip-fade 150ms ease;
}

@keyframes ds-tooltip-fade {
  from { opacity: 0; transform: translateX(-50%) translateY(4px); }
  to { opacity: 1; transform: translateX(-50%) translateY(0); }
}

@media (prefers-reduced-motion: reduce) {
  .stratix-slider__input::-webkit-slider-thumb {
    transition: none;
  }
  .stratix-slider__tooltip {
    animation: none;
  }
}
</style>
