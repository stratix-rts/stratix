/**
 * ZoneCoordinatorEvents - Event system for ZoneCoordinator
 *
 * Provides a singleton event emitter for ZoneCoordinator lifecycle events
 * so other modules (like OrchestrationSync) can subscribe to them.
 */

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

type ListenerMap = Map<ZoneCoordinatorEvent, Set<ZoneCoordinatorEventCallback>>;
type WildcardListeners = Set<ZoneCoordinatorEventCallback>;

class ZoneCoordinatorEventEmitter {
  private static instance: ZoneCoordinatorEventEmitter;

  private listeners: ListenerMap = new Map();
  private wildcardListeners: WildcardListeners = new Set();

  private constructor() {}

  static getInstance(): ZoneCoordinatorEventEmitter {
    if (!ZoneCoordinatorEventEmitter.instance) {
      ZoneCoordinatorEventEmitter.instance = new ZoneCoordinatorEventEmitter();
    }
    return ZoneCoordinatorEventEmitter.instance;
  }

  /**
   * Subscribe to a specific event
   */
  on(event: ZoneCoordinatorEvent, callback: ZoneCoordinatorEventCallback): void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(callback);
  }

  /**
   * Unsubscribe from a specific event
   */
  off(event: ZoneCoordinatorEvent, callback: ZoneCoordinatorEventCallback): void {
    const callbacks = this.listeners.get(event);
    if (callbacks) {
      callbacks.delete(callback);
      if (callbacks.size === 0) {
        this.listeners.delete(event);
      }
    }
  }

  /**
   * Subscribe to all events (wildcard)
   */
  onAny(callback: ZoneCoordinatorEventCallback): void {
    this.wildcardListeners.add(callback);
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
    // Notify specific event listeners
    const callbacks = this.listeners.get(payload.type);
    if (callbacks) {
      for (const callback of callbacks) {
        try {
          callback(payload);
        } catch (error) {
          console.error(`[ZoneCoordinatorEventEmitter] Error in callback for ${payload.type}:`, error);
        }
      }
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
}

export default ZoneCoordinatorEventEmitter;
