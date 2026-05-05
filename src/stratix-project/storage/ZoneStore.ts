import path from 'path';

import * as fs from 'fs-extra';
import { Low } from 'lowdb';
import { JSONFile } from 'lowdb/node';

import { Project, ProjectChannel, ProjectChannelMessage } from '../types';

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

export class ZoneStore {
  private db: Low<ProjectDatabase>;
  private dbPath: string;
  private initialized: boolean = false;
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(dataDir: string = 'stratix-data') {
    this.dbPath = path.join(dataDir, 'projects.json');
    this.db = new Low<ProjectDatabase>(new JSONFile(this.dbPath), DEFAULT_DB);
  }

  /**
   * Serialize database writes to prevent concurrent write conflicts
   */
  private async enqueueWrite<T>(operation: () => Promise<T>): Promise<void> {
    this.writeQueue = this.writeQueue.then(async () => {
      await operation();
    });
    return this.writeQueue;
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
    return this.enqueueWrite(async () => {
      this.db.data.metadata.updatedAt = Date.now();
      await this.db.write();
    });
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

  public async getZone(id: string): Promise<Project | null> {
    await this.ensureInitialized();
    await this.refresh();
    
    const project = this.db.data.projects.find(p => p.id === id);
    return project ? JSON.parse(JSON.stringify(project)) : null;
  }

  public async updateZone(project: Project): Promise<void> {
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

  public async deleteZone(id: string): Promise<boolean> {
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

  public async getAllZones(): Promise<Project[]> {
    await this.ensureInitialized();
    await this.refresh();
    return JSON.parse(JSON.stringify(this.db.data.projects));
  }

  public async getZonesByStatus(status: string): Promise<Project[]> {
    await this.ensureInitialized();
    await this.refresh();
    return this.db.data.projects.filter(p => p.status === status);
  }

  public async getZonesByPriority(priority: number): Promise<Project[]> {
    await this.ensureInitialized();
    await this.refresh();
    return this.db.data.projects.filter(p => p.priority === priority);
  }

  public async getZoneCount(): Promise<number> {
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
    let data: ProjectDatabase;
    try {
      data = JSON.parse(jsonData) as ProjectDatabase;
    } catch (error) {
      throw new Error(`Invalid JSON data: ${error instanceof Error ? error.message : String(error)}`);
    }
    this.db.data = data;
    await this.persist();
  }

  // ============================================
  // Channel 存储方法
  // ============================================

  public async getChannels(zoneId: string): Promise<ProjectChannel[]> {
    await this.ensureInitialized();
    await this.refresh();
    return this.db.data.channels[zoneId] || [];
  }

  public async getChannel(zoneId: string, channelId: string): Promise<ProjectChannel | null> {
    await this.ensureInitialized();
    await this.refresh();
    const channels = this.db.data.channels[zoneId] || [];
    return channels.find(c => c.id === channelId) || null;
  }

  public async addChannel(channel: ProjectChannel): Promise<void> {
    await this.ensureInitialized();
    await this.refresh();

    if (!this.db.data.channels[channel.zoneId]) {
      this.db.data.channels[channel.zoneId] = [];
    }

    const existingIndex = this.db.data.channels[channel.zoneId].findIndex(c => c.id === channel.id);
    if (existingIndex >= 0) {
      throw new Error(`Channel with id ${channel.id} already exists`);
    }

    this.db.data.channels[channel.zoneId].push(channel);
    await this.persist();
  }

  public async updateChannel(channel: ProjectChannel): Promise<void> {
    await this.ensureInitialized();
    await this.refresh();

    const channels = this.db.data.channels[channel.zoneId];
    if (!channels) {
      throw new Error(`Project ${channel.zoneId} has no channels`);
    }

    const index = channels.findIndex(c => c.id === channel.id);
    if (index === -1) {
      throw new Error(`Channel ${channel.id} not found`);
    }

    channels[index] = { ...channel, updatedAt: Date.now() };
    await this.persist();
  }

  public async deleteChannel(zoneId: string, channelId: string): Promise<boolean> {
    await this.ensureInitialized();
    await this.refresh();

    const channels = this.db.data.channels[zoneId];
    if (!channels) return false;

    const initialLength = channels.length;
    this.db.data.channels[zoneId] = channels.filter(c => c.id !== channelId);

    if (this.db.data.channels[zoneId].length < initialLength) {
      await this.persist();
      return true;
    }
    return false;
  }

  public async subscribeToChannel(zoneId: string, channelId: string, agentId: string): Promise<void> {
    await this.ensureInitialized();
    await this.refresh();

    const channels = this.db.data.channels[zoneId];
    if (!channels) {
      throw new Error(`Project ${zoneId} has no channels`);
    }

    const channel = channels.find(c => c.id === channelId);
    if (!channel) {
      throw new Error(`Channel ${channelId} not found`);
    }

    if (!channel.subscriberIds.includes(agentId)) {
      channel.subscriberIds.push(agentId);
      channel.updatedAt = Date.now();
      await this.persist();
    }
  }

  public async unsubscribeFromChannel(zoneId: string, channelId: string, agentId: string): Promise<void> {
    await this.ensureInitialized();
    await this.refresh();

    const channels = this.db.data.channels[zoneId];
    if (!channels) return;

    const channel = channels.find(c => c.id === channelId);
    if (!channel) return;

    channel.subscriberIds = channel.subscriberIds.filter(id => id !== agentId);
    channel.updatedAt = Date.now();
    await this.persist();
  }

  // ============================================
  // Message 存储方法
  // ============================================

  public async getMessages(zoneId: string, channelId?: string, since?: number): Promise<ProjectChannelMessage[]> {
    await this.ensureInitialized();
    await this.refresh();

    const messages = this.db.data.messages[zoneId] || [];
    let filtered = channelId ? messages.filter(m => m.channelId === channelId) : messages;

    if (since) {
      filtered = filtered.filter(m => m.timestamp > since);
    }

    return filtered.sort((a, b) => a.timestamp - b.timestamp);
  }

  public async addMessage(message: ProjectChannelMessage): Promise<void> {
    await this.ensureInitialized();
    await this.refresh();

    if (!this.db.data.messages[message.zoneId]) {
      this.db.data.messages[message.zoneId] = [];
    }

    this.db.data.messages[message.zoneId].push(message);
    await this.persist();

    console.log('[ZoneStore] Message added:', JSON.stringify({
      id: message.id,
      zoneId: message.zoneId,
      channelId: message.channelId,
      sender: message.sender.name,
      contentLength: message.content.length,
      mentions: message.mentions,
      timestamp: message.timestamp
    }));
  }

  public async getMessagesByMention(zoneId: string, agentId: string): Promise<ProjectChannelMessage[]> {
    await this.ensureInitialized();
    await this.refresh();

    const messages = this.db.data.messages[zoneId] || [];
    return JSON.parse(JSON.stringify(messages.filter(m => m.mentions.includes(agentId))));
  }

  public async getLastMessageTime(zoneId: string): Promise<number> {
    await this.ensureInitialized();
    await this.refresh();

    const messages = this.db.data.messages[zoneId] || [];
    if (messages.length === 0) return 0;

    return Math.max(...messages.map(m => m.timestamp));
  }

  public async deleteProjectMessages(zoneId: string): Promise<void> {
    await this.ensureInitialized();
    await this.refresh();

    delete this.db.data.messages[zoneId];
    delete this.db.data.channels[zoneId];
    await this.persist();
  }
}
