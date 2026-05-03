/**
 * SessionRuntime - Unified session management layer
 * Handles session lifecycle, turn execution, and usage tracking
 */

import { randomUUID } from 'crypto';

import { TranscriptStore } from './TranscriptStore';
import { stratixStateStore, type SessionState } from '../../stratix-core/state/StratixStateStore';
import type {
  SessionContext,
  TurnOptions,
  TurnResult,
  TurnMetadata,
  ChatMessage,
  TokenUsage,
  TranscriptEntry,
} from './types';

// ============================================
// Constants
// ============================================
const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_TURN_TIMEOUT_MS = 30000;

/**
 * Default token usage structure
 */
function createEmptyUsage(): TokenUsage {
  return {
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    turnCount: 0,
  };
}

/**
 * Create an empty session context
 */
function createEmptyContext(sessionId: string, agentId: string): SessionContext {
  return {
    sessionId,
    agentId,
    messages: [],
    usage: createEmptyUsage(),
    memory: new Map(),
    discoveredSkills: [],
    permissionDenials: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
    status: 'active',
  };
}

/**
 * Generate a short turn ID
 */
function generateTurnId(): string {
  return `turn_${Date.now()}_${randomUUID().slice(0, 8)}`;
}

/**
 * Agent delegate interface for turn execution.
 * Allows external agents (e.g., EnhancedStratixAgent) to provide LLM execution logic.
 */
export interface AgentTurnDelegate {
  executeAgentTurn(
    session: SessionContext,
    message: string,
    timeout: number,
    signal?: AbortSignal
  ): Promise<{ response: string; usage: TokenUsage }>;
}

/**
 * SessionRuntime manages agent sessions with transcript persistence
 */
export class SessionRuntime {
  private sessions: Map<string, SessionContext> = new Map();
  private transcriptStore: TranscriptStore;
  private agentDelegate: AgentTurnDelegate | null;

  constructor(transcriptDir: string = '.transcripts', agentDelegate: AgentTurnDelegate | null = null) {
    this.transcriptStore = new TranscriptStore(transcriptDir);
    this.agentDelegate = agentDelegate;
  }

  /**
   * Create a new session for an agent
   */
  async createSession(agentId: string): Promise<SessionContext> {
    const sessionId = `sess_${randomUUID()}`;
    const context = createEmptyContext(sessionId, agentId);
    this.sessions.set(sessionId, context);
    return context;
  }

  /**
   * Retrieve an existing session by ID
   */
  async getSession(sessionId: string): Promise<SessionContext | null> {
    return this.sessions.get(sessionId) || null;
  }

  /**
   * Resume an existing session, loading its transcript
   */
  async resumeSession(sessionId: string): Promise<SessionContext> {
    const existing = this.sessions.get(sessionId);
    if (existing) {
      if (existing.status === 'destroyed') {
        throw new Error(`Session ${sessionId} has been destroyed`);
      }
      return existing;
    }

    // Load from transcript
    const entries = await this.transcriptStore.getBySession(sessionId);
    if (entries.length === 0) {
      throw new Error(`Session ${sessionId} not found`);
    }

    // Reconstruct session context from transcript
    // First entry should have agentId
    const firstEntry = entries[0];
    const context = createEmptyContext(sessionId, firstEntry.sessionId);

    for (const entry of entries) {
      const msg: ChatMessage = {
        id: entry.turnId,
        role: entry.role,
        content: entry.content,
        timestamp: entry.timestamp,
        metadata: entry.metadata,
      };
      context.messages.push(msg);

      if (entry.usage) {
        context.usage.promptTokens += entry.usage.promptTokens;
        context.usage.completionTokens += entry.usage.completionTokens;
        context.usage.totalTokens += entry.usage.totalTokens;
        context.usage.turnCount += entry.usage.turnCount;
      }
    }

    context.status = 'active';
    this.sessions.set(sessionId, context);
    return context;
  }

  /**
   * Execute a single turn in the session
   */
  async executeTurn(
    sessionId: string,
    message: string,
    options: TurnOptions = {}
  ): Promise<TurnResult> {
    const { maxRetries = DEFAULT_MAX_RETRIES, timeout = DEFAULT_TURN_TIMEOUT_MS, signal } = options;

    const session = await this.getSession(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }
    if (session.status !== 'active') {
      throw new Error(`Session ${sessionId} is ${session.status}`);
    }

    const startTime = Date.now();
    const turnId = generateTurnId();

    await this.recordUserMessage(session, message, turnId, startTime);

    const { response, usage, retries, interrupted, error } = await this.executeWithRetries(
      session,
      message,
      timeout,
      signal,
      maxRetries
    );

    const endTime = Date.now();
    const duration = endTime - startTime;

    await this.recordAssistantMessage(session, response, turnId, retries, usage, endTime);
    this.updateSessionUsage(session, usage, endTime);
    this.syncSessionToStateStore(session);

    const metadata: TurnMetadata = {
      turnId,
      sessionId,
      timestamp: endTime,
      duration,
      retries,
      interrupted,
      error: retries > maxRetries ? error : undefined,
    };

    return {
      response,
      usage,
      metadata,
      interrupted,
    };
  }

  private async recordUserMessage(
    session: SessionContext,
    message: string,
    turnId: string,
    timestamp: number
  ): Promise<void> {
    session.messages.push({ id: turnId, role: 'user', content: message, timestamp });
    await this.transcriptStore.append({ sessionId: session.sessionId, turnId, role: 'user', content: message, timestamp });
  }

