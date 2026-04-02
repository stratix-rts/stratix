/**
 * MCP Connection Resilience Layer - Type Definitions
 */

// ---------------------------------------------------------------------------
// Server Reference
// ---------------------------------------------------------------------------

export interface MCPServerRef {
  id: string;
  name: string;
  endpoint: string;
  transport?: 'websocket' | 'http' | 'stdio';
  capabilities?: string[];
  metadata?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Connection Handle
// ---------------------------------------------------------------------------

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error' | 'reconnecting';

export interface ConnectionMetrics {
  connectedAt?: number;
  lastHealthCheck?: number;
  reconnectAttempts: number;
  totalReconnects: number;
  lastError?: string;
}

export interface ConnectionHandle {
  id: string;
  serverRef: MCPServerRef;
  status: ConnectionStatus;
  metrics: ConnectionMetrics;
  createdAt: number;
}

// ---------------------------------------------------------------------------
// Health Status
// ---------------------------------------------------------------------------

export type HealthLevel = 'healthy' | 'degraded' | 'unhealthy';

export interface HealthStatus {
  connectionId: string;
  level: HealthLevel;
  latencyMs?: number;
  lastCheck: number;
  issues: HealthIssue[];
}

export interface HealthIssue {
  code: string;
  message: string;
  since?: number;
}

// ---------------------------------------------------------------------------
// Result Transformation
// ---------------------------------------------------------------------------

export type ContentBlockType = 'text' | 'image' | 'binary' | 'resource';

export interface TextBlock {
  type: 'text';
  text: string;
  truncated?: boolean;
}

export interface ImageBlock {
  type: 'image';
  url?: string;
  base64?: string;
  mimeType: string;
  sizeBytes: number;
  resized?: boolean;
}

export interface BinaryBlock {
  type: 'binary';
  filePath: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
}

export interface ResourceBlock {
  type: 'resource';
  uri: string;
  mimeType: string;
  sizeBytes: number;
}

export type TransformedContentBlock = TextBlock | ImageBlock | BinaryBlock | ResourceBlock;

export interface TransformedResult {
  content: TransformedContentBlock[];
  totalSizeBytes: number;
  wasTruncated: boolean;
  warnings: string[];
}

// ---------------------------------------------------------------------------
// Reconnect Policy
// ---------------------------------------------------------------------------

export interface ReconnectConfig {
  maxRetries: number;
  initialDelayMs: number;
  maxDelayMs: number;
  backoffMultiplier: number;
}

export const DEFAULT_RECONNECT_CONFIG: ReconnectConfig = {
  maxRetries: 5,
  initialDelayMs: 1000,
  maxDelayMs: 30000,
  backoffMultiplier: 2,
};

// ---------------------------------------------------------------------------
// MCP Result Transformer Config
// ---------------------------------------------------------------------------

export interface TransformerConfig {
  maxTextLength: number;
  maxImageBytes: number;
  maxTotalBytes: number;
}

export const DEFAULT_TRANSFORMER_CONFIG: TransformerConfig = {
  maxTextLength: 10000,
  maxImageBytes: 2 * 1024 * 1024, // 2MB
  maxTotalBytes: 50 * 1024, // 50KB
};
