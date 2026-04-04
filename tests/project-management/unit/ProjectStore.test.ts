import { ProjectStore } from '../../../src/stratix-project/storage/ProjectStore';
import { Project } from '../../../src/stratix-project/types';
import fs from 'fs-extra';
import path from 'path';
import { generateId } from '../../../src/stratix-project/utils/helpers';

describe('ProjectStore', () => {
  let store: ProjectStore;
  let testDir: string;

  beforeEach(async () => {
    testDir = path.join(__dirname, 'test-data', Date.now().toString());
    store = new ProjectStore(testDir);
    await store.initialize();
  });

  afterEach(async () => {
    try {
      await fs.remove(testDir);
    } catch (error) {
      // Ignore cleanup errors
    }
  });

  function createTestProject(overrides?: Partial<Project>): Project {
    return {
      id: generateId('proj'),
      name: 'Test Project',
      priority: 3,
      status: 'pending',
      config: {
        name: 'Test Project',
        priority: 3,
        localFolderPath: '/test/path',
        agentMode: 'openclaw',
        planningRule: 'sequential',
        executionPermission: 'auto',
        requirement: { type: 'text', content: 'Test requirement' },
        progressRule: 'average'
      },
      path: '/test/path',
      presentAgentIds: [],
      zoneConfig: {
        x: 100,
        y: 100,
        width: 800,
        height: 600
      },
      createdAt: new Date(),
      updatedAt: new Date(),
      ...overrides
    };
  }

  describe('initialize', () => {
    it('should create database directory if it does not exist', async () => {
      const dir = path.join(__dirname, 'test-init', Date.now().toString());
      const newStore = new ProjectStore(dir);
      
      await newStore.initialize();
      
      const exists = await fs.pathExists(path.join(dir, 'projects.json'));
      expect(exists).toBe(true);
      
      await fs.remove(dir);
    });

    it('should not reinitialize if already initialized', async () => {
      const metadata1 = await store.getMetadata();
      
      await store.initialize();
      
      const metadata2 = await store.getMetadata();
      expect(metadata1.createdAt).toBe(metadata2.createdAt);
    });
  });

  describe('addProject', () => {
    it('should add a new project', async () => {
      const project = createTestProject();
      
      await store.addProject(project);
      
      const retrieved = await store.getProject(project.id);
      expect(retrieved).not.toBeNull();
      expect(retrieved?.id).toBe(project.id);
      expect(retrieved?.name).toBe(project.name);
    });

    it('should throw error when adding duplicate project', async () => {
      const project = createTestProject();
      
      await store.addProject(project);
      
      await expect(store.addProject(project)).rejects.toThrow(
        `Project with id ${project.id} already exists`
      );
    });

    it('should persist project to disk', async () => {
      const project = createTestProject();
      await store.addProject(project);
      
      const newStore = new ProjectStore(testDir);
      await newStore.initialize();
      
      const retrieved = await newStore.getProject(project.id);
      expect(retrieved).not.toBeNull();
      expect(retrieved?.id).toBe(project.id);
    });
  });

  describe('getProject', () => {
    it('should retrieve existing project', async () => {
      const project = createTestProject();
      await store.addProject(project);
      
      const retrieved = await store.getProject(project.id);
      
      expect(retrieved).not.toBeNull();
      expect(retrieved?.id).toBe(project.id);
    });

    it('should return null for non-existent project', async () => {
      const retrieved = await store.getProject('non-existent-id');
      
      expect(retrieved).toBeNull();
    });

    it('should return deep copy of project', async () => {
      const project = createTestProject();
      await store.addProject(project);
      
      const retrieved1 = await store.getProject(project.id);
      const retrieved2 = await store.getProject(project.id);
      
      expect(retrieved1).not.toBe(retrieved2);
      expect(retrieved1).toEqual(retrieved2);
    });
  });

  describe('updateProject', () => {
    it('should update existing project', async () => {
      const project = createTestProject();
      await store.addProject(project);
      
      const updated = {
        ...project,
        name: 'Updated Name',
        status: 'active' as const
      };
      
      await store.updateProject(updated);
      
      const retrieved = await store.getProject(project.id);
      expect(retrieved?.name).toBe('Updated Name');
      expect(retrieved?.status).toBe('active');
    });

    it('should throw error when updating non-existent project', async () => {
      const project = createTestProject();
      
      await expect(store.updateProject(project)).rejects.toThrow(
        `Project with id ${project.id} not found`
      );
    });

    it('should update updatedAt timestamp', async () => {
      const project = createTestProject();
      await store.addProject(project);
      
      await new Promise(resolve => setTimeout(resolve, 10));
      
      const updated = { ...project, name: 'Updated' };
      await store.updateProject(updated);
      
      const retrieved = await store.getProject(project.id);
      expect(retrieved?.updatedAt.getTime()).toBeGreaterThan(project.updatedAt.getTime());
    });
  });

  describe('deleteProject', () => {
    it('should delete existing project', async () => {
      const project = createTestProject();
      await store.addProject(project);
      
      const result = await store.deleteProject(project.id);
      
      expect(result).toBe(true);
      
      const retrieved = await store.getProject(project.id);
      expect(retrieved).toBeNull();
    });

    it('should return false when deleting non-existent project', async () => {
      const result = await store.deleteProject('non-existent-id');
      
      expect(result).toBe(false);
    });
  });

  describe('getAllProjects', () => {
    it('should return empty array when no projects', async () => {
      const projects = await store.getAllProjects();
      
      expect(projects).toEqual([]);
    });

    it('should return all projects', async () => {
      const project1 = createTestProject({ id: 'proj_1' });
      const project2 = createTestProject({ id: 'proj_2' });
      const project3 = createTestProject({ id: 'proj_3' });
      
      await store.addProject(project1);
      await store.addProject(project2);
      await store.addProject(project3);
      
      const projects = await store.getAllProjects();
      
      expect(projects).toHaveLength(3);
      expect(projects.map(p => p.id)).toEqual(
        expect.arrayContaining(['proj_1', 'proj_2', 'proj_3'])
      );
    });

    it('should return deep copies', async () => {
      const project = createTestProject();
      await store.addProject(project);
      
      const projects1 = await store.getAllProjects();
      const projects2 = await store.getAllProjects();
      
      expect(projects1[0]).not.toBe(projects2[0]);
      expect(projects1[0]).toEqual(projects2[0]);
    });
  });

  describe('getProjectsByStatus', () => {
    it('should filter projects by status', async () => {
      const project1 = createTestProject({ id: 'proj_1', status: 'pending' });
      const project2 = createTestProject({ id: 'proj_2', status: 'active' });
      const project3 = createTestProject({ id: 'proj_3', status: 'pending' });
      
      await store.addProject(project1);
      await store.addProject(project2);
      await store.addProject(project3);
      
      const pendingProjects = await store.getProjectsByStatus('pending');
      
      expect(pendingProjects).toHaveLength(2);
      expect(pendingProjects.map(p => p.id)).toEqual(
        expect.arrayContaining(['proj_1', 'proj_3'])
      );
    });

    it('should return empty array when no matching projects', async () => {
      const project = createTestProject({ status: 'pending' });
      await store.addProject(project);
      
      const activeProjects = await store.getProjectsByStatus('active');
      
      expect(activeProjects).toEqual([]);
    });
  });

  describe('getProjectsByPriority', () => {
    it('should filter projects by priority', async () => {
      const project1 = createTestProject({ id: 'proj_1', priority: 1 });
      const project2 = createTestProject({ id: 'proj_2', priority: 2 });
      const project3 = createTestProject({ id: 'proj_3', priority: 1 });
      
      await store.addProject(project1);
      await store.addProject(project2);
      await store.addProject(project3);
      
      const highPriorityProjects = await store.getProjectsByPriority(1);
      
      expect(highPriorityProjects).toHaveLength(2);
      expect(highPriorityProjects.map(p => p.id)).toEqual(
        expect.arrayContaining(['proj_1', 'proj_3'])
      );
    });
  });

  describe('getProjectCount', () => {
    it('should return correct count', async () => {
      expect(await store.getProjectCount()).toBe(0);
      
      await store.addProject(createTestProject());
      expect(await store.getProjectCount()).toBe(1);
      
      await store.addProject(createTestProject());
      expect(await store.getProjectCount()).toBe(2);
    });
  });

  describe('clearAllProjects', () => {
    it('should remove all projects', async () => {
      await store.addProject(createTestProject());
      await store.addProject(createTestProject());
      
      await store.clearAllProjects();
      
      const projects = await store.getAllProjects();
      expect(projects).toEqual([]);
      expect(await store.getProjectCount()).toBe(0);
    });
  });

  describe('getMetadata', () => {
    it('should return metadata', async () => {
      const metadata = await store.getMetadata();
      
      expect(metadata).toHaveProperty('createdAt');
      expect(metadata).toHaveProperty('updatedAt');
      expect(metadata).toHaveProperty('version');
      expect(metadata.version).toBe('1.0.0');
    });
  });

  describe('exportData and importData', () => {
    it('should export and import data', async () => {
      const project1 = createTestProject({ id: 'proj_1' });
      const project2 = createTestProject({ id: 'proj_2' });
      
      await store.addProject(project1);
      await store.addProject(project2);
      
      const exported = await store.exportData();
      
      await store.clearAllProjects();
      expect(await store.getProjectCount()).toBe(0);
      
      await store.importData(exported);
      
      const projects = await store.getAllProjects();
      expect(projects).toHaveLength(2);
      expect(projects.map(p => p.id)).toEqual(
        expect.arrayContaining(['proj_1', 'proj_2'])
      );
    });
  });
});
