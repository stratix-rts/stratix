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
  return props.toasts.slice(0, props.maxToasts);
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
          v-for="toast in displayedToasts"
          :key="toast.id"
          class="toast-item"
          :class="`toast-item--${toast.type}`"
          :style="{
            '--toast-border': getToastStyle(toast.type).border,
            '--toast-bg': getToastStyle(toast.type).background,
            '--toast-bg-subtle': getToastStyle(toast.type).backgroundSubtle,
            '--toast-text': getToastStyle(toast.type).text,
            '--toast-icon': getToastStyle(toast.type).icon,
          }"
          role="alert"
        >
          <div class="toast-icon">
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
  padding: 16px;
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
  gap: 8px;
  max-width: 400px;
}

.toast-item {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 12px 16px;
  background: var(--toast-bg);
  border: 1px solid var(--toast-border);
  border-left: 3px solid var(--toast-icon);
  border-radius: 4px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
  pointer-events: auto;
  backdrop-filter: blur(8px);
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
  font-size: 14px;
  font-weight: 500;
  color: var(--toast-text);
  line-height: 1.4;
}

.toast-message {
  font-size: 13px;
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
  transition: opacity 0.15s ease;
  display: flex;
  align-items: center;
  justify-content: center;
}

.toast-dismiss:hover {
  opacity: 1;
}

.toast-dismiss svg {
  width: 16px;
  height: 16px;
}

/* Transition animations */
.toast-enter-active {
  animation: toast-in 300ms cubic-bezier(0.175, 0.885, 0.32, 1.275);
}

.toast-leave-active {
  animation: toast-out 200ms ease-in forwards;
}

.toast-move {
  transition: transform 300ms ease;
}

@keyframes toast-in {
  from {
    opacity: 0;
    transform: translateX(100%);
  }
  to {
    opacity: 1;
    transform: translateX(0);
  }
}

@keyframes toast-out {
  from {
    opacity: 1;
    transform: translateX(0);
  }
  to {
    opacity: 0;
    transform: translateX(100%);
  }
}

.toast-container--top-right .toast-enter-active {
  animation: toast-in-right 300ms cubic-bezier(0.175, 0.885, 0.32, 1.275);
}

.toast-container--top-right .toast-leave-active {
  animation: toast-out-right 200ms ease-in forwards;
}

@keyframes toast-in-right {
  from {
    opacity: 0;
    transform: translateX(100%);
  }
  to {
    opacity: 1;
    transform: translateX(0);
  }
}

@keyframes toast-out-right {
  from {
    opacity: 1;
    transform: translateX(0);
  }
  to {
    opacity: 0;
    transform: translateX(100%);
  }
}

.toast-container--bottom-right .toast-enter-active {
  animation: toast-in-bottom-right 300ms cubic-bezier(0.175, 0.885, 0.32, 1.275);
}

.toast-container--bottom-right .toast-leave-active {
  animation: toast-out-bottom-right 200ms ease-in forwards;
}

@keyframes toast-in-bottom-right {
  from {
    opacity: 0;
    transform: translateY(100%);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

@keyframes toast-out-bottom-right {
  from {
    opacity: 1;
    transform: translateY(0);
  }
  to {
    opacity: 0;
    transform: translateY(100%);
  }
}
</style>
