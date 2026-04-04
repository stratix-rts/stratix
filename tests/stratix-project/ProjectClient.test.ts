import { ProjectClient } from '@/stratix-project/ProjectClient';
import { Project, ProjectConfig, ProjectStatus } from '@/stratix-project/types';

// Mock the ApiClient
const mockPost = jest.fn();
const mockGet = jest.fn();
const mockPut = jest.fn();
const mockDelete = jest.fn();
const mockPatch = jest.fn();

jest.mock('@/stratix-gateway/api/client', () => ({
  ApiClient: jest.fn().mockImplementation(() => ({
    post: mockPost,
    get: mockGet,
    put: mockPut,
    delete: mockDelete,
    patch: mockPatch,
  })),
}));

jest.mock('@/stratix-gateway/api/types/api', () => ({
  API_PATHS: {
    PROJECTS: '/api/projects',
    PROJECT_BY_ID: (id: string) => `/api/projects/${id}`,
    PROJECT_START: (id: string) => `/api/projects/${id}/start`,
    PROJECT_PAUSE: (id: string) => `/api/projects/${id}/pause`,
    PROJECT_COMPLETE: (id: string) => `/api/projects/${id}/complete`,
    PROJECT_FAIL: (id: string) => `/api/projects/${id}/fail`,
    PROJECT_AGENTS_ENTER: (id: string) => `/api/projects/${id}/agents/enter`,
    PROJECT_AGENTS_LEAVE: (id: string) => `/api/projects/${id}/agents/leave`,
    PROJECT_ZONE_CONTEXT_LINK: (zoneId: string) => `/api/zones/${zoneId}/context`,
    PROJECT_METADATA: '/api/projects/metadata',
    ZONE_MEMBER: (zoneId: string, agentId: string) => `/api/zones/${zoneId}/members/${agentId}`,
  },
  isApiSuccess: (result: any) => result.success,
}));

