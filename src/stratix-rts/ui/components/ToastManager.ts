import { rtsEventBus } from '../../events/core/RTSEventBus';
import type { ErrorSeverity } from '../../error/types';
import { ErrorSeverity as ES } from '../../error/types';

export interface ToastConfig {
  type: 'info' | 'success' | 'warning' | 'error';
  title: string;
  message: string;
  duration?: number;
  actions?: Array<{
    label: string;
    action: () => void | Promise<void>;
  }>;
}

export interface Toast extends ToastConfig {
  id: string;
  createdAt: number;
  visible: boolean;
}

export class ToastManager {
  private toasts = new Map<string, Toast>();
  private maxToasts = 5;
  private defaultDuration = 5000;

  constructor() {
    this.setupEventListeners();
  }

  private setupEventListeners(): void {
    rtsEventBus.on('scene:ui:notification' as any, (data: ToastConfig) => {
      this.show(data);
    });
  }

  show(config: ToastConfig): string {
    const id = `toast-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    const toast: Toast = {
      id,
      type: config.type,
      title: config.title,
      message: config.message,
      duration: config.duration ?? this.defaultDuration,
      actions: config.actions,
      createdAt: Date.now(),
      visible: true,
    };

    this.toasts.set(id, toast);

    this.enforceMaxToasts();

    if (toast.duration && toast.duration > 0) {
      setTimeout(() => {
        this.dismiss(id);
      }, toast.duration);
    }

    this.emitToastUpdate();

    return id;
  }

  dismiss(id: string): void {
    const toast = this.toasts.get(id);
    if (toast) {
      toast.visible = false;
      this.toasts.delete(id);
      this.emitToastUpdate();
    }
  }

  dismissAll(): void {
    this.toasts.clear();
    this.emitToastUpdate();
  }

  private enforceMaxToasts(): void {
    if (this.toasts.size > this.maxToasts) {
      const entries = Array.from(this.toasts.entries());
      const toRemove = entries.slice(0, this.toasts.size - this.maxToasts);
      toRemove.forEach(([id]) => this.toasts.delete(id));
    }
  }

  private emitToastUpdate(): void {
    rtsEventBus.emit('toast:updated' as any, {
      toasts: Array.from(this.toasts.values()),
    });
  }

  getToasts(): Toast[] {
    return Array.from(this.toasts.values());
  }

  getVisibleToasts(): Toast[] {
    return Array.from(this.toasts.values()).filter(t => t.visible);
  }

  destroy(): void {
    this.toasts.clear();
    rtsEventBus.off('scene:ui:notification' as any);
  }
}

export const toastManager = new ToastManager();