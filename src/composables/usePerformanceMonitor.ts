/**
 * usePerformanceMonitor composable
 *
 * Provides lightweight performance monitoring for Vue components:
 * - Render timing via performance.mark/measure
 * - Event handler timing
 * - Memory usage tracking
 * - Metric aggregation and thresholds
 */

import { ref, readonly, onUnmounted, type Ref } from 'vue';

export interface PerformanceMetric {
  name: string;
  duration: number;
  timestamp: number;
}

export interface RenderMetrics {
  mount: number;
  update: number;
  unmount: number;
}

export interface MemoryData {
  usedMB: number;
  totalMB: number;
  limitMB: number;
}

export interface PerformanceReport {
  metrics: PerformanceMetric[];
  renderMetrics: RenderMetrics;
  memory: MemoryData | null;
  slowHandlers: PerformanceMetric[];
  threshold: number;
}

const DEFAULT_THRESHOLD_MS = 16; // ~60fps budget

export function usePerformanceMonitor(options: { threshold?: number } = {}) {
  const threshold = options.threshold ?? DEFAULT_THRESHOLD_MS;

  const metrics = ref<PerformanceMetric[]>([]);
  const renderMetrics = ref<RenderMetrics>({ mount: 0, update: 0, unmount: 0 });
  const slowHandlers = ref<PerformanceMetric[]>([]);

  // Memory tracking interval
  let memoryInterval: ReturnType<typeof setInterval> | null = null;
  const memoryData = ref<MemoryData | null>(null);

  function trackRender(stage: 'mount' | 'update' | 'unmount', fn: () => void): void {
    const start = performance.now();
    fn();
    const duration = performance.now() - start;
    renderMetrics.value[stage] = duration;

    addMetric(`render:${stage}`, duration);
  }

  function trackEvent(name: string, fn: () => void): ReturnType<typeof fn> {
    const start = performance.now();
    const result = fn();
    const duration = performance.now() - start;

    addMetric(`event:${name}`, duration);

    if (duration > threshold) {
      slowHandlers.value.push({
        name: `event:${name}`,
        duration,
        timestamp: Date.now(),
      });
      // Keep only last 10 slow handlers
      if (slowHandlers.value.length > 10) {
        slowHandlers.value.shift();
      }
    }

    return result;
  }

  async function trackAsync<T>(name: string, fn: () => Promise<T>): Promise<T> {
    const start = performance.now();
    const result = await fn();
    const duration = performance.now() - start;
    addMetric(`async:${name}`, duration);
    return result;
  }

  function addMetric(name: string, duration: number): void {
    metrics.value.push({ name, duration, timestamp: Date.now() });
    // Keep only last 100 metrics
    if (metrics.value.length > 100) {
      metrics.value.shift();
    }
  }

  function getMemory(): MemoryData | null {
    const perf = performance as unknown as {
      memory?: {
        usedJSHeapSize: number;
        totalJSHeapSize: number;
        jsHeapSizeLimit: number;
      };
    };
    if (!perf.memory) return null;
    return {
      usedMB: perf.memory.usedJSHeapSize / (1024 * 1024),
      totalMB: perf.memory.totalJSHeapSize / (1024 * 1024),
      limitMB: perf.memory.jsHeapSizeLimit / (1024 * 1024),
    };
  }

  function startMemoryTracking(intervalMs = 2000): void {
    memoryData.value = getMemory();
    memoryInterval = setInterval(() => {
      memoryData.value = getMemory();
    }, intervalMs);
  }

  function stopMemoryTracking(): void {
    if (memoryInterval) {
      clearInterval(memoryInterval);
      memoryInterval = null;
    }
  }

  function getReport(): PerformanceReport {
    return {
      metrics: [...metrics.value],
      renderMetrics: { ...renderMetrics.value },
      memory: memoryData.value,
      slowHandlers: [...slowHandlers.value],
      threshold,
    };
  }

  function clearMetrics(): void {
    metrics.value = [];
    slowHandlers.value = [];
    renderMetrics.value = { mount: 0, update: 0, unmount: 0 };
  }

  onUnmounted(() => {
    stopMemoryTracking();
  });

  return {
    metrics: readonly(metrics),
    renderMetrics: readonly(renderMetrics),
    slowHandlers: readonly(slowHandlers),
    memoryData: readonly(memoryData) as Ref<MemoryData | null>,
    trackRender,
    trackEvent,
    trackAsync,
    startMemoryTracking,
    stopMemoryTracking,
    getReport,
    clearMetrics,
  };
}
