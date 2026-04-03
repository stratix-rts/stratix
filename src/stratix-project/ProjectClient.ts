import { ApiClient } from '../stratix-gateway/api/client';
import { API_PATHS } from '../stratix-gateway/api/types/api';
import { isApiSuccess } from '../stratix-gateway/api/types/api';
import { Project, ProjectConfig, ProjectZoneConfig, ProjectStatus } from './types';

export interface ProjectClientConfig {
  baseURL?: string;
}

interface ProjectsResponse {
  projects: Project[];
}

interface ProjectResponse {
  project: Project;
}

interface InitializeResponse {
  message: string;
}

interface MetadataResponse {
  createdAt: number;
  updatedAt: number;
  version: string;
}

export class ProjectClient {
  private client: ApiClient;

  constructor(config?: ProjectClientConfig) {
    this.client = new ApiClient({
      baseURL: config?.baseURL || 'http://localhost:7524'
    });
  }

  async initialize(): Promise<void> {
    const result = await this.client.post<InitializeResponse>(API_PATHS.PROJECTS + '/initialize');
    if (!result.success) {
      throw new Error(`Failed to initialize project service: ${result.error}`);
    }
    console.log('[ProjectClient] Project service initialized');
  }

  async getAllProjects(): Promise<Project[]> {
    const result = await this.client.get<ProjectsResponse>(API_PATHS.PROJECTS);
    if (!result.success) {
      console.error('[ProjectClient] Failed to get projects:', result.error);
      return [];
    }
    return result.data.projects || [];
  }

  async getProjectsByStatus(status: ProjectStatus): Promise<Project[]> {
    const result = await this.client.get<ProjectsResponse>(API_PATHS.PROJECTS, {
      headers: { params: JSON.stringify({ status }) }
    });
    if (!result.success) {
      console.error('[ProjectClient] Failed to get projects by status:', result.error);
      return [];
    }
    return result.data.projects || [];
  }

  async getProjectsByPriority(priority: number): Promise<Project[]> {
    const result = await this.client.get<ProjectsResponse>(API_PATHS.PROJECTS, {
      headers: { params: JSON.stringify({ priority }) }
    });
    if (!result.success) {
      console.error('[ProjectClient] Failed to get projects by priority:', result.error);
      return [];
    }
    return result.data.projects || [];
  }

  async createProject(
    config: ProjectConfig,
    zoneConfig?: Partial<ProjectZoneConfig>
  ): Promise<Project> {
    const result = await this.client.post<ProjectResponse>(API_PATHS.PROJECTS, {
      config,
      zoneConfig
    });

    if (!result.success) {
      throw new Error(`Failed to create project: ${result.error}`);
    }

    console.log(`[ProjectClient] Project created: ${result.data.project.id}`);
    return result.data.project;
  }

  async getProject(id: string): Promise<Project | null> {
    const result = await this.client.get<ProjectResponse>(API_PATHS.PROJECT_BY_ID(id));
    if (!result.success) {
      console.error(`[ProjectClient] Failed to get project ${id}:`, result.error);
      return null;
    }
    return result.data.project;
  }

  async updateProject(id: string, updates: Partial<Project>): Promise<Project> {
    const result = await this.client.put<ProjectResponse>(
      API_PATHS.PROJECT_BY_ID(id),
      { updates }
    );

    if (!result.success) {
      throw new Error(`Failed to update project ${id}: ${result.error}`);
    }

    console.log(`[ProjectClient] Project updated: ${id}`);
    return result.data.project;
  }

  async updateZoneConfig(id: string, zoneConfig: Partial<ProjectZoneConfig>): Promise<Project> {
    return this.updateProject(id, { zoneConfig } as Partial<Project>);
  }

  async updateZoneContextId(zoneId: string, zoneContextId: string): Promise<void> {
    const result = await this.client.patch<{ message: string }>(
      API_PATHS.PROJECT_ZONE_CONTEXT_LINK(zoneId),
      { zoneContextId }
    );

    if (!result.success) {
      console.error(`[ProjectClient] Failed to update zone context FK for ${zoneId}:`, result.error);
      throw new Error(`Failed to update zone context FK: ${result.error}`);
    }
    console.log(`[ProjectClient] Zone context FK updated: ${zoneId} -> ${zoneContextId}`);
  }

