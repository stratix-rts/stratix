/**
 * OpenClawConnectionManager - OpenClaw 连接管理器
 * 
 * 管理 WebSocketOpenClawAdapter 实例
 * 支持单例模式、自动重连、状态同步
 */

import type { StratixOpenClawConfig } from '@/stratix-core/stratix-protocol';
import { WebSocketOpenClawAdapter } from '@/stratix-openclaw-adapter';
import type { OpenClawStatus } from '@/stratix-openclaw-adapter/types';

export interface ConnectionTestResult {
  success: boolean;
  message: string;
  deviceId?: string;
  error?: string;
}

class OpenClawConnectionManager {
  private static instance: OpenClawConnectionManager | null = null;
  private adapter: WebSocketOpenClawAdapter | null = null;
  private config: StratixOpenClawConfig | null = null;
  private statusListeners: Set<(status: OpenClawStatus) => void> = new Set();
  private statusCheckInterval: ReturnType<typeof setInterval> | null = null;

  private constructor() {}

  static getInstance(): OpenClawConnectionManager {
    if (!OpenClawConnectionManager.instance) {
      OpenClawConnectionManager.instance = new OpenClawConnectionManager();
    }
    return OpenClawConnectionManager.instance;
  }

  async testConnection(config: StratixOpenClawConfig): Promise<ConnectionTestResult> {
    try {
      const testAdapter = new WebSocketOpenClawAdapter(config);
      await testAdapter.connect();
      
      const status = await testAdapter.getStatus();
      const deviceId = testAdapter.getDeviceId();
      
      await testAdapter.disconnect();

      if (status.connected) {
        return {
          success: true,
          message: `WebSocket 连接成功`,
          deviceId: deviceId || undefined,
        };
      } else {
        return {
          success: false,
          message: '连接失败',
          error: status.error || 'Unknown error',
        };
      }
    } catch (error) {
      return {
        success: false,
        message: '连接失败',
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  async connect(config: StratixOpenClawConfig): Promise<ConnectionTestResult> {
    if (this.adapter) {
      await this.disconnect();
    }

    this.config = config;
    this.adapter = new WebSocketOpenClawAdapter(config);

    try {
      await this.adapter.connect();
      
      const status = await this.adapter.getStatus();
      const deviceId = this.adapter.getDeviceId();

      if (status.connected) {
        this.startStatusCheck();
        return {
          success: true,
          message: 'WebSocket 连接成功',
          deviceId: deviceId || undefined,
        };
      } else {
        return {
          success: false,
          message: '连接失败',
          error: status.error || 'Unknown error',
        };
      }
    } catch (error) {
      this.adapter = null;
      return {
        success: false,
        message: '连接失败',
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  async disconnect(): Promise<void> {
    this.stopStatusCheck();
    
    if (this.adapter) {
      await this.adapter.disconnect();
      this.adapter = null;
    }
    
    this.config = null;
    this.notifyStatusListeners({
      connected: false,
      accountId: '',
      lastActive: 0,
      error: 'Disconnected',
    });
  }

  getAdapter(): WebSocketOpenClawAdapter | null {
    return this.adapter;
  }

  getConfig(): StratixOpenClawConfig | null {
    return this.config;
  }

  async getStatus(): Promise<OpenClawStatus> {
    if (!this.adapter) {
      return {
        connected: false,
        accountId: this.config?.accountId || '',
        lastActive: 0,
        error: 'Not configured',
      };
    }
    return this.adapter.getStatus();
  }

  isConnected(): boolean {
    return this.adapter?.isConnected() ?? false;
  }

  addStatusListener(listener: (status: OpenClawStatus) => void): () => void {
    this.statusListeners.add(listener);
    return () => {
      this.statusListeners.delete(listener);
    };
  }

  private notifyStatusListeners(status: OpenClawStatus): void {
    this.statusListeners.forEach((listener) => {
      try {
        listener(status);
      } catch (e) {
        console.error('[OpenClawConnectionManager] Status listener error:', e);
      }
    });
  }

  private startStatusCheck(): void {
    if (this.statusCheckInterval) {
      clearInterval(this.statusCheckInterval);
    }

    this.statusCheckInterval = setInterval(async () => {
      if (this.adapter) {
        const status = await this.adapter.getStatus();
        this.notifyStatusListeners(status);
      }
    }, 30000);
  }

  private stopStatusCheck(): void {
    if (this.statusCheckInterval) {
      clearInterval(this.statusCheckInterval);
      this.statusCheckInterval = null;
    }
  }

  async invokeTool<T = unknown>(
    tool: string,
    args?: Record<string, unknown>,
    options?: { sessionKey?: string; action?: string }
  ): Promise<T> {
    if (!this.adapter) {
      throw new Error('OpenClaw not connected');
    }
    return this.adapter.invokeTool<T>(tool, args, options);
  }

  async sendMessage(message: string, options?: { sessionId?: string; agentId?: string }): Promise<{ content: string }> {
    if (!this.adapter) {
      throw new Error('OpenClaw not connected');
    }
    const result = await this.adapter.sendMessage(message, options);
    return { content: result.content };
  }

  async listAgents(): Promise<unknown[]> {
    if (!this.adapter) {
      throw new Error('OpenClaw not connected');
    }
    return this.adapter.listAgents();
  }
}

export const openClawConnectionManager = OpenClawConnectionManager.getInstance();
export default OpenClawConnectionManager;
