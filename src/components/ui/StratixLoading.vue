<script setup lang="ts">
/**
 * StratixLoading - Unified loading states component
 * Supports 4 modes: spinner, dots, pulse, ring, skeleton, fullscreen
 */
import { computed } from 'vue';

export type SpinnerType = 'ring' | 'dots' | 'pulse';
export type LoadingMode = 'spinner' | 'skeleton' | 'fullscreen';

interface Props {
  mode?: LoadingMode;
  spinner?: SpinnerType;
  size?: 'sm' | 'md' | 'lg';
  text?: string;
  skeletonLines?: number;
  fullscreen?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  mode: 'spinner',
  spinner: 'ring',
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
          v-if="spinner === 'ring'"
          class="stratix-loading-spinner stratix-loading-spinner--lg"
          :style="{ width: `${spinnerSize * 1.5}px`, height: `${spinnerSize * 1.5}px` }"
        ></div>
        <div
          v-else-if="spinner === 'dots'"
          class="stratix-loading-dots"
        >
          <span></span><span></span><span></span>
        </div>
        <div
          v-else-if="spinner === 'pulse'"
          class="stratix-loading-pulse"
          :style="{ width: `${spinnerSize * 1.5}px`, height: `${spinnerSize * 1.5}px` }"
        ></div>
        <span v-if="text" class="stratix-loading-fullscreen__text">{{ text }}</span>
      </div>
    </div>
  </Teleport>

  <!-- Spinner mode: inline loading indicator -->
  <div v-if="mode === 'spinner' && !fullscreen" class="stratix-loading-spinner-container">
    <div
      v-if="spinner === 'ring'"
      class="stratix-loading-spinner"
      :class="`stratix-loading-spinner--${size}`"
      :style="{ width: `${spinnerSize}px`, height: `${spinnerSize}px` }"
    ></div>
    <div
      v-else-if="spinner === 'dots'"
      class="stratix-loading-dots"
      :class="`stratix-loading-dots--${size}`"
    >
      <span></span><span></span><span></span>
    </div>
    <div
      v-else-if="spinner === 'pulse'"
      class="stratix-loading-pulse"
      :class="`stratix-loading-pulse--${size}`"
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
/* ============ Spinner Container ============ */
.stratix-loading-spinner-container {
  display: inline-flex;
  align-items: center;
  gap: var(--ds-spacing-sm);
}

/* ============ Ring Spinner ============ */
.stratix-loading-spinner {
  border: 2px solid currentColor;
  border-top-color: transparent;
  border-radius: var(--ds-radius-full);
  animation: ds-spin var(--ds-animation-duration-slow, 400ms) linear infinite;
  flex-shrink: 0;
}

.stratix-loading-spinner--sm {
  border-width: 1.5px;
}

.stratix-loading-spinner--lg {
  border-width: 3px;
}

/* ============ Dots Spinner ============ */
.stratix-loading-dots {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.stratix-loading-dots--sm {
  gap: 3px;
}

.stratix-loading-dots--lg {
  gap: 6px;
}

.stratix-loading-dots span {
  display: inline-block;
  width: 6px;
  height: 6px;
  background: currentColor;
  border-radius: var(--ds-radius-full);
  animation: ds-loading-dots 1.4s ease-in-out infinite both;
}

.stratix-loading-dots--sm span {
  width: 4px;
  height: 4px;
}

.stratix-loading-dots--lg span {
  width: 10px;
  height: 10px;
}

.stratix-loading-dots span:nth-child(1) {
  animation-delay: -0.32s;
}

.stratix-loading-dots span:nth-child(2) {
  animation-delay: -0.16s;
}

/* ============ Pulse Spinner ============ */
.stratix-loading-pulse {
  border-radius: var(--ds-radius-full);
  background: currentColor;
  animation: ds-loading-pulse 1.5s ease-in-out infinite;
  flex-shrink: 0;
}

.stratix-loading-pulse--sm {
  animation-duration: 1.2s;
}

.stratix-loading-pulse--lg {
  animation-duration: 1.8s;
}

/* ============ Text ============ */
.stratix-loading-spinner__text {
  font-size: var(--ds-font-size-md);
  color: var(--ds-text-secondary, var(--text-secondary, #a0a0b0));
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
  color: var(--ds-text-secondary, var(--text-secondary, #a0a0b0));
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
@keyframes ds-spin {
  to { transform: rotate(360deg); }
}

@keyframes ds-loading-dots {
  0%, 80%, 100% {
    transform: scale(0);
    opacity: 0.5;
  }
  40% {
    transform: scale(1);
    opacity: 1;
  }
}

@keyframes ds-loading-pulse {
  0%, 100% {
    transform: scale(0.6);
    opacity: 0.4;
  }
  50% {
    transform: scale(1);
    opacity: 1;
  }
}

@keyframes stratix-skeleton-pulse {
  0% {
    background-position: 200% 0;
  }
  100% {
    background-position: -200% 0;
  }
}

@media (prefers-reduced-motion: reduce) {
  .stratix-loading-spinner,
  .stratix-loading-dots span,
  .stratix-loading-pulse,
  .stratix-loading-skeleton__line {
    animation: none;
  }
}
</style>
