import { rtsEventBus } from '../events/core/RTSEventBus';
import type { ZoneStatus } from '../zones/BaseZone';

export interface ZoneState {
  zoneId: string;
  status: ZoneStatus;
  version: number;
  timestamp: number;
  metadata?: Record<string, unknown>;
}

export interface SyncTask {
  zoneId: string;
  status: ZoneStatus;
  timestamp: number;
  priority: number;
}

export interface ConflictEvent {
  zoneId: string;
  localState: ZoneState;
  remoteState: ZoneState;
  resolvedState: ZoneState;
}

export interface ZoneChangeEvent {
  zoneId: string;
  oldStatus: string;
  newStatus: string;
  timestamp: number;
}

export class ZoneSyncManager {
  private syncQueue: SyncTask[] = [];
  private zoneStates = new Map<string, ZoneState>();
  private isProcessing = false;
  private syncInterval: NodeJS.Timeout | null = null;
  private readonly batchSize = 10;
  private readonly syncDelay = 100;
  private readonly maxRetries = 3;
  private retryCount = new Map<string, number>();

  constructor() {
    this.setupEventListeners();
  }

  private setupEventListeners(): void {
    rtsEventBus.on('zone:status_change', (data: ZoneChangeEvent) => {
      this.enqueueSync(data.zoneId, data.newStatus as ZoneStatus);
    });
  }

  async syncZoneStatus(zoneId: string, status: ZoneStatus): Promise<void> {
    const currentState = this.zoneStates.get(zoneId);
    const newState: ZoneState = {
      zoneId,
      status,
      version: (currentState?.version || 0) + 1,
      timestamp: Date.now(),
    };

    this.zoneStates.set(zoneId, newState);

    this.enqueueSync(zoneId, status);

    rtsEventBus.emit('zone:synced', { zoneId, status } as any);
  }

  private enqueueSync(zoneId: string, status: ZoneStatus): void {
    const priority = this.getPriority(status);

    const existingIndex = this.syncQueue.findIndex(task => task.zoneId === zoneId);
    
    if (existingIndex !== -1) {
      this.syncQueue[existingIndex] = { zoneId, status, timestamp: Date.now(), priority };
    } else {
      this.syncQueue.push({ zoneId, status, timestamp: Date.now(), priority });
    }

    this.syncQueue.sort((a, b) => a.priority - b.priority);

    this.scheduleSync();
  }

  private getPriority(status: ZoneStatus): number {
    switch (status) {
      case 'error':
        return 0;
      case 'busy':
        return 1;
      case 'active':
        return 2;
      case 'idle':
        return 3;
      case 'completed':
        return 4;
      default:
        return 5;
    }
  }

  private scheduleSync(): void {
    if (this.syncInterval) {
      return;
    }

    this.syncInterval = setTimeout(() => {
      this.processQueue();
    }, this.syncDelay);
  }

  private async processQueue(): Promise<void> {
    if (this.isProcessing || this.syncQueue.length === 0) {
      this.syncInterval = null;
      return;
    }

    this.isProcessing = true;

    try {
      const batch = this.syncQueue.splice(0, this.batchSize);
      
      await Promise.all(batch.map(task => this.processSyncTask(task)));
    } catch (error) {
      console.error('[ZoneSyncManager] Batch processing error:', error);
    } finally {
      this.isProcessing = false;
      this.syncInterval = null;

      if (this.syncQueue.length > 0) {
        this.scheduleSync();
      }
    }
  }

  private async processSyncTask(task: SyncTask): Promise<void> {
    try {
      const localState = this.zoneStates.get(task.zoneId);
      
      if (!localState) {
        console.warn(`[ZoneSyncManager] No local state for zone ${task.zoneId}`);
        return;
      }

      rtsEventBus.emit('zone:sync_complete', {
        zoneId: task.zoneId,
        status: task.status,
        version: localState.version,
      } as any);

      this.retryCount.delete(task.zoneId);
    } catch (error) {
      console.error(`[ZoneSyncManager] Sync failed for zone ${task.zoneId}:`, error);
      
      const retries = this.retryCount.get(task.zoneId) || 0;
      
      if (retries < this.maxRetries) {
        this.retryCount.set(task.zoneId, retries + 1);
        this.syncQueue.push(task);
      } else {
        rtsEventBus.emit('zone:sync_failed', {
          zoneId: task.zoneId,
          error: error instanceof Error ? error.message : 'Unknown error',
        } as any);
        
        this.retryCount.delete(task.zoneId);
      }
    }
  }

  resolveConflicts(local: ZoneState, remote: ZoneState): ZoneState {
    if (local.version > remote.version) {
      return local;
    } else if (remote.version > local.version) {
      return remote;
    } else {
      return local.timestamp >= remote.timestamp ? local : remote;
    }
  }

  getZoneState(zoneId: string): ZoneState | undefined {
    return this.zoneStates.get(zoneId);
  }

  getAllZoneStates(): Map<string, ZoneState> {
    return new Map(this.zoneStates);
  }

  getQueueLength(): number {
    return this.syncQueue.length;
  }

  clearQueue(): void {
    this.syncQueue = [];
    if (this.syncInterval) {
      clearTimeout(this.syncInterval);
      this.syncInterval = null;
    }
  }

  destroy(): void {
    this.clearQueue();
    this.zoneStates.clear();
    this.retryCount.clear();
    rtsEventBus.off('zone:status_change');
  }
}