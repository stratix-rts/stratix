<script setup lang="ts">
import { ref, computed } from 'vue';
import { getPanelToken, type PanelVariants } from '@/design-system/components/shared/panel';
import SvgIcon from './SvgIcon.vue';

interface Props {
  variant?: keyof typeof PanelVariants;
  padding?: 'sm' | 'md' | 'lg';
  hoverable?: boolean;
  collapsible?: boolean;
  defaultCollapsed?: boolean;
  title?: string;
  glass?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  variant: 'default',
  padding: 'md',
  hoverable: false,
  collapsible: false,
  defaultCollapsed: false,
  title: '',
  glass: false,
});

const token = computed(() => getPanelToken(props.variant));
const isCollapsed = ref(props.defaultCollapsed);

const toggleCollapse = () => {
  if (props.collapsible) {
    isCollapsed.value = !isCollapsed.value;
  }
};
</script>

<template>
  <div
    class="stratix-panel"
    :class="{
      'stratix-panel--hoverable': hoverable,
      'stratix-panel--glass': glass,
      'stratix-panel--collapsed': isCollapsed,
      [`stratix-panel--${variant}`]: true,
    }"
  >
    <div
      v-if="title || $slots.header || collapsible"
      class="stratix-panel__header"
      :class="{ 'stratix-panel__header--collapsible': collapsible }"
      @click="toggleCollapse"
    >
      <slot name="header">
        <h4 class="stratix-panel__title">{{ title }}</h4>
      </slot>
      <SvgIcon
        v-if="collapsible"
        name="chevron-down"
        :size="16"
        class="stratix-panel__collapse-icon"
      />
    </div>
    <transition name="stratix-panel-content">
      <div v-show="!isCollapsed" class="stratix-panel__content">
        <slot />
      </div>
    </transition>
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

.stratix-panel__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 0;
  margin-bottom: 4px;
  transition: color var(--ds-animation-duration-fast) ease;
}

.stratix-panel__header--collapsible {
  cursor: pointer;
  user-select: none;
}

.stratix-panel__header--collapsible:hover {
  color: var(--ds-text-primary);
}

.stratix-panel__title {
  margin: 0;
  font-size: var(--ds-font-size-md);
  font-weight: 600;
  color: var(--ds-text-primary);
}

.stratix-panel__collapse-icon {
  color: var(--ds-text-muted);
  transition: transform var(--ds-animation-duration-fast) ease;
}

.stratix-panel--collapsed .stratix-panel__collapse-icon {
  transform: rotate(-90deg);
}

.stratix-panel__content {
  display: contents;
}

/* Collapse animation */
.stratix-panel-content-enter-active,
.stratix-panel-content-leave-active {
  transition: all var(--ds-animation-duration-fast) ease;
  overflow: hidden;
}

.stratix-panel-content-enter-from,
.stratix-panel-content-leave-to {
  opacity: 0;
  max-height: 0;
  transform: translateY(-4px);
}

.stratix-panel-content-enter-to,
.stratix-panel-content-leave-from {
  opacity: 1;
  max-height: 500px;
  transform: translateY(0);
}

@media (prefers-reduced-motion: reduce) {
  .stratix-panel,
  .stratix-panel__collapse-icon {
    transition: none;
    animation: none;
  }
  .stratix-panel-content-enter-active,
  .stratix-panel-content-leave-active {
    transition: none;
  }
}
</style>
