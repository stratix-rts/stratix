import { Project, ProjectChannel, ProjectChannelMessage, MessageSender, ProjectConfig, ProjectZoneConfig, ProjectStatus, ProjectChannelType, MessageRole, ProjectMessageType } from '../stratix-project/types';

import { getDatabase } from './StratixDatabase';

interface ProjectRow {
  project_id: string;
  name: string;
  description: string;
  priority: number;
  status: string;
  config: string;
  path: string;
  present_agent_ids: string;
  zone_config: string;
  created_at: number;
  updated_at: number;
  started_at: number | null;
  completed_at: number | null;
}

interface ChannelRow {
  channel_id: string;
  project_id: string;
  name: string;
  type: string;
  description: string;
  subscriber_ids: string;
  created_at: number;
  updated_at: number;
}

interface MessageRow {
  message_id: string;
  project_id: string;
  channel_id: string;
  role: string;
  content: string;
  sender: string;
  mentions: string;
  raw_content: string;
  message_type: string;
  task_id: string;
  session_key: string;
  run_id: string;
  metadata: string;
  timestamp: number;
}

export class ProjectRepository {
  private get db() {
    return getDatabase().getDatabase();
  }

  getAllProjects(): Project[] {
    const rows = this.db.prepare('SELECT * FROM projects ORDER BY created_at DESC').all() as ProjectRow[];
    return rows.map(this.mapRowToProject);
  }

  getProject(projectId: string): Project | null {
    const row = this.db.prepare('SELECT * FROM projects WHERE project_id = ?').get(projectId) as ProjectRow | undefined;
    return row ? this.mapRowToProject(row) : null;
  }

