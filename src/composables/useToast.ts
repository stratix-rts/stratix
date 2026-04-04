/**
 * useToast composable
 *
 * Provides a unified toast notification API for Vue components.
 * Subscribe to the global toast service and provide methods to show/dismiss toasts.
 */

import { ref, readonly, onUnmounted } from 'vue';

import { toastService, type ToastOptions } from '@/components/ui/ToastService';

export function useToast() {
  const toasts = ref(toastService.getToasts());

  // Subscribe to toast updates
  const unsubscribe = toastService.subscribe((newToasts) => {
    toasts.value = newToasts;
  });

  onUnmounted(() => {
    unsubscribe();
  });

  /**
   * Show a toast notification
   */
  function show(options: ToastOptions): string {
    return toastService.show(options);
  }

  /**
   * Show a success toast
   */
  function success(title: string, message?: string): string {
    return toastService.show({ type: 'success', title, message });
  }

  /**
   * Show an error toast
   */
  function error(title: string, message?: string): string {
    return toastService.show({ type: 'error', title, message });
  }

  /**
   * Show a warning toast
   */
  function warning(title: string, message?: string): string {
    return toastService.show({ type: 'warning', title, message });
  }

  /**
   * Show an info toast
   */
  function info(title: string, message?: string): string {
    return toastService.show({ type: 'info', title, message });
  }

  /**
   * Dismiss a toast by ID
   */
  function dismiss(id: string): void {
    toastService.dismiss(id);
  }

  /**
   * Dismiss all toasts
   */
  function dismissAll(): void {
    toastService.dismissAll();
  }

  return {
    toasts: readonly(toasts),
    show,
    success,
    error,
    warning,
    info,
    dismiss,
    dismissAll,
  };
}
