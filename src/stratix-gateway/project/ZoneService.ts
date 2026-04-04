import fs from 'fs';
import path from 'path';

import { projectRepository } from '../../stratix-database/ProjectRepository';
import { zoneRepository } from '../../stratix-database/ZoneRepository';
import { Zone, ZoneFile, FileType, ZoneTask, ZoneTaskCreateRequest, ZoneTaskUpdateRequest, ZoneMessage, ZoneMessageCreateRequest, FileVersion } from '../../stratix-project/types';
import { gatewayEventBus } from '../GatewayEventBus';
import { stratixStateStore, ZoneState } from '../../stratix-core/state';
import { PermissionOrchestrator, PermissionContext } from '../../stratix-core/permission';

export interface ZoneFileBatchRequest {
  files: Array<{
    name: string;
    sourceType: 'local' | 'url';
    source: string;
    fileType?: FileType;
    metadata?: any;
  }>;
}

export class ZoneService {
  private initialized: boolean = false;
  private permissionOrchestrator: PermissionOrchestrator | null = null;

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

  // 文件缓存配置
  private cacheExpiry: number = 3600000; // 1小时
  private maxFileSize: number = 10 * 1024 * 1024; // 10MB
  private allowedBasePaths: string[] = [];
  // URL 抓取安全配置
  private allowedUrlPatterns: RegExp[] = []; // 允许的 URL 正则模式
  private blockedIpRanges: string[] = [
    '127.0.0.0/8',   // localhost
    '10.0.0.0/8',    // private
    '172.16.0.0/12', // private
    '192.168.0.0/16', // private
    '169.254.0.0/16', // link-local
    '0.0.0.0/8'      // current network
  ];

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

