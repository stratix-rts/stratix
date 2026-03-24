<script setup lang="ts">
import { computed } from 'vue';
import { getToken } from '@/design-system/config';

interface Props {
  error?: boolean;
  success?: boolean;
  disabled?: boolean;
  size?: 'sm' | 'md' | 'lg';
}

const props = withDefaults(defineProps<Props>(), {
  error: false,
  success: false,
  disabled: false,
  size: 'md',
});

const gapMap = {
  sm: '4px',
  md: '8px',
  lg: '12px',
};
</script>

<template>
  <div 
    class="stratix-form-field"
    :class="{
      'stratix-form-field--error': error,
      'stratix-form-field--success': success,
      'stratix-form-field--disabled': disabled,
    }"
  >
    <slot name="label" />
    <div class="stratix-form-field__content">
      <slot />
    </div>
    <div v-if="$slots.help" class="stratix-form-field__help">
      <slot name="help" />
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
}

.stratix-form-field__content {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.stratix-form-field__help {
  font-size: 12px;
  color: v-bind('getToken("colors.text.muted")');
  margin-top: 2px;
}

.stratix-form-field__error {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: v-bind('getToken("colors.semantic.danger")');
  margin-top: 2px;
  animation: error-fade-in 150ms ease;
}

.stratix-form-field--success .stratix-form-field__help {
  color: v-bind('getToken("colors.semantic.success")');
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
</style>
