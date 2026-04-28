<script setup lang="ts">
import { computed } from 'vue';

type Direction = 'left' | 'right' | 'top' | 'bottom';

interface Props {
  direction?: Direction;
  duration?: number;
  appear?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  direction: 'right',
  duration: 300,
  appear: false,
});

const transitionName = computed(() => `panel-transition-${props.direction}`);
</script>

<template>
  <Transition
    :appear="appear"
    :name="transitionName"
    :style="{
      '--panel-duration': `${duration}ms`,
    }"
  >
    <slot />
  </Transition>
</template>

<style>
.panel-transition-left-enter-active,
.panel-transition-left-leave-active,
.panel-transition-right-enter-active,
.panel-transition-right-leave-active,
.panel-transition-top-enter-active,
.panel-transition-top-leave-active,
.panel-transition-bottom-enter-active,
.panel-transition-bottom-leave-active {
  transition: transform var(--panel-duration) ease, opacity var(--panel-duration) ease;
}

.panel-transition-left-enter-from,
.panel-transition-left-leave-to {
  opacity: 0;
  transform: translateX(-100%);
}

.panel-transition-right-enter-from,
.panel-transition-right-leave-to {
  opacity: 0;
  transform: translateX(100%);
}

.panel-transition-top-enter-from,
.panel-transition-top-leave-to {
  opacity: 0;
  transform: translateY(-100%);
}

.panel-transition-bottom-enter-from,
.panel-transition-bottom-leave-to {
  opacity: 0;
  transform: translateY(100%);
}

@media (prefers-reduced-motion: reduce) {
  .panel-transition-left-enter-active,
  .panel-transition-left-leave-active,
  .panel-transition-right-enter-active,
  .panel-transition-right-leave-active,
  .panel-transition-top-enter-active,
  .panel-transition-top-leave-active,
  .panel-transition-bottom-enter-active,
  .panel-transition-bottom-leave-active {
    transition: none;
  }
}
</style>
