import { Zone, ZoneFile, FileType, ZoneTask, ZoneTaskStatus, ZoneMessage, SenderType, FileVersion, FileMetadata } from '../stratix-project/types';
import { generateId } from '../stratix-project/utils/helpers';

import { getDatabase } from './StratixDatabase';

// Database row types
interface ZoneContextRow {
  zone_id: string;
  project_id: string;
  title: string;
  prompt: string | null;
  members: string | null;
  task_policy: string | null;
  task_creator_id: string | null;
  deleted_at: number | null;
  created_at: number;
  updated_at: number;
  description: string | null;
  priority: number | null;
  status: string | null;
  path: string | null;
  present_agent_ids: string | null;
  started_at: number | null;
  completed_at: number | null;
  zone_config: string | null;
}

interface ZoneFileRow {
  file_id: string;
  zone_id: string;
  name: string;
  source_type: string;
  source: string;
  content: string | null;
  file_type: string | null;
  last_fetched: number | null;
  metadata: string | null;
  created_at: number;
  updated_at: number;
}

interface ZoneTaskRow {
  task_id: string;
  zone_id: string;
  title: string;
  status: string;
  assignee: string | null;
  created_by: string;
  created_at: number;
  updated_at: number;
}

interface ZoneMessageRow {
  message_id: string;
  zone_id: string;
  sender_id: string;
  sender_type: string;
  content: string;
  created_at: number;
}

interface ZoneContextSimpleRow {
  task_policy: string | null;
  task_creator_id: string | null;
  members: string | null;
}

interface CountRow {
  count: number;
}

export class ZoneRepository {
  private get db() {
    return getDatabase().getDatabase();
  }

  // Zone CRUD operations
  getZonesByProject(projectId: string): Zone[] {
    // JOIN with zones table to get location/config fields
    const rows = this.db.prepare(`
      SELECT zc.*, z.description, z.priority, z.status, z.path, z.present_agent_ids, z.started_at, z.completed_at, z.config as zone_config
      FROM zone_contexts zc
      LEFT JOIN zones z ON z.zone_context_id = zc.zone_id
      WHERE zc.project_id = ? AND zc.deleted_at IS NULL
      ORDER BY zc.created_at DESC
    `).all(projectId) as ZoneContextRow[];

    if (rows.length === 0) return [];

    // Batch load files for all zones to avoid N+1 queries
    const zoneIds = rows.map(r => r.zone_id);
    const filesByZone = this.getFilesBatch(zoneIds);

    return rows.map(row => this.mapRowToZone(row, filesByZone));
  }

