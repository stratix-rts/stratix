<script setup lang="ts">
import { computed, ref, watch, nextTick } from 'vue';
import { getToken } from '@/design-system/config';

interface Props {
  modelValue?: string;
  placeholder?: string;
  disabled?: boolean;
  error?: boolean;
  size?: 'sm' | 'md' | 'lg';
  rows?: number;
  resize?: 'none' | 'vertical' | 'horizontal' | 'both';
  autoResize?: boolean;
  maxLength?: number;
  showCount?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  modelValue: '',
  placeholder: '',
  disabled: false,
  error: false,
  size: 'md',
  rows: 3,
  resize: 'vertical',
  autoResize: false,
  showCount: false,
});

const emit = defineEmits<{
  'update:modelValue': [value: string];
  focus: [];
  blur: [];
}>();

const isFocused = ref(false);
const textareaRef = ref<HTMLTextAreaElement | null>(null);

const sizeConfig = {
  sm: { padding: '4px 8px', fontSize: '12px' },
  md: { padding: '8px 12px', fontSize: '14px' },
  lg: { padding: '12px 16px', fontSize: '16px' },
};

const handleInput = (event: Event) => {
  const target = event.target as HTMLTextAreaElement;
  emit('update:modelValue', target.value);
  if (props.autoResize) {
    nextTick(autoResize);
  }
};

const handleFocus = () => {
  isFocused.value = true;
  emit('focus');
};

const handleBlur = () => {
  isFocused.value = false;
  emit('blur');
};

const autoResize = () => {
  const el = textareaRef.value;
  if (!el) return;
  el.style.height = 'auto';
  el.style.height = `${el.scrollHeight}px`;
};

watch(() => props.modelValue, () => {
  if (props.autoResize) {
    nextTick(autoResize);
  }
});

const resizeMap = {
  none: 'none',
  vertical: 'vertical',
  horizontal: 'horizontal',
  both: 'both',
};

const charCount = computed(() => props.modelValue?.length || 0);
</script>

<template>
  <div class="stratix-textarea-wrapper">
    <textarea
      ref="textareaRef"
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
      :maxlength="maxLength"
      :style="{ resize: resizeMap[resize] }"
      @input="handleInput"
      @focus="handleFocus"
      @blur="handleBlur"
    />
    <div v-if="showCount || maxLength" class="stratix-textarea__count">
      <span :class="{ 'stratix-textarea__count--overflow': maxLength && charCount > maxLength }">
        {{ charCount }}
      </span>
      <span v-if="maxLength"> / {{ maxLength }}</span>
    </div>
  </div>
</template>

<style scoped>
.stratix-textarea-wrapper {
  position: relative;
}

.stratix-textarea {
  width: 100%;
  padding: v-bind('sizeConfig[size].padding');
  background: v-bind('getToken("colors.background.overlay")');
  border: 1px solid v-bind('getToken("colors.border.default")');
  border-radius: v-bind('getToken("radii.md")');
  color: v-bind('getToken("colors.text.primary")');
  font-size: v-bind('sizeConfig[size].fontSize');
  font-family: v-bind('getToken("typography.fontFamily.sans")');
  transition: all var(--ds-animation-duration-fast) ease;
  resize: v-bind('resizeMap[resize]');
  min-height: v-bind('`${rows * 1.5}em`');
}

.stratix-textarea::placeholder {
  color: v-bind('getToken("colors.text.muted")');
}

.stratix-textarea:focus {
  outline: none;
  border-color: v-bind('getToken("colors.status.info")');
  box-shadow: 0 0 0 3px color-mix(in srgb, v-bind('getToken("colors.status.info")') 20%, transparent);
}

.stratix-textarea--error {
  border-color: v-bind('getToken("colors.status.danger")');
}

.stratix-textarea--error:focus {
  border-color: v-bind('getToken("colors.status.danger")');
  box-shadow: 0 0 0 3px color-mix(in srgb, v-bind('getToken("colors.status.danger")') 20%, transparent);
}

.stratix-textarea--disabled {
  opacity: 0.5;
  cursor: not-allowed;
  background: v-bind('getToken("colors.background.elevated")');
}

.stratix-textarea__count {
  position: absolute;
  bottom: 6px;
  right: 10px;
  font-size: var(--ds-font-size-xs);
  color: v-bind('getToken("colors.text.muted")');
  pointer-events: none;
  user-select: none;
  background: v-bind('getToken("colors.background.overlay")');
  padding: 0 4px;
  border-radius: var(--ds-radius-xs);
}

.stratix-textarea__count--overflow {
  color: v-bind('getToken("colors.status.danger")');
  font-weight: 600;
}

@media (prefers-reduced-motion: reduce) {
  .stratix-textarea {
    transition: none;
  }
}
</style>
