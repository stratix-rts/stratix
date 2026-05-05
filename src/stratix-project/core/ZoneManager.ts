import mitt from 'mitt';

import { ParsedTask } from '../../stratix-ai-service/types';
import { LRAClient } from '../../stratix-lra-bridge';
import { ZoneStore } from '../storage/ZoneStore';
import { Project, ProjectConfig, ZoneStatus, ZoneConfig } from '../types';
import { generateId } from '../utils/helpers';


type EventBus = ReturnType<typeof mitt>;

export class ZoneManager {
  private store: ZoneStore;
  private eventBus: EventBus;
  private lraClient: LRAClient;

  constructor(store: ZoneStore, eventBus?: EventBus) {
    this.store = store;
    this.eventBus = eventBus || mitt();
    this.lraClient = new LRAClient();
  }

  public getEventBus(): EventBus {
    return this.eventBus;
  }

  public async createZone(config: ProjectConfig, zoneConfig?: Partial<Project['zoneConfig']>): Promise<Project> {
    const zoneId = generateId('proj');
    
    const project: Project = {
      id: zoneId,
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

    await this.initializeLRA(project.path ?? "", project.name ?? "");

    return project;
  }

  public async getZone(id: string): Promise<Project | null> {
    return await this.store.getZone(id);
  }

  public async updateZone(id: string, updates: Partial<Project>): Promise<Project> {
    const project = await this.getZone(id);
    if (!project) {
      throw new Error(`Zone not found: ${id}`);
    }

    const oldStatus = project.status;
    
    const updatedProject: Project = {
      ...project,
      ...updates,
      id: project.id,
      createdAt: project.createdAt,
      updatedAt: new Date()
    };

    await this.store.updateZone(updatedProject);
    
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

  public async deleteZone(id: string): Promise<void> {
    const project = await this.getZone(id);
    if (!project) {
      throw new Error(`Zone not found: ${id}`);
    }

    await this.store.deleteZone(id);
    this.eventBus.emit('zone:deleted', { zoneId: id });
  }

  public async getAllZones(): Promise<Project[]> {
    return await this.store.getAllZones();
  }

  public async getZonesByStatus(status: ZoneStatus): Promise<Project[]> {
    return await this.store.getZonesByStatus(status);
  }

  public async getZonesByPriority(priority: number): Promise<Project[]> {
    return await this.store.getZonesByPriority(priority);
  }

  public async startProject(id: string): Promise<Project> {
    return await this.updateZone(id, {
      status: 'active',
      startedAt: new Date()
    });
  }

  public async pauseProject(id: string): Promise<Project> {
    return await this.updateZone(id, {
      status: 'paused'
    });
  }

  public async completeProject(id: string): Promise<Project> {
    return await this.updateZone(id, {
      status: 'completed',
      completedAt: new Date()
    });
  }

  public async failProject(id: string): Promise<Project> {
    return await this.updateZone(id, {
      status: 'failed'
    });
  }

  public async updateZoneConfig(id: string, zoneConfig: Partial<Project['zoneConfig']>): Promise<Project> {
    const project = await this.getZone(id);
    if (!project) {
      throw new Error(`Zone not found: ${id}`);
    }

    return await this.updateZone(id, {
      zoneConfig: {
        ...(project.zoneConfig ?? {} as any),
        ...zoneConfig
      } as ZoneConfig
    });
  }

  public async getZoneCount(): Promise<number> {
    return await this.store.getZoneCount();
  }

  public async getActiveProjectCount(): Promise<number> {
    const activeProjects = await this.getZonesByStatus('active');
    return activeProjects.length;
  }

  public async getCompletedProjectCount(): Promise<number> {
    const completedProjects = await this.getZonesByStatus('completed');
    return completedProjects.length;
  }

  private async initializeLRA(projectPath: string, projectName: string): Promise<void> {
    try {
      await this.lraClient.init(projectPath, projectName);
      console.log(`[ZoneManager] LRA initialized for project: ${projectName}`);
    } catch (error) {
      console.error('[ZoneManager] Failed to initialize LRA:', error instanceof Error ? error.message : String(error));
    }
  }

  public async createTasksFromAI(
    zoneId: string, 
    tasks: ParsedTask[]
  ): Promise<void> {
    const project = await this.getZone(zoneId);
    if (!project) {
      throw new Error(`Zone not found: ${zoneId ?? ""}`);
    }

    for (const task of tasks) {
      await this.lraClient.createTask(
        project.path ?? "",
        `${task.name}: ${task.description}`,
        task.type
      );
    }

    console.log(`[ZoneManager] Created  tasks from AI for zone ${zoneId}`);
  }

  public async createTaskManually(
    zoneId: string,
    description: string,
    template?: string
  ): Promise<string> {
    const project = await this.getZone(zoneId);
    if (!project) {
      throw new Error(`Zone not found: ${zoneId ?? ""}`);
    }

    const taskId = await this.lraClient.createTask(
      project.path ?? "",
      description,
      template
    );

    console.log(`[ZoneManager] Created task  for zone ${zoneId}`);
    return taskId;
  }

  public async agentEnterProject(
    zoneId: string,
    agentId: string
  ): Promise<void> {
    const project = await this.getZone(zoneId);
    if (!project) {
      throw new Error(`Zone not found: ${zoneId ?? ""}`);
    }

    if (!project.presentAgentIds?.includes(agentId)) {
      project.presentAgentIds = project.presentAgentIds ?? [];
      project.presentAgentIds.push(agentId);
      await this.updateZone(zoneId, {
        presentAgentIds: project.presentAgentIds
      });

      this.eventBus.emit('zone:agent-entered', { zoneId, agentId });
      console.log(`[ZoneManager] Agent  entered zone ${zoneId}`);
    }
  }

  public async agentLeaveProject(
    zoneId: string,
    agentId: string
  ): Promise<void> {
    const project = await this.getZone(zoneId);
    if (!project) {
      throw new Error(`Zone not found: ${zoneId ?? ""}`);
    }

    if (!project.presentAgentIds?.includes(agentId)) {
      project.presentAgentIds = project.presentAgentIds ?? [];
      return;
    }

    project.presentAgentIds = project.presentAgentIds?.filter(id => id !== agentId);
    
    await this.updateZone(zoneId, {
      presentAgentIds: project.presentAgentIds
    });

    this.eventBus.emit('zone:agent-left', { zoneId, agentId });
    console.log(`[ZoneManager] Agent  left zone ${zoneId}`);
  }
}
