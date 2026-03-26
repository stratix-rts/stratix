/**
 * ZoneManager Unit Tests
 */

// Mock database
const mockDb = {
  prepare: jest.fn().mockReturnValue({
    run: jest.fn().mockReturnValue({ changes: 1 }),
    get: jest.fn(),
    all: jest.fn().mockReturnValue([]),
  }),
};

jest.mock('@/stratix-database/StratixDatabase', () => ({
  getDatabase: jest.fn().mockReturnValue({
    getDatabase: jest.fn().mockReturnValue(mockDb),
  }),
}));

// Mock TaskQueueService
jest.mock('@/stratix-orchestration/task-queue/TaskQueueService', () => ({
  TaskQueueService: {
    getInstance: jest.fn().mockReturnValue({
      getTasksByZone: jest.fn().mockResolvedValue([]),
    }),
  },
}));

import { ZoneManager } from '@/stratix-orchestration/zone/ZoneManager';
import { ZoneState, ZoneEvent } from '@/stratix-orchestration/zone/ZoneState';

describe('ZoneManager', () => {
  let zoneManager: ZoneManager;
  let eventHandler: jest.Mock;

  beforeEach(() => {
    // Reset singleton state for testing
    (ZoneManager as any).instance = undefined;
    zoneManager = ZoneManager.getInstance();
    jest.clearAllMocks();

    eventHandler = jest.fn();
    mockDb.prepare.mockReturnValue({
      run: jest.fn().mockReturnValue({ changes: 1 }),
      get: jest.fn(),
      all: jest.fn().mockReturnValue([]),
    });
  });

  describe('getInstance', () => {
    it('should return the same instance on multiple calls', () => {
      const instance1 = ZoneManager.getInstance();
      const instance2 = ZoneManager.getInstance();
      expect(instance1).toBe(instance2);
    });
  });

  describe('createZone', () => {
    it('should create a zone with correct parameters', async () => {
      const zoneId = 'zone-1';
      const name = 'Test Zone';
      const type: 'task' | 'project' | 'general' = 'task';
      const position = { x: 100, y: 200 };
      const size = { width: 300, height: 400 };

      const result = await zoneManager.createZone(zoneId, name, type, position, size, {}, 'project-1');

      expect(result).toMatchObject({
        zoneId,
        name,
        type,
        projectId: 'project-1',
        position,
        size,
        status: 'idle',
        enteredAgents: [],
        taskPool: [],
      });
      expect(result.createdAt).toBeDefined();
      expect(result.updatedAt).toBeDefined();
    });

    it('should create a zone without projectId', async () => {
      const result = await zoneManager.createZone(
        'zone-2',
        'No Project Zone',
        'general',
        { x: 0, y: 0 },
        { width: 100, height: 100 }
      );

      expect(result.zoneId).toBe('zone-2');
      expect(result.projectId).toBeUndefined();
    });

    it('should emit status_change event on create', async () => {
      zoneManager.on('status_change', eventHandler);

      await zoneManager.createZone(
        'zone-3',
        'Event Test',
        'task',
        { x: 0, y: 0 },
        { width: 100, height: 100 }
      );

      expect(eventHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'status_change',
          zoneId: 'zone-3',
          data: { status: 'idle' },
        })
      );
    });
  });

  describe('getZone', () => {
    it('should return null for non-existent zone', async () => {
      mockDb.prepare.mockReturnValue({
        run: jest.fn(),
        get: jest.fn().mockReturnValue(undefined),
        all: jest.fn().mockReturnValue([]),
      });

      const result = await zoneManager.getZone('non-existent');
      expect(result).toBeNull();
    });

    it('should return cached zone if in memory', async () => {
      // Create a zone first
      await zoneManager.createZone(
        'cached-zone',
        'Cached',
        'task',
        { x: 0, y: 0 },
        { width: 100, height: 100 }
      );

      // Mock would have been called during create
      jest.clearAllMocks();

      const result = await zoneManager.getZone('cached-zone');
      expect(result).not.toBeNull();
      expect(result?.zoneId).toBe('cached-zone');
    });
  });

  describe('enterZone', () => {
    it('should add agent to zone', async () => {
      // Setup mocks for create zone first
      mockDb.prepare.mockReturnValue({
        run: jest.fn().mockReturnValue({ changes: 1 }),
        get: jest.fn().mockReturnValue(undefined),
        all: jest.fn().mockReturnValue([]),
      });

      await zoneManager.createZone(
        'enter-zone',
        'Enter Test',
        'task',
        { x: 0, y: 0 },
        { width: 100, height: 100 }
      );

      // Mock for enter zone
      mockDb.prepare.mockReturnValue({
        run: jest.fn().mockReturnValue({ changes: 1 }),
        get: jest.fn().mockReturnValue(undefined), // No existing membership
        all: jest.fn().mockReturnValue([]),
      });

      zoneManager.on('enter', eventHandler);

      const result = await zoneManager.enterZone('agent-1', 'enter-zone');

      expect(result).toBe(true);
    });

    it('should return false for non-existent zone', async () => {
      mockDb.prepare.mockReturnValue({
        run: jest.fn(),
        get: jest.fn().mockReturnValue(undefined),
        all: jest.fn().mockReturnValue([]),
      });

      const result = await zoneManager.enterZone('agent-1', 'non-existent');
      expect(result).toBe(false);
    });

    it('should emit enter event', async () => {
      mockDb.prepare.mockReturnValue({
        run: jest.fn().mockReturnValue({ changes: 1 }),
        get: jest.fn().mockReturnValue(undefined),
        all: jest.fn().mockReturnValue([]),
      });

      await zoneManager.createZone(
        'event-enter-zone',
        'Event Test',
        'task',
        { x: 0, y: 0 },
        { width: 100, height: 100 }
      );

      zoneManager.on('enter', eventHandler);

      mockDb.prepare.mockReturnValue({
        run: jest.fn().mockReturnValue({ changes: 1 }),
        get: jest.fn().mockReturnValue(undefined),
        all: jest.fn().mockReturnValue([]),
      });

      await zoneManager.enterZone('agent-1', 'event-enter-zone');

      expect(eventHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'enter',
          zoneId: 'event-enter-zone',
          agentId: 'agent-1',
        })
      );
    });
  });

  describe('exitZone', () => {
    it('should remove agent from zone', async () => {
      // Setup mocks
      mockDb.prepare.mockReturnValue({
        run: jest.fn().mockReturnValue({ changes: 1 }),
        get: jest.fn().mockReturnValue(undefined),
        all: jest.fn().mockReturnValue([]),
      });

      await zoneManager.createZone(
        'exit-zone',
        'Exit Test',
        'task',
        { x: 0, y: 0 },
        { width: 100, height: 100 }
      );

      // Mock for exit zone
      mockDb.prepare.mockReturnValue({
        run: jest.fn().mockReturnValue({ changes: 1 }),
        get: jest.fn(),
        all: jest.fn().mockReturnValue([]),
      });

      zoneManager.on('exit', eventHandler);

      const result = await zoneManager.exitZone('agent-1', 'exit-zone');

      expect(result).toBe(true);
    });

    it('should return false for non-existent zone', async () => {
      mockDb.prepare.mockReturnValue({
        run: jest.fn(),
        get: jest.fn().mockReturnValue(undefined),
        all: jest.fn().mockReturnValue([]),
      });

      const result = await zoneManager.exitZone('agent-1', 'non-existent');
      expect(result).toBe(false);
    });
  });

  describe('getAgentsInZone', () => {
    it('should return agents in zone', async () => {
      mockDb.prepare.mockReturnValue({
        run: jest.fn().mockReturnValue({ changes: 1 }),
        get: jest.fn().mockReturnValue(undefined),
        all: jest.fn().mockReturnValue([]),
      });

      await zoneManager.createZone(
        'agents-zone',
        'Agents Test',
        'task',
        { x: 0, y: 0 },
        { width: 100, height: 100 }
      );

      const agents = await zoneManager.getAgentsInZone('agents-zone');
      expect(Array.isArray(agents)).toBe(true);
    });
  });

  describe('task pool management', () => {
    beforeEach(() => {
      mockDb.prepare.mockReturnValue({
        run: jest.fn().mockReturnValue({ changes: 1 }),
        get: jest.fn().mockReturnValue(undefined),
        all: jest.fn().mockReturnValue([]),
      });
    });

    it('should add task to zone', async () => {
      await zoneManager.createZone(
        'task-zone',
        'Task Zone',
        'task',
        { x: 0, y: 0 },
        { width: 100, height: 100 }
      );

      zoneManager.on('task_added', eventHandler);

      const result = await zoneManager.addTaskToZone('task-zone', 'task-1');

      expect(result).toBe(true);
    });

    it('should remove task from zone', async () => {
      await zoneManager.createZone(
        'remove-task-zone',
        'Remove Task Zone',
        'task',
        { x: 0, y: 0 },
        { width: 100, height: 100 }
      );

      zoneManager.on('task_removed', eventHandler);

      const result = await zoneManager.removeTaskFromZone('remove-task-zone', 'task-1');

      expect(result).toBe(true);
    });
  });

  describe('event system', () => {
    it('should register and emit events to specific listeners', async () => {
      mockDb.prepare.mockReturnValue({
        run: jest.fn().mockReturnValue({ changes: 1 }),
        get: jest.fn().mockReturnValue(undefined),
        all: jest.fn().mockReturnValue([]),
      });

      const enterHandler = jest.fn();
      const exitHandler = jest.fn();

      zoneManager.on('enter', enterHandler);
      zoneManager.on('exit', exitHandler);

      await zoneManager.createZone(
        'event-test-zone',
        'Event Test',
        'task',
        { x: 0, y: 0 },
        { width: 100, height: 100 }
      );

      // Trigger enter event
      mockDb.prepare.mockReturnValue({
        run: jest.fn().mockReturnValue({ changes: 1 }),
        get: jest.fn().mockReturnValue(undefined),
        all: jest.fn().mockReturnValue([]),
      });

      await zoneManager.enterZone('agent-1', 'event-test-zone');

      expect(enterHandler).toHaveBeenCalled();
      expect(exitHandler).not.toHaveBeenCalled();
    });

    it('should register and emit events to global listeners', async () => {
      mockDb.prepare.mockReturnValue({
        run: jest.fn().mockReturnValue({ changes: 1 }),
        get: jest.fn().mockReturnValue(undefined),
        all: jest.fn().mockReturnValue([]),
      });

      const globalHandler = jest.fn();

      zoneManager.on('*', globalHandler);

      await zoneManager.createZone(
        'global-event-zone',
        'Global Event Test',
        'task',
        { x: 0, y: 0 },
        { width: 100, height: 100 }
      );

      expect(globalHandler).toHaveBeenCalled();
    });

    it('should remove event listeners', async () => {
      mockDb.prepare.mockReturnValue({
        run: jest.fn().mockReturnValue({ changes: 1 }),
        get: jest.fn().mockReturnValue(undefined),
        all: jest.fn().mockReturnValue([]),
      });

      const handler = jest.fn();

      zoneManager.on('status_change', handler);
      zoneManager.off('status_change', handler);

      await zoneManager.createZone(
        'off-test-zone',
        'Off Test',
        'task',
        { x: 0, y: 0 },
        { width: 100, height: 100 }
      );

      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe('updateZone', () => {
    it('should update zone name', async () => {
      mockDb.prepare.mockReturnValue({
        run: jest.fn().mockReturnValue({ changes: 1 }),
        get: jest.fn().mockReturnValue(undefined),
        all: jest.fn().mockReturnValue([]),
      });

      await zoneManager.createZone(
        'update-zone',
        'Original Name',
        'task',
        { x: 0, y: 0 },
        { width: 100, height: 100 }
      );

      const result = await zoneManager.updateZone('update-zone', { name: 'New Name' });

      expect(result?.name).toBe('New Name');
    });

    it('should return null for non-existent zone', async () => {
      mockDb.prepare.mockReturnValue({
        run: jest.fn(),
        get: jest.fn().mockReturnValue(undefined),
        all: jest.fn().mockReturnValue([]),
      });

      const result = await zoneManager.updateZone('non-existent', { name: 'New Name' });
      expect(result).toBeNull();
    });
  });

  describe('deleteZone', () => {
    it('should delete existing zone', async () => {
      mockDb.prepare.mockReturnValue({
        run: jest.fn().mockReturnValue({ changes: 1 }),
        get: jest.fn().mockReturnValue(undefined),
        all: jest.fn().mockReturnValue([]),
      });

      await zoneManager.createZone(
        'delete-zone',
        'Delete Test',
        'task',
        { x: 0, y: 0 },
        { width: 100, height: 100 }
      );

      const result = await zoneManager.deleteZone('delete-zone');
      expect(result).toBe(true);
    });

    it('should return false for non-existent zone', async () => {
      mockDb.prepare.mockReturnValue({
        run: jest.fn().mockReturnValue({ changes: 0 }),
        get: jest.fn().mockReturnValue(undefined),
        all: jest.fn().mockReturnValue([]),
      });

      const result = await zoneManager.deleteZone('non-existent');
      expect(result).toBe(false);
    });
  });
});