  createProject(project: Project): Project {
    const stmt = this.db.prepare(`
      INSERT INTO projects (project_id, name, description, priority, status, config, path, present_agent_ids, zone_config, created_at, updated_at, started_at, completed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    
    const createdAt = project.createdAt instanceof Date ? project.createdAt.getTime() : project.createdAt;
    const updatedAt = project.updatedAt instanceof Date ? project.updatedAt.getTime() : project.updatedAt;
    const startedAt = project.startedAt ? (project.startedAt instanceof Date ? project.startedAt.getTime() : project.startedAt) : null;
    const completedAt = project.completedAt ? (project.completedAt instanceof Date ? project.completedAt.getTime() : project.completedAt) : null;
    
    stmt.run(
      project.id,
      project.name,
      project.description,
      project.priority,
      project.status,
      JSON.stringify(project.config),
      project.path,
      JSON.stringify(project.presentAgentIds),
      JSON.stringify(project.zoneConfig),
      createdAt,
      updatedAt,
      startedAt,
      completedAt
    );
    
    return project;
  }

  updateProject(projectId: string, updates: Partial<Project>): Project | null {
    const existing = this.getProject(projectId);
    if (!existing) return null;

    const updated: Project = { ...existing, ...updates, id: projectId, updatedAt: new Date() };
    
    const stmt = this.db.prepare(`
      UPDATE projects SET 
        name = ?, description = ?, priority = ?, status = ?, config = ?, path = ?, 
        present_agent_ids = ?, zone_config = ?, updated_at = ?, started_at = ?, completed_at = ?
      WHERE project_id = ?
    `);
    
    const updatedAt = updated.updatedAt instanceof Date ? updated.updatedAt.getTime() : updated.updatedAt;
    const startedAt = updated.startedAt ? (updated.startedAt instanceof Date ? updated.startedAt.getTime() : updated.startedAt) : null;
    const completedAt = updated.completedAt ? (updated.completedAt instanceof Date ? updated.completedAt.getTime() : updated.completedAt) : null;
    
    stmt.run(
      updated.name,
      updated.description,
      updated.priority,
      updated.status,
      JSON.stringify(updated.config),
      updated.path,
      JSON.stringify(updated.presentAgentIds),
      JSON.stringify(updated.zoneConfig),
      updatedAt,
      startedAt,
      completedAt,
      projectId
    );
    
    return updated;
  }

  deleteProject(projectId: string): boolean {
    const stmt = this.db.prepare('DELETE FROM projects WHERE project_id = ?');
    const result = stmt.run(projectId);
    return result.changes > 0;
  }

  getChannels(projectId: string): ProjectChannel[] {
    const rows = this.db.prepare('SELECT * FROM channels WHERE project_id = ?').all(projectId) as ChannelRow[];
    return rows.map(this.mapRowToChannel);
  }

  getChannel(projectId: string, channelId: string): ProjectChannel | null {
    const row = this.db.prepare('SELECT * FROM channels WHERE project_id = ? AND channel_id = ?').get(projectId, channelId) as ChannelRow | undefined;
    return row ? this.mapRowToChannel(row) : null;
  }

  createChannel(channel: ProjectChannel): ProjectChannel {
    const stmt = this.db.prepare(`
      INSERT INTO channels (channel_id, project_id, name, type, description, subscriber_ids, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    
    stmt.run(
      channel.id,
      channel.projectId,
      channel.name,
      channel.type,
      channel.description || '',
      JSON.stringify(channel.subscriberIds),
      channel.createdAt,
      channel.updatedAt
    );
    
    return channel;
  }

  updateChannel(projectId: string, channelId: string, subscriberIds: string[]): ProjectChannel | null {
    const stmt = this.db.prepare(`
      UPDATE channels SET subscriber_ids = ?, updated_at = ? WHERE project_id = ? AND channel_id = ?
    `);
    stmt.run(JSON.stringify(subscriberIds), Date.now(), projectId, channelId);
    return this.getChannel(projectId, channelId);
  }

  getMessages(projectId: string, channelId?: string): ProjectChannelMessage[] {
    let rows;
    if (channelId) {
      rows = this.db.prepare('SELECT * FROM messages WHERE project_id = ? AND channel_id = ? ORDER BY timestamp ASC').all(projectId, channelId);
    } else {
      rows = this.db.prepare('SELECT * FROM messages WHERE project_id = ? ORDER BY timestamp ASC').all(projectId);
    }
    return (rows as MessageRow[]).map(this.mapRowToMessage);
  }

  getMessagesByMention(projectId: string, agentId: string): ProjectChannelMessage[] {
    const rows = this.db.prepare(`
      SELECT * FROM messages 
      WHERE project_id = ? 
      ORDER BY timestamp ASC
    `).all(projectId) as MessageRow[];
    
    return rows
      .map(row => this.mapRowToMessage(row))
      .filter(msg => msg.mentions.includes(agentId));
  }

  createMessage(message: ProjectChannelMessage): ProjectChannelMessage {
    const stmt = this.db.prepare(`
      INSERT INTO messages (message_id, project_id, channel_id, role, content, sender, mentions, raw_content, message_type, task_id, session_key, run_id, metadata, timestamp, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    
    stmt.run(
      message.id,
      message.projectId,
      message.channelId,
      message.role,
      message.content,
      JSON.stringify(message.sender),
      JSON.stringify(message.mentions),
      message.rawContent || '',
      message.messageType,
      message.taskId || '',
      message.sessionKey || '',
      message.runId || '',
      JSON.stringify(message.metadata),
      message.timestamp,
      message.timestamp
    );
    
    return message;
  }

  private mapRowToProject(row: ProjectRow): Project {
    return {
      id: row.project_id,
      name: row.name,
      description: row.description,
      priority: row.priority,
      status: row.status as ProjectStatus,
      config: JSON.parse(row.config || '{}') as ProjectConfig,
      path: row.path,
      presentAgentIds: JSON.parse(row.present_agent_ids || '[]') as string[],
      zoneConfig: JSON.parse(row.zone_config || '{}') as ProjectZoneConfig,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
      startedAt: row.started_at ? new Date(row.started_at) : undefined,
      completedAt: row.completed_at ? new Date(row.completed_at) : undefined
    };
  }

  private mapRowToChannel(row: ChannelRow): ProjectChannel {
    return {
      id: row.channel_id,
      projectId: row.project_id,
      name: row.name,
      type: row.type as ProjectChannelType,
      description: row.description,
      subscriberIds: JSON.parse(row.subscriber_ids || '[]') as string[],
      isPrivate: false,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  private mapRowToMessage(row: MessageRow): ProjectChannelMessage {
    let sender: MessageSender;
    try {
      sender = row.sender ? JSON.parse(row.sender) as MessageSender : { id: '', type: 'user', name: '' };
    } catch {
      /* expected: corrupted sender JSON */
      sender = { id: '', type: 'user', name: '' };
    }

    let mentions: string[] = [];
    try {
      mentions = JSON.parse(row.mentions || '[]') as string[];
    } catch {
      /* expected: corrupted mentions JSON */
      mentions = [];
    }

    let metadata: { source: 'openclaw' | 'local' | 'user'; createdAt: string };
    try {
      metadata = JSON.parse(row.metadata || '{}') as { source: 'openclaw' | 'local' | 'user'; createdAt: string };
    } catch {
      /* expected: corrupted metadata JSON */
      metadata = { source: 'user', createdAt: new Date().toISOString() };
    }

    return {
      id: row.message_id,
      projectId: row.project_id,
      channelId: row.channel_id,
      role: row.role as MessageRole,
      content: row.content,
      sender,
      mentions,
      rawContent: row.raw_content,
      messageType: row.message_type as ProjectMessageType,
      taskId: row.task_id || undefined,
      sessionKey: row.session_key || undefined,
      runId: row.run_id || undefined,
      metadata,
      timestamp: row.timestamp
    };
  }
}

export const projectRepository = new ProjectRepository();
