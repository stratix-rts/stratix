<script setup lang="ts">
import { computed, ref, toRef } from 'vue';
import { InputBaseConfig, InputSizes, type InputVariant } from '@/design-system/components/shared/input';
import { provideSizeContext } from '@/design-system/composables/useSizeContext';
import { getToken } from '@/design-system';

interface Props {
  modelValue?: string | number;
  type?: 'text' | 'password' | 'email' | 'number';
  placeholder?: string;
  disabled?: boolean;
  error?: string | boolean;
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
  <span v-if="typeof error === 'string'" class="stratix-input__error-message">
    {{ error }}
  </span>
</template>

<style scoped>
.stratix-input-wrapper {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: v-bind('sizeConfig.padding');
  background: v-bind('getToken("colors.background.tertiary")');
  border: 1px solid v-bind('getToken("colors.border.default")');
  border-radius: v-bind('getToken("radii.md")');
  transition: all 0.15s ease;
}

.stratix-input-wrapper--focused {
  border-color: v-bind('getToken("colors.info")');
  box-shadow: 0 0 0 2px v-bind('getToken("colors.info") + "1A"');
}

.stratix-input-wrapper--error {
  border-color: v-bind('getToken("colors.semantic.danger")');
}

.stratix-input-wrapper--error.stratix-input-wrapper--focused {
  border-color: v-bind('getToken("colors.semantic.danger")');
  box-shadow: 0 0 0 2px v-bind('getToken("colors.semantic.danger") + "1A"');
}

.stratix-input {
  flex: 1;
  width: 100%;
  height: v-bind('sizeConfig.height');
  background: transparent;
  border: none;
  outline: none;
  color: v-bind('getToken("colors.text.primary")');
  font-size: v-bind('sizeConfig.fontSize');
  font-family: v-bind('getToken("typography.fontFamily.sans")');
}

.stratix-input::placeholder {
  color: v-bind('getToken("colors.text.muted")');
}

.stratix-input:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.stratix-input__icon {
  flex-shrink: 0;
  color: v-bind('getToken("colors.text.muted")');
}

.stratix-input__error-message {
  display: block;
  margin-top: 6px;
  font-size: 12px;
  color: v-bind('getToken("colors.semantic.danger")');
}
</style>
