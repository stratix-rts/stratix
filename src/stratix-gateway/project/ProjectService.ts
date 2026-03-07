import { Low } from 'lowdb';
import { JSONFile } from 'lowdb/node';
import { Project, ProjectConfig, ProjectStatus } from '../../stratix-project/types';
import fs from 'fs-extra';
import path from 'path';
import { generateId } from '../../stratix-project/utils/helpers';

export interface ProjectDatabase {
  projects: Project[];
  metadata: {
    createdAt: number;
    updatedAt: number;
    version: string;
  };
}

const DEFAULT_DB: ProjectDatabase = {
  projects: [],
  metadata: {
    createdAt: Date.now(),
    updatedAt: Date.now(),
    version: '1.0.0'
  }
};

export class ProjectService {
  private db: Low<ProjectDatabase>;
  private dbPath: string;
  private initialized: boolean = false;

  constructor(dataDir: string = 'stratix-data') {
    this.dbPath = path.join(dataDir, 'projects.json');
    this.db = new Low<ProjectDatabase>(new JSONFile(this.dbPath), DEFAULT_DB);
  }

  public async initialize(): Promise<void> {
    if (this.initialized) return;

    await fs.ensureDir(path.dirname(this.dbPath));

    try {
      await this.db.read();
    } catch {
    }

    if (!this.db.data || !this.db.data.metadata) {
      this.db.data = JSON.parse(JSON.stringify(DEFAULT_DB));
      this.db.data.metadata.createdAt = Date.now();
      this.db.data.metadata.updatedAt = Date.now();
      await this.db.write();
    }

    this.initialized = true;
    console.log(`[ProjectService] Initialized with database at: ${this.dbPath}`);
  }

  private async ensureInitialized(): Promise<void> {
    if (!this.initialized) {
      await this.initialize();
    }
  }

  private async refresh(): Promise<void> {
    await this.db.read();
  }

  private async persist(): Promise<void> {
    this.db.data.metadata.updatedAt = Date.now();
    await this.db.write();
  }

  public async createProject(config: ProjectConfig, zoneConfig?: Partial<Project['zoneConfig']>): Promise<Project> {
    await this.ensureInitialized();
    await this.refresh();

    const projectId = generateId('proj');
    
    const project: Project = {
      id: projectId,
      name: config.name,
      description: config.description,
      priority: config.priority,
      status: 'pending',
      config: config,
      path: config.localFolderPath,
      presentAgentIds: [],
      zoneConfig: {
        x: 100,
        y: 100,
        width: 800,
        height: 600,
        color: 15790320,
        opacity: 0.3,
        visible: true,
        ...zoneConfig
      },
      createdAt: new Date(),
      updatedAt: new Date()
    };

    const existingIndex = this.db.data.projects.findIndex(p => p.id === project.id);
    if (existingIndex >= 0) {
      throw new Error(`Project with id ${project.id} already exists`);
    }

    this.db.data.projects.push(project);
    await this.persist();

    console.log(`[ProjectService] Created project: ${project.id} - ${project.name}`);
    return project;
  }

  public async getProject(id: string): Promise<Project | null> {
    await this.ensureInitialized();
    await this.refresh();
    
    const project = this.db.data.projects.find(p => p.id === id);
    return project ? JSON.parse(JSON.stringify(project)) : null;
  }

  public async updateProject(id: string, updates: Partial<Project>): Promise<Project> {
    await this.ensureInitialized();
    await this.refresh();

    const index = this.db.data.projects.findIndex(p => p.id === id);
    if (index === -1) {
      throw new Error(`Project with id ${id} not found`);
    }

    const updatedProject: Project = {
      ...this.db.data.projects[index],
      ...updates,
      id: id,
      createdAt: this.db.data.projects[index].createdAt,
      updatedAt: new Date()
    };

    this.db.data.projects[index] = updatedProject;
    await this.persist();

    console.log(`[ProjectService] Updated project: ${id}`);
    return JSON.parse(JSON.stringify(updatedProject));
  }

  public async deleteProject(id: string): Promise<boolean> {
    await this.ensureInitialized();
    await this.refresh();

    const initialLength = this.db.data.projects.length;
    this.db.data.projects = this.db.data.projects.filter(p => p.id !== id);

    if (this.db.data.projects.length < initialLength) {
      await this.persist();
      console.log(`[ProjectService] Deleted project: ${id}`);
      return true;
    }
    return false;
  }

  public async getAllProjects(): Promise<Project[]> {
    await this.ensureInitialized();
    await this.refresh();
    return JSON.parse(JSON.stringify(this.db.data.projects));
  }

  public async getProjectsByStatus(status: ProjectStatus): Promise<Project[]> {
    await this.ensureInitialized();
    await this.refresh();
    return this.db.data.projects.filter(p => p.status === status);
  }

  public async getProjectsByPriority(priority: number): Promise<Project[]> {
    await this.ensureInitialized();
    await this.refresh();
    return this.db.data.projects.filter(p => p.priority === priority);
  }

  public async startProject(id: string): Promise<Project> {
    return await this.updateProject(id, {
      status: 'active',
      startedAt: new Date()
    });
  }

  public async pauseProject(id: string): Promise<Project> {
    return await this.updateProject(id, {
      status: 'paused'
    });
  }

  public async completeProject(id: string): Promise<Project> {
    return await this.updateProject(id, {
      status: 'completed',
      completedAt: new Date()
    });
  }

  public async failProject(id: string): Promise<Project> {
    return await this.updateProject(id, {
      status: 'failed'
    });
  }

  public async agentEnterProject(projectId: string, agentId: string): Promise<Project> {
    const project = await this.getProject(projectId);
    if (!project) {
      throw new Error(`Project not found: ${projectId}`);
    }

    if (!project.presentAgentIds.includes(agentId)) {
      project.presentAgentIds.push(agentId);
      const updated = await this.updateProject(projectId, {
        presentAgentIds: project.presentAgentIds
      });
      console.log(`[ProjectService] Agent ${agentId} entered project ${projectId}`);
      return updated;
    }

    return project;
  }

  public async agentLeaveProject(projectId: string, agentId: string): Promise<Project> {
    const project = await this.getProject(projectId);
    if (!project) {
      throw new Error(`Project not found: ${projectId}`);
    }

    project.presentAgentIds = project.presentAgentIds.filter(id => id !== agentId);
    
    const updated = await this.updateProject(projectId, {
      presentAgentIds: project.presentAgentIds
    });

    console.log(`[ProjectService] Agent ${agentId} left project ${projectId}`);
    return updated;
  }

  public getDbPath(): string {
    return this.dbPath;
  }

  public async getMetadata(): Promise<{ createdAt: number; updatedAt: number; version: string }> {
    await this.ensureInitialized();
    await this.refresh();
    return { ...this.db.data.metadata };
  }
}
