/**
 * Electron 协议路由配置
 * 
 * 定义所有需要拦截和透传的资源路径
 * 用于 Electron 主进程的协议处理器
 */

export interface ProtocolRouteConfig {
  /**
   * 处理方式
   * - file: 拦截并映射到本地文件
   * - pass: 透传，不做处理
   */
  handler: 'file' | 'pass';
  
  /**
   * 本地基础目录（仅 handler='file' 时有效）
   */
  baseDir?: string;
  
  /**
   * 是否启用安全检查（仅 handler='file' 时有效）
   */
  securityCheck?: boolean;
  
  /**
   * 功能描述
   */
  description: string;
}

/**
 * 协议路由拦截表
 * 
 * 规则说明：
 * 1. 精准匹配路径前缀，避免误拦截
 * 2. 拦截规则按优先级从上到下匹配
 * 3. 未匹配的路径默认透传
 */
export const PROTOCOL_ROUTES: Record<string, ProtocolRouteConfig> = {
  // ==================== 拦截规则（本地数据资源） ====================
  
  /**
   * 角色纹理图片
   * 
   * - 来源：CharacterCreator 生成、RTS 加载
   * - 格式：PNG (832×3456)
   * - 存储：stratix-data/textures/{characterId}.png
   * - 访问：/textures/{characterId}.png
   * 
   * 示例：
   * - /textures/char_1234567890_abc123.png
   * - /textures/char_9876543210_def456.png
   */
  '/textures/': {
    handler: 'file',
    baseDir: 'textures',
    securityCheck: true,
    description: '角色完整雪碧图'
  },

  /**
   * 角色头像缩略图（未来扩展）
   * 
   * - 来源：CharacterCreator 生成
   * - 格式：PNG (128×128)
   * - 存储：stratix-data/thumbnails/{characterId}.png
   * - 访问：/thumbnails/{characterId}.png
   * 
   * 示例：
   * - /thumbnails/char_1234567890_abc123.png
   */
  '/thumbnails/': {
    handler: 'file',
    baseDir: 'thumbnails',
    securityCheck: true,
    description: '角色头像缩略图（预留）'
  },

  // ==================== 透传规则 ====================
  
  /**
   * 前端静态资源
   * 
   * - 开发环境：由 Vite Dev Server 提供
   * - 生产环境：由文件服务器提供
   * - 包含：图片、字体、图标等
   * 
   * 示例：
   * - /assets/logo.png
   * - /assets/fonts/inter.woff2
   */
  '/assets/': {
    handler: 'pass',
    description: '前端静态资源'
  },

  /**
   * API 接口
   * 
   * - 由内嵌 Gateway 服务处理
   * - 路由：/api/stratix/*
   * - 健康检查：/health
   * 
   * 示例：
   * - /api/stratix/config/agent/list
   * - /api/stratix/texture/upload
   */
  '/api/': {
    handler: 'pass',
    description: 'HTTP API 接口'
  },

  /**
   * 健康检查
   * 
   * - 由内嵌 Gateway 服务处理
   * - 路径：/health
   */
  '/health': {
    handler: 'pass',
    description: '服务健康检查'
  },

  /**
   * Vite HMR（仅开发环境）
   * 
   * - Vite 热更新相关资源
   * - WebSocket 连接
   * 
   * 示例：
   * - /@vite/client
   * - /@vite/env
   */
  '/@vite/': {
    handler: 'pass',
    description: 'Vite 热更新'
  },

  /**
   * Node 模块（仅开发环境）
   * 
   * - Vite Dev Server 访问 node_modules
   * 
   * 示例：
   * - /node_modules/vue/dist/vue.runtime.esm-bundler.js
   */
  '/node_modules/': {
    handler: 'pass',
    description: 'Node 模块访问'
  }
};

/**
 * 路由匹配器
 * 
 * 用于快速匹配 URL 到路由配置
 */
export class ProtocolRouteMatcher {
  /**
   * 匹配路由配置
   * 
   * @param url 请求 URL
   * @returns 匹配的路由配置，如果没有匹配则返回 null
   */
  static match(url: string): { prefix: string; config: ProtocolRouteConfig } | null {
    // 遍历所有路由规则
    for (const [prefix, config] of Object.entries(PROTOCOL_ROUTES)) {
      // 精准匹配前缀
      if (url.startsWith(prefix) || url.includes(prefix)) {
        return { prefix, config };
      }
    }
    
    // 未匹配到任何规则
    return null;
  }
  
  /**
   * 检查是否为文件类型路由
   */
  static isFileRoute(url: string): boolean {
    const match = this.match(url);
    return match?.config.handler === 'file';
  }
  
  /**
   * 检查是否为透传路由
   */
  static isPassRoute(url: string): boolean {
    const match = this.match(url);
    return match?.config.handler === 'pass' || match === null;
  }
}

/**
 * 获取所有文件类型路由
 */
export function getFileRoutes(): Array<{ prefix: string; config: ProtocolRouteConfig }> {
  return Object.entries(PROTOCOL_ROUTES)
    .filter(([, config]) => config.handler === 'file')
    .map(([prefix, config]) => ({ prefix, config }));
}

/**
 * 获取所有透传类型路由
 */
export function getPassRoutes(): Array<{ prefix: string; config: ProtocolRouteConfig }> {
  return Object.entries(PROTOCOL_ROUTES)
    .filter(([, config]) => config.handler === 'pass')
    .map(([prefix, config]) => ({ prefix, config }));
}
