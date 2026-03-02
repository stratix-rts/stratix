/**
 * UnifiedOpenClawConnectionManager - 统一 OpenClaw 连接管理器
 * 
 * 支持两种连接方式：
 * - pairing: 配对连接（本地/远程，需要 shared token）
 * - tailscale: Tailscale 身份验证（无需 token）
 * 
 * 支持两种模式：
 * - direct: 直连模式（浏览器 WebSocket 直接连接）
 * - proxy: 代理模式（通过 Gateway 代理连接，token 不暴露）
 * 
 * 浏览器和 Electron 有一致的连接体验
 */

import { deviceIdentityManager, type StoredConnection } from './openclaw/DeviceIdentityManager';
import { OpenClawWebSocketConnection, type ConnectionState, type ConnectionResult } from './openclaw/OpenClawWebSocketConnection';
import type { OpenClawStatus, ChatResponse, ChatOptions } from '@/stratix-openclaw-adapter/types';
import type { OpenClawConnectionRecord, ConnectionPoolStatus } from '@/stratix-data-store/types';

export interface TailscaleNode {
  nodeId: string;
  name: string;
  ipAddress: string;
  online: boolean;
  latency?: number;
}

export interface CheckEndpointResult {
  exists: boolean;
  connection?: OpenClawConnectionRecord & { status?: string };
}

export { type StoredConnection, type ConnectionState, type ConnectionResult };

class UnifiedOpenClawConnectionManager {
  private static instance: UnifiedOpenClawConnectionManager | null = null;
  private connection: OpenClawWebSocketConnection | null = null;
  private statusListeners: Set<(status: OpenClawStatus) => void> = new Set();
  private electronAPI: any = null;
  private tailscaleNodes: TailscaleNode[] = [];
  private connectionId: string | null = null;
  private useProxy: boolean = true;

  private constructor() {
    this.detectEnvironment();
  }

  static getInstance(): UnifiedOpenClawConnectionManager {
    if (!UnifiedOpenClawConnectionManager.instance) {
      UnifiedOpenClawConnectionManager.instance = new UnifiedOpenClawConnectionManager();
    }
    return UnifiedOpenClawConnectionManager.instance;
  }

  private detectEnvironment(): void {
    if (typeof window !== 'undefined') {
      this.electronAPI = (window as any).electronAPI;
    }
  }

  private isElectron(): boolean {
    return !!(typeof window !== 'undefined' && (window as any).electronAPI);
  }

  setUseProxy(useProxy: boolean): void {
    this.useProxy = useProxy;
  }

  getConnectionId(): string | null {
    return this.connectionId;
  }

  async getDeviceId(): Promise<string> {
    return deviceIdentityManager.getDeviceId();
  }

