import { projectRepository } from '../../stratix-database/ProjectRepository';
import { zoneRepository } from '../../stratix-database/ZoneRepository';
import { Zone, ZoneFile, FileType, ZoneTask, ZoneTaskUpdateRequest, ZoneMessage, FileVersion } from '../../stratix-project/types';
import { gatewayEventBus } from '../GatewayEventBus';
import { stratixStateStore, ZoneState } from '../../stratix-core/state';
import { PermissionOrchestrator, PermissionContext } from '../../stratix-core/permission';
import { ZoneAgent } from '../../stratix-agent/core/ZoneAgent';
import { ZoneMemberService } from './ZoneMemberService';
import { ZoneFileService } from './ZoneFileService';
import { ZoneTaskService } from './ZoneTaskService';
import { ZoneMessageService } from './ZoneMessageService';

export interface ZoneFileBatchRequest {
  files: Array<{
    name: string;
    sourceType: 'local' | 'url';
    source: string;
    fileType?: FileType;
    metadata?: Record<string, unknown>;
  }>;
}

export class ZoneService {
  private initialized: boolean = false;
  private permissionOrchestrator: PermissionOrchestrator | null = null;
  private memberService: ZoneMemberService;
  private fileService: ZoneFileService;
  private taskService: ZoneTaskService;
  private messageService: ZoneMessageService;

  constructor() {
    this.memberService = new ZoneMemberService(
      this.checkPermission.bind(this),
      this.syncZoneToStore.bind(this),
      this.ensureInitialized.bind(this)
    );
    this.fileService = new ZoneFileService(
      this.checkPermission.bind(this),
      this.ensureInitialized.bind(this)
    );
    this.taskService = new ZoneTaskService(
      this.checkPermission.bind(this),
      this.ensureInitialized.bind(this)
    );
    this.messageService = new ZoneMessageService(
      this.checkPermission.bind(this),
      this.ensureInitialized.bind(this)
    );
  }

  // Zone State 同步到 StratixStateStore
  private syncZoneToStore(zone: Zone): void {
    const zoneState: ZoneState = {
      id: zone.id,
      title: zone.title,
      status: zone.status ?? 'idle',
      members: zone.members ?? [],
      tasks: zone.tasks?.map(t => t.id) ?? [],
      createdAt: zone.createdAt,
    };
    stratixStateStore.setZone(zone.id, zoneState);
  }

  private removeZoneFromStore(zoneId: string): void {
    stratixStateStore.removeZone(zoneId);
  }

  public async initialize(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;
    console.log('[ZoneService] Initialized');
  }

  /**
   * 设置权限检查器
   */
  public setPermissionOrchestrator(orchestrator: PermissionOrchestrator): void {
    this.permissionOrchestrator = orchestrator;
  }

  /**
   * Check permission for an action on a resource.
   * @param action - Permission action (e.g., 'create', 'update', 'delete')
   * @param resource - Full resource identifier: 'zone:${zoneId}' or 'project:${projectId}'
   * @param agentId - Agent requesting the action
   */
  private checkPermission(action: string, resource: string, agentId: string): void {
    if (!this.permissionOrchestrator) return;

    // Parse resource to extract zoneId/projectId for params
    const params: { zoneId?: string; projectId?: string } = {};
    if (resource.startsWith('zone:')) {
      params.zoneId = resource.slice(5);
    } else if (resource.startsWith('project:')) {
      params.projectId = resource.slice(8);
    }

    const context: PermissionContext = {
      action,
      resource,
      agentId,
      params,
    };
    const result = this.permissionOrchestrator.decide(context);
    if (result.decision === 'deny') {
      const err = new Error(`Permission denied: ${action} on ${resource} by ${agentId}`) as Error & { code?: string };
      err.code = 'ZONE_PERMISSION_DENIED';
      throw err;
    }
    // 'ask' means user confirmation required — return 403 until UI confirmation flow is implemented
    if (result.decision === 'ask') {
      const err = new Error(`Permission requires confirmation: ${action} on ${resource}`) as Error & { code?: string };
      err.code = 'ZONE_PERMISSION_REQUIRED';
      throw err;
    }
  }

  /**
   * 配置文件缓存策略
   */
  public configureFileCache(options: {
    cacheExpiry?: number;
    maxFileSize?: number;
    allowedBasePaths?: string[];
    allowedUrlPatterns?: string[];
    blockedIpRanges?: string[];
  }): void {
    this.fileService.configureFileCache(options);
    console.log('[ZoneService] File cache configured via ZoneFileService');
  }

