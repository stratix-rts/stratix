/**
 * MCPConnectionManager - Connection lifecycle management with auto-reconnect
 *
 * Responsibilities:
 * - connect(serverRef): Promise<ConnectionHandle> with auto-reconnect
 * - disconnect(connectionId): void
 * - getConnection(id): ConnectionHandle | null
 * - healthCheck(id): HealthStatus
 * - Connection state tracking via StratixStateStore
 * - Exponential backoff reconnect (max 5 retries)
 */

import { retryPolicyEngine } from '../retry/RetryPolicyEngine';
import { stratixStateStore, MCPConnection } from '../state/StratixStateStore';

import {
  MCPServerRef,
  ConnectionHandle,
  ConnectionStatus,
  ConnectionMetrics,
  HealthStatus,
  HealthLevel,
  HealthIssue,
  ReconnectConfig,
  DEFAULT_RECONNECT_CONFIG,
} from './types';

const INTERNAL_STATE_KEY = '__mcp_connections' as const;

interface InternalConnection {
  handle: ConnectionHandle;
  reconnectTimer?: ReturnType<typeof setTimeout>;
  healthCheckTimer?: ReturnType<typeof setInterval>;
  isIntentionalDisconnect: boolean;
}

export class MCPConnectionManager {
  private connections = new Map<string, InternalConnection>();
  private reconnectConfigs = new Map<string, ReconnectConfig>();

  constructor() {}

  /**
   * Connect to an MCP server with auto-reconnect
   */
  async connect(
    serverRef: MCPServerRef,
    reconnectConfig: Partial<ReconnectConfig> = {}
  ): Promise<ConnectionHandle> {
    const config: ReconnectConfig = { ...DEFAULT_RECONNECT_CONFIG, ...reconnectConfig };

    // Check if already connected
    const existing = this.connections.get(serverRef.id);
    if (existing && existing.handle.status === 'connected') {
      return existing.handle;
    }

    const metrics: ConnectionMetrics = {
      reconnectAttempts: 0,
      totalReconnects: 0,
    };

    const handle: ConnectionHandle = {
      id: serverRef.id,
      serverRef,
      status: 'connecting',
      metrics,
      createdAt: Date.now(),
    };

    const internal: InternalConnection = {
      handle,
      isIntentionalDisconnect: false,
    };

    this.connections.set(serverRef.id, internal);
    this.reconnectConfigs.set(serverRef.id, config);

    try {
      await this.establishConnection(serverRef, handle, internal, config);
      return handle;
    } catch (error) {
      handle.status = 'error';
      handle.metrics.lastError = error instanceof Error ? error.message : 'Connection failed';
      this.trackInStateStore(handle);
      throw error;
    }
  }

  /**
   * Disconnect from an MCP server
   */
  disconnect(connectionId: string): void {
    const internal = this.connections.get(connectionId);
    if (!internal) return;

    internal.isIntentionalDisconnect = true;
    this.clearTimers(internal);

    internal.handle.status = 'disconnected';
    this.connections.delete(connectionId);
    this.reconnectConfigs.delete(connectionId);
    this.trackInStateStore(internal.handle);
  }

  /**
   * Get a connection handle by ID
   */
  getConnection(id: string): ConnectionHandle | null {
    const internal = this.connections.get(id);
    return internal ? { ...internal.handle } : null;
  }

  /**
   * Get all active connections
   */
  getAllConnections(): ConnectionHandle[] {
    return Array.from(this.connections.values()).map((i) => ({ ...i.handle }));
  }

  /**
   * Perform health check on a connection
   */
  healthCheck(connectionId: string): HealthStatus {
    const internal = this.connections.get(connectionId);
    if (!internal) {
      return {
        connectionId,
        level: 'unhealthy',
        lastCheck: Date.now(),
        issues: [{ code: 'NOT_FOUND', message: 'Connection not found' }],
      };
    }

    const { handle } = internal;
    const issues: HealthIssue[] = [];

    let level: HealthLevel = 'healthy';

    if (handle.status === 'disconnected') {
      level = 'unhealthy';
      issues.push({ code: 'DISCONNECTED', message: 'Connection is disconnected', since: handle.metrics.connectedAt });
    } else if (handle.status === 'error') {
      level = 'unhealthy';
      issues.push({
        code: 'ERROR',
        message: handle.metrics.lastError || 'Unknown error',
      });
    } else if (handle.status === 'reconnecting') {
      level = 'degraded';
      issues.push({
        code: 'RECONNECTING',
        message: `Reconnecting (attempt ${handle.metrics.reconnectAttempts})`,
        since: handle.metrics.connectedAt,
      });
    }

    handle.metrics.lastHealthCheck = Date.now();

    return {
      connectionId,
      level,
      lastCheck: handle.metrics.lastHealthCheck,
      issues,
    };
  }

