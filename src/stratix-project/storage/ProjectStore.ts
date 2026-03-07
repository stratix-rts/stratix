import { Low } from 'lowdb';
import { JSONFile } from 'lowdb/node';
import { Project } from '../types';
import fs from 'fs-extra';
import path from 'path';

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

export class ProjectStore {
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
      // File doesn't exist or is invalid, use default
    }

    if (!this.db.data || !this.db.data.metadata) {
      this.db.data = JSON.parse(JSON.stringify(DEFAULT_DB));
      this.db.data.metadata.createdAt = Date.now();
      this.db.data.metadata.updatedAt = Date.now();
      await this.db.write();
    }

    this.initialized = true;
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

  public async addProject(project: Project): Promise<void> {
    await this.ensureInitialized();
    await this.refresh();

    const existingIndex = this.db.data.projects.findIndex(p => p.id === project.id);
    if (existingIndex >= 0) {
      throw new Error(`Project with id ${project.id} already exists`);
    }

    this.db.data.projects.push(project);
    await this.persist();
  }

  public async getProject(id: string): Promise<Project | null> {
    await this.ensureInitialized();
    await this.refresh();
    
    const project = this.db.data.projects.find(p => p.id === id);
    return project ? JSON.parse(JSON.stringify(project)) : null;
  }

  public async updateProject(project: Project): Promise<void> {
    await this.ensureInitialized();
    await this.refresh();

    const index = this.db.data.projects.findIndex(p => p.id === project.id);
    if (index === -1) {
      throw new Error(`Project with id ${project.id} not found`);
    }

    this.db.data.projects[index] = {
      ...project,
      updatedAt: new Date()
    };
    await this.persist();
  }

  public async deleteProject(id: string): Promise<boolean> {
    await this.ensureInitialized();
    await this.refresh();

    const initialLength = this.db.data.projects.length;
    this.db.data.projects = this.db.data.projects.filter(p => p.id !== id);

    if (this.db.data.projects.length < initialLength) {
      await this.persist();
      return true;
    }
    return false;
  }

  public async getAllProjects(): Promise<Project[]> {
    await this.ensureInitialized();
    await this.refresh();
    return JSON.parse(JSON.stringify(this.db.data.projects));
  }

  public async getProjectsByStatus(status: string): Promise<Project[]> {
    await this.ensureInitialized();
    await this.refresh();
    return this.db.data.projects.filter(p => p.status === status);
  }

  public async getProjectsByPriority(priority: number): Promise<Project[]> {
    await this.ensureInitialized();
    await this.refresh();
    return this.db.data.projects.filter(p => p.priority === priority);
  }

  public async getProjectCount(): Promise<number> {
    await this.ensureInitialized();
    await this.refresh();
    return this.db.data.projects.length;
  }

  public async clearAllProjects(): Promise<void> {
    await this.ensureInitialized();
    await this.refresh();
    this.db.data.projects = [];
    await this.persist();
  }

  public getDbPath(): string {
    return this.dbPath;
  }

  public async getMetadata(): Promise<{ createdAt: number; updatedAt: number; version: string }> {
    await this.ensureInitialized();
    await this.refresh();
    return { ...this.db.data.metadata };
  }

  public async exportData(): Promise<string> {
    await this.ensureInitialized();
    await this.refresh();
    return JSON.stringify(this.db.data, null, 2);
  }

  public async importData(jsonData: string): Promise<void> {
    await this.ensureInitialized();
    const data = JSON.parse(jsonData) as ProjectDatabase;
    this.db.data = data;
    await this.persist();
  }
}