  private async ensureInitialized(): Promise<void> {
    if (!this.initialized) {
      await this.initialize();
    }
  }

  // Zone CRUD
  public async getZones(projectId: string): Promise<Zone[]> {
    await this.ensureInitialized();

    // Verify project exists
    const project = projectRepository.getProject(projectId);
    if (!project) {
      throw new Error(`Project not found: ${projectId}`);
    }

    return zoneRepository.getZonesByProject(projectId);
  }

  public async getZone(zoneId: string): Promise<Zone | null> {
    await this.ensureInitialized();
    return zoneRepository.getZone(zoneId);
  }

  public async createZone(projectId: string, title: string, prompt: string = '', agentId: string = 'system'): Promise<Zone> {
    await this.ensureInitialized();

    this.checkPermission('create', `project:${projectId}`, agentId);

    // Verify project exists
    const project = projectRepository.getProject(projectId);
    if (!project) {
      throw new Error(`Project not found: ${projectId}`);
    }

    const created = zoneRepository.createZone(projectId, title, prompt);
    this.syncZoneToStore(created);

    // Publish zone:created event first (before ZoneAgent starts)
    gatewayEventBus.publishZoneEvent('zone:created', created.id, created.projectId!, {
      title: created.title,
      prompt: created.prompt,
      creator: agentId,
    });

    // Start ZoneAgent to split OKR into tasks
    this.startZoneAgent(created);

    return created;
  }

  /**
   * Start ZoneAgent for a newly created zone
   * ZoneAgent will parse OKR and create tasks in TaskQueue
   */
  private async startZoneAgent(zone: Zone): Promise<void> {
    try {
      const zoneAgent = new ZoneAgent(zone.id, zone.title, zone.prompt || '');

      // Check if zone has OKR content to split
      if (zone.prompt && zone.prompt.trim().length > 0) {
        const tasks = await zoneAgent.splitOKRToTasks();
        console.log(`[ZoneService] ZoneAgent created ${tasks.length} tasks for zone ${zone.id}`);
      } else {
        console.log(`[ZoneService] Zone ${zone.id} has no OKR content to split`);
      }
    } catch (error) {
      console.error(`[ZoneService] Failed to start ZoneAgent for zone ${zone.id}:`, error);
    }
  }

  public async updateZone(zoneId: string, updates: { title?: string; prompt?: string }, agentId: string = 'system'): Promise<Zone> {
    await this.ensureInitialized();

    this.checkPermission('update', `zone:${zoneId}`, agentId);

    const updated = zoneRepository.updateZone(zoneId, updates);
    if (!updated) {
      throw new Error(`Zone not found: ${zoneId}`);
    }

    // Sync to StratixStateStore
    this.syncZoneToStore(updated);

    // Publish zone:updated event
    gatewayEventBus.publishZoneEvent('zone:updated', zoneId, updated.projectId!, {
      title: updated.title,
      prompt: updated.prompt
    });

    return updated;
  }

  public async deleteZone(zoneId: string, agentId: string = 'system'): Promise<boolean> {
    await this.ensureInitialized();

    this.checkPermission('delete', `zone:${zoneId}`, agentId);

    // Get zone info before soft delete for event publishing
    const zone = zoneRepository.getZone(zoneId);
    if (!zone) {
      return false;
    }

    const deleted = zoneRepository.deleteZone(zoneId);
    if (deleted) {
      // Remove from StratixStateStore
      this.removeZoneFromStore(zoneId);
      // Publish zone:deleted event
      gatewayEventBus.publishZoneEvent('zone:deleted', zoneId, zone.projectId!, {
        title: zone.title
      });
    }

    return deleted;
  }

  // ============================================
  // Zone Recycle Bin (Soft Delete Recovery)
  // ============================================

  /**
   * Get all soft-deleted zones for a project (recycle bin)
   */
  public async getDeletedZones(projectId: string): Promise<Zone[]> {
    await this.ensureInitialized();

    // Verify project exists
    const project = projectRepository.getProject(projectId);
    if (!project) {
      throw new Error(`Project not found: ${projectId}`);
    }

    return zoneRepository.getDeletedZones(projectId);
  }

  /**
   * Search zones across all projects (global search)
   */
  public async searchZones(keyword: string, limit: number = 20): Promise<Zone[]> {
    await this.ensureInitialized();
    return zoneRepository.searchZones(keyword, limit);
  }