  /**
   * Reconnect a disconnected/error connection
   */
  async reconnect(connectionId: string): Promise<ConnectionHandle> {
    const internal = this.connections.get(connectionId);
    if (!internal) {
      throw new Error(`Connection ${connectionId} not found`);
    }

    const { handle, isIntentionalDisconnect } = internal;
    if (isIntentionalDisconnect) {
      throw new Error('Connection was intentionally disconnected');
    }

    const config = this.reconnectConfigs.get(connectionId) ?? DEFAULT_RECONNECT_CONFIG;
    handle.status = 'reconnecting';
    this.trackInStateStore(handle);

    await this.establishConnection(handle.serverRef, handle, internal, config);
    return handle;
  }

  // ---------------------------------------------------------------------------
  // Private Methods
  // ---------------------------------------------------------------------------

  private async establishConnection(
    serverRef: MCPServerRef,
    handle: ConnectionHandle,
    internal: InternalConnection,
    config: ReconnectConfig
  ): Promise<void> {
    handle.status = 'connecting';
    this.trackInStateStore(handle);

    try {
      // Simulate connection establishment
      // In real implementation, this would use OpenClawWebSocketConnection or similar
      await this.simulateConnect(serverRef);

      handle.status = 'connected';
      handle.metrics.connectedAt = Date.now();
      handle.metrics.reconnectAttempts = 0;
      handle.metrics.lastError = undefined;
      this.trackInStateStore(handle);

      // Start health check timer
      this.startHealthCheck(internal);
    } catch (error) {
      handle.metrics.reconnectAttempts++;
      handle.metrics.totalReconnects++;
      handle.metrics.lastError = error instanceof Error ? error.message : 'Connection failed';

      if (handle.metrics.reconnectAttempts <= config.maxRetries && !internal.isIntentionalDisconnect) {
        await this.scheduleReconnect(serverRef, handle, internal, config);
      } else {
        handle.status = 'error';
        this.trackInStateStore(handle);
        throw error;
      }
    }
  }

  private async simulateConnect(serverRef: MCPServerRef): Promise<void> {
    // Simulate network delay
    await new Promise<void>((resolve, reject) => {
      const delay = 100 + Math.random() * 100;
      setTimeout(() => {
        // Simulate occasional connection failure for testing
        if ((serverRef as { _simulateFailure?: boolean })._simulateFailure) {
          reject(new Error('Simulated connection failure'));
        } else {
          resolve();
        }
      }, delay);
    });
  }

  private async scheduleReconnect(
    serverRef: MCPServerRef,
    handle: ConnectionHandle,
    internal: InternalConnection,
    config: ReconnectConfig
  ): Promise<void> {
    const attempt = handle.metrics.reconnectAttempts;
    const delay = this.calculateBackoff(attempt, config);

    handle.status = 'reconnecting';
    this.trackInStateStore(handle);

    internal.reconnectTimer = setTimeout(async () => {
      if (internal.isIntentionalDisconnect) return;
      try {
        await this.establishConnection(serverRef, handle, internal, config);
      } catch {
        // establishConnection handles scheduling the next reconnect
      }
    }, delay);
  }

  private calculateBackoff(attempt: number, config: ReconnectConfig): number {
    const delay = config.initialDelayMs * Math.pow(config.backoffMultiplier, attempt - 1);
    const capped = Math.min(delay, config.maxDelayMs);
    // Add jitter (0.8 - 1.2)
    const jitter = 0.8 + Math.random() * 0.4;
    return Math.floor(capped * jitter);
  }

  private startHealthCheck(internal: InternalConnection): void {
    this.clearHealthCheck(internal);

    internal.healthCheckTimer = setInterval(() => {
      if (internal.handle.status !== 'connected') {
        this.clearHealthCheck(internal);
        return;
      }

      // In a real implementation, this would ping the server
      // For now, we just update the timestamp
      internal.handle.metrics.lastHealthCheck = Date.now();
    }, 30000);
  }

  private clearHealthCheck(internal: InternalConnection): void {
    if (internal.healthCheckTimer) {
      clearInterval(internal.healthCheckTimer);
      internal.healthCheckTimer = undefined;
    }
  }

  private clearTimers(internal: InternalConnection): void {
    if (internal.reconnectTimer) {
      clearTimeout(internal.reconnectTimer);
      internal.reconnectTimer = undefined;
    }
    this.clearHealthCheck(internal);
  }

  private trackInStateStore(handle: ConnectionHandle): void {
    try {
      const mcpState = stratixStateStore.select('mcp');
      const connections = [...mcpState.connections];
      const idx = connections.findIndex((c) => c.id === handle.id);

      // Map internal status to state-compatible status (state doesn't have 'reconnecting')
      const stateStatus: MCPConnection['status'] =
        handle.status === 'reconnecting' ? 'connecting' : handle.status;

      const stateConn: MCPConnection = {
        id: handle.id,
        name: handle.serverRef.name,
        status: stateStatus,
        endpoint: handle.serverRef.endpoint,
        lastError: handle.metrics.lastError,
      };

      if (idx >= 0) {
        connections[idx] = stateConn;
      } else {
        connections.push(stateConn);
      }

      stratixStateStore.set('mcp', { ...mcpState, connections });
    } catch {
      // State store may not be initialized in test environments
    }
  }
}

// Singleton export
export const mcpConnectionManager = new MCPConnectionManager();
