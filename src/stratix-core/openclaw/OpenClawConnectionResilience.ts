/**
 * OpenClawConnectionResilience.ts
 * Connection resilience for OpenClaw/MCP connections with retry, auth refresh, and event logging.
 */

export interface ConnectionHandle {
  id: string;
  status: 'connected' | 'disconnected' | 'reconnecting';
  connectedAt: number;
  lastActivity: number;
  config: ResilienceConfig;
}

export interface ResilienceConfig {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
  authRefreshIntervalMs: number;
  heartbeatIntervalMs: number;
}

export interface ConnectionEvent {
  type: 'connected' | 'lost' | 'reconnected' | 'auth_refreshed' | 'error';
  connectionId: string;
  timestamp: number;
  detail?: string;
}

export class OpenClawConnectionResilience {
  private connections: Map<string, ConnectionHandle> = new Map();
  private eventLog: ConnectionEvent[] = [];
  private config: ResilienceConfig;

  constructor(config: Partial<ResilienceConfig> = {}) {
    this.config = {
      maxRetries: 3,
      baseDelayMs: 1000,
      maxDelayMs: 30000,
      authRefreshIntervalMs: 300000,
      heartbeatIntervalMs: 30000,
      ...config,
    };
  }

  register(id: string, config?: Partial<ResilienceConfig>): ConnectionHandle {
    const mergedConfig = { ...this.config, ...config };
    const handle: ConnectionHandle = {
      id,
      status: 'disconnected',
      connectedAt: 0,
      lastActivity: Date.now(),
      config: mergedConfig,
    };
    this.connections.set(id, handle);
    return handle;
  }

  markConnected(id: string): void {
    const handle = this.connections.get(id);
    if (!handle) return;
    handle.status = 'connected';
    handle.connectedAt = Date.now();
    handle.lastActivity = Date.now();
    this.logEvent('connected', id);
  }

  markDisconnected(id: string): void {
    const handle = this.connections.get(id);
    if (!handle) return;
    handle.status = 'disconnected';
    handle.lastActivity = Date.now();
    this.logEvent('lost', id);
  }

  getHandle(id: string): ConnectionHandle | undefined {
    return this.connections.get(id);
  }

  isConnected(id: string): boolean {
    const handle = this.connections.get(id);
    return handle?.status === 'connected';
  }

  getAllConnections(): ConnectionHandle[] {
    return Array.from(this.connections.values());
  }

  async onConnectionLost(
    id: string,
    reconnectFn: () => Promise<boolean>
  ): Promise<boolean> {
    const handle = this.connections.get(id);
    if (!handle) return false;

    handle.status = 'reconnecting';
    const { maxRetries, baseDelayMs, maxDelayMs } = handle.config;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const delay =
        Math.min(baseDelayMs * Math.pow(2, attempt), maxDelayMs) +
        Math.random() * 100;
      await this.sleep(delay);

      try {
        const success = await reconnectFn();
        if (success) {
          this.markConnected(id);
          this.logEvent('reconnected', id, `attempt ${attempt}`);
          return true;
        }
      } catch (err) {
        this.logEvent('error', id, `reconnect attempt ${attempt}: ${err}`);
      }
    }

    this.markDisconnected(id);
    return false;
  }

  async refreshAuth(
    id: string,
    refreshFn: () => Promise<boolean>
  ): Promise<boolean> {
    const handle = this.connections.get(id);
    if (!handle) return false;

    try {
      const success = await refreshFn();
      if (success) {
        this.logEvent('auth_refreshed', id);
        return true;
      }
    } catch (err) {
      this.logEvent('error', id, `auth refresh failed: ${err}`);
    }

    this.markDisconnected(id);
    return false;
  }

  getEventLog(connectionId?: string): ConnectionEvent[] {
    if (connectionId) {
      return this.eventLog.filter((e) => e.connectionId === connectionId);
    }
    return [...this.eventLog];
  }

  async gracefulShutdown(): Promise<void> {
    for (const id of Array.from(this.connections.keys())) {
      this.markDisconnected(id);
    }
  }

  private logEvent(
    type: ConnectionEvent['type'],
    connectionId: string,
    detail?: string
  ): void {
    this.eventLog.push({
      type,
      connectionId,
      timestamp: Date.now(),
      detail,
    });
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
