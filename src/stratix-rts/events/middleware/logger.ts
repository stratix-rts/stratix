import type { RTSEventName } from '../types/RTSEventTypes';

import type { Middleware, MiddlewareContext } from './types';

type LogFilter = (event: RTSEventName) => boolean;

const defaultFilter: LogFilter = () => true;

export function createLoggerMiddleware(
  options?: {
    filter?: LogFilter;
    logData?: boolean;
    logTiming?: boolean;
  }
): Middleware {
  const filter = options?.filter ?? defaultFilter;
  const logData = options?.logData ?? true;
  const logTiming = options?.logTiming ?? false;

  return <K extends RTSEventName>(ctx: MiddlewareContext<K>) => {
    if (!filter(ctx.event)) {
      ctx.next();
      return;
    }

    const startTime = logTiming ? performance.now() : 0;

    const extras: Record<string, unknown> = {};
    if (logData) {
      extras.data = ctx.data;
    }

    console.log(`[RTS Event] ${ctx.event}`, extras);

    ctx.next();

    if (logTiming) {
      const duration = performance.now() - startTime;
      if (duration > 1) {
        console.log(`[RTS Event] ${ctx.event} completed in ${duration.toFixed(2)}ms`);
      }
    }
  };
}

export function createErrorMiddleware(
  options?: {
    onError?: (error: Error, event: RTSEventName, data: unknown) => void;
  }
): Middleware {
  const onError = options?.onError ?? ((error, event, data) => {
    console.error(`[RTS Error] Error in event "${event}":`, error, data);
  });

  return <K extends RTSEventName>(ctx: MiddlewareContext<K>) => {
    try {
      ctx.next();
    } catch (error) {
      onError(error as Error, ctx.event, ctx.data);
    }
  };
}
