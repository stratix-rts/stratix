/**
 * ZoneService Unit Tests
 * Comprehensive coverage of ZoneService methods with focus on permission orchestration.
 */

import { ZoneService } from '../../src/stratix-gateway/project/ZoneService';
import { Zone, ZoneFile, ZoneTask, FileType } from '../../src/stratix-project/types';

// ============================================
// Mock Setup
// ============================================

// Mock fs module
jest.mock('fs', () => ({
  stat: jest.fn(),
  readFile: jest.fn(),
  readdir: jest.fn(),
  createReadStream: jest.fn(),
}));

// Mock fetch for URL fetching
const mockFetch = jest.fn();
global.fetch = mockFetch;

// Mock all dependencies
jest.mock('../../src/stratix-database/ZoneRepository');
jest.mock('../../src/stratix-database/ProjectRepository');
jest.mock('../../src/stratix-gateway/GatewayEventBus');
jest.mock('../../src/stratix-core/state', () => ({
  stratixStateStore: {
    getZone: jest.fn(),
    setZone: jest.fn(),
    removeZone: jest.fn(),
    updateZone: jest.fn(),
    get: jest.fn(),
    set: jest.fn(),
    subscribe: jest.fn(() => () => {}),
  },
  ZoneState: {},
}));

import { zoneRepository } from '../../src/stratix-database/ZoneRepository';
import { projectRepository } from '../../src/stratix-database/ProjectRepository';
import { gatewayEventBus } from '../../src/stratix-gateway/GatewayEventBus';
import { stratixStateStore } from '../../src/stratix-core/state';
import type { PermissionOrchestrator, PermissionContext } from '../../src/stratix-core/permission';
import * as fs from 'fs';

const MockedZoneRepository = zoneRepository as jest.Mocked<typeof zoneRepository>;
const MockedProjectRepository = projectRepository as jest.Mocked<typeof projectRepository>;
const MockedGatewayEventBus = gatewayEventBus as jest.Mocked<typeof gatewayEventBus>;
const MockedStateStore = stratixStateStore as jest.Mocked<typeof stratixStateStore>;

// ============================================
// Test Data Factories
// ============================================

const createMockZone = (overrides: Partial<Zone> = {}): Zone => ({
  id: 'zone-test-1',
  projectId: 'proj-1',
  title: 'Test Zone',
  prompt: 'Test prompt',
  description: '',
  priority: 3,
  status: 'idle' as const,
  path: '',
  presentAgentIds: [],
  members: [],
  files: [],
  tasks: [],
  createdAt: 1700000000000,
  updatedAt: 1700000000000,
  ...overrides,
});

const createMockFile = (overrides: Partial<ZoneFile> = {}): ZoneFile => ({
  id: 'file-1',
  zoneId: 'zone-test-1',
  name: 'test.md',
  sourceType: 'local' as const,
  source: '/path/to/test.md',
  createdAt: 1700000000000,
  updatedAt: 1700000000000,
  ...overrides,
});

const createMockTask = (overrides: Partial<ZoneTask> = {}): ZoneTask => ({
  id: 'task-1',
  zoneId: 'zone-test-1',
  title: 'Test Task',
  status: 'pending' as const,
  assignee: null,
  createdBy: 'agent-1',
  createdAt: 1700000000000,
  updatedAt: 1700000000000,
  ...overrides,
});

// ============================================
// Permission Orchestrator Helpers
// ============================================

const mockPermissionAllow = (): PermissionOrchestrator => ({
  decide: jest.fn().mockReturnValue({ decision: 'allow' as const, reason: 'mock-allow', source: 'mock' }),
  addHook: jest.fn(),
  addZoneRule: jest.fn(),
} as unknown as PermissionOrchestrator);

const mockPermissionDeny = (): PermissionOrchestrator => ({
  decide: jest.fn().mockReturnValue({ decision: 'deny' as const, reason: 'mock-deny', source: 'mock' }),
  addHook: jest.fn(),
  addZoneRule: jest.fn(),
} as unknown as PermissionOrchestrator);

const mockPermissionAsk = (): PermissionOrchestrator => ({
  decide: jest.fn().mockReturnValue({ decision: 'ask' as const, reason: 'mock-ask', source: 'mock' }),
  addHook: jest.fn(),
  addZoneRule: jest.fn(),
} as unknown as PermissionOrchestrator);

// Helper to capture permission context
const capturePermissionContext = (): { calls: PermissionContext[]; orchestrator: PermissionOrchestrator } => {
  const calls: PermissionContext[] = [];
  const orchestrator: PermissionOrchestrator = {
    decide: jest.fn().mockImplementation((ctx: PermissionContext) => {
      calls.push(ctx);
      return { decision: 'allow' as const, reason: 'captured', source: 'mock' };
    }),
    addHook: jest.fn(),
    addZoneRule: jest.fn(),
  } as unknown as PermissionOrchestrator;
  return { calls, orchestrator };
};

// ============================================
// Test Suite
// ============================================