  private checkPermission(action: string, zoneId: string, agentId: string): void {
    if (!this.permissionOrchestrator) return;
    const context: PermissionContext = {
      action,
      resource: `zone:${zoneId}`,
      agentId,
      params: { zoneId },
    };
    const result = this.permissionOrchestrator.decide(context);
    if (result.decision === 'deny') {
      throw new Error(`Permission denied: ${action} on zone ${zoneId} by agent ${agentId}`);
    }
    // 'ask' also throws — caller must handle user confirmation separately
    if (result.decision === 'ask') {
      throw new Error(`Permission requires confirmation: ${action} on zone ${zoneId}`);
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
    if (options.cacheExpiry !== undefined) {
      this.cacheExpiry = options.cacheExpiry;
    }
    if (options.maxFileSize !== undefined) {
      this.maxFileSize = options.maxFileSize;
    }
    if (options.allowedBasePaths !== undefined) {
      this.allowedBasePaths = options.allowedBasePaths;
    }
    if (options.allowedUrlPatterns !== undefined) {
      this.allowedUrlPatterns = options.allowedUrlPatterns.map(p => new RegExp(p));
    }
    if (options.blockedIpRanges !== undefined) {
      this.blockedIpRanges = options.blockedIpRanges;
    }
    console.log('[ZoneService] File cache configured:', {
      cacheExpiry: this.cacheExpiry,
      maxFileSize: this.maxFileSize,
      allowedBasePaths: this.allowedBasePaths,
      allowedUrlPatterns: this.allowedUrlPatterns.map(r => r.source),
      blockedIpRanges: this.blockedIpRanges
    });
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
    return created;
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
    gatewayEventBus.publishZoneEvent('zone:updated', zoneId, updated.projectId || zoneId, {
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
      gatewayEventBus.publishZoneEvent('zone:deleted', zoneId, zone.projectId || zoneId, {
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
    gatewayEventBus.publishZoneEvent('zone:restored', zoneId, zone.id, {
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
        zoneRepository.permanentlyDeleteZone(zone.id);
        this.removeZoneFromStore(zone.id);
        deleted++;
      } catch (error) {
        console.warn(`[ZoneService] Failed to permanently delete zone ${zone.id}:`, error);
        failed++;
      }
    }

    return { deleted, failed };
  }

  // Zone Members
  public async addMember(zoneId: string, agentId: string, requesterId: string = 'system'): Promise<Zone> {
    await this.ensureInitialized();

    this.checkPermission('add_member', `zone:${zoneId}`, requesterId);

    const zone = zoneRepository.addMember(zoneId, agentId);
    if (!zone) {
      throw new Error(`Zone not found: ${zoneId}`);
    }

    // Sync to StratixStateStore
    this.syncZoneToStore(zone);

    // Publish zone:member_joined event
    gatewayEventBus.publishZoneEvent('zone:member_joined', zoneId, zone.id, {
      agentId
    });

    return zone;
  }

  public async removeMember(zoneId: string, agentId: string, requesterId: string = 'system'): Promise<Zone> {
    await this.ensureInitialized();

    this.checkPermission('remove_member', `zone:${zoneId}`, requesterId);

    const zone = zoneRepository.removeMember(zoneId, agentId);
    if (!zone) {
      throw new Error(`Zone not found: ${zoneId}`);
    }

    // Sync to StratixStateStore
    this.syncZoneToStore(zone);

    // Publish zone:member_left event
    gatewayEventBus.publishZoneEvent('zone:member_left', zoneId, zone.id, {
      agentId
    });

    return zone;
  }

  public async addMembers(zoneId: string, agentIds: string[], requesterId: string = 'system'): Promise<Zone> {
    await this.ensureInitialized();

    this.checkPermission('add_members', `zone:${zoneId}`, requesterId);

    const zone = zoneRepository.addMembers(zoneId, agentIds);
    if (!zone) {
      throw new Error(`Zone not found: ${zoneId}`);
    }

    // Sync to StratixStateStore
    this.syncZoneToStore(zone);

    // Publish events for each member joined
    for (const agentId of agentIds) {
      gatewayEventBus.publishZoneEvent('zone:member_joined', zoneId, zone.id, {
        agentId
      });
    }

    return zone;
  }

  public async removeMembers(zoneId: string, agentIds: string[], requesterId: string = 'system'): Promise<Zone> {
    await this.ensureInitialized();

    this.checkPermission('remove_members', `zone:${zoneId}`, requesterId);

    const zone = zoneRepository.removeMembers(zoneId, agentIds);
    if (!zone) {
      throw new Error(`Zone not found: ${zoneId}`);
    }

    // Sync to StratixStateStore
    this.syncZoneToStore(zone);

    // Publish events for each member left
    for (const agentId of agentIds) {
      gatewayEventBus.publishZoneEvent('zone:member_left', zoneId, zone.id, {
        agentId
      });
    }

    return zone;
  }

  // Zone Files
  public async addFile(
    zoneId: string,
    name: string,
    sourceType: 'local' | 'url',
    source: string,
    fileType?: FileType,
    agentId: string = 'system'
  ): Promise<ZoneFile> {
    await this.ensureInitialized();

    this.checkPermission('add_file', `zone:${zoneId}`, agentId);

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
    gatewayEventBus.publishZoneEvent('zone:file_added', zoneId, zone.id, {
      file: finalFile
    });

    return finalFile;
  }

  /**
   * Batch add files to a Zone
   */
  public async addFiles(zoneId: string, files: Array<{ name: string; sourceType: 'local' | 'url'; source: string; fileType?: FileType; metadata?: any }>, agentId: string = 'system'): Promise<ZoneFile[]> {
    await this.ensureInitialized();

    this.checkPermission('add_files', `zone:${zoneId}`, agentId);

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
      gatewayEventBus.publishZoneEvent('zone:file_added', zoneId, zone.id, {
        file
      });
    }

    return addedFiles;
  }

  public async removeFile(zoneId: string, fileId: string, agentId: string = 'system'): Promise<boolean> {
    await this.ensureInitialized();

    this.checkPermission('remove_file', `zone:${zoneId}`, agentId);

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
      gatewayEventBus.publishZoneEvent('zone:file_removed', zoneId, zone.id, {
        fileId,
        fileName: file?.name
      });
    }

    return deleted;
  }

  /**
   * Check if file content should be refreshed based on cache expiry
   */
  public shouldRefreshFile(file: ZoneFile): boolean {
    // Always refresh if no content cached
    if (!file.content) {
      return true;
    }

    // Check if cache has expired
    if (file.lastFetched) {
      const age = Date.now() - file.lastFetched;
      return age > this.cacheExpiry;
    }

    // If no lastFetched timestamp but has content, still refresh to be safe
    return true;
  }

  /**
   * Get file content with automatic cache refresh if stale
   * Returns the file with updated content if refresh happened, or the original file if cache is valid
   */
  public async getFileWithContent(zoneId: string, fileId: string): Promise<{ file: ZoneFile | null; content: string | null; cacheHit: boolean }> {
    const file = zoneRepository.getFile(fileId);
    if (!file || file.zoneId !== zoneId) {
      return { file: null, content: null, cacheHit: false };
    }

    // If cache is still valid, return existing content
    if (!this.shouldRefreshFile(file)) {
      return { file, content: file.content ?? null, cacheHit: true };
    }

    // Cache is stale, fetch new content
    let newContent: string | null = null;
    if (file.sourceType === 'local') {
      try {
        newContent = await this.readLocalFile(file.source);
      } catch (error) {
        console.warn(`[ZoneService] Failed to read local file ${file.source}:`, error);
        // Return stale cache if refresh fails
        return { file, content: file.content ?? null, cacheHit: false };
      }
    } else if (file.sourceType === 'url') {
      try {
        newContent = await this.fetchUrl(file.source);
      } catch (error) {
        console.warn(`[ZoneService] Failed to fetch URL ${file.source}:`, error);
        // Return stale cache if refresh fails
        return { file, content: file.content ?? null, cacheHit: false };
      }
    }

    // Update database with new content
    if (newContent !== null) {
      const updated = zoneRepository.updateFile(fileId, {
        content: newContent,
        lastFetched: Date.now()
      });
      if (updated) {
        return { file: updated, content: newContent, cacheHit: false };
      }
    }

    // Fallback to stale cache
    return { file, content: file.content ?? null, cacheHit: false };
  }

  /**
   * Refresh file content from source
   * @param force If true, skip cache expiry check and always refresh
   */
  public async refreshFile(zoneId: string, fileId: string, force: boolean = false, agentId: string = 'system'): Promise<ZoneFile> {
    await this.ensureInitialized();

    this.checkPermission('update_file', `zone:${zoneId}`, agentId);

    const file = zoneRepository.getFile(fileId);
    if (!file || file.zoneId !== zoneId) {
      throw new Error(`File not found: ${fileId} in zone ${zoneId}`);
    }

    // Check cache expiry unless force is true
    if (!force && !this.shouldRefreshFile(file)) {
      console.log(`[ZoneService] File ${fileId} cache still valid, skipping refresh`);
      return file;
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
      // Save version history before updating (only for text files)
      if (content && this.isTextFile(file.fileType)) {
        zoneRepository.addFileVersion(fileId, content, 'Auto-saved on refresh');
      }
      zoneRepository.updateFile(fileId, { content, lastFetched: Date.now() });
    }

    const updated = zoneRepository.getFile(fileId);
    if (!updated) {
      throw new Error(`File not found after update: ${fileId}`);
    }

    return updated;
  }

  // Fetch URL metadata (title, favicon) for URL type files
  public async fetchUrlMetadata(zoneId: string, fileId: string): Promise<{ title?: string; favicon?: string; description?: string }> {
    await this.ensureInitialized();

    const file = zoneRepository.getFile(fileId);
    if (!file || file.zoneId !== zoneId) {
      throw new Error(`File not found: ${fileId} in zone ${zoneId}`);
    }

    if (file.sourceType !== 'url') {
      throw new Error('File is not a URL type');
    }

    try {
      const html = await this.fetchUrl(file.source);

      // Extract title
      const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
      const title = titleMatch ? titleMatch[1].trim() : undefined;

      // Extract description
      const descMatch = html.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']+)["']/i);
      const description = descMatch ? descMatch[1].trim() : undefined;

      // Extract favicon
      let favicon: string | undefined;
      const faviconMatch = html.match(/<link[^>]*rel=["'](?:shortcut )?icon["'][^>]*href=["']([^"']+)["']/i);
      if (faviconMatch) {
        favicon = faviconMatch[1];
        // Handle relative URLs
        if (favicon && !favicon.startsWith('http')) {
          const urlObj = new URL(file.source);
          favicon = favicon.startsWith('/')
            ? `${urlObj.protocol}//${urlObj.host}${favicon}`
            : `${urlObj.protocol}//${urlObj.host}/${favicon}`;
        }
      }

      // Update file metadata
      if (title || description) {
        const newMetadata = { ...file.metadata, title, description, favicon };
        zoneRepository.updateFile(fileId, { metadata: newMetadata });
      }

      return { title, favicon, description };
    } catch (error) {
      console.warn(`[ZoneService] Failed to fetch URL metadata for ${file.source}:`, error);
      return {};
    }
  }

  // Search files by name or content within a zone
  public async searchFiles(zoneId: string, keyword: string): Promise<ZoneFile[]> {
    await this.ensureInitialized();

    // Verify zone exists
    const zone = zoneRepository.getZone(zoneId);
    if (!zone) {
      throw new Error(`Zone not found: ${zoneId}`);
    }

    return zoneRepository.searchFiles(zoneId, keyword);
  }

  // ============================================
  // File Version History
  // ============================================

  /**
   * Check if file type supports version history (text files only)
   */
  private isTextFile(fileType?: FileType): boolean {
    if (!fileType) return false;
    return ['md', 'txt', 'ts', 'js', 'fig', 'link'].includes(fileType);
  }

  /**
   * Get file versions
   */
  public async getFileVersions(zoneId: string, fileId: string): Promise<{ versions: FileVersion[]; currentVersionId?: string }> {
    await this.ensureInitialized();

    const file = zoneRepository.getFile(fileId);
    if (!file || file.zoneId !== zoneId) {
      throw new Error(`File not found: ${fileId} in zone ${zoneId}`);
    }

    const result = zoneRepository.getFileVersions(fileId);
    return result || { versions: [] };
  }

  /**
   * Update file content with version tracking (saves old content as version)
   */
  public async updateFileWithVersion(zoneId: string, fileId: string, newContent: string, description?: string, agentId: string = 'system'): Promise<ZoneFile> {
    await this.ensureInitialized();

    this.checkPermission('update_file', `zone:${zoneId}`, agentId);

    const file = zoneRepository.getFile(fileId);
    if (!file || file.zoneId !== zoneId) {
      throw new Error(`File not found: ${fileId} in zone ${zoneId}`);
    }

    // Only save version for text files that have content
    if (this.isTextFile(file.fileType) && file.content) {
      zoneRepository.addFileVersion(fileId, file.content, description);
    }

    // Update file with new content
    const updated = zoneRepository.updateFile(fileId, { content: newContent, lastFetched: Date.now() });
    if (!updated) {
      throw new Error(`File not found after update: ${fileId}`);
    }

    // Publish file:updated event
    const zone = zoneRepository.getZone(zoneId);
    if (zone) {
      gatewayEventBus.publishZoneEvent('zone:file_updated', zoneId, zone.id, {
        file: updated
      });
    }

    return updated;
  }

  /**
   * Rollback file to a specific version
   */
  public async rollbackFileToVersion(zoneId: string, fileId: string, versionId: string, agentId: string = 'system'): Promise<ZoneFile> {
    await this.ensureInitialized();

    this.checkPermission('rollback_file', `zone:${zoneId}`, agentId);

    const file = zoneRepository.getFile(fileId);
    if (!file || file.zoneId !== zoneId) {
      throw new Error(`File not found: ${fileId} in zone ${zoneId}`);
    }

    const updated = zoneRepository.rollbackFileToVersion(fileId, versionId);
    if (!updated) {
      throw new Error(`Failed to rollback to version: ${versionId}`);
    }

    // Publish file:updated event
    const zone = zoneRepository.getZone(zoneId);
    if (zone) {
      gatewayEventBus.publishZoneEvent('zone:file_updated', zoneId, zone.id, {
        file: updated
      });
    }

    return updated;
  }

  public async scanFolder(
    zoneId: string,
    folderPath: string,
    recursive: boolean = false,
    extensions?: string[],
    agentId: string = 'system'
  ): Promise<ZoneFile[]> {
    await this.ensureInitialized();

    this.checkPermission('scan_folder', `zone:${zoneId}`, agentId);

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

  /**
   * 获取 Zone 的统计信息
   */
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
   * 获取单个 Task
   */
  public async getTask(zoneId: string, taskId: string): Promise<ZoneTask | null> {
    await this.ensureInitialized();
    const zone = zoneRepository.getZone(zoneId);
    if (!zone) {
      throw new Error(`Zone not found: ${zoneId}`);
    }

    const task = zoneRepository.getTask(taskId);
    if (!task || task.zoneId !== zoneId) {
      return null;
    }

    return task;
  }

  /**
   * 创建 Task（只有 taskCreatorId 的 agent 才能创建）
   * 如果没有 taskCreatorId，当前 agent 成为 creator
   */
  public async createTask(zoneId: string, agentId: string, title: string): Promise<ZoneTask> {
    await this.ensureInitialized();

    this.checkPermission('create_task', `zone:${zoneId}`, agentId);

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
    gatewayEventBus.publishZoneEvent('zone:task_created', zoneId, zone.id, {
      task
    });

    return task;
  }

  /**
   * 更新 Task（只有 creator 或 assignee 可以更新）
   */
  public async updateTask(zoneId: string, taskId: string, agentId: string, updates: ZoneTaskUpdateRequest): Promise<ZoneTask> {
    await this.ensureInitialized();

    this.checkPermission('update_task', `zone:${zoneId}`, agentId);

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
    gatewayEventBus.publishZoneEvent('zone:task_updated', zoneId, zone.id, {
      task: updated
    });

    return updated;
  }

  /**
   * 删除 Task（只有 creator 可以删除）
   */
  public async deleteTask(zoneId: string, taskId: string, agentId: string): Promise<boolean> {
    await this.ensureInitialized();

    this.checkPermission('delete_task', `zone:${zoneId}`, agentId);

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
      gatewayEventBus.publishZoneEvent('zone:task_deleted', zoneId, zone.id, {
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

    this.checkPermission('claim_task', `zone:${zoneId}`, agentId);

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
    gatewayEventBus.publishZoneEvent('zone:task_claimed', zoneId, zone.id, {
      taskId,
      assignee: agentId
    });

    return updated;
  }

  /**
   * 批量创建 Tasks
   */
  public async createTasksBatch(
    zoneId: string,
    agentId: string,
    titles: string[]
  ): Promise<{ success: ZoneTask[]; failed: Array<{ title: string; error: string }> }> {
    await this.ensureInitialized();

    this.checkPermission('create_tasks_batch', `zone:${zoneId}`, agentId);

    const zone = zoneRepository.getZone(zoneId);
    if (!zone) {
      throw new Error(`Zone not found: ${zoneId}`);
    }

    const success: ZoneTask[] = [];
    const failed: Array<{ title: string; error: string }> = [];

    for (const title of titles) {
      try {
        const task = zoneRepository.createTask(zoneId, title, agentId);
        success.push(task);

        // Publish task:created event for each task
        gatewayEventBus.publishZoneEvent('zone:task_created', zoneId, zone.id, {
          task
        });
      } catch (error) {
        failed.push({
          title,
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    }

    return { success, failed };
  }

  /**
   * 批量更新 Tasks
   */
  public async updateTasksBatch(
    zoneId: string,
    agentId: string,
    updates: Array<{ taskId: string; title?: string; status?: string; assignee?: string | null }>
  ): Promise<{ success: ZoneTask[]; failed: Array<{ taskId: string; error: string }> }> {
    await this.ensureInitialized();

    this.checkPermission('update_tasks_batch', `zone:${zoneId}`, agentId);

    const zone = zoneRepository.getZone(zoneId);
    if (!zone) {
      throw new Error(`Zone not found: ${zoneId}`);
    }

    const success: ZoneTask[] = [];
    const failed: Array<{ taskId: string; error: string }> = [];

    for (const update of updates) {
      try {
        const task = zoneRepository.getTask(update.taskId);
        if (!task || task.zoneId !== zoneId) {
          throw new Error(`Task not found: ${update.taskId}`);
        }

        // Check permissions
        const ctx = zoneRepository.getZoneContext(zoneId);
        const isCreator = ctx?.taskCreatorId === agentId;
        const isAssignee = task.assignee === agentId;

        if (!isCreator && !isAssignee) {
          throw new Error('只有任务创建者或认领者可以更新任务');
        }

        const updated = zoneRepository.updateTask(update.taskId, {
          title: update.title,
          status: update.status as any,
          assignee: update.assignee
        });

        if (updated) {
          success.push(updated);

          // Publish task:updated event
          gatewayEventBus.publishZoneEvent('zone:task_updated', zoneId, zone.id, {
            task: updated
          });
        }
      } catch (error) {
        failed.push({
          taskId: update.taskId,
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    }

    return { success, failed };
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

    this.checkPermission('add_message', `zone:${zoneId}`, senderId);

    const zone = zoneRepository.getZone(zoneId);
    if (!zone) {
      throw new Error(`Zone not found: ${zoneId}`);
    }

    const message = zoneRepository.addMessage(zoneId, senderId, senderType, content);

    // Publish message:added event
    gatewayEventBus.publishZoneEvent('zone:message_added', zoneId, zone.id, {
      message
    });

    return message;
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

  // Helper: Validate file path security (prevent path traversal)
  private validateFilePath(filePath: string): void {
    // Check for path traversal attempts
    const normalized = path.normalize(filePath);
    if (normalized.includes('..')) {
      throw new Error(`Path traversal not allowed: ${filePath}`);
    }

    // If allowedBasePaths is configured, verify file is within allowed paths
    if (this.allowedBasePaths.length > 0) {
      const isAllowed = this.allowedBasePaths.some(basePath => {
        const normalizedBase = path.normalize(basePath);
        return normalized.startsWith(normalizedBase);
      });
      if (!isAllowed) {
        throw new Error(`File path not in allowed directories: ${filePath}`);
      }
    }
  }

  // Helper: Get file size
  private async getFileSize(filePath: string): Promise<number> {
    return new Promise((resolve, reject) => {
      fs.stat(filePath, (err, stats) => {
        if (err) reject(err);
        else resolve(stats.size);
      });
    });
  }

  // Helper: Read local file content with size check and chunking for large files
  private async readLocalFile(filePath: string): Promise<string> {
    // Validate path security
    this.validateFilePath(filePath);

    // Check file size
    const size = await this.getFileSize(filePath);
    if (size > this.maxFileSize) {
      throw new Error(`File too large: ${size} bytes (max: ${this.maxFileSize} bytes)`);
    }

    // For large files (>1MB), read in chunks
    if (size > 1024 * 1024) {
      return this.readFileWithChunk(filePath);
    }

    // For normal files, read directly
    return new Promise((resolve, reject) => {
      fs.readFile(filePath, 'utf-8', (err, data) => {
        if (err) reject(err);
        else resolve(data);
      });
    });
  }

  // Helper: Read large file in chunks
  private async readFileWithChunk(filePath: string): Promise<string> {
    const chunkSize = 512 * 1024; // 512KB per chunk
    const chunks: string[] = [];
    let totalSize = 0;

    return new Promise((resolve, reject) => {
      const stream = fs.createReadStream(filePath, { encoding: 'utf-8', highWaterMark: chunkSize });

      stream.on('data', (chunk: string | Buffer) => {
        const chunkStr = typeof chunk === 'string' ? chunk : chunk.toString('utf-8');
        chunks.push(chunkStr);
        totalSize += chunkStr.length;
      });

      stream.on('end', () => {
        resolve(chunks.join(''));
      });

      stream.on('error', (err) => {
        reject(err);
      });
    });
  }

  // Helper: Fetch URL content with SSRF protection
  private async fetchUrl(url: string): Promise<string> {
    // Check for blocked protocols
    const parsedUrl = new URL(url);
    if (parsedUrl.protocol === 'file:') {
      throw new Error('File protocol not allowed for URL fetch');
    }

    // If allowed patterns are configured, check against them
    if (this.allowedUrlPatterns.length > 0) {
      const isAllowed = this.allowedUrlPatterns.some(pattern => pattern.test(url));
      if (!isAllowed) {
        throw new Error(`URL not in allowed patterns: ${url}`);
      }
    }

    // Check for private IP ranges (basic SSRF protection)
    // Note: This is a simplified check. For production, use a proper IP library.
    const hostname = parsedUrl.hostname;
    if (this.isPrivateIp(hostname)) {
      throw new Error(`Private IP not allowed: ${hostname}`);
    }

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    return response.text();
  }

  // Helper: Check if hostname is a private IP
  private isPrivateIp(hostname: string): boolean {
    // Check for IPv4
    const ipv4Pattern = /^(\d{1,3}\.){3}\d{1,3}$/;
    if (ipv4Pattern.test(hostname)) {
      const parts = hostname.split('.').map(Number);
      const ip = parts[0] * 256 * 256 * 256 + parts[1] * 256 * 256 + parts[2] * 256 + parts[3];

      for (const cidr of this.blockedIpRanges) {
        if (this.ipInCidr(hostname, cidr)) {
          return true;
        }
      }
    }
    return false;
  }

  // Helper: Check if IP is in CIDR range (simplified)
  private ipInCidr(ip: string, cidr: string): boolean {
    const [range, bitsStr] = cidr.split('/');
    const bits = parseInt(bitsStr, 10);

    const ipParts = ip.split('.').map(Number);
    const rangeParts = range.split('.').map(Number);

    const ipNum = (ipParts[0] << 24) | (ipParts[1] << 16) | (ipParts[2] << 8) | ipParts[3];
    const rangeNum = (rangeParts[0] << 24) | (rangeParts[1] << 16) | (rangeParts[2] << 8) | rangeParts[3];

    const mask = bits === 0 ? 0 : ~((1 << (32 - bits)) - 1);

    return (ipNum & mask) === (rangeNum & mask);
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
