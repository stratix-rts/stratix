import { ProjectManager } from '@/stratix-project/core/ProjectManager';
import { ProjectStore } from '@/stratix-project/storage/ProjectStore';
import { Project, ProjectConfig, ProjectStatus } from '@/stratix-project/types';
import mitt from 'mitt';

// Mock LRAClient
const mockInit = jest.fn().mockResolvedValue(undefined);
const mockCreateTask = jest.fn().mockResolvedValue('task-1');
const mockLRAClient = {
  init: mockInit,
  createTask: mockCreateTask,
};

jest.mock('@/stratix-project/storage/ProjectStore');
jest.mock('@/stratix-lra-bridge', () => ({
  LRAClient: jest.fn().mockImplementation(() => mockLRAClient),
}));

describe('ProjectManager', () => {
  let projectManager: ProjectManager;
  let mockStore: jest.Mocked<ProjectStore>;
  let eventBus: ReturnType<typeof mitt>;
  let emittedEvents: any[];

  beforeEach(() => {
    jest.clearAllMocks();
    emittedEvents = [];

    // Create mock store
    mockStore = {
      addProject: jest.fn().mockResolvedValue(undefined),
      getProject: jest.fn().mockResolvedValue(null),
      updateProject: jest.fn().mockResolvedValue(undefined),
      deleteProject: jest.fn().mockResolvedValue(true),
      getAllProjects: jest.fn().mockResolvedValue([]),
      getProjectsByStatus: jest.fn().mockResolvedValue([]),
      getProjectsByPriority: jest.fn().mockResolvedValue([]),
      getProjectCount: jest.fn().mockResolvedValue(0),
    } as any;

    // Create event bus
    eventBus = mitt();
    eventBus.on('*', (type, data) => {
      emittedEvents.push({ type, data });
    });

    projectManager = new ProjectManager(mockStore, eventBus);
  });

  const createMockProjectConfig = (): ProjectConfig => ({
    name: 'Test Project',
    description: 'A test project',
    priority: 1,
    localFolderPath: '/tmp/test-project',
    agentMode: 'llm',
    planningRule: 'sequential',
    executionPermission: 'confirm',
    requirement: { type: 'text', content: 'Test requirement' },
    progressRule: 'average',
  });

  const createMockProject = (overrides?: Partial<Project>): Project => ({
    id: 'proj-1',
    name: 'Test Project',
    description: 'A test project',
    priority: 1,
    status: 'pending',
    config: createMockProjectConfig(),
    path: '/tmp/test-project',
    presentAgentIds: [],
    zoneConfig: { x: 100, y: 100, width: 800, height: 600 },
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  });

  describe('constructor', () => {
    test('creates instance with store', () => {
      expect(projectManager).toBeInstanceOf(ProjectManager);
    });

    test('creates instance with store and eventBus', () => {
      const manager = new ProjectManager(mockStore, eventBus);
      expect(manager).toBeInstanceOf(ProjectManager);
    });
  });

  describe('getEventBus', () => {
    test('returns the event bus', () => {
      const eb = projectManager.getEventBus();
      expect(eb).toBe(eventBus);
    });
  });

  describe('createProject', () => {
    test('creates project with config', async () => {
      const config = createMockProjectConfig();

      const project = await projectManager.createProject(config);

      expect(project).toMatchObject({
        name: config.name,
        description: config.description,
        priority: config.priority,
        status: 'pending',
      });
      expect(project.id).toMatch(/^proj_/);
      expect(mockStore.addProject).toHaveBeenCalled();
      expect(mockInit).toHaveBeenCalledWith(config.localFolderPath, config.name);
    });

    test('emits project:created event', async () => {
      const config = createMockProjectConfig();
      emittedEvents = [];

      await projectManager.createProject(config);

      expect(emittedEvents).toContainEqual(
        expect.objectContaining({
          type: 'project:created',
          data: expect.objectContaining({
            project: expect.objectContaining({ name: config.name }),
          }),
        })
      );
    });

    test('creates project with custom zoneConfig', async () => {
      const config = createMockProjectConfig();
      const customZone = { x: 200, y: 200, width: 600, height: 400, color: 0xff0000 };

      const project = await projectManager.createProject(config, customZone);

      expect(project.zoneConfig.x).toBe(200);
      expect(project.zoneConfig.color).toBe(0xff0000);
    });
  });

  describe('getProject', () => {
    test('returns project by id', async () => {
      const mockProject = createMockProject();
      mockStore.getProject.mockResolvedValue(mockProject);

      const project = await projectManager.getProject('proj-1');

      expect(project).toEqual(mockProject);
      expect(mockStore.getProject).toHaveBeenCalledWith('proj-1');
    });

    test('returns null for non-existent project', async () => {
      mockStore.getProject.mockResolvedValue(null);

      const project = await projectManager.getProject('non-existent');

      expect(project).toBeNull();
    });
  });

  describe('updateProject', () => {
    test('updates existing project', async () => {
      const existingProject = createMockProject();
      mockStore.getProject.mockResolvedValue(existingProject);

      const updatedProject = await projectManager.updateProject('proj-1', { name: 'Updated Name' });

      expect(updatedProject.name).toBe('Updated Name');
      expect(mockStore.updateProject).toHaveBeenCalled();
    });

    test('throws error for non-existent project', async () => {
      mockStore.getProject.mockResolvedValue(null);

      await expect(projectManager.updateProject('non-existent', { name: 'Test' }))
        .rejects.toThrow('Project not found');
    });

    test('emits project:updated event', async () => {
      const existingProject = createMockProject();
      mockStore.getProject.mockResolvedValue(existingProject);
      emittedEvents = [];

      await projectManager.updateProject('proj-1', { name: 'Updated' });

      expect(emittedEvents).toContainEqual(
        expect.objectContaining({
          type: 'project:updated',
          data: expect.objectContaining({
            project: expect.objectContaining({ name: 'Updated' }),
            changes: { name: 'Updated' },
          }),
        })
      );
    });

    test('emits project:status-changed event when status changes', async () => {
      const existingProject = createMockProject({ status: 'pending' });
      mockStore.getProject.mockResolvedValue(existingProject);
      emittedEvents = [];

      await projectManager.updateProject('proj-1', { status: 'active' });

      expect(emittedEvents).toContainEqual(
        expect.objectContaining({
          type: 'project:status-changed',
          data: expect.objectContaining({
            oldStatus: 'pending',
            newStatus: 'active',
          }),
        })
      );
    });
  });

  describe('deleteProject', () => {
    test('deletes existing project', async () => {
      const existingProject = createMockProject();
      mockStore.getProject.mockResolvedValue(existingProject);

      await projectManager.deleteProject('proj-1');

      expect(mockStore.deleteProject).toHaveBeenCalledWith('proj-1');
    });

    test('throws error for non-existent project', async () => {
      mockStore.getProject.mockResolvedValue(null);

      await expect(projectManager.deleteProject('non-existent'))
        .rejects.toThrow('Project not found');
    });

    test('emits project:deleted event', async () => {
      const existingProject = createMockProject();
      mockStore.getProject.mockResolvedValue(existingProject);
      emittedEvents = [];

      await projectManager.deleteProject('proj-1');

      expect(emittedEvents).toContainEqual(
        expect.objectContaining({
          type: 'project:deleted',
          data: expect.objectContaining({ projectId: 'proj-1' }),
        })
      );
    });
  });

  describe('getAllProjects', () => {
    test('returns all projects', async () => {
      const projects = [createMockProject({ id: 'proj-1' }), createMockProject({ id: 'proj-2' })];
      mockStore.getAllProjects.mockResolvedValue(projects);

      const result = await projectManager.getAllProjects();

      expect(result).toEqual(projects);
      expect(mockStore.getAllProjects).toHaveBeenCalled();
    });
  });

  describe('getProjectsByStatus', () => {
    test('returns projects with matching status', async () => {
      const projects = [createMockProject({ id: 'proj-1', status: 'active' })];
      mockStore.getProjectsByStatus.mockResolvedValue(projects);

      const result = await projectManager.getProjectsByStatus('active');

      expect(result).toEqual(projects);
      expect(mockStore.getProjectsByStatus).toHaveBeenCalledWith('active');
    });
  });

  describe('getProjectsByPriority', () => {
    test('returns projects with matching priority', async () => {
      const projects = [createMockProject({ id: 'proj-1', priority: 1 })];
      mockStore.getProjectsByPriority.mockResolvedValue(projects);

      const result = await projectManager.getProjectsByPriority(1);

      expect(result).toEqual(projects);
      expect(mockStore.getProjectsByPriority).toHaveBeenCalledWith(1);
    });
  });

  describe('startProject', () => {
    test('sets status to active and sets startedAt', async () => {
      const existingProject = createMockProject({ status: 'pending' });
      mockStore.getProject.mockResolvedValue(existingProject);

      const result = await projectManager.startProject('proj-1');

      expect(result.status).toBe('active');
      expect(result.startedAt).toBeDefined();
      expect(mockStore.updateProject).toHaveBeenCalled();
    });
  });

  describe('pauseProject', () => {
    test('sets status to paused', async () => {
      const existingProject = createMockProject({ status: 'active' });
      mockStore.getProject.mockResolvedValue(existingProject);

      const result = await projectManager.pauseProject('proj-1');

      expect(result.status).toBe('paused');
    });
  });

  describe('completeProject', () => {
    test('sets status to completed and sets completedAt', async () => {
      const existingProject = createMockProject({ status: 'active' });
      mockStore.getProject.mockResolvedValue(existingProject);

      const result = await projectManager.completeProject('proj-1');

      expect(result.status).toBe('completed');
      expect(result.completedAt).toBeDefined();
    });
  });

  describe('failProject', () => {
    test('sets status to failed', async () => {
      const existingProject = createMockProject({ status: 'active' });
      mockStore.getProject.mockResolvedValue(existingProject);

      const result = await projectManager.failProject('proj-1');

      expect(result.status).toBe('failed');
    });
  });

  describe('updateProjectZoneConfig', () => {
    test('merges zone config updates', async () => {
      const existingProject = createMockProject({
        zoneConfig: { x: 100, y: 100, width: 800, height: 600 },
      });
      mockStore.getProject.mockResolvedValue(existingProject);

      const result = await projectManager.updateProjectZoneConfig('proj-1', { x: 200, y: 200 });

      expect(result.zoneConfig.x).toBe(200);
      expect(result.zoneConfig.y).toBe(200);
      expect(result.zoneConfig.width).toBe(800); // unchanged
    });

    test('throws error for non-existent project', async () => {
      mockStore.getProject.mockResolvedValue(null);

      await expect(projectManager.updateProjectZoneConfig('non-existent', { x: 200 }))
        .rejects.toThrow('Project not found');
    });
  });

  describe('getProjectCount', () => {
    test('returns project count', async () => {
      mockStore.getProjectCount.mockResolvedValue(5);

      const count = await projectManager.getProjectCount();

      expect(count).toBe(5);
    });
  });

  describe('getActiveProjectCount', () => {
    test('returns count of active projects', async () => {
      mockStore.getProjectsByStatus.mockResolvedValue([
        createMockProject({ id: 'proj-1' }),
        createMockProject({ id: 'proj-2' }),
      ]);

      const count = await projectManager.getActiveProjectCount();

      expect(count).toBe(2);
    });
  });

  describe('getCompletedProjectCount', () => {
    test('returns count of completed projects', async () => {
      mockStore.getProjectsByStatus.mockResolvedValue([createMockProject({ id: 'proj-1' })]);

      const count = await projectManager.getCompletedProjectCount();

      expect(count).toBe(1);
    });
  });

  describe('agentEnterProject', () => {
    test('adds agent to project', async () => {
      const existingProject = createMockProject({ presentAgentIds: [] });
      mockStore.getProject.mockResolvedValue(existingProject);

      await projectManager.agentEnterProject('proj-1', 'agent-1');

      expect(mockStore.updateProject).toHaveBeenCalledWith(
        expect.objectContaining({
          presentAgentIds: ['agent-1'],
        })
      );
    });

    test('does not add duplicate agent', async () => {
      const existingProject = createMockProject({ presentAgentIds: ['agent-1'] });
      mockStore.getProject.mockResolvedValue(existingProject);

      await projectManager.agentEnterProject('proj-1', 'agent-1');

      // updateProject should not be called since agent already exists
      expect(mockStore.updateProject).not.toHaveBeenCalled();
    });

    test('emits project:agent-entered event', async () => {
      const existingProject = createMockProject({ presentAgentIds: [] });
      mockStore.getProject.mockResolvedValue(existingProject);
      emittedEvents = [];

      await projectManager.agentEnterProject('proj-1', 'agent-1');

      expect(emittedEvents).toContainEqual(
        expect.objectContaining({
          type: 'project:agent-entered',
          data: expect.objectContaining({ projectId: 'proj-1', agentId: 'agent-1' }),
        })
      );
    });

    test('throws error for non-existent project', async () => {
      mockStore.getProject.mockResolvedValue(null);

      await expect(projectManager.agentEnterProject('non-existent', 'agent-1'))
        .rejects.toThrow('Project not found');
    });
  });

  describe('agentLeaveProject', () => {
    test('removes agent from project', async () => {
      const existingProject = createMockProject({ presentAgentIds: ['agent-1', 'agent-2'] });
      mockStore.getProject.mockResolvedValue(existingProject);

      await projectManager.agentLeaveProject('proj-1', 'agent-1');

      expect(mockStore.updateProject).toHaveBeenCalledWith(
        expect.objectContaining({
          presentAgentIds: ['agent-2'],
        })
      );
    });

    test('emits project:agent-left event', async () => {
      const existingProject = createMockProject({ presentAgentIds: ['agent-1'] });
      mockStore.getProject.mockResolvedValue(existingProject);
      emittedEvents = [];

      await projectManager.agentLeaveProject('proj-1', 'agent-1');

      expect(emittedEvents).toContainEqual(
        expect.objectContaining({
          type: 'project:agent-left',
          data: expect.objectContaining({ projectId: 'proj-1', agentId: 'agent-1' }),
        })
      );
    });

    test('throws error for non-existent project', async () => {
      mockStore.getProject.mockResolvedValue(null);

      await expect(projectManager.agentLeaveProject('non-existent', 'agent-1'))
        .rejects.toThrow('Project not found');
    });
  });

  describe('createTaskManually', () => {
    test('creates task via LRAClient', async () => {
      const existingProject = createMockProject();
      mockStore.getProject.mockResolvedValue(existingProject);

      const taskId = await projectManager.createTaskManually('proj-1', 'New task');

      expect(taskId).toBe('task-1');
      expect(mockCreateTask).toHaveBeenCalledWith(existingProject.path, 'New task', undefined);
    });

    test('creates task with template', async () => {
      const existingProject = createMockProject();
      mockStore.getProject.mockResolvedValue(existingProject);

      await projectManager.createTaskManually('proj-1', 'New task', 'coding');

      expect(mockCreateTask).toHaveBeenCalledWith(existingProject.path, 'New task', 'coding');
    });

    test('throws error for non-existent project', async () => {
      mockStore.getProject.mockResolvedValue(null);

      await expect(projectManager.createTaskManually('non-existent', 'New task'))
        .rejects.toThrow('Project not found');
    });
  });
});
