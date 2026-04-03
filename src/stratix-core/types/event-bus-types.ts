/**
 * Stratix Core - Typed Event Bus Interface
 *
 * Defines the standard interface for all event buses in the Stratix system.
 * All event buses should conform to this interface to ensure consistent
 * event handling patterns across the codebase.
 *
 * Event buses are singleton instances that manage pub/sub communication
 * between modules. Each bus is scoped to a specific domain.
 */

/**
 * Standard event bus interface - all Stratix event buses should implement this
 */
export interface TypedEventBus<T extends Record<string, unknown>> {
  /**
   * Subscribe to an event
   * @param event Event name
   * @param handler Event handler function
   * @returns Unsubscribe function
   */
  on<K extends keyof T>(event: K, handler: (data: T[K]) => void): () => void;

  /**
   * Subscribe to an event only once (auto-unsubscribes after first trigger)
   * @param event Event name
   * @param handler Event handler function
   * @returns Unsubscribe function
   */
  once<K extends keyof T>(event: K, handler: (data: T[K]) => void): () => void;

  /**
   * Unsubscribe from an event
   * @param event Event name
   * @param handler Event handler function (optional, removes all handlers if omitted)
   */
  off<K extends keyof T>(event: K, handler?: (data: T[K]) => void): void;

  /**
   * Emit an event to all subscribers
   * @param event Event name
   * @param data Event data
   */
  emit<K extends keyof T>(event: K, data: T[K]): void;
}

/**
 * Event bus with wildcard listener support (subscribe to ALL events)
 */
export interface WildcardEventBus<T extends Record<string, unknown>>
  extends TypedEventBus<T> {
  /**
   * Subscribe to ALL events (wildcard listener)
   * @param handler Handler that receives all events
   * @returns Unsubscribe function
   */
  onAny(handler: (event: keyof T, data: T[keyof T]) => void): () => void;

  /**
   * Unsubscribe wildcard listener
   * @param handler Handler to remove
   */
  offAny(handler: (event: keyof T, data: T[keyof T]) => void): void;
}

/**
 * Event bus with enable/disable capability
 */
export interface EnableableEventBus<T extends Record<string, unknown>>
  extends TypedEventBus<T> {
  /**
   * Enable or disable the event bus
   */
  setEnabled(enabled: boolean): void;

  /**
   * Check if the event bus is enabled
   */
  isEnabled(): boolean;
}

/**
 * Event bus with queue processing capability
 */
export interface QueuedEventBus<T extends Record<string, unknown>>
  extends TypedEventBus<T> {
  /**
   * Queue an event for later processing (batch mode)
   */
  emitQueued<K extends keyof T>(event: K, data: T[K]): void;

  /**
   * Process all queued events
   * @param maxEvents Maximum number of events to process (default: 100)
   */
  processQueue(maxEvents?: number): void;

  /**
   * Get the number of queued events
   */
  getQueueLength(): number;

  /**
   * Clear all queued events
   */
  clearQueue(): void;
}

/**
 * Request/Response event bus for async communication
 */
export interface RequestResponseEventBus<
  T extends Record<string, unknown>,
  R extends Record<string, { request: unknown; response: unknown }>
> extends TypedEventBus<T> {
  /**
   * Send a request and wait for response
   */
  request<K extends keyof R>(
    event: K,
    data: R[K]['request']
  ): Promise<R[K]['response']>;

  /**
   * Register a response handler for a request event
   */
  respond<K extends keyof R>(
    event: K,
    handler: (data: R[K]['request']) => R[K]['response'] | Promise<R[K]['response']>
  ): () => void;
}

/**
 * Event bus factory - creates event bus instances
 */
export interface EventBusFactory {
  create<T extends Record<string, unknown>>(name: string): TypedEventBus<T>;
}
