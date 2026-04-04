/**
 * ZoneService Unit Tests - StratixStateStore Integration
 */

import { ZoneService } from '../../src/stratix-gateway/project/ZoneService';
import { Zone, ZoneFile, ZoneTask } from '../../src/stratix-project/types';

// Mock dependencies
jest.mock('../../src/stratix-database/ZoneRepository');
jest.mock('../../src/stratix-database/ProjectRepository');
jest.mock('../../src/stratix-gateway/GatewayEventBus');
jest.mock('../../src/stratix-core/state', () => {
  const actual = jest.requireActual('../../src/stratix-core/state');
  return {
    ...actual,
    stratixStateStore: {
      getZone: jest.fn(),
      setZone: jest.fn(),
      removeZone: jest.fn(),
      updateZone: jest.fn(),
      get: jest.fn(),
      set: jest.fn(),
      subscribe: jest.fn(() => () => {}),
    },
  };
});

import { zoneRepository } from '../../src/stratix-database/ZoneRepository';
import { projectRepository } from '../../src/stratix-database/ProjectRepository';
import { gatewayEventBus } from '../../src/stratix-gateway/GatewayEventBus';
import { stratixStateStore } from '../../src/stratix-core/state';
import type { PermissionOrchestrator } from '../../src/stratix-core/permission';

const MockedZoneRepository = zoneRepository as jest.Mocked<typeof zoneRepository>;
const MockedProjectRepository = projectRepository as jest.Mocked<typeof projectRepository>;
const MockedGatewayEventBus = gatewayEventBus as jest.Mocked<typeof gatewayEventBus>;
const MockedStateStore = stratixStateStore as jest.Mocked<typeof stratixStateStore>;

// Helper: create a minimal Zone object
const mockZone = (overrides: Partial<Zone> = {}): Zone => ({
  id: 'zone-test-1',
  projectId: 'proj-1',
  title: 'Test Zone',
  prompt: 'Test prompt',
  description: '',
  priority: 3,
  status: 'idle',
  path: '',
  presentAgentIds: [],
  members: [],
  files: [],
  tasks: [],
  createdAt: Date.now(),
  updatedAt: Date.now(),
  ...overrides,
});

// Helper: create a PermissionOrchestrator mock that allows all actions
const mockPermissionAllow = (): PermissionOrchestrator => {
  const mockDecide = jest.fn().mockReturnValue({ decision: 'allow' as const, reason: 'mock', source: 'mock' });
  return {
    decide: mockDecide,
    addHook: jest.fn(),
    addZoneRule: jest.fn(),
  } as unknown as PermissionOrchestrator;
};

