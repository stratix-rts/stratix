/**
 * ZoneTaskService Unit Tests
 */

import { ZoneTaskService } from '../../../src/stratix-gateway/project/ZoneTaskService';
import { Zone, ZoneTask, ZoneTaskStatus } from '../../../src/stratix-project/types';

jest.mock('../../../src/stratix-database/ZoneRepository');
jest.mock('../../../src/stratix-gateway/GatewayEventBus');

import { zoneRepository } from '../../../src/stratix-database/ZoneRepository';
import { gatewayEventBus } from '../../../src/stratix-gateway/GatewayEventBus';

const MockedZoneRepository = zoneRepository as jest.Mocked<typeof zoneRepository>;
const MockedGatewayEventBus = gatewayEventBus as jest.Mocked<typeof gatewayEventBus>;

const mockZone = (overrides: Partial<Zone> = {}): Zone => ({
  id: 'zone-test-1',
  projectId: 'proj-1',
  title: 'Test Zone',
  prompt: 'Test prompt',
  members: [],
  files: [],
  createdAt: Date.now(),
  updatedAt: Date.now(),
  ...overrides,
});

const mockTask = (overrides: Partial<ZoneTask> = {}): ZoneTask => ({
  id: 'task-1',
  zoneId: 'zone-test-1',
  title: 'Test Task',
  status: 'pending' as ZoneTaskStatus,
  assignee: null,
  createdBy: 'agent-1',
  createdAt: Date.now(),
  updatedAt: Date.now(),
  ...overrides,
});

