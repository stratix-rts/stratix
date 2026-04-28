<script setup lang="ts">
import { computed, toRef } from 'vue';
import { getToken } from '@/design-system/config';
import { provideSizeContext } from '@/design-system/composables/useSizeContext';

interface Props {
  modelValue?: boolean;
  disabled?: boolean;
  size?: SizeVariant;
  label?: string;
  labelPosition?: 'left' | 'right';
}

const props = withDefaults(defineProps<Props>(), {
  modelValue: false,
  disabled: false,
  size: 'md',
  label: '',
  labelPosition: 'right',
});

provideSizeContext(toRef(props, 'size'));

const emit = defineEmits<{
  'update:modelValue': [value: boolean];
  change: [value: boolean];
}>();

const sizeConfig = {
  sm: { width: '36px', height: '20px', dot: '16px' },
  md: { width: '44px', height: '24px', dot: '20px' },
  lg: { width: '52px', height: '28px', dot: '24px' },
};

const handleChange = () => {
  if (props.disabled) return;
  const newValue = !props.modelValue;
  emit('update:modelValue', newValue);
  emit('change', newValue);
};
</script>

<template>
  <label 
    class="stratix-switch"
    :class="{
      'stratix-switch--disabled': disabled,
      'stratix-switch--checked': modelValue,
      [`stratix-switch--${size}`]: true,
    }"
  >
    <span v-if="label && labelPosition === 'left'" class="stratix-switch__label stratix-switch__label--left">
      {{ label }}
    </span>
    <input
      type="checkbox"
      :checked="modelValue"
      :disabled="disabled"
      @change="handleChange"
      class="stratix-switch__input"
    />
    <span 
      class="stratix-switch__track"
      :class="[`stratix-switch__track--${size}`]"
    >
      <span 
        class="stratix-switch__thumb"
        :class="[`stratix-switch__thumb--${size}`]"
      ></span>
    </span>
    <span v-if="label && labelPosition === 'right'" class="stratix-switch__label stratix-switch__label--right">
      {{ label }}
    </span>
  </label>
</template>

<style scoped>
.stratix-switch {
  display: inline-flex;
  align-items: center;
  gap: var(--ds-spacing-sm);
  cursor: pointer;
  user-select: none;
}

.stratix-switch--disabled {
  opacity: 0.5;
  cursor: not-allowed;
  filter: grayscale(100%);
}

.stratix-switch__input {
  position: absolute;
  opacity: 0;
  pointer-events: none;
}

.stratix-switch__track {
  position: relative;
  background: v-bind('getToken("colors.background.overlay")');
  border: 1px solid v-bind('getToken("colors.border.default")');
  border-radius: 999px;
  transition: all var(--ds-animation-duration-fast) ease;
  flex-shrink: 0;
}

.stratix-switch__track--sm {
  width: v-bind('sizeConfig.sm.width');
  height: v-bind('sizeConfig.sm.height');
}

.stratix-switch__track--md {
  width: v-bind('sizeConfig.md.width');
  height: v-bind('sizeConfig.md.height');
}

.stratix-switch__track--lg {
  width: v-bind('sizeConfig.lg.width');
  height: v-bind('sizeConfig.lg.height');
}

.stratix-switch:hover:not(.stratix-switch--disabled) .stratix-switch__track {
  border-color: v-bind('getToken("colors.status.info")');
  box-shadow: 0 0 0 2px color-mix(in srgb, v-bind('getToken("colors.status.info")') 15%, transparent);
}

.stratix-switch--checked .stratix-switch__track {
  background: v-bind('getToken("colors.status.info")');
  border-color: v-bind('getToken("colors.status.info")');
}

.stratix-switch__thumb {
  position: absolute;
  top: 50%;
  left: 2px;
  background: v-bind('getToken("colors.background.base")');
  border-radius: var(--ds-radius-full);
  transition: transform var(--ds-animation-duration-normal, 250ms) cubic-bezier(0.34, 1.56, 0.64, 1);
  box-shadow: v-bind('getToken("shadows.sm")');
}

.stratix-switch__thumb--sm {
  width: v-bind('sizeConfig.sm.dot');
  height: v-bind('sizeConfig.sm.dot');
  transform: translateY(-50%);
}

.stratix-switch__thumb--md {
  width: v-bind('sizeConfig.md.dot');
  height: v-bind('sizeConfig.md.dot');
  transform: translateY(-50%);
}

.stratix-switch__thumb--lg {
  width: v-bind('sizeConfig.lg.dot');
  height: v-bind('sizeConfig.lg.dot');
  transform: translateY(-50%);
}

.stratix-switch--checked .stratix-switch__thumb--sm {
  transform: translateY(-50%) translateX(calc(v-bind('sizeConfig.sm.width') - v-bind('sizeConfig.sm.dot') - 4px));
}

.stratix-switch--checked .stratix-switch__thumb--md {
  transform: translateY(-50%) translateX(calc(v-bind('sizeConfig.md.width') - v-bind('sizeConfig.md.dot') - 4px));
}

.stratix-switch--checked .stratix-switch__thumb--lg {
  transform: translateY(-50%) translateX(calc(v-bind('sizeConfig.lg.width') - v-bind('sizeConfig.lg.dot') - 4px));
}

.stratix-switch__label {
  font-size: var(--ds-font-size-md);
  color: v-bind('getToken("colors.text.primary")');
}

.stratix-switch--disabled .stratix-switch__label {
  color: v-bind('getToken("colors.text.muted")');
}

@media (prefers-reduced-motion: reduce) {
  .stratix-switch__track,
  .stratix-switch__thumb {
    transition: none;
  }
}
</style>
