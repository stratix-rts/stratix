<script setup lang="ts">
import { computed } from 'vue';
import { getPanelToken, type PanelVariants } from '@/design-system/components/shared/panel';

interface Props {
  variant?: keyof typeof PanelVariants;
  padding?: 'sm' | 'md' | 'lg';
  hoverable?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  variant: 'default',
  padding: 'md',
  hoverable: false,
});

const token = computed(() => getPanelToken(props.variant));
</script>

<template>
  <div
    class="stratix-panel"
    :class="{
      'stratix-panel--hoverable': hoverable,
      [`stratix-panel--${variant}`]: true,
    }"
  >
    <div class="stratix-panel__content">
      <slot />
    </div>
  </div>
</template>

<style scoped>
.stratix-panel {
  background: v-bind('token.style.background');
  border: v-bind('token.style.border');
  border-radius: var(--ds-radius-sm);
  box-shadow: v-bind('token.style.boxShadow');
  padding: v-bind('`8px 16px`');
  transition: all var(--ds-animation-duration-fast) ease;
}

.stratix-panel--elevated {
  background: var(--ds-gradient-bg-subtle, v-bind('token.style.background'));
}

.stratix-panel--glass {
  background: var(--ds-glass-bg, v-bind('token.style.background'));
  border: var(--ds-glass-border, v-bind('token.style.border'));
  box-shadow: var(--ds-glass-shadow, v-bind('token.style.boxShadow'));
  backdrop-filter: blur(var(--ds-glass-blur)) saturate(var(--ds-glass-saturate));
  -webkit-backdrop-filter: blur(var(--ds-glass-blur)) saturate(var(--ds-glass-saturate));
}

.stratix-panel--hoverable {
  transform-style: preserve-3d;
}

.stratix-panel--hoverable:hover {
  transform: perspective(1000px) rotateX(1deg) rotateY(-1deg) translateZ(8px) translateY(-2px);
  box-shadow: var(--ds-shadow-lg);
}

/* Cyberpunk 主题下的 glow pulse 效果 */
[data-theme="cyberpunk"] .stratix-panel--hoverable:hover {
  animation: ds-glow-pulse 2s var(--ds-animation-easing-linear) infinite;
}

.stratix-panel__content {
  display: contents;
}
</style>
