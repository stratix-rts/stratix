<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { getToken } from '@/design-system/config';

type BadgeVariant = 'default' | 'primary' | 'success' | 'warning' | 'danger' | 'info';

interface Props {
  variant?: BadgeVariant;
  count?: number;
  max?: number;
  ping?: boolean;
  dot?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  variant: 'default',
  max: 99,
  ping: false,
  dot: false,
});

const displayCount = computed(() => {
  if (props.count === undefined) return '';
  if (props.count > props.max) return `${props.max}+`;
  return String(props.count);
});

const prevCount = ref(props.count);
const isChanging = ref(false);

watch(() => props.count, (newVal, oldVal) => {
  if (newVal !== oldVal && oldVal !== undefined) {
    isChanging.value = true;
    prevCount.value = oldVal;
    setTimeout(() => {
      isChanging.value = false;
    }, 300);
  }
});
</script>

<template>
  <span
    class="stratix-badge"
    :class="[
      `stratix-badge--${variant}`,
      { 'stratix-badge--dot': dot, 'stratix-badge--ping': ping, 'stratix-badge--changing': isChanging }
    ]"
  >
    <span v-if="!dot" class="stratix-badge__content">
      <slot>{{ displayCount }}</slot>
    </span>
    <span v-if="ping" class="stratix-badge__ping"></span>
  </span>
</template>

<style scoped>
.stratix-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 18px;
  height: 18px;
  padding: 0 6px;
  font-size: var(--ds-font-size-xs);
  font-weight: 600;
  border-radius: var(--ds-radius-full);
  line-height: 1;
  position: relative;
}

.stratix-badge--default {
  background: v-bind('getToken("colors.background.elevated")');
  color: v-bind('getToken("colors.text.primary")');
  border: 1px solid v-bind('getToken("colors.border.default")');
}

.stratix-badge--primary {
  background: v-bind('getToken("colors.brand.primary")');
  color: v-bind('getToken("colors.background.base")');
}

.stratix-badge--success {
  background: v-bind('getToken("colors.status.success")');
  color: v-bind('getToken("colors.background.base")');
}

.stratix-badge--warning {
  background: v-bind('getToken("colors.status.warning")');
  color: v-bind('getToken("colors.background.base")');
}

.stratix-badge--danger {
  background: v-bind('getToken("colors.status.danger")');
  color: v-bind('getToken("colors.background.base")');
}

.stratix-badge--info {
  background: v-bind('getToken("colors.status.info")');
  color: v-bind('getToken("colors.background.base")');
}

.stratix-badge--dot {
  width: 8px;
  min-width: 8px;
  height: 8px;
  padding: 0;
}

.stratix-badge__content {
  display: inline-flex;
  align-items: center;
}

.stratix-badge--changing .stratix-badge__content {
  animation: ds-badge-count 300ms ease;
}

.stratix-badge__ping {
  position: absolute;
  inset: 0;
  border-radius: inherit;
  background: inherit;
  animation: ds-badge-ping 1.5s cubic-bezier(0, 0, 0.2, 1) infinite;
  opacity: 0.75;
}

@keyframes ds-badge-ping {
  75%, 100% {
    transform: scale(1.6);
    opacity: 0;
  }
}

@keyframes ds-badge-count {
  0% { transform: translateY(-8px); opacity: 0; }
  50% { transform: translateY(2px); }
  100% { transform: translateY(0); opacity: 1; }
}

@media (prefers-reduced-motion: reduce) {
  .stratix-badge--changing .stratix-badge__content,
  .stratix-badge__ping {
    animation: none;
  }
}
</style>
