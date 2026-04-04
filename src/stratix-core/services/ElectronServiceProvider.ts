/**
 * Electron 模式服务提供者
 * 
 * 通过 IPC 调用内置 Gateway 服务
 * 适用于 Electron 桌面应用环境
 */


import type { StratixAgentConfig, UnifiedOpenClawConfig } from '@/stratix-core/stratix-protocol';
import type { ChatResponse } from '@/stratix-openclaw-adapter/types';

import type { ServiceProvider, TailscaleNode, AppConfiguration } from './ServiceProvider';

export class ElectronServiceProvider implements ServiceProvider {
  private electronAPI: any;
  private initialized = false;
  
  constructor() {
    this.electronAPI = (typeof window !== 'undefined') ? (window as any).electronAPI : null;
  }
  
  getEnvironment(): 'electron' {
    return 'electron';
  }
  
  getConfiguration(): AppConfiguration {
    return {
      environment: 'electron',
      dataDir: this.getDataDir(),
      version: '1.0.0',
    };
  }
  
  private getDataDir(): string {
    // Electron 环境下由主进程管理数据目录
    return 'userData://data';
  }
  
  async initialize(): Promise<void> {
    if (!this.electronAPI) {
      throw new Error('Electron API not available');
    }
    this.initialized = true;
  }
  
  async destroy(): Promise<void> {
    // Electron 模式下由主进程清理资源
    this.initialized = false;
  }
  
  // ==================== 数据服务 ====================
  
  async saveAgent(config: StratixAgentConfig): Promise<void> {
    if (!this.electronAPI) {
      throw new Error('Electron API not available');
    }
    await this.electronAPI.invoke('service:saveAgent', config);
  }
  
  async loadAgent(id: string): Promise<StratixAgentConfig | null> {
    if (!this.electronAPI) {
      throw new Error('Electron API not available');
    }
    return await this.electronAPI.invoke('service:loadAgent', id);
  }
  
  async deleteAgent(id: string): Promise<void> {
    if (!this.electronAPI) {
      throw new Error('Electron API not available');
    }
    await this.electronAPI.invoke('service:deleteAgent', id);
  }
  
  async listAgents(): Promise<StratixAgentConfig[]> {
    if (!this.electronAPI) {
      throw new Error('Electron API not available');
    }
    return await this.electronAPI.invoke('service:listAgents');
  }
  
  // ==================== OpenClaw 连接服务 ====================
  
  async connectOpenClaw(config: UnifiedOpenClawConfig): Promise<boolean> {
    if (!this.electronAPI) {
      throw new Error('Electron API not available');
    }

    const endpoint = config.localEndpoint || config.remoteEndpoint;
    if (!endpoint) {
      throw new Error('No endpoint provided');
    }

    const result = await this.electronAPI.openclaw.connectDirect(endpoint, config);
    return result === true;
  }

  async sendOpenClawMessage(message: string, sessionId?: string): Promise<ChatResponse> {
    if (!this.electronAPI) {
      throw new Error('Electron API not available');
    }

    return await this.electronAPI.invoke('openclaw:sendMessage', { message, sessionId });
  }

  async disconnectOpenClaw(): Promise<void> {
    if (!this.electronAPI) {
      throw new Error('Electron API not available');
    }
    await this.electronAPI.openclaw.disconnectDirect();
  }
  
  async getOpenClawStatus(): Promise<{ connected: boolean; endpoint?: string; error?: string }> {
    if (!this.electronAPI) {
      return {
        connected: false,
        error: 'Electron API not available',
      };
    }
    
    return await this.electronAPI.invoke('service:getOpenClawStatus');
  }
  
  // ==================== Tailscale 服务 ====================
  
  async discoverTailscaleNodes(): Promise<TailscaleNode[]> {
    if (!this.electronAPI?.tailscale) {
      return [];
    }
    return await this.electronAPI.tailscale.discoverNodes();
  }
  
  async connectTailscaleNode(nodeId: string): Promise<boolean> {
    if (!this.electronAPI?.tailscale) {
      return false;
    }
    return await this.electronAPI.tailscale.connectNode(nodeId);
  }
  
  async getTailscaleStatus(): Promise<{ running: boolean; authenticated: boolean; nodes: number }> {
    if (!this.electronAPI?.tailscale) {
      return {
        running: false,
        authenticated: false,
        nodes: 0,
      };
    }
    
    const status = await this.electronAPI.tailscale.getStatus();
    const nodes = await this.electronAPI.tailscale.getNodes();
    
    return {
      running: status?.running || false,
      authenticated: status?.authenticated || false,
      nodes: nodes?.length || 0,
    };
  }
  
  // ==================== 纹理管理服务 ====================
  
  async uploadTexture(
    characterId: string,
    imageData: string,
    filename?: string
  ): Promise<import('@/stratix-core/stratix-protocol').CharacterTexture> {
    if (!this.electronAPI) {
      throw new Error('Electron API not available');
    }

    const result = await this.electronAPI.invoke('texture:upload', {
      characterId,
      imageData,
      filename
    });

    if (result.success) {
      return result.data;
    }

    throw new Error(result.error || 'Failed to upload texture');
  }

  async checkTexture(filePath: string): Promise<{
    exists: boolean;
    url: string | null;
    size?: number;
    generatedAt?: number;
  }> {
    if (!this.electronAPI) {
      return { exists: false, url: null };
    }

    return await this.electronAPI.invoke('texture:check', filePath);
  }

  async deleteTexture(filePath: string): Promise<void> {
    if (!this.electronAPI) {
      throw new Error('Electron API not available');
    }

    await this.electronAPI.invoke('texture:delete', filePath);
  }

  getTextureUrl(filePath: string): string {
    return `/textures/${filePath}`;
  }
}

export default ElectronServiceProvider;
