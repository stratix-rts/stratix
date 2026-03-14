import { Project, ProjectConfig, ProjectStatus, ProjectChannel, ProjectChannelMessage, MessageSender } from '../../stratix-project/types';
import { projectRepository } from '../../stratix-database/ProjectRepository';
import { generateId } from '../../stratix-project/utils/helpers';

export class ProjectService {
  private initialized: boolean = false;

  public async initialize(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;
    console.log('[ProjectService] Initialized with SQLite');
  }

  private async ensureInitialized(): Promise<void> {
    if (!this.initialized) {
      await this.initialize();
    }
  }

  public async getProjects(): Promise<Project[]> {
    await this.ensureInitialized();
    return projectRepository.getAllProjects();
  }

  public async getProjectsByStatus(status: ProjectStatus): Promise<Project[]> {
    await this.ensureInitialized();
    const all = await projectRepository.getAllProjects();
    return all.filter(p => p.status === status);
  }

  public async getProjectsByPriority(priority: number): Promise<Project[]> {
    await this.ensureInitialized();
    const all = await projectRepository.getAllProjects();
    return all.filter(p => p.priority === priority);
  }

  public async getMetadata(): Promise<{ count: number }> {
    await this.ensureInitialized();
    const projects = await projectRepository.getAllProjects();
    return { count: projects.length };
  }

  public async getProject(id: string): Promise<Project | null> {
    await this.ensureInitialized();
    return projectRepository.getProject(id);
  }

  public async createProject(config: ProjectConfig, zoneConfig?: any): Promise<Project> {
    await this.ensureInitialized();
    
    const now = new Date();
    const project: Project = {
      id: generateId('proj'),
      name: config.name,
      description: config.description || '',
      priority: config.priority || 3,
      status: 'pending' as ProjectStatus,
      config,
      path: config.localFolderPath || '',
      presentAgentIds: [],
      zoneConfig: zoneConfig || { x: 0, y: 0, width: 400, height: 300, color: 15790320, opacity: 0.3, visible: true },
      createdAt: now,
      updatedAt: now
    };

    return projectRepository.createProject(project);
  }

  public async updateProject(id: string, updates: Partial<Project>): Promise<Project> {
    await this.ensureInitialized();
    
    const updated = projectRepository.updateProject(id, updates);
    if (!updated) {
      throw new Error(`Project with id ${id} not found`);
    }
    return updated;
  }

  public async deleteProject(id: string): Promise<boolean> {
    await this.ensureInitialized();
    return projectRepository.deleteProject(id);
  }

  public async startProject(id: string): Promise<Project> {
    await this.ensureInitialized();
    const project = await this.getProject(id);
    if (!project) {
      throw new Error(`Project not found: ${id}`);
    }
    
    return this.updateProject(id, {
      status: 'active',
      startedAt: new Date()
    });
  }

  public async pauseProject(id: string): Promise<Project> {
    await this.ensureInitialized();
    return this.updateProject(id, { status: 'paused' as ProjectStatus });
  }

  public async completeProject(id: string): Promise<Project> {
    await this.ensureInitialized();
    return this.updateProject(id, {
      status: 'completed' as ProjectStatus,
      completedAt: new Date()
    });
  }

  public async failProject(id: string): Promise<Project> {
    await this.ensureInitialized();
    return this.updateProject(id, { status: 'failed' as ProjectStatus });
  }

  public async agentEnterProject(projectId: string, agentId: string): Promise<Project> {
    await this.ensureInitialized();
    const project = await this.getProject(projectId);
    if (!project) {
      throw new Error(`Project not found: ${projectId}`);
    }

    // 始终确保订阅 channel（即使 agent 已经在项目中）
    await this.autoSubscribeChannels(projectId, agentId);

    if (!project.presentAgentIds.includes(agentId)) {
      project.presentAgentIds.push(agentId);
      const updated = await this.updateProject(projectId, {
        presentAgentIds: project.presentAgentIds
      });
      
      console.log(`[ProjectService] Agent ${agentId} entered project ${projectId}`);
      return updated;
    }

    console.log(`[ProjectService] Agent ${agentId} already in project ${projectId}, re-subscribed to channels`);
    return project;
  }

