import type { RTSEventName } from '../types/RTSEventTypes';

export interface MiddlewareContext<K extends RTSEventName = RTSEventName> {
  event: K;
  data: unknown;
  timestamp: number;
  next: () => void;
  abort: boolean;
}

export type Middleware = <K extends RTSEventName>(
  ctx: MiddlewareContext<K>
) => void | Promise<void>;

export interface MiddlewareOptions {
  enabled: boolean;
}

export function composeMiddleware(middlewares: Middleware[]): (ctx: MiddlewareContext) => Promise<void> {
  return async (ctx: MiddlewareContext) => {
    let index = 0;

    const dispatch = async (): Promise<void> => {
      if (ctx.abort) {
        return;
      }

      if (index >= middlewares.length) {
        ctx.next();
        return;
      }

      const middleware = middlewares[index++];
      await middleware(ctx);
    };

    ctx.next = dispatch;
    await dispatch();
  };
}