  /**
   * Restore a soft-deleted zone
   */
  public async restoreZone(zoneId: string, agentId: string = 'system'): Promise<Zone> {
    await this.ensureInitialized();

    this.checkPermission('restore', `zone:${zoneId}`, agentId);

    const zone = zoneRepository.getDeletedZone(zoneId);
    if (!zone) {
      throw new Error(`Deleted zone not found: ${zoneId}`);
    }

    const restored = zoneRepository.restoreZone(zoneId);
    if (!restored) {
      throw new Error(`Failed to restore zone: ${zoneId}`);
    }

    // Sync to StratixStateStore
    this.syncZoneToStore(restored);

    // Publish zone:restored event
    gatewayEventBus.publishZoneEvent('zone:restored', zoneId, zone.projectId!, {
      title: restored.title
    });

    return restored;
  }

  /**
   * Permanently delete a zone (cannot be recovered)
   */
  public async permanentlyDeleteZone(zoneId: string, agentId: string = 'system'): Promise<boolean> {
    await this.ensureInitialized();

    this.checkPermission('permanent_delete', `zone:${zoneId}`, agentId);

    const zone = zoneRepository.getDeletedZone(zoneId);
    if (!zone) {
      throw new Error(`Deleted zone not found: ${zoneId}`);
    }

    const deleted = zoneRepository.permanentlyDeleteZone(zoneId);
    if (deleted) {
      this.removeZoneFromStore(zoneId);
    }
    return deleted;
  }

  /**
   * 清空回收站（永久删除项目中所有软删除的 Zone）
   */
  public async emptyTrash(projectId: string, agentId: string = 'system'): Promise<{ deleted: number; failed: number }> {
    await this.ensureInitialized();

    this.checkPermission('empty_trash', `project:${projectId}`, agentId);

    const deletedZones = zoneRepository.getDeletedZones(projectId);
    let deleted = 0;
    let failed = 0;

    for (const zone of deletedZones) {
      try {
        const actuallyDeleted = zoneRepository.permanentlyDeleteZone(zone.id);
        if (actuallyDeleted) {
          this.removeZoneFromStore(zone.id);
          deleted++;
        } else {
          // Zone wasn't actually deleted (e.g., not soft-deleted or already permanently deleted)
          console.warn(`[ZoneService] Zone ${zone.id} was not permanently deleted - may not be soft-deleted`);
          failed++;
        }
      } catch (error) {
        console.warn(`[ZoneService] Failed to permanently delete zone ${zone.id}:`, error);
        failed++;
      }
    }

    return { deleted, failed };
  }

  // ============================================
  // Zone Members (delegated to ZoneMemberService)
  // ============================================
  public async addMember(zoneId: string, agentId: string, requesterId: string = 'system'): Promise<Zone> {
    return this.memberService.addMember(zoneId, agentId, requesterId);
  }

  public async removeMember(zoneId: string, agentId: string, requesterId: string = 'system'): Promise<Zone> {
    return this.memberService.removeMember(zoneId, agentId, requesterId);
  }

  public async addMembers(zoneId: string, agentIds: string[], requesterId: string = 'system'): Promise<Zone> {
    return this.memberService.addMembers(zoneId, agentIds, requesterId);
  }

  public async removeMembers(zoneId: string, agentIds: string[], requesterId: string = 'system'): Promise<Zone> {
    return this.memberService.removeMembers(zoneId, agentIds, requesterId);
  }

  // ============================================
  // Zone Files (delegated to ZoneFileService)
  // ============================================
  public async addFile(
    zoneId: string,
    name: string,
    sourceType: 'local' | 'url',
    source: string,
    fileType?: FileType,
    agentId: string = 'system'
  ): Promise<ZoneFile> {
    return this.fileService.addFile(zoneId, name, sourceType, source, fileType, agentId);
  }

  public async addFiles(zoneId: string, files: Array<{ name: string; sourceType: 'local' | 'url'; source: string; fileType?: FileType; metadata?: any }>, agentId: string = 'system'): Promise<ZoneFile[]> {
    return this.fileService.addFiles(zoneId, files, agentId);
  }

  public async removeFile(zoneId: string, fileId: string, agentId: string = 'system'): Promise<boolean> {
    return this.fileService.removeFile(zoneId, fileId, agentId);
  }

  public shouldRefreshFile(file: ZoneFile): boolean {
    return this.fileService.shouldRefreshFile(file);
  }

  public async getFileWithContent(zoneId: string, fileId: string): Promise<{ file: ZoneFile | null; content: string | null; cacheHit: boolean }> {
    return this.fileService.getFileWithContent(zoneId, fileId);
  }

