<script setup lang="ts">
import { computed } from 'vue';
import { getToken } from '@/design-system/config';

interface Props {
  for?: string;
  required?: boolean;
  optional?: boolean;
  size?: 'sm' | 'md' | 'lg';
  error?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  required: false,
  optional: false,
  size: 'md',
  error: false,
});

const sizeMap = {
  sm: '11px',
  md: '13px',
  lg: '14px',
};

const labelColor = computed(() => {
  if (props.error) return getToken('colors.semantic.danger');
  if (props.optional) return getToken('colors.text.muted');
  return getToken('colors.text.secondary');
});
</script>

<template>
  <label 
    class="stratix-label"
    :class="{
      'stratix-label--required': required,
      'stratix-label--optional': optional,
      'stratix-label--error': error,
    }"
    :for="for"
  >
    <slot />
    <span v-if="required" class="stratix-label__marker">*</span>
    <span v-else-if="optional" class="stratix-label__optional">(可选)</span>
  </label>
</template>

<style scoped>
.stratix-label {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: v-bind('sizeMap[size]');
  font-weight: 500;
  color: v-bind('labelColor');
  margin-bottom: 4px;
}

.stratix-label__marker {
  color: v-bind('getToken("colors.semantic.danger")');
  font-weight: 600;
}

.stratix-label__optional {
  color: v-bind('getToken("colors.text.muted")');
  font-weight: normal;
  font-size: 0.9em;
}
</style>