  async deleteProject(id: string): Promise<boolean> {
    const result = await this.client.delete<{ message: string }>(API_PATHS.PROJECT_BY_ID(id));
    if (!result.success) {
      console.error(`[ProjectClient] Failed to delete project ${id}:`, result.error);
      return false;
    }
    console.log(`[ProjectClient] Project deleted: ${id}`);
    return true;
  }

  async startProject(id: string): Promise<Project> {
    const result = await this.client.post<ProjectResponse>(API_PATHS.PROJECT_START(id));
    if (!result.success) {
      throw new Error(`Failed to start project ${id}: ${result.error}`);
    }
    console.log(`[ProjectClient] Project started: ${id}`);
    return result.data.project;
  }

  async pauseProject(id: string): Promise<Project> {
    const result = await this.client.post<ProjectResponse>(API_PATHS.PROJECT_PAUSE(id));
    if (!result.success) {
      throw new Error(`Failed to pause project ${id}: ${result.error}`);
    }
    console.log(`[ProjectClient] Project paused: ${id}`);
    return result.data.project;
  }

  async completeProject(id: string): Promise<Project> {
    const result = await this.client.post<ProjectResponse>(API_PATHS.PROJECT_COMPLETE(id));
    if (!result.success) {
      throw new Error(`Failed to complete project ${id}: ${result.error}`);
    }
    console.log(`[ProjectClient] Project completed: ${id}`);
    return result.data.project;
  }

  async failProject(id: string): Promise<Project> {
    const result = await this.client.post<ProjectResponse>(API_PATHS.PROJECT_FAIL(id));
    if (!result.success) {
      throw new Error(`Failed to mark project ${id} as failed: ${result.error}`);
    }
    console.log(`[ProjectClient] Project marked as failed: ${id}`);
    return result.data.project;
  }

  async agentEnterProject(projectId: string, agentId: string): Promise<Project> {
    const result = await this.client.post<ProjectResponse>(
      API_PATHS.PROJECT_AGENTS_ENTER(projectId),
      { agentId }
    );

    if (!result.success) {
      throw new Error(`Failed to add agent to project ${projectId}: ${result.error}`);
    }

    console.log(`[ProjectClient] Agent ${agentId} entered project ${projectId}`);
    return result.data.project;
  }

  async agentLeaveProject(projectId: string, agentId: string): Promise<Project> {
    const result = await this.client.post<ProjectResponse>(
      API_PATHS.PROJECT_AGENTS_LEAVE(projectId),
      { agentId }
    );

    if (!result.success) {
      throw new Error(`Failed to remove agent from project ${projectId}: ${result.error}`);
    }

    console.log(`[ProjectClient] Agent ${agentId} left project ${projectId}`);
    return result.data.project;
  }

  async getMetadata(): Promise<MetadataResponse> {
    const result = await this.client.get<MetadataResponse>(API_PATHS.PROJECT_METADATA);
    if (!result.success) {
      throw new Error(`Failed to get metadata: ${result.error}`);
    }
    return result.data;
  }

  // Zone member management
  async addZoneMember(zoneId: string, agentId: string): Promise<void> {
    const result = await this.client.post<{ zone: unknown }>(
      API_PATHS.ZONE_MEMBER(zoneId, agentId)
    );

    if (!result.success) {
      console.error(`[ProjectClient] Failed to add agent ${agentId} to zone ${zoneId}:`, result.error);
      throw new Error(`Failed to add agent to zone: ${result.error}`);
    }
    console.log(`[ProjectClient] Agent ${agentId} added to zone ${zoneId}`);
  }

  async removeZoneMember(zoneId: string, agentId: string): Promise<void> {
    const result = await this.client.delete<{ zone: unknown }>(
      API_PATHS.ZONE_MEMBER(zoneId, agentId)
    );

    if (!result.success) {
      console.error(`[ProjectClient] Failed to remove agent ${agentId} from zone ${zoneId}:`, result.error);
      throw new Error(`Failed to remove agent from zone: ${result.error}`);
    }
    console.log(`[ProjectClient] Agent ${agentId} removed from zone ${zoneId}`);
  }
}
