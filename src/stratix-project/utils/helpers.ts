export function generateId(prefix: string): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substr(2, 9);
  return `${prefix}_${timestamp}_${random}`;
}

export function formatDate(date: Date): string {
  return date.toISOString();
}

export function parseDate(dateString: string): Date {
  return new Date(dateString);
}

export function now(): string {
  return new Date().toISOString();
}

export function deepClone<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj));
}

export function validatePriority(priority: number): boolean {
  return Number.isInteger(priority) && priority >= 1 && priority <= 5;
}

export function validateProgress(progress: number): boolean {
  return Number.isFinite(progress) && progress >= 0 && progress <= 100;
}

export const PROJECT_STATUS_VALUES = ['pending', 'active', 'paused', 'completed', 'failed'] as const;

export function validateProjectStatus(status: string): status is 'pending' | 'active' | 'paused' | 'completed' | 'failed' {
  return PROJECT_STATUS_VALUES.includes(status as any);
}

export const TASK_STATUS_VALUES = ['pending', 'configured', 'waiting', 'running', 'completed', 'paused', 'failed'] as const;

export function validateTaskStatus(status: string): status is 'pending' | 'configured' | 'waiting' | 'running' | 'completed' | 'paused' | 'failed' {
  return TASK_STATUS_VALUES.includes(status as any);
}

export function validateRequired(value: any, fieldName: string): void {
  if (value === undefined || value === null || value === '') {
    throw new Error(`${fieldName} is required`);
  }
}

export function validatePath(path: string): boolean {
  if (!path || typeof path !== 'string') {
    return false;
  }

  return path.length > 0;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) {
    return `${hours}h ${minutes % 60}m`;
  } else if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  } else {
    return `${seconds}s`;
  }
}

export function debounce<T extends (...args: any[]) => any>(
  func: T,
  wait: number
): (...args: Parameters<T>) => void {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  
  return function(this: any, ...args: Parameters<T>) {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
    
    timeoutId = setTimeout(() => {
      func.apply(this, args);
    }, wait);
  };
}

export function throttle<T extends (...args: any[]) => any>(
  func: T,
  limit: number
): (...args: Parameters<T>) => void {
  let inThrottle: boolean = false;
  
  return function(this: any, ...args: Parameters<T>) {
    if (!inThrottle) {
      func.apply(this, args);
      inThrottle = true;
      setTimeout(() => {
        inThrottle = false;
      }, limit);
    }
  };
}