  public async refreshFile(zoneId: string, fileId: string, force: boolean = false, agentId: string = 'system'): Promise<ZoneFile> {
    return this.fileService.refreshFile(zoneId, fileId, force, agentId);
  }

  public async fetchUrlMetadata(zoneId: string, fileId: string): Promise<{ title?: string; favicon?: string; description?: string }> {
    return this.fileService.fetchUrlMetadata(zoneId, fileId);
  }

  public async searchFiles(zoneId: string, keyword: string): Promise<ZoneFile[]> {
    return this.fileService.searchFiles(zoneId, keyword);
  }

  public async getFileVersions(zoneId: string, fileId: string): Promise<{ versions: FileVersion[]; currentVersionId?: string }> {
    return this.fileService.getFileVersions(zoneId, fileId);
  }

  public async updateFileWithVersion(zoneId: string, fileId: string, newContent: string, description?: string, agentId: string = 'system'): Promise<ZoneFile> {
    return this.fileService.updateFileWithVersion(zoneId, fileId, newContent, description, agentId);
  }

  public async rollbackFileToVersion(zoneId: string, fileId: string, versionId: string, agentId: string = 'system'): Promise<ZoneFile> {
    return this.fileService.rollbackFileToVersion(zoneId, fileId, versionId, agentId);
  }

  public async scanFolder(
    zoneId: string,
    folderPath: string,
    recursive: boolean = false,
    extensions?: string[],
    agentId: string = 'system'
  ): Promise<ZoneFile[]> {
    return this.fileService.scanFolder(zoneId, folderPath, recursive, extensions, agentId);
  }

  // ============================================
  // Zone Statistics
  // ============================================
  public async getZoneStatistics(zoneId: string): Promise<{
    tasks: { total: number; pending: number; in_progress: number; done: number };
    files: { total: number };
    members: { total: number };
  }> {
    await this.ensureInitialized();
    const zone = zoneRepository.getZone(zoneId);
    if (!zone) {
      throw new Error(`Zone not found: ${zoneId}`);
    }

    const tasks = zoneRepository.getTasks(zoneId);
    const taskStats = {
      total: tasks.length,
      pending: tasks.filter(t => t.status === 'pending').length,
      in_progress: tasks.filter(t => t.status === 'in_progress').length,
      done: tasks.filter(t => t.status === 'done').length
    };

    const fileStats = {
      total: zone.files?.length || 0
    };

    const memberStats = {
      total: zone.members?.length || 0
    };

    return {
      tasks: taskStats,
      files: fileStats,
      members: memberStats
    };
  }

  // ============================================
  // Zone Tasks (delegated to ZoneTaskService)
  // ============================================
  public async getTasks(zoneId: string, limit?: number, offset?: number): Promise<ZoneTask[]> {
    return this.taskService.getTasks(zoneId, limit, offset);
  }

  public async getTasksCount(zoneId: string): Promise<number> {
    return this.taskService.getTasksCount(zoneId);
  }

  public async getTask(zoneId: string, taskId: string): Promise<ZoneTask | null> {
    return this.taskService.getTask(zoneId, taskId);
  }

  public async createTask(zoneId: string, agentId: string, title: string): Promise<ZoneTask> {
    return this.taskService.createTask(zoneId, agentId, title);
  }

  public async updateTask(zoneId: string, taskId: string, agentId: string, updates: ZoneTaskUpdateRequest): Promise<ZoneTask> {
    return this.taskService.updateTask(zoneId, taskId, agentId, updates);
  }

  public async deleteTask(zoneId: string, taskId: string, agentId: string): Promise<boolean> {
    return this.taskService.deleteTask(zoneId, taskId, agentId);
  }

  public async claimTask(zoneId: string, taskId: string, agentId: string): Promise<ZoneTask> {
    return this.taskService.claimTask(zoneId, taskId, agentId);
  }

  public async createTasksBatch(
    zoneId: string,
    agentId: string,
    titles: string[]
  ): Promise<{ success: ZoneTask[]; failed: Array<{ title: string; error: string }> }> {
    return this.taskService.createTasksBatch(zoneId, agentId, titles);
  }

  public async updateTasksBatch(
    zoneId: string,
    agentId: string,
    updates: Array<{ taskId: string; title?: string; status?: string; assignee?: string | null }>
  ): Promise<{ success: ZoneTask[]; failed: Array<{ taskId: string; error: string }> }> {
    return this.taskService.updateTasksBatch(zoneId, agentId, updates);
  }