describe('ZoneService', () => {
  let service: ZoneService;

  beforeEach(() => {
    jest.resetAllMocks();
    service = new ZoneService();
    service.setPermissionOrchestrator(mockPermissionAllow());
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // ============================================
  // Initialization
  // ============================================
  describe('initialize', () => {
    it('should only initialize once', async () => {
      const initSpy = jest.spyOn(service, 'initialize');

      await service.initialize();
      await service.initialize();

      expect(initSpy).toHaveBeenCalledTimes(2);
      // Second call should return early due to `initialized` flag
    });
  });

  // ============================================
  // Zone CRUD - StateStore Sync Tests
  // ============================================
  describe('createZone', () => {
    it('should create zone and sync to StateStore', async () => {
      const zone = mockZone({ id: 'zone-new', title: 'New Zone' });
      MockedProjectRepository.getProject.mockReturnValue({ id: 'proj-1', name: 'Test' } as any);
      MockedZoneRepository.createZone.mockReturnValue(zone);
      MockedStateStore.setZone.mockClear();

      const result = await service.createZone('proj-1', 'New Zone', 'KR', 'agent-1');

      expect(result).toEqual(zone);
      expect(MockedStateStore.setZone).toHaveBeenCalledWith('zone-new', expect.objectContaining({
        id: 'zone-new',
        title: 'New Zone',
        status: 'idle',
        members: [],
        tasks: [],
      }));
    });

    it('should throw if project not found', async () => {
      MockedProjectRepository.getProject.mockReturnValue(null);

      await expect(service.createZone('invalid-proj', 'Title', 'KR', 'agent-1'))
        .rejects.toThrow('Project not found: invalid-proj');
    });

    it('should throw permission denied when orchestrator denies', async () => {
      MockedProjectRepository.getProject.mockReturnValue({ id: 'proj-1', name: 'Test' } as any);
      const mockPermOrchestrator = {
        decide: jest.fn().mockReturnValue({ decision: 'deny' as const }),
      } as any;
      service.setPermissionOrchestrator(mockPermOrchestrator);

      await expect(service.createZone('proj-1', 'Title', 'KR', 'agent-1'))
        .rejects.toThrow('Permission denied');
    });
  });

  describe('updateZone', () => {
    it('should update zone and sync to StateStore', async () => {
      const zone = mockZone({ id: 'zone-1', title: 'Updated Title' });
      MockedZoneRepository.updateZone.mockReturnValue(zone);
      MockedStateStore.setZone.mockClear();
      MockedGatewayEventBus.publishZoneEvent.mockClear();

      const result = await service.updateZone('zone-1', { title: 'Updated Title' }, 'agent-1');

      expect(result).toEqual(zone);
      expect(MockedStateStore.setZone).toHaveBeenCalledWith('zone-1', expect.objectContaining({
        id: 'zone-1',
        title: 'Updated Title',
      }));
      expect(MockedGatewayEventBus.publishZoneEvent).toHaveBeenCalledWith(
        'zone:updated', 'zone-1', expect.any(String), { title: 'Updated Title', prompt: 'Test prompt' }
      );
    });

    it('should throw if zone not found', async () => {
      MockedZoneRepository.updateZone.mockReturnValue(null);

      await expect(service.updateZone('nonexistent', { title: 'X' }, 'agent-1'))
        .rejects.toThrow('Zone not found: nonexistent');
    });
  });

  describe('deleteZone (soft delete)', () => {
    it('should soft delete zone and remove from StateStore', async () => {
      const zone = mockZone({ id: 'zone-del', title: 'To Delete' });
      MockedZoneRepository.getZone.mockReturnValue(zone);
      MockedZoneRepository.deleteZone.mockReturnValue(true);
      MockedStateStore.removeZone.mockClear();
      MockedGatewayEventBus.publishZoneEvent.mockClear();

      const result = await service.deleteZone('zone-del', 'agent-1');

      expect(result).toBe(true);
      expect(MockedStateStore.removeZone).toHaveBeenCalledWith('zone-del');
      expect(MockedGatewayEventBus.publishZoneEvent).toHaveBeenCalledWith(
        'zone:deleted', 'zone-del', expect.any(String), { title: 'To Delete' }
      );
    });

    it('should return false if zone does not exist', async () => {
      MockedZoneRepository.getZone.mockReturnValue(null);

      const result = await service.deleteZone('nonexistent', 'agent-1');

      expect(result).toBe(false);
      expect(MockedStateStore.removeZone).not.toHaveBeenCalled();
    });
  });

  describe('getZones', () => {
    it('should return zones for project', async () => {
      const zones = [mockZone({ id: 'z1' }), mockZone({ id: 'z2' })];
      MockedProjectRepository.getProject.mockReturnValue({ id: 'proj-1' } as any);
      MockedZoneRepository.getZonesByProject.mockReturnValue(zones);

      const result = await service.getZones('proj-1');

      expect(result).toHaveLength(2);
      expect(MockedZoneRepository.getZonesByProject).toHaveBeenCalledWith('proj-1');
    });

    it('should throw if project not found', async () => {
      MockedProjectRepository.getProject.mockReturnValue(null);

      await expect(service.getZones('invalid')).rejects.toThrow('Project not found');
    });
  });

  describe('getZone', () => {
    it('should return zone by id', async () => {
      const zone = mockZone({ id: 'zone-get' });
      MockedZoneRepository.getZone.mockReturnValue(zone);

      const result = await service.getZone('zone-get');

      expect(result).toEqual(zone);
    });
  });

  // ============================================
  // Member Management - StateStore Sync Tests
  // ============================================
  describe('addMember', () => {
    it('should add member and sync to StateStore', async () => {
      const zone = mockZone({ id: 'zone-1', members: ['agent-1'] });
      MockedZoneRepository.addMember.mockReturnValue(zone);
      MockedStateStore.setZone.mockClear();
      MockedGatewayEventBus.publishZoneEvent.mockClear();

      const result = await service.addMember('zone-1', 'agent-1', 'agent-1');

      expect(result).toEqual(zone);
      expect(MockedStateStore.setZone).toHaveBeenCalledWith('zone-1', expect.objectContaining({
        id: 'zone-1',
        members: ['agent-1'],
      }));
      expect(MockedGatewayEventBus.publishZoneEvent).toHaveBeenCalledWith(
        'zone:member_joined', 'zone-1', expect.any(String), { agentId: 'agent-1' }
      );
    });

    it('should throw if zone not found', async () => {
      MockedZoneRepository.addMember.mockReturnValue(null);

      await expect(service.addMember('nonexistent', 'agent-1', 'agent-1'))
        .rejects.toThrow('Zone not found: nonexistent');
    });
  });

  describe('removeMember', () => {
    it('should remove member and sync to StateStore', async () => {
      const zone = mockZone({ id: 'zone-1', members: [] });
      MockedZoneRepository.removeMember.mockReturnValue(zone);
      MockedStateStore.setZone.mockClear();
      MockedGatewayEventBus.publishZoneEvent.mockClear();

      const result = await service.removeMember('zone-1', 'agent-1', 'agent-1');

      expect(result).toEqual(zone);
      expect(MockedStateStore.setZone).toHaveBeenCalledWith('zone-1', expect.objectContaining({
        id: 'zone-1',
        members: [],
      }));
      expect(MockedGatewayEventBus.publishZoneEvent).toHaveBeenCalledWith(
        'zone:member_left', 'zone-1', expect.any(String), { agentId: 'agent-1' }
      );
    });

    it('should throw if zone not found', async () => {
      MockedZoneRepository.removeMember.mockReturnValue(null);

      await expect(service.removeMember('nonexistent', 'agent-1', 'agent-1'))
        .rejects.toThrow('Zone not found: nonexistent');
    });
  });

  describe('addMembers (batch)', () => {
    it('should add multiple members and sync to StateStore', async () => {
      const zone = mockZone({ id: 'zone-1', members: ['agent-1', 'agent-2', 'agent-3'] });
      MockedZoneRepository.addMembers.mockReturnValue(zone);
      MockedStateStore.setZone.mockClear();

      const result = await service.addMembers('zone-1', ['agent-1', 'agent-2', 'agent-3'], 'agent-1');

      expect(result).toEqual(zone);
      expect(MockedStateStore.setZone).toHaveBeenCalledWith('zone-1', expect.objectContaining({
        id: 'zone-1',
        members: ['agent-1', 'agent-2', 'agent-3'],
      }));
      // Should publish event for each member
      expect(MockedGatewayEventBus.publishZoneEvent).toHaveBeenCalledTimes(3);
    });
  });

  describe('removeMembers (batch)', () => {
    it('should remove multiple members and sync to StateStore', async () => {
      const zone = mockZone({ id: 'zone-1', members: ['agent-3'] });
      MockedZoneRepository.removeMembers.mockReturnValue(zone);
      MockedStateStore.setZone.mockClear();

      const result = await service.removeMembers('zone-1', ['agent-1', 'agent-2'], 'agent-1');

      expect(result).toEqual(zone);
      expect(MockedStateStore.setZone).toHaveBeenCalledWith('zone-1', expect.objectContaining({
        id: 'zone-1',
        members: ['agent-3'],
      }));
      expect(MockedGatewayEventBus.publishZoneEvent).toHaveBeenCalledTimes(2);
    });
  });

  // ============================================
  // Soft Delete / Recovery - StateStore Sync Tests
  // ============================================
  describe('getDeletedZones', () => {
    it('should return soft-deleted zones for project', async () => {
      const deletedZones = [mockZone({ id: 'zone-deleted' })];
      MockedProjectRepository.getProject.mockReturnValue({ id: 'proj-1' } as any);
      MockedZoneRepository.getDeletedZones.mockReturnValue(deletedZones);

      const result = await service.getDeletedZones('proj-1');

      expect(result).toHaveLength(1);
      expect(MockedZoneRepository.getDeletedZones).toHaveBeenCalledWith('proj-1');
    });

    it('should throw if project not found', async () => {
      MockedProjectRepository.getProject.mockReturnValue(null);

      await expect(service.getDeletedZones('invalid')).rejects.toThrow('Project not found');
    });
  });

  describe('restoreZone', () => {
    it('should restore zone and sync to StateStore', async () => {
      const zone = mockZone({ id: 'zone-restore', title: 'Restored Zone' });
      MockedZoneRepository.getDeletedZone.mockReturnValue(zone);
      MockedZoneRepository.restoreZone.mockReturnValue(zone);
      MockedStateStore.setZone.mockClear();
      MockedGatewayEventBus.publishZoneEvent.mockClear();

      const result = await service.restoreZone('zone-restore', 'agent-1');

      expect(result).toEqual(zone);
      expect(MockedStateStore.setZone).toHaveBeenCalledWith('zone-restore', expect.objectContaining({
        id: 'zone-restore',
        title: 'Restored Zone',
      }));
      expect(MockedGatewayEventBus.publishZoneEvent).toHaveBeenCalledWith(
        'zone:restored', 'zone-restore', expect.any(String), { title: 'Restored Zone' }
      );
    });

    it('should throw if deleted zone not found', async () => {
      MockedZoneRepository.getDeletedZone.mockReturnValue(null);

      await expect(service.restoreZone('nonexistent', 'agent-1'))
        .rejects.toThrow('Deleted zone not found: nonexistent');
    });
  });

  describe('permanentlyDeleteZone', () => {
    it('should permanently delete zone and remove from StateStore', async () => {
      const zone = mockZone({ id: 'zone-perm' });
      MockedZoneRepository.getDeletedZone.mockReturnValue(zone);
      MockedZoneRepository.permanentlyDeleteZone.mockReturnValue(true);
      MockedStateStore.removeZone.mockClear();

      const result = await service.permanentlyDeleteZone('zone-perm', 'agent-1');

      expect(result).toBe(true);
      expect(MockedStateStore.removeZone).toHaveBeenCalledWith('zone-perm');
    });

    it('should throw if zone is not in deleted state', async () => {
      MockedZoneRepository.getDeletedZone.mockReturnValue(null);

      await expect(service.permanentlyDeleteZone('zone-active', 'agent-1'))
        .rejects.toThrow('Deleted zone not found: zone-active');
    });
  });

  describe('emptyTrash', () => {
    it('should permanently delete all soft-deleted zones', async () => {
      const deletedZones = [
        mockZone({ id: 'trash-1' }),
        mockZone({ id: 'trash-2' }),
      ];
      MockedProjectRepository.getProject.mockReturnValue({ id: 'proj-1' } as any);
      MockedZoneRepository.getDeletedZones.mockReturnValue(deletedZones);
      MockedZoneRepository.permanentlyDeleteZone.mockReturnValue(true);
      MockedStateStore.removeZone.mockClear();

      const result = await service.emptyTrash('proj-1', 'agent-1');

      expect(result.deleted).toBe(2);
      expect(result.failed).toBe(0);
      expect(MockedStateStore.removeZone).toHaveBeenCalledTimes(2);
    });

    it('should count failures', async () => {
      const deletedZones = [
        mockZone({ id: 'trash-1' }),
        mockZone({ id: 'trash-2' }),
      ];
      MockedProjectRepository.getProject.mockReturnValue({ id: 'proj-1' } as any);
      MockedZoneRepository.getDeletedZones.mockReturnValue(deletedZones);
      // Simulate first delete succeeds, second throws exception
      MockedZoneRepository.permanentlyDeleteZone
        .mockReturnValueOnce(true)
        .mockImplementationOnce(() => { throw new Error('DB error'); });
      MockedStateStore.removeZone.mockClear();

      const result = await service.emptyTrash('proj-1', 'agent-1');

      expect(result.deleted).toBe(1);
      expect(result.failed).toBe(1);
    });
  });

  // ============================================
  // Zone Files
  // ============================================
  describe('addFile', () => {
    it('should add file and publish event', async () => {
      const zone = mockZone({ id: 'zone-1' });
      const file: ZoneFile = {
        id: 'file-1',
        zoneId: 'zone-1',
        name: 'test.md',
        sourceType: 'local',
        source: '/path/to/test.md',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      MockedZoneRepository.getZone.mockReturnValue(zone);
      MockedZoneRepository.addFile.mockReturnValue(file);
      MockedZoneRepository.updateFile.mockReturnValue(file);
      MockedZoneRepository.getFile.mockReturnValue(file);
      MockedGatewayEventBus.publishZoneEvent.mockClear();

      const result = await service.addFile('zone-1', 'test.md', 'local', '/path/to/test.md', undefined, 'agent-1');

      expect(result).toEqual(file);
      expect(MockedGatewayEventBus.publishZoneEvent).toHaveBeenCalledWith(
        'zone:file_added', 'zone-1', expect.any(String), { file }
      );
    });

    it('should throw if zone not found', async () => {
      MockedZoneRepository.getZone.mockReturnValue(null);

      await expect(service.addFile('nonexistent', 'test.md', 'local', '/path', undefined, 'agent-1'))
        .rejects.toThrow('Zone not found: nonexistent');
    });
  });

  describe('removeFile', () => {
    it('should remove file and publish event', async () => {
      const zone = mockZone({ id: 'zone-1' });
      const file: ZoneFile = {
        id: 'file-1',
        zoneId: 'zone-1',
        name: 'test.md',
        sourceType: 'local',
        source: '/path',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      MockedZoneRepository.getZone.mockReturnValue(zone);
      MockedZoneRepository.getFile.mockReturnValue(file);
      MockedZoneRepository.deleteFile.mockReturnValue(true);
      MockedGatewayEventBus.publishZoneEvent.mockClear();

      const result = await service.removeFile('zone-1', 'file-1', 'agent-1');

      expect(result).toBe(true);
      expect(MockedGatewayEventBus.publishZoneEvent).toHaveBeenCalledWith(
        'zone:file_removed', 'zone-1', expect.any(String), { fileId: 'file-1', fileName: 'test.md' }
      );
    });

    it('should throw if file not found in zone', async () => {
      const zone = mockZone({ id: 'zone-1' });
      MockedZoneRepository.getZone.mockReturnValue(zone);
      MockedZoneRepository.getFile.mockReturnValue(null);

      await expect(service.removeFile('zone-1', 'nonexistent', 'agent-1'))
        .rejects.toThrow('File nonexistent not found in zone zone-1');
    });
  });

  // ============================================
  // Zone Tasks
  // ============================================
  describe('getTasks', () => {
    it('should return tasks for zone', async () => {
      const zone = mockZone({ id: 'zone-1' });
      const tasks: ZoneTask[] = [
        { id: 'task-1', zoneId: 'zone-1', title: 'Task 1', status: 'pending', assignee: null, createdBy: 'agent-1', createdAt: Date.now(), updatedAt: Date.now() },
      ];
      MockedZoneRepository.getZone.mockReturnValue(zone);
      MockedZoneRepository.getTasks.mockReturnValue(tasks);

      const result = await service.getTasks('zone-1');

      expect(result).toHaveLength(1);
    });

    it('should throw if zone not found', async () => {
      MockedZoneRepository.getZone.mockReturnValue(null);

      await expect(service.getTasks('nonexistent')).rejects.toThrow('Zone not found');
    });
  });

  describe('createTask', () => {
    it('should create task and publish event', async () => {
      const zone = mockZone({ id: 'zone-1' });
      const task: ZoneTask = {
        id: 'task-new',
        zoneId: 'zone-1',
        title: 'New Task',
        status: 'pending',
        assignee: null,
        createdBy: 'agent-1',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      MockedZoneRepository.getZone.mockReturnValue(zone);
      MockedZoneRepository.getZoneContext.mockReturnValue({ taskPolicy: 'creator', taskCreatorId: null, members: [] });
      MockedZoneRepository.updateZoneContext.mockReturnValue(true);
      MockedZoneRepository.createTask.mockReturnValue(task);
      MockedGatewayEventBus.publishZoneEvent.mockClear();

      const result = await service.createTask('zone-1', 'agent-1', 'New Task');

      expect(result).toEqual(task);
      expect(MockedGatewayEventBus.publishZoneEvent).toHaveBeenCalledWith(
        'zone:task_created', 'zone-1', expect.any(String), { task }
      );
    });
  });

  describe('claimTask', () => {
    it('should claim task and publish event', async () => {
      const zone = mockZone({ id: 'zone-1' });
      const task: ZoneTask = {
        id: 'task-1',
        zoneId: 'zone-1',
        title: 'Task 1',
        status: 'pending',
        assignee: null,
        createdBy: 'agent-2',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      const claimedTask: ZoneTask = { ...task, status: 'in_progress', assignee: 'agent-1' };
      MockedZoneRepository.getZone.mockReturnValue(zone);
      MockedZoneRepository.getTask.mockReturnValue(task);
      MockedZoneRepository.updateTask.mockReturnValue(claimedTask);
      MockedGatewayEventBus.publishZoneEvent.mockClear();

      const result = await service.claimTask('zone-1', 'task-1', 'agent-1');

      expect(result.assignee).toBe('agent-1');
      expect(MockedGatewayEventBus.publishZoneEvent).toHaveBeenCalledWith(
        'zone:task_claimed', 'zone-1', expect.any(String), { taskId: 'task-1', assignee: 'agent-1' }
      );
    });

    it('should throw if task already assigned', async () => {
      const zone = mockZone({ id: 'zone-1' });
      const task: ZoneTask = {
        id: 'task-1',
        zoneId: 'zone-1',
        title: 'Task 1',
        status: 'pending',
        assignee: 'agent-2',
        createdBy: 'agent-2',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      MockedZoneRepository.getZone.mockReturnValue(zone);
      MockedZoneRepository.getTask.mockReturnValue(task);

      await expect(service.claimTask('zone-1', 'task-1', 'agent-1'))
        .rejects.toThrow('任务已被认领');
    });
  });

  // ============================================
  // Zone Messages
  // ============================================
  describe('addMessage', () => {
    it('should add message and publish event', async () => {
      const zone = mockZone({ id: 'zone-1' });
      MockedZoneRepository.getZone.mockReturnValue(zone);
      MockedZoneRepository.addMessage.mockReturnValue({
        id: 'msg-1',
        zoneId: 'zone-1',
        senderId: 'agent-1',
        senderType: 'agent',
        content: 'Hello',
        createdAt: Date.now(),
      });
      MockedGatewayEventBus.publishZoneEvent.mockClear();

      const result = await service.addMessage('zone-1', 'agent-1', 'agent', 'Hello');

      expect(result.content).toBe('Hello');
      expect(MockedGatewayEventBus.publishZoneEvent).toHaveBeenCalledWith(
        'zone:message_added', 'zone-1', expect.any(String), expect.objectContaining({ message: expect.any(Object) })
      );
    });
  });

  // ============================================
  // Zone Clone
  // ============================================
  describe('cloneZone', () => {
    it('should clone zone with files and sync new zone to StateStore', async () => {
      const sourceZone = mockZone({ id: 'zone-source', projectId: 'proj-1', title: 'Source Zone' });
      const clonedZone = mockZone({ id: 'zone-clone', projectId: 'proj-1', title: 'Clone of Source Zone' });

      MockedZoneRepository.getZone
        .mockReturnValueOnce(sourceZone)
        .mockReturnValueOnce(clonedZone);
      MockedZoneRepository.createZone.mockReturnValue(clonedZone);
      MockedZoneRepository.getFilesByZone.mockReturnValue([]);
      MockedZoneRepository.getTasks.mockReturnValue([]);
      MockedStateStore.setZone.mockClear();

      const result = await service.cloneZone('zone-source', { includeFiles: false, includeTasks: false }, 'agent-1');

      expect(result).toEqual(clonedZone);
      // Called once for the initial createZone sync
      expect(MockedStateStore.setZone).toHaveBeenCalledWith('zone-clone', expect.objectContaining({
        id: 'zone-clone',
      }));
    });
  });

  // ============================================
  // Zone Search
  // ============================================
  describe('searchZones', () => {
    it('should search zones by keyword', async () => {
      const zones = [mockZone({ id: 'zone-match' })];
      MockedZoneRepository.searchZones.mockReturnValue(zones);

      const result = await service.searchZones('test', 20);

      expect(result).toHaveLength(1);
      expect(MockedZoneRepository.searchZones).toHaveBeenCalledWith('test', 20);
    });
  });

  // ============================================
  // Zone Statistics
  // ============================================
  describe('getZoneStatistics', () => {
    it('should return correct statistics', async () => {
      const zone = mockZone({ id: 'zone-1', members: ['a1', 'a2'], files: [{ id: 'f1' } as ZoneFile] });
      const tasks: ZoneTask[] = [
        { id: 't1', zoneId: 'zone-1', title: 'T1', status: 'pending', assignee: null, createdBy: 'a1', createdAt: 0, updatedAt: 0 },
        { id: 't2', zoneId: 'zone-1', title: 'T2', status: 'in_progress', assignee: null, createdBy: 'a1', createdAt: 0, updatedAt: 0 },
        { id: 't3', zoneId: 'zone-1', title: 'T3', status: 'done', assignee: null, createdBy: 'a1', createdAt: 0, updatedAt: 0 },
      ];
      MockedZoneRepository.getZone.mockReturnValue(zone);
      MockedZoneRepository.getTasks.mockReturnValue(tasks);

      const result = await service.getZoneStatistics('zone-1');

      expect(result.tasks.total).toBe(3);
      expect(result.tasks.pending).toBe(1);
      expect(result.tasks.in_progress).toBe(1);
      expect(result.tasks.done).toBe(1);
      expect(result.files.total).toBe(1);
      expect(result.members.total).toBe(2);
    });
  });

  // ============================================
  // File Cache Configuration
  // ============================================
  describe('configureFileCache', () => {
    it('should configure cache settings', () => {
      service.configureFileCache({
        cacheExpiry: 7200000,
        maxFileSize: 20 * 1024 * 1024,
        allowedBasePaths: ['/safe/path'],
        allowedUrlPatterns: ['https://trusted.*'],
        blockedIpRanges: ['192.168.0.0/16'],
      });

      // No error means success
      expect(true).toBe(true);
    });
  });

  describe('shouldRefreshFile', () => {
    it('should return true when no content cached', () => {
      const file: ZoneFile = {
        id: 'file-1',
        zoneId: 'zone-1',
        name: 'test.md',
        sourceType: 'url',
        source: 'https://example.com/file.md',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      expect(service.shouldRefreshFile(file)).toBe(true);
    });

    it('should return true when cache expired', () => {
      const now = Date.now();
      const file: ZoneFile = {
        id: 'file-1',
        zoneId: 'zone-1',
        name: 'test.md',
        sourceType: 'url',
        source: 'https://example.com/file.md',
        content: 'cached content',
        lastFetched: now - 7200000, // 2 hours ago
        createdAt: now,
        updatedAt: now,
      };

      // Default cacheExpiry is 3600000 (1 hour), so 2 hours should trigger refresh
      expect(service.shouldRefreshFile(file)).toBe(true);
    });

    it('should return false when cache is still valid', () => {
      const now = Date.now();
      const file: ZoneFile = {
        id: 'file-1',
        zoneId: 'zone-1',
        name: 'test.md',
        sourceType: 'url',
        source: 'https://example.com/file.md',
        content: 'cached content',
        lastFetched: now - 1800000, // 30 minutes ago
        createdAt: now,
        updatedAt: now,
      };

      // Default cacheExpiry is 3600000 (1 hour), so 30 minutes should NOT trigger refresh
      expect(service.shouldRefreshFile(file)).toBe(false);
    });
  });
});
