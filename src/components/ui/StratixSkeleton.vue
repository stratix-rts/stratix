<script setup lang="ts">
import { computed } from 'vue';

type SkeletonType = 'text' | 'circle' | 'rect' | 'card';

interface Props {
  type?: SkeletonType;
  width?: string;
  height?: string;
  borderRadius?: string;
  animated?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  type: 'text',
  animated: true,
});

const computedStyle = computed(() => {
  const style: Record<string, string> = {};
  if (props.width) style.width = props.width;
  if (props.height) style.height = props.height;
  if (props.borderRadius) style.borderRadius = props.borderRadius;
  return style;
});
</script>

<template>
  <div
    class="stratix-skeleton"
    :class="[
      `stratix-skeleton--${type}`,
      { 'stratix-skeleton--animated': animated },
    ]"
    :style="computedStyle"
    aria-hidden="true"
  />
</template>

<style scoped>
.stratix-skeleton {
  background: var(--ds-skeleton-base);
  position: relative;
  overflow: hidden;
  flex-shrink: 0;
}

.stratix-skeleton--animated::after {
  content: '';
  position: absolute;
  inset: 0;
  background: linear-gradient(
    90deg,
    transparent 0%,
    var(--ds-skeleton-highlight) 50%,
    transparent 100%
  );
  background-size: 200% 100%;
  animation: ds-shimmer 1.5s infinite;
}

.stratix-skeleton--text {
  height: 16px;
  width: 100%;
  border-radius: var(--ds-skeleton-radius, var(--ds-radius-sm));
}

.stratix-skeleton--circle {
  width: 40px;
  height: 40px;
  border-radius: 50%;
}

.stratix-skeleton--rect {
  height: 80px;
  width: 100%;
  border-radius: var(--ds-radius-md);
}

.stratix-skeleton--card {
  height: 120px;
  width: 100%;
  border-radius: var(--ds-radius-lg);
}

@media (prefers-reduced-motion: reduce) {
  .stratix-skeleton--animated::after {
    animation: none;
  }
}
</style>
