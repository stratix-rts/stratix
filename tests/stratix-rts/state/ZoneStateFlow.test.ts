import { ZoneStateFlow, StateChangeEvent } from '@/stratix-rts/state/ZoneStateFlow';
import { rtsEventBus } from '@/stratix-rts/events/core/RTSEventBus';

describe('ZoneStateFlow', () => {
  let stateFlow: ZoneStateFlow;

  beforeEach(() => {
    stateFlow = new ZoneStateFlow({ enableLogging: false, persistToStorage: false });
  });

  afterEach(() => {
    stateFlow.destroy();
  });

  describe('event recording', () => {
    it('should record zone:created event', async () => {
      rtsEventBus.emit('zone:created' as any, {
        zoneId: 'zone-1',
        zoneConfig: { x: 0, y: 0, width: 100, height: 100 }
      });

      await new Promise(resolve => setTimeout(resolve, 10));

      const events = stateFlow.getEventLog({ type: 'zone:created' });
      expect(events).toHaveLength(1);
      expect(events[0].data.zoneId).toBe('zone-1');
    });

    it('should record zone:deleted event', async () => {
      rtsEventBus.emit('zone:deleted' as any, {
        zoneId: 'zone-1',
        zoneConfig: { x: 0, y: 0, width: 100, height: 100 }
      });

      await new Promise(resolve => setTimeout(resolve, 10));

      const events = stateFlow.getEventLog({ type: 'zone:deleted' });
      expect(events).toHaveLength(1);
    });

    it('should record zone:moved event', async () => {
      rtsEventBus.emit('zone:moved' as any, {
        zoneId: 'zone-1',
        position: { x: 100, y: 100 }
      });

      await new Promise(resolve => setTimeout(resolve, 10));

      const events = stateFlow.getEventLog({ type: 'zone:moved' });
      expect(events).toHaveLength(1);
      expect(events[0].newState).toEqual({ x: 100, y: 100 });
    });

    it('should record zone:resized event', async () => {
      rtsEventBus.emit('zone:resized' as any, {
        zoneId: 'zone-1',
        size: { width: 200, height: 200 }
      });

      await new Promise(resolve => setTimeout(resolve, 10));

      const events = stateFlow.getEventLog({ type: 'zone:resized' });
      expect(events).toHaveLength(1);
    });

    it('should distinguish event sources', async () => {
      rtsEventBus.emit('zone:moved' as any, {
        zoneId: 'zone-1',
        position: { x: 100, y: 100 }
      });

      rtsEventBus.emit('zone:moved' as any, {
        zoneId: 'zone-1',
        position: { x: 0, y: 0 },
        isUndo: true
      });

      rtsEventBus.emit('zone:synced' as any, {
        zoneId: 'zone-1',
        status: 'active'
      });

      await new Promise(resolve => setTimeout(resolve, 10));

      const userEvents = stateFlow.getEventLog({ source: 'user' });
      const systemEvents = stateFlow.getEventLog({ source: 'system' });
      const syncEvents = stateFlow.getEventLog({ source: 'sync' });

      expect(userEvents.length).toBeGreaterThan(0);
      expect(systemEvents.length).toBeGreaterThan(0);
      expect(syncEvents.length).toBeGreaterThan(0);
    });
  });

  describe('subscription', () => {
    it('should notify subscribers on event', async () => {
      const callback = jest.fn();
      stateFlow.subscribe('zone:created', callback);

      rtsEventBus.emit('zone:created' as any, {
        zoneId: 'zone-1',
        zoneConfig: {}
      });

      await new Promise(resolve => setTimeout(resolve, 10));

      expect(callback).toHaveBeenCalled();
      expect(callback.mock.calls[0][0].type).toBe('zone:created');
    });

    it('should support wildcard subscription', async () => {
      const callback = jest.fn();
      stateFlow.subscribe('*', callback);

      rtsEventBus.emit('zone:created' as any, { zoneId: 'zone-1' });
      rtsEventBus.emit('zone:deleted' as any, { zoneId: 'zone-2' });

      await new Promise(resolve => setTimeout(resolve, 10));

      expect(callback).toHaveBeenCalledTimes(2);
    });

    it('should unsubscribe correctly', async () => {
      const callback = jest.fn();
      const unsubscribe = stateFlow.subscribe('zone:created', callback);

      rtsEventBus.emit('zone:created' as any, { zoneId: 'zone-1' });
      await new Promise(resolve => setTimeout(resolve, 10));
      
      expect(callback).toHaveBeenCalledTimes(1);

      unsubscribe();

      rtsEventBus.emit('zone:created' as any, { zoneId: 'zone-2' });
      await new Promise(resolve => setTimeout(resolve, 10));
      
      expect(callback).toHaveBeenCalledTimes(1);
    });
  });

  describe('query and filtering', () => {
    beforeEach(async () => {
      rtsEventBus.emit('zone:created' as any, { zoneId: 'zone-1' });
      rtsEventBus.emit('zone:moved' as any, { zoneId: 'zone-1', position: { x: 10, y: 10 } });
      rtsEventBus.emit('zone:created' as any, { zoneId: 'zone-2' });
      
      await new Promise(resolve => setTimeout(resolve, 10));
    });

    it('should filter events by type', () => {
      const createdEvents = stateFlow.getEventLog({ type: 'zone:created' });
      expect(createdEvents.length).toBeGreaterThanOrEqual(2);
    });

    it('should filter events by time range', () => {
      const now = Date.now();
      const events = stateFlow.getEventLog({
        startTime: now - 1000,
        endTime: now + 1000
      });
      expect(events.length).toBeGreaterThan(0);
    });

    it('should get event count', () => {
      const count = stateFlow.getEventCount({ type: 'zone:created' });
      expect(count).toBeGreaterThanOrEqual(2);
    });

    it('should get last event', () => {
      const lastEvent = stateFlow.getLastEvent();
      expect(lastEvent).toBeDefined();
      expect(lastEvent?.timestamp).toBeGreaterThan(0);
    });

    it('should get last event by type', () => {
      const lastCreated = stateFlow.getLastEvent('zone:created');
      expect(lastCreated).toBeDefined();
      expect(lastCreated?.type).toBe('zone:created');
    });
  });

  describe('statistics', () => {
    beforeEach(async () => {
      rtsEventBus.emit('zone:created' as any, { zoneId: 'zone-1' });
      rtsEventBus.emit('zone:moved' as any, { zoneId: 'zone-1', position: { x: 10, y: 10 } });
      rtsEventBus.emit('zone:synced' as any, { zoneId: 'zone-1', status: 'active' });

      await new Promise(resolve => setTimeout(resolve, 10));
    });

    it('should return correct statistics', () => {
      const stats = stateFlow.getStatistics();
      
      expect(stats.totalEvents).toBeGreaterThan(0);
      expect(stats.userEvents).toBeGreaterThanOrEqual(0);
      expect(stats.systemEvents).toBeGreaterThanOrEqual(0);
      expect(stats.syncEvents).toBeGreaterThanOrEqual(0);
      expect(Object.keys(stats.eventTypeDistribution).length).toBeGreaterThan(0);
    });
  });

  describe('export and import', () => {
    it('should export log to JSON', async () => {
      rtsEventBus.emit('zone:created' as any, { zoneId: 'zone-1' });
      await new Promise(resolve => setTimeout(resolve, 10));

      const json = stateFlow.exportLog();
      const parsed = JSON.parse(json);

      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed.length).toBeGreaterThan(0);
    });

    it('should import log from JSON', async () => {
      const events: StateChangeEvent[] = [
        {
          type: 'zone:created',
          timestamp: Date.now(),
          source: 'user',
          data: { zoneId: 'zone-1' }
        }
      ];

      stateFlow.importLog(JSON.stringify(events));
      const imported = stateFlow.getEventLog();

      expect(imported).toHaveLength(1);
      expect(imported[0].data.zoneId).toBe('zone-1');
    });
  });

  describe('max history size', () => {
    it('should limit history size', async () => {
      const smallFlow = new ZoneStateFlow({ maxHistorySize: 5 });

      for (let i = 0; i < 10; i++) {
        rtsEventBus.emit('zone:created' as any, { zoneId: `zone-${i}` });
        await new Promise(resolve => setTimeout(resolve, 5));
      }

      const events = smallFlow.getEventLog();
      expect(events.length).toBeLessThanOrEqual(5);
      
      smallFlow.destroy();
    });
  });

  describe('clear', () => {
    it('should clear all events', async () => {
      rtsEventBus.emit('zone:created' as any, { zoneId: 'zone-1' });
      await new Promise(resolve => setTimeout(resolve, 10));

      stateFlow.clearLog();
      const events = stateFlow.getEventLog();

      expect(events).toHaveLength(0);
    });
  });
});