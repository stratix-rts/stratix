/**
 * Stratix OpenClaw Adapter - 连接池管理
 * 
 * 负责管理多个 OpenClaw 实例的连接池
 * 支持适配器缓存、复用、自动重连和健康检查
 */

import { LocalOpenClawAdapter } from './LocalOpenClawAdapter';
import { RemoteOpenClawAdapter } from './RemoteOpenClawAdapter';
import { OpenClawAdapterInterface } from './types';

import { CONNECTION_POOL_DEFAULTS } from '@/stratix-core/config/defaults';
import { StratixOpenClawConfig } from '@/stratix-core/stratix-protocol';

export interface ConnectionInfo {
  key: string;
  endpoint: string;
  accountId: string;
  status: 'connected' | 'disconnected' | 'error' | 'reconnecting';
  lastUsed: number;
  createdAt: number;
  errorCount: number;
  lastError?: string;
}

export interface ConnectionPoolOptions {
  maxConnections?: number;
  idleTimeout?: number;
  reconnectAttempts?: number;
  reconnectDelay?: number;
  healthCheckInterval?: number;
  connectionBatchDelay?: number;
}

export interface PoolStats {
  totalConnections: number;
  activeConnections: number;
  idleConnections: number;
  errorConnections: number;
}

export interface InvokeAllResult<T = unknown> {
  key: string;
  success: boolean;
  result?: T;
  error?: string;
}

interface InternalConnection {
  adapter: OpenClawAdapterInterface;
  config: StratixOpenClawConfig;
  info: ConnectionInfo;
}

const DEFAULT_OPTIONS: Required<ConnectionPoolOptions> = {
  maxConnections: CONNECTION_POOL_DEFAULTS.MAX_CONNECTIONS,
  idleTimeout: CONNECTION_POOL_DEFAULTS.IDLE_TIMEOUT_MS,
  reconnectAttempts: 3,
  reconnectDelay: 1000,
  healthCheckInterval: CONNECTION_POOL_DEFAULTS.HEALTH_CHECK_INTERVAL_MS,
  connectionBatchDelay: 100,
};

export class ConnectionPool {
  private connections: Map<string, InternalConnection> = new Map();
  private options: Required<ConnectionPoolOptions>;
  private healthCheckTimer?: ReturnType<typeof setInterval>;
  private idleCheckTimer?: ReturnType<typeof setInterval>;

  constructor(options?: ConnectionPoolOptions) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  public async getAdapter(config: StratixOpenClawConfig): Promise<OpenClawAdapterInterface> {
    const key = this.generateKey(config);

    if (this.connections.has(key)) {
      const conn = this.connections.get(key)!;
      conn.info.lastUsed = Date.now();
      conn.info.status = 'connected';
      return conn.adapter;
    }

    if (this.connections.size >= this.options.maxConnections) {
      await this.cleanupIdleConnections();
    }

    if (this.connections.size >= this.options.maxConnections) {
      throw new Error('Connection pool exhausted: maximum connections reached');
    }

    return this.createAndConnect(config);
  }

  private async createAndConnect(config: StratixOpenClawConfig): Promise<OpenClawAdapterInterface> {
    const key = this.generateKey(config);
    const adapter = this.createAdapter(config);

    const info: ConnectionInfo = {
      key,
      endpoint: config.endpoint,
      accountId: config.accountId,
      status: 'reconnecting',
      lastUsed: Date.now(),
      createdAt: Date.now(),
      errorCount: 0,
    };

    this.connections.set(key, { adapter, config, info });

    try {
      await adapter.connect();
      this.connections.get(key)!.info.status = 'connected';
    } catch (error) {
      this.connections.get(key)!.info.status = 'error';
      this.connections.get(key)!.info.lastError = (error as Error).message;
    }

    return adapter;
  }

  private createAdapter(config: StratixOpenClawConfig): OpenClawAdapterInterface {
    const isLocal =
      config.endpoint.includes('localhost') || config.endpoint.includes('127.0.0.1');
    return isLocal ? new LocalOpenClawAdapter(config) : new RemoteOpenClawAdapter(config);
  }

  public async releaseAdapter(key: string): Promise<void> {
    const conn = this.connections.get(key);
    if (conn) {
      conn.info.lastUsed = Date.now();
    }
  }

  public async removeAdapter(key: string): Promise<void> {
    const conn = this.connections.get(key);
    if (conn) {
      try {
        await conn.adapter.disconnect();
      } catch {
        // ignore disconnect errors
      }
      this.connections.delete(key);
    }
  }

  public async disconnectAll(): Promise<void> {
    const disconnects = Array.from(this.connections.values()).map(async (conn) => {
      try {
        await conn.adapter.disconnect();
      } catch {
        // ignore disconnect errors
      }
    });
    await Promise.all(disconnects);
    this.connections.clear();
    this.stopHealthCheck();
  }

  public getConnectionInfo(key: string): ConnectionInfo | null {
    const conn = this.connections.get(key);
    return conn ? { ...conn.info } : null;
  }

  public getAllConnectionInfo(): ConnectionInfo[] {
    return Array.from(this.connections.values()).map((conn) => ({ ...conn.info }));
  }

  public getPoolStats(): PoolStats {
    const connections = Array.from(this.connections.values());
    const now = Date.now();
    const idleThreshold = now - this.options.idleTimeout;

    return {
      totalConnections: connections.length,
      activeConnections: connections.filter((c) => c.info.lastUsed > idleThreshold).length,
      idleConnections: connections.filter(
        (c) => c.info.lastUsed <= idleThreshold && c.info.status === 'connected'
      ).length,
      errorConnections: connections.filter((c) => c.info.status === 'error').length,
    };
  }

