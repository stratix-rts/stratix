/**
 * SessionRuntime - Unified session management layer
 * Handles session lifecycle, turn execution, and usage tracking
 */

import { randomUUID } from 'crypto';

import { TranscriptStore } from './TranscriptStore.js';
import type {
  SessionContext,
  TurnOptions,
  TurnResult,
  TurnMetadata,
  ChatMessage,
  TokenUsage,
  TranscriptEntry,
} from './types.js';

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
    const { maxRetries = 2, timeout = 30000, signal } = options;

    const session = await this.getSession(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }
    if (session.status !== 'active') {
      throw new Error(`Session ${sessionId} is ${session.status}`);
    }

    const startTime = Date.now();
    const turnId = generateTurnId();
    let retries = 0;
    let interrupted = false;
    let error: string | undefined;

    // Add user message to session
    const userMsg: ChatMessage = {
      id: turnId,
      role: 'user',
      content: message,
      timestamp: startTime,
    };
    session.messages.push(userMsg);

    // Record in transcript
    const userEntry: TranscriptEntry = {
      sessionId,
      turnId,
      role: 'user',
      content: message,
      timestamp: startTime,
    };
    await this.transcriptStore.append(userEntry);

    // Execute turn with retries
    let response = '';
    let usage = createEmptyUsage();

    while (retries <= maxRetries) {
      try {
        // Check abort signal
        if (signal?.aborted) {
          interrupted = true;
          break;
        }

        // Execute the actual turn - placeholder for agent execution
        // In real implementation, this would call the agent runtime
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

    const endTime = Date.now();
    const duration = endTime - startTime;

    // Add assistant response to session
    const assistantMsg: ChatMessage = {
      id: `asst_${turnId}`,
      role: 'assistant',
      content: response,
      timestamp: endTime,
      metadata: { turnId, retries },
    };
    session.messages.push(assistantMsg);

    // Record in transcript
    const assistantEntry: TranscriptEntry = {
      sessionId,
      turnId: `asst_${turnId}`,
      role: 'assistant',
      content: response,
      timestamp: endTime,
      usage,
      metadata: { originalTurnId: turnId, retries },
    };
    await this.transcriptStore.append(assistantEntry);

    // Update session usage
    session.usage.promptTokens += usage.promptTokens;
    session.usage.completionTokens += usage.completionTokens;
    session.usage.totalTokens += usage.totalTokens;
    session.usage.turnCount += 1;
    session.updatedAt = endTime;

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
}
