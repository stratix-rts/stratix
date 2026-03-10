import { Low } from 'lowdb';
import { JSONFile } from 'lowdb/node';
import { Project, ProjectConfig, ProjectStatus, ProjectChannel, ProjectChannelMessage, MessageSender } from '../../stratix-project/types';
import fs from 'fs-extra';
import path from 'path';
import { generateId } from '../../stratix-project/utils/helpers';

export interface ProjectDatabase {
  projects: Project[];
  channels: Record<string, ProjectChannel[]>;
  messages: Record<string, ProjectChannelMessage[]>;
  metadata: {
    createdAt: number;
    updatedAt: number;
    version: string;
  };
}

const DEFAULT_DB: ProjectDatabase = {
  projects: [],
  channels: {},
  messages: {},
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
    
    if (!this.db.data.channels) {
      this.db.data.channels = {};
    }
    if (!this.db.data.messages) {
      this.db.data.messages = {};
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
    
    if (!this.db.data) {
      this.db.data = JSON.parse(JSON.stringify(DEFAULT_DB));
    }
    if (!this.db.data.channels) {
      this.db.data.channels = {};
    }
    if (!this.db.data.messages) {
      this.db.data.messages = {};
    }
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

  // ============================================
  // Agent Zone 进入/离开 - 自动 Channel 订阅
  // ============================================

  private async ensureProjectChannel(projectId: string): Promise<void> {
    const channels = this.db.data.channels[projectId] || [];
    if (channels.length === 0) {
      const defaultChannel: ProjectChannel = {
        id: generateId('ch'),
        projectId,
        name: 'general',
        type: 'general',
        description: 'General discussion',
        subscriberIds: [],
        isPrivate: false,
        createdAt: Date.now(),
        updatedAt: Date.now()
      };
      this.db.data.channels[projectId] = [defaultChannel];
      await this.persist();
      console.log(`[ProjectService] Created default channel for project ${projectId}`);
    }
  }

  private async autoSubscribeChannels(projectId: string, agentId: string): Promise<void> {
    await this.ensureProjectChannel(projectId);
    const channels = this.db.data.channels[projectId] || [];
    
    for (const channel of channels) {
      if (!channel.subscriberIds.includes(agentId)) {
        channel.subscriberIds.push(agentId);
        console.log(`[ProjectService] Auto-subscribed agent ${agentId} to channel ${channel.name}`);
      }
    }
    
    await this.persist();
  }

  private async autoUnsubscribeChannels(projectId: string, agentId: string): Promise<void> {
    const channels = this.db.data.channels[projectId] || [];
    
    for (const channel of channels) {
      if (channel.subscriberIds.includes(agentId)) {
        channel.subscriberIds = channel.subscriberIds.filter(id => id !== agentId);
        console.log(`[ProjectService] Auto-unsubscribed agent ${agentId} from channel ${channel.name}`);
      }
    }
    
    await this.persist();
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
      
      await this.autoSubscribeChannels(projectId, agentId);
      
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

    await this.autoUnsubscribeChannels(projectId, agentId);

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

  // ============================================
  // Channel 管理方法
  // ============================================

  public async getChannels(projectId: string): Promise<ProjectChannel[]> {
    await this.ensureInitialized();
    await this.refresh();
    return this.db.data.channels[projectId] || [];
  }

  public async getChannel(projectId: string, channelId: string): Promise<ProjectChannel | null> {
    await this.ensureInitialized();
    await this.refresh();
    const channels = this.db.data.channels[projectId] || [];
    return channels.find(c => c.id === channelId) || null;
  }

  public async createChannel(projectId: string, name: string, type: ProjectChannel['type'], description?: string): Promise<ProjectChannel> {
    await this.ensureInitialized();
    await this.refresh();

    if (!this.db.data.channels[projectId]) {
      this.db.data.channels[projectId] = [];
    }

    const channel: ProjectChannel = {
      id: generateId('ch'),
      projectId,
      name,
      type,
      description,
      subscriberIds: [],
      isPrivate: type === 'agent_dm',
      createdAt: Date.now(),
      updatedAt: Date.now()
    };

    this.db.data.channels[projectId].push(channel);
    await this.persist();

    console.log('[ProjectService] Channel created:', JSON.stringify({
      id: channel.id,
      projectId,
      name,
      type
    }));

    return channel;
  }

  public async subscribeChannel(projectId: string, channelId: string, agentId: string): Promise<ProjectChannel> {
    await this.ensureInitialized();
    await this.refresh();

    const channels = this.db.data.channels[projectId];
    if (!channels) {
      throw new Error(`Project ${projectId} has no channels`);
    }

    const channel = channels.find(c => c.id === channelId);
    if (!channel) {
      throw new Error(`Channel ${channelId} not found`);
    }

    if (!channel.subscriberIds.includes(agentId)) {
      channel.subscriberIds.push(agentId);
      channel.updatedAt = Date.now();
      await this.persist();

      console.log('[ProjectService] Subscribed to channel:', {
        channelId,
        agentId,
        subscriberIds: channel.subscriberIds
      });
    }

    return channel;
  }

  public async unsubscribeChannel(projectId: string, channelId: string, agentId: string): Promise<ProjectChannel> {
    await this.ensureInitialized();
    await this.refresh();

    const channels = this.db.data.channels[projectId];
    if (!channels) {
      throw new Error(`Project ${projectId} has no channels`);
    }

    const channel = channels.find(c => c.id === channelId);
    if (!channel) {
      throw new Error(`Channel ${channelId} not found`);
    }

    channel.subscriberIds = channel.subscriberIds.filter(id => id !== agentId);
    channel.updatedAt = Date.now();
    await this.persist();

    console.log('[ProjectService] Unsubscribed from channel:', {
      channelId,
      agentId,
      subscriberIds: channel.subscriberIds
    });

    return channel;
  }

  // ============================================
  // Message 管理方法
  // ============================================

  public async getMessages(projectId: string, channelId?: string, since?: number): Promise<ProjectChannelMessage[]> {
    await this.ensureInitialized();
    await this.refresh();

    const messages = this.db.data.messages[projectId] || [];
    let filtered = channelId ? messages.filter(m => m.channelId === channelId) : messages;

    if (since) {
      filtered = filtered.filter(m => m.timestamp > since);
    }

    return filtered.sort((a, b) => a.timestamp - b.timestamp);
  }

  public async sendMessage(
    projectId: string,
    channelId: string,
    sender: MessageSender,
    content: string,
    options?: {
      rawContent?: string;
      mentions?: string[];
      messageType?: ProjectChannelMessage['messageType'];
      taskId?: string;
      sessionKey?: string;
      runId?: string;
      source?: 'openclaw' | 'local' | 'user';
    }
  ): Promise<ProjectChannelMessage> {
    await this.ensureInitialized();
    await this.refresh();

    if (!this.db.data.messages[projectId]) {
      this.db.data.messages[projectId] = [];
    }

    const mentions = options?.mentions || this.extractMentions(content);
    const message: ProjectChannelMessage = {
      id: generateId('msg'),
      projectId,
      channelId,
      role: sender.type === 'agent' ? 'assistant' : 'user',
      content: this.processContent(content),
      timestamp: Date.now(),
      sender,
      mentions,
      rawContent: options?.rawContent || content,
      messageType: options?.messageType || 'chat',
      taskId: options?.taskId,
      sessionKey: options?.sessionKey,
      runId: options?.runId,
      metadata: {
        source: options?.source || 'local',
        createdAt: new Date().toISOString()
      }
    };

    this.db.data.messages[projectId].push(message);
    await this.persist();

    console.log('[ProjectService] Message sent:', JSON.stringify({
      id: message.id,
      projectId,
      channelId,
      sender: sender.name,
      content: content.slice(0, 50),
      mentions,
      timestamp: message.timestamp
    }));

    return message;
  }

  public async getMessagesByMention(projectId: string, agentId: string): Promise<ProjectChannelMessage[]> {
    await this.ensureInitialized();
    await this.refresh();

    const messages = this.db.data.messages[projectId] || [];
    return messages.filter(m => m.mentions.includes(agentId));
  }

  public async getLastMessageTime(projectId: string): Promise<number> {
    await this.ensureInitialized();
    await this.refresh();

    const messages = this.db.data.messages[projectId] || [];
    if (messages.length === 0) return 0;

    return Math.max(...messages.map(m => m.timestamp));
  }

  // ============================================
  // 私有辅助方法
  // ============================================

  private extractMentions(content: string): string[] {
    const mentionRegex = /@(\w+)/g;
    const mentions: string[] = [];
    let match;

    while ((match = mentionRegex.exec(content)) !== null) {
      mentions.push(match[1]);
    }

    return mentions;
  }

  private processContent(content: string): string {
    return content.replace(/@(\w+)/g, '$1');
  }
}
