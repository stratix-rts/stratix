<script setup lang="ts">
import { computed, toRef } from 'vue';
import { getIconPath } from '@/design-system/icons/registry';
import { useIconSize } from '@/design-system/composables/useSizeContext';

interface Props {
  name: string;
  size?: number;
  color?: string;
  strokeWidth?: number;
  animated?: 'spin' | 'pulse' | 'bounce' | 'rotate-on-hover' | 'bounce-on-click' | null;
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
  transition: transform var(--ds-animation-duration-fast) ease;
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

.svg-icon--rotate-on-hover:hover {
  animation: ds-icon-rotate var(--ds-animation-duration-normal, 250ms) ease;
}

.svg-icon--bounce-on-click:active {
  animation: ds-icon-bounce-click 200ms ease;
}

@keyframes ds-spin {
  to { transform: rotate(360deg); }
}

@keyframes ds-icon-pulse {
  0%, 100% { transform: scale(1); }
  50% { transform: scale(1.15); }
}

@keyframes ds-icon-bounce {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-3px); }
}

@keyframes ds-icon-rotate {
  from { transform: rotate(0deg); }
  to { transform: rotate(180deg); }
}

@keyframes ds-icon-bounce-click {
  0% { transform: scale(1); }
  50% { transform: scale(0.85); }
  100% { transform: scale(1); }
}

@media (prefers-reduced-motion: reduce) {
  .svg-icon,
  .svg-icon--spin,
  .svg-icon--pulse,
  .svg-icon--bounce,
  .svg-icon--rotate-on-hover:hover,
  .svg-icon--bounce-on-click:active {
    animation: none;
    transition: none;
  }
}
</style>
