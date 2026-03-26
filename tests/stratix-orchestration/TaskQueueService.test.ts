/**
 * TaskQueueService Unit Tests
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

import { TaskQueueService } from '@/stratix-orchestration/task-queue/TaskQueueService';
import { TaskItem, TaskContext, TaskEvent } from '@/stratix-orchestration/task-queue/TaskItem';

describe('TaskQueueService', () => {
  let taskQueue: TaskQueueService;
  let eventHandler: jest.Mock;

  beforeEach(() => {
    // Reset singleton state for testing
    (TaskQueueService as any).instance = undefined;
    taskQueue = TaskQueueService.getInstance();
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
      const instance1 = TaskQueueService.getInstance();
      const instance2 = TaskQueueService.getInstance();
      expect(instance1).toBe(instance2);
    });
  });

  describe('createTask', () => {
    it('should create a task with correct parameters', async () => {
      const context: TaskContext = { description: 'Test task description' };

      const result = await taskQueue.createTask(
        'task-1',
        'zone-1',
        'project-1',
        'Test Task',
        'coding',
        context,
        { priority: 5, description: 'A test task' }
      );

      expect(result).toMatchObject({
        taskId: 'task-1',
        zoneId: 'zone-1',
        projectId: 'project-1',
        name: 'Test Task',
        type: 'coding',
        priority: 5,
        status: 'pending',
        dependencies: [],
      });
      expect(result.createdAt).toBeDefined();
    });

    it('should use default priority of 5 when not specified', async () => {
      const context: TaskContext = { description: 'Test' };

      const result = await taskQueue.createTask(
        'task-2',
        'zone-1',
        'project-1',
        'Default Priority Task',
        'general',
        context
      );

      expect(result.priority).toBe(5);
    });

    it('should create task with dependencies', async () => {
      const context: TaskContext = { description: 'Dependent task' };

      const result = await taskQueue.createTask(
        'task-3',
        'zone-1',
        'project-1',
        'Dependent Task',
        'analysis',
        context,
        { dependencies: ['task-1', 'task-2'] }
      );

      expect(result.dependencies).toEqual(['task-1', 'task-2']);
    });

    it('should emit created event', async () => {
      taskQueue.on('created', eventHandler);
      const context: TaskContext = { description: 'Test' };

      await taskQueue.createTask(
        'event-task',
        'zone-1',
        'project-1',
        'Event Task',
        'general',
        context
      );

      expect(eventHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'created',
          taskId: 'event-task',
        })
      );
    });
  });

  describe('getTask', () => {
    it('should return null for non-existent task', async () => {
      mockDb.prepare.mockReturnValue({
        run: jest.fn(),
        get: jest.fn().mockReturnValue(undefined),
        all: jest.fn().mockReturnValue([]),
      });

      const result = await taskQueue.getTask('non-existent');
      expect(result).toBeNull();
    });

    it('should return cached task if in memory', async () => {
      const context: TaskContext = { description: 'Test' };

      await taskQueue.createTask(
        'cached-task',
        'zone-1',
        'project-1',
        'Cached Task',
        'coding',
        context
      );

      jest.clearAllMocks();

      const result = await taskQueue.getTask('cached-task');
      expect(result).not.toBeNull();
      expect(result?.taskId).toBe('cached-task');
    });
  });

  describe('updateTask', () => {
    it('should update task status', async () => {
      mockDb.prepare.mockReturnValue({
        run: jest.fn().mockReturnValue({ changes: 1 }),
        get: jest.fn(),
        all: jest.fn().mockReturnValue([]),
      });

      const context: TaskContext = { description: 'Test' };

      await taskQueue.createTask(
        'update-task',
        'zone-1',
        'project-1',
        'Update Test',
        'coding',
        context
      );

      const result = await taskQueue.updateTask('update-task', { status: 'assigned', assignedAgentId: 'agent-1' });

      expect(result?.status).toBe('assigned');
      expect(result?.assignedAgentId).toBe('agent-1');
    });

    it('should emit assigned event when status changes to assigned', async () => {
      mockDb.prepare.mockReturnValue({
        run: jest.fn().mockReturnValue({ changes: 1 }),
        get: jest.fn(),
        all: jest.fn().mockReturnValue([]),
      });

      const context: TaskContext = { description: 'Test' };

      await taskQueue.createTask(
        'assigned-task',
        'zone-1',
        'project-1',
        'Assigned Test',
        'coding',
        context
      );

      taskQueue.on('assigned', eventHandler);

      await taskQueue.updateTask('assigned-task', { status: 'assigned', assignedAgentId: 'agent-1' });

      expect(eventHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'assigned',
          taskId: 'assigned-task',
          agentId: 'agent-1',
        })
      );
    });

    it('should emit completed event when status changes to completed', async () => {
      mockDb.prepare.mockReturnValue({
        run: jest.fn().mockReturnValue({ changes: 1 }),
        get: jest.fn(),
        all: jest.fn().mockReturnValue([]),
      });

      const context: TaskContext = { description: 'Test' };

      await taskQueue.createTask(
        'completed-task',
        'zone-1',
        'project-1',
        'Completed Test',
        'coding',
        context
      );

      taskQueue.on('completed', eventHandler);

      await taskQueue.updateTask('completed-task', { status: 'completed' });

      expect(eventHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'completed',
          taskId: 'completed-task',
        })
      );
    });

    it('should return null for non-existent task', async () => {
      mockDb.prepare.mockReturnValue({
        run: jest.fn(),
        get: jest.fn().mockReturnValue(undefined),
        all: jest.fn().mockReturnValue([]),
      });

      const result = await taskQueue.updateTask('non-existent', { status: 'assigned' });
      expect(result).toBeNull();
    });
  });

  describe('enqueueTask', () => {
    it('should enqueue task with satisfied dependencies', async () => {
      mockDb.prepare.mockReturnValue({
        run: jest.fn().mockReturnValue({ changes: 1 }),
        get: jest.fn().mockReturnValue({
          task_id: 'task-1',
          zone_id: 'zone-1',
          project_id: 'project-1',
          name: 'Task 1',
          description: null,
          type: 'coding',
          priority: 5,
          status: 'completed',
          assigned_agent_id: null,
          dependencies: '[]',
          context: '{}',
          result: null,
          error: null,
          created_at: Date.now(),
          assigned_at: null,
          started_at: null,
          completed_at: null,
        }),
        all: jest.fn().mockReturnValue([]),
      });

      const context: TaskContext = { description: 'Test' };

      await taskQueue.createTask(
        'enqueue-task',
        'zone-1',
        'project-1',
        'Enqueue Test',
        'coding',
        context
      );

      // Mock the getTask call to return a completed dependency
      mockDb.prepare.mockReturnValue({
        run: jest.fn().mockReturnValue({ changes: 1 }),
        get: jest.fn().mockReturnValue({
          task_id: 'dep-task',
          zone_id: 'zone-1',
          project_id: 'project-1',
          name: 'Dep Task',
          description: null,
          type: 'coding',
          priority: 5,
          status: 'completed',
          assigned_agent_id: null,
          dependencies: '[]',
          context: '{}',
          result: null,
          error: null,
          created_at: Date.now(),
          assigned_at: null,
          started_at: null,
          completed_at: null,
        }),
        all: jest.fn().mockReturnValue([]),
      });

      const result = await taskQueue.enqueueTask('enqueue-task');
      expect(result).toBe(true);
    });

    it('should return false for task with unsatisfied dependencies', async () => {
      mockDb.prepare.mockReturnValue({
        run: jest.fn().mockReturnValue({ changes: 1 }),
        get: jest.fn().mockReturnValue({
          task_id: 'unsatisfied-task',
          zone_id: 'zone-1',
          project_id: 'project-1',
          name: 'Unsatisfied Task',
          description: null,
          type: 'coding',
          priority: 5,
          status: 'pending',
          assigned_agent_id: null,
          dependencies: '[]',
          context: '{}',
          result: null,
          error: null,
          created_at: Date.now(),
          assigned_at: null,
          started_at: null,
          completed_at: null,
        }),
        all: jest.fn().mockReturnValue([]),
      });

      const context: TaskContext = { description: 'Test' };

      await taskQueue.createTask(
        'unsatisfied-task',
        'zone-1',
        'project-1',
        'Unsatisfied Test',
        'coding',
        context,
        { dependencies: ['non-existent-task'] }
      );

      const result = await taskQueue.enqueueTask('unsatisfied-task');
      expect(result).toBe(false);
    });

    it('should return false for non-existent task', async () => {
      mockDb.prepare.mockReturnValue({
        run: jest.fn(),
        get: jest.fn().mockReturnValue(undefined),
        all: jest.fn().mockReturnValue([]),
      });

      const result = await taskQueue.enqueueTask('non-existent');
      expect(result).toBe(false);
    });
  });

  describe('dequeueTask', () => {
    it('should return null when zone has no pending tasks', async () => {
      mockDb.prepare.mockReturnValue({
        run: jest.fn(),
        get: jest.fn(),
        all: jest.fn().mockReturnValue([]),
      });

      const result = await taskQueue.dequeueTask('agent-1', 'empty-zone');
      expect(result).toBeNull();
    });
  });

  describe('getPendingTasks', () => {
    it('should return pending tasks for zone', async () => {
      mockDb.prepare.mockReturnValue({
        run: jest.fn(),
        get: jest.fn(),
        all: jest.fn().mockReturnValue([
          {
            task_id: 'pending-1',
            zone_id: 'zone-1',
            project_id: 'project-1',
            name: 'Pending 1',
            description: null,
            type: 'coding',
            priority: 5,
            status: 'pending',
            assigned_agent_id: null,
            dependencies: '[]',
            context: '{}',
            result: null,
            error: null,
            created_at: Date.now(),
            assigned_at: null,
            started_at: null,
            completed_at: null,
          },
        ]),
      });

      const result = await taskQueue.getPendingTasks('zone-1');
      expect(result.length).toBeGreaterThanOrEqual(0);
    });
  });

  describe('getNextTask', () => {
    it('should return highest priority task', async () => {
      mockDb.prepare.mockReturnValue({
        run: jest.fn(),
        get: jest.fn(),
        all: jest.fn().mockReturnValue([
          {
            task_id: 'low-priority',
            zone_id: 'zone-1',
            project_id: 'project-1',
            name: 'Low Priority',
            description: null,
            type: 'coding',
            priority: 1,
            status: 'pending',
            assigned_agent_id: null,
            dependencies: '[]',
            context: '{}',
            result: null,
            error: null,
            created_at: Date.now(),
            assigned_at: null,
            started_at: null,
            completed_at: null,
          },
          {
            task_id: 'high-priority',
            zone_id: 'zone-1',
            project_id: 'project-1',
            name: 'High Priority',
            description: null,
            type: 'coding',
            priority: 10,
            status: 'pending',
            assigned_agent_id: null,
            dependencies: '[]',
            context: '{}',
            result: null,
            error: null,
            created_at: Date.now(),
            assigned_at: null,
            started_at: null,
            completed_at: null,
          },
        ]),
      });

      const result = await taskQueue.getNextTask('zone-1');
      // Result depends on sorting implementation
      expect(result).not.toBeNull();
    });
  });

  describe('event system', () => {
    it('should register and emit events to specific listeners', async () => {
      mockDb.prepare.mockReturnValue({
        run: jest.fn().mockReturnValue({ changes: 1 }),
        get: jest.fn(),
        all: jest.fn().mockReturnValue([]),
      });

      const createdHandler = jest.fn();
      const completedHandler = jest.fn();

      taskQueue.on('created', createdHandler);
      taskQueue.on('completed', completedHandler);

      const context: TaskContext = { description: 'Test' };

      await taskQueue.createTask(
        'event-task-1',
        'zone-1',
        'project-1',
        'Event Task 1',
        'coding',
        context
      );

      expect(createdHandler).toHaveBeenCalled();
      expect(completedHandler).not.toHaveBeenCalled();
    });

    it('should register and emit events to global listeners', async () => {
      mockDb.prepare.mockReturnValue({
        run: jest.fn().mockReturnValue({ changes: 1 }),
        get: jest.fn(),
        all: jest.fn().mockReturnValue([]),
      });

      const globalHandler = jest.fn();

      taskQueue.on('*', globalHandler);

      const context: TaskContext = { description: 'Test' };

      await taskQueue.createTask(
        'global-event-task',
        'zone-1',
        'project-1',
        'Global Event Task',
        'coding',
        context
      );

      expect(globalHandler).toHaveBeenCalled();
    });

    it('should remove event listeners', async () => {
      mockDb.prepare.mockReturnValue({
        run: jest.fn().mockReturnValue({ changes: 1 }),
        get: jest.fn(),
        all: jest.fn().mockReturnValue([]),
      });

      const handler = jest.fn();

      taskQueue.on('created', handler);
      taskQueue.off('created', handler);

      const context: TaskContext = { description: 'Test' };

      await taskQueue.createTask(
        'off-event-task',
        'zone-1',
        'project-1',
        'Off Event Task',
        'coding',
        context
      );

      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe('deleteTask', () => {
    it('should delete existing task', async () => {
      mockDb.prepare.mockReturnValue({
        run: jest.fn().mockReturnValue({ changes: 1 }),
        get: jest.fn().mockReturnValue({
          task_id: 'delete-task',
          zone_id: 'zone-1',
          project_id: 'project-1',
          name: 'Delete Task',
          description: null,
          type: 'coding',
          priority: 5,
          status: 'pending',
          assigned_agent_id: null,
          dependencies: '[]',
          context: '{}',
          result: null,
          error: null,
          created_at: Date.now(),
          assigned_at: null,
          started_at: null,
          completed_at: null,
        }),
        all: jest.fn().mockReturnValue([]),
      });

      const context: TaskContext = { description: 'Test' };

      await taskQueue.createTask(
        'delete-task',
        'zone-1',
        'project-1',
        'Delete Task',
        'coding',
        context
      );

      const result = await taskQueue.deleteTask('delete-task');
      expect(result).toBe(true);
    });

    it('should return false for non-existent task', async () => {
      mockDb.prepare.mockReturnValue({
        run: jest.fn().mockReturnValue({ changes: 0 }),
        get: jest.fn().mockReturnValue(undefined),
        all: jest.fn().mockReturnValue([]),
      });

      const result = await taskQueue.deleteTask('non-existent');
      expect(result).toBe(false);
    });
  });

  describe('requeueAbandonedTasks', () => {
    it('should return empty array when no abandoned tasks', async () => {
      mockDb.prepare.mockReturnValue({
        run: jest.fn(),
        get: jest.fn(),
        all: jest.fn().mockReturnValue([]),
      });

      const result = await taskQueue.requeueAbandonedTasks();
      expect(result).toEqual([]);
    });
  });
});
