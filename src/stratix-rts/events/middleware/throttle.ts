import type { RTSEventName } from '../types/RTSEventTypes';
import { ThrottleConfig } from '../types/RTSEventTypes';

import type { Middleware, MiddlewareContext } from './types';

interface ThrottleState {
  lastEmit: number;
  pendingData: unknown;
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
        pendingData: null,
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
      state.pendingData = ctx.data;
      
      if (!state.timeoutId) {
        state.timeoutId = setTimeout(() => {
          state.timeoutId = null;
          state.lastEmit = performance.now();
          if (state.pendingData !== null) {
            ctx.data = state.pendingData;
            ctx.next();
            state.pendingData = null;
          }
        }, throttleMs - elapsed);
      }
      
      ctx.abort = true;
    }
  };
}

export function clearThrottleState(event?: RTSEventName): void {
}
