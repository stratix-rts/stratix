<script setup lang="ts">
import { computed, ref, toRef } from 'vue';
import { InputBaseConfig, InputSizes, type InputVariant } from '@/design-system/components/shared/input';
import { provideSizeContext } from '@/design-system/composables/useSizeContext';

interface Props {
  modelValue?: string | number;
  type?: 'text' | 'password' | 'email' | 'number';
  placeholder?: string;
  disabled?: boolean;
  error?: boolean;
  size?: SizeVariant;
  variant?: InputVariant;
  icon?: string;
}

const props = withDefaults(defineProps<Props>(), {
  modelValue: '',
  type: 'text',
  placeholder: '',
  disabled: false,
  error: false,
  size: 'md',
  variant: 'default',
});

provideSizeContext(toRef(props, 'size'));

const emit = defineEmits<{
  'update:modelValue': [value: string];
  focus: [];
  blur: [];
}>();

const isFocused = ref(false);

const sizeConfig = computed(() => InputSizes[props.size]);

const handleInput = (event: Event) => {
  const target = event.target as HTMLInputElement;
  emit('update:modelValue', target.value);
};

const handleFocus = () => {
  isFocused.value = true;
  emit('focus');
};

const handleBlur = () => {
  isFocused.value = false;
  emit('blur');
};
</script>

<template>
  <div class="stratix-input-wrapper" :class="{ 'stratix-input-wrapper--focused': isFocused, 'stratix-input-wrapper--error': error }">
    <svg v-if="icon" class="stratix-input__icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
      <path :d="icon" />
    </svg>
    <input
      class="stratix-input"
      :type="type"
      :value="modelValue"
      :placeholder="placeholder"
      :disabled="disabled"
      @input="handleInput"
      @focus="handleFocus"
      @blur="handleBlur"
    />
  </div>
</template>

<style scoped>
.stratix-input-wrapper {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: v-bind('sizeConfig.padding');
  background: var(--ds-bg-secondary);
  border: 1px solid var(--ds-border);
  border-radius: 4px;
  transition: all 0.15s ease;
}

.stratix-input-wrapper--focused {
  border-color: var(--ds-brand-primary);
  box-shadow: 0 0 0 2px var(--ds-shadow-sm);
}

.stratix-input-wrapper--error {
  border-color: var(--ds-status-danger);
}

.stratix-input {
  flex: 1;
  width: 100%;
  height: v-bind('sizeConfig.height');
  background: transparent;
  border: none;
  outline: none;
  color: #ffffff;
  font-size: v-bind('sizeConfig.fontSize');
  font-family: 'SF Mono', 'Monaco', monospace;
}

.stratix-input::placeholder {
  color: #6a6a8a;
}

.stratix-input:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.stratix-input__icon {
  flex-shrink: 0;
  color: #6a6a8a;
}
</style>
