/**
 * Toast notification types
 */

export interface ToastItem {
  id: string;
  type: 'info' | 'success' | 'warning' | 'error';
  title: string;
  message?: string;
  duration?: number;
  visible: boolean;
  createdAt: number;
}

export type ToastType = ToastItem['type'];

export interface ToastOptions {
  type: ToastType;
  title: string;
  message?: string;
  duration?: number;
}
