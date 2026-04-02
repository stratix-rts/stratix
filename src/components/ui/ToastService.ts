/**
 * ToastService - Unified Toast Notification System
 *
 * A singleton service that manages toast notifications across the entire application.
 * Provides:
 * - Unified notification types: success/warning/error/info
 * - Auto-dismiss (3-5 seconds)
 * - Stacked display of multiple toasts
 * - Enter/exit animations
 * - Position configuration (top-right, bottom-right, etc.)
 *
 * Bridges Vue composables and RTS event bus.
 */

import type { ToastItem, ToastOptions } from './ToastItem';

import { rtsEventBus } from '@/stratix-rts/events/core/RTSEventBus';

export type { ToastOptions };

type ToastSubscriber = (toasts: ToastItem[]) => void;

class ToastService {
  private static instance: ToastService;
  private toasts = new Map<string, ToastItem>();
  private maxToasts = 5;
  private defaultDuration = 4000;
  private subscribers = new Set<ToastSubscriber>();
  private eventUnsubscribe: (() => void) | null = null;

  private constructor() {
    this.setupEventListeners();
  }

  static getInstance(): ToastService {
    if (!ToastService.instance) {
      ToastService.instance = new ToastService();
    }
    return ToastService.instance;
  }

  /**
   * Setup event listeners for RTS events
   */
  private setupEventListeners(): void {
    // Listen for scene:ui:notification events from RTS layer
    this.eventUnsubscribe = rtsEventBus.on('scene:ui:notification' as any, (data: { message: string; type: ToastOptions['type'] }) => {
      this.show({
        type: data.type,
        title: data.type.charAt(0).toUpperCase() + data.type.slice(1),
        message: data.message,
      });
    });
  }

  /**
   * Subscribe to toast updates
   * @returns unsubscribe function
   */
  subscribe(fn: ToastSubscriber): () => void {
    this.subscribers.add(fn);
    // Immediately call with current state
    fn(this.getToasts());
    return () => {
      this.subscribers.delete(fn);
    };
  }

  /**
   * Notify all subscribers of state change
   */
  private notify(): void {
    const toastList = this.getToasts();
    this.subscribers.forEach((fn) => fn(toastList));
  }

  /**
   * Show a toast notification
   * @returns toast ID
   */
  show(options: ToastOptions): string {
    const id = `toast-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    const toast: ToastItem = {
      id,
      type: options.type,
      title: options.title,
      message: options.message,
      duration: options.duration ?? this.defaultDuration,
      visible: true,
      createdAt: Date.now(),
    };

    this.toasts.set(id, toast);
    this.enforceMaxToasts();
    this.notify();

    // Auto-dismiss after duration
    if (toast.duration && toast.duration > 0) {
      setTimeout(() => {
        this.dismiss(id);
      }, toast.duration);
    }

    return id;
  }

  /**
   * Dismiss a toast by ID
   */
  dismiss(id: string): void {
    if (this.toasts.has(id)) {
      this.toasts.delete(id);
      this.notify();
    }
  }

  /**
   * Dismiss all toasts
   */
  dismissAll(): void {
    this.toasts.clear();
    this.notify();
  }

  /**
   * Get all toasts (sorted by creation time, newest first)
   */
  getToasts(): ToastItem[] {
    return Array.from(this.toasts.values()).sort((a, b) => b.createdAt - a.createdAt);
  }

  /**
   * Enforce max toasts limit
   */
  private enforceMaxToasts(): void {
    if (this.toasts.size > this.maxToasts) {
      const sorted = this.getToasts();
      const toRemove = sorted.slice(this.maxToasts);
      toRemove.forEach((t) => this.toasts.delete(t.id));
    }
  }

  /**
   * Set max toasts limit
   */
  setMaxToasts(max: number): void {
    this.maxToasts = max;
    this.enforceMaxToasts();
  }

  /**
   * Set default duration for auto-dismiss
   */
  setDefaultDuration(duration: number): void {
    this.defaultDuration = duration;
  }

  /**
   * Cleanup
   */
  destroy(): void {
    if (this.eventUnsubscribe) {
      this.eventUnsubscribe();
      this.eventUnsubscribe = null;
    }
    this.toasts.clear();
    this.subscribers.clear();
  }
}

export const toastService = ToastService.getInstance();
