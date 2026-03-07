import { Project, ProjectConfig, ProjectStatus } from '../types';
import { ProjectStore } from '../storage/ProjectStore';
import { generateId } from '../utils/helpers';
import { ParsedTask } from '../../stratix-ai-service/types';
import { LRAClient } from '../../stratix-lra-bridge';
import mitt from 'mitt';

type EventBus = ReturnType<typeof mitt>;

export class ProjectManager {
  private store: ProjectStore;
  private eventBus: EventBus;
  private lraClient: LRAClient;

  constructor(store: ProjectStore, eventBus?: EventBus) {
    this.store = store;
    this.eventBus = eventBus || mitt();
    this.lraClient = new LRAClient();
  }

  public getEventBus(): EventBus {
    return this.eventBus;
  }

  public async createProject(config: ProjectConfig, zoneConfig?: Partial<Project['zoneConfig']>): Promise<Project> {
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

    await this.store.addProject(project);
    this.eventBus.emit('project:created', { project });

    await this.initializeLRA(project.path, project.name);

    return project;
  }

  public async getProject(id: string): Promise<Project | null> {
    return await this.store.getProject(id);
  }

  public async updateProject(id: string, updates: Partial<Project>): Promise<Project> {
    const project = await this.getProject(id);
    if (!project) {
      throw new Error(`Project not found: ${id}`);
    }

    const oldStatus = project.status;
    
    const updatedProject: Project = {
      ...project,
      ...updates,
      id: project.id,
      createdAt: project.createdAt,
      updatedAt: new Date()
    };

    await this.store.updateProject(updatedProject);
    
    this.eventBus.emit('project:updated', {
      project: updatedProject,
      changes: updates
    });

    if (updates.status && updates.status !== oldStatus) {
      this.eventBus.emit('project:status-changed', {
        project: updatedProject,
        oldStatus,
        newStatus: updates.status
      });
    }

    return updatedProject;
  }

  public async deleteProject(id: string): Promise<void> {
    const project = await this.getProject(id);
    if (!project) {
      throw new Error(`Project not found: ${id}`);
    }

    await this.store.deleteProject(id);
    this.eventBus.emit('project:deleted', { projectId: id });
  }

  public async getAllProjects(): Promise<Project[]> {
    return await this.store.getAllProjects();
  }

  public async getProjectsByStatus(status: ProjectStatus): Promise<Project[]> {
    return await this.store.getProjectsByStatus(status);
  }

  public async getProjectsByPriority(priority: number): Promise<Project[]> {
    return await this.store.getProjectsByPriority(priority);
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

  public async updateProjectZoneConfig(id: string, zoneConfig: Partial<Project['zoneConfig']>): Promise<Project> {
    const project = await this.getProject(id);
    if (!project) {
      throw new Error(`Project not found: ${id}`);
    }

    return await this.updateProject(id, {
      zoneConfig: {
        ...project.zoneConfig,
        ...zoneConfig
      }
    });
  }

  public async getProjectCount(): Promise<number> {
    return await this.store.getProjectCount();
  }

  public async getActiveProjectCount(): Promise<number> {
    const activeProjects = await this.getProjectsByStatus('active');
    return activeProjects.length;
  }

  public async getCompletedProjectCount(): Promise<number> {
    const completedProjects = await this.getProjectsByStatus('completed');
    return completedProjects.length;
  }

  private async initializeLRA(projectPath: string, projectName: string): Promise<void> {
    try {
      await this.lraClient.init(projectPath, projectName);
      console.log(`[ProjectManager] LRA initialized for project: ${projectName}`);
    } catch (error) {
      console.error('[ProjectManager] Failed to initialize LRA:', error);
    }
  }

  public async createTasksFromAI(
    projectId: string, 
    tasks: ParsedTask[]
  ): Promise<void> {
    const project = await this.getProject(projectId);
    if (!project) {
      throw new Error(`Project not found: ${projectId}`);
    }

    for (const task of tasks) {
      await this.lraClient.createTask(
        project.path,
        `${task.name}: ${task.description}`,
        task.type
      );
    }

    console.log(`[ProjectManager] Created ${tasks.length} tasks from AI for project ${projectId}`);
  }

  public async createTaskManually(
    projectId: string,
    description: string,
    template?: string
  ): Promise<string> {
    const project = await this.getProject(projectId);
    if (!project) {
      throw new Error(`Project not found: ${projectId}`);
    }

    const taskId = await this.lraClient.createTask(
      project.path,
      description,
      template
    );

    console.log(`[ProjectManager] Created task ${taskId} for project ${projectId}`);
    return taskId;
  }

  public async agentEnterProject(
    projectId: string,
    agentId: string
  ): Promise<void> {
    const project = await this.getProject(projectId);
    if (!project) {
      throw new Error(`Project not found: ${projectId}`);
    }

    if (!project.presentAgentIds.includes(agentId)) {
      project.presentAgentIds.push(agentId);
      await this.updateProject(projectId, {
        presentAgentIds: project.presentAgentIds
      });

      this.eventBus.emit('project:agent-entered', { projectId, agentId });
      console.log(`[ProjectManager] Agent ${agentId} entered project ${projectId}`);
    }
  }

  public async agentLeaveProject(
    projectId: string,
    agentId: string
  ): Promise<void> {
    const project = await this.getProject(projectId);
    if (!project) {
      throw new Error(`Project not found: ${projectId}`);
    }

    project.presentAgentIds = project.presentAgentIds.filter(id => id !== agentId);
    
    await this.updateProject(projectId, {
      presentAgentIds: project.presentAgentIds
    });

    this.eventBus.emit('project:agent-left', { projectId, agentId });
    console.log(`[ProjectManager] Agent ${agentId} left project ${projectId}`);
  }
}
