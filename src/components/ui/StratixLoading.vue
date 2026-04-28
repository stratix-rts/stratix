<script setup lang="ts">
/**
 * StratixLoading - Unified loading states component
 * Supports 3 modes: spinner, skeleton, fullscreen
 */
import { computed } from 'vue';

export type LoadingMode = 'spinner' | 'skeleton' | 'fullscreen';

interface Props {
  mode?: LoadingMode;
  size?: 'sm' | 'md' | 'lg';
  text?: string;
  skeletonLines?: number;
  fullscreen?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  mode: 'spinner',
  size: 'md',
  text: '',
  skeletonLines: 3,
  fullscreen: false,
});

const spinnerSize = computed(() => {
  const sizes = { sm: 14, md: 20, lg: 32 };
  return sizes[props.size];
});

const skeletonLineHeight = computed(() => {
  const heights = { sm: 12, md: 16, lg: 20 };
  return heights[props.size];
});
</script>

<template>
  <!-- Fullscreen mode: overlay covering entire viewport -->
  <Teleport to="body">
    <div v-if="mode === 'fullscreen' || fullscreen" class="stratix-loading-fullscreen">
      <div class="stratix-loading-fullscreen__content">
        <div
          class="stratix-loading-spinner"
          :style="{ width: `${spinnerSize * 1.5}px`, height: `${spinnerSize * 1.5}px` }"
        ></div>
        <span v-if="text" class="stratix-loading-fullscreen__text">{{ text }}</span>
      </div>
    </div>
  </Teleport>

  <!-- Spinner mode: inline loading indicator -->
  <div v-if="mode === 'spinner' && !fullscreen" class="stratix-loading-spinner-container">
    <div
      class="stratix-loading-spinner"
      :style="{ width: `${spinnerSize}px`, height: `${spinnerSize}px` }"
    ></div>
    <span v-if="text" class="stratix-loading-spinner__text">{{ text }}</span>
  </div>

  <!-- Skeleton mode: content placeholder -->
  <div v-if="mode === 'skeleton' && !fullscreen" class="stratix-loading-skeleton">
    <div
      v-for="i in skeletonLines"
      :key="i"
      class="stratix-loading-skeleton__line"
      :style="{ height: `${skeletonLineHeight}px` }"
    ></div>
  </div>
</template>

<style scoped>
/* ============ Spinner ============ */
.stratix-loading-spinner-container {
  display: inline-flex;
  align-items: center;
  gap: var(--ds-spacing-sm);
}

.stratix-loading-spinner {
  border: 2px solid currentColor;
  border-top-color: transparent;
  border-radius: var(--ds-radius-full);
  animation: ds-spin var(--ds-animation-duration-slow, 400ms) linear infinite;
  flex-shrink: 0;
}

.stratix-loading-spinner__text {
  font-size: var(--ds-font-size-md);
  color: var(--text-secondary, #a0a0b0);
}

/* ============ Fullscreen ============ */
.stratix-loading-fullscreen {
  position: fixed;
  inset: 0;
  z-index: 9999;
  display: flex;
  align-items: center;
  justify-content: center;
  background: color-mix(in srgb, var(--ds-bg-base) 85%, transparent);
  backdrop-filter: blur(4px);
}

.stratix-loading-fullscreen__content {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--ds-spacing-md);
}

.stratix-loading-fullscreen__text {
  font-size: var(--ds-font-size-md);
  color: var(--text-secondary, #a0a0b0);
}

/* ============ Skeleton ============ */
.stratix-loading-skeleton {
  display: flex;
  flex-direction: column;
  gap: var(--ds-spacing-sm);
}

.stratix-loading-skeleton__line {
  background: linear-gradient(
    90deg,
    var(--bg-elevated, #12121a) 0%,
    var(--bg-overlay, #1a1a2e) 50%,
    var(--bg-elevated, #12121a) 100%
  );
  background-size: 200% 100%;
  border-radius: var(--ds-radius-sm);
  animation: stratix-skeleton-pulse 1.5s ease-in-out infinite;
}

.stratix-loading-skeleton__line:first-child {
  width: 100%;
}

.stratix-loading-skeleton__line:nth-child(2) {
  width: 85%;
}

.stratix-loading-skeleton__line:nth-child(3) {
  width: 70%;
}

/* ============ Animations ============ */


@keyframes stratix-skeleton-pulse {
  0% {
    background-position: 200% 0;
  }
  100% {
    background-position: -200% 0;
  }
}
</style>
