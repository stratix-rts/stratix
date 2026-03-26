import { getDatabase } from './StratixDatabase';
import { Zone, ZoneFile, FileType, ZoneTask, ZoneTaskStatus, ZoneMessage, SenderType } from '../stratix-project/types';
import { generateId } from '../stratix-project/utils/helpers';

export class ZoneRepository {
  private get db() {
    return getDatabase().getDatabase();
  }

  // Zone CRUD operations
  getZonesByProject(projectId: string): Zone[] {
    const rows = this.db.prepare('SELECT * FROM zone_contexts WHERE project_id = ? AND deleted_at IS NULL ORDER BY created_at DESC').all(projectId) as any[];
    return rows.map(row => this.mapRowToZone(row));
  }

  getZone(zoneId: string): Zone | null {
    const row = this.db.prepare('SELECT * FROM zone_contexts WHERE zone_id = ? AND deleted_at IS NULL').get(zoneId) as any;
    return row ? this.mapRowToZone(row) : null;
  }

  createZone(projectId: string, title: string, prompt: string = ''): Zone {
    const now = Date.now();
    const zoneId = generateId('zone');

    const stmt = this.db.prepare(`
      INSERT INTO zone_contexts (zone_id, project_id, title, prompt, members, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(zoneId, projectId, title, prompt, '[]', now, now);

    return {
      id: zoneId,
      projectId,
      title,
      prompt,
      files: [],
      members: [],
      createdAt: now,
      updatedAt: now
    };
  }

  updateZone(zoneId: string, updates: { title?: string; prompt?: string; members?: string[] }): Zone | null {
    const existing = this.getZone(zoneId);
    if (!existing) return null;

    const now = Date.now();
    const title = updates.title ?? existing.title;
    const prompt = updates.prompt ?? existing.prompt;
    const members = updates.members ?? existing.members;

    const stmt = this.db.prepare(`
      UPDATE zone_contexts SET title = ?, prompt = ?, members = ?, updated_at = ?
      WHERE zone_id = ?
    `);

    stmt.run(title, prompt, JSON.stringify(members), now, zoneId);

    return this.getZone(zoneId);
  }

  deleteZone(zoneId: string): boolean {
    // Soft delete: set deleted_at timestamp instead of physical deletion
    const now = Date.now();
    const stmt = this.db.prepare('UPDATE zone_contexts SET deleted_at = ? WHERE zone_id = ? AND deleted_at IS NULL');
    const result = stmt.run(now, zoneId);
    return result.changes > 0;
  }

  // Zone Members operations
  addMember(zoneId: string, agentId: string): Zone | null {
    const zone = this.getZone(zoneId);
    if (!zone) return null;

    if (!zone.members.includes(agentId)) {
      zone.members.push(agentId);
      this.updateZone(zoneId, { members: zone.members });
    }

    return this.getZone(zoneId);
  }

  removeMember(zoneId: string, agentId: string): Zone | null {
    const zone = this.getZone(zoneId);
    if (!zone) return null;

    zone.members = zone.members.filter(id => id !== agentId);
    return this.updateZone(zoneId, { members: zone.members });
  }

  // Zone Files operations
  getFilesByZone(zoneId: string): ZoneFile[] {
    const rows = this.db.prepare('SELECT * FROM zone_files WHERE zone_id = ? ORDER BY created_at DESC').all(zoneId) as any[];
    return rows.map(row => this.mapRowToFile(row));
  }

  getFile(fileId: string): ZoneFile | null {
    const row = this.db.prepare('SELECT * FROM zone_files WHERE file_id = ?').get(fileId) as any;
    return row ? this.mapRowToFile(row) : null;
  }

  addFile(zoneId: string, name: string, sourceType: 'local' | 'url', source: string, fileType?: FileType, metadata?: any): ZoneFile {
    const now = Date.now();
    const fileId = generateId('zf');

    const stmt = this.db.prepare(`
      INSERT INTO zone_files (file_id, zone_id, name, source_type, source, content, file_type, last_fetched, metadata, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(fileId, zoneId, name, sourceType, source, null, fileType || null, null, JSON.stringify(metadata || {}), now, now);

    return {
      id: fileId,
      zoneId,
      name,
      sourceType,
      source,
      fileType,
      metadata,
      createdAt: now,
      updatedAt: now
    };
  }

  updateFile(fileId: string, updates: { content?: string; lastFetched?: number; metadata?: any }): ZoneFile | null {
    const existing = this.getFile(fileId);
    if (!existing) return null;

    const now = Date.now();
    const content = updates.content ?? existing.content;
    const lastFetched = updates.lastFetched ?? now;
    const metadata = updates.metadata ?? existing.metadata;

    const stmt = this.db.prepare(`
      UPDATE zone_files SET content = ?, last_fetched = ?, metadata = ?, updated_at = ?
      WHERE file_id = ?
    `);

    stmt.run(content, lastFetched, JSON.stringify(metadata), now, fileId);

    return this.getFile(fileId);
  }

  deleteFile(fileId: string): boolean {
    const stmt = this.db.prepare('DELETE FROM zone_files WHERE file_id = ?');
    const result = stmt.run(fileId);
    return result.changes > 0;
  }

  // ============================================
  // Zone Context helpers (direct access to zone_contexts table)
  // ============================================

  getZoneContext(zoneId: string): { taskPolicy: string; taskCreatorId: string | null; members: string[] } | null {
    const row = this.db.prepare('SELECT task_policy, task_creator_id, members FROM zone_contexts WHERE zone_id = ? AND deleted_at IS NULL').get(zoneId) as any;
    if (!row) return null;
    return {
      taskPolicy: row.task_policy || 'creator',
      taskCreatorId: row.task_creator_id || null,
      members: JSON.parse(row.members || '[]')
    };
  }

  updateZoneContext(zoneId: string, updates: { taskPolicy?: string; taskCreatorId?: string | null; members?: string[] }): boolean {
    const existing = this.getZoneContext(zoneId);
    if (!existing) return false;

    const now = Date.now();
    const taskPolicy = updates.taskPolicy ?? existing.taskPolicy;
    const taskCreatorId = updates.taskCreatorId !== undefined ? updates.taskCreatorId : existing.taskCreatorId;
    const members = updates.members ?? existing.members;

    const stmt = this.db.prepare(`
      UPDATE zone_contexts SET task_policy = ?, task_creator_id = ?, members = ?, updated_at = ?
      WHERE zone_id = ?
    `);
    stmt.run(taskPolicy, taskCreatorId, JSON.stringify(members), now, zoneId);
    return true;
  }

  // ============================================
  // Zone Tasks
  // ============================================

  getTasks(zoneId: string): ZoneTask[] {
    const rows = this.db.prepare('SELECT * FROM zone_tasks WHERE zone_id = ? ORDER BY created_at DESC').all(zoneId) as any[];
    return rows.map(row => this.mapRowToTask(row));
  }

  getTask(taskId: string): ZoneTask | null {
    const row = this.db.prepare('SELECT * FROM zone_tasks WHERE task_id = ?').get(taskId) as any;
    return row ? this.mapRowToTask(row) : null;
  }

  createTask(zoneId: string, title: string, createdBy: string): ZoneTask {
    const now = Date.now();
    const taskId = generateId('task');

    const stmt = this.db.prepare(`
      INSERT INTO zone_tasks (task_id, zone_id, title, status, assignee, created_by, created_at, updated_at)
      VALUES (?, ?, ?, 'pending', NULL, ?, ?, ?)
    `);
    stmt.run(taskId, zoneId, title, createdBy, now, now);

    return {
      id: taskId,
      zoneId,
      title,
      status: 'pending',
      assignee: null,
      createdBy,
      createdAt: now,
      updatedAt: now
    };
  }

  updateTask(taskId: string, updates: { title?: string; status?: ZoneTaskStatus; assignee?: string | null }): ZoneTask | null {
    const existing = this.getTask(taskId);
    if (!existing) return null;

    const now = Date.now();
    const title = updates.title ?? existing.title;
    const status = updates.status ?? existing.status;
    const assignee = updates.assignee !== undefined ? updates.assignee : existing.assignee;

    const stmt = this.db.prepare(`
      UPDATE zone_tasks SET title = ?, status = ?, assignee = ?, updated_at = ?
      WHERE task_id = ?
    `);
    stmt.run(title, status, assignee, now, taskId);

    return this.getTask(taskId);
  }

  deleteTask(taskId: string): boolean {
    const stmt = this.db.prepare('DELETE FROM zone_tasks WHERE task_id = ?');
    const result = stmt.run(taskId);
    return result.changes > 0;
  }

  // ============================================
  // Zone Messages
  // ============================================

  getMessages(zoneId: string, limit: number = 100): ZoneMessage[] {
    const rows = this.db.prepare('SELECT * FROM zone_messages WHERE zone_id = ? ORDER BY created_at DESC LIMIT ?').all(zoneId, limit) as any[];
    return rows.map(row => this.mapRowToMessage(row)).reverse(); // Oldest first for display
  }

  addMessage(zoneId: string, senderId: string, senderType: SenderType, content: string): ZoneMessage {
    const now = Date.now();
    const messageId = generateId('msg');

    const stmt = this.db.prepare(`
      INSERT INTO zone_messages (message_id, zone_id, sender_id, sender_type, content, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    stmt.run(messageId, zoneId, senderId, senderType, content, now);

    return {
      id: messageId,
      zoneId,
      senderId,
      senderType,
      content,
      createdAt: now
    };
  }

  // ============================================
  // Row Mappers
  // ============================================

  // Map row to Zone (with files)
  private mapRowToZone(row: any): Zone {
    const files = this.getFilesByZone(row.zone_id);
    return {
      id: row.zone_id,
      projectId: row.project_id,
      title: row.title,
      prompt: row.prompt || '',
      members: JSON.parse(row.members || '[]'),
      files,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  // Map row to ZoneFile
  private mapRowToFile(row: any): ZoneFile {
    return {
      id: row.file_id,
      zoneId: row.zone_id,
      name: row.name,
      sourceType: row.source_type,
      source: row.source,
      content: row.content || undefined,
      fileType: row.file_type as FileType || undefined,
      lastFetched: row.last_fetched || undefined,
      metadata: JSON.parse(row.metadata || '{}'),
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  // Map row to ZoneTask
  private mapRowToTask(row: any): ZoneTask {
    return {
      id: row.task_id,
      zoneId: row.zone_id,
      title: row.title,
      status: row.status as ZoneTaskStatus,
      assignee: row.assignee || null,
      createdBy: row.created_by,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  // Map row to ZoneMessage
  private mapRowToMessage(row: any): ZoneMessage {
    return {
      id: row.message_id,
      zoneId: row.zone_id,
      senderId: row.sender_id,
      senderType: row.sender_type as SenderType,
      content: row.content,
      createdAt: row.created_at
    };
  }
}

export const zoneRepository = new ZoneRepository();
