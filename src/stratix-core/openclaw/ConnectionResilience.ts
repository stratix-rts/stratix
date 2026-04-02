/**
 * ConnectionResilience - Connection resilience layer for OpenClaw WebSocket connections
 *
 * Features:
 * - Auto-reconnect with exponential backoff
 * - Auth refresh before reconnect
 * - Circuit breaker pattern
 * - Health check / heartbeat
 * - Connection lifecycle events via typed EventEmitter
 *
 * Framework-agnostic: pure TypeScript with Node.js types only.
 */

import { EventEmitter } from 'events';

// ============ Types ============

export type ConnectionResilienceState =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'circuit_open'
  | 'circuit_half_open'
  | 'error';

export interface ResilienceConfig {
  reconnect: boolean; // default true
  maxRetries: number; // default 10
  initialDelayMs: number; // default 1000
  maxDelayMs: number; // default 30000
  jitterFactor: number; // default 0.2
  circuitThreshold: number; // default 5
  circuitResetMs: number; // default 60000
  healthCheckMs: number; // default 30000
  authRefreshFn?: () => Promise<Record<string, string>>; // returns headers to inject
}

export interface ConnectionEvents {
  connecting: () => void;
  connected: () => void;
  disconnected: (reason?: string) => void;
  reconnecting: (attempt: number, delayMs: number) => void;
  error: (error: Error) => void;
  circuit_open: (failureCount: number) => void;
  circuit_half_open: () => void;
  circuit_closed: () => void;
  health_check_failed: (latencyMs: number) => void;
  auth_refresh: () => void;
}

export interface HealthCheckResult {
  healthy: boolean;
  latencyMs: number;
  timestamp: number;
}

/**
 * Connection wrapper interface - implement this to wrap any connection type
 */
export interface IConnection<T = unknown> {
  connect(): Promise<T>;
  disconnect(): Promise<void>;
  send?(data: unknown): Promise<void>;
  isConnected(): boolean;
}

/**
 * Connection resilience events
 */
export type ResilienceEvent =
  | 'connecting'
  | 'connected'
  | 'disconnected'
  | 'reconnecting'
  | 'error'
  | 'circuit_open'
  | 'circuit_half_open'
  | 'circuit_closed'
  | 'health_check_failed'
  | 'auth_refresh';

// ============ Constants ============

const DEFAULT_CONFIG: ResilienceConfig = {
  reconnect: true,
  maxRetries: 10,
  initialDelayMs: 1000,
  maxDelayMs: 30000,
  jitterFactor: 0.2,
  circuitThreshold: 5,
  circuitResetMs: 60000,
  healthCheckMs: 30000,
};

// ============ ConnectionResilience Class ============

export class ConnectionResilience<T = unknown> extends EventEmitter {
  private config: ResilienceConfig;
  private connection: IConnection<T> | null = null;
  private state: ConnectionResilienceState = 'disconnected';
  private retryCount = 0;
  private consecutiveFailures = 0;
  private consecutiveSuccesses = 0;
  private circuitOpenSince = 0;
  private healthCheckTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private isShuttingDown = false;
  private lastHealthCheck: HealthCheckResult | null = null;
  private injectedHeaders: Record<string, string> = {};
  private connectionResult: T | null = null;

