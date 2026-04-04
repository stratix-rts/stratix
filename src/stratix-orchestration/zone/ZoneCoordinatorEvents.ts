/**
 * ZoneCoordinatorEvents - Event system for ZoneCoordinator
 *
 * Provides a singleton event emitter for ZoneCoordinator lifecycle events
 * so other modules (like OrchestrationSync) can subscribe to them.
 *
 * Uses mitt for typed event handling with wildcard listener support.
 */

import mitt, { Emitter } from 'mitt';

export type ZoneCoordinatorEvent =
  | 'task_delegated'
  | 'task_completed'
  | 'task_failed'
  | 'task_claimed'
  | 'requirement_received'
  | 'requirement_decomposed'
  | 'task_created'
  | 'task_reassigned';

export interface ZoneCoordinatorEventPayload {
  type: ZoneCoordinatorEvent;
  zoneId: string;
  taskId?: string;
  agentId?: string;
  previousAgentId?: string;
  requirement?: string;
  tasks?: Array<{
    id: string;
    title: string;
    type: string;
    priority: number;
  }>;
  report?: {
    success: boolean;
    output?: string;
    files?: string[];
    issues?: string[];
    duration?: number;
  };
  timestamp: number;
}

export type ZoneCoordinatorEventCallback = (payload: ZoneCoordinatorEventPayload) => void;

class ZoneCoordinatorEventEmitter {
  private static instance: ZoneCoordinatorEventEmitter;
  private emitter: Emitter<Record<string, ZoneCoordinatorEventPayload>>;
  private wildcardListeners: Set<ZoneCoordinatorEventCallback> = new Set();

  private constructor() {
    this.emitter = mitt<Record<string, ZoneCoordinatorEventPayload>>();
  }

  static getInstance(): ZoneCoordinatorEventEmitter {
    if (!ZoneCoordinatorEventEmitter.instance) {
      ZoneCoordinatorEventEmitter.instance = new ZoneCoordinatorEventEmitter();
    }
    return ZoneCoordinatorEventEmitter.instance;
  }

  /**
   * Subscribe to a specific event
   */
  on(event: ZoneCoordinatorEvent, callback: ZoneCoordinatorEventCallback): () => void {
    this.emitter.on(event, callback);
    return () => this.off(event, callback);
  }

  /**
   * Unsubscribe from a specific event
   */
  off(event: ZoneCoordinatorEvent, callback: ZoneCoordinatorEventCallback): void {
    this.emitter.off(event, callback);
  }

  /**
   * Subscribe to all events (wildcard)
   */
  onAny(callback: ZoneCoordinatorEventCallback): () => void {
    this.wildcardListeners.add(callback);
    return () => this.offAny(callback);
  }

  /**
   * Unsubscribe from all events
   */
  offAny(callback: ZoneCoordinatorEventCallback): void {
    this.wildcardListeners.delete(callback);
  }

  /**
   * Emit an event to all subscribers
   */
  emit(payload: ZoneCoordinatorEventPayload): void {
    // Notify specific event listeners with error isolation
    try {
      this.emitter.emit(payload.type, payload);
    } catch (error) {
      console.error('[ZoneCoordinatorEventEmitter] Error in specific listener:', error);
    }

    // Notify wildcard listeners
    for (const callback of this.wildcardListeners) {
      try {
        callback(payload);
      } catch (error) {
        console.error('[ZoneCoordinatorEventEmitter] Error in wildcard callback:', error);
      }
    }
  }

  /**
   * Clear all listeners (for testing)
   */
  clearAll(): void {
    this.emitter.all.clear();
    this.wildcardListeners.clear();
  }
}

export default ZoneCoordinatorEventEmitter;