  // ============================================
  // Zone Messages (delegated to ZoneMessageService)
  // ============================================
  public async getMessages(zoneId: string, limit: number = 100, offset: number = 0): Promise<ZoneMessage[]> {
    return this.messageService.getMessages(zoneId, limit, offset);
  }

  public async getMessagesCount(zoneId: string): Promise<number> {
    return this.messageService.getMessagesCount(zoneId);
  }

  public async addMessage(zoneId: string, senderId: string, senderType: 'user' | 'agent', content: string): Promise<ZoneMessage> {
    return this.messageService.addMessage(zoneId, senderId, senderType, content);
  }

  // ============================================
  // Zone Template Export/Import
  // ============================================

  /**
   * Export Zone as template (JSON)
   */
  public async exportZone(zoneId: string): Promise<{ version: string; exportedAt: number; zone: { title: string; prompt: string; files: Array<{ name: string; sourceType: 'local' | 'url'; source: string }>; tasks: Array<{ title: string }> } }> {
    await this.ensureInitialized();

    const zone = zoneRepository.getZone(zoneId);
    if (!zone) {
      throw new Error(`Zone not found: ${zoneId}`);
    }

    const exportData = zoneRepository.exportZone(zoneId);
    if (!exportData) {
      throw new Error(`Failed to export zone: ${zoneId}`);
    }

    return {
      version: '1.0',
      exportedAt: Date.now(),
      zone: exportData
    };
  }

  /**
   * Clone a Zone (duplicate within same project)
   */
  public async cloneZone(zoneId: string, options?: { includeFiles?: boolean; includeTasks?: boolean }, agentId: string = 'system'): Promise<Zone> {
    await this.ensureInitialized();

    this.checkPermission('clone', `zone:${zoneId}`, agentId);

    const sourceZone = zoneRepository.getZone(zoneId);
    if (!sourceZone) {
      throw new Error(`Zone not found: ${zoneId}`);
    }

    // Create new zone with cloned title
    const cloneTitle = `Clone of ${sourceZone.title}`;
    if (!sourceZone.projectId) {
      throw new Error(`Cannot clone zone ${zoneId}: missing projectId`);
    }
    const newZone = zoneRepository.createZone(sourceZone.projectId, cloneTitle, sourceZone.prompt || '');
    this.syncZoneToStore(newZone);

    // Clone files if requested
    if (options?.includeFiles) {
      const files = zoneRepository.getFilesByZone(zoneId);
      for (const file of files) {
        try {
          await this.addFile(newZone.id, file.name, file.sourceType as 'local' | 'url', file.source || '', undefined, agentId);
        } catch (error) {
          console.warn(`[ZoneService] Failed to clone file ${file.name}:`, error);
        }
      }
    }

    // Clone tasks if requested
    if (options?.includeTasks) {
      const tasks = zoneRepository.getTasks(zoneId);
      for (const task of tasks) {
        try {
          zoneRepository.createTask(newZone.id, task.title, task.createdBy);
        } catch (error) {
          console.warn(`[ZoneService] Failed to clone task "${task.title}":`, error);
        }
      }
    }

    return zoneRepository.getZone(newZone.id)!;
  }

  /**
   * Import Zone from template
   */
  public async importZone(projectId: string, template: { title: string; prompt: string; files?: Array<{ name: string; sourceType: 'local' | 'url'; source: string }>; tasks?: Array<{ title: string }> }, creatorAgentId?: string, agentId: string = 'system'): Promise<Zone> {
    await this.ensureInitialized();

    this.checkPermission('import', `project:${projectId}`, agentId);

    // Verify project exists
    const project = projectRepository.getProject(projectId);
    if (!project) {
      throw new Error(`Project not found: ${projectId}`);
    }

    // Create zone from template
    const zone = zoneRepository.createZone(projectId, template.title, template.prompt);
    this.syncZoneToStore(zone);

    // Add files if provided
    if (template.files && template.files.length > 0) {
      for (const file of template.files) {
        try {
          await this.addFile(zone.id, file.name, file.sourceType, file.source, undefined, agentId);
        } catch (error) {
          console.warn(`[ZoneService] Failed to add file ${file.name} during import:`, error);
        }
      }
    }

    // Create tasks if provided
    if (template.tasks && template.tasks.length > 0 && creatorAgentId) {
      for (const task of template.tasks) {
        try {
          zoneRepository.createTask(zone.id, task.title, creatorAgentId);
        } catch (error) {
          console.warn(`[ZoneService] Failed to create task "${task.title}" during import:`, error);
        }
      }
    }

    return zoneRepository.getZone(zone.id)!;
  }
}

export const zoneService = new ZoneService();
