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
  border-radius: 4px;
  box-shadow: v-bind('token.style.boxShadow');
  padding: v-bind('`8px 16px`');
  transition: all 0.2s ease;
}

.stratix-panel--hoverable:hover {
  transform: translateY(-2px);
  box-shadow: 0 8px 16px rgba(0, 0, 0, 0.6);
}

.stratix-panel__content {
  display: contents;
}
</style>
