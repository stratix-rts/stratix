<script setup lang="ts">
import { computed, ref, toRef } from 'vue';
import { InputBaseConfig, InputSizes, type InputVariant } from '@/design-system/components/shared/input';
import { provideSizeContext } from '@/design-system/composables/useSizeContext';
import { getToken } from '@/design-system';
import SvgIcon from './SvgIcon.vue';

interface Props {
  modelValue?: string | number;
  type?: 'text' | 'password' | 'email' | 'number';
  placeholder?: string;
  disabled?: boolean;
  error?: string | boolean;
  size?: SizeVariant;
  variant?: InputVariant;
  icon?: string;
  prefix?: string;
  suffix?: string;
  clearable?: boolean;
  maxLength?: number;
}

const props = withDefaults(defineProps<Props>(), {
  modelValue: '',
  type: 'text',
  placeholder: '',
  disabled: false,
  error: false,
  size: 'md',
  variant: 'default',
  clearable: false,
});

provideSizeContext(toRef(props, 'size'));

const emit = defineEmits<{
  'update:modelValue': [value: string];
  focus: [];
  blur: [];
  clear: [];
}>();

const isFocused = ref(false);
const isHovered = ref(false);

const sizeConfig = computed(() => InputSizes[props.size]);

const hasValue = computed(() => {
  return props.modelValue !== undefined && props.modelValue !== null && String(props.modelValue).length > 0;
});

const showClear = computed(() => {
  return props.clearable && hasValue.value && (isFocused.value || isHovered.value);
});

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

const handleClear = () => {
  emit('update:modelValue', '');
  emit('clear');
};

const isError = computed(() => {
  return typeof props.error === 'string' ? true : props.error;
});

const errorMessage = computed(() => {
  return typeof props.error === 'string' ? props.error : '';
});
</script>

<template>
  <div
    class="stratix-input-wrapper"
    :class="{
      'stratix-input-wrapper--focused': isFocused,
      'stratix-input-wrapper--error': isError,
      'stratix-input-wrapper--disabled': disabled,
    }"
    @mouseenter="isHovered = true"
    @mouseleave="isHovered = false"
  >
    <span v-if="prefix" class="stratix-input__prefix">{{ prefix }}</span>
    <SvgIcon
      v-else-if="icon"
      :name="icon"
      :size="14"
      class="stratix-input__icon"
    />
    <input
      class="stratix-input"
      :type="type"
      :value="modelValue"
      :placeholder="placeholder"
      :disabled="disabled"
      :maxlength="maxLength"
      @input="handleInput"
      @focus="handleFocus"
      @blur="handleBlur"
    />
    <button
      v-if="showClear"
      type="button"
      class="stratix-input__clear"
      @click.stop="handleClear"
      aria-label="清除"
    >
      <SvgIcon name="x" :size="14" />
    </button>
    <span v-if="suffix" class="stratix-input__suffix">{{ suffix }}</span>
  </div>
  <span v-if="errorMessage" class="stratix-input__error-message">
    {{ errorMessage }}
  </span>
</template>

<style scoped>
.stratix-input-wrapper {
  display: flex;
  align-items: center;
  gap: var(--ds-spacing-sm);
  padding: v-bind('sizeConfig.padding');
  background: v-bind('getToken("colors.background.overlay")');
  border: 1px solid v-bind('getToken("colors.border.default")');
  border-radius: v-bind('getToken("radii.md")');
  transition: all var(--ds-animation-duration-fast) ease;
}

.stratix-input-wrapper--focused {
  border-color: v-bind('getToken("colors.status.info")');
  box-shadow: 0 0 0 3px color-mix(in srgb, v-bind('getToken("colors.status.info")') 20%, transparent);
}

.stratix-input-wrapper--error {
  border-color: v-bind('getToken("colors.status.danger")');
  animation: ds-shake 300ms ease;
}

.stratix-input-wrapper--error.stratix-input-wrapper--focused {
  border-color: v-bind('getToken("colors.status.danger")');
  box-shadow: 0 0 0 3px color-mix(in srgb, v-bind('getToken("colors.status.danger")') 20%, transparent);
}

.stratix-input-wrapper--disabled {
  opacity: 0.5;
  cursor: not-allowed;
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
  cursor: not-allowed;
}

.stratix-input__icon {
  flex-shrink: 0;
  color: v-bind('getToken("colors.text.muted")');
  transition: transform var(--ds-animation-duration-fast) ease, color var(--ds-animation-duration-fast) ease;
}

.stratix-input-wrapper:hover:not(.stratix-input-wrapper--disabled) .stratix-input__icon {
  transform: scale(1.15);
  color: v-bind('getToken("colors.text.secondary")');
}

.stratix-input__prefix,
.stratix-input__suffix {
  flex-shrink: 0;
  font-size: v-bind('sizeConfig.fontSize');
  color: v-bind('getToken("colors.text.muted")');
  user-select: none;
}

.stratix-input__clear {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  padding: 0;
  background: v-bind('getToken("colors.background.elevated")');
  border: none;
  border-radius: var(--ds-radius-full);
  color: v-bind('getToken("colors.text.muted")');
  cursor: pointer;
  transition: all var(--ds-animation-duration-fast) ease;
  flex-shrink: 0;
}

.stratix-input__clear:hover {
  background: v-bind('getToken("colors.status.danger")');
  color: v-bind('getToken("colors.background.base")');
  transform: scale(1.1);
}

.stratix-input__error-message {
  display: block;
  margin-top: 6px;
  font-size: var(--ds-font-size-sm);
  color: v-bind('getToken("colors.status.danger")');
}

@keyframes ds-shake {
  0%, 100% { transform: translateX(0); }
  20% { transform: translateX(-4px); }
  40% { transform: translateX(4px); }
  60% { transform: translateX(-2px); }
  80% { transform: translateX(2px); }
}

@media (prefers-reduced-motion: reduce) {
  .stratix-input-wrapper {
    transition: none;
  }
  .stratix-input-wrapper--error {
    animation: none;
  }
}
</style>
