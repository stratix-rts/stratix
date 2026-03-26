import { Zone, ZoneFile, FileType, ZoneTask, ZoneTaskCreateRequest, ZoneTaskUpdateRequest, ZoneMessage, ZoneMessageCreateRequest } from '../../stratix-project/types';

export interface ZoneFileBatchRequest {
  files: Array<{
    name: string;
    sourceType: 'local' | 'url';
    source: string;
    fileType?: FileType;
    metadata?: any;
  }>;
}
import { zoneRepository } from '../../stratix-database/ZoneRepository';
import { projectRepository } from '../../stratix-database/ProjectRepository';
import { gatewayEventBus } from '../GatewayEventBus';
import fs from 'fs';
import path from 'path';

export class ZoneService {
  private initialized: boolean = false;

  public async initialize(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;
    console.log('[ZoneService] Initialized');
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

  public async createZone(projectId: string, title: string, prompt: string = ''): Promise<Zone> {
    await this.ensureInitialized();

    // Verify project exists
    const project = projectRepository.getProject(projectId);
    if (!project) {
      throw new Error(`Project not found: ${projectId}`);
    }

    return zoneRepository.createZone(projectId, title, prompt);
  }

  public async updateZone(zoneId: string, updates: { title?: string; prompt?: string }): Promise<Zone> {
    await this.ensureInitialized();

    const updated = zoneRepository.updateZone(zoneId, updates);
    if (!updated) {
      throw new Error(`Zone not found: ${zoneId}`);
    }

    // Publish zone:updated event
    gatewayEventBus.publishZoneEvent('zone:updated', zoneId, updated.projectId, {
      title: updated.title,
      prompt: updated.prompt
    });

    return updated;
  }

  public async deleteZone(zoneId: string): Promise<boolean> {
    await this.ensureInitialized();

    // Get zone info before soft delete for event publishing
    const zone = zoneRepository.getZone(zoneId);
    if (!zone) {
      return false;
    }

    const deleted = zoneRepository.deleteZone(zoneId);
    if (deleted) {
      // Publish zone:deleted event
      gatewayEventBus.publishZoneEvent('zone:deleted', zoneId, zone.projectId, {
        title: zone.title
      });
    }

    return deleted;
  }

  // Zone Members
  public async addMember(zoneId: string, agentId: string): Promise<Zone> {
    await this.ensureInitialized();

    const zone = zoneRepository.addMember(zoneId, agentId);
    if (!zone) {
      throw new Error(`Zone not found: ${zoneId}`);
    }

    // Publish zone:member_joined event
    gatewayEventBus.publishZoneEvent('zone:member_joined', zoneId, zone.projectId, {
      agentId
    });

    return zone;
  }

  public async removeMember(zoneId: string, agentId: string): Promise<Zone> {
    await this.ensureInitialized();

    const zone = zoneRepository.removeMember(zoneId, agentId);
    if (!zone) {
      throw new Error(`Zone not found: ${zoneId}`);
    }

    // Publish zone:member_left event
    gatewayEventBus.publishZoneEvent('zone:member_left', zoneId, zone.projectId, {
      agentId
    });

    return zone;
  }

  // Zone Files
  public async addFile(
    zoneId: string,
    name: string,
    sourceType: 'local' | 'url',
    source: string,
    fileType?: FileType
  ): Promise<ZoneFile> {
    await this.ensureInitialized();

    // Verify zone exists
    const zone = zoneRepository.getZone(zoneId);
    if (!zone) {
      throw new Error(`Zone not found: ${zoneId}`);
    }

    // For local files, try to read content
    let content: string | undefined;
    if (sourceType === 'local') {
      try {
        content = await this.readLocalFile(source);
      } catch (error) {
        console.warn(`[ZoneService] Failed to read local file ${source}:`, error);
      }
    }

    const file = zoneRepository.addFile(zoneId, name, sourceType, source, fileType);

    // If content was read, update the file
    if (content) {
      zoneRepository.updateFile(file.id, { content, lastFetched: Date.now() });
    }

    const finalFile = zoneRepository.getFile(file.id)!;

    // Publish zone:file_added event
    gatewayEventBus.publishZoneEvent('zone:file_added', zoneId, zone.projectId, {
      file: finalFile
    });

    return finalFile;
  }

  /**
   * Batch add files to a Zone
   */
  public async addFiles(zoneId: string, files: Array<{ name: string; sourceType: 'local' | 'url'; source: string; fileType?: FileType; metadata?: any }>): Promise<ZoneFile[]> {
    await this.ensureInitialized();

    // Verify zone exists
    const zone = zoneRepository.getZone(zoneId);
    if (!zone) {
      throw new Error(`Zone not found: ${zoneId}`);
    }

    // Add files in batch
    const addedFiles = zoneRepository.addFiles(zoneId, files);

    // Try to read content for local files and update
    for (let i = 0; i < addedFiles.length; i++) {
      const file = addedFiles[i];
      if (file.sourceType === 'local') {
        try {
          const content = await this.readLocalFile(file.source);
          zoneRepository.updateFile(file.id, { content, lastFetched: Date.now() });
          addedFiles[i] = zoneRepository.getFile(file.id)!;
        } catch (error) {
          console.warn(`[ZoneService] Failed to read local file ${file.source}:`, error);
        }
      }
    }

    // Publish zone:file_added event for each file
    for (const file of addedFiles) {
      gatewayEventBus.publishZoneEvent('zone:file_added', zoneId, zone.projectId, {
        file
      });
    }

    return addedFiles;
  }

  public async removeFile(zoneId: string, fileId: string): Promise<boolean> {
    await this.ensureInitialized();

    // Verify zone exists
    const zone = zoneRepository.getZone(zoneId);
    if (!zone) {
      throw new Error(`Zone not found: ${zoneId}`);
    }

    // Get file info and verify it belongs to this zone
    const file = zoneRepository.getFile(fileId);
    if (!file || file.zoneId !== zoneId) {
      throw new Error(`File ${fileId} not found in zone ${zoneId}`);
    }

    const deleted = zoneRepository.deleteFile(fileId);

    if (deleted) {
      // Publish zone:file_removed event
      gatewayEventBus.publishZoneEvent('zone:file_removed', zoneId, zone.projectId, {
        fileId,
        fileName: file?.name
      });
    }

    return deleted;
  }

  public async refreshFile(zoneId: string, fileId: string): Promise<ZoneFile> {
    await this.ensureInitialized();

    const file = zoneRepository.getFile(fileId);
    if (!file || file.zoneId !== zoneId) {
      throw new Error(`File not found: ${fileId} in zone ${zoneId}`);
    }

    let content: string | undefined;
    if (file.sourceType === 'local') {
      try {
        content = await this.readLocalFile(file.source);
      } catch (error) {
        console.warn(`[ZoneService] Failed to refresh local file ${file.source}:`, error);
        throw new Error(`Failed to read local file: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    } else if (file.sourceType === 'url') {
      try {
        content = await this.fetchUrl(file.source);
      } catch (error) {
        console.warn(`[ZoneService] Failed to refresh URL ${file.source}:`, error);
        throw new Error(`Failed to fetch URL: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    }

    if (content !== undefined) {
      zoneRepository.updateFile(fileId, { content, lastFetched: Date.now() });
    }

    const updated = zoneRepository.getFile(fileId);
    if (!updated) {
      throw new Error(`File not found after update: ${fileId}`);
    }

    return updated;
  }

  public async scanFolder(
    zoneId: string,
    folderPath: string,
    recursive: boolean = false,
    extensions?: string[]
  ): Promise<ZoneFile[]> {
    await this.ensureInitialized();

    // Verify zone exists
    const zone = zoneRepository.getZone(zoneId);
    if (!zone) {
      throw new Error(`Zone not found: ${zoneId}`);
    }

    const scannedFiles = await this.scanLocalFolder(folderPath, recursive, extensions);
    const addedFiles: ZoneFile[] = [];

    for (const scanned of scannedFiles) {
      const file = zoneRepository.addFile(
        zoneId,
        scanned.name,
        'local',
        scanned.source,
        scanned.fileType
      );

      // Try to read content
      try {
        const content = await this.readLocalFile(scanned.source);
        zoneRepository.updateFile(file.id, { content, lastFetched: Date.now() });
      } catch (error) {
        console.warn(`[ZoneService] Failed to read scanned file ${scanned.source}:`, error);
      }

      addedFiles.push(zoneRepository.getFile(file.id)!);
    }

    return addedFiles;
  }

  // ============================================
  // Zone Tasks (Task Creator 模式)
  // ============================================

  /**
   * 获取 Zone 的所有 Tasks
   */
  public async getTasks(zoneId: string, limit?: number, offset?: number): Promise<ZoneTask[]> {
    await this.ensureInitialized();
    const zone = zoneRepository.getZone(zoneId);
    if (!zone) {
      throw new Error(`Zone not found: ${zoneId}`);
    }
    return zoneRepository.getTasks(zoneId, limit, offset);
  }

  public async getTasksCount(zoneId: string): Promise<number> {
    await this.ensureInitialized();
    const zone = zoneRepository.getZone(zoneId);
    if (!zone) {
      throw new Error(`Zone not found: ${zoneId}`);
    }
    return zoneRepository.getTasksCount(zoneId);
  }

  /**
   * 创建 Task（只有 taskCreatorId 的 agent 才能创建）
   * 如果没有 taskCreatorId，当前 agent 成为 creator
   */
  public async createTask(zoneId: string, agentId: string, title: string): Promise<ZoneTask> {
    await this.ensureInitialized();
    const zone = zoneRepository.getZone(zoneId);
    if (!zone) {
      throw new Error(`Zone not found: ${zoneId}`);
    }

    // 获取 zone context
    const ctx = zoneRepository.getZoneContext(zoneId);
    if (!ctx) {
      throw new Error(`Zone context not found: ${zoneId}`);
    }

    // 如果没有 creator，当前 agent 成为 creator
    if (!ctx.taskCreatorId) {
      zoneRepository.updateZoneContext(zoneId, { taskCreatorId: agentId });
    } else if (ctx.taskCreatorId !== agentId) {
      throw new Error('只有任务创建者可以创建新任务');
    }

    const task = zoneRepository.createTask(zoneId, title, agentId);

    // Publish task:created event
    gatewayEventBus.publishZoneEvent('zone:task_created', zoneId, zone.projectId, {
      task
    });

    return task;
  }

  /**
   * 更新 Task（只有 creator 或 assignee 可以更新）
   */
  public async updateTask(zoneId: string, taskId: string, agentId: string, updates: ZoneTaskUpdateRequest): Promise<ZoneTask> {
    await this.ensureInitialized();
    const zone = zoneRepository.getZone(zoneId);
    if (!zone) {
      throw new Error(`Zone not found: ${zoneId}`);
    }

    const task = zoneRepository.getTask(taskId);
    if (!task || task.zoneId !== zoneId) {
      throw new Error(`Task not found: ${taskId}`);
    }

    // 检查权限：creator 或 assignee 可以更新
    const ctx = zoneRepository.getZoneContext(zoneId);
    const isCreator = ctx?.taskCreatorId === agentId;
    const isAssignee = task.assignee === agentId;

    if (!isCreator && !isAssignee) {
      throw new Error('只有任务创建者或认领者可以更新任务');
    }

    const updated = zoneRepository.updateTask(taskId, updates);
    if (!updated) {
      throw new Error(`Task not found: ${taskId}`);
    }

    // Publish task:updated event
    gatewayEventBus.publishZoneEvent('zone:task_updated', zoneId, zone.projectId, {
      task: updated
    });

    return updated;
  }

  /**
   * 删除 Task（只有 creator 可以删除）
   */
  public async deleteTask(zoneId: string, taskId: string, agentId: string): Promise<boolean> {
    await this.ensureInitialized();
    const zone = zoneRepository.getZone(zoneId);
    if (!zone) {
      throw new Error(`Zone not found: ${zoneId}`);
    }

    const ctx = zoneRepository.getZoneContext(zoneId);
    if (ctx?.taskCreatorId !== agentId) {
      throw new Error('只有任务创建者可以删除任务');
    }

    const deleted = zoneRepository.deleteTask(taskId);

    if (deleted) {
      gatewayEventBus.publishZoneEvent('zone:task_deleted', zoneId, zone.projectId, {
        taskId
      });
    }

    return deleted;
  }

  /**
   * 认领 Task（设置 assignee + status = in_progress）
   */
  public async claimTask(zoneId: string, taskId: string, agentId: string): Promise<ZoneTask> {
    await this.ensureInitialized();
    const zone = zoneRepository.getZone(zoneId);
    if (!zone) {
      throw new Error(`Zone not found: ${zoneId}`);
    }

    const task = zoneRepository.getTask(taskId);
    if (!task || task.zoneId !== zoneId) {
      throw new Error(`Task not found: ${taskId}`);
    }

    if (task.assignee) {
      throw new Error('任务已被认领');
    }

    if (task.status === 'done') {
      throw new Error('任务已完成，无法认领');
    }

    const updated = zoneRepository.updateTask(taskId, {
      assignee: agentId,
      status: 'in_progress'
    });

    if (!updated) {
      throw new Error(`Task not found: ${taskId}`);
    }

    // Publish task:claimed event
    gatewayEventBus.publishZoneEvent('zone:task_claimed', zoneId, zone.projectId, {
      taskId,
      assignee: agentId
    });

    return updated;
  }

  // ============================================
  // Zone Messages (聊天)
  // ============================================

  /**
   * 获取 Zone 的消息历史
   */
  public async getMessages(zoneId: string, limit: number = 100, offset: number = 0): Promise<ZoneMessage[]> {
    await this.ensureInitialized();
    const zone = zoneRepository.getZone(zoneId);
    if (!zone) {
      throw new Error(`Zone not found: ${zoneId}`);
    }
    return zoneRepository.getMessages(zoneId, limit, offset);
  }

  public async getMessagesCount(zoneId: string): Promise<number> {
    await this.ensureInitialized();
    const zone = zoneRepository.getZone(zoneId);
    if (!zone) {
      throw new Error(`Zone not found: ${zoneId}`);
    }
    return zoneRepository.getMessagesCount(zoneId);
  }

  /**
   * 发送消息
   */
  public async addMessage(zoneId: string, senderId: string, senderType: 'user' | 'agent', content: string): Promise<ZoneMessage> {
    await this.ensureInitialized();
    const zone = zoneRepository.getZone(zoneId);
    if (!zone) {
      throw new Error(`Zone not found: ${zoneId}`);
    }

    const message = zoneRepository.addMessage(zoneId, senderId, senderType, content);

    // Publish message:added event
    gatewayEventBus.publishZoneEvent('zone:message_added', zoneId, zone.projectId, {
      message
    });

    return message;
  }

  // Helper: Read local file content
  private async readLocalFile(filePath: string): Promise<string> {
    return new Promise((resolve, reject) => {
      fs.readFile(filePath, 'utf-8', (err, data) => {
        if (err) reject(err);
        else resolve(data);
      });
    });
  }

  // Helper: Fetch URL content
  private async fetchUrl(url: string): Promise<string> {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    return response.text();
  }

  // Helper: Scan local folder
  private async scanLocalFolder(
    folderPath: string,
    recursive: boolean,
    extensions?: string[]
  ): Promise<{ name: string; source: string; fileType: FileType }[]> {
    return new Promise((resolve, reject) => {
      fs.readdir(folderPath, { withFileTypes: true }, async (err, entries) => {
        if (err) {
          reject(err);
          return;
        }

        const results: { name: string; source: string; fileType: FileType }[] = [];

        for (const entry of entries) {
          const fullPath = path.join(folderPath, entry.name);

          if (entry.isFile()) {
            const ext = path.extname(entry.name).toLowerCase();

            // Filter by extensions if provided
            if (extensions && extensions.length > 0) {
              if (!extensions.some(e => e.toLowerCase() === ext)) {
                continue;
              }
            }

            const fileType = this.getFileType(ext);
            results.push({
              name: entry.name,
              source: fullPath,
              fileType
            });
          } else if (entry.isDirectory() && recursive) {
            try {
              const subFiles = await this.scanLocalFolder(fullPath, recursive, extensions);
              results.push(...subFiles);
            } catch (error) {
              console.warn(`[ZoneService] Failed to scan subfolder ${fullPath}:`, error);
            }
          }
        }

        resolve(results);
      });
    });
  }

  // Helper: Get file type from extension
  private getFileType(ext: string): FileType {
    const typeMap: Record<string, FileType> = {
      '.md': 'md',
      '.txt': 'txt',
      '.ts': 'ts',
      '.tsx': 'ts',
      '.js': 'js',
      '.jsx': 'js',
      '.fig': 'fig',
      '.png': 'image',
      '.jpg': 'image',
      '.jpeg': 'image',
      '.gif': 'image',
      '.svg': 'image',
      '.link': 'link',
      '.folder': 'folder'
    };

    return typeMap[ext] || 'other';
  }
}

export const zoneService = new ZoneService();