  public startHealthCheck(): void {
    if (this.healthCheckTimer) return;

    this.healthCheckTimer = setInterval(() => {
      this.performHealthCheck();
    }, this.options.healthCheckInterval);

    this.idleCheckTimer = setInterval(() => {
      this.cleanupIdleConnections();
    }, this.options.idleTimeout / 2);
  }

  public stopHealthCheck(): void {
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = undefined;
    }
    if (this.idleCheckTimer) {
      clearInterval(this.idleCheckTimer);
      this.idleCheckTimer = undefined;
    }
  }

  public dispose(): void {
    this.stopHealthCheck();
  }

  public async attemptReconnect(key: string): Promise<boolean> {
    const conn = this.connections.get(key);
    if (!conn) return false;

    conn.info.status = 'reconnecting';

    for (let attempt = 1; attempt <= this.options.reconnectAttempts; attempt++) {
      try {
        await conn.adapter.connect();
        conn.info.status = 'connected';
        conn.info.errorCount = 0;
        conn.info.lastError = undefined;
        return true;
      } catch (error) {
        conn.info.errorCount++;
        conn.info.lastError = (error as Error).message;

        if (attempt < this.options.reconnectAttempts) {
          const delay = this.options.reconnectDelay * Math.pow(2, attempt - 1);
          await this.sleep(delay);
        }
      }
    }

    conn.info.status = 'error';
    return false;
  }

  private async cleanupIdleConnections(): Promise<void> {
    const now = Date.now();
    const idleConnections: string[] = [];

    for (const [key, conn] of this.connections) {
      if (now - conn.info.lastUsed > this.options.idleTimeout && conn.info.status !== 'error') {
        idleConnections.push(key);
      }
    }

    for (const key of idleConnections) {
      await this.removeAdapter(key);
    }
  }

  private async performHealthCheck(): Promise<void> {
    for (const [key, conn] of this.connections) {
      if (conn.info.status === 'error') {
        await this.attemptReconnect(key);
        continue;
      }

      try {
        await conn.adapter.getStatus();
        conn.info.status = 'connected';
      } catch (error) {
        this.handleConnectionError(key, error as Error);
      }
    }
  }

  private handleConnectionError(key: string, error: Error): void {
    const conn = this.connections.get(key);
    if (!conn) return;

    conn.info.errorCount++;
    conn.info.lastError = error.message;

    if (conn.info.errorCount >= this.options.reconnectAttempts) {
      conn.info.status = 'error';
    }
  }

  private generateKey(config: StratixOpenClawConfig): string {
    return `${config.endpoint}:${config.accountId}`;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  public async initializeAll(configs: StratixOpenClawConfig[]): Promise<Map<string, boolean>> {
    const results = new Map<string, boolean>();

    for (const config of configs) {
      const key = this.generateKey(config);
      try {
        await this.getAdapter(config);
        results.set(key, true);
      } catch {
        results.set(key, false);
      }
      await this.sleep(this.options.connectionBatchDelay);
    }

    return results;
  }

  public async invokeAll<T = unknown>(
    tool: string,
    args?: Record<string, unknown>,
    options?: { sessionKey?: string; action?: string }
  ): Promise<InvokeAllResult<T>[]> {
    const connectedAdapters = Array.from(this.connections.entries()).filter(
      ([_, conn]) => conn.info.status === 'connected'
    );

    const results = await Promise.all(
      connectedAdapters.map(async ([key, conn]): Promise<InvokeAllResult<T>> => {
        try {
          const result = await conn.adapter.invokeTool<T>(tool, args, options);
          return { key, success: true, result };
        } catch (error) {
          return { key, success: false, error: (error as Error).message };
        }
      })
    );

    return Array.from(results);
  }

  public async invokeFirst<T = unknown>(
    tool: string,
    args?: Record<string, unknown>,
    options?: { sessionKey?: string; action?: string }
  ): Promise<{ key: string; result: T }> {
    for (const [key, conn] of this.connections) {
      if (conn.info.status !== 'connected') continue;

      try {
        const result = await conn.adapter.invokeTool<T>(tool, args, options);
        return { key, result };
      } catch {
        continue;
      }
    }

    throw new Error('No available connections');
  }

  public async invokeRoundRobin<T = unknown>(
    tool: string,
    args?: Record<string, unknown>,
    options?: { sessionKey?: string; action?: string }
  ): Promise<{ key: string; result: T }> {
    const connectedKeys = Array.from(this.connections.entries())
      .filter(([_, conn]) => conn.info.status === 'connected')
      .map(([key]) => key);

    if (connectedKeys.length === 0) {
      throw new Error('No available connections');
    }

    const key = connectedKeys[Math.floor(Math.random() * connectedKeys.length)];
    const conn = this.connections.get(key)!;

    const result = await conn.adapter.invokeTool<T>(tool, args, options);
    return { key, result };
  }

  public getConnectedKeys(): string[] {
    return Array.from(this.connections.entries())
      .filter(([_, conn]) => conn.info.status === 'connected')
      .map(([key]) => key);
  }

  public getAdapterByKey(key: string): OpenClawAdapterInterface | null {
    return this.connections.get(key)?.adapter || null;
  }
}

export default ConnectionPool;
