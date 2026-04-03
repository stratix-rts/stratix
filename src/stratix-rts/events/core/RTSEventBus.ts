import mitt from 'mitt';
import type Phaser from 'phaser';

import { createErrorMiddleware, createLoggerMiddleware } from '../middleware/logger';
import { createThrottleMiddleware } from '../middleware/throttle';
import type { Middleware, MiddlewareContext } from '../middleware/types';
import { composeMiddleware } from '../middleware/types';
import type {
  RTSEventName,
  RTSEventData,
  AllRTSEvents,
  RequestResponseMap,
} from '../types/RTSEventTypes';

import { EventQueue } from './EventQueue';

type EventHandler<T = unknown> = (data: T) => void;
type ResponseHandler<T = unknown, R = unknown> = (data: T) => R | Promise<R>;

interface SceneRegistry {
  game: Phaser.Scene | null;
  ui: Phaser.Scene | null;
}

export class RTSEventBus {
  private static instance: RTSEventBus;
  private emitter = mitt<Record<string, unknown>>();
  private queue: EventQueue;
  private middlewares: Middleware[] = [];
  private composedMiddleware: ((ctx: MiddlewareContext) => Promise<void>) | null = null;
  private responseHandlers = new Map<string, ResponseHandler[]>();
  private scenes: SceneRegistry = { game: null, ui: null };
  private isProcessing = false;
  private enabled = true;

  private constructor() {
    this.queue = new EventQueue();
    this.setupDefaultMiddlewares();
  }

  static getInstance(): RTSEventBus {
    if (!RTSEventBus.instance) {
      RTSEventBus.instance = new RTSEventBus();
    }
    return RTSEventBus.instance;
  }

  static destroyInstance(): void {
    if (RTSEventBus.instance) {
      RTSEventBus.instance.destroy();
      RTSEventBus.instance = undefined as unknown as RTSEventBus;
    }
  }

  private setupDefaultMiddlewares(): void {
    this.middlewares.push(createErrorMiddleware());
  }

  addMiddleware(middleware: Middleware): void {
    this.middlewares.push(middleware);
    this.composedMiddleware = composeMiddleware(this.middlewares);
  }

  on<K extends RTSEventName>(
    event: K,
    handler: EventHandler<RTSEventData<K>>
  ): () => void {
    this.emitter.on(event, handler as EventHandler);
    return () => this.off(event, handler);
  }

  once<K extends RTSEventName>(
    event: K,
    handler: EventHandler<RTSEventData<K>>
  ): () => void {
    const wrappedHandler: EventHandler<RTSEventData<K>> = (data) => {
      this.off(event, wrappedHandler);
      handler(data);
    };
    return this.on(event, wrappedHandler);
  }

  off<K extends RTSEventName>(
    event: K,
    handler?: EventHandler<RTSEventData<K>>
  ): void {
    if (handler) {
      this.emitter.off(event, handler as EventHandler);
    } else {
      this.emitter.off(event);
    }
  }

  onAny(handler: (event: string, data: unknown) => void): () => void {
    this.emitter.on('*', handler as EventHandler);
    return () => this.offAny(handler);
  }

  offAny(handler: (event: string, data: unknown) => void): void {
    this.emitter.off('*', handler as EventHandler);
  }

  emit<K extends RTSEventName>(event: K, data: RTSEventData<K>): void {
    if (!this.enabled) return;

    if (this.middlewares.length > 0 && this.composedMiddleware) {
      const ctx: MiddlewareContext<K> = {
        event,
        data,
        timestamp: performance.now(),
        next: () => {
          this.emitter.emit(event, data);
        },
        abort: false,
      };

      this.composedMiddleware(ctx).catch((error) => {
        console.error(`[RTSEventBus] Middleware error for ${event}:`, error);
      });
    } else {
      this.emitter.emit(event, data);
    }
  }

  emitQueued<K extends RTSEventName>(event: K, data: RTSEventData<K>): void {
    if (!this.enabled) return;
    this.queue.enqueue(event, data);
  }

  processQueue(maxEvents: number = 100): void {
    if (this.isProcessing) return;
    this.isProcessing = true;

    try {
      const events = this.queue.dequeueBatch(maxEvents);
      for (const { event, data } of events) {
        this.emit(event as RTSEventName, data as AllRTSEvents[RTSEventName]);
      }
    } finally {
      this.isProcessing = false;
    }
  }

  async request<K extends keyof RequestResponseMap>(
    event: K,
    data: RequestResponseMap[K]['request']
  ): Promise<RequestResponseMap[K]['response']> {
    const handlers = this.responseHandlers.get(event);
    if (!handlers || handlers.length === 0) {
      console.warn(`[RTSEventBus] No response handler for ${event}`);
      return null as RequestResponseMap[K]['response'];
    }

    try {
      const result = await handlers[0](data);
      return result as RequestResponseMap[K]['response'];
    } catch (error) {
        console.error(`[RTSEventBus] Request error for ${event}:`, error);
        return null as RequestResponseMap[K]['response'];
    }
  }

  respond<K extends keyof RequestResponseMap>(
    event: K,
    handler: ResponseHandler<RequestResponseMap[K]['request'], RequestResponseMap[K]['response']>
  ): () => void {
    if (!this.responseHandlers.has(event)) {
      this.responseHandlers.set(event, []);
    }
    this.responseHandlers.get(event)!.push(handler as ResponseHandler);

    return () => {
      const handlers = this.responseHandlers.get(event);
      if (handlers) {
        const index = handlers.indexOf(handler as ResponseHandler);
        if (index !== -1) {
          handlers.splice(index, 1);
        }
      }
    };
  }

  registerScene(name: 'game' | 'ui', scene: Phaser.Scene): void {
    this.scenes[name] = scene;
  }

  unregisterScene(name: 'game' | 'ui'): void {
    this.scenes[name] = null;
  }

  getScene(name: 'game' | 'ui'): Phaser.Scene | undefined {
    return this.scenes[name] ?? undefined;
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  getQueueLength(): number {
    return this.queue.length;
  }

  getQueueStats(): ReturnType<EventQueue['getStats']> {
    return this.queue.getStats();
  }

  clearQueue(): void {
    this.queue.clear();
  }

  destroy(): void {
    this.emitter.all.clear();
    this.queue.clear();
    this.responseHandlers.clear();
    this.middlewares = [];
    this.composedMiddleware = null;
    this.scenes = { game: null, ui: null };
  }
}

export const rtsEventBus = RTSEventBus.getInstance();