describe('ProjectClient', () => {
  let client: ProjectClient;

  const createMockProject = (overrides?: Partial<Project>): Project => ({
    id: 'proj-1',
    name: 'Test Project',
    description: 'A test project',
    priority: 1,
    status: 'pending',
    config: {
      name: 'Test Project',
      description: 'A test project',
      priority: 1,
      localFolderPath: '/tmp/test-project',
      agentMode: 'llm',
      planningRule: 'sequential',
      executionPermission: 'confirm',
      requirement: { type: 'text', content: 'Test requirement' },
      progressRule: 'average',
    },
    path: '/tmp/test-project',
    presentAgentIds: [],
    zoneConfig: { x: 100, y: 100, width: 800, height: 600 },
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  });

  beforeEach(() => {
    jest.clearAllMocks();
    client = new ProjectClient({ baseURL: 'http://localhost:7524' });
  });

  describe('constructor', () => {
    test('creates instance with default baseURL', () => {
      const defaultClient = new ProjectClient();
      expect(defaultClient).toBeInstanceOf(ProjectClient);
    });

    test('creates instance with custom baseURL', () => {
      const customClient = new ProjectClient({ baseURL: 'http://custom:3000' });
      expect(customClient).toBeInstanceOf(ProjectClient);
    });
  });

  describe('initialize', () => {
    test('initializes successfully', async () => {
      mockPost.mockResolvedValue({ success: true, data: { message: 'initialized' } });

      await expect(client.initialize()).resolves.not.toThrow();
      expect(mockPost).toHaveBeenCalledWith('/api/projects/initialize');
    });

    test('throws error on failure', async () => {
      mockPost.mockResolvedValue({ success: false, error: 'Initialization failed' });

      await expect(client.initialize()).rejects.toThrow('Failed to initialize project service');
    });
  });

  describe('getAllProjects', () => {
    test('returns projects on success', async () => {
      const projects = [createMockProject(), createMockProject({ id: 'proj-2' })];
      mockGet.mockResolvedValue({ success: true, data: { projects } });

      const result = await client.getAllProjects();

      expect(result).toEqual(projects);
      expect(mockGet).toHaveBeenCalledWith('/api/projects');
    });

    test('returns empty array on failure', async () => {
      mockGet.mockResolvedValue({ success: false, error: 'Failed to get projects' });

      const result = await client.getAllProjects();

      expect(result).toEqual([]);
    });

    test('returns empty array when data is undefined', async () => {
      mockGet.mockResolvedValue({ success: true, data: {} });

      const result = await client.getAllProjects();

      expect(result).toEqual([]);
    });
  });

  describe('getProjectsByStatus', () => {
    test('returns filtered projects', async () => {
      const projects = [createMockProject({ status: 'active' })];
      mockGet.mockResolvedValue({ success: true, data: { projects } });

      const result = await client.getProjectsByStatus('active');

      expect(result).toEqual(projects);
      expect(mockGet).toHaveBeenCalledWith('/api/projects', {
        headers: { params: JSON.stringify({ status: 'active' }) },
      });
    });

    test('returns empty array on failure', async () => {
      mockGet.mockResolvedValue({ success: false, error: 'Failed' });

      const result = await client.getProjectsByStatus('active');

      expect(result).toEqual([]);
    });
  });

  describe('getProjectsByPriority', () => {
    test('returns filtered projects', async () => {
      const projects = [createMockProject({ priority: 1 })];
      mockGet.mockResolvedValue({ success: true, data: { projects } });

      const result = await client.getProjectsByPriority(1);

      expect(result).toEqual(projects);
      expect(mockGet).toHaveBeenCalledWith('/api/projects', {
        headers: { params: JSON.stringify({ priority: 1 }) },
      });
    });
  });

  describe('createProject', () => {
    test('creates project successfully', async () => {
      const config: ProjectConfig = {
        name: 'New Project',
        description: 'A new project',
        priority: 1,
        localFolderPath: '/tmp/new-project',
        agentMode: 'llm',
        planningRule: 'sequential',
        executionPermission: 'confirm',
        requirement: { type: 'text', content: 'Test' },
        progressRule: 'average',
      };
      const project = createMockProject();
      mockPost.mockResolvedValue({ success: true, data: { project } });

      const result = await client.createProject(config);

      expect(result).toEqual(project);
      expect(mockPost).toHaveBeenCalledWith('/api/projects', { config, zoneConfig: undefined });
    });

    test('creates project with zoneConfig', async () => {
      const config: ProjectConfig = {
        name: 'New Project',
        description: 'A new project',
        priority: 1,
        localFolderPath: '/tmp/new-project',
        agentMode: 'llm',
        planningRule: 'sequential',
        executionPermission: 'confirm',
        requirement: { type: 'text', content: 'Test' },
        progressRule: 'average',
      };
      const zoneConfig = { x: 200, y: 200, width: 600, height: 400 };
      const project = createMockProject();
      mockPost.mockResolvedValue({ success: true, data: { project } });

      const result = await client.createProject(config, zoneConfig);

      expect(result).toEqual(project);
      expect(mockPost).toHaveBeenCalledWith('/api/projects', { config, zoneConfig });
    });

    test('throws error on failure', async () => {
      mockPost.mockResolvedValue({ success: false, error: 'Failed to create' });

      await expect(
        client.createProject({
          name: 'Test',
          description: 'Test',
          priority: 1,
          localFolderPath: '/tmp/test',
          agentMode: 'llm',
          planningRule: 'sequential',
          executionPermission: 'confirm',
          requirement: { type: 'text', content: 'Test' },
          progressRule: 'average',
        })
      ).rejects.toThrow('Failed to create project');
    });
  });

  describe('getProject', () => {
    test('returns project on success', async () => {
      const project = createMockProject();
      mockGet.mockResolvedValue({ success: true, data: { project } });

      const result = await client.getProject('proj-1');

      expect(result).toEqual(project);
      expect(mockGet).toHaveBeenCalledWith('/api/projects/proj-1');
    });

    test('returns null on failure', async () => {
      mockGet.mockResolvedValue({ success: false, error: 'Not found' });

      const result = await client.getProject('non-existent');

      expect(result).toBeNull();
    });
  });

  describe('updateProject', () => {
    test('updates project successfully', async () => {
      const project = createMockProject({ name: 'Updated Name' });
      mockPut.mockResolvedValue({ success: true, data: { project } });

      const result = await client.updateProject('proj-1', { name: 'Updated Name' });

      expect(result.name).toBe('Updated Name');
      expect(mockPut).toHaveBeenCalledWith('/api/projects/proj-1', { updates: { name: 'Updated Name' } });
    });

    test('throws error on failure', async () => {
      mockPut.mockResolvedValue({ success: false, error: 'Update failed' });

      await expect(client.updateProject('proj-1', { name: 'Test' })).rejects.toThrow(
        'Failed to update project proj-1'
      );
    });
  });

  describe('updateZoneConfig', () => {
    test('updates zone config', async () => {
      const project = createMockProject({ zoneConfig: { x: 200, y: 200, width: 600, height: 400 } });
      mockPut.mockResolvedValue({ success: true, data: { project } });

      const result = await client.updateZoneConfig('proj-1', { x: 200, y: 200 });

      expect(result.zoneConfig.x).toBe(200);
      expect(mockPut).toHaveBeenCalledWith('/api/projects/proj-1', {
        updates: { zoneConfig: { x: 200, y: 200 } },
      });
    });
  });

  describe('updateZoneContextId', () => {
    test('updates zone context FK successfully', async () => {
      mockPatch.mockResolvedValue({ success: true, data: { message: 'updated' } });

      await expect(
        client.updateZoneContextId('zone-1', 'context-1')
      ).resolves.not.toThrow();

      expect(mockPatch).toHaveBeenCalledWith('/api/zones/zone-1/context', {
        zoneContextId: 'context-1',
      });
    });

    test('throws error on failure', async () => {
      mockPatch.mockResolvedValue({ success: false, error: 'Failed' });

      await expect(client.updateZoneContextId('zone-1', 'context-1')).rejects.toThrow(
        'Failed to update zone context FK'
      );
    });
  });

  describe('deleteProject', () => {
    test('deletes project successfully', async () => {
      mockDelete.mockResolvedValue({ success: true, data: { message: 'deleted' } });

      const result = await client.deleteProject('proj-1');

      expect(result).toBe(true);
      expect(mockDelete).toHaveBeenCalledWith('/api/projects/proj-1');
    });

    test('returns false on failure', async () => {
      mockDelete.mockResolvedValue({ success: false, error: 'Delete failed' });

      const result = await client.deleteProject('proj-1');

      expect(result).toBe(false);
    });
  });

  describe('startProject', () => {
    test('starts project successfully', async () => {
      const project = createMockProject({ status: 'active' });
      mockPost.mockResolvedValue({ success: true, data: { project } });

      const result = await client.startProject('proj-1');

      expect(result.status).toBe('active');
      expect(mockPost).toHaveBeenCalledWith('/api/projects/proj-1/start');
    });

    test('throws error on failure', async () => {
      mockPost.mockResolvedValue({ success: false, error: 'Start failed' });

      await expect(client.startProject('proj-1')).rejects.toThrow('Failed to start project proj-1');
    });
  });

  describe('pauseProject', () => {
    test('pauses project successfully', async () => {
      const project = createMockProject({ status: 'paused' });
      mockPost.mockResolvedValue({ success: true, data: { project } });

      const result = await client.pauseProject('proj-1');

      expect(result.status).toBe('paused');
      expect(mockPost).toHaveBeenCalledWith('/api/projects/proj-1/pause');
    });
  });

  describe('completeProject', () => {
    test('completes project successfully', async () => {
      const project = createMockProject({ status: 'completed' });
      mockPost.mockResolvedValue({ success: true, data: { project } });

      const result = await client.completeProject('proj-1');

      expect(result.status).toBe('completed');
      expect(mockPost).toHaveBeenCalledWith('/api/projects/proj-1/complete');
    });
  });

  describe('failProject', () => {
    test('marks project as failed', async () => {
      const project = createMockProject({ status: 'failed' });
      mockPost.mockResolvedValue({ success: true, data: { project } });

      const result = await client.failProject('proj-1');

      expect(result.status).toBe('failed');
      expect(mockPost).toHaveBeenCalledWith('/api/projects/proj-1/fail');
    });
  });

  describe('agentEnterProject', () => {
    test('adds agent to project', async () => {
      const project = createMockProject({ presentAgentIds: ['agent-1'] });
      mockPost.mockResolvedValue({ success: true, data: { project } });

      const result = await client.agentEnterProject('proj-1', 'agent-1');

      expect(result.presentAgentIds).toContain('agent-1');
      expect(mockPost).toHaveBeenCalledWith('/api/projects/proj-1/agents/enter', {
        agentId: 'agent-1',
      });
    });

    test('throws error on failure', async () => {
      mockPost.mockResolvedValue({ success: false, error: 'Failed' });

      await expect(client.agentEnterProject('proj-1', 'agent-1')).rejects.toThrow(
        'Failed to add agent to project proj-1'
      );
    });
  });

  describe('agentLeaveProject', () => {
    test('removes agent from project', async () => {
      const project = createMockProject({ presentAgentIds: [] });
      mockPost.mockResolvedValue({ success: true, data: { project } });

      const result = await client.agentLeaveProject('proj-1', 'agent-1');

      expect(result.presentAgentIds).not.toContain('agent-1');
      expect(mockPost).toHaveBeenCalledWith('/api/projects/proj-1/agents/leave', {
        agentId: 'agent-1',
      });
    });
  });

  describe('getMetadata', () => {
    test('returns metadata on success', async () => {
      const metadata = { createdAt: 1234567890, updatedAt: 1234567890, version: '1.0.0' };
      mockGet.mockResolvedValue({ success: true, data: metadata });

      const result = await client.getMetadata();

      expect(result).toEqual(metadata);
      expect(mockGet).toHaveBeenCalledWith('/api/projects/metadata');
    });

    test('throws error on failure', async () => {
      mockGet.mockResolvedValue({ success: false, error: 'Failed' });

      await expect(client.getMetadata()).rejects.toThrow('Failed to get metadata');
    });
  });

  describe('addZoneMember', () => {
    test('adds member to zone', async () => {
      mockPost.mockResolvedValue({ success: true, data: { zone: {} } });

      await expect(client.addZoneMember('zone-1', 'agent-1')).resolves.not.toThrow();

      expect(mockPost).toHaveBeenCalledWith('/api/zones/zone-1/members/agent-1');
    });

    test('throws error on failure', async () => {
      mockPost.mockResolvedValue({ success: false, error: 'Failed' });

      await expect(client.addZoneMember('zone-1', 'agent-1')).rejects.toThrow(
        'Failed to add agent to zone'
      );
    });
  });

  describe('removeZoneMember', () => {
    test('removes member from zone', async () => {
      mockDelete.mockResolvedValue({ success: true, data: { zone: {} } });

      await expect(client.removeZoneMember('zone-1', 'agent-1')).resolves.not.toThrow();

      expect(mockDelete).toHaveBeenCalledWith('/api/zones/zone-1/members/agent-1');
    });

    test('throws error on failure', async () => {
      mockDelete.mockResolvedValue({ success: false, error: 'Failed' });

      await expect(client.removeZoneMember('zone-1', 'agent-1')).rejects.toThrow(
        'Failed to remove agent from zone'
      );
    });
  });
});