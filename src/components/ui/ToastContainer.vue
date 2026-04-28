<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue';
import { Animation } from '@/design-system/tokens/animation';
import { StatusSemantic } from '@/design-system/semantic/status';
import type { ToastItem } from './ToastItem';

interface Props {
  toasts: ToastItem[];
  position?: 'top-right' | 'bottom-right' | 'top-left' | 'bottom-left';
  maxToasts?: number;
}

const props = withDefaults(defineProps<Props>(), {
  position: 'top-right',
  maxToasts: 5,
});

const emit = defineEmits<{
  dismiss: [id: string];
}>();

const displayedToasts = computed(() => {
  return props.toasts.slice(-props.maxToasts);
});

const getToastStyle = (type: ToastItem['type']) => {
  const colors = {
    info: StatusSemantic.info,
    success: StatusSemantic.success,
    warning: StatusSemantic.warning,
    error: StatusSemantic.danger,
  };
  return colors[type];
};

const handleDismiss = (id: string) => {
  emit('dismiss', id);
};

const hoveredToast = ref<string | null>(null);

const progressMap = ref<Record<string, number>>({});
const rafIds = ref<Record<string, number>>({});

const startProgress = (toast: ToastItem) => {
  if (!toast.duration || toast.duration <= 0) return;
  const start = performance.now();
  const duration = toast.duration;

  const tick = (now: number) => {
    if (hoveredToast.value === toast.id) {
      rafIds.value[toast.id] = requestAnimationFrame(tick);
      return;
    }
    const elapsed = now - start;
    const remaining = Math.max(0, duration - elapsed);
    progressMap.value[toast.id] = (remaining / duration) * 100;

    if (remaining > 0) {
      rafIds.value[toast.id] = requestAnimationFrame(tick);
    } else {
      handleDismiss(toast.id);
    }
  };

  rafIds.value[toast.id] = requestAnimationFrame(tick);
};

watch(() => props.toasts, (newToasts, oldToasts) => {
  const newIds = new Set(newToasts.map(t => t.id));
  const oldIds = new Set((oldToasts || []).map(t => t.id));

  newToasts.forEach(toast => {
    if (!oldIds.has(toast.id)) {
      progressMap.value[toast.id] = 100;
      startProgress(toast);
    }
  });

  (oldToasts || []).forEach(toast => {
    if (!newIds.has(toast.id) && rafIds.value[toast.id]) {
      cancelAnimationFrame(rafIds.value[toast.id]);
      delete rafIds.value[toast.id];
      delete progressMap.value[toast.id];
    }
  });
}, { deep: true });

onUnmounted(() => {
  Object.values(rafIds.value).forEach(id => cancelAnimationFrame(id));
});

const getIconAnimation = (type: ToastItem['type']) => {
  const map = {
    success: 'ds-toast-icon-bounce',
    error: 'ds-toast-icon-shake',
    warning: 'ds-toast-icon-pulse',
    info: 'ds-toast-icon-slide',
  };
  return map[type];
};
</script>

<template>
  <Teleport to="body">
    <div
      class="toast-container"
      :class="`toast-container--${position}`"
    >
      <TransitionGroup
        name="toast"
        tag="div"
        class="toast-list"
      >
        <div
          v-for="(toast, index) in displayedToasts"
          :key="toast.id"
          class="toast-item"
          :class="`toast-item--${toast.type}`"
          :style="{
            '--toast-border': getToastStyle(toast.type).border,
            '--toast-bg': getToastStyle(toast.type).background,
            '--toast-bg-subtle': getToastStyle(toast.type).backgroundSubtle,
            '--toast-text': getToastStyle(toast.type).text,
            '--toast-icon': getToastStyle(toast.type).icon,
            '--toast-index': index,
          }"
          role="alert"
          @mouseenter="hoveredToast = toast.id"
          @mouseleave="hoveredToast = null"
        >
          <div class="toast-icon" :class="getIconAnimation(toast.type)">
            <svg
              v-if="toast.type === 'success'"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
            >
              <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" stroke-linecap="round" stroke-linejoin="round"/>
              <polyline points="22 4 12 14.01 9 11.01" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
            <svg
              v-else-if="toast.type === 'error'"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
            >
              <circle cx="12" cy="12" r="10"/>
              <line x1="15" y1="9" x2="9" y2="15"/>
              <line x1="9" y1="9" x2="15" y2="15"/>
            </svg>
            <svg
              v-else-if="toast.type === 'warning'"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
            >
              <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
              <line x1="12" y1="9" x2="12" y2="13"/>
              <line x1="12" y1="17" x2="12.01" y2="17"/>
            </svg>
            <svg
              v-else
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
            >
              <circle cx="12" cy="12" r="10"/>
              <line x1="12" y1="16" x2="12" y2="12"/>
              <line x1="12" y1="8" x2="12.01" y2="8"/>
            </svg>
          </div>

          <div class="toast-content">
            <div class="toast-title">{{ toast.title }}</div>
            <div v-if="toast.message" class="toast-message">{{ toast.message }}</div>
          </div>

          <button
            class="toast-dismiss"
            @click="handleDismiss(toast.id)"
            aria-label="Dismiss"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="18" y1="6" x2="6" y2="18"/>
              <line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>

          <div
            v-if="toast.duration && toast.duration > 0"
            class="toast-progress"
            :style="{ width: `${progressMap[toast.id] ?? 100}%` }"
          ></div>
        </div>
      </TransitionGroup>
    </div>
  </Teleport>
</template>

<style scoped>
.toast-container {
  position: fixed;
  z-index: 9999;
  pointer-events: none;
  padding: var(--ds-spacing-md);
}

.toast-container--top-right {
  top: 0;
  right: 0;
}

