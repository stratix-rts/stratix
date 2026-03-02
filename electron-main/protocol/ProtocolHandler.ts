/**
 * Electron 协议处理器
 * 
 * 负责拦截文件协议请求并映射到本地文件
 * 使用精准的路由匹配，避免误拦截
 */

import { app, protocol } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { PROTOCOL_ROUTES, ProtocolRouteMatcher } from './protocolConfig';

export class ProtocolHandler {
  private dataDir: string;
  private initialized: boolean = false;

  constructor(dataDir?: string) {
    this.dataDir = dataDir || path.join(app.getPath('userData'), 'stratix-data');
  }

  register(): void {
    if (this.initialized) {
      console.warn('[ProtocolHandler] Already initialized');
      return;
    }

    app.whenReady().then(() => {
      protocol.interceptFileProtocol('file', (request, callback) => {
        this.handleRequest(request, callback);
      });

      console.log('[ProtocolHandler] File protocol interceptor registered');
      console.log('[ProtocolHandler] Data directory:', this.dataDir);
      this.initialized = true;
      this.logRoutes();
    });
  }

  /**
   * 处理请求
   */
  private handleRequest(
    request: any,
    callback: (response: any) => void
  ): void {
    const url = request.url;
    
    const urlPath = url.replace('file://', '');

    const match = ProtocolRouteMatcher.match(urlPath);

    if (match && match.config.handler === 'file') {
      this.handleLocalFile(urlPath, match.prefix, match.config, callback);
    } else {
      callback({ path: urlPath });
    }
  }

  /**
   * 处理本地文件请求
   */
  private handleLocalFile(
    url: string,
    prefix: string,
    config: any,
    callback: (response: any) => void
  ): void {
    try {
      const relativePath = this.extractRelativePath(url, prefix);
      
      const filePath = path.join(this.dataDir, config.baseDir, relativePath);

      if (config.securityCheck && !this.isPathSafe(filePath, config.baseDir)) {
        console.error(`[ProtocolHandler] Unsafe path blocked: ${filePath}`);
        callback({ error: -2 });
        return;
      }

      if (!fs.existsSync(filePath)) {
        console.warn(`[ProtocolHandler] File not found: ${filePath}`);
        callback({ error: -6 });
        return;
      }

      console.log(`[ProtocolHandler] Serving file: ${filePath}`);
      callback({ path: filePath });

    } catch (error) {
      console.error('[ProtocolHandler] Error handling request:', error);
      callback({ error: -2 });
    }
  }

  /**
   * 提取相对路径
   * 
   * 从 URL 中提取相对于 baseDir 的路径
   * 
   * 示例：
   * - /textures/char_123.png → char_123.png
   * - /textures/subdir/char_123.png → subdir/char_123.png
   */
  private extractRelativePath(url: string, prefix: string): string {
    // 移除查询参数
    let cleanUrl = url.split('?')[0];
    
    // 查找前缀位置
    const prefixIndex = cleanUrl.indexOf(prefix);
    
    if (prefixIndex >= 0) {
      // 提取前缀之后的部分
      return cleanUrl.substring(prefixIndex + prefix.length);
    }
    
    // 如果找不到前缀，返回完整 URL（去掉开头的 /）
    return cleanUrl.replace(/^\//, '');
  }

  /**
   * 路径安全检查
   * 
   * 防止路径穿越攻击
   * 确保请求的文件在允许的目录内
   */
  private isPathSafe(filePath: string, baseDir: string): boolean {
    try {
      // 解析绝对路径
      const resolved = path.resolve(filePath);
      
      // 构建允许的基础目录
      const base = path.join(this.dataDir, baseDir);
      
      // 检查是否在基础目录内
      const isSafe = resolved.startsWith(base);
      
      if (!isSafe) {
        console.warn(`[ProtocolHandler] Path traversal attempt detected: ${filePath}`);
      }
      
      return isSafe;
    } catch (error) {
      console.error('[ProtocolHandler] Path safety check failed:', error);
      return false;
    }
  }

  /**
   * 记录路由信息
   */
  private logRoutes(): void {
    console.log('[ProtocolHandler] Registered routes:');
    
    for (const [prefix, config] of Object.entries(PROTOCOL_ROUTES)) {
      const icon = config.handler === 'file' ? '📁' : '➡️';
      console.log(`  ${icon} ${prefix.padEnd(20)} - ${config.description}`);
    }
  }

  /**
   * 获取数据目录
   */
  getDataDir(): string {
    return this.dataDir;
  }

  /**
   * 设置数据目录（用于测试）
   */
  setDataDir(dataDir: string): void {
    this.dataDir = dataDir;
  }
}
