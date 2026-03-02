import { EventPriority, type RTSEventName } from '../types/RTSEventTypes';
import { EventPriorityConfig } from '../types/RTSEventTypes';

interface QueuedEvent<K extends RTSEventName = RTSEventName> {
  event: K;
  data: unknown;
  priority: EventPriority;
  timestamp: number;
}

export class EventQueue {
  private queues: Map<EventPriority, QueuedEvent[]> = new Map();
  private pendingCount = 0;

  constructor() {
    Object.values(EventPriority).forEach((p) => {
      if (typeof p === 'number') {
        this.queues.set(p, []);
      }
    });
  }

  enqueue<K extends RTSEventName>(event: K, data: unknown): void {
    const priority = EventPriorityConfig[event] ?? EventPriority.NORMAL;
    const queuedEvent: QueuedEvent<K> = {
      event,
      data,
      priority,
      timestamp: performance.now(),
    };
    
    const queue = this.queues.get(priority);
    if (queue) {
      queue.push(queuedEvent);
      this.pendingCount++;
    }
  }

  dequeue(): QueuedEvent | null {
    for (const priority of [EventPriority.CRITICAL, EventPriority.HIGH, EventPriority.NORMAL, EventPriority.LOW]) {
    const queue = this.queues.get(priority);
    if (queue && queue.length > 0) {
      this.pendingCount--;
      return queue.shift() ?? null;
      }
    }
    return null;
  }

  dequeueBatch(maxCount: number): QueuedEvent[] {
    const result: QueuedEvent[] = [];
    
    while (result.length < maxCount && this.pendingCount > 0) {
      const event = this.dequeue();
      if (event) {
        result.push(event);
      } else {
        break;
      }
    }
    
    return result;
  }

  peek(): QueuedEvent | null {
    for (const priority of [EventPriority.CRITICAL, EventPriority.HIGH, EventPriority.NORMAL, EventPriority.LOW]) {
      const queue = this.queues.get(priority);
      if (queue && queue.length > 0) {
        return queue[0];
      }
    }
    return null;
  }

  get length(): number {
    return this.pendingCount;
  }

  isEmpty(): boolean {
    return this.pendingCount === 0;
  }

  clear(): void {
    this.queues.forEach((queue) => {
      queue.length = 0;
    });
    this.pendingCount = 0;
  }

  getStats(): Record<EventPriority, number> {
    const stats = {} as Record<EventPriority, number>;
    this.queues.forEach((queue, priority) => {
      stats[priority as EventPriority] = queue.length;
    });
    return stats;
  }
}