describe('ZoneTaskService', () => {
  let service: ZoneTaskService;
  let mockCheckPermission: jest.Mock;
  let mockEnsureInitialized: jest.Mock;

  beforeEach(() => {
    jest.resetAllMocks();
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});

    mockCheckPermission = jest.fn();
    mockEnsureInitialized = jest.fn().mockResolvedValue(undefined);

    service = new ZoneTaskService(mockCheckPermission, mockEnsureInitialized);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // ============================================
  // getTasks
  // ============================================
  describe('getTasks', () => {
    it('should return tasks for a zone', async () => {
      const zone = mockZone();
      const tasks = [mockTask(), mockTask({ id: 'task-2' })];
      MockedZoneRepository.getZone.mockReturnValue(zone);
      MockedZoneRepository.getTasks.mockReturnValue(tasks);

      const result = await service.getTasks('zone-1', 10, 0);

      expect(mockEnsureInitialized).toHaveBeenCalled();
      expect(MockedZoneRepository.getZone).toHaveBeenCalledWith('zone-1');
      expect(MockedZoneRepository.getTasks).toHaveBeenCalledWith('zone-1', 10, 0);
      expect(result).toEqual(tasks);
    });

    it('should throw when zone not found', async () => {
      MockedZoneRepository.getZone.mockReturnValue(null);

      await expect(service.getTasks('zone-1')).rejects.toThrow('Zone not found: zone-1');
    });
  });

  // ============================================
  // getTasksCount
  // ============================================
  describe('getTasksCount', () => {
    it('should return task count for a zone', async () => {
      MockedZoneRepository.getZone.mockReturnValue(mockZone());
      MockedZoneRepository.getTasksCount.mockReturnValue(5);

      const result = await service.getTasksCount('zone-1');

      expect(MockedZoneRepository.getTasksCount).toHaveBeenCalledWith('zone-1');
      expect(result).toBe(5);
    });

    it('should throw when zone not found', async () => {
      MockedZoneRepository.getZone.mockReturnValue(null);

      await expect(service.getTasksCount('zone-1')).rejects.toThrow('Zone not found: zone-1');
    });
  });

  // ============================================
  // getTask
  // ============================================
  describe('getTask', () => {
    it('should return a task by id', async () => {
      const task = mockTask();
      MockedZoneRepository.getZone.mockReturnValue(mockZone());
      MockedZoneRepository.getTask.mockReturnValue(task);

      const result = await service.getTask('zone-test-1', 'task-1');

      expect(MockedZoneRepository.getTask).toHaveBeenCalledWith('task-1');
      expect(result).toEqual(task);
    });

    it('should return null when task not in zone', async () => {
      MockedZoneRepository.getZone.mockReturnValue(mockZone());
      MockedZoneRepository.getTask.mockReturnValue(mockTask({ zoneId: 'other-zone' }));

      const result = await service.getTask('zone-test-1', 'task-1');

      expect(result).toBeNull();
    });

    it('should return null when task not found', async () => {
      MockedZoneRepository.getZone.mockReturnValue(mockZone());
      MockedZoneRepository.getTask.mockReturnValue(null);

      const result = await service.getTask('zone-test-1', 'task-1');

      expect(result).toBeNull();
    });
  });

  // ============================================
  // createTask
  // ============================================
  describe('createTask', () => {
    it('should create task and publish event', async () => {
      const zone = mockZone();
      const task = mockTask();
      MockedZoneRepository.getZone.mockReturnValue(zone);
      MockedZoneRepository.getZoneContext.mockReturnValue({ taskPolicy: '', taskCreatorId: null, members: [] });
      MockedZoneRepository.createTask.mockReturnValue(task);

      const result = await service.createTask('zone-test-1', 'agent-1', 'New Task');

      expect(mockCheckPermission).toHaveBeenCalledWith('create_task', 'zone:zone-test-1', 'agent-1');
      expect(MockedZoneRepository.updateZoneContext).toHaveBeenCalledWith('zone-test-1', { taskCreatorId: 'agent-1' });
      expect(MockedZoneRepository.createTask).toHaveBeenCalledWith('zone-test-1', 'New Task', 'agent-1');
      expect(MockedGatewayEventBus.publishZoneEvent).toHaveBeenCalledWith(
        'zone:task_created',
        'zone-test-1',
        'zone-test-1',
        { task }
      );
      expect(result).toEqual(task);
    });

    it('should allow existing task creator to create more tasks', async () => {
      const zone = mockZone();
      const task = mockTask();
      MockedZoneRepository.getZone.mockReturnValue(zone);
      MockedZoneRepository.getZoneContext.mockReturnValue({ taskPolicy: '', taskCreatorId: 'agent-1', members: [] });
      MockedZoneRepository.createTask.mockReturnValue(task);

      const result = await service.createTask('zone-test-1', 'agent-1', 'Another Task');

      expect(MockedZoneRepository.updateZoneContext).not.toHaveBeenCalled();
      expect(result).toEqual(task);
    });

    it('should throw when non-creator tries to create task', async () => {
      MockedZoneRepository.getZone.mockReturnValue(mockZone());
      MockedZoneRepository.getZoneContext.mockReturnValue({ taskPolicy: '', taskCreatorId: 'agent-1', members: [] });

      await expect(service.createTask('zone-test-1', 'agent-2', 'New Task')).rejects.toThrow('只有任务创建者可以创建新任务');
    });

    it('should throw when zone context not found', async () => {
      MockedZoneRepository.getZone.mockReturnValue(mockZone());
      MockedZoneRepository.getZoneContext.mockReturnValue(null);

      await expect(service.createTask('zone-test-1', 'agent-1', 'New Task')).rejects.toThrow('Zone context not found: zone-test-1');
    });

    it('should throw when permission denied', async () => {
      mockCheckPermission.mockImplementation(() => {
        throw new Error('Permission denied');
      });

      await expect(service.createTask('zone-test-1', 'agent-1', 'New Task')).rejects.toThrow('Permission denied');
    });
  });

  // ============================================
  // updateTask
  // ============================================
  describe('updateTask', () => {
    it('should update task and publish event when creator', async () => {
      const zone = mockZone();
      const task = mockTask();
      const updated = mockTask({ title: 'Updated' });
      MockedZoneRepository.getZone.mockReturnValue(zone);
      MockedZoneRepository.getTask.mockReturnValue(task);
      MockedZoneRepository.getZoneContext.mockReturnValue({ taskPolicy: '', taskCreatorId: 'agent-1', members: [] });
      MockedZoneRepository.updateTask.mockReturnValue(updated);

      const result = await service.updateTask('zone-test-1', 'task-1', 'agent-1', { title: 'Updated' });

      expect(mockCheckPermission).toHaveBeenCalledWith('update_task', 'zone:zone-test-1', 'agent-1');
      expect(MockedZoneRepository.updateTask).toHaveBeenCalledWith('task-1', { title: 'Updated' });
      expect(MockedGatewayEventBus.publishZoneEvent).toHaveBeenCalledWith(
        'zone:task_updated',
        'zone-test-1',
        'zone-test-1',
        { task: updated }
      );
      expect(result).toEqual(updated);
    });

    it('should allow assignee to update task', async () => {
      const task = mockTask({ assignee: 'agent-2' });
      const updated = mockTask({ assignee: 'agent-2', status: 'in_progress' });
      MockedZoneRepository.getZone.mockReturnValue(mockZone());
      MockedZoneRepository.getTask.mockReturnValue(task);
      MockedZoneRepository.getZoneContext.mockReturnValue({ taskPolicy: '', taskCreatorId: 'agent-1', members: [] });
      MockedZoneRepository.updateTask.mockReturnValue(updated);

      const result = await service.updateTask('zone-test-1', 'task-1', 'agent-2', { status: 'in_progress' });

      expect(result).toEqual(updated);
    });

    it('should throw when neither creator nor assignee updates', async () => {
      MockedZoneRepository.getZone.mockReturnValue(mockZone());
      MockedZoneRepository.getTask.mockReturnValue(mockTask());
      MockedZoneRepository.getZoneContext.mockReturnValue({ taskPolicy: '', taskCreatorId: 'agent-1', members: [] });

      await expect(service.updateTask('zone-test-1', 'task-1', 'agent-3', { title: 'Hacked' })).rejects.toThrow(
        '只有任务创建者或认领者可以更新任务'
      );
    });

    it('should throw when task not found', async () => {
      MockedZoneRepository.getZone.mockReturnValue(mockZone());
      MockedZoneRepository.getTask.mockReturnValue(null);

      await expect(service.updateTask('zone-test-1', 'task-1', 'agent-1', {})).rejects.toThrow('Task not found: task-1');
    });

    it('should throw when task is in different zone', async () => {
      MockedZoneRepository.getZone.mockReturnValue(mockZone());
      MockedZoneRepository.getTask.mockReturnValue(mockTask({ zoneId: 'other-zone' }));

      await expect(service.updateTask('zone-test-1', 'task-1', 'agent-1', {})).rejects.toThrow('Task not found: task-1');
    });
  });

  // ============================================
  // deleteTask
  // ============================================
  describe('deleteTask', () => {
    it('should delete task and publish event when creator', async () => {
      MockedZoneRepository.getZone.mockReturnValue(mockZone());
      MockedZoneRepository.getZoneContext.mockReturnValue({ taskPolicy: '', taskCreatorId: 'agent-1', members: [] });
      MockedZoneRepository.deleteTask.mockReturnValue(true);

      const result = await service.deleteTask('zone-test-1', 'task-1', 'agent-1');

      expect(mockCheckPermission).toHaveBeenCalledWith('delete_task', 'zone:zone-test-1', 'agent-1');
      expect(MockedZoneRepository.deleteTask).toHaveBeenCalledWith('task-1');
      expect(MockedGatewayEventBus.publishZoneEvent).toHaveBeenCalledWith(
        'zone:task_deleted',
        'zone-test-1',
        'zone-test-1',
        { taskId: 'task-1' }
      );
      expect(result).toBe(true);
    });

    it('should throw when non-creator tries to delete', async () => {
      MockedZoneRepository.getZone.mockReturnValue(mockZone());
      MockedZoneRepository.getZoneContext.mockReturnValue({ taskPolicy: '', taskCreatorId: 'agent-1', members: [] });

      await expect(service.deleteTask('zone-test-1', 'task-1', 'agent-2')).rejects.toThrow('只有任务创建者可以删除任务');
    });

    it('should return false when delete fails', async () => {
      MockedZoneRepository.getZone.mockReturnValue(mockZone());
      MockedZoneRepository.getZoneContext.mockReturnValue({ taskPolicy: '', taskCreatorId: 'agent-1', members: [] });
      MockedZoneRepository.deleteTask.mockReturnValue(false);

      const result = await service.deleteTask('zone-test-1', 'task-1', 'agent-1');

      expect(MockedGatewayEventBus.publishZoneEvent).not.toHaveBeenCalled();
      expect(result).toBe(false);
    });
  });

  // ============================================
  // claimTask
  // ============================================
  describe('claimTask', () => {
    it('should claim unassigned pending task', async () => {
      const task = mockTask();
      const updated = mockTask({ assignee: 'agent-1', status: 'in_progress' });
      MockedZoneRepository.getZone.mockReturnValue(mockZone());
      MockedZoneRepository.getTask.mockReturnValue(task);
      MockedZoneRepository.updateTask.mockReturnValue(updated);

      const result = await service.claimTask('zone-test-1', 'task-1', 'agent-1');

      expect(mockCheckPermission).toHaveBeenCalledWith('claim_task', 'zone:zone-test-1', 'agent-1');
      expect(MockedZoneRepository.updateTask).toHaveBeenCalledWith('task-1', { assignee: 'agent-1', status: 'in_progress' });
      expect(MockedGatewayEventBus.publishZoneEvent).toHaveBeenCalledWith(
        'zone:task_claimed',
        'zone-test-1',
        'zone-test-1',
        { taskId: 'task-1', assignee: 'agent-1' }
      );
      expect(result).toEqual(updated);
    });

    it('should throw when task already claimed', async () => {
      MockedZoneRepository.getZone.mockReturnValue(mockZone());
      MockedZoneRepository.getTask.mockReturnValue(mockTask({ assignee: 'agent-2' }));

      await expect(service.claimTask('zone-test-1', 'task-1', 'agent-1')).rejects.toThrow('任务已被认领');
    });

    it('should throw when task is already done', async () => {
      MockedZoneRepository.getZone.mockReturnValue(mockZone());
      MockedZoneRepository.getTask.mockReturnValue(mockTask({ status: 'done' }));

      await expect(service.claimTask('zone-test-1', 'task-1', 'agent-1')).rejects.toThrow('任务已完成，无法认领');
    });

    it('should throw when task not found', async () => {
      MockedZoneRepository.getZone.mockReturnValue(mockZone());
      MockedZoneRepository.getTask.mockReturnValue(null);

      await expect(service.claimTask('zone-test-1', 'task-1', 'agent-1')).rejects.toThrow('Task not found: task-1');
    });
  });

  // ============================================
  // createTasksBatch
  // ============================================
  describe('createTasksBatch', () => {
    it('should create tasks in batch and return success/failed', async () => {
      const task1 = mockTask({ id: 'task-1', title: 'Task 1' });
      const task2 = mockTask({ id: 'task-2', title: 'Task 2' });
      MockedZoneRepository.getZone.mockReturnValue(mockZone());
      MockedZoneRepository.createTask.mockImplementation((zoneId, title) => {
        return title === 'Task 1' ? task1 : task2;
      });

      const result = await service.createTasksBatch('zone-test-1', 'agent-1', ['Task 1', 'Task 2']);

      expect(result.success).toHaveLength(2);
      expect(result.failed).toHaveLength(0);
      expect(MockedGatewayEventBus.publishZoneEvent).toHaveBeenCalledTimes(2);
    });

    it('should handle failures in batch creation', async () => {
      MockedZoneRepository.getZone.mockReturnValue(mockZone());
      MockedZoneRepository.createTask.mockImplementation((zoneId, title) => {
        if (title === 'Bad Task') throw new Error('DB error');
        return mockTask({ title });
      });

      const result = await service.createTasksBatch('zone-test-1', 'agent-1', ['Good Task', 'Bad Task']);

      expect(result.success).toHaveLength(1);
      expect(result.failed).toHaveLength(1);
      expect(result.failed[0]).toEqual({ title: 'Bad Task', error: 'DB error' });
    });
  });

  // ============================================
  // updateTasksBatch
  // ============================================
  describe('updateTasksBatch', () => {
    it('should update tasks in batch', async () => {
      const task = mockTask();
      const updated = mockTask({ title: 'Updated' });
      MockedZoneRepository.getZone.mockReturnValue(mockZone());
      MockedZoneRepository.getTask.mockReturnValue(task);
      MockedZoneRepository.getZoneContext.mockReturnValue({ taskPolicy: '', taskCreatorId: 'agent-1', members: [] });
      MockedZoneRepository.updateTask.mockReturnValue(updated);

      const result = await service.updateTasksBatch('zone-test-1', 'agent-1', [
        { taskId: 'task-1', title: 'Updated' },
      ]);

      expect(result.success).toHaveLength(1);
      expect(result.failed).toHaveLength(0);
      expect(MockedGatewayEventBus.publishZoneEvent).toHaveBeenCalled();
    });

    it('should handle task not found in batch update', async () => {
      MockedZoneRepository.getZone.mockReturnValue(mockZone());
      MockedZoneRepository.getTask.mockReturnValue(null);

      const result = await service.updateTasksBatch('zone-test-1', 'agent-1', [
        { taskId: 'task-1', title: 'Updated' },
      ]);

      expect(result.success).toHaveLength(0);
      expect(result.failed).toHaveLength(1);
      expect(result.failed[0].error).toContain('Task not found');
    });

    it('should handle permission error in batch update', async () => {
      MockedZoneRepository.getZone.mockReturnValue(mockZone());
      MockedZoneRepository.getTask.mockReturnValue(mockTask());
      MockedZoneRepository.getZoneContext.mockReturnValue({ taskPolicy: '', taskCreatorId: 'agent-1', members: [] });

      const result = await service.updateTasksBatch('zone-test-1', 'agent-2', [
        { taskId: 'task-1', title: 'Updated' },
      ]);

      expect(result.success).toHaveLength(0);
      expect(result.failed).toHaveLength(1);
      expect(result.failed[0].error).toContain('只有任务创建者或认领者可以更新任务');
    });
  });
});