  async checkEndpointExists(endpoint: string): Promise<CheckEndpointResult> {
    try {
      const response = await fetch('/api/stratix/openclaw/connections/check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ endpoint }),
      });
      
      const result = await response.json();
      
      if (result.code === 200 && result.data?.exists) {
        return {
          exists: true,
          connection: result.data.connection,
        };
      }
      
      return { exists: false };
    } catch (error) {
      console.error('[UnifiedOpenClaw] Failed to check endpoint:', error);
      return { exists: false };
    }
  }

  async createConnection(params: {
    name?: string;
    method: 'pairing' | 'tailscale';
    endpoint: string;
    sharedToken?: string;
  }): Promise<{ success: boolean; connectionId?: string; error?: string }> {
    try {
      const response = await fetch('/api/stratix/openclaw/connections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
      });
      
      const result = await response.json();
      
      if (result.code === 200 && result.data) {
        this.connectionId = result.data.id;
        return { success: true, connectionId: result.data.id };
      }
      
      return { success: false, error: result.message || 'Failed to create connection' };
    } catch (error) {
      const err = error as Error;
      return { success: false, error: err.message };
    }
  }

  async connectViaProxy(connectionId: string): Promise<ConnectionResult> {
    try {
      const response = await fetch(`/api/stratix/openclaw/connections/${connectionId}/connect`, {
        method: 'POST',
      });
      
      const result = await response.json();
      
      if (result.code === 200) {
        this.connectionId = connectionId;
        return {
          success: true,
          state: 'connected',
          message: 'Connected via proxy',
        };
      }
      
      return {
        success: false,
        state: 'error',
        message: result.message || 'Connection failed',
      };
    } catch (error) {
      const err = error as Error;
      return {
        success: false,
        state: 'error',
        message: err.message,
      };
    }
  }

  async getConnections(): Promise<Array<OpenClawConnectionRecord & { status?: string; clientCount?: number }>> {
    try {
      const response = await fetch('/api/stratix/openclaw/connections/list');
      const result = await response.json();
      
      if (result.code === 200 && Array.isArray(result.data)) {
        return result.data;
      }
      
      return [];
    } catch (error) {
      console.error('[UnifiedOpenClaw] Failed to get connections:', error);
      return [];
    }
  }

  async getConnectionStatus(connectionId: string): Promise<ConnectionPoolStatus | null> {
    try {
      const response = await fetch(`/api/stratix/openclaw/status/${connectionId}`);
      const result = await response.json();
      
      if (result.code === 200 && result.data) {
        return result.data;
      }
      
      return null;
    } catch (error) {
      console.error('[UnifiedOpenClaw] Failed to get connection status:', error);
      return null;
    }
  }

  async pairConnect(endpoint: string, sharedToken: string): Promise<ConnectionResult> {
    if (this.useProxy) {
      return this.pairConnectProxy(endpoint, sharedToken);
    }
    return this.pairConnectDirect(endpoint, sharedToken);
  }

  private async pairConnectProxy(endpoint: string, sharedToken: string): Promise<ConnectionResult> {
    const checkResult = await this.checkEndpointExists(endpoint);
    
    if (checkResult.exists && checkResult.connection) {
      const useExisting = confirm(
        `此 endpoint 已存在配置：\n名称: ${checkResult.connection.name}\n状态: ${checkResult.connection.status || '未知'}\n\n是否使用已有配置？\n点击"取消"将创建新配置。`
      );
      
      if (useExisting) {
        this.connectionId = checkResult.connection.id;
        return {
          success: true,
          state: 'connected',
          message: 'Using existing connection',
        };
      }
    }
    
    const createResult = await this.createConnection({
      endpoint,
      method: 'pairing',
      sharedToken,
    });
    
    if (!createResult.success) {
      return {
        success: false,
        state: 'error',
        message: createResult.error || 'Failed to create connection',
      };
    }
    
    return this.connectViaProxy(createResult.connectionId!);
  }

  private async pairConnectDirect(endpoint: string, sharedToken: string): Promise<ConnectionResult> {
    if (this.connection) {
      await this.connection.disconnect();
    }

    this.connection = new OpenClawWebSocketConnection();
    
    const result = await this.connection.connectWithPairing(endpoint, sharedToken);
    
    if (result.success) {
      this.saveConnection(endpoint, 'pairing', result.deviceToken);
    }
    
    return result;
  }

  async tailscaleConnect(endpoint: string): Promise<ConnectionResult> {
    if (this.useProxy) {
      return this.tailscaleConnectProxy(endpoint);
    }
    return this.tailscaleConnectDirect(endpoint);
  }

  private async tailscaleConnectProxy(endpoint: string): Promise<ConnectionResult> {
    const checkResult = await this.checkEndpointExists(endpoint);
    
    if (checkResult.exists && checkResult.connection) {
      this.connectionId = checkResult.connection.id;
      return {
        success: true,
        state: 'connected',
        message: 'Using existing connection',
      };
    }
    
    const createResult = await this.createConnection({
      endpoint,
      method: 'tailscale',
    });
    
    if (!createResult.success) {
      return {
        success: false,
        state: 'error',
        message: createResult.error || 'Failed to create connection',
      };
    }
    
    return this.connectViaProxy(createResult.connectionId!);
  }

  private async tailscaleConnectDirect(endpoint: string): Promise<ConnectionResult> {
    if (this.connection) {
      await this.connection.disconnect();
    }

    this.connection = new OpenClawWebSocketConnection();
    
    const result = await this.connection.connectWithTailscale(endpoint);
    
    if (result.success) {
      this.saveConnection(endpoint, 'tailscale');
    }
    
    return result;
  }

  private async saveConnection(endpoint: string, method: 'pairing' | 'tailscale', deviceToken?: string): Promise<void> {
    const deviceId = await this.getDeviceId();
    
    const connection: StoredConnection = {
      id: `conn_${Date.now()}`,
      name: this.extractNameFromEndpoint(endpoint),
      endpoint,
      method,
      deviceId,
      deviceToken,
      lastConnected: Date.now(),
    };
    
    deviceIdentityManager.saveConnection(connection);
  }

  async disconnect(): Promise<void> {
    if (this.connectionId) {
      try {
        await fetch(`/api/stratix/openclaw/connections/${this.connectionId}/disconnect`, {
          method: 'POST',
        });
      } catch (error) {
        console.error('[UnifiedOpenClaw] Failed to disconnect via proxy:', error);
      }
      this.connectionId = null;
    }
    
    if (this.connection) {
      await this.connection.disconnect();
      this.connection = null;
    }
  }

  async sendMessage(message: string, options?: ChatOptions): Promise<ChatResponse> {
    if (this.useProxy && this.connectionId) {
      return this.sendMessageProxy(message, options);
    }
    return this.sendMessageDirect(message, options);
  }

  private async sendMessageProxy(message: string, options?: ChatOptions): Promise<ChatResponse> {
    if (!this.connectionId) {
      throw new Error('未连接');
    }
    
    const sessionId = options?.sessionId || 'main';
    
    try {
      const ws = new WebSocket(`/api/stratix/openclaw/ws-proxy/${this.connectionId}`);
      
      return new Promise((resolve, reject) => {
        let accumulatedText = '';
        
        ws.onmessage = (event) => {
          try {
            const msg = JSON.parse(event.data);
            
            if (msg.event === 'chat.delta' && msg.payload?.text) {
              accumulatedText = msg.payload.text;
            } else if (msg.event === 'chat.complete') {
              ws.close();
              resolve({
                messageId: msg.payload?.messageId || '',
                content: accumulatedText || msg.payload?.content || '',
                role: 'assistant',
                sessionId,
                done: true,
              });
            } else if (msg.type === 'error') {
              ws.close();
              reject(new Error(msg.error?.message || 'Unknown error'));
            }
          } catch (e) {
            console.error('[UnifiedOpenClaw] Failed to parse message:', e);
          }
        };
        
        ws.onerror = () => {
          reject(new Error('WebSocket error'));
        };
        
        ws.onopen = () => {
          ws.send(JSON.stringify({
            type: 'req',
            id: `chat-${Date.now()}`,
            method: 'chat.send',
            params: { message, sessionKey: sessionId },
          }));
        };
        
        setTimeout(() => {
          ws.close();
          if (accumulatedText) {
            resolve({
              messageId: '',
              content: accumulatedText,
              role: 'assistant',
              sessionId,
              done: true,
            });
          } else {
            reject(new Error('请求超时'));
          }
        }, 120000);
      });
    } catch (error) {
      throw error;
    }
  }

  private async sendMessageDirect(message: string, options?: ChatOptions): Promise<ChatResponse> {
    if (!this.connection || !this.connection.isConnected()) {
      throw new Error('未连接');
    }
    
    const sessionId = options?.sessionId || 'main';
    let accumulatedText = '';
    let lastText = '';
    let resolveFunc: ((value: ChatResponse) => void) | null = null;
    let rejectFunc: ((reason: Error) => void) | null = null;
    let idleTimer: ReturnType<typeof setTimeout> | null = null;
    
    const responsePromise = new Promise<ChatResponse>((resolve, reject) => {
      resolveFunc = resolve;
      rejectFunc = reject;
    });
    
    const cleanup = (error?: Error) => {
      if (idleTimer) clearTimeout(idleTimer);
      if (error && rejectFunc) rejectFunc(error);
    };
    
    this.connection!.sendMessage(message, {
      onDelta: (text) => {
        accumulatedText = text;
        
        if (text === lastText) return;
        lastText = text;
        
        if (idleTimer) clearTimeout(idleTimer);
        idleTimer = setTimeout(() => {
          if (accumulatedText && resolveFunc) {
            cleanup();
            resolveFunc({
              messageId: '',
              content: accumulatedText,
              role: 'assistant',
              sessionId,
              done: true,
            });
          }
        }, 1000);
      },
      onFinal: (msg) => {
        cleanup();
        if (resolveFunc) {
          resolveFunc({
            messageId: '',
            content: msg.content,
            role: 'assistant',
            sessionId,
            done: true,
          });
        }
      },
      onError: (err) => {
        cleanup(new Error(err));
      },
    }, { sessionId }).catch((err) => {
      cleanup(err instanceof Error ? err : new Error(String(err)));
    });
    
    setTimeout(() => {
      cleanup();
      if (accumulatedText && resolveFunc) {
        resolveFunc({
          messageId: '',
          content: accumulatedText,
          role: 'assistant',
          sessionId,
          done: true,
        });
      } else if (rejectFunc) {
        rejectFunc(new Error('请求超时'));
      }
    }, 120000);
    
    return responsePromise;
  }

  async getStatus(): Promise<OpenClawStatus> {
    if (this.useProxy && this.connectionId) {
      const status = await this.getConnectionStatus(this.connectionId);
      return {
        connected: status?.status === 'connected',
        accountId: '',
        lastActive: status?.lastConnected || 0,
        error: status?.lastError,
      };
    }
    
    if (!this.connection) {
      return {
        connected: false,
        accountId: '',
        lastActive: 0,
        error: 'Not connected',
      };
    }

    const connected = this.connection.isConnected();
    return {
      connected,
      accountId: '',
      lastActive: connected ? Date.now() : 0,
      error: connected ? undefined : 'Disconnected',
    };
  }

  isConnected(): boolean {
    if (this.useProxy && this.connectionId) {
      return true;
    }
    return this.connection?.isConnected() ?? false;
  }

  getConnection(): OpenClawWebSocketConnection | null {
    return this.connection;
  }

  async initialize(config: any): Promise<boolean> {
    if (config.id) {
      this.connectionId = config.id;
      const result = await this.connectViaProxy(config.id);
      return result.success;
    }
    
    if (config.method === 'tailscale' || config.mode === 'tailscale') {
      const result = await this.tailscaleConnect(config.endpoint || config.remoteEndpoint);
      return result.success;
    } else {
      const result = await this.pairConnect(
        config.endpoint || config.localEndpoint || 'ws://127.0.0.1:18789',
        config.sharedToken || config.credentials?.token || ''
      );
      return result.success;
    }
  }

  async listAgents(): Promise<unknown[]> {
    return [];
  }

  getConnectionState(): ConnectionState {
    if (this.useProxy && this.connectionId) {
      return 'connected';
    }
    return this.connection?.getState() ?? 'disconnected';
  }

  startPairingPolling(callback: (result: ConnectionResult) => void, interval?: number): void {
    this.connection?.startPairingPolling(callback, interval);
  }

  stopPairingPolling(): void {
    this.connection?.stopPairingPolling();
  }

  onConnectionStateChange(callback: (state: ConnectionState) => void): () => void {
    if (this.connection) {
      return this.connection.onStateChange(callback);
    }
    return () => {};
  }

  getSavedConnections(): StoredConnection[] {
    return deviceIdentityManager.getConnections();
  }

  removeSavedConnection(id: string): void {
    deviceIdentityManager.removeConnection(id);
  }

  async getStoredDeviceToken(endpoint: string): Promise<string | null> {
    return deviceIdentityManager.getDeviceToken(endpoint);
  }

  async discoverTailscaleNodes(): Promise<TailscaleNode[]> {
    if (this.isElectron() && this.electronAPI?.tailscale) {
      return this.discoverTailscaleNodesElectron();
    }
    return this.discoverTailscaleNodesBrowser();
  }

  private async discoverTailscaleNodesElectron(): Promise<TailscaleNode[]> {
    try {
      const nodes = await this.electronAPI.tailscale.getNodes();
      this.tailscaleNodes = nodes.map((node: any) => ({
        nodeId: node.id || node.nodeId,
        name: node.name,
        ipAddress: node.ipAddress || node.ip,
        online: node.online,
        latency: node.latency,
      }));
      return this.tailscaleNodes;
    } catch (error) {
      console.error('[UnifiedOpenClaw] Failed to discover Tailscale nodes:', error);
      return [];
    }
  }

  private async discoverTailscaleNodesBrowser(): Promise<TailscaleNode[]> {
    try {
      const response = await fetch('/api/stratix/openclaw/tailscale/nodes', {
        method: 'GET',
      });
      
      const result = await response.json();
      
      if (result.code === 200 && Array.isArray(result.data)) {
        this.tailscaleNodes = result.data.map((node: any) => ({
          nodeId: node.id || node.nodeId,
          name: node.name,
          ipAddress: node.ipAddress || node.ip,
          online: node.online ?? true,
          latency: node.latency,
        }));
        return this.tailscaleNodes;
      }
    } catch (error) {
      console.warn('[UnifiedOpenClaw] Failed to discover Tailscale nodes via API:', error);
    }
    
    return [];
  }

  getTailscaleNodes(): TailscaleNode[] {
    return this.tailscaleNodes;
  }

  addStatusListener(listener: (status: OpenClawStatus) => void): () => void {
    this.statusListeners.add(listener);
    return () => {
      this.statusListeners.delete(listener);
    };
  }

  private extractNameFromEndpoint(endpoint: string): string {
    try {
      const url = new URL(endpoint.replace(/^ws/, 'http'));
      if (url.hostname === '127.0.0.1' || url.hostname === 'localhost') {
        return '本地连接';
      }
      if (url.hostname.includes('.ts.net') || url.hostname.includes('.tailscale')) {
        return url.hostname.split('.')[0];
      }
      return url.hostname;
    } catch {
      return '自定义连接';
    }
  }
}

export const unifiedOpenClawConnectionManager = UnifiedOpenClawConnectionManager.getInstance();
export default UnifiedOpenClawConnectionManager;