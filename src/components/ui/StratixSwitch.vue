<script setup lang="ts">
import { computed, toRef } from 'vue';
import { getToken } from '@/design-system/config';
import { provideSizeContext } from '@/design-system/composables/useSizeContext';

interface Props {
  modelValue?: boolean;
  disabled?: boolean;
  size?: SizeVariant;
  label?: string;
}

const props = withDefaults(defineProps<Props>(), {
  modelValue: false,
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
    }"
  >
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
    <span v-if="label" class="stratix-switch__label">
      {{ label }}
    </span>
  </label>
</template>

<style scoped>
.stratix-switch {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  user-select: none;
}

.stratix-switch--disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.stratix-switch__input {
  position: absolute;
  opacity: 0;
  pointer-events: none;
}

.stratix-switch__track {
  position: relative;
  background: v-bind('getToken("colors.background.tertiary")');
  border: 1px solid v-bind('getToken("colors.border.default")');
  border-radius: 999px;
  transition: all 0.2s ease;
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
  border-color: v-bind('getToken("colors.info")');
}

.stratix-switch--checked .stratix-switch__track {
  background: v-bind('getToken("colors.info")');
  border-color: v-bind('getToken("colors.info")');
}

.stratix-switch__thumb {
  position: absolute;
  top: 50%;
  left: 2px;
  background: v-bind('getToken("colors.background.primary")');
  border-radius: 50%;
  transition: transform 0.2s ease;
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
  font-size: 14px;
  color: v-bind('getToken("colors.text.primary")');
}

.stratix-switch--disabled .stratix-switch__label {
  color: v-bind('getToken("colors.text.muted")');
}
</style>
