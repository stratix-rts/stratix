/**
 * SessionRuntime Type Definitions
 * Unified session management layer for agent-human exchanges
 */

/**
 * Represents a single chat message in a session
 */
export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  metadata?: Record<string, unknown>;
}

/**
 * Token usage tracking for a session or turn
 */
export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  turnCount: number;
}

/**
 * Records a permission denial event during agent execution
 */
export interface PermissionDenial {
  timestamp: number;
  permission: string;
  reason: string;
  context?: string;
}

/**
 * Metadata attached to a turn result
 */
export interface TurnMetadata {
  turnId: string;
  sessionId: string;
  timestamp: number;
  duration: number;
  retries: number;
  interrupted: boolean;
  error?: string;
}

/**
 * Options for executing a turn
 */
export interface TurnOptions {
  /** Maximum retry attempts on failure (default: 2) */
  maxRetries?: number;
  /** Timeout in milliseconds (default: 30000) */
  timeout?: number;
  /** Abort signal for cancellation */
  signal?: AbortSignal;
}

/**
 * Result of a single turn execution
 */
export interface TurnResult {
  /** The agent's response content */
  response: string;
  /** Token usage for this turn */
  usage: TokenUsage;
  /** Turn metadata */
  metadata: TurnMetadata;
  /** Whether the turn was interrupted */
  interrupted: boolean;
}

/**
 * Active session context holding all session state
 */
export interface SessionContext {
  sessionId: string;
  agentId: string;
  messages: ChatMessage[];
  usage: TokenUsage;
  memory: Map<string, unknown>;
  discoveredSkills: string[];
  permissionDenials: PermissionDenial[];
  createdAt: number;
  updatedAt: number;
  status: 'active' | 'paused' | 'destroyed';
}

/**
 * A single entry in the transcript log (JSONL format)
 */
export interface TranscriptEntry {
  sessionId: string;
  turnId: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  usage?: TokenUsage;
  metadata?: Record<string, unknown>;
}

/**
 * Query options for transcript retrieval
 */
export interface TranscriptQuery {
  sessionId?: string;
  startTime?: number;
  endTime?: number;
  limit?: number;
}
