<script setup lang="ts">
interface Props {
  duration?: number;
  easing?: string;
  appear?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  duration: 200,
  easing: 'ease-out',
  appear: false,
});
</script>

<template>
  <Transition
    :appear="appear"
    :style="{
      '--modal-duration': `${duration}ms`,
      '--modal-easing': easing,
    }"
    enter-active-class="modal-transition-enter-active"
    enter-from-class="modal-transition-enter-from"
    leave-active-class="modal-transition-leave-active"
    leave-to-class="modal-transition-leave-to"
  >
    <slot />
  </Transition>
</template>

<style>
.modal-transition-enter-active {
  transition: all var(--modal-duration) var(--modal-easing);
}

.modal-transition-enter-from {
  opacity: 0;
  transform: scale(0.95);
}

.modal-transition-leave-active {
  transition: all 150ms ease-in;
}

.modal-transition-leave-to {
  opacity: 0;
}

@media (prefers-reduced-motion: reduce) {
  .modal-transition-enter-active,
  .modal-transition-leave-active {
    transition: none;
  }
}
</style>
