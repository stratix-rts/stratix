<script setup lang="ts">
import { computed, toRef } from 'vue';
import { getToken } from '@/design-system/config';
import { provideSizeContext } from '@/design-system/composables/useSizeContext';

interface Props {
  modelValue?: string | number;
  value: string | number;
  disabled?: boolean;
  size?: 'sm' | 'md';
  label?: string;
  name?: string;
}

const props = withDefaults(defineProps<Props>(), {
  modelValue: '',
  disabled: false,
  size: 'md',
  label: '',
});

provideSizeContext(toRef(props, 'size'));

const emit = defineEmits<{
  'update:modelValue': [value: string | number];
  change: [value: string | number];
}>();

const sizeConfig = {
  sm: { width: '16px', height: '16px' },
  md: { width: '18px', height: '18px' },
};

const isChecked = computed(() => props.modelValue === props.value);

const handleChange = (event: Event) => {
  if (props.disabled) return;
  const target = event.target as HTMLInputElement;
  if (target.checked) {
    emit('update:modelValue', props.value);
    emit('change', props.value);
  }
};
</script>

<template>
  <label 
    class="stratix-radio"
    :class="{
      'stratix-radio--disabled': disabled,
      'stratix-radio--checked': isChecked,
    }"
  >
    <input
      type="radio"
      :name="name"
      :value="value"
      :checked="isChecked"
      :disabled="disabled"
      @change="handleChange"
      class="stratix-radio__input"
    />
    <span 
      class="stratix-radio__circle"
      :class="[`stratix-radio__circle--${size}`]"
    >
      <span v-if="isChecked" class="stratix-radio__dot"></span>
      <span v-if="isChecked" class="stratix-radio__ripple"></span>
    </span>
    <span v-if="label" class="stratix-radio__label">
      {{ label }}
    </span>
  </label>
</template>

<style scoped>
.stratix-radio {
  display: inline-flex;
  align-items: center;
  gap: var(--ds-spacing-sm);
  cursor: pointer;
  user-select: none;
}

.stratix-radio--disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.stratix-radio__input {
  position: absolute;
  opacity: 0;
  pointer-events: none;
}

.stratix-radio__circle {
  display: flex;
  align-items: center;
  justify-content: center;
  background: v-bind('getToken("colors.background.overlay")');
  border: 1px solid v-bind('getToken("colors.border.default")');
  border-radius: var(--ds-radius-full);
  transition: all var(--ds-animation-duration-fast) ease;
  flex-shrink: 0;
  position: relative;
}

.stratix-radio__circle--sm {
  width: v-bind('sizeConfig.sm.width');
  height: v-bind('sizeConfig.sm.height');
}

.stratix-radio__circle--md {
  width: v-bind('sizeConfig.md.width');
  height: v-bind('sizeConfig.md.height');
}

.stratix-radio:hover:not(.stratix-radio--disabled) .stratix-radio__circle {
  border-color: v-bind('getToken("colors.status.info")');
  box-shadow: 0 0 0 2px color-mix(in srgb, v-bind('getToken("colors.status.info")') 15%, transparent);
}

.stratix-radio--checked .stratix-radio__circle {
  border-color: v-bind('getToken("colors.status.info")');
  border-width: 5px;
}

.stratix-radio__dot {
  width: 40%;
  height: 40%;
  background: v-bind('getToken("colors.status.info")');
  border-radius: var(--ds-radius-full);
  animation: ds-radio-dot-scale var(--ds-animation-duration-fast) var(--ds-animation-easing-ease-out, ease-out);
}

.stratix-radio__ripple {
  position: absolute;
  inset: -4px;
  border-radius: var(--ds-radius-full);
  border: 1px solid v-bind('getToken("colors.status.info")');
  opacity: 0;
  animation: ds-radio-ripple 400ms ease-out forwards;
  pointer-events: none;
}

.stratix-radio__label {
  font-size: var(--ds-font-size-md);
  color: v-bind('getToken("colors.text.primary")');
}

.stratix-radio--disabled .stratix-radio__label {
  color: v-bind('getToken("colors.text.muted")');
}

@keyframes ds-radio-dot-scale {
  0% { transform: scale(0); }
  50% { transform: scale(1.2); }
  100% { transform: scale(1); }
}

@keyframes ds-radio-ripple {
  0% {
    transform: scale(0.8);
    opacity: 0.4;
  }
  100% {
    transform: scale(1.6);
    opacity: 0;
  }
}

@media (prefers-reduced-motion: reduce) {
  .stratix-radio__circle,
  .stratix-radio__dot,
  .stratix-radio__ripple {
    transition: none;
    animation: none;
  }
  .stratix-radio__ripple {
    display: none;
  }
}
</style>
