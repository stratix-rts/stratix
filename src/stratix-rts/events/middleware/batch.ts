import type { RTSEventName } from '../types/RTSEventTypes';
import { BatchConfig } from '../types/RTSEventTypes';

import type { Middleware, MiddlewareContext } from './types';

interface BatchState<T = unknown> {
  items: T[];
  timeoutId: ReturnType<typeof setTimeout> | null;
}

export function createBatchMiddleware(
  config: Partial<Record<RTSEventName, { window: number; maxBatch: number }>> = {}
): Middleware {
  const states = new Map<RTSEventName, BatchState>();
  const batchHandlers = new Map<RTSEventName, (items: unknown[]) => void>();

  const getState = (event: RTSEventName): BatchState => {
    if (!states.has(event)) {
      states.set(event, { items: [], timeoutId: null });
    }
    return states.get(event)!;
  };

  const flush = <K extends RTSEventName>(event: K, ctx: MiddlewareContext<K>): void => {
    const state = getState(event);
    const handler = batchHandlers.get(event);
    
    if (state.items.length > 0 && handler) {
      handler(state.items);
      state.items = [];
    }
    
    if (state.timeoutId) {
      clearTimeout(state.timeoutId);
      state.timeoutId = null;
    }
  };

  return <K extends RTSEventName>(ctx: MiddlewareContext<K>) => {
    const batchConfig = config[ctx.event] ?? BatchConfig[ctx.event];
    
    if (!batchConfig) {
      ctx.next();
      return;
    }

    const state = getState(ctx.event);
    state.items.push(ctx.data);
    
    batchHandlers.set(ctx.event, (items) => {
      ctx.data = items;
      ctx.next();
    });

    if (state.items.length >= batchConfig.maxBatch) {
      flush(ctx.event, ctx);
    } else if (!state.timeoutId) {
      state.timeoutId = setTimeout(() => {
        state.timeoutId = null;
        flush(ctx.event, ctx);
      }, batchConfig.window);
    }
    
    ctx.abort = true;
  };
}

export function registerBatchHandler<K extends RTSEventName>(
  _event: K,
  _handler: (items: unknown[]) => void
): void {
  // Batch handlers are registered via the createBatchMiddleware config.
  // This function is a placeholder for future dynamic handler registration.
  console.debug('[BatchMiddleware] registerBatchHandler called (no-op)');
}
