import { rtsEventBus } from '../events/core/RTSEventBus';

export interface StateChangeEvent {
  type: string;
  timestamp: number;
  source: 'user' | 'system' | 'sync';
  data: any;
  previousState?: any;
  newState?: any;
}

export interface StateFlowConfig {
  maxHistorySize?: number;
  enableLogging?: boolean;
  persistToStorage?: boolean;
}

export class ZoneStateFlow {
  private eventLog: StateChangeEvent[] = [];
  private maxHistorySize: number;
  private enableLogging: boolean;
  private persistToStorage: boolean;
  private stateSubscribers: Map<string, Set<(event: StateChangeEvent) => void>> = new Map();
  
  constructor(config: StateFlowConfig = {}) {
    this.maxHistorySize = config.maxHistorySize || 1000;
    this.enableLogging = config.enableLogging || false;
    this.persistToStorage = config.persistToStorage || false;
    
    this.setupEventListeners();
  }

  private setupEventListeners(): void {
    rtsEventBus.on('zone:created' as any, (event: any) => {
      this.recordEvent({
        type: 'zone:created',
        timestamp: Date.now(),
        source: event.isUndo ? 'system' : event.isRedo ? 'system' : 'user',
        data: event,
        newState: event.zoneConfig
      });
    });

    rtsEventBus.on('zone:deleted' as any, (event: any) => {
      this.recordEvent({
        type: 'zone:deleted',
        timestamp: Date.now(),
        source: event.isUndo ? 'system' : event.isRedo ? 'system' : 'user',
        data: event,
        previousState: event.zoneConfig
      });
    });

    rtsEventBus.on('zone:moved' as any, (event: any) => {
      this.recordEvent({
        type: 'zone:moved',
        timestamp: Date.now(),
        source: event.isUndo ? 'system' : event.isRedo ? 'system' : 'user',
        data: event,
        newState: event.position
      });
    });

    rtsEventBus.on('zone:resized' as any, (event: any) => {
      this.recordEvent({
        type: 'zone:resized',
        timestamp: Date.now(),
        source: event.isUndo ? 'system' : event.isRedo ? 'system' : 'user',
        data: event,
        newState: event.size
      });
    });

    rtsEventBus.on('zone:selected' as any, (event: any) => {
      this.recordEvent({
        type: 'zone:selected',
        timestamp: Date.now(),
        source: 'user',
        data: event,
        newState: { selectedZoneIds: event.zoneIds }
      });
    });

    rtsEventBus.on('zone:deselected' as any, (event: any) => {
      this.recordEvent({
        type: 'zone:deselected',
        timestamp: Date.now(),
        source: 'user',
        data: event,
        previousState: { selectedZoneIds: event.zoneIds }
      });
    });

    rtsEventBus.on('zone:synced' as any, (event: any) => {
      this.recordEvent({
        type: 'zone:synced',
        timestamp: Date.now(),
        source: 'sync',
        data: event,
        newState: { status: event.status }
      });
    });

    rtsEventBus.on('history:changed' as any, (event: any) => {
      this.recordEvent({
        type: 'history:changed',
        timestamp: Date.now(),
        source: 'system',
        data: event
      });
    });
  }

  private recordEvent(event: StateChangeEvent): void {
    this.eventLog.push(event);

    if (this.eventLog.length > this.maxHistorySize) {
      this.eventLog.shift();
    }

    if (this.enableLogging) {
      console.log('[StateFlow]', event);
    }

    this.notifySubscribers(event);

    if (this.persistToStorage) {
      this.persistEvent(event);
    }
  }

  subscribe(eventType: string, callback: (event: StateChangeEvent) => void): () => void {
    if (!this.stateSubscribers.has(eventType)) {
      this.stateSubscribers.set(eventType, new Set());
    }
    
    this.stateSubscribers.get(eventType)!.add(callback);

    return () => {
      const subscribers = this.stateSubscribers.get(eventType);
      if (subscribers) {
        subscribers.delete(callback);
      }
    };
  }

  private notifySubscribers(event: StateChangeEvent): void {
    const subscribers = this.stateSubscribers.get(event.type);
    if (subscribers) {
      subscribers.forEach(callback => callback(event));
    }

    const allSubscribers = this.stateSubscribers.get('*');
    if (allSubscribers) {
      allSubscribers.forEach(callback => callback(event));
    }
  }

  getEventLog(filter?: {
    type?: string;
    source?: 'user' | 'system' | 'sync';
    startTime?: number;
    endTime?: number;
  }): StateChangeEvent[] {
    let events = [...this.eventLog];

    if (filter) {
      if (filter.type) {
        events = events.filter(e => e.type === filter.type);
      }
      if (filter.source) {
        events = events.filter(e => e.source === filter.source);
      }
      if (filter.startTime) {
        events = events.filter(e => e.timestamp >= filter.startTime!);
      }
      if (filter.endTime) {
        events = events.filter(e => e.timestamp <= filter.endTime!);
      }
    }

    return events;
  }

  getEventCount(filter?: {
    type?: string;
    source?: 'user' | 'system' | 'sync';
  }): number {
    return this.getEventLog(filter).length;
  }

  getLastEvent(eventType?: string): StateChangeEvent | undefined {
    if (eventType) {
      const events = this.eventLog.filter(e => e.type === eventType);
      return events[events.length - 1];
    }
    return this.eventLog[this.eventLog.length - 1];
  }

  clearLog(): void {
    this.eventLog = [];
  }

  exportLog(): string {
    return JSON.stringify(this.eventLog, null, 2);
  }

  importLog(jsonLog: string): void {
    try {
      const events = JSON.parse(jsonLog);
      if (Array.isArray(events)) {
        this.eventLog = events;
      }
    } catch (error) {
      console.error('Failed to import event log:', error);
    }
  }

  private persistEvent(event: StateChangeEvent): void {
    try {
      const storageKey = 'stratix_zone_state_log';
      const stored = localStorage.getItem(storageKey);
      const log = stored ? JSON.parse(stored) : [];
      
      log.push(event);
      
      const trimmed = log.slice(-this.maxHistorySize);
      localStorage.setItem(storageKey, JSON.stringify(trimmed));
    } catch (error) {
      console.error('Failed to persist event:', error);
    }
  }

  loadPersistedLog(): void {
    try {
      const storageKey = 'stratix_zone_state_log';
      const stored = localStorage.getItem(storageKey);
      
      if (stored) {
        const log = JSON.parse(stored);
        if (Array.isArray(log)) {
          this.eventLog = log;
        }
      }
    } catch (error) {
      console.error('Failed to load persisted log:', error);
    }
  }

  getStatistics(): {
    totalEvents: number;
    userEvents: number;
    systemEvents: number;
    syncEvents: number;
    eventTypeDistribution: Record<string, number>;
  } {
    const stats = {
      totalEvents: this.eventLog.length,
      userEvents: 0,
      systemEvents: 0,
      syncEvents: 0,
      eventTypeDistribution: {} as Record<string, number>
    };

    this.eventLog.forEach(event => {
      if (event.source === 'user') stats.userEvents++;
      else if (event.source === 'system') stats.systemEvents++;
      else if (event.source === 'sync') stats.syncEvents++;

      if (!stats.eventTypeDistribution[event.type]) {
        stats.eventTypeDistribution[event.type] = 0;
      }
      stats.eventTypeDistribution[event.type]++;
    });

    return stats;
  }

  destroy(): void {
    this.eventLog = [];
    this.stateSubscribers.clear();
  }
}