  public async agentLeaveProject(projectId: string, agentId: string): Promise<Project> {
    await this.ensureInitialized();
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

  private async autoSubscribeChannels(projectId: string, agentId: string): Promise<void> {
    await this.ensureProjectChannel(projectId);
    const channels = await this.getChannels(projectId);
    
    for (const channel of channels) {
      if (!channel.subscriberIds.includes(agentId)) {
        channel.subscriberIds.push(agentId);
        await projectRepository.updateChannel(projectId, channel.id, channel.subscriberIds);
        console.log(`[ProjectService] Auto-subscribed agent ${agentId} to channel ${channel.name}`);
      }
    }
  }

  private async autoUnsubscribeChannels(projectId: string, agentId: string): Promise<void> {
    const channels = await this.getChannels(projectId);
    
    for (const channel of channels) {
      if (channel.subscriberIds.includes(agentId)) {
        channel.subscriberIds = channel.subscriberIds.filter(id => id !== agentId);
        await projectRepository.updateChannel(projectId, channel.id, channel.subscriberIds);
        console.log(`[ProjectService] Auto-unsubscribed agent ${agentId} from channel ${channel.name}`);
      }
    }
  }

  public async getChannels(projectId: string): Promise<ProjectChannel[]> {
    await this.ensureInitialized();
    await this.ensureProjectChannel(projectId);
    return projectRepository.getChannels(projectId);
  }

  public async getChannel(projectId: string, channelId: string): Promise<ProjectChannel | null> {
    await this.ensureInitialized();
    return projectRepository.getChannel(projectId, channelId);
  }

  private async ensureProjectChannel(projectId: string): Promise<void> {
    const channels = await projectRepository.getChannels(projectId);
    if (channels.length === 0) {
      const now = Date.now();
      await projectRepository.createChannel({
        id: generateId('ch'),
        projectId,
        name: 'general',
        type: 'general' as any,
        description: 'General discussion channel',
        subscriberIds: [],
        isPrivate: false,
        createdAt: now,
        updatedAt: now
      });
    }
  }

  public async createChannel(projectId: string, name: string, type: string, description?: string): Promise<ProjectChannel> {
    await this.ensureInitialized();
    
    const now = Date.now();
    const channel: ProjectChannel = {
      id: generateId('ch'),
      projectId,
      name,
      type: type as any,
      description: description || '',
      subscriberIds: [],
      isPrivate: false,
      createdAt: now,
      updatedAt: now
    };

    return projectRepository.createChannel(channel);
  }

  public async subscribeChannel(projectId: string, channelId: string, agentId: string): Promise<ProjectChannel> {
    await this.ensureInitialized();
    const channel = await projectRepository.getChannel(projectId, channelId);
    if (!channel) {
      throw new Error(`Channel not found: ${channelId}`);
    }

    if (!channel.subscriberIds.includes(agentId)) {
      channel.subscriberIds.push(agentId);
      await projectRepository.updateChannel(projectId, channelId, channel.subscriberIds);
    }

    return channel;
  }

  public async unsubscribeChannel(projectId: string, channelId: string, agentId: string): Promise<ProjectChannel> {
    await this.ensureInitialized();
    const channel = await projectRepository.getChannel(projectId, channelId);
    if (!channel) {
      throw new Error(`Channel not found: ${channelId}`);
    }

    channel.subscriberIds = channel.subscriberIds.filter(id => id !== agentId);
    await projectRepository.updateChannel(projectId, channelId, channel.subscriberIds);

    return channel;
  }

  public async getMessages(projectId: string, channelId?: string, since?: number): Promise<ProjectChannelMessage[]> {
    await this.ensureInitialized();
    
    let messages = await projectRepository.getMessages(projectId, channelId);
    
    if (since) {
      messages = messages.filter(m => m.timestamp > since);
    }
    
    return messages;
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

    const mentions = options?.mentions || this.extractMentions(content);
    console.log(`[ProjectService] sendMessage extracted mentions:`, mentions, `from content: "${content.slice(0, 50)}..."`);
    
    const now = Date.now();
    const message: ProjectChannelMessage = {
      id: generateId('msg'),
      projectId,
      channelId,
      role: sender.type === 'agent' ? 'assistant' : 'user',
      content: this.processContent(content),
      timestamp: now,
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

    await projectRepository.createMessage(message);

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
    return projectRepository.getMessagesByMention(projectId, agentId);
  }

  private extractMentions(content: string): string[] {
    // 匹配 @名字，支持中英文、数字、下划线、空格等常见字符
    // @ 后面跟着非空格字符，直到遇到空格或字符串结束
    const mentionRegex = /@([^\s@]+)/g;
    const mentions: string[] = [];
    let match;
    while ((match = mentionRegex.exec(content)) !== null) {
      mentions.push(match[1]);
    }
    return mentions;
  }

  private processContent(content: string): string {
    return content;
  }
}
