import axios from 'axios';

import { Project, ProjectConfig, ProjectZoneConfig, ProjectStatus } from './types';

export interface ProjectClientConfig {
  baseURL?: string;
}

export class ProjectClient {
  private baseURL: string;
  
  constructor(config?: ProjectClientConfig) {
    this.baseURL = config?.baseURL || 'http://localhost:7524/api/projects';
  }
  
  async initialize(): Promise<void> {
    try {
      await axios.post(`${this.baseURL}/initialize`);
      console.log('[ProjectClient] Project service initialized');
    } catch (error) {
      console.error('[ProjectClient] Failed to initialize:', error);
      throw new Error(`Failed to initialize project service: ${error}`);
    }
  }
  
  async getAllProjects(): Promise<Project[]> {
    try {
      const { data } = await axios.get(this.baseURL);
      return data.projects || [];
    } catch (error) {
      console.error('[ProjectClient] Failed to get projects:', error);
      return [];
    }
  }
  
  async getProjectsByStatus(status: ProjectStatus): Promise<Project[]> {
    try {
      const { data } = await axios.get(this.baseURL, {
        params: { status }
      });
      return data.projects || [];
    } catch (error) {
      console.error('[ProjectClient] Failed to get projects by status:', error);
      return [];
    }
  }
  
  async getProjectsByPriority(priority: number): Promise<Project[]> {
    try {
      const { data } = await axios.get(this.baseURL, {
        params: { priority }
      });
      return data.projects || [];
    } catch (error) {
      console.error('[ProjectClient] Failed to get projects by priority:', error);
      return [];
    }
  }
  
  async createProject(
    config: ProjectConfig, 
    zoneConfig?: Partial<ProjectZoneConfig>
  ): Promise<Project> {
    try {
      const { data } = await axios.post(this.baseURL, {
        config,
        zoneConfig
      });
      
      const project = data.project;
      console.log(`[ProjectClient] Project created: ${project.id}`);
      return project;
    } catch (error) {
      throw new Error(`Failed to create project: ${error}`);
    }
  }
  
  async getProject(id: string): Promise<Project | null> {
    try {
      const { data } = await axios.get(`${this.baseURL}/${id}`);
      return data.project;
    } catch (error) {
      console.error(`[ProjectClient] Failed to get project ${id}:`, error);
      return null;
    }
  }
  
  async updateProject(id: string, updates: Partial<Project>): Promise<Project> {
    try {
      const { data } = await axios.put(`${this.baseURL}/${id}`, { updates });
      const project = data.project;
      console.log(`[ProjectClient] Project updated: ${id}`);
      return project;
    } catch (error) {
      throw new Error(`Failed to update project ${id}: ${error}`);
    }
  }

  async updateZoneConfig(id: string, zoneConfig: Partial<ProjectZoneConfig>): Promise<Project> {
    return this.updateProject(id, { zoneConfig } as Partial<Project>);
  }

  async updateZoneContextId(zoneId: string, zoneContextId: string): Promise<void> {
    try {
      // Direct database update to set zone_context_id FK
      await axios.patch(`${this.baseURL}/${zoneId}/zone-context-link`, {
        zoneContextId
      });
      console.log(`[ProjectClient] Zone context FK updated: ${zoneId} -> ${zoneContextId}`);
    } catch (error) {
      console.error(`[ProjectClient] Failed to update zone context FK for ${zoneId}:`, error);
      throw error;
    }
  }
  
  async deleteProject(id: string): Promise<boolean> {
    try {
      await axios.delete(`${this.baseURL}/${id}`);
      console.log(`[ProjectClient] Project deleted: ${id}`);
      return true;
    } catch (error) {
      console.error(`[ProjectClient] Failed to delete project ${id}:`, error);
      return false;
    }
  }
  
  async startProject(id: string): Promise<Project> {
    try {
      const { data } = await axios.post(`${this.baseURL}/${id}/start`);
      const project = data.project;
      console.log(`[ProjectClient] Project started: ${id}`);
      return project;
    } catch (error) {
      throw new Error(`Failed to start project ${id}: ${error}`);
    }
  }
  
  async pauseProject(id: string): Promise<Project> {
    try {
      const { data } = await axios.post(`${this.baseURL}/${id}/pause`);
      const project = data.project;
      console.log(`[ProjectClient] Project paused: ${id}`);
      return project;
    } catch (error) {
      throw new Error(`Failed to pause project ${id}: ${error}`);
    }
  }
  
  async completeProject(id: string): Promise<Project> {
    try {
      const { data } = await axios.post(`${this.baseURL}/${id}/complete`);
      const project = data.project;
      console.log(`[ProjectClient] Project completed: ${id}`);
      return project;
    } catch (error) {
      throw new Error(`Failed to complete project ${id}: ${error}`);
    }
  }
  
  async failProject(id: string): Promise<Project> {
    try {
      const { data } = await axios.post(`${this.baseURL}/${id}/fail`);
      const project = data.project;
      console.log(`[ProjectClient] Project marked as failed: ${id}`);
      return project;
    } catch (error) {
      throw new Error(`Failed to mark project ${id} as failed: ${error}`);
    }
  }
  
  async agentEnterProject(projectId: string, agentId: string): Promise<Project> {
    try {
      const { data } = await axios.post(`${this.baseURL}/${projectId}/agents/enter`, {
        agentId
      });
      const project = data.project;
      console.log(`[ProjectClient] Agent ${agentId} entered project ${projectId}`);
      return project;
    } catch (error) {
      throw new Error(`Failed to add agent to project ${projectId}: ${error}`);
    }
  }
  
  async agentLeaveProject(projectId: string, agentId: string): Promise<Project> {
    try {
      const { data } = await axios.post(`${this.baseURL}/${projectId}/agents/leave`, {
        agentId
      });
      const project = data.project;
      console.log(`[ProjectClient] Agent ${agentId} left project ${projectId}`);
      return project;
    } catch (error) {
      throw new Error(`Failed to remove agent from project ${projectId}: ${error}`);
    }
  }
  
  async getMetadata(): Promise<{ createdAt: number; updatedAt: number; version: string }> {
    try {
      const { data } = await axios.get(`${this.baseURL}/metadata/info`);
      return data.metadata;
    } catch (error) {
      throw new Error(`Failed to get metadata: ${error}`);
    }
  }

  // Zone member management
  async addZoneMember(zoneId: string, agentId: string): Promise<void> {
    try {
      await axios.post(`/api/zones/${zoneId}/members/${agentId}`);
      console.log(`[ProjectClient] Agent ${agentId} added to zone ${zoneId}`);
    } catch (error) {
      console.error(`[ProjectClient] Failed to add agent ${agentId} to zone ${zoneId}:`, error);
      throw error;
    }
  }

  async removeZoneMember(zoneId: string, agentId: string): Promise<void> {
    try {
      await axios.delete(`/api/zones/${zoneId}/members/${agentId}`);
      console.log(`[ProjectClient] Agent ${agentId} removed from zone ${zoneId}`);
    } catch (error) {
      console.error(`[ProjectClient] Failed to remove agent ${agentId} from zone ${zoneId}:`, error);
      throw error;
    }
  }
}
