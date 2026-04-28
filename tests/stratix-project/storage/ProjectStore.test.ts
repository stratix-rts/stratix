import { ProjectStore, ProjectDatabase } from '@/stratix-project/storage/ProjectStore';
import { Project, ProjectChannel, ProjectChannelMessage } from '@/stratix-project/types';

const mockEnsureDir = jest.fn().mockResolvedValue(undefined);
const mockRead = jest.fn().mockResolvedValue(undefined);
const mockWrite = jest.fn().mockResolvedValue(undefined);

jest.mock('fs-extra', () => ({
  ensureDir: (...args: any[]) => mockEnsureDir(...args),
}));

function createMockDb() {
  const data: ProjectDatabase = {
    projects: [],
    channels: {},
    messages: {},
    metadata: {
      createdAt: Date.now(),
      updatedAt: Date.now(),
      version: '1.0.0',
    },
  };
  return {
    read: (...args: any[]) => mockRead(...args),
    write: (...args: any[]) => mockWrite(...args),
    data,
  };
}

let mockDb = createMockDb();

jest.mock('lowdb', () => ({
  Low: jest.fn().mockImplementation(() => mockDb),
}));

jest.mock('lowdb/node', () => ({
  JSONFile: jest.fn(),
}));

function createMockProject(overrides?: Partial<Project>): Project {
  return {
    id: 'proj-1',
    name: 'Test Project',
    description: 'A test project',
    priority: 1,
    status: 'pending',
    config: {
      name: 'Test Project',
      description: 'A test project',
      priority: 1,
      localFolderPath: '/tmp/test',
      agentMode: 'llm',
      planningRule: 'sequential',
      executionPermission: 'confirm',
      requirement: { type: 'text', content: 'Test' },
      progressRule: 'average',
    },
    path: '/tmp/test',
    presentAgentIds: [],
    zoneConfig: { x: 100, y: 100, width: 800, height: 600 },
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function createMockChannel(overrides?: Partial<ProjectChannel>): ProjectChannel {
  return {
    id: 'ch-1',
    projectId: 'proj-1',
    name: 'general',
    type: 'general',
    subscriberIds: [],
    isPrivate: false,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  };
}

function createMockMessage(overrides?: Partial<ProjectChannelMessage>): ProjectChannelMessage {
  return {
    id: 'msg-1',
    projectId: 'proj-1',
    channelId: 'ch-1',
    role: 'user',
    content: 'Hello',
    timestamp: Date.now(),
    sender: { id: 'user-1', type: 'user', name: 'Test User' },
    mentions: [],
    messageType: 'chat',
    metadata: { source: 'local', createdAt: new Date().toISOString() },
    ...overrides,
  };
}

describe('ProjectStore', () => {
  let store: ProjectStore;

  beforeEach(() => {
    jest.clearAllMocks();
    mockDb = createMockDb();
    store = new ProjectStore('test-data');
  });

  afterEach(async () => {
    // Wait for any pending write queue operations
    await new Promise((resolve) => setTimeout(resolve, 50));
  });

  describe('constructor', () => {
    test('creates instance with default data dir', () => {
      const defaultStore = new ProjectStore();
      expect(defaultStore).toBeInstanceOf(ProjectStore);
      expect(defaultStore.getDbPath()).toContain('projects.json');
    });

    test('creates instance with custom data dir', () => {
      expect(store.getDbPath()).toBe('test-data/projects.json');
    });
  });

  describe('initialize', () => {
    test('creates directory if not exists', async () => {
      await store.initialize();
      expect(mockEnsureDir).toHaveBeenCalledWith('test-data');
    });

    test('reads existing db file', async () => {
      await store.initialize();
      expect(mockRead).toHaveBeenCalled();
    });

    test('initializes default data when db is empty', async () => {
      mockDb.data = null as any;
      await store.initialize();
      expect(mockDb.data.projects).toEqual([]);
      expect(mockDb.data.metadata.version).toBe('1.0.0');
      expect(mockWrite).toHaveBeenCalled();
    });

    test('initializes default data when metadata is missing', async () => {
      mockDb.data = { projects: [] } as any;
      await store.initialize();
      expect(mockDb.data.metadata).toBeDefined();
      expect(mockWrite).toHaveBeenCalled();
    });

    test('does not re-initialize if already initialized', async () => {
      await store.initialize();
      expect(mockEnsureDir).toHaveBeenCalledTimes(1);
      await store.initialize();
      expect(mockEnsureDir).toHaveBeenCalledTimes(1);
    });

    test('handles read errors gracefully', async () => {
      mockRead.mockRejectedValueOnce(new Error('Read failed'));
      await expect(store.initialize()).resolves.not.toThrow();
    });
  });

  describe('addProject', () => {
    test('adds project to store', async () => {
      const project = createMockProject();
      await store.addProject(project);
      expect(mockDb.data.projects).toHaveLength(1);
      expect(mockDb.data.projects[0].id).toBe('proj-1');
    });

    test('throws when project with same id exists', async () => {
      const project = createMockProject();
      await store.addProject(project);
      await expect(store.addProject(project)).rejects.toThrow('already exists');
    });

    test('initializes store if not initialized', async () => {
      const project = createMockProject();
      await store.addProject(project);
      expect(mockEnsureDir).toHaveBeenCalled();
    });
  });

  describe('getProject', () => {
    test('returns project by id', async () => {
      const project = createMockProject();
      await store.addProject(project);
      const result = await store.getProject('proj-1');
      expect(result).toMatchObject({ id: 'proj-1', name: 'Test Project' });
    });

    test('returns null for non-existent project', async () => {
      const result = await store.getProject('non-existent');
      expect(result).toBeNull();
    });

    test('returns cloned object, not reference', async () => {
      const project = createMockProject();
      await store.addProject(project);
      const result = await store.getProject('proj-1');
      expect(result).not.toBe(mockDb.data.projects[0]);
    });
  });

  describe('updateProject', () => {
    test('updates existing project', async () => {
      const project = createMockProject();
      await store.addProject(project);
      const updated = { ...project, name: 'Updated Name' };
      await store.updateProject(updated);
      expect(mockDb.data.projects[0].name).toBe('Updated Name');
    });

    test('throws when project not found', async () => {
      const project = createMockProject();
      await expect(store.updateProject(project)).rejects.toThrow('not found');
    });

    test('sets updatedAt date', async () => {
      const project = createMockProject();
      await store.addProject(project);
      const updated = { ...project, name: 'Updated' };
      await store.updateProject(updated);
      expect(mockDb.data.projects[0].updatedAt).toBeInstanceOf(Date);
    });
  });

  describe('deleteProject', () => {
    test('deletes existing project and returns true', async () => {
      const project = createMockProject();
      await store.addProject(project);
      const result = await store.deleteProject('proj-1');
      expect(result).toBe(true);
      expect(mockDb.data.projects).toHaveLength(0);
    });

    test('returns false for non-existent project', async () => {
      const result = await store.deleteProject('non-existent');
      expect(result).toBe(false);
    });
  });

  describe('getAllProjects', () => {
    test('returns all projects', async () => {
      await store.addProject(createMockProject({ id: 'proj-1' }));
      await store.addProject(createMockProject({ id: 'proj-2', name: 'Project 2' }));
      const result = await store.getAllProjects();
      expect(result).toHaveLength(2);
    });

    test('returns cloned array', async () => {
      await store.addProject(createMockProject());
      const result = await store.getAllProjects();
      expect(result).not.toBe(mockDb.data.projects);
    });
  });

  describe('getProjectsByStatus', () => {
    test('returns projects matching status', async () => {
      await store.addProject(createMockProject({ id: 'proj-1', status: 'active' }));
      await store.addProject(createMockProject({ id: 'proj-2', status: 'pending' }));
      const result = await store.getProjectsByStatus('active');
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('proj-1');
    });

    test('returns empty array when no matches', async () => {
      await store.addProject(createMockProject({ status: 'pending' }));
      const result = await store.getProjectsByStatus('active');
      expect(result).toEqual([]);
    });
  });

  describe('getProjectsByPriority', () => {
    test('returns projects matching priority', async () => {
      await store.addProject(createMockProject({ id: 'proj-1', priority: 3 }));
      await store.addProject(createMockProject({ id: 'proj-2', priority: 1 }));
      const result = await store.getProjectsByPriority(3);
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('proj-1');
    });
  });

  describe('getProjectCount', () => {
    test('returns correct count', async () => {
      expect(await store.getProjectCount()).toBe(0);
      await store.addProject(createMockProject());
      expect(await store.getProjectCount()).toBe(1);
    });
  });

  describe('clearAllProjects', () => {
    test('removes all projects', async () => {
      await store.addProject(createMockProject({ id: 'proj-1' }));
      await store.addProject(createMockProject({ id: 'proj-2' }));
      await store.clearAllProjects();
      expect(await store.getProjectCount()).toBe(0);
    });
  });

  describe('getMetadata', () => {
    test('returns metadata copy', async () => {
      await store.initialize();
      const metadata = await store.getMetadata();
      expect(metadata.version).toBe('1.0.0');
    });
  });

  describe('exportData / importData', () => {
    test('exportData returns JSON string', async () => {
      await store.addProject(createMockProject());
      const json = await store.exportData();
      const parsed = JSON.parse(json);
      expect(parsed.projects).toHaveLength(1);
      expect(parsed.metadata.version).toBe('1.0.0');
    });

    test('importData restores database', async () => {
      const data: ProjectDatabase = {
        projects: [createMockProject()],
        channels: {},
        messages: {},
        metadata: { createdAt: 1, updatedAt: 2, version: '2.0.0' },
      };
      await store.importData(JSON.stringify(data));
      expect(mockDb.data.metadata.version).toBe('2.0.0');
      expect(mockDb.data.projects).toHaveLength(1);
    });
  });

  describe('Channel operations', () => {
    test('getChannels returns empty array for new project', async () => {
      const result = await store.getChannels('proj-1');
      expect(result).toEqual([]);
    });

    test('addChannel adds channel to project', async () => {
      const channel = createMockChannel();
      await store.addChannel(channel);
      const result = await store.getChannels('proj-1');
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('general');
    });

    test('addChannel throws for duplicate id', async () => {
      const channel = createMockChannel();
      await store.addChannel(channel);
      await expect(store.addChannel(channel)).rejects.toThrow('already exists');
    });

    test('getChannel returns specific channel', async () => {
      const channel = createMockChannel();
      await store.addChannel(channel);
      const result = await store.getChannel('proj-1', 'ch-1');
      expect(result).toEqual(channel);
    });

    test('getChannel returns null for non-existent channel', async () => {
      const result = await store.getChannel('proj-1', 'ch-1');
      expect(result).toBeNull();
    });

    test('updateChannel updates existing channel', async () => {
      const channel = createMockChannel();
      await store.addChannel(channel);
      const updated = { ...channel, name: 'updated' };
      await store.updateChannel(updated);
      const result = await store.getChannel('proj-1', 'ch-1');
      expect(result?.name).toBe('updated');
    });

    test('updateChannel throws when project has no channels', async () => {
      const channel = createMockChannel();
      await expect(store.updateChannel(channel)).rejects.toThrow('has no channels');
    });

    test('updateChannel throws when channel not found', async () => {
      const channel = createMockChannel();
      await store.addChannel(channel);
      const updated = { ...channel, id: 'ch-2' };
      await expect(store.updateChannel(updated)).rejects.toThrow('not found');
    });

    test('deleteChannel removes channel and returns true', async () => {
      const channel = createMockChannel();
      await store.addChannel(channel);
      const result = await store.deleteChannel('proj-1', 'ch-1');
      expect(result).toBe(true);
      expect(await store.getChannels('proj-1')).toHaveLength(0);
    });

    test('deleteChannel returns false for non-existent project', async () => {
      const result = await store.deleteChannel('proj-1', 'ch-1');
      expect(result).toBe(false);
    });

    test('subscribeToChannel adds agent to subscribers', async () => {
      const channel = createMockChannel({ subscriberIds: [] });
      await store.addChannel(channel);
      await store.subscribeToChannel('proj-1', 'ch-1', 'agent-1');
      const result = await store.getChannel('proj-1', 'ch-1');
      expect(result?.subscriberIds).toContain('agent-1');
    });

    test('subscribeToChannel does not duplicate agent', async () => {
      const channel = createMockChannel({ subscriberIds: ['agent-1'] });
      await store.addChannel(channel);
      await store.subscribeToChannel('proj-1', 'ch-1', 'agent-1');
      const result = await store.getChannel('proj-1', 'ch-1');
      expect(result?.subscriberIds).toEqual(['agent-1']);
    });

    test('unsubscribeFromChannel removes agent', async () => {
      const channel = createMockChannel({ subscriberIds: ['agent-1', 'agent-2'] });
      await store.addChannel(channel);
      await store.unsubscribeFromChannel('proj-1', 'ch-1', 'agent-1');
      const result = await store.getChannel('proj-1', 'ch-1');
      expect(result?.subscriberIds).toEqual(['agent-2']);
    });

    test('unsubscribeFromChannel handles missing channel gracefully', async () => {
      await expect(store.unsubscribeFromChannel('proj-1', 'ch-1', 'agent-1')).resolves.not.toThrow();
    });
  });

  describe('Message operations', () => {
    test('addMessage adds message to project', async () => {
      const message = createMockMessage();
      await store.addMessage(message);
      const result = await store.getMessages('proj-1');
      expect(result).toHaveLength(1);
      expect(result[0].content).toBe('Hello');
    });

    test('getMessages filters by channelId', async () => {
      await store.addMessage(createMockMessage({ channelId: 'ch-1' }));
      await store.addMessage(createMockMessage({ id: 'msg-2', channelId: 'ch-2' }));
      const result = await store.getMessages('proj-1', 'ch-1');
      expect(result).toHaveLength(1);
      expect(result[0].channelId).toBe('ch-1');
    });

    test('getMessages filters by since timestamp', async () => {
      const t1 = Date.now() - 1000;
      const t2 = Date.now();
      await store.addMessage(createMockMessage({ timestamp: t1 }));
      await store.addMessage(createMockMessage({ id: 'msg-2', timestamp: t2 }));
      const result = await store.getMessages('proj-1', undefined, t1);
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('msg-2');
    });

    test('getMessages returns sorted by timestamp', async () => {
      await store.addMessage(createMockMessage({ timestamp: 300 }));
      await store.addMessage(createMockMessage({ id: 'msg-2', timestamp: 100 }));
      await store.addMessage(createMockMessage({ id: 'msg-3', timestamp: 200 }));
      const result = await store.getMessages('proj-1');
      expect(result.map((m) => m.id)).toEqual(['msg-2', 'msg-3', 'msg-1']);
    });

    test('getMessagesByMention returns matching messages', async () => {
      await store.addMessage(createMockMessage({ mentions: ['agent-1'] }));
      await store.addMessage(createMockMessage({ id: 'msg-2', mentions: ['agent-2'] }));
      const result = await store.getMessagesByMention('proj-1', 'agent-1');
      expect(result).toHaveLength(1);
    });

    test('getLastMessageTime returns latest timestamp', async () => {
      await store.addMessage(createMockMessage({ timestamp: 100 }));
      await store.addMessage(createMockMessage({ id: 'msg-2', timestamp: 500 }));
      const result = await store.getLastMessageTime('proj-1');
      expect(result).toBe(500);
    });

    test('getLastMessageTime returns 0 for no messages', async () => {
      const result = await store.getLastMessageTime('proj-1');
      expect(result).toBe(0);
    });

    test('deleteProjectMessages removes all messages and channels for project', async () => {
      await store.addMessage(createMockMessage());
      await store.addChannel(createMockChannel());
      await store.deleteProjectMessages('proj-1');
      expect(await store.getMessages('proj-1')).toHaveLength(0);
      expect(await store.getChannels('proj-1')).toHaveLength(0);
    });
  });

  describe('Concurrent write safety', () => {
    test('serializes multiple write operations', async () => {
      const project1 = createMockProject({ id: 'proj-1' });
      const project2 = createMockProject({ id: 'proj-2' });

      // Start both operations concurrently
      const promise1 = store.addProject(project1);
      const promise2 = store.addProject(project2);

      await expect(Promise.all([promise1, promise2])).resolves.not.toThrow();
      expect(mockDb.data.projects).toHaveLength(2);
    });

    test('write queue persists operations in order', async () => {
      const project = createMockProject();
      await store.addProject(project);

      const updatePromise = store.updateProject({ ...project, name: 'Updated' });
      const deletePromise = store.deleteProject('proj-1');

      await expect(Promise.all([updatePromise, deletePromise])).resolves.not.toThrow();
    });
  });
});
