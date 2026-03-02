/**
 * Web 模式服务提供者
 * 
 * 通过 HTTP 请求与 Gateway 服务通信
 * 适用于浏览器环境和 Vite 开发服务器
 */

import type { ServiceProvider, TailscaleNode, AppConfiguration } from './ServiceProvider';
import type { StratixAgentConfig, UnifiedOpenClawConfig } from '@/stratix-core/stratix-protocol';
import type { ChatResponse } from '@/stratix-openclaw-adapter/types';

export class WebServiceProvider implements ServiceProvider {
  private apiBase: string;
  private initialized = false;
  
  constructor(apiBase = '/api/stratix') {
    this.apiBase = apiBase;
  }
  
  getEnvironment(): 'web' {
    return 'web';
  }
  
  getConfiguration(): AppConfiguration {
    return {
      environment: 'web',
      dataDir: './stratix-data', // Web 模式下由服务端管理
      version: '1.0.0',
    };
  }
  
  async initialize(): Promise<void> {
    // Web 模式不需要额外初始化
    this.initialized = true;
  }
  
  async destroy(): Promise<void> {
    // Web 模式不需要清理
    this.initialized = false;
  }
  
  // ==================== 数据服务 ====================
  
  async saveAgent(config: StratixAgentConfig): Promise<void> {
    const response = await fetch(`${this.apiBase}/config/agent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(config),
    });
    
    if (!response.ok) {
      throw new Error(`Failed to save agent: ${response.statusText}`);
    }
  }
  
  async loadAgent(id: string): Promise<StratixAgentConfig | null> {
    const response = await fetch(`${this.apiBase}/config/agent/${encodeURIComponent(id)}`);
    
    if (!response.ok) {
      if (response.status === 404) {
        return null;
      }
      throw new Error(`Failed to load agent: ${response.statusText}`);
    }
    
    const data = await response.json();
    return data.data || null;
  }
  
  async deleteAgent(id: string): Promise<void> {
    const response = await fetch(`${this.apiBase}/config/agent/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
    
    if (!response.ok) {
      throw new Error(`Failed to delete agent: ${response.statusText}`);
    }
  }
  
  async listAgents(): Promise<StratixAgentConfig[]> {
    const response = await fetch(`${this.apiBase}/config/agent`);
    
    if (!response.ok) {
      throw new Error(`Failed to list agents: ${response.statusText}`);
    }
    
    const data = await response.json();
    return data.data || [];
  }
  
  // ==================== OpenClaw 连接服务 ====================
  
  async connectOpenClaw(config: UnifiedOpenClawConfig): Promise<boolean> {
    const endpoint = config.localEndpoint || config.remoteEndpoint;
    if (!endpoint) {
      throw new Error('No endpoint provided');
    }
    
    const response = await fetch(`${this.apiBase}/openclaw/ws-connect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        endpoint: endpoint.replace(/^http/, 'ws') + '/ws',
        accountId: config.credentials?.accountId || 'stratix',
        apiKey: config.credentials?.apiKey,
      }),
    });
    
    const result = await response.json();
    return result.code === 200 && result.data?.connected === true;
  }
  
  async sendOpenClawMessage(message: string, sessionId?: string): Promise<ChatResponse> {
    const response = await fetch(`${this.apiBase}/openclaw/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message,
        sessionId,
      }),
    });
    
    const result = await response.json();
    
    if (result.code === 200 && result.data) {
      return {
        messageId: result.data.messageId || `msg_${Date.now()}`,
        content: result.data.content || result.data,
        role: 'assistant',
        sessionId,
        done: true,
      };
    }
    
    throw new Error(result.message || 'Failed to send message');
  }
  
  async disconnectOpenClaw(): Promise<void> {
    // Web 模式下由 Gateway 管理连接
    await fetch(`${this.apiBase}/openclaw/disconnect`, {
      method: 'POST',
    }).catch(() => {
      // Ignore errors
    });
  }
  
  async getOpenClawStatus(): Promise<{ connected: boolean; endpoint?: string; error?: string }> {
    try {
      const response = await fetch(`${this.apiBase}/openclaw/connections`);
      const result = await response.json();
      
      if (result.code === 200 && result.data) {
        const connections = result.data;
        return {
          connected: connections.length > 0,
          endpoint: connections[0]?.endpoint,
        };
      }
    } catch (error: any) {
      return {
        connected: false,
        error: error.message,
      };
    }
    
    return {
      connected: false,
      error: 'Not connected',
    };
  }
  
  // ==================== Tailscale 服务 ====================
  
  async discoverTailscaleNodes(): Promise<TailscaleNode[]> {
    // Web 模式不支持 Tailscale
    console.warn('Tailscale is not supported in Web mode');
    return [];
  }
  
  async connectTailscaleNode(_nodeId: string): Promise<boolean> {
    // Web 模式不支持 Tailscale
    throw new Error('Tailscale is not supported in Web mode');
  }
  
  async getTailscaleStatus(): Promise<{ running: boolean; authenticated: boolean; nodes: number }> {
    return {
      running: false,
      authenticated: false,
      nodes: 0,
    };
  }
  
  // ==================== 纹理管理服务 ====================
  
  async uploadTexture(
    characterId: string,
    imageData: string,
    filename?: string
  ): Promise<import('@/stratix-core/stratix-protocol').CharacterTexture> {
    const response = await fetch(`${this.apiBase}/texture/upload`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ characterId, imageData, filename })
    });

    const result = await response.json();
    
    if (result.code === 200 && result.data) {
      return {
        filePath: result.data.filePath,
        width: 832,
        height: 3456,
        animations: ['walk', 'idle', 'run'],
        generatedAt: result.data.generatedAt
      };
    }

    throw new Error(result.message || 'Failed to upload texture');
  }

  async checkTexture(filePath: string): Promise<{
    exists: boolean;
    url: string | null;
    size?: number;
    generatedAt?: number;
  }> {
    try {
      const response = await fetch(
        `${this.apiBase}/texture/check/${encodeURIComponent(filePath)}`
      );
      const result = await response.json();

      if (result.code === 200 && result.data) {
        return result.data;
      }

      return { exists: false, url: null };
    } catch (error) {
      console.error('[WebServiceProvider] Failed to check texture:', error);
      return { exists: false, url: null };
    }
  }

  async deleteTexture(filePath: string): Promise<void> {
    await fetch(
      `${this.apiBase}/texture/${encodeURIComponent(filePath)}`,
      { method: 'DELETE' }
    );
  }

  getTextureUrl(filePath: string): string {
    return `/textures/${filePath}`;
  }
}

export default WebServiceProvider;