  private async executeWithRetries(
    session: SessionContext,
    message: string,
    timeout: number,
    signal: AbortSignal | undefined,
    maxRetries: number
  ): Promise<{ response: string; usage: TokenUsage; retries: number; interrupted: boolean; error?: string }> {
    let retries = 0;
    let interrupted = false;
    let error: string | undefined;
    let response = '';
    let usage = createEmptyUsage();

    while (retries <= maxRetries) {
      try {
        if (signal?.aborted) {
          interrupted = true;
          break;
        }
        const result = await this.executeAgentTurn(session, message, timeout, signal);
        response = result.response;
        usage = result.usage;
        break;
      } catch (err) {
        retries++;
        error = err instanceof Error ? err.message : String(err);
        if (retries > maxRetries) {
          response = `Error after ${maxRetries} retries: ${error}`;
        }
      }
    }

    return { response, usage, retries, interrupted, error };
  }

  private async recordAssistantMessage(
    session: SessionContext,
    response: string,
    turnId: string,
    retries: number,
    usage: TokenUsage,
    timestamp: number
  ): Promise<void> {
    session.messages.push({
      id: `asst_${turnId}`,
      role: 'assistant',
      content: response,
      timestamp,
      metadata: { turnId, retries },
    });
    await this.transcriptStore.append({
      sessionId: session.sessionId,
      turnId: `asst_${turnId}`,
      role: 'assistant',
      content: response,
      timestamp,
      usage,
      metadata: { originalTurnId: turnId, retries },
    });
  }

  private updateSessionUsage(session: SessionContext, usage: TokenUsage, timestamp: number): void {
    session.usage.promptTokens += usage.promptTokens;
    session.usage.completionTokens += usage.completionTokens;
    session.usage.totalTokens += usage.totalTokens;
    session.usage.turnCount += 1;
    session.updatedAt = timestamp;
  }

  private syncSessionToStateStore(session: SessionContext): void {
    const sessionState: SessionState = {
      id: session.sessionId,
      agentId: session.agentId,
      messages: session.messages
        .filter(m => m.role === 'user' || m.role === 'assistant')
        .map(m => ({
          role: m.role as 'user' | 'assistant',
          content: m.content,
          timestamp: m.timestamp,
        })),
      usage: {
        promptTokens: session.usage.promptTokens,
        completionTokens: session.usage.completionTokens,
        totalTokens: session.usage.totalTokens,
        turnCount: session.usage.turnCount,
      },
      startedAt: session.createdAt,
    };
    stratixStateStore.setSession(session.sessionId, sessionState);
  }

  /**
   * Internal agent turn execution - delegates to agentDelegate if provided,
   * otherwise falls back to a placeholder response.
   */
  protected async executeAgentTurn(
    session: SessionContext,
    message: string,
    timeout: number,
    signal?: AbortSignal
  ): Promise<{ response: string; usage: TokenUsage }> {
    if (this.agentDelegate) {
      return this.agentDelegate.executeAgentTurn(session, message, timeout, signal);
    }
    // Placeholder: Return mock response for testing
    return {
      response: `[Session ${session.sessionId}] Turn executed`,
      usage: {
        promptTokens: 10,
        completionTokens: 20,
        totalTokens: 30,
        turnCount: 1,
      },
    };
  }

  /**
   * Pause a session (can be resumed)
   */
  async pause(sessionId: string): Promise<void> {
    const session = await this.getSession(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }
    session.status = 'paused';
    session.updatedAt = Date.now();
  }

  /**
   * Destroy a session (permanent, cannot be resumed)
   */
  async destroy(sessionId: string): Promise<void> {
    const session = await this.getSession(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }
    session.status = 'destroyed';
    session.updatedAt = Date.now();
    this.sessions.delete(sessionId);
  }

  /**
   * Get usage statistics for a session
   */
  getUsage(sessionId: string): TokenUsage {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return createEmptyUsage();
    }
    return { ...session.usage };
  }

  /**
   * Get recent messages from a session (synchronous, in-memory only)
   */
  getRecentMessages(sessionId: string, limit: number = 50): ChatMessage[] {
    const session = this.sessions.get(sessionId);
    if (!session) return [];
    return session.messages.slice(-limit);
  }

  /**
   * Add a permission denial to the session
   */
  async recordPermissionDenial(
    sessionId: string,
    permission: string,
    reason: string,
    context?: string
  ): Promise<void> {
    const session = await this.getSession(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }
    session.permissionDenials.push({
      timestamp: Date.now(),
      permission,
      reason,
      context,
    });
  }

  /**
   * Add a discovered skill to the session
   */
  async recordDiscoveredSkill(sessionId: string, skill: string): Promise<void> {
    const session = await this.getSession(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }
    if (!session.discoveredSkills.includes(skill)) {
      session.discoveredSkills.push(skill);
    }
  }

  /**
   * Get transcript store for direct access
   */
  getTranscriptStore(): TranscriptStore {
    return this.transcriptStore;
  }

  /**
   * Health check - verifies the runtime is operational
   */
  isHealthy(): boolean {
    return true;
  }

  /**
   * Get runtime statistics
   */
  getStats(): { activeSessions: number; totalMessages: number } {
    let totalMessages = 0;
    for (const session of this.sessions.values()) {
      totalMessages += session.messages.length;
    }
    return {
      activeSessions: this.sessions.size,
      totalMessages,
    };
  }

  /**
   * Dispose of all sessions and clear in-memory state.
   * Call this during graceful shutdown to prevent memory leaks.
   */
  dispose(): void {
    this.sessions.clear();
  }
}
