import fs from 'fs';
import path from 'path';

import { zoneRepository } from '../../stratix-database/ZoneRepository';
import { Zone, ZoneFile, FileType, FileVersion } from '../../stratix-project/types';
import { gatewayEventBus } from '../GatewayEventBus';

export class ZoneFileService {
  private cacheExpiry: number = 3600000; // 1小时
  private maxFileSize: number = 10 * 1024 * 1024; // 10MB
  private allowedBasePaths: string[] = [];
  // URL 抓取安全配置 - 默认阻止所有 URL（需要显式配置允许）
  private allowedUrlPatterns: RegExp[] = [/^https?:\/\/[^/]+\.(github\.io|gitlab\.io|bitbucket\.org|jsdelivr\.net|cdn\.jsdelivr\.net|unpkg\.com|skypack\.dev)\//i]; // 默认允许公共 CDN
  private blockedIpRanges: string[] = [
    '127.0.0.0/8',   // localhost
    '10.0.0.0/8',    // private
    '172.16.0.0/12', // private
    '192.168.0.0/16', // private
    '169.254.0.0/16', // link-local
    '0.0.0.0/8'      // current network
  ];

  constructor(
    private checkPermission: (action: string, resource: string, agentId: string) => void,
    private ensureInitialized: () => Promise<void>
  ) {}

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
      this.allowedUrlPatterns = options.allowedUrlPatterns.map(p => {
        try {
          return new RegExp(p);
        } catch {
          console.warn(`[ZoneFileService] Invalid URL pattern ignored: ${p}`);
          return /^$/; // Match nothing
        }
      });
    }
    if (options.blockedIpRanges !== undefined) {
      this.blockedIpRanges = options.blockedIpRanges;
    }
    console.log('[ZoneFileService] File cache configured:', {
      cacheExpiry: this.cacheExpiry,
      maxFileSize: this.maxFileSize,
      allowedBasePaths: this.allowedBasePaths,
      allowedUrlPatterns: this.allowedUrlPatterns.map(r => r.source),
      blockedIpRanges: this.blockedIpRanges
    });
  }

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
        console.warn(`[ZoneFileService] Failed to read local file ${source}:`, error);
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

  public async addFiles(zoneId: string, files: Array<{ name: string; sourceType: 'local' | 'url'; source: string; fileType?: FileType; metadata?: Record<string, unknown> }>, agentId: string = 'system'): Promise<ZoneFile[]> {
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
          console.warn(`[ZoneFileService] Failed to read local file ${file.source}:`, error);
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
        console.warn(`[ZoneFileService] Failed to read local file ${file.source}:`, error);
        // Return stale cache if refresh fails
        return { file, content: file.content ?? null, cacheHit: false };
      }
    } else if (file.sourceType === 'url') {
      try {
        newContent = await this.fetchUrl(file.source);
      } catch (error) {
        console.warn(`[ZoneFileService] Failed to fetch URL ${file.source}:`, error);
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

  public async refreshFile(zoneId: string, fileId: string, force: boolean = false, agentId: string = 'system'): Promise<ZoneFile> {
    await this.ensureInitialized();

    this.checkPermission('update_file', `zone:${zoneId}`, agentId);

    const file = zoneRepository.getFile(fileId);
    if (!file || file.zoneId !== zoneId) {
      throw new Error(`File not found: ${fileId} in zone ${zoneId}`);
    }

    // Check cache expiry unless force is true
    if (!force && !this.shouldRefreshFile(file)) {
      console.log(`[ZoneFileService] File ${fileId} cache still valid, skipping refresh`);
      return file;
    }

    let content: string | undefined;
    if (file.sourceType === 'local') {
      try {
        content = await this.readLocalFile(file.source);
      } catch (error) {
        console.warn(`[ZoneFileService] Failed to refresh local file ${file.source}:`, error);
        throw new Error(`Failed to read local file: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    } else if (file.sourceType === 'url') {
      try {
        content = await this.fetchUrl(file.source);
      } catch (error) {
        console.warn(`[ZoneFileService] Failed to refresh URL ${file.source}:`, error);
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
      console.warn(`[ZoneFileService] Failed to fetch URL metadata for ${file.source}:`, error);
      return {};
    }
  }

  public async searchFiles(zoneId: string, keyword: string): Promise<ZoneFile[]> {
    await this.ensureInitialized();

    // Verify zone exists
    const zone = zoneRepository.getZone(zoneId);
    if (!zone) {
      throw new Error(`Zone not found: ${zoneId}`);
    }

    return zoneRepository.searchFiles(zoneId, keyword);
  }

  public async getFileVersions(zoneId: string, fileId: string): Promise<{ versions: FileVersion[]; currentVersionId?: string }> {
    await this.ensureInitialized();

    const file = zoneRepository.getFile(fileId);
    if (!file || file.zoneId !== zoneId) {
      throw new Error(`File not found: ${fileId} in zone ${zoneId}`);
    }

    const result = zoneRepository.getFileVersions(fileId);
    return result || { versions: [] };
  }

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
        console.warn(`[ZoneFileService] Failed to read scanned file ${scanned.source}:`, error);
      }

      addedFiles.push(zoneRepository.getFile(file.id)!);
    }

    return addedFiles;
  }

  // Helper: Validate file path security (prevent path traversal)
  private validateFilePath(filePath: string): void {
    // Resolve to absolute path to prevent traversal
    const resolved = path.resolve(filePath);
    const normalized = path.normalize(filePath);
    if (normalized.includes('..') || resolved.includes('..')) {
      throw new Error(`Path traversal not allowed: ${filePath}`);
    }

    // If allowedBasePaths is configured, verify file is within allowed paths
    if (this.allowedBasePaths.length > 0) {
      const isAllowed = this.allowedBasePaths.some(basePath => {
        const normalizedBase = path.resolve(basePath);
        return resolved.startsWith(normalizedBase + path.sep) || resolved === normalizedBase;
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
    if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
      throw new Error('Only HTTP/HTTPS protocols allowed for URL fetch');
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

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000); // 30s timeout

    try {
      const response = await fetch(url, { signal: controller.signal });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      const text = await response.text();
      if (text.length > this.maxFileSize) {
        throw new Error(`URL content too large: ${text.length} bytes (max: ${this.maxFileSize} bytes)`);
      }
      return text;
    } finally {
      clearTimeout(timeout);
    }
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
    extensions?: string[],
    currentDepth: number = 0,
    maxDepth: number = 10
  ): Promise<{ name: string; source: string; fileType: FileType }[]> {
    if (currentDepth > maxDepth) {
      console.warn(`[ZoneFileService] Max scan depth ${maxDepth} reached at ${folderPath}`);
      return [];
    }

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
              const subFiles = await this.scanLocalFolder(fullPath, recursive, extensions, currentDepth + 1, maxDepth);
              results.push(...subFiles);
            } catch (error) {
              console.warn(`[ZoneFileService] Failed to scan subfolder ${fullPath}:`, error);
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

  // Helper: Check if file type supports version history (text files only)
  private isTextFile(fileType?: FileType): boolean {
    if (!fileType) return false;
    return ['md', 'txt', 'ts', 'js', 'fig', 'link'].includes(fileType);
  }
}