describe('ZoneService', () => {
  let service: ZoneService;

  beforeEach(async () => {
    jest.resetAllMocks();
    service = new ZoneService();
    await service.initialize();
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
    });

    it('should set initialized flag', async () => {
      expect(service['initialized']).toBe(false);
      await service.initialize();
      expect(service['initialized']).toBe(true);
    });
  });

  // ============================================
  // Permission Check Tests - All Write Operations
  // ============================================
  describe('Permission Checks on Write Operations', () => {
    describe('createZone', () => {
      it('should call permission check with correct params', async () => {
        const { calls, orchestrator } = capturePermissionContext();
        service.setPermissionOrchestrator(orchestrator);
        MockedProjectRepository.getProject.mockReturnValue({ id: 'proj-1', name: 'Test' } as any);
        MockedZoneRepository.createZone.mockReturnValue(createMockZone());

        await service.createZone('proj-1', 'New Zone', 'KR', 'agent-1');

        expect(calls).toContainEqual(expect.objectContaining({
          action: 'create',
          resource: 'project:proj-1',
          agentId: 'agent-1',
        }));
      });

      it('should throw when permission denied', async () => {
        service.setPermissionOrchestrator(mockPermissionDeny());
        MockedProjectRepository.getProject.mockReturnValue({ id: 'proj-1', name: 'Test' } as any);

        await expect(service.createZone('proj-1', 'Title', 'KR', 'agent-1'))
          .rejects.toThrow('Permission denied');
      });

      it('should throw when permission asks (requires confirmation)', async () => {
        service.setPermissionOrchestrator(mockPermissionAsk());
        MockedProjectRepository.getProject.mockReturnValue({ id: 'proj-1', name: 'Test' } as any);

        await expect(service.createZone('proj-1', 'Title', 'KR', 'agent-1'))
          .rejects.toThrow('Permission requires confirmation');
      });

      it('should proceed without permission orchestrator', async () => {
        service.setPermissionOrchestrator(null as any);
        MockedProjectRepository.getProject.mockReturnValue({ id: 'proj-1', name: 'Test' } as any);
        MockedZoneRepository.createZone.mockReturnValue(createMockZone());

        // Should not throw
        await expect(service.createZone('proj-1', 'Title', 'KR', 'agent-1'))
          .resolves.toBeDefined();
      });
    });

    describe('updateZone', () => {
      it('should call permission check with correct params', async () => {
        const { calls, orchestrator } = capturePermissionContext();
        service.setPermissionOrchestrator(orchestrator);
        MockedZoneRepository.updateZone.mockReturnValue(createMockZone({ id: 'zone-1', title: 'Updated' }));

        await service.updateZone('zone-1', { title: 'Updated' }, 'agent-1');

        expect(calls).toContainEqual(expect.objectContaining({
          action: 'update',
          resource: 'zone:zone-1',
          agentId: 'agent-1',
        }));
      });

      it('should throw when permission denied', async () => {
        service.setPermissionOrchestrator(mockPermissionDeny());

        await expect(service.updateZone('zone-1', { title: 'X' }, 'agent-1'))
          .rejects.toThrow('Permission denied');
      });
    });

    describe('deleteZone', () => {
      it('should call permission check with correct params', async () => {
        const { calls, orchestrator } = capturePermissionContext();
        service.setPermissionOrchestrator(orchestrator);
        MockedZoneRepository.getZone.mockReturnValue(createMockZone({ id: 'zone-1' }));
        MockedZoneRepository.deleteZone.mockReturnValue(true);

        await service.deleteZone('zone-1', 'agent-1');

        expect(calls).toContainEqual(expect.objectContaining({
          action: 'delete',
          resource: 'zone:zone-1',
          agentId: 'agent-1',
        }));
      });

      it('should throw when permission denied', async () => {
        service.setPermissionOrchestrator(mockPermissionDeny());
        MockedZoneRepository.getZone.mockReturnValue(createMockZone());

        await expect(service.deleteZone('zone-1', 'agent-1'))
          .rejects.toThrow('Permission denied');
      });
    });

    describe('restoreZone', () => {
      it('should call permission check with correct params', async () => {
        const { calls, orchestrator } = capturePermissionContext();
        service.setPermissionOrchestrator(orchestrator);
        MockedZoneRepository.getDeletedZone.mockReturnValue(createMockZone({ id: 'zone-del' }));
        MockedZoneRepository.restoreZone.mockReturnValue(createMockZone({ id: 'zone-del' }));

        await service.restoreZone('zone-del', 'agent-1');

        expect(calls).toContainEqual(expect.objectContaining({
          action: 'restore',
          resource: 'zone:zone-del',
          agentId: 'agent-1',
        }));
      });

      it('should throw when permission denied', async () => {
        service.setPermissionOrchestrator(mockPermissionDeny());
        MockedZoneRepository.getDeletedZone.mockReturnValue(createMockZone());

        await expect(service.restoreZone('zone-1', 'agent-1'))
          .rejects.toThrow('Permission denied');
      });
    });

    describe('permanentlyDeleteZone', () => {
      it('should call permission check with correct params', async () => {
        const { calls, orchestrator } = capturePermissionContext();
        service.setPermissionOrchestrator(orchestrator);
        MockedZoneRepository.getDeletedZone.mockReturnValue(createMockZone());
        MockedZoneRepository.permanentlyDeleteZone.mockReturnValue(true);

        await service.permanentlyDeleteZone('zone-1', 'agent-1');

        expect(calls).toContainEqual(expect.objectContaining({
          action: 'permanent_delete',
          resource: 'zone:zone-1',
          agentId: 'agent-1',
        }));
      });
    });

    describe('emptyTrash', () => {
      it('should call permission check with project resource', async () => {
        const { calls, orchestrator } = capturePermissionContext();
        service.setPermissionOrchestrator(orchestrator);
        MockedProjectRepository.getProject.mockReturnValue({ id: 'proj-1' } as any);
        MockedZoneRepository.getDeletedZones.mockReturnValue([]);

        await service.emptyTrash('proj-1', 'agent-1');

        expect(calls).toContainEqual(expect.objectContaining({
          action: 'empty_trash',
          resource: 'project:proj-1',
          agentId: 'agent-1',
        }));
      });
    });

    describe('addMember', () => {
      it('should call permission check with correct params', async () => {
        const { calls, orchestrator } = capturePermissionContext();
        service.setPermissionOrchestrator(orchestrator);
        MockedZoneRepository.addMember.mockReturnValue(createMockZone({ members: ['agent-new'] }));

        await service.addMember('zone-1', 'agent-new', 'agent-1');

        expect(calls).toContainEqual(expect.objectContaining({
          action: 'add_member',
          resource: 'zone:zone-1',
          agentId: 'agent-1',
        }));
      });

      it('should throw when permission denied', async () => {
        service.setPermissionOrchestrator(mockPermissionDeny());
        MockedZoneRepository.addMember.mockReturnValue(createMockZone());

        await expect(service.addMember('zone-1', 'agent-2', 'agent-1'))
          .rejects.toThrow('Permission denied');
      });
    });

    describe('removeMember', () => {
      it('should call permission check with correct params', async () => {
        const { calls, orchestrator } = capturePermissionContext();
        service.setPermissionOrchestrator(orchestrator);
        MockedZoneRepository.removeMember.mockReturnValue(createMockZone({ members: [] }));

        await service.removeMember('zone-1', 'agent-1', 'agent-1');

        expect(calls).toContainEqual(expect.objectContaining({
          action: 'remove_member',
          resource: 'zone:zone-1',
          agentId: 'agent-1',
        }));
      });
    });

    describe('addMembers (batch)', () => {
      it('should call permission check', async () => {
        const { calls, orchestrator } = capturePermissionContext();
        service.setPermissionOrchestrator(orchestrator);
        MockedZoneRepository.addMembers.mockReturnValue(createMockZone({ members: ['a1', 'a2'] }));

        await service.addMembers('zone-1', ['a1', 'a2'], 'agent-1');

        expect(calls).toContainEqual(expect.objectContaining({
          action: 'add_members',
          resource: 'zone:zone-1',
        }));
      });
    });

    describe('removeMembers (batch)', () => {
      it('should call permission check', async () => {
        const { calls, orchestrator } = capturePermissionContext();
        service.setPermissionOrchestrator(orchestrator);
        MockedZoneRepository.removeMembers.mockReturnValue(createMockZone({ members: [] }));

        await service.removeMembers('zone-1', ['a1'], 'agent-1');

        expect(calls).toContainEqual(expect.objectContaining({
          action: 'remove_members',
          resource: 'zone:zone-1',
        }));
      });
    });

    describe('addFile', () => {
      it('should call permission check with correct params', async () => {
        const { calls, orchestrator } = capturePermissionContext();
        service.setPermissionOrchestrator(orchestrator);
        MockedZoneRepository.getZone.mockReturnValue(createMockZone());
        MockedZoneRepository.addFile.mockReturnValue(createMockFile());
        MockedZoneRepository.updateFile.mockReturnValue(createMockFile());
        MockedZoneRepository.getFile.mockReturnValue(createMockFile());

        await service.addFile('zone-1', 'test.md', 'local', '/path', undefined, 'agent-1');

        expect(calls).toContainEqual(expect.objectContaining({
          action: 'add_file',
          resource: 'zone:zone-1',
          agentId: 'agent-1',
        }));
      });
    });

    describe('addFiles (batch)', () => {
      it('should call permission check', async () => {
        const { calls, orchestrator } = capturePermissionContext();
        service.setPermissionOrchestrator(orchestrator);
        MockedZoneRepository.getZone.mockReturnValue(createMockZone());
        MockedZoneRepository.addFiles.mockReturnValue([createMockFile()]);

        await service.addFiles('zone-1', [{ name: 'test.md', sourceType: 'local', source: '/path' }], 'agent-1');

        expect(calls).toContainEqual(expect.objectContaining({
          action: 'add_files',
          resource: 'zone:zone-1',
        }));
      });
    });

    describe('removeFile', () => {
      it('should call permission check', async () => {
        const { calls, orchestrator } = capturePermissionContext();
        service.setPermissionOrchestrator(orchestrator);
        MockedZoneRepository.getZone.mockReturnValue(createMockZone());
        MockedZoneRepository.getFile.mockReturnValue(createMockFile({ zoneId: 'zone-1' }));
        MockedZoneRepository.deleteFile.mockReturnValue(true);

        await service.removeFile('zone-1', 'file-1', 'agent-1');

        expect(calls).toContainEqual(expect.objectContaining({
          action: 'remove_file',
          resource: 'zone:zone-1',
          agentId: 'agent-1',
        }));
      });
    });

    describe('refreshFile', () => {
      it('should call permission check', async () => {
        const { calls, orchestrator } = capturePermissionContext();
        service.setPermissionOrchestrator(orchestrator);
        MockedZoneRepository.getFile.mockReturnValue(createMockFile({ sourceType: 'url', source: 'https://example.com/file.md' }));

        // Need to mock fetch for URL
        mockFetch.mockResolvedValueOnce({ ok: true, text: () => Promise.resolve('content') } as any);

        await service.refreshFile('zone-1', 'file-1', false, 'agent-1');

        expect(calls).toContainEqual(expect.objectContaining({
          action: 'update_file',
          resource: 'zone:zone-1',
          agentId: 'agent-1',
        }));
      });
    });

    describe('updateFileWithVersion', () => {
      it('should call permission check', async () => {
        const { calls, orchestrator } = capturePermissionContext();
        service.setPermissionOrchestrator(orchestrator);
        MockedZoneRepository.getFile.mockReturnValue(createMockFile({ fileType: 'md' }));
        MockedZoneRepository.updateFile.mockReturnValue(createMockFile());

        await service.updateFileWithVersion('zone-1', 'file-1', 'new content', 'update', 'agent-1');

        expect(calls).toContainEqual(expect.objectContaining({
          action: 'update_file',
          resource: 'zone:zone-1',
          agentId: 'agent-1',
        }));
      });
    });

    describe('rollbackFileToVersion', () => {
      it('should call permission check', async () => {
        const { calls, orchestrator } = capturePermissionContext();
        service.setPermissionOrchestrator(orchestrator);
        MockedZoneRepository.getFile.mockReturnValue(createMockFile());
        MockedZoneRepository.rollbackFileToVersion.mockReturnValue(createMockFile());

        await service.rollbackFileToVersion('zone-1', 'file-1', 'version-1', 'agent-1');

        expect(calls).toContainEqual(expect.objectContaining({
          action: 'rollback_file',
          resource: 'zone:zone-1',
          agentId: 'agent-1',
        }));
      });
    });

    describe('scanFolder', () => {
      it('should call permission check', async () => {
        const { calls, orchestrator } = capturePermissionContext();
        service.setPermissionOrchestrator(orchestrator);
        MockedZoneRepository.getZone.mockReturnValue(createMockZone());
        MockedZoneRepository.addFile.mockReturnValue(createMockFile());
        MockedZoneRepository.getFile.mockReturnValue(createMockFile());

        // Mock fs.readdir
        jest.spyOn(fs, 'readdir').mockImplementation((path: any, opts: any, callback: any) => {
          if (typeof opts === 'function') opts(null, []);
          else if (typeof callback === 'function') callback(null, []);
          return {} as any;
        });

        await service.scanFolder('zone-1', '/path', false, undefined, 'agent-1');

        expect(calls).toContainEqual(expect.objectContaining({
          action: 'scan_folder',
          resource: 'zone:zone-1',
          agentId: 'agent-1',
        }));
      });
    });

    describe('createTask', () => {
      it('should call permission check', async () => {
        const { calls, orchestrator } = capturePermissionContext();
        service.setPermissionOrchestrator(orchestrator);
        MockedZoneRepository.getZone.mockReturnValue(createMockZone());
        MockedZoneRepository.getZoneContext.mockReturnValue({ taskPolicy: 'creator', taskCreatorId: null, members: [] });
        MockedZoneRepository.updateZoneContext.mockReturnValue(true);
        MockedZoneRepository.createTask.mockReturnValue(createMockTask());

        await service.createTask('zone-1', 'agent-1', 'New Task');

        expect(calls).toContainEqual(expect.objectContaining({
          action: 'create_task',
          resource: 'zone:zone-1',
          agentId: 'agent-1',
        }));
      });
    });

    describe('updateTask', () => {
      it('should call permission check', async () => {
        const { calls, orchestrator } = capturePermissionContext();
        service.setPermissionOrchestrator(orchestrator);
        MockedZoneRepository.getZone.mockReturnValue(createMockZone());
        MockedZoneRepository.getTask.mockReturnValue(createMockTask({ createdBy: 'agent-1' }));
        MockedZoneRepository.getZoneContext.mockReturnValue({ taskPolicy: 'creator', taskCreatorId: 'agent-1', members: [] });
        MockedZoneRepository.updateTask.mockReturnValue(createMockTask({ title: 'Updated' }));

        await service.updateTask('zone-1', 'task-1', 'agent-1', { title: 'Updated' });

        expect(calls).toContainEqual(expect.objectContaining({
          action: 'update_task',
          resource: 'zone:zone-1',
          agentId: 'agent-1',
        }));
      });
    });

    describe('deleteTask', () => {
      it('should call permission check', async () => {
        const { calls, orchestrator } = capturePermissionContext();
        service.setPermissionOrchestrator(orchestrator);
        MockedZoneRepository.getZone.mockReturnValue(createMockZone());
        MockedZoneRepository.getZoneContext.mockReturnValue({ taskPolicy: 'creator', taskCreatorId: 'agent-1', members: [] });
        MockedZoneRepository.deleteTask.mockReturnValue(true);

        await service.deleteTask('zone-1', 'task-1', 'agent-1');

        expect(calls).toContainEqual(expect.objectContaining({
          action: 'delete_task',
          resource: 'zone:zone-1',
          agentId: 'agent-1',
        }));
      });
    });

    describe('claimTask', () => {
      it('should call permission check', async () => {
        const { calls, orchestrator } = capturePermissionContext();
        service.setPermissionOrchestrator(orchestrator);
        MockedZoneRepository.getZone.mockReturnValue(createMockZone());
        MockedZoneRepository.getTask.mockReturnValue(createMockTask({ assignee: null, status: 'pending' }));
        MockedZoneRepository.updateTask.mockReturnValue(createMockTask({ assignee: 'agent-1', status: 'in_progress' }));

        await service.claimTask('zone-1', 'task-1', 'agent-1');

        expect(calls).toContainEqual(expect.objectContaining({
          action: 'claim_task',
          resource: 'zone:zone-1',
          agentId: 'agent-1',
        }));
      });
    });

    describe('createTasksBatch', () => {
      it('should call permission check', async () => {
        const { calls, orchestrator } = capturePermissionContext();
        service.setPermissionOrchestrator(orchestrator);
        MockedZoneRepository.getZone.mockReturnValue(createMockZone());
        MockedZoneRepository.createTask.mockReturnValue(createMockTask());

        await service.createTasksBatch('zone-1', 'agent-1', ['Task 1', 'Task 2']);

        expect(calls).toContainEqual(expect.objectContaining({
          action: 'create_tasks_batch',
          resource: 'zone:zone-1',
          agentId: 'agent-1',
        }));
      });
    });

    describe('updateTasksBatch', () => {
      it('should call permission check', async () => {
        const { calls, orchestrator } = capturePermissionContext();
        service.setPermissionOrchestrator(orchestrator);
        MockedZoneRepository.getZone.mockReturnValue(createMockZone());
        MockedZoneRepository.getTask.mockReturnValue(createMockTask({ createdBy: 'agent-1' }));
        MockedZoneRepository.getZoneContext.mockReturnValue({ taskPolicy: 'creator', taskCreatorId: 'agent-1', members: [] });
        MockedZoneRepository.updateTask.mockReturnValue(createMockTask());

        await service.updateTasksBatch('zone-1', 'agent-1', [{ taskId: 'task-1', title: 'Updated' }]);

        expect(calls).toContainEqual(expect.objectContaining({
          action: 'update_tasks_batch',
          resource: 'zone:zone-1',
          agentId: 'agent-1',
        }));
      });
    });

    describe('addMessage', () => {
      it('should call permission check', async () => {
        const { calls, orchestrator } = capturePermissionContext();
        service.setPermissionOrchestrator(orchestrator);
        MockedZoneRepository.getZone.mockReturnValue(createMockZone());
        MockedZoneRepository.addMessage.mockReturnValue({
          id: 'msg-1', zoneId: 'zone-1', senderId: 'agent-1', senderType: 'agent' as const,
          content: 'Hello', createdAt: Date.now(),
        });

        await service.addMessage('zone-1', 'agent-1', 'agent', 'Hello');

        expect(calls).toContainEqual(expect.objectContaining({
          action: 'add_message',
          resource: 'zone:zone-1',
          agentId: 'agent-1',
        }));
      });
    });

    describe('cloneZone', () => {
      it('should call permission check', async () => {
        const { calls, orchestrator } = capturePermissionContext();
        service.setPermissionOrchestrator(orchestrator);
        MockedZoneRepository.getZone
          .mockReturnValueOnce(createMockZone({ id: 'zone-source', projectId: 'proj-1' }))
          .mockReturnValueOnce(createMockZone({ id: 'zone-clone', projectId: 'proj-1' }));
        MockedZoneRepository.createZone.mockReturnValue(createMockZone({ id: 'zone-clone', projectId: 'proj-1' }));
        MockedZoneRepository.getFilesByZone.mockReturnValue([]);
        MockedZoneRepository.getTasks.mockReturnValue([]);

        await service.cloneZone('zone-source', {}, 'agent-1');

        expect(calls).toContainEqual(expect.objectContaining({
          action: 'clone',
          resource: 'zone:zone-source',
          agentId: 'agent-1',
        }));
      });
    });

    describe('importZone', () => {
      it('should call permission check', async () => {
        const { calls, orchestrator } = capturePermissionContext();
        service.setPermissionOrchestrator(orchestrator);
        MockedProjectRepository.getProject.mockReturnValue({ id: 'proj-1' } as any);
        MockedZoneRepository.createZone.mockReturnValue(createMockZone({ id: 'zone-new', projectId: 'proj-1' }));
        MockedZoneRepository.getZone.mockReturnValue(createMockZone({ id: 'zone-new', projectId: 'proj-1' }));

        await service.importZone('proj-1', { title: 'Imported', prompt: '' }, 'agent-1', 'agent-1');

        expect(calls).toContainEqual(expect.objectContaining({
          action: 'import',
          resource: 'project:proj-1',
          agentId: 'agent-1',
        }));
      });
    });
  });

  // ============================================
  // createZone
  // ============================================
  describe('createZone', () => {
    it('should create zone and sync to StateStore', async () => {
      const zone = createMockZone({ id: 'zone-new', title: 'New Zone' });
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

    it('should use default agentId as system', async () => {
      const zone = createMockZone();
      MockedProjectRepository.getProject.mockReturnValue({ id: 'proj-1' } as any);
      MockedZoneRepository.createZone.mockReturnValue(zone);

      await service.createZone('proj-1', 'Title', 'KR');
      // Default agentId is 'system' - permission check would be called with 'system'
    });
  });

  // ============================================
  // updateZone
  // ============================================
  describe('updateZone', () => {
    it('should update zone and sync to StateStore', async () => {
      const zone = createMockZone({ id: 'zone-1', title: 'Updated Title' });
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

  // ============================================
  // deleteZone
  // ============================================
  describe('deleteZone', () => {
    it('should soft delete zone and remove from StateStore', async () => {
      const zone = createMockZone({ id: 'zone-del', title: 'To Delete' });
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

  // ============================================
  // getZone / getZones
  // ============================================
  describe('getZones', () => {
    it('should return zones for project', async () => {
      const zones = [createMockZone({ id: 'z1' }), createMockZone({ id: 'z2' })];
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
      const zone = createMockZone({ id: 'zone-get' });
      MockedZoneRepository.getZone.mockReturnValue(zone);

      const result = await service.getZone('zone-get');

      expect(result).toEqual(zone);
    });

    it('should return null if zone not found', async () => {
      MockedZoneRepository.getZone.mockReturnValue(null);

      const result = await service.getZone('nonexistent');

      expect(result).toBeNull();
    });
  });

  // ============================================
  // Member Management
  // ============================================
  describe('addMember', () => {
    it('should add member and sync to StateStore', async () => {
      const zone = createMockZone({ id: 'zone-1', members: ['agent-1'] });
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
      const zone = createMockZone({ id: 'zone-1', members: [] });
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
      const zone = createMockZone({ id: 'zone-1', members: ['agent-1', 'agent-2', 'agent-3'] });
      MockedZoneRepository.addMembers.mockReturnValue(zone);
      MockedStateStore.setZone.mockClear();

      const result = await service.addMembers('zone-1', ['agent-1', 'agent-2', 'agent-3'], 'agent-1');

      expect(result).toEqual(zone);
      expect(MockedGatewayEventBus.publishZoneEvent).toHaveBeenCalledTimes(3);
    });
  });

  describe('removeMembers (batch)', () => {
    it('should remove multiple members and sync to StateStore', async () => {
      const zone = createMockZone({ id: 'zone-1', members: ['agent-3'] });
      MockedZoneRepository.removeMembers.mockReturnValue(zone);
      MockedStateStore.setZone.mockClear();

      await service.removeMembers('zone-1', ['agent-1', 'agent-2'], 'agent-1');

      expect(MockedGatewayEventBus.publishZoneEvent).toHaveBeenCalledTimes(2);
    });
  });

  // ============================================
  // Soft Delete / Recovery
  // ============================================
  describe('getDeletedZones', () => {
    it('should return soft-deleted zones for project', async () => {
      const deletedZones = [createMockZone({ id: 'zone-deleted' })];
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
      const zone = createMockZone({ id: 'zone-restore', title: 'Restored Zone' });
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
      const zone = createMockZone({ id: 'zone-perm' });
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
        createMockZone({ id: 'trash-1' }),
        createMockZone({ id: 'trash-2' }),
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
      const deletedZones = [createMockZone({ id: 'trash-1' }), createMockZone({ id: 'trash-2' })];
      MockedProjectRepository.getProject.mockReturnValue({ id: 'proj-1' } as any);
      MockedZoneRepository.getDeletedZones.mockReturnValue(deletedZones);
      MockedZoneRepository.permanentlyDeleteZone
        .mockReturnValueOnce(true)
        .mockImplementationOnce(() => { throw new Error('DB error'); });

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
      const zone = createMockZone({ id: 'zone-1' });
      const file = createMockFile();
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
      const zone = createMockZone({ id: 'zone-1' });
      const file = createMockFile({ zoneId: 'zone-1' });
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
      const zone = createMockZone({ id: 'zone-1' });
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
      const zone = createMockZone({ id: 'zone-1' });
      const tasks = [createMockTask()];
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
      const zone = createMockZone({ id: 'zone-1' });
      const task = createMockTask({ id: 'task-new', title: 'New Task' });
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

    it('should throw if zone not found', async () => {
      MockedZoneRepository.getZone.mockReturnValue(null);

      await expect(service.createTask('nonexistent', 'agent-1', 'Task'))
        .rejects.toThrow('Zone not found: nonexistent');
    });

    it('should throw if zone context not found', async () => {
      MockedZoneRepository.getZone.mockReturnValue(createMockZone());
      MockedZoneRepository.getZoneContext.mockReturnValue(null);

      await expect(service.createTask('zone-1', 'agent-1', 'Task'))
        .rejects.toThrow('Zone context not found');
    });

    it('should set first creator as taskCreatorId', async () => {
      const zone = createMockZone({ id: 'zone-1' });
      MockedZoneRepository.getZone.mockReturnValue(zone);
      MockedZoneRepository.getZoneContext.mockReturnValue({ taskPolicy: 'creator', taskCreatorId: null, members: [] });
      MockedZoneRepository.createTask.mockReturnValue(createMockTask());

      await service.createTask('zone-1', 'agent-1', 'Task');

      expect(MockedZoneRepository.updateZoneContext).toHaveBeenCalledWith('zone-1', { taskCreatorId: 'agent-1' });
    });

    it('should throw if non-creator tries to create task when creator exists', async () => {
      const zone = createMockZone({ id: 'zone-1' });
      MockedZoneRepository.getZone.mockReturnValue(zone);
      MockedZoneRepository.getZoneContext.mockReturnValue({ taskPolicy: 'creator', taskCreatorId: 'other-agent', members: [] });

      await expect(service.createTask('zone-1', 'agent-1', 'Task'))
        .rejects.toThrow('只有任务创建者可以创建新任务');
    });
  });

  describe('updateTask', () => {
    it('should update task and publish event', async () => {
      const zone = createMockZone({ id: 'zone-1' });
      const task = createMockTask({ createdBy: 'agent-1' });
      const updated = createMockTask({ title: 'Updated' });
      MockedZoneRepository.getZone.mockReturnValue(zone);
      MockedZoneRepository.getTask.mockReturnValue(task);
      MockedZoneRepository.getZoneContext.mockReturnValue({ taskPolicy: 'creator', taskCreatorId: 'agent-1', members: [] });
      MockedZoneRepository.updateTask.mockReturnValue(updated);
      MockedGatewayEventBus.publishZoneEvent.mockClear();

      const result = await service.updateTask('zone-1', 'task-1', 'agent-1', { title: 'Updated' });

      expect(result.title).toBe('Updated');
      expect(MockedGatewayEventBus.publishZoneEvent).toHaveBeenCalledWith(
        'zone:task_updated', 'zone-1', expect.any(String), { task: updated }
      );
    });

    it('should throw if task not found', async () => {
      MockedZoneRepository.getZone.mockReturnValue(createMockZone());
      MockedZoneRepository.getTask.mockReturnValue(null);

      await expect(service.updateTask('zone-1', 'nonexistent', 'agent-1', { title: 'X' }))
        .rejects.toThrow('Task not found: nonexistent');
    });

    it('should throw if neither creator nor assignee', async () => {
      const zone = createMockZone({ id: 'zone-1' });
      MockedZoneRepository.getZone.mockReturnValue(zone);
      MockedZoneRepository.getTask.mockReturnValue(createMockTask({ createdBy: 'other', assignee: 'someone-else' }));
      MockedZoneRepository.getZoneContext.mockReturnValue({ taskPolicy: 'creator', taskCreatorId: 'other', members: [] });

      await expect(service.updateTask('zone-1', 'task-1', 'agent-1', { title: 'X' }))
        .rejects.toThrow('只有任务创建者或认领者可以更新任务');
    });

    it('should allow assignee to update task', async () => {
      const zone = createMockZone({ id: 'zone-1' });
      MockedZoneRepository.getZone.mockReturnValue(zone);
      MockedZoneRepository.getTask.mockReturnValue(createMockTask({ createdBy: 'other', assignee: 'agent-1' }));
      MockedZoneRepository.getZoneContext.mockReturnValue({ taskPolicy: 'creator', taskCreatorId: 'other', members: [] });
      MockedZoneRepository.updateTask.mockReturnValue(createMockTask({ assignee: 'agent-1' }));

      await expect(service.updateTask('zone-1', 'task-1', 'agent-1', { title: 'X' }))
        .resolves.toBeDefined();
    });
  });

  describe('deleteTask', () => {
    it('should delete task and publish event', async () => {
      const zone = createMockZone({ id: 'zone-1' });
      MockedZoneRepository.getZone.mockReturnValue(zone);
      MockedZoneRepository.getZoneContext.mockReturnValue({ taskPolicy: 'creator', taskCreatorId: 'agent-1', members: [] });
      MockedZoneRepository.deleteTask.mockReturnValue(true);
      MockedGatewayEventBus.publishZoneEvent.mockClear();

      const result = await service.deleteTask('zone-1', 'task-1', 'agent-1');

      expect(result).toBe(true);
      expect(MockedGatewayEventBus.publishZoneEvent).toHaveBeenCalledWith(
        'zone:task_deleted', 'zone-1', expect.any(String), { taskId: 'task-1' }
      );
    });

    it('should throw if not task creator', async () => {
      MockedZoneRepository.getZone.mockReturnValue(createMockZone());
      MockedZoneRepository.getZoneContext.mockReturnValue({ taskPolicy: 'creator', taskCreatorId: 'other-agent', members: [] });

      await expect(service.deleteTask('zone-1', 'task-1', 'agent-1'))
        .rejects.toThrow('只有任务创建者可以删除任务');
    });
  });

  describe('claimTask', () => {
    it('should claim task and publish event', async () => {
      const zone = createMockZone({ id: 'zone-1' });
      const task = createMockTask({ assignee: null, status: 'pending' });
      const claimed = createMockTask({ assignee: 'agent-1', status: 'in_progress' });
      MockedZoneRepository.getZone.mockReturnValue(zone);
      MockedZoneRepository.getTask.mockReturnValue(task);
      MockedZoneRepository.updateTask.mockReturnValue(claimed);
      MockedGatewayEventBus.publishZoneEvent.mockClear();

      const result = await service.claimTask('zone-1', 'task-1', 'agent-1');

      expect(result.assignee).toBe('agent-1');
      expect(result.status).toBe('in_progress');
      expect(MockedGatewayEventBus.publishZoneEvent).toHaveBeenCalledWith(
        'zone:task_claimed', 'zone-1', expect.any(String), { taskId: 'task-1', assignee: 'agent-1' }
      );
    });

    it('should throw if task already assigned', async () => {
      MockedZoneRepository.getZone.mockReturnValue(createMockZone());
      MockedZoneRepository.getTask.mockReturnValue(createMockTask({ assignee: 'other-agent' }));

      await expect(service.claimTask('zone-1', 'task-1', 'agent-1'))
        .rejects.toThrow('任务已被认领');
    });

    it('should throw if task already done', async () => {
      MockedZoneRepository.getZone.mockReturnValue(createMockZone());
      MockedZoneRepository.getTask.mockReturnValue(createMockTask({ status: 'done' }));

      await expect(service.claimTask('zone-1', 'task-1', 'agent-1'))
        .rejects.toThrow('任务已完成，无法认领');
    });
  });

  describe('createTasksBatch', () => {
    it('should create multiple tasks', async () => {
      const zone = createMockZone({ id: 'zone-1' });
      MockedZoneRepository.getZone.mockReturnValue(zone);
      MockedZoneRepository.createTask.mockReturnValue(createMockTask());
      MockedGatewayEventBus.publishZoneEvent.mockClear();

      const result = await service.createTasksBatch('zone-1', 'agent-1', ['Task 1', 'Task 2']);

      expect(result.success).toHaveLength(2);
      expect(result.failed).toHaveLength(0);
    });

    it('should track failures', async () => {
      const zone = createMockZone({ id: 'zone-1' });
      MockedZoneRepository.getZone.mockReturnValue(zone);
      MockedZoneRepository.createTask
        .mockReturnValueOnce(createMockTask())
        .mockImplementationOnce(() => { throw new Error('DB error'); });

      const result = await service.createTasksBatch('zone-1', 'agent-1', ['Task 1', 'Task 2']);

      expect(result.success).toHaveLength(1);
      expect(result.failed).toHaveLength(1);
      expect(result.failed[0].error).toBe('DB error');
    });
  });

  describe('updateTasksBatch', () => {
    it('should update multiple tasks', async () => {
      const zone = createMockZone({ id: 'zone-1' });
      MockedZoneRepository.getZone.mockReturnValue(zone);
      MockedZoneRepository.getTask.mockReturnValue(createMockTask({ createdBy: 'agent-1' }));
      MockedZoneRepository.getZoneContext.mockReturnValue({ taskPolicy: 'creator', taskCreatorId: 'agent-1', members: [] });
      MockedZoneRepository.updateTask.mockReturnValue(createMockTask());
      MockedGatewayEventBus.publishZoneEvent.mockClear();

      const result = await service.updateTasksBatch('zone-1', 'agent-1', [
        { taskId: 'task-1', title: 'Updated 1' },
        { taskId: 'task-2', title: 'Updated 2' },
      ]);

      expect(result.success).toHaveLength(2);
    });
  });

  // ============================================
  // Zone Messages
  // ============================================
  describe('addMessage', () => {
    it('should add message and publish event', async () => {
      const zone = createMockZone({ id: 'zone-1' });
      MockedZoneRepository.getZone.mockReturnValue(zone);
      MockedZoneRepository.addMessage.mockReturnValue({
        id: 'msg-1', zoneId: 'zone-1', senderId: 'agent-1', senderType: 'agent' as const,
        content: 'Hello', createdAt: Date.now(),
      });
      MockedGatewayEventBus.publishZoneEvent.mockClear();

      const result = await service.addMessage('zone-1', 'agent-1', 'agent', 'Hello');

      expect(result.content).toBe('Hello');
      expect(MockedGatewayEventBus.publishZoneEvent).toHaveBeenCalledWith(
        'zone:message_added', 'zone-1', expect.any(String), expect.objectContaining({ message: expect.any(Object) })
      );
    });

    it('should throw if zone not found', async () => {
      MockedZoneRepository.getZone.mockReturnValue(null);

      await expect(service.addMessage('nonexistent', 'agent-1', 'agent', 'Hi'))
        .rejects.toThrow('Zone not found: nonexistent');
    });
  });

  // ============================================
  // Zone Clone / Import / Export
  // ============================================
  describe('cloneZone', () => {
    it('should clone zone without files/tasks', async () => {
      const sourceZone = createMockZone({ id: 'zone-source', projectId: 'proj-1', title: 'Source Zone' });
      const clonedZone = createMockZone({ id: 'zone-clone', projectId: 'proj-1', title: 'Clone of Source Zone' });

      MockedZoneRepository.getZone
        .mockReturnValueOnce(sourceZone)
        .mockReturnValueOnce(clonedZone);
      MockedZoneRepository.createZone.mockReturnValue(clonedZone);
      MockedZoneRepository.getFilesByZone.mockReturnValue([]);
      MockedZoneRepository.getTasks.mockReturnValue([]);
      MockedStateStore.setZone.mockClear();

      const result = await service.cloneZone('zone-source', { includeFiles: false, includeTasks: false }, 'agent-1');

      expect(result).toEqual(clonedZone);
      expect(MockedStateStore.setZone).toHaveBeenCalledWith('zone-clone', expect.objectContaining({
        id: 'zone-clone',
      }));
    });

    it('should throw if source zone not found', async () => {
      MockedZoneRepository.getZone.mockReturnValue(null);

      await expect(service.cloneZone('nonexistent', {}, 'agent-1'))
        .rejects.toThrow('Zone not found: nonexistent');
    });

    it('should throw if source zone has no projectId', async () => {
      MockedZoneRepository.getZone.mockReturnValue(createMockZone({ projectId: '' }));

      await expect(service.cloneZone('zone-1', {}, 'agent-1'))
        .rejects.toThrow('Cannot clone zone');
    });
  });

  describe('searchZones', () => {
    it('should search zones by keyword', async () => {
      const zones = [createMockZone({ id: 'zone-match' })];
      MockedZoneRepository.searchZones.mockReturnValue(zones);

      const result = await service.searchZones('test', 20);

      expect(result).toHaveLength(1);
      expect(MockedZoneRepository.searchZones).toHaveBeenCalledWith('test', 20);
    });

    it('should use default limit', async () => {
      MockedZoneRepository.searchZones.mockReturnValue([]);

      await service.searchZones('test');

      expect(MockedZoneRepository.searchZones).toHaveBeenCalledWith('test', 20);
    });
  });

  describe('exportZone', () => {
    it('should export zone as template', async () => {
      const zone = createMockZone({ id: 'zone-1', title: 'Export Zone' });
      MockedZoneRepository.getZone.mockReturnValue(zone);
      MockedZoneRepository.exportZone.mockReturnValue({
        title: 'Export Zone',
        prompt: 'Test',
        files: [],
        tasks: [],
      });

      const result = await service.exportZone('zone-1');

      expect(result.version).toBe('1.0');
      expect(result.exportedAt).toBeDefined();
      expect(result.zone.title).toBe('Export Zone');
    });

    it('should throw if zone not found', async () => {
      MockedZoneRepository.getZone.mockReturnValue(null);

      await expect(service.exportZone('nonexistent'))
        .rejects.toThrow('Zone not found: nonexistent');
    });
  });

  describe('importZone', () => {
    it('should import zone from template', async () => {
      const newZone = createMockZone({ id: 'zone-new', projectId: 'proj-1' });
      MockedProjectRepository.getProject.mockReturnValue({ id: 'proj-1' } as any);
      MockedZoneRepository.createZone.mockReturnValue(newZone);
      MockedZoneRepository.getZone.mockReturnValue(newZone);

      const result = await service.importZone('proj-1', { title: 'Imported', prompt: 'Test' }, 'agent-1', 'agent-1');

      expect(result).toEqual(newZone);
    });

    it('should throw if project not found', async () => {
      MockedProjectRepository.getProject.mockReturnValue(null);

      await expect(service.importZone('invalid', { title: 'X', prompt: '' }, 'agent-1', 'agent-1'))
        .rejects.toThrow('Project not found: invalid');
    });
  });

  // ============================================
  // Zone Statistics
  // ============================================
  describe('getZoneStatistics', () => {
    it('should return correct statistics', async () => {
      const zone = createMockZone({
        id: 'zone-1',
        members: ['a1', 'a2'],
        files: [{ id: 'f1' } as ZoneFile],
      });
      const tasks = [
        createMockTask({ id: 't1', status: 'pending' }),
        createMockTask({ id: 't2', status: 'in_progress' }),
        createMockTask({ id: 't3', status: 'done' }),
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

    it('should throw if zone not found', async () => {
      MockedZoneRepository.getZone.mockReturnValue(null);

      await expect(service.getZoneStatistics('nonexistent'))
        .rejects.toThrow('Zone not found: nonexistent');
    });
  });

  // ============================================
  // File Cache
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

      expect(service['cacheExpiry']).toBe(7200000);
      expect(service['maxFileSize']).toBe(20 * 1024 * 1024);
      expect(service['allowedBasePaths']).toEqual(['/safe/path']);
    });
  });

  describe('shouldRefreshFile', () => {
    it('should return true when no content cached', () => {
      const file = createMockFile({ content: undefined });
      expect(service.shouldRefreshFile(file)).toBe(true);
    });

    it('should return true when cache expired', () => {
      const now = Date.now();
      const file = createMockFile({
        content: 'cached',
        lastFetched: now - 7200000, // 2 hours ago
      });
      expect(service.shouldRefreshFile(file)).toBe(true);
    });

    it('should return false when cache is valid', () => {
      const now = Date.now();
      const file = createMockFile({
        content: 'cached',
        lastFetched: now - 1800000, // 30 minutes ago
      });
      expect(service.shouldRefreshFile(file)).toBe(false);
    });
  });

  describe('getFileWithContent', () => {
    it('should return cache hit when valid', async () => {
      const now = Date.now();
      const file = createMockFile({
        content: 'cached content',
        lastFetched: now - 1000,
      });
      MockedZoneRepository.getFile.mockReturnValue(file);

      const result = await service.getFileWithContent('zone-1', 'file-1');

      expect(result.cacheHit).toBe(true);
      expect(result.content).toBe('cached content');
    });

    it('should return null when file not found', async () => {
      MockedZoneRepository.getFile.mockReturnValue(null);

      const result = await service.getFileWithContent('zone-1', 'nonexistent');

      expect(result.file).toBeNull();
      expect(result.content).toBeNull();
    });
  });

  // ============================================
  // File Version History
  // ============================================
  describe('getFileVersions', () => {
    it('should return file versions', async () => {
      const file = createMockFile();
      MockedZoneRepository.getFile.mockReturnValue(file);
      MockedZoneRepository.getFileVersions.mockReturnValue({
        versions: [{ id: 'v1', content: 'old', createdAt: 0, description: 'Initial' }],
      });

      const result = await service.getFileVersions('zone-1', 'file-1');

      expect(result.versions).toHaveLength(1);
    });

    it('should throw if file not found', async () => {
      MockedZoneRepository.getFile.mockReturnValue(null);

      await expect(service.getFileVersions('zone-1', 'nonexistent'))
        .rejects.toThrow('File not found');
    });
  });

  describe('rollbackFileToVersion', () => {
    it('should rollback file', async () => {
      const file = createMockFile();
      MockedZoneRepository.getFile.mockReturnValue(file);
      MockedZoneRepository.rollbackFileToVersion.mockReturnValue(file);
      MockedZoneRepository.getZone.mockReturnValue(createMockZone());
      MockedGatewayEventBus.publishZoneEvent.mockClear();

      const result = await service.rollbackFileToVersion('zone-1', 'file-1', 'version-1', 'agent-1');

      expect(result).toEqual(file);
    });
  });

  // ============================================
  // Messages
  // ============================================
  describe('getMessages', () => {
    it('should return messages for zone', async () => {
      const zone = createMockZone({ id: 'zone-1' });
      MockedZoneRepository.getZone.mockReturnValue(zone);
      MockedZoneRepository.getMessages.mockReturnValue([]);

      const result = await service.getMessages('zone-1');

      expect(Array.isArray(result)).toBe(true);
    });

    it('should throw if zone not found', async () => {
      MockedZoneRepository.getZone.mockReturnValue(null);

      await expect(service.getMessages('nonexistent')).rejects.toThrow('Zone not found');
    });
  });

  describe('getMessagesCount', () => {
    it('should return message count', async () => {
      const zone = createMockZone({ id: 'zone-1' });
      MockedZoneRepository.getZone.mockReturnValue(zone);
      MockedZoneRepository.getMessagesCount.mockReturnValue(5);

      const result = await service.getMessagesCount('zone-1');

      expect(result).toBe(5);
    });
  });

  // ============================================
  // Task Count
  // ============================================
  describe('getTasksCount', () => {
    it('should return task count', async () => {
      const zone = createMockZone({ id: 'zone-1' });
      MockedZoneRepository.getZone.mockReturnValue(zone);
      MockedZoneRepository.getTasksCount.mockReturnValue(10);

      const result = await service.getTasksCount('zone-1');

      expect(result).toBe(10);
    });
  });

  describe('getTask', () => {
    it('should return single task', async () => {
      const zone = createMockZone({ id: 'zone-1' });
      const task = createMockTask({ id: 'task-1' });
      MockedZoneRepository.getZone.mockReturnValue(zone);
      MockedZoneRepository.getTask.mockReturnValue(task);

      const result = await service.getTask('zone-1', 'task-1');

      expect(result).toEqual(task);
    });

    it('should return null if task not in zone', async () => {
      const zone = createMockZone({ id: 'zone-1' });
      MockedZoneRepository.getZone.mockReturnValue(zone);
      MockedZoneRepository.getTask.mockReturnValue(null);

      const result = await service.getTask('zone-1', 'nonexistent');

      expect(result).toBeNull();
    });
  });

  // ============================================
  // File Search
  // ============================================
  describe('searchFiles', () => {
    it('should search files in zone', async () => {
      const zone = createMockZone({ id: 'zone-1' });
      const files = [createMockFile()];
      MockedZoneRepository.getZone.mockReturnValue(zone);
      MockedZoneRepository.searchFiles.mockReturnValue(files);

      const result = await service.searchFiles('zone-1', 'test');

      expect(result).toHaveLength(1);
    });

    it('should throw if zone not found', async () => {
      MockedZoneRepository.getZone.mockReturnValue(null);

      await expect(service.searchFiles('nonexistent', 'test'))
        .rejects.toThrow('Zone not found');
    });
  });

  // ============================================
  // URL Metadata
  // ============================================
  describe('fetchUrlMetadata', () => {
    it('should fetch URL metadata', async () => {
      const file = createMockFile({ sourceType: 'url', source: 'https://example.com' });
      MockedZoneRepository.getFile.mockReturnValue(file);
      MockedZoneRepository.updateFile.mockReturnValue(file);
      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve('<title>Test Page</title>'),
      } as any);

      const result = await service.fetchUrlMetadata('zone-1', 'file-1');

      expect(result.title).toBe('Test Page');
    });

    it('should throw if file not URL type', async () => {
      const file = createMockFile({ sourceType: 'local' });
      MockedZoneRepository.getFile.mockReturnValue(file);

      await expect(service.fetchUrlMetadata('zone-1', 'file-1'))
        .rejects.toThrow('File is not a URL type');
    });
  });
});
