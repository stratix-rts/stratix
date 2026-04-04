import type { RTSEventName } from '../types/RTSEventTypes';
import { ThrottleConfig } from '../types/RTSEventTypes';

import type { Middleware, MiddlewareContext } from './types';

interface ThrottleState {
  lastEmit: number;
  pendingData: unknown[];
  timeoutId: ReturnType<typeof setTimeout> | null;
}

export function createThrottleMiddleware(
  config: Partial<Record<RTSEventName, number>> = {}
): Middleware {
  const states = new Map<RTSEventName, ThrottleState>();
  const defaultThrottle = 16;

  const getState = (event: RTSEventName): ThrottleState => {
    if (!states.has(event)) {
      states.set(event, {
        lastEmit: 0,
        pendingData: [],
        timeoutId: null,
      });
    }
    return states.get(event)!;
  };

  return <K extends RTSEventName>(ctx: MiddlewareContext<K>) => {
    const throttleMs = config[ctx.event] ?? ThrottleConfig[ctx.event];

    if (!throttleMs) {
      ctx.next();
      return;
    }

    const state = getState(ctx.event);
    const now = performance.now();
    const elapsed = now - state.lastEmit;

    if (elapsed >= throttleMs) {
      state.lastEmit = now;
      ctx.next();
    } else {
      state.pendingData.push(ctx.data);

      if (!state.timeoutId) {
        const remainingMs = throttleMs - elapsed;
        state.timeoutId = setTimeout(() => {
          state.timeoutId = null;
          state.lastEmit = performance.now();
          const pending = state.pendingData;
          state.pendingData = [];
          for (const data of pending) {
            ctx.data = data;
            ctx.next();
          }
        }, remainingMs);
      }

      ctx.abort = true;
    }
  };
}

export function clearThrottleState(_event?: RTSEventName): void {
  // Throttle state is managed internally by the middleware instance.
  // This function is a placeholder for future state management needs.
  console.debug('[ThrottleMiddleware] clearThrottleState called (no-op)');
}