  getZone(zoneId: string): Zone | null {
    // JOIN with zones table to get location/config fields
    const row = this.db.prepare(`
      SELECT zc.*, z.description, z.priority, z.status, z.path, z.present_agent_ids, z.started_at, z.completed_at, z.config as zone_config
      FROM zone_contexts zc
      LEFT JOIN zones z ON z.zone_context_id = zc.zone_id
      WHERE zc.zone_id = ? AND zc.deleted_at IS NULL
    `).get(zoneId) as ZoneContextRow | undefined;
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

  updateZone(zoneId: string, updates: { title?: string; prompt?: string; members?: string[]; presentAgentIds?: string[] }): Zone | null {
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

    // Also update present_agent_ids in zones table if provided
    if (updates.presentAgentIds !== undefined) {
      const presentStmt = this.db.prepare(`
        UPDATE zones SET present_agent_ids = ?, updated_at = ?
        WHERE zone_context_id = ?
      `);
      presentStmt.run(JSON.stringify(updates.presentAgentIds), now, zoneId);
    }

    return this.getZone(zoneId);
  }

  deleteZone(zoneId: string): boolean {
    // Soft delete: set deleted_at timestamp instead of physical deletion
    const now = Date.now();
    const stmt = this.db.prepare('UPDATE zone_contexts SET deleted_at = ? WHERE zone_id = ? AND deleted_at IS NULL');
    const result = stmt.run(now, zoneId);
    return result.changes > 0;
  }

  // ============================================
  // Zone Soft Delete Recovery (Recycle Bin)
  // ============================================

  getDeletedZones(projectId: string): Zone[] {
    const rows = this.db.prepare(`
      SELECT zc.*, z.description, z.priority, z.status, z.path, z.present_agent_ids, z.started_at, z.completed_at, z.config as zone_config
      FROM zone_contexts zc
      LEFT JOIN zones z ON z.zone_context_id = zc.zone_id
      WHERE zc.project_id = ? AND zc.deleted_at IS NOT NULL
      ORDER BY zc.deleted_at DESC
    `).all(projectId) as ZoneContextRow[];

    if (rows.length === 0) return [];

    const zoneIds = rows.map(r => r.zone_id);
    const filesByZone = this.getFilesBatch(zoneIds);
    return rows.map(row => this.mapRowToZone(row, filesByZone));
  }

  restoreZone(zoneId: string): Zone | null {
    const stmt = this.db.prepare('UPDATE zone_contexts SET deleted_at = NULL WHERE zone_id = ? AND deleted_at IS NOT NULL');
    const result = stmt.run(zoneId);
    if (result.changes === 0) return null;
    return this.getZone(zoneId);
  }

  permanentlyDeleteZone(zoneId: string): boolean {
    // Physical delete - use with caution
    const stmt = this.db.prepare('DELETE FROM zone_contexts WHERE zone_id = ?');
    const result = stmt.run(zoneId);
    return result.changes > 0;
  }

  getDeletedZone(zoneId: string): Zone | null {
    const row = this.db.prepare(`
      SELECT zc.*, z.description, z.priority, z.status, z.path, z.present_agent_ids, z.started_at, z.completed_at, z.config as zone_config
      FROM zone_contexts zc
      LEFT JOIN zones z ON z.zone_context_id = zc.zone_id
      WHERE zc.zone_id = ? AND zc.deleted_at IS NOT NULL
    `).get(zoneId) as ZoneContextRow | undefined;
    return row ? this.mapRowToZone(row) : null;
  }

  // Search zones across all projects (global search)
  searchZones(keyword: string, limit: number = 20): Zone[] {
    const pattern = `%${keyword}%`;
    const rows = this.db.prepare(`
      SELECT zc.*, z.description, z.priority, z.status, z.path, z.present_agent_ids, z.started_at, z.completed_at, z.config as zone_config
      FROM zone_contexts zc
      LEFT JOIN zones z ON z.zone_context_id = zc.zone_id
      WHERE zc.deleted_at IS NULL
        AND (zc.title LIKE ? OR zc.prompt LIKE ?)
      ORDER BY zc.updated_at DESC
      LIMIT ?
    `).all(pattern, pattern, limit) as ZoneContextRow[];

    if (rows.length === 0) return [];

    const zoneIds = rows.map(r => r.zone_id);
    const filesByZone = this.getFilesBatch(zoneIds);
    return rows.map(row => this.mapRowToZone(row, filesByZone));
  }

  // Zone Members operations
  addMember(zoneId: string, agentId: string): Zone | null {
    const zone = this.getZone(zoneId);
    if (!zone) return null;

    const currentMembers = zone.members || [];
    const currentPresentAgentIds = zone.presentAgentIds || [];

    // Only add to members if not already there
    const newMembers = currentMembers.includes(agentId)
      ? currentMembers
      : [...currentMembers, agentId];

    // Only add to presentAgentIds if not already there
    const newPresentAgentIds = currentPresentAgentIds.includes(agentId)
      ? currentPresentAgentIds
      : [...currentPresentAgentIds, agentId];

    return this.updateZone(zoneId, { members: newMembers, presentAgentIds: newPresentAgentIds });
  }

  removeMember(zoneId: string, agentId: string): Zone | null {
    const zone = this.getZone(zoneId);
    if (!zone) return null;

    const newMembers = (zone.members || []).filter(id => id !== agentId);
    const newPresentAgentIds = (zone.presentAgentIds || []).filter(id => id !== agentId);

    return this.updateZone(zoneId, { members: newMembers, presentAgentIds: newPresentAgentIds });
  }

  // Bulk add members
  addMembers(zoneId: string, agentIds: string[]): Zone | null {
    const zone = this.getZone(zoneId);
    if (!zone) return null;

    const currentMembers = zone.members || [];
    const currentPresentAgentIds = zone.presentAgentIds || [];

    const newMembers = [...new Set([...currentMembers, ...agentIds])];
    const newPresentAgentIds = [...new Set([...currentPresentAgentIds, ...agentIds])];

    return this.updateZone(zoneId, { members: newMembers, presentAgentIds: newPresentAgentIds });
  }

  // Bulk remove members
  removeMembers(zoneId: string, agentIds: string[]): Zone | null {
    const zone = this.getZone(zoneId);
    if (!zone) return null;

    const newMembers = (zone.members || []).filter(id => !agentIds.includes(id));
    const newPresentAgentIds = (zone.presentAgentIds || []).filter(id => !agentIds.includes(id));

    return this.updateZone(zoneId, { members: newMembers, presentAgentIds: newPresentAgentIds });
  }

  // Zone Files operations
  getFilesByZone(zoneId: string): ZoneFile[] {
    const rows = this.db.prepare('SELECT * FROM zone_files WHERE zone_id = ? ORDER BY created_at DESC').all(zoneId) as ZoneFileRow[];
    return rows.map(row => this.mapRowToFile(row));
  }

  // Batch load files for multiple zones to avoid N+1 queries
  getFilesBatch(zoneIds: string[]): Map<string, ZoneFile[]> {
    if (zoneIds.length === 0) return new Map();

    const placeholders = zoneIds.map(() => '?').join(', ');
    const rows = this.db.prepare(
      `SELECT * FROM zone_files WHERE zone_id IN (${placeholders}) ORDER BY zone_id, created_at DESC`
    ).all(...zoneIds) as ZoneFileRow[];

    const filesByZone = new Map<string, ZoneFile[]>();
    for (const zoneId of zoneIds) {
      filesByZone.set(zoneId, []);
    }
    for (const row of rows) {
      const zoneId = row.zone_id;
      if (filesByZone.has(zoneId)) {
        filesByZone.get(zoneId)!.push(this.mapRowToFile(row));
      }
    }
    return filesByZone;
  }

  getFile(fileId: string): ZoneFile | null {
    const row = this.db.prepare('SELECT * FROM zone_files WHERE file_id = ?').get(fileId) as ZoneFileRow | undefined;
    return row ? this.mapRowToFile(row) : null;
  }

  // Search files by name or content within a zone
  searchFiles(zoneId: string, keyword: string): ZoneFile[] {
    const pattern = `%${keyword}%`;
    const rows = this.db.prepare(`
      SELECT * FROM zone_files
      WHERE zone_id = ? AND (name LIKE ? OR (content IS NOT NULL AND file_type IN ('md', 'txt', 'ts', 'js', 'fig', 'link', 'other')))
      ORDER BY created_at DESC
    `).all(zoneId, pattern) as ZoneFileRow[];

    const lowerKeyword = keyword.toLowerCase();
    return rows
      .map(row => this.mapRowToFile(row))
      .filter((file) => {
        // Match name (already filtered in SQL, but double-check for case sensitivity)
        if (file.name?.toLowerCase().includes(lowerKeyword)) {
          return true;
        }
        // Match content (only for text files with content)
        if (file.content && this.isTextFile(file.fileType)) {
          if (file.content.toLowerCase().includes(lowerKeyword)) {
            return true;
          }
        }
        return false;
      });
  }

  // Helper: check if file type is text (has readable content)
  private isTextFile(fileType?: FileType | string): boolean {
    if (!fileType) return false;
    const textTypes = ['md', 'txt', 'ts', 'js', 'fig', 'link', 'other'];
    return textTypes.includes(fileType);
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

  // ============================================
  // File Version History
  // ============================================

  /**
   * Get file versions from metadata
   */
  getFileVersions(fileId: string): { versions: FileVersion[]; currentVersionId?: string } | null {
    const file = this.getFile(fileId);
    if (!file) return null;

    return {
      versions: file.metadata?.versions || [],
      currentVersionId: file.metadata?.currentVersionId
    };
  }

  /**
   * Add a version to file metadata
   */
  addFileVersion(fileId: string, content: string, description?: string): ZoneFile | null {
    const file = this.getFile(fileId);
    if (!file) return null;

    const metadata = file.metadata || {};
    const versions: FileVersion[] = metadata.versions || [];

    // Create new version
    const newVersion: FileVersion = {
      id: generateId('ver'),
      content,
      createdAt: Date.now(),
      description
    };

    // Add to versions array (at the beginning, newest first)
    versions.unshift(newVersion);

    // Keep only last 10 versions
    if (versions.length > 10) {
      versions.pop();
    }

    // Update metadata
    const updatedMetadata: FileMetadata = {
      ...metadata,
      versions,
      currentVersionId: newVersion.id
    };

    return this.updateFile(fileId, { metadata: updatedMetadata });
  }

  /**
   * Rollback file to a specific version
   */
  rollbackFileToVersion(fileId: string, versionId: string): ZoneFile | null {
    const file = this.getFile(fileId);
    if (!file) return null;

    const versions: FileVersion[] = file.metadata?.versions || [];
    const targetVersion = versions.find(v => v.id === versionId);
    if (!targetVersion) return null;

    // Save current content as a new version before rollback
    if (file.content) {
      const currentVersion: FileVersion = {
        id: generateId('ver'),
        content: file.content,
        createdAt: Date.now(),
        description: 'Auto-saved before rollback'
      };
      versions.unshift(currentVersion);
      if (versions.length > 10) {
        versions.pop();
      }
    }

    // Update metadata with current version pointing to rollback target
    const updatedMetadata: FileMetadata = {
      ...file.metadata,
      versions,
      currentVersionId: versionId
    };

    // Update file content to the target version
    return this.updateFile(fileId, { content: targetVersion.content, metadata: updatedMetadata });
  }

  deleteFile(fileId: string): boolean {
    const stmt = this.db.prepare('DELETE FROM zone_files WHERE file_id = ?');
    const result = stmt.run(fileId);
    return result.changes > 0;
  }

  // ============================================
  // Batch File Operations
  // ============================================

  addFiles(zoneId: string, files: Array<{ name: string; sourceType: 'local' | 'url'; source: string; fileType?: FileType; metadata?: any }>): ZoneFile[] {
    const now = Date.now();
    const addedFiles: ZoneFile[] = [];

    const stmt = this.db.prepare(`
      INSERT INTO zone_files (file_id, zone_id, name, source_type, source, content, file_type, last_fetched, metadata, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const file of files) {
      const fileId = generateId('zf');
      stmt.run(fileId, zoneId, file.name, file.sourceType, file.source, null, file.fileType || null, null, JSON.stringify(file.metadata || {}), now, now);

      addedFiles.push({
        id: fileId,
        zoneId,
        name: file.name,
        sourceType: file.sourceType,
        source: file.source,
        fileType: file.fileType,
        metadata: file.metadata,
        createdAt: now,
        updatedAt: now
      });
    }

    return addedFiles;
  }

  // ============================================
  // Zone Context helpers (direct access to zone_contexts table)
  // ============================================

  getZoneContext(zoneId: string): { taskPolicy: string; taskCreatorId: string | null; members: string[] } | null {
    const row = this.db.prepare('SELECT task_policy, task_creator_id, members FROM zone_contexts WHERE zone_id = ? AND deleted_at IS NULL').get(zoneId) as ZoneContextSimpleRow | undefined;
    if (!row) return null;

    let members: string[] = [];
    try {
      members = JSON.parse(row.members || '[]');
    } catch { /* ignore malformed JSON */ }

    return {
      taskPolicy: row.task_policy || 'creator',
      taskCreatorId: row.task_creator_id || null,
      members
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

  getTasks(zoneId: string, limit?: number, offset?: number): ZoneTask[] {
    let query = 'SELECT * FROM zone_tasks WHERE zone_id = ? ORDER BY created_at DESC';
    const params: (string | number)[] = [zoneId];

    if (limit !== undefined) {
      query += ' LIMIT ?';
      params.push(limit);
      if (offset !== undefined) {
        query += ' OFFSET ?';
        params.push(offset);
      }
    }

    const rows = this.db.prepare(query).all(...params) as ZoneTaskRow[];
    return rows.map(row => this.mapRowToTask(row));
  }

  getTasksCount(zoneId: string): number {
    const row = this.db.prepare('SELECT COUNT(*) as count FROM zone_tasks WHERE zone_id = ?').get(zoneId) as CountRow | undefined;
    return row?.count || 0;
  }

  getTask(taskId: string): ZoneTask | null {
    const row = this.db.prepare('SELECT * FROM zone_tasks WHERE task_id = ?').get(taskId) as ZoneTaskRow | undefined;
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
  // Zone Messages (with pagination)
  // ============================================

  getMessages(zoneId: string, limit: number = 100, offset: number = 0): ZoneMessage[] {
    // Use ASC order directly for oldest-first display, no reversal needed
    const rows = this.db.prepare('SELECT * FROM zone_messages WHERE zone_id = ? ORDER BY created_at ASC LIMIT ? OFFSET ?').all(zoneId, limit, offset) as ZoneMessageRow[];
    return rows.map(row => this.mapRowToMessage(row));
  }

  getMessagesCount(zoneId: string): number {
    const row = this.db.prepare('SELECT COUNT(*) as count FROM zone_messages WHERE zone_id = ?').get(zoneId) as CountRow | undefined;
    return row?.count || 0;
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
  // Zone Template Export/Import
  // ============================================

  exportZone(zoneId: string): { title: string; prompt: string; files: Array<{ name: string; sourceType: 'local' | 'url'; source: string }>; tasks: Array<{ title: string }> } | null {
    const zone = this.getZone(zoneId);
    if (!zone) return null;

    const files = this.getFilesByZone(zoneId);
    const tasks = this.getTasks(zoneId);

    return {
      title: zone.title,
      prompt: zone.prompt,
      files: files.map(f => ({
        name: f.name,
        sourceType: f.sourceType,
        source: f.source
      })),
      tasks: tasks.map(t => ({
        title: t.title
      }))
    };
  }

  // ============================================
  // Row Mappers
  // ============================================

  // Map row to Zone (with files)
  private mapRowToZone(row: ZoneContextRow, filesByZone?: Map<string, ZoneFile[]>): Zone {
    const files = filesByZone?.get(row.zone_id) ?? this.getFilesByZone(row.zone_id);
    let presentAgentIds: string[] = [];
    let members: string[] = [];
    let config: any;

    try {
      presentAgentIds = JSON.parse(row.present_agent_ids || '[]');
    } catch { /* ignore malformed JSON */ }

    try {
      members = JSON.parse(row.members || '[]');
    } catch { /* ignore malformed JSON */ }

    if (row.zone_config) {
      try {
        config = JSON.parse(row.zone_config);
      } catch { /* ignore malformed JSON */ }
    }

    return {
      id: row.zone_id,
      projectId: row.project_id,
      title: row.title || row.name || '',
      prompt: row.prompt || '',
      description: row.description || '',
      priority: row.priority || 3,
      status: row.status || 'idle',
      path: row.path || '',
      presentAgentIds,
      members,
      files,
      config,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      startedAt: row.started_at || undefined,
      completedAt: row.completed_at || undefined
    };
  }

  // Map row to ZoneFile
  private mapRowToFile(row: ZoneFileRow): ZoneFile {
    let metadata: FileMetadata = {};
    try {
      metadata = JSON.parse(row.metadata || '{}');
    } catch { /* ignore malformed JSON */ }

    return {
      id: row.file_id,
      zoneId: row.zone_id,
      name: row.name,
      sourceType: row.source_type,
      source: row.source,
      content: row.content || undefined,
      fileType: row.file_type as FileType || undefined,
      lastFetched: row.last_fetched || undefined,
      metadata,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  // Map row to ZoneTask
  private mapRowToTask(row: ZoneTaskRow): ZoneTask {
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
  private mapRowToMessage(row: ZoneMessageRow): ZoneMessage {
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
