<script setup lang="ts">
import { computed, toRef } from 'vue';
import { getIconPath } from '@/design-system/icons/registry';
import { useIconSize } from '@/design-system/composables/useSizeContext';

interface Props {
  name: string;
  size?: number;
  color?: string;
  strokeWidth?: number;
  animated?: 'spin' | 'pulse' | 'bounce' | null;
}

const props = withDefaults(defineProps<Props>(), {
  color: 'currentColor',
  strokeWidth: 2,
  animated: null,
});

const resolvedSize = useIconSize(toRef(props, 'size'));
const iconPath = computed(() => getIconPath(props.name) || '');

const animationClass = computed(() => {
  if (!props.animated) return '';
  return `svg-icon--${props.animated}`;
});
</script>

<template>
  <svg
    class="svg-icon"
    :class="animationClass"
    viewBox="0 0 24 24"
    :width="resolvedSize"
    :height="resolvedSize"
    fill="none"
    :stroke="color"
    :stroke-width="strokeWidth"
    stroke-linecap="round"
    stroke-linejoin="round"
    v-html="iconPath"
  />
</template>

<style scoped>
.svg-icon {
  display: inline-flex;
  vertical-align: middle;
  flex-shrink: 0;
  overflow: visible;
}

.svg-icon--spin {
  animation: ds-spin var(--ds-animation-duration-slow, 400ms) linear infinite;
}

.svg-icon--pulse {
  animation: ds-icon-pulse var(--ds-animation-duration-fast, 150ms) ease infinite;
}

.svg-icon--bounce {
  animation: ds-icon-bounce var(--ds-animation-duration-fast, 150ms) ease infinite;
}
</style>
