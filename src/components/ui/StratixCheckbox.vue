<script setup lang="ts">
import { SvgIcon } from '@/components/ui';
import { computed, toRef } from 'vue';
import { getToken } from '@/design-system/config';
import { provideSizeContext } from '@/design-system/composables/useSizeContext';

interface Props {
  modelValue?: boolean;
  disabled?: boolean;
  size?: 'sm' | 'md';
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
</script>

<template>
  <label 
    class="stratix-checkbox"
    :class="{
      'stratix-checkbox--disabled': disabled,
      'stratix-checkbox--checked': modelValue,
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
      <SvgIcon v-if="modelValue" class="stratix-checkbox__icon" name="check" />
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
  gap: 8px;
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
  background: v-bind('getToken("colors.background.tertiary")');
  border: 1px solid v-bind('getToken("colors.border.default")');
  border-radius: v-bind('getToken("radii.sm")');
  transition: all 0.15s ease;
  flex-shrink: 0;
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
  border-color: v-bind('getToken("colors.info")');
}

.stratix-checkbox--checked .stratix-checkbox__box {
  background: v-bind('getToken("colors.info")');
  border-color: v-bind('getToken("colors.info")');
}

.stratix-checkbox__icon {
  width: 70%;
  height: 70%;
  color: v-bind('getToken("colors.background.primary")');
}

.stratix-checkbox__label {
  font-size: 14px;
  color: v-bind('getToken("colors.text.primary")');
}

.stratix-checkbox--disabled .stratix-checkbox__label {
  color: v-bind('getToken("colors.text.muted")');
}
</style>
