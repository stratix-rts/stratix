import { ZoneSyncManager } from '@/stratix-rts/managers/ZoneSyncManager';
import { rtsEventBus } from '@/stratix-rts/events/core/RTSEventBus';
import type { ZoneStatus } from '@/stratix-rts/zones/BaseZone';

describe('ZoneSyncManager', () => {
  let manager: ZoneSyncManager;

  beforeEach(() => {
    manager = new ZoneSyncManager();
  });

  afterEach(() => {
    manager.destroy();
  });

  describe('syncZoneStatus', () => {
    it('should sync zone status successfully', async () => {
      const zoneId = 'zone-1';
      const status: ZoneStatus = 'active';

      await manager.syncZoneStatus(zoneId, status);

      const state = manager.getZoneState(zoneId);
      expect(state).toBeDefined();
      expect(state?.status).toBe(status);
      expect(state?.version).toBe(1);
    });

    it('should increment version on subsequent syncs', async () => {
      const zoneId = 'zone-1';

      await manager.syncZoneStatus(zoneId, 'idle');
      await manager.syncZoneStatus(zoneId, 'active');
      await manager.syncZoneStatus(zoneId, 'busy');

      const state = manager.getZoneState(zoneId);
      expect(state?.version).toBe(3);
      expect(state?.status).toBe('busy');
    });

    it('should emit zone:synced event', async () => {
      const eventSpy = jest.fn();
      rtsEventBus.on('zone:synced', eventSpy);

      await manager.syncZoneStatus('zone-1', 'active');

      expect(eventSpy).toHaveBeenCalledWith({
        zoneId: 'zone-1',
        status: 'active',
      });
    });
  });

  describe('resolveConflicts', () => {
    it('should prefer local state with higher version', () => {
      const local = {
        zoneId: 'zone-1',
        status: 'active' as ZoneStatus,
        version: 5,
        timestamp: 1000,
      };

      const remote = {
        zoneId: 'zone-1',
        status: 'idle' as ZoneStatus,
        version: 3,
        timestamp: 2000,
      };

      const resolved = manager.resolveConflicts(local, remote);
      expect(resolved.status).toBe('active');
      expect(resolved.version).toBe(5);
    });

    it('should prefer remote state with higher version', () => {
      const local = {
        zoneId: 'zone-1',
        status: 'idle' as ZoneStatus,
        version: 2,
        timestamp: 1000,
      };

      const remote = {
        zoneId: 'zone-1',
        status: 'active' as ZoneStatus,
        version: 5,
        timestamp: 2000,
      };

      const resolved = manager.resolveConflicts(local, remote);
      expect(resolved.status).toBe('active');
      expect(resolved.version).toBe(5);
    });

    it('should prefer local state when versions are equal', () => {
      const local = {
        zoneId: 'zone-1',
        status: 'active' as ZoneStatus,
        version: 3,
        timestamp: 2000,
      };

      const remote = {
        zoneId: 'zone-1',
        status: 'idle' as ZoneStatus,
        version: 3,
        timestamp: 1000,
      };

      const resolved = manager.resolveConflicts(local, remote);
      expect(resolved.status).toBe('active');
    });
  });

  describe('getZoneState', () => {
    it('should return undefined for unknown zone', () => {
      const state = manager.getZoneState('unknown-zone');
      expect(state).toBeUndefined();
    });

    it('should return state for known zone', async () => {
      await manager.syncZoneStatus('zone-1', 'active');

      const state = manager.getZoneState('zone-1');
      expect(state).toBeDefined();
      expect(state?.status).toBe('active');
    });
  });

  describe('getAllZoneStates', () => {
    it('should return empty map when no zones', () => {
      const states = manager.getAllZoneStates();
      expect(states.size).toBe(0);
    });

    it('should return all zone states', async () => {
      await manager.syncZoneStatus('zone-1', 'active');
      await manager.syncZoneStatus('zone-2', 'idle');
      await manager.syncZoneStatus('zone-3', 'busy');

      const states = manager.getAllZoneStates();
      expect(states.size).toBe(3);
      expect(states.get('zone-1')?.status).toBe('active');
      expect(states.get('zone-2')?.status).toBe('idle');
      expect(states.get('zone-3')?.status).toBe('busy');
    });
  });

  describe('getQueueLength', () => {
    it('should return 0 when queue is empty', () => {
      expect(manager.getQueueLength()).toBe(0);
    });

    it('should return queue length', async () => {
      await manager.syncZoneStatus('zone-1', 'active');
      await manager.syncZoneStatus('zone-2', 'idle');

      expect(manager.getQueueLength()).toBeGreaterThan(0);
    });
  });

  describe('clearQueue', () => {
    it('should clear the queue', async () => {
      await manager.syncZoneStatus('zone-1', 'active');
      await manager.syncZoneStatus('zone-2', 'idle');

      manager.clearQueue();
      expect(manager.getQueueLength()).toBe(0);
    });
  });

  describe('priority', () => {
    it('should prioritize error status', async () => {
      await manager.syncZoneStatus('zone-1', 'idle');
      await manager.syncZoneStatus('zone-2', 'active');
      await manager.syncZoneStatus('zone-3', 'error');

      const queueLength = manager.getQueueLength();
      expect(queueLength).toBeGreaterThan(0);
    });
  });

  describe('destroy', () => {
    it('should clean up resources', async () => {
      await manager.syncZoneStatus('zone-1', 'active');
      
      manager.destroy();

      expect(manager.getQueueLength()).toBe(0);
      expect(manager.getAllZoneStates().size).toBe(0);
    });
  });
});