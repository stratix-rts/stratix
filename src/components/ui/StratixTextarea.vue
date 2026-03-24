<script setup lang="ts">
import { computed, ref } from 'vue';
import { getToken } from '@/design-system/config';

interface Props {
  modelValue?: string;
  placeholder?: string;
  disabled?: boolean;
  error?: boolean;
  size?: 'sm' | 'md' | 'lg';
  rows?: number;
  resize?: 'none' | 'vertical' | 'horizontal' | 'both';
}

const props = withDefaults(defineProps<Props>(), {
  modelValue: '',
  placeholder: '',
  disabled: false,
  error: false,
  size: 'md',
  rows: 3,
  resize: 'vertical',
});

const emit = defineEmits<{
  'update:modelValue': [value: string];
  focus: [];
  blur: [];
}>();

const isFocused = ref(false);

const sizeConfig = {
  sm: { padding: '4px 8px', fontSize: '12px' },
  md: { padding: '8px 12px', fontSize: '14px' },
  lg: { padding: '12px 16px', fontSize: '16px' },
};

const handleInput = (event: Event) => {
  const target = event.target as HTMLTextAreaElement;
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

const resizeMap = {
  none: 'none',
  vertical: 'vertical',
  horizontal: 'horizontal',
  both: 'both',
};
</script>

<template>
  <textarea
    class="stratix-textarea"
    :class="{
      'stratix-textarea--focused': isFocused,
      'stratix-textarea--error': error,
      'stratix-textarea--disabled': disabled,
    }"
    :value="modelValue"
    :placeholder="placeholder"
    :disabled="disabled"
    :rows="rows"
    :style="{ resize: resizeMap[resize] }"
    @input="handleInput"
    @focus="handleFocus"
    @blur="handleBlur"
  />
</template>

<style scoped>
.stratix-textarea {
  width: 100%;
  padding: v-bind('sizeConfig[size].padding');
  background: v-bind('getToken("colors.background.tertiary")');
  border: 1px solid v-bind('getToken("colors.border.default")');
  border-radius: v-bind('getToken("radii.md")');
  color: v-bind('getToken("colors.text.primary")');
  font-size: v-bind('sizeConfig[size].fontSize');
  font-family: v-bind('getToken("typography.fontFamily.sans")');
  transition: all 0.15s ease;
  resize: v-bind('resizeMap[resize]');
}

.stratix-textarea::placeholder {
  color: v-bind('getToken("colors.text.muted")');
}

.stratix-textarea:focus {
  outline: none;
  border-color: v-bind('getToken("colors.info")');
  box-shadow: 0 0 0 2px v-bind('getToken("colors.info") + "1A"');
}

.stratix-textarea--error {
  border-color: v-bind('getToken("colors.semantic.danger")');
}

.stratix-textarea--error:focus {
  border-color: v-bind('getToken("colors.semantic.danger")');
  box-shadow: 0 0 0 2px v-bind('getToken("colors.semantic.danger") + "1A"');
}

.stratix-textarea--disabled {
  opacity: 0.5;
  cursor: not-allowed;
  background: v-bind('getToken("colors.background.secondary")');
}
</style>
