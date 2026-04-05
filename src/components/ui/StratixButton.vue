<script setup lang="ts">
import { computed, toRef } from 'vue';
import { getButtonToken, type ButtonVariant, ButtonSizes } from '@/design-system/components/shared/button';
import { provideSizeContext, type SizeVariant } from '@/design-system/composables/useSizeContext';
import SvgIcon from './SvgIcon.vue';

interface Props {
  variant?: ButtonVariant;
  size?: SizeVariant;
  disabled?: boolean;
  loading?: boolean;
  icon?: string;
}

const props = withDefaults(defineProps<Props>(), {
  variant: 'primary',
  size: 'md',
  disabled: false,
  loading: false,
});

const emit = defineEmits<{
  click: [event: MouseEvent];
}>();

provideSizeContext(toRef(props, 'size'));

const token = computed(() => getButtonToken(props.variant));
const sizeConfig = computed(() => ButtonSizes[props.size] || ButtonSizes.md);

// 按钮样式计算属性（处理默认值）
const buttonStyle = computed(() => ({
  background: token.value.style.background || 'transparent',
  border: token.value.style.border || 'none',
  text: token.value.style.text || '#ffffff',
}));
const iconSize = computed(() => {
  const sizes: Record<string, number> = { sm: 14, md: 16, lg: 18 };
  return sizes[props.size] || 16;
});

const handleClick = (event: MouseEvent) => {
  if (!props.disabled && !props.loading) {
    emit('click', event);
  }
};
</script>

<template>
  <button
    class="stratix-btn"
    :class="[
      `stratix-btn--${variant}`,
      `stratix-btn--${size}`,
      { 'stratix-btn--disabled': disabled || loading },
    ]"
    :disabled="disabled || loading"
    @click="handleClick"
  >
    <span v-if="loading" class="stratix-btn__loader"></span>
    <SvgIcon v-if="icon && !loading" :name="icon" :size="iconSize" class="stratix-btn__icon" />
    <span class="stratix-btn__text">
      <slot />
    </span>
  </button>
</template>

<style scoped>
.stratix-btn {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: v-bind('sizeConfig.padding');
  font-size: v-bind('sizeConfig.fontSize');
  font-family: 'SF Mono', 'Monaco', monospace;
  font-weight: 500;
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.15s ease;
  border: v-bind('buttonStyle.border');
  background: v-bind('buttonStyle.background');
  color: v-bind('buttonStyle.text');
}

.stratix-btn:hover:not(.stratix-btn--disabled) {
  filter: brightness(1.1);
  transform: translateY(-1px);
}

.stratix-btn:active:not(.stratix-btn--disabled) {
  transform: translateY(0) scale(0.98);
}

.stratix-btn:focus-visible {
  outline: 2px solid var(--ds-focus-ring, #3b82f6);
  outline-offset: 2px;
}

.stratix-btn--disabled {
  opacity: 0.5;
  cursor: not-allowed;
  transform: none;
}

.stratix-btn__loader {
  width: 14px;
  height: 14px;
  border: 2px solid currentColor;
  border-top-color: transparent;
  border-radius: 50%;
  animation: spin 0.6s linear infinite;
  flex-shrink: 0;
}

.stratix-btn__icon {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  overflow: visible;
}

.stratix-btn__text {
  line-height: 1;
  display: inline-flex;
  align-items: center;
}

.stratix-btn__text {
  line-height: 1;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
