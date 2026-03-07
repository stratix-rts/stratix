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
  gap: 8px;
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
  background: v-bind('getToken("colors.background.tertiary")');
  border: 1px solid v-bind('getToken("colors.border.default")');
  border-radius: 50%;
  transition: all 0.15s ease;
  flex-shrink: 0;
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
  border-color: v-bind('getToken("colors.info")');
}

.stratix-radio--checked .stratix-radio__circle {
  border-color: v-bind('getToken("colors.info")');
  border-width: 5px;
}

.stratix-radio__dot {
  width: 40%;
  height: 40%;
  background: v-bind('getToken("colors.info")');
  border-radius: 50%;
}

.stratix-radio__label {
  font-size: 14px;
  color: v-bind('getToken("colors.text.primary")');
}

.stratix-radio--disabled .stratix-radio__label {
  color: v-bind('getToken("colors.text.muted")');
}
</style>
