<script setup lang="ts">
import { ref, computed } from 'vue';
import { getToken } from '@/design-system/config';
import SvgIcon from './SvgIcon.vue';

type AlertType = 'success' | 'warning' | 'error' | 'info';

interface Props {
  type?: AlertType;
  title?: string;
  message?: string;
  closable?: boolean;
  showIcon?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  type: 'info',
  closable: false,
  showIcon: true,
});

const emit = defineEmits<{
  close: [];
}>();

const visible = ref(true);

const config = computed(() => {
  const map = {
    success: { icon: 'check-circle', color: getToken('colors.status.success') },
    warning: { icon: 'alert-triangle', color: getToken('colors.status.warning') },
    error: { icon: 'x-circle', color: getToken('colors.status.danger') },
    info: { icon: 'info', color: getToken('colors.status.info') },
  };
  return map[props.type];
});

const handleClose = () => {
  visible.value = false;
  emit('close');
};
</script>

<template>
  <transition name="stratix-alert">
    <div
      v-if="visible"
      class="stratix-alert"
      :class="`stratix-alert--${type}`"
      :style="{
        '--alert-color': config.color,
      }"
      role="alert"
    >
      <div class="stratix-alert__icon-wrapper" :class="`stratix-alert__icon--${type}`">
        <SvgIcon v-if="showIcon" :name="config.icon" :size="20" />
      </div>
      <div class="stratix-alert__content">
        <div v-if="title" class="stratix-alert__title">{{ title }}</div>
        <div v-if="message || $slots.default" class="stratix-alert__message">
          <slot>{{ message }}</slot>
        </div>
        <div v-if="$slots.action" class="stratix-alert__action">
          <slot name="action" />
        </div>
      </div>
      <button
        v-if="closable"
        class="stratix-alert__close"
        @click="handleClose"
        aria-label="关闭"
      >
        <SvgIcon name="x" :size="14" />
      </button>
    </div>
  </transition>
</template>

<style scoped>
.stratix-alert {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 12px 16px;
  border-radius: var(--ds-radius-md);
  border: 1px solid color-mix(in srgb, var(--alert-color) 30%, transparent);
  background: color-mix(in srgb, var(--alert-color) 8%, transparent);
  position: relative;
}

.stratix-alert__icon-wrapper {
  flex-shrink: 0;
  margin-top: 1px;
  color: var(--alert-color);
}

.stratix-alert__icon--success {
  animation: ds-alert-icon-bounce 400ms cubic-bezier(0.175, 0.885, 0.32, 1.275);
}

.stratix-alert__icon--error {
  animation: ds-alert-icon-shake 400ms ease;
}

.stratix-alert__icon--warning {
  animation: ds-alert-icon-pulse 400ms ease;
}

.stratix-alert__icon--info {
  animation: ds-alert-icon-slide 300ms ease;
}

.stratix-alert__content {
  flex: 1;
  min-width: 0;
}

.stratix-alert__title {
  font-size: var(--ds-font-size-sm);
  font-weight: 600;
  color: v-bind('getToken("colors.text.primary")');
  line-height: 1.4;
}

.stratix-alert__message {
  font-size: var(--ds-font-size-sm);
  color: v-bind('getToken("colors.text.secondary")');
  line-height: 1.5;
  margin-top: 2px;
}

.stratix-alert__action {
  margin-top: 8px;
}

.stratix-alert__close {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  padding: 0;
  background: transparent;
  border: none;
  color: v-bind('getToken("colors.text.muted")');
  cursor: pointer;
  border-radius: var(--ds-radius-sm);
  transition: all var(--ds-animation-duration-fast) ease;
}

.stratix-alert__close:hover {
  background: color-mix(in srgb, var(--alert-color) 15%, transparent);
  color: var(--alert-color);
}

.stratix-alert-enter-active,
.stratix-alert-leave-active {
  transition: all var(--ds-animation-duration-fast) ease;
}

.stratix-alert-enter-from,
.stratix-alert-leave-to {
  opacity: 0;
  transform: translateY(-8px);
}

@keyframes ds-alert-icon-bounce {
  0% { transform: scale(0); }
  50% { transform: scale(1.3); }
  100% { transform: scale(1); }
}

@keyframes ds-alert-icon-shake {
  0%, 100% { transform: translateX(0); }
  20% { transform: translateX(-4px); }
  40% { transform: translateX(4px); }
  60% { transform: translateX(-2px); }
  80% { transform: translateX(2px); }
}

@keyframes ds-alert-icon-pulse {
  0% { transform: scale(1); opacity: 0.7; }
  50% { transform: scale(1.2); opacity: 1; }
  100% { transform: scale(1); opacity: 1; }
}

@keyframes ds-alert-icon-slide {
  0% { transform: translateX(-8px); opacity: 0; }
  100% { transform: translateX(0); opacity: 1; }
}

@media (prefers-reduced-motion: reduce) {
  .stratix-alert-enter-active,
  .stratix-alert-leave-active,
  .stratix-alert__icon-wrapper {
    transition: none;
    animation: none;
  }
}
</style>
