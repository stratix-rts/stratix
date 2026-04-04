import { EventEmitter } from 'events';

import { WebSocket, RawData } from 'ws';

import type { OpenClawConnectionRecord, ConnectionPoolStatus } from '../../stratix-data-store/types';

import { serverDeviceIdentityManager } from './ServerDeviceIdentityManager';

interface PoolEntry {
  connectionId: string;
  record: OpenClawConnectionRecord;
  ws: WebSocket | null;
  status: ConnectionPoolStatus;
  reconnectTimer: NodeJS.Timeout | null;
  heartbeatTimer: NodeJS.Timeout | null;
  pendingClients: Set<WebSocket>;
}

const RECONNECT_DELAY = 5000;
const HEARTBEAT_INTERVAL = 30000;
const AUTH_TIMEOUT = 15000;

const CLIENT_ID = 'gateway-client';
const CLIENT_MODE = 'ui';
const CLIENT_VERSION = '1.0.0';
const CLIENT_PLATFORM = 'node';
const ROLE = 'operator';
const SCOPES = ['operator.read', 'operator.write', 'operator.admin', 'operator.approvals', 'operator.pairing'];

class OpenClawProxyManager extends EventEmitter {
  private pool: Map<string, PoolEntry> = new Map();
  private initPromise: Promise<void> | null = null;

  async initialize(dataDir: string): Promise<void> {
    if (this.initPromise) return this.initPromise;
    this.initPromise = serverDeviceIdentityManager.initialize(dataDir);
    return this.initPromise;
  }

  async connect(record: OpenClawConnectionRecord): Promise<{ success: boolean; error?: string }> {
    console.log('[ProxyManager] connect called with record:', {
      id: record.id,
      endpoint: record.endpoint,
      method: record.method,
      hasSharedToken: !!record.sharedToken,
      hasDeviceToken: !!record.deviceToken,
    });
    
    const existing = this.pool.get(record.id);
    if (existing) {
      // 更新 entry 中的 record，确保使用最新的 sharedToken
      console.log('[ProxyManager] Updating existing entry with new record');
      existing.record = record;
      
      if (existing.ws?.readyState === WebSocket.OPEN) {
        console.log('[ProxyManager] WebSocket already open, returning success');
        return { success: true };
      }
      
      // 连接已断开，需要重新连接
      console.log('[ProxyManager] WebSocket not open, disconnecting and reconnecting');
      await this.disconnect(record.id);
    }

    return this.createConnection(record);
  }

  private async createConnection(record: OpenClawConnectionRecord): Promise<{ success: boolean; error?: string }> {
    return new Promise((resolve) => {
      const entry: PoolEntry = {
        connectionId: record.id,
        record,
        ws: null,
        status: {
          connectionId: record.id,
          status: 'connecting',
          clientCount: 0,
        },
        reconnectTimer: null,
        heartbeatTimer: null,
        pendingClients: new Set(),
      };

      this.pool.set(record.id, entry);

      try {
        const ws = new WebSocket(record.endpoint);
        entry.ws = ws;

        ws.on('open', () => {
          entry.status.status = 'connecting';
          entry.status.lastConnected = Date.now();
          this.emitStatusChange(record.id);

          if (record.method === 'pairing') {
            this.handleAuthentication(ws, record, entry, resolve);
          } else {
            entry.status.status = 'connected';
            this.startHeartbeat(entry);
            this.emitStatusChange(record.id);
            resolve({ success: true });
          }
        });

        ws.on('message', (data: RawData) => {
          this.handleMessage(entry, data);
        });

        ws.on('close', () => {
          this.handleDisconnect(entry);
        });

        ws.on('error', (error: Error) => {
          entry.status.status = 'error';
          entry.status.lastError = error.message;
          this.emitStatusChange(record.id);
          resolve({ success: false, error: error.message });
        });

      } catch (error: unknown) {
        const err = error as Error;
        entry.status.status = 'error';
        entry.status.lastError = err.message;
        this.emitStatusChange(record.id);
        resolve({ success: false, error: err.message });
      }
    });
  }

  private handleAuthentication(
    ws: WebSocket,
    record: OpenClawConnectionRecord,
    entry: PoolEntry,
    resolve: (result: { success: boolean; error?: string }) => void
  ): void {
    const authHandler: (data: RawData) => void;

    authHandler = async (data: RawData) => {
      try {
        const msg = JSON.parse(data.toString());
        
        if (msg.event === 'connect.challenge') {
          const { nonce } = msg.payload || {};
          await this.sendAuthResponse(ws, record, nonce);
          return;
        }

        if ((msg.type === 'res' || msg.ok !== undefined) && msg.id === 'connect-1') {
          if (msg.ok) {
            entry.status.status = 'connected';
            entry.status.lastConnected = Date.now();
            
            const deviceToken = msg.result?.auth?.deviceToken || msg.payload?.auth?.deviceToken;
            if (deviceToken) {
              entry.record.deviceToken = deviceToken;
              this.emit('deviceToken', record.id, deviceToken);
            }
            this.startHeartbeat(entry);
            this.emitStatusChange(record.id);
            resolve({ success: true });
          } else {
            entry.status.status = 'error';
            entry.status.lastError = msg.error?.message || 'Authentication failed';
            this.emitStatusChange(record.id);
            resolve({ success: false, error: entry.status.lastError });
          }
          ws.off('message', authHandler);
        }
      } catch (e) {
        console.error('[ProxyManager] Auth message parse error:', e);
      }
    };

    ws.on('message', authHandler);

    setTimeout(() => {
      if (entry.status.status === 'connecting') {
        ws.off('message', authHandler);
        entry.status.status = 'error';
        entry.status.lastError = 'Authentication timeout';
        this.emitStatusChange(record.id);
        resolve({ success: false, error: 'Authentication timeout' });
      }
    }, AUTH_TIMEOUT);
  }

