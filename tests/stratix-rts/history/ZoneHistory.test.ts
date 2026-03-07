import { 
  ZoneHistory, 
  ZoneMoveAction, 
  ZoneResizeAction,
  ZoneCreateAction,
  ZoneDeleteAction 
} from '@/stratix-rts/history/ZoneHistory';
import { rtsEventBus } from '@/stratix-rts/events/core/RTSEventBus';

describe('ZoneHistory', () => {
  let history: ZoneHistory;

  beforeEach(() => {
    history = new ZoneHistory();
  });

  afterEach(() => {
    history.destroy();
  });

  describe('execute', () => {
    it('should execute action and add to undo stack', async () => {
      const mockZone = {
        getZoneId: () => 'zone-1',
        setPosition: jest.fn(),
        x: 0,
        y: 0,
      };

      const action = new ZoneMoveAction(mockZone, { x: 0, y: 0 }, { x: 100, y: 100 });
      await history.execute(action);

      expect(history.canUndo()).toBe(true);
      expect(history.canRedo()).toBe(false);
      expect(history.getUndoStackLength()).toBe(1);
    });

    it('should limit undo stack size', async () => {
      const mockZone = {
        getZoneId: () => 'zone-1',
        setPosition: jest.fn(),
        x: 0,
        y: 0,
      };

      for (let i = 0; i < 60; i++) {
        const action = new ZoneMoveAction(mockZone, { x: i, y: i }, { x: i + 1, y: i + 1 });
        await history.execute(action);
      }

      expect(history.getUndoStackLength()).toBeLessThanOrEqual(50);
    });
  });

  describe('undo/redo', () => {
    it('should undo action', async () => {
      const mockZone = {
        getZoneId: () => 'zone-1',
        setPosition: jest.fn(),
        x: 0,
        y: 0,
      };

      const action = new ZoneMoveAction(mockZone, { x: 0, y: 0 }, { x: 100, y: 100 });
      await history.execute(action);
      await history.undo();

      expect(mockZone.setPosition).toHaveBeenCalledWith(0, 0);
      expect(history.canRedo()).toBe(true);
      expect(history.getRedoStackLength()).toBe(1);
    });

    it('should redo action', async () => {
      const mockZone = {
        getZoneId: () => 'zone-1',
        setPosition: jest.fn(),
        x: 0,
        y: 0,
      };

      const action = new ZoneMoveAction(mockZone, { x: 0, y: 0 }, { x: 100, y: 100 });
      await history.execute(action);
      await history.undo();
      await history.redo();

      expect(mockZone.setPosition).toHaveBeenCalledWith(100, 100);
      expect(history.canUndo()).toBe(true);
      expect(history.getUndoStackLength()).toBe(1);
    });

    it('should clear redo stack on new action', async () => {
      const mockZone = {
        getZoneId: () => 'zone-1',
        setPosition: jest.fn(),
        x: 0,
        y: 0,
      };

      const action1 = new ZoneMoveAction(mockZone, { x: 0, y: 0 }, { x: 100, y: 100 });
      await history.execute(action1);
      await history.undo();

      const action2 = new ZoneMoveAction(mockZone, { x: 100, y: 100 }, { x: 200, y: 200 });
      await history.execute(action2);

      expect(history.getRedoStackLength()).toBe(0);
    });
  });

  describe('canUndo/canRedo', () => {
    it('should return false when no actions to undo', () => {
      expect(history.canUndo()).toBe(false);
    });

    it('should return false when no actions to redo', () => {
      expect(history.canRedo()).toBe(false);
    });

    it('should return true when actions available', async () => {
      const mockZone = {
        getZoneId: () => 'zone-1',
        setPosition: jest.fn(),
        x: 0,
        y: 0,
      };

      const action = new ZoneMoveAction(mockZone, { x: 0, y: 0 }, { x: 100, y: 100 });
      await history.execute(action);

      expect(history.canUndo()).toBe(true);
    });
  });

  describe('clear', () => {
    it('should clear all stacks', async () => {
      const mockZone = {
        getZoneId: () => 'zone-1',
        setPosition: jest.fn(),
        x: 0,
        y: 0,
      };

      const action = new ZoneMoveAction(mockZone, { x: 0, y: 0 }, { x: 100, y: 100 });
      await history.execute(action);
      await history.undo();

      history.clear();

      expect(history.getUndoStackLength()).toBe(0);
      expect(history.getRedoStackLength()).toBe(0);
    });
  });

  describe('events', () => {
    it('should emit history:changed event on execute', async () => {
      const eventSpy = jest.fn();
      rtsEventBus.on('history:changed' as any, eventSpy);

      const mockZone = {
        getZoneId: () => 'zone-1',
        setPosition: jest.fn(),
        x: 0,
        y: 0,
      };

      const action = new ZoneMoveAction(mockZone, { x: 0, y: 0 }, { x: 100, y: 100 });
      await history.execute(action);

      expect(eventSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          canUndo: true,
          canRedo: false,
        })
      );

      rtsEventBus.off('history:changed' as any, eventSpy);
    });
  });

  describe('ZoneMoveAction', () => {
    it('should create move action with correct data', () => {
      const mockZone = {
        getZoneId: () => 'zone-1',
        setPosition: jest.fn(),
        x: 0,
        y: 0,
      };

      const action = new ZoneMoveAction(mockZone, { x: 0, y: 0 }, { x: 100, y: 100 });

      expect(action.type).toBe('move');
      expect(action.zoneId).toBe('zone-1');
      expect(action.data).toBeDefined();
      expect(action.data.oldPosition).toEqual({ x: 0, y: 0 });
      expect(action.data.newPosition).toEqual({ x: 100, y: 100 });
    });
  });

  describe('ZoneResizeAction', () => {
    it('should create resize action with correct data', () => {
      const mockZone = {
        getZoneId: () => 'zone-1',
        resize: jest.fn(),
        width: 100,
        height: 100,
      };

      const action = new ZoneResizeAction(mockZone, { width: 100, height: 100 }, { width: 200, height: 200 });

      expect(action.type).toBe('resize');
      expect(action.zoneId).toBe('zone-1');
      expect(action.data).toBeDefined();
    });
  });
});