  constructor(config: Partial<ResilienceConfig> = {}) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
    // Prevent unhandled error events from crashing
    this.on('error', () => {});
  }

  // ============ Public Methods ============

  /**
   * Wrap an existing connection with resilience features
   */
  wrap(connection: IConnection<T>): void {
    this.connection = connection;
  }

  /**
   * Connect with resilience
   */
  async connect(): Promise<T> {
    if (!this.connection) {
      throw new Error('No connection wrapped. Call wrap() first.');
    }

    this.isShuttingDown = false;
    this.state = 'connecting';
    this.emit('connecting');

    try {
      this.connectionResult = await this.connection.connect();
      this.onConnectSuccess();
      return this.connectionResult;
    } catch (error) {
      this.onConnectFailure(error as Error);
      throw error;
    }
  }

  /**
   * Disconnect gracefully
   */
  async disconnect(reason = 'manual'): Promise<void> {
    this.isShuttingDown = true;
    this.stopHealthCheck();
    this.stopReconnectTimer();

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.connection) {
      try {
        await this.connection.disconnect();
      } catch {
        // Ignore disconnect errors
      }
    }

    this.state = 'disconnected';
    this.emit('disconnected', reason);
  }

  /**
   * Send data through the connection
   */
  async send(data: unknown): Promise<void> {
    if (!this.connection) {
      throw new Error('No connection wrapped. Call wrap() first.');
    }

    if (!this.connection.isConnected()) {
      throw new Error('Connection not established');
    }

    if (this.state === 'circuit_open') {
      throw new Error('Circuit breaker is open');
    }

    try {
      if (this.connection.send) {
        await this.connection.send(data);
      }
      this.onSendSuccess();
    } catch (error) {
      this.onSendFailure(error as Error);
      throw error;
    }
  }

  /**
   * Check if currently connected
   */
  isConnected(): boolean {
    return this.state === 'connected' && (this.connection?.isConnected() ?? false);
  }

  /**
   * Get current state
   */
  getState(): ConnectionResilienceState {
    return this.state;
  }

  /**
   * Get current config
   */
  getConfig(): ResilienceConfig {
    return { ...this.config };
  }

  /**
   * Get last health check result
   */
  getLastHealthCheck(): HealthCheckResult | null {
    return this.lastHealthCheck;
  }

  /**
   * Get connection result from last successful connect
   */
  getConnectionResult(): T | null {
    return this.connectionResult;
  }

  /**
   * Manually reset circuit breaker
   */
  resetCircuit(): void {
    this.consecutiveFailures = 0;
    this.consecutiveSuccesses = 0;
    this.circuitOpenSince = 0;
    if (this.state === 'circuit_open') {
      this.state = 'disconnected';
    }
  }

  // ============ Event Methods ============

  /**
   * Add listener for connection events
   */
  on<E extends ResilienceEvent>(event: E, listener: ConnectionEvents[E]): this {
    return super.on(event, listener);
  }

  /**
   * Remove listener
   */
  off<E extends ResilienceEvent>(event: E, listener: ConnectionEvents[E]): this {
    return super.off(event, listener);
  }

  /**
   * Add one-time listener
   */
  once<E extends ResilienceEvent>(event: E, listener: ConnectionEvents[E]): this {
    return super.once(event, listener);
  }

  // ============ Private Methods: Connection Lifecycle ============

  private onConnectSuccess(): void {
    this.retryCount = 0;
    this.consecutiveFailures = 0;
    this.consecutiveSuccesses++;
    this.state = 'connected';
    this.emit('connected');

    // Start health check
    this.startHealthCheck();
  }

  private onConnectFailure(error: Error): void {
    this.consecutiveFailures++;
    this.consecutiveSuccesses = 0;

    // Check circuit breaker
    if (this.shouldOpenCircuit()) {
      this.openCircuit();
      this.emit('error', error);
      return;
    }

    // Check if we should reconnect
    if (this.config.reconnect && this.retryCount < this.config.maxRetries && !this.isShuttingDown) {
      this.scheduleReconnect();
    } else {
      this.state = 'error';
      this.emit('error', error);
    }
  }

  private onSendSuccess(): void {
    this.consecutiveFailures = 0;
    this.consecutiveSuccesses++;

    // Close circuit if we've had enough successes in half-open state
    if (this.state === 'circuit_half_open' && this.consecutiveSuccesses >= 3) {
      this.closeCircuit();
    }
  }

  private onSendFailure(error: Error): void {
    this.consecutiveFailures++;
    this.consecutiveSuccesses = 0;

    if (this.shouldOpenCircuit()) {
      this.openCircuit();
    }

    this.emit('error', error);
  }

  // ============ Private Methods: Circuit Breaker ============

  private shouldOpenCircuit(): boolean {
    return this.consecutiveFailures >= this.config.circuitThreshold;
  }

  private openCircuit(): void {
    this.state = 'circuit_open';
    this.circuitOpenSince = Date.now();
    this.stopHealthCheck();

    // Schedule circuit reset
    setTimeout(() => {
      this.halfOpenCircuit();
    }, this.config.circuitResetMs);

    this.emit('circuit_open', this.consecutiveFailures);
  }

  private halfOpenCircuit(): void {
    // Only transition if still in open state and reset time has passed
    if (this.state !== 'circuit_open') return;
    if (Date.now() - this.circuitOpenSince < this.config.circuitResetMs) return;

    this.state = 'circuit_half_open';
    this.consecutiveSuccesses = 0;
    this.emit('circuit_half_open');

    // Try a test connection
    this.attemptTestConnection();
  }

  private closeCircuit(): void {
    this.state = 'connected';
    this.consecutiveFailures = 0;
    this.consecutiveSuccesses = 0;
    this.circuitOpenSince = 0;
    this.emit('circuit_closed');
    this.startHealthCheck();
  }

  private async attemptTestConnection(): Promise<void> {
    if (!this.connection) return;

    try {
      await this.connection.connect();
      this.onConnectSuccess();
    } catch {
      // Test failed, go back to open state
      this.consecutiveFailures++;
      this.openCircuit();
    }
  }

  // ============ Private Methods: Reconnect ============

  private scheduleReconnect(): void {
    const delay = this.calculateBackoffDelay();
    this.retryCount++;
    this.state = 'reconnecting';
    this.emit('reconnecting', this.retryCount, delay);

    this.reconnectTimer = setTimeout(async () => {
      await this.attemptReconnect();
    }, delay);
  }

  private async attemptReconnect(): Promise<void> {
    if (!this.connection || this.isShuttingDown) return;

    // Refresh auth if configured
    if (this.config.authRefreshFn) {
      try {
        this.emit('auth_refresh');
        this.injectedHeaders = await this.config.authRefreshFn();
      } catch {
        // Auth refresh failed, continue with current headers
      }
    }

    this.state = 'connecting';
    this.emit('connecting');

    try {
      await this.connection.connect();
      this.onConnectSuccess();
    } catch (error) {
      this.onConnectFailure(error as Error);
    }
  }

  private calculateBackoffDelay(): number {
    // Exponential backoff: initialDelay * 2^(retryCount - 1)
    const exponentialDelay = this.config.initialDelayMs * Math.pow(2, this.retryCount - 1);
    const cappedDelay = Math.min(exponentialDelay, this.config.maxDelayMs);

    // Add jitter
    const jitter = cappedDelay * this.config.jitterFactor * (Math.random() * 2 - 1);
    const delay = cappedDelay + jitter;

    return Math.max(0, Math.floor(delay));
  }

  private stopReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  // ============ Private Methods: Health Check ============

  private startHealthCheck(): void {
    this.stopHealthCheck();

    this.healthCheckTimer = setInterval(async () => {
      await this.performHealthCheck();
    }, this.config.healthCheckMs);
  }

  private stopHealthCheck(): void {
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = null;
    }
  }

  private async performHealthCheck(): Promise<void> {
    if (!this.connection || !this.connection.isConnected()) {
      this.lastHealthCheck = {
        healthy: false,
        latencyMs: -1,
        timestamp: Date.now(),
      };
      this.emit('health_check_failed', -1);
      return;
    }

    const start = Date.now();

    try {
      // Send a ping if supported, otherwise just check connection state
      if (this.connection.send) {
        await this.connection.send({ type: 'ping' });
      }

      const latency = Date.now() - start;
      this.lastHealthCheck = {
        healthy: true,
        latencyMs: latency,
        timestamp: Date.now(),
      };
    } catch {
      const latency = Date.now() - start;
      this.lastHealthCheck = {
        healthy: false,
        latencyMs: latency,
        timestamp: Date.now(),
      };
      this.emit('health_check_failed', latency);

      // Treat health check failure as a connection failure
      this.onSendFailure(new Error('Health check failed'));
    }
  }
}

// ============ Factory Function ============

export function createConnectionResilience<T>(
  connection: IConnection<T>,
  config?: Partial<ResilienceConfig>
): ConnectionResilience<T> {
  const resilience = new ConnectionResilience<T>(config);
  resilience.wrap(connection);
  return resilience;
}

export default ConnectionResilience;
