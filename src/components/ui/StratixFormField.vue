<script setup lang="ts">
import { computed, ref } from 'vue';
import { getToken } from '@/design-system/config';
import SvgIcon from './SvgIcon.vue';

interface Props {
  label?: string;
  error?: boolean;
  success?: boolean;
  disabled?: boolean;
  size?: 'sm' | 'md' | 'lg';
  helpText?: string;
  floatingLabel?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  error: false,
  success: false,
  disabled: false,
  size: 'md',
  floatingLabel: false,
});

const gapMap = {
  sm: '4px',
  md: '8px',
  lg: '12px',
};

const isFocused = ref(false);
const hasValue = ref(false);

const showFloatingLabel = computed(() => {
  return props.floatingLabel && props.label;
});
</script>

<template>
  <div 
    class="stratix-form-field"
    :class="{
      'stratix-form-field--error': error,
      'stratix-form-field--success': success,
      'stratix-form-field--disabled': disabled,
      'stratix-form-field--floating': showFloatingLabel,
    }"
  >
    <label
      v-if="label && !floatingLabel"
      class="stratix-form-field__label"
    >
      {{ label }}
    </label>
    <div
      v-else-if="showFloatingLabel"
      class="stratix-form-field__floating-label"
      :class="{
        'stratix-form-field__floating-label--active': isFocused || hasValue,
      }"
    >
      {{ label }}
    </div>
    <div class="stratix-form-field__content">
      <slot :focused="isFocused" :set-focused="(v: boolean) => isFocused = v" :set-value="(v: boolean) => hasValue = v" />
    </div>
    <div v-if="helpText && !error" class="stratix-form-field__help">
      <SvgIcon v-if="helpText" name="info" :size="12" />
      {{ helpText }}
    </div>
    <div v-if="$slots.error && error" class="stratix-form-field__error">
      <slot name="error" />
    </div>
  </div>
</template>

<style scoped>
.stratix-form-field {
  display: flex;
  flex-direction: column;
  gap: v-bind('gapMap[size]');
  margin-bottom: v-bind('gapMap[size]');
  position: relative;
}

.stratix-form-field__label {
  font-size: var(--ds-font-size-sm);
  font-weight: 500;
  color: v-bind('getToken("colors.text.secondary")');
  transition: color var(--ds-animation-duration-fast) ease;
}

.stratix-form-field--floating .stratix-form-field__content {
  margin-top: 8px;
}

.stratix-form-field__floating-label {
  position: absolute;
  left: 12px;
  top: 50%;
  transform: translateY(-50%);
  font-size: var(--ds-font-size-md);
  color: v-bind('getToken("colors.text.muted")');
  pointer-events: none;
  transition: all var(--ds-animation-duration-fast) ease;
  background: transparent;
  padding: 0 4px;
  z-index: 1;
}

.stratix-form-field__floating-label--active {
  top: 0;
  font-size: var(--ds-font-size-xs);
  color: v-bind('getToken("colors.status.info")');
  background: v-bind('getToken("colors.background.base")');
}

.stratix-form-field__content {
  display: flex;
  flex-direction: column;
  gap: var(--ds-spacing-xs);
}

.stratix-form-field__help {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: var(--ds-font-size-sm);
  color: v-bind('getToken("colors.text.muted")');
  margin-top: 2px;
}

.stratix-form-field__error {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: var(--ds-font-size-sm);
  color: v-bind('getToken("colors.status.danger")');
  margin-top: 2px;
  animation: error-fade-in 150ms ease;
}

.stratix-form-field--error {
  animation: ds-shake 300ms ease;
}

.stratix-form-field--success .stratix-form-field__help {
  color: v-bind('getToken("colors.status.success")');
}

@keyframes error-fade-in {
  from {
    opacity: 0;
    transform: translateY(-4px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

@keyframes ds-shake {
  0%, 100% { transform: translateX(0); }
  20% { transform: translateX(-4px); }
  40% { transform: translateX(4px); }
  60% { transform: translateX(-2px); }
  80% { transform: translateX(2px); }
}

@media (prefers-reduced-motion: reduce) {
  .stratix-form-field__error,
  .stratix-form-field__floating-label,
  .stratix-form-field__label {
    transition: none;
    animation: none;
  }
  .stratix-form-field--error {
    animation: none;
  }
}
</style>