.toast-container--bottom-right {
  bottom: 0;
  right: 0;
}

.toast-container--top-left {
  top: 0;
  left: 0;
}

.toast-container--bottom-left {
  bottom: 0;
  left: 0;
}

.toast-list {
  display: flex;
  flex-direction: column;
  gap: var(--ds-spacing-sm);
  max-width: 400px;
}

.toast-item {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: var(--ds-spacing-md) var(--ds-spacing-md);
  padding-bottom: calc(var(--ds-spacing-md) + 3px);
  background: var(--ds-glass-bg, var(--toast-bg));
  border: var(--ds-glass-border, 1px solid var(--toast-border));
  border-left: 3px solid var(--toast-icon);
  border-radius: var(--ds-radius-sm);
  box-shadow: var(--ds-glass-shadow, 0 4px 12px color-mix(in srgb, black 40%, transparent));
  pointer-events: auto;
  backdrop-filter: blur(var(--ds-glass-blur, 8px)) saturate(var(--ds-glass-saturate, 100%));
  -webkit-backdrop-filter: blur(var(--ds-glass-blur, 8px)) saturate(var(--ds-glass-saturate, 100%));
  position: relative;
  overflow: hidden;
}

.toast-item--success {
  background: var(--ds-gradient-status-success, var(--toast-bg));
}

.toast-item--warning {
  background: var(--ds-gradient-status-warning, var(--toast-bg));
}

.toast-item--error {
  background: var(--ds-gradient-status-danger, var(--toast-bg));
}

.toast-item--info {
  background: var(--ds-gradient-status-info, var(--toast-bg));
}

.toast-icon {
  flex-shrink: 0;
  width: 20px;
  height: 20px;
  color: var(--toast-icon);
}

.toast-icon svg {
  width: 100%;
  height: 100%;
}

.toast-content {
  flex: 1;
  min-width: 0;
}

.toast-title {
  font-size: var(--ds-font-size-md);
  font-weight: 500;
  color: var(--toast-text);
  line-height: 1.4;
}

.toast-message {
  font-size: var(--ds-font-size-sm);
  color: var(--toast-text);
  opacity: 0.8;
  margin-top: 2px;
  line-height: 1.4;
}

.toast-dismiss {
  flex-shrink: 0;
  width: 20px;
  height: 20px;
  padding: 0;
  border: none;
  background: transparent;
  color: var(--toast-text);
  opacity: 0.6;
  cursor: pointer;
  transition: opacity 0.15s ease, transform 0.15s ease;
  display: flex;
  align-items: center;
  justify-content: center;
}

.toast-dismiss:hover {
  opacity: 1;
  transform: rotate(90deg);
}

.toast-dismiss svg {
  width: 16px;
  height: 16px;
}

.toast-progress {
  position: absolute;
  bottom: 0;
  left: 0;
  height: 3px;
  background: var(--toast-icon);
  opacity: 0.5;
  transition: width 0.1s linear;
}

/* Icon animations */
.ds-toast-icon-bounce {
  animation: ds-toast-bounce 400ms cubic-bezier(0.175, 0.885, 0.32, 1.275);
}

.ds-toast-icon-shake {
  animation: ds-toast-shake 400ms ease;
}

.ds-toast-icon-pulse {
  animation: ds-toast-pulse 400ms ease;
}

.ds-toast-icon-slide {
  animation: ds-toast-slide 300ms ease;
}

/* Transition animations */
.toast-enter-active {
  animation: ds-slide-right 300ms cubic-bezier(0.175, 0.885, 0.32, 1.275);
  animation-delay: calc(var(--toast-index, 0) * 80ms);
}

.toast-leave-active {
  animation: ds-fade-out 200ms var(--ds-animation-easing-ease-in, ease-in) forwards;
}

.toast-move {
  transition: transform 300ms ease;
}

.toast-container--top-left .toast-enter-active,
.toast-container--bottom-left .toast-enter-active {
  animation: ds-slide-left 300ms cubic-bezier(0.175, 0.885, 0.32, 1.275);
  animation-delay: calc(var(--toast-index, 0) * 80ms);
}

.toast-container--bottom-right .toast-enter-active,
.toast-container--bottom-left .toast-enter-active {
  animation: ds-slide-up 300ms cubic-bezier(0.175, 0.885, 0.32, 1.275);
  animation-delay: calc(var(--toast-index, 0) * 80ms);
}

@keyframes ds-toast-bounce {
  0% { transform: scale(0); }
  50% { transform: scale(1.3); }
  100% { transform: scale(1); }
}

@keyframes ds-toast-shake {
  0%, 100% { transform: translateX(0); }
  20% { transform: translateX(-4px); }
  40% { transform: translateX(4px); }
  60% { transform: translateX(-2px); }
  80% { transform: translateX(2px); }
}

@keyframes ds-toast-pulse {
  0% { transform: scale(1); opacity: 0.7; }
  50% { transform: scale(1.2); opacity: 1; }
  100% { transform: scale(1); opacity: 1; }
}

@keyframes ds-toast-slide {
  0% { transform: translateX(-8px); opacity: 0; }
  100% { transform: translateX(0); opacity: 1; }
}

@keyframes ds-slide-left {
  from {
    opacity: 0;
    transform: translateX(var(--ds-spacing-sm, 8px));
  }
  to {
    opacity: 1;
    transform: translateX(0);
  }
}

@media (prefers-reduced-motion: reduce) {
  .toast-enter-active,
  .toast-leave-active,
  .toast-move,
  .ds-toast-icon-bounce,
  .ds-toast-icon-shake,
  .ds-toast-icon-pulse,
  .ds-toast-icon-slide {
    animation: none;
    transition: none;
  }
  .toast-dismiss:hover {
    transform: none;
  }
}
</style>
