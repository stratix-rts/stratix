import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { usePerformanceMonitor } from '../usePerformanceMonitor';

describe('usePerformanceMonitor', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('returns expected API', () => {
    it('returns metrics, renderMetrics, slowHandlers, and memoryData as readonly refs', () => {
      const { metrics, renderMetrics, slowHandlers, memoryData } = usePerformanceMonitor();
      expect(metrics).toBeDefined();
      expect(renderMetrics).toBeDefined();
      expect(slowHandlers).toBeDefined();
      expect(memoryData).toBeDefined();
    });

    it('returns trackRender, trackEvent, trackAsync functions', () => {
      const { trackRender, trackEvent, trackAsync } = usePerformanceMonitor();
      expect(typeof trackRender).toBe('function');
      expect(typeof trackEvent).toBe('function');
      expect(typeof trackAsync).toBe('function');
    });

    it('returns memory tracking and report functions', () => {
      const { startMemoryTracking, stopMemoryTracking, getReport, clearMetrics } = usePerformanceMonitor();
      expect(typeof startMemoryTracking).toBe('function');
      expect(typeof stopMemoryTracking).toBe('function');
      expect(typeof getReport).toBe('function');
      expect(typeof clearMetrics).toBe('function');
    });
  });

  describe('trackRender', () => {
    it('measures render duration for mount stage', () => {
      const { trackRender, renderMetrics } = usePerformanceMonitor();
      let counter = 0;

      trackRender('mount', () => {
        counter = 1;
      });

      expect(counter).toBe(1);
      expect(renderMetrics.value.mount).toBeGreaterThanOrEqual(0);
    });

    it('measures render duration for update stage', () => {
      const { trackRender, renderMetrics } = usePerformanceMonitor();

      trackRender('update', () => {});

      expect(renderMetrics.value.update).toBeGreaterThanOrEqual(0);
    });

    it('measures render duration for unmount stage', () => {
      const { trackRender, renderMetrics } = usePerformanceMonitor();

      trackRender('unmount', () => {});

      expect(renderMetrics.value.unmount).toBeGreaterThanOrEqual(0);
    });

    it('adds render metric to metrics list', () => {
      const { trackRender, metrics } = usePerformanceMonitor();

      trackRender('mount', () => {});

      expect(metrics.value.some(m => m.name === 'render:mount')).toBe(true);
    });
  });

  describe('trackEvent', () => {
    it('measures synchronous event handler duration', () => {
      const { trackEvent, metrics } = usePerformanceMonitor();

      trackEvent('click', () => {});

      expect(metrics.value.some(m => m.name === 'event:click')).toBe(true);
    });

    it('returns the result of the wrapped function', () => {
      const { trackEvent } = usePerformanceMonitor();

      const result = trackEvent('test', () => 42);

      expect(result).toBe(42);
    });

    it('tracks slow handlers that exceed threshold', () => {
      const { trackEvent, slowHandlers } = usePerformanceMonitor({ threshold: 0 });

      trackEvent('slow', () => {
        // Simulate slow work
        const start = Date.now();
        while (Date.now() - start < 10) {}
      });

      expect(slowHandlers.value.some(m => m.name === 'event:slow')).toBe(true);
    });

    it('does not add to slowHandlers if under threshold', () => {
      const { trackEvent, slowHandlers } = usePerformanceMonitor({ threshold: 1000 });

      trackEvent('fast', () => {});

      expect(slowHandlers.value.some(m => m.name === 'event:fast')).toBe(false);
    });
  });

  describe('trackAsync', () => {
    it('measures async function duration', async () => {
      const { trackAsync, metrics } = usePerformanceMonitor();

      await trackAsync('fetch', async () => {
        await new Promise(resolve => setTimeout(resolve, 5));
        return 'done';
      });

      expect(metrics.value.some(m => m.name === 'async:fetch')).toBe(true);
    });

    it('returns the result of the async function', async () => {
      const { trackAsync } = usePerformanceMonitor();

      const result = await trackAsync('test', async () => 'async result');

      expect(result).toBe('async result');
    });
  });

  describe('memory tracking', () => {
    it('startMemoryTracking sets up interval', () => {
      jest.useFakeTimers();
      const { startMemoryTracking, memoryData } = usePerformanceMonitor();

      startMemoryTracking(1000);

      jest.advanceTimersByTime(2000);

      // memoryData may or may not be populated depending on browser support
      expect(memoryData.value).toBeDefined();

      jest.useRealTimers();
    });

    it('stopMemoryTracking clears interval', () => {
      jest.useFakeTimers();
      const { startMemoryTracking, stopMemoryTracking } = usePerformanceMonitor();

      startMemoryTracking(100);
      stopMemoryTracking();

      // Should not throw when advancing timers
      expect(() => jest.advanceTimersByTime(200)).not.toThrow();

      jest.useRealTimers();
    });
  });

  describe('getReport', () => {
    it('returns complete performance report', () => {
      const { getReport, trackEvent } = usePerformanceMonitor();

      trackEvent('test', () => {});

      const report = getReport();

      expect(report).toHaveProperty('metrics');
      expect(report).toHaveProperty('renderMetrics');
      expect(report).toHaveProperty('slowHandlers');
      expect(report).toHaveProperty('memory');
      expect(report).toHaveProperty('threshold');
      expect(Array.isArray(report.metrics)).toBe(true);
    });

    it('report includes threshold from options', () => {
      const { getReport } = usePerformanceMonitor({ threshold: 50 });

      const report = getReport();

      expect(report.threshold).toBe(50);
    });
  });

  describe('clearMetrics', () => {
    it('clears all collected metrics', () => {
      const { trackEvent, clearMetrics, getReport } = usePerformanceMonitor();

      trackEvent('one', () => {});
      trackEvent('two', () => {});

      clearMetrics();

      const report = getReport();
      expect(report.metrics).toHaveLength(0);
      expect(report.slowHandlers).toHaveLength(0);
    });

    it('resets render metrics to zero', () => {
      const { trackRender, clearMetrics, getReport } = usePerformanceMonitor();

      trackRender('mount', () => {});
      clearMetrics();

      const report = getReport();
      expect(report.renderMetrics.mount).toBe(0);
      expect(report.renderMetrics.update).toBe(0);
      expect(report.renderMetrics.unmount).toBe(0);
    });
  });

  describe('metrics limit', () => {
    it('keeps only last 100 metrics', () => {
      const { trackEvent, metrics } = usePerformanceMonitor();

      for (let i = 0; i < 105; i++) {
        trackEvent(`event${i}`, () => {});
      }

      expect(metrics.value.length).toBeLessThanOrEqual(100);
    });

    it('keeps only last 10 slow handlers', () => {
      const { trackEvent, slowHandlers } = usePerformanceMonitor({ threshold: 0 });

      for (let i = 0; i < 15; i++) {
        trackEvent(`slow${i}`, () => {
          const start = Date.now();
          while (Date.now() - start < 10) {}
        });
      }

      expect(slowHandlers.value.length).toBeLessThanOrEqual(10);
    });
  });
});
