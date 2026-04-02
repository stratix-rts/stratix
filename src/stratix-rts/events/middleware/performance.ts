import type { RTSEventName } from '../types/RTSEventTypes';

import type { Middleware, MiddlewareContext } from './types';

export interface PerformanceStats {
  totalEvents: number;
  eventsPerSecond: number;
  averageLatency: number;
  slowEvents: Array<{ event: RTSEventName; duration: number; timestamp: number }>;
  eventCounts: Map<RTSEventName, number>;
}

export interface PerformanceMiddleware extends Middleware {
  getStats: () => PerformanceStats;
  reset: () => void;
}

export function createPerformanceMiddleware(
  options?: {
    slowThreshold?: number;
    maxSlowEvents?: number;
    onSlowEvent?: (event: RTSEventName, duration: number, data: unknown) => void;
  }
): PerformanceMiddleware {
  const slowThreshold = options?.slowThreshold ?? 5;
  const maxSlowEvents = options?.maxSlowEvents ?? 50;
  const onSlowEvent = options?.onSlowEvent;

  let totalEvents = 0;
  let totalLatency = 0;
  let eventCounts = new Map<RTSEventName, number>();
  let slowEvents: Array<{ event: RTSEventName; duration: number; timestamp: number }> = [];
  let startTime = performance.now();

  const middleware = <K extends RTSEventName>(ctx: MiddlewareContext<K>) => {
    const eventStart = performance.now();

    const originalNext = ctx.next;
    ctx.next = () => {
      const duration = performance.now() - eventStart;
      
      totalEvents++;
      totalLatency += duration;
      
      const currentCount = eventCounts.get(ctx.event) ?? 0;
      eventCounts.set(ctx.event, currentCount + 1);

      if (duration > slowThreshold) {
        const slowEvent = {
          event: ctx.event,
          duration,
          timestamp: Date.now(),
        };
        
        slowEvents.push(slowEvent);
        if (slowEvents.length > maxSlowEvents) {
          slowEvents.shift();
        }

        if (onSlowEvent) {
          onSlowEvent(ctx.event, duration, ctx.data);
        }
      }

      originalNext();
    };

    ctx.next();
  };

  middleware.getStats = (): PerformanceStats => {
    const elapsed = (performance.now() - startTime) / 1000;
    return {
      totalEvents,
      eventsPerSecond: elapsed > 0 ? totalEvents / elapsed : 0,
      averageLatency: totalEvents > 0 ? totalLatency / totalEvents : 0,
      slowEvents: [...slowEvents],
      eventCounts: new Map(eventCounts),
    };
  };

  middleware.reset = (): void => {
    totalEvents = 0;
    totalLatency = 0;
    eventCounts = new Map();
    slowEvents = [];
    startTime = performance.now();
  };

  return middleware;
}