  private async sendAuthResponse(
    ws: WebSocket, 
    record: OpenClawConnectionRecord, 
    nonce: string
  ): Promise<void> {
    try {
      const token = record.deviceToken || record.sharedToken;
      const signedAtMs = Date.now();

      const deviceId = await serverDeviceIdentityManager.getDeviceId();
      const publicKey = await serverDeviceIdentityManager.getPublicKeyBase64();
      const signature = await serverDeviceIdentityManager.signChallenge({
        clientId: CLIENT_ID,
        clientMode: CLIENT_MODE,
        role: ROLE,
        scopes: SCOPES,
        signedAtMs,
        token: token || null,
        nonce,
      });

      console.log('[ProxyManager] Sending auth response:', {
        deviceId,
        hasToken: !!token,
        nonce,
      });

      ws.send(JSON.stringify({
        type: 'req',
        id: 'connect-1',
        method: 'connect',
        params: {
          minProtocol: 3,
          maxProtocol: 3,
          auth: token ? { token } : undefined,
          role: ROLE,
          scopes: SCOPES,
          client: {
            id: CLIENT_ID,
            version: CLIENT_VERSION,
            platform: CLIENT_PLATFORM,
            mode: CLIENT_MODE,
          },
          device: {
            id: deviceId,
            publicKey,
            signature,
            signedAt: signedAtMs,
            nonce,
          },
          locale: 'zh-CN',
          userAgent: 'stratix-gateway/1.0.0',
        },
      }));
    } catch (error) {
      console.error('[ProxyManager] Failed to send auth response:', error);
    }
  }

  private handleMessage(entry: PoolEntry, data: RawData): void {
    const message = data.toString();
    console.log('[ProxyManager] handleMessage from OpenClaw:', message.slice(0, 500));
    
    entry.pendingClients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message);
      }
    });
  }

  private handleDisconnect(entry: PoolEntry): void {
    entry.status.status = 'disconnected';
    this.emitStatusChange(entry.connectionId);

    entry.pendingClients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.close(1011, 'OpenClaw connection lost');
      }
    });
    entry.pendingClients.clear();

    this.scheduleReconnect(entry);
  }

  private scheduleReconnect(entry: PoolEntry): void {
    if (entry.reconnectTimer) return;

    entry.reconnectTimer = setTimeout(() => {
      entry.reconnectTimer = null;
      if (entry.pendingClients.size > 0 || entry.status.clientCount > 0) {
        this.createConnection(entry.record);
      }
    }, RECONNECT_DELAY);
  }

  private startHeartbeat(entry: PoolEntry): void {
    if (entry.heartbeatTimer) {
      clearInterval(entry.heartbeatTimer);
    }

    entry.heartbeatTimer = setInterval(() => {
      if (entry.ws?.readyState === WebSocket.OPEN) {
        entry.ws.ping();
      }
    }, HEARTBEAT_INTERVAL);
  }

  attachClient(connectionId: string, clientWs: WebSocket): boolean {
    const entry = this.pool.get(connectionId);
    if (!entry || entry.status.status !== 'connected') {
      return false;
    }

    entry.pendingClients.add(clientWs);
    entry.status.clientCount = entry.pendingClients.size;
    this.emitStatusChange(connectionId);

    clientWs.on('message', (data: RawData) => {
      if (entry.ws?.readyState === WebSocket.OPEN) {
        entry.ws.send(data);
      }
    });

    clientWs.on('close', () => {
      entry.pendingClients.delete(clientWs);
      entry.status.clientCount = entry.pendingClients.size;
      this.emitStatusChange(connectionId);
    });

    return true;
  }

  async disconnect(connectionId: string): Promise<void> {
    const entry = this.pool.get(connectionId);
    if (!entry) return;

    if (entry.heartbeatTimer) {
      clearInterval(entry.heartbeatTimer);
      entry.heartbeatTimer = null;
    }

    if (entry.reconnectTimer) {
      clearTimeout(entry.reconnectTimer);
      entry.reconnectTimer = null;
    }

    if (entry.ws) {
      entry.ws.close();
      entry.ws = null;
    }

    entry.pendingClients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.close(1000, 'Connection closed');
      }
    });
    entry.pendingClients.clear();

    entry.status.status = 'disconnected';
    entry.status.clientCount = 0;
    this.emitStatusChange(connectionId);
  }

  remove(connectionId: string): void {
    this.disconnect(connectionId);
    this.pool.delete(connectionId);
  }

  getStatus(connectionId: string): ConnectionPoolStatus | null {
    const entry = this.pool.get(connectionId);
    return entry ? { ...entry.status } : null;
  }

  getAllStatuses(): ConnectionPoolStatus[] {
    return Array.from(this.pool.values()).map(e => ({ ...e.status }));
  }

  isConnected(connectionId: string): boolean {
    const entry = this.pool.get(connectionId);
    return entry?.status.status === 'connected';
  }

  private emitStatusChange(connectionId: string): void {
    const status = this.getStatus(connectionId);
    if (status) {
      this.emit('statusChange', status);
    }
  }

  onStatusChange(listener: (status: ConnectionPoolStatus) => void): () => void {
    this.on('statusChange', listener);
    return () => this.off('statusChange', listener);
  }

  onDeviceToken(listener: (connectionId: string, deviceToken: string) => void): () => void {
    this.on('deviceToken', listener);
    return () => this.off('deviceToken', listener);
  }
}

export const openClawProxyManager = new OpenClawProxyManager();
export default OpenClawProxyManager;
