/**
 * MCP Connection Resilience Layer - Public API
 */

export {
  MCPConnectionManager,
  mcpConnectionManager,
} from './MCPConnectionManager';

export {
  MCPResultTransformer,
  mcpResultTransformer,
} from './MCPResultTransformer';

export {
  DEFAULT_RECONNECT_CONFIG,
  DEFAULT_TRANSFORMER_CONFIG,
} from './types';

export type {
  MCPServerRef,
  ConnectionHandle,
  ConnectionStatus,
  ConnectionMetrics,
  HealthStatus,
  HealthLevel,
  HealthIssue,
  TransformedResult,
  TransformedContentBlock,
  TextBlock,
  ImageBlock,
  BinaryBlock,
  ResourceBlock,
  ReconnectConfig,
  TransformerConfig,
  ContentBlockType,
} from './types';
