/**
 * Stratix 服务提供者接口
 * 
 * 定义所有服务的抽象接口，Web 和 Electron 共享
 * 前端通过此接口访问所有服务，无需关心底层实现
 */

import type { StratixAgentConfig, UnifiedOpenClawConfig, CharacterTexture } from '@/stratix-core/stratix-protocol';
import type { ChatResponse } from '@/stratix-openclaw-adapter/types';

/**
 * Tailscale 节点信息
 */
export interface TailscaleNode {
  nodeId: string;
  name: string;
  ipAddress: string;
  online: boolean;
  latency?: number;
}

/**
 * 应用配置
 */
export interface AppConfiguration {
  environment: 'web' | 'electron';
  dataDir: string;
  version: string;
}

/**
 * 服务提供者接口
 */
export interface ServiceProvider {
  // ==================== 环境信息 ====================
  
  /**
   * 获取当前运行环境
   */
  getEnvironment(): 'web' | 'electron';
  
  /**
   * 获取应用配置
   */
  getConfiguration(): AppConfiguration;
  
  // ==================== 数据服务 ====================
  
  /**
   * 保存 Agent 配置
   */
  saveAgent(config: StratixAgentConfig): Promise<void>;
  
  /**
   * 加载 Agent 配置
   */
  loadAgent(id: string): Promise<StratixAgentConfig | null>;
  
  /**
   * 删除 Agent 配置
   */
  deleteAgent(id: string): Promise<void>;
  
  /**
   * 列出所有 Agent 配置
   */
  listAgents(): Promise<StratixAgentConfig[]>;
  
  // ==================== OpenClaw 连接服务 ====================
  
  /**
   * 连接 OpenClaw
   */
  connectOpenClaw(config: UnifiedOpenClawConfig): Promise<boolean>;
  
  /**
   * 发送 OpenClaw 消息
   */
  sendOpenClawMessage(message: string, sessionId?: string): Promise<ChatResponse>;
  
  /**
   * 断开 OpenClaw 连接
   */
  disconnectOpenClaw(): Promise<void>;
  
  /**
   * 获取 OpenClaw 连接状态
   */
  getOpenClawStatus(): Promise<{
    connected: boolean;
    endpoint?: string;
    error?: string;
  }>;
  
  // ==================== Tailscale 服务 ====================
  
  /**
   * 发现 Tailscale 节点
   */
  discoverTailscaleNodes(): Promise<TailscaleNode[]>;
  
  /**
   * 连接 Tailscale 节点
   */
  connectTailscaleNode(nodeId: string): Promise<boolean>;
  
  /**
   * 获取 Tailscale 状态
   */
  getTailscaleStatus(): Promise<{
    running: boolean;
    authenticated: boolean;
    nodes: number;
  }>;
  
  // ==================== 纹理管理服务 ====================
  
  /**
   * 上传纹理图片
   * @param characterId 角色ID
   * @param imageData base64 编码的图片数据
   * @param filename 可选的文件名
   */
  uploadTexture(
    characterId: string,
    imageData: string,
    filename?: string
  ): Promise<CharacterTexture>;
  
  /**
   * 检查纹理是否存在
   * @param filePath 文件路径
   */
  checkTexture(filePath: string): Promise<{
    exists: boolean;
    url: string | null;
    size?: number;
    generatedAt?: number;
  }>;
  
  /**
   * 删除纹理文件
   * @param filePath 文件路径
   */
  deleteTexture(filePath: string): Promise<void>;
  
  /**
   * 获取纹理访问URL
   * @param filePath 文件路径
   */
  getTextureUrl(filePath: string): string;
  
  // ==================== 生命周期 ====================
  
  /**
   * 初始化服务
   */
  initialize(): Promise<void>;
  
  /**
   * 销毁服务
   */
  destroy(): Promise<void>;
}

/**
 * 服务提供者工厂
 */
export interface ServiceProviderFactory {
  create(): ServiceProvider;
